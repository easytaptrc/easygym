import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import Stripe from 'stripe'
import { db } from './lib/admin'
import { guardRequest } from './rateLimit'

// ═══════════════════════════════════════════════════════════════════════════
// STRIPE B · Connect:  el SOCIO le paga a SU gimnasio
//
// COMPLETAMENTE SEPARADO de `stripeSaas.ts`.
//
//   Stripe A (SaaS)     dinero → cuenta de EasyGym      suscripciones mensuales
//   Stripe B (Connect)  dinero → cuenta del gimnasio    membresías y renovaciones
//
// EasyGym nunca toca el dinero de los socios: cada gimnasio conecta su propia
// cuenta de Stripe y los cobros van directos ahí. EasyGym solo orquesta.
// Esto no es un detalle técnico: es lo que evita ser un intermediario
// financiero y tener que responder por el dinero de terceros.
//
// Cada gimnasio guarda su `stripeAccountId` en `gyms/{gymId}.stripeAccountId`
// tras completar el onboarding de Connect.
// ═══════════════════════════════════════════════════════════════════════════

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
const STRIPE_CONNECT_WEBHOOK_SECRET = defineSecret('STRIPE_CONNECT_WEBHOOK_SECRET')

// Ver la nota en stripeSaas.ts sobre `apiVersion`.
function stripe(): Stripe {
  return new Stripe(STRIPE_SECRET_KEY.value())
}

// ──────────────── 1 · Onboarding: conectar la cuenta del gym ────────────────

export const createConnectAccountLink = onRequest(
  { secrets: [STRIPE_SECRET_KEY], cors: true, region: 'us-central1' },
  async (req, res) => {
    if (!(await guardRequest('createConnectAccountLink', req, res))) return

    const { gymId } = req.body as { gymId: string }
    const gymRef = db.collection('gyms').doc(gymId)
    const gym = await gymRef.get()
    if (!gym.exists) {
      res.status(404).json({ error: 'Gimnasio no encontrado' })
      return
    }

    let accountId = gym.data()?.stripeAccountId as string | undefined
    if (!accountId) {
      const account = await stripe().accounts.create({
        type: 'express',
        country: 'MX',
        email: gym.data()?.email,
        business_type: 'company',
        metadata: { gymId },
      })
      accountId = account.id
      await gymRef.update({ stripeAccountId: accountId })
    }

    const link = await stripe().accountLinks.create({
      account: accountId,
      refresh_url: `${req.headers.origin}/configuracion`,
      return_url: `${req.headers.origin}/configuracion?stripe=ok`,
      type: 'account_onboarding',
    })

    res.json({ url: link.url })
  },
)

// ────────────── 2 · Cobro de una renovación al socio del gym ────────────────

export const createMemberPaymentIntent = onRequest(
  { secrets: [STRIPE_SECRET_KEY], cors: true, region: 'us-central1' },
  async (req, res) => {
    // Cada intento crea un PaymentIntent en Stripe. Sin tope, un bucle desde
    // una consola llena la cuenta del gimnasio de intentos abandonados.
    if (!(await guardRequest('createMemberPaymentIntent', req, res))) return

    const { gymId, memberId, membershipPlanId } = req.body as {
      gymId: string
      memberId: string
      membershipPlanId: string
    }

    const [gym, plan] = await Promise.all([
      db.collection('gyms').doc(gymId).get(),
      db.collection('membershipPlans').doc(membershipPlanId).get(),
    ])

    // El importe lo decide el SERVIDOR leyendo el plan. Jamás se acepta un
    // precio enviado por el cliente: sería regalar membresías a quien sepa
    // editar una petición.
    if (!gym.exists || !plan.exists || plan.data()?.gymId !== gymId) {
      res.status(400).json({ error: 'Datos inválidos' })
      return
    }

    const accountId = gym.data()?.stripeAccountId as string | undefined
    if (!accountId) {
      res.status(409).json({ error: 'Este gimnasio todavía no conectó su cuenta de Stripe.' })
      return
    }

    const amount = Math.round(Number(plan.data()?.price ?? 0) * 100)

    const intent = await stripe().paymentIntents.create(
      {
        amount,
        currency: 'mxn',
        metadata: { gymId, memberId, membershipPlanId },
        // Comisión de EasyGym sobre el cobro, si el modelo de negocio la usa.
        // application_fee_amount: Math.round(amount * 0.01),
      },
      { stripeAccount: accountId },
    )

    res.json({ clientSecret: intent.client_secret })
  },
)

