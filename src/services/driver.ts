import type { CollectionName } from '@/types'

// ═══════════════════════════════════════════════════════════════════════════
// Contrato del driver de datos.
//
// Existen dos implementaciones intercambiables:
//   · mockDriver      → localStorage, funciona sin credenciales (demo)
//   · firestoreDriver → Firestore real
//
// TODO el resto de la aplicación habla con `Driver`, nunca con Firestore
// directamente. Cambiar de uno a otro es una variable de entorno.
// ═══════════════════════════════════════════════════════════════════════════

export type WhereOp = '==' | '!=' | 'in' | '>' | '>=' | '<' | '<='

export interface Where {
  field: string
  op: WhereOp
  value: unknown
}

/**
 * Cursor de paginación.
 *
 * Lleva el valor del campo de orden Y el id del documento: sin el id, dos
 * socios dados de alta el mismo milisegundo harían que la página siguiente
 * repita o se salte uno. Firestore ordena de forma estable añadiendo
 * `__name__` como último criterio, y aquí se replica lo mismo.
 */
export interface Cursor {
  value: unknown
  id: string
}

export interface Query {
  where?: Where[]
  orderBy?: { field: string; dir: 'asc' | 'desc' }
  limit?: number
  /** Continúa después de este documento. Requiere `orderBy`. */
  startAfter?: Cursor
}

/** Una página de resultados más su cursor para pedir la siguiente. */
export interface Page<T> {
  rows: T[]
  cursor: Cursor | null
  /** `false` cuando el servidor devolvió menos filas que el límite pedido. */
  hasMore: boolean
}

export type Unsubscribe = () => void

export interface Driver {
  readonly kind: 'mock' | 'firestore'
  list<T>(col: CollectionName, q?: Query): Promise<T[]>
  /**
   * Una página de resultados. Pide `limit + 1` documentos internamente para
   * saber si hay más sin necesitar un `count()` aparte.
   */
  page<T extends { id: string }>(col: CollectionName, q: Query): Promise<Page<T>>
  /**
   * Cuántos documentos cumplen la consulta, SIN descargarlos.
   *
   * Es la diferencia entre leer 6 000 socios para escribir «6 000» en pantalla
   * y no leer ninguno: Firestore resuelve esto en el servidor con una
   * agregación y lo factura a una lectura por cada mil documentos contados.
   *
   * Aun así no es gratis, y no sustituye a `counters/{gymId}` para los números
   * que se pintan en cada carga del panel. Es para los recuentos puntuales que
   * no vale la pena desnormalizar, como «cuántos socios tienen ESTA membresía».
   */
  count(col: CollectionName, q?: Query): Promise<number>
  get<T>(col: CollectionName, id: string): Promise<T | null>
  create<T extends { id: string }>(col: CollectionName, data: T): Promise<T>
  update(col: CollectionName, id: string, patch: Record<string, unknown>): Promise<void>
  remove(col: CollectionName, id: string): Promise<void>
  watch<T>(col: CollectionName, q: Query | undefined, cb: (rows: T[]) => void): Unsubscribe
  /**
   * Operación atómica. En el driver mock es una sección crítica síncrona;
   * en Firestore es una transacción real.
   * Es lo que evita que dos socios reserven la misma bicicleta.
   */
  transaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T>
}

export interface TxContext {
  list<T>(col: CollectionName, q?: Query): Promise<T[]>
  get<T>(col: CollectionName, id: string): Promise<T | null>
  create<T extends { id: string }>(col: CollectionName, data: T): void
  update(col: CollectionName, id: string, patch: Record<string, unknown>): void
  remove(col: CollectionName, id: string): void
}

/**
 * Empaqueta una página a partir de las filas que devolvió el motor.
 *
 * Se piden `limit + 1` documentos: si llega el extra, hay página siguiente.
 * Es una lectura de más, frente a un `count()` que recorre toda la colección.
 */
export function toPage<T extends { id: string }>(rows: T[], limit: number, orderField: string): Page<T> {
  const hasMore = rows.length > limit
  const visible = hasMore ? rows.slice(0, limit) : rows
  const last = visible[visible.length - 1]
  return {
    rows: visible,
    cursor: last ? { value: (last as Record<string, unknown>)[orderField], id: last.id } : null,
    hasMore,
  }
}

// ─────────────────────────── Evaluador de queries ───────────────────────────
// Compartido por el driver mock y por cualquier filtrado en memoria.

export function matches(doc: Record<string, unknown>, where: Where[] | undefined): boolean {
  if (!where || where.length === 0) return true
  return where.every((w) => {
    const v = doc[w.field]
    switch (w.op) {
      case '==':
        return v === w.value
      case '!=':
        return v !== w.value
      case 'in':
        return Array.isArray(w.value) && (w.value as unknown[]).includes(v)
      case '>':
        return (v as number) > (w.value as number)
      case '>=':
        return (v as number) >= (w.value as number)
      case '<':
        return (v as number) < (w.value as number)
      case '<=':
        return (v as number) <= (w.value as number)
      default:
        return false
    }
  })
}

/** Compara dos documentos por (campo de orden, id), igual que Firestore. */
function compareBy(field: string, dir: 'asc' | 'desc') {
  const sign = dir === 'desc' ? -1 : 1
  return (a: Record<string, unknown>, b: Record<string, unknown>) => {
    const av = a[field] as never
    const bv = b[field] as never
    if (av !== bv) return (av > bv ? 1 : -1) * sign
    // Desempate por id: hace la paginación estable.
    const ai = String(a.id ?? '')
    const bi = String(b.id ?? '')
    if (ai === bi) return 0
    return (ai > bi ? 1 : -1) * sign
  }
}

export function applyQuery<T extends Record<string, unknown>>(rows: T[], q?: Query): T[] {
  let out = rows.filter((r) => matches(r, q?.where))
  if (q?.orderBy) {
    const { field, dir } = q.orderBy
    const cmp = compareBy(field, dir)
    out = [...out].sort(cmp)
    if (q.startAfter) {
      const anchor = { [field]: q.startAfter.value, id: q.startAfter.id } as Record<string, unknown>
      out = out.filter((r) => cmp(r, anchor) > 0)
    }
  }
  if (q?.limit != null) out = out.slice(0, q.limit)
  return out
}
