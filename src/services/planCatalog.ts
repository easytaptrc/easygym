import type { AppUser, FeatureKey, Gym, GymEntitlements, Plan, PlanDoc, PlanId } from '@/types'
import { DEFAULT_PLANS, PLAN_ORDER, defaultPlan } from '@/config/plans'
import { isCoreFeature } from '@/config/features'
import { platform } from './db'
import { recordAudit } from './audit'

// ═══════════════════════════════════════════════════════════════════════════
// Catálogo de planes — editable en caliente.
//
// EL PROBLEMA QUE RESUELVE
//
// Antes, cambiar "Starter incluye reservaciones" exigía editar código,
// recompilar y desplegar. Ahora el SuperAdmin lo cambia desde una pantalla y
// surte efecto de inmediato en todos los gimnasios de ese plan.
//
// CÓMO SE PROPAGA
//
//   plans/{planId}.features          ← la verdad, la edita el SuperAdmin
//          │
//          │  syncEntitlements()  (en producción: trigger de Cloud Function)
//          ▼
//   gyms/{gymId}.entitlements        ← copia por gimnasio
//          │
//          ├──► hasFeature() en el navegador          (esconde la interfaz)
//          └──► firestore.rules                       (RECHAZA la escritura)
//
// La copia en el gimnasio no es duplicación gratuita: es lo que permite que
// una regla de seguridad decida con UNA lectura en vez de dos, y es lo que
// hace que apagar una función la apague de verdad y no solo visualmente.
// ═══════════════════════════════════════════════════════════════════════════

export type PlanCatalog = Record<PlanId, Plan>

/** Convierte un plan en los entitlements que se copian al gimnasio. */
export function entitlementsFrom(plan: Plan): GymEntitlements {
  return {
    planId: plan.id,
    features: { ...plan.features },
    maxMembers: plan.maxMembers,
    maxStaff: plan.maxStaff,
    maxBranches: plan.maxBranches,
    syncedAt: Date.now(),
  }
}

/** Siembra el catálogo si aún no existe. Idempotente. */
export async function ensurePlanCatalog(): Promise<PlanDoc[]> {
  const existing = await platform.list('plans')
  if (existing.length > 0) return existing

  const seeded: PlanDoc[] = []
  for (const id of PLAN_ORDER) {
    const doc: PlanDoc = { ...DEFAULT_PLANS[id], id, updatedAt: Date.now(), updatedBy: null }
    await platform.create('plans', doc)
    seeded.push(doc)
  }
  return seeded
}

/**
 * Plan vivo desde Firestore. Es lo que hay que usar para cualquier decisión
 * con consecuencias: cuánto cobrar, qué límite aplicar, qué funciones dar.
 */
export async function getLivePlan(planId: PlanId): Promise<Plan> {
  return (await platform.get('plans', planId)) ?? defaultPlan(planId)
}

export async function readPlanCatalog(): Promise<PlanCatalog> {
  const rows = await platform.list('plans')
  return toCatalog(rows)
}

export function watchPlanCatalog(cb: (catalog: PlanCatalog) => void) {
  return platform.watch('plans', undefined, (rows) => cb(toCatalog(rows)))
}

function toCatalog(rows: PlanDoc[]): PlanCatalog {
  const out = { ...DEFAULT_PLANS }
  for (const row of rows) {
    if (PLAN_ORDER.includes(row.id)) out[row.id] = row
  }
  return out
}

// ──────────────────────────── Edición del plan ──────────────────────────────

export interface PlanPatch {
  name?: string
  tagline?: string
  price?: number | null
  maxMembers?: number | null
  maxStaff?: number | null
  maxBranches?: number | null
  support?: string
  highlights?: string[]
  active?: boolean
  publiclyVisible?: boolean
  popular?: boolean
}

/** Campos que se muestran en la auditoría con nombre legible. */
const FIELD_LABEL: Record<string, string> = {
  name: 'nombre',
  price: 'precio',
  maxMembers: 'límite de socios',
  maxStaff: 'límite de usuarios',
  maxBranches: 'límite de sucursales',
  support: 'soporte',
  active: 'estado',
  publiclyVisible: 'visibilidad pública',
  popular: 'destacado',
  tagline: 'descripción',
  highlights: 'lista de ventajas',
}

export class PlanCatalogError extends Error {
  constructor(message: string) {
    super(message)
  }
}

/**
 * Actualiza un plan y propaga el cambio a todos los gimnasios que lo tienen.
 *
 * Deja auditoría de qué cambió exactamente: sin eso, "alguien bajó el precio
 * de Pro" se vuelve imposible de investigar.
 */
