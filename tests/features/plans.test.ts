import { describe, expect, it } from 'vitest'
import type { FeatureKey, Gym, Plan, PlanId } from '@/types'
import {
  DEFAULT_PLANS,
  hasFeature,
  limitOf,
  memberLimitReached,
  staffLimitReached,
  branchLimitReached,
} from '@/config/plans'
import { entitlementsFrom, minimumPlanFor } from '@/services/planCatalog'
import { ALL_FEATURE_KEYS, CORE_FEATURES, FEATURES, isCoreFeature } from '@/config/features'

// ═══════════════════════════════════════════════════════════════════════════
// Planes y funcionalidades.
//
// Lo que se comprueba aquí es la promesa comercial del producto: que lo que
// se cobra sea exactamente lo que se entrega, y que apagar una funcionalidad
// desde el SuperAdmin la apague de verdad.
//
// Son pruebas de lógica pura: no necesitan emulador ni red.
// ═══════════════════════════════════════════════════════════════════════════

/** Gimnasio de prueba con el plan y los entitlements que se le indiquen. */
function gymWith(planId: PlanId, overrides: Partial<Gym> = {}): Gym {
  const plan = DEFAULT_PLANS[planId]
  return {
    id: 'gym_test',
    slug: 'test',
    name: 'Gimnasio de prueba',
    email: 't@t.mx',
    phone: '0000000000',
    address: '',
    city: '',
    state: '',
    zip: '',
    timezone: 'America/Mexico_City',
    currency: 'MXN',
    ownerId: 'u1',
    planId,
    subscriptionStatus: 'ACTIVE',
    branding: { accent: '', accentSoft: '', accentDeep: '' },
    onboarding: { dismissed: true, steps: {} as never },
    entitlements: entitlementsFrom(plan),
    createdAt: 0,
    ...overrides,
  }
}

describe('catálogo de funcionalidades', () => {
  it('declara todas las claves que usan los planes', () => {
    for (const plan of Object.values(DEFAULT_PLANS)) {
      for (const key of Object.keys(plan.features) as FeatureKey[]) {
        expect(ALL_FEATURE_KEYS, `la clave "${key}" no está en el catálogo`).toContain(key)
      }
    }
  })

  it('no tiene claves duplicadas', () => {
    expect(new Set(ALL_FEATURE_KEYS).size).toBe(ALL_FEATURE_KEYS.length)
  })

  it('todas las funcionalidades esenciales están activas en Starter', () => {
    // Si una función esencial no estuviera en el plan más barato, ese plan
    // sería un producto roto que igualmente se cobra.
    for (const key of CORE_FEATURES) {
      expect(DEFAULT_PLANS.STARTER.features[key], `Starter debería incluir "${key}"`).toBe(true)
    }
  })

  it('cada funcionalidad tiene nombre y descripción', () => {
    for (const f of FEATURES) {
      expect(f.name.length).toBeGreaterThan(2)
      expect(f.description.length).toBeGreaterThan(10)
    }
  })
})

describe('funcionalidades por plan', () => {
  it('Starter NO puede usar reservaciones', () => {
    expect(hasFeature(gymWith('STARTER'), 'reservations')).toBe(false)
  })

  it('Starter NO puede usar el mapa de bicicletas', () => {
    expect(hasFeature(gymWith('STARTER'), 'spinningMap')).toBe(false)
  })

  it('Pro SÍ puede usar reservaciones y mapa de bicicletas', () => {
    const pro = gymWith('PRO')
    expect(hasFeature(pro, 'reservations')).toBe(true)
    expect(hasFeature(pro, 'spinningMap')).toBe(true)
  })

  it('Pro NO puede usar inventario ni múltiples sucursales', () => {
    const pro = gymWith('PRO')
    expect(hasFeature(pro, 'inventory')).toBe(false)
    expect(hasFeature(pro, 'multipleBranches')).toBe(false)
  })

  it('Business puede usar múltiples sucursales e inventario', () => {
    const business = gymWith('BUSINESS')
    expect(hasFeature(business, 'multipleBranches')).toBe(true)
    expect(hasFeature(business, 'inventory')).toBe(true)
    expect(hasFeature(business, 'api')).toBe(true)
  })

  it('todos los planes incluyen las funcionalidades esenciales', () => {
    for (const id of ['STARTER', 'PRO', 'BUSINESS'] as PlanId[]) {
      for (const key of CORE_FEATURES) {
        expect(hasFeature(gymWith(id), key), `${id} debería incluir "${key}"`).toBe(true)
      }
    }
  })
})

