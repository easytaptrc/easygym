import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

// Inicialización única del Admin SDK. Con el Admin SDK las reglas de Firestore
// NO aplican: este código pasa por encima de ellas, y por eso todo lo que se
// escribe desde aquí tiene que validarse a mano.

initializeApp()

export const db = getFirestore()
export const auth = getAuth()

/** Roles del producto. Debe coincidir con `src/types/index.ts`. */
export type Role = 'SUPERADMIN' | 'OWNER' | 'ADMIN' | 'RECEPCIONISTA' | 'ENTRENADOR' | 'MEMBER'

export type PlanId = 'STARTER' | 'PRO' | 'BUSINESS' | 'ENTERPRISE'

/** Precio mensual en centavos, por plan. Debe coincidir con config/plans.ts. */
export const PLAN_AMOUNT_CENTS: Record<PlanId, number> = {
  STARTER: 49900,
  PRO: 89900,
  BUSINESS: 149900,
  ENTERPRISE: 0,
}

/** Price IDs de Stripe. Se inyectan como secretos, nunca se escriben aquí. */
export function stripePriceFor(plan: PlanId): string {
  const map: Record<PlanId, string | undefined> = {
    STARTER: process.env.STRIPE_PRICE_STARTER,
    PRO: process.env.STRIPE_PRICE_PRO,
    BUSINESS: process.env.STRIPE_PRICE_BUSINESS,
    ENTERPRISE: undefined,
  }
  const price = map[plan]
  if (!price) throw new Error(`No hay price de Stripe configurado para el plan ${plan}`)
  return price
}
