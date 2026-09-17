import { useMemo, useState } from 'react'
import { Download, FileSpreadsheet } from 'lucide-react'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { fullName } from '@/services/employees'
import {
  absenceRecord,
  formatDuration,
  missingDays,
  summarize,
} from '@/lib/workSchedule'
import { addDays, dayKey, fmtDayKey, startOfWeek } from '@/lib/date'
import { cx, downloadCsv } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Badge, EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { Segmented, Select } from '@/components/ui/Inputs'

// ═══════════════════════════════════════════════════════════════════════════
// Reporte de personal para el dueño.
//
// Una tabla, una fila por persona, todo lo que hace falta para una
// conversación de cinco minutos: quién vino, quién llegó tarde y cuánto se
// trabajó.
//
// PREPARA la nómina, no la calcula. Los minutos trabajados y los retardos son
// el insumo; sueldos, ISR, IMSS y prestaciones son otra fase y otro problema —
// uno que se hace mal si se improvisa.
// ═══════════════════════════════════════════════════════════════════════════

type Period = 'week' | 'lastWeek' | 'month' | 'custom'

interface Row {
  id: string
  employee: string
  position: string
  daysWorked: number
  onTime: number
  late: number
  lateMinutes: number
  absent: number
  justified: number
  earlyExits: number
  workedMinutes: number
  punctualityPct: number
}

function periodRange(p: Period, from: string, to: string): { from: string; to: string } {
  const now = Date.now()
  if (p === 'week') {
    const s = startOfWeek(now)
    return { from: dayKey(s), to: dayKey(addDays(s, 6)) }
  }
  if (p === 'lastWeek') {
    const s = addDays(startOfWeek(now), -7)
    return { from: dayKey(s), to: dayKey(addDays(s, 6)) }
  }
  if (p === 'month') {
    const d = new Date(now)
    return {
      from: dayKey(new Date(d.getFullYear(), d.getMonth(), 1).getTime()),
      to: dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime()),
    }
  }
  return { from, to }
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  let cur = new Date(fy, fm - 1, fd).getTime()
  const end = new Date(ty, tm - 1, td).getTime()
  while (cur <= end && out.length < 200) {
    out.push(dayKey(cur))
    cur = addDays(cur, 1)
  }
  return out
}

