import { useEffect, useMemo, useRef, useState } from 'react'
import type { CollectionMap, TenantCollectionName } from '@/types'
import { useSession } from '@/state/SessionContext'
import type { TenantQuery } from '@/services/db'

// ═══════════════════════════════════════════════════════════════════════════
// Suscripción en vivo a una colección del gimnasio activo.
//
// Usa `repo.watch`, así que en modo Firestore es un `onSnapshot` real: cuando
// alguien reserva una bicicleta o registra una asistencia, la pantalla de
// cualquier otro usuario se actualiza sola.
// ═══════════════════════════════════════════════════════════════════════════

export interface CollectionState<T> {
  data: T[]
  loading: boolean
  error: Error | null
}

export function useCollection<K extends TenantCollectionName>(
  collection: K,
  query?: TenantQuery,
  options?: { enabled?: boolean },
): CollectionState<CollectionMap[K]> {
  const { repo } = useSession()
  const [data, setData] = useState<CollectionMap[K][]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // La query se serializa para no re-suscribirse en cada render por un objeto
  // literal nuevo con el mismo contenido.
  const queryKey = useMemo(() => JSON.stringify(query ?? null), [query])
  const enabled = options?.enabled !== false

  useEffect(() => {
    if (!repo || !enabled) {
      setData([])
      setLoading(false)
      return
    }
    setLoading(true)
    let live = true
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = repo.watch(collection, query, (rows) => {
        if (!live) return
        setData(rows)
        setLoading(false)
        setError(null)
      })
    } catch (err) {
      setError(err as Error)
      setLoading(false)
    }
    return () => {
      live = false
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, collection, queryKey, enabled])

  return { data, loading, error }
}

/** Igual que `useCollection` pero devuelve un único documento. */
export function useDocument<K extends TenantCollectionName>(
  collection: K,
  id: string | null | undefined,
): { data: CollectionMap[K] | null; loading: boolean } {
  const { repo } = useSession()
  const [data, setData] = useState<CollectionMap[K] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!repo || !id) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const off = repo.watch(collection, { where: [{ field: 'id', op: '==', value: id }] }, (rows) => {
      setData(rows[0] ?? null)
      setLoading(false)
    })
    return off
  }, [repo, collection, id])

  return { data, loading }
}

/** Ejecuta una promesa y expone su estado. Para lecturas puntuales. */
export function useAsync<T>(
  factory: () => Promise<T>,
  deps: unknown[],
): { data: T | null; loading: boolean; error: Error | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [nonce, setNonce] = useState(0)
  const factoryRef = useRef(factory)
  factoryRef.current = factory

  useEffect(() => {
    let live = true
    setLoading(true)
    factoryRef
      .current()
      .then((r) => {
        if (!live) return
        setData(r)
        setError(null)
      })
      .catch((e: Error) => live && setError(e))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, loading, error, reload: () => setNonce((n) => n + 1) }
}
