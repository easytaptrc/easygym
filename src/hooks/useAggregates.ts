import { useEffect, useMemo, useState } from 'react'
import type { DailyStat, GymCounters, RevenueCategory } from '@/types'
import { dayKey, type DateRange } from '@/lib/date'
import { emptyCounters, watchCounters, watchDailyRange } from '@/services/aggregates'
import { useSession } from '@/state/SessionContext'

// ═══════════════════════════════════════════════════════════════════════════
// Lectura de agregados.
//
// Estos hooks son la alternativa escalable a `useCollection('members')`:
// en lugar de traer 100 000 socios para contar cuántos están activos, leen un
// documento de contadores y un puñado de resúmenes diarios.
//
// Coste por apertura del panel:
//   · contadores      → 1 documento
//   · rango de un mes → ≤ 31 documentos
//   · rango de un año → ≤ 366 documentos
//
// Frente a decenas de miles de lecturas con el enfoque ingenuo.
// ═══════════════════════════════════════════════════════════════════════════

export function useCounters(): { counters: GymCounters; loading: boolean } {
  const { gym } = useSession()
  const [counters, setCounters] = useState<GymCounters | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!gym) {
      setCounters(null)
      setLoading(false)
      return
    }
    setLoading(true)
    return watchCounters(gym.id, (c) => {
      setCounters(c)
      setLoading(false)
    })
  }, [gym])

  return {
    counters: counters ?? emptyCounters(gym?.id ?? ''),
    loading,
  }
}

export interface DailyRollup {
  /** Un punto por día del rango, en orden. */
  days: DailyStat[]
  revenueTotal: number
  revenueByCategory: Record<RevenueCategory, number>
  byHour: Record<string, number>
  visits: number
  attendance: number
  newMemberships: number
  renewals: number
  newMembers: number
  reservations: number
  loading: boolean
}

const ZERO_REVENUE: Record<RevenueCategory, number> = {
  MEMBERSHIP: 0,
  RENEWAL: 0,
  VISIT: 0,
  PRODUCT: 0,
  OTHER: 0,
}

/** Resúmenes diarios de un rango, ya sumados. */
export function useDailyStats(range: DateRange): DailyRollup {
  const { gym } = useSession()
  const [days, setDays] = useState<DailyStat[]>([])
  const [loading, setLoading] = useState(true)

  const fromKey = dayKey(range.from)
  const toKey = dayKey(range.to)

  useEffect(() => {
    if (!gym) {
      setDays([])
      setLoading(false)
      return
    }
    setLoading(true)
    return watchDailyRange(gym.id, fromKey, toKey, (rows) => {
      setDays(rows)
      setLoading(false)
    })
  }, [gym, fromKey, toKey])

  return useMemo(() => {
    const revenueByCategory = { ...ZERO_REVENUE }
    const byHour: Record<string, number> = {}
    let revenueTotal = 0
    let visits = 0
    let attendance = 0
    let newMemberships = 0
    let renewals = 0
    let newMembers = 0
    let reservations = 0

    for (const d of days) {
      revenueTotal += d.revenueTotal
      for (const c of Object.keys(revenueByCategory) as RevenueCategory[]) {
        revenueByCategory[c] += d.revenue[c] ?? 0
      }
      for (const [h, n] of Object.entries(d.byHour ?? {})) byHour[h] = (byHour[h] ?? 0) + n
      visits += d.visits
      attendance += d.attendance
      newMemberships += d.newMemberships
      renewals += d.renewals
      newMembers += d.newMembers
      reservations += d.reservations
    }

    return {
      days,
      revenueTotal,
      revenueByCategory,
      byHour,
      visits,
      attendance,
      newMemberships,
      renewals,
      newMembers,
      reservations,
      loading,
    }
  }, [days, loading])
}
