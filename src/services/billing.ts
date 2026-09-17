import type { GymSettings, Payment, PaymentMethod, RevenueCategory, Visit } from '@/types'
import { dayKey, timeKey } from '@/lib/date'
import { money } from '@/lib/format'
import type { TenantRepo } from './db'
import { bumpDaily } from './aggregates'
import { audit } from './audit'
import { assertCurrentGymCanOperate } from './gymStatus'
import { Stripe } from './stripe'

// ═══════════════════════════════════════════════════════════════════════════
// Pagos SOCIO → GIMNASIO.
//
// Nada que ver con la suscripción del dueño a EasyGym (services/stripe.ts).
// Todo pago lleva `category` para que el dashboard pueda separar las ventas
// en MEMBRESÍAS · RENOVACIONES · VISITAS · PRODUCTOS · OTROS.
// ═══════════════════════════════════════════════════════════════════════════

export interface RegisterPaymentInput {
  memberId?: string | null
  memberName?: string | null
  concept: string
  category: RevenueCategory
  amount: number
  method: PaymentMethod
  status?: Payment['status']
  membershipId?: string | null
  visitId?: string | null
  saleId?: string | null
  transactionId?: string | null
  collectedBy?: string | null
}

export async function registerPayment(repo: TenantRepo, input: RegisterPaymentInput): Promise<Payment> {
  assertCurrentGymCanOperate()

  const payment = await repo.create('payments', {
    memberId: input.memberId ?? null,
    memberName: input.memberName ?? null,
    concept: input.concept,
    category: input.category,
    amount: input.amount,
    method: input.method,
    status: input.status ?? 'PAID',
    transactionId: input.transactionId ?? null,
    collectedBy: input.collectedBy ?? null,
    membershipId: input.membershipId ?? null,
    visitId: input.visitId ?? null,
    saleId: input.saleId ?? null,
  })

  // Suma al resumen del día. Va DESPUÉS del cobro y sin `await` bloqueante en
  // la ruta crítica: si el agregado falla, el pago ya está registrado.
  if (payment.status === 'PAID') {
    void bumpDaily(repo.gymId, dayKey(payment.createdAt), {
      revenue: { [payment.category]: payment.amount },
      byMethod: { [payment.method]: payment.amount },
    })
  }

  // Todo movimiento de dinero queda registrado. Es lo que permite cuadrar la
  // caja al final del turno y saber quién cobró qué cuando algo no suma.
  audit({
    gymId: repo.gymId,
    action: 'PAYMENT_REGISTERED',
    entityType: 'payments',
    entityId: payment.id,
    summary: `Cobro de ${money(payment.amount)} · ${payment.concept}`,
    after: {
      importe: payment.amount,
      método: PAYMENT_METHOD_LABEL[payment.method],
      categoría: CATEGORY_LABEL[payment.category],
      socio: payment.memberName ?? '—',
    },
  })

  return payment
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  stripe: 'Stripe',
}

export const CATEGORY_LABEL: Record<RevenueCategory, string> = {
  MEMBERSHIP: 'Membresías',
  RENEWAL: 'Renovaciones',
  VISIT: 'Visitas',
  PRODUCT: 'Productos',
  OTHER: 'Otros',
}

/** Orden y color de las categorías en gráficas y reportes. */
export const CATEGORY_ORDER: RevenueCategory[] = ['MEMBERSHIP', 'RENEWAL', 'VISIT', 'PRODUCT', 'OTHER']

/**
 * Colores de serie para gráficas — NO son los colores de marca.
 *
 * El verde neón de la interfaz (#22E06B) es demasiado claro para usarse como
 * relleno de datos sobre fondo negro: satura y aplana las diferencias. Esta
 * escala está afinada para el fondo oscuro y verificada en banda de luminosidad,
 * croma, separación para daltonismo y contraste. El orden es fijo: una categoría
 * conserva su color aunque se filtren las demás.
 */
export const CATEGORY_COLOR: Record<RevenueCategory, string> = {
  MEMBERSHIP: '#17A45B',
  RENEWAL: '#2E93C8',
  VISIT: '#C08211',
  PRODUCT: '#C2568C',
  OTHER: '#8A57D6',
}

// ══════════════════════════════════ VISITAS ═════════════════════════════════
//
// UNA VISITA NO ES UNA MEMBRESÍA.
//
// Es un pase de un día. No exige ser socio, no crea membresía y no toca
// `expiresAt` de nadie. Un socio puede comprar una visita para un invitado:
// en ese caso `invitedByMemberId` apunta al socio y `memberId` queda en null
// porque el que entra no es él.
//
// Las visitas se contabilizan aparte en todos los reportes.
// ════════════════════════════════════════════════════════════════════════════

