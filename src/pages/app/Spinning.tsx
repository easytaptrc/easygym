import { useMemo, useState } from 'react'
import { Bike, LayoutGrid, RotateCcw, Save, Wrench } from 'lucide-react'
import type { Bike as BikeDoc, SpinningLayout } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { useToast } from '@/hooks/useToast'
import { audit } from '@/services/audit'
import { platform } from '@/services/db'
import { buildSlots, generateBikeLayout } from '@/services/reservations'
import { dayKey, fmt12h } from '@/lib/date'
import { cx } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge, EmptyState } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/Modal'
import { Input, Segmented, Select } from '@/components/ui/Inputs'
import { BikeMap } from '@/components/BikeMap'
import { completeOnboardingStep } from './OnboardingChecklist'

// ═══════════════════════════════════════════════════════════════════════════
// Salón de spinning: configuración del layout y vista en vivo de ocupación.
//
// El dueño define filas, columnas, numeración, pasillos y dónde está el
// instructor. Puede bloquear bicicletas concretas (rotas o en mantenimiento):
// una bici bloqueada desaparece del mapa para los socios.
// ═══════════════════════════════════════════════════════════════════════════

type Mode = 'layout' | 'live'

export default function Spinning() {
  const { repo, gym, settings } = useSession()
  const toast = useToast()

  const [mode, setMode] = useState<Mode>('layout')
  const [rows, setRows] = useState(settings?.spinning.rows ?? 4)
  const [cols, setCols] = useState(settings?.spinning.cols ?? 5)
  const [instructorAt, setInstructorAt] = useState<'top' | 'bottom'>(settings?.spinning.instructorAt ?? 'top')
  const [regenOpen, setRegenOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const [date, setDate] = useState(() => dayKey())
  const [slotKey, setSlotKey] = useState<string>('')

  const bikes = useCollection('bikes')
  const classes = useCollection('classes')
  // Solo las reservaciones del día que se está viendo. Traerlas todas
  // funcionaba con la demo y se habría caído sola al segundo año de uso: un
  // salón de 30 bicis con 6 clases diarias son ~65 000 documentos al año.
  const reservations = useCollection(
    'reservations',
    useMemo(() => ({ where: [{ field: 'date', op: '==' as const, value: date }] }), [date]),
  )

  const layout: SpinningLayout = useMemo(
    () => ({ rows, cols, instructorAt, aisles: settings?.spinning.aisles ?? [] }),
    [rows, cols, instructorAt, settings],
  )

  const bikeClasses = useMemo(() => classes.data.filter((c) => c.usesBikeMap && c.active), [classes.data])
  const slots = useMemo(
    () => buildSlots(bikeClasses, reservations.data, date),
    [bikeClasses, reservations.data, date],
  )
  const activeSlot = slots.find((s) => `${s.classId}|${s.time}` === slotKey) ?? slots[0] ?? null

  const slotReservations = useMemo(() => {
    if (!activeSlot) return []
    return reservations.data.filter(
      (r) =>
        r.classId === activeSlot.classId &&
        r.date === activeSlot.date &&
        r.time === activeSlot.time &&
        r.status !== 'CANCELLED',
    )
  }, [reservations.data, activeSlot])

  const stats = useMemo(() => {
    const available = bikes.data.filter((b) => b.status === 'AVAILABLE').length
    const blocked = bikes.data.filter((b) => b.status === 'BLOCKED').length
    const maintenance = bikes.data.filter((b) => b.status === 'MAINTENANCE').length
    return { total: bikes.data.length, available, blocked, maintenance }
  }, [bikes.data])

  async function saveLayout() {
    if (!repo || !gym) return
    setBusy(true)
    try {
      await platform.update('settings', gym.id, {
        spinning: layout,
        updatedAt: Date.now(),
      })
      await completeOnboardingStep(gym, 'spinning')
      toast.success('Distribución guardada', `${rows} filas × ${cols} columnas`)
    } finally {
      setBusy(false)
    }
  }

  async function regenerateBikes() {
    if (!repo) return
    setBusy(true)
    try {
      const before = bikes.data.length
      for (const b of bikes.data) await repo.remove('bikes', b.id)
      for (const b of generateBikeLayout(rows, cols)) await repo.create('bikes', b)
      await saveLayout()
      audit({
        gymId: repo.gymId,
        action: 'BIKES_REGENERATED',
        entityType: 'bikes',
        summary: `Salón regenerado: ${rows} × ${cols} (${rows * cols} bicicletas)`,
        before: { bicicletas: before },
        after: { filas: rows, columnas: cols, bicicletas: rows * cols },
      })
      toast.success('Salón regenerado', `${rows * cols} bicicletas numeradas`)
      setRegenOpen(false)
    } finally {
      setBusy(false)
    }
  }

  async function cycleBikeStatus(bike: BikeDoc) {
    if (!repo) return
    const next: BikeDoc['status'] =
      bike.status === 'AVAILABLE' ? 'MAINTENANCE' : bike.status === 'MAINTENANCE' ? 'BLOCKED' : 'AVAILABLE'
    await repo.update('bikes', bike.id, { status: next })
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Spinning"
        description="Arma el salón como se ve en la realidad: filas, columnas, numeración y bicicletas fuera de servicio."
        actions={
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'layout', label: 'Configurar', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
              { value: 'live', label: 'Ocupación', icon: <Bike className="h-3.5 w-3.5" /> },
            ]}
          />
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { label: 'Bicicletas', value: stats.total, tone: 'text-ink-50' },
          { label: 'Disponibles', value: stats.available, tone: 'text-tap-400' },
          { label: 'Mantenimiento', value: stats.maintenance, tone: 'text-warn-400' },
          { label: 'Bloqueadas', value: stats.blocked, tone: 'text-ink-500' },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-[11.5px] text-ink-400">{s.label}</p>
            <p className={cx('mt-1.5 text-[24px] font-bold tnum', s.tone)}>{s.value}</p>
          </Card>
        ))}
      </div>

      {mode === 'layout' ? (
        <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
          <Card className="h-fit">
            <CardHeader title="Distribución del salón" icon={<LayoutGrid className="h-4 w-4" />} />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Filas"
                  type="number"
                  min={1}
                  max={12}
                  value={rows}
                  onChange={(e) => setRows(Math.max(1, Math.min(12, Number(e.target.value))))}
                />
                <Input
                  label="Columnas"
                  type="number"
                  min={1}
                  max={12}
                  value={cols}
                  onChange={(e) => setCols(Math.max(1, Math.min(12, Number(e.target.value))))}
                />
              </div>

              <Select
                label="Posición del instructor"
                value={instructorAt}
                onChange={(e) => setInstructorAt(e.target.value as 'top' | 'bottom')}
              >
                <option value="top">Al frente (arriba)</option>
                <option value="bottom">Al fondo (abajo)</option>
              </Select>

              <div className="rounded-xl border border-white/[.07] bg-ink-950/40 p-3.5">
                <p className="text-[12.5px] font-medium text-ink-200">
                  {rows * cols} bicicletas
                </p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
                  Regenerar borra las bicicletas actuales y las vuelve a numerar del 1 al {rows * cols}.
                  Las reservaciones existentes quedan sin bicicleta asignada.
                </p>
              </div>

              <div className="space-y-2">
                <Button variant="primary" block loading={busy} icon={<Save className="h-4 w-4" />} onClick={saveLayout}>
                  Guardar distribución
                </Button>
                <Button
                  variant="ghost"
                  block
                  icon={<RotateCcw className="h-4 w-4" />}
                  onClick={() => setRegenOpen(true)}
                >
                  Regenerar bicicletas
                </Button>
              </div>

              <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-500">
                <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Toca una bicicleta en el mapa para cambiar su estado: disponible → mantenimiento →
                bloqueada.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Vista del salón"
              subtitle="Así lo verán tus socios al reservar"
              icon={<Bike className="h-4 w-4" />}
            />
            <CardBody>
              {bikes.data.length === 0 ? (
                <EmptyState
                  icon={<Bike className="h-6 w-6" />}
                  title="Todavía no hay bicicletas"
                  detail={`Define filas y columnas y genera tu salón de ${rows} × ${cols}.`}
                  action={
                    <Button variant="primary" icon={<Bike className="h-4 w-4" />} onClick={() => setRegenOpen(true)}>
                      Generar {rows * cols} bicicletas
                    </Button>
                  }
                />
              ) : (
                <BikeMap
                  bikes={bikes.data}
                  reservations={[]}
                  layout={layout}
                  selectedBikeId={null}
                  onSelect={cycleBikeStatus}
                  editable
                />
              )}
            </CardBody>
          </Card>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
          <Card className="h-fit">
            <CardHeader title="Horario" subtitle="Elige la sesión que quieres revisar" />
            <CardBody className="space-y-3">
              <Input type="date" label="Día" value={date} onChange={(e) => setDate(e.target.value)} />
              {slots.length === 0 ? (
                <p className="py-4 text-center text-[13px] text-ink-500">
                  No hay clases con bicicletas este día.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {slots.map((s) => {
                    const key = `${s.classId}|${s.time}`
                    const active = activeSlot && `${activeSlot.classId}|${activeSlot.time}` === key
                    return (
                      <li key={key}>
                        <button
                          onClick={() => setSlotKey(key)}
                          className={cx(
                            'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition',
                            active
                              ? 'border-gym/45 bg-gym/[.08]'
                              : 'border-white/[.07] bg-white/[.02] hover:border-white/[.16]',
                          )}
                        >
                          <span className="shrink-0 font-mono text-[12px] font-semibold text-ink-100">
                            {fmt12h(s.time)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-300">
                            {s.className}
                          </span>
                          {s.full ? (
                            <Badge tone="danger">Llena</Badge>
                          ) : (
                            <span className="text-[11.5px] text-ink-500 tnum">{s.free} libres</span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={activeSlot ? `${activeSlot.className} · ${fmt12h(activeSlot.time)}` : 'Ocupación'}
              subtitle={
                activeSlot
                  ? `${slotReservations.length} de ${activeSlot.capacity} bicicletas ocupadas`
                  : undefined
              }
              icon={<Bike className="h-4 w-4" />}
            />
            <CardBody>
              {!activeSlot ? (
                <EmptyState title="Elige un horario para ver su mapa" />
              ) : (
                <BikeMap
                  bikes={bikes.data}
                  reservations={slotReservations}
                  layout={settings?.spinning ?? layout}
                  selectedBikeId={null}
                  onSelect={() => undefined}
                />
              )}
            </CardBody>
          </Card>
        </div>
      )}

      <ConfirmModal
        open={regenOpen}
        onClose={() => setRegenOpen(false)}
        title="¿Regenerar el salón?"
        message={`Se borrarán las ${bikes.data.length} bicicletas actuales y se crearán ${rows * cols} nuevas, numeradas del 1 al ${rows * cols}. Las reservaciones ya hechas perderán su bicicleta asignada.`}
        confirmLabel={`Generar ${rows * cols} bicicletas`}
        tone="primary"
        loading={busy}
        onConfirm={regenerateBikes}
      />
    </div>
  )
}