// ──────────────────── 3 · Webhook de las cuentas conectadas ─────────────────

export const connectWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_CONNECT_WEBHOOK_SECRET], region: 'us-central1' },
  async (req, res) => {
    let event: Stripe.Event
    try {
      event = stripe().webhooks.constructEvent(
        req.rawBody,
        req.headers['stripe-signature'] as string,
        STRIPE_CONNECT_WEBHOOK_SECRET.value(),
      )
    } catch (err) {
      console.error('Firma de webhook Connect inválida', err)
      res.status(400).send('Invalid signature')
      return
    }

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent
      const { gymId, memberId, membershipPlanId } = intent.metadata ?? {}
      if (gymId && memberId && membershipPlanId) {
        await extendMembership(gymId, memberId, membershipPlanId, intent.id, intent.amount / 100)
      }
    }

    res.json({ received: true })
  },
)

/**
 * Extiende la membresía del socio. ESTE es el único sitio donde una renovación
 * se da por buena: el frontend solo muestra el resultado.
 *
 * Los días nuevos se ENCADENAN desde el vencimiento actual si todavía está
 * vigente: quien renueva antes no pierde los días que le quedaban.
 */
async function extendMembership(
  gymId: string,
  memberId: string,
  membershipPlanId: string,
  transactionId: string,
  amount: number,
) {
  const [memberSnap, planSnap] = await Promise.all([
    db.collection('members').doc(memberId).get(),
    db.collection('membershipPlans').doc(membershipPlanId).get(),
  ])
  if (!memberSnap.exists || !planSnap.exists) return

  const member = memberSnap.data()!
  const plan = planSnap.data()!
  if (member.gymId !== gymId || plan.gymId !== gymId) return

  const now = Date.now()
  const today = new Date(now).setHours(0, 0, 0, 0)
  const startsAt = member.expiresAt && member.expiresAt > today ? member.expiresAt : today
  const expiresAt = startsAt + Number(plan.days) * 86_400_000

  const batch = db.batch()
  const membershipRef = db.collection('memberships').doc()
  const paymentRef = db.collection('payments').doc()

  batch.set(membershipRef, {
    id: membershipRef.id,
    gymId,
    memberId,
    membershipPlanId,
    planName: plan.name,
    price: amount,
    startsAt,
    expiresAt,
    status: 'ACTIVE',
    paymentId: paymentRef.id,
    kind: member.expiresAt ? 'RENEWAL' : 'NEW',
    createdAt: now,
  })

  batch.set(paymentRef, {
    id: paymentRef.id,
    gymId,
    memberId,
    memberName: member.name,
    concept: `${member.expiresAt ? 'Renovación' : 'Membresía'} ${plan.name}`,
    category: member.expiresAt ? 'RENEWAL' : 'MEMBERSHIP',
    amount,
    method: 'stripe',
    status: 'PAID',
    transactionId,
    collectedBy: null,
    membershipId: membershipRef.id,
    visitId: null,
    saleId: null,
    createdAt: now,
  })

  batch.update(memberSnap.ref, {
    membershipPlanId,
    membershipId: membershipRef.id,
    startsAt,
    expiresAt,
    status: 'ACTIVE',
    updatedAt: now,
  })

  await batch.commit()
}
