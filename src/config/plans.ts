import type { FeatureKey, FeatureMap, Gym, Plan, PlanId } from '@/types'
import { ALL_FEATURE_KEYS } from './features'

// ═══════════════════════════════════════════════════════════════════════════
// Planes de EasyGym.
//
// ⚠️ ESTE ARCHIVO YA NO ES LA VERDAD EN RUNTIME.
//
// Los planes viven en Firestore (`plans/{planId}`) y los edita el SuperAdmin
// desde /superadmin/planes. Lo que hay aquí son los valores INICIALES con los
// que se siembra ese catálogo la primera vez.
//
// Para preguntar si un gimnasio puede usar algo: `hasFeature(gym, key)`.
// Para el catálogo editable: `services/planCatalog.ts`.
// ═══════════════════════════════════════════════════════════════════════════

/** Mapa de funcionalidades con todo apagado. */
function noFeatures(): FeatureMap {
  return Object.fromEntries(ALL_FEATURE_KEYS.map((k) => [k, false])) as FeatureMap
}

function withFeatures(base: FeatureMap, on: FeatureKey[]): FeatureMap {
  const out = { ...base }
  for (const k of on) out[k] = true
  return out
}

const STARTER_FEATURES = withFeatures(noFeatures(), [
  'members',
  'memberships',
  'attendance',
  'visits',
  'manualPayments',
  'memberPortal',
  'paymentHistory',
  'basicReports',
  'pwa',
])

const PRO_FEATURES = withFeatures(STARTER_FEATURES, [
  'stripeAutoPayments',
  'autoRenewals',
  'advancedPortal',
  'reservations',
  'classes',
  'spinningMap',
  'configurableSchedules',
  'accessControl',
  'fingerprint',
  'advancedReports',
  'posBasic',
  'notifications',
])

const BUSINESS_FEATURES = withFeatures(PRO_FEATURES, [
  'multipleBranches',
  'posFull',
  'inventory',
  'whatsapp',
  'automations',
  'customBranding',
  'api',
  'integrations',
  'enterpriseReports',
])

const ENTERPRISE_FEATURES = { ...BUSINESS_FEATURES }

/** Valores iniciales del catálogo. Se escriben en Firestore la primera vez. */
export const DEFAULT_PLANS: Record<PlanId, Plan> = {
  STARTER: {
    id: 'STARTER',
    name: 'Starter',
    tagline: 'Ideal para gimnasios que empiezan',
    price: 499,
    currency: 'MXN',
    interval: 'month',
    maxMembers: 150,
    maxStaff: 2,
    maxBranches: 1,
    support: 'Soporte por correo',
    accent: 'tap',
    active: true,
    publiclyVisible: true,
    highlights: [
      'Hasta 150 socios',
      'Socios y membresías',
      'Control de asistencia',
      'Registro de visitas',
      'Pagos manuales',
      'Portal del socio',
      'Historial de pagos',
      'Reportes básicos',
      '2 usuarios administrativos',
      '1 sucursal',
    ],
    features: STARTER_FEATURES,
  },
  PRO: {
    id: 'PRO',
    name: 'Pro',
    tagline: 'La solución más completa para tu gimnasio',
    price: 899,
    currency: 'MXN',
    interval: 'month',
    popular: true,
    maxMembers: 1000,
    maxStaff: 10,
    maxBranches: 1,
    support: 'Soporte prioritario',
    accent: 'cyber',
    active: true,
    publiclyVisible: true,
    highlights: [
      'Hasta 1,000 socios',
      'Todo lo de Starter',
      'Cobros automáticos con Stripe',
      'Renovación automática',
      'Reservación de clases',
      'Mapa de bicicletas (spinning)',
      'Control de acceso + huella',
      'Reportes avanzados',
      'POS básico',
      'Notificaciones',
      'Hasta 10 usuarios',
    ],
    features: PRO_FEATURES,
  },
  BUSINESS: {
    id: 'BUSINESS',
    name: 'Business',
    tagline: 'Sin límites para grandes gimnasios',
    price: 1499,
    currency: 'MXN',
    interval: 'month',
    maxMembers: null,
    maxStaff: null,
    maxBranches: null,
    support: 'Soporte premium 24/7',
    accent: 'plasma',
    active: true,
    publiclyVisible: true,
    highlights: [
      'Socios ilimitados',
      'Todo lo de Pro',
      'Múltiples sucursales',
      'Usuarios ilimitados',
      'POS completo + inventario',
      'WhatsApp Business',
      'Automatizaciones',
      'Branding personalizado',
      'API e integraciones',
      'Reportes empresariales',
    ],
    features: BUSINESS_FEATURES,
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    tagline: 'Para cadenas y franquicias',
    price: null,
    currency: 'MXN',
    interval: 'month',
    maxMembers: null,
    maxStaff: null,
    maxBranches: null,
    support: 'Gerente de cuenta dedicado',
    accent: 'ink',
    active: true,
    publiclyVisible: false,
    highlights: [
      'Todo lo de Business',
      'SLA y contrato a medida',
      'SSO corporativo',
      'Infraestructura dedicada',
      'Onboarding asistido',
      'Integraciones a medida',
    ],
    features: ENTERPRISE_FEATURES,
  },
}

