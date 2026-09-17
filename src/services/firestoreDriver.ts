import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy as fsOrderBy,
  query as fsQuery,
  runTransaction,
  setDoc,
  startAfter as fsStartAfter,
  updateDoc,
  where as fsWhere,
  type QueryConstraint,
  type WhereFilterOp,
} from 'firebase/firestore'
import type { CollectionName } from '@/types'
import { getDb } from './firebase'
import { toPage, type Driver, type Page, type Query, type TxContext, type Unsubscribe, type WhereOp } from './driver'

// ═══════════════════════════════════════════════════════════════════════════
// Driver FIRESTORE — misma interfaz que el mock, datos reales.
//
// Las reglas de firestore.rules exigen que toda query a una colección
// multi-tenant venga filtrada por gymId. Como `TenantRepo` siempre inyecta ese
// filtro, cualquier intento de listar sin él es rechazado por el servidor,
// no solo por el cliente.
// ═══════════════════════════════════════════════════════════════════════════

const OP_MAP: Record<WhereOp, WhereFilterOp> = {
  '==': '==',
  '!=': '!=',
  in: 'in',
  '>': '>',
  '>=': '>=',
  '<': '<',
  '<=': '<=',
}

function constraints(q?: Query): QueryConstraint[] {
  const out: QueryConstraint[] = []
  for (const w of q?.where ?? []) out.push(fsWhere(w.field, OP_MAP[w.op], w.value))
  if (q?.orderBy) {
    out.push(fsOrderBy(q.orderBy.field, q.orderBy.dir))
    // Desempate por id: sin él, dos documentos con el mismo valor de orden
    // pueden repetirse o perderse entre página y página.
    out.push(fsOrderBy(documentId(), q.orderBy.dir))
    if (q.startAfter) out.push(fsStartAfter(q.startAfter.value, q.startAfter.id))
  }
  if (q?.limit != null) out.push(fsLimit(q.limit))
  return out
}

class FirestoreDriver implements Driver {
  readonly kind = 'firestore' as const

  async list<T>(col: CollectionName, q?: Query): Promise<T[]> {
    const snap = await getDocs(fsQuery(collection(getDb(), col), ...constraints(q)))
    return snap.docs.map((d) => ({ ...d.data(), id: d.id })) as T[]
  }

  async count(col: CollectionName, q?: Query): Promise<number> {
    // El orden y el límite no aportan nada a un recuento y sí pueden hacerlo
    // incorrecto, así que solo se conservan los filtros.
    const filters: QueryConstraint[] = (q?.where ?? []).map((w) => fsWhere(w.field, OP_MAP[w.op], w.value))
    const snap = await getCountFromServer(fsQuery(collection(getDb(), col), ...filters))
    return snap.data().count
  }

  async page<T extends { id: string }>(col: CollectionName, q: Query): Promise<Page<T>> {
    const limit = q.limit ?? 25
    const orderField = q.orderBy?.field ?? 'createdAt'
    const rows = await this.list<T>(col, { ...q, limit: limit + 1 })
    return toPage(rows, limit, orderField)
  }

  async get<T>(col: CollectionName, id: string): Promise<T | null> {
    const snap = await getDoc(doc(getDb(), col, id))
    return snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null
  }

  async create<T extends { id: string }>(col: CollectionName, data: T): Promise<T> {
    await setDoc(doc(getDb(), col, data.id), data)
    return data
  }

  async update(col: CollectionName, id: string, patch: Record<string, unknown>): Promise<void> {
    await updateDoc(doc(getDb(), col, id), patch)
  }

  async remove(col: CollectionName, id: string): Promise<void> {
    await deleteDoc(doc(getDb(), col, id))
  }

  watch<T>(col: CollectionName, q: Query | undefined, cb: (rows: T[]) => void): Unsubscribe {
    return onSnapshot(
      fsQuery(collection(getDb(), col), ...constraints(q)),
      (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id })) as T[]),
      (err) => console.error(`[EasyGym] watch(${col}) falló:`, err),
    )
  }

  transaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    return runTransaction(getDb(), async (tx) => {
      // Firestore no permite queries dentro de una transacción: las lecturas
      // de lista se hacen antes y se revalidan con `get` sobre los documentos
      // concretos que se van a tocar.
      const ctx: TxContext = {
        list: async <R>(col: CollectionName, q?: Query) => this.list<R>(col, q),
        get: async <R>(col: CollectionName, id: string) => {
          const snap = await tx.get(doc(getDb(), col, id))
          return snap.exists() ? ({ ...snap.data(), id: snap.id } as R) : null
        },
        create: <R extends { id: string }>(col: CollectionName, data: R) => {
          tx.set(doc(getDb(), col, data.id), data)
        },
        update: (col: CollectionName, id: string, patch: Record<string, unknown>) => {
          tx.update(doc(getDb(), col, id), patch)
        },
        remove: (col: CollectionName, id: string) => {
          tx.delete(doc(getDb(), col, id))
        },
      }
      return fn(ctx)
    })
  }
}

export const firestoreDriver = new FirestoreDriver()
