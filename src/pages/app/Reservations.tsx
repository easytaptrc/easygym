import { useMemo, useState } from 'react'
import { Bike, CalendarCheck, ChevronLeft, ChevronRight, Users, X } from 'lucide-react'
import type { Reservation } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { useToast } from '@/hooks/useToast'
import {
  buildSlots,
  cancelReservation,
  canCancel,
  cancellationWindowLabel,
  reserveSlot,
  type Slot,
} from '@/services/reservations'
import { reportError } from '@/lib/errors'
import { MemberPicker } from '@/components/MemberPicker'
import { addDays, dayKey, fmt12h, fmtDayKey, WEEKDAYS_ES } from '@/lib/date'
import { cx } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Avatar, Badge, EmptyState, Progress } from '@/components/ui/Feedback'
import { Button, IconButton } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { BikeMap } from '@/components/BikeMap'

// Vista de recepción/entrenador sobre las reservaciones: qué horarios hay hoy,
// cuánto cupo queda, quién está apuntado y quién no llegó.

export default function Reservations() {
  const { repo, settings } = useSession()
  const toast = useToast()

  const [date, setDate] = useState(() => dayKey())
  const [selected, setSelected] = useState<Slot | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const classes = useCollection('classes')
  const bikes = useCollection('bikes')
  // Acotado al día que se está viendo: la agenda de hoy no necesita las
  // reservaciones de los últimos tres años, y pedirlas no escala.
  const reservations = useCollection(
    'reservations',
    useMemo(() => ({ where: [{ field: 'date', op: '==' as const, value: date }] }), [date]),
  )

  const slots = useMemo(
    () => buildSlots(classes.data, reservations.data, date),
    [classes.data, reservations.data, date],
  )

  const slotReservations = useMemo(() => {
    if (!selected) return []
    return reservations.data.filter(
      (r) => r.classId === selected.classId && r.date === selected.date && r.time === selected.time,
    )
  }, [reservations.data, selected])

  const activeSlotReservations = slotReservations.filter((r) => r.status !== 'CANCELLED')
  const cls = classes.data.find((c) => c.id === selected?.classId) ?? null

  const dayTotals = useMemo(() => {
    const confirmed = reservations.data.filter((r) => r.date === date && r.status !== 'CANCELLED').length
    const capacity = slots.reduce((a, s) => a + s.capacity, 0)
    return { confirmed, capacity }
  }, [reservations.data, date, slots])

  async function doCancel(reservation: Reservation, force: boolean) {
    if (!repo) return
    try {
      await cancelReservation(repo, reservation, settings, force)
      toast.info('Reservación cancelada', `${reservation.memberName} · ${reservation.className}`)
    } catch (err) {
      toast.error('No se pudo cancelar', reportError('cancelar reservación', err).message)
    }
  }

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        title="Reservaciones"
        description={`Ventana de cancelación: ${cancellationWindowLabel(settings?.cancellationWindowMin ?? 120)}. Se configura en Configuración → Clases.`}
      />

      {/* Selector de día */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-white/[.07] bg-ink-900/70 p-1">
          <IconButton label="Día anterior" size="sm" onClick={() => setDate(dayKey(addDays(new Date(date), -1)))}>
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <div className="px-3 text-center">
            <p className="text-[13px] font-semibold text-ink-100">{fmtDayKey(date)}</p>
            <p className="text-[10.5px] text-ink-500">
              {WEEKDAYS_ES[new Date(date + 'T00:00:00').getDay() as 0]}
            </p>
          </div>
          <IconButton label="Día siguiente" size="sm" onClick={() => setDate(dayKey(addDays(new Date(date), 1)))}>
            <ChevronRight className="h-4 w-4" />
          </IconButton>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setDate(dayKey())}>
          Hoy
        </Button>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="h-8 rounded-xl border border-white/10 bg-ink-950/60 px-3 text-[12.5px] text-ink-200 outline-none [color-scheme:dark]"
        />
        <span className="ml-auto text-[12.5px] text-ink-400">
          <b className="text-ink-100 tnum">{dayTotals.confirmed}</b> reservaciones ·{' '}
          <span className="tnum">{dayTotals.capacity}</span> lugares
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1.25fr]">
        {/* Horarios del día */}
        <Card>
          <CardHeader title="Horarios" subtitle={`${slots.length} sesiones programadas`} icon={<CalendarCheck className="h-4 w-4" />} />
          <CardBody className="space-y-2">
            {slots.length === 0 ? (
              <EmptyState
                title="No hay clases este día"
                detail="Revisa los días configurados en cada clase."
              />
            ) : (
              slots.map((s) => {
                const isSelected = selected?.classId === s.classId && selected.time === s.time
                const pct = (s.taken / Math.max(1, s.capacity)) * 100
                return (
                  <button
                    key={`${s.classId}-${s.time}`}
                    onClick={() => setSelected(s)}
                    className={cx(
                      'w-full rounded-xl border p-3.5 text-left transition-all duration-200',
                      isSelected
                        ? 'border-gym/45 bg-gym/[.08]'
                        : 'border-white/[.07] bg-white/[.02] hover:border-white/[.16]',
                      s.past && 'opacity-60',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="shrink-0 rounded-lg bg-white/[.05] px-2.5 py-1.5 font-mono text-[12px] font-semibold text-ink-100">
                        {fmt12h(s.time)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold text-ink-50">
                          {s.className}
                          {s.usesBikeMap && <Bike className="ml-1.5 inline h-3.5 w-3.5 text-gym" />}
                        </p>
                        <p className="truncate text-[11.5px] text-ink-500">
                          {s.instructor} · {s.durationMin} min
                        </p>
                      </div>
                      {s.full ? (
                        <Badge tone="danger">CLASE LLENA</Badge>
                      ) : (
                        <span className="shrink-0 text-right">
                          <span className="block text-[14px] font-bold text-ink-50 tnum">{s.free}</span>
                          <span className="text-[10.5px] text-ink-500">libres</span>
                        </span>
                      )}
                    </div>
                    <Progress
                      className="mt-2.5"
                      value={s.taken}
                      max={s.capacity}
                      tone={pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'gym'}
                    />
                    <p className="mt-1.5 text-[11px] text-ink-500 tnum">
                      {s.taken} / {s.capacity} lugares
                    </p>
                  </button>
                )
              })
            )}
          </CardBody>
        </Card>

        {/* Detalle del horario */}
        <div className="space-y-3">
          {!selected ? (
            <Card>
              <EmptyState
                icon={<CalendarCheck className="h-6 w-6" />}
                title="Elige un horario"
                detail="Verás quién está apuntado y, si la clase usa bicicletas, el mapa del salón."
              />
            </Card>
          ) : (
            <>
              {/* Mapa de bicis */}
              {selected.usesBikeMap && bikes.data.length > 0 && (
                <Card>
                  <CardHeader
                    title="Mapa del salón"
                    subtitle={`${selected.className} · ${fmt12h(selected.time)}`}
                    icon={<Bike className="h-4 w-4" />}
                  />
                  <CardBody>
                    <BikeMap
                      bikes={bikes.data}
                      reservations={activeSlotReservations}
                      layout={settings?.spinning ?? { rows: 4, cols: 5, instructorAt: 'top', aisles: [] }}
                      selectedBikeId={null}
                      onSelect={() => undefined}
                    />
                  </CardBody>
                </Card>
              )}

              {/* Lista de reservados */}
              <Card>
                <CardHeader
                  title="Lista de la clase"
                  subtitle={`${activeSlotReservations.length} de ${selected.capacity} lugares`}
                  icon={<Users className="h-4 w-4" />}
                  action={
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={selected.full}
                      onClick={() => setAddOpen(true)}
                    >
                      {selected.full ? 'Clase llena' : 'Apuntar socio'}
                    </Button>
                  }
                />
                <CardBody>
                  {activeSlotReservations.length === 0 ? (
                    <p className="py-8 text-center text-[13px] text-ink-500">
                      Todavía no hay nadie apuntado en este horario.
                    </p>
                  ) : (
                    <ul className="divide-y divide-white/[.05]">
                      {activeSlotReservations.map((r) => {
                        const check = canCancel(r, settings)
                        return (
                          <li key={r.id} className="flex items-center gap-3 py-2.5">
                            <Avatar name={r.memberName} size={32} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13.5px] font-medium text-ink-100">{r.memberName}</p>
                              <p className="text-[11px] text-ink-500">
                                {r.bikeNumber != null
                                  ? `Bicicleta ${String(r.bikeNumber).padStart(2, '0')}`
                                  : 'Sin bicicleta asignada'}
                              </p>
                            </div>
                            {r.status === 'ATTENDED' && <Badge tone="tap">Asistió</Badge>}
                            {r.status === 'NO_SHOW' && <Badge tone="warn">No asistió</Badge>}
                            {r.status === 'CONFIRMED' && (
                              <button
                                onClick={() => doCancel(r, !check.allowed)}
                                title={check.allowed ? 'Cancelar' : `Fuera de periodo — ${check.message}`}
                                className={cx(
                                  'rounded-lg p-1.5 transition',
                                  check.allowed
                                    ? 'text-ink-500 hover:bg-white/5 hover:text-danger-400'
                                    : 'text-warn-500/70 hover:bg-warn-500/10',
                                )}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Apuntar socio */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Apuntar a un socio"
        description={selected ? `${selected.className} · ${fmtDayKey(selected.date)} · ${fmt12h(selected.time)}` : ''}
        size="md"
      >
        <MemberPicker
          onPick={async (m) => {
            if (!repo || !selected || !cls) return
            try {
              // El staff apunta en la recepción: se elige la primera bici libre.
              let bikeId: string | null = null
              if (cls.usesBikeMap) {
                const taken = new Set(activeSlotReservations.map((r) => r.bikeId))
                const free = bikes.data.find((b) => b.status === 'AVAILABLE' && !taken.has(b.id))
                bikeId = free?.id ?? null
              }
              await reserveSlot(repo, {
                member: m,
                cls,
                date: selected.date,
                time: selected.time,
                bikeId,
                settings,
              })
              toast.success('Reservación creada', `${m.name} · ${selected.className}`)
              setAddOpen(false)
            } catch (err) {
              toast.error('No se pudo reservar', reportError('crear reservación', err).message)
            }
          }}
        />
      </Modal>
    </div>
  )
}
