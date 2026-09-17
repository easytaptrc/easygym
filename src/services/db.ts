import type { CollectionMap, CollectionName, Millis, TenantCollectionName } from '@/types'
import { newId } from '@/lib/utils'
import type { Cursor, Driver, Page, Query, TxContext, Unsubscribe, Where } from './driver'
import { mockDriver } from './mockDriver'
import { initFirebase, isFirebaseConfigured } from './firebase'

// ═══════════════════════════════════════════════════════════════════════════
// Punto único de acceso a datos.
//
// `TenantRepo` es la pieza que hace real el aislamiento multi-tenant en el
// cliente: NUNCA se puede leer ni escribir sin que el gymId del repositorio
// entre en la query. No hay forma de pedir "todos los socios" a secas.
//
// El servidor lo vuelve a comprobar en firestore.rules: aquí prevenimos el
// error honesto, allá prevenimos el ataque.
// ═══════════════════════════════════════════════════════════════════════════

const REQUESTED = import.meta.env.VITE_DATA_DRIVER ?? 'mock'

/**
 * Selección del driver.
 *
 * El SDK de Firebase se importa de forma DIFERIDA: en modo demostración el
 * bundle inicial no lo arrastra (son ~400 KB que nadie necesita descargar
 * para ver una demo). Si piden firebase pero falta la configuración, se cae
 * al mock con un aviso en consola en lugar de romper la aplicación.
 */
async function pickDriver(): Promise<Driver> {
  if (REQUESTED === 'firebase') {
    if (isFirebaseConfigured()) {
      await initFirebase()
      const { firestoreDriver } = await import('./firestoreDriver')
      return firestoreDriver
    }
    console.warn('[EasyGym] VITE_DATA_DRIVER=firebase pero falta VITE_FIREBASE_*. Usando driver mock.')
  }
  return mockDriver
}

export const driver: Driver = await pickDriver()
export const isMockDriver = driver.kind === 'mock'

// ────────────────────────── Acceso sin tenant (plataforma) ──────────────────
// Solo para colecciones de plataforma: gyms, users, subscriptions, settings,
// activity. Cualquier colección de gimnasio debe pasar por TenantRepo.

export const platform = {
  list: <K extends CollectionName>(col: K, q?: Query) => driver.list<CollectionMap[K]>(col, q),
  page: <K extends CollectionName>(col: K, q: Query) =>
    driver.page<CollectionMap[K] & { id: string }>(col, q),
  count: (col: CollectionName, q?: Query) => driver.count(col, q),
  get: <K extends CollectionName>(col: K, id: string) => driver.get<CollectionMap[K]>(col, id),
  create: <K extends CollectionName>(col: K, data: CollectionMap[K] & { id: string }) =>
    driver.create(col, data),
  update: (col: CollectionName, id: string, patch: Record<string, unknown>) => driver.update(col, id, patch),
  remove: (col: CollectionName, id: string) => driver.remove(col, id),
  watch: <K extends CollectionName>(col: K, q: Query | undefined, cb: (rows: CollectionMap[K][]) => void) =>
    driver.watch<CollectionMap[K]>(col, q, cb),
  transaction: <T>(fn: (tx: TxContext) => Promise<T>) => driver.transaction(fn),
}

// ───────────────────────────────── TenantRepo ───────────────────────────────

export interface TenantQuery {
  where?: Where[]
  orderBy?: { field: string; dir: 'asc' | 'desc' }
  limit?: number
  startAfter?: Cursor
}

/** Datos que el llamador aporta al crear: sin id, gymId ni createdAt. */
export type NewDoc<K extends TenantCollectionName> = Omit<
  CollectionMap[K],
  'id' | 'gymId' | 'createdAt' | 'updatedAt'
> &
  Partial<Pick<CollectionMap[K], 'id'>>

export class TenantRepo {
  constructor(readonly gymId: string) {
    if (!gymId) throw new Error('[EasyGym] TenantRepo requiere un gymId')
  }

  /** Inyecta el filtro de tenant en toda consulta. Es innegociable. */
  private scoped(q?: TenantQuery): Query {
    return {
      where: [{ field: 'gymId', op: '==', value: this.gymId }, ...(q?.where ?? [])],
      orderBy: q?.orderBy,
      limit: q?.limit,
      startAfter: q?.startAfter,
    }
  }

  list<K extends TenantCollectionName>(col: K, q?: TenantQuery): Promise<CollectionMap[K][]> {
    return driver.list<CollectionMap[K]>(col, this.scoped(q))
  }

  /**
   * Una página de resultados, con cursor. Es la forma correcta de leer una
   * colección que crece: `list()` sin límite trae 100 000 socios de golpe.
   */
  page<K extends TenantCollectionName>(
    col: K,
    q: TenantQuery,
  ): Promise<Page<CollectionMap[K] & { id: string }>> {
    return driver.page<CollectionMap[K] & { id: string }>(col, this.scoped(q))
  }

