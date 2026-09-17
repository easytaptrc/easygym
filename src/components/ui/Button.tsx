import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { cx } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'ghost' | 'subtle' | 'danger' | 'outline-gym'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-gym text-ink-950 shadow-glow-gym hover:brightness-110',
  ghost: 'border border-white/10 bg-white/[.03] text-ink-100 hover:border-white/20 hover:bg-white/[.07]',
  subtle: 'text-ink-300 hover:bg-white/5 hover:text-ink-50',
  danger: 'bg-danger-500 text-white hover:bg-danger-400',
  'outline-gym': 'border border-gym/40 bg-gym/[.07] text-gym hover:bg-gym/15',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-lg px-3 text-[12.5px]',
  md: 'h-10 rounded-xl px-4 text-sm',
  lg: 'h-12 rounded-xl px-6 text-[15px]',
}

interface BaseProps {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
  block?: boolean
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, BaseProps {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', loading, icon, iconRight, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold',
        'transition-all duration-200 ease-spring active:scale-[.97]',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
      {!loading && iconRight}
    </button>
  )
})

interface LinkButtonProps extends BaseProps {
  to: string
  className?: string
  children?: ReactNode
  state?: unknown
}

export function LinkButton({
  to,
  state,
  variant = 'ghost',
  size = 'md',
  icon,
  iconRight,
  block,
  className,
  children,
}: LinkButtonProps) {
  return (
    <Link
      to={to}
      state={state}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold',
        'transition-all duration-200 ease-spring active:scale-[.97]',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
    >
      {icon}
      {children}
      {iconRight}
    </Link>
  )
}

/** Botón de icono, cuadrado. */
export function IconButton({
  label,
  size = 'md',
  variant = 'subtle',
  className,
  children,
  ...rest
}: ButtonProps & { label: string }) {
  const dim = size === 'sm' ? 'h-8 w-8 rounded-lg' : size === 'lg' ? 'h-12 w-12 rounded-xl' : 'h-10 w-10 rounded-xl'
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-grid place-items-center transition-all duration-200 ease-spring active:scale-95',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        dim,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
