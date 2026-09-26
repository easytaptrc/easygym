import { registerSW } from 'virtual:pwa-register'

// ═══════════════════════════════════════════════════════════════════════════
// VERSIONES: index.html, service worker y chunks tienen que ir juntos.
//
// QUÉ PASABA
//
// El service worker se registraba con `autoUpdate`, que en Workbox significa
// `skipWaiting()`: en cuanto se despliega una versión nueva, el service worker
// nuevo se activa y toma el control de las pestañas YA ABIERTAS, y de paso
// borra el precache anterior.
//
// El problema es que esa pestaña sigue ejecutando el JavaScript de la versión
// VIEJA. Su grafo de módulos apunta a `Dashboard-QZdquKOQ.js`, un nombre con
// hash que solo existía en el build anterior. Entonces el usuario pulsa algo,
// React hace el `import()` diferido, y:
//
//   · el service worker nuevo ya no tiene ese archivo en caché
//   · GitHub Pages tampoco, porque el deploy lo reemplazó
//
//   → Failed to fetch dynamically imported module
//   → Unexpected Application Error!
//
// No es un problema de caché "sucia". Es que se cambió el suelo debajo de una
// aplicación que estaba corriendo.
//
// CÓMO SE ARREGLA
//
// 1. El service worker nuevo ESPERA en vez de tomar el control (`prompt`).
//    Mientras la pestaña viva, conserva su propio service worker, su propio
//    precache y sus propios chunks. La coherencia deja de ser algo que hay que
//    vigilar: es una consecuencia del diseño.
//
// 2. Se avisa a la persona y se actualiza cuando ella acepta. UNA recarga,
//    provocada por ella, en el momento en que no está a media operación.
//
// 3. Red de seguridad: si aun así falla un chunk —una index.html servida por
//    la CDN de GitHub con diez minutos de retraso, una pestaña abierta desde
//    ayer, alguien con el service worker desactivado— se recarga UNA vez.
//    Una sola, y anotada, para no entrar en un bucle.
// ═══════════════════════════════════════════════════════════════════════════

/** Marca de que ya se intentó recuperar en esta pestaña. */
const CLAVE_RECARGA = 'easygym:recuperacion-de-version'

/**
 * Marca de que el fallo de esta pestaña fue "falta un trozo de la aplicación".
 *
 * Sirve para que la pantalla de error sepa QUÉ contar. El mensaje que le llega
 * a React no siempre dice la verdad: cuando el import diferido se queda a
 * medias, lo que sale por arriba es un «Cannot read properties of undefined
 * (reading 'default')» que no ayuda a nadie.
 */
const CLAVE_FALLO = 'easygym:falta-un-chunk'

/** Deja constancia de que lo que falló fue un chunk de otra versión. */
function marcarFalloDeVersion(): void {
  try {
    sessionStorage.setItem(CLAVE_FALLO, '1')
  } catch {
    /* sin almacenamiento se pierde el matiz, no la recuperación */
  }
}

/** ¿El fallo de esta pestaña fue por un chunk que ya no existe? */
export function huboFalloDeVersion(): boolean {
  try {
    return sessionStorage.getItem(CLAVE_FALLO) === '1'
  } catch {
    return false
  }
}

/**
 * ¿Este error es "me falta un trozo de la aplicación"?
 *
 * Cada navegador lo redacta distinto, y por eso se comprueban varias formas.
 * Un fallo de red corriente NO entra aquí: eso se reintenta solo y no debe
 * provocar una recarga.
 */
export function esErrorDeVersion(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === 'string'
        ? err
        : String((err as { message?: string } | null)?.message ?? '')

  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Unable to preload CSS/i.test(msg) ||
    /ChunkLoadError/i.test(msg)
  )
}

/**
 * Recarga UNA vez para recoger la versión nueva.
 *
 * Devuelve `false` si ya se intentó: en ese caso el problema no es la versión
 * y recargar otra vez solo haría parpadear la pantalla para siempre. Es la
 * diferencia entre recuperarse y entrar en bucle.
 */
export function recuperarDeVersionVieja(motivo: string): boolean {
  try {
    if (sessionStorage.getItem(CLAVE_RECARGA)) {
      console.error(`[EasyGym] Sigue fallando tras recargar (${motivo}). No se insiste.`)
      return false
    }
    sessionStorage.setItem(CLAVE_RECARGA, String(Date.now()))
  } catch {
    // Sin sessionStorage no hay forma de saber si ya se intentó. Se prefiere
    // no recargar antes que arriesgar un bucle.
    return false
  }

  console.warn(`[EasyGym] Versión desfasada (${motivo}). Recargando para actualizar…`)
  // `location.reload()` puede reusar la caché del navegador. Ir a la misma URL
  // fuerza una navegación limpia, que es lo que hace falta para recoger la
  // index.html nueva.
  window.location.replace(window.location.href)
  return true
}

