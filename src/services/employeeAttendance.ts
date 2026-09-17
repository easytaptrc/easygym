import type {
  Employee,
  EmployeeAttendance,
  GymSettings,
  WorkCheckMethod,
} from '@/types'
import { dayKey, timeKey } from '@/lib/date'
import {
  evaluateEntry,
  evaluateExit,
  resolveStatus,
  shiftForEntry,
  shiftsFor,
  workedMinutesBetween,
} from '@/lib/workSchedule'
import type { TenantRepo } from './db'
import { audit } from './audit'
import { assertCurrentGymCanOperate } from './gymStatus'
import { fullName } from './employees'

// ═══════════════════════════════════════════════════════════════════════════
// Asistencia LABORAL.
//
// No se mezcla con `attendance`, que es la entrada de un SOCIO al gimnasio.
// Son dos preguntas distintas —«¿cuánta gente entrenó hoy?» frente a «¿quién
// llegó tarde?»— y las mira gente distinta.
//
// UN DOCUMENTO POR EMPLEADO Y DÍA.
//
// El id es `{employeeId}_{fecha}`, así que fichar dos veces la entrada no crea
// dos registros: actualiza el mismo. Es la primera línea de defensa contra el
// doble escaneo, antes incluso de la cola de sincronización.
// ═══════════════════════════════════════════════════════════════════════════

/** Id estable del día. Es lo que hace idempotente el fichaje. */
export function attendanceIdFor(employeeId: string, date: string): string {
  return `${employeeId}_${date}`
}

/** Tolerancia efectiva: la del empleado manda sobre la del gimnasio. */
export function toleranceFor(
  employee: Pick<Employee, 'toleranceMinutes'>,
  settings: GymSettings | null,
): number {
  if (typeof employee.toleranceMinutes === 'number') return employee.toleranceMinutes
  const fromGym = (settings as unknown as { work?: { toleranceMinutes?: number } } | null)?.work
    ?.toleranceMinutes
  return typeof fromGym === 'number' ? fromGym : 15
}

export interface CheckInput {
  employee: Employee
  settings: GymSettings | null
  method: WorkCheckMethod
  deviceId?: string | null
  /** `HH:mm`. Por defecto, ahora. Se pasa explícito al fichar a mano. */
  time?: string
  /** `YYYY-MM-DD`. Por defecto, hoy. */
  date?: string
}

/**
 * Registra la ENTRADA laboral.
 *
 * Si ya hay entrada ese día, NO la pisa: el primer fichaje es el bueno. Quien
 * llegó a las 7:20 y vuelve a pasar la huella a las 7:25 no mejora su hora.
 */
export async function checkIn(repo: TenantRepo, input: CheckInput): Promise<EmployeeAttendance> {
  assertCurrentGymCanOperate()

  const { employee, settings, method } = input
  const date = input.date ?? dayKey()
  const time = input.time ?? timeKey()
  const id = attendanceIdFor(employee.id, date)

  const existing = await repo.get('employeeAttendance', id)
  if (existing?.actualEntry) return existing

  const shifts = shiftsFor(employee.schedule, date)
  const shift = shiftForEntry(shifts, time)
  const tolerance = toleranceFor(employee, settings)

  const entry = evaluateEntry(shift?.start ?? null, time, tolerance)

  const record: EmployeeAttendance = {
    id,
    gymId: repo.gymId,
    employeeId: employee.id,
    employeeName: fullName(employee),
    position: employee.position,
    date,
    scheduledEntry: shift?.start ?? null,
    scheduledExit: shift?.end ?? null,
    actualEntry: time,
    actualExit: existing?.actualExit ?? null,
    toleranceMinutes: tolerance,
    status: resolveStatus({
      hasSchedule: shifts.length > 0,
      actualEntry: time,
      actualExit: existing?.actualExit ?? null,
      lateMinutes: entry.lateMinutes,
      earlyExitMinutes: 0,
    }),
    lateMinutes: entry.lateMinutes,
    earlyExitMinutes: 0,
    workedMinutes: workedMinutesBetween(time, existing?.actualExit ?? null),
    deviceId: input.deviceId ?? null,
    method,
    createdAt: existing?.createdAt ?? Date.now(),
  }

  await repo.create('employeeAttendance', record)

  if (method === 'MANUAL') {
    audit({
      gymId: repo.gymId,
      action: 'WORK_ATTENDANCE_MANUAL',
      entityType: 'employeeAttendance',
      entityId: id,
      summary: `Entrada manual de ${record.employeeName} a las ${time}`,
      after: { fecha: date, entrada: time, estado: record.status },
    })
  }

  return record
}

/**
 * Registra la SALIDA laboral.
 *
 * Al contrario que la entrada, aquí la ÚLTIMA gana: quien sale, vuelve a
 * entrar por algo y se va de nuevo, trabajó hasta la segunda salida.
 */
