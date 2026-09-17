import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarCheck,
  Clock,
  Fingerprint,
  Printer,
  RefreshCw,
  ScanLine,
  Ticket,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react'
import type { Attendance, Member } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCounters, useDailyStats } from '@/hooks/useAggregates'
import { dayKey, presetRange, daysUntil, fmtDate, fromDayKey, MONTHS_SHORT, type DateRange } from '@/lib/date'
import { money, money0, moneyShort, num } from '@/lib/format'
import { cx } from '@/lib/utils'
import { deltaPct, previousRange } from '@/services/analytics'
import { CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ORDER } from '@/services/billing'
import { getPlan, memberLimitReached } from '@/config/plans'
import { PageHeader } from '@/components/layout/PageHeader'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { StaffPanel } from '@/components/StaffPanel'
import { RecentActivity } from '@/components/RecentActivity'
import { StatTile } from '@/components/charts/StatTile'
import { AreaChart } from '@/components/charts/AreaChart'
import { BarChart, RankBars } from '@/components/charts/BarChart'
import { DonutChart } from '@/components/charts/DonutChart'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Avatar, Badge, Progress, StatusChip } from '@/components/ui/Feedback'
import { Button, LinkButton } from '@/components/ui/Button'
import { IfFeature } from '@/components/PlanGuard'
import { OnboardingChecklist } from './OnboardingChecklist'

// ═══════════════════════════════════════════════════════════════════════════
// Panel del gimnasio.
//
// Responde en orden a lo que un dueño se pregunta al abrir el sistema:
// ¿cuánto entró?, ¿cuántos socios tengo y en qué estado?, ¿a quién llamo hoy?,
// ¿a qué hora se me llena?
//
// TODO lo que se pinta aquí sale de AGREGADOS, no de recorrer colecciones:
//
//   · contadores de socios  → 1 documento  (`counters/{gymId}`)
//   · ingresos y actividad  → ≤31 documentos del rango (`dailyStats`)
//   · lista de por vencer   → consulta acotada, limit 8
//
// Con 100 000 socios el panel sigue costando lo mismo que con 100.
// ═══════════════════════════════════════════════════════════════════════════

