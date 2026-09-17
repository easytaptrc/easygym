import { useMemo } from 'react'
import { CreditCard, TrendingUp } from 'lucide-react'
import type { Subscription } from '@/types'
import { getPlan } from '@/config/plans'
import { fmtDate } from '@/lib/date'
import { money, money0 } from '@/lib/format'
import { cx } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Badge, EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { usePlatformData } from './usePlatformData'

// Suscripciones que los DUEÑOS tienen con EasyGym. No confundir con los pagos
// que los socios hacen a sus gimnasios: esos viven dentro de cada tenant.

const STATUS_TONE: Record<string, 'gym' | 'warn' | 'danger' | 'neutral'> = {
  ACTIVE: 'gym',
  TRIALING: 'neutral',
  PAST_DUE: 'warn',
  SUSPENDED: 'danger',
  CANCELED: 'danger',
}

export default function SuperSubscriptions() {
  const { gyms, subscriptions, loading } = usePlatformData()

  const gymName = (id: string) => gyms.find((g) => g.id === id)?.name ?? '—'

  const stats = useMemo(() => {
    const active = subscriptions.filter((s) => s.status === 'ACTIVE')
    const mrr = active.reduce((a, s) => a + s.amount, 0)
    const arr = mrr * 12
    const invoiced = subscriptions.reduce(
      (a, s) => a + (s.invoices ?? []).filter((i) => i.status === 'PAID').reduce((b, i) => b + i.amount, 0),
      0,
    )
    const failed = subscriptions.reduce(
      (a, s) => a + (s.invoices ?? []).filter((i) => i.status === 'FAILED').length,
      0,
    )
    return { mrr, arr, invoiced, failed, active: active.length }
  }, [subscriptions])

  const columns: Column<Subscription>[] = [
    {
      key: 'gym',
      header: 'Gimnasio',
      sortValue: (s) => gymName(s.gymId),
      cell: (s) => <span className="truncate text-[13.5px] font-medium text-ink-100">{gymName(s.gymId)}</span>,
    },
    {
      key: 'plan',
      header: 'Plan',
      sortValue: (s) => s.planId,
      cell: (s) => {
        const p = getPlan(s.planId)
        return <Badge tone={p.accent === 'ink' ? 'neutral' : (p.accent as never)}>{p.name}</Badge>
      },
    },
    {
      key: 'amount',
      header: 'Importe',
      align: 'right',
      sortValue: (s) => s.amount,
      cell: (s) => <span className="text-[13px] font-semibold text-plasma-300 tnum">{money(s.amount)}</span>,
    },
    {
      key: 'period',
      header: 'Periodo actual',
      hideOnMobile: true,
      sortValue: (s) => s.currentPeriodEnd,
      cell: (s) => (
        <span className="whitespace-nowrap text-[12.5px] text-ink-400 tnum">
          {fmtDate(s.currentPeriodStart)} — {fmtDate(s.currentPeriodEnd)}
        </span>
      ),
    },
    {
      key: 'stripe',
      header: 'Stripe',
      hideOnMobile: true,
      cell: (s) => <span className="font-mono text-[11px] text-ink-500">{s.stripeSubscriptionId}</span>,
    },
    {
      key: 'invoices',
      header: 'Facturas',
      align: 'right',
      hideOnMobile: true,
      cell: (s) => {
        const paid = (s.invoices ?? []).filter((i) => i.status === 'PAID').length
        const failed = (s.invoices ?? []).filter((i) => i.status === 'FAILED').length
        return (
          <span className="text-[12.5px] tnum">
            <span className="text-tap-400">{paid}</span>
            {failed > 0 && <span className="text-danger-400"> / {failed} fallidas</span>}
          </span>
        )
      },
    },
    {
      key: 'status',
      header: 'Estado',
      align: 'right',
      sortValue: (s) => s.status,
      cell: (s) => (
        <Badge tone={STATUS_TONE[s.status] ?? 'neutral'} dot>
          {s.status}
        </Badge>
      ),
    },
  ]

  if (loading) return <LoadingBlock />

  return (
    <div>
      <PageHeader
        eyebrow="Plataforma"
        title="Suscripciones"
        description="Lo que los dueños le pagan a EasyGym. Los cobros que ellos hacen a sus socios viven dentro de cada gimnasio."
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: 'MRR', value: money0(stats.mrr), tone: 'text-plasma-300', icon: TrendingUp },
          { label: 'ARR estimado', value: money0(stats.arr), tone: 'text-ink-50', icon: TrendingUp },
          { label: 'Facturado histórico', value: money0(stats.invoiced), tone: 'text-tap-400', icon: CreditCard },
          {
            label: 'Cobros fallidos',
            value: String(stats.failed),
            tone: stats.failed > 0 ? 'text-danger-400' : 'text-ink-50',
            icon: CreditCard,
          },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11.5px] text-ink-400">{s.label}</p>
              <s.icon className="h-3.5 w-3.5 text-ink-600" />
            </div>
            <p className={cx('mt-1.5 text-[22px] font-bold tnum', s.tone)}>{s.value}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={subscriptions}
          rowKey={(s) => s.id}
          pageSize={30}
          empty={<EmptyState icon={<CreditCard className="h-6 w-6" />} title="Sin suscripciones registradas" />}
        />
      </Card>

      <Card className="mt-3">
        <CardHeader title="Cómo funciona el cobro" subtitle="Arquitectura de facturación de EasyGym" />
        <CardBody>
          <ol className="space-y-2.5 text-[13px] leading-relaxed text-ink-400">
            <li>
              <b className="text-ink-200">1.</b> El dueño elige plan en <code className="font-mono text-gym">/registro</code>{' '}
              y paga en <code className="font-mono text-gym">/checkout</code>.
            </li>
            <li>
              <b className="text-ink-200">2.</b> Stripe crea el <i>customer</i> y la <i>subscription</i>, y llama al
              webhook.
            </li>
            <li>
              <b className="text-ink-200">3.</b> Una Cloud Function verifica la firma con{' '}
              <code className="font-mono">STRIPE_WEBHOOK_SECRET</code> y provisiona el tenant con el Admin SDK.
            </li>
            <li>
              <b className="text-ink-200">4.</b> Cada mes Stripe cobra solo. Si falla, el gimnasio pasa a{' '}
              <span className="text-warn-400">PAST_DUE</span> — sigue operando durante el periodo de gracia.
            </li>
            <li>
              <b className="text-ink-200">5.</b> Si se cancela, pasa a <span className="text-danger-400">CANCELED</span>:
              se restringe el acceso, <b className="text-ink-200">nunca se borran los datos</b>.
            </li>
          </ol>
        </CardBody>
      </Card>
    </div>
  )
}
