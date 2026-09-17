import { useMemo, useState } from 'react'
import { cx } from '@/lib/utils'
import { arcPath, CHART_SURFACE } from './primitives'

// Dona de composición (ventas por categoría).
//
// Con leyenda SIEMPRE, porque hay ≥2 series, y con etiqueta directa del valor
// destacado en el centro. Los segmentos llevan 2px de separación del color de
// la superficie: es lo que permite distinguir dos categorías contiguas aunque
// el lector no perciba bien esos dos tonos.

export interface Slice {
  key: string
  label: string
  value: number
  color: string
}

interface Props {
  data: Slice[]
  format: (v: number) => string
  size?: number
  className?: string
  /** Texto bajo el total en el centro. */
  centerLabel?: string
}

const GAP_RAD = 0.022 // ≈ 2px de separación a radio 90

export function DonutChart({ data, format, size = 190, className, centerLabel = 'Total' }: Props) {
  const [hover, setHover] = useState<string | null>(null)

  const slices = useMemo(() => data.filter((d) => d.value > 0), [data])
  const total = useMemo(() => slices.reduce((a, s) => a + s.value, 0), [slices])

  const cx0 = size / 2
  const cy0 = size / 2
  const rOuter = size / 2 - 4
  const rInner = rOuter * 0.63

  const arcs = useMemo(() => {
    if (total <= 0) return []
    let angle = -Math.PI / 2
    return slices.map((s) => {
      const sweep = (s.value / total) * Math.PI * 2
      const start = angle + (slices.length > 1 ? GAP_RAD / 2 : 0)
      const end = angle + sweep - (slices.length > 1 ? GAP_RAD / 2 : 0)
      angle += sweep
      return { ...s, d: arcPath(cx0, cy0, rOuter, rInner, start, Math.max(start + 0.001, end)) }
    })
  }, [slices, total, cx0, cy0, rOuter, rInner])

  const active = hover ? slices.find((s) => s.key === hover) : null
  const shown = active ?? { label: centerLabel, value: total }

  if (total <= 0) {
    return (
      <div className={cx('flex items-center justify-center py-10 text-sm text-ink-500', className)}>
        Sin ventas en este periodo
      </div>
    )
  }

  return (
    <div className={cx('flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label="Ventas por categoría">
          {arcs.map((a) => (
            <path
              key={a.key}
              d={a.d}
              fill={a.color}
              stroke={CHART_SURFACE}
              strokeWidth={2}
              opacity={hover && hover !== a.key ? 0.34 : 1}
              className="cursor-pointer transition-opacity duration-150"
              onMouseEnter={() => setHover(a.key)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        {/* Etiqueta directa en el centro */}
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <p className="text-[17px] font-bold text-ink-50 tnum">{format(shown.value)}</p>
          <p className="mt-0.5 max-w-[92px] text-[11px] leading-tight text-ink-400">{shown.label}</p>
        </div>
      </div>

      {/* Leyenda: identidad nunca queda solo en el color */}
      <ul className="w-full min-w-0 space-y-1.5">
        {slices.map((s) => {
          const pct = (s.value / total) * 100
          return (
            <li
              key={s.key}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
              className={cx(
                'flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors',
                hover === s.key ? 'bg-white/[.05]' : 'hover:bg-white/[.03]',
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-200">{s.label}</span>
              <span className="shrink-0 text-[12.5px] font-semibold text-ink-100 tnum">{format(s.value)}</span>
              <span className="w-10 shrink-0 text-right text-[11.5px] text-ink-500 tnum">{pct.toFixed(0)}%</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
