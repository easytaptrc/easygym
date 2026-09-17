import type { ReactNode } from 'react'
import { cx } from '@/lib/utils'

/** Encabezado estándar de página: título, descripción y acciones. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: string
  description?: string
  actions?: ReactNode
  eyebrow?: string
  className?: string
}) {
  return (
    <div className={cx('mb-5 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 font-mono text-[10.5px] uppercase tracking-[.22em] text-ink-500">{eyebrow}</p>
        )}
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink-50 sm:text-[30px]">
          {title}
        </h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
