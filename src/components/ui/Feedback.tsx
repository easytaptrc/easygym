import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cx, hueFrom, initials } from '@/lib/utils'
import type { MemberStatus } from '@/types'
import { STATUS_CLASS, STATUS_DOT, STATUS_LABEL } from '@/services/members'

// ──────────────────────────────── Spinner ───────────────────────────────────

export function Spinner({ className, size = 20 }: { className?: string; size?: number }) {
  return <Loader2 className={cx('animate-spin text-gym', className)} style={{ width: size, height: size }} />
}

export function LoadingBlock({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Spinner size={26} />
      <p className="text-sm text-ink-400">{label}</p>
    </div>
  )
}

/** Pantalla completa de carga — se usa mientras arranca la sesión. */
export function FullPageLoader({ label = 'Preparando tu gimnasio…' }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-content-center gap-5 justify-items-center bg-ink-950">
      <div className="relative">
        <div className="absolute inset-0 animate-pulse-ring rounded-full bg-gym/25 blur-xl" />
        <Spinner size={34} />
      </div>
      <p className="animate-pulse text-sm text-ink-400">{label}</p>
    </div>
  )
}

// ──────────────────────────────── Skeleton ──────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cx('relative overflow-hidden rounded-lg bg-ink-800/70', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[.06] to-transparent" />
    </div>
  )
}

export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}

// ───────────────────────────────── Badges ───────────────────────────────────

export type BadgeTone = 'tap' | 'cyber' | 'plasma' | 'warn' | 'danger' | 'neutral' | 'gym'

const TONES: Record<BadgeTone, string> = {
  tap: 'bg-tap-500/15 text-tap-300 ring-tap-500/30',
  cyber: 'bg-cyber-400/15 text-cyber-300 ring-cyber-400/30',
  plasma: 'bg-plasma-400/15 text-plasma-300 ring-plasma-400/30',
  warn: 'bg-warn-500/15 text-warn-300 ring-warn-500/30',
  danger: 'bg-danger-500/15 text-danger-300 ring-danger-500/30',
  neutral: 'bg-white/[.06] text-ink-300 ring-white/10',
  gym: 'bg-gym/15 text-gym ring-gym/30',
}

export function Badge({
  tone = 'neutral',
  children,
  className,
  dot,
}: {
  tone?: BadgeTone
  children: ReactNode
  className?: string
  dot?: boolean
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold leading-none ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

/** Chip de estado de un socio — el color es el mismo en todo el producto. */
export function StatusChip({ status, className }: { status: MemberStatus; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold leading-none',
        STATUS_CLASS[status],
        className,
      )}
    >
      <span className={cx('h-1.5 w-1.5 rounded-full', STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  )
}

// ───────────────────────────────── Avatar ───────────────────────────────────

export function Avatar({
  name,
  src,
  size = 40,
  className,
  ring,
}: {
  name: string
  src?: string | null
  size?: number
  className?: string
  ring?: boolean
}) {
  const hue = hueFrom(name)
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={cx('shrink-0 rounded-full object-cover', ring && 'ring-2 ring-gym/40', className)}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className={cx(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold text-white',
        ring && 'ring-2 ring-gym/40',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${hue} 55% 34%), hsl(${(hue + 40) % 360} 60% 22%))`,
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

// ────────────────────────────── Estado vacío ────────────────────────────────

export function EmptyState({
  icon,
  title,
  detail,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  detail?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && (
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-white/[.07] bg-white/[.03] text-ink-400">
          {icon}
        </div>
      )}
      <p className="text-[15px] font-semibold text-ink-100">{title}</p>
      {detail && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-400">{detail}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

// ──────────────────────────── Variación (KPI) ───────────────────────────────

export function Delta({ value, className }: { value: number | undefined; className?: string }) {
  if (value === undefined || !Number.isFinite(value)) {
    return <span className={cx('text-[12px] text-ink-500', className)}>—</span>
  }
  const up = value >= 0
  return (
    <span
      className={cx(
        'inline-flex items-center gap-0.5 text-[12px] font-semibold tnum',
        up ? 'text-tap-400' : 'text-danger-400',
        className,
      )}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path
          d={up ? 'M5 1.5 L9 7 H1 Z' : 'M5 8.5 L1 3 H9 Z'}
          fill="currentColor"
        />
      </svg>
      {Math.abs(value).toFixed(value >= 100 ? 0 : 1)}%
    </span>
  )
}

// ─────────────────────────── Barra de progreso ──────────────────────────────

export function Progress({
  value,
  max = 100,
  className,
  tone = 'gym',
}: {
  value: number
  max?: number
  className?: string
  tone?: 'gym' | 'warn' | 'danger'
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const bg = tone === 'gym' ? 'bg-gym' : tone === 'warn' ? 'bg-warn-400' : 'bg-danger-400'
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-ink-800', className)}>
      <div
        className={cx('h-full rounded-full transition-all duration-700 ease-spring', bg)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
