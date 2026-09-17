import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import Stripe from 'stripe'
import { db, stripePriceFor, type PlanId } from './lib/admin'
import { provisionTenant } from './provisionTenant'
import { guardRequest } from './rateLimit'

// ═══════════════════════════════════════════════════════════════════════════
// STRIPE A · SaaS:  el DUEÑO le paga a EasyGym
//
// Este archivo NO tiene nada que ver con los cobros que un socio le hace a su
// gimnasio. Esos viven en `stripeGym.ts` y usan Stripe Connect, con otra
// cuenta, otras claves y otro webhook.
//
// Mezclarlos es el error clásico: el dinero de las suscripciones de EasyGym
// entra a la cuenta de EasyGym; el de las membresías entra a la cuenta del
// gimnasio. Nunca pasan por el mismo sitio.
//
// Flujo
//   1. El navegador llama a `createSaasCheckout` (solo datos, sin claves)
//   2. Stripe cobra en su propia página alojada
//   3. Stripe llama a `saasWebhook` con la firma
//   4. La firma se verifica y ENTONCES se provisiona el tenant
//
// El navegador NUNCA confirma un pago. Si alguien falsea el retorno de
// Checkout, no pasa nada: el gimnasio lo crea el webhook, no el redirect.
// ═══════════════════════════════════════════════════════════════════════════

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET')

// Sin `apiVersion` explícita: se usa la que trae el SDK instalado, que es la
// que corresponde a sus tipos. Fijar una versión distinta compila mal y, peor,
// hace que los tipos mientan sobre la forma real de las respuestas.
function stripe(): Stripe {
  return new Stripe(STRIPE_SECRET_KEY.value())
}

// ───────────────────── 1 · Crear la sesión de Checkout ──────────────────────

export const createSaasCheckout = onRequest(
  { secrets: [STRIPE_SECRET_KEY], cors: true, region: 'us-central1' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed')
      return
    }
    // Se llama sin sesión (el gimnasio aún no existe), así que el límite es
    // por IP. Es un sujeto pobre, pero es el único que hay antes del alta.
    if (!(await guardRequest('createSaasCheckout', req, res))) return

    try {
      const { planId, email, gym, owner } = req.body as {
        planId: PlanId
        email: string
        gym: Record<string, string>
        owner: Record<string, string>
      }

      const session = await stripe().checkout.sessions.create({
        mode: 'subscription',
        customer_email: email,
        line_items: [{ price: stripePriceFor(planId), quantity: 1 }],
        success_url: `${req.headers.origin}/checkout?session={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin}/registro?plan=${planId}`,
        // Los datos del gimnasio viajan como metadata: el webhook los necesita
        // para provisionar, y así no hace falta guardarlos en ningún sitio
        // intermedio antes de que el pago exista.
        metadata: {
          planId,
          gymName: gym.name,
          address: gym.address,
          city: gym.city,
          state: gym.state,
          zip: gym.zip,
          gymPhone: gym.phone,
          ownerName: owner.name,
          ownerPhone: owner.phone,
        },
      })

      res.json({ url: session.url })
    } catch (err) {
      console.error('createSaasCheckout', err)
      res.status(500).json({ error: 'No se pudo iniciar el pago.' })
    }
  },
)

// ─────────────────────────── 2 · Webhook firmado ────────────────────────────

export const saasWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET], region: 'us-central1' },
  async (req, res) => {
    let event: Stripe.Event
    try {
      // `req.rawBody` es imprescindible: verificar la firma sobre el JSON ya
      // parseado falla siempre, porque el orden de las claves cambia.
      event = stripe().webhooks.constructEvent(
        req.rawBody,
        req.headers['stripe-signature'] as string,
        STRIPE_WEBHOOK_SECRET.value(),
      )
    } catch (err) {
      console.error('Firma de webhook inválida', err)
      res.status(400).send('Invalid signature')
      return
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object
          const m = session.metadata ?? {}
          const subscriptionId = String(session.subscription)
          const sub = await stripe().subscriptions.retrieve(subscriptionId)

          await provisionTenant({
            ownerName: m.ownerName ?? '',
            email: session.customer_email ?? '',
            phone: m.ownerPhone ?? '',
            gymName: m.gymName ?? '',
            address: m.address ?? '',
            city: m.city ?? '',
            state: m.state ?? '',
            zip: m.zip ?? '',
            gymPhone: m.gymPhone ?? '',
            planId: (m.planId as PlanId) ?? 'STARTER',
            stripeCustomerId: String(session.customer),
            stripeSubscriptionId: subscriptionId,
            currentPeriodStart: sub.current_period_start * 1000,
            currentPeriodEnd: sub.current_period_end * 1000,
          })
          break
        }

        case 'invoice.payment_succeeded':
          await setSubscriptionStatus(String((event.data.object as Stripe.Invoice).subscription), 'ACTIVE')
          break

        case 'invoice.payment_failed':
          // PAST_DUE, no SUSPENDED: el gimnasio sigue operando durante el
          // periodo de gracia. Dejar a un negocio sin cobrar por una tarjeta
          // rechazada hace más daño que esperar unos días.
          await setSubscriptionStatus(String((event.data.object as Stripe.Invoice).subscription), 'PAST_DUE')
          break

        case 'customer.subscription.deleted':
          await setSubscriptionStatus((event.data.object as Stripe.Subscription).id, 'CANCELED')
          break

        case 'customer.subscription.updated': {
          const sub = event.data.object as Stripe.Subscription
          await setSubscriptionStatus(sub.id, sub.status === 'active' ? 'ACTIVE' : 'PAST_DUE')
          break
        }
      }
      res.json({ received: true })
    } catch (err) {
      console.error('saasWebhook', event.type, err)
      // 500 hace que Stripe reintente: es lo correcto ante un fallo transitorio.
      res.status(500).send('Handler error')
    }
  },
)

/**
 * Propaga el estado a `subscriptions` y a `gyms`.
 *
 * NUNCA borra datos: un gimnasio cancelado conserva socios, pagos e historial
 * intactos y los recupera en cuanto vuelve a contratar.
 */
async function setSubscriptionStatus(stripeSubscriptionId: string, status: string) {
  const snap = await db
    .collection('subscriptions')
    .where('stripeSubscriptionId', '==', stripeSubscriptionId)
    .limit(1)
    .get()
  if (snap.empty) return

  const doc = snap.docs[0]
  const gymId = doc.data().gymId as string

  const batch = db.batch()
  batch.update(doc.ref, { status, updatedAt: Date.now() })
  batch.update(db.collection('gyms').doc(gymId), {
    subscriptionStatus: status,
    updatedAt: Date.now(),
  })
  await batch.commit()
}
