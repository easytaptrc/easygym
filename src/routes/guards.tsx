import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { Role } from '@/types'
import { homeFor, type Permission } from '@/services/auth'
import { useSession } from '@/state/SessionContext'
import { FullPageLoader } from '@/components/ui/Feedback'
import { UpgradeNotice } from '@/components/PlanGuard'
import type { FeatureKey } from '@/types'

/** Exige sesión iniciada. Guarda a dónde iba para volver tras el login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, user } = useSession()
  const location = useLocation()
  if (!ready) return <FullPageLoader />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <>{children}</>
}

/** Exige uno de estos roles. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { ready, user } = useSession()
  if (!ready) return <FullPageLoader />
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />
  return <>{children}</>
}

/** Exige un permiso concreto. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission
  children: ReactNode
}) {
  const { ready, user, can } = useSession()
  if (!ready) return <FullPageLoader />
  if (!user) return <Navigate to="/login" replace />
  if (!can(permission)) return <Navigate to={homeFor(user)} replace />
  return <>{children}</>
}

/** Exige que el plan incluya la función. Si no, muestra la invitación a mejorar. */
export function RequireFeature({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  const { ready, hasFeature } = useSession()
  if (!ready) return <FullPageLoader />
  if (!hasFeature(feature)) {
    return (
      <div className="py-10">
        <UpgradeNotice feature={feature} />
      </div>
    )
  }
  return <>{children}</>
}

/** Si ya hay sesión, no tiene sentido ver /login o /registro. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { ready, user } = useSession()
  if (!ready) return <FullPageLoader />
  if (user) return <Navigate to={homeFor(user)} replace />
  return <>{children}</>
}
