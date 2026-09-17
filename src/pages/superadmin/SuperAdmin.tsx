import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Building2, CreditCard, TrendingUp, Users } from 'lucide-react'
import { usePlans } from '@/state/PlansContext'
import { fmtDateTime } from '@/lib/date'
import { money0, num } from '@/lib/format'
import { cx } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge, EmptyState, LoadingBlock, Progress } from '@/components/ui/Feedback'
import { StatTile } from '@/components/charts/StatTile'
import { DonutChart } from '@/components/charts/DonutChart'
import { RankBars } from '@/components/charts/BarChart'
import { usePlatformData, useMemberCounts } from './usePlatformData'

// Resumen del negocio EASYGYM: cuántos gimnasios hay, cuánto facturan y
// quién está en riesgo de irse.

const PLAN_COLOR: Record<string, string> = {
  STARTER: '#17A45B',
  PRO: '#2E93C8',
  BUSINESS: '#8A57D6',
  ENTERPRISE: '#C08211',
}

export default function SuperAdmin() {
  const { gyms, users, subscriptions, activity, loading } = usePlatformData()
  const memberCounts = useMemberCounts()
  const { publicPlans, getPlan } = usePlans()

  const stats = useMemo(() => {
    const active = gyms.filter((g) => g.subscriptionStatus === 'ACTIVE').length
    const pastDue = gyms.filter((g) => g.subscriptionStatus === 'PAST_DUE').length
    const suspended = gyms.filter(
      (g) => g.subscriptionStatus === 'SUSPENDED' || g.subscriptionStatus === 'CANCELED',
    ).length
    const mrr = subscriptions
      .filter((s) => s.status === 'ACTIVE')
      .reduce((a, s) => a + s.amount, 0)
    const totalMembers = Object.values(memberCounts).reduce((a, n) => a + n, 0)
    return { active, pastDue, suspended, mrr, totalMembers, total: gyms.length }
  }, [gyms, subscriptions, memberCounts])

  const byPlan = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const g of gyms) counts[g.planId] = (counts[g.planId] ?? 0) + 1
    return publicPlans.map((p) => ({
      key: p.id,
      label: p.name,
      value: counts[p.id] ?? 0,
      color: PLAN_COLOR[p.id] ?? '#6C7E97',
    }))
  }, [gyms, publicPlans])

  const topGyms = useMemo(
    () =>
      [...gyms]
        .map((g) => ({ key: g.id, label: g.name, value: memberCounts[g.id] ?? 0 }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
    [gyms, memberCounts],
  )

  if (loading) return <LoadingBlock label="Cargando la plataforma…" />

  return (
    <div>
      <PageHeader
        eyebrow="Consola de plataforma"
        title="EasyGym"
        description="Todos los gimnasios, sus suscripciones y su actividad."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Ingreso recurrente mensual"
          value={stats.mrr}
          format="money"
          hint="Suscripciones activas"
          icon={<TrendingUp className="h-4 w-4" />}
          tone="plasma"
        />
        <StatTile
          label="Gimnasios"
          value={stats.total}
          hint={`${stats.active} activos`}
          icon={<Building2 className="h-4 w-4" />}
          tone="cyber"
        />
        <StatTile
          label="Socios en la plataforma"
          value={stats.totalMembers}
          icon={<Users className="h-4 w-4" />}
          tone="tap"
        />
        <StatTile
          label="Con pago pendiente"
          value={stats.pastDue + stats.suspended}
          hint="Requieren atención"
          icon={<CreditCard className="h-4 w-4" />}
          tone={stats.pastDue + stats.suspended > 0 ? 'warn' : 'tap'}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_1.1fr]">
        <Card>
          <CardHeader title="Distribución por plan" subtitle="Cuántos gimnasios hay en cada uno" />
          <CardBody>
            <DonutChart data={byPlan} format={(v) => `${v}`} centerLabel="Gimnasios" size={168} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Gimnasios más grandes" subtitle="Por número de socios" />
          <CardBody>
            {topGyms.length === 0 ? (
              <EmptyState title="Sin gimnasios todavía" />
            ) : (
              <RankBars data={topGyms} format={(v) => `${num(v)} socios`} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Actividad reciente"
            subtitle="Altas, cambios de plan y suspensiones"
            icon={<Activity className="h-4 w-4" />}
          />
          <CardBody>
            {activity.length === 0 ? (
              <EmptyState title="Sin actividad registrada" />
            ) : (
              <ul className="divide-y divide-white/[.05]">
                {[...activity]
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .slice(0, 8)
                  .map((a) => (
                    <li key={a.id} className="py-2.5">
                      <p className="text-[13px] text-ink-200">{a.detail}</p>
                      <p className="mt-0.5 text-[11px] text-ink-500 tnum">
                        {fmtDateTime(a.createdAt)} · {a.actorName}
                      </p>
                    </li>
                  ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Lista rápida */}
      <Card className="mt-3">
        <CardHeader
          title="Gimnasios"
          subtitle={`${gyms.length} registrados`}
          action={
            <Link to="/superadmin/gimnasios" className="text-[12.5px] font-semibold text-plasma-300 hover:underline">
              Administrar →
            </Link>
          }
        />
        <CardBody>
          <ul className="divide-y divide-white/[.05]">
            {gyms.map((g) => {
              const plan = getPlan(g.planId)
              const count = memberCounts[g.id] ?? 0
              const owner = users.find((u) => u.uid === g.ownerId)
              return (
                <li key={g.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[12px] font-bold"
                    style={{
                      background: `rgb(${g.branding.accent} / .14)`,
                      color: `rgb(${g.branding.accent})`,
                    }}
                  >
                    {g.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-ink-50">{g.name}</p>
                    <p className="truncate text-[11.5px] text-ink-500">
                      {owner?.name ?? '—'} · {g.city}, {g.state} · /{g.slug}
                    </p>
                  </div>
                  <div className="w-28 shrink-0">
                    <p className="text-[11px] text-ink-500 tnum">
                      {num(count)} / {plan.maxMembers ? num(plan.maxMembers) : '∞'}
                    </p>
                    <Progress
                      className="mt-1"
                      value={count}
                      max={plan.maxMembers ?? Math.max(count, 1)}
                      tone={plan.maxMembers && count / plan.maxMembers > 0.9 ? 'warn' : 'gym'}
                    />
                  </div>
                  <Badge tone={plan.accent === 'ink' ? 'neutral' : (plan.accent as never)}>{plan.name}</Badge>
                  <span className="w-20 shrink-0 text-right text-[13px] font-semibold text-ink-100 tnum">
                    {money0(plan.price ?? 0)}
                  </span>
                  <span
                    className={cx(
                      'w-24 shrink-0 text-right text-[12px] font-medium',
                      g.subscriptionStatus === 'ACTIVE'
                        ? 'text-tap-400'
                        : g.subscriptionStatus === 'PAST_DUE'
                          ? 'text-warn-400'
                          : 'text-danger-400',
                    )}
                  >
                    {g.subscriptionStatus}
                  </span>
                </li>
              )
            })}
          </ul>
        </CardBody>
      </Card>
    </div>
  )
}
