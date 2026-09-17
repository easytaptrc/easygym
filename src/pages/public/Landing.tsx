import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  Bike,
  Building2,
  CalendarCheck,
  Check,
  Cloud,
  CreditCard,
  Fingerprint,
  Clock,
  Rocket,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Ticket,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react'
import { BRAND } from '@/config/brand'
import { usePlans } from '@/state/PlansContext'
import { money0 } from '@/lib/format'
import { cx } from '@/lib/utils'
import { Logo, NfcMark } from '@/components/ui/Logo'
import { Backdrop, Marquee } from '@/components/ui/Backdrop'
import { LinkButton } from '@/components/ui/Button'
import { PlanCard } from './PlanCard'
import { PublicNav, PublicFooter } from './PublicChrome'

// ═══════════════════════════════════════════════════════════════════════════
// Landing pública de EasyGym.
//
// Estética: negro, malla técnica, auroras y el gesto "tap" del logo como hilo
// conductor. Las animaciones son de entrada y de estado — nada que se mueva
// sin parar delante de quien está leyendo.
// ═══════════════════════════════════════════════════════════════════════════

/** Revela un bloque al entrar en pantalla. */
function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={cx('transition-all duration-700 ease-spring', className)}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'translateY(22px)',
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}

const BENEFITS = [
  { icon: BarChart3, title: 'Más control', detail: 'Sabes exactamente cuánto entró hoy y de dónde.' },
  { icon: Users, title: 'Más socios', detail: 'Avisos automáticos antes de que una membresía venza.' },
  { icon: TrendingUp, title: 'Más ingresos', detail: 'Renovaciones, visitas y productos en un solo lugar.' },
  { icon: Clock, title: 'Más tiempo para ti', detail: 'Se acabó el cuaderno y la hoja de cálculo.' },
]

const FEATURES = [
  {
    icon: Users,
    title: 'Socios y membresías',
    detail:
      'Alta en 30 segundos, estado de cada membresía al día y renovaciones encadenadas: quien renueva antes no pierde días.',
    tone: 'tap',
  },
  {
    icon: Fingerprint,
    title: 'Control de acceso',
    detail:
      'Huella, QR o recepción. La pantalla dice ACCESO AUTORIZADO o DENEGADO en letras grandes, con foto y vigencia.',
    tone: 'cyber',
  },
  {
    icon: Bike,
    title: 'Mapa de bicicletas',
    detail:
      'Tus socios eligen su bici como quien elige butaca en el cine. Dos personas nunca acaban en la misma.',
    tone: 'plasma',
  },
  {
    icon: Ticket,
    title: 'Visitas de un día',
    detail:
      'Una visita no es una membresía. Se cobra, se imprime y aparece separada en todos tus reportes.',
    tone: 'warn',
  },
  {
    icon: CreditCard,
    title: 'Cobros automáticos',
    detail: 'Stripe cobra solo cada mes. Tú ves el dinero entrar sin perseguir a nadie.',
    tone: 'tap',
  },
  {
    icon: Smartphone,
    title: 'App para tus socios',
    detail:
      'Se instala desde el navegador. Ven su vigencia, reservan clase y renuevan sin pasar por recepción.',
    tone: 'cyber',
  },
] as const

const TONE_CLASS = {
  tap: 'text-tap-400 ring-tap-500/25',
  cyber: 'text-cyber-400 ring-cyber-400/25',
  plasma: 'text-plasma-400 ring-plasma-400/25',
  warn: 'text-warn-400 ring-warn-500/25',
} as const

const TRUST = [
  { icon: Rocket, title: 'Implementación rápida', detail: 'Empieza en pocos días' },
  { icon: ShieldCheck, title: 'Seguro y confiable', detail: 'Tus datos siempre protegidos' },
  { icon: Cloud, title: 'En cualquier dispositivo', detail: 'Web, tablet y móvil' },
  { icon: Zap, title: 'Actualizaciones sin costo', detail: 'Siempre en la mejor versión' },
]

