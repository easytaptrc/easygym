import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { FieldValue } from 'firebase-admin/firestore'
import { db, type PlanId } from './lib/admin'
import { consume } from './rateLimit'

// ═══════════════════════════════════════════════════════════════════════════
// Propagación de planes → gimnasios.
//
// EL PROBLEMA
//
// El SuperAdmin activa «Reservaciones» en el plan Starter. Para que eso surta
// efecto DE VERDAD, no basta con que la interfaz deje de esconder el botón:
// las reglas de Firestore tienen que empezar a aceptar escrituras en
// `reservations` para los gimnasios de ese plan.
//
// Las reglas podrían leer `plans/{planId}` en cada evaluación, pero eso son
// DOS lecturas por documento evaluado (gimnasio + plan) en lugar de una. Con
// una tabla de 500 socios eso es 1 000 lecturas extra solo para autorizar.
//
// LA SOLUCIÓN
//
// Copiar las funcionalidades y los límites del plan dentro del documento del
// gimnasio (`gyms/{id}.entitlements`). Las reglas leen UNA vez y deciden.
//
// Esa copia es una caché, y toda caché necesita quien la mantenga: esta
// función. Se dispara cuando cambia un plan y actualiza todos sus gimnasios.
//
// POR QUÉ NO PUEDE HACERLO EL NAVEGADOR
//
// Porque escribir en `gyms/{otro}.entitlements` es, literalmente, darse
// permisos. Las reglas se lo prohíben a todo el mundo salvo al SuperAdmin, y
// aun así nadie debería poder hacerlo documento a documento desde una pestaña
// que puede cerrarse a la mitad.
// ═══════════════════════════════════════════════════════════════════════════

interface Entitlements {
  planId: PlanId
  features: Record<string, boolean>
  maxMembers: number | null
  maxStaff: number | null
  maxBranches: number | null
  syncedAt: number
}

function entitlementsFrom(planId: PlanId, plan: FirebaseFirestore.DocumentData): Entitlements {
  return {
    planId,
    features: { ...(plan.features ?? {}) },
    maxMembers: plan.maxMembers ?? null,
    maxStaff: plan.maxStaff ?? null,
    maxBranches: plan.maxBranches ?? null,
    syncedAt: Date.now(),
  }
}

/** Escribe los entitlements en todos los gimnasios de un plan, por lotes. */
async function propagate(planId: PlanId, entitlements: Entitlements): Promise<number> {
  const gyms = await db.collection('gyms').where('planId', '==', planId).get()
  if (gyms.empty) return 0

  // Firestore acepta 500 operaciones por lote. Un plan con 4 000 gimnasios
  // necesita ocho lotes, no una escritura gigante que falla entera.
  const CHUNK = 400
  let written = 0

  for (let i = 0; i < gyms.docs.length; i += CHUNK) {
    const batch = db.batch()
    for (const doc of gyms.docs.slice(i, i + CHUNK)) {
      batch.update(doc.ref, { entitlements, updatedAt: Date.now() })
    }
    await batch.commit()
    written += Math.min(CHUNK, gyms.docs.length - i)
  }

  return written
}

/**
 * El SuperAdmin editó un plan: se copia a sus gimnasios.
 *
 * Es idempotente: volver a ejecutarla con el mismo plan deja el mismo estado.
 */
export const onPlanWritten = onDocumentWritten('plans/{planId}', async (event) => {
  const after = event.data?.after.data()
  const before = event.data?.before.data()
  const planId = event.params.planId as PlanId

  if (!after) {
    // Un plan borrado NO se propaga: dejar sin funcionalidades a gimnasios que
    // están pagando por el descuido de alguien en otra pantalla sería el peor
    // resultado posible. Se avisa y se conserva lo que ya tenían.
    logger.warn(`[EasyGym] El plan ${planId} fue eliminado; los gimnasios conservan sus permisos.`)
    return
  }

  // Solo interesa lo que las reglas leen. Cambiar el texto comercial de un
  // plan no debería reescribir miles de documentos.
  const relevant = (d: FirebaseFirestore.DocumentData | undefined) =>
    JSON.stringify({
      features: d?.features ?? {},
      maxMembers: d?.maxMembers ?? null,
      maxStaff: d?.maxStaff ?? null,
      maxBranches: d?.maxBranches ?? null,
    })

  if (before && relevant(before) === relevant(after)) return

  const entitlements = entitlementsFrom(planId, after)
  const count = await propagate(planId, entitlements)

  logger.info(`[EasyGym] Plan ${planId} propagado a ${count} gimnasios.`)

  await db.collection('auditLogs').add({
    gymId: null,
    actorId: null,
    actorName: 'Sistema',
    actorRole: 'SYSTEM',
    action: 'PLAN_UPDATED',
    entityType: 'plans',
    entityId: planId,
    summary: `Permisos del plan ${planId} propagados a ${count} ${count === 1 ? 'gimnasio' : 'gimnasios'}`,
    before: null,
    after: { gimnasios: count },
    createdAt: Date.now(),
  })
})

