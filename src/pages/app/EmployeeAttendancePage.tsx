import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CheckCircle2, Clock, Download, LogIn, LogOut } from 'lucide-react'
import type { Employee, EmployeeAttendance } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { useToast } from '@/hooks/useToast'
import { checkIn, checkOut, justifyAbsence } from '@/services/employeeAttendance'
import { fullName } from '@/services/employees'
import { CHECK_METHOD_LABEL } from '@/services/biometric'
import {
  WORK_STATUS_LABEL,
  WORK_STATUS_TONE,
  absenceRecord,
  formatDuration,
  missingDays,
  summarize,
  type WorkSummary,
} from '@/lib/workSchedule'
import { addDays, dayKey, fmtDayKey, startOfWeek, timeKey } from '@/lib/date'
import { reportError } from '@/lib/errors'
import { cx, downloadCsv } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Avatar, Badge, EmptyState, LoadingBlock, Progress } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Segmented, Select } from '@/components/ui/Inputs'

// ═══════════════════════════════════════════════════════════════════════════
// Asistencia del personal.
//
// LA PREGUNTA QUE CONTESTA ESTA PANTALLA es «¿cómo va mi equipo esta semana?»,
// no «¿a qué hora llegó Adrián el martes?». Por eso lo primero que se ve es el
// resumen por persona, y el detalle día por día está un clic más abajo.
//
// Obligar al dueño a revisar 100 registros sueltos para enterarse de que
// alguien llegó tarde una vez es la forma más segura de que no los revise.
// ═══════════════════════════════════════════════════════════════════════════

type RangeKey = 'today' | 'week' | 'lastWeek' | 'month' | 'custom'

const RANGES: Array<{ value: RangeKey; label: string }> = [
  { value: 'today', label: 'Hoy' },
  { value: 'week', label: 'Esta semana' },
  { value: 'lastWeek', label: 'Semana anterior' },
  { value: 'month', label: 'Este mes' },
  { value: 'custom', label: 'Personalizado' },
]

/** Rango en claves de fecha, que es como se consulta `employeeAttendance`. */
function resolveRange(key: RangeKey, customFrom: string, customTo: string): { from: string; to: string } {
  const now = Date.now()
  switch (key) {
    case 'today':
      return { from: dayKey(now), to: dayKey(now) }
    case 'week': {
      const start = startOfWeek(now)
      return { from: dayKey(start), to: dayKey(addDays(start, 6)) }
    }
    case 'lastWeek': {
      const start = addDays(startOfWeek(now), -7)
      return { from: dayKey(start), to: dayKey(addDays(start, 6)) }
    }
    case 'month': {
      const d = new Date(now)
      const first = new Date(d.getFullYear(), d.getMonth(), 1)
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      return { from: dayKey(first.getTime()), to: dayKey(last.getTime()) }
    }
    case 'custom':
      return { from: customFrom, to: customTo }
  }
}