export default function Landing() {
  // Precios y planes salen del catálogo vivo: si el SuperAdmin cambia un
  // precio, la landing lo refleja sin recompilar.
  const { publicPlans } = usePlans()

  return (
    <div className="relative min-h-screen">
      <Backdrop variant="landing" />
      <PublicNav />

      {/* ══════════════════════ HERO ══════════════════════ */}
      <header className="relative px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
        <div className="mx-auto max-w-6xl">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_.95fr]">
            <div>
              <Reveal>
                <span className="inline-flex items-center gap-2 rounded-full border border-tap-500/25 bg-tap-500/[.08] px-3 py-1.5 text-[12px] font-semibold text-tap-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  {BRAND.subtitle}
                </span>
              </Reveal>

              <Reveal delay={80}>
                <h1 className="mt-5 text-[40px] font-bold leading-[1.02] tracking-[-0.035em] text-white sm:text-[58px]">
                  Más que software,
                  <br />
                  <span className="text-tap">tu aliado</span>
                  <br />
                  en el crecimiento
                </h1>
              </Reveal>

              <Reveal delay={150}>
                <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-ink-300">
                  {BRAND.name} administra tu gimnasio completo: socios, membresías, cobros, control de
                  acceso, clases y reservación de bicicletas. Todo en un solo lugar, desde cualquier
                  dispositivo.
                </p>
              </Reveal>

              <Reveal delay={210}>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <LinkButton
                    to="/registro"
                    variant="primary"
                    size="lg"
                    iconRight={<ArrowRight className="h-4 w-4" />}
                  >
                    Comenzar ahora
                  </LinkButton>
                  <LinkButton to="/planes" variant="ghost" size="lg">
                    Ver planes y precios
                  </LinkButton>
                </div>
              </Reveal>

              <Reveal delay={270}>
                <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2">
                  {['Sin permanencia', 'Configúralo en un día', 'Soporte en español'].map((t) => (
                    <li key={t} className="flex items-center gap-2 text-[13px] text-ink-400">
                      <Check className="h-3.5 w-3.5 text-tap-400" />
                      {t}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>

            {/* Maqueta del producto */}
            <Reveal delay={200}>
              <HeroMockup />
            </Reveal>
          </div>

          <Reveal delay={340} className="mt-14">
            <Marquee
              items={[
                'Administra',
                'Controla',
                'Haz crecer tu negocio',
                'Disciplina siempre',
                'Resultados',
                'Sin cuadernos',
                'Sin hojas de cálculo',
              ]}
            />
          </Reveal>
        </div>
      </header>

      {/* ══════════════════════ BENEFICIOS ══════════════════════ */}
      <section className="px-4 py-12 sm:px-6">
        <div className="mx-auto grid max-w-6xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map((b, i) => (
            <Reveal key={b.title} delay={i * 70}>
              <div className="group h-full rounded-2xl border border-white/[.07] bg-ink-900/60 p-5 backdrop-blur-xl transition-all duration-300 ease-spring hover:-translate-y-1 hover:border-tap-500/25">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-tap-500/10 text-tap-400 ring-1 ring-inset ring-tap-500/20 transition-transform duration-300 group-hover:scale-110">
                  <b.icon className="h-5 w-5" />
                </span>
                <p className="mt-4 text-[15px] font-semibold text-ink-50">{b.title}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-400">{b.detail}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ══════════════════════ FUNCIONES ══════════════════════ */}
      <section id="funciones" className="px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <Reveal className="mb-10 text-center">
            <p className="eyebrow">Todo lo que necesitas</p>
            <h2 className="mt-3 text-[32px] font-bold tracking-tight text-white sm:text-[40px]">
              Un sistema, <span className="text-tap">cero cuadernos</span>
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-ink-400">
              Cada herramienta resuelve un problema real de recepción. Nada de módulos que nadie abre.
            </p>
          </Reveal>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 60}>
                <article className="group relative h-full overflow-hidden rounded-2xl border border-white/[.07] bg-ink-900/60 p-6 backdrop-blur-xl transition-all duration-300 ease-spring hover:-translate-y-1 hover:border-white/[.16] hover:shadow-pop">
                  <span className="pointer-events-none absolute inset-x-8 -top-px h-px bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                  <span
                    className={cx(
                      'grid h-11 w-11 place-items-center rounded-xl bg-white/[.04] ring-1 ring-inset',
                      TONE_CLASS[f.tone],
                    )}
                  >
                    <f.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-[16px] font-semibold text-ink-50">{f.title}</h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-ink-400">{f.detail}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════ CÓMO FUNCIONA ══════════════════════ */}
      <section className="px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <Reveal className="mb-10 text-center">
            <p className="eyebrow">En cuatro pasos</p>
            <h2 className="mt-3 text-[32px] font-bold tracking-tight text-white sm:text-[40px]">
              De cero a operando
            </h2>
          </Reveal>

          <ol className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { n: '01', t: 'Elige tu plan', d: 'Starter, Pro o Business. Cambias cuando quieras.' },
              { n: '02', t: 'Crea tu cuenta', d: 'Tu gimnasio se crea solo, con su propio espacio.' },
              { n: '03', t: 'Carga tus socios', d: 'Membresías y precios listos desde el primer día.' },
              { n: '04', t: 'Empieza a cobrar', d: 'Recepción, accesos y reportes funcionando.' },
            ].map((s, i) => (
              <Reveal key={s.n} delay={i * 90}>
                <li className="relative h-full rounded-2xl border border-white/[.07] bg-ink-900/50 p-5 backdrop-blur-xl">
                  <span className="font-mono text-[28px] font-bold leading-none text-tap-500/40">{s.n}</span>
                  <p className="mt-3 text-[15px] font-semibold text-ink-50">{s.t}</p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-400">{s.d}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* ══════════════════════ PLANES ══════════════════════ */}
      <section id="planes" className="px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <Reveal className="mb-10 text-center">
            <p className="eyebrow">Planes</p>
            <h2 className="mt-3 text-[32px] font-bold tracking-tight text-white sm:text-[40px]">
              Elige el plan ideal para tu gimnasio
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-[15px] text-ink-400">
              Sin permanencia. Cambia de plan o cancela cuando quieras.
            </p>
          </Reveal>

          <div className="grid items-start gap-4 lg:grid-cols-3">
            {publicPlans.map((plan, i) => (
              <Reveal key={plan.id} delay={i * 90}>
                <PlanCard plan={plan} />
              </Reveal>
            ))}
          </div>

          <Reveal delay={280}>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-white/[.07] bg-ink-900/50 px-6 py-5 text-center backdrop-blur-xl">
              <Building2 className="h-5 w-5 text-ink-400" />
              <p className="text-[14px] text-ink-300">
                ¿Cadena o franquicia con varias sucursales?{' '}
                <span className="font-semibold text-white">Tenemos plan Enterprise.</span>
              </p>
              <Link to="/planes" className="text-[13.5px] font-semibold text-tap-400 hover:underline">
                Ver comparativa completa →
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══════════════════════ CONFIANZA ══════════════════════ */}
      <section className="px-4 py-12 sm:px-6">
        <div className="mx-auto grid max-w-6xl gap-4 border-y border-white/[.06] py-10 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map((t, i) => (
            <Reveal key={t.title} delay={i * 70}>
              <div className="flex items-start gap-3">
                <t.icon className="mt-0.5 h-5 w-5 shrink-0 text-tap-400" />
                <div>
                  <p className="text-[14px] font-semibold text-ink-100">{t.title}</p>
                  <p className="mt-0.5 text-[12.5px] text-ink-400">{t.detail}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ══════════════════════ CIERRE ══════════════════════ */}
      <section className="px-4 py-20 sm:px-6">
        <Reveal>
          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-white/[.09] bg-ink-900/60 px-6 py-14 text-center backdrop-blur-xl">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 -top-32 h-64 opacity-30 blur-3xl"
              style={{ background: 'radial-gradient(ellipse,#22E06B,transparent 70%)' }}
            />
            <NfcMark size={34} className="mx-auto text-tap-400" />
            <h2 className="mt-5 text-[30px] font-bold leading-tight tracking-tight text-white sm:text-[38px]">
              Gimnasios más fuertes,
              <br />
              <span className="text-tap">negocios más grandes</span>
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-ink-400">
              Empieza hoy con tu gimnasio. Se crea solo en cuanto eliges tu plan.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <LinkButton
                to="/registro"
                variant="primary"
                size="lg"
                iconRight={<ArrowRight className="h-4 w-4" />}
              >
                Crear mi gimnasio
              </LinkButton>
              <LinkButton to="/login" variant="ghost" size="lg">
                Ya tengo cuenta
              </LinkButton>
            </div>
          </div>
        </Reveal>
      </section>

      <PublicFooter />
    </div>
  )
}

