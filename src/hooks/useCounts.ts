import { useEffect, useState } from 'react'
import type { TenantCollectionName } from '@/types'
import { useSession } from '@/state/SessionContext'
import type { TenantQuery } from '@/services/db'
import { reportError } from '@/lib/errors'

// ═══════════════════════════════════════════════════════════════════════════
// Recuentos sin descargar documentos.
//
// El patrón que sustituye: cargar `members` entera para escribir «42 socios
// tienen esta membresía» debajo de cada tarjeta. Eso son 6 000 lecturas para
// pintar cinco números.
//
// Aquí se pide el recuento al servidor. En Firestore es una agregación que se
// factura a una lectura por cada mil documentos contados; en el driver de
// demostración es un filtro en memoria.
//
// Para los números que se pintan en CADA carga del panel siguen estando
// `counters/{gymId}` y `dailyStats`: un documento leído gana a cualquier
// agregación. Esto es para lo que no vale la pena desnormalizar.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Varios recuentos de la misma colección, uno por clave.
 *
 * `queries` se vuelve a evaluar cuando cambia `deps`, no en cada render: sin
 * eso, un objeto literal nuevo dispararía las consultas indefinidamente.
 */
export function useCounts(
  collection: TenantCollectionName,
  queries: Record<string, TenantQuery>,
  deps: unknown[],
): { counts: Record<string, number>; loading: boolean } {
  const { repo } = useSession()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!repo) {
      setCounts({})
      setLoading(false)
      return
    }
    let live = true
    setLoading(true)

    void (async () => {
      const entries = Object.entries(queries)
      const out: Record<string, number> = {}
      try {
        const results = await Promise.all(entries.map(([, q]) => repo.count(collection, q)))
        entries.forEach(([key], i) => {
          out[key] = results[i]
        })
        if (live) setCounts(out)
      } catch (err) {
        // Un contador que falla degrada la pantalla, no la rompe: se queda sin
        // número, pero la lista de membresías sigue siendo usable.
        reportError(`contar ${collection}`, err)
        if (live) setCounts({})
      } finally {
        if (live) setLoading(false)
      }
    })()

    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, collection, ...deps])

  return { counts, loading }
}
