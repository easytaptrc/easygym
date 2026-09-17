// ═══════════════════════════════════════════════════════════════════════════
// Piezas compartidas por todas las gráficas.
//
// Las gráficas son SVG a mano, sin librería: el bundle no crece y el control
// sobre marcas, ejes y accesibilidad es total.
//
// La paleta de series está verificada para fondo oscuro (banda de luminosidad,
// croma mínimo, separación para daltonismo y contraste contra la superficie).
// El orden es FIJO: filtrar series nunca repinta a las que quedan.
// ═══════════════════════════════════════════════════════════════════════════

/** Superficie sobre la que se dibuja (la de `.card`). */
export const CHART_SURFACE = '#0B0F16'

/** Serie categórica, en orden fijo. */
export const SERIES_COLORS = ['#17A45B', '#2E93C8', '#C08211', '#C2568C', '#8A57D6'] as const

/** Tinta de ejes, rejilla y textos. Nunca se usa el color de la serie en texto. */
export const INK = {
  grid: 'rgba(255,255,255,.055)',
  axis: 'rgba(255,255,255,.12)',
  label: '#6C7E97',
  strong: '#C3CDDC',
} as const

export interface Point {
  label: string
  value: number
  key?: string
}

export interface Padding {
  top: number
  right: number
  bottom: number
  left: number
}

/** Escala lineal simple dominio → rango. */
export function scale(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0 || 1
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0)
}

/**
 * Techo "bonito" para el eje Y: 1, 2, 2.5 o 5 × 10ⁿ.
 * Evita ejes que terminan en 8 731 y hace comparables dos gráficas.
 */
export function niceMax(max: number): number {
  if (max <= 0) return 1
  const exp = Math.floor(Math.log10(max))
  const base = 10 ** exp
  const n = max / base
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * base
}

/**
 * Marcas del eje Y, incluidos 0 y el techo.
 *
 * Elige el número de divisiones que da pasos redondos: un eje que va
 * 0 · 16.667 · 33.333 · 50 no lo lee nadie. Prefiere `count` divisiones, y
 * si no salen exactas prueba 5, 4, 3 y 2 antes de rendirse.
 */
export function ticks(max: number, count = 4): number[] {
  const top = niceMax(max)
  // Dominios pequeños (0–4 asistencias): una marca por unidad.
  if (top <= count) {
    const d = Math.max(1, Math.round(top))
    return Array.from({ length: d + 1 }, (_, i) => (top / d) * i)
  }
  const divisions = [count, 5, 4, 3, 2].find((c) => Number.isInteger(top / c)) ?? count
  return Array.from({ length: divisions + 1 }, (_, i) => (top / divisions) * i)
}

/**
 * Trazo suavizado (Catmull-Rom → Bézier). La tensión baja evita los
 * sobreimpulsos que inventan valores que no existen en los datos.
 */
export function smoothPath(pts: Array<[number, number]>, tension = 0.22): string {
  if (pts.length === 0) return ''
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) * tension
    const c1y = p1[1] + (p2[1] - p0[1]) * tension
    const c2x = p2[0] - (p3[0] - p1[0]) * tension
    const c2y = p2[1] - (p3[1] - p1[1]) * tension
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`
  }
  return d
}

/** Reparte etiquetas del eje X sin que se encimen. */
export function labelStride(count: number, maxLabels: number): number {
  return Math.max(1, Math.ceil(count / maxLabels))
}

/** Arco de dona en coordenadas SVG. */
export function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number,
): string {
  const large = endAngle - startAngle > Math.PI ? 1 : 0
  const x = (r: number, a: number) => cx + r * Math.cos(a)
  const y = (r: number, a: number) => cy + r * Math.sin(a)
  return [
    `M${x(rOuter, startAngle)},${y(rOuter, startAngle)}`,
    `A${rOuter},${rOuter} 0 ${large} 1 ${x(rOuter, endAngle)},${y(rOuter, endAngle)}`,
    `L${x(rInner, endAngle)},${y(rInner, endAngle)}`,
    `A${rInner},${rInner} 0 ${large} 0 ${x(rInner, startAngle)},${y(rInner, startAngle)}`,
    'Z',
  ].join(' ')
}