// ═══════════════════════════ Maqueta del hero ═══════════════════════════════
// Recrea el panel real con datos estáticos: es la promesa visual del producto.

function HeroMockup() {
  // El precio de la insignia sale del catálogo vivo, igual que la sección de
  // planes: dos sitios mostrando precios distintos sería peor que no mostrarlo.
  const { publicPlans } = usePlans()

  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-8 opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(ellipse at 60% 40%,#22E06B33,transparent 70%)' }}
      />

      {/* Panel */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[.1] bg-ink-900/85 shadow-pop backdrop-blur-xl">
        <div className="flex items-center gap-2 border-b border-white/[.06] px-4 py-2.5">
          <span className="h-2 w-2 rounded-full bg-danger-500/70" />
          <span className="h-2 w-2 rounded-full bg-warn-500/70" />
          <span className="h-2 w-2 rounded-full bg-tap-500/70" />
          <Logo size="xs" still className="ml-2" />
        </div>

        <div className="space-y-3 p-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { l: 'Socios activos', v: '412', c: 'text-tap-400' },
              { l: 'Ventas hoy', v: '$18.4k', c: 'text-cyber-400' },
              { l: 'Por vencer', v: '27', c: 'text-warn-400' },
            ].map((k) => (
              <div key={k.l} className="rounded-xl border border-white/[.06] bg-ink-950/60 p-2.5">
                <p className="truncate text-[9.5px] text-ink-500">{k.l}</p>
                <p className={cx('mt-1 text-[17px] font-bold tnum', k.c)}>{k.v}</p>
              </div>
            ))}
          </div>

          {/* Gráfica decorativa */}
          <div className="rounded-xl border border-white/[.06] bg-ink-950/60 p-3">
            <p className="mb-2 text-[10px] text-ink-500">Ingresos · últimos 30 días</p>
            <svg viewBox="0 0 280 74" className="w-full" aria-hidden="true">
              <defs>
                <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22E06B" stopOpacity=".38" />
                  <stop offset="100%" stopColor="#22E06B" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0 58 C24 54 34 40 54 42 C76 44 86 24 108 27 C130 30 140 47 162 41 C186 35 196 16 220 13 C244 10 258 22 280 8"
                fill="none"
                stroke="#22E06B"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M0 58 C24 54 34 40 54 42 C76 44 86 24 108 27 C130 30 140 47 162 41 C186 35 196 16 220 13 C244 10 258 22 280 8 L280 74 L0 74 Z"
                fill="url(#heroFill)"
              />
            </svg>
          </div>

          {/* Filas de socios */}
          <div className="space-y-1.5">
            {[
              { n: 'Valeria Ortiz', s: 'Activo', c: 'bg-tap-500/15 text-tap-300' },
              { n: 'Miguel Herrera', s: 'Por vencer', c: 'bg-warn-500/15 text-warn-300' },
              { n: 'Andrea Campos', s: 'Activo', c: 'bg-tap-500/15 text-tap-300' },
            ].map((r) => (
              <div
                key={r.n}
                className="flex items-center gap-2.5 rounded-lg border border-white/[.05] bg-ink-950/40 px-2.5 py-2"
              >
                <span className="h-6 w-6 rounded-full bg-gradient-to-br from-ink-600 to-ink-800" />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-200">{r.n}</span>
                <span className={cx('rounded-full px-2 py-0.5 text-[9.5px] font-semibold', r.c)}>{r.s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Teléfono flotante con el portal del socio */}
      <div className="absolute -bottom-8 -right-2 w-[132px] animate-float sm:-right-6 sm:w-[152px]">
        <div className="overflow-hidden rounded-[20px] border border-white/[.14] bg-ink-950 p-1.5 shadow-pop">
          <div className="rounded-[15px] bg-gradient-to-b from-ink-900 to-ink-950 px-3 py-4 text-center">
            <div className="relative mx-auto grid h-12 w-12 place-items-center">
              <span className="absolute inset-0 animate-pulse-ring rounded-full bg-tap-500/30" />
              <span className="grid h-12 w-12 place-items-center rounded-full bg-tap-500/15 ring-1 ring-tap-400/40">
                <Check className="h-6 w-6 text-tap-400" />
              </span>
            </div>
            <p className="mt-3 text-[10px] text-ink-400">Mi membresía</p>
            <p className="text-[15px] font-bold text-tap-400">Activa</p>
            <p className="mt-1.5 text-[9px] text-ink-500">Vence en 24 días</p>
            <div className="mt-3 rounded-lg bg-tap-400 py-1.5 text-[9.5px] font-bold text-ink-950">
              Renovar
            </div>
          </div>
        </div>
      </div>

      {/* Insignia de precio */}
      <div
        className="absolute -left-4 bottom-12 hidden animate-float rounded-xl border border-white/10 bg-ink-900/90 px-3 py-2 shadow-pop backdrop-blur lg:block"
        style={{ animationDelay: '-2s' }}
      >
        <p className="text-[9.5px] text-ink-500">Desde</p>
        <p className="text-[15px] font-bold text-white tnum">
          {money0(publicPlans[0]?.price ?? 0)}
          <span className="text-[10px] font-medium text-ink-400"> /mes</span>
        </p>
      </div>

      <CalendarCheck className="pointer-events-none absolute -right-4 top-1/3 hidden h-5 w-5 animate-float text-cyber-400/60 lg:block" />
    </div>
  )
}
