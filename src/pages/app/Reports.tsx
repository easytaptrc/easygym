import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Download, Info, Printer } from 'lucide-react'
import type { Attendance, PaymentMethod, Reservation } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCounters, useDailyStats } from '@/hooks/useAggregates'
import { CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ORDER, PAYMENT_METHOD_LABEL } from '@/services/billing'
import { dayKey, fmtDate, fromDayKey, MONTHS_SHORT, presetRange, type DateRange } from '@/lib/date'
import { money, money0, moneyShort, num, pct } from '@/lib/format'
import { cx, downloadCsv } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Inputs'
import { AreaChart } from '@/components/charts/AreaChart'
import { RankBars } from '@/components/charts/BarChart'
import { DonutChart } from '@/components/charts/DonutChart'
import { IfFeature } from '@/components/PlanGuard'

// ═══════════════════════════════════════════════════════════════════════════
// Reportes.
//
// Sirven para tomar tres decisiones: qué ofrecer, a quién llamar y qué clase
// mover de horario. Todo lo demás es adorno.
//
// ESCALA: ventas y socios salen de agregados (`dailyStats` + `counters`), así
// que un reporte anual cuesta 365 lecturas y no doscientos mil pagos. Los dos
// bloques que necesitan detalle por socio —el ranking de constancia y la
// ocupación por clase— van con consulta acotada y tope duro; en producción los
// precalcula un job nocturno.
// ═══════════════════════════════════════════════════════════════════════════

type Report = 'ventas' | 'socios' | 'clases'

const DETAIL_LIMIT = 1500