/** La aplicación arrancó bien: se borra la marca para poder recuperar otra vez. */
function marcarArranqueCorrecto(): void {
  // Se espera un poco: si el fallo ocurre nada más arrancar, la marca tiene
  // que seguir puesta para no volver a recargar.
  window.setTimeout(() => {
    try {
      sessionStorage.removeItem(CLAVE_RECARGA)
      sessionStorage.removeItem(CLAVE_FALLO)
    } catch {
      /* sin almacenamiento no hay nada que limpiar */
    }
  }, 10_000)
}

// ─────────────────────────── Aviso de actualización ─────────────────────────

type Suscriptor = (aplicar: () => void) => void

let avisar: Suscriptor | null = null
let aplicarPendiente: (() => void) | null = null

/**
 * La interfaz se suscribe para poder ofrecer «Actualizar».
 *
 * Si el service worker se adelantó y ya hay una versión esperando, se entrega
 * en cuanto alguien escucha: el aviso no se pierde por llegar antes que React.
 */
export function alHaberVersionNueva(suscriptor: Suscriptor): () => void {
  avisar = suscriptor
  if (aplicarPendiente) suscriptor(aplicarPendiente)
  return () => {
    avisar = null
  }
}

/**
 * Arranca el service worker y la vigilancia de versiones.
 *
 * `registerType: 'prompt'` en vite.config.ts hace que `registerSW` NO active
 * el service worker nuevo por su cuenta: llama a `onNeedRefresh` y espera.
 */
export function iniciarControlDeVersiones(): void {
  // La red de seguridad se instala SIEMPRE, incluso sin service worker: los
  // chunks también se pueden caer por una CDN con contenido viejo.
  instalarRedDeSeguridad()
  marcarArranqueCorrecto()

  if (!import.meta.env.PROD) return

  const actualizar = registerSW({
    immediate: true,

    onNeedRefresh() {
      // Hay una versión nueva ESPERANDO. La pestaña actual sigue intacta con
      // sus propios archivos: no se toca nada hasta que la persona acepte.
      const aplicar = () => {
        void actualizar(true) // skipWaiting + recarga
      }
      aplicarPendiente = aplicar
      avisar?.(aplicar)
    },

    onRegisteredSW(_url, registro) {
      if (!registro) return
      // Buscar versiones nuevas cada media hora. Sin esto, una pantalla de
      // recepción que lleva tres días encendida nunca se entera de un deploy.
      window.setInterval(() => void registro.update(), 30 * 60 * 1000)
      // Y también al volver a la pestaña, que es cuando la gente vuelve a usarla.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registro.update()
      })
    },

    onRegisterError(err) {
      // Que el service worker no arranque no puede tumbar la aplicación: sin
      // él se pierde el modo sin conexión, no el producto.
      console.warn('[EasyGym] No se pudo registrar el service worker:', err)
    },
  })
}

/**
 * Red de seguridad para chunks que ya no existen.
 *
 * Vite emite `vite:preloadError` justo cuando falla la carga diferida de un
 * módulo. Es el punto exacto donde se sabe que el problema es de versión y no
 * otra cosa.
 */
function instalarRedDeSeguridad(): void {
  window.addEventListener('vite:preloadError', (evento) => {
    marcarFalloDeVersion()

    // `preventDefault` le dice a Vite "yo me encargo", y solo es cierto si de
    // verdad vamos a recargar. Cuando ya se intentó y no se insiste, hay que
    // dejar pasar el error: es la única forma de que llegue al errorElement
    // con su mensaje real en vez de convertirse en un
    // «Cannot read properties of undefined (reading 'default')».
    if (recuperarDeVersionVieja('vite:preloadError')) evento.preventDefault()
  })

  // Algunos fallos de `import()` no pasan por `vite:preloadError` —depende del
  // navegador y de en qué punto se rompa—, así que se vigila también la
  // promesa sin capturar.
  window.addEventListener('unhandledrejection', (evento) => {
    if (esErrorDeVersion(evento.reason)) {
      marcarFalloDeVersion()
      if (recuperarDeVersionVieja('unhandledrejection')) evento.preventDefault()
    }
  })
}