export default function StaffReport() {
  const { gym } = useSession()
  const [period, setPeriod] = useState<Period>('week')
  const [customFrom, setCustomFrom] = useState(() => dayKey(startOfWeek(Date.now())))
  const [customTo, setCustomTo] = useState(() => dayKey())
  const [positionFilter, setPositionFilter] = useState('ALL')

  const range = useMemo(
    () => periodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  )

  const employees = useCollection(
    'employees',
    useMemo(
      () => ({
        where: [{ field: 'status', op: '==' as const, value: 'ACTIVE' }],
        orderBy: { field: 'employeeNumber' as const, dir: 'asc' as const },
        limit: 200,
      }),
      [],
    ),
  )

  const records = useCollection(
    'employeeAttendance',
    useMemo(
      () => ({
        where: [
          { field: 'date', op: '>=' as const, value: range.from },
          { field: 'date', op: '<=' as const, value: range.to },
        ],
        orderBy: { field: 'date' as const, dir: 'desc' as const },
        limit: 600,
      }),
      [range.from, range.to],
    ),
  )

  const today = dayKey()
  const rangeDays = useMemo(() => daysBetween(range.from, range.to), [range.from, range.to])
  const positions = useMemo(
    () => [...new Set(employees.data.map((e) => e.position))].sort(),
    [employees.data],
  )

  const rows = useMemo<Row[]>(() => {
    return employees.data
      .filter((e) => (positionFilter === 'ALL' ? true : e.position === positionFilter))
      .map((employee) => {
        const own = records.data.filter((r) => r.employeeId === employee.id)
        const absences = missingDays(employee.schedule, rangeDays, own, today).map((d) =>
          absenceRecord(employee.gymId, employee, d, employee.schedule),
        )
        const s = summarize([...own, ...absences])
        return {
          id: employee.id,
          employee: fullName(employee),
          position: employee.position,
          daysWorked: s.daysWorked,
          onTime: s.onTime,
          late: s.late,
          lateMinutes: s.lateMinutes,
          absent: s.absent,
          justified: s.justified,
          earlyExits: s.earlyExits,
          workedMinutes: s.workedMinutes,
          punctualityPct: s.punctualityPct,
        }
      })
  }, [employees.data, records.data, rangeDays, today, positionFilter])

  const columns: Column<Row>[] = [
    {
      key: 'employee',
      header: 'Empleado',
      sortValue: (r) => r.employee,
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium text-ink-100">{r.employee}</p>
          <p className="truncate text-[11.5px] text-ink-500">{r.position}</p>
        </div>
      ),
    },
    {
      key: 'days',
      header: 'Días',
      align: 'right',
      sortValue: (r) => r.daysWorked,
      cell: (r) => <span className="text-[13px] text-ink-200 tnum">{r.daysWorked}</span>,
    },
    {
      key: 'onTime',
      header: 'Puntual',
      align: 'right',
      sortValue: (r) => r.onTime,
      cell: (r) => <span className="text-[13px] font-semibold text-gym tnum">{r.onTime}</span>,
    },
    {
      key: 'late',
      header: 'Retardos',
      align: 'right',
      sortValue: (r) => r.late,
      cell: (r) => (
        <span className={cx('text-[13px] font-semibold tnum', r.late > 0 ? 'text-warn-400' : 'text-ink-500')}>
          {r.late}
        </span>
      ),
    },
    {
      key: 'lateMin',
      header: 'Min. retardo',
      align: 'right',
      hideOnMobile: true,
      sortValue: (r) => r.lateMinutes,
      cell: (r) => <span className="text-[13px] text-ink-300 tnum">{r.lateMinutes}</span>,
    },
    {
      key: 'absent',
      header: 'Faltas',
      align: 'right',
      sortValue: (r) => r.absent,
      cell: (r) => (
        <span className={cx('text-[13px] font-semibold tnum', r.absent > 0 ? 'text-danger-400' : 'text-ink-500')}>
          {r.absent}
        </span>
      ),
    },
    {
      key: 'early',
      header: 'Salidas antes',
      align: 'right',
      hideOnMobile: true,
      sortValue: (r) => r.earlyExits,
      cell: (r) => <span className="text-[13px] text-ink-300 tnum">{r.earlyExits}</span>,
    },
    {
      key: 'hours',
      header: 'Horas',
      align: 'right',
      sortValue: (r) => r.workedMinutes,
      cell: (r) => (
        <span className="whitespace-nowrap text-[13px] font-semibold text-cyber-300 tnum">
          {formatDuration(r.workedMinutes)}
        </span>
      ),
    },
    {
      key: 'punctuality',
      header: 'Puntualidad',
      align: 'right',
      sortValue: (r) => r.punctualityPct,
      cell: (r) => (
        <Badge tone={r.punctualityPct >= 80 ? 'gym' : r.punctualityPct >= 60 ? 'warn' : 'danger'}>
          {r.punctualityPct}%
        </Badge>
      ),
    },
  ]

  if (employees.loading) return <LoadingBlock label="Cargando el reporte…" />

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        eyebrow="Reportes"
        title="Personal"
        description={`${gym?.name ?? ''} · ${fmtDayKey(range.from)} — ${fmtDayKey(range.to)}`}
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={<Download className="h-3.5 w-3.5" />}
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                `reporte-personal-${range.from}_${range.to}.csv`,
                rows.map((r) => ({
                  Empleado: r.employee,
                  Puesto: r.position,
                  DiasTrabajados: r.daysWorked,
                  Puntualidades: r.onTime,
                  Retardos: r.late,
                  MinutosRetardo: r.lateMinutes,
                  Faltas: r.absent,
                  Justificadas: r.justified,
                  SalidasAnticipadas: r.earlyExits,
                  MinutosTrabajados: r.workedMinutes,
                  HorasTrabajadas: formatDuration(r.workedMinutes),
                  PuntualidadPct: r.punctualityPct,
                })),
              )
            }
          >
            Exportar CSV
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          value={period}
          onChange={setPeriod}
          size="sm"
          options={[
            { value: 'week', label: 'Esta semana' },
            { value: 'lastWeek', label: 'Semana anterior' },
            { value: 'month', label: 'Este mes' },
            { value: 'custom', label: 'Rango' },
          ]}
        />
        {period === 'custom' && (
          <div className="flex items-center gap-1.5 rounded-xl border border-white/[.07] bg-ink-900/70 px-2.5 py-1.5">
            <input
              type="date"
              value={customFrom}
              max={customTo}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="bg-transparent text-[12.5px] text-ink-200 outline-none [color-scheme:dark]"
            />
            <span className="text-ink-600">—</span>
            <input
              type="date"
              value={customTo}
              min={customFrom}
              onChange={(e) => setCustomTo(e.target.value)}
              className="bg-transparent text-[12.5px] text-ink-200 outline-none [color-scheme:dark]"
            />
          </div>
        )}
        {positions.length > 1 && (
          <Select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            containerClassName="w-full sm:w-48"
          >
            <option value="ALL">Todos los puestos</option>
            {positions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        )}
      </div>

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          pageSize={30}
          empty={
            <EmptyState
              icon={<FileSpreadsheet className="h-6 w-6" />}
              title="Sin personal activo en este periodo"
              detail="Da de alta a tu equipo en Empleados."
            />
          }
        />
      </Card>

      <p className="mt-4 text-[12.5px] leading-relaxed text-ink-500">
        Este reporte <span className="text-ink-300">prepara</span> la nómina, no la calcula. Los
        minutos trabajados y los retardos son el insumo; sueldos, ISR, IMSS y prestaciones son otra
        cosa y se harán mal si se improvisan.
      </p>
    </div>
  )
}
