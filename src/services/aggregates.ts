import type {
  DailyStat,
  GymCounters,
  MemberStatus,
  Millis,
  PaymentMethod,
  RevenueCategory,
} from '@/types'
import { dayKey } from '@/lib/date'
import { computeStatus } from '@/lib/memberStatus'
import { platform, type TenantRepo } from './db'

// ═══════════════════════════════════════════════════════════════════════════
// Agregados: contadores y resúmenes diarios.
//
// EL PROBLEMA QUE RESUELVEN
//
// Un panel que dice "1 284 socios activos" tiene dos formas de saberlo:
//
//   a) leer los 1 284 documentos y contarlos  → 1 284 lecturas, cada vez
//   b) leer UN documento que ya lo sabe        → 1 lectura, siempre
//
// Con 100 000 socios la opción (a) no es lenta: es cara e inviable. Firestore
// factura por documento leído, y el panel se abre decenas de veces al día.
//
// CÓMO SE MANTIENEN
//
//   · `counters/{gymId}`            → cardinalidades (socios por estado, staff…)
//   · `dailyStats/{gymId}_{fecha}`  → un documento por gimnasio y día
//
// Cada operación del negocio (cobrar, dar de alta, marcar entrada) suma su
// delta. El panel de un año lee 365 documentos pequeños en lugar de 200 000
// pagos.
//
// POR QUÉ SON "BEST-EFFORT"
//
// Un agregado es dato DERIVADO. Si falla el incremento, el cobro ya ocurrió y
// debe quedar registrado igual: nunca se bloquea una venta porque un contador
// no se pudo actualizar. La deriva se corrige con `rebuildAggregates()`, que
// recalcula todo desde los documentos originales.
//
// EN PRODUCCIÓN
//
// Estos incrementos los hace el SERVIDOR con `FieldValue.increment()` desde
// triggers de Firestore (ver `functions/src/aggregates.ts`). Así son atómicos
// de verdad, no dependen de que el cliente termine la operación, y las reglas
// pueden prohibir que el navegador escriba estas colecciones.
// ═══════════════════════════════════════════════════════════════════════════

export const dailyStatId = (gymId: string, date: string) => `${gymId}_${date}`

// ─────────────────────────────── Contadores ─────────────────────────────────

export function emptyCounters(gymId: string): GymCounters {
  return {
    id: gymId,
    gymId,
    members: { total: 0, active: 0, nearExpiration: 0, expired: 0, inactive: 0 },
    staff: 0,
    classes: 0,
    products: 0,
    branches: 0,
    rebuiltAt: 0,
    updatedAt: Date.now(),
  }
}

/** Clave dentro de `counters.members` para cada estado de socio. */
const STATUS_KEY: Record<MemberStatus, keyof GymCounters['members']> = {
  ACTIVE: 'active',
  NEAR_EXPIRATION: 'nearExpiration',
  EXPIRED: 'expired',
  INACTIVE: 'inactive',
}

export interface CounterDelta {
  membersTotal?: number
  /** Movimientos entre estados: { ACTIVE: +1, EXPIRED: -1 } */
  memberStatus?: Partial<Record<MemberStatus, number>>
  staff?: number
  classes?: number
  products?: number
  branches?: number
}

/**
 * Aplica deltas al contador del gimnasio, dentro de una transacción.
 *
 * Nunca lanza: los agregados son derivados y no deben tumbar la operación que
 * los origina. Si algo falla, queda el aviso en consola y `rebuildAggregates`
 * lo arregla.
 */
export async function bumpCounters(gymId: string, delta: CounterDelta): Promise<void> {
  try {
    await platform.transaction(async (tx) => {
      const current = (await tx.get<GymCounters>('counters', gymId)) ?? emptyCounters(gymId)
      const members = { ...current.members }

      members.total = Math.max(0, members.total + (delta.membersTotal ?? 0))
      for (const [status, n] of Object.entries(delta.memberStatus ?? {})) {
        const key = STATUS_KEY[status as MemberStatus]
        members[key] = Math.max(0, members[key] + (n ?? 0))
      }

      const next: GymCounters = {
        ...current,
        id: gymId,
        gymId,
        members,
        staff: Math.max(0, current.staff + (delta.staff ?? 0)),
        classes: Math.max(0, current.classes + (delta.classes ?? 0)),
        products: Math.max(0, current.products + (delta.products ?? 0)),
        branches: Math.max(0, current.branches + (delta.branches ?? 0)),
        updatedAt: Date.now(),
      }
      tx.create('counters', next)
    })
  } catch (err) {
    console.warn('[EasyGym] No se pudo actualizar el contador del gimnasio:', err)
  }
}