describe('el SuperAdmin cambia funcionalidades sin tocar código', () => {
  it('activar una funcionalidad en el plan la habilita en el gimnasio', () => {
    // Starter sin reservaciones…
    const antes = gymWith('STARTER')
    expect(hasFeature(antes, 'reservations')).toBe(false)

    // …el SuperAdmin la activa en el plan, y el servidor copia los
    // entitlements al gimnasio.
    const planEditado: Plan = {
      ...DEFAULT_PLANS.STARTER,
      features: { ...DEFAULT_PLANS.STARTER.features, reservations: true },
    }
    const despues = gymWith('STARTER', { entitlements: entitlementsFrom(planEditado) })

    expect(hasFeature(despues, 'reservations')).toBe(true)
  })

  it('desactivar una funcionalidad en el plan la bloquea en el gimnasio', () => {
    const planEditado: Plan = {
      ...DEFAULT_PLANS.PRO,
      features: { ...DEFAULT_PLANS.PRO.features, spinningMap: false },
    }
    const pro = gymWith('PRO', { entitlements: entitlementsFrom(planEditado) })

    expect(hasFeature(pro, 'spinningMap')).toBe(false)
    // Lo demás del plan sigue intacto.
    expect(hasFeature(pro, 'reservations')).toBe(true)
  })

  it('las funcionalidades esenciales están marcadas como tales', () => {
    expect(isCoreFeature('members')).toBe(true)
    expect(isCoreFeature('memberships')).toBe(true)
    expect(isCoreFeature('reservations')).toBe(false)
  })

  it('el gimnasio sin entitlements cae a los valores del plan', () => {
    // Gimnasio antiguo, anterior a la migración: no debe quedarse sin servicio.
    const viejo = gymWith('PRO', { entitlements: undefined })
    expect(hasFeature(viejo, 'reservations')).toBe(true)
    expect(hasFeature(viejo, 'inventory')).toBe(false)
  })
})

describe('la suscripción manda sobre el plan', () => {
  it('un gimnasio SUSPENDED pierde todas las funcionalidades', () => {
    const g = gymWith('BUSINESS', { subscriptionStatus: 'SUSPENDED' })
    expect(hasFeature(g, 'members')).toBe(false)
    expect(hasFeature(g, 'reservations')).toBe(false)
  })

  it('un gimnasio CANCELED pierde todas las funcionalidades', () => {
    const g = gymWith('PRO', { subscriptionStatus: 'CANCELED' })
    expect(hasFeature(g, 'reservations')).toBe(false)
  })

  it('PAST_DUE conserva el acceso: un cargo fallido no cierra el negocio', () => {
    const g = gymWith('PRO', { subscriptionStatus: 'PAST_DUE' })
    expect(hasFeature(g, 'members')).toBe(true)
    expect(hasFeature(g, 'reservations')).toBe(true)
  })

  it('TRIALING opera con normalidad', () => {
    const g = gymWith('PRO', { subscriptionStatus: 'TRIALING' })
    expect(hasFeature(g, 'reservations')).toBe(true)
  })
})

describe('límites del plan', () => {
  it('Starter tope 150 socios', () => {
    const g = gymWith('STARTER')
    expect(limitOf(g, 'maxMembers')).toBe(150)
    expect(memberLimitReached(g, 149)).toBe(false)
    expect(memberLimitReached(g, 150)).toBe(true)
    expect(memberLimitReached(g, 200)).toBe(true)
  })

  it('Pro tope 1000 socios y 10 usuarios', () => {
    const g = gymWith('PRO')
    expect(memberLimitReached(g, 999)).toBe(false)
    expect(memberLimitReached(g, 1000)).toBe(true)
    expect(staffLimitReached(g, 10)).toBe(true)
    expect(staffLimitReached(g, 9)).toBe(false)
  })

  it('Business no tiene topes', () => {
    const g = gymWith('BUSINESS')
    expect(limitOf(g, 'maxMembers')).toBeNull()
    expect(memberLimitReached(g, 100_000)).toBe(false)
    expect(staffLimitReached(g, 500)).toBe(false)
    expect(branchLimitReached(g, 40)).toBe(false)
  })

  it('el SuperAdmin puede subir el tope sin tocar código', () => {
    const ampliado: Plan = { ...DEFAULT_PLANS.STARTER, maxMembers: 400 }
    const g = gymWith('STARTER', { entitlements: entitlementsFrom(ampliado) })
    expect(memberLimitReached(g, 300)).toBe(false)
    expect(memberLimitReached(g, 400)).toBe(true)
  })
})

describe('plan mínimo para una funcionalidad', () => {
  it('reservaciones empiezan en Pro', () => {
    expect(minimumPlanFor(DEFAULT_PLANS, 'reservations').id).toBe('PRO')
  })

  it('inventario empieza en Business', () => {
    expect(minimumPlanFor(DEFAULT_PLANS, 'inventory').id).toBe('BUSINESS')
  })

  it('socios están desde Starter', () => {
    expect(minimumPlanFor(DEFAULT_PLANS, 'members').id).toBe('STARTER')
  })

  it('refleja los cambios del SuperAdmin', () => {
    const catalogo = {
      ...DEFAULT_PLANS,
      STARTER: {
        ...DEFAULT_PLANS.STARTER,
        features: { ...DEFAULT_PLANS.STARTER.features, reservations: true },
      },
    }
    expect(minimumPlanFor(catalogo, 'reservations').id).toBe('STARTER')
  })
})

describe('entitlements copiados al gimnasio', () => {
  it('llevan plan, funcionalidades y los tres límites', () => {
    const e = entitlementsFrom(DEFAULT_PLANS.PRO)
    expect(e.planId).toBe('PRO')
    expect(e.maxMembers).toBe(1000)
    expect(e.maxStaff).toBe(10)
    expect(e.maxBranches).toBe(1)
    expect(e.features.reservations).toBe(true)
    expect(e.syncedAt).toBeGreaterThan(0)
  })

  it('son una copia, no una referencia al plan', () => {
    const plan = { ...DEFAULT_PLANS.PRO }
    const e = entitlementsFrom(plan)
    e.features.reservations = false
    // Tocar los entitlements de un gimnasio no puede cambiar el plan de todos.
    expect(plan.features.reservations).toBe(true)
  })
})
