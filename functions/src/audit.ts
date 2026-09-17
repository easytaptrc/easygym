import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions'
import { db } from './lib/admin'

// ═══════════════════════════════════════════════════════════════════════════
// Bitácora escrita por el SERVIDOR.
//
// POR QUÉ ESTO Y NO EL CLIENTE
//
// Mientras la bitácora la escribe el navegador, el actor que aparece en cada
// registro es lo que el propio auditado declaró. No puede BORRAR ni EDITAR lo
// escrito —las reglas lo prohíben a todos, incluido el SuperAdmin—, pero sí
// podría mentir al escribir, o sencillamente no escribir.
//
// Estos disparadores cierran ese hueco: el actor sale del documento, no de lo
// que diga el cliente, y el registro se escribe aunque el navegador se cierre
// a la mitad de la operación.
//
// Con esto desplegado, en `firestore.rules` se cambia:
//
//     match /auditLogs/{id} { allow create: if ... }
//   → match /auditLogs/{id} { allow create: if false; }
//
// QUÉ SE REGISTRA AQUÍ
//
// Solo lo que tiene consecuencias y lo que alguien podría querer negar:
// dinero, permisos y datos personales. Registrar cada lectura convertiría la
// bitácora en la colección más grande del producto y en la más inútil.
// ═══════════════════════════════════════════════════════════════════════════

type Actor = { id: string | null; name: string; role: string }

/** Quién hizo la operación, según el documento. Nunca según el cliente. */
async function actorOf(uid: string | null | undefined): Promise<Actor> {
  if (!uid) return { id: null, name: 'Sistema', role: 'SYSTEM' }
  const snap = await db.collection('users').doc(uid).get()
  const data = snap.data()
  if (!data) return { id: uid, name: 'Desconocido', role: 'SYSTEM' }
  return { id: uid, name: (data.name as string) ?? 'Sin nombre', role: (data.role as string) ?? 'SYSTEM' }
}

interface WriteAudit {
  gymId: string | null
  actor: Actor
  action: string
  entityType: string
  entityId: string | null
  summary: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

async function write(entry: WriteAudit): Promise<void> {
  try {
    await db.collection('auditLogs').add({
      gymId: entry.gymId,
      actorId: entry.actor.id,
      actorName: entry.actor.name,
      actorRole: entry.actor.role,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary,
      before: entry.before ?? null,
      after: entry.after ?? null,
      createdAt: Date.now(),
    })
  } catch (err) {
    // Que falle la bitácora no puede deshacer la operación que ya ocurrió.
    logger.error('[EasyGym] No se pudo escribir la auditoría:', err)
  }
}

/** Solo los campos que cambiaron. Copiar el documento entero no es un log. */
function diff(
  before: FirebaseFirestore.DocumentData,
  after: FirebaseFirestore.DocumentData,
  fields: string[],
): { before: Record<string, unknown>; after: Record<string, unknown>; changed: boolean } {
  const b: Record<string, unknown> = {}
  const a: Record<string, unknown> = {}
  for (const f of fields) {
    if (JSON.stringify(before[f]) !== JSON.stringify(after[f])) {
      b[f] = before[f] ?? null
      a[f] = after[f] ?? null
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 }
}

const money = (n: unknown) => `$${Number(n ?? 0).toLocaleString('es-MX')}`

// ─────────────────────────────── Dinero ─────────────────────────────────────

export const auditPaymentCreated = onDocumentCreated('payments/{id}', async (event) => {
  const p = event.data?.data()
  if (!p) return
  await write({
    gymId: p.gymId ?? null,
    actor: await actorOf(p.collectedBy),
    action: 'PAYMENT_REGISTERED',
    entityType: 'payments',
    entityId: event.params.id,
    summary: `Cobro de ${money(p.amount)} · ${p.concept ?? 'sin concepto'}`,
    after: { importe: p.amount, método: p.method, categoría: p.category, socio: p.memberName ?? null },
  })
})

export const auditPaymentUpdated = onDocumentUpdated('payments/{id}', async (event) => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()
  if (!before || !after) return
  if (before.status === after.status) return

  await write({
    gymId: after.gymId ?? null,
    actor: await actorOf(after.collectedBy),
    action: after.status === 'REFUNDED' ? 'PAYMENT_REFUNDED' : 'PAYMENT_REGISTERED',
    entityType: 'payments',
    entityId: event.params.id,
    summary: `${after.status === 'REFUNDED' ? 'Devolución' : 'Cambio de estado'} de ${money(after.amount)}`,
    before: { status: before.status },
    after: { status: after.status },
  })
})

export const auditVisitCreated = onDocumentCreated('visits/{id}', async (event) => {
  const v = event.data?.data()
  if (!v) return
  await write({
    gymId: v.gymId ?? null,
    actor: await actorOf(v.registeredBy),
    action: 'VISIT_REGISTERED',
    entityType: 'visits',
    entityId: event.params.id,
    summary: `Visita de ${v.name} · ${money(v.amount)}`,
    after: { nombre: v.name, importe: v.amount, método: v.method },
  })
})

// ───────────────────────── Socios y membresías ──────────────────────────────

export const auditMemberCreated = onDocumentCreated('members/{id}', async (event) => {
  const m = event.data?.data()
  if (!m) return
  await write({
    gymId: m.gymId ?? null,
    actor: { id: null, name: 'Sistema', role: 'SYSTEM' },
    action: 'MEMBER_CREATED',
    entityType: 'members',
    entityId: event.params.id,
    summary: `Alta de ${m.name} (#${String(m.memberNumber ?? 0).padStart(4, '0')})`,
    after: { nombre: m.name, correo: m.email ?? null, teléfono: m.phone ?? null },
  })
})

/**
 * Campos de un socio cuyo cambio importa.
 *
 * `expiresAt` está en la lista por una razón concreta: alargarle la vigencia a
 * un socio sin cobrarle es la forma más fácil de robarle a un gimnasio, y sin
 * bitácora es indetectable.
 */
const MEMBER_AUDITED = ['name', 'email', 'phone', 'expiresAt', 'status', 'membershipPlanId', 'fingerprintId']

export const auditMemberUpdated = onDocumentUpdated('members/{id}', async (event) => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()
  if (!before || !after) return

  const d = diff(before, after, MEMBER_AUDITED)
  if (!d.changed) return

  // El barrido nocturno cambia `status` de miles de socios. Eso no es una
  // edición de nadie y llenaría la bitácora de ruido.
  const onlyStatus = Object.keys(d.after).length === 1 && d.after.status !== undefined
  if (onlyStatus) return

  await write({
    gymId: after.gymId ?? null,
    actor: { id: null, name: 'Sistema', role: 'SYSTEM' },
    action: 'MEMBER_UPDATED',
    entityType: 'members',
    entityId: event.params.id,
    summary: `Edición de ${after.name}`,
    before: d.before,
    after: d.after,
  })
})

