import { useEffect, useState } from 'react'
import type { ActivityLog, AppUser, Gym, GymCounters, Subscription } from '@/types'
import { platform } from '@/services/db'

/**
 * Datos de toda la plataforma.
 *
 * Es el ÚNICO lugar de la aplicación que consulta sin filtrar por gymId, y
 * solo lo alcanzan las rutas protegidas por `RequireRole roles={['SUPERADMIN']}`.
 * Las reglas de Firestore lo vuelven a comprobar: `allow list: if isSuperadmin()`.
 */
/** Roles que se consideran "personal": los que administran un gimnasio. */
const STAFF_ROLES = [
  'SUPERADMIN',
  'OWNER',
  'ADMIN',
  'RECEPCIONISTA',
  'ENTRENADOR',
  'MANTENIMIENTO',
]

export function usePlatformData() {
  const [gyms, setGyms] = useState<Gym[]>([])
  const [users, setUsers] = useState<AppUser[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [activity, setActivity] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const offs = [
      platform.watch('gyms', { orderBy: { field: 'createdAt', dir: 'desc' }, limit: 500 }, (rows) => {
        setGyms(rows as Gym[])
        setLoading(false)
      }),
      // Solo el personal, NO los socios.
      //
      // `users` contiene una fila por cada socio con portal: en una plataforma
      // con 300 gimnasios de 2 000 socios son 600 000 documentos. Lo que estas
      // pantallas necesitan son los dueños y administradores, que son cientos.
      platform.watch(
        'users',
        { where: [{ field: 'role', op: 'in', value: STAFF_ROLES }], limit: 2000 },
        (rows) => setUsers(rows as AppUser[]),
      ),
      platform.watch(
        'subscriptions',
        { orderBy: { field: 'createdAt', dir: 'desc' }, limit: 500 },
        (rows) => setSubscriptions(rows as Subscription[]),
      ),
      platform.watch(
        'activity',
        { orderBy: { field: 'createdAt', dir: 'desc' }, limit: 200 },
        (rows) => setActivity(rows as ActivityLog[]),
      ),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  return { gyms, users, subscriptions, activity, loading }
}

/**
 * Socios por gimnasio, para el panel de plataforma.
 *
 * Lee la colección `counters` —un documento por gimnasio— en vez de recorrer
 * `members`. Con 1 000 gimnasios de 5 000 socios cada uno, la versión ingenua
 * serían 5 millones de lecturas para pintar una tabla; esta son 1 000.
 */
export function useMemberCounts(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})

  useEffect(
    () =>
      platform.watch('counters', { limit: 500 }, (rows) => {
        const next: Record<string, number> = {}
        for (const c of rows) next[c.gymId] = c.members.total
        setCounts(next)
      }),
    [],
  )

  return counts
}

/** Desglose por estado de cada gimnasio, también desde `counters`. */
export function useMemberBreakdowns(): Record<string, GymCounters['members']> {
  const [byGym, setByGym] = useState<Record<string, GymCounters['members']>>({})

  useEffect(
    () =>
      platform.watch('counters', { limit: 500 }, (rows) => {
        const next: Record<string, GymCounters['members']> = {}
        for (const c of rows) next[c.gymId] = c.members
        setByGym(next)
      }),
    [],
  )

  return byGym
}
