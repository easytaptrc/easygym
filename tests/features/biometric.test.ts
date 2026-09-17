import { describe, expect, it } from 'vitest'
import {
  CHECK_METHOD_LABEL,
  FutureFaceProvider,
  MockLanFingerprintProvider,
  MockUsbFingerprintProvider,
  lanAdapters,
  methodFor,
  providerFor,
  type IncomingDeviceEvent,
} from '@/services/biometric'

// ═══════════════════════════════════════════════════════════════════════════
// BIOMETRÍA — el contrato, no el hardware.
//
// Lo que se prueba es que la interfaz común se cumple igual venga de un lector
// USB, de uno en red o —el día que exista— del reconocimiento facial. Si esto
// se sostiene, conectar un aparato real no obliga a tocar ninguna pantalla.
// ═══════════════════════════════════════════════════════════════════════════

describe('lector USB simulado', () => {
  it('se declara como USB y sabe dar de alta e identificar', () => {
    const p = new MockUsbFingerprintProvider(0)
    expect(p.capabilities.connection).toBe('USB')
    expect(p.capabilities.canEnroll).toBe(true)
    expect(p.capabilities.canIdentify).toBe(true)
    // Un lector de mostrador no empuja eventos: se le pregunta.
    expect(p.capabilities.pushesEvents).toBe(false)
  })

  it('está disponible', async () => {
    await expect(new MockUsbFingerprintProvider(0).isAvailable()).resolves.toBe(true)
  })

  it('da de alta una huella en tres capturas', async () => {
    const p = new MockUsbFingerprintProvider(0)
    const capturas: number[] = []
    const r = await p.enroll('emp_1', (n) => capturas.push(n))

    expect(capturas).toEqual([1, 2, 3])
    expect(r.captures).toBe(3)
    expect(r.quality).toBeGreaterThanOrEqual(60)
    expect(r.fingerprintId).toMatch(/^fp_/)
  })

  it('devuelve un identificador, NUNCA la huella', async () => {
    const r = await new MockUsbFingerprintProvider(0).enroll('emp_1')
    // Lo que sale es una referencia opaca y corta. Si algún día esto empezara
    // a traer minucias o una imagen, esta prueba tendría que fallar.
    expect(typeof r.fingerprintId).toBe('string')
    expect(r.fingerprintId.length).toBeLessThan(40)
    expect(Object.keys(r).sort()).toEqual(['captures', 'fingerprintId', 'quality'])
  })

  it('sin huellas dadas de alta, no identifica a nadie', async () => {
    const r = await new MockUsbFingerprintProvider(0).identify()
    expect(r.ok).toBe(false)
    expect(r.fingerprintId).toBeNull()
    expect(r.message).toContain('No hay huellas')
  })

  it('identifica a alguien que ya está dado de alta', async () => {
    const p = new MockUsbFingerprintProvider(0)
    const alta = await p.enroll('emp_1')
    const r = await p.identify()

    expect(r.ok).toBe(true)
    expect(r.fingerprintId).toBe(alta.fingerprintId)
    expect(r.score).toBeGreaterThan(80)
  })

  it('verifica 1:1 contra un identificador concreto', async () => {
    const p = new MockUsbFingerprintProvider(0)
    const alta = await p.enroll('emp_1')

    await expect(p.verify(alta.fingerprintId)).resolves.toMatchObject({ ok: true })
    await expect(p.verify('fp_de_otro')).resolves.toMatchObject({ ok: false })
  })
})

describe('lector en red simulado', () => {
  it('se declara como LAN y SÍ empuja eventos', () => {
    const p = new MockLanFingerprintProvider(0)
    expect(p.capabilities.connection).toBe('LAN')
    // La diferencia con el USB es real: un lector de pared avisa por su
    // cuenta, no espera a que le pregunten.
    expect(p.capabilities.pushesEvents).toBe(true)
  })

  it('entrega los eventos que empuja a quien se suscribe', () => {
    const p = new MockLanFingerprintProvider(0)
    const recibidos: IncomingDeviceEvent[] = []
    const off = p.onEvent((e) => recibidos.push(e))

    const evento: IncomingDeviceEvent = {
      eventId: 'EVENT-1',
      type: 'EMPLOYEE_ENTRY',
      deviceId: 'dev_1',
      employeeId: 'emp_1',
      occurredAt: Date.now(),
      method: 'FINGERPRINT_LAN',
    }
    p.emit(evento)

    expect(recibidos).toEqual([evento])

    off()
    p.emit({ ...evento, eventId: 'EVENT-2' })
    expect(recibidos.length).toBe(1)
  })

  it('cada evento trae su eventId, que es lo que evita duplicados', () => {
    const p = new MockLanFingerprintProvider(0)
    const ids: string[] = []
    p.onEvent((e) => ids.push(e.eventId))

    const base: IncomingDeviceEvent = {
      eventId: 'EVENT-A',
      type: 'EMPLOYEE_ENTRY',
      deviceId: 'dev_1',
      occurredAt: 1,
      method: 'FINGERPRINT_LAN',
    }
    p.emit(base)
    p.emit(base)

    // El lector puede mandarlo dos veces; deduplicar es trabajo de la cola y
    // del id del documento, no del aparato.
    expect(ids).toEqual(['EVENT-A', 'EVENT-A'])
    expect(new Set(ids).size).toBe(1)
  })
})

describe('reconocimiento facial', () => {
  it('se declara NO disponible', async () => {
    const p = new FutureFaceProvider()
    expect(p.capabilities.canEnroll).toBe(false)
    expect(p.capabilities.canIdentify).toBe(false)
    await expect(p.isAvailable()).resolves.toBe(false)
  })

  it('dar de alta una cara lanza, no finge funcionar', async () => {
    // Un mock que devuelve datos falsos haría creer que está integrado. Lo
    // correcto es fallar de forma evidente hasta que exista un proveedor.
    await expect(new FutureFaceProvider().enroll()).rejects.toThrow(/pendiente de integración/i)
  })

  it('identificar responde que no está disponible', async () => {
    const r = await new FutureFaceProvider().identify()
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/pendiente de integración/i)
  })
})

describe('selección del lector', () => {
  it('elige el proveedor según la conexión', () => {
    expect(providerFor('USB').capabilities.connection).toBe('USB')
    expect(providerFor('LAN').capabilities.connection).toBe('LAN')
    expect(providerFor('WIFI').capabilities.connection).toBe('LAN')
  })

  it('traduce la conexión al método que se guarda en el fichaje', () => {
    expect(methodFor('USB')).toBe('FINGERPRINT_USB')
    expect(methodFor('LAN')).toBe('FINGERPRINT_LAN')
    expect(methodFor('WIFI')).toBe('FINGERPRINT_LAN')
  })

  it('todos los métodos tienen nombre legible', () => {
    for (const label of Object.values(CHECK_METHOD_LABEL)) {
      expect(label.length).toBeGreaterThan(3)
    }
  })

  it('todavía no hay ningún adaptador de fabricante', () => {
    // No se inventan protocolos. Cuando llegue el aparato real, se registra
    // aquí su adaptador y esta prueba cambia con conocimiento de causa.
    expect(Object.keys(lanAdapters)).toEqual([])
  })
})
