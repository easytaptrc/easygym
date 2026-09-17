import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx } from '@/lib/utils'
import { Button } from './Button'

// Modal con foco atrapado por el navegador (dialog nativo no hace falta aquí),
// cierre con Escape y bloqueo del scroll de fondo.

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  /** Impide cerrar tocando fuera (procesos en curso). */
  persistent?: boolean
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-6xl',
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  persistent,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !persistent) onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose, persistent])

  if (!open) return null

  return createPortal(
    <div className="no-print fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 animate-fade-in bg-ink-1000/75 backdrop-blur-sm"
        onClick={persistent ? undefined : onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'relative flex max-h-[92vh] w-full animate-scale-in flex-col overflow-hidden',
          'rounded-t-3xl border border-white/[.09] bg-ink-900/95 shadow-pop backdrop-blur-2xl sm:rounded-3xl',
          SIZES[size],
        )}
      >
        {/* Filo luminoso superior */}
        <span className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gym/60 to-transparent" />

        {(title || !persistent) && (
          <header className="flex items-start justify-between gap-4 px-5 pb-3 pt-5 sm:px-6">
            <div className="min-w-0">
              {title && <h2 className="text-lg font-semibold text-ink-50">{title}</h2>}
              {description && <p className="mt-1 text-[13px] leading-relaxed text-ink-400">{description}</p>}
            </div>
            {!persistent && (
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="-mr-1 -mt-1 shrink-0 rounded-lg p-2 text-ink-400 transition hover:bg-white/5 hover:text-ink-100"
              >
                <X className="h-[18px] w-[18px]" />
              </button>
            )}
          </header>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">{children}</div>

        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[.06] bg-ink-950/40 px-5 py-4 sm:px-6">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Confirmación destructiva. Devuelve el control al llamador. */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmar',
  tone = 'danger',
  loading,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  loading?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-300">{message}</p>
    </Modal>
  )
}

/** Panel lateral — para perfiles y detalles sin perder el contexto. */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'md',
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  width?: 'md' | 'lg'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="no-print fixed inset-0 z-[90]">
      <div className="absolute inset-0 animate-fade-in bg-ink-1000/70 backdrop-blur-sm" onClick={onClose} />
      <aside
        className={cx(
          'absolute inset-y-0 right-0 flex w-full animate-slide-in-right flex-col border-l border-white/[.08] bg-ink-900/95 shadow-pop backdrop-blur-2xl',
          width === 'lg' ? 'sm:w-[38rem]' : 'sm:w-[30rem]',
        )}
      >
        <header className="flex items-center justify-between gap-4 border-b border-white/[.06] px-5 py-4">
          <h2 className="truncate text-base font-semibold text-ink-50">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-2 text-ink-400 transition hover:bg-white/5 hover:text-ink-100"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-white/[.06] bg-ink-950/40 px-5 py-4">
            {footer}
          </footer>
        )}
      </aside>
    </div>,
    document.body,
  )
}
