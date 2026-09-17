import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Clock, Pencil, Plus, Trash2, User, Users } from 'lucide-react'
import type { ClassKind, GymClass, Weekday } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { useCounts } from '@/hooks/useCounts'
import { useToast } from '@/hooks/useToast'
import { audit } from '@/services/audit'
import { ALL_WEEKDAYS, dayKey, fmt12h, WEEKDAYS_SHORT, WEEKDAYS_ES } from '@/lib/date'
import { reportError } from '@/lib/errors'
import { cx } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge, EmptyState } from '@/components/ui/Feedback'
import { Button, IconButton } from '@/components/ui/Button'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea, Toggle } from '@/components/ui/Inputs'
import { completeOnboardingStep } from './OnboardingChecklist'

// ═══════════════════════════════════════════════════════════════════════════
// Clases del gimnasio.
//
// Los horarios NO están escritos en el código: cada clase define sus días y
// sus horas, y el dueño los cambia cuando quiera. Los ejemplos que trae la
// demo (spinning lunes a jueves 7, 8, 19 y 20 h) son datos, no constantes.
// ═══════════════════════════════════════════════════════════════════════════

const KINDS: Array<{ value: ClassKind; label: string; color: string }> = [
  { value: 'SPINNING', label: 'Spinning', color: '#22E06B' },
  { value: 'BOX', label: 'Box', color: '#FF6B6B' },
  { value: 'YOGA', label: 'Yoga', color: '#A970FF' },
  { value: 'CROSSFIT', label: 'CrossFit', color: '#38D9FF' },
  { value: 'FUNCIONAL', label: 'Funcional', color: '#FFBE3D' },
  { value: 'ZUMBA', label: 'Zumba', color: '#C2568C' },
  { value: 'OTRA', label: 'Otra', color: '#6C7E97' },
]

const HOURS = Array.from({ length: 19 }, (_, i) => `${String(i + 5).padStart(2, '0')}:00`)

