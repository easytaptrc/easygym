import type { AppUser, Gym, GymSettings, PlanId, Subscription } from '@/types'
import { BRAND, GYM_ACCENT_PRESETS } from '@/config/brand'
import { newId, slugify } from '@/lib/utils'
import { platform, repoFor } from './db'
import { auth } from './auth'
import { emptyCounters } from './aggregates'
import { applyPlanToGym, entitlementsFrom, getLivePlan } from './planCatalog'
import { recordAudit } from './audit'
import { syncPublicGym, syncPublicGymQuietly } from './publicGym'
import { Stripe, type CardInput, type StripeError } from './stripe'
import { defaultOnboarding, defaultSettings, STARTER_MEMBERSHIP_TEMPLATES } from './defaults'

// ═══════════════════════════════════════════════════════════════════════════
// Alta automática de un gimnasio.
//
// Este es el corazón del modelo SaaS: NO se crean gimnasios a mano.
// El dueño elige plan → crea su cuenta → registra su gimnasio → paga, y a
// partir de ahí todo se provisiona solo:
//
//    gymId → gimnasio → usuario OWNER → configuración → suscripción
//          → membresías base → espejo público → onboarding → dashboard
//
// ───────────────────────────────────────────────────────────────────────────
// ⚠️  ESTE ARCHIVO NO ESTÁ LISTO PARA PRODUCCIÓN TAL CUAL
//
// `provisionTenant()` crea el gimnasio, el usuario OWNER y la suscripción.
// Mientras corra en el navegador, cualquiera con la consola abierta puede
// invocarlo y fabricarse un gimnasio con plan Business sin pagar.
//
// Está escrito a propósito como una función PURA DE SERVIDOR:
//   · no toca React, ni el DOM, ni el contexto de sesión
//   · recibe todo lo que necesita por parámetro
//   · devuelve el resultado completo
//
// Moverla es copiarla a `functions/src/provisionTenant.ts` y cambiar
// `platform.*` por `admin.firestore()`. El cliente entonces solo llama a
// `callProvisionTenant()`, que hace un POST a la Cloud Function.
//
// El interruptor es `VITE_FUNCTIONS_URL`: si está definido, el alta la hace
// el servidor; si no, corre local en modo demostración.
// ───────────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/** ¿Hay un backend al que delegar el alta? */
export const FUNCTIONS_URL = import.meta.env.VITE_FUNCTIONS_URL ?? ''
export const hasServerProvisioning = FUNCTIONS_URL !== ''

export interface RegisterGymInput {
  // Dueño
  ownerName: string
  email: string
  phone: string
  password: string
  // Gimnasio
  gymName: string
  address: string
  city: string
  state: string
  zip: string
  gymPhone: string
  logoUrl?: string | null
  // Plan
  planId: PlanId
  card?: CardInput
}

export interface RegisterGymResult {
  gym: Gym
  owner: AppUser
  subscription: Subscription
  settings: GymSettings
}

export type ProvisionStep =
  | 'account'
  | 'stripe-customer'
  | 'stripe-subscription'
  | 'gym'
  | 'owner'
  | 'settings'
  | 'memberships'
  | 'done'

export const PROVISION_LABELS: Record<ProvisionStep, string> = {
  account: 'Validando tu cuenta',
  'stripe-customer': 'Creando tu cliente en Stripe',
  'stripe-subscription': 'Activando tu suscripción',
  gym: 'Creando tu gimnasio',
  owner: 'Configurando tu acceso de dueño',
  settings: 'Preparando tu configuración',
  memberships: 'Cargando membresías base',
  done: '¡Listo!',
}

/** Garantiza que el slug sea único en toda la plataforma. */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'gimnasio'
  const existing = await platform.list('gyms', { where: [{ field: 'slug', op: '==', value: base }] })
  if (existing.length === 0) return base
  for (let i = 2; i < 200; i++) {
    const candidate = `${base}-${i}`
    const taken = await platform.list('gyms', { where: [{ field: 'slug', op: '==', value: candidate }] })
    if (taken.length === 0) return candidate
  }
  return `${base}-${newId().slice(0, 6).toLowerCase()}`
}

/**
 * Datos que necesita el servidor para crear un tenant. Es el cuerpo exacto
 * del POST a la Cloud Function.
 */
export interface ProvisionTenantInput {
  ownerName: string
  email: string
  phone: string
  /** Solo en modo demo. En producción el usuario ya existe en Firebase Auth. */
  password: string
  gymName: string
  address: string
  city: string
  state: string
  zip: string
  gymPhone: string
  logoUrl?: string | null
  planId: PlanId
  /** Identificadores que devolvió Stripe al cobrar. */
  stripeCustomerId: string
  stripeSubscriptionId: string
  currentPeriodStart: number
  currentPeriodEnd: number
}

/**
 * ▓▓▓ CÓDIGO DE SERVIDOR ▓▓▓
 *
 * Crea el tenant completo. Sin React, sin DOM, sin sesión: todo entra por
 * parámetro y todo sale por el retorno, para que mover esto a una Cloud
 * Function sea copiar y pegar.
 *
 * En producción debe ejecutarse DENTRO de un `admin.firestore().runTransaction`
 * o un `batch()`, para que un fallo a mitad no deje un gimnasio sin dueño.
 * Aquí se hace secuencial porque el driver mock no expone batch.
 */
