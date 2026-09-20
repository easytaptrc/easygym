import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, KeyRound, LogIn, RotateCcw, Zap } from 'lucide-react'
import { BRAND } from '@/config/brand'
import { reportError } from '@/lib/errors'
import { cx } from '@/lib/utils'
import { homeFor } from '@/services/auth'
import { isMockDriver } from '@/services/db'
import { getDemoCredentials, resetDemo, type DemoCredential } from '@/data/seed'
import { useSession } from '@/state/SessionContext'
import { useToast } from '@/hooks/useToast'
import { Backdrop } from '@/components/ui/Backdrop'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Inputs'
import { Logo } from '@/components/ui/Logo'
import { Badge } from '@/components/ui/Feedback'
import { PublicNav } from './PublicChrome'

// Pantalla de acceso. En modo demostración muestra los usuarios de prueba:
// sin esto, demostrar los seis roles obligaría a copiar correos a mano.

const ACCENT_RING = {
  tap: 'hover:border-tap-500/40 hover:bg-tap-500/[.06]',
  cyber: 'hover:border-cyber-400/40 hover:bg-cyber-400/[.06]',
  plasma: 'hover:border-plasma-400/40 hover:bg-plasma-400/[.06]',
  ink: 'hover:border-white/25 hover:bg-white/[.05]',
} as const

export default function Login() {
  const { signIn, signInAsDemo } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [demos, setDemos] = useState<DemoCredential[]>([])
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    if (isMockDriver) setDemos(getDemoCredentials())
  }, [])

  const from = (location.state as { from?: string } | null)?.from

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const user = await signIn(email, password)
      navigate(from ?? homeFor(user), { replace: true })
    } catch (err) {
      setError(reportError('iniciar sesión', err).message)
    } finally {
      setBusy(false)
    }
  }

  async function quickIn(cred: DemoCredential) {
    setBusy(true)
    setError(null)
    try {
      const user = await signInAsDemo(cred.uid)
      navigate(homeFor(user), { replace: true })
    } catch (err) {
      setError(reportError('entrar con usuario de demostración', err).message)
    } finally {
      setBusy(false)
    }
  }

  async function doReset() {
    setResetting(true)
    try {
      const creds = await resetDemo()
      setDemos(creds)
      toast.success('Demo reiniciada', 'Se volvieron a generar los tres gimnasios de ejemplo.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="relative min-h-screen">
      <Backdrop variant="auth" />
      <PublicNav />

      <main className="mx-auto grid max-w-5xl gap-6 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* Formulario */}
        <div className="rounded-2xl border border-white/[.08] bg-ink-900/70 p-7 shadow-card backdrop-blur-xl">
          <Logo size="sm" />
          <h1 className="mt-6 text-[24px] font-bold tracking-tight text-white">Inicia sesión</h1>
          <p className="mt-1.5 text-sm text-ink-400">Entra al panel de tu gimnasio.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Input
              label="Correo electrónico"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              autoComplete="email"
            />
            <Input
              label="Contraseña"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              prefix={<KeyRound className="h-4 w-4" />}
            />

            {error && (
              <p className="rounded-xl border border-danger-500/30 bg-danger-500/10 px-3.5 py-2.5 text-[13px] text-danger-200">
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              loading={busy}
              icon={<LogIn className="h-4 w-4" />}
            >
              Entrar
            </Button>
          </form>

          <p className="mt-5 text-center text-[12.5px] text-ink-500">
            ¿Todavía no tienes gimnasio?{' '}
            <Link to="/registro" className="font-semibold text-gym hover:underline">
              Créalo en 2 minutos
            </Link>
          </p>
        </div>

        {/* Accesos demo */}
        {isMockDriver && (
          <aside className="rounded-2xl border border-white/[.08] bg-ink-900/50 p-6 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-[15px] font-semibold text-white">
                  <Zap className="h-4 w-4 text-gym" />
                  Acceso rápido a la demo
                </p>
                <p className="mt-1 text-[12.5px] text-ink-400">
                  Tres gimnasios reales con planes distintos. Toca un usuario para entrar.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                loading={resetting}
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={doReset}
              >
                Reiniciar demo
              </Button>
            </div>

            <ul className="mt-5 grid gap-2 sm:grid-cols-2">
              {demos.map((d) => (
                <li key={d.uid}>
                  <button
                    onClick={() => quickIn(d)}
                    disabled={busy}
                    className={cx(
                      'group flex w-full items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.02] px-3.5 py-3 text-left transition-all duration-200 disabled:opacity-50',
                      ACCENT_RING[d.accent],
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-ink-100">{d.label}</p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-ink-500">{d.email}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-ink-600 transition-transform group-hover:translate-x-0.5 group-hover:text-gym" />
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-5 rounded-xl border border-white/[.06] bg-ink-950/50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-ink-500">
                Qué demostrar
              </p>
              <ul className="mt-2.5 space-y-1.5 text-[12.5px] text-ink-400">
                <li>
                  · Entra como <b className="text-ink-200">dueño de Iron Fitness</b> (plan Pro): tiene
                  clases, spinning y control de acceso.
                </li>
                <li>
                  · Entra como <b className="text-ink-200">dueño de Power House</b> (plan Starter): las
                  reservaciones aparecen bloqueadas.
                </li>
                <li>
                  · Entra como <b className="text-ink-200">Super administrador</b>: ve los tres gimnasios
                  y sus suscripciones.
                </li>
                <li>
                  · Cualquier dueño solo ve <b className="text-ink-200">sus</b> socios: ese es el
                  aislamiento por <code className="font-mono text-gym">gymId</code>.
                </li>
              </ul>
              <p className="mt-3 flex items-center gap-2 text-[11.5px] text-ink-600">
                <Badge tone="neutral">Contraseña</Badge>
                <code className="font-mono">easygym123</code>
              </p>
            </div>

            <p className="mt-4 text-[11.5px] leading-relaxed text-ink-600">
              Modo demostración: los datos viven en este navegador (localStorage). Nada se envía a
              ningún servidor y ninguna credencial es real. Cambia{' '}
              <code className="font-mono text-ink-400">VITE_DATA_DRIVER=firebase</code> para usar{' '}
              {BRAND.name} contra Firestore.
            </p>
          </aside>
        )}
      </main>
    </div>
  )
}