/**
 * Un gimnasio cambió de plan: recibe los entitlements del nuevo.
 *
 * Sin esto, cambiar a un gimnasio de Starter a Pro le daría el botón de
 * reservaciones pero no el permiso, y viceversa al bajarlo.
 */
export const onGymPlanChanged = onDocumentWritten('gyms/{gymId}', async (event) => {
  const after = event.data?.after.data()
  if (!after) return

  const before = event.data?.before.data()
  const planId = after.planId as PlanId | undefined
  if (!planId) return

  // Solo cuando cambia el plan, o cuando el gimnasio aún no tiene permisos.
  const planChanged = before?.planId !== planId
  const missing = !after.entitlements
  const stale = after.entitlements?.planId !== planId
  if (!planChanged && !missing && !stale) return

  const plan = await db.collection('plans').doc(planId).get()
  if (!plan.exists) {
    logger.error(`[EasyGym] El gimnasio ${event.params.gymId} apunta al plan ${planId}, que no existe.`)
    return
  }

  await event.data!.after.ref.update({
    entitlements: entitlementsFrom(planId, plan.data()!),
    updatedAt: Date.now(),
  })
})

/**
 * Resincronización manual de TODOS los planes.
 *
 * Es la red de seguridad para cuando algo se quedó a medias: una propagación
 * interrumpida, una migración, un documento editado a mano en la consola.
 * Solo el SUPERADMIN puede llamarla.
 */
export const resyncEntitlements = onCall({ memory: '512MiB', timeoutSeconds: 540 }, async (request) => {
  if (request.auth?.token.role !== 'SUPERADMIN') {
    throw new HttpsError('permission-denied', 'Solo el administrador de la plataforma puede hacer esto.')
  }

  // Recorre todos los gimnasios de la plataforma: pulsar el botón cinco veces
  // seguidas por impaciencia no debería multiplicar la carga por cinco.
  await consume('resyncEntitlements', request.auth.uid)

  const plans = await db.collection('plans').get()
  let total = 0

  for (const plan of plans.docs) {
    const planId = plan.id as PlanId
    total += await propagate(planId, entitlementsFrom(planId, plan.data()))
  }

  await db.collection('auditLogs').add({
    gymId: null,
    actorId: request.auth.uid,
    actorName: request.auth.token.name ?? 'SuperAdmin',
    actorRole: 'SUPERADMIN',
    action: 'AGGREGATES_REBUILT',
    entityType: 'gyms',
    entityId: null,
    summary: `Resincronizó permisos de ${total} ${total === 1 ? 'gimnasio' : 'gimnasios'}`,
    before: null,
    after: { gimnasios: total },
    createdAt: Date.now(),
  })

  return { gyms: total, plans: plans.size }
})

/**
 * Tope de socios, comprobado en el servidor.
 *
 * Las reglas ya rechazan el alta cuando `counters.members.total` llega al
 * límite, pero ese contador es una caché. Esta función es la que lo mantiene
 * honesto: cuando un alta lo sobrepasa —porque el contador iba desfasado— lo
 * deja marcado para que se vea en el panel de la plataforma.
 *
 * NO borra al socio. Un gimnasio que se pasó de su plan tiene un problema
 * comercial, no un problema de datos, y borrarle gente sería lo contrario de
 * resolverlo.
 */
export const onMemberCreatedCheckLimit = onDocumentWritten('members/{memberId}', async (event) => {
  if (event.data?.before.exists || !event.data?.after.exists) return

  const gymId = event.data.after.data()?.gymId as string | undefined
  if (!gymId) return

  const gym = await db.collection('gyms').doc(gymId).get()
  const max = gym.data()?.entitlements?.maxMembers as number | null | undefined
  if (max == null) return

  const counter = await db.collection('counters').doc(gymId).get()
  const total = (counter.data()?.members?.total as number | undefined) ?? 0
  if (total <= max) return

  await gym.ref.update({
    overLimitSince: gym.data()?.overLimitSince ?? FieldValue.serverTimestamp(),
    overLimitBy: total - max,
  })

  logger.warn(`[EasyGym] El gimnasio ${gymId} superó su tope de socios (${total}/${max}).`)
})