export async function updatePlan(planId: PlanId, patch: PlanPatch, actor: AppUser): Promise<PlanDoc> {
  const current = (await platform.get('plans', planId)) ?? { ...DEFAULT_PLANS[planId], id: planId }

  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    const prev = (current as unknown as Record<string, unknown>)[key]
    if (JSON.stringify(prev) !== JSON.stringify(value)) {
      before[key] = prev
      after[key] = value
    }
  }
  if (Object.keys(after).length === 0) return current

  const next: PlanDoc = {
    ...current,
    ...patch,
    id: planId,
    updatedAt: Date.now(),
    updatedBy: actor.uid,
  }
  await platform.create('plans', next)

  const changed = Object.keys(after)
    .map((k) => FIELD_LABEL[k] ?? k)
    .join(', ')

  await recordAudit({
    gymId: null,
    actor,
    action: after.price !== undefined ? 'PLAN_PRICE_CHANGED' : 'PLAN_UPDATED',
    entityType: 'plans',
    entityId: planId,
    summary: `Plan ${next.name}: cambió ${changed}`,
    before,
    after,
  })

  await syncEntitlementsForPlan(planId, next)
  return next
}

/**
 * Enciende o apaga una funcionalidad en un plan.
 *
 * Las funcionalidades marcadas como `core` no se pueden apagar: dejar a los
 * gimnasios Starter sin "Socios" les daría una aplicación que no sirve para
 * nada, y ningún panel de administración debería permitir ese error.
 */
export async function setPlanFeature(
  planId: PlanId,
  feature: FeatureKey,
  enabled: boolean,
  actor: AppUser,
): Promise<PlanDoc> {
  if (!enabled && isCoreFeature(feature)) {
    throw new PlanCatalogError(
      'Esta funcionalidad es esencial y no se puede desactivar: el gimnasio se quedaría sin poder operar.',
    )
  }

  const current = (await platform.get('plans', planId)) ?? { ...DEFAULT_PLANS[planId], id: planId }
  if (current.features[feature] === enabled) return current

  const next: PlanDoc = {
    ...current,
    id: planId,
    features: { ...current.features, [feature]: enabled },
    updatedAt: Date.now(),
    updatedBy: actor.uid,
  }
  await platform.create('plans', next)

  await recordAudit({
    gymId: null,
    actor,
    action: 'PLAN_FEATURE_TOGGLED',
    entityType: 'plans',
    entityId: planId,
    summary: `Plan ${next.name}: ${enabled ? 'activó' : 'desactivó'} «${feature}»`,
    before: { [feature]: current.features[feature] },
    after: { [feature]: enabled },
  })

  await syncEntitlementsForPlan(planId, next)
  return next
}

/**
 * Copia las funcionalidades y límites del plan a todos sus gimnasios.
 *
 * ▸ PRODUCCIÓN: esto lo hace el trigger `onPlanWritten` en
 *   `functions/src/planFeatures.ts`. Aquí corre en el cliente porque el
 *   prototipo no tiene servidor, y por eso está acotado a lo mínimo: leer los
 *   gimnasios del plan y escribir su campo `entitlements`.
 */
export async function syncEntitlementsForPlan(planId: PlanId, plan?: Plan): Promise<number> {
  const resolved = plan ?? (await platform.get('plans', planId)) ?? defaultPlan(planId)
  const entitlements = entitlementsFrom(resolved)

  const gyms = await platform.list('gyms', {
    where: [{ field: 'planId', op: '==', value: planId }],
  })

  for (const gym of gyms) {
    await platform.update('gyms', gym.id, { entitlements, updatedAt: Date.now() })
  }
  return gyms.length
}

/** Aplica el plan indicado a UN gimnasio (al crearlo o al cambiarle el plan). */
export async function applyPlanToGym(gym: Pick<Gym, 'id'>, planId: PlanId): Promise<GymEntitlements> {
  const plan = (await platform.get('plans', planId)) ?? defaultPlan(planId)
  const entitlements = entitlementsFrom(plan)
  await platform.update('gyms', gym.id, { entitlements, updatedAt: Date.now() })
  return entitlements
}

/** Rehace los entitlements de TODOS los gimnasios. Tarea de mantenimiento. */
export async function syncAllEntitlements(): Promise<number> {
  let total = 0
  for (const id of PLAN_ORDER) total += await syncEntitlementsForPlan(id)
  return total
}

/** El plan más barato que incluye esta funcionalidad, según el catálogo vivo. */
export function minimumPlanFor(catalog: PlanCatalog, feature: FeatureKey): Plan {
  for (const id of PLAN_ORDER) {
    if (catalog[id]?.features[feature]) return catalog[id]
  }
  return catalog.BUSINESS ?? DEFAULT_PLANS.BUSINESS
}

/** Planes que se muestran en la página pública de precios. */
export function publicPlans(catalog: PlanCatalog): Plan[] {
  return PLAN_ORDER.map((id) => catalog[id]).filter(
    (p): p is Plan => Boolean(p) && p.active !== false && p.publiclyVisible !== false,
  )
}