export const PLAN_ORDER: PlanId[] = ['STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE']

/** Plan por defecto cuando el catálogo aún no cargó. */
export function defaultPlan(planId: PlanId | undefined | null): Plan {
  return DEFAULT_PLANS[planId ?? 'STARTER'] ?? DEFAULT_PLANS.STARTER
}

/**
 * Acceso ESTÁTICO al plan. Solo para código que no puede usar hooks
 * (servicios, seed) y donde basta con los valores iniciales: nombres,
 * etiquetas, colores.
 *
 * Para decisiones que dependen del catálogo editado —precio a cobrar,
 * límites, funcionalidades— hay que leer el plan vivo:
 *   · en componentes → `usePlans().getPlan(id)`
 *   · en servicios   → `planCatalog.getLivePlan(id)`
 */
export const getPlan = defaultPlan

// ═══════════════════════════ Control de acceso ═════════════════════════════

/**
 * ¿Este gimnasio puede usar esta funcionalidad?
 *
 * Lee `gym.entitlements.features`, la copia que el servidor mantiene dentro
 * del documento del gimnasio cada vez que cambia su plan o el SuperAdmin edita
 * el catálogo. Es la MISMA fuente que consultan las reglas de Firestore, así
 * que la interfaz y el servidor nunca discrepan.
 *
 * Si el gimnasio todavía no tiene entitlements (recién creado, o base antigua)
 * se cae a los valores por defecto del plan, que es lo más conservador posible
 * sin dejar a nadie sin servicio.
 *
 * Devuelve `false` cuando la suscripción no permite operar: ver
 * `services/gymStatus.ts`, que es donde vive esa política.
 */
export function hasFeature(
  gym: Pick<Gym, 'planId' | 'subscriptionStatus' | 'entitlements'> | null | undefined,
  feature: FeatureKey,
): boolean {
  if (!gym) return false
  if (gym.subscriptionStatus === 'CANCELED' || gym.subscriptionStatus === 'SUSPENDED') return false

  const fromGym = gym.entitlements?.features?.[feature]
  if (typeof fromGym === 'boolean') return fromGym

  return defaultPlan(gym.planId).features[feature] === true
}

/** Límite efectivo del gimnasio. `null` = ilimitado. */
export function limitOf(
  gym: Pick<Gym, 'planId' | 'entitlements'> | null | undefined,
  limit: 'maxMembers' | 'maxStaff' | 'maxBranches',
): number | null {
  if (!gym) return 0
  const fromGym = gym.entitlements?.[limit]
  if (fromGym !== undefined) return fromGym
  return defaultPlan(gym.planId)[limit]
}

export function memberLimitReached(gym: Pick<Gym, 'planId' | 'entitlements'>, current: number): boolean {
  const max = limitOf(gym, 'maxMembers')
  return max !== null && current >= max
}

export function staffLimitReached(gym: Pick<Gym, 'planId' | 'entitlements'>, current: number): boolean {
  const max = limitOf(gym, 'maxStaff')
  return max !== null && current >= max
}

export function branchLimitReached(gym: Pick<Gym, 'planId' | 'entitlements'>, current: number): boolean {
  const max = limitOf(gym, 'maxBranches')
  return max !== null && current >= max
}

/** Etiqueta legible de un límite (para pintar "12 / 150"). */
export function limitLabel(value: number | null): string {
  return value === null ? 'Ilimitados' : value.toLocaleString('es-MX')
}

// ─────────── Etiquetas para la tabla comparativa pública ────────────────────

export const FEATURE_LABELS: Array<{ key: FeatureKey; label: string }> = [
  { key: 'members', label: 'Socios y membresías' },
  { key: 'attendance', label: 'Control de asistencia' },
  { key: 'visits', label: 'Registro de visitas' },
  { key: 'memberPortal', label: 'Portal web/app para socios' },
  { key: 'manualPayments', label: 'Pagos manuales' },
  { key: 'stripeAutoPayments', label: 'Cobros automáticos con Stripe' },
  { key: 'autoRenewals', label: 'Renovación automática' },
  { key: 'basicReports', label: 'Reportes de ventas' },
  { key: 'advancedReports', label: 'Reportes avanzados' },
  { key: 'reservations', label: 'Reservación de clases' },
  { key: 'spinningMap', label: 'Mapa de bicicletas (spinning)' },
  { key: 'fingerprint', label: 'Control de acceso (huella)' },
  { key: 'posBasic', label: 'Punto de venta' },
  { key: 'inventory', label: 'Inventario' },
  { key: 'notifications', label: 'Notificaciones (email / WhatsApp)' },
  { key: 'multipleBranches', label: 'Múltiples sucursales' },
  { key: 'customBranding', label: 'Branding personalizado' },
  { key: 'api', label: 'API e integraciones' },
]
