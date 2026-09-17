import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Check, CreditCard, Lock, PartyPopper, ShieldCheck } from 'lucide-react'
import { getPlan } from '@/config/plans'
import { BRAND } from '@/config/brand'
import { money0 } from '@/lib/format'
import { cx } from '@/lib/utils'
import { Backdrop } from '@/components/ui/Backdrop'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Inputs'
import { Logo } from '@/components/ui/Logo'
import { useToast } from '@/hooks/useToast'
import { useSession } from '@/state/SessionContext'
import {
  PROVISION_LABELS,
  registerGym,
  type ProvisionStep,
  type RegisterGymInput,
} from '@/services/provisioning'
import { StripeError, TEST_CARDS } from '@/services/stripe'
import { PublicNav } from './PublicChrome'

// ═══════════════════════════════════════════════════════════════════════════
// Checkout — el dueño le paga a EasyGym.
//
// Cuando el pago pasa, `registerGym` provisiona TODO el tenant de una vez:
// gymId, gimnasio, usuario OWNER, configuración, suscripción y membresías base.
// El usuario ve cada paso: si algo falla, sabe exactamente dónde.
//
// ⚠️ MOCK: no se usa ninguna clave real. En producción esta pantalla solo crea
// una Checkout Session y quien provisiona es el webhook, en el servidor.
// ═══════════════════════════════════════════════════════════════════════════

