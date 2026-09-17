import type { Millis, Weekday } from '@/types'

export const DAY_MS = 86_400_000

export const WEEKDAYS_ES: Record<Weekday, string> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
}

export const WEEKDAYS_SHORT: Record<Weekday, string> = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
}

export const ALL_WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 0]

const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

export const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

// ────────────────────────────── Claves de día ───────────────────────────────
// Se usa YYYY-MM-DD en hora LOCAL (no UTC) porque un gimnasio razona en su
// propio huso: "las ventas del martes" son las del martes ahí, no en UTC.

export function dayKey(d: Date | Millis = Date.now()): string {
  const date = typeof d === 'number' ? new Date(d) : d
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function timeKey(d: Date | Millis = Date.now()): string {
  const date = typeof d === 'number' ? new Date(d) : d
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** "2026-03-14" → Date a las 00:00 locales. */
export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** Combina "2026-03-14" + "19:30" → epoch ms locales. */
export function combine(date: string, time: string): Millis {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0).getTime()
}

export function startOfDay(d: Date | Millis = Date.now()): Millis {
  const date = typeof d === 'number' ? new Date(d) : new Date(d.getTime())
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function endOfDay(d: Date | Millis = Date.now()): Millis {
  const date = typeof d === 'number' ? new Date(d) : new Date(d.getTime())
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

export function addDays(d: Date | Millis, days: number): Millis {
  const date = typeof d === 'number' ? new Date(d) : new Date(d.getTime())
  date.setDate(date.getDate() + days)
  return date.getTime()
}

export function addMonths(d: Date | Millis, months: number): Millis {
  const date = typeof d === 'number' ? new Date(d) : new Date(d.getTime())
  const day = date.getDate()
  date.setMonth(date.getMonth() + months)
  // Evita el salto 31 de enero → 3 de marzo
  if (date.getDate() < day) date.setDate(0)
  return date.getTime()
}

/** Semana que empieza en LUNES (convención mexicana). */
export function startOfWeek(d: Date | Millis = Date.now()): Millis {
  const date = typeof d === 'number' ? new Date(d) : new Date(d.getTime())
  const dow = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - dow)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function startOfMonth(d: Date | Millis = Date.now()): Millis {
  const date = typeof d === 'number' ? new Date(d) : new Date(d.getTime())
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

export function endOfMonth(d: Date | Millis = Date.now()): Millis {
  const date = typeof d === 'number' ? new Date(d) : new Date(d.getTime())
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999).getTime()
}

export function startOfYear(d: Date | Millis = Date.now()): Millis {
  const date = typeof d === 'number' ? new Date(d) : new Date(d.getTime())
  return new Date(date.getFullYear(), 0, 1).getTime()
}

export function weekdayOf(dateKey: string): Weekday {
  return fromDayKey(dateKey).getDay() as Weekday
}

// ──────────────────────────────── Formato ───────────────────────────────────

export function fmtDate(ms: Millis | null | undefined): string {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

export function fmtDateLong(ms: Millis | null | undefined): string {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${d.getDate()} de ${MONTHS_ES[d.getMonth()]} de ${d.getFullYear()}`
}

export function fmtDateTime(ms: Millis | null | undefined): string {
  if (!ms) return '—'
  return `${fmtDate(ms)} · ${timeKey(ms)}`
}

/** "2026-03-14" → "14 Mar 2026" */
export function fmtDayKey(key: string | null | undefined): string {
  if (!key) return '—'
  return fmtDate(fromDayKey(key).getTime())
}

/** "hace 3 días", "en 12 días", "hoy" */
export function relativeDays(ms: Millis | null | undefined): string {
  if (!ms) return '—'
  const diff = Math.round((startOfDay(ms) - startOfDay()) / DAY_MS)
  if (diff === 0) return 'hoy'
  if (diff === 1) return 'mañana'
  if (diff === -1) return 'ayer'
  return diff > 0 ? `en ${diff} días` : `hace ${Math.abs(diff)} días`
}

/** Días completos que faltan para `ms`. Negativo si ya pasó. */
export function daysUntil(ms: Millis | null | undefined): number {
  if (!ms) return 0
  return Math.round((startOfDay(ms) - startOfDay()) / DAY_MS)
}

/** "19:30" → "7:30 PM" */
export function fmt12h(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

export function ageFrom(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null
  const b = fromDayKey(birthDate)
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--
  return age
}

// ─────────────────────────── Rangos para reportes ───────────────────────────

export type RangePreset = 'today' | 'week' | 'month' | 'year' | 'custom'

export interface DateRange {
  from: Millis
  to: Millis
  label: string
  preset: RangePreset
}

export function presetRange(preset: Exclude<RangePreset, 'custom'>, ref: Millis = Date.now()): DateRange {
  switch (preset) {
    case 'today':
      return { from: startOfDay(ref), to: endOfDay(ref), label: 'Hoy', preset }
    case 'week':
      return { from: startOfWeek(ref), to: endOfDay(ref), label: 'Esta semana', preset }
    case 'month':
      return { from: startOfMonth(ref), to: endOfMonth(ref), label: 'Este mes', preset }
    case 'year':
      return { from: startOfYear(ref), to: endOfDay(ref), label: 'Este año', preset }
  }
}

export function customRange(fromKey: string, toKey: string): DateRange {
  return {
    from: startOfDay(fromDayKey(fromKey).getTime()),
    to: endOfDay(fromDayKey(toKey).getTime()),
    label: `${fmtDayKey(fromKey)} — ${fmtDayKey(toKey)}`,
    preset: 'custom',
  }
}

export function inRange(ms: Millis, range: DateRange): boolean {
  return ms >= range.from && ms <= range.to
}

/**
 * Serie de días para las gráficas. Máximo `maxPoints` puntos.
 *
 * Se recorta en HOY: dibujar los días que todavía no han llegado los pintaría
 * en cero y haría parecer que el negocio se desplomó a mitad de mes.
 */
export function daySeries(range: DateRange, maxPoints = 31): string[] {
  const out: string[] = []
  const end = Math.min(range.to, endOfDay())
  if (end < range.from) return [dayKey(range.from)]
  const span = Math.ceil((end - range.from) / DAY_MS)
  const step = Math.max(1, Math.ceil(span / maxPoints))
  for (let t = range.from; t <= end; t = addDays(t, step)) out.push(dayKey(t))
  return out
}
