import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '@/lib/utils'
import { money0, num } from '@/lib/format'
import { Delta } from '@/components/ui/Feedback'
import { smoothPath } from './primitives'

// Tarjeta de KPI. El número es el protagonista: sin gráfica compitiendo,
// con la variación contra el periodo anterior y un rastro fino opcional.

interface Props {
  label: string
  value: number
  format?: 'number' | 'money'
  delta?: number | undefined
  hint?: string
  icon?: ReactNode
  /** Serie fina bajo el número. */
  trend?: number[]
  tone?: 'gym' | 'tap' | 'cyber' | 'plasma' | 'warn' | 'danger'
  className?: string
  onClick?: () => void
  /** Anima el número al montar. */
  animate?: boolean
}

const TONE_TEXT = {
  gym: 'text-gym',
  tap: 'text-tap-400',
  cyber: 'text-cyber-400',
  plasma: 'text-plasma-400',
  warn: 'text-warn-400',
  danger: 'text-danger-400',
} as const

const TONE_STROKE = {
  gym: 'rgb(var(--gym-accent))',
  tap: '#22E06B',
  cyber: '#38D9FF',
  plasma: '#A970FF',
  warn: '#FFBE3D',
  danger: '#FF6B6B',
} as const

/**
 * Cuenta hasta el valor con easing.
 *
 * Se salta la animación cuando el sistema pide menos movimiento y cuando la
 * pestaña NO está visible. Esto último no es un detalle estético: el navegador
 * congela `requestAnimationFrame` en las pestañas de fondo, así que un panel
 * abierto en segundo plano —con Ctrl+clic, o cambiando de pestaña mientras
 * carga— se quedaba mostrando $0 y 0 socios indefinidamente.
 *
 * Un tablero que enseña ceros es peor que uno que no enseña nada: alguien se
 * los va a creer.
 */
function useCountUp(target: number, enabled: boolean): number {
  const [value, setValue] = useState(enabled ? 0 : target)
  const raf = useRef<number>()

  useEffect(() => {
    const skip =
      !enabled ||
      document.hidden ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (skip) {
      setValue(target)
      return
    }

    const start = performance.now()
    const from = 0
    const duration = 680
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      setValue(from + (target - from) * eased)
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)

    // Si la pestaña se oculta a mitad de la cuenta, se salta al final: al
    // volver, el número tiene que estar bien, no a medio camino.
    const onHide = () => {
      if (document.hidden) {
        if (raf.current) cancelAnimationFrame(raf.current)
        setValue(target)
      }
    }
    document.addEventListener('visibilitychange', onHide)

    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [target, enabled])

  return value
}

export function StatTile({
  label,
  value,
  format = 'number',
  delta,
  hint,
  icon,
  trend,
  tone = 'gym',
  className,
  onClick,
  animate = true,
}: Props) {
  const shown = useCountUp(value, animate)
  const display = format === 'money' ? money0(Math.round(shown)) : num(Math.round(shown))

  const Wrapper = onClick ? 'button' : 'div'

  return (
    <Wrapper
      onClick={onClick}
      className={cx(
        'group relative overflow-hidden rounded-2xl border border-white/[.07] bg-ink-900/70 p-4 text-left shadow-card backdrop-blur-xl',
        'transition-all duration-300 ease-spring',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:border-white/[.16] hover:shadow-pop',
        className,
      )}
    >
      {/* Filo luminoso superior */}
      <span
        className="pointer-events-none absolute inset-x-5 -top-px h-px opacity-70"
        style={{ background: `linear-gradient(90deg,transparent,${TONE_STROKE[tone]},transparent)` }}
      />

      <div className="flex items-start justify-between gap-3">
        <p className="text-[12.5px] font-medium text-ink-400">{label}</p>
        {icon && <span className={cx('shrink-0 opacity-70', TONE_TEXT[tone])}>{icon}</span>}
      </div>

      <p className="mt-2 text-[26px] font-bold leading-none tracking-tight text-ink-50 tnum">{display}</p>

      <div className="mt-2 flex items-center gap-2">
        <Delta value={delta} />
        {hint && <span className="truncate text-[11.5px] text-ink-500">{hint}</span>}
      </div>

      {trend && trend.length > 1 && (
        <Sparkline values={trend} color={TONE_STROKE[tone]} className="mt-3" />
      )}
    </Wrapper>
  )
}

export function Sparkline({
  values,
  color = 'rgb(var(--gym-accent))',
  width = 160,
  height = 30,
  className,
}: {
  values: number[]
  color?: string
  width?: number
  height?: number
  className?: string
}) {
  const max = Math.max(1, ...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const pts = values.map(
    (v, i) =>
      [(i / Math.max(1, values.length - 1)) * width, height - ((v - min) / span) * (height - 3) - 1.5] as [
        number,
        number,
      ],
  )
  const d = smoothPath(pts)
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={cx('block', className)}
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.85} />
    </svg>
  )
}
