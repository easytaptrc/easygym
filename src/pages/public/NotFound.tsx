import { Compass } from 'lucide-react'
import { Backdrop } from '@/components/ui/Backdrop'
import { LinkButton } from '@/components/ui/Button'
import { Logo } from '@/components/ui/Logo'

export default function NotFound() {
  return (
    <div className="relative grid min-h-screen place-content-center px-6 text-center">
      <Backdrop variant="auth" />
      <Logo size="md" className="mx-auto" />
      <p className="mt-8 font-mono text-[64px] font-bold leading-none text-ink-800">404</p>
      <h1 className="mt-3 text-[24px] font-bold tracking-tight text-white">Esta página no existe</h1>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-400">
        Puede que el enlace esté mal escrito o que la sección se haya movido.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        <LinkButton to="/" variant="primary" icon={<Compass className="h-4 w-4" />}>
          Ir al inicio
        </LinkButton>
        <LinkButton to="/login" variant="subtle">
          Iniciar sesión
        </LinkButton>
      </div>
    </div>
  )
}
