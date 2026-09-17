import type { Gym, PublicGym } from '@/types'
import { platform, repoFor } from './db'

// ═══════════════════════════════════════════════════════════════════════════
// Espejo público del gimnasio.
//
// POR QUÉ EXISTE
//
// La página `/g/:slug` la ve cualquiera, sin sesión. Si leyera la colección
// `gyms` haría falta `allow get: if true`, y ese documento contiene el correo
// del dueño, su ownerId, el estado de su suscripción y los contadores del
// negocio. Nadie necesita eso para ver la dirección y los precios.
//
// `publicGyms/{gymId}` guarda SOLO lo que el gimnasio quiere enseñar, y la
// lista de precios va desnormalizada dentro del mismo documento: una lectura,
// sin poder enumerar los planes de los demás gimnasios de la plataforma.
//
// EN PRODUCCIÓN
//
// Lo escribe un trigger de Firestore (`onGymWrite` / `onMembershipPlanWrite`)
// y las reglas prohíben que el cliente lo toque. Aquí lo mantiene el cliente
// porque el prototipo no tiene servidor: la función es la misma y se mueve
// tal cual.
// ═══════════════════════════════════════════════════════════════════════════

/** Un gimnasio suspendido o cancelado deja de anunciarse públicamente. */
function isPubliclyVisible(gym: Gym): boolean {
  return gym.subscriptionStatus === 'ACTIVE' || gym.subscriptionStatus === 'TRIALING'
}

export async function syncPublicGym(gymId: string): Promise<PublicGym | null> {
  const gym = await platform.get('gyms', gymId)
  if (!gym) return null

  const plans = await repoFor(gymId).list('membershipPlans', {
    where: [{ field: 'active', op: '==', value: true }],
  })

  const mirror: PublicGym = {
    id: gym.id,
    slug: gym.slug,
    name: gym.branding.displayName ?? gym.name,
    city: gym.city,
    state: gym.state,
    address: gym.address,
    phone: gym.phone,
    logoUrl: gym.logoUrl ?? null,
    branding: {
      accent: gym.branding.accent,
      accentSoft: gym.branding.accentSoft,
      accentDeep: gym.branding.accentDeep,
    },
    plans: plans
      // Un pase de un día no es una membresía: no va en la lista de precios.
      .filter((p) => p.duration !== 'DAILY')
      .sort((a, b) => a.days - b.days)
      .map((p) => ({ id: p.id, name: p.name, price: p.price, days: p.days, benefits: p.benefits })),
    active: isPubliclyVisible(gym),
    updatedAt: Date.now(),
  }

  await platform.create('publicGyms', mirror)
  return mirror
}

/** Resuelve un gimnasio por su slug SIN necesitar sesión. */
export async function findPublicGymBySlug(slug: string): Promise<PublicGym | null> {
  const rows = await platform.list('publicGyms', {
    where: [
      { field: 'slug', op: '==', value: slug },
      { field: 'active', op: '==', value: true },
    ],
    limit: 1,
  })
  return rows[0] ?? null
}

/** Best-effort: la sincronización del espejo nunca debe tumbar una operación. */
export function syncPublicGymQuietly(gymId: string): void {
  void syncPublicGym(gymId).catch((err) =>
    console.warn('[EasyGym] No se pudo sincronizar el espejo público del gimnasio:', err),
  )
}
