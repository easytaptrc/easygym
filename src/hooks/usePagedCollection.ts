import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CollectionMap, TenantCollectionName } from '@/types'
import { useSession } from '@/state/SessionContext'
import type { Cursor } from '@/services/driver'
import type { TenantQuery } from '@/services/db'

// ═══════════════════════════════════════════════════════════════════════════
// Listado paginado con cursor.
//
// `useCollection` trae TODA la colección y es correcto para conjuntos acotados
// (las clases de un gimnasio, sus bicicletas, su catálogo de membresías).
// Para lo que crece sin techo — socios, pagos, asistencias — hay que pedir
// páginas.
//
// No se usa offset: saltarse 40 000 documentos cuesta como leerlos. El cursor
// lleva el valor del campo de orden y el id del último documento, y Firestore
// salta directo ahí con `startAfter`.
//
// Es un modelo de "cargar más", no de "página 7": con un cursor no se puede
// saltar a una página arbitraria, y eso es justo lo que lo hace barato.
// ═══════════════════════════════════════════════════════════════════════════

export interface PagedState<T> {
  rows: T[]
  loading: boolean
  /** Cargando la siguiente página (las filas actuales siguen visibles). */
  loadingMore: boolean
  hasMore: boolean
  error: Error | null
  loadMore: () => void
  reload: () => void
}

export function usePagedCollection<K extends TenantCollectionName>(
  collection: K,
  query: TenantQuery & { orderBy: { field: string; dir: 'asc' | 'desc' } },
  pageSize = 30,
): PagedState<CollectionMap[K] & { id: string }> {
  type Row = CollectionMap[K] & { id: string }

  const { repo } = useSession()
  const [rows, setRows] = useState<Row[]>([])
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [nonce, setNonce] = useState(0)

  // La query se serializa: un objeto literal nuevo en cada render dispararía
  // una recarga infinita.
  const queryKey = useMemo(() => JSON.stringify(query), [query])

  // Evita que una respuesta lenta de una búsqueda anterior pise a la actual.
  const requestId = useRef(0)

  const fetchPage = useCallback(
    async (after: Cursor | null, append: boolean) => {
      if (!repo) return
      const myRequest = ++requestId.current
      append ? setLoadingMore(true) : setLoading(true)
      try {
        const page = await repo.page(collection, {
          ...(JSON.parse(queryKey) as TenantQuery),
          limit: pageSize,
          ...(after ? { startAfter: after } : {}),
        })
        if (myRequest !== requestId.current) return
        setRows((prev) => (append ? [...prev, ...(page.rows as Row[])] : (page.rows as Row[])))
        setCursor(page.cursor)
        setHasMore(page.hasMore)
        setError(null)
      } catch (err) {
        if (myRequest === requestId.current) setError(err as Error)
      } finally {
        if (myRequest === requestId.current) {
          setLoadingMore(false)
          setLoading(false)
        }
      }
    },
    [repo, collection, queryKey, pageSize],
  )

  // Primera página: se repite cuando cambia el filtro o se fuerza una recarga.
  useEffect(() => {
    setRows([])
    setCursor(null)
    void fetchPage(null, false)
  }, [fetchPage, nonce])

  return {
    rows,
    loading,
    loadingMore,
    hasMore,
    error,
    loadMore: () => {
      if (!loadingMore && hasMore && cursor) void fetchPage(cursor, true)
    },
    reload: () => setNonce((n) => n + 1),
  }
}
