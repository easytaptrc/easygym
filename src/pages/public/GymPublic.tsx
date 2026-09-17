import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Clock, Dumbbell, MapPin, Phone, Smartphone } from 'lucide-react'
import type { PublicGym } from '@/types'
import { findPublicGymBySlug } from '@/services/publicGym'
import { applyGymTheme, resetTheme } from '@/lib/theme'
import { money0 } from '@/lib/format'
import { Backdrop } from '@/components/ui/Backdrop'
import { LinkButton } from '@/components/ui/Button'
import { Logo } from '@/components/ui/Logo'
import { FullPageLoader, EmptyState } from '@/components/ui/Feedback'
import { Card } from '@/components/ui/Card'

// ═══════════════════════════════════════════════════════════════════════════
// Página pública de un gimnasio:  easygym.com/g/iron-fitness
//
// NO hay un dominio ni un build por gimnasio. Una sola aplicación resuelve el
// slug en runtime y aplica el color de marca de ese gimnasio. Es lo que hace
// que 10 000 gimnasios no signifiquen 10 000 despliegues.
//
// Lee `publicGyms`, NUNCA `gyms`: esta pantalla no tiene sesión y el documento
// del gimnasio contiene datos del dueño y de su suscripción. Ver
// services/publicGym.ts.
// ═══════════════════════════════════════════════════════════════════════════

export default function GymPublic() {
  const { slug } = useParams<{ slug: string }>()
  const [gym, setGym] = useState<PublicGym | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    ;(async () => {
      const found = slug ? await findPublicGymBySlug(slug) : null
      if (!live) return
      setGym(found)
      if (found) applyGymTheme(found.branding)
      setLoading(false)
    })()
    return () => {
      live = false
      resetTheme()
    }
  }, [slug])

  const plans = gym?.plans ?? []

  if (loading) return <FullPageLoader label="Buscando gimnasio…" />

  if (!gym) {
    return (
      <div className="relative grid min-h-screen place-content-center px-6">
        <Backdrop variant="auth" />
        <EmptyState
          icon={<Dumbbell className="h-6 w-6" />}
          title="No encontramos ese gimnasio"
          detail={`Ningún gimnasio usa la dirección /g/${slug}.`}
          action={
            <LinkButton to="/" variant="primary">
              Ir al inicio
            </LinkButton>
          }
        />
      </div>
    )
  }

  return (
    <div className="relative min-h-screen">
      <Backdrop variant="landing" />

      <header className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" aria-label="EasyGym">
          <Logo size="xs" still />
        </Link>
        <LinkButton to="/login" variant="ghost" size="sm">
          Iniciar sesión
        </LinkButton>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-20 pt-8 sm:px-6">
        {/* Portada */}
        <div className="relative overflow-hidden rounded-3xl border border-white/[.08] bg-ink-900/60 p-8 text-center backdrop-blur-xl sm:p-12">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-28 h-56 opacity-30 blur-3xl"
            style={{ background: 'radial-gradient(ellipse,rgb(var(--gym-accent)),transparent 70%)' }}
          />
          <span className="relative grid h-16 w-16 mx-auto place-items-center rounded-2xl bg-gym/15 text-[22px] font-bold text-gym ring-1 ring-inset ring-gym/30">
            {gym.name.slice(0, 2).toUpperCase()}
          </span>
          <h1 className="relative mt-5 text-[34px] font-bold leading-tight tracking-tight text-white sm:text-[42px]">
            {gym.name}
          </h1>
          <p className="relative mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[13.5px] text-ink-400">
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {gym.address}, {gym.city}
            </span>
            <span className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" />
              {gym.phone}
            </span>
          </p>

          <div className="relative mt-7 flex flex-wrap items-center justify-center gap-3">
            <LinkButton to="/login" variant="primary" size="lg" icon={<Smartphone className="h-4 w-4" />}>
              Entrar a mi portal
            </LinkButton>
            <a
              href={`tel:${gym.phone}`}
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-6 text-[15px] font-semibold text-ink-100 transition hover:bg-white/[.07]"
            >
              Llamar al gimnasio
            </a>
          </div>
        </div>

        {/* Membresías */}
        {plans.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-4 text-center text-[13px] font-semibold uppercase tracking-[.18em] text-ink-400">
              Membresías
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((p) => (
                <Card key={p.id} hover className="p-5">
                  <p className="text-[15px] font-semibold text-ink-50">{p.name}</p>
                  <p className="mt-2 text-[28px] font-bold text-gym tnum">{money0(p.price)}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-500">
                    <Clock className="h-3 w-3" />
                    {p.days} días de acceso
                  </p>
                  {p.benefits.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {p.benefits.map((b) => (
                        <li key={b} className="text-[12.5px] text-ink-400">
                          · {b}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ))}
            </div>
          </section>
        )}

        <p className="mt-12 text-center text-[12px] text-ink-600">
          Este gimnasio administra su operación con{' '}
          <Link to="/" className="font-semibold text-gym hover:underline">
            EasyGym
          </Link>
        </p>
      </main>
    </div>
  )
}
