import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { FeatureKey, Plan, PlanId } from '@/types'
import { DEFAULT_PLANS, PLAN_ORDER } from '@/config/plans'
import {
  ensurePlanCatalog,
  minimumPlanFor as pickMinimumPlan,
  publicPlans as pickPublicPlans,
  watchPlanCatalog,
  type PlanCatalog,
} from '@/services/planCatalog'
import { isMockDriver } from '@/services/db'

// ═══════════════════════════════════════════════════════════════════════════
// Catálogo de planes, en vivo.
//
// Se suscribe a la colección `plans`. Cuando el SuperAdmin activa una
// funcionalidad, el cambio llega por el listener y la interfaz de todos los
// gimnasios de ese plan se actualiza sin recargar ni recompilar.
//
// El contexto NO decide si un gimnasio puede usar algo: eso lo resuelve
// `hasFeature(gym, key)` contra los entitlements del gimnasio. Este contexto
// sirve para pintar precios, comparativas y la pantalla del SuperAdmin.
// ═══════════════════════════════════════════════════════════════════════════

interface PlansValue {
  catalog: PlanCatalog
  plans: Plan[]
  /** Los que se muestran en la página pública de precios. */
  publicPlans: Plan[]
  ready: boolean
  getPlan: (planId: PlanId | null | undefined) => Plan
  /** El plan más barato que incluye esta funcionalidad. */
  minimumPlanFor: (feature: FeatureKey) => Plan
}

const PlansContext = createContext<PlansValue | null>(null)

export function PlansProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<PlanCatalog>(DEFAULT_PLANS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    void (async () => {
      try {
        // En modo demostración el catálogo se siembra con los valores por
        // defecto la primera vez. En Firestore real lo crea el despliegue.
        if (isMockDriver) await ensurePlanCatalog()
        if (cancelled) return
        unsubscribe = watchPlanCatalog((next) => {
          setCatalog(next)
          setReady(true)
        })
      } catch (err) {
        // Si el catálogo no se puede leer, se opera con los valores por
        // defecto: es preferible a dejar la aplicación sin planes.
        console.warn('[EasyGym] No se pudo cargar el catálogo de planes:', err)
        setReady(true)
      }
    })()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const value = useMemo<PlansValue>(
    () => ({
      catalog,
      plans: PLAN_ORDER.map((id) => catalog[id]).filter(Boolean),
      publicPlans: pickPublicPlans(catalog),
      ready,
      getPlan: (planId) => catalog[planId ?? 'STARTER'] ?? DEFAULT_PLANS.STARTER,
      minimumPlanFor: (feature) => pickMinimumPlan(catalog, feature),
    }),
    [catalog, ready],
  )

  return <PlansContext.Provider value={value}>{children}</PlansContext.Provider>
}

export function usePlans(): PlansValue {
  const ctx = useContext(PlansContext)
  if (!ctx) throw new Error('usePlans debe usarse dentro de <PlansProvider>')
  return ctx
}
