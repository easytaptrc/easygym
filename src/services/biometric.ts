import type { BiometricEventType, Device, WorkCheckMethod } from '@/types'
import { newId, sleep } from '@/lib/utils'

// ═══════════════════════════════════════════════════════════════════════════
// BIOMETRÍA — una interfaz, varios aparatos.
//
// EL NAVEGADOR NO HABLA CON EL HARDWARE. NUNCA.
//
// No es una preferencia de diseño: una página web no puede abrir un lector USB
// con el SDK del fabricante, ni debería poder. La cadena real es:
//
//   LECTOR USB / LAN
//        │
//        ▼
//   EASYGYM AGENT            aplicación de escritorio en el equipo del gimnasio
//        │                   (Windows). Carga el SDK del fabricante.
//        ▼
//   DEVICE ADAPTER           traduce el protocolo concreto de ese modelo
//        │
//        ▼
//   TEMPLATE / EVENTO        identificador, jamás la imagen de la huella
//        │
//        ▼
//   BASE LOCAL               sobrevive a la caída de Internet
//        │
//        ▼
//   SYNC SERVICE ──────────► FIRESTORE
//
// Lo que vive en este archivo es el CONTRATO: qué puede pedirse a un lector,
// sin decidir cuál es. El navegador habla con el Agente; el Agente habla con
// el aparato.
//
// POR QUÉ NO HAY PROTOCOLO AQUÍ
//
// Porque no se conoce el modelo. Inventar endpoints para un ZKTeco, un
// Suprema o un Hikvision imaginario produciría código que hay que borrar el
// día que llegue el aparato real. Lo que sí se puede escribir hoy, y es lo que
// está escrito, es la forma del hueco donde encajará.
// ═══════════════════════════════════════════════════════════════════════════

export type BiometricSubject = 'EMPLOYEE' | 'MEMBER'

export interface EnrollResult {
  /**
   * Identificador del template.
   *
   * NO es la huella. Es la referencia con la que el aparato reconoce a esa
   * persona. Ver la nota de privacidad al final del archivo.
   */
  fingerprintId: string
  /** Calidad de la captura, 0–100. Por debajo de 60 conviene repetir. */
  quality: number
  captures: number
}

export interface IdentifyResult {
  ok: boolean
  fingerprintId: string | null
  /** Confianza de la coincidencia, 0–100. */
  score: number
  message: string
}

export interface ProviderCapabilities {
  /** Nombre legible, para diagnósticos. */
  engine: string
  /** ¿Puede dar de alta huellas o solo identificar? */
  canEnroll: boolean
  /** ¿Identifica 1:N por sí mismo, o hay que decirle contra quién comparar? */
  canIdentify: boolean
  /** ¿Empuja eventos por su cuenta (torniquete) o hay que preguntarle? */
  pushesEvents: boolean
  connection: 'MOCK' | 'USB' | 'LAN' | 'WIFI'
}

/**
 * Lo que EasyGym le pide a cualquier lector.
 *
 * Añadir un modelo nuevo es implementar esto. Ninguna pantalla cambia.
 */
export interface BiometricProvider {
  readonly capabilities: ProviderCapabilities
  /** ¿Está el aparato disponible ahora mismo? */
  isAvailable(): Promise<boolean>
  /** Alta: varias capturas → un template. */
  enroll(subjectId: string, onCapture?: (n: number, total: number) => void): Promise<EnrollResult>
  /** Identificación 1:N: ¿de quién es esta huella? */
  identify(): Promise<IdentifyResult>
  /** Verificación 1:1: ¿esta huella es de esta persona? */
  verify(fingerprintId: string): Promise<IdentifyResult>
}

/**
 * Eventos que EasyGym puede RECIBIR de un aparato.
 *
 * Un torniquete no espera a que le pregunten: avisa. El adaptador traduce lo
 * que escupe el aparato a esta forma, y de ahí en adelante todo es igual
 * venga de donde venga.
 */
export interface IncomingDeviceEvent {
  /** Identificador único del ORIGEN. Es la clave de la idempotencia. */
  eventId: string
  type: BiometricEventType
  /**
   * Aparato que lo originó. `null` cuando no viene de uno dado de alta:
   * el simulador, o un lector que todavía no se registró en Dispositivos.
   * Obligatorio pero anulable, para que quien lo construya tenga que decidir.
   */
  deviceId: string | null
  fingerprintId?: string | null
  employeeId?: string | null
  memberId?: string | null
  occurredAt: number
  method: WorkCheckMethod
  reason?: string | null
}