export default function Reports() {
  const { gym, repo } = useSession()
  const [range, setRange] = useState<DateRange>(() => presetRange('month'))
  const [tab, setTab] = useState<Report>('ventas')

  const rollup = useDailyStats(range)
  const { counters } = useCounters()
  const breakdown = counters.members

  const series = useMemo(
    () => rollup.days.map((d) => ({ key: d.date, label: shortDay(d.date), value: d.revenueTotal })),
    [rollup.days],
  )
  const newMembersSeries = useMemo(
    () => rollup.days.map((d) => ({ key: d.date, label: shortDay(d.date), value: d.newMembers })),
    [rollup.days],
  )
  const byMethod = useMemo(() => {
    const out: Partial<Record<PaymentMethod, number>> = {}
    for (const d of rollup.days) {
      for (const [m, v] of Object.entries(d.byMethod ?? {})) {
        out[m as PaymentMethod] = (out[m as PaymentMethod] ?? 0) + v
      }
    }
    return out
  }, [rollup.days])

  // Proporción de contratos que son renovaciones: mide si el gimnasio retiene
  // o solo capta. No es la retención contable, y por eso se etiqueta así.
  const renewalShare =
    rollup.renewals + rollup.newMemberships > 0
      ? (rollup.renewals / (rollup.renewals + rollup.newMemberships)) * 100
      : 0

  // ── Detalle acotado: ranking de constancia ──
  const [top, setTop] = useState<Array<{ id: string; name: string; count: number }>>([])
  useEffect(() => {
    if (!repo || tab !== 'socios') return
    let live = true
    void (async () => {
      const rows = (await repo.list('attendance', {
        where: [
          { field: 'date', op: '>=', value: dayKey(range.from) },
          { field: 'date', op: '<=', value: dayKey(range.to) },
        ],
        orderBy: { field: 'date', dir: 'desc' },
        limit: DETAIL_LIMIT,
      })) as Attendance[]
      if (!live) return
      const counts = new Map<string, { name: string; count: number }>()
      for (const a of rows) {
        if (!a.granted) continue
        const e = counts.get(a.memberId) ?? { name: a.memberName, count: 0 }
        e.count++
        counts.set(a.memberId, e)
      }
      setTop(
        [...counts.entries()]
          .map(([id, v]) => ({ id, ...v }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
      )
    })()
    return () => {
      live = false
    }
  }, [repo, tab, range.from, range.to])

  // ── Detalle acotado: ocupación por clase ──
  const [occupancy, setOccupancy] = useState<
    Array<{ classId: string; name: string; reserved: number; attended: number; cancelled: number }>
  >([])
  useEffect(() => {
    if (!repo || tab !== 'clases') return
    let live = true
    void (async () => {
      const rows = (await repo.list('reservations', {
        where: [
          { field: 'date', op: '>=', value: dayKey(range.from) },
          { field: 'date', op: '<=', value: dayKey(range.to) },
        ],
        orderBy: { field: 'date', dir: 'desc' },
        limit: DETAIL_LIMIT,
      })) as Reservation[]
      if (!live) return
      const byClass = new Map<
        string,
        { name: string; reserved: number; attended: number; cancelled: number }
      >()
      for (const r of rows) {
        const e = byClass.get(r.classId) ?? { name: r.className, reserved: 0, attended: 0, cancelled: 0 }
        if (r.status === 'CANCELLED') e.cancelled++
        else {
          e.reserved++
          if (r.status === 'ATTENDED') e.attended++
        }
        byClass.set(r.classId, e)
      }
      setOccupancy(
        [...byClass.entries()]
          .map(([classId, v]) => ({ classId, ...v }))
          .sort((a, b) => b.reserved - a.reserved),
      )
    })()
    return () => {
      live = false
    }
  }, [repo, tab, range.from, range.to])

  function exportReport() {
    if (tab === 'ventas') {
      downloadCsv(
        `reporte-ventas-${range.preset}.csv`,
        CATEGORY_ORDER.map((c) => ({
          Categoria: CATEGORY_LABEL[c],
          Importe: rollup.revenueByCategory[c],
          Porcentaje:
            rollup.revenueTotal > 0
              ? ((rollup.revenueByCategory[c] / rollup.revenueTotal) * 100).toFixed(1)
              : '0',
        })),
      )
    } else if (tab === 'socios') {
      downloadCsv(
        `reporte-socios-${range.preset}.csv`,
        top.map((t) => ({ Socio: t.name, Asistencias: t.count })),
      )
    } else {
      downloadCsv(
        `reporte-clases-${range.preset}.csv`,
        occupancy.map((o) => ({
          Clase: o.name,
          Reservadas: o.reserved,
          Asistieron: o.attended,
          Canceladas: o.cancelled,
          TasaAsistencia: o.reserved > 0 ? ((o.attended / o.reserved) * 100).toFixed(1) : '0',
        })),
      )
    }
  }

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        title="Reportes"
        description={`${gym?.name ?? ''} · ${range.label}`}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<Printer className="h-3.5 w-3.5" />}
              onClick={() => window.print()}
              className="no-print"
            >
              Imprimir
            </Button>
            <Button variant="ghost" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportReport}>
              Exportar CSV
            </Button>
          </>
        }
      />

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <DateRangeFilter value={range} onChange={setRange} />
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'ventas', label: 'Ventas' },
            { value: 'socios', label: 'Socios' },
            { value: 'clases', label: 'Clases' },
          ]}
        />
      </div>

      {/* ── Ventas ── */}
      {tab === 'ventas' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {[
              { label: 'Ingresos totales', value: money0(rollup.revenueTotal), tone: 'text-gym' },
              { label: 'Nuevas membresías', value: num(rollup.newMemberships), tone: 'text-cyber-400' },
              { label: 'Renovaciones', value: num(rollup.renewals), tone: 'text-cyber-400' },
              { label: 'Visitas', value: num(rollup.visits), tone: 'text-warn-400' },
            ].map((s) => (
              <Card key={s.label} className="p-4">
                <p className="text-[11.5px] text-ink-400">{s.label}</p>
                <p className={cx('mt-1.5 text-[24px] font-bold tnum', s.tone)}>{s.value}</p>
              </Card>
            ))}
          </div>

          <Card lit>
            <CardHeader title="Ingresos por día" subtitle={range.label} icon={<BarChart3 className="h-4 w-4" />} />
            <CardBody>
              <AreaChart data={series} format={moneyShort} height={240} seriesLabel="Ingresos" />
            </CardBody>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader title="Por categoría" subtitle="De dónde viene el dinero" />
              <CardBody>
                <DonutChart
                  data={CATEGORY_ORDER.map((c) => ({
                    key: c,
                    label: CATEGORY_LABEL[c],
                    value: rollup.revenueByCategory[c],
                    color: CATEGORY_COLOR[c],
                  }))}
                  format={money0}
                  centerLabel="Total del periodo"
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Por método de pago" subtitle="Cómo te pagan tus socios" />
              <CardBody>
                <RankBars
                  data={Object.entries(byMethod).map(([m, v]) => ({
                    key: m,
                    label: PAYMENT_METHOD_LABEL[m as PaymentMethod] ?? m,
                    value: v,
                  }))}
                  format={money0}
                />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Resumen de ventas" subtitle={range.label} />
            <CardBody>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[.07]">
                    <th className="py-2 text-left text-[11px] uppercase tracking-wider text-ink-500">Categoría</th>
                    <th className="py-2 text-right text-[11px] uppercase tracking-wider text-ink-500">Importe</th>
                    <th className="py-2 text-right text-[11px] uppercase tracking-wider text-ink-500">%</th>
                  </tr>
                </thead>
                <tbody>
                  {CATEGORY_ORDER.map((c) => (
                    <tr key={c} className="border-b border-white/[.04]">
                      <td className="py-2.5">
                        <span className="flex items-center gap-2 text-ink-200">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLOR[c] }} />
                          {CATEGORY_LABEL[c]}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-ink-100 tnum">
                        {money(rollup.revenueByCategory[c])}
                      </td>
                      <td className="py-2.5 text-right text-ink-400 tnum">
                        {rollup.revenueTotal > 0
                          ? pct((rollup.revenueByCategory[c] / rollup.revenueTotal) * 100, 1)
                          : '0%'}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-3 font-semibold text-ink-100">Total</td>
                    <td className="py-3 text-right text-[16px] font-bold text-gym tnum">
                      {money(rollup.revenueTotal)}
                    </td>
                    <td className="py-3 text-right text-ink-400">100%</td>
                  </tr>
                </tbody>
              </table>
            </CardBody>
          </Card>
        </div>
      )}

      {/* ── Socios ── */}
      {tab === 'socios' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
            {[
              { label: 'Total', value: num(breakdown.total), tone: 'text-ink-50' },
              { label: 'Activos', value: num(breakdown.active), tone: 'text-tap-400' },
              { label: 'Por vencer', value: num(breakdown.nearExpiration), tone: 'text-warn-400' },
              { label: 'Vencidos', value: num(breakdown.expired), tone: 'text-danger-400' },
              { label: '% renovaciones', value: pct(renewalShare), tone: 'text-cyber-400' },
            ].map((s) => (
              <Card key={s.label} className="p-4">
                <p className="text-[11.5px] text-ink-400">{s.label}</p>
                <p className={cx('mt-1.5 text-[24px] font-bold tnum', s.tone)}>{s.value}</p>
              </Card>
            ))}
          </div>

          <Card lit>
            <CardHeader
              title="Altas de socios"
              subtitle="Nuevos registros en el periodo"
              icon={<BarChart3 className="h-4 w-4" />}
            />
            <CardBody>
              <AreaChart data={newMembersSeries} format={num} height={220} seriesLabel="Altas" />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Socios más constantes"
              subtitle="Quién viene más seguido"
              action={
                <span className="flex items-center gap-1.5 text-[11.5px] text-ink-500">
                  <Info className="h-3 w-3" />
                  últimas {num(DETAIL_LIMIT)} entradas
                </span>
              }
            />
            <CardBody>
              {top.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-ink-500">Sin asistencias en el periodo.</p>
              ) : (
                <RankBars
                  data={top.map((t) => ({ key: t.id, label: t.name, value: t.count }))}
                  format={(v) => `${v} visitas`}
                  maxRows={10}
                />
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* ── Clases ── */}
      {tab === 'clases' && (
        <IfFeature feature="reservations">
          <Card>
            <CardHeader
              title="Ocupación por clase"
              subtitle="Qué clases llenas y cuáles conviene mover de horario"
              icon={<BarChart3 className="h-4 w-4" />}
            />
            <CardBody>
              {occupancy.length === 0 ? (
                <p className="py-10 text-center text-[13px] text-ink-500">Sin reservaciones en el periodo.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[.07]">
                      <th className="py-2 text-left text-[11px] uppercase tracking-wider text-ink-500">Clase</th>
                      <th className="py-2 text-right text-[11px] uppercase tracking-wider text-ink-500">Reservas</th>
                      <th className="py-2 text-right text-[11px] uppercase tracking-wider text-ink-500">
                        Asistieron
                      </th>
                      <th className="py-2 text-right text-[11px] uppercase tracking-wider text-ink-500">
                        Canceladas
                      </th>
                      <th className="py-2 text-right text-[11px] uppercase tracking-wider text-ink-500">Tasa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {occupancy.map((o) => {
                      const rate = o.reserved > 0 ? (o.attended / o.reserved) * 100 : 0
                      return (
                        <tr key={o.classId} className="border-b border-white/[.04]">
                          <td className="py-2.5 font-medium text-ink-100">{o.name}</td>
                          <td className="py-2.5 text-right text-ink-200 tnum">{o.reserved}</td>
                          <td className="py-2.5 text-right text-tap-400 tnum">{o.attended}</td>
                          <td className="py-2.5 text-right text-danger-400 tnum">{o.cancelled}</td>
                          <td
                            className={cx(
                              'py-2.5 text-right font-semibold tnum',
                              rate >= 80 ? 'text-tap-400' : rate >= 50 ? 'text-warn-400' : 'text-danger-400',
                            )}
                          >
                            {pct(rate)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
        </IfFeature>
      )}

      <p className="print-only mt-6 text-[12px]">
        {gym?.name} · {range.label} · Generado el {fmtDate(Date.now())} con EasyGym
      </p>
    </div>
  )
}

function shortDay(key: string): string {
  const d = fromDayKey(key)
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}
