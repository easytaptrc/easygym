import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck, Pencil, Plus, Trash2, Users } from 'lucide-react'
import type { MembershipDuration, MembershipPlan } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { useCounts } from '@/hooks/useCounts'
import { useToast } from '@/hooks/useToast'
import { syncPublicGymQuietly } from '@/services/publicGym'
import { audit } from '@/services/audit'
import { money, money0 } from '@/lib/format'
import { reportError } from '@/lib/errors'
import { cx } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge, EmptyState } from '@/components/ui/Feedback'
import { Button, IconButton } from '@/components/ui/Button'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea, Toggle } from '@/components/ui/Inputs'
import { completeOnboardingStep } from './OnboardingChecklist'

// Catálogo de membresías del gimnasio. Nada está escrito a fuego: el dueño
// crea las duraciones y precios que quiera.

const DURATIONS: Array<{ value: MembershipDuration; label: string; days: number }> = [
  { value: 'DAILY', label: 'Diaria', days: 1 },
  { value: 'WEEKLY', label: 'Semanal', days: 7 },
  { value: 'MONTHLY', label: 'Mensual', days: 30 },
  { value: 'QUARTERLY', label: 'Trimestral', days: 90 },
  { value: 'BIANNUAL', label: 'Semestral', days: 180 },
  { value: 'ANNUAL', label: 'Anual', days: 365 },
]

