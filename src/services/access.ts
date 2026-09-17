import type { Attendance, CheckInMethod, GymSettings, Member, MembershipPlan, Visit } from '@/types'
import { dayKey, daysUntil, timeKey } from '@/lib/date'
import type { TenantRepo } from './db'
import { bumpDaily } from './aggregates'
import { audit } from './audit'
import { assertCurrentGymCanOperate } from './gymStatus'
import { computeStatus } from './members'

// ═══════════════════════════════════════════════════════════════════════════
// Control de acceso.
//
// Un solo lugar decide si alguien entra o no. La pantalla de recepción, el
// lector de huella y (mañana) el torniquete llaman todos a `evaluateAccess`.
// Si la política cambia, cambia aquí y cambia en todas partes.
// ═══════════════════════════════════════════════════════════════════════════

export type AccessDecision = 'GRANTED' | 'DENIED' | 'GRACE' | 'VISIT'

export interface AccessResult {
  decision: AccessDecision
  granted: boolean
  /** Titular grande en pantalla. */
  headline: string
  /** Explicación corta debajo. */
  reason: string
  member: Member | null
  membershipPlan: MembershipPlan | null
  daysRemaining: number
  visit?: Visit | null
}

export async function evaluateAccess(
  repo: TenantRepo,
  member: Member,
  settings: GymSettings | null,
): Promise<AccessResult> {
  const nearDays = settings?.nearExpirationDays ?? 7
  const graceDays = settings?.access.graceDays ?? 0
  const allowExpired = settings?.access.allowExpiredEntry ?? false

  const plan = member.membershipPlanId ? await repo.get('membershipPlans', member.membershipPlanId) : null
  const remaining = member.expiresAt ? daysUntil(member.expiresAt) : -9999
  const status = computeStatus(member, nearDays)

  const base = { member, membershipPlan: plan, daysRemaining: remaining }

  if (status === 'INACTIVE') {
    return {
      ...base,
      decision: 'DENIED',
      granted: false,
      headline: 'ACCESO DENEGADO',
      reason: 'Este socio está dado de baja.',
    }
  }

  if (remaining >= 0) {
    return {
      ...base,
      decision: 'GRANTED',
      granted: true,
      headline: 'ACCESO AUTORIZADO',
      reason:
        status === 'NEAR_EXPIRATION'
          ? `Su membresía vence en ${remaining} ${remaining === 1 ? 'día' : 'días'}. Recuérdale renovar.`
          : `Membresía vigente · ${remaining} días restantes`,
    }
  }

  // Vencida, pero dentro de la tolerancia configurada.
  const overdue = Math.abs(remaining)
  if (graceDays > 0 && overdue <= graceDays) {
    return {
      ...base,
      decision: 'GRACE',
      granted: true,
      headline: 'ACCESO CON TOLERANCIA',
      reason: `Venció hace ${overdue} ${overdue === 1 ? 'día' : 'días'}. Quedan ${graceDays - overdue} de tolerancia.`,
    }
  }

  if (allowExpired) {
    return {
      ...base,
      decision: 'GRACE',
      granted: true,
      headline: 'ACCESO AUTORIZADO',
      reason: 'El gimnasio permite el acceso con membresía vencida.',
    }
  }

  // Última opción: ¿pagó visita hoy?
  if (settings?.access.visitGrantsAccess) {
    const today = dayKey()
    const visits = await repo.list('visits', {
      where: [
        { field: 'date', op: '==', value: today },
        { field: 'memberId', op: '==', value: member.id },
      ],
    })
    const paid = visits.find((v) => v.status === 'PAID')
    if (paid) {
      return {
        ...base,
        decision: 'VISIT',
        granted: true,
        visit: paid,
        headline: 'ACCESO POR VISITA',
        reason: 'Su membresía está vencida, pero pagó visita el día de hoy.',
      }
    }
  }

  return {
    ...base,
    decision: 'DENIED',
    granted: false,
    headline: 'ACCESO DENEGADO',
    reason:
      member.expiresAt === null
        ? 'Este socio no tiene una membresía contratada.'
        : `Su membresía venció hace ${overdue} ${overdue === 1 ? 'día' : 'días'}.`,
  }
}

/** Registra la asistencia. Se guarda incluso cuando se deniega el acceso. */
export async function recordAttendance(
  repo: TenantRepo,
  member: Member,
  method: CheckInMethod,
  granted: boolean,
): Promise<Attendance> {
  assertCurrentGymCanOperate()

  const now = Date.now()
  const record = await repo.create('attendance', {
    memberId: member.id,
    memberName: member.name,
    date: dayKey(now),
    time: timeKey(now),
    method,
    granted,
    branchId: member.branchId ?? null,
  })

  // Solo cuentan las entradas autorizadas: un intento denegado es un dato de
  // seguridad, no una asistencia.
  if (granted) {
    void bumpDaily(repo.gymId, record.date, { attendance: 1, hour: new Date(now).getHours() })
  }

  audit({
    gymId: repo.gymId,
    action: granted ? 'ATTENDANCE_RECORDED' : 'ACCESS_DENIED',
    entityType: 'attendance',
    entityId: record.id,
    summary: granted
      ? `Entrada de ${member.name} · ${CHECKIN_METHOD_LABEL[method]}`
      : `Acceso denegado a ${member.name} · ${CHECKIN_METHOD_LABEL[method]}`,
    after: { socio: member.name, método: CHECKIN_METHOD_LABEL[method], hora: record.time },
  })

  return record
}

/** ¿Ya registró entrada hoy? Evita duplicados por doble escaneo. */
export async function alreadyCheckedInToday(repo: TenantRepo, memberId: string): Promise<Attendance | null> {
  const rows = await repo.list('attendance', {
    where: [
      { field: 'memberId', op: '==', value: memberId },
      { field: 'date', op: '==', value: dayKey() },
    ],
  })
  return rows.find((r) => r.granted) ?? null
}

export const CHECKIN_METHOD_LABEL: Record<CheckInMethod, string> = {
  fingerprint: 'Huella',
  qr: 'QR',
  reception: 'Recepción',
  manual: 'Manual',
  card: 'Tarjeta',
}
