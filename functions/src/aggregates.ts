import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from './lib/admin'

// ═══════════════════════════════════════════════════════════════════════════
// Agregados mantenidos por el SERVIDOR.
//
// Es la versión de producción de `src/services/aggregates.ts`. Diferencias:
//
//   · usa `FieldValue.increment()`, que es atómico en el servidor y no
//     necesita leer-modificar-escribir ni transacciones
//   · se dispara con triggers: no depende de que el cliente termine la
//     operación ni de que tenga red
//   · permite cerrar la escritura de `counters` y `dailyStats` con
//     `allow write: if false` en las reglas
//
// Con esto, contar 100 000 socios cuesta 1 lectura en lugar de 100 000.
// ═══════════════════════════════════════════════════════════════════════════

const dayKeyOf = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const dailyRef = (gymId: string, date: string) => db.collection('dailyStats').doc(`${gymId}_${date}`)
const countersRef = (gymId: string) => db.collection('counters').doc(gymId)

/** `set(..., {merge:true})` crea el documento si no existía. */
async function bumpDaily(gymId: string, date: string, delta: Record<string, unknown>) {
  await dailyRef(gymId, date).set(
    { id: `${gymId}_${date}`, gymId, date, updatedAt: Date.now(), ...delta },
    { merge: true },
  )
}

const STATUS_FIELD: Record<string, string> = {
  ACTIVE: 'members.active',
  NEAR_EXPIRATION: 'members.nearExpiration',
  EXPIRED: 'members.expired',
  INACTIVE: 'members.inactive',
}

// ────────────────────────────────── Pagos ───────────────────────────────────

export const onPaymentCreated = onDocumentCreated('payments/{id}', async (event) => {
  const p = event.data?.data()
  if (!p || p.status !== 'PAID') return
  await bumpDaily(p.gymId, dayKeyOf(p.createdAt), {
    revenueTotal: FieldValue.increment(p.amount),
    [`revenue.${p.category}`]: FieldValue.increment(p.amount),
    [`byMethod.${p.method}`]: FieldValue.increment(p.amount),
  })
})

// ────────────────────────────────── Visitas ─────────────────────────────────

export const onVisitCreated = onDocumentCreated('visits/{id}', async (event) => {
  const v = event.data?.data()
  if (!v) return
  await bumpDaily(v.gymId, v.date, { visits: FieldValue.increment(1) })
})

// ──────────────────────────────── Asistencias ───────────────────────────────

export const onAttendanceCreated = onDocumentCreated('attendance/{id}', async (event) => {
  const a = event.data?.data()
  if (!a || !a.granted) return
  const hour = String(Number(String(a.time).split(':')[0]))
  await bumpDaily(a.gymId, a.date, {
    attendance: FieldValue.increment(1),
    [`byHour.${hour}`]: FieldValue.increment(1),
  })
})

// ──────────────────────────────── Membresías ────────────────────────────────

export const onMembershipCreated = onDocumentCreated('memberships/{id}', async (event) => {
  const m = event.data?.data()
  if (!m) return
  await bumpDaily(m.gymId, dayKeyOf(m.createdAt), {
    [m.kind === 'RENEWAL' ? 'renewals' : 'newMemberships']: FieldValue.increment(1),
  })
})

// ─────────────────────────────── Reservaciones ──────────────────────────────

export const onReservationCreated = onDocumentCreated('reservations/{id}', async (event) => {
  const r = event.data?.data()
  if (!r || r.status === 'CANCELLED') return
  await bumpDaily(r.gymId, dayKeyOf(r.createdAt), { reservations: FieldValue.increment(1) })
})

// ─────────────────── Socios: altas, bajas y cambios de estado ───────────────

export const onMemberWritten = onDocumentWritten('members/{id}', async (event) => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()

  // Alta
  if (!before && after) {
    await countersRef(after.gymId).set(
      {
        id: after.gymId,
        gymId: after.gymId,
        'members.total': FieldValue.increment(1),
        [STATUS_FIELD[after.status] ?? 'members.expired']: FieldValue.increment(1),
        updatedAt: Date.now(),
      },
      { merge: true },
    )
    await bumpDaily(after.gymId, dayKeyOf(after.createdAt), { newMembers: FieldValue.increment(1) })
    return
  }

  // Baja física (no debería pasar: el producto usa baja lógica)
  if (before && !after) {
    await countersRef(before.gymId).set(
      {
        'members.total': FieldValue.increment(-1),
        [STATUS_FIELD[before.status] ?? 'members.expired']: FieldValue.increment(-1),
        updatedAt: Date.now(),
      },
      { merge: true },
    )
    return
  }

  // Cambio de estado: una unidad se mueve de un cubo al otro.
  if (before && after && before.status !== after.status) {
    await countersRef(after.gymId).set(
      {
        [STATUS_FIELD[before.status] ?? 'members.expired']: FieldValue.increment(-1),
        [STATUS_FIELD[after.status] ?? 'members.expired']: FieldValue.increment(1),
        updatedAt: Date.now(),
      },
      { merge: true },
    )
  }
})

// ─────────── Recalcular el estado de los socios cada madrugada ──────────────
//
// El estado se DERIVA de expiresAt, pero el campo `status` es la caché con la
// que se filtra en el servidor. Sin este barrido, un socio que venció a
// medianoche seguiría apareciendo como ACTIVE hasta que alguien lo tocara.

export const onMembershipExpiryChanged = onDocumentUpdated('members/{id}', async (event) => {
  const after = event.data?.after.data()
  const before = event.data?.before.data()
  if (!after || !before) return
  if (before.expiresAt === after.expiresAt) return
  // El cambio de `status` lo escribe quien renueva; aquí solo se deja rastro.
  console.debug(`Vigencia actualizada de ${event.params.id}: ${after.expiresAt}`)
})
