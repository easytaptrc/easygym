import type {
  GymSettings,
  Member,
  Membership,
  MembershipPlan,
  Millis,
  PaymentMethod,
} from '@/types'
import { addDays, dayKey, startOfDay } from '@/lib/date'
import { newId, norm } from '@/lib/utils'
import { computeStatus } from '@/lib/memberStatus'
import type { TenantRepo } from './db'
import { bumpCounters, bumpDaily, memberStatusMoved } from './aggregates'
import { registerPayment } from './billing'
import { audit, diffFields } from './audit'
import { assertCurrentGymCanOperate } from './gymStatus'

// ═══════════════════════════════════════════════════════════════════════════
// Socios: alta, contratación y renovación de membresías.
//
// La derivación del estado vive en `lib/memberStatus.ts` (función pura) y se
// re-exporta aquí para no romper a quien ya la importaba desde este módulo.
// ═══════════════════════════════════════════════════════════════════════════

export { computeStatus, daysLeft, STATUS_LABEL, STATUS_CLASS, STATUS_DOT } from '@/lib/memberStatus'

/**
 * Recalcula el estado guardado de los socios cuyo vencimiento ya pasó.
 *
 * ⚠️ NO se llama al abrir el panel, y es deliberado: recorrer todos los socios
 * para actualizar unos pocos convierte cada visita al dashboard en la consulta
 * más cara del producto. El estado que se MUESTRA se deriva en el momento con
 * `computeStatus(member)`, que es una función pura sobre `expiresAt`: la
 * pantalla siempre es correcta aunque el campo guardado esté desfasado.
 *
 * Esto es una tarea de mantenimiento, para que el campo `status` sirva como
 * filtro en las consultas.
 *
 * ▸ PRODUCCIÓN: lo hace `functions/src/expirationSweep.ts` una vez al día,
 *   sobre los socios cuya fecha ya venció. Aquí queda acotado por la misma
 *   condición y con tope, para que no pueda volverse una consulta ilimitada.
 */
export async function refreshMemberStatuses(
  repo: TenantRepo,
  settings: GymSettings | null,
  maxDocs = 500,
): Promise<number> {
  const near = settings?.nearExpirationDays ?? 7

  // Solo los que ya vencieron o están por vencer: los demás no pueden haber
  // cambiado de estado por el paso del tiempo.
  const horizon = addDays(startOfDay(), near)
  const candidates = await repo.list('members', {
    where: [{ field: 'expiresAt', op: '<=', value: horizon }],
    orderBy: { field: 'expiresAt', dir: 'asc' },
    limit: maxDocs,
  })

  let changed = 0
  for (const m of candidates) {
    const next = computeStatus(m, near)
    if (next !== m.status) {
      await repo.update('members', m.id, { status: next })
      changed++
    }
  }
  return changed
}

// ─────────────────────────────── Alta de socio ──────────────────────────────

export interface CreateMemberInput {
  name: string
  email: string
  phone: string
  birthDate?: string | null
  gender?: Member['gender']
  photoUrl?: string | null
  notes?: string
  emergencyContact?: Member['emergencyContact']
  /** Si se indica, se contrata la membresía y se registra el cobro. */
  membershipPlanId?: string | null
  paymentMethod?: PaymentMethod
  /** Permite registrar al socio sin cobrar (p. ej. cortesía). */
  skipPayment?: boolean
  collectedBy?: string | null
}

export async function createMember(
  repo: TenantRepo,
  input: CreateMemberInput,
): Promise<{ member: Member; membership?: Membership }> {
  assertCurrentGymCanOperate()

  const existing = await repo.list('members', { orderBy: { field: 'memberNumber', dir: 'desc' }, limit: 1 })
  const memberNumber = (existing[0]?.memberNumber ?? 0) + 1

  const member = await repo.create('members', {
    memberNumber,
    name: input.name.trim(),
    searchKey: norm(input.name),
    email: input.email.trim().toLowerCase(),
    phone: input.phone,
    birthDate: input.birthDate ?? null,
    gender: input.gender ?? null,
    photoUrl: input.photoUrl ?? null,
    emergencyContact: input.emergencyContact ?? null,
    membershipPlanId: null,
    membershipId: null,
    startsAt: null,
    expiresAt: null,
    status: 'EXPIRED',
    notes: input.notes ?? '',
    fingerprintId: null,
    branchId: null,
  })

  // Contadores: un socio más, de momento sin membresía (EXPIRED).
  void bumpCounters(repo.gymId, { membersTotal: 1, ...memberStatusMoved(null, 'EXPIRED') })
  void bumpDaily(repo.gymId, dayKey(member.createdAt), { newMembers: 1 })

  audit({
    gymId: repo.gymId,
    action: 'MEMBER_CREATED',
    entityType: 'members',
    entityId: member.id,
    summary: `Alta de ${member.name} (${memberTag(memberNumber)})`,
    after: { name: member.name, email: member.email, phone: member.phone },
  })

  if (!input.membershipPlanId) return { member }

  const plan = await repo.get('membershipPlans', input.membershipPlanId)
  if (!plan) return { member }

  const result = await contractMembership(repo, {
    member,
    plan,
    kind: 'NEW',
    method: input.paymentMethod ?? 'cash',
    skipPayment: input.skipPayment ?? false,
    collectedBy: input.collectedBy ?? null,
  })
  return { member: result.member, membership: result.membership }
}