export default function Classes() {
  const { repo, gym } = useSession()
  const toast = useToast()
  const classes = useCollection('classes')
  const plans = useCollection('membershipPlans')

  const [editing, setEditing] = useState<GymClass | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<GymClass | null>(null)

  const sorted = useMemo(
    () => [...classes.data].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
    [classes.data],
  )

  // Reservaciones futuras de cada clase, contadas en el servidor y acotadas a
  // partir de hoy. El histórico completo no aporta nada aquí y crece sin fin.
  const today = dayKey()
  const classIds = useMemo(() => sorted.map((c) => c.id).join(','), [sorted])
  const { counts } = useCounts(
    'reservations',
    useMemo(
      () =>
        Object.fromEntries(
          sorted.map((c) => [
            c.id,
            {
              where: [
                { field: 'classId', op: '==' as const, value: c.id },
                { field: 'date', op: '>=' as const, value: today },
              ],
            },
          ]),
        ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [classIds, today],
    ),
    [classIds, today],
  )

  const reservationCount = (classId: string) => counts[classId] ?? 0

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Clases"
        description="Spinning, box, yoga… con su instructor, cupo y horarios. Todo configurable, nada fijo."
        actions={
          <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
            Nueva clase
          </Button>
        }
      />

      {sorted.length === 0 && !classes.loading ? (
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="Todavía no tienes clases"
            detail="Crea tu primera clase con su instructor, cupo y horarios. Tus socios podrán reservar desde su portal."
            action={
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                Crear clase
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {sorted.map((c) => {
            const kind = KINDS.find((k) => k.value === c.kind)
            return (
              <Card key={c.id} hover className={cx(!c.active && 'opacity-55')}>
                <CardBody className="pt-5">
                  <div className="flex items-start gap-3">
                    <span
                      className="mt-1 h-10 w-1 shrink-0 rounded-full"
                      style={{ background: c.color ?? kind?.color ?? '#6C7E97' }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[17px] font-bold text-ink-50">{c.name}</h3>
                        {c.usesBikeMap && <Badge tone="gym">Mapa de bicicletas</Badge>}
                        {!c.active && <Badge tone="danger">Inactiva</Badge>}
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-400">
                        <span className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5" />
                          {c.instructor}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          {c.durationMin} min
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5" />
                          {c.capacity} lugares
                        </span>
                      </p>
                      {c.description && (
                        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">{c.description}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <IconButton label="Editar" size="sm" onClick={() => setEditing(c)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton label="Eliminar" size="sm" onClick={() => setDeleting(c)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </div>

                  {/* Horario */}
                  <div className="mt-4 rounded-xl border border-white/[.06] bg-ink-950/40 p-3">
                    <div className="flex flex-wrap gap-1">
                      {ALL_WEEKDAYS.map((d) => (
                        <span
                          key={d}
                          className={cx(
                            'grid h-6 w-8 place-items-center rounded-md text-[10.5px] font-semibold',
                            c.schedule.days.includes(d)
                              ? 'bg-gym/15 text-gym'
                              : 'bg-white/[.03] text-ink-600',
                          )}
                        >
                          {WEEKDAYS_SHORT[d]}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {[...c.schedule.times].sort().map((t) => (
                        <span
                          key={t}
                          className="rounded-md bg-white/[.05] px-2 py-1 font-mono text-[11px] text-ink-200"
                        >
                          {fmt12h(t)}
                        </span>
                      ))}
                      {c.schedule.times.length === 0 && (
                        <span className="text-[12px] text-ink-600">Sin horarios definidos</span>
                      )}
                    </div>
                  </div>

                  <p className="mt-3 text-[11.5px] text-ink-500">
                    {reservationCount(c.id)} reservaciones de hoy en adelante
                  </p>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      <ClassModal
        open={creating || editing !== null}
        cls={editing}
        planOptions={plans.data.map((p) => ({ id: p.id, name: p.name }))}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSave={async (values) => {
          if (!repo) return
          try {
            if (editing) {
              await repo.update('classes', editing.id, values)
              audit({
                gymId: repo.gymId,
                action: 'CLASS_UPDATED',
                entityType: 'classes',
                entityId: editing.id,
                summary: `Edición de la clase ${values.name}`,
                before: { cupo: editing.capacity, instructor: editing.instructor, activa: editing.active },
                after: { cupo: values.capacity, instructor: values.instructor, activa: values.active },
              })
              toast.success('Clase actualizada', values.name)
            } else {
              const created = await repo.create('classes', { ...values, branchId: null })
              await completeOnboardingStep(gym, 'classes')
              audit({
                gymId: repo.gymId,
                action: 'CLASS_CREATED',
                entityType: 'classes',
                entityId: created.id,
                summary: `Clase creada: ${values.name}`,
                after: { cupo: values.capacity, instructor: values.instructor },
              })
              toast.success('Clase creada', values.name)
            }
            setCreating(false)
            setEditing(null)
          } catch (err) {
            toast.error('No se pudo guardar la clase', reportError('guardar clase', err).message)
          }
        }}
      />

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="¿Eliminar esta clase?"
        message={
          deleting && reservationCount(deleting.id) > 0
            ? `Esta clase tiene ${reservationCount(deleting.id)} reservaciones próximas. Si la eliminas, esos socios se quedan sin lugar y el historial queda huérfano. Considera desactivarla en su lugar.`
            : 'La clase dejará de aparecer y no se podrá reservar.'
        }
        confirmLabel="Eliminar"
        onConfirm={async () => {
          if (!repo || !deleting) return
          await repo.remove('classes', deleting.id)
          audit({
            gymId: repo.gymId,
            action: 'CLASS_DELETED',
            entityType: 'classes',
            entityId: deleting.id,
            summary: `Clase eliminada: ${deleting.name}`,
            before: { nombre: deleting.name, cupo: deleting.capacity },
          })
          toast.info('Clase eliminada', deleting.name)
          setDeleting(null)
        }}
      />
    </div>
  )
}

// ────────────────────────────── Modal ───────────────────────────────────────

interface ClassValues {
  name: string
  kind: ClassKind
  instructor: string
  durationMin: number
  capacity: number
  schedule: { days: Weekday[]; times: string[] }
  active: boolean
  usesBikeMap: boolean
  description: string
  color: string
  allowedMembershipPlanIds: string[]
}

function ClassModal({
  open,
  cls,
  planOptions,
  onClose,
  onSave,
}: {
  open: boolean
  cls: GymClass | null
  planOptions: Array<{ id: string; name: string }>
  onClose: () => void
  onSave: (v: ClassValues) => Promise<void>
}) {
  const [v, setV] = useState<ClassValues>({
    name: '',
    kind: 'SPINNING',
    instructor: '',
    durationMin: 45,
    capacity: 20,
    schedule: { days: [1, 3, 5], times: ['19:00'] },
    active: true,
    usesBikeMap: true,
    description: '',
    color: '#22E06B',
    allowedMembershipPlanIds: [],
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    if (cls) {
      setV({
        name: cls.name,
        kind: cls.kind,
        instructor: cls.instructor,
        durationMin: cls.durationMin,
        capacity: cls.capacity,
        schedule: { days: [...cls.schedule.days], times: [...cls.schedule.times] },
        active: cls.active,
        usesBikeMap: cls.usesBikeMap,
        description: cls.description ?? '',
        color: cls.color ?? '#22E06B',
        allowedMembershipPlanIds: [...cls.allowedMembershipPlanIds],
      })
    } else {
      setV({
        name: '',
        kind: 'SPINNING',
        instructor: '',
        durationMin: 45,
        capacity: 20,
        schedule: { days: [1, 2, 3, 4], times: ['07:00', '19:00'] },
        active: true,
        usesBikeMap: true,
        description: '',
        color: '#22E06B',
        allowedMembershipPlanIds: [],
      })
    }
  }, [open, cls])

  const toggleDay = (d: Weekday) =>
    setV((x) => ({
      ...x,
      schedule: {
        ...x.schedule,
        days: x.schedule.days.includes(d) ? x.schedule.days.filter((y) => y !== d) : [...x.schedule.days, d],
      },
    }))

  const toggleTime = (t: string) =>
    setV((x) => ({
      ...x,
      schedule: {
        ...x.schedule,
        times: x.schedule.times.includes(t)
          ? x.schedule.times.filter((y) => y !== t)
          : [...x.schedule.times, t].sort(),
      },
    }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={cls ? 'Editar clase' : 'Nueva clase'}
      description="Elige días y horas concretas. Cada combinación se convierte en un horario reservable."
      size="lg"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!v.name.trim() || v.schedule.days.length === 0 || v.schedule.times.length === 0}
            onClick={async () => {
              setBusy(true)
              try {
                await onSave(v)
              } finally {
                setBusy(false)
              }
            }}
          >
            {cls ? 'Guardar' : 'Crear clase'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Nombre"
          required
          value={v.name}
          onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))}
          placeholder="Spinning"
        />
        <Select
          label="Tipo"
          value={v.kind}
          onChange={(e) => {
            const k = KINDS.find((x) => x.value === e.target.value)
            if (k)
              setV((x) => ({
                ...x,
                kind: k.value,
                color: k.color,
                usesBikeMap: k.value === 'SPINNING',
              }))
          }}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
        <Input
          label="Instructor"
          value={v.instructor}
          onChange={(e) => setV((x) => ({ ...x, instructor: e.target.value }))}
          placeholder="Coach Ana Ruiz"
        />
        <Input
          label="Duración (minutos)"
          type="number"
          min={10}
          value={v.durationMin}
          onChange={(e) => setV((x) => ({ ...x, durationMin: Number(e.target.value) }))}
        />
        <Input
          label="Cupo máximo"
          type="number"
          min={1}
          value={v.capacity}
          onChange={(e) => setV((x) => ({ ...x, capacity: Number(e.target.value) }))}
          hint="Cuando se llena, la clase se marca como LLENA"
        />
        <Textarea
          label="Descripción"
          value={v.description}
          onChange={(e) => setV((x) => ({ ...x, description: e.target.value }))}
          rows={2}
          containerClassName="sm:col-span-2"
        />
      </div>

      {/* Días */}
      <div className="mt-5">
        <p className="mb-2 text-[12.5px] font-medium text-ink-300">Días</p>
        <div className="flex flex-wrap gap-1.5">
          {ALL_WEEKDAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={cx(
                'rounded-lg px-3 py-2 text-[12.5px] font-semibold transition-all duration-200',
                v.schedule.days.includes(d)
                  ? 'bg-gym text-ink-950'
                  : 'bg-white/[.04] text-ink-400 hover:bg-white/[.08]',
              )}
            >
              {WEEKDAYS_ES[d].slice(0, 3)}
            </button>
          ))}
        </div>
      </div>

      {/* Horas */}
      <div className="mt-4">
        <p className="mb-2 text-[12.5px] font-medium text-ink-300">
          Horas de inicio{' '}
          <span className="text-ink-500">({v.schedule.times.length} seleccionadas)</span>
        </p>
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-7">
          {HOURS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => toggleTime(h)}
              className={cx(
                'rounded-lg py-2 font-mono text-[11.5px] font-semibold transition-all duration-200',
                v.schedule.times.includes(h)
                  ? 'bg-gym text-ink-950'
                  : 'bg-white/[.04] text-ink-400 hover:bg-white/[.08]',
              )}
            >
              {h}
            </button>
          ))}
        </div>
      </div>

      {/* Opciones */}
      <div className="mt-5 space-y-3.5 rounded-xl border border-white/[.07] bg-ink-950/40 p-4">
        <Toggle
          checked={v.active}
          onChange={(active) => setV((x) => ({ ...x, active }))}
          label="Clase activa"
          description="Si la desactivas deja de aparecer para reservar."
        />
        <Toggle
          checked={v.usesBikeMap}
          onChange={(usesBikeMap) => setV((x) => ({ ...x, usesBikeMap }))}
          label="Reservar eligiendo bicicleta"
          description="El socio elige su bici en el mapa, como una butaca de cine."
        />
        {planOptions.length > 0 && (
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-ink-300">
              Membresías permitidas{' '}
              <span className="text-ink-500">(ninguna seleccionada = todas)</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {planOptions.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    setV((x) => ({
                      ...x,
                      allowedMembershipPlanIds: x.allowedMembershipPlanIds.includes(p.id)
                        ? x.allowedMembershipPlanIds.filter((y) => y !== p.id)
                        : [...x.allowedMembershipPlanIds, p.id],
                    }))
                  }
                  className={cx(
                    'rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition',
                    v.allowedMembershipPlanIds.includes(p.id)
                      ? 'bg-cyber-400/20 text-cyber-300'
                      : 'bg-white/[.04] text-ink-400 hover:bg-white/[.08]',
                  )}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
