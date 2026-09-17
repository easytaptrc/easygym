import type { Bike, GymClass, GymSettings, Member, Reservation, Weekday } from '@/types'
import { combine, dayKey, fmt12h, fmtDayKey, weekdayOf } from '@/lib/date'
import type { TenantRepo } from './db'
import { bumpDaily } from './aggregates'
import { audit } from './audit'
import { assertCurrentGymCanOperate } from './gymStatus'

// ═══════════════════════════════════════════════════════════════════════════
// Reservaciones y mapa de bicicletas.
//
// Las dos reglas que hay que cumplir sí o sí:
//   1. Nunca se sobrepasa el cupo de una clase.
//   2. Nunca dos socios acaban con la misma bicicleta.
//
// Ambas se resuelven DENTRO de una transacción (`repo.transaction`): se lee
// el estado y se escribe la reservación en la misma operación atómica. Validar
// en la UI y luego escribir es exactamente como se producen los duplicados.
// ═══════════════════════════════════════════════════════════════════════════

export class ReservationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'class-full'
      | 'bike-taken'
      | 'already-reserved'
      | 'too-many'
      | 'closed'
      | 'not-allowed'
      | 'cancel-window'
      | 'past',
  ) {
    super(message)
  }
}

export interface Slot {
  classId: string
  className: string
  /** YYYY-MM-DD */
  date: string
  /** HH:mm */
  time: string
  capacity: number
  taken: number
  free: number
  startsAt: number
  usesBikeMap: boolean
  instructor: string
  durationMin: number
  full: boolean
  past: boolean
}

/** ¿Esta clase se imparte ese día a esa hora? */
export function classRunsAt(cls: GymClass, date: string, time: string): boolean {
  const day = weekdayOf(date) as Weekday
  return cls.active && cls.schedule.days.includes(day) && cls.schedule.times.includes(time)
}

/** Todos los horarios de un día concreto, con su ocupación. */
export function buildSlots(
  classes: GymClass[],
  reservations: Reservation[],
  date: string,
  now = Date.now(),
): Slot[] {
  const day = weekdayOf(date) as Weekday
  const slots: Slot[] = []

  for (const cls of classes) {
    if (!cls.active || !cls.schedule.days.includes(day)) continue
    for (const time of [...cls.schedule.times].sort()) {
      const taken = reservations.filter(
        (r) => r.classId === cls.id && r.date === date && r.time === time && r.status !== 'CANCELLED',
      ).length
      const startsAt = combine(date, time)
      slots.push({
        classId: cls.id,
        className: cls.name,
        date,
        time,
        capacity: cls.capacity,
        taken,
        free: Math.max(0, cls.capacity - taken),
        startsAt,
        usesBikeMap: cls.usesBikeMap,
        instructor: cls.instructor,
        durationMin: cls.durationMin,
        full: taken >= cls.capacity,
        past: startsAt < now,
      })
    }
  }

  return slots.sort((a, b) => a.startsAt - b.startsAt)
}

export interface ReserveInput {
  member: Pick<Member, 'id' | 'name' | 'membershipPlanId' | 'expiresAt' | 'status'>
  cls: GymClass
  date: string
  time: string
  bikeId?: string | null
  settings: GymSettings | null
}

/**
 * Crea una reservación de forma atómica.
 *
 * Todas las comprobaciones viven DENTRO de la transacción: aunque dos socios
 * pulsen "Reservar" en el mismo milisegundo sobre la última bicicleta, solo
 * uno de los dos sale con reservación.
 */
