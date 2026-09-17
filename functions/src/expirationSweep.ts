import { onSchedule } from 'firebase-functions/v2/scheduler'
import { db } from './lib/admin'

// ═══════════════════════════════════════════════════════════════════════════
// Barrido diario de vigencias.
//
// El estado de un socio se DERIVA de `expiresAt`, pero el campo `status` es
// la caché con la que se filtra en el servidor. Sin este barrido, un socio que
// venció a medianoche seguiría marcado como ACTIVE hasta que alguien abriera
// su ficha — y las reglas, los contadores y la recepción usarían ese dato.
//
// Corre todas las madrugadas, en lotes, y de paso encola los avisos de
// "tu membresía vence en N días".
// ═══════════════════════════════════════════════════════════════════════════

const DAY = 86_400_000
const BATCH_LIMIT = 400

const startOfToday = () => new Date().setHours(0, 0, 0, 0)

function statusFor(expiresAt: number | null, current: string, nearDays: number): string {
  if (current === 'INACTIVE') return 'INACTIVE'
  if (!expiresAt) return 'EXPIRED'
  const remaining = Math.round((new Date(expiresAt).setHours(0, 0, 0, 0) - startOfToday()) / DAY)
  if (remaining < 0) return 'EXPIRED'
  if (remaining <= nearDays) return 'NEAR_EXPIRATION'
  return 'ACTIVE'
}

export const dailyExpirationSweep = onSchedule(
  { schedule: '15 6 * * *', timeZone: 'America/Mexico_City', region: 'us-central1' },
  async () => {
    const gyms = await db.collection('gyms').get()

    for (const gymDoc of gyms.docs) {
      const gymId = gymDoc.id
      const settings = await db.collection('settings').doc(gymId).get()
      const nearDays = Number(settings.data()?.nearExpirationDays ?? 7)
      const channels: string[] = settings.data()?.notifications?.channels ?? ['inapp']
      const notifyBefore = Number(settings.data()?.notifications?.nearExpirationDaysBefore ?? 5)

      // Solo se revisan los socios cuyo estado PUEDE haber cambiado: los que
      // no están de baja. Paginado por cursor para no cargar el gimnasio
      // entero en memoria.
      let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined
      for (;;) {
        let q = db
          .collection('members')
          .where('gymId', '==', gymId)
          .where('status', 'in', ['ACTIVE', 'NEAR_EXPIRATION', 'EXPIRED'])
          .orderBy('__name__')
          .limit(BATCH_LIMIT)
        if (cursor) q = q.startAfter(cursor)

        const snap = await q.get()
        if (snap.empty) break

        const batch = db.batch()
        let writes = 0

        for (const doc of snap.docs) {
          const m = doc.data()
          const next = statusFor(m.expiresAt ?? null, m.status, nearDays)
          if (next !== m.status) {
            batch.update(doc.ref, { status: next, updatedAt: Date.now() })
            writes++
          }

          // Aviso de vencimiento próximo.
          const remaining = m.expiresAt
            ? Math.round((new Date(m.expiresAt).setHours(0, 0, 0, 0) - startOfToday()) / DAY)
            : -1
          if (remaining >= 0 && remaining <= notifyBefore) {
            for (const channel of channels) {
              const ref = db.collection('notifications').doc()
              batch.set(ref, {
                id: ref.id,
                gymId,
                kind: 'MEMBERSHIP_NEAR_EXPIRATION',
                channel,
                title: `Tu membresía vence en ${remaining} ${remaining === 1 ? 'día' : 'días'}`,
                body: `Renueva desde tu portal y no pierdas tu racha.`,
                memberId: doc.id,
                status: 'QUEUED',
                readAt: null,
                sentAt: null,
                createdAt: Date.now(),
              })
              writes++
            }
          }
        }

        if (writes > 0) await batch.commit()
        cursor = snap.docs[snap.docs.length - 1]
        if (snap.size < BATCH_LIMIT) break
      }
    }
  },
)
