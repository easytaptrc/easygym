import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, Check, CreditCard, Receipt, RefreshCw, XCircle } from 'lucide-react'
import type { PlanId, Subscription as Sub } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useToast } from '@/hooks/useToast'
import { platform } from '@/services/db'
import { changePlan } from '@/services/provisioning'
import { stripeWebhook } from '@/services/stripe'
import { watchCounters } from '@/services/aggregates'
import { limitLabel } from '@/config/plans'
import { usePlans } from '@/state/PlansContext'
import { fmtDate } from '@/lib/date'
import { money, money0 } from '@/lib/format'
import { reportError } from '@/lib/errors'
import { cx } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card'
import { Badge, LoadingBlock, Progress } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/Modal'

// ═══════════════════════════════════════════════════════════════════════════
// Suscripción del DUEÑO con EasyGym.
//
// Nada que ver con lo que los socios le pagan al gimnasio (eso vive en /pagos).
// Aquí se cambia de plan, se ven las facturas y se cancela.
// ═══════════════════════════════════════════════════════════════════════════

const STATUS: Record<string, { label: string; tone: 'gym' | 'warn' | 'danger' | 'neutral' }> = {
  ACTIVE: { label: 'Activa', tone: 'gym' },
  TRIALING: { label: 'En prueba', tone: 'cyber' as never },
  PAST_DUE: { label: 'Pago pendiente', tone: 'warn' },
  SUSPENDED: { label: 'Suspendida', tone: 'danger' },
  CANCELED: { label: 'Cancelada', tone: 'danger' },
}

