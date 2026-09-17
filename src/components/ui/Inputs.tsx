import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Search, X } from 'lucide-react'
import { cx } from '@/lib/utils'

// ─────────────────────────────── Envoltura ──────────────────────────────────

interface FieldShellProps {
  label?: string
  hint?: string
  error?: string
  required?: boolean
  className?: string
  children: (id: string) => ReactNode
}

export function Field({ label, hint, error, required, className, children }: FieldShellProps) {
  const id = useId()
  return (
    <div className={cx('min-w-0', className)}>
      {label && (
        <label htmlFor={id} className="mb-1.5 flex items-center gap-1 text-[12.5px] font-medium text-ink-300">
          {label}
          {required && <span className="text-danger-400">*</span>}
        </label>
      )}
      {children(id)}
      {error ? (
        <p className="mt-1 text-[12px] text-danger-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[12px] text-ink-500">{hint}</p>
      ) : null}
    </div>
  )
}

const BASE =
  'w-full rounded-xl border bg-ink-950/60 px-3.5 text-sm text-ink-100 placeholder:text-ink-500 ' +
  'transition focus:bg-ink-950 focus:outline-none focus:ring-4'

const OK = 'border-white/10 focus:border-gym/60 focus:ring-gym/15'
const BAD = 'border-danger-500/50 focus:border-danger-400 focus:ring-danger-500/15'

// ──────────────────────────────── Text input ────────────────────────────────

// Se omite `prefix` del tipo nativo: en HTML es un atributo de string y aquí
// necesitamos poder pasar un icono.
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  label?: string
  hint?: string
  error?: string
  prefix?: ReactNode
  suffix?: ReactNode
  containerClassName?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, prefix, suffix, className, containerClassName, required, ...rest },
  ref,
) {
  return (
    <Field
      {...(label ? { label } : {})}
      {...(hint ? { hint } : {})}
      {...(error ? { error } : {})}
      {...(required ? { required: true } : {})}
      {...(containerClassName ? { className: containerClassName } : {})}
    >
      {(id) => (
        <div className="relative">
          {prefix && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500">
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            id={id}
            required={required}
            className={cx(
              BASE,
              error ? BAD : OK,
              'h-10',
              prefix && 'pl-9',
              suffix && 'pr-10',
              className,
            )}
            {...rest}
          />
          {suffix && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500">{suffix}</span>
          )}
        </div>
      )}
    </Field>
  )
})

// ──────────────────────────────── Select ────────────────────────────────────

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: string
  error?: string
  containerClassName?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, className, containerClassName, children, required, ...rest },
  ref,
) {
  return (
    <Field
      {...(label ? { label } : {})}
      {...(hint ? { hint } : {})}
      {...(error ? { error } : {})}
      {...(required ? { required: true } : {})}
      {...(containerClassName ? { className: containerClassName } : {})}
    >
      {(id) => (
        <select
          ref={ref}
          id={id}
          required={required}
          className={cx(
            BASE,
            error ? BAD : OK,
            'h-10 appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-9',
            className,
          )}
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236C7E97' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          }}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  )
})

// ─────────────────────────────── Textarea ───────────────────────────────────

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  error?: string
  containerClassName?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, containerClassName, ...rest },
  ref,
) {
  return (
    <Field
      {...(label ? { label } : {})}
      {...(hint ? { hint } : {})}
      {...(error ? { error } : {})}
      {...(containerClassName ? { className: containerClassName } : {})}
    >
      {(id) => (
        <textarea
          ref={ref}
          id={id}
          rows={3}
          className={cx(BASE, error ? BAD : OK, 'resize-y py-2.5', className)}
          {...rest}
        />
      )}
    </Field>
  )
})

// ───────────────────────────── Buscador ─────────────────────────────────────

export function SearchInput({
  value,
  onValueChange,
  placeholder = 'Buscar…',
  className,
  autoFocus,
}: {
  value: string
  onValueChange: (v: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}) {
  return (
    <div className={cx('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        className={cx(BASE, OK, 'h-10 pl-9 pr-9')}
      />
      {value && (
        <button
          onClick={() => onValueChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-500 transition hover:bg-white/5 hover:text-ink-200"
          aria-label="Limpiar búsqueda"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// ──────────────────────────────── Toggle ────────────────────────────────────

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
}) {
  return (
    <label
      className={cx(
        'flex items-start gap-3',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-300',
          checked ? 'bg-gym' : 'bg-ink-700',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-300 ease-spring',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
        />
      </button>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium text-ink-100">{label}</span>}
          {description && <span className="mt-0.5 block text-[12.5px] text-ink-400">{description}</span>}
        </span>
      )}
    </label>
  )
}

// ────────────────────────── Selector segmentado ─────────────────────────────

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string; icon?: ReactNode }>
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div
      className={cx(
        'inline-flex items-center gap-0.5 rounded-xl border border-white/[.07] bg-ink-900/70 p-1',
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-all duration-200',
            size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
            value === o.value
              ? 'bg-gym/15 text-gym shadow-[inset_0_0_0_1px_rgb(var(--gym-accent)/.28)]'
              : 'text-ink-400 hover:bg-white/5 hover:text-ink-100',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ─────────────────────── Selector de color del gimnasio ─────────────────────

export function ColorPicker({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (rgb: string, soft: string, deep: string) => void
  options: ReadonlyArray<{ name: string; accent: string; soft: string; deep: string }>
}) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {options.map((o) => (
        <button
          key={o.accent}
          type="button"
          onClick={() => onChange(o.accent, o.soft, o.deep)}
          title={o.name}
          aria-label={o.name}
          className={cx(
            'group relative h-11 w-11 rounded-xl transition-all duration-200 ease-spring hover:scale-110',
            value === o.accent && 'ring-2 ring-white/70 ring-offset-2 ring-offset-ink-900',
          )}
          style={{ background: `rgb(${o.accent})` }}
        >
          <span
            className="absolute inset-0 rounded-xl opacity-0 blur-md transition group-hover:opacity-70"
            style={{ background: `rgb(${o.accent})` }}
          />
        </button>
      ))}
    </div>
  )
}
