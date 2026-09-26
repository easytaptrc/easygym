import { beforeEach, describe, expect, it, vi } from 'vitest'
import { esErrorDeVersion, huboFalloDeVersion, recuperarDeVersionVieja } from '@/services/appUpdate'

// La recuperación automática es lo más peligroso que hay en este archivo: si
// se equivoca hacia el lado malo, el usuario ve una pantalla que parpadea sin
// parar y no puede ni leer el error. Por eso se prueba aquí, y no solo a ojo
// en el navegador.

const CLAVE_RECARGA = 'easygym:recuperacion-de-version'

/** sessionStorage de mentira: el entorno de estas pruebas es Node, sin DOM. */
function almacenDeMentira() {
  const datos = new Map<string, string>()
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    removeItem: (k: string) => void datos.delete(k),
    clear: () => datos.clear(),
  }
}

let navegacionesA: string[]

beforeEach(() => {
  navegacionesA = []
  vi.stubGlobal('sessionStorage', almacenDeMentira())
  vi.stubGlobal('window', {
    location: {
      href: 'https://easytaptrc.github.io/easygym/dashboard',
      replace: (url: string) => navegacionesA.push(url),
    },
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('reconocer un chunk de otra versión', () => {
  it('reconoce los mensajes que usan los navegadores', () => {
    const mensajes = [
      'Failed to fetch dynamically imported module: https://x/assets/Dashboard-QZdquKOQ.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/index.css',
      'ChunkLoadError: Loading chunk 4 failed',
    ]
    for (const m of mensajes) expect(esErrorDeVersion(new Error(m)), m).toBe(true)
  })

  it('acepta la cadena suelta y el objeto con .message', () => {
    expect(esErrorDeVersion('Failed to fetch dynamically imported module')).toBe(true)
    expect(esErrorDeVersion({ message: 'Importing a module script failed' })).toBe(true)
  })

  it('NO confunde un fallo de red corriente con un cambio de versión', () => {
    // Esto importa tanto como lo anterior: si se recargara con cada error de
    // red, el gimnasio con wifi malo viviría recargando la página.
    expect(esErrorDeVersion(new Error('Failed to fetch'))).toBe(false)
    expect(esErrorDeVersion(new Error('NetworkError when attempting to fetch resource'))).toBe(false)
    expect(esErrorDeVersion(new TypeError('x is not a function'))).toBe(false)
    expect(esErrorDeVersion(null)).toBe(false)
    expect(esErrorDeVersion(undefined)).toBe(false)
  })
})

describe('recuperarse sin entrar en bucle', () => {
  it('recarga la primera vez', () => {
    expect(recuperarDeVersionVieja('prueba')).toBe(true)
    expect(navegacionesA).toEqual(['https://easytaptrc.github.io/easygym/dashboard'])
    expect(sessionStorage.getItem(CLAVE_RECARGA)).not.toBeNull()
  })

  it('NO recarga la segunda vez: ahí es donde nacería el bucle', () => {
    recuperarDeVersionVieja('primera')
    navegacionesA = []

    expect(recuperarDeVersionVieja('segunda')).toBe(false)
    expect(recuperarDeVersionVieja('tercera')).toBe(false)
    expect(navegacionesA).toEqual([])
  })

  it('se niega a recargar si no puede llevar la cuenta', () => {
    // Sin sessionStorage —modo privado, almacenamiento bloqueado— no hay forma
    // de saber si ya se intentó. Ante la duda, no recargar.
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('bloqueado') },
      setItem: () => { throw new Error('bloqueado') },
      removeItem: () => {},
    })
    expect(recuperarDeVersionVieja('sin almacenamiento')).toBe(false)
    expect(navegacionesA).toEqual([])
  })
})

describe('huboFalloDeVersion', () => {
  it('es falso mientras no falle ningún chunk', () => {
    expect(huboFalloDeVersion()).toBe(false)
  })

  it('no revienta si el almacenamiento está bloqueado', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('bloqueado') },
    })
    expect(huboFalloDeVersion()).toBe(false)
  })
})
