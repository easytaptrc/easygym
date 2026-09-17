import type { Millis, PlanId, Subscription, SubscriptionStatus } from '@/types'
import { getPlan } from '@/config/plans'
import { newId, sleep } from '@/lib/utils'
import { platform } from './db'

// ═══════════════════════════════════════════════════════════════════════════
// Stripe — HAY DOS SISTEMAS DE PAGO SEPARADOS. No se mezclan nunca.
//
//   1) DUEÑO → EasyGym        Suscripción SaaS mensual (este archivo).
//                             Vive en `subscriptions` + `gyms.subscriptionStatus`.
//
//   2) SOCIO → GIMNASIO       Membresías, renovaciones, visitas, productos.
//                             Vive en `payments`, con gymId. Ver services/billing.ts
//
// Este módulo es un MOCK: simula la API de Stripe con las mismas firmas para
// que sustituirlo por llamadas reales sea cambiar el cuerpo de 4 funciones.
//
// ⛔ La clave secreta (sk_…) NUNCA entra al frontend. En producción cada
//    función de aquí hace `fetch` a una Cloud Function que sí la tiene.
// ═══════════════════════════════════════════════════════════════════════════

export interface StripeCustomer {
  id: string
  email: string
  name: string
  createdAt: Millis
}

export interface StripeSubscription {
  id: string
  customerId: string
  priceId: string
  status: SubscriptionStatus
  currentPeriodStart: Millis
  currentPeriodEnd: Millis
  cancelAtPeriodEnd: boolean
}

export interface StripePaymentIntent {
  id: string
  amount: number
  currency: 'mxn'
  status: 'succeeded' | 'requires_payment_method' | 'processing'
  receiptUrl: string
}

export interface CardInput {
  number: string
  exp: string
  cvc: string
  name: string
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly code: 'card_declined' | 'invalid_number' | 'expired_card' | 'processing_error',
  ) {
    super(message)
  }
}

const MONTH_MS = 30 * 86_400_000

/**
 * Tarjetas de prueba. Mantienen el contrato de las tarjetas reales de Stripe
 * para que el flujo de error se pueda demostrar sin tocar nada.
 */
export const TEST_CARDS: Record<'success' | 'declined' | 'expired', string> = {
  success: '4242 4242 4242 4242',
  declined: '4000 0000 0000 0002',
  expired: '4000 0000 0000 0069',
}

function validateCard(card: CardInput): void {
  const digits = card.number.replace(/\s/g, '')
  if (digits.length < 15) throw new StripeError('El número de tarjeta no es válido.', 'invalid_number')
  if (digits === '4000000000000002') throw new StripeError('Tu banco rechazó la tarjeta.', 'card_declined')
  if (digits === '4000000000000069') throw new StripeError('La tarjeta está vencida.', 'expired_card')
}

// ────────────────────────────── MockStripeService ───────────────────────────