/** Un socio cambió de estado: mueve una unidad de un cubo al otro. */
export function memberStatusMoved(from: MemberStatus | null, to: MemberStatus | null): CounterDelta {
  const memberStatus: Partial<Record<MemberStatus, number>> = {}
  if (from && from !== to) memberStatus[from] = (memberStatus[from] ?? 0) - 1
  if (to && to !== from) memberStatus[to] = (memberStatus[to] ?? 0) + 1
  return { memberStatus }
}

export function readCounters(gymId: string): Promise<GymCounters | null> {
  return platform.get('counters', gymId)
}

export function watchCounters(gymId: string, cb: (c: GymCounters | null) => void) {
  return platform.watch('counters', { where: [{ field: 'id', op: '==', value: gymId }] }, (rows) =>
    cb(rows[0] ?? null),
  )
}

// ────────────────────────────── Resumen diario ──────────────────────────────

export function emptyDailyStat(gymId: string, date: string): DailyStat {
  return {
    id: dailyStatId(gymId, date),
    gymId,
    date,
    revenue: { MEMBERSHIP: 0, RENEWAL: 0, VISIT: 0, PRODUCT: 0, OTHER: 0 },
    revenueTotal: 0,
    byMethod: {},
    byHour: {},
    visits: 0,
    attendance: 0,
    newMemberships: 0,
    renewals: 0,
    newMembers: 0,
    reservations: 0,
    updatedAt: Date.now(),
  }
}

export interface DailyDelta {
  revenue?: Partial<Record<RevenueCategory, number>>
  byMethod?: Partial<Record<PaymentMethod, number>>
  /** Hora del día (0–23) de una asistencia. */
  hour?: number
  visits?: number
  attendance?: number
  newMemberships?: number
  renewals?: number
  newMembers?: number
  reservations?: number
}

/** Suma deltas al resumen del día. No lanza: ver la nota de arriba. */
export async function bumpDaily(gymId: string, date: string, delta: DailyDelta): Promise<void> {
  try {
    await platform.transaction(async (tx) => {
      const id = dailyStatId(gymId, date)
      const current = (await tx.get<DailyStat>('dailyStats', id)) ?? emptyDailyStat(gymId, date)

      const revenue = { ...current.revenue }
      let revenueTotal = current.revenueTotal
      for (const [cat, amount] of Object.entries(delta.revenue ?? {})) {
        revenue[cat as RevenueCategory] += amount ?? 0
        revenueTotal += amount ?? 0
      }

      const byMethod = { ...current.byMethod }
      for (const [method, amount] of Object.entries(delta.byMethod ?? {})) {
        byMethod[method as PaymentMethod] = (byMethod[method as PaymentMethod] ?? 0) + (amount ?? 0)
      }

      const byHour = { ...current.byHour }
      if (delta.hour !== undefined) {
        const k = String(delta.hour)
        byHour[k] = (byHour[k] ?? 0) + 1
      }

      tx.create('dailyStats', {
        ...current,
        id,
        gymId,
        date,
        revenue,
        revenueTotal,
        byMethod,
        byHour,
        visits: current.visits + (delta.visits ?? 0),
        attendance: current.attendance + (delta.attendance ?? 0),
        newMemberships: current.newMemberships + (delta.newMemberships ?? 0),
        renewals: current.renewals + (delta.renewals ?? 0),
        newMembers: current.newMembers + (delta.newMembers ?? 0),
        reservations: current.reservations + (delta.reservations ?? 0),
        updatedAt: Date.now(),
      } satisfies DailyStat)
    })
  } catch (err) {
    console.warn('[EasyGym] No se pudo actualizar el resumen diario:', err)
  }
}

/**
 * Resúmenes diarios entre dos fechas.
 *
 * Es una consulta acotada por rango sobre `date`, con su índice compuesto
 * (gymId ASC, date ASC). Un año son 365 documentos.
 */
