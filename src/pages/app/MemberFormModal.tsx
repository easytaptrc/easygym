import { useEffect, useState } from 'react'
import type { Member, MembershipPlan, PaymentMethod } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useToast } from '@/hooks/useToast'
import { createMember, updateMember } from '@/services/members'
import { PAYMENT_METHOD_LABEL } from '@/services/billing'
import { getPlan, memberLimitReached } from '@/config/plans'
import { money0 } from '@/lib/format'
import { reportError } from '@/lib/errors'
import { cx } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea, Toggle } from '@/components/ui/Inputs'
import { completeOnboardingStep } from './OnboardingChecklist'

// Alta y edición de socios. Al dar de alta se puede contratar la membresía y
// cobrarla en el mismo paso: es exactamente lo que pasa en el mostrador.

interface Props {
  open: boolean
  onClose: () => void
  /** Si viene, el modal edita en lugar de crear. */
  member?: Member | null
  plans: MembershipPlan[]
  currentMemberCount: number
  onSaved?: (member: Member) => void
}

const EMPTY = {
  name: '',
  email: '',
  phone: '',
  birthDate: '',
  gender: '' as '' | 'M' | 'F' | 'X',
  notes: '',
  emergencyName: '',
  emergencyPhone: '',
  membershipPlanId: '',
  paymentMethod: 'cash' as PaymentMethod,
}

