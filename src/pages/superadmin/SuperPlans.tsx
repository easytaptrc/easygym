import { useMemo, useState, type ReactNode } from 'react'
import { Check, Infinity as InfinityIcon, Pencil, RefreshCw, Users, Building2, UserCog } from 'lucide-react'
import type { Plan } from '@/types'
import { usePlans } from '@/state/PlansContext'
import { useSession } from '@/state/SessionContext'
import { useToast } from '@/hooks/useToast'
import { updatePlan, syncAllEntitlements, type PlanPatch } from '@/services/planCatalog'
import { reportError } from '@/lib/errors'
import { money0, num } from '@/lib/format'
import { fmtDateTime } from '@/lib/date'
import { cx } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Badge, LoadingBlock, Progress } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea, Toggle } from '@/components/ui/Inputs'
import { usePlatformData, useMemberCounts } from './usePlatformData'

// ═══════════════════════════════════════════════════════════════════════════
// Planes — editables sin tocar código.
//
// Cambiar un precio o un límite aquí surte efecto en el acto: se escribe en
// `plans/{planId}` y de ahí se copia a los `entitlements` de cada gimnasio de
// ese plan, que es lo que leen tanto la interfaz como las reglas de Firestore.
//
// Por eso los campos con consecuencias sobre dinero o sobre operación —precio
// y límite de socios— piden confirmación y dicen a cuántos gimnasios afectan.
// Bajar el tope de Starter a 50 con gimnasios que ya tienen 120 socios no se
// hace por accidente.
// ═══════════════════════════════════════════════════════════════════════════

const ACCENT: Record<string, { ring: string; text: string; bg: string }> = {
  tap: { ring: 'border-tap-500/35', text: 'text-tap-300', bg: 'bg-tap-500/10' },
  cyber: { ring: 'border-cyber-400/35', text: 'text-cyber-300', bg: 'bg-cyber-400/10' },
  plasma: { ring: 'border-plasma-400/35', text: 'text-plasma-300', bg: 'bg-plasma-400/10' },
  ink: { ring: 'border-white/12', text: 'text-ink-200', bg: 'bg-white/[.04]' },
}

interface FormState {
  name: string
  tagline: string
  price: string
  maxMembers: string
  maxStaff: string
  maxBranches: string
  support: string
  highlights: string
  active: boolean
  publiclyVisible: boolean
  popular: boolean
}

function toForm(plan: Plan): FormState {
  return {
    name: plan.name,
    tagline: plan.tagline,
    price: plan.price === null ? '' : String(plan.price),
    maxMembers: plan.maxMembers === null ? '' : String(plan.maxMembers),
    maxStaff: plan.maxStaff === null ? '' : String(plan.maxStaff),
    maxBranches: plan.maxBranches === null ? '' : String(plan.maxBranches),
    support: plan.support,
    highlights: plan.highlights.join('\n'),
    active: plan.active !== false,
    publiclyVisible: plan.publiclyVisible !== false,
    popular: plan.popular === true,
  }
}

/** Un campo vacío significa «sin límite», no «cero». */
function toNullableNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function toPatch(form: FormState): PlanPatch {
  return {
    name: form.name.trim(),
    tagline: form.tagline.trim(),
    price: toNullableNumber(form.price),
    maxMembers: toNullableNumber(form.maxMembers),
    maxStaff: toNullableNumber(form.maxStaff),
    maxBranches: toNullableNumber(form.maxBranches),
    support: form.support.trim(),
    highlights: form.highlights
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
    active: form.active,
    publiclyVisible: form.publiclyVisible,
    popular: form.popular,
  }
}

/**
 * Qué cambia respecto al plan actual, en texto legible.
 *
 * `critical` marca lo que toca dinero o capacidad de operar: eso es lo que
 * exige una segunda confirmación antes de propagarse a todos los gimnasios.
 */
interface PlanChange {
  text: string
  critical: boolean
}

