import { useState } from 'react'
import { Check, CreditCard, Lock, ShieldCheck } from 'lucide-react'
import type { MembershipPlan } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useToast } from '@/hooks/useToast'
import { contractMembership } from '@/services/members'
import { Stripe, StripeError, TEST_CARDS } from '@/services/stripe'
import { notify } from '@/services/notifications'
import { addDays, fmtDate } from '@/lib/date'
import { money, money0 } from '@/lib/format'
import { cx } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Inputs'
import { DetailRow } from '@/components/ui/Card'

// ═══════════════════════════════════════════════════════════════════════════
// Renovación desde el portal del socio.
//
// Flujo real (producción):
//   socio paga → Stripe → webhook → Cloud Function → Firestore →
//   se extiende la membresía → se actualiza el estado → nueva fecha
//
// El frontend NUNCA confirma un pago por su cuenta. Aquí se simula el paso
// del webhook con `contractMembership`, que es exactamente lo que la Cloud
// Function ejecutaría del lado servidor.
// ═══════════════════════════════════════════════════════════════════════════

export function RenewSheet({
  open,
  onClose,
  plans,
  currentPrice,
}: {
  open: boolean
  onClose: () => void
  plans: MembershipPlan[]
  currentPrice: number
}) {
  const { repo, member, gym, hasFeature } = useSession()
  const toast = useToast()

  const [planId, setPlanId] = useState<string>('')
  const [step, setStep] = useState<'plan' | 'pago' | 'listo'>('plan')
  const [card, setCard] = useState({ number: TEST_CARDS.success, exp: '12/29', cvc: '123' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = plans.find((p) => p.id === planId) ?? plans.find((p) => p.price === currentPrice) ?? plans[0]
  const canPayOnline = hasFeature('stripeAutoPayments')

  const newExpiry = selected
    ? addDays(
        member?.expiresAt && member.expiresAt > Date.now() ? member.expiresAt : Date.now(),
        selected.days,
      )
    : null

  async function pay() {
    if (!repo || !member || !selected) return
    setBusy(true)
    setError(null)
    try {
      // 1. El socio paga (esto sí ocurre en el cliente, con Stripe Elements).
      const intent = await Stripe.createPayment({
        amount: selected.price,
        description: `${selected.name} — ${gym?.name}`,
        card: { ...card, name: member.name },
      })

      // 2. [SERVIDOR] Lo que haría el webhook al recibir payment_intent.succeeded.
      await contractMembership(repo, {
        member,
        plan: selected,
        kind: member.expiresAt ? 'RENEWAL' : 'NEW',
        method: 'stripe',
        transactionId: intent.id,
      })

      await notify(repo, {
        kind: 'PAYMENT_CONFIRMED',
        memberId: member.id,
        context: { memberName: member.name, gymName: gym?.name ?? '', amount: selected.price },
      })

      setStep('listo')
      toast.success('¡Membresía renovada!', `Vigente hasta ${fmtDate(newExpiry)}`)
    } catch (err) {
      const msg = err instanceof StripeError ? err.message : 'No pudimos procesar el pago.'
      setError(msg)
      toast.error('El pago no se completó', msg)
    } finally {
      setBusy(false)
    }
  }

  function close() {
    onClose()
    setTimeout(() => {
      setStep('plan')
      setError(null)
    }, 250)
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={step === 'listo' ? '¡Listo!' : 'Renovar membresía'}
      description={step === 'plan' ? 'Elige el plan que quieres contratar.' : undefined}
      size="md"
      persistent={busy}
    >
      {/* Paso 1 — elegir plan */}
      {step === 'plan' && (
        <div className="space-y-2">
          {plans.map((p) => (
            <button
              key={p.id}
              onClick={() => setPlanId(p.id)}
              className={cx(
                'flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-all duration-200',
                selected?.id === p.id
                  ? 'border-gym/50 bg-gym/[.07] ring-1 ring-inset ring-gym/25'
                  : 'border-white/[.07] bg-white/[.02] hover:border-white/20',
              )}
            >
              <span
                className={cx(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
                  selected?.id === p.id ? 'border-gym bg-gym' : 'border-ink-600',
                )}
              >
                {selected?.id === p.id && <Check className="h-3 w-3 text-ink-950" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-ink-50">{p.name}</p>
                <p className="text-[12px] text-ink-500">{p.days} días de acceso</p>
                {p.benefits.length > 0 && (
                  <p className="mt-1 truncate text-[11.5px] text-ink-500">{p.benefits.join(' · ')}</p>
                )}
              </div>
              <span className="shrink-0 text-[19px] font-bold text-gym tnum">{money0(p.price)}</span>
            </button>
          ))}

          {newExpiry && member?.expiresAt && member.expiresAt > Date.now() && (
            <p className="rounded-xl border border-cyber-400/20 bg-cyber-400/[.07] px-3.5 py-3 text-[12.5px] leading-relaxed text-cyber-100">
              Tu membresía sigue vigente. Los días nuevos se <b>suman</b> a los que ya tienes: renovar
              antes no te quita nada.
            </p>
          )}

          <Button
            variant="primary"
            size="lg"
            block
            className="mt-2"
            disabled={!selected}
            onClick={() => (canPayOnline ? setStep('pago') : toast.info('Pasa a recepción', 'Este gimnasio cobra las renovaciones en el mostrador.'))}
          >
            {canPayOnline ? `Continuar · ${money0(selected?.price ?? 0)}` : 'Pagar en recepción'}
          </Button>

          {!canPayOnline && (
            <p className="text-center text-[11.5px] leading-relaxed text-ink-500">
              El pago en línea está disponible en los planes Pro y Business de tu gimnasio.
            </p>
          )}
        </div>
      )}

      {/* Paso 2 — pago */}
      {step === 'pago' && selected && (
        <div className="space-y-4">
          <div className="rounded-xl border border-white/[.07] bg-ink-950/50 p-4">
            <DetailRow label="Plan">{selected.name}</DetailRow>
            <DetailRow label="Duración">{selected.days} días</DetailRow>
            <DetailRow label="Nueva vigencia">
              <span className="text-gym">{fmtDate(newExpiry)}</span>
            </DetailRow>
            <div className="mt-2 flex items-baseline justify-between border-t border-white/[.07] pt-3">
              <span className="text-[13px] font-semibold text-ink-200">Total</span>
              <span className="text-[24px] font-bold text-gym tnum">{money(selected.price)}</span>
            </div>
          </div>

          <Input
            label="Número de tarjeta"
            value={card.number}
            onChange={(e) => setCard((c) => ({ ...c, number: e.target.value }))}
            prefix={<CreditCard className="h-4 w-4" />}
            inputMode="numeric"
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Vencimiento"
              value={card.exp}
              onChange={(e) => setCard((c) => ({ ...c, exp: e.target.value }))}
              placeholder="MM/AA"
            />
            <Input
              label="CVC"
              value={card.cvc}
              onChange={(e) => setCard((c) => ({ ...c, cvc: e.target.value }))}
              maxLength={4}
            />
          </div>

          <div className="rounded-xl border border-cyber-400/20 bg-cyber-400/[.06] p-3.5">
            <p className="flex items-center gap-2 text-[12px] font-semibold text-cyber-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Demostración — no se cobra nada
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                { label: 'Aprobar', value: TEST_CARDS.success },
                { label: 'Rechazar', value: TEST_CARDS.declined },
              ].map((t) => (
                <button
                  key={t.value}
                  onClick={() => setCard((c) => ({ ...c, number: t.value }))}
                  className="rounded-md bg-white/[.06] px-2 py-1 font-mono text-[11px] text-ink-200 transition hover:bg-white/[.12]"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded-xl border border-danger-500/30 bg-danger-500/10 px-3.5 py-2.5 text-[13px] text-danger-200">
              {error}
            </p>
          )}

          <Button variant="primary" size="lg" block loading={busy} onClick={pay}>
            Pagar {money0(selected.price)}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-[11.5px] text-ink-500">
            <Lock className="h-3 w-3" />
            Pago protegido por Stripe
          </p>
        </div>
      )}

      {/* Paso 3 — confirmación */}
      {step === 'listo' && (
        <div className="py-6 text-center">
          <div className="relative mx-auto grid h-20 w-20 place-items-center">
            <span className="absolute inset-0 animate-pulse-ring rounded-full bg-gym/25" />
            <span className="grid h-20 w-20 place-items-center rounded-full bg-gym/15 ring-2 ring-gym/40">
              <Check className="h-9 w-9 text-gym" />
            </span>
          </div>
          <p className="mt-5 text-[22px] font-bold text-ink-50">¡Membresía renovada!</p>
          <p className="mt-2 text-[14px] text-ink-400">
            Ya estás vigente hasta el <b className="text-gym">{fmtDate(newExpiry)}</b>
          </p>
          <Button variant="primary" size="lg" className="mt-6" onClick={close}>
            Volver al inicio
          </Button>
        </div>
      )}
    </Modal>
  )
}