export async function reserveSlot(repo: TenantRepo, input: ReserveInput): Promise<Reservation> {
  assertCurrentGymCanOperate()

  const { member, cls, date, time, settings } = input
  const startsAt = combine(date, time)

  if (startsAt < Date.now()) {
    throw new ReservationError('Ese horario ya pasó.', 'past')
  }

  // ¿Su membresía permite esta clase?
  if (cls.allowedMembershipPlanIds.length > 0 && member.membershipPlanId) {
    if (!cls.allowedMembershipPlanIds.includes(member.membershipPlanId)) {
      throw new ReservationError('Tu membresía no incluye esta clase.', 'not-allowed')
    }
  }
  if (member.expiresAt !== null && member.expiresAt !== undefined && member.expiresAt < Date.now()) {
    throw new ReservationError('Tu membresía está vencida. Renuévala para reservar.', 'not-allowed')
  }

  // ¿Ya abrió la ventana de reservación?
  const opensHours = settings?.reservationOpensHoursBefore ?? 72
  if (startsAt - Date.now() > opensHours * 3_600_000) {
    throw new ReservationError(
      `Las reservaciones abren ${opensHours} horas antes de la clase.`,
      'closed',
    )
  }

  const maxActive = settings?.maxActiveReservationsPerMember ?? 3

  const reservation = await repo.transaction(async (tx) => {
    // Acotado a partir de hoy: las reservaciones de un socio se acumulan para
    // siempre, y lo que hace falta comprobar son las que aún no han pasado.
    const existing = await tx.list('reservations', {
      where: [
        { field: 'memberId', op: '==', value: member.id },
        { field: 'date', op: '>=', value: dayKey() },
      ],
    })

    // ¿Ya reservó este mismo horario?
    if (
      existing.some(
        (r) => r.classId === cls.id && r.date === date && r.time === time && r.status !== 'CANCELLED',
      )
    ) {
      throw new ReservationError('Ya tienes una reservación para este horario.', 'already-reserved')
    }

    // ¿Excede su tope de reservaciones activas?
    const active = existing.filter(
      (r) => r.status === 'CONFIRMED' && combine(r.date, r.time) >= Date.now(),
    ).length
    if (active >= maxActive) {
      throw new ReservationError(
        `Solo puedes tener ${maxActive} reservaciones activas a la vez.`,
        'too-many',
      )
    }

    // Ocupación real del horario, leída dentro de la transacción y acotada al
    // día: pedir todas las reservaciones históricas de la clase para contar
    // las de una hora concreta crece sin tope con los años.
    const slotReservations = (
      await tx.list('reservations', {
        where: [
          { field: 'classId', op: '==', value: cls.id },
          { field: 'date', op: '==', value: date },
        ],
      })
    ).filter((r) => r.time === time && r.status !== 'CANCELLED')

    if (slotReservations.length >= cls.capacity) {
      throw new ReservationError('CLASE LLENA — ya no hay lugares disponibles.', 'class-full')
    }

    // Bicicleta: unicidad dentro del mismo horario.
    let bike: Bike | null = null
    if (cls.usesBikeMap) {
      if (!input.bikeId) throw new ReservationError('Selecciona una bicicleta.', 'not-allowed')
      bike = await tx.get('bikes', input.bikeId)
      if (!bike) throw new ReservationError('Esa bicicleta no existe.', 'not-allowed')
      if (bike.status !== 'AVAILABLE') {
        throw new ReservationError('Esa bicicleta no está disponible.', 'bike-taken')
      }
      if (slotReservations.some((r) => r.bikeId === input.bikeId)) {
        throw new ReservationError(
          `La bicicleta ${bike.number} acaba de ser reservada por alguien más.`,
          'bike-taken',
        )
      }
    }

    return tx.create('reservations', {
      classId: cls.id,
      className: cls.name,
      memberId: member.id,
      memberName: member.name,
      bikeId: bike?.id ?? null,
      bikeNumber: bike?.number ?? null,
      date,
      time,
      status: 'CONFIRMED',
      cancelledAt: null,
      checkedInAt: null,
    })
  })

  // El agregado se suma FUERA de la transacción: meterlo dentro obligaría a
  // anidar transacciones y haría que un contador con contención pudiera
  // reintentar —o abortar— la reserva de la bicicleta.
  void bumpDaily(repo.gymId, dayKey(reservation.createdAt), { reservations: 1 })

  audit({
    gymId: repo.gymId,
    action: 'RESERVATION_CREATED',
    entityType: 'reservations',
    entityId: reservation.id,
    summary: `${member.name} reservó ${slotLabel({ className: cls.name, date, time })}`,
    after: {
      clase: cls.name,
      fecha: date,
      hora: time,
      ...(reservation.bikeNumber ? { bicicleta: reservation.bikeNumber } : {}),
    },
  })

  return reservation
}

// ───────────────────────────── Cancelaciones ────────────────────────────────

export interface CancelCheck {
  allowed: boolean
  minutesLeft: number
  windowMin: number
  message: string
}