export async function checkOut(repo: TenantRepo, input: CheckInput): Promise<EmployeeAttendance | null> {
  assertCurrentGymCanOperate()

  const { employee, settings, method } = input
  const date = input.date ?? dayKey()
  const time = input.time ?? timeKey()
  const id = attendanceIdFor(employee.id, date)

  const existing = await repo.get('employeeAttendance', id)

  // Salir sin haber entrado deja el registro incompleto, no lo inventa: ese
  // hueco es un dato, y alguien tiene que corregirlo a mano.
  if (!existing?.actualEntry) {
    const shifts = shiftsFor(employee.schedule, date)
    const shift = shifts[0] ?? null
    const record: EmployeeAttendance = {
      id,
      gymId: repo.gymId,
      employeeId: employee.id,
      employeeName: fullName(employee),
      position: employee.position,
      date,
      scheduledEntry: shift?.start ?? null,
      scheduledExit: shift?.end ?? null,
      actualEntry: null,
      actualExit: time,
      toleranceMinutes: toleranceFor(employee, settings),
      status: 'INCOMPLETE',
      lateMinutes: 0,
      earlyExitMinutes: 0,
      workedMinutes: 0,
      deviceId: input.deviceId ?? null,
      method,
      createdAt: Date.now(),
    }
    await repo.create('employeeAttendance', record)
    return record
  }

  const earlyExitMinutes = evaluateExit(existing.scheduledExit, time)
  const patch = {
    actualExit: time,
    earlyExitMinutes,
    workedMinutes: workedMinutesBetween(existing.actualEntry, time),
    status: resolveStatus({
      hasSchedule: existing.scheduledEntry !== null,
      actualEntry: existing.actualEntry,
      actualExit: time,
      lateMinutes: existing.lateMinutes,
      earlyExitMinutes,
    }),
    method,
  }

  await repo.update('employeeAttendance', id, patch)

  if (method === 'MANUAL') {
    audit({
      gymId: repo.gymId,
      action: 'WORK_ATTENDANCE_MANUAL',
      entityType: 'employeeAttendance',
      entityId: id,
      summary: `Salida manual de ${existing.employeeName} a las ${time}`,
      after: { fecha: date, salida: time, estado: patch.status },
    })
  }

  return { ...existing, ...patch }
}

/**
 * Justifica una falta.
 *
 * Crea el registro si no existe: una falta no tiene documento propio —es la
 * ausencia de uno— así que justificarla es la primera vez que hay algo que
 * escribir.
 *
 * `reason` es texto libre y corto. Nada de información médica: para el
 * gimnasio «permiso médico» es suficiente, y el diagnóstico no es asunto suyo.
 */
export async function justifyAbsence(
  repo: TenantRepo,
  employee: Employee,
  date: string,
  reason: string,
  justifiedBy: string,
): Promise<EmployeeAttendance> {
  assertCurrentGymCanOperate()

  const id = attendanceIdFor(employee.id, date)
  const shifts = shiftsFor(employee.schedule, date)
  const existing = await repo.get('employeeAttendance', id)

  const record: EmployeeAttendance = {
    ...(existing ?? {
      id,
      gymId: repo.gymId,
      employeeId: employee.id,
      employeeName: fullName(employee),
      position: employee.position,
      date,
      scheduledEntry: shifts[0]?.start ?? null,
      scheduledExit: shifts[shifts.length - 1]?.end ?? null,
      actualEntry: null,
      actualExit: null,
      toleranceMinutes: 0,
      lateMinutes: 0,
      earlyExitMinutes: 0,
      workedMinutes: 0,
      method: 'MANUAL' as WorkCheckMethod,
      createdAt: Date.now(),
    }),
    status: 'JUSTIFIED',
    justification: reason.trim(),
    justifiedBy,
  }

  await repo.create('employeeAttendance', record)

  audit({
    gymId: repo.gymId,
    action: 'WORK_ABSENCE_JUSTIFIED',
    entityType: 'employeeAttendance',
    entityId: id,
    summary: `Falta justificada de ${record.employeeName} el ${date}`,
    before: { estado: existing?.status ?? 'ABSENT' },
    after: { estado: 'JUSTIFIED', motivo: reason.trim() },
  })

  return record
}

// ─────────────────────────────── Consultas ──────────────────────────────────

/**
 * Registros de un rango.
 *
 * SIEMPRE acotado por fecha. Un gimnasio con 20 empleados genera 400 registros
 * al mes: pedir la colección entera es insostenible al segundo año, y esta
 * pantalla se abre todos los lunes.
 */
export function readRange(
  repo: TenantRepo,
  fromDate: string,
  toDate: string,
  employeeId?: string | null,
  limit = 600,
): Promise<EmployeeAttendance[]> {
  const where: Array<{ field: string; op: '==' | '>=' | '<='; value: unknown }> = [
    { field: 'date', op: '>=', value: fromDate },
    { field: 'date', op: '<=', value: toDate },
  ]
  if (employeeId) where.unshift({ field: 'employeeId', op: '==', value: employeeId })

  return repo.list('employeeAttendance', {
    where,
    orderBy: { field: 'date', dir: 'desc' },
    limit,
  })
}

/** Lo de hoy, para el panel y la recepción. */
export function readToday(repo: TenantRepo, limit = 100): Promise<EmployeeAttendance[]> {
  const today = dayKey()
  return repo.list('employeeAttendance', {
    where: [{ field: 'date', op: '==', value: today }],
    limit,
  })
}