function describeChanges(plan: Plan, patch: PlanPatch): PlanChange[] {
  const out: PlanChange[] = []
  const limit = (v: number | null | undefined) => (v === null || v === undefined ? 'ilimitado' : num(v))

  if (patch.name !== plan.name) {
    out.push({ text: `Nombre: «${plan.name}» → «${patch.name}»`, critical: false })
  }
  if (patch.tagline !== plan.tagline) {
    out.push({ text: 'Cambia la descripción corta', critical: false })
  }
  if (patch.price !== plan.price) {
    out.push({
      text: `Precio: ${plan.price === null ? 'a cotizar' : money0(plan.price)} → ${
        patch.price === null ? 'a cotizar' : money0(patch.price)
      }`,
      critical: true,
    })
  }
  if (patch.maxMembers !== plan.maxMembers) {
    out.push({ text: `Límite de socios: ${limit(plan.maxMembers)} → ${limit(patch.maxMembers)}`, critical: true })
  }
  if (patch.maxStaff !== plan.maxStaff) {
    out.push({ text: `Límite de usuarios: ${limit(plan.maxStaff)} → ${limit(patch.maxStaff)}`, critical: true })
  }
  if (patch.maxBranches !== plan.maxBranches) {
    out.push({
      text: `Límite de sucursales: ${limit(plan.maxBranches)} → ${limit(patch.maxBranches)}`,
      critical: true,
    })
  }
  if (patch.support !== plan.support) {
    out.push({ text: `Soporte: «${plan.support}» → «${patch.support}»`, critical: false })
  }
  if (JSON.stringify(patch.highlights) !== JSON.stringify(plan.highlights)) {
    out.push({ text: 'Cambia la lista de ventajas', critical: false })
  }
  if (patch.active !== (plan.active !== false)) {
    out.push({
      text: patch.active ? 'El plan vuelve a ofrecerse' : 'El plan deja de ofrecerse a gimnasios nuevos',
      critical: true,
    })
  }
  if (patch.publiclyVisible !== (plan.publiclyVisible !== false)) {
    out.push({
      text: patch.publiclyVisible ? 'Se muestra en la página de precios' : 'Se oculta de la página de precios',
      critical: false,
    })
  }
  if (patch.popular !== (plan.popular === true)) {
    out.push({ text: patch.popular ? 'Se marca como «Más popular»' : 'Deja de estar destacado', critical: false })
  }
  return out
}