export function MemberFormModal({ open, onClose, member, plans, currentMemberCount, onSaved }: Props) {
  const { repo, gym, user, settings } = useSession()
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [charge, setCharge] = useState(true)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const editing = Boolean(member)

  useEffect(() => {
    if (!open) return
    setErrors({})
    if (member) {
      setForm({
        name: member.name,
        email: member.email,
        phone: member.phone,
        birthDate: member.birthDate ?? '',
        gender: member.gender ?? '',
        notes: member.notes ?? '',
        emergencyName: member.emergencyContact?.name ?? '',
        emergencyPhone: member.emergencyContact?.phone ?? '',
        membershipPlanId: member.membershipPlanId ?? '',
        paymentMethod: 'cash',
      })
    } else {
      setForm({ ...EMPTY, membershipPlanId: plans.find((p) => p.duration === 'MONTHLY')?.id ?? '' })
    }
  }, [open, member, plans])

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))

  const selectedPlan = plans.find((p) => p.id === form.membershipPlanId)
  const limitHit = gym ? memberLimitReached(gym, currentMemberCount) : false

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (form.name.trim().length < 3) e.name = 'Escribe el nombre completo.'
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) e.email = 'Correo no válido.'
    if (form.phone.replace(/\D/g, '').length < 10) e.phone = 'Necesitamos 10 dígitos.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
    if (!repo || !validate()) return
    setBusy(true)
    try {
      if (member) {
        // Pasa por el servicio para que la edición quede en la bitácora y
        // para que el nombre y su clave de búsqueda no puedan separarse.
        await updateMember(repo, member.id, {
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone,
          birthDate: form.birthDate || null,
          gender: form.gender || null,
          notes: form.notes,
          emergencyContact: form.emergencyName
            ? { name: form.emergencyName, phone: form.emergencyPhone }
            : null,
        })
        toast.success('Socio actualizado', form.name)
        onSaved?.({ ...member, name: form.name })
      } else {
        if (limitHit) {
          toast.error(
            'Llegaste al límite de tu plan',
            `El plan ${getPlan(gym?.planId).name} permite ${getPlan(gym?.planId).maxMembers} socios.`,
          )
          setBusy(false)
          return
        }
        const { member: created } = await createMember(repo, {
          name: form.name,
          email: form.email,
          phone: form.phone,
          birthDate: form.birthDate || null,
          gender: form.gender || null,
          notes: form.notes,
          emergencyContact: form.emergencyName
            ? { name: form.emergencyName, phone: form.emergencyPhone }
            : null,
          membershipPlanId: form.membershipPlanId || null,
          paymentMethod: form.paymentMethod,
          skipPayment: !charge,
          collectedBy: user?.uid ?? null,
        })
        await completeOnboardingStep(gym, 'firstMember')
        toast.success(
          '¡Socio registrado!',
          selectedPlan && charge
            ? `${created.name} · ${selectedPlan.name} · ${money0(selectedPlan.price)} cobrados`
            : created.name,
        )
        onSaved?.(created)
      }
      onClose()
    } catch (err) {
      // Nunca se enseña el error crudo del SDK: «FirebaseError:
      // PERMISSION_DENIED» no le dice nada a quien está en el mostrador.
      const friendly = reportError('guardar socio', err)
      toast.error('No se pudo guardar', friendly.message)
    } finally {
      setBusy(false)
    }
  }

  const methods = settings?.payments.methods ?? (['cash', 'card', 'transfer'] as PaymentMethod[])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar socio' : 'Nuevo socio'}
      description={
        editing
          ? 'Los datos de contacto se actualizan al instante.'
          : 'Da de alta al socio y, si quieres, contrata y cobra su membresía aquí mismo.'
      }
      size="lg"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            {editing ? 'Guardar cambios' : 'Registrar socio'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Nombre completo"
          required
          value={form.name}
          onChange={set('name')}
          error={errors.name}
          placeholder="Valeria Ortiz Campos"
          containerClassName="sm:col-span-2"
        />
        <Input
          label="Teléfono"
          required
          type="tel"
          value={form.phone}
          onChange={set('phone')}
          error={errors.phone}
          placeholder="33 1234 5678"
        />
        <Input
          label="Correo electrónico"
          type="email"
          value={form.email}
          onChange={set('email')}
          error={errors.email}
          placeholder="socio@correo.com"
        />
        <Input label="Fecha de nacimiento" type="date" value={form.birthDate} onChange={set('birthDate')} />
        <Select label="Género" value={form.gender} onChange={set('gender')}>
          <option value="">Prefiero no decirlo</option>
          <option value="F">Femenino</option>
          <option value="M">Masculino</option>
          <option value="X">Otro</option>
        </Select>
        <Input
          label="Contacto de emergencia"
          value={form.emergencyName}
          onChange={set('emergencyName')}
          placeholder="Nombre"
        />
        <Input
          label="Teléfono de emergencia"
          type="tel"
          value={form.emergencyPhone}
          onChange={set('emergencyPhone')}
          placeholder="33 0000 0000"
        />
        <Textarea
          label="Notas"
          value={form.notes}
          onChange={set('notes')}
          placeholder="Lesiones, objetivos, observaciones…"
          containerClassName="sm:col-span-2"
          rows={2}
        />
      </div>

      {!editing && (
        <div className="mt-5 rounded-xl border border-white/[.07] bg-ink-950/40 p-4">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-[.16em] text-ink-500">
            Membresía
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Plan" value={form.membershipPlanId} onChange={set('membershipPlanId')}>
              <option value="">Sin membresía por ahora</option>
              {plans
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {money0(p.price)} · {p.days} días
                  </option>
                ))}
            </Select>
            <Select
              label="Método de pago"
              value={form.paymentMethod}
              onChange={set('paymentMethod')}
              disabled={!form.membershipPlanId || !charge}
            >
              {methods.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          </div>

          {form.membershipPlanId && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <Toggle
                checked={charge}
                onChange={setCharge}
                label="Registrar el cobro"
                description="Desactívalo si es una cortesía o si ya pagó por otro medio."
              />
              {selectedPlan && (
                <span
                  className={cx(
                    'rounded-xl px-3 py-2 text-[18px] font-bold tnum',
                    charge ? 'bg-gym/10 text-gym' : 'bg-white/[.04] text-ink-500 line-through',
                  )}
                >
                  {money0(selectedPlan.price)}
                </span>
              )}
            </div>
          )}

          {limitHit && (
            <p className="mt-3 rounded-lg border border-warn-500/25 bg-warn-500/10 px-3 py-2 text-[12.5px] text-warn-200">
              Tu plan {getPlan(gym?.planId).name} llegó a su tope de socios. Cambia de plan para seguir
              dando de alta.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
