import { describe, expect, it } from 'vitest'
import type { EmployeeAttendance, WorkSchedule } from '@/types'
import {
  absenceRecord,
  defaultSchedule,
  emptySchedule,
  evaluateEntry,
  evaluateExit,
  formatDuration,
  fromMinutes,
  isRestDay,
  missingDays,
  resolveStatus,
  scheduledMinutes,
  shiftForEntry,
  shiftsFor,
  summarize,
  toMinutes,
  weekdayOfDate,
  weeklyScheduledMinutes,
  workedMinutesBetween,
} from '@/lib/workSchedule'

// ═══════════════════════════════════════════════════════════════════════════
// Horarios, tolerancia y retardos.
//
// Esta es la parte del producto donde un error se convierte en que a alguien
// le descuenten un día que sí trabajó. Se prueba con números concretos, no con
// aproximaciones.
// ═══════════════════════════════════════════════════════════════════════════

describe('horas y minutos', () => {
  it('convierte HH:mm a minutos', () => {
    expect(toMinutes('00:00')).toBe(0)
    expect(toMinutes('07:00')).toBe(420)
    expect(toMinutes('07:30')).toBe(450)
    expect(toMinutes('16:00')).toBe(960)
    expect(toMinutes('23:59')).toBe(1439)
  })

  it('rechaza lo que no es una hora', () => {
    expect(toMinutes('')).toBeNull()
    expect(toMinutes(null)).toBeNull()
    expect(toMinutes('24:00')).toBeNull()
    expect(toMinutes('07:60')).toBeNull()
    expect(toMinutes('siete')).toBeNull()
  })

  it('vuelve de minutos a HH:mm', () => {
    expect(fromMinutes(420)).toBe('07:00')
    expect(fromMinutes(455)).toBe('07:35')
  })

  it('formatea duraciones como las lee una persona', () => {
    expect(formatDuration(2325)).toBe('38h 45m')
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(0)).toBe('0m')
  })
})

describe('el horario semanal', () => {
  it('resuelve el día de la semana en hora local', () => {
    // 14 de septiembre de 2026 es lunes.
    expect(weekdayOfDate('2026-09-14')).toBe('mon')
    expect(weekdayOfDate('2026-09-18')).toBe('fri')
    expect(weekdayOfDate('2026-09-20')).toBe('sun')
  })

  it('un día sin turnos es descanso', () => {
    const s = defaultSchedule('07:00', '16:00')
    expect(isRestDay(s, '2026-09-14')).toBe(false) // lunes
    expect(isRestDay(s, '2026-09-19')).toBe(true) // sábado
    expect(isRestDay(s, '2026-09-20')).toBe(true) // domingo
  })

  it('suma los minutos que exige cada día', () => {
    const s = defaultSchedule('07:00', '16:00')
    expect(scheduledMinutes(s, '2026-09-14')).toBe(540) // 9 horas
    expect(scheduledMinutes(s, '2026-09-19')).toBe(0)
    expect(weeklyScheduledMinutes(s)).toBe(540 * 5)
  })

  it('admite jornada partida en el mismo día', () => {
    const s: WorkSchedule = {
      ...emptySchedule(),
      mon: [
        { start: '14:00', end: '18:00' },
        { start: '07:00', end: '12:00' },
      ],
    }
    // Se devuelven ordenados aunque se guarden al revés.
    expect(shiftsFor(s, '2026-09-14').map((x) => x.start)).toEqual(['07:00', '14:00'])
    expect(scheduledMinutes(s, '2026-09-14')).toBe(300 + 240)
  })

  it('con jornada partida, elige el turno al que se está llegando', () => {
    const shifts = [
      { start: '07:00', end: '12:00' },
      { start: '14:00', end: '18:00' },
    ]
    // Quien ficha a las 13:52 llega al SEGUNDO turno, no 352 minutos tarde
    // al primero.
    expect(shiftForEntry(shifts, '13:52')?.start).toBe('14:00')
    // Dentro del primer turno, aunque 11:00 esté más cerca de las 14:00.
    expect(shiftForEntry(shifts, '11:00')?.start).toBe('07:00')
    expect(shiftForEntry(shifts, '07:03')?.start).toBe('07:00')
    // Antes de todo: llega pronto al primero.
    expect(shiftForEntry(shifts, '06:30')?.start).toBe('07:00')
    // Entre turnos: llega pronto al segundo.
    expect(shiftForEntry(shifts, '12:30')?.start).toBe('14:00')
    // Después de todo: se le imputa el último.
    expect(shiftForEntry(shifts, '19:00')?.start).toBe('14:00')
  })
})