export default function Memberships() {
  const { repo, gym } = useSession()
  const toast = useToast()
  const plans = useCollection('membershipPlans')

  const [editing, setEditing] = useState<MembershipPlan | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<MembershipPlan | null>(null)

  const sorted = useMemo(() => [...plans.data].sort((a, b) => a.days - b.days), [plans.data])

  // Cuántos socios tiene cada membresía, contado en el servidor. La versión
  // anterior se descargaba la colección `members` completa para hacer un
  // `filter().length` por tarjeta.
  const planIds = useMemo(() => sorted.map((p) => p.id).join(','), [sorted])
  const { counts } = useCounts(
    'members',
    useMemo(
      () =>
        Object.fromEntries(
          sorted.map((p) => [p.id, { where: [{ field: 'membershipPlanId', op: '==' as const, value: p.id }] }]),
        ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [planIds],
    ),
    [planIds],
  )
  const countFor = (planId: string) => counts[planId] ?? 0

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Membresías"
        description="Define tus planes: nombre, precio, duración y beneficios. Aparecen al dar de alta o renovar un socio."
        actions={
          <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
            Nueva membresía
          </Button>
        }
      />

      {sorted.length === 0 && !plans.loading ? (
        <Card>
          <EmptyState
            icon={<CalendarCheck className="h-6 w-6" />}
            title="Todavía no tienes membresías"
            detail="Crea al menos una para poder dar de alta socios. La más común es una mensual."
            action={
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                Crear membresía
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((p) => {
            const count = countFor(p.id)
            return (
              <Card key={p.id} hover lit={p.active} className={cx(!p.active && 'opacity-60')}>
                <CardBody className="pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-[17px] font-bold text-ink-50">{p.name}</h3>
                      <p className="mt-0.5 text-[12px] text-ink-500">
                        {DURATIONS.find((d) => d.value === p.duration)?.label} · {p.days} días
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <IconButton label="Editar" size="sm" onClick={() => setEditing(p)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton label="Eliminar" size="sm" onClick={() => setDeleting(p)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </div>

                  <p className="mt-3 text-[30px] font-bold leading-none text-gym tnum">{money0(p.price)}</p>
                  <p className="mt-1 text-[11.5px] text-ink-500">
                    {money((p.price / p.days) * 30)} al mes equivalente
                  </p>

                  {p.benefits.length > 0 && (
                    <ul className="mt-4 space-y-1.5">
                      {p.benefits.map((b) => (
                        <li key={b} className="flex items-start gap-2 text-[12.5px] text-ink-400">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gym" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[.06] pt-3">
                    <Badge tone="neutral">
                      <Users className="h-3 w-3" />
                      {count} {count === 1 ? 'socio' : 'socios'}
                    </Badge>
                    {p.allowsReservations && <Badge tone="cyber">Permite reservar</Badge>}
                    {!p.active && <Badge tone="danger">Inactiva</Badge>}
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      <PlanModal
        open={creating || editing !== null}
        plan={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSave={async (values) => {
          if (!repo) return
          try {
            if (editing) {
              await repo.update('membershipPlans', editing.id, values)
              audit({
                gymId: repo.gymId,
                action: 'MEMBERSHIP_PLAN_UPDATED',
                entityType: 'membershipPlans',
                entityId: editing.id,
                summary: `Edición de la membresía ${values.name}`,
                before: { precio: editing.price, días: editing.days, activa: editing.active },
                after: { precio: values.price, días: values.days, activa: values.active },
              })
              toast.success('Membresía actualizada', values.name)
            } else {
              const created = await repo.create('membershipPlans', { ...values, allowedClassIds: [] })
              await completeOnboardingStep(gym, 'firstMembership')
              audit({
                gymId: repo.gymId,
                action: 'MEMBERSHIP_PLAN_CREATED',
                entityType: 'membershipPlans',
                entityId: created.id,
                summary: `Membresía creada: ${values.name}`,
                after: { precio: values.price, días: values.days },
              })
              toast.success('Membresía creada', values.name)
            }
            // La lista de precios pública se reconstruye con cada cambio.
            if (gym) syncPublicGymQuietly(gym.id)
            setCreating(false)
            setEditing(null)
          } catch (err) {
            toast.error('No se pudo guardar la membresía', reportError('guardar membresía', err).message)
          }
        }}
      />

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="¿Eliminar esta membresía?"
        message={
          deleting && countFor(deleting.id) > 0
            ? `${countFor(deleting.id)} socios tienen esta membresía. En vez de borrarla, conviene desactivarla: así conservas el historial y deja de aparecer al dar de alta.`
            : 'Esta membresía dejará de aparecer al dar de alta o renovar socios.'
        }
        confirmLabel="Eliminar"
        onConfirm={async () => {
          if (!repo || !deleting) return
          await repo.remove('membershipPlans', deleting.id)
          if (gym) syncPublicGymQuietly(gym.id)
          audit({
            gymId: repo.gymId,
            action: 'MEMBERSHIP_PLAN_DELETED',
            entityType: 'membershipPlans',
            entityId: deleting.id,
            summary: `Membresía eliminada: ${deleting.name}`,
            before: { nombre: deleting.name, precio: deleting.price, días: deleting.days },
          })
          toast.info('Membresía eliminada', deleting.name)
          setDeleting(null)
        }}
      />
    </div>
  )
}

// ────────────────────────────── Modal ───────────────────────────────────────

interface PlanValues {
  name: string
  price: number
  duration: MembershipDuration
  days: number
  benefits: string[]
  active: boolean
  allowsReservations: boolean
}

function PlanModal({
  open,
  plan,
  onClose,
  onSave,
}: {
  open: boolean
  plan: MembershipPlan | null
  onClose: () => void
  onSave: (values: PlanValues) => Promise<void>
}) {
  const [values, setValues] = useState<PlanValues>({
    name: '',
    price: 500,
    duration: 'MONTHLY',
    days: 30,
    benefits: [],
    active: true,
    allowsReservations: true,
  })
  const [benefitsText, setBenefitsText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    if (plan) {
      setValues({
        name: plan.name,
        price: plan.price,
        duration: plan.duration,
        days: plan.days,
        benefits: plan.benefits,
        active: plan.active,
        allowsReservations: plan.allowsReservations,
      })
      setBenefitsText(plan.benefits.join('\n'))
    } else {
      setValues({
        name: '',
        price: 500,
        duration: 'MONTHLY',
        days: 30,
        benefits: [],
        active: true,
        allowsReservations: true,
      })
      setBenefitsText('Acceso ilimitado\nÁrea de pesas y cardio')
    }
  }, [open, plan])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={plan ? 'Editar membresía' : 'Nueva membresía'}
      description="La duración define cuántos días otorga. Puedes ajustarla a mano si tu gimnasio usa otra."
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!values.name.trim()}
            onClick={async () => {
              setBusy(true)
              try {
                await onSave({
                  ...values,
                  benefits: benefitsText
                    .split('\n')
                    .map((b) => b.trim())
                    .filter(Boolean),
                })
              } finally {
                setBusy(false)
              }
            }}
          >
            {plan ? 'Guardar' : 'Crear membresía'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Nombre"
          required
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          placeholder="Mensual"
          containerClassName="sm:col-span-2"
        />
        <Input
          label="Precio (MXN)"
          type="number"
          min={0}
          value={values.price}
          onChange={(e) => setValues((v) => ({ ...v, price: Number(e.target.value) }))}
          prefix="$"
        />
        <Select
          label="Duración"
          value={values.duration}
          onChange={(e) => {
            const d = DURATIONS.find((x) => x.value === e.target.value)
            if (d) setValues((v) => ({ ...v, duration: d.value, days: d.days }))
          }}
        >
          {DURATIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </Select>
        <Input
          label="Días que otorga"
          type="number"
          min={1}
          value={values.days}
          onChange={(e) => setValues((v) => ({ ...v, days: Number(e.target.value) }))}
          hint="Ajústalo si tu gimnasio cuenta los meses distinto"
          containerClassName="sm:col-span-2"
        />
        <Textarea
          label="Beneficios"
          value={benefitsText}
          onChange={(e) => setBenefitsText(e.target.value)}
          hint="Uno por línea. Se muestran al socio en su portal."
          rows={4}
          containerClassName="sm:col-span-2"
        />
      </div>

      <div className="mt-5 space-y-3.5 rounded-xl border border-white/[.07] bg-ink-950/40 p-4">
        <Toggle
          checked={values.active}
          onChange={(active) => setValues((v) => ({ ...v, active }))}
          label="Activa"
          description="Si la desactivas, deja de ofrecerse sin perder el historial."
        />
        <Toggle
          checked={values.allowsReservations}
          onChange={(allowsReservations) => setValues((v) => ({ ...v, allowsReservations }))}
          label="Permite reservar clases"
          description="Los socios con esta membresía pueden apartar lugar en clases y bicicletas."
        />
      </div>
    </Modal>
  )
}
