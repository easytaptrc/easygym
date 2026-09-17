import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { AppUser, FeatureKey, Gym, GymSettings, Member } from '@/types'
import { hasFeature as planHasFeature } from '@/config/plans'
import { auth, can, type Permission } from '@/services/auth'
import { platform, repoFor, isMockDriver, type TenantRepo } from '@/services/db'
import { ensureSeed } from '@/data/seed'
import { setAuditActor } from '@/services/audit'
import { setOperatingGym } from '@/services/gymStatus'
import { applyGymTheme, resetTheme } from '@/lib/theme'

// ═══════════════════════════════════════════════════════════════════════════
// Sesión: usuario + gimnasio + configuración + repositorio acotado.
//
// El `repo` que sale de aquí ya está atado al gymId del usuario. Ninguna
// pantalla elige su tenant: lo recibe. Así no existe el error de "olvidé
// filtrar por gimnasio", porque no hay forma de escribirlo.
// ═══════════════════════════════════════════════════════════════════════════

interface SessionValue {
  ready: boolean
  user: AppUser | null
  gym: Gym | null
  settings: GymSettings | null
  /** Documento del socio, cuando el usuario es un MEMBER. */
  member: Member | null
  repo: TenantRepo | null
  isMock: boolean

  signIn: (email: string, password: string) => Promise<AppUser>
  signInAsDemo: (uid: string) => Promise<AppUser>
  signOut: () => Promise<void>
  /** Recarga gimnasio, configuración y socio desde la base. */
  refresh: () => Promise<void>
  /** El SUPERADMIN puede mirar dentro de un gimnasio concreto. */
  impersonateGym: (gymId: string | null) => Promise<void>
  impersonatedGymId: string | null

  can: (permission: Permission) => boolean
  hasFeature: (feature: FeatureKey) => boolean
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<AppUser | null>(null)
  const [gym, setGym] = useState<Gym | null>(null)
  const [settings, setSettings] = useState<GymSettings | null>(null)
  const [member, setMember] = useState<Member | null>(null)
  const [impersonatedGymId, setImpersonatedGymId] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // La bitácora necesita saber quién está operando. Se fija aquí, una vez, en
  // lugar de que cada función de servicio arrastre un parámetro `actor` hasta
  // el fondo: en una aplicación de una sola página hay una sesión por pestaña,
  // y un parámetro que se puede olvidar acaba olvidándose.
  useEffect(() => {
    setAuditActor(user ? { uid: user.uid, name: user.name, role: user.role } : null)
  }, [user])

  // Mismo motivo para el estado de la suscripción: los servicios reciben un
  // repositorio, no el gimnasio, y necesitan poder negarse a escribir cuando
  // la cuenta está suspendida.
  useEffect(() => {
    setOperatingGym(gym)
  }, [gym])

  /** gymId efectivo: el del usuario, o el que el SuperAdmin está mirando. */
  const effectiveGymId = useMemo(() => {
    if (user?.role === 'SUPERADMIN') return impersonatedGymId
    return user?.gymId || null
  }, [user, impersonatedGymId])

  const repo = useMemo(() => (effectiveGymId ? repoFor(effectiveGymId) : null), [effectiveGymId])

  const loadContext = useCallback(async (nextUser: AppUser | null, gymId: string | null) => {
    if (!gymId) {
      setGym(null)
      setSettings(null)
      setMember(null)
      resetTheme()
      return
    }
    const [g, s] = await Promise.all([platform.get('gyms', gymId), platform.get('settings', gymId)])
    if (!mounted.current) return
    setGym(g)
    setSettings(s)
    if (g) applyGymTheme(g.branding)

    if (nextUser?.role === 'MEMBER' && nextUser.memberId) {
      const m = await repoFor(gymId).get('members', nextUser.memberId)
      if (mounted.current) setMember(m)
    } else {
      setMember(null)
    }
  }, [])

  // Arranque: siembra la demo si hace falta y restaura la sesión.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (isMockDriver) await ensureSeed()
        const current = await auth.current()
        if (cancelled) return
        setUser(current)
        await loadContext(current, current?.role === 'SUPERADMIN' ? null : (current?.gymId ?? null))
      } catch (err) {
        console.error('[EasyGym] Fallo al iniciar la sesión:', err)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadContext])

  // El gimnasio y su configuración se escuchan en vivo: si el dueño cambia el
  // color de marca o el plan, la pantalla se entera sola.
  useEffect(() => {
    if (!effectiveGymId) return
    const offGym = platform.watch('gyms', { where: [{ field: 'id', op: '==', value: effectiveGymId }] }, (rows) => {
      const g = rows[0] ?? null
      setGym(g)
      if (g) applyGymTheme(g.branding)
    })
    const offSettings = platform.watch(
      'settings',
      { where: [{ field: 'gymId', op: '==', value: effectiveGymId }] },
      (rows) => setSettings(rows[0] ?? null),
    )
    return () => {
      offGym()
      offSettings()
    }
  }, [effectiveGymId])

  // El socio también se escucha: al renovar, su portal se actualiza al vuelo.
  useEffect(() => {
    if (!effectiveGymId || user?.role !== 'MEMBER' || !user.memberId) return
    return repoFor(effectiveGymId).watch(
      'members',
      { where: [{ field: 'id', op: '==', value: user.memberId }] },
      (rows) => setMember(rows[0] ?? null),
    )
  }, [effectiveGymId, user])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const u = await auth.signIn({ email, password })
      setUser(u)
      setImpersonatedGymId(null)
      await loadContext(u, u.role === 'SUPERADMIN' ? null : u.gymId)
      return u
    },
    [loadContext],
  )

  const signInAsDemo = useCallback(
    async (uid: string) => {
      const u = await auth.signInAsDemo(uid)
      setUser(u)
      setImpersonatedGymId(null)
      await loadContext(u, u.role === 'SUPERADMIN' ? null : u.gymId)
      return u
    },
    [loadContext],
  )

  const signOut = useCallback(async () => {
    await auth.signOut()
    setUser(null)
    setGym(null)
    setSettings(null)
    setMember(null)
    setImpersonatedGymId(null)
    resetTheme()
  }, [])

  const refresh = useCallback(async () => {
    const current = await auth.current()
    setUser(current)
    await loadContext(current, effectiveGymId)
  }, [effectiveGymId, loadContext])

  const impersonateGym = useCallback(
    async (gymId: string | null) => {
      setImpersonatedGymId(gymId)
      await loadContext(user, gymId)
    },
    [user, loadContext],
  )

  const value = useMemo<SessionValue>(
    () => ({
      ready,
      user,
      gym,
      settings,
      member,
      repo,
      isMock: isMockDriver,
      signIn,
      signInAsDemo,
      signOut,
      refresh,
      impersonateGym,
      impersonatedGymId,
      can: (permission) => can(user, permission),
      hasFeature: (feature) => planHasFeature(gym, feature),
    }),
    [
      ready,
      user,
      gym,
      settings,
      member,
      repo,
      signIn,
      signInAsDemo,
      signOut,
      refresh,
      impersonateGym,
      impersonatedGymId,
    ],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession debe usarse dentro de <SessionProvider>')
  return ctx
}

/** Repositorio del gimnasio activo. Lanza si no hay gimnasio en contexto. */
export function useRepo(): TenantRepo {
  const { repo } = useSession()
  if (!repo) throw new Error('No hay un gimnasio activo en la sesión')
  return repo
}
