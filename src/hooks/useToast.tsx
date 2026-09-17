import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cx } from '@/lib/utils'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  kind: ToastKind
  title: string
  detail?: string
}

interface ToastApi {
  push: (t: Omit<Toast, 'id'>) => void
  success: (title: string, detail?: string) => void
  error: (title: string, detail?: string) => void
  info: (title: string, detail?: string) => void
  warning: (title: string, detail?: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
} as const

const TONES: Record<ToastKind, string> = {
  success: 'border-tap-500/30 bg-tap-500/10 text-tap-200',
  error: 'border-danger-500/30 bg-danger-500/10 text-danger-200',
  info: 'border-cyber-400/30 bg-cyber-400/10 text-cyber-300',
  warning: 'border-warn-500/30 bg-warn-500/10 text-warn-200',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Math.random().toString(36).slice(2)
      setToasts((prev) => [...prev.slice(-3), { ...t, id }])
      setTimeout(() => dismiss(id), t.kind === 'error' ? 6500 : 4200)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (title, detail) => push({ kind: 'success', title, ...(detail ? { detail } : {}) }),
      error: (title, detail) => push({ kind: 'error', title, ...(detail ? { detail } : {}) }),
      info: (title, detail) => push({ kind: 'info', title, ...(detail ? { detail } : {}) }),
      warning: (title, detail) => push({ kind: 'warning', title, ...(detail ? { detail } : {}) }),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:bottom-auto sm:right-0 sm:top-0 sm:items-end">
        {toasts.map((t) => {
          const Icon = ICONS[t.kind]
          return (
            <div
              key={t.id}
              role="status"
              className={cx(
                'pointer-events-auto flex w-full max-w-sm animate-slide-in-right items-start gap-3 rounded-xl border px-4 py-3 shadow-pop backdrop-blur-xl',
                TONES[t.kind],
              )}
            >
              <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug">{t.title}</p>
                {t.detail && <p className="mt-0.5 text-[12.5px] leading-snug opacity-80">{t.detail}</p>}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="rounded-md p-0.5 opacity-50 transition hover:opacity-100"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return ctx
}