export default function Checkout() {
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const { signIn } = useSession()

  const data = location.state as Omit<RegisterGymInput, 'card'> | null

  const [card, setCard] = useState({ number: TEST_CARDS.success, exp: '12/29', cvc: '123', name: '' })
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<ProvisionStep | null>(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!data) return <Navigate to="/registro" replace />

  const plan = getPlan(data.planId)

  async function pay() {
    if (!data) return
    setBusy(true)
    setError(null)
    try {
      await registerGym({ ...data, card: { ...card, name: card.name || data.ownerName } }, setStep)
      setDone(true)
      // Entra directo a su panel: nadie quiere volver a escribir la contraseña
      // treinta segundos después de haberla creado.
      await signIn(data.email, data.password)
      toast.success('¡Tu gimnasio está listo!', `Bienvenido a ${BRAND.name}, ${data.ownerName.split(' ')[0]}.`)
      setTimeout(() => navigate('/dashboard', { replace: true }), 1400)
    } catch (err) {
      const message =
        err instanceof StripeError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'No pudimos procesar el pago.'
      setError(message)
      toast.error('El pago no se completó', message)
      setStep(null)
    } finally {
      setBusy(false)
    }
  }

  if (done) return <SuccessScreen gymName={data.gymName} planName={plan.name} />

  return (
    <div className="relative min-h-screen">
      <Backdrop variant="auth" />
      <PublicNav />

      <main className="mx-auto grid max-w-4xl gap-5 px-4 pb-20 pt-8 sm:px-6 lg:grid-cols-[1.15fr_.85fr]">
        {/* Formulario */}
        <div className="rounded-2xl border border-white/[.08] bg-ink-900/70 p-6 shadow-card backdrop-blur-xl sm:p-7">
          <h1 className="text-[24px] font-bold tracking-tight text-white">Confirma tu suscripción</h1>
          <p className="mt-1.5 text-sm text-ink-400">
            En cuanto se procese el pago creamos tu gimnasio automáticamente.
          </p>

          <div className="mt-6 space-y-4">
            <Input
              label="Nombre en la tarjeta"
              value={card.name}
              onChange={(e) => setCard((c) => ({ ...c, name: e.target.value }))}
              placeholder={data.ownerName}
              autoComplete="cc-name"
            />
            <Input
              label="Número de tarjeta"
              value={card.number}
              onChange={(e) => setCard((c) => ({ ...c, number: e.target.value }))}
              prefix={<CreditCard className="h-4 w-4" />}
              inputMode="numeric"
              autoComplete="cc-number"
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Vencimiento"
                value={card.exp}
                onChange={(e) => setCard((c) => ({ ...c, exp: e.target.value }))}
                placeholder="MM/AA"
                autoComplete="cc-exp"
              />
              <Input
                label="CVC"
                value={card.cvc}
                onChange={(e) => setCard((c) => ({ ...c, cvc: e.target.value }))}
                placeholder="123"
                maxLength={4}
                autoComplete="cc-csc"
              />
            </div>
          </div>

          {/* Tarjetas de prueba */}
          <div className="mt-5 rounded-xl border border-cyber-400/20 bg-cyber-400/[.06] p-4">
            <p className="flex items-center gap-2 text-[12px] font-semibold text-cyber-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Modo demostración — no se cobra nada
            </p>
            <ul className="mt-2.5 space-y-1.5">
              {[
                { label: 'Pago exitoso', value: TEST_CARDS.success },
                { label: 'Tarjeta rechazada', value: TEST_CARDS.declined },
                { label: 'Tarjeta vencida', value: TEST_CARDS.expired },
              ].map((t) => (
                <li key={t.value} className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-ink-400">{t.label}</span>
                  <button
                    onClick={() => setCard((c) => ({ ...c, number: t.value }))}
                    className="rounded-md bg-white/[.06] px-2 py-1 font-mono text-[11.5px] text-ink-200 transition hover:bg-white/[.12]"
                  >
                    {t.value}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {error && (
            <p className="mt-4 rounded-xl border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-[13px] text-danger-200">
              {error}
            </p>
          )}

          {/* Progreso de provisión */}
          {busy && step && (
            <div className="mt-5 space-y-2">
              {(Object.keys(PROVISION_LABELS) as ProvisionStep[]).map((s) => {
                const order = Object.keys(PROVISION_LABELS) as ProvisionStep[]
                const idx = order.indexOf(s)
                const current = order.indexOf(step)
                const state = idx < current ? 'done' : idx === current ? 'active' : 'pending'
                return (
                  <div key={s} className="flex items-center gap-2.5">
                    <span
                      className={cx(
                        'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] transition-colors',
                        state === 'done'
                          ? 'bg-gym text-ink-950'
                          : state === 'active'
                            ? 'bg-gym/25 text-gym'
                            : 'bg-white/[.05] text-ink-600',
                      )}
                    >
                      {state === 'done' ? (
                        <Check className="h-3 w-3" />
                      ) : state === 'active' ? (
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gym" />
                      ) : null}
                    </span>
                    <span
                      className={cx(
                        'text-[13px]',
                        state === 'pending' ? 'text-ink-600' : 'text-ink-200',
                      )}
                    >
                      {PROVISION_LABELS[s]}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          <Button variant="primary" size="lg" block className="mt-6" loading={busy} onClick={pay}>
            {busy ? 'Procesando…' : `Pagar ${money0(plan.price ?? 0)} y crear mi gimnasio`}
          </Button>

          <p className="mt-3 flex items-center justify-center gap-1.5 text-[11.5px] text-ink-500">
            <Lock className="h-3 w-3" />
            Pago seguro procesado por Stripe · Cancela cuando quieras
          </p>
        </div>

        {/* Resumen */}
        <aside className="h-fit rounded-2xl border border-white/[.08] bg-ink-900/70 p-6 shadow-card backdrop-blur-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-ink-500">Tu pedido</p>

          <div className="mt-4 flex items-baseline justify-between gap-3">
            <span className="text-[16px] font-bold text-white">Plan {plan.name}</span>
            <span className="text-[20px] font-bold text-white tnum">{money0(plan.price ?? 0)}</span>
          </div>
          <p className="mt-0.5 text-[12px] text-ink-500">Facturación mensual · MXN</p>

          <div className="my-5 divider" />

          <p className="text-[12.5px] font-semibold text-ink-300">Incluye</p>
          <ul className="mt-2.5 space-y-2">
            {plan.highlights.slice(0, 7).map((h) => (
              <li key={h} className="flex items-start gap-2 text-[12.5px] text-ink-400">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gym" />
                {h}
              </li>
            ))}
          </ul>

          <div className="my-5 divider" />

          <dl className="space-y-2">
            <div className="flex justify-between gap-3 text-[12.5px]">
              <dt className="text-ink-500">Gimnasio</dt>
              <dd className="min-w-0 truncate font-medium text-ink-200">{data.gymName}</dd>
            </div>
            <div className="flex justify-between gap-3 text-[12.5px]">
              <dt className="text-ink-500">Dueño</dt>
              <dd className="min-w-0 truncate font-medium text-ink-200">{data.ownerName}</dd>
            </div>
            <div className="flex justify-between gap-3 text-[12.5px]">
              <dt className="text-ink-500">Ciudad</dt>
              <dd className="min-w-0 truncate font-medium text-ink-200">
                {data.city}, {data.state}
              </dd>
            </div>
          </dl>

          <div className="mt-5 flex items-baseline justify-between border-t border-white/[.07] pt-4">
            <span className="text-[13px] font-semibold text-ink-200">Total hoy</span>
            <span className="text-[22px] font-bold text-gym tnum">{money0(plan.price ?? 0)}</span>
          </div>
        </aside>
      </main>
    </div>
  )
}

function SuccessScreen({ gymName, planName }: { gymName: string; planName: string }) {
  return (
    <div className="relative grid min-h-screen place-content-center px-6 text-center">
      <Backdrop variant="auth" />
      <div className="animate-scale-in">
        <div className="relative mx-auto grid h-20 w-20 place-items-center">
          <span className="absolute inset-0 animate-pulse-ring rounded-full bg-gym/30" />
          <span className="grid h-20 w-20 place-items-center rounded-full bg-gym/15 ring-2 ring-gym/40">
            <PartyPopper className="h-9 w-9 text-gym" />
          </span>
        </div>
        <h1 className="mt-7 text-[30px] font-bold tracking-tight text-white">
          ¡Bienvenido a <Logo size="md" className="align-baseline" still />!
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-ink-400">
          <span className="font-semibold text-ink-100">{gymName}</span> ya está creado con el plan{' '}
          <span className="font-semibold text-gym">{planName}</span>. Te llevamos a tu panel…
        </p>
        <div className="mx-auto mt-6 h-1 w-40 overflow-hidden rounded-full bg-ink-800">
          <div className="h-full w-1/3 animate-shimmer rounded-full bg-gym" />
        </div>
      </div>
    </div>
  )
}