export default function Dashboard() {
  const { gym, settings, user, repo } = useSession()
  const navigate = useNavigate()
  const [range, setRange] = useState<DateRange>(() => presetRange('month'))

  const { counters } = useCounters()
  const rollup = useDailyStats(range)
  const previous = useDailyStats(useMemo(() => previousRange(range), [range]))
  const todayRollup = useDailyStats(useMemo(() => presetRange('today'), []))
  const monthRollup = useDailyStats(useMemo(() => presetRange('month'), []))

  const nearDays = settings?.nearExpirationDays ?? 7
  const plan = getPlan(gym?.planId)
  const breakdown = counters.members

  // ── Series para las gráficas, a partir de los resúmenes diarios ──
  const revenueSeries = useMemo(
    () =>
      rollup.days.map((d) => ({
        key: d.date,
        label: shortDay(d.date),
        value: d.revenueTotal,
      })),
    [rollup.days],
  )

  const attendanceSeries = useMemo(
    () => rollup.days.map((d) => ({ key: d.date, label: shortDay(d.date), value: d.attendance })),
    [rollup.days],
  )

  const hourly = useMemo(() => {
    const out: Array<{ key: string; label: string; value: number }> = []
    for (let h = 5; h <= 23; h++) {
      out.push({ key: String(h), label: `${h}h`, value: rollup.byHour[String(h)] ?? 0 })
    }
    return out
  }, [rollup.byHour])

  const donutSlices = useMemo(
    () =>
      CATEGORY_ORDER.map((c) => ({
        key: c,
        label: CATEGORY_LABEL[c],
        value: rollup.revenueByCategory[c],
        color: CATEGORY_COLOR[c],
      })),
    [rollup.revenueByCategory],
  )

  const trend = (key: 'revenue' | 'attendance') => {
    const today = dayKey()
    const source = key === 'revenue' ? revenueSeries : attendanceSeries
    return source
      .filter((p) => p.key <= today)
      .map((p) => p.value)
      .slice(-14)
  }

  // ── Socios por vencer: consulta acotada, no un escaneo ──
  const [expiring, setExpiring] = useState<Member[]>([])
  useEffect(() => {
    if (!repo) return
    return repo.watch(
      'members',
      {
        where: [{ field: 'status', op: '==', value: 'NEAR_EXPIRATION' }],
        orderBy: { field: 'expiresAt', dir: 'asc' },
        limit: 8,
      },
      setExpiring,
    )
  }, [repo])

  // ── Top de constancia ──
  // Un ranking por socio no se puede sacar de un resumen diario: necesita el
  // detalle. Se acota a las asistencias del rango con un tope duro; en
  // producción esto lo precalcula un job nocturno en `memberStats`.
  const [topAttendees, setTopAttendees] = useState<Array<{ id: string; name: string; count: number }>>([])
  useEffect(() => {
    if (!repo) return
    let live = true
    void (async () => {
      const rows = await repo.list('attendance', {
        where: [
          { field: 'date', op: '>=', value: dayKey(range.from) },
          { field: 'date', op: '<=', value: dayKey(range.to) },
        ],
        orderBy: { field: 'date', dir: 'desc' },
        limit: 1500,
      })
      if (!live) return
      const counts = new Map<string, { name: string; count: number }>()
      for (const a of rows as Attendance[]) {
        if (!a.granted) continue
        const e = counts.get(a.memberId) ?? { name: a.memberName, count: 0 }
        e.count++
        counts.set(a.memberId, e)
      }
      setTopAttendees(
        [...counts.entries()]
          .map(([id, v]) => ({ id, ...v }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 6),
      )
    })()
    return () => {
      live = false
    }
  }, [repo, range.from, range.to])

  const [refreshing, setRefreshing] = useState(false)
  const limitHit = gym ? memberLimitReached(gym, breakdown.total) : false

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        eyebrow={new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
        title={`Hola, ${user?.name.split(' ')[0] ?? ''}`}
        description={`Así va ${gym?.name ?? 'tu gimnasio'} ${range.preset === 'today' ? 'hoy' : `en ${range.label.toLowerCase()}`}.`}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<Printer className="h-3.5 w-3.5" />}
              onClick={() => window.print()}
              className="no-print hidden sm:inline-flex"
            >
              Imprimir
            </Button>
            <LinkButton to="/recepcion" variant="ghost" size="sm" icon={<ScanLine className="h-3.5 w-3.5" />}>
              Recepción
            </LinkButton>
            <LinkButton to="/socios" variant="primary" size="sm" icon={<UserPlus className="h-3.5 w-3.5" />}>
              Nuevo socio
            </LinkButton>
          </>
        }
      />

      <OnboardingChecklist />

      {limitHit && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-warn-500/25 bg-warn-500/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warn-400" />
          <p className="min-w-0 flex-1 text-[13px] text-warn-100">
            Llegaste al tope de <b>{plan.maxMembers}</b> socios de tu plan {plan.name}. Para dar de alta a
            más, cambia de plan.
          </p>
          <Link to="/planes" className="text-[12.5px] font-semibold text-warn-300 hover:underline">
            Ver planes →
          </Link>
        </div>
      )}

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <DateRangeFilter value={range} onChange={setRange} />
        <div className="flex items-center gap-3 text-[12.5px] text-ink-500">
          <span>
            Hoy: <b className="text-tap-400 tnum">{money0(todayRollup.revenueTotal)}</b>
          </span>
          <span className="hidden sm:inline">
            Mes: <b className="text-ink-200 tnum">{money0(monthRollup.revenueTotal)}</b>
          </span>
          <button
            onClick={() => {
              setRefreshing(true)
              setTimeout(() => setRefreshing(false), 600)
            }}
            className="rounded-lg p-1.5 text-ink-500 transition hover:bg-white/5 hover:text-ink-200"
            aria-label="Actualizar"
          >
            <RefreshCw className={cx('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Ingresos"
          value={rollup.revenueTotal}
          format="money"
          delta={deltaPct(rollup.revenueTotal, previous.revenueTotal)}
          hint="vs. periodo anterior"
          icon={<Banknote className="h-4 w-4" />}
          trend={trend('revenue')}
          tone="gym"
        />
        <StatTile
          label="Socios activos"
          value={breakdown.active}
          hint={`de ${num(breakdown.total)} registrados`}
          icon={<Users className="h-4 w-4" />}
          tone="tap"
        />
        <StatTile
          label="Por vencer"
          value={breakdown.nearExpiration}
          hint={`En ${nearDays} días o menos`}
          icon={<Clock className="h-4 w-4" />}
          tone="warn"
          onClick={() => navigate('/socios?estado=NEAR_EXPIRATION')}
        />
        <StatTile
          label="Vencidos"
          value={breakdown.expired}
          hint="Oportunidad de recuperar"
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="danger"
          onClick={() => navigate('/socios?estado=EXPIRED')}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Nuevas membresías"
          value={rollup.newMemberships}
          delta={deltaPct(rollup.newMemberships, previous.newMemberships)}
          icon={<UserPlus className="h-4 w-4" />}
          tone="cyber"
        />
        <StatTile
          label="Renovaciones"
          value={rollup.renewals}
          delta={deltaPct(rollup.renewals, previous.renewals)}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="cyber"
        />
        <StatTile
          label="Visitas"
          value={rollup.visits}
          delta={deltaPct(rollup.visits, previous.visits)}
          hint="Pases de un día"
          icon={<Ticket className="h-4 w-4" />}
          tone="warn"
        />
        <StatTile
          label="Asistencias"
          value={rollup.attendance}
          delta={deltaPct(rollup.attendance, previous.attendance)}
          icon={<Fingerprint className="h-4 w-4" />}
          trend={trend('attendance')}
          tone="plasma"
        />
      </div>

      {/* ── Gráficas ── */}
      <div className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Card lit>
          <CardHeader
            title="Ingresos"
            subtitle={`${range.label} · ${money(rollup.revenueTotal)}`}
            icon={<Banknote className="h-4 w-4" />}
            action={
              <Badge tone="neutral">
                {(() => {
                  const d = deltaPct(rollup.revenueTotal, previous.revenueTotal)
                  if (d === undefined) return 'Sin comparativa'
                  return `${d >= 0 ? '+' : ''}${d.toFixed(0)}% vs. anterior`
                })()}
              </Badge>
            }
          />
          <CardBody>
            {rollup.loading ? (
              <div className="h-[220px] animate-pulse rounded-xl bg-ink-850/60" />
            ) : (
              <AreaChart data={revenueSeries} format={moneyShort} seriesLabel="Ingresos" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Ventas por categoría"
            subtitle="Membresías · Renovaciones · Visitas · Productos"
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <CardBody>
            <DonutChart data={donutSlices} format={money0} centerLabel="Total del periodo" size={168} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
        <Card>
          <CardHeader title="Tus socios" subtitle={`${num(breakdown.total)} en total`} icon={<Users className="h-4 w-4" />} />
          <CardBody className="space-y-3.5">
            {[
              { label: 'Activos', value: breakdown.active, tone: 'gym' as const, to: '/socios?estado=ACTIVE' },
              { label: 'Por vencer', value: breakdown.nearExpiration, tone: 'warn' as const, to: '/socios?estado=NEAR_EXPIRATION' },
              { label: 'Vencidos', value: breakdown.expired, tone: 'danger' as const, to: '/socios?estado=EXPIRED' },
              { label: 'Inactivos', value: breakdown.inactive, tone: 'gym' as const, to: '/socios?estado=INACTIVE' },
            ].map((r) => (
              <Link key={r.label} to={r.to} className="block">
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="text-[13px] text-ink-300">{r.label}</span>
                  <span className="text-[13px] font-semibold text-ink-100 tnum">
                    {num(r.value)}
                    <span className="ml-1.5 text-[11px] font-normal text-ink-500">
                      {breakdown.total > 0 ? `${((r.value / breakdown.total) * 100).toFixed(0)}%` : '0%'}
                    </span>
                  </span>
                </div>
                <Progress value={r.value} max={Math.max(1, breakdown.total)} tone={r.tone} />
              </Link>
            ))}

            {plan.maxMembers !== null && (
              <div className="mt-4 rounded-xl border border-white/[.06] bg-ink-950/40 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] text-ink-400">Capacidad de tu plan</span>
                  <span className="text-[12px] font-semibold text-ink-200 tnum">
                    {num(breakdown.total)} / {num(plan.maxMembers)}
                  </span>
                </div>
                <Progress
                  className="mt-2"
                  value={breakdown.total}
                  max={plan.maxMembers}
                  tone={breakdown.total / plan.maxMembers > 0.9 ? 'danger' : 'gym'}
                />
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Horas con más gente"
            subtitle="Asistencias registradas por hora"
            icon={<Clock className="h-4 w-4" />}
          />
          <CardBody>
            <BarChart data={hourly} format={num} height={188} highlightMax label="Asistencias por hora" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Socios más constantes"
            subtitle={range.label}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <CardBody>
            {topAttendees.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-ink-500">Sin asistencias en el periodo</p>
            ) : (
              <RankBars
                data={topAttendees.map((t) => ({ key: t.id, label: t.name, value: t.count }))}
                format={(v) => `${v} días`}
              />
            )}
          </CardBody>
        </Card>
      </div>

      {/* ── Acción del día ── */}
      <div className="mt-3 grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader
            title="Llama a estos socios hoy"
            subtitle="Su membresía está por vencer — un recordatorio a tiempo evita una baja"
            icon={<Clock className="h-4 w-4" />}
            action={
              <LinkButton to="/socios?estado=NEAR_EXPIRATION" variant="subtle" size="sm" iconRight={<ArrowRight className="h-3.5 w-3.5" />}>
                Ver todos
              </LinkButton>
            }
          />
          <CardBody>
            {expiring.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-ink-500">
                Ninguna membresía vence en los próximos {nearDays} días. 👌
              </p>
            ) : (
              <ul className="divide-y divide-white/[.05]">
                {expiring.map((m) => {
                  const left = daysUntil(m.expiresAt)
                  return (
                    <li key={m.id}>
                      <Link
                        to={`/socios/${m.id}`}
                        className="flex items-center gap-3 py-2.5 transition-colors hover:bg-white/[.02]"
                      >
                        <Avatar name={m.name} src={m.photoUrl} size={34} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-medium text-ink-100">{m.name}</p>
                          <p className="truncate text-[11.5px] text-ink-500">{m.phone}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[12.5px] font-semibold text-warn-300 tnum">
                            {left === 0 ? 'Vence hoy' : `${left} ${left === 1 ? 'día' : 'días'}`}
                          </p>
                          <p className="text-[11px] text-ink-500">{fmtDate(m.expiresAt)}</p>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHeader title="Atajos" subtitle="Lo que más se usa en el mostrador" />
            <CardBody className="grid grid-cols-2 gap-2">
              {[
                { to: '/recepcion', icon: ScanLine, label: 'Recepción', tone: 'text-gym' },
                { to: '/socios', icon: UserPlus, label: 'Nuevo socio', tone: 'text-cyber-400' },
                { to: '/visitas', icon: Ticket, label: 'Cobrar visita', tone: 'text-warn-400' },
                { to: '/pagos', icon: Banknote, label: 'Registrar pago', tone: 'text-tap-400' },
              ].map((a) => (
                <Link
                  key={a.to}
                  to={a.to}
                  className="group flex flex-col gap-2 rounded-xl border border-white/[.07] bg-white/[.02] p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[.16] hover:bg-white/[.05]"
                >
                  <a.icon className={cx('h-[18px] w-[18px]', a.tone)} />
                  <span className="text-[12.5px] font-medium text-ink-200">{a.label}</span>
                </Link>
              ))}
            </CardBody>
          </Card>

          <IfFeature feature="reservations">
            <Card>
              <CardHeader
                title="Reservaciones"
                subtitle={`${num(rollup.reservations)} en ${range.label.toLowerCase()}`}
                icon={<CalendarCheck className="h-4 w-4" />}
                action={
                  <LinkButton to="/reservaciones" variant="subtle" size="sm" iconRight={<ArrowRight className="h-3.5 w-3.5" />}>
                    Ver
                  </LinkButton>
                }
              />
              <CardBody>
                <div className="flex items-baseline gap-2">
                  <span className="text-[30px] font-bold text-ink-50 tnum">{num(rollup.reservations)}</span>
                  <span className="text-[12.5px] text-ink-500">lugares reservados</span>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-400">
                  Revisa qué horarios se llenan y cuáles conviene mover o cerrar.
                </p>
              </CardBody>
            </Card>
          </IfFeature>
        </div>
      </div>

      <Card className="mt-3">
        <CardHeader title="Desglose de ventas" subtitle={range.label} />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {CATEGORY_ORDER.map((c) => (
              <div key={c} className="rounded-xl border border-white/[.06] bg-ink-950/40 p-3.5">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLOR[c] }} />
                  <span className="text-[12px] text-ink-400">{CATEGORY_LABEL[c]}</span>
                </div>
                <p className="mt-2 text-[19px] font-bold text-ink-50 tnum">
                  {money0(rollup.revenueByCategory[c])}
                </p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Personal: solo se pinta si el plan incluye el módulo. */}
      <StaffPanel />

      {/* Lo que ha pasado hoy en el gimnasio, de la bitácora. */}
      <RecentActivity />

      <div className="print-only mt-6">
        <p className="text-[12px]">
          {gym?.name} · {range.label} · Generado el {fmtDate(Date.now())}
        </p>
      </div>

      <div className="no-print mt-5 flex flex-wrap items-center gap-2 text-[12px] text-ink-600">
        <span>Leyenda:</span>
        <StatusChip status="ACTIVE" />
        <StatusChip status="NEAR_EXPIRATION" />
        <StatusChip status="EXPIRED" />
        <StatusChip status="INACTIVE" />
      </div>
    </div>
  )
}

/** "2026-09-16" → "16 Sep" */
function shortDay(key: string): string {
  const d = fromDayKey(key)
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}
