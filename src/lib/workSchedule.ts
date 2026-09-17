import type {
  EmployeeAttendance,
  WorkAttendanceStatus,
  WorkSchedule,
  WorkShift,
} from '@/types'

// ═══════════════════════════════════════════════════════════════════════════
// Horarios, tolerancia y retardos — LÓGICA PURA.
//
// Aquí no hay red, ni reloj global, ni Firestore. Todo entra por parámetro y
// todo sale calculado, para que se pueda probar de verdad: esta es la parte
// del producto donde un error se traduce en que a alguien le descuenten un día
// que sí trabajó.
//
// LA REGLA QUE NO SE NEGOCIA
//
// La hora real de entrada NUNCA se toca. Si alguien llegó a las 7:20, el
// registro dice 7:20. Lo que se calcula encima —puntual, retardo, cuántos
// minutos— es una DERIVACIÓN, y siempre se puede volver a calcular desde el
// dato original. Un sistema que redondea la entrada para que cuadre deja de
// servir como prueba de nada, ni a favor del empleado ni del gimnasio.
// ═══════════════════════════════════════════════════════════════════════════

export type WeekdayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

/** Orden de la semana laboral en México: empieza en lunes. */
export const WEEK_ORDER: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export const WEEKDAY_LABEL: Record<WeekdayKey, string> = {
  mon: 'Lunes',
  tue: 'Martes',
  wed: 'Miércoles',
  thu: 'Jueves',
  fri: 'Viernes',
  sat: 'Sábado',
  sun: 'Domingo',
}

/** Índice de `Date.getDay()` → clave del horario. */
const BY_INDEX: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function emptySchedule(): WorkSchedule {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
}

/**
 * Horario de oficina de lunes a viernes. Solo es el valor por defecto del
 * formulario: cualquier día y cualquier turno se puede cambiar.
 */
export function defaultSchedule(start = '07:00', end = '16:00'): WorkSchedule {
  const s = emptySchedule()
  for (const d of ['mon', 'tue', 'wed', 'thu', 'fri'] as WeekdayKey[]) {
    s[d] = [{ start, end }]
  }
  return s
}

// ───────────────────────────── Horas y minutos ──────────────────────────────

/** `"07:30"` → 450. Devuelve `null` si no es una hora válida. */
export function toMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