describe('tolerancia de entrada', () => {
  const HORARIO = '07:00'
  const TOLERANCIA = 15

  it('llegar antes es puntual', () => {
    const r = evaluateEntry(HORARIO, '06:58', TOLERANCIA)
    expect(r.status).toBe('ON_TIME')
    expect(r.lateMinutes).toBe(0)
  })

  it('llegar en punto es puntual', () => {
    expect(evaluateEntry(HORARIO, '07:00', TOLERANCIA).status).toBe('ON_TIME')
  })

  it('dentro de la tolerancia es puntual', () => {
    expect(evaluateEntry(HORARIO, '07:05', TOLERANCIA).status).toBe('ON_TIME')
    expect(evaluateEntry(HORARIO, '07:14', TOLERANCIA).status).toBe('ON_TIME')
  })

  it('el último minuto de tolerancia CUENTA como dentro', () => {
    const r = evaluateEntry(HORARIO, '07:15', TOLERANCIA)
    expect(r.status).toBe('ON_TIME')
    expect(r.lateMinutes).toBe(0)
  })

  it('un minuto después de la tolerancia ya es retardo', () => {
    const r = evaluateEntry(HORARIO, '07:16', TOLERANCIA)
    expect(r.status).toBe('LATE')
    expect(r.lateMinutes).toBe(1)
  })

  it('los minutos de retardo se cuentan DESDE el fin de la tolerancia', () => {
    // 07:20 con tolerancia 15 son 5 minutos de retardo, no 20.
    const r = evaluateEntry(HORARIO, '07:20', TOLERANCIA)
    expect(r.status).toBe('LATE')
    expect(r.lateMinutes).toBe(5)
    expect(r.minutesAfterSchedule).toBe(20)
  })

  it('sin tolerancia, un minuto tarde es un minuto de retardo', () => {
    const r = evaluateEntry(HORARIO, '07:01', 0)
    expect(r.status).toBe('LATE')
    expect(r.lateMinutes).toBe(1)
  })

  it('sin horario asignado no se puede llegar tarde', () => {
    const r = evaluateEntry(null, '11:42', 15)
    expect(r.status).toBe('ON_TIME')
    expect(r.lateMinutes).toBe(0)
  })
})

describe('salida anticipada y horas trabajadas', () => {
  it('salir después del horario no es salida anticipada', () => {
    expect(evaluateExit('16:00', '16:02')).toBe(0)
    expect(evaluateExit('16:00', '16:00')).toBe(0)
  })

  it('salir antes cuenta los minutos que faltaron', () => {
    expect(evaluateExit('16:00', '15:30')).toBe(30)
  })

  it('cuenta los minutos trabajados entre entrada y salida reales', () => {
    expect(workedMinutesBetween('07:00', '16:00')).toBe(540)
    expect(workedMinutesBetween('06:58', '16:02')).toBe(544)
  })

  it('sin salida no hay minutos trabajados', () => {
    expect(workedMinutesBetween('07:00', null)).toBe(0)
  })
})

