import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncQueueItem } from '@/types'

// ═══════════════════════════════════════════════════════════════════════════
// MODO SIN CONEXIÓN, COLA E IDEMPOTENCIA.
//
// Lo que se prueba aquí es la promesa operativa: que perder Internet a las 7
// de la mañana no deje al gimnasio sin poder registrar entradas, y que al
// volver la conexión no aparezcan fichajes duplicados.
//
// La cola vive en localStorage, que no existe en Node. Se monta uno mínimo:
// es un Map con la misma forma, y basta porque el código solo usa
// getItem/setItem/removeItem.
// ═══════════════════════════════════════════════════════════════════════════

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v)
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
  clear(): void {
    this.map.clear()
  }
  get length(): number {
    return this.map.size
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null
  }
}

const storage = new MemoryStorage()
vi.stubGlobal('localStorage', storage)
vi.stubGlobal('navigator', { onLine: true })

// La importación va DESPUÉS del stub: el módulo lee localStorage al usarse.
const {
  MAX_RETRIES,
  all,
  byStatus,
  clearQueue,
  enqueue,
  flush,
  isOnline,
  pending,
  pendingCount,
  purgeSynced,
  retryStuck,
  stuck,
  subscribe,
} = await import('@/services/syncQueue')

const GYM = 'gym_demo'

function evento(eventId: string, extra: Record<string, unknown> = {}) {
  return {
    gymId: GYM,
    eventId,
    type: 'BIOMETRIC_EVENT' as const,
    payload: { employeeId: 'emp_1', occurredAt: 1_700_000_000_000, ...extra },
  }
}

beforeEach(() => {
  clearQueue()
  storage.clear()
})

