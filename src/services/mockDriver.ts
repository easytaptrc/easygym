import type { CollectionName } from '@/types'
import {
  applyQuery,
  toPage,
  type Driver,
  type Page,
  type Query,
  type TxContext,
  type Unsubscribe,
} from './driver'

// ═══════════════════════════════════════════════════════════════════════════
// Driver MOCK — persistencia en localStorage.
//
// Reproduce el comportamiento que importa de Firestore:
//   · documentos por colección con id
//   · queries con where/orderBy/limit
//   · listeners en tiempo real (watch) que reemiten en cada escritura
//   · transacciones atómicas (necesarias para el cupo de clases y bicicletas)
//   · sincronización entre pestañas vía el evento `storage`
//
// No es una base de datos: es suficiente para que el prototipo se comporte
// como el producto real sin necesitar credenciales.
// ═══════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'easygym:db:v1'

type Doc = Record<string, unknown> & { id: string }
type Store = Partial<Record<CollectionName, Record<string, Doc>>>

/** Latencia simulada para que la UI ejercite sus estados de carga. */
const LATENCY_MS = Number(import.meta.env.VITE_MOCK_LATENCY ?? 45)

class MockDriver implements Driver {
  readonly kind = 'mock' as const

  private store: Store = {}
  private listeners = new Set<(col: CollectionName) => void>()
  private loaded = false
  private writeTimer: ReturnType<typeof setTimeout> | null = null

