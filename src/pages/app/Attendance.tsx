import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Fingerprint, Plus, ScanLine } from 'lucide-react'
import type { Attendance as AttendanceDoc, CheckInMethod } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { useToast } from '@/hooks/useToast'
import { CHECKIN_METHOD_LABEL, evaluateAccess, recordAttendance } from '@/services/access'
import { useDailyStats } from '@/hooks/useAggregates'
import { dayKey, fromDayKey, MONTHS_SHORT, presetRange, fmtDateTime, type DateRange } from '@/lib/date'
import { num } from '@/lib/format'
import { cx, downloadCsv, norm } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Avatar, Badge, EmptyState } from '@/components/ui/Feedback'
import { Button, LinkButton } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { SearchInput, Select } from '@/components/ui/Inputs'
import { AreaChart } from '@/components/charts/AreaChart'
import { BarChart } from '@/components/charts/BarChart'

/** Tope de documentos que esta pantalla trae de una vez. */
const DETAIL_LIMIT = 1500

function shortDay(key: string): string {
  const d = fromDayKey(key)
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}

export default function Attendance() {
  const { repo, settings } = useSession()
  const toast = useToast()
  const navigate = useNavigate()

  const [range, setRange] = useState<DateRange>(() => presetRange('week'))
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState<CheckInMethod | 'ALL'>('ALL')
  const [manualOpen, setManualOpen] = useState(false)

  // La lista se acota SIEMPRE al rango elegido y con tope duro: sin esto,
  // abrir esta pantalla en un gimnasio con años de historial traería cientos
  // de miles de documentos.
  const attendance = useCollection('attendance', {
    where: [
      { field: 'date', op: '>=', value: dayKey(range.from) },
      { field: 'date', op: '<=', value: dayKey(range.to) },
    ],
    orderBy: { field: 'date', dir: 'desc' },
    limit: DETAIL_LIMIT,
  })
  const members = useCollection('members', { limit: 300 })

  // Las gráficas salen de los resúmenes diarios, no de la lista: así siguen
  // siendo exactas aunque la lista esté truncada por el tope.
  const rollup = useDailyStats(range)

  const rows = useMemo(() => {
    const q = norm(query.trim())
    return attendance.data
      .filter((a) => (method === 'ALL' ? true : a.method === method))
      .filter((a) => (!q ? true : norm(a.memberName).includes(q)))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [attendance.data, query, method])

  const series = useMemo(
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
  const uniquePeople = useMemo(() => new Set(rows.map((r) => r.memberId)).size, [rows])

  const columns: Column<AttendanceDoc>[] = [
    {
      key: 'member',
      header: 'Socio',
      sortValue: (a) => a.memberName,
      cell: (a) => (
        <button
          onClick={(e) => {
            e.stopPropagation()
            navigate(`/socios/${a.memberId}`)
          }}
          className="flex items-center gap-2.5 text-left transition hover:text-gym"
        >
          <Avatar name={a.memberName} size={30} />
          <span className="truncate text-[13.5px] font-medium text-ink-100">{a.memberName}</span>
        </button>
      ),
    },
    {
      key: 'when',
      header: 'Entrada',
      sortValue: (a) => a.createdAt,
      cell: (a) => <span className="whitespace-nowrap text-[12.5px] text-ink-300 tnum">{fmtDateTime(a.createdAt)}</span>,
    },
    {
      key: 'method',
      header: 'Método',
      cell: (a) => <Badge tone="neutral">{CHECKIN_METHOD_LABEL[a.method]}</Badge>,
    },
    {
      key: 'granted',
      header: 'Resultado',
      align: 'right',
      cell: (a) => (
        <Badge tone={a.granted ? 'tap' : 'danger'} dot>
          {a.granted ? 'Autorizado' : 'Denegado'}
        </Badge>
      ),
    },
  ]

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Asistencias"
        description="Cada entrada registrada, con el método usado y si se autorizó el acceso."
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={() =>
                downloadCsv(
                  `asistencias-${new Date().toISOString().slice(0, 10)}.csv`,
                  rows.map((a) => ({
                    Fecha: a.date,
                    Hora: a.time,
                    Socio: a.memberName,
                    Metodo: CHECKIN_METHOD_LABEL[a.method],
                    Resultado: a.granted ? 'Autorizado' : 'Denegado',
                  })),
                )
              }
            >
              Exportar
            </Button>
            <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setManualOpen(true)}>
              Registro manual
            </Button>
            <LinkButton to="/recepcion" variant="primary" size="sm" icon={<ScanLine className="h-3.5 w-3.5" />}>
              Abrir recepción
            </LinkButton>
          </>
        }
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-[1.5fr_1fr]">
        <Card lit>
          <CardHeader
            title="Asistencias por día"
            subtitle={`${num(rows.length)} entradas · ${num(uniquePeople)} socios distintos`}
          />
          <CardBody>
            <AreaChart data={series} format={num} height={190} seriesLabel="Asistencias" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Horas pico" subtitle="Cuándo se llena tu gimnasio" />
          <CardBody>
            <BarChart data={hourly} format={num} height={190} highlightMax label="Asistencias por hora" />
          </CardBody>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRangeFilter value={range} onChange={setRange} />
        <SearchInput value={query} onValueChange={setQuery} placeholder="Buscar socio…" className="w-full sm:w-64" />
        <Select
          value={method}
          onChange={(e) => setMethod(e.target.value as CheckInMethod | 'ALL')}
          containerClassName="w-full sm:w-44"
        >
          <option value="ALL">Todos los métodos</option>
          {(['fingerprint', 'qr', 'reception', 'manual', 'card'] as CheckInMethod[]).map((m) => (
            <option key={m} value={m}>
              {CHECKIN_METHOD_LABEL[m]}
            </option>
          ))}
        </Select>
      </div>

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          loading={attendance.loading}
          pageSize={40}
          empty={
            <EmptyState
              icon={<Fingerprint className="h-6 w-6" />}
              title="Sin asistencias en este periodo"
              detail="Las entradas se registran desde recepción, con huella, QR o manualmente."
            />
          }
        />
      </Card>

      {/* Registro manual */}
      <Modal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title="Registrar asistencia manualmente"
        description="Úsalo cuando el lector falle o alguien entre sin marcar."
        size="sm"
      >
        <ManualAttendance
          members={members.data}
          onPick={async (memberId) => {
            if (!repo) return
            const m = members.data.find((x) => x.id === memberId)
            if (!m) return
            const result = await evaluateAccess(repo, m, settings)
            await recordAttendance(repo, m, 'manual', result.granted)
            if (result.granted) toast.success('Asistencia registrada', m.name)
            else toast.warning('Se registró el intento', `${m.name} — ${result.reason}`)
            setManualOpen(false)
          }}
        />
      </Modal>
    </div>
  )
}

function ManualAttendance({
  members,
  onPick,
}: {
  members: Array<{ id: string; name: string; photoUrl?: string | null }>
  onPick: (id: string) => Promise<void>
}) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const n = norm(q.trim())
    if (!n) return members.slice(0, 8)
    return members.filter((m) => norm(m.name).includes(n)).slice(0, 8)
  }, [members, q])

  return (
    <div>
      <SearchInput value={q} onValueChange={setQ} placeholder="Buscar socio…" autoFocus />
      <ul className="mt-3 space-y-1">
        {filtered.map((m) => (
          <li key={m.id}>
            <button
              onClick={() => onPick(m.id)}
              className={cx(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition',
                'hover:bg-white/[.05]',
              )}
            >
              <Avatar name={m.name} src={m.photoUrl} size={32} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-100">{m.name}</span>
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="py-6 text-center text-[13px] text-ink-500">Sin resultados</li>}
      </ul>
    </div>
  )
}