/** 450 → `"07:30"`. */
export function fromMinutes(total: number): string {
  const clamped = Math.max(0, Math.round(total))
  const h = Math.floor(clamped / 60) % 24
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 2325 → `"38h 45m"`. Formato del resumen semanal. */
export function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  const h = Math.floor(safe / 60)
  const m = safe % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${String(m).padStart(2, '0')}m`
}

// ──────────────────────────────── El horario ────────────────────────────────

/** `"2026-09-14"` → `'mon'`. Se construye en hora LOCAL, no UTC. */
export function weekdayOfDate(dateKey: string): WeekdayKey {
  const [y, m, d] = dateKey.split('-').map(Number)
  return BY_INDEX[new Date(y, (m ?? 1) - 1, d ?? 1).getDay()]
}

/** Turnos de ese día, ordenados. Array vacío = descanso. */
export function shiftsFor(schedule: WorkSchedule | undefined, dateKey: string): WorkShift[] {
  if (!schedule) return []
  const shifts = schedule[weekdayOfDate(dateKey)] ?? []
  return [...shifts].sort((a, b) => (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0))
}

export function isRestDay(schedule: WorkSchedule | undefined, dateKey: string): boolean {
  return shiftsFor(schedule, dateKey).length === 0
}

/** Minutos que el horario exige ese día, sumando todos sus turnos. */
export function scheduledMinutes(schedule: WorkSchedule | undefined, dateKey: string): number {
  return shiftsFor(schedule, dateKey).reduce((total, s) => {
    const a = toMinutes(s.start)
    const b = toMinutes(s.end)
    return a === null || b === null ? total : total + Math.max(0, b - a)
  }, 0)
}

export function weeklyScheduledMinutes(schedule: WorkSchedule | undefined): number {
  if (!schedule) return 0
  return WEEK_ORDER.reduce((total, day) => {
    return (
      total +
      (schedule[day] ?? []).reduce((t, s) => {
        const a = toMinutes(s.start)
        const b = toMinutes(s.end)
        return a === null || b === null ? t : t + Math.max(0, b - a)
      }, 0)
    )
  }, 0)
}

/**
 * El turno al que corresponde una entrada.
 *
 * Con jornada partida (7:00–12:00 y 14:00–18:00), alguien que ficha a las
 * 13:52 está llegando al SEGUNDO turno, no 352 minutos tarde al primero.
 *
 * El orden importa, y elegir «el inicio más cercano» no sirve: las 11:00
 * están más cerca de las 14:00 que de las 7:00, pero quien ficha a las 11:00
 * está DENTRO de su primer turno. Por eso se decide así:
 *
 *   1. ¿La hora cae dentro de algún turno?   → ese turno
 *   2. ¿Hay algún turno que aún no empieza?  → el primero de ellos (llega antes)
 *   3. Si no                                  → el último (todos ya pasaron)
 */
export function shiftForEntry(shifts: WorkShift[], actualEntry: string): WorkShift | null {
  const actual = toMinutes(actualEntry)
  if (actual === null || shifts.length === 0) return null

  const ordered = [...shifts].sort((a, b) => (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0))

  for (const shift of ordered) {
    const start = toMinutes(shift.start)
    const end = toMinutes(shift.end)
    if (start === null || end === null) continue
    if (actual >= start && actual <= end) return shift
  }

  for (const shift of ordered) {
    const start = toMinutes(shift.start)
    if (start !== null && actual < start) return shift
  }

  return ordered[ordered.length - 1] ?? null
}

// ─────────────────────────── Puntualidad y retardo ──────────────────────────

export interface EntryEvaluation {
  status: Extract<WorkAttendanceStatus, 'ON_TIME' | 'LATE'>
  /** Minutos MÁS ALLÁ de la tolerancia. 0 cuando llegó dentro. */
  lateMinutes: number
  /** Minutos de diferencia con el horario, tolerancia aparte. Informativo. */
  minutesAfterSchedule: number
}

/**
 * ¿Llegó a tiempo?
 *
 * Con horario 7:00 y 15 minutos de tolerancia:
 *
 *   06:58 → puntual   (llegó antes)
 *   07:00 → puntual
 *   07:14 → puntual   (dentro de tolerancia)
 *   07:15 → puntual   (el último minuto de tolerancia CUENTA como dentro)
 *   07:16 → retardo, lateMinutes = 1
 *   07:20 → retardo, lateMinutes = 5
 *
 * La tolerancia es un margen concedido, no un adelanto del horario: por eso
 * `lateMinutes` se mide desde el final de la tolerancia y no desde las 7:00.
 * Quien llega 07:20 acumula 5 minutos, no 20.
 */
export function evaluateEntry(
  scheduledEntry: string | null,
  actualEntry: string,
  toleranceMinutes: number,
): EntryEvaluation {
  const scheduled = toMinutes(scheduledEntry)
  const actual = toMinutes(actualEntry)

  // Sin horario asignado no se puede llegar tarde: se ficha y ya.
  if (scheduled === null || actual === null) {
    return { status: 'ON_TIME', lateMinutes: 0, minutesAfterSchedule: 0 }
  }

  const minutesAfterSchedule = actual - scheduled
  const tolerance = Math.max(0, toleranceMinutes)
  const late = minutesAfterSchedule - tolerance

  if (late <= 0) {
    return { status: 'ON_TIME', lateMinutes: 0, minutesAfterSchedule }
  }
  return { status: 'LATE', lateMinutes: late, minutesAfterSchedule }
}

/**
 * ¿Se fue antes?
 *
 * Sin tolerancia propia: cerrar el turno es cerrar el turno. Si más adelante
 * hace falta un margen de salida, va aquí y en ningún otro sitio.
 */
export function evaluateExit(scheduledExit: string | null, actualExit: string): number {
  const scheduled = toMinutes(scheduledExit)
  const actual = toMinutes(actualExit)
  if (scheduled === null || actual === null) return 0
  return Math.max(0, scheduled - actual)
}

/** Minutos entre entrada y salida reales. Nunca negativo. */
export function workedMinutesBetween(
  actualEntry: string | null,
  actualExit: string | null,
): number {
  const a = toMinutes(actualEntry)
  const b = toMinutes(actualExit)
  if (a === null || b === null) return 0
  return Math.max(0, b - a)
}

// ──────────────────────────── Estado del registro ───────────────────────────

/**
 * Estado final de un día.
 *
 * PRECEDENCIA, y por qué:
 *
 *   JUSTIFIED   una falta con permiso deja de ser falta
 *   ABSENT      tenía turno y no fichó
 *   INCOMPLETE  entró y nunca salió — el dato está roto, hay que arreglarlo
 *               antes de juzgar puntualidad
 *   LATE        llegó fuera de tolerancia
 *   EARLY_EXIT  llegó bien pero se fue antes
 *   ON_TIME     todo en orden
 *
 * `lateMinutes` y `earlyExitMinutes` viajan SIEMPRE aparte del estado. Así el
 * resumen semanal puede contar «1 retardo Y 1 salida anticipada» aunque el
 * estado solo pueda tener un valor.
 */
export function resolveStatus(input: {
  hasSchedule: boolean
  actualEntry: string | null
  actualExit: string | null
  lateMinutes: number
  earlyExitMinutes: number
  justified?: boolean
}): WorkAttendanceStatus {
  if (input.justified) return 'JUSTIFIED'
  if (!input.actualEntry) return input.hasSchedule ? 'ABSENT' : 'ON_TIME'
  if (!input.actualExit) return 'INCOMPLETE'
  if (input.lateMinutes > 0) return 'LATE'
  if (input.earlyExitMinutes > 0) return 'EARLY_EXIT'
  return 'ON_TIME'
}

export const WORK_STATUS_LABEL: Record<WorkAttendanceStatus, string> = {
  ON_TIME: 'Puntual',
  LATE: 'Retardo',
  ABSENT: 'Falta',
  JUSTIFIED: 'Justificada',
  EARLY_EXIT: 'Salida anticipada',
  INCOMPLETE: 'Sin salida',
}

export const WORK_STATUS_TONE: Record<WorkAttendanceStatus, 'gym' | 'warn' | 'danger' | 'cyber' | 'neutral'> = {
  ON_TIME: 'gym',
  LATE: 'warn',
  ABSENT: 'danger',
  JUSTIFIED: 'cyber',
  EARLY_EXIT: 'warn',
  INCOMPLETE: 'neutral',
}

// ───────────────────────────── Resumen semanal ──────────────────────────────

export interface WorkSummary {
  onTime: number
  late: number
  absent: number
  justified: number
  earlyExits: number
  incomplete: number
  lateMinutes: number
  earlyExitMinutes: number
  workedMinutes: number
  /** Días con al menos una entrada. */
  daysWorked: number
  /** Puntuales ÷ días con turno, en porcentaje. */
  punctualityPct: number
}

export function emptySummary(): WorkSummary {
  return {
    onTime: 0,
    late: 0,
    absent: 0,
    justified: 0,
    earlyExits: 0,
    incomplete: 0,
    lateMinutes: 0,
    earlyExitMinutes: 0,
    workedMinutes: 0,
    daysWorked: 0,
    punctualityPct: 0,
  }
}

/**
 * Agrega una lista de registros.
 *
 * Es lo que evita que el dueño tenga que abrir día por día: la pregunta real
 * es «¿cómo va Adrián esta semana?», no «¿a qué hora llegó el martes?».
 */
export function summarize(records: EmployeeAttendance[]): WorkSummary {
  const out = emptySummary()

  for (const r of records) {
    switch (r.status) {
      case 'ON_TIME':
        out.onTime++
        break
      case 'LATE':
        out.late++
        break
      case 'ABSENT':
        out.absent++
        break
      case 'JUSTIFIED':
        out.justified++
        break
      case 'EARLY_EXIT':
        out.onTime++ // llegó puntual; la salida se cuenta aparte
        break
      case 'INCOMPLETE':
        out.incomplete++
        break
    }

    out.lateMinutes += r.lateMinutes ?? 0
    out.earlyExitMinutes += r.earlyExitMinutes ?? 0
    out.workedMinutes += r.workedMinutes ?? 0
    if ((r.earlyExitMinutes ?? 0) > 0) out.earlyExits++
    if (r.actualEntry) out.daysWorked++
  }

  // Los días de descanso no entran: no se puede ser puntual a un día libre.
  const scheduledDays = out.onTime + out.late + out.absent + out.incomplete
  out.punctualityPct = scheduledDays === 0 ? 0 : Math.round((out.onTime / scheduledDays) * 100)

  return out
}

// ──────────────────── Reconstrucción de faltas (derivadas) ──────────────────

/**
 * Días con turno en los que NO hay registro.
 *
 * Una falta no es un documento que alguien cree: es la AUSENCIA de uno. Por eso
 * se deriva del horario y del rango, en vez de esperar a que un proceso
 * nocturno escriba «faltó» —que es justo lo que se rompe el día que el proceso
 * no corre—.
 *
 * `untilDate` evita inventar faltas futuras: el viernes no ha faltado nadie
 * todavía el miércoles.
 */
export function missingDays(
  schedule: WorkSchedule | undefined,
  dateKeys: string[],
  existing: EmployeeAttendance[],
  untilDate: string,
): string[] {
  const seen = new Set(existing.map((r) => r.date))
  return dateKeys.filter(
    (d) => d <= untilDate && !seen.has(d) && !isRestDay(schedule, d),
  )
}

/** Registro sintético de falta, para pintar la fila sin escribir en la base. */
export function absenceRecord(
  gymId: string,
  employee: { id: string; name: string; lastName?: string; position: string },
  dateKey: string,
  schedule: WorkSchedule | undefined,
): EmployeeAttendance {
  const shifts = shiftsFor(schedule, dateKey)
  const first = shifts[0]
  const last = shifts[shifts.length - 1]
  return {
    id: `absence_${employee.id}_${dateKey}`,
    gymId,
    employeeId: employee.id,
    employeeName: `${employee.name} ${employee.lastName ?? ''}`.trim(),
    position: employee.position,
    date: dateKey,
    scheduledEntry: first?.start ?? null,
    scheduledExit: last?.end ?? null,
    actualEntry: null,
    actualExit: null,
    toleranceMinutes: 0,
    status: 'ABSENT',
    lateMinutes: 0,
    earlyExitMinutes: 0,
    workedMinutes: 0,
    method: 'MANUAL',
    createdAt: 0,
  }
}
