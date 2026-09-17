import type { BiometricEvent, Employee, GymSettings, SyncQueueItem } from '@/types'
import { dayKey } from '@/lib/date'
import { newId } from '@/lib/utils'
import type { TenantRepo } from './db'
import type { IncomingDeviceEvent } from './biometric'
import { checkIn, checkOut } from './employeeAttendance'
import { enqueue, isOnline } from './syncQueue'

// ═══════════════════════════════════════════════════════════════════════════
// Eventos de los aparatos → asistencia.
//
// Un lector de pared o un torniquete no saben de horarios ni de tolerancias:
// solo dicen «la huella 4F2A pasó a las 07:03 por el aparato de la entrada».
// Traducir eso a «Adrián entró puntual» es trabajo de EasyGym, y ocurre aquí.
//
// IDEMPOTENCIA EN EL DESTINO
//
// El id del documento ES el `eventId`. Guardar dos veces el mismo evento
// sobrescribe el mismo documento en lugar de crear otro. Es la garantía del
// lado del servidor, complementaria a la de la cola: aunque la cola fallara y
// reenviara, Firestore seguiría terminando con un solo registro.
// ═══════════════════════════════════════════════════════════════════════════

export interface RecordEventInput {
  repo: TenantRepo
  event: IncomingDeviceEvent
  /** Empleado ya resuelto a partir de la huella, si lo hay. */
  employee?: Employee | null
  settings?: GymSettings | null
}

export interface RecordEventResult {
  event: BiometricEvent
  /** `true` cuando el evento ya existía: llegó repetido y se ignoró. */
  duplicate: boolean
  /** `true` si el evento se guardó en la cola por falta de conexión. */
  queued: boolean
}

/**
 * Registra un evento del aparato y, si procede, su fichaje.
 *
 * Sin conexión no se pierde nada: el evento va a la cola local con su
 * `eventId`, y al volver Internet sube con ese mismo identificador.
 */
export async function recordBiometricEvent(input: RecordEventInput): Promise<RecordEventResult> {
  const { repo, event, employee, settings } = input

  const doc: BiometricEvent = {
    id: event.eventId,
    gymId: repo.gymId,
    eventId: event.eventId,
    type: event.type,
    employeeId: event.employeeId ?? employee?.id ?? null,
    memberId: event.memberId ?? null,
    deviceId: event.deviceId ?? null,
    occurredAt: event.occurredAt,
    method: event.method,
    fingerprintId: event.fingerprintId ?? null,
    reason: event.reason ?? null,
    createdAt: Date.now(),
  }

  // Sin conexión: a la cola y a seguir trabajando.
  if (!isOnline()) {
    enqueue({
      gymId: repo.gymId,
      eventId: event.eventId,
      type: 'BIOMETRIC_EVENT',
      payload: doc as unknown as Record<string, unknown>,
    })
    return { event: doc, duplicate: false, queued: true }
  }

  const existing = await repo.get('biometricEvents', event.eventId)
  if (existing) return { event: existing, duplicate: true, queued: false }

  await repo.create('biometricEvents', doc)

  // Un evento de personal se traduce a fichaje. Los de socio los maneja la
  // recepción, que ya tiene su propia lógica de acceso.
  if (employee && (event.type === 'EMPLOYEE_ENTRY' || event.type === 'EMPLOYEE_EXIT')) {
    const time = new Date(event.occurredAt)
    const hhmm = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
    const args = {
      employee,
      settings: settings ?? null,
      method: event.method,
      deviceId: event.deviceId ?? null,
      time: hhmm,
    }
    if (event.type === 'EMPLOYEE_ENTRY') await checkIn(repo, args)
    else await checkOut(repo, args)
  }

  return { event: doc, duplicate: false, queued: false }
}

/**
 * Sube un elemento de la cola.
 *
 * Devuelve `duplicate` cuando el servidor ya lo tenía, que es exactamente lo
 * que debe pasar si el mismo evento se reintenta: no es un error.
 *
 * SUBE EL EVENTO **Y** APLICA SU CONSECUENCIA.
 *
 * No basta con guardar el evento: un fichaje que se hizo sin conexión tiene
 * que acabar siendo una entrada en `employeeAttendance`, o el lunes por la
 * mañana el dueño vería «falta» de alguien que sí vino —solo que vino el día
 * que se cayó Internet—.
 */
export async function uploadQueued(
  repo: TenantRepo,
  item: SyncQueueItem,
  settings: GymSettings | null = null,
): Promise<'synced' | 'duplicate'> {
  if (item.type !== 'BIOMETRIC_EVENT') {
    // Los otros tipos se irán conectando conforme se necesiten. Se marca como
    // subido para no bloquear la cola con algo que nadie procesa.
    return 'synced'
  }

  const existing = await repo.get('biometricEvents', item.eventId)
  if (existing) return 'duplicate'

  const doc = item.payload as unknown as BiometricEvent & { id: string }
  await repo.create('biometricEvents', doc)

  // El fichaje que quedó pendiente. `checkIn` es idempotente por su id
  // `{employeeId}_{fecha}`, así que reintentarlo no duplica nada.
  if (doc.employeeId && (doc.type === 'EMPLOYEE_ENTRY' || doc.type === 'EMPLOYEE_EXIT')) {
    const employee = await repo.get('employees', doc.employeeId)
    if (employee) {
      const when = new Date(doc.occurredAt)
      const args = {
        employee,
        settings,
        method: doc.method,
        deviceId: doc.deviceId ?? null,
        // La hora que se guarda es la del FICHAJE, no la de la subida. Un
        // evento de las 7:03 que sube a las 11:20 sigue siendo de las 7:03.
        date: dayKey(when),
        time: `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`,
      }
      if (doc.type === 'EMPLOYEE_ENTRY') await checkIn(repo, args)
      else await checkOut(repo, args)
    }
  }

  return 'synced'
}

/** Identificador de evento para lo que se origina en EasyGym, no en un aparato. */
export function newEventId(prefix = 'evt'): string {
  return newId(prefix)
}

/** Últimos eventos, acotados. Esta colección crece con cada paso de huella. */
export function readRecentEvents(repo: TenantRepo, limit = 50): Promise<BiometricEvent[]> {
  return repo.list('biometricEvents', {
    orderBy: { field: 'occurredAt', dir: 'desc' },
    limit,
  })
}