export const auditMemberDeleted = onDocumentDeleted('members/{id}', async (event) => {
  const m = event.data?.data()
  if (!m) return
  await write({
    gymId: m.gymId ?? null,
    actor: { id: null, name: 'Sistema', role: 'SYSTEM' },
    action: 'MEMBER_DEACTIVATED',
    entityType: 'members',
    entityId: event.params.id,
    summary: `Socio ELIMINADO: ${m.name}`,
    before: { nombre: m.name, correo: m.email ?? null, vencía: m.expiresAt ?? null },
  })
})

// ──────────────────────────── Permisos ──────────────────────────────────────

/**
 * Cambios de rol.
 *
 * Es el cambio con más consecuencias de todo el producto: decide quién puede
 * tocar el dinero. Va aparte para poder filtrarlo.
 */
export const auditRoleChanged = onDocumentUpdated('users/{uid}', async (event) => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()
  if (!before || !after) return

  const d = diff(before, after, ['role', 'gymId', 'active', 'memberId'])
  if (!d.changed) return

  const roleChanged = d.after.role !== undefined
  await write({
    gymId: (after.gymId as string) || null,
    actor: { id: null, name: 'Sistema', role: 'SYSTEM' },
    action: roleChanged ? 'STAFF_ROLE_CHANGED' : after.active === false ? 'STAFF_DEACTIVATED' : 'STAFF_UPDATED',
    entityType: 'users',
    entityId: event.params.uid,
    summary: roleChanged
      ? `${after.name}: rol ${before.role} → ${after.role}`
      : `Cambio en la cuenta de ${after.name}`,
    before: d.before,
    after: d.after,
  })
})

// ──────────────────────── Estado de los gimnasios ───────────────────────────

export const auditGymStatusChanged = onDocumentUpdated('gyms/{gymId}', async (event) => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()
  if (!before || !after) return

  const d = diff(before, after, ['subscriptionStatus', 'planId'])
  if (!d.changed) return

  await write({
    gymId: event.params.gymId,
    actor: { id: null, name: 'Sistema', role: 'SYSTEM' },
    action: d.after.planId !== undefined ? 'GYM_PLAN_CHANGED' : 'GYM_STATUS_CHANGED',
    entityType: 'gyms',
    entityId: event.params.gymId,
    summary:
      d.after.planId !== undefined
        ? `${after.name}: plan ${before.planId} → ${after.planId}`
        : `${after.name}: suscripción ${before.subscriptionStatus} → ${after.subscriptionStatus}`,
    before: d.before,
    after: d.after,
  })
})

// ───────────────────────────── Retención ────────────────────────────────────

/**
 * Purga de registros antiguos.
 *
 * Una bitácora sin retención crece sin fin y acaba costando más que los datos
 * que protege. Dos años es un plazo con sentido fiscal y contable en México.
 *
 * Se borra lo de los gimnasios; los eventos de PLATAFORMA (`gymId: null`) se
 * conservan, porque son pocos y son precisamente los que interesan cuando hay
 * una disputa años después.
 */
const RETENTION_DAYS = 730

export const purgeOldAuditLogs = onSchedule(
  { schedule: '0 4 * * 0', timeZone: 'America/Mexico_City', memory: '512MiB', timeoutSeconds: 540 },
  async () => {
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000
    let deleted = 0

    // En tandas: borrar cientos de miles de documentos en una sola operación
    // agota la función y no deja nada hecho.
    for (let round = 0; round < 20; round++) {
      const old = await db
        .collection('auditLogs')
        .where('createdAt', '<', cutoff)
        .where('gymId', '!=', null)
        .limit(400)
        .get()

      if (old.empty) break

      const batch = db.batch()
      old.docs.forEach((d) => batch.delete(d.ref))
      await batch.commit()
      deleted += old.size
    }

    if (deleted > 0) {
      logger.info(`[EasyGym] Bitácora: ${deleted} registros de más de ${RETENTION_DAYS} días eliminados.`)
    }
  },
)