export async function readDailyRange(gymId: string, fromKey: string, toKey: string): Promise<DailyStat[]> {
  const rows = await platform.list('dailyStats', {
    where: [
      { field: 'gymId', op: '==', value: gymId },
      { field: 'date', op: '>=', value: fromKey },
      { field: 'date', op: '<=', value: toKey },
    ],
    orderBy: { field: 'date', dir: 'asc' },
  })
  return rows
}

export function watchDailyRange(
  gymId: string,
  fromKey: string,
  toKey: string,
  cb: (rows: DailyStat[]) => void,
) {
  return platform.watch(
    'dailyStats',
    {
      where: [
        { field: 'gymId', op: '==', value: gymId },
        { field: 'date', op: '>=', value: fromKey },
        { field: 'date', op: '<=', value: toKey },
      ],
      orderBy: { field: 'date', dir: 'asc' },
    },
    cb,
  )
}

// ──────────────────────── Reconstrucción desde cero ─────────────────────────

/**
 * Recalcula contadores y resúmenes diarios recorriendo los documentos reales.
 *
 * Es la operación cara (lee todo el gimnasio) y por eso es MANUAL: se ejecuta
 * al sembrar la demo, tras una migración, o desde el botón «Recalcular» de
 * /configuracion cuando se sospecha deriva.
 *
 * En producción vive en una Cloud Function invocable, no en el navegador.
 */
export async function rebuildAggregates(
  repo: TenantRepo,
  nearExpirationDays = 7,
): Promise<{ counters: GymCounters; days: number }> {
  const gymId = repo.gymId
  const [members, payments, visits, attendance, memberships, reservations, classes, products, branches] =
    await Promise.all([
      repo.list('members'),
      repo.list('payments'),
      repo.list('visits'),
      repo.list('attendance'),
      repo.list('memberships'),
      repo.list('reservations'),
      repo.list('classes'),
      repo.list('products'),
      repo.list('branches'),
    ])

  // ── Contadores ──
  const counters = emptyCounters(gymId)
  counters.members.total = members.length
  for (const m of members) {
    counters.members[STATUS_KEY[computeStatus(m, nearExpirationDays)]]++
  }
  counters.classes = classes.length
  counters.products = products.length
  counters.branches = branches.length
  const staffUsers = await platform.list('users', {
    where: [{ field: 'gymId', op: '==', value: gymId }],
  })
  counters.staff = staffUsers.filter((u) => u.role !== 'MEMBER').length
  counters.rebuiltAt = Date.now()
  counters.updatedAt = Date.now()
  await platform.create('counters', counters)

  // ── Resúmenes diarios ──
  const byDay = new Map<string, DailyStat>()
  const ensure = (date: string) => {
    let d = byDay.get(date)
    if (!d) {
      d = emptyDailyStat(gymId, date)
      byDay.set(date, d)
    }
    return d
  }

  for (const p of payments) {
    if (p.status !== 'PAID') continue
    const d = ensure(dayKey(p.createdAt))
    d.revenue[p.category] += p.amount
    d.revenueTotal += p.amount
    d.byMethod[p.method] = (d.byMethod[p.method] ?? 0) + p.amount
  }
  for (const v of visits) ensure(v.date).visits++
  for (const a of attendance) {
    if (!a.granted) continue
    const d = ensure(a.date)
    d.attendance++
    const hour = String(Number(a.time.split(':')[0]))
    d.byHour[hour] = (d.byHour[hour] ?? 0) + 1
  }
  for (const m of memberships) {
    const d = ensure(dayKey(m.createdAt))
    if (m.kind === 'RENEWAL') d.renewals++
    else d.newMemberships++
  }
  for (const m of members) ensure(dayKey(m.createdAt)).newMembers++
  for (const r of reservations) {
    if (r.status !== 'CANCELLED') ensure(dayKey(r.createdAt)).reservations++
  }

  for (const stat of byDay.values()) {
    stat.updatedAt = Date.now()
    await platform.create('dailyStats', stat)
  }

  return { counters, days: byDay.size }
}

/** Contadores vacíos listos para pintar mientras carga el documento real. */
export const ZERO_COUNTERS: GymCounters['members'] = {
  total: 0,
  active: 0,
  nearExpiration: 0,
  expired: 0,
  inactive: 0,
}

export type { Millis }