/** Todos los días del rango, para poder deducir las faltas. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  let cur = new Date(fy, fm - 1, fd).getTime()
  const end = new Date(ty, tm - 1, td).getTime()
  // Tope de seguridad: un rango absurdo no puede colgar la pantalla.
  while (cur <= end && out.length < 200) {
    out.push(dayKey(cur))
    cur = addDays(cur, 1)
  }
  return out
}

export default function EmployeeAttendancePage() {
  const { repo, settings, user, can } = useSession()
  const toast = useToast()

  const [rangeKey, setRangeKey] = useState<RangeKey>('week')
  const [customFrom, setCustomFrom] = useState(() => dayKey(startOfWeek(Date.now())))
  const [customTo, setCustomTo] = useState(() => dayKey())
  const [positionFilter, setPositionFilter] = useState('ALL')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [checking, setChecking] = useState<Employee | null>(null)
  const [justifying, setJustifying] = useState<{ employee: Employee; date: string } | null>(null)

  const range = useMemo(
    () => resolveRange(rangeKey, customFrom, customTo),
    [rangeKey, customFrom, customTo],
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

  // Acotado por fecha SIEMPRE. Un gimnasio con 20 empleados genera 400
  // registros al mes: pedir la colección entera se cae sola al segundo año.
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

  const canWrite = can('workAttendance.write')
  const today = dayKey()
  const rangeDays = useMemo(() => daysBetween(range.from, range.to), [range.from, range.to])

  const positions = useMemo(
    () => [...new Set(employees.data.map((e) => e.position))].sort(),
    [employees.data],
  )

  /** Por empleado: sus registros reales + las faltas deducidas del horario. */
  const perEmployee = useMemo(() => {
    const visible = employees.data.filter((e) =>
      positionFilter === 'ALL' ? true : e.position === positionFilter,
    )

    return visible.map((employee) => {
      const own = records.data.filter((r) => r.employeeId === employee.id)
      const absences = missingDays(employee.schedule, rangeDays, own, today).map((d) =>
        absenceRecord(employee.gymId, employee, d, employee.schedule),
      )
      const all = [...own, ...absences].sort((a, b) => b.date.localeCompare(a.date))
      return { employee, records: all, summary: summarize(all) }
    })
  }, [employees.data, records.data, rangeDays, today, positionFilter])

  const totals = useMemo<WorkSummary>(() => {
    return perEmployee.reduce<WorkSummary>(
      (acc, row) => ({
        onTime: acc.onTime + row.summary.onTime,
        late: acc.late + row.summary.late,
        absent: acc.absent + row.summary.absent,
        justified: acc.justified + row.summary.justified,
        earlyExits: acc.earlyExits + row.summary.earlyExits,
        incomplete: acc.incomplete + row.summary.incomplete,
        lateMinutes: acc.lateMinutes + row.summary.lateMinutes,
        earlyExitMinutes: acc.earlyExitMinutes + row.summary.earlyExitMinutes,
        workedMinutes: acc.workedMinutes + row.summary.workedMinutes,
        daysWorked: acc.daysWorked + row.summary.daysWorked,
        punctualityPct: 0,
      }),
      {
        onTime: 0,
        late: 0,
        absent: 0,
        justified: 0,
        earlyExits: 0,
        incomplete: 0,
        lateMinutes: 0,
        earlyExitMinutes: 0,
        workedMinutes: 0,
        daysWorked: 0,
        punctualityPct: 0,
      },
    )
  }, [perEmployee])

  if (employees.loading) return <LoadingBlock label="Cargando el personal…" />

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        eyebrow="Personal"
        title="Asistencia del personal"
        description="Puntualidad, retardos y faltas de tu equipo. La hora real de entrada se guarda siempre tal cual: la tolerancia decide el estado, no cambia el dato."
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={<Download className="h-3.5 w-3.5" />}
            disabled={perEmployee.length === 0}
            onClick={() =>
              downloadCsv(
                `asistencia-personal-${range.from}_${range.to}.csv`,
                perEmployee.map(({ employee, summary }) => ({
                  Empleado: fullName(employee),
                  Puesto: employee.position,
                  DiasTrabajados: summary.daysWorked,
                  Puntualidades: summary.onTime,
                  Retardos: summary.late,
                  MinutosRetardo: summary.lateMinutes,
                  Faltas: summary.absent,
                  Justificadas: summary.justified,
                  SalidasAnticipadas: summary.earlyExits,
                  HorasTrabajadas: formatDuration(summary.workedMinutes),
                  PuntualidadPct: summary.punctualityPct,
                })),
              )
            }
          >
            Exportar
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented value={rangeKey} onChange={setRangeKey} options={RANGES} size="sm" />
        {rangeKey === 'custom' && (
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

      {/* ── Totales del periodo ────────────────────────────────────────── */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TotalTile label="Puntualidades" value={totals.onTime} tone="gym" />
        <TotalTile label="Retardos" value={totals.late} hint={`${totals.lateMinutes} min`} tone="warn" />
        <TotalTile label="Faltas" value={totals.absent} hint={`${totals.justified} justificadas`} tone="danger" />
        <TotalTile label="Horas trabajadas" text={formatDuration(totals.workedMinutes)} tone="cyber" />
      </div>

      {perEmployee.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarClock className="h-6 w-6" />}
            title="Todavía no hay personal activo"
            detail="Da de alta a tu equipo en Empleados para empezar a llevar su asistencia."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {perEmployee.map(({ employee, records: rows, summary }) => {
            const open = expanded === employee.id
            return (
              <Card key={employee.id}>
                <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
                  <Avatar name={fullName(employee)} src={employee.photoUrl} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-ink-50">{fullName(employee)}</p>
                    <p className="truncate text-[12.5px] text-ink-400">{employee.position}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Dot tone="gym" value={summary.onTime} label="puntuales" />
                    <Dot tone="warn" value={summary.late} label="retardos" />
                    <Dot tone="danger" value={summary.absent} label="faltas" />
                  </div>

                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Clock className="h-3.5 w-3.5" />}
                      onClick={() => setChecking(employee)}
                    >
                      Fichar
                    </Button>
                  )}
                  <Button variant="subtle" size="sm" onClick={() => setExpanded(open ? null : employee.id)}>
                    {open ? 'Ocultar' : 'Detalle'}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3 px-5 py-3 sm:grid-cols-4">
                  <Mini label="Horas" value={formatDuration(summary.workedMinutes)} />
                  <Mini label="Min. retardo" value={String(summary.lateMinutes)} />
                  <Mini label="Salidas antes" value={String(summary.earlyExits)} />
                  <Mini label="Puntualidad" value={`${summary.punctualityPct}%`}>
                    <Progress
                      value={summary.punctualityPct}
                      tone={summary.punctualityPct >= 80 ? 'gym' : summary.punctualityPct >= 60 ? 'warn' : 'danger'}
                      className="mt-1.5"
                    />
                  </Mini>
                </div>

                {open && (
                  <CardBody className="border-t border-white/[.06] pt-3">
                    {rows.length === 0 ? (
                      <p className="py-6 text-center text-[13px] text-ink-500">
                        Sin registros en este periodo.
                      </p>
                    ) : (
                      <ul className="divide-y divide-white/[.05]">
                        {rows.map((r) => (
                          <DayRow
                            key={r.id}
                            record={r}
                            canWrite={canWrite}
                            onJustify={() => setJustifying({ employee, date: r.date })}
                          />
                        ))}
                      </ul>
                    )}
                  </CardBody>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Fichaje manual ─────────────────────────────────────────────── */}
      <Modal
        open={checking !== null}
        onClose={() => setChecking(null)}
        title={`Fichar a ${checking ? fullName(checking) : ''}`}
        description="Se guarda la hora que escribas, tal cual. Queda registrado como fichaje manual en la bitácora."
        size="sm"
      >
        {checking && (
          <ManualCheckForm
            onCancel={() => setChecking(null)}
            onSubmit={async (kind, date, time) => {
              if (!repo) return
              try {
                const args = { employee: checking, settings, method: 'MANUAL' as const, date, time }
                const r = kind === 'IN' ? await checkIn(repo, args) : await checkOut(repo, args)
                toast.success(
                  kind === 'IN' ? 'Entrada registrada' : 'Salida registrada',
                  r ? `${fullName(checking)} · ${WORK_STATUS_LABEL[r.status]}` : fullName(checking),
                )
                setChecking(null)
              } catch (err) {
                toast.error('No se pudo fichar', reportError('fichaje manual', err).message)
              }
            }}
          />
        )}
      </Modal>

      {/* ── Justificar falta ───────────────────────────────────────────── */}
      <JustifyModal
        open={justifying !== null}
        employee={justifying?.employee ?? null}
        date={justifying?.date ?? ''}
        onClose={() => setJustifying(null)}
        onSave={async (reason) => {
          if (!repo || !justifying || !user) return
          try {
            await justifyAbsence(repo, justifying.employee, justifying.date, reason, user.uid)
            toast.success('Falta justificada', `${fullName(justifying.employee)} · ${justifying.date}`)
            setJustifying(null)
          } catch (err) {
            toast.error('No se pudo justificar', reportError('justificar falta', err).message)
          }
        }}
      />
    </div>
  )
}

// ────────────────────────────── Piezas ──────────────────────────────────────

const TONE_TEXT = {
  gym: 'text-gym',
  warn: 'text-warn-400',
  danger: 'text-danger-400',
  cyber: 'text-cyber-400',
} as const

function TotalTile({
  label,
  value,
  text,
  hint,
  tone,
}: {
  label: string
  value?: number
  text?: string
  hint?: string
  tone: keyof typeof TONE_TEXT
}) {
  return (
    <Card className="p-4">
      <p className="text-[12px] text-ink-400">{label}</p>
      <p className={cx('mt-1.5 text-[24px] font-bold leading-none tnum', TONE_TEXT[tone])}>
        {text ?? value ?? 0}
      </p>
      {hint && <p className="mt-1.5 text-[11.5px] text-ink-500">{hint}</p>}
    </Card>
  )
}

function Dot({ tone, value, label }: { tone: 'gym' | 'warn' | 'danger'; value: number; label: string }) {
  const color = tone === 'gym' ? 'bg-gym' : tone === 'warn' ? 'bg-warn-400' : 'bg-danger-400'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1">
      <span className={cx('h-2 w-2 rounded-full', color)} />
      <span className="text-[12.5px] font-semibold text-ink-100 tnum">{value}</span>
      <span className="hidden text-[11.5px] text-ink-500 sm:inline">{label}</span>
    </span>
  )
}

function Mini({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[.05] bg-white/[.02] px-3 py-2">
      <p className="text-[11px] text-ink-500">{label}</p>
      <p className="mt-0.5 text-[14px] font-semibold text-ink-100 tnum">{value}</p>
      {children}
    </div>
  )
}

function DayRow({
  record,
  canWrite,
  onJustify,
}: {
  record: EmployeeAttendance
  canWrite: boolean
  onJustify: () => void
}) {
  const tone = WORK_STATUS_TONE[record.status]
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5">
      <span className="w-40 shrink-0 text-[12.5px] text-ink-300">{fmtDayKey(record.date)}</span>

      <span className="flex items-center gap-1.5 text-[12.5px] text-ink-200 tnum">
        <LogIn className="h-3.5 w-3.5 text-ink-500" />
        {record.actualEntry ?? '—'}
      </span>
      <span className="flex items-center gap-1.5 text-[12.5px] text-ink-200 tnum">
        <LogOut className="h-3.5 w-3.5 text-ink-500" />
        {record.actualExit ?? '—'}
      </span>

      <Badge tone={tone}>
        {WORK_STATUS_LABEL[record.status]}
        {record.lateMinutes > 0 && ` ${record.lateMinutes} min`}
      </Badge>

      {record.earlyExitMinutes > 0 && record.status !== 'EARLY_EXIT' && (
        <Badge tone="warn">Salió {record.earlyExitMinutes} min antes</Badge>
      )}

      <span className="ml-auto flex items-center gap-2">
        {record.workedMinutes > 0 && (
          <span className="text-[12px] text-ink-400 tnum">{formatDuration(record.workedMinutes)}</span>
        )}
        <span className="hidden text-[11px] text-ink-600 sm:inline">
          {CHECK_METHOD_LABEL[record.method]}
        </span>
        {canWrite && record.status === 'ABSENT' && (
          <Button variant="subtle" size="sm" onClick={onJustify}>
            Justificar
          </Button>
        )}
      </span>

      {record.justification && (
        <p className="w-full pl-1 text-[11.5px] text-cyber-300">Motivo: {record.justification}</p>
      )}
    </li>
  )
}

function ManualCheckForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void
  onSubmit: (kind: 'IN' | 'OUT', date: string, time: string) => Promise<void>
}) {
  const [kind, setKind] = useState<'IN' | 'OUT'>('IN')
  const [date, setDate] = useState(() => dayKey())
  const [time, setTime] = useState(() => timeKey())
  const [busy, setBusy] = useState(false)

  return (
    <div>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'IN', label: 'Entrada', icon: <LogIn className="h-3.5 w-3.5" /> },
          { value: 'OUT', label: 'Salida', icon: <LogOut className="h-3.5 w-3.5" /> },
        ]}
        className="mb-4"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label="Hora" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="subtle" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onSubmit(kind, date, time)
            } finally {
              setBusy(false)
            }
          }}
        >
          Registrar
        </Button>
      </div>
    </div>
  )
}

function JustifyModal({
  open,
  employee,
  date,
  onClose,
  onSave,
}: {
  open: boolean
  employee: Employee | null
  date: string
  onClose: () => void
  onSave: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setReason('')
  }, [open])

  const suggestions = ['Permiso personal', 'Permiso médico', 'Incapacidad', 'Día festivo', 'Vacaciones']

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Justificar la falta"
      description={employee ? `${fullName(employee)} · ${fmtDayKey(date)}` : ''}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={async () => {
              setBusy(true)
              try {
                await onSave(reason)
              } finally {
                setBusy(false)
              }
            }}
          >
            Justificar
          </Button>
        </>
      }
    >
      <Input
        label="Motivo"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Permiso personal"
        autoFocus
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => setReason(s)}
            className="rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[11.5px] text-ink-300 transition hover:border-white/20 hover:text-ink-100"
          >
            {s}
          </button>
        ))}
      </div>
      <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-ink-500">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Basta con el motivo general. No escribas diagnósticos ni información médica: para el gimnasio
        «permiso médico» es suficiente, y el detalle no es asunto suyo.
      </p>
    </Modal>
  )
}