export default function Subscription() {
  const { gym, refresh } = useSession()
  const { publicPlans, getPlan } = usePlans()
  const toast = useToast()

  const [sub, setSub] = useState<Sub | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [memberCount, setMemberCount] = useState(0)

  useEffect(() => {
    if (!gym?.subscriptionId) {
      setLoading(false)
      return
    }
    return platform.watch(
      'subscriptions',
      { where: [{ field: 'id', op: '==', value: gym.subscriptionId }] },
      (rows) => {
        setSub((rows[0] as Sub) ?? null)
        setLoading(false)
      },
    )
  }, [gym])

  // El total sale del contador, no de recorrer los socios.
  useEffect(() => {
    if (!gym) return
    return watchCounters(gym.id, (c) => setMemberCount(c?.members.total ?? 0))
  }, [gym])

  if (!gym) return <LoadingBlock />
  const plan = getPlan(gym.planId)
  const status = STATUS[gym.subscriptionStatus] ?? STATUS.ACTIVE

  async function switchPlan(planId: PlanId) {
    if (!gym || planId === gym.planId) return
    setBusy(true)
    try {
      await changePlan(gym.id, planId)
      await refresh()
      toast.success('Plan actualizado', `Ahora estás en ${getPlan(planId).name}.`)
    } catch (err) {
      toast.error('No se pudo cambiar el plan', reportError('cambiar de plan', err).message)
    } finally {
      setBusy(false)
    }
  }

  /** Simula el webhook de Stripe — sirve para demostrar todos los estados. */
  async function simulate(type: Parameters<typeof stripeWebhook.handle>[0]['type']) {
    if (!gym?.subscriptionId) return
    setBusy(true)
    try {
      await stripeWebhook.handle({ type, gymId: gym.id, subscriptionId: gym.subscriptionId })
      await refresh()
      toast.info('Evento aplicado', type)
    } finally {
      setBusy(false)
    }
  }

  const daysLeftInPeriod = sub
    ? Math.max(0, Math.ceil((sub.currentPeriodEnd - Date.now()) / 86_400_000))
    : 0

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Mi suscripción"
        description="Tu plan con EasyGym. No confundir con los pagos que tus socios te hacen a ti."
      />

      {loading ? (
        <LoadingBlock />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
          {/* Plan actual */}
          <div className="space-y-3">
            <Card lit>
              <CardBody className="pt-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="eyebrow">Plan actual</p>
                    <h2 className="mt-1.5 text-[30px] font-bold tracking-tight text-ink-50">{plan.name}</h2>
                    <p className="mt-1 text-[13px] text-ink-400">{plan.tagline}</p>
                  </div>
                  <div className="text-right">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <p className="mt-2 text-[26px] font-bold text-gym tnum">
                      {money0(plan.price ?? 0)}
                      <span className="text-[12px] font-medium text-ink-400"> /mes</span>
                    </p>
                  </div>
                </div>

                {sub && (
                  <div className="mt-5 rounded-xl border border-white/[.06] bg-ink-950/40 p-4">
                    <div className="mb-2 flex items-baseline justify-between">
                      <span className="text-[12.5px] text-ink-400">Periodo actual</span>
                      <span className="text-[12.5px] font-medium text-ink-200 tnum">
                        {daysLeftInPeriod} días restantes
                      </span>
                    </div>
                    <Progress
                      value={Date.now() - sub.currentPeriodStart}
                      max={Math.max(1, sub.currentPeriodEnd - sub.currentPeriodStart)}
                    />
                    <p className="mt-2 text-[11.5px] text-ink-500 tnum">
                      {fmtDate(sub.currentPeriodStart)} — {fmtDate(sub.currentPeriodEnd)}
                    </p>
                  </div>
                )}

                {/* Uso contra límites */}
                <div className="mt-4 space-y-3">
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-[12.5px] text-ink-400">Socios</span>
                      <span className="text-[12.5px] font-semibold text-ink-200 tnum">
                        {memberCount} / {limitLabel(plan.maxMembers)}
                      </span>
                    </div>
                    <Progress
                      value={memberCount}
                      max={plan.maxMembers ?? Math.max(memberCount, 1)}
                      tone={
                        plan.maxMembers && memberCount / plan.maxMembers > 0.9 ? 'danger' : 'gym'
                      }
                    />
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Cambio de plan */}
            <Card>
              <CardHeader title="Cambiar de plan" subtitle="El cambio es inmediato y no afecta tus datos" />
              <CardBody className="space-y-2">
                {publicPlans.map((p) => {
                  const current = p.id === gym.planId
                  return (
                    <div
                      key={p.id}
                      className={cx(
                        'flex flex-wrap items-center gap-4 rounded-xl border p-4 transition',
                        current ? 'border-gym/40 bg-gym/[.06]' : 'border-white/[.07] bg-white/[.02]',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-[15px] font-bold text-ink-50">
                          {p.name}
                          {current && <Badge tone="gym">Tu plan</Badge>}
                          {p.popular && !current && <Badge tone="cyber">Más popular</Badge>}
                        </p>
                        <p className="mt-0.5 text-[12.5px] text-ink-400">
                          {limitLabel(p.maxMembers)} socios · {limitLabel(p.maxStaff)} usuarios · {p.support}
                        </p>
                      </div>
                      <span className="text-[18px] font-bold text-ink-100 tnum">
                        {money0(p.price ?? 0)}
                      </span>
                      <Button
                        variant={current ? 'subtle' : 'ghost'}
                        size="sm"
                        disabled={current || busy}
                        onClick={() => switchPlan(p.id)}
                        iconRight={current ? undefined : <ArrowUpRight className="h-3.5 w-3.5" />}
                      >
                        {current ? 'Activo' : 'Cambiar'}
                      </Button>
                    </div>
                  )
                })}
                <Link
                  to="/planes"
                  className="mt-2 block text-center text-[12.5px] font-semibold text-gym hover:underline"
                >
                  Ver comparativa completa →
                </Link>
              </CardBody>
            </Card>
          </div>

          {/* Facturación */}
          <div className="space-y-3">
            <Card>
              <CardHeader title="Método de pago" icon={<CreditCard className="h-4 w-4" />} />
              <CardBody>
                <div className="flex items-center gap-3 rounded-xl border border-white/[.07] bg-ink-950/40 p-4">
                  <span className="grid h-10 w-14 place-items-center rounded-lg bg-white/[.06] font-mono text-[11px] font-bold text-ink-200">
                    VISA
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-ink-100">•••• •••• •••• 4242</p>
                    <p className="text-[11.5px] text-ink-500">Vence 12/29</p>
                  </div>
                </div>
                <p className="mt-3 text-[11.5px] leading-relaxed text-ink-500">
                  En producción esto abre el portal de facturación de Stripe, donde el dueño administra
                  su tarjeta sin que EasyGym la vea nunca.
                </p>
              </CardBody>
            </Card>

            {sub && sub.invoices && sub.invoices.length > 0 && (
              <Card>
                <CardHeader title="Facturas" icon={<Receipt className="h-4 w-4" />} />
                <CardBody>
                  <ul className="divide-y divide-white/[.05]">
                    {[...sub.invoices]
                      .sort((a, b) => b.paidAt - a.paidAt)
                      .map((i) => (
                        <li key={i.id} className="flex items-center gap-3 py-2.5">
                          <span
                            className={cx(
                              'grid h-7 w-7 shrink-0 place-items-center rounded-lg',
                              i.status === 'PAID' ? 'bg-tap-500/12 text-tap-400' : 'bg-danger-500/12 text-danger-400',
                            )}
                          >
                            {i.status === 'PAID' ? <Check className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-[11.5px] text-ink-400">{i.id}</p>
                            <p className="text-[11.5px] text-ink-500 tnum">{fmtDate(i.paidAt)}</p>
                          </div>
                          <span className="text-[13px] font-semibold text-ink-100 tnum">{money(i.amount)}</span>
                        </li>
                      ))}
                  </ul>
                </CardBody>
              </Card>
            )}

            {sub && (
              <Card>
                <CardHeader title="Detalles" />
                <CardBody className="divide-y divide-white/[.05]">
                  <DetailRow label="ID de suscripción">
                    <span className="font-mono text-[11.5px]">{sub.stripeSubscriptionId}</span>
                  </DetailRow>
                  <DetailRow label="Cliente Stripe">
                    <span className="font-mono text-[11.5px]">{sub.stripeCustomerId}</span>
                  </DetailRow>
                  <DetailRow label="Importe mensual">{money(sub.amount)}</DetailRow>
                  <DetailRow label="Renovación automática">
                    {sub.cancelAtPeriodEnd ? 'Desactivada' : 'Activada'}
                  </DetailRow>
                </CardBody>
              </Card>
            )}

            {/* Simulador de webhook — herramienta de demostración */}
            <Card className="border-cyber-400/20">
              <CardHeader
                title="Simulador de Stripe"
                subtitle="Solo en el prototipo: dispara eventos del webhook para ver cada estado"
                icon={<RefreshCw className="h-4 w-4" />}
              />
              <CardBody className="grid grid-cols-2 gap-2">
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => simulate('invoice.payment_succeeded')}>
                  Pago exitoso
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => simulate('invoice.payment_failed')}>
                  Pago rechazado
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  className="col-span-2"
                  onClick={() => simulate('customer.subscription.deleted')}
                >
                  Suscripción cancelada
                </Button>
              </CardBody>
            </Card>

            <Card>
              <CardBody className="pt-5">
                <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn-400" />
                  Si cancelas, <b className="text-ink-200">no borramos nada</b>. Tus socios, pagos e
                  historial se conservan y vuelven en cuanto contrates de nuevo.
                </p>
                <Button variant="ghost" className="mt-3 w-full text-danger-300" onClick={() => setCancelOpen(true)}>
                  Cancelar suscripción
                </Button>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      <ConfirmModal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="¿Cancelar tu suscripción?"
        message="Conservarás el acceso hasta el final del periodo pagado. Después, el gimnasio pasa a modo restringido pero tus datos siguen intactos."
        confirmLabel="Cancelar suscripción"
        loading={busy}
        onConfirm={async () => {
          await simulate('customer.subscription.deleted')
          setCancelOpen(false)
        }}
      />
    </div>
  )
}
