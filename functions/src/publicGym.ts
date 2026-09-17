import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { db } from './lib/admin'

// ═══════════════════════════════════════════════════════════════════════════
// Sincronización del espejo público.
//
// `publicGyms/{gymId}` es la ÚNICA colección legible sin sesión. Contiene lo
// que el gimnasio quiere enseñar en `/g/:slug` y nada más: ni el correo del
// dueño, ni su ownerId, ni el estado de su suscripción, ni sus contadores.
//
// Al mantenerlo un trigger, las reglas pueden cerrar la escritura con
// `allow write: if false` y nadie puede falsear la ficha de un gimnasio.
// ═══════════════════════════════════════════════════════════════════════════

async function rebuildMirror(gymId: string) {
  const gymSnap = await db.collection('gyms').doc(gymId).get()
  if (!gymSnap.exists) {
    await db.collection('publicGyms').doc(gymId).delete().catch(() => undefined)
    return
  }
  const gym = gymSnap.data()!

  const plansSnap = await db
    .collection('membershipPlans')
    .where('gymId', '==', gymId)
    .where('active', '==', true)
    .get()

  const plans = plansSnap.docs
    .map((d) => d.data())
    // Un pase de un día no es una membresía: fuera de la lista de precios.
    .filter((p) => p.duration !== 'DAILY')
    .sort((a, b) => Number(a.days) - Number(b.days))
    .map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      days: p.days,
      benefits: p.benefits ?? [],
    }))

  const visible = gym.subscriptionStatus === 'ACTIVE' || gym.subscriptionStatus === 'TRIALING'

  await db.collection('publicGyms').doc(gymId).set({
    id: gymId,
    slug: gym.slug,
    name: gym.branding?.displayName ?? gym.name,
    city: gym.city,
    state: gym.state,
    address: gym.address,
    phone: gym.phone,
    logoUrl: gym.logoUrl ?? null,
    branding: {
      accent: gym.branding?.accent ?? '34 224 107',
      accentSoft: gym.branding?.accentSoft ?? '143 255 193',
      accentDeep: gym.branding?.accentDeep ?? '11 166 72',
    },
    plans,
    active: visible,
    updatedAt: Date.now(),
  })
}

export const onGymWritten = onDocumentWritten('gyms/{gymId}', async (event) => {
  await rebuildMirror(event.params.gymId)
})

export const onMembershipPlanWritten = onDocumentWritten('membershipPlans/{id}', async (event) => {
  const gymId = (event.data?.after.data() ?? event.data?.before.data())?.gymId
  if (gymId) await rebuildMirror(gymId)
})
