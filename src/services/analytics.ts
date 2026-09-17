import { dayKey, daySeries, fromDayKey, MONTHS_SHORT, type DateRange } from '@/lib/date'

// ═══════════════════════════════════════════════════════════════════════════
// Utilidades de análisis.
//
// Lo que antes vivía aquí —sumar pagos, contar socios por estado, calcular
// ingresos de un periodo— se movió a `services/aggregates.ts`, porque hacerlo
// recorriendo documentos no escala. Este archivo conserva solo las piezas
// PURAS que siguen teniendo sentido sobre conjuntos ya acotados.
// ═══════════════════════════════════════════════════════════════════════════

export interface SeriesPoint {
  key: string
  label: string
  value: number
}

/** "2026-09-16" → "16 Sep" */
export function shortDayLabel(key: string): string {
  const d = fromDayKey(key)
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}

/**
 * Serie diaria de un conteo sobre una lista YA acotada.
 *
 * Se usa en el portal del socio, donde el conjunto es pequeño por definición
 * (las asistencias de una sola persona). Para el panel del gimnasio hay que
 * usar `useDailyStats`, que lee resúmenes precalculados.
 */
export function countSeries(
  items: Array<{ date?: string; createdAt?: number }>,
  range: DateRange,
): SeriesPoint[] {
  const buckets = new Map<string, number>()
  for (const k of daySeries(range, 62)) buckets.set(k, 0)
  for (const it of items) {
    const k = it.date ?? (it.createdAt ? dayKey(it.createdAt) : null)
    if (k && buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1)
  }
  return [...buckets.entries()].map(([key, value]) => ({ key, label: shortDayLabel(key), value }))
}

// ──────────────────── Comparación contra el periodo anterior ────────────────

/** Rango inmediatamente anterior, de la misma duración. */
export function previousRange(range: DateRange): DateRange {
  const span = range.to - range.from
  return { from: range.from - span - 1, to: range.from - 1, label: 'Periodo anterior', preset: range.preset }
}

/**
 * Variación porcentual. Devuelve `undefined` cuando no hay comparativa
 * posible (el periodo anterior fue cero y el actual no): mostrar "+∞%" o
 * "+100%" ahí sería inventarse un dato.
 */
export function deltaPct(current: number, previous: number): number | undefined {
  if (previous === 0) return current === 0 ? 0 : undefined
  return ((current - previous) / previous) * 100
}