describe('estado del día', () => {
  const base = { hasSchedule: true, lateMinutes: 0, earlyExitMinutes: 0 }

  it('con turno y sin entrada es FALTA', () => {
    expect(resolveStatus({ ...base, actualEntry: null, actualExit: null })).toBe('ABSENT')
  })

  it('sin turno y sin entrada no es falta: era su descanso', () => {
    expect(
      resolveStatus({ ...base, hasSchedule: false, actualEntry: null, actualExit: null }),
    ).toBe('ON_TIME')
  })

  it('una falta justificada deja de ser falta', () => {
    expect(
      resolveStatus({ ...base, actualEntry: null, actualExit: null, justified: true }),
    ).toBe('JUSTIFIED')
  })

  it('entrada sin salida queda INCOMPLETO', () => {
    expect(resolveStatus({ ...base, actualEntry: '07:00', actualExit: null })).toBe('INCOMPLETE')
  })

  it('el retardo manda sobre la salida anticipada', () => {
    const s = resolveStatus({
      ...base,
      actualEntry: '07:30',
      actualExit: '15:00',
      lateMinutes: 15,
      earlyExitMinutes: 60,
    })
    expect(s).toBe('LATE')
  })

  it('llegar bien y salir antes es SALIDA ANTICIPADA', () => {
    const s = resolveStatus({
      ...base,
      actualEntry: '07:00',
      actualExit: '15:00',
      earlyExitMinutes: 60,
    })
    expect(s).toBe('EARLY_EXIT')
  })

  it('todo en orden es PUNTUAL', () => {
    expect(resolveStatus({ ...base, actualEntry: '06:58', actualExit: '16:02' })).toBe('ON_TIME')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// EL CASO DE ADRIÁN
//
// Mantenimiento · 7:00 → 16:00 · tolerancia 15 minutos.
// Es el escenario que debe poder demostrarse de punta a punta.
// ═══════════════════════════════════════════════════════════════════════════

/** Construye el registro del día tal como lo haría el servicio. */
function dayRecord(date: string, entry: string, exit: string): EmployeeAttendance {
  const entryEval = evaluateEntry('07:00', entry, 15)
  const earlyExitMinutes = evaluateExit('16:00', exit)
  return {
    id: `att_${date}`,
    gymId: 'gym_demo',
    employeeId: 'emp_adrian',
    employeeName: 'Adrián Rivera',
    position: 'Mantenimiento',
    date,
    scheduledEntry: '07:00',
    scheduledExit: '16:00',
    actualEntry: entry,
    actualExit: exit,
    toleranceMinutes: 15,
    status: resolveStatus({
      hasSchedule: true,
      actualEntry: entry,
      actualExit: exit,
      lateMinutes: entryEval.lateMinutes,
      earlyExitMinutes,
    }),
    lateMinutes: entryEval.lateMinutes,
    earlyExitMinutes,
    workedMinutes: workedMinutesBetween(entry, exit),
    method: 'MANUAL',
    createdAt: 0,
  }
}

describe('Adrián · semana del 14 al 20 de septiembre', () => {
  const semana = [
    dayRecord('2026-09-14', '06:58', '16:02'), // lunes
    dayRecord('2026-09-15', '07:20', '16:05'), // martes
    dayRecord('2026-09-16', '07:01', '16:00'), // miércoles
    dayRecord('2026-09-17', '07:05', '16:01'), // jueves
    dayRecord('2026-09-18', '07:00', '16:00'), // viernes
  ]

  it('lunes 6:58 → puntual', () => {
    expect(semana[0].status).toBe('ON_TIME')
    expect(semana[0].lateMinutes).toBe(0)
  })

  it('martes 7:20 → retardo de 5 minutos', () => {
    expect(semana[1].status).toBe('LATE')
    expect(semana[1].lateMinutes).toBe(5)
  })

  it('miércoles 7:01 → puntual', () => {
    expect(semana[2].status).toBe('ON_TIME')
  })

  it('jueves 7:05 → puntual', () => {
    expect(semana[3].status).toBe('ON_TIME')
  })

  it('viernes 7:00 → puntual', () => {
    expect(semana[4].status).toBe('ON_TIME')
  })

  it('la hora REAL se conserva intacta, aunque el estado sea retardo', () => {
    expect(semana[1].actualEntry).toBe('07:20')
  })

  it('resumen: 4 puntuales, 1 retardo, 0 faltas, 5 minutos', () => {
    const s = summarize(semana)
    expect(s.onTime).toBe(4)
    expect(s.late).toBe(1)
    expect(s.absent).toBe(0)
    expect(s.earlyExits).toBe(0)
    expect(s.lateMinutes).toBe(5)
    expect(s.daysWorked).toBe(5)
  })

  it('resumen: horas trabajadas de la semana', () => {
    const s = summarize(semana)
    // 544 + 525 + 539 + 536 + 540 = 2684 minutos
    expect(s.workedMinutes).toBe(2684)
    expect(formatDuration(s.workedMinutes)).toBe('44h 44m')
  })

  it('resumen: puntualidad del 80 %', () => {
    expect(summarize(semana).punctualityPct).toBe(80)
  })
})

describe('faltas derivadas del horario', () => {
  const schedule = defaultSchedule('07:00', '16:00')
  const semana = [
    '2026-09-14',
    '2026-09-15',
    '2026-09-16',
    '2026-09-17',
    '2026-09-18',
    '2026-09-19',
    '2026-09-20',
  ]

  it('un día con turno y sin registro es falta', () => {
    const existing = [dayRecord('2026-09-14', '07:00', '16:00')]
    const faltas = missingDays(schedule, semana, existing, '2026-09-18')
    expect(faltas).toEqual(['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'])
  })

  it('el sábado y el domingo no son faltas: son descanso', () => {
    const faltas = missingDays(schedule, semana, [], '2026-09-20')
    expect(faltas).not.toContain('2026-09-19')
    expect(faltas).not.toContain('2026-09-20')
  })

  it('no se inventan faltas futuras', () => {
    // El miércoles todavía no ha faltado nadie el viernes.
    const faltas = missingDays(schedule, semana, [], '2026-09-16')
    expect(faltas).toEqual(['2026-09-14', '2026-09-15', '2026-09-16'])
  })

  it('el registro sintético de falta no se escribe, solo se pinta', () => {
    const r = absenceRecord(
      'gym_demo',
      { id: 'emp_adrian', name: 'Adrián', lastName: 'Rivera', position: 'Mantenimiento' },
      '2026-09-15',
      schedule,
    )
    expect(r.status).toBe('ABSENT')
    expect(r.actualEntry).toBeNull()
    expect(r.scheduledEntry).toBe('07:00')
    expect(r.workedMinutes).toBe(0)
  })
})

describe('resumen con faltas y salidas anticipadas', () => {
  it('cuenta cada cosa por separado', () => {
    const records: EmployeeAttendance[] = [
      dayRecord('2026-09-14', '07:00', '16:00'), // puntual
      dayRecord('2026-09-15', '07:30', '16:00'), // retardo 15
      dayRecord('2026-09-16', '07:00', '15:00'), // salida anticipada 60
      absenceRecord(
        'gym_demo',
        { id: 'e1', name: 'X', position: 'Limpieza' },
        '2026-09-17',
        defaultSchedule(),
      ),
    ]
    const s = summarize(records)
    expect(s.late).toBe(1)
    expect(s.lateMinutes).toBe(15)
    expect(s.absent).toBe(1)
    expect(s.earlyExits).toBe(1)
    expect(s.earlyExitMinutes).toBe(60)
    // La salida anticipada llegó puntual, así que cuenta como puntual.
    expect(s.onTime).toBe(2)
    expect(s.daysWorked).toBe(3)
  })
})