export interface RegisterVisitInput {
  name: string
  phone?: string | null
  amount: number
  method: PaymentMethod
  /** Socio que la compra para un invitado (opcional). */
  invitedByMemberId?: string | null
  invitedByMemberName?: string | null
  /** Socio que entra de paso, si el visitante resulta ser socio (opcional). */
  memberId?: string | null
  notes?: string
  registeredBy?: string | null
}

export async function registerVisit(
  repo: TenantRepo,
  input: RegisterVisitInput,
): Promise<{ visit: Visit; payment: Payment }> {
  assertCurrentGymCanOperate()

  const now = Date.now()
  const visit = await repo.create('visits', {
    memberId: input.memberId ?? null,
    name: input.name.trim(),
    phone: input.phone ?? null,
    date: dayKey(now),
    time: timeKey(now),
    amount: input.amount,
    method: input.method,
    status: 'PAID',
    invitedByMemberId: input.invitedByMemberId ?? null,
    invitedByMemberName: input.invitedByMemberName ?? null,
    notes: input.notes ?? '',
    registeredBy: input.registeredBy ?? null,
  })

  const payment = await registerPayment(repo, {
    memberId: input.memberId ?? input.invitedByMemberId ?? null,
    memberName: input.name,
    concept: `Visita — ${input.name}`,
    category: 'VISIT',
    amount: input.amount,
    method: input.method,
    visitId: visit.id,
    collectedBy: input.registeredBy ?? null,
  })

  // El importe ya lo contó `registerPayment` en la categoría VISIT; aquí solo
  // se suma la visita como evento, que es lo que separa "cuánto entró por
  // visitas" de "cuántas personas entraron de visita".
  void bumpDaily(repo.gymId, visit.date, { visits: 1 })

  audit({
    gymId: repo.gymId,
    action: 'VISIT_REGISTERED',
    entityType: 'visits',
    entityId: visit.id,
    summary: `Visita de ${visit.name} · ${money(visit.amount)}`,
    after: { nombre: visit.name, importe: visit.amount, método: PAYMENT_METHOD_LABEL[visit.method] },
  })

  return { visit, payment }
}

/** Precio sugerido: si un socio invita, aplica la tarifa de invitado. */
export function visitPrice(settings: GymSettings | null, invitedByMember: boolean): number {
  if (!settings) return invitedByMember ? 80 : 100
  return invitedByMember ? settings.visits.memberGuestPrice : settings.visits.defaultPrice
}

/** ¿Esta persona ya pagó visita hoy? Determina el acceso del día. */
export async function visitToday(repo: TenantRepo, name: string): Promise<Visit | null> {
  const today = dayKey()
  const visits = await repo.list('visits', { where: [{ field: 'date', op: '==', value: today }] })
  const match = visits.find((v) => v.name.toLowerCase() === name.trim().toLowerCase() && v.status === 'PAID')
  return match ?? null
}

// ────────────────────── Cobro con tarjeta (socio → gym) ─────────────────────

/**
 * Cobro con Stripe de un socio al gimnasio.
 *
 * ⚠️ En producción el frontend SOLO crea el PaymentIntent y muestra el
 * resultado. Quien escribe el pago como PAID en Firestore es el webhook
 * `payment_intent.succeeded` corriendo en una Cloud Function. Nunca se
 * confía en que el navegador diga "ya pagué".
 */
export async function chargeCard(
  repo: TenantRepo,
  input: RegisterPaymentInput & { customerId?: string },
): Promise<Payment> {
  const intent = await Stripe.createPayment({
    ...(input.customerId ? { customerId: input.customerId } : {}),
    amount: input.amount,
    description: input.concept,
  })
  return registerPayment(repo, {
    ...input,
    method: 'stripe',
    status: intent.status === 'succeeded' ? 'PAID' : 'PENDING',
    transactionId: intent.id,
  })
}

export async function refundPayment(repo: TenantRepo, paymentId: string): Promise<void> {
  assertCurrentGymCanOperate()

  const payment = await repo.get('payments', paymentId)
  await repo.update('payments', paymentId, { status: 'REFUNDED' })

  if (payment) {
    // Devolver no borra el cobro: lo marca. Un pago que desaparece del
    // historial es un descuadre de caja que nadie puede explicar después.
    void bumpDaily(repo.gymId, dayKey(payment.createdAt), {
      revenue: { [payment.category]: -payment.amount },
      byMethod: { [payment.method]: -payment.amount },
    })

    audit({
      gymId: repo.gymId,
      action: 'PAYMENT_REFUNDED',
      entityType: 'payments',
      entityId: paymentId,
      summary: `Devolución de ${money(payment.amount)} · ${payment.concept}`,
      before: { status: payment.status },
      after: { status: 'REFUNDED' },
    })
  }
}