  // ───────────────────────────── Persistencia ───────────────────────────────

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      this.store = raw ? (JSON.parse(raw) as Store) : {}
    } catch {
      this.store = {}
    }
    // Otra pestaña escribió: recargamos y notificamos a los listeners.
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return
      try {
        this.store = JSON.parse(e.newValue) as Store
        this.emitAll()
      } catch {
        /* payload corrupto: se ignora */
      }
    })
  }

  /** Escritura agrupada: muchas mutaciones seguidas → un solo JSON.stringify. */
  private persist(): void {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store))
      } catch (err) {
        console.warn('[EasyGym] No se pudo persistir la base local:', err)
      }
    }, 0)
  }

  private col(name: CollectionName): Record<string, Doc> {
    this.load()
    return (this.store[name] ??= {})
  }

  private emit(col: CollectionName): void {
    for (const l of this.listeners) l(col)
  }

  private emitAll(): void {
    for (const l of this.listeners) l('__all__' as CollectionName)
  }

  // ─────────────────────────────── Lectura ──────────────────────────────────

  async list<T>(col: CollectionName, q?: Query): Promise<T[]> {
    await tick()
    return this.listSync<T>(col, q)
  }

  listSync<T>(col: CollectionName, q?: Query): T[] {
    const rows = Object.values(this.col(col))
    return applyQuery(rows, q) as unknown as T[]
  }

  async count(col: CollectionName, q?: Query): Promise<number> {
    await tick()
    // Sin orden ni límite: un recuento los ignora, igual que la agregación
    // de Firestore.
    const filtered = applyQuery(Object.values(this.col(col)), q ? { where: q.where ?? [] } : undefined)
    return filtered.length
  }

  async page<T extends { id: string }>(col: CollectionName, q: Query): Promise<Page<T>> {
    await tick()
    const limit = q.limit ?? 25
    const orderField = q.orderBy?.field ?? 'createdAt'
    // Se pide una fila de más para saber si hay página siguiente.
    const rows = this.listSync<T>(col, { ...q, limit: limit + 1 })
    return toPage(rows, limit, orderField)
  }

  async get<T>(col: CollectionName, id: string): Promise<T | null> {
    await tick()
    return (this.col(col)[id] as unknown as T) ?? null
  }

  // ────────────────────────────── Escritura ─────────────────────────────────

  async create<T extends { id: string }>(col: CollectionName, data: T): Promise<T> {
    await tick()
    this.col(col)[data.id] = data as unknown as Doc
    this.persist()
    this.emit(col)
    return data
  }

  async update(col: CollectionName, id: string, patch: Record<string, unknown>): Promise<void> {
    await tick()
    const current = this.col(col)[id]
    if (!current) throw new Error(`[EasyGym] ${col}/${id} no existe`)
    this.col(col)[id] = { ...current, ...patch, id }
    this.persist()
    this.emit(col)
  }

  async remove(col: CollectionName, id: string): Promise<void> {
    await tick()
    delete this.col(col)[id]
    this.persist()
    this.emit(col)
  }

  // ─────────────────────────────── Tiempo real ──────────────────────────────

  watch<T>(col: CollectionName, q: Query | undefined, cb: (rows: T[]) => void): Unsubscribe {
    this.load()
    const fire = () => cb(this.listSync<T>(col, q))
    const listener = (changed: CollectionName) => {
      if (changed === col || (changed as string) === '__all__') fire()
    }
    this.listeners.add(listener)
    // Primera emisión asíncrona, igual que onSnapshot.
    queueMicrotask(fire)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // ────────────────────────────── Transacción ───────────────────────────────
  //
  // Se serializan con una cola: la siguiente transacción no empieza hasta que
  // la anterior terminó. Así `reserveBike` no puede entrelazarse consigo misma.

  private txQueue: Promise<unknown> = Promise.resolve()

  transaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.load()
      const touched = new Set<CollectionName>()
      // Snapshot para poder revertir si `fn` lanza.
      const backup = JSON.stringify(this.store)

      const ctx: TxContext = {
        list: async <R>(col: CollectionName, q?: Query) => this.listSync<R>(col, q),
        get: async <R>(col: CollectionName, id: string) => (this.col(col)[id] as unknown as R) ?? null,
        create: <R extends { id: string }>(col: CollectionName, data: R) => {
          this.col(col)[data.id] = data as unknown as Doc
          touched.add(col)
        },
        update: (col: CollectionName, id: string, patch: Record<string, unknown>) => {
          const cur = this.col(col)[id]
          if (!cur) throw new Error(`[EasyGym] ${col}/${id} no existe`)
          this.col(col)[id] = { ...cur, ...patch, id }
          touched.add(col)
        },
        remove: (col: CollectionName, id: string) => {
          delete this.col(col)[id]
          touched.add(col)
        },
      }

      try {
        const result = await fn(ctx)
        this.persist()
        for (const c of touched) this.emit(c)
        return result
      } catch (err) {
        this.store = JSON.parse(backup) as Store
        throw err
      }
    }

    const next = this.txQueue.then(run, run)
    // La cola nunca se rompe aunque una transacción falle.
    this.txQueue = next.catch(() => undefined)
    return next
  }

  // ─────────────────────────── Utilidades de demo ───────────────────────────

  /** ¿Ya hay datos sembrados? */
  isEmpty(): boolean {
    this.load()
    return Object.keys(this.col('gyms')).length === 0
  }

  /** Carga masiva sin emitir por cada documento (usado por el seed). */
  bulkLoad(data: Store): void {
    this.load()
    for (const [col, docs] of Object.entries(data)) {
      const target = this.col(col as CollectionName)
      for (const [id, doc] of Object.entries(docs as Record<string, Doc>)) target[id] = doc
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store))
    } catch (err) {
      console.warn('[EasyGym] Seed demasiado grande para localStorage:', err)
    }
    this.emitAll()
  }

  /** Borra TODO. Solo lo usa el botón "Reiniciar demo". */
  reset(): void {
    this.store = {}
    this.loaded = true
    localStorage.removeItem(STORAGE_KEY)
    this.emitAll()
  }

  /** Tamaño aproximado en KB de la base local. */
  sizeKb(): number {
    try {
      return Math.round((localStorage.getItem(STORAGE_KEY)?.length ?? 0) / 1024)
    } catch {
      return 0
    }
  }
}

function tick(): Promise<void> {
  return LATENCY_MS > 0 ? new Promise((r) => setTimeout(r, LATENCY_MS)) : Promise.resolve()
}

export const mockDriver = new MockDriver()