  /**
   * Cuenta sin descargar. Siempre acotado a este gimnasio.
   *
   * Para los números del panel están `counters/{gymId}` y `dailyStats`, que se
   * leen en un documento. Esto es para los recuentos puntuales que no vale la
   * pena desnormalizar: «cuántos socios tienen esta membresía», «cuántas
   * reservaciones quedan de esta clase».
   */
  count<K extends TenantCollectionName>(col: K, q?: TenantQuery): Promise<number> {
    return driver.count(col, this.scoped(q))
  }

  /** Lee un documento y verifica que pertenezca a este gimnasio. */
  async get<K extends TenantCollectionName>(col: K, id: string): Promise<CollectionMap[K] | null> {
    const doc = await driver.get<CollectionMap[K]>(col, id)
    if (!doc) return null
    if ((doc as { gymId: string }).gymId !== this.gymId) {
      console.error(`[EasyGym] Acceso cruzado bloqueado: ${col}/${id} no pertenece a ${this.gymId}`)
      return null
    }
    return doc
  }

  async create<K extends TenantCollectionName>(col: K, data: NewDoc<K>): Promise<CollectionMap[K]> {
    const doc = {
      ...(data as object),
      id: (data as { id?: string }).id ?? newId(),
      gymId: this.gymId,
      createdAt: Date.now() as Millis,
    } as CollectionMap[K] & { id: string }
    await driver.create(col, doc)
    return doc
  }

  /** Actualiza solo si el documento es de este gimnasio. gymId es inmutable. */
  async update<K extends TenantCollectionName>(
    col: K,
    id: string,
    patch: Partial<Omit<CollectionMap[K], 'id' | 'gymId' | 'createdAt'>>,
  ): Promise<void> {
    const current = await this.get(col, id)
    if (!current) throw new Error(`[EasyGym] ${col}/${id} no existe en este gimnasio`)
    const { gymId: _ignored, ...safe } = patch as Record<string, unknown>
    void _ignored
    await driver.update(col, id, { ...safe, updatedAt: Date.now() })
  }

  async remove<K extends TenantCollectionName>(col: K, id: string): Promise<void> {
    const current = await this.get(col, id)
    if (!current) throw new Error(`[EasyGym] ${col}/${id} no existe en este gimnasio`)
    await driver.remove(col, id)
  }

  watch<K extends TenantCollectionName>(
    col: K,
    q: TenantQuery | undefined,
    cb: (rows: CollectionMap[K][]) => void,
  ): Unsubscribe {
    return driver.watch<CollectionMap[K]>(col, this.scoped(q), cb)
  }

  /**
   * Cuenta documentos recorriéndolos.
   *
   * ⚠️ NO usar para nada que se pinte en pantalla: con 100 000 socios son
   * 100 000 lecturas facturadas cada vez. Para contadores usa
   * `services/counters.ts`, que los mantiene con incrementos.
   *
   * Queda para tareas puntuales de mantenimiento (reconstruir agregados,
   * migraciones) donde recorrer todo es justamente lo que se quiere.
   */
  async countByScan<K extends TenantCollectionName>(col: K, q?: TenantQuery): Promise<number> {
    return (await this.list(col, q)).length
  }

  /**
   * Transacción con el mismo blindaje de tenant.
   * Es lo que usan `reserveSlot` y el POS para no vender dos veces lo mismo.
   */
  transaction<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
    return driver.transaction((tx) => fn(new ScopedTx(tx, this.gymId)))
  }
}

/** Contexto transaccional ya acotado a un gimnasio. */
export class ScopedTx {
  constructor(
    private tx: TxContext,
    readonly gymId: string,
  ) {}

  list<K extends TenantCollectionName>(col: K, q?: TenantQuery): Promise<CollectionMap[K][]> {
    return this.tx.list<CollectionMap[K]>(col, {
      where: [{ field: 'gymId', op: '==', value: this.gymId }, ...(q?.where ?? [])],
      orderBy: q?.orderBy,
      limit: q?.limit,
    })
  }

  async get<K extends TenantCollectionName>(col: K, id: string): Promise<CollectionMap[K] | null> {
    const doc = await this.tx.get<CollectionMap[K]>(col, id)
    if (!doc || (doc as { gymId: string }).gymId !== this.gymId) return null
    return doc
  }

  create<K extends TenantCollectionName>(col: K, data: NewDoc<K>): CollectionMap[K] {
    const doc = {
      ...(data as object),
      id: (data as { id?: string }).id ?? newId(),
      gymId: this.gymId,
      createdAt: Date.now() as Millis,
    } as CollectionMap[K] & { id: string }
    this.tx.create(col, doc)
    return doc
  }

  update<K extends TenantCollectionName>(col: K, id: string, patch: Record<string, unknown>): void {
    const { gymId: _ignored, ...safe } = patch
    void _ignored
    this.tx.update(col, id, { ...safe, updatedAt: Date.now() })
  }

  remove(col: TenantCollectionName, id: string): void {
    this.tx.remove(col, id)
  }
}

/** Caché de repositorios: un objeto por gimnasio. */
const repoCache = new Map<string, TenantRepo>()

export function repoFor(gymId: string): TenantRepo {
  let r = repoCache.get(gymId)
  if (!r) {
    r = new TenantRepo(gymId)
    repoCache.set(gymId, r)
  }
  return r
}
