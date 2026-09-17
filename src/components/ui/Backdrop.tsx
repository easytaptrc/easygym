import { cx } from '@/lib/utils'

// Fondo futurista: malla técnica + auroras de color que respiran lentamente.
// Es puramente decorativo, así que va tras `aria-hidden` y se detiene solo
// cuando el sistema pide menos movimiento (lo hace el CSS global).

export function Backdrop({
  variant = 'landing',
  className,
}: {
  variant?: 'landing' | 'app' | 'auth'
  className?: string
}) {
  return (
    <div aria-hidden="true" className={cx('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}>
      {/* Base */}
      <div className="absolute inset-0 bg-ink-950" />

      {/* Malla */}
      <div
        className={cx(
          'absolute inset-0 bg-grid mask-fade',
          variant === 'app' ? 'opacity-[.35]' : 'opacity-60',
          variant === 'landing' && 'animate-grid-drift',
        )}
      />

      {/* Auroras */}
      {variant !== 'app' && (
        <>
          <div
            className="absolute -left-[12%] -top-[18%] h-[52vmax] w-[52vmax] animate-aurora rounded-full opacity-[.22] blur-[110px]"
            style={{ background: 'radial-gradient(circle, rgb(var(--gym-accent)) 0%, transparent 62%)' }}
          />
          <div
            className="absolute -right-[16%] top-[8%] h-[46vmax] w-[46vmax] animate-aurora rounded-full opacity-[.16] blur-[120px]"
            style={{
              animationDelay: '-7s',
              background: 'radial-gradient(circle, #38D9FF 0%, transparent 62%)',
            }}
          />
          <div
            className="absolute -bottom-[22%] left-[22%] h-[44vmax] w-[44vmax] animate-aurora rounded-full opacity-[.14] blur-[130px]"
            style={{
              animationDelay: '-14s',
              background: 'radial-gradient(circle, #A970FF 0%, transparent 62%)',
            }}
          />
        </>
      )}

      {variant === 'app' && (
        <div
          className="absolute -top-[30%] left-1/2 h-[46vmax] w-[70vmax] -translate-x-1/2 rounded-full opacity-[.13] blur-[130px]"
          style={{ background: 'radial-gradient(ellipse, rgb(var(--gym-accent)) 0%, transparent 65%)' }}
        />
      )}

      {/* Viñeta */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,.65)_100%)]" />
    </div>
  )
}

/** Franja de texto en bucle — se usa en la landing bajo el hero. */
export function Marquee({ items, className }: { items: string[]; className?: string }) {
  const doubled = [...items, ...items]
  return (
    <div className={cx('mask-fade-x overflow-hidden', className)}>
      <div className="flex w-max animate-marquee items-center gap-10">
        {doubled.map((t, i) => (
          <span key={i} className="flex items-center gap-10 whitespace-nowrap">
            <span className="text-[13px] font-medium uppercase tracking-[.2em] text-ink-500">{t}</span>
            <span className="h-1 w-1 rounded-full bg-gym/60" />
          </span>
        ))}
      </div>
    </div>
  )
}