/**
 * Adaptador de un aparato en red.
 *
 * ▸ PENDIENTE DE INTEGRACIÓN REAL.
 *
 * Cada fabricante habla lo suyo: unos exponen HTTP, otros un socket TCP con
 * trama propietaria, otros empujan por webhook. Cuando se conozca marca y
 * modelo se escribe una clase que implemente esto y se registra en
 * `lanAdapters`. Nada más cambia.
 *
 * NO se inventan endpoints aquí a propósito.
 */
export interface LanDeviceAdapter {
  readonly vendor: string
  readonly model: string
  connect(device: Device): Promise<boolean>
  disconnect(): Promise<void>
  /** Suscribe a los eventos que empuja el aparato. Devuelve el cancelador. */
  subscribe(onEvent: (event: IncomingDeviceEvent) => void): () => void
  /** Abre el torniquete o el relé. `ACCESS_GRANTED` ya decidido por EasyGym. */
  grantAccess?(durationMs?: number): Promise<void>
}

/** Adaptadores disponibles, por `vendor:model`. Hoy vacío: no hay hardware. */
export const lanAdapters: Record<string, () => LanDeviceAdapter> = {}

// ═══════════════════════ Implementaciones de simulación ════════════════════

/**
 * Base común de los simuladores.
 *
 * Reproducen la LATENCIA y los FALLOS del hardware real —una lectura tarda un
 * segundo y a veces no reconoce— porque una interfaz que siempre responde al
 * instante y siempre acierta esconde justo los casos que hay que diseñar: qué
 * ve el recepcionista mientras espera, y qué ve cuando no lee.
 */
abstract class SimulatedProvider implements BiometricProvider {
  abstract readonly capabilities: ProviderCapabilities
  protected abstract readDelay: number

  /**
   * Multiplicador de la latencia simulada.
   *
   * En la aplicación vale 1 y el lector «tarda» como tardaría uno real. Las
   * pruebas lo ponen a 0: comprobar el contrato no requiere esperar segundos,
   * y una suite lenta acaba sin ejecutarse.
   */
  constructor(protected readonly speed: number = 1) {}

  /** Huellas dadas de alta en esta sesión: id de persona → template. */
  protected enrolled = new Map<string, string>()

  protected wait(ms: number): Promise<void> {
    return this.speed === 0 ? Promise.resolve() : sleep(ms * this.speed)
  }

  async isAvailable(): Promise<boolean> {
    await this.wait(120)
    return true
  }

  async enroll(subjectId: string, onCapture?: (n: number, total: number) => void): Promise<EnrollResult> {
    const total = 3
    for (let i = 1; i <= total; i++) {
      await this.wait(600)
      onCapture?.(i, total)
    }
    const fingerprintId = `fp_${subjectId.slice(0, 8)}_${newId().slice(0, 6)}`
    this.enrolled.set(subjectId, fingerprintId)
    return { fingerprintId, captures: total, quality: 82 + Math.floor(Math.random() * 16) }
  }

  async identify(): Promise<IdentifyResult> {
    await this.wait(this.readDelay)
    const ids = [...this.enrolled.values()]
    if (ids.length === 0) {
      return {
        ok: false,
        fingerprintId: null,
        score: 0,
        message: 'No hay huellas registradas en este lector.',
      }
    }
    const picked = ids[Math.floor(Math.random() * ids.length)]
    return { ok: true, fingerprintId: picked, score: 88 + Math.floor(Math.random() * 11), message: 'Huella reconocida' }
  }

  async verify(fingerprintId: string): Promise<IdentifyResult> {
    await this.wait(this.readDelay)
    const known = [...this.enrolled.values()].includes(fingerprintId)
    return known
      ? { ok: true, fingerprintId, score: 93, message: 'Huella verificada' }
      : { ok: false, fingerprintId: null, score: 0, message: 'La huella no coincide.' }
  }

  /** Solo para la demostración: precarga huellas ya dadas de alta. */
  seed(pairs: Array<{ subjectId: string; fingerprintId: string }>): void {
    for (const p of pairs) this.enrolled.set(p.subjectId, p.fingerprintId)
  }
}

/**
 * Lector USB simulado.
 *
 * El real se conecta al equipo de recepción y lo maneja el Agente de Windows.
 * Esta clase existe para que la interfaz se pueda construir y probar hoy.
 */
export class MockUsbFingerprintProvider extends SimulatedProvider {
  readonly capabilities: ProviderCapabilities = {
    engine: 'Lector USB (simulado)',
    canEnroll: true,
    canIdentify: true,
    pushesEvents: false,
    connection: 'USB',
  }
  protected readDelay = 1100
}

/**
 * Lector en red simulado.
 *
 * El real vive en la pared, junto al torniquete, y empuja eventos por su
 * cuenta. Por eso `pushesEvents: true`: la diferencia de comportamiento es
 * real y la interfaz tiene que notarla.
 */
