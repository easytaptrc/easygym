import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// ═══════════════════════════════════════════════════════════════════════════
// Enlaces a una sección de la página (#funciones, #precios…) dentro del router.
//
// QUÉ PASABA
//
// El menú tenía `href="/easygym#funciones"`. El navegador solo salta a un
// ancla cuando el elemento existe EN ESE INSTANTE, y aquí nunca existe:
//
//   · desde /planes, React Router cambia la ruta sin recargar; el navegador no
//     se entera de que hay un ancla que atender
//   · en una carga limpia de /easygym/#funciones, el navegador busca el ancla
//     antes de que React haya pintado nada, y la landing además llega por
//     `lazy()`, más tarde todavía
//
// Resultado: el enlace "funciona" —la URL cambia, la ruta es correcta— pero la
// página se queda arriba. Parece un enlace roto.
//
// POR QUÉ AQUÍ Y NO EN LA LANDING
//
// Esto no es un problema de la landing: es cómo se comportan las anclas en una
// SPA con basename. Puesto en el router, funciona para cualquier ruta y
// cualquier ancla que se añada después, sin acordarse de nada.
// ═══════════════════════════════════════════════════════════════════════════

/** Hasta cuándo seguir buscando la sección antes de rendirse. */
const ESPERA_MAXIMA_MS = 4000

/** Cada cuánto volver a mirar si ya apareció. */
const INTERVALO_MS = 60

/**
 * Margen para dar por bueno el salto.
 *
 * Con la barra superior fija encima, "arriba del todo" no es exactamente 0.
 */
const TOLERANCIA_PX = 24

export function ScrollToHash() {
  const { hash, key } = useLocation()

  useEffect(() => {
    if (!hash) return

    // El hash llega con almohadilla y puede venir percent-encoded (#gestión).
    let id: string
    try {
      id = decodeURIComponent(hash.slice(1))
    } catch {
      id = hash.slice(1)
    }
    if (!id) return

    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const limite = Date.now() + ESPERA_MAXIMA_MS
    const temporizadores: number[] = []
    let cancelado = false
    let yaSalto = false

    const esperar = (ms: number, fn: () => void) => {
      temporizadores.push(window.setTimeout(fn, ms))
    }

    const saltar = (destino: Element) => {
      destino.scrollIntoView({ behavior: suave && yaSalto ? 'smooth' : 'auto', block: 'start' })

      // Que el teclado y el lector de pantalla vayan donde fue la vista. Sin
      // esto, quien navega con Tab sigue en el menú y el salto no existió.
      if (destino instanceof HTMLElement) {
        const enfocable =
          destino.hasAttribute('tabindex') || /^(a|button|input)$/i.test(destino.tagName)
        if (!enfocable) destino.setAttribute('tabindex', '-1')
        destino.focus({ preventScroll: true })
      }
    }

    // La sección puede no existir todavía: la pantalla viene por `lazy()` y
    // encima hay secciones que se montan cuando terminan de cargar sus datos.
    // Por eso se mira una y otra vez hasta que aparece.
    //
    // Con temporizadores y NO con requestAnimationFrame: rAF se congela en
    // pestañas ocultas y en algunos momentos de la carga, y entonces el salto
    // sencillamente no ocurría. Ya pasó una vez en este proyecto con los
    // contadores del panel; no hace falta que vuelva a pasar.
    const buscar = () => {
      if (cancelado) return

      const destino =
        document.getElementById(id) ?? document.querySelector(`[name="${CSS.escape(id)}"]`)

      if (destino) {
        const arriba = Math.abs(destino.getBoundingClientRect().top) <= TOLERANCIA_PX
        if (!arriba) saltar(destino)
        yaSalto = true

        // Insistir un poco. Al terminar de cargar, el navegador restaura la
        // posición de scroll que tenía la página y puede deshacer el salto;
        // también hay imágenes que al cargar empujan la sección hacia abajo.
        if (Date.now() < limite) esperar(250, buscar)
        return
      }

      if (Date.now() < limite) esperar(INTERVALO_MS, buscar)
    }

    buscar()

    return () => {
      cancelado = true
      temporizadores.forEach(clearTimeout)
    }
    // `key` cambia en cada navegación: sin él, volver a pulsar "Funciones"
    // estando ya en /#funciones no haría nada, porque el hash no cambió.
  }, [hash, key])

  return null
}
