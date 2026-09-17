import { useMemo, useState } from 'react'
import { Bike, CalendarDays, Check, Clock } from 'lucide-react'
import type { Bike as BikeDoc, GymClass } from '@/types'
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
import { addDays, combine, dayKey, fmt12h, fmtDayKey, WEEKDAYS_SHORT } from '@/lib/date'
import { cx } from '@/lib/utils'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge, EmptyState, LoadingBlock, Progress } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { BikeMap } from '@/components/BikeMap'
import { UpgradeNotice } from '@/components/PlanGuard'

// ═══════════════════════════════════════════════════════════════════════════
// Reservación desde el celular del socio.
//
// Flujo: elegir día → elegir horario → (si es spinning) elegir bicicleta en
// el mapa → confirmar. La transacción del servidor garantiza que dos socios
// no se queden con la misma bici ni se rebase el cupo.
// ═══════════════════════════════════════════════════════════════════════════

export default function PortalReservations() {
  const { repo, member, settings, hasFeature } = useSession()
  const toast = useToast()

  const [date, setDate] = useState(() => dayKey())
  const [slot, setSlot] = useState<Slot | null>(null)
  const [bikeId, setBikeId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const classes = useCollection('classes')
  const bikes = useCollection('bikes')

  // Dos consultas acotadas en lugar de una sin filtro. El portal se usa desde
  // el móvil con datos móviles: descargar el histórico de reservaciones del
  // gimnasio para enseñar la agenda de mañana no es aceptable ahí.
  //
  // 1) Las del día que se está viendo — para saber cuánto cupo queda.
  const dayReservations = useCollection(
    'reservations',
    useMemo(() => ({ where: [{ field: 'date', op: '==' as const, value: date }] }), [date]),
  )

  // 2) Las MÍAS de hoy en adelante — para la lista «tus reservaciones».
  const myReservations = useCollection(
    'reservations',
    useMemo(
      () => ({
        where: [
          { field: 'memberId', op: '==' as const, value: member?.id ?? '' },
          { field: 'date', op: '>=' as const, value: dayKey() },
        ],
        limit: 30,
      }),
      [member?.id],
    ),
    { enabled: Boolean(member?.id) },
  )

  const slots = useMemo(
    () => buildSlots(classes.data, dayReservations.data, date),
    [classes.data, dayReservations.data, date],
  )

  const mine = useMemo(
    () =>
      myReservations.data
        .filter((r) => r.status === 'CONFIRMED')
        .filter((r) => combine(r.date, r.time) >= Date.now() - 3_600_000)
        .sort((a, b) => combine(a.date, a.time) - combine(b.date, b.time)),
    [myReservations.data],
  )

  const slotReservations = useMemo(() => {
    if (!slot) return []
    return dayReservations.data.filter(
      (r) => r.classId === slot.classId && r.time === slot.time && r.status !== 'CANCELLED',
    )
  }, [dayReservations.data, slot])

  const cls: GymClass | null = classes.data.find((c) => c.id === slot?.classId) ?? null

  // Los próximos 7 días son los que se pueden reservar desde el móvil.
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => dayKey(addDays(Date.now(), i))),
    [],
  )

  if (!hasFeature('reservations')) {
    return <UpgradeNotice feature="reservations" title="Tu gimnasio todavía no tiene" />
  }
  if (!member) return <LoadingBlock />

  async function confirm() {
    if (!repo || !member || !slot || !cls) return
    setBusy(true)
    try {
      await reserveSlot(repo, {
        member,
        cls,
        date: slot.date,
        time: slot.time,
        bikeId,
        settings,
      })
      toast.success('¡Lugar apartado!', `${slot.className} · ${fmtDayKey(slot.date)} · ${fmt12h(slot.time)}`)
      setSlot(null)
      setBikeId(null)
    } catch (err) {
      toast.error('No se pudo reservar', reportError('reservar desde el portal', err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Mis reservaciones */}
      {mine.length > 0 && (
        <Card lit>
          <CardHeader title="Tus reservaciones" subtitle={`${mine.length} próximas`} icon={<Check className="h-4 w-4" />} />
          <CardBody>
            <ul className="space-y-2">
              {mine.map((r) => {
                const check = canCancel(r, settings)
                return (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 rounded-xl border border-white/[.06] bg-ink-950/40 p-3.5"
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gym/12 text-gym">
                      {r.bikeNumber != null ? <Bike className="h-5 w-5" /> : <CalendarDays className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-ink-100">{r.className}</p>
                      <p className="truncate text-[12px] text-ink-500">
                        {fmtDayKey(r.date)} · {fmt12h(r.time)}
                        {r.bikeNumber != null && ` · Bici ${String(r.bikeNumber).padStart(2, '0')}`}
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        if (!repo) return
                        if (!check.allowed) {
                          toast.warning('No se puede cancelar', check.message)
                          return
                        }
                        try {
                          await cancelReservation(repo, r, settings)
                          toast.info('Reservación cancelada', 'Tu lugar quedó libre.')
                        } catch (err) {
                          toast.error(
                            'No se pudo cancelar',
                            reportError('cancelar desde el portal', err).message,
                          )
                        }
                      }}
                      className={cx(
                        'shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition',
                        check.allowed
                          ? 'text-danger-300 hover:bg-danger-500/10'
                          : 'text-ink-600 hover:bg-white/5',
                      )}
                    >
                      Cancelar
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-ink-500">
              <Clock className="h-3 w-3" />
              Puedes cancelar hasta {cancellationWindowLabel(settings?.cancellationWindowMin ?? 120)}.
            </p>
          </CardBody>
        </Card>
      )}

      {/* Selector de día */}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {days.map((d) => {
          const dt = new Date(d + 'T00:00:00')
          const active = d === date
          return (
            <button
              key={d}
              onClick={() => {
                setDate(d)
                setSlot(null)
              }}
              className={cx(
                'flex w-[62px] shrink-0 flex-col items-center gap-1 rounded-2xl border py-3 transition-all duration-200',
                active
                  ? 'border-gym/45 bg-gym/[.1] text-gym'
                  : 'border-white/[.07] bg-ink-900/60 text-ink-400 hover:border-white/[.16]',
              )}
            >
              <span className="text-[10.5px] font-medium uppercase">
                {WEEKDAYS_SHORT[dt.getDay() as 0]}
              </span>
              <span className="text-[19px] font-bold leading-none tnum">{dt.getDate()}</span>
            </button>
          )
        })}
      </div>

      {/* Horarios */}
      <Card>
        <CardHeader title="Horarios disponibles" subtitle={fmtDayKey(date)} icon={<CalendarDays className="h-4 w-4" />} />
        <CardBody className="space-y-2">
          {slots.length === 0 ? (
            <EmptyState title="No hay clases este día" detail="Prueba con otro día de la semana." />
          ) : (
            slots.map((s) => {
              const alreadyMine = dayReservations.data.some(
                (r) =>
                  r.memberId === member.id &&
                  r.classId === s.classId &&
                  r.time === s.time &&
                  r.status !== 'CANCELLED',
              )
              const disabled = s.full || s.past || alreadyMine
              return (
                <button
                  key={`${s.classId}-${s.time}`}
                  disabled={disabled}
                  onClick={() => {
                    setSlot(s)
                    setBikeId(null)
                  }}
                  className={cx(
                    'w-full rounded-xl border p-3.5 text-left transition-all duration-200',
                    disabled
                      ? 'cursor-not-allowed border-white/[.05] bg-white/[.01] opacity-60'
                      : 'border-white/[.07] bg-white/[.02] hover:-translate-y-0.5 hover:border-gym/35 hover:bg-gym/[.05]',
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
                      <p className="truncate text-[11.5px] text-ink-500">{s.instructor}</p>
                    </div>
                    {alreadyMine ? (
                      <Badge tone="gym" dot>
                        Reservada
                      </Badge>
                    ) : s.past ? (
                      <Badge tone="neutral">Ya pasó</Badge>
                    ) : s.full ? (
                      <Badge tone="danger">CLASE LLENA</Badge>
                    ) : (
                      <span className="shrink-0 text-right">
                        <span className="block text-[14px] font-bold text-ink-50 tnum">{s.free}</span>
                        <span className="text-[10px] text-ink-500">libres</span>
                      </span>
                    )}
                  </div>
                  <Progress
                    className="mt-2.5"
                    value={s.taken}
                    max={s.capacity}
                    tone={s.full ? 'danger' : s.taken / s.capacity > 0.8 ? 'warn' : 'gym'}
                  />
                </button>
              )
            })
          )}
        </CardBody>
      </Card>

      {/* Confirmación */}
      <Modal
        open={slot !== null}
        onClose={() => setSlot(null)}
        title={slot ? slot.className : ''}
        description={slot ? `${fmtDayKey(slot.date)} · ${fmt12h(slot.time)} · ${slot.instructor}` : ''}
        size={slot?.usesBikeMap ? 'lg' : 'sm'}
        footer={
          <>
            <Button variant="subtle" onClick={() => setSlot(null)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="lg"
              loading={busy}
              disabled={Boolean(slot?.usesBikeMap && !bikeId)}
              onClick={confirm}
            >
              {slot?.usesBikeMap && !bikeId ? 'Elige tu bicicleta' : 'Confirmar reservación'}
            </Button>
          </>
        }
      >
        {slot?.usesBikeMap ? (
          bikes.data.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-500">
              Este gimnasio todavía no configuró su salón de bicicletas.
            </p>
          ) : (
            <>
              <p className="mb-4 text-center text-[13px] text-ink-400">
                Elige tu bicicleta. Las rojas ya están apartadas.
              </p>
              <BikeMap
                bikes={bikes.data}
                reservations={slotReservations}
                layout={settings?.spinning ?? { rows: 4, cols: 5, instructorAt: 'top', aisles: [] }}
                selectedBikeId={bikeId}
                onSelect={(b: BikeDoc) => setBikeId(bikeId === b.id ? null : b.id)}
                myMemberId={member.id}
              />
              {bikeId && (
                <p className="mt-4 rounded-xl border border-gym/25 bg-gym/[.08] px-4 py-3 text-center text-[13.5px] text-gym">
                  Bicicleta{' '}
                  <b className="tnum">
                    {String(bikes.data.find((b) => b.id === bikeId)?.number ?? 0).padStart(2, '0')}
                  </b>{' '}
                  seleccionada
                </p>
              )}
            </>
          )
        ) : (
          <div className="space-y-3">
            <p className="text-[13.5px] leading-relaxed text-ink-300">
              Vas a apartar tu lugar en <b className="text-ink-50">{slot?.className}</b>.
            </p>
            <div className="rounded-xl border border-white/[.07] bg-ink-950/40 p-4">
              <p className="text-[12.5px] text-ink-400">
                Quedan <b className="text-ink-100 tnum">{slot?.free}</b> de{' '}
                <span className="tnum">{slot?.capacity}</span> lugares.
              </p>
              <p className="mt-1.5 text-[11.5px] text-ink-500">
                Podrás cancelar hasta {cancellationWindowLabel(settings?.cancellationWindowMin ?? 120)}.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