export class MockLanFingerprintProvider extends SimulatedProvider {
  readonly capabilities: ProviderCapabilities = {
    engine: 'Lector LAN (simulado)',
    canEnroll: true,
    canIdentify: true,
    pushesEvents: true,
    connection: 'LAN',
  }
  protected readDelay = 700

  private listeners = new Set<(e: IncomingDeviceEvent) => void>()

  /** Suscripción a los eventos que empujaría el aparato. */
  onEvent(listener: (e: IncomingDeviceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Dispara un evento como si lo hubiera mandado el lector de la pared. */
  emit(event: IncomingDeviceEvent): void {
    for (const l of this.listeners) l(event)
  }
}

/**
 * Reconocimiento facial.
 *
 * ▸ NO IMPLEMENTADO. Pendiente de integración con un proveedor compatible.
 *
 * No se inventa ningún SDK. Lo que hay es la forma del hueco: cuando se elija
 * proveedor, se implementa `BiometricProvider` con `FUTURE_FACE` como método y
 * el resto del sistema —fichajes, eventos, cola de sincronización, reportes—
 * funciona sin tocarse.
 *
 * ANTES DE IMPLEMENTARLO hay que resolver, y no es opcional:
 *   · consentimiento explícito de cada persona, revocable
 *   · qué se guarda exactamente (vector, jamás la fotografía)
 *   · dónde se guarda y quién puede leerlo
 *   · cuánto tiempo se conserva y cómo se borra
 *   · aviso de privacidad acorde a la LFPDPPP
 *
 * La cara es un dato biométrico con las mismas obligaciones legales que la
 * huella, y algunas más: se puede capturar sin que la persona colabore.
 */
export class FutureFaceProvider implements BiometricProvider {
  readonly capabilities: ProviderCapabilities = {
    engine: 'Reconocimiento facial (no disponible)',
    canEnroll: false,
    canIdentify: false,
    pushesEvents: false,
    connection: 'MOCK',
  }

  private readonly pendiente = 'Reconocimiento facial pendiente de integración.'

  async isAvailable(): Promise<boolean> {
    return false
  }

  async enroll(): Promise<EnrollResult> {
    throw new Error(this.pendiente)
  }

  async identify(): Promise<IdentifyResult> {
    return { ok: false, fingerprintId: null, score: 0, message: this.pendiente }
  }

  async verify(): Promise<IdentifyResult> {
    return { ok: false, fingerprintId: null, score: 0, message: this.pendiente }
  }
}

// ═══════════════════════════ Selección del lector ══════════════════════════

export const usbProvider = new MockUsbFingerprintProvider()
export const lanProvider = new MockLanFingerprintProvider()
export const faceProvider = new FutureFaceProvider()

/**
 * Punto de cambio.
 *
 * El día que exista el Agente de Windows, esto pasa a devolver el proveedor
 * que habla con él. Las pantallas no se enteran.
 */
export function providerFor(connection: 'USB' | 'LAN' | 'WIFI' | 'MOCK'): BiometricProvider {
  switch (connection) {
    case 'USB':
      return usbProvider
    case 'LAN':
    case 'WIFI':
      return lanProvider
    default:
      return usbProvider
  }
}

export function methodFor(connection: 'USB' | 'LAN' | 'WIFI' | 'MOCK'): WorkCheckMethod {
  return connection === 'USB' ? 'FINGERPRINT_USB' : 'FINGERPRINT_LAN'
}

export const CHECK_METHOD_LABEL: Record<WorkCheckMethod, string> = {
  FINGERPRINT_USB: 'Huella (USB)',
  FINGERPRINT_LAN: 'Huella (red)',
  MANUAL: 'Manual',
  FUTURE_FACE: 'Reconocimiento facial',
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIVACIDAD BIOMÉTRICA — lo que este sistema NO guarda
//
//   ✗ imágenes de huellas
//   ✗ fotografías de dedos
//   ✗ minucias en bruto
//   ✗ cualquier dato del que pueda reconstruirse una huella
//
// Lo único que se guarda es `fingerprintId`: una referencia opaca que sirve
// para preguntarle al aparato «¿es esta persona?» y para nada más. Si el
// lector se cambia por otro modelo, esos identificadores dejan de valer — y
// eso es exactamente lo que se quiere: los datos biométricos no deben ser
// portables fuera del aparato que los capturó.
//
// Una huella filtrada no se puede cambiar como una contraseña. Por eso el
// criterio no es «guardar lo que quepa» sino «guardar lo mínimo que funcione».
// ═══════════════════════════════════════════════════════════════════════════
