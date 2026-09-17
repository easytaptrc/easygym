import { useId, useMemo, useRef, useState } from 'react'
import { cx } from '@/lib/utils'
import { useMeasure } from '@/hooks/useMeasure'
import { INK, labelStride, niceMax, scale, smoothPath, ticks, type Point } from './primitives'

// Serie temporal única (ingresos, asistencias…).
// Una sola serie ⇒ sin leyenda: el título ya dice qué se está viendo.
// Lleva retícula + tooltip porque una gráfica en HTML que no se puede
// interrogar desperdicia la mitad de lo que aporta.

interface Props {
  data: Point[]
  /** Formato del valor en eje y tooltip. */
  format: (v: number) => string
  height?: number
  color?: string
  className?: string
  /** Etiqueta de la serie para el tooltip. */
  seriesLabel?: string
}

const PAD = { top: 14, right: 12, bottom: 26, left: 52 }

export function AreaChart({
  data,
  format,
  height = 220,
  color = 'rgb(var(--gym-accent))',
  className,
  seriesLabel = 'Total',
}: Props) {
  const gradientId = useId()
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const { ref: boxRef, width } = useMeasure<HTMLDivElement>()

  const max = useMemo(() => niceMax(Math.max(1, ...data.map((d) => d.value))), [data])
  const yTicks = useMemo(() => ticks(max, 4), [max])

  const innerW = Math.max(40, width - PAD.left - PAD.right)
  const innerH = height - PAD.top - PAD.bottom

  const x = scale([0, Math.max(1, data.length - 1)], [PAD.left, PAD.left + innerW])
  const y = scale([0, max], [PAD.top + innerH, PAD.top])

  const pts = useMemo(
    () => data.map((d, i) => [x(i), y(d.value)] as [number, number]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, width, height, max],
  )

  const line = smoothPath(pts)
  const area = pts.length
    ? `${line} L${pts[pts.length - 1][0]},${PAD.top + innerH} L${pts[0][0]},${PAD.top + innerH} Z`
    : ''

  const stride = labelStride(data.length, Math.floor(innerW / 64))

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || data.length === 0) return
    const px = ((e.clientX - rect.left) / rect.width) * width
    const i = Math.round(((px - PAD.left) / innerW) * (data.length - 1))
    setHover(Math.max(0, Math.min(data.length - 1, i)))
  }

  const active = hover !== null ? data[hover] : null

  return (
    <div className={cx('relative w-full', className)} ref={boxRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`${seriesLabel} por día`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        className="overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.34" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Rejilla recesiva */}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke={INK.grid} strokeWidth={1} />
            <text
              x={PAD.left - 10}
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

        {/* Área + línea */}
        {area && <path d={area} fill={`url(#${gradientId})`} />}
        {line && (
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* Eje X */}
        {data.map((d, i) =>
          i % stride === 0 ? (
            <text
              key={d.key ?? i}
              x={x(i)}
              y={height - 8}
              textAnchor="middle"
              fill={INK.label}
              fontSize={10.5}
            >
              {d.label}
            </text>
          ) : null,
        )}

        {/* Retícula + marcador */}
        {active && hover !== null && (
          <g pointerEvents="none">
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="rgba(255,255,255,.22)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {/* Anillo de superficie para que el punto no se funda con el área */}
            <circle cx={x(hover)} cy={y(active.value)} r={6} fill={CHART_DOT_RING} />
            <circle cx={x(hover)} cy={y(active.value)} r={4.5} fill={color} />
          </g>
        )}
      </svg>

      {/* Tooltip */}
      {active && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-ink-950/95 px-2.5 py-1.5 shadow-pop backdrop-blur"
          style={{
            left: `${(x(hover) / width) * 100}%`,
            top: `${((y(active.value) - 12) / height) * 100}%`,
          }}
        >
          <p className="whitespace-nowrap text-[11px] text-ink-400">{active.label}</p>
          <p className="whitespace-nowrap text-[13px] font-semibold text-ink-50 tnum">
            {format(active.value)}
          </p>
        </div>
      )}
    </div>
  )
}

const CHART_DOT_RING = '#0B0F16'
