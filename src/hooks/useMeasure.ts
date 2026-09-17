import { useEffect, useRef, useState } from 'react'

/**
 * Ancho real de un contenedor. Las gráficas SVG lo necesitan para repartir
 * etiquetas sin encimarlas; un `viewBox` fijo se deforma al cambiar de tamaño.
 */
export function useMeasure<T extends HTMLElement>(initial = 720) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(initial)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      if (w > 0) setWidth(w)
    }
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { ref, width }
}