describe('encolar eventos', () => {
  it('guarda un evento como pendiente', () => {
    const item = enqueue(evento('EVENT-1'))
    expect(item.status).toBe('PENDING')
    expect(item.retryCount).toBe(0)
    expect(item.eventId).toBe('EVENT-1')
    expect(pendingCount(GYM)).toBe(1)
  })

  it('genera un eventId cuando no se pasa uno', () => {
    const item = enqueue({ gymId: GYM, type: 'BIOMETRIC_EVENT', payload: {} })
    expect(item.eventId).toBeTruthy()
  })

  it('sobrevive a que el almacenamiento tenga basura', () => {
    storage.setItem('easygym:syncqueue:v1', 'esto no es JSON')
    // No lanza: empieza de cero y sigue operando. Lo que se pierde ya estaba
    // perdido, y la recepción no puede detenerse por eso.
    expect(() => enqueue(evento('EVENT-X'))).not.toThrow()
    expect(pendingCount(GYM)).toBe(1)
  })

  it('separa las colas de gimnasios distintos', () => {
    enqueue(evento('EVENT-1'))
    enqueue({ ...evento('EVENT-2'), gymId: 'gym_otro' })
    expect(pendingCount(GYM)).toBe(1)
    expect(pendingCount('gym_otro')).toBe(1)
    expect(all().length).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// IDEMPOTENCIA — el punto que no se puede fallar.
//
// «EVENT-123 se envía dos veces. Firestore debe terminar con 1 evento, no 2.»
// ═══════════════════════════════════════════════════════════════════════════

describe('idempotencia', () => {
  it('encolar el MISMO eventId dos veces no crea dos entradas', () => {
    const a = enqueue(evento('EVENT-123'))
    const b = enqueue(evento('EVENT-123'))

    expect(all(GYM).length).toBe(1)
    expect(b.queueId).toBe(a.queueId)
  })

  it('el mismo eventId en gimnasios distintos SÍ son dos eventos', () => {
    // No es un duplicado: son dos aparatos que numeran por su cuenta.
    enqueue(evento('EVENT-123'))
    enqueue({ ...evento('EVENT-123'), gymId: 'gym_otro' })
    expect(all().length).toBe(2)
  })

  it('un evento que el servidor ya tenía cuenta como duplicado, no como error', async () => {
    enqueue(evento('EVENT-A'))
    enqueue(evento('EVENT-B'))

    const yaEnServidor = new Set(['EVENT-A'])
    const result = await flush(
      async (item) => (yaEnServidor.has(item.eventId) ? 'duplicate' : 'synced'),
      GYM,
    )

    expect(result.attempted).toBe(2)
    expect(result.synced).toBe(1)
    expect(result.duplicates).toBe(1)
    expect(result.failed).toBe(0)
    // Los dos quedan como sincronizados: el duplicado no es un fallo.
    expect(byStatus('SYNCED', GYM).length).toBe(2)
  })

  it('reintentar después de sincronizar no vuelve a subir nada', async () => {
    enqueue(evento('EVENT-1'))
    const subidos: string[] = []
    const uploader = async (i: SyncQueueItem) => {
      subidos.push(i.eventId)
      return 'synced' as const
    }

    await flush(uploader, GYM)
    await flush(uploader, GYM)

    expect(subidos).toEqual(['EVENT-1'])
  })
})

describe('sincronizar', () => {
  it('sube en orden de llegada', async () => {
    // Una salida no puede subir antes que su entrada.
    enqueue(evento('EVENT-1'))
    enqueue(evento('EVENT-2'))
    enqueue(evento('EVENT-3'))

    const orden: string[] = []
    await flush(async (i) => {
      orden.push(i.eventId)
      return 'synced'
    }, GYM)

    expect(orden).toEqual(['EVENT-1', 'EVENT-2', 'EVENT-3'])
  })

  it('un fallo marca el evento y cuenta el reintento', async () => {
    enqueue(evento('EVENT-1'))
    const result = await flush(async () => {
      throw new Error('sin red')
    }, GYM)

    expect(result.failed).toBe(1)
    const item = all(GYM)[0]
    expect(item.status).toBe('FAILED')
    expect(item.retryCount).toBe(1)
    expect(item.lastError).toContain('sin red')
  })

  it('lo que falló se reintenta solo en la siguiente pasada', async () => {
    enqueue(evento('EVENT-1'))
    await flush(async () => {
      throw new Error('sin red')
    }, GYM)

    expect(pendingCount(GYM)).toBe(1)

    const result = await flush(async () => 'synced', GYM)
    expect(result.synced).toBe(1)
    expect(pendingCount(GYM)).toBe(0)
  })

  it('tras agotar los reintentos deja de intentarlo solo', async () => {
    enqueue(evento('EVENT-1'))
    const fail = async () => {
      throw new Error('sin red')
    }

    for (let i = 0; i < MAX_RETRIES; i++) await flush(fail, GYM)

    expect(stuck(GYM).length).toBe(1)
    expect(pendingCount(GYM)).toBe(0)

    // Ya no se reintenta solo: hace falta que alguien mire qué pasa.
    const result = await flush(async () => 'synced', GYM)
    expect(result.attempted).toBe(0)
  })

  it('el reintento manual lo devuelve a la cola', async () => {
    enqueue(evento('EVENT-1'))
    const fail = async () => {
      throw new Error('sin red')
    }
    for (let i = 0; i < MAX_RETRIES; i++) await flush(fail, GYM)

    expect(retryStuck(GYM)).toBe(1)
    expect(pendingCount(GYM)).toBe(1)

    const result = await flush(async () => 'synced', GYM)
    expect(result.synced).toBe(1)
  })

  it('una cola vacía no hace nada', async () => {
    const result = await flush(async () => 'synced', GYM)
    expect(result).toEqual({ attempted: 0, synced: 0, failed: 0, duplicates: 0 })
  })
})

describe('limpieza de la cola', () => {
  it('borra lo sincronizado hace más de un día', async () => {
    enqueue(evento('EVENT-1'))
    await flush(async () => 'synced', GYM)

    // Recién sincronizado: se conserva, por si hay que revisarlo.
    expect(purgeSynced()).toBe(0)
    expect(all(GYM).length).toBe(1)

    // Con el margen a cero, ya se puede tirar.
    expect(purgeSynced(0)).toBe(1)
    expect(all(GYM).length).toBe(0)
  })

  it('nunca borra lo que sigue pendiente', () => {
    enqueue(evento('EVENT-1'))
    expect(purgeSynced(0)).toBe(0)
    expect(pendingCount(GYM)).toBe(1)
  })
})

describe('avisos a la interfaz', () => {
  it('notifica al encolar', () => {
    let veces = 0
    const off = subscribe(() => veces++)
    enqueue(evento('EVENT-1'))
    expect(veces).toBe(1)
    off()
    enqueue(evento('EVENT-2'))
    expect(veces).toBe(1)
  })

  it('un suscriptor que falla no rompe a los demás', () => {
    let ok = 0
    subscribe(() => {
      throw new Error('componente roto')
    })
    subscribe(() => ok++)
    expect(() => enqueue(evento('EVENT-1'))).not.toThrow()
    expect(ok).toBe(1)
  })
})

describe('estado de la conexión', () => {
  it('lee navigator.onLine', () => {
    vi.stubGlobal('navigator', { onLine: true })
    expect(isOnline()).toBe(true)
    vi.stubGlobal('navigator', { onLine: false })
    expect(isOnline()).toBe(false)
    vi.stubGlobal('navigator', { onLine: true })
  })

  it('sin navigator asume que hay conexión', () => {
    // En un entorno sin navegador no se puede saber, y bloquear por si acaso
    // sería peor que intentarlo y fallar.
    vi.stubGlobal('navigator', undefined)
    expect(isOnline()).toBe(true)
    vi.stubGlobal('navigator', { onLine: true })
  })
})

describe('lo pendiente frente a lo atascado', () => {
  it('separa lo que aún se puede reintentar de lo que no', async () => {
    enqueue(evento('EVENT-1'))
    enqueue(evento('EVENT-2'))

    // El primero falla siempre; el segundo sube.
    const uploader = async (i: SyncQueueItem) => {
      if (i.eventId === 'EVENT-1') throw new Error('sin red')
      return 'synced' as const
    }
    for (let i = 0; i < MAX_RETRIES; i++) await flush(uploader, GYM)

    expect(stuck(GYM).map((i) => i.eventId)).toEqual(['EVENT-1'])
    expect(byStatus('SYNCED', GYM).map((i) => i.eventId)).toEqual(['EVENT-2'])
    expect(pending(GYM).length).toBe(0)
  })
})
