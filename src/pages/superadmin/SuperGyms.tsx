import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ban, Building2, Eye, Play, Repeat } from 'lucide-react'
import type { Gym, PlanId } from '@/types'
import { usePlans } from '@/state/PlansContext'
import { changePlan, setGymStatus } from '@/services/provisioning'
import { useSession } from '@/state/SessionContext'
import { useToast } from '@/hooks/useToast'
import { fmtDate } from '@/lib/date'
import { money0, num } from '@/lib/format'
import { cx, norm } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Badge, EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { Button, IconButton } from '@/components/ui/Button'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { SearchInput, Select } from '@/components/ui/Inputs'
import { usePlatformData, useMemberCounts } from './usePlatformData'

// Administración de gimnasios: ver dentro de uno, activar, suspender y cambiar
// de plan. Suspender NUNCA borra datos.

const STATUS_TONE: Record<string, 'gym' | 'warn' | 'danger' | 'neutral'> = {
  ACTIVE: 'gym',
  TRIALING: 'neutral',
  PAST_DUE: 'warn',
  SUSPENDED: 'danger',
  CANCELED: 'danger',
}

export default function SuperGyms() {
  const { gyms, users, loading } = usePlatformData()
  const memberCounts = useMemberCounts()
  const { publicPlans, getPlan } = usePlans()
  const { impersonateGym } = useSession()
  const toast = useToast()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string>('ALL')
  const [planFilter, setPlanFilter] = useState<string>('ALL')
  const [suspending, setSuspending] = useState<Gym | null>(null)
  const [changingPlan, setChangingPlan] = useState<Gym | null>(null)
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => {
    const q = norm(query.trim())
    return gyms
      .filter((g) => (status === 'ALL' ? true : g.subscriptionStatus === status))
      .filter((g) => (planFilter === 'ALL' ? true : g.planId === planFilter))
      .filter((g) => (!q ? true : norm(g.name).includes(q) || norm(g.city).includes(q) || g.slug.includes(q)))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [gyms, query, status, planFilter])

  const ownerOf = (g: Gym) => users.find((u) => u.uid === g.ownerId)

  async function enterGym(g: Gym) {
    await impersonateGym(g.id)
    toast.info('Entrando al gimnasio', `${g.name} — verás sus datos como si fueras el dueño.`)
    navigate('/dashboard')
  }

  const columns: Column<Gym>[] = [
    {
      key: 'gym',
      header: 'Gimnasio',
      sortValue: (g) => g.name,
      cell: (g) => (
        <div className="flex items-center gap-3">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[11px] font-bold"
            style={{
              background: `rgb(${g.branding.accent} / .14)`,
              color: `rgb(${g.branding.accent})`,
            }}
          >
            {g.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-medium text-ink-100">{g.name}</p>
            <p className="truncate font-mono text-[11px] text-ink-500">/{g.slug}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'owner',
      header: 'Dueño',
      hideOnMobile: true,
      cell: (g) => {
        const o = ownerOf(g)
        return (
          <div className="min-w-0">
            <p className="truncate text-[13px] text-ink-200">{o?.name ?? '—'}</p>
            <p className="truncate text-[11px] text-ink-500">{o?.email ?? ''}</p>
          </div>
        )
      },
    },
    {
      key: 'plan',
      header: 'Plan',
      sortValue: (g) => g.planId,
      cell: (g) => {
        const p = getPlan(g.planId)
        return <Badge tone={p.accent === 'ink' ? 'neutral' : (p.accent as never)}>{p.name}</Badge>
      },
    },
    {
      key: 'members',
      header: 'Socios',
      align: 'right',
      sortValue: (g) => memberCounts[g.id] ?? 0,
      cell: (g) => {
        const count = memberCounts[g.id] ?? 0
        const max = getPlan(g.planId).maxMembers
        return (
          <span
            className={cx(
              'text-[13px] font-semibold tnum',
              max && count / max > 0.9 ? 'text-warn-400' : 'text-ink-100',
            )}
          >
            {num(count)}
            <span className="text-[11px] font-normal text-ink-500"> / {max ? num(max) : '∞'}</span>
          </span>
        )
      },
    },
    {
      key: 'mrr',
      header: 'MRR',
      align: 'right',
      hideOnMobile: true,
      sortValue: (g) => getPlan(g.planId).price ?? 0,
      cell: (g) => (
        <span className="text-[13px] font-semibold text-plasma-300 tnum">
          {money0(getPlan(g.planId).price ?? 0)}
        </span>
      ),
    },
    {
      key: 'created',
      header: 'Alta',
      hideOnMobile: true,
      sortValue: (g) => g.createdAt,
      cell: (g) => <span className="whitespace-nowrap text-[12.5px] text-ink-400 tnum">{fmtDate(g.createdAt)}</span>,
    },
    {
      key: 'status',
      header: 'Estado',
      sortValue: (g) => g.subscriptionStatus,
      cell: (g) => (
        <Badge tone={STATUS_TONE[g.subscriptionStatus] ?? 'neutral'} dot>
          {g.subscriptionStatus}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (g) => (
        <div className="flex justify-end gap-1">
          <IconButton
            label="Ver dentro"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              enterGym(g)
            }}
          >
            <Eye className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label="Cambiar plan"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setChangingPlan(g)
            }}
          >
            <Repeat className="h-3.5 w-3.5" />
          </IconButton>
          {g.subscriptionStatus === 'SUSPENDED' || g.subscriptionStatus === 'CANCELED' ? (
            <IconButton
              label="Reactivar"
              size="sm"
              onClick={async (e) => {
                e.stopPropagation()
                await setGymStatus(g.id, 'ACTIVE')
                toast.success('Gimnasio reactivado', g.name)
              }}
            >
              <Play className="h-3.5 w-3.5" />
            </IconButton>
          ) : (
            <IconButton
              label="Suspender"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                setSuspending(g)
              }}
            >
              <Ban className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
      ),
    },
  ]

  if (loading) return <LoadingBlock />

  return (
    <div>
      <PageHeader
        eyebrow="Plataforma"
        title="Gimnasios"
        description="Cada gimnasio es un tenant aislado. Entrar a uno no mezcla sus datos con los demás."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={query} onValueChange={setQuery} placeholder="Buscar gimnasio, ciudad o slug…" className="w-full sm:w-72" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} containerClassName="w-full sm:w-48">
          <option value="ALL">Todos los estados</option>
          {['ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} containerClassName="w-full sm:w-44">
          <option value="ALL">Todos los planes</option>
          {publicPlans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(g) => g.id}
          pageSize={30}
          empty={<EmptyState icon={<Building2 className="h-6 w-6" />} title="Ningún gimnasio coincide" />}
        />
      </Card>

      <ConfirmModal
        open={suspending !== null}
        onClose={() => setSuspending(null)}
        title="¿Suspender este gimnasio?"
        message={`${suspending?.name} perderá acceso a las funciones de su plan, pero NO se borra nada: socios, pagos e historial se conservan íntegros y vuelven al reactivarlo.`}
        confirmLabel="Suspender"
        loading={busy}
        onConfirm={async () => {
          if (!suspending) return
          setBusy(true)
          try {
            await setGymStatus(suspending.id, 'SUSPENDED')
            toast.info('Gimnasio suspendido', suspending.name)
            setSuspending(null)
          } finally {
            setBusy(false)
          }
        }}
      />

      <Modal
        open={changingPlan !== null}
        onClose={() => setChangingPlan(null)}
        title="Cambiar de plan"
        description={changingPlan?.name}
        size="sm"
      >
        <div className="space-y-2">
          {publicPlans.map((p) => {
            const current = changingPlan?.planId === p.id
            return (
              <button
                key={p.id}
                disabled={current || busy}
                onClick={async () => {
                  if (!changingPlan) return
                  setBusy(true)
                  try {
                    await changePlan(changingPlan.id, p.id as PlanId)
                    toast.success('Plan actualizado', `${changingPlan.name} → ${p.name}`)
                    setChangingPlan(null)
                  } finally {
                    setBusy(false)
                  }
                }}
                className={cx(
                  'flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition disabled:opacity-50',
                  current
                    ? 'border-plasma-400/40 bg-plasma-400/[.08]'
                    : 'border-white/[.07] bg-white/[.02] hover:border-white/20',
                )}
              >
                <div>
                  <p className="text-[14px] font-semibold text-ink-100">{p.name}</p>
                  <p className="text-[11.5px] text-ink-500">
                    {p.maxMembers ? `${num(p.maxMembers)} socios` : 'Socios ilimitados'}
                  </p>
                </div>
                <div className="text-right">
                  <span className="block text-[16px] font-bold text-ink-50 tnum">{money0(p.price ?? 0)}</span>
                  {current && <span className="text-[10.5px] text-plasma-300">Plan actual</span>}
                </div>
              </button>
            )
          })}
        </div>
        <Button variant="subtle" block className="mt-4" onClick={() => setChangingPlan(null)}>
          Cancelar
        </Button>
      </Modal>
    </div>
  )
}