export async function provisionTenant(
  input: ProvisionTenantInput,
  onStep?: (step: ProvisionStep) => void,
): Promise<RegisterGymResult> {
  const step = (s: ProvisionStep) => onStep?.(s)
  // El plan se lee del catálogo VIVO, no de los valores del código: si el
  // SuperAdmin bajó el precio ayer, el gimnasio nuevo debe pagar ese precio.
  const plan = await getLivePlan(input.planId)
  const now = Date.now()

  step('gym')
  const gymId = `gym_${newId().slice(0, 12)}`
  const preset = GYM_ACCENT_PRESETS[0]

  const gym: Gym = {
    id: gymId,
    slug: await uniqueSlug(input.gymName),
    name: input.gymName.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.gymPhone,
    address: input.address,
    city: input.city,
    state: input.state,
    zip: input.zip,
    logoUrl: input.logoUrl ?? null,
    timezone: 'America/Mexico_City',
    currency: 'MXN',
    ownerId: '', // se completa al crear el OWNER
    planId: input.planId,
    subscriptionStatus: 'ACTIVE',
    subscriptionId: null,
    trialEndsAt: null,
    branding: {
      accent: preset.accent,
      accentSoft: preset.soft,
      accentDeep: preset.deep,
      logoUrl: input.logoUrl ?? null,
      displayName: input.gymName.trim(),
    },
    onboarding: defaultOnboarding(),
    // Funcionalidades y límites del plan, copiados al gimnasio. Es lo que
    // leen las reglas de Firestore para autorizar o rechazar escrituras.
    entitlements: entitlementsFrom(plan),
    stats: { members: 0, activeMembers: 0 },
    createdAt: now,
  }
  await platform.create('gyms', gym)

  step('owner')
  const owner = await auth.signUp({
    email: input.email,
    password: input.password,
    name: input.ownerName,
    phone: input.phone,
    role: 'OWNER',
    gymId,
  })
  await platform.update('gyms', gymId, { ownerId: owner.uid })
  gym.ownerId = owner.uid

  // Suscripción del dueño con EasyGym (NO son los pagos de los socios).
  const subscription: Subscription = {
    id: `sub_${newId().slice(0, 12)}`,
    gymId,
    ownerId: owner.uid,
    planId: input.planId,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    status: 'ACTIVE',
    currentPeriodStart: input.currentPeriodStart,
    currentPeriodEnd: input.currentPeriodEnd,
    cancelAtPeriodEnd: false,
    amount: plan.price ?? 0,
    currency: 'MXN',
    createdAt: now,
    invoices: [{ id: `in_${newId().slice(0, 10)}`, amount: plan.price ?? 0, paidAt: now, status: 'PAID' }],
  }
  await platform.create('subscriptions', subscription)
  await platform.update('gyms', gymId, { subscriptionId: subscription.id })
  gym.subscriptionId = subscription.id

  step('settings')
  const settings = defaultSettings(gymId)
  await platform.create('settings', settings)

  step('memberships')
  const repo = repoFor(gymId)
  for (const t of STARTER_MEMBERSHIP_TEMPLATES) {
    await repo.create('membershipPlans', {
      name: t.name,
      price: t.price,
      duration: t.duration,
      days: t.days,
      benefits: t.benefits,
      active: true,
      allowsReservations: t.duration !== 'DAILY',
      allowedClassIds: [],
    })
  }

  // Espejo público: lo que verá cualquiera en /g/:slug, sin sesión.
  await syncPublicGym(gymId)

  // Contadores iniciales en cero, para que el panel no tenga que contar nada.
  await platform.create('counters', emptyCounters(gymId))

  await logActivity({
    gymId,
    actorId: owner.uid,
    actorName: owner.name,
    action: 'GYM_CREATED',
    detail: `${gym.name} contrató el plan ${plan.name}`,
  })

  step('done')
  return { gym, owner, subscription, settings }
}

