import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Headphones, Minus, Building2 } from 'lucide-react'
import type { Plan } from '@/types'
import { FEATURE_LABELS, limitLabel } from '@/config/plans'
import { usePlans } from '@/state/PlansContext'
import { money0 } from '@/lib/format'
import { cx } from '@/lib/utils'
import { Backdrop } from '@/components/ui/Backdrop'
import { Segmented } from '@/components/ui/Inputs'
import { PlanCard } from './PlanCard'
import { PublicNav, PublicFooter } from './PublicChrome'

// Página pública de precios con la comparativa completa.
// En móvil la tabla se convierte en tarjetas por plan: una matriz de 18 filas
// × 3 columnas dentro de un teléfono no se lee.

const ACCENT_TEXT = {
  tap: 'text-tap-400',
  cyber: 'text-cyber-400',
  plasma: 'text-plasma-400',
  ink: 'text-ink-200',
} as const

export default function Plans() {
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const { publicPlans } = usePlans()

  return (
    <div className="relative min-h-screen">
      <Backdrop variant="landing" />
      <PublicNav />

      <header className="px-4 pb-10 pt-12 text-center sm:px-6">
        <p className="eyebrow">Planes</p>
        <h1 className="mx-auto mt-3 max-w-2xl text-[36px] font-bold leading-tight tracking-tight text-white sm:text-[46px]">
          Elige el plan ideal <span className="text-tap">para tu gimnasio</span>
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-ink-400">
          Todos incluyen socios, membresías, asistencias y portal para tus clientes. Sin permanencia:
          cambias o cancelas cuando quieras.
        </p>

        <div className="mt-7 flex justify-center">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'cards', label: 'Planes' },
              { value: 'table', label: 'Comparar todo' },
            ]}
          />
        </div>
      </header>

      <main className="px-4 pb-16 sm:px-6">
        {view === 'cards' ? (
          <div className="mx-auto grid max-w-6xl items-start gap-4 lg:grid-cols-3">
            {publicPlans.map((p) => (
              <PlanCard key={p.id} plan={p} />
            ))}
          </div>
        ) : (
          <ComparisonTable plans={publicPlans} />
        )}

        {/* Enterprise */}
        <section className="mx-auto mt-6 max-w-6xl">
          <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-white/[.08] bg-ink-900/60 p-6 backdrop-blur-xl">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/[.05] text-ink-200 ring-1 ring-inset ring-white/10">
              <Building2 className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[18px] font-semibold text-white">Enterprise</h3>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-400">
                Para cadenas y franquicias: SLA a medida, SSO corporativo, infraestructura dedicada,
                integraciones propias y un gerente de cuenta asignado.
              </p>
            </div>
            <a
              href="mailto:hola@easygym.com?subject=Plan%20Enterprise"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-white/20 px-5 text-[14px] font-semibold text-ink-100 transition hover:bg-white/5"
            >
              Hablar con ventas
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </section>

        {/* Preguntas */}
        <section className="mx-auto mt-14 max-w-3xl">
          <h2 className="mb-6 text-center text-[24px] font-bold tracking-tight text-white">
            Preguntas frecuentes
          </h2>
          <div className="space-y-2.5">
            {[
              {
                q: '¿Puedo cambiar de plan después?',
                a: 'Sí, cuando quieras y desde tu propio panel. El cambio es inmediato y tus datos no se tocan: al subir de plan se desbloquean las funciones nuevas, al bajar simplemente dejan de estar disponibles.',
              },
              {
                q: '¿Qué pasa si dejo de pagar?',
                a: 'Tu cuenta pasa a un estado restringido, pero NO borramos nada. Tus socios, pagos e historial siguen ahí. En cuanto regularizas el pago, todo vuelve tal como lo dejaste.',
              },
              {
                q: '¿Las visitas cuentan como socios?',
                a: 'No. Una visita es un pase de un día: no crea membresía ni ocupa un lugar en tu límite de socios. Se registra, se cobra y aparece separada en tus reportes.',
              },
              {
                q: '¿Starter incluye reservación de clases?',
                a: 'No. La reservación de clases y el mapa de bicicletas están disponibles a partir de Pro. Starter cubre socios, membresías, asistencias, visitas, pagos manuales y portal del socio.',
              },
              {
                q: '¿Necesito comprar un lector de huella?',
                a: 'Solo si quieres control de acceso biométrico (Pro y Business). Funciona con lectores USB comunes conectados a la app de recepción de Windows. También puedes operar con QR o desde recepción.',
              },
              {
                q: '¿Mis socios necesitan descargar una app?',
                a: 'No hay que pasar por ninguna tienda. El portal se instala desde el navegador en dos toques y se comporta como una app nativa, con su ícono en la pantalla de inicio.',
              },
            ].map((f) => (
              <details
                key={f.q}
                className="group rounded-xl border border-white/[.07] bg-ink-900/50 px-5 py-4 backdrop-blur-xl transition-colors hover:border-white/[.12]"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14.5px] font-semibold text-ink-100">
                  {f.q}
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/10 text-ink-400 transition-transform duration-300 group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-[13.5px] leading-relaxed text-ink-400">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}

// ═══════════════════════════ Comparativa ════════════════════════════════════

function Yes({ accent }: { accent: keyof typeof ACCENT_TEXT }) {
  return (
    <span className="inline-grid place-items-center" aria-label="Incluido">
      <Check className={cx('h-[18px] w-[18px]', ACCENT_TEXT[accent])} />
    </span>
  )
}

function No() {
  return (
    <span className="inline-grid place-items-center text-ink-700" aria-label="No incluido">
      <Minus className="h-[18px] w-[18px]" />
    </span>
  )
}

function ComparisonTable({ plans: publicPlans }: { plans: Plan[] }) {
  return (
    <div className="mx-auto max-w-6xl">
      {/* Escritorio */}
      <div className="hidden overflow-hidden rounded-2xl border border-white/[.08] bg-ink-900/60 backdrop-blur-xl lg:block">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="w-[30%] border-b border-white/[.07] px-6 py-5 text-left">
                <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-ink-500">
                  Comparativa
                </p>
              </th>
              {publicPlans.map((p) => (
                <th
                  key={p.id}
                  className={cx(
                    'border-b border-white/[.07] px-4 py-5 text-center',
                    p.popular && 'bg-cyber-400/[.05]',
                  )}
                >
                  {p.popular && (
                    <span className="mb-2 inline-block rounded-full bg-cyber-400 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-950">
                      Más popular
                    </span>
                  )}
                  <p className={cx('text-[20px] font-bold', ACCENT_TEXT[p.accent])}>{p.name}</p>
                  <p className="mt-1 text-[22px] font-bold text-white tnum">
                    {money0(p.price ?? 0)}
                    <span className="text-[12px] font-medium text-ink-400"> /mes</span>
                  </p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row label="Número de socios">
              {publicPlans.map((p) => (
                <Cell key={p.id} popular={p.popular}>
                  <span className="text-[13px] font-semibold text-ink-100">{limitLabel(p.maxMembers)}</span>
                </Cell>
              ))}
            </Row>

            {FEATURE_LABELS.map((f) => (
              <Row key={f.key} label={f.label}>
                {publicPlans.map((p) => (
                  <Cell key={p.id} popular={p.popular}>
                    {p.features[f.key] ? <Yes accent={p.accent} /> : <No />}
                  </Cell>
                ))}
              </Row>
            ))}

            <Row label="Usuarios administrativos">
              {publicPlans.map((p) => (
                <Cell key={p.id} popular={p.popular}>
                  <span className="text-[13px] font-semibold text-ink-100">{limitLabel(p.maxStaff)}</span>
                </Cell>
              ))}
            </Row>
            <Row label="Sucursales">
              {publicPlans.map((p) => (
                <Cell key={p.id} popular={p.popular}>
                  <span className="text-[13px] font-semibold text-ink-100">{limitLabel(p.maxBranches)}</span>
                </Cell>
              ))}
            </Row>
            <Row label="Soporte" icon={<Headphones className="h-3.5 w-3.5" />}>
              {publicPlans.map((p) => (
                <Cell key={p.id} popular={p.popular}>
                  <span className="text-[12.5px] text-ink-300">{p.support}</span>
                </Cell>
              ))}
            </Row>

            <tr>
              <td className="px-6 py-5" />
              {publicPlans.map((p) => (
                <td key={p.id} className={cx('px-4 py-5 text-center', p.popular && 'bg-cyber-400/[.05]')}>
                  <Link
                    to={`/registro?plan=${p.id}`}
                    className={cx(
                      'inline-flex h-10 w-full max-w-[180px] items-center justify-center gap-1.5 rounded-xl border text-[13.5px] font-bold transition-all active:scale-[.98]',
                      p.popular
                        ? 'border-transparent bg-cyber-400 text-ink-950 hover:bg-cyber-300'
                        : p.accent === 'plasma'
                          ? 'border-plasma-400/50 text-plasma-300 hover:bg-plasma-400/10'
                          : 'border-tap-500/50 text-tap-300 hover:bg-tap-500/10',
                    )}
                  >
                    Comenzar ahora
                  </Link>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Móvil / tablet */}
      <div className="grid gap-4 lg:hidden">
        {publicPlans.map((p) => (
          <div key={p.id}>
            <PlanCard plan={p} />
          </div>
        ))}
        <p className="px-2 text-center text-[12.5px] text-ink-500">
          Consulta la comparativa completa desde una pantalla más grande, o escríbenos y te la mandamos.
        </p>
      </div>
    </div>
  )
}

function Row({ label, children, icon }: { label: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <tr className="transition-colors hover:bg-white/[.02]">
      <td className="border-b border-white/[.04] px-6 py-3">
        <span className="flex items-center gap-2 text-[13.5px] text-ink-300">
          {icon}
          {label}
        </span>
      </td>
      {children}
    </tr>
  )
}

function Cell({ children, popular }: { children: React.ReactNode; popular?: boolean }) {
  return (
    <td
      className={cx(
        'border-b border-white/[.04] px-4 py-3 text-center',
        popular && 'bg-cyber-400/[.05]',
      )}
    >
      {children}
    </td>
  )
}