export const MockStripeService = {
  isMock: true as const,

  async createCustomer(input: { email: string; name: string }): Promise<StripeCustomer> {
    await sleep(320)
    return { id: `cus_${newId().slice(0, 14)}`, email: input.email, name: input.name, createdAt: Date.now() }
  },

  async createSubscription(input: {
    customerId: string
    planId: PlanId
    card?: CardInput
  }): Promise<StripeSubscription> {
    await sleep(520)
    if (input.card) validateCard(input.card)
    const now = Date.now()
    return {
      id: `sub_${newId().slice(0, 14)}`,
      customerId: input.customerId,
      priceId: getPlan(input.planId).stripePriceId ?? `price_${input.planId.toLowerCase()}_mxn_monthly`,
      status: 'ACTIVE',
      currentPeriodStart: now,
      currentPeriodEnd: now + MONTH_MS,
      cancelAtPeriodEnd: false,
    }
  },

  /** Cobro único: renovación de un socio, una visita, una venta del POS. */
  async createPayment(input: {
    customerId?: string
    amount: number
    description: string
    card?: CardInput
  }): Promise<StripePaymentIntent> {
    await sleep(460)
    if (input.card) validateCard(input.card)
    const id = `pi_${newId().slice(0, 14)}`
    return {
      id,
      amount: input.amount,
      currency: 'mxn',
      status: 'succeeded',
      receiptUrl: `https://pay.stripe.com/receipts/${id}`,
    }
  },

  async cancelSubscription(subscriptionId: string, atPeriodEnd = true): Promise<StripeSubscription> {
    await sleep(320)
    const now = Date.now()
    return {
      id: subscriptionId,
      customerId: '',
      priceId: '',
      status: atPeriodEnd ? 'ACTIVE' : 'CANCELED',
      currentPeriodStart: now - MONTH_MS,
      currentPeriodEnd: now + (atPeriodEnd ? MONTH_MS : 0),
      cancelAtPeriodEnd: atPeriodEnd,
    }
  },

  async updateSubscription(subscriptionId: string, planId: PlanId): Promise<StripeSubscription> {
    await sleep(380)
    const now = Date.now()
    return {
      id: subscriptionId,
      customerId: '',
      priceId: getPlan(planId).stripePriceId ?? `price_${planId.toLowerCase()}_mxn_monthly`,
      status: 'ACTIVE',
      currentPeriodStart: now,
      currentPeriodEnd: now + MONTH_MS,
      cancelAtPeriodEnd: false,
    }
  },
}

// ───────────────────── Simulación del webhook de Stripe ─────────────────────
//
// En producción esto ocurre en el SERVIDOR: Stripe llama a una Cloud Function,
// la función verifica la firma con STRIPE_WEBHOOK_SECRET y escribe Firestore
// con el Admin SDK. El frontend jamás confirma un pago por su cuenta.
//
// Aquí replicamos ese efecto para que el prototipo tenga el mismo flujo.

export type StripeEventType =
  | 'customer.subscription.created'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'invoice.payment_succeeded'
  | 'invoice.payment_failed'

export const stripeWebhook = {
  /** Aplica el efecto de un evento sobre `subscriptions` y `gyms`. */
  async handle(event: {
    type: StripeEventType
    gymId: string
    subscriptionId: string
    data?: Partial<Subscription>
  }): Promise<void> {
    const sub = await platform.get('subscriptions', event.subscriptionId)
    if (!sub) return

    const patch: Partial<Subscription> = { ...event.data, updatedAt: Date.now() }
    let gymStatus: SubscriptionStatus | null = null

    switch (event.type) {
      case 'invoice.payment_succeeded': {
        const start = Date.now()
        patch.status = 'ACTIVE'
        patch.currentPeriodStart = start
        patch.currentPeriodEnd = start + MONTH_MS
        patch.invoices = [
          ...(sub.invoices ?? []),
          { id: `in_${newId().slice(0, 12)}`, amount: sub.amount, paidAt: start, status: 'PAID' },
        ]
        gymStatus = 'ACTIVE'
        break
      }
      case 'invoice.payment_failed':
        patch.status = 'PAST_DUE'
        patch.invoices = [
          ...(sub.invoices ?? []),
          { id: `in_${newId().slice(0, 12)}`, amount: sub.amount, paidAt: Date.now(), status: 'FAILED' },
        ]
        gymStatus = 'PAST_DUE'
        break
      case 'customer.subscription.deleted':
        patch.status = 'CANCELED'
        gymStatus = 'CANCELED'
        break
      case 'customer.subscription.updated':
        if (event.data?.status) gymStatus = event.data.status
        break
      case 'customer.subscription.created':
        patch.status = 'ACTIVE'
        gymStatus = 'ACTIVE'
        break
    }

    await platform.update('subscriptions', event.subscriptionId, patch as Record<string, unknown>)
    if (gymStatus) {
      await platform.update('gyms', event.gymId, { subscriptionStatus: gymStatus, updatedAt: Date.now() })
    }
  },
}

/**
 * Punto de sustitución por Stripe real.
 *
 * ```ts
 * export const Stripe = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
 *   ? RealStripeService   // llama a Cloud Functions
 *   : MockStripeService
 * ```
 */
export const Stripe = MockStripeService
