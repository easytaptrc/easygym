import { useMemo } from 'react'
import { Fingerprint, Flame } from 'lucide-react'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { CHECKIN_METHOD_LABEL } from '@/services/access'
import { countSeries } from '@/services/analytics'
import { dayKey, fmtDateTime, presetRange, startOfWeek } from '@/lib/date'
import { num } from '@/lib/format'
import { cx } from '@/lib/utils'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge, EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { AreaChart } from '@/components/charts/AreaChart'

export default function PortalAttendance() {
  const { member } = useSession()
  const attendance = useCollection(
    'attendance',
    member ? { where: [{ field: 'memberId', op: '==', value: member.id }] } : undefined,
  )

  const rows = useMemo(
    () => [...attendance.data].sort((a, b) => b.createdAt - a.createdAt),
    [attendance.data],
  )

  const week = useMemo(() => {
    const from = startOfWeek()
    return rows.filter((a) => a.createdAt >= from && a.granted).length
  }, [rows])

  const series = useMemo(() => countSeries(rows, presetRange('month')), [rows])

  // Racha: días consecutivos (hacia atrás) con al menos una entrada.
  const streak = useMemo(() => {
    const days = new Set(rows.filter((r) => r.granted).map((r) => r.date))
    let count = 0
    for (let i = 0; i < 400; i++) {
      const key = dayKey(Date.now() - i * 86_400_000)
      if (days.has(key)) count++
      else if (i > 0) break
    }
    return count
  }, [rows])

  if (!member) return <LoadingBlock />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Esta semana', value: week, tone: 'text-gym' },
          { label: 'Racha', value: streak, tone: 'text-warn-400' },
          { label: 'Total', value: rows.filter((r) => r.granted).length, tone: 'text-ink-50' },
        ].map((s) => (
          <Card key={s.label} className="p-4 text-center">
            <p className="text-[11px] text-ink-500">{s.label}</p>
            <p className={cx('mt-1.5 text-[24px] font-bold tnum', s.tone)}>{num(s.value)}</p>
          </Card>
        ))}
      </div>

      <Card lit>
        <CardHeader title="Tu constancia" subtitle="Últimos 30 días" icon={<Flame className="h-4 w-4" />} />
        <CardBody>
          <AreaChart data={series} format={num} height={160} seriesLabel="Visitas" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Historial de entradas" icon={<Fingerprint className="h-4 w-4" />} />
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState
              icon={<Fingerprint className="h-6 w-6" />}
              title="Todavía no registras entradas"
              detail="Cuando marques tu entrada en recepción aparecerá aquí."
            />
          ) : (
            <ul className="divide-y divide-white/[.05]">
              {rows.slice(0, 60).map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2.5">
                  <span className={cx('h-2 w-2 shrink-0 rounded-full', a.granted ? 'bg-gym' : 'bg-danger-400')} />
                  <span className="min-w-0 flex-1 text-[13px] text-ink-200 tnum">{fmtDateTime(a.createdAt)}</span>
                  <Badge tone="neutral">{CHECKIN_METHOD_LABEL[a.method]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
