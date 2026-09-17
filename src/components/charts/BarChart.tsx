import { useMemo, useState } from 'react'
import { cx } from '@/lib/utils'
import { useMeasure } from '@/hooks/useMeasure'
import { INK, labelStride, niceMax, scale, ticks, type Point } from './primitives'

// Barras verticales de una sola serie (asistencias por hora, altas por día).
// Extremos redondeados 4px anclados a la línea base, separación de 2px del
// color de superficie entre barras contiguas, y tooltip por barra.

interface Props {
  data: Point[]
  format: (v: number) => string
  height?: number
  color?: string
  className?: string
  /** Resalta la barra más alta — dice de un vistazo cuál es la hora pico. */
  highlightMax?: boolean
  label?: string
}

const PAD = { top: 14, right: 8, bottom: 24, left: 42 }

export function BarChart({
  data,
  format,
  height = 200,
  color = 'rgb(var(--gym-accent))',
  className,
  highlightMax,
  label = 'Total',
}: Props) {
  const { ref, width } = useMeasure<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const max = useMemo(() => niceMax(Math.max(1, ...data.map((d) => d.value))), [data])
  const peak = useMemo(() => data.reduce((best, d, i) => (d.value > (data[best]?.value ?? 0) ? i : best), 0), [data])
  const yTicks = useMemo(() => ticks(max, 3), [max])

  const innerW = Math.max(40, width - PAD.left - PAD.right)
  const innerH = height - PAD.top - PAD.bottom
  const y = scale([0, max], [PAD.top + innerH, PAD.top])

  const slot = innerW / Math.max(1, data.length)
  const barW = Math.max(3, Math.min(34, slot - 3))
  const stride = labelStride(data.length, Math.floor(innerW / 44))

  return (
    <div className={cx('relative w-full', className)} ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={label}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke={INK.grid} strokeWidth={1} />
            <text
              x={PAD.left - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fill={INK.label}
              fontSize={10.5}
              className="tnum"
            >
              {format(t)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 2 : 0, PAD.top + innerH - y(d.value))
          const bx = PAD.left + i * slot + (slot - barW) / 2
          const dim = highlightMax && i !== peak
          const isHover = hover === i
          return (
            <g key={d.key ?? i}>
              {/* Zona de impacto más grande que la barra */}
              <rect
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              <rect
                x={bx}
                y={y(d.value)}
                width={barW}
                height={h}
                rx={Math.min(4, barW / 2)}
                fill={color}
                opacity={isHover ? 1 : dim ? 0.32 : 0.82}
                className="transition-opacity duration-150"
                pointerEvents="none"
              />
            </g>
          )
        })}

        {/* Línea base */}
        <line
          x1={PAD.left}
          x2={PAD.left + innerW}
          y1={PAD.top + innerH}
          y2={PAD.top + innerH}
          stroke={INK.axis}
          strokeWidth={1}
        />

        {data.map((d, i) =>
          i % stride === 0 ? (
            <text
              key={`l-${d.key ?? i}`}
              x={PAD.left + i * slot + slot / 2}
              y={height - 7}
              textAnchor="middle"
              fill={INK.label}
              fontSize={10.5}
            >
              {d.label}
            </text>
          ) : null,
        )}
      </svg>

      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-ink-950/95 px-2.5 py-1.5 shadow-pop backdrop-blur"
          style={{
            left: `${((PAD.left + hover * slot + slot / 2) / width) * 100}%`,
            top: `${((y(data[hover].value) - 10) / height) * 100}%`,
          }}
        >
          <p className="whitespace-nowrap text-[11px] text-ink-400">{data[hover].label}</p>
          <p className="whitespace-nowrap text-[13px] font-semibold text-ink-50 tnum">
            {format(data[hover].value)}
          </p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────── Barras horizontales ────────────────────────────
// Para rankings con etiquetas largas (top de asistencia, clases más llenas).
// Una barra horizontal lee el nombre completo sin rotar texto.

export function RankBars({
  data,
  format,
  color = 'rgb(var(--gym-accent))',
  className,
  maxRows = 8,
}: {
  data: Point[]
  format: (v: number) => string
  color?: string
  className?: string
  maxRows?: number
}) {
  const rows = data.slice(0, maxRows)
  const max = Math.max(1, ...rows.map((d) => d.value))
  return (
    <ul className={cx('space-y-2.5', className)}>
      {rows.map((d) => (
        <li key={d.key ?? d.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[13px] text-ink-200">{d.label}</span>
            <span className="shrink-0 text-[12.5px] font-semibold text-ink-300 tnum">{format(d.value)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
            <div
              className="h-full rounded-full transition-all duration-700 ease-spring"
              style={{ width: `${(d.value / max) * 100}%`, background: color }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
