import { db, auth, type PlanId } from './lib/admin'

// ═══════════════════════════════════════════════════════════════════════════
// Provisión de un tenant.
//
// Es el gemelo de `src/services/provisioning.ts → provisionTenant()`, que en
// el prototipo corre en el navegador. Aquí corre en el servidor, que es donde
// tiene que estar: crear un gimnasio con plan Business no puede ser algo que
// cualquiera dispare desde la consola del navegador.
//
// NO se expone como endpoint HTTP público. Solo lo invoca el webhook de Stripe
// tras `checkout.session.completed`, con la firma ya verificada. El cliente
// nunca lo llama directamente.
// ═══════════════════════════════════════════════════════════════════════════

export interface ProvisionTenantInput {
  ownerName: string
  email: string
  phone: string
  gymName: string
  address: string
  city: string
  state: string
  zip: string
  gymPhone: string
  logoUrl?: string | null
  planId: PlanId
  stripeCustomerId: string
  stripeSubscriptionId: string
  currentPeriodStart: number
  currentPeriodEnd: number
}

const STARTER_MEMBERSHIPS = [
  { name: 'Visita', price: 100, duration: 'DAILY', days: 1, benefits: ['Acceso por un día'] },
  { name: 'Mensual', price: 500, duration: 'MONTHLY', days: 30, benefits: ['Acceso ilimitado'] },
  { name: 'Trimestral', price: 1350, duration: 'QUARTERLY', days: 90, benefits: ['Acceso ilimitado'] },
  { name: 'Semestral', price: 2400, duration: 'BIANNUAL', days: 180, benefits: ['Acceso ilimitado'] },
  { name: 'Anual', price: 4200, duration: 'ANNUAL', days: 365, benefits: ['Acceso ilimitado'] },
]

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** Slug único en toda la plataforma. */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'gimnasio'
  for (let i = 1; i < 200; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`
    const taken = await db.collection('gyms').where('slug', '==', candidate).limit(1).get()
    if (taken.empty) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

/**
 * Crea gimnasio + OWNER + configuración + suscripción + membresías base.
 *
 * Todo lo que toca Firestore va en un único `batch()`: o queda el tenant
 * completo, o no queda nada. Un gimnasio a medio crear —sin dueño, o sin
 * configuración— es peor que un error limpio.
 */
export async function provisionTenant(input: ProvisionTenantInput) {
  const now = Date.now()
  const gymId = db.collection('gyms').doc().id

  // 1. Usuario de Auth. Va FUERA del batch porque Auth no es Firestore.
  //    Si el batch falla después, este usuario queda huérfano: la función de
  //    limpieza `reapOrphanAuthUsers` (programada) lo recoge.
  let uid: string
  try {
    const existing = await auth.getUserByEmail(input.email)
    uid = existing.uid
  } catch {
    const created = await auth.createUser({
      email: input.email,
      displayName: input.ownerName,
      emailVerified: false,
    })
    uid = created.uid
  }

  // 2. Custom claims: son la fuente autoritativa de rol y tenant para las
  //    reglas de Firestore. Se ponen ANTES de que el usuario entre.
  await auth.setCustomUserClaims(uid, { role: 'OWNER', gymId })

  // 3. Todo Firestore, atómico.
  const batch = db.batch()
  const slug = await uniqueSlug(input.gymName)

  const gym = {
    id: gymId,
    slug,
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
    ownerId: uid,
    planId: input.planId,
    subscriptionStatus: 'ACTIVE',
    subscriptionId: null as string | null,
    trialEndsAt: null,
    branding: {
      accent: '34 224 107',
      accentSoft: '143 255 193',
      accentDeep: '11 166 72',
      logoUrl: input.logoUrl ?? null,
      displayName: input.gymName.trim(),
    },
    onboarding: {
      dismissed: false,
      steps: {
        gymInfo: false,
        firstMembership: false,
        firstMember: false,
        classes: false,
        spinning: false,
        staff: false,
        payments: false,
      },
    },
    createdAt: now,
  }

  const subId = db.collection('subscriptions').doc().id
  gym.subscriptionId = subId

  batch.set(db.collection('gyms').doc(gymId), gym)

  batch.set(db.collection('users').doc(uid), {
    uid,
    email: input.email.trim().toLowerCase(),
    name: input.ownerName,
    phone: input.phone,
    role: 'OWNER',
    gymId,
    memberId: null,
    avatarUrl: null,
    active: true,
    lastLoginAt: null,
    createdAt: now,
  })

  batch.set(db.collection('subscriptions').doc(subId), {
    id: subId,
    gymId,
    ownerId: uid,
    planId: input.planId,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    status: 'ACTIVE',
    currentPeriodStart: input.currentPeriodStart,
    currentPeriodEnd: input.currentPeriodEnd,
    cancelAtPeriodEnd: false,
    amount: 0,
    currency: 'MXN',
    createdAt: now,
    invoices: [],
  })

  batch.set(db.collection('settings').doc(gymId), defaultSettings(gymId))

  batch.set(db.collection('counters').doc(gymId), {
    id: gymId,
    gymId,
    members: { total: 0, active: 0, nearExpiration: 0, expired: 0, inactive: 0 },
    staff: 1,
    classes: 0,
    products: 0,
    branches: 0,
    rebuiltAt: now,
    updatedAt: now,
  })

  for (const t of STARTER_MEMBERSHIPS) {
    const ref = db.collection('membershipPlans').doc()
    batch.set(ref, {
      id: ref.id,
      gymId,
      name: t.name,
      price: t.price,
      duration: t.duration,
      days: t.days,
      benefits: t.benefits,
      active: true,
      allowsReservations: t.duration !== 'DAILY',
      allowedClassIds: [],
      createdAt: now,
    })
  }

  batch.set(db.collection('activity').doc(), {
    gymId,
    actorId: uid,
    actorName: input.ownerName,
    action: 'GYM_CREATED',
    detail: `${gym.name} contrató el plan ${input.planId}`,
    createdAt: now,
  })

  await batch.commit()

  return { gymId, ownerId: uid, slug, subscriptionId: subId }
}

function defaultSettings(gymId: string) {
  const weekday = { open: '06:00', close: '22:00', closed: false }
  return {
    id: gymId,
    gymId,
    hours: {
      1: weekday,
      2: weekday,
      3: weekday,
      4: weekday,
      5: weekday,
      6: { open: '08:00', close: '16:00', closed: false },
      0: { open: '09:00', close: '14:00', closed: true },
    },
    nearExpirationDays: 7,
    cancellationWindowMin: 120,
    reservationOpensHoursBefore: 72,
    maxActiveReservationsPerMember: 6,
    spinning: { rows: 4, cols: 5, instructorAt: 'top', aisles: [] },
    access: {
      visitGrantsAccess: true,
      allowExpiredEntry: false,
      graceDays: 0,
      methods: ['fingerprint', 'qr', 'reception', 'manual'],
    },
    visits: { defaultPrice: 100, memberGuestPrice: 80 },
    payments: { methods: ['cash', 'card', 'transfer'], taxRate: 0, receiptFooter: '¡Gracias por entrenar con nosotros!' },
    notifications: { channels: ['inapp', 'email'], nearExpirationDaysBefore: 5, classReminderHoursBefore: 2 },
    printing: { receiptWidth: '80mm', printLogo: true },
    updatedAt: Date.now(),
  }
}
