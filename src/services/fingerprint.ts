import type { Member } from '@/types'
import { newId, sleep } from '@/lib/utils'
import type { TenantRepo } from './db'

// ═══════════════════════════════════════════════════════════════════════════
// Lector de huella — servicio MOCK.
//
// ARQUITECTURA REAL (el navegador NO habla con el lector USB, y no debe):
//
//    LECTOR USB
//        ↓  (driver del fabricante)
//    APLICACIÓN WINDOWS DE RECEPCIÓN
//        ↓  (SDK: ZKTeco / Digital Persona / Suprema …)
//    TEMPLATE BIOMÉTRICO  (vector propietario, no una imagen)
//        ↓
//    BASE LOCAL (SQLite)  ← el matching 1:N ocurre AQUÍ, offline y en ms
//        ↓  (solo el identificador del template)
//    FIRESTORE  ← guarda `fingerprintId`, jamás la huella
//
// La app Windows expone un servidor local (ws://127.0.0.1:9123) y esta web
// se suscribe. Sustituir el mock = cambiar el cuerpo de estas 3 funciones.
//
// ⛔ NUNCA se almacena la imagen cruda de una huella. Ni aquí ni en Firestore.
//    Un template no permite reconstruir el dedo; una fotografía sí lo permite
//    y convierte una fuga de datos en un problema biométrico irreversible.
// ═══════════════════════════════════════════════════════════════════════════

export type ScannerState = 'idle' | 'waiting' | 'reading' | 'matched' | 'not-found' | 'error'

export interface ScanResult {
  ok: boolean
  /** Identificador del template, NO la huella. */
  fingerprintId: string | null
  /** Confianza del matching 0–100, como la reportan los SDK reales. */
  score: number
  message: string
}

export interface EnrollResult {
  fingerprintId: string
  /** Capturas necesarias para un template estable (los SDK piden 3). */
  captures: number
  quality: number
}

const DEVICE_NAME_MOCK = 'EasyGym Virtual Reader (mock)'

export const MockFingerprintService = {
  isMock: true as const,

  /** ¿Hay un lector conectado? En real: ping al servicio de Windows. */
  async isAvailable(): Promise<boolean> {
    await sleep(120)
    return true
  },

  async deviceName(): Promise<string> {
    return DEVICE_NAME_MOCK
  },

  /**
   * Alta de huella. En real: 3 capturas → el SDK fusiona → template → SQLite.
   * `onCapture` permite pintar el progreso "Captura 2 de 3".
   */
  async registerFingerprint(memberId: string, onCapture?: (n: number, total: number) => void): Promise<EnrollResult> {
    const total = 3
    for (let i = 1; i <= total; i++) {
      await sleep(700)
      onCapture?.(i, total)
    }
    return {
      fingerprintId: `fp_${memberId.slice(0, 6)}_${newId().slice(0, 8)}`,
      captures: total,
      quality: 82 + Math.floor(Math.random() * 16),
    }
  },

  /**
   * Lectura 1:N. En real: el SDK compara contra la base local y devuelve el
   * identificador del template que coincide, SIN que el navegador necesite
   * conocer a nadie.
   *
   * El mock imita esa firma: recibe el repositorio y busca él mismo un socio
   * al que "reconocer", en vez de exigir que la pantalla le pase la lista
   * entera de socios. Esa lista era el motivo por el que la recepción cargaba
   * la colección `members` completa nada más abrirse.
   */
  async scanFingerprint(repo: TenantRepo): Promise<ScanResult> {
    await sleep(1100)

    // Muestra acotada: suficiente para que la demo encuentre a alguien real.
    const sample = await repo.list('members', {
      orderBy: { field: 'memberNumber', dir: 'desc' },
      limit: 60,
    })
    const enrolled = sample.filter((m) => m.fingerprintId)
    const pool = enrolled.length > 0 ? enrolled : sample
    if (pool.length === 0) {
      return { ok: false, fingerprintId: null, score: 0, message: 'No hay socios registrados.' }
    }
    const picked = pool[Math.floor(Math.random() * pool.length)]
    return {
      ok: true,
      fingerprintId: picked.fingerprintId ?? `fp_sim_${picked.id}`,
      score: 88 + Math.floor(Math.random() * 11),
      message: 'Huella reconocida',
    }
  },

  /** Resuelve el socio a partir del identificador del template. */
  async identifyMember(repo: TenantRepo, fingerprintId: string): Promise<Member | null> {
    const rows = await repo.list('members', {
      where: [{ field: 'fingerprintId', op: '==', value: fingerprintId }],
    })
    if (rows[0]) return rows[0]
    // El mock puede devolver un id simulado `fp_sim_<memberId>`.
    if (fingerprintId.startsWith('fp_sim_')) {
      return repo.get('members', fingerprintId.replace('fp_sim_', ''))
    }
    return null
  },

  async deleteFingerprint(repo: TenantRepo, memberId: string): Promise<void> {
    await repo.update('members', memberId, { fingerprintId: null })
  },
}

/**
 * Punto de sustitución por el lector real.
 *
 * ```ts
 * class WindowsBridgeFingerprintService {
 *   private ws = new WebSocket('ws://127.0.0.1:9123')
 *   async scanFingerprint() {
 *     this.ws.send(JSON.stringify({ cmd: 'identify' }))
 *     return this.once('identify')   // { fingerprintId, score }
 *   }
 * }
 * export const Fingerprint = navigator.userAgent.includes('EasyGymDesktop')
 *   ? new WindowsBridgeFingerprintService()
 *   : MockFingerprintService
 * ```
 */
export const Fingerprint = MockFingerprintService