export default function SuperPlans() {
  const { plans, ready } = usePlans()
  const { gyms, loading } = usePlatformData()
  const memberCounts = useMemberCounts()
  const { user } = useSession()
  const toast = useToast()

  const [editing, setEditing] = useState<Plan | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [confirming, setConfirming] = useState<{ plan: Plan; patch: PlanPatch; changes: PlanChange[] } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)

  /** Gimnasios por plan y cuántos socios suman: el contexto del cambio. */
  const usage = useMemo(() => {
    const out: Record<string, { gyms: number; members: number; overLimit: number; mrr: number }> = {}
    for (const plan of plans) out[plan.id] = { gyms: 0, members: 0, overLimit: 0, mrr: 0 }
    for (const g of gyms) {
      const row = out[g.planId]
      if (!row) continue
      const count = memberCounts[g.id] ?? 0
      const max = plans.find((p) => p.id === g.planId)?.maxMembers ?? null
      row.gyms += 1
      row.members += count
      if (max !== null && count > max) row.overLimit += 1
      if (g.subscriptionStatus === 'ACTIVE' || g.subscriptionStatus === 'PAST_DUE') {
        row.mrr += plans.find((p) => p.id === g.planId)?.price ?? 0
      }
    }
    return out
  }, [gyms, memberCounts, plans])

  function openEditor(plan: Plan) {
    setEditing(plan)
    setForm(toForm(plan))
  }

  function closeEditor() {
    setEditing(null)
    setForm(null)
  }

  /** Revisa si el cambio toca algo delicado; si no, guarda directo. */
  function review() {
    if (!editing || !form) return
    const patch = toPatch(form)
    if (!patch.name) {
      toast.error('El plan necesita un nombre', 'Un plan sin nombre no se puede ofrecer ni facturar.')
      return
    }
    const changes = describeChanges(editing, patch)
    if (changes.length === 0) {
      closeEditor()
      return
    }
    if (changes.some((c) => c.critical)) {
      setConfirming({ plan: editing, patch, changes })
      return
    }
    void save(editing, patch)
  }

  async function save(plan: Plan, patch: PlanPatch) {
    if (!user) return
    setBusy(true)
    try {
      await updatePlan(plan.id, patch, user)
      const affected = usage[plan.id]?.gyms ?? 0
      toast.success(
        'Plan actualizado',
        affected === 0
          ? 'Todavía no hay gimnasios en este plan.'
          : `${affected} ${affected === 1 ? 'gimnasio recibió' : 'gimnasios recibieron'} el cambio.`,
      )
      setConfirming(null)
      closeEditor()
    } catch (err) {
      const friendly = reportError('updatePlan', err, { planId: plan.id })
      toast.error('No se pudo guardar el plan', friendly.message)
    } finally {
      setBusy(false)
    }
  }

  if (!ready || loading) return <LoadingBlock label="Cargando planes…" />

  return (
    <div>
      <PageHeader
        eyebrow="Plataforma"
        title="Planes"
        description="Precio, límites y visibilidad de cada paquete. Lo que guardes aquí se aplica de inmediato a todos los gimnasios de ese plan, sin desplegar nada."
        actions={
          <Button
            variant="ghost"
            icon={<RefreshCw className={cx('h-4 w-4', syncing && 'animate-spin')} />}
            loading={syncing}
            onClick={async () => {
              setSyncing(true)
              try {
                const n = await syncAllEntitlements()
                toast.success('Permisos resincronizados', `${n} ${n === 1 ? 'gimnasio' : 'gimnasios'} al día.`)
              } catch (err) {
                const friendly = reportError('syncAllEntitlements', err)
                toast.error('No se pudo resincronizar', friendly.message)
              } finally {
                setSyncing(false)
              }
            }}
          >
            Resincronizar permisos
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const accent = ACCENT[plan.accent] ?? ACCENT.ink
          const u = usage[plan.id] ?? { gyms: 0, members: 0, overLimit: 0, mrr: 0 }
          const activeCount = Object.values(plan.features).filter(Boolean).length
          const totalCount = Object.keys(plan.features).length

          return (
            <Card key={plan.id} className={cx('flex flex-col border p-5', accent.ring)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className={cx('text-[17px] font-bold', accent.text)}>{plan.name}</h3>
                    {plan.popular && <Badge tone="cyber">Más popular</Badge>}
                    {plan.active === false && <Badge tone="danger">Retirado</Badge>}
                    {plan.publiclyVisible === false && plan.active !== false && (
                      <Badge tone="neutral">Oculto</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-[12.5px] leading-snug text-ink-400">{plan.tagline}</p>
                </div>
                <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEditor(plan)}>
                  Editar
                </Button>
              </div>

              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-[30px] font-bold leading-none text-ink-50 tnum">
                  {plan.price === null ? 'A cotizar' : money0(plan.price)}
                </span>
                {plan.price !== null && <span className="text-[12.5px] text-ink-500">/mes</span>}
              </div>

              <dl className="mt-4 space-y-2 border-t border-white/[.06] pt-4">
                <LimitRow icon={<Users className="h-3.5 w-3.5" />} label="Socios" value={plan.maxMembers} />
                <LimitRow icon={<UserCog className="h-3.5 w-3.5" />} label="Usuarios" value={plan.maxStaff} />
                <LimitRow icon={<Building2 className="h-3.5 w-3.5" />} label="Sucursales" value={plan.maxBranches} />
              </dl>

              <div className="mt-4 border-t border-white/[.06] pt-4">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-[12px] text-ink-400">Funcionalidades</span>
                  <span className="text-[12.5px] font-semibold text-ink-100 tnum">
                    {activeCount}
                    <span className="font-normal text-ink-500"> / {totalCount}</span>
                  </span>
                </div>
                <Progress value={activeCount} max={totalCount} />
              </div>

              <div className={cx('mt-4 rounded-xl px-3 py-2.5', accent.bg)}>
                <p className="text-[12px] text-ink-300">
                  <span className="font-semibold text-ink-100 tnum">{u.gyms}</span>{' '}
                  {u.gyms === 1 ? 'gimnasio' : 'gimnasios'} ·{' '}
                  <span className="font-semibold text-ink-100 tnum">{num(u.members)}</span> socios
                </p>
                <p className="mt-0.5 text-[11.5px] text-ink-500">
                  MRR {money0(u.mrr)}
                  {u.overLimit > 0 && (
                    <span className="text-warn-400">
                      {' '}
                      · {u.overLimit} por encima del tope
                    </span>
                  )}
                </p>
              </div>

              {plan.updatedAt && (
                <p className="mt-3 text-[11px] text-ink-600">Última edición {fmtDateTime(plan.updatedAt)}</p>
              )}
            </Card>
          )
        })}
      </div>

      <p className="mt-5 text-[12.5px] leading-relaxed text-ink-500">
        Para encender o apagar funcionalidades concretas de cada plan, usa{' '}
        <span className="text-ink-300">Funcionalidades</span>. Los cambios de ambas pantallas quedan registrados
        en <span className="text-ink-300">Auditoría</span> con quién los hizo y qué valores había antes.
      </p>

      {/* ── Editor ─────────────────────────────────────────────────────── */}
      <Modal
        open={editing !== null && form !== null}
        onClose={closeEditor}
        title={`Editar ${editing?.name ?? ''}`}
        description="Se aplica a todos los gimnasios que tienen este plan."
        size="lg"
        footer={
          <>
            <Button variant="subtle" onClick={closeEditor}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={review} loading={busy}>
              Revisar y guardar
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Nombre"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              <Input
                label="Precio mensual"
                type="number"
                min={0}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                prefix={<span className="text-[13px]">$</span>}
                hint="Vacío = precio a cotizar (Enterprise)."
              />
            </div>

            <Input
              label="Descripción corta"
              value={form.tagline}
              onChange={(e) => setForm({ ...form, tagline: e.target.value })}
              hint="Es lo que se lee bajo el nombre en la página de precios."
            />

            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Límite de socios"
                type="number"
                min={0}
                value={form.maxMembers}
                onChange={(e) => setForm({ ...form, maxMembers: e.target.value })}
                placeholder="Sin límite"
              />
              <Input
                label="Límite de usuarios"
                type="number"
                min={0}
                value={form.maxStaff}
                onChange={(e) => setForm({ ...form, maxStaff: e.target.value })}
                placeholder="Sin límite"
              />
              <Input
                label="Límite de sucursales"
                type="number"
                min={0}
                value={form.maxBranches}
                onChange={(e) => setForm({ ...form, maxBranches: e.target.value })}
                placeholder="Sin límite"
              />
            </div>
            <p className="-mt-2 text-[12px] text-ink-500">
              Un campo vacío significa <span className="text-ink-300">sin límite</span>. El tope de socios lo
              comprueba el servidor: un gimnasio no puede pasarlo aunque llame directamente a la base de datos.
            </p>

            <Input
              label="Soporte"
              value={form.support}
              onChange={(e) => setForm({ ...form, support: e.target.value })}
            />

            <Textarea
              label="Ventajas (una por línea)"
              rows={5}
              value={form.highlights}
              onChange={(e) => setForm({ ...form, highlights: e.target.value })}
              hint="Se muestran como la lista de bullets del plan en la página pública."
            />

            <div className="space-y-3 rounded-xl border border-white/[.07] bg-white/[.02] p-4">
              <Toggle
                checked={form.active}
                onChange={(v) => setForm({ ...form, active: v })}
                label="Plan disponible"
                description="Al desactivarlo deja de ofrecerse a gimnasios nuevos. Los que ya lo tienen siguen funcionando igual."
              />
              <Toggle
                checked={form.publiclyVisible}
                onChange={(v) => setForm({ ...form, publiclyVisible: v })}
                label="Visible en la página de precios"
                description="Ocúltalo para planes a medida que solo se asignan a mano."
              />
              <Toggle
                checked={form.popular}
                onChange={(v) => setForm({ ...form, popular: v })}
                label="Destacar como «Más popular»"
                description="Solo debería estar marcado en uno."
              />
            </div>
          </div>
        )}
      </Modal>

      {/* ── Confirmación de cambios delicados ──────────────────────────── */}
      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Confirma el cambio"
        description={
          confirming
            ? `Afecta a ${usage[confirming.plan.id]?.gyms ?? 0} ${
                (usage[confirming.plan.id]?.gyms ?? 0) === 1 ? 'gimnasio' : 'gimnasios'
              } en el plan ${confirming.plan.name}.`
            : undefined
        }
        size="md"
        footer={
          <>
            <Button variant="subtle" onClick={() => setConfirming(null)}>
              Volver
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => confirming && save(confirming.plan, confirming.patch)}
            >
              Aplicar cambios
            </Button>
          </>
        }
      >
        <ul className="space-y-2">
          {confirming?.changes.map((c) => (
            <li key={c.text} className="flex items-start gap-2.5 text-[13.5px] text-ink-200">
              <Check className={cx('mt-0.5 h-4 w-4 shrink-0', c.critical ? 'text-warn-400' : 'text-gym')} />
              <span>{c.text}</span>
            </li>
          ))}
        </ul>

        {confirming && (usage[confirming.plan.id]?.overLimit ?? 0) > 0 && (
          <p className="mt-4 rounded-xl border border-warn-500/30 bg-warn-500/10 px-3.5 py-3 text-[12.5px] leading-relaxed text-warn-200">
            {usage[confirming.plan.id]?.overLimit} de esos gimnasios ya superan el tope de socios. No se les borra
            nada ni se les bloquea la operación: simplemente no podrán dar de alta socios nuevos hasta que bajen del
            límite o cambien de plan.
          </p>
        )}
      </Modal>
    </div>
  )
}

function LimitRow({ icon, label, value }: { icon: ReactNode; label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-[12.5px] text-ink-400">
        <span className="text-ink-500">{icon}</span>
        {label}
      </dt>
      <dd className="text-[13px] font-semibold text-ink-100 tnum">
        {value === null ? <InfinityIcon className="h-4 w-4 text-ink-300" aria-label="Sin límite" /> : num(value)}
      </dd>
    </div>
  )
}