/** ¿Estamos todavía dentro del periodo en el que se puede cancelar? */
export function canCancel(reservation: Reservation, settings: GymSettings | null, now = Date.now()): CancelCheck {
  const windowMin = settings?.cancellationWindowMin ?? 120
  const startsAt = combine(reservation.date, reservation.time)
  const minutesLeft = Math.floor((startsAt - now) / 60_000)

  if (reservation.status === 'CANCELLED') {
    return { allowed: false, minutesLeft, windowMin, message: 'Esta reservación ya fue cancelada.' }
  }
  if (minutesLeft <= 0) {
    return { allowed: false, minutesLeft, windowMin, message: 'La clase ya comenzó.' }
  }
  if (minutesLeft < windowMin) {
    return {
      allowed: false,
      minutesLeft,
      windowMin,
      message:
        'No es posible cancelar esta reservación porque se encuentra fuera del periodo permitido.',
    }
  }
  return { allowed: true, minutesLeft, windowMin, message: 'Puedes cancelar esta reservación.' }
}

export async function cancelReservation(
  repo: TenantRepo,
  reservation: Reservation,
  settings: GymSettings | null,
  /** La recepción puede forzar la cancelación fuera del periodo. */
  force = false,
): Promise<void> {
  assertCurrentGymCanOperate()

  const check = canCancel(reservation, settings)
  if (!check.allowed && !force) throw new ReservationError(check.message, 'cancel-window')
  await repo.update('reservations', reservation.id, { status: 'CANCELLED', cancelledAt: Date.now() })

  audit({
    gymId: repo.gymId,
    action: 'RESERVATION_CANCELLED',
    entityType: 'reservations',
    entityId: reservation.id,
    summary: `Cancelación de ${slotLabel(reservation)} · ${reservation.memberName}${
      force ? ' (forzada desde recepción)' : ''
    }`,
    before: { status: reservation.status },
    after: { status: 'CANCELLED', ...(force ? { forzada: true } : {}) },
  })
}

export function cancellationWindowLabel(min: number): string {
  if (min < 60) return `${min} minutos antes`
  if (min < 1440) return `${min / 60} horas antes`
  return `${min / 1440} ${min / 1440 === 1 ? 'día' : 'días'} antes`
}

export const CANCELLATION_OPTIONS = [
  { value: 30, label: '30 minutos antes' },
  { value: 120, label: '2 horas antes' },
  { value: 720, label: '12 horas antes' },
  { value: 1440, label: '24 horas antes' },
] as const

// ────────────────────────────── Mapa de bicis ───────────────────────────────

export type BikeCellState = 'available' | 'reserved' | 'selected' | 'blocked' | 'mine'

export interface BikeCell {
  bike: Bike
  state: BikeCellState
  reservedBy?: string
}

/** Cruza el layout con las reservaciones del horario para pintar el mapa. */
export function buildBikeMap(
  bikes: Bike[],
  slotReservations: Reservation[],
  selectedBikeId: string | null,
  myMemberId?: string | null,
): BikeCell[] {
  return [...bikes]
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((bike) => {
      const res = slotReservations.find((r) => r.bikeId === bike.id && r.status !== 'CANCELLED')
      let state: BikeCellState = 'available'
      if (bike.status !== 'AVAILABLE') state = 'blocked'
      else if (res) state = myMemberId && res.memberId === myMemberId ? 'mine' : 'reserved'
      else if (selectedBikeId === bike.id) state = 'selected'
      return { bike, state, ...(res ? { reservedBy: res.memberName } : {}) }
    })
}

/** Genera el layout de bicicletas para un salón de `rows` × `cols`. */
export function generateBikeLayout(rows: number, cols: number): Array<Omit<Bike, 'id' | 'gymId' | 'createdAt'>> {
  const out: Array<Omit<Bike, 'id' | 'gymId' | 'createdAt'>> = []
  let n = 1
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ number: n++, row: r, col: c, status: 'AVAILABLE' })
    }
  }
  return out
}

export function slotLabel(slot: Pick<Slot, 'date' | 'time' | 'className'>): string {
  return `${slot.className} · ${fmtDayKey(slot.date)} · ${fmt12h(slot.time)}`
}