// ─────────────────────── Contratación / renovación ──────────────────────────

export interface ContractInput {
  member: Member
  plan: MembershipPlan
  kind: 'NEW' | 'RENEWAL'
  method: PaymentMethod
  /** Importe realmente cobrado (permite descuentos). Por defecto, el del plan. */
  amount?: number
  skipPayment?: boolean
  collectedBy?: string | null
  transactionId?: string | null
}

/**
 * Contrata o renueva una membresía.
 *
 * Si el socio aún tiene días vigentes, la renovación se ENCADENA a partir de
 * su vencimiento actual, no de hoy: quien renueva antes no pierde días. Ese
 * detalle es la diferencia entre un software que se usa y uno que se abandona.
 */
export async function contractMembership(
  repo: TenantRepo,
  input: ContractInput,
): Promise<{ member: Member; membership: Membership }> {
  assertCurrentGymCanOperate()

  const { member, plan } = input
  const today = startOfDay()
  const currentExpiry = member.expiresAt ?? 0
  const startsAt: Millis = currentExpiry > today ? currentExpiry : today
  const expiresAt = addDays(startsAt, plan.days)
  const amount = input.amount ?? plan.price

  const membership = await repo.create('memberships', {
    memberId: member.id,
    membershipPlanId: plan.id,
    planName: plan.name,
    price: amount,
    startsAt,
    expiresAt,
    status: 'ACTIVE',
    paymentId: null,
    kind: input.kind,
  })

  let paymentId: string | null = null
  if (!input.skipPayment && amount > 0) {
    const payment = await registerPayment(repo, {
      memberId: member.id,
      memberName: member.name,
      concept: `${input.kind === 'RENEWAL' ? 'Renovación' : 'Membresía'} ${plan.name}`,
      category: input.kind === 'RENEWAL' ? 'RENEWAL' : 'MEMBERSHIP',
      amount,
      method: input.method,
      membershipId: membership.id,
      collectedBy: input.collectedBy ?? null,
      transactionId: input.transactionId ?? null,
    })
    paymentId = payment.id
    await repo.update('memberships', membership.id, { paymentId })
  }

  // Cierra los contratos anteriores del socio.
  const previous = await repo.list('memberships', {
    where: [
      { field: 'memberId', op: '==', value: member.id },
      { field: 'status', op: '==', value: 'ACTIVE' },
    ],
  })
  for (const old of previous) {
    if (old.id !== membership.id) await repo.update('memberships', old.id, { status: 'EXPIRED' })
  }

  const previousStatus = computeStatus(member)
  const patch = {
    membershipPlanId: plan.id,
    membershipId: membership.id,
    startsAt,
    expiresAt,
    status: computeStatus({ expiresAt, status: 'ACTIVE' }),
  }
  await repo.update('members', member.id, patch)

  // Agregados: el socio pasó de un cubo de estado a otro, y el día suma una
  // contratación o una renovación.
  void bumpCounters(repo.gymId, memberStatusMoved(previousStatus, patch.status))
  void bumpDaily(repo.gymId, dayKey(membership.createdAt), {
    [input.kind === 'RENEWAL' ? 'renewals' : 'newMemberships']: 1,
  })

  audit({
    gymId: repo.gymId,
    action: input.kind === 'RENEWAL' ? 'MEMBERSHIP_RENEWED' : 'MEMBERSHIP_CONTRACTED',
    entityType: 'memberships',
    entityId: membership.id,
    summary: `${input.kind === 'RENEWAL' ? 'Renovación' : 'Contratación'} de ${plan.name} · ${member.name}`,
    before: { expiresAt: member.expiresAt, status: member.status },
    after: { expiresAt, status: patch.status, precio: amount },
  })

  return {
    member: { ...member, ...patch },
    membership: { ...membership, paymentId },
  }
}

