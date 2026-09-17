import type { ReactNode } from 'react'
import { cx } from '@/lib/utils'

// Superficies del producto. Toda tarjeta del dashboard, formulario o panel
// sale de aquí, para que el vidrio, el borde y la sombra sean siempre iguales.

export function Card({
  children,
  className,
  hover,
  lit,
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  /** Eleva la tarjeta al pasar el cursor. */
  hover?: boolean
  /** Filo luminoso superior con el color del gimnasio. */
  lit?: boolean
  as?: 'div' | 'section' | 'article' | 'li'
}) {
  return (
    <Tag
      className={cx(
        'relative rounded-2xl border border-white/[.07] bg-ink-900/70 shadow-card backdrop-blur-xl',
        hover && 'transition-all duration-300 ease-spring hover:-translate-y-0.5 hover:border-white/[.14] hover:shadow-pop',
        className,
      )}
    >
      {lit && (
        <span className="pointer-events-none absolute inset-x-6 -top-px h-px bg-gradient-to-r from-transparent via-gym/70 to-transparent" />
      )}
      {children}
    </Tag>
  )
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex items-start justify-between gap-4 px-5 pb-3 pt-5', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[.07] bg-white/[.03] text-gym">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-ink-50">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[12.5px] leading-snug text-ink-400">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('px-5 pb-5', className)}>{children}</div>
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center gap-2 border-t border-white/[.06] px-5 py-3.5', className)}>
      {children}
    </div>
  )
}

/** Título de sección dentro de una página. */
export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('mb-3 flex items-end justify-between gap-4', className)}>
      <h2 className="text-[13px] font-semibold uppercase tracking-[.16em] text-ink-400">{children}</h2>
      {action}
    </div>
  )
}

/** Fila etiqueta / valor — perfiles, detalles, recibos. */
export function DetailRow({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex items-baseline justify-between gap-4 py-2', className)}>
      <span className="shrink-0 text-[12.5px] text-ink-400">{label}</span>
      <span className="min-w-0 truncate text-right text-sm font-medium text-ink-100">{children}</span>
    </div>
  )
}