/** Llama a la Cloud Function que provisiona el tenant del lado servidor. */
async function callProvisionTenant(input: ProvisionTenantInput): Promise<RegisterGymResult> {
  const res = await fetch(`${FUNCTIONS_URL}/provisionTenant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`No se pudo crear el gimnasio (${res.status}). ${detail}`)
  }
  return (await res.json()) as RegisterGymResult
}

/**
 * Alta completa desde el checkout: valida, cobra y provisiona.
 *
 * El cobro SIEMPRE ocurre antes que la provisión: así no quedan gimnasios
 * fantasma de gente que abandonó el formulario o cuya tarjeta fue rechazada.
 */
export async function registerGym(
  input: RegisterGymInput,
  onStep?: (step: ProvisionStep) => void,
): Promise<RegisterGymResult> {
  const step = (s: ProvisionStep) => onStep?.(s)

  step('account')
  const emailTaken = await platform.list('users', {
    where: [{ field: 'email', op: '==', value: input.email.trim().toLowerCase() }],
  })
  if (emailTaken.length > 0) {
    throw new Error('Ese correo ya tiene una cuenta en ' + BRAND.name + '. Inicia sesión.')
  }

  // ── Stripe A · el DUEÑO le paga a EasyGym ────────────────────────────────
  step('stripe-customer')
  const customer = await Stripe.createCustomer({ email: input.email, name: input.ownerName })

  step('stripe-subscription')
  const stripeSub = await Stripe.createSubscription({
    customerId: customer.id,
    planId: input.planId,
    ...(input.card ? { card: input.card } : {}),
  })

  const tenantInput: ProvisionTenantInput = {
    ownerName: input.ownerName,
    email: input.email,
    phone: input.phone,
    password: input.password,
    gymName: input.gymName,
    address: input.address,
    city: input.city,
    state: input.state,
    zip: input.zip,
    gymPhone: input.gymPhone,
    logoUrl: input.logoUrl ?? null,
    planId: input.planId,
    stripeCustomerId: customer.id,
    stripeSubscriptionId: stripeSub.id,
    currentPeriodStart: stripeSub.currentPeriodStart,
    currentPeriodEnd: stripeSub.currentPeriodEnd,
  }

  // Con backend: provisiona el servidor. Sin él (demo): corre aquí mismo.
  return hasServerProvisioning
    ? callProvisionTenant(tenantInput)
    : provisionTenant(tenantInput, onStep)
}

/** Cambia de plan. En producción: Stripe `subscriptions.update` + prorrateo. */
export async function changePlan(gymId: string, planId: PlanId, actor?: AppUser): Promise<void> {
  const gym = await platform.get('gyms', gymId)
  if (!gym) throw new Error('Gimnasio no encontrado')
  const plan = await getLivePlan(planId)
  const previousPlan = gym.planId

  if (gym.subscriptionId) {
    const sub = await platform.get('subscriptions', gym.subscriptionId)
    if (sub) {
      const updated = await Stripe.updateSubscription(sub.stripeSubscriptionId, planId)
      await platform.update('subscriptions', sub.id, {
        planId,
        amount: plan.price ?? 0,
        currentPeriodStart: updated.currentPeriodStart,
        currentPeriodEnd: updated.currentPeriodEnd,
        status: 'ACTIVE',
        updatedAt: Date.now(),
      })
    }
  }

  await platform.update('gyms', gymId, {
    planId,
    subscriptionStatus: 'ACTIVE',
    updatedAt: Date.now(),
  })

  // Las funcionalidades y los límites del plan nuevo se copian al gimnasio.
  // Sin esto, el gimnasio cambiaría de plan pero seguiría con los permisos
  // del anterior, tanto en la interfaz como en las reglas de Firestore.
  await applyPlanToGym({ id: gymId }, planId)
  syncPublicGymQuietly(gymId)

  await recordAudit({
    gymId,
    actor: actor ?? null,
    action: 'GYM_PLAN_CHANGED',
    entityType: 'gyms',
    entityId: gymId,
    summary: `${gym.name}: ${previousPlan} → ${plan.name}`,
    before: { planId: previousPlan },
    after: { planId },
  })

  await logActivity({
    gymId,
    actorId: actor?.uid ?? null,
    actorName: actor?.name ?? 'Sistema',
    action: 'PLAN_CHANGED',
    detail: `${gym.name} ahora está en ${plan.name}`,
  })
}

/**
 * Suspende un gimnasio moroso.
 *
 * POLÍTICA: se restringe el acceso, NO se borran los datos. Un gimnasio que
 * vuelve a pagar recupera todo tal cual lo dejó.
 */
export async function setGymStatus(
  gymId: string,
  status: Gym['subscriptionStatus'],
  actor?: AppUser,
): Promise<void> {
  const gym = await platform.get('gyms', gymId)
  if (!gym) throw new Error('Gimnasio no encontrado')
  const previous = gym.subscriptionStatus

  await platform.update('gyms', gymId, { subscriptionStatus: status, updatedAt: Date.now() })
  if (gym.subscriptionId) {
    await platform.update('subscriptions', gym.subscriptionId, { status, updatedAt: Date.now() })
  }
  // Un gimnasio suspendido desaparece de /g/:slug, pero conserva sus datos.
  syncPublicGymQuietly(gymId)

  await recordAudit({
    gymId,
    actor: actor ?? null,
    action: 'GYM_STATUS_CHANGED',
    entityType: 'gyms',
    entityId: gymId,
    summary: `${gym.name}: ${previous} → ${status}`,
    before: { subscriptionStatus: previous },
    after: { subscriptionStatus: status },
  })

  await logActivity({
    gymId,
    actorId: actor?.uid ?? null,
    actorName: actor?.name ?? 'SuperAdmin',
    action: 'GYM_STATUS_CHANGED',
    detail: `${gym.name} → ${status}`,
  })
}

export async function logActivity(entry: {
  gymId: string | null
  actorId: string | null
  actorName: string
  action: string
  detail: string
}): Promise<void> {
  await platform.create('activity', {
    id: newId('act'),
    ...entry,
    createdAt: Date.now(),
  })
}

export type { StripeError }