/**
 * Edita los datos personales de un socio.
 *
 * Existe para que toda edición pase por un sitio y quede en la bitácora. La
 * pregunta «¿quién le cambió la fecha de vencimiento a este socio?» solo se
 * puede contestar si TODAS las ediciones pasan por aquí.
 */
export async function updateMember(
  repo: TenantRepo,
  memberId: string,
  patch: Partial<Member>,
): Promise<Member | null> {
  assertCurrentGymCanOperate()

  const before = await repo.get('members', memberId)
  if (!before) return null

  // El nombre y su clave de búsqueda van siempre juntos: si se separan, el
  // buscador deja de encontrar al socio y nadie entiende por qué.
  const next = { ...patch }
  if (typeof patch.name === 'string') {
    next.name = patch.name.trim()
    next.searchKey = norm(patch.name)
  }

  await repo.update('members', memberId, next)

  const { before: b, after: a, changed } = diffFields(
    before as unknown as Record<string, unknown>,
    next as Record<string, unknown>,
    ['name', 'email', 'phone', 'birthDate', 'gender', 'notes', 'expiresAt', 'status', 'branchId'],
  )
  if (changed) {
    audit({
      gymId: repo.gymId,
      action: 'MEMBER_UPDATED',
      entityType: 'members',
      entityId: memberId,
      summary: `Edición de ${before.name}`,
      before: b,
      after: a,
    })
  }

  return { ...before, ...next }
}

/** Baja lógica. Nunca se borra un socio: se conserva su historial. */
export async function deactivateMember(repo: TenantRepo, memberId: string): Promise<void> {
  assertCurrentGymCanOperate()

  const member = await repo.get('members', memberId)
  if (!member) return
  await repo.update('members', memberId, { status: 'INACTIVE' })
  void bumpCounters(repo.gymId, memberStatusMoved(computeStatus(member), 'INACTIVE'))

  audit({
    gymId: repo.gymId,
    action: 'MEMBER_DEACTIVATED',
    entityType: 'members',
    entityId: memberId,
    summary: `Baja de ${member.name}`,
    before: { status: member.status },
    after: { status: 'INACTIVE' },
  })
}

export async function reactivateMember(repo: TenantRepo, memberId: string): Promise<void> {
  assertCurrentGymCanOperate()

  const member = await repo.get('members', memberId)
  if (!member) return
  const next = computeStatus({ ...member, status: 'ACTIVE' })
  await repo.update('members', memberId, { status: next })
  void bumpCounters(repo.gymId, memberStatusMoved('INACTIVE', next))

  audit({
    gymId: repo.gymId,
    action: 'MEMBER_REACTIVATED',
    entityType: 'members',
    entityId: memberId,
    summary: `Reactivación de ${member.name}`,
    before: { status: member.status },
    after: { status: next },
  })
}

/**
 * Búsqueda de socios por prefijo de nombre, resuelta en el SERVIDOR.
 *
 * Firestore no tiene búsqueda de texto, pero `searchKey >= q` y
 * `searchKey <= q + ''` acotan el rango a los nombres que empiezan por
 * `q`. Se leen solo esos documentos, no la colección.
 *
 * Límite conocido: solo encuentra por el PRINCIPIO del nombre. Buscar
 * "herrera" no devuelve a "María Herrera". Para eso hace falta un índice de
 * texto externo (Algolia / Typesense) — está documentado en el README.
 */
export async function searchMembersByName(
  repo: TenantRepo,
  term: string,
  limit = 20,
): Promise<Member[]> {
  const q = norm(term.trim())
  if (!q) return []
  return repo.list('members', {
    where: [
      { field: 'searchKey', op: '>=', value: q },
      { field: 'searchKey', op: '<=', value: `${q}` },
    ],
    orderBy: { field: 'searchKey', dir: 'asc' },
    limit,
  })
}

/**
 * Prefijo del código de credencial. Se compara contra `parts[0]` al escanear,
 * así que generador y lector TIENEN que leer la misma constante.
 */
export const QR_PREFIX = 'EASYGYM'

/** Genera el identificador de credencial QR de un socio. */
export function memberQrPayload(member: Member): string {
  return `${QR_PREFIX}:${member.gymId}:${member.id}`
}

export function parseQrPayload(raw: string): { gymId: string; memberId: string } | null {
  const parts = raw.trim().split(':')
  if (parts.length !== 3 || parts[0].toUpperCase() !== QR_PREFIX) return null
  return { gymId: parts[1], memberId: parts[2] }
}

/** Número de socio con formato: 42 → "#0042" */
export function memberTag(n: number): string {
  return `#${String(n).padStart(4, '0')}`
}

export function newMemberId(): string {
  return newId('mem')
}
