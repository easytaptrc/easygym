import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Fingerprint, Pencil, Plus, UserCog, UserX, Users } from 'lucide-react'
import type { Employee, WorkSchedule } from '@/types'
import { DEFAULT_POSITIONS } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { useToast } from '@/hooks/useToast'
import {
  createEmployee,
  employeeTag,
  fullName,
  setEmployeeStatus,
  setSchedule,
  updateEmployee,
} from '@/services/employees'
import { defaultSchedule, formatDuration, weeklyScheduledMinutes } from '@/lib/workSchedule'
import { fmtDate } from '@/lib/date'
import { reportError } from '@/lib/errors'
import { cx, norm } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Avatar, Badge, EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { Button, IconButton } from '@/components/ui/Button'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Input, SearchInput, Select, Textarea } from '@/components/ui/Inputs'
import { ScheduleEditor } from '@/components/ScheduleEditor'

// ═══════════════════════════════════════════════════════════════════════════
// Personal del gimnasio.
//
// UN EMPLEADO NO ES UN USUARIO: el de limpieza ficha con la huella y nunca
// inicia sesión. Por eso esta pantalla es distinta de /usuarios, que gestiona
// cuentas de acceso.
// ═══════════════════════════════════════════════════════════════════════════

export default function Employees() {
  const { repo, can } = useSession()
  const toast = useToast()

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ACTIVE')
  const [editing, setEditing] = useState<Employee | null>(null)
  const [creating, setCreating] = useState(false)
  const [scheduling, setScheduling] = useState<Employee | null>(null)
  const [deactivating, setDeactivating] = useState<Employee | null>(null)
  const [busy, setBusy] = useState(false)

  // Un gimnasio tiene decenas de empleados, no miles: cabe con tope holgado.
  const employees = useCollection(
    'employees',
    useMemo(() => ({ orderBy: { field: 'employeeNumber' as const, dir: 'asc' as const }, limit: 200 }), []),
  )

  const canManage = can('employees.manage')

  const rows = useMemo(() => {
    const q = norm(query.trim())
    return employees.data
      .filter((e) => (statusFilter === 'ALL' ? true : e.status === statusFilter))
      .filter((e) =>
        !q ? true : norm(fullName(e)).includes(q) || norm(e.position).includes(q) || e.phone.includes(q),
      )
  }, [employees.data, query, statusFilter])

  const byPosition = useMemo(() => {
    const out: Record<string, number> = {}
    for (const e of employees.data) {
      if (e.status !== 'ACTIVE') continue
      out[e.position] = (out[e.position] ?? 0) + 1
    }
    return Object.entries(out).sort((a, b) => b[1] - a[1])
  }, [employees.data])

  if (employees.loading) return <LoadingBlock label="Cargando el personal…" />

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Empleados"
        description="Quién trabaja aquí, en qué puesto y con qué horario. No es lo mismo que Usuarios: un empleado puede no tener cuenta."
        actions={
          canManage && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setCreating(true)}
            >
              Nuevo empleado
            </Button>
          )
        }
      />

      {byPosition.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {byPosition.map(([position, count]) => (
            <span
              key={position}
              className="rounded-full border border-white/[.07] bg-white/[.03] px-3 py-1.5 text-[12px] text-ink-300"
            >
              {position} <span className="font-semibold text-ink-100 tnum">{count}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Buscar por nombre, puesto o teléfono…"
          className="w-full sm:w-80"
        />
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          containerClassName="w-full sm:w-44"
        >
          <option value="ACTIVE">Activos</option>
          <option value="INACTIVE">Dados de baja</option>
          <option value="ALL">Todos</option>
        </Select>
        <Link
          to="/empleados/asistencia"
          className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-4 text-sm font-semibold text-ink-100 transition hover:border-white/20"
        >
          <CalendarClock className="h-4 w-4" />
          Ver asistencia
        </Link>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title={query ? 'Nadie coincide' : 'Todavía no hay personal dado de alta'}
            detail={
              query
                ? 'Prueba con otro término.'
                : 'Da de alta a tu equipo para poder llevar su horario y su asistencia.'
            }
            action={
              canManage && !query ? (
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                  Nuevo empleado
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((e) => (
            <Card key={e.id} className={cx('p-4', e.status === 'INACTIVE' && 'opacity-60')} hover>
              <div className="flex items-start gap-3">
                <Avatar name={fullName(e)} src={e.photoUrl} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-semibold text-ink-50">{fullName(e)}</p>
                  <p className="truncate text-[12.5px] text-ink-400">{e.position}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-600">
                    {employeeTag(e.employeeNumber)}
                  </p>
                </div>
                {e.status === 'INACTIVE' && <Badge tone="danger">Baja</Badge>}
                {e.fingerprintId && (
                  <span title="Huella registrada" className="text-gym">
                    <Fingerprint className="h-4 w-4" />
                  </span>
                )}
              </div>

              <dl className="mt-3 space-y-1 border-t border-white/[.06] pt-3 text-[12px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-500">Horario</dt>
                  <dd className="text-ink-200 tnum">
                    {formatDuration(weeklyScheduledMinutes(e.schedule))} / semana
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-500">Tolerancia</dt>
                  <dd className="text-ink-200 tnum">
                    {e.toleranceMinutes ?? 15} min
                  </dd>
                </div>
                {e.hireDate && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-500">Ingreso</dt>
                    <dd className="text-ink-200">{fmtDate(new Date(e.hireDate).getTime())}</dd>
                  </div>
                )}
              </dl>

              {canManage && (
                <div className="mt-3 flex gap-1.5 border-t border-white/[.06] pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1"
                    icon={<CalendarClock className="h-3.5 w-3.5" />}
                    onClick={() => setScheduling(e)}
                  >
                    Horario
                  </Button>
                  <IconButton label="Editar" size="sm" onClick={() => setEditing(e)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </IconButton>
                  {e.status === 'ACTIVE' ? (
                    <IconButton label="Dar de baja" size="sm" onClick={() => setDeactivating(e)}>
                      <UserX className="h-3.5 w-3.5" />
                    </IconButton>
                  ) : (
                    <IconButton
                      label="Reactivar"
                      size="sm"
                      onClick={async () => {
                        if (!repo) return
                        await setEmployeeStatus(repo, e.id, 'ACTIVE')
                        toast.success('Empleado reactivado', fullName(e))
                      }}
                    >
                      <UserCog className="h-3.5 w-3.5" />
                    </IconButton>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* ── Alta y edición ─────────────────────────────────────────────── */}
      <EmployeeModal
        open={creating || editing !== null}
        employee={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSave={async (v) => {
          if (!repo) return
          try {
            if (editing) {
              await updateEmployee(repo, editing.id, v)
              toast.success('Empleado actualizado', `${v.name} ${v.lastName}`.trim())
            } else {
              await createEmployee(repo, v)
              toast.success('Empleado dado de alta', `${v.name} ${v.lastName}`.trim())
            }
            setCreating(false)
            setEditing(null)
          } catch (err) {
            toast.error('No se pudo guardar', reportError('guardar empleado', err).message)
          }
        }}
      />

      {/* ── Horario ────────────────────────────────────────────────────── */}
      <Modal
        open={scheduling !== null}
        onClose={() => setScheduling(null)}
        title={`Horario de ${scheduling ? fullName(scheduling) : ''}`}
        description="Define los turnos de cada día y los minutos de tolerancia de entrada."
        size="lg"
      >
        {scheduling && (
          <ScheduleForm
            employee={scheduling}
            busy={busy}
            onCancel={() => setScheduling(null)}
            onSave={async (schedule, tolerance) => {
              if (!repo) return
              setBusy(true)
              try {
                await setSchedule(repo, scheduling.id, schedule, tolerance)
                toast.success('Horario guardado', fullName(scheduling))
                setScheduling(null)
              } catch (err) {
                toast.error('No se pudo guardar el horario', reportError('guardar horario', err).message)
              } finally {
                setBusy(false)
              }
            }}
          />
        )}
      </Modal>

      <ConfirmModal
        open={deactivating !== null}
        onClose={() => setDeactivating(null)}
        title="¿Dar de baja a este empleado?"
        message={`${deactivating ? fullName(deactivating) : ''} dejará de aparecer en la asistencia diaria. NO se borra nada: su historial se conserva íntegro, porque es el respaldo de lo que se le pagó.`}
        confirmLabel="Dar de baja"
        loading={busy}
        onConfirm={async () => {
          if (!repo || !deactivating) return
          setBusy(true)
          try {
            await setEmployeeStatus(repo, deactivating.id, 'INACTIVE')
            toast.info('Empleado dado de baja', fullName(deactivating))
            setDeactivating(null)
          } finally {
            setBusy(false)
          }
        }}
      />
    </div>
  )
}

// ──────────────────────────── Formularios ───────────────────────────────────

interface EmployeeValues {
  name: string
  lastName: string
  phone: string
  email: string
  position: string
  hireDate: string | null
  notes: string
}

function EmployeeModal({
  open,
  employee,
  onClose,
  onSave,
}: {
  open: boolean
  employee: Employee | null
  onClose: () => void
  onSave: (v: EmployeeValues) => Promise<void>
}) {
  const [v, setV] = useState<EmployeeValues>({
    name: '',
    lastName: '',
    phone: '',
    email: '',
    position: 'Recepción',
    hireDate: null,
    notes: '',
  })
  const [customPosition, setCustomPosition] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const known = employee ? DEFAULT_POSITIONS.includes(employee.position as never) : true
    setV({
      name: employee?.name ?? '',
      lastName: employee?.lastName ?? '',
      phone: employee?.phone ?? '',
      email: employee?.email ?? '',
      position: employee ? (known ? employee.position : 'Otro') : 'Recepción',
      hireDate: employee?.hireDate ?? null,
      notes: employee?.notes ?? '',
    })
    setCustomPosition(employee && !known ? employee.position : '')
  }, [open, employee])

  const position = v.position === 'Otro' ? customPosition.trim() : v.position
  const valid = v.name.trim().length >= 2 && position.length >= 2

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={employee ? 'Editar empleado' : 'Nuevo empleado'}
      description="Los datos mínimos para poder llevar su horario y su asistencia."
      size="lg"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!valid}
            onClick={async () => {
              setBusy(true)
              try {
                await onSave({ ...v, position })
              } finally {
                setBusy(false)
              }
            }}
          >
            {employee ? 'Guardar' : 'Dar de alta'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Nombre"
          required
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
          autoFocus
        />
        <Input
          label="Apellidos"
          value={v.lastName}
          onChange={(e) => setV({ ...v, lastName: e.target.value })}
        />
        <Input
          label="Teléfono"
          type="tel"
          value={v.phone}
          onChange={(e) => setV({ ...v, phone: e.target.value })}
          placeholder="33 0000 0000"
        />
        <Input
          label="Correo (opcional)"
          type="email"
          value={v.email}
          onChange={(e) => setV({ ...v, email: e.target.value })}
        />
        <Select
          label="Puesto"
          required
          value={v.position}
          onChange={(e) => setV({ ...v, position: e.target.value })}
        >
          {DEFAULT_POSITIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Input
          label="Fecha de ingreso"
          type="date"
          value={v.hireDate ?? ''}
          onChange={(e) => setV({ ...v, hireDate: e.target.value || null })}
        />
        {v.position === 'Otro' && (
          <Input
            label="¿Qué puesto?"
            required
            value={customPosition}
            onChange={(e) => setCustomPosition(e.target.value)}
            placeholder="Nutrición, Valet, Coordinador…"
            containerClassName="sm:col-span-2"
            hint="Cada gimnasio tiene sus propios puestos: escribe el que uses."
          />
        )}
        <Textarea
          label="Notas (opcional)"
          value={v.notes}
          onChange={(e) => setV({ ...v, notes: e.target.value })}
          containerClassName="sm:col-span-2"
          rows={2}
        />
      </div>

      {!employee && (
        <p className="mt-4 rounded-xl border border-white/[.07] bg-white/[.02] px-3.5 py-3 text-[12px] leading-relaxed text-ink-400">
          Se le asigna un horario de lunes a viernes de 7:00 a 16:00 que puedes cambiar después desde
          el botón <span className="text-ink-200">Horario</span>. Dar de alta un empleado NO le crea
          una cuenta: eso se hace en <span className="text-ink-200">Usuarios</span> y solo si necesita
          entrar al sistema.
        </p>
      )}
    </Modal>
  )
}

function ScheduleForm({
  employee,
  busy,
  onCancel,
  onSave,
}: {
  employee: Employee
  busy: boolean
  onCancel: () => void
  onSave: (schedule: WorkSchedule, tolerance: number | null) => Promise<void>
}) {
  const [schedule, setScheduleState] = useState<WorkSchedule>(employee.schedule ?? defaultSchedule())
  const [tolerance, setTolerance] = useState<string>(String(employee.toleranceMinutes ?? 15))

  return (
    <div>
      <ScheduleEditor value={schedule} onChange={setScheduleState} />

      <div className="mt-4 rounded-xl border border-white/[.07] bg-white/[.02] p-4">
        <Input
          label="Tolerancia de entrada"
          type="number"
          min={0}
          max={120}
          value={tolerance}
          onChange={(e) => setTolerance(e.target.value)}
          suffix={<span className="text-[12px]">min</span>}
          containerClassName="max-w-[220px]"
        />
        <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
          Con entrada a las 7:00 y {tolerance || 0} minutos de tolerancia, llegar a las{' '}
          <span className="text-ink-200">7:{String(Number(tolerance) || 0).padStart(2, '0')}</span> sigue
          siendo puntual; un minuto más ya es retardo. La hora real de entrada se guarda siempre tal
          cual: la tolerancia decide el estado, no maquilla el dato.
        </p>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="subtle" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          loading={busy}
          onClick={() => onSave(schedule, tolerance === '' ? null : Number(tolerance))}
        >
          Guardar horario
        </Button>
      </div>
    </div>
  )
}
