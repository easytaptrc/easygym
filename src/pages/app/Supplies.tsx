import { useEffect, useMemo, useState } from 'react'
import { Check, Clock, History, Package, Plus, Truck, X } from 'lucide-react'
import type { SupplyRequest } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { useToast } from '@/hooks/useToast'
import {
  COMMON_SUPPLIES,
  SUPPLY_STATUS_LABEL,
  SUPPLY_STATUS_TONE,
  acceptRequest,
  cancelRequest,
  createRequest,
  deliverRequest,
} from '@/services/supplies'
import { fmtDateTime, relativeDays } from '@/lib/date'
import { reportError } from '@/lib/errors'
import { cx } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Avatar, Badge, EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Segmented, Textarea, Toggle } from '@/components/ui/Inputs'

// ═══════════════════════════════════════════════════════════════════════════
// SOLICITUDES DE INSUMOS.
//
// Sustituye al papelito pegado en la puerta de la oficina.
//
// PENSADA PARA EL TELÉFONO. Adrián no tiene computadora: abre EasyGym desde el
// celular entre una cosa y otra, ve qué le han pedido y lo marca con el pulgar.
// Por eso las tarjetas son grandes, los botones ocupan el ancho y lo primero
// que se ve es lo que falta por hacer, no el historial.
// ═══════════════════════════════════════════════════════════════════════════

type Tab = 'open' | 'history'

export default function Supplies() {
  const { repo, user, can } = useSession()
  const toast = useToast()

  const [tab, setTab] = useState<Tab>('open')
  const [creating, setCreating] = useState(false)
  const [cancelling, setCancelling] = useState<SupplyRequest | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Últimos 60 días. El historial completo no cabe ni hace falta en el móvil.
  const since = useMemo(() => Date.now() - 60 * 86_400_000, [])
  const requests = useCollection(
    'supplyRequests',
    useMemo(
      () => ({
        where: [{ field: 'createdAt', op: '>=' as const, value: since }],
        orderBy: { field: 'createdAt' as const, dir: 'desc' as const },
        limit: 150,
      }),
      [since],
    ),
  )

  const canFulfill = can('supplies.fulfill')
  const canRequest = can('supplies.request')

  const open = useMemo(
    () =>
      requests.data
        .filter((r) => r.status === 'PENDING' || r.status === 'IN_PROGRESS')
        .sort(
          (a, b) => Number(b.urgent ?? false) - Number(a.urgent ?? false) || b.createdAt - a.createdAt,
        ),
    [requests.data],
  )

  const history = useMemo(
    () => requests.data.filter((r) => r.status === 'DELIVERED' || r.status === 'CANCELLED'),
    [requests.data],
  )

  const pendingCount = open.filter((r) => r.status === 'PENDING').length

  async function run(id: string, fn: () => Promise<void>, ok: string) {
    setBusy(id)
    try {
      await fn()
      toast.success(ok)
    } catch (err) {
      toast.error('No se pudo actualizar', reportError('solicitud de insumo', err).message)
    } finally {
      setBusy(null)
    }
  }

  if (requests.loading) return <LoadingBlock label="Cargando solicitudes…" />

  const shown = tab === 'open' ? open : history

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        eyebrow="Operación"
        title="Insumos"
        description={
          pendingCount > 0
            ? `${pendingCount} ${pendingCount === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'}.`
            : 'No hay nada pendiente.'
        }
        actions={
          canRequest && (
            <Button
              variant="primary"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setCreating(true)}
            >
              Solicitar
            </Button>
          )
        }
      />

      <Segmented
        value={tab}
        onChange={setTab}
        className="mb-4"
        options={[
          { value: 'open', label: `Pendientes (${open.length})`, icon: <Clock className="h-3.5 w-3.5" /> },
          { value: 'history', label: 'Historial', icon: <History className="h-3.5 w-3.5" /> },
        ]}
      />

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Package className="h-6 w-6" />}
            title={tab === 'open' ? 'Todo al día' : 'Sin historial todavía'}
            detail={
              tab === 'open'
                ? 'No hay solicitudes pendientes. Cuando alguien pida algo, aparecerá aquí.'
                : 'Las solicitudes entregadas y canceladas se guardan aquí.'
            }
            action={
              canRequest && tab === 'open' ? (
                <Button variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                  Solicitar algo
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => {
            const working = busy === r.id
            const mine = r.requestedBy === user?.uid
            return (
              <Card
                key={r.id}
                className={cx(
                  'p-4 sm:p-5',
                  r.urgent && r.status === 'PENDING' && 'border-warn-500/30 bg-warn-500/[.04]',
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cx(
                      'grid h-12 w-12 shrink-0 place-items-center rounded-2xl',
                      r.status === 'DELIVERED'
                        ? 'bg-gym/12 text-gym'
                        : r.status === 'CANCELLED'
                          ? 'bg-white/[.05] text-ink-500'
                          : 'bg-warn-500/12 text-warn-300',
                    )}
                  >
                    <Package className="h-6 w-6" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[17px] font-semibold leading-tight text-ink-50">
                        <span className="tnum">{r.quantity}</span> × {r.item}
                      </p>
                      {r.urgent && r.status !== 'DELIVERED' && <Badge tone="warn">Urgente</Badge>}
                      <Badge tone={SUPPLY_STATUS_TONE[r.status]} dot>
                        {SUPPLY_STATUS_LABEL[r.status]}
                      </Badge>
                    </div>

                    {r.note && <p className="mt-1.5 text-[13.5px] leading-snug text-ink-300">{r.note}</p>}

                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-500">
                      <Avatar name={r.requestedByName} size={18} />
                      <span className="text-ink-400">{r.requestedByName}</span>
                      <span>·</span>
                      <span>{relativeDays(r.createdAt)}</span>
                      {r.assignedToName && (
                        <>
                          <span>·</span>
                          <span className="text-cyber-300">Atiende {r.assignedToName}</span>
                        </>
                      )}
                    </div>

                    {r.status === 'DELIVERED' && r.completedAt && (
                      <p className="mt-1 text-[11.5px] text-gym">
                        Entregado {fmtDateTime(r.completedAt)}
                      </p>
                    )}
                    {r.status === 'CANCELLED' && r.cancelReason && (
                      <p className="mt-1 text-[11.5px] text-ink-500">Cancelada: {r.cancelReason}</p>
                    )}
                  </div>
                </div>

                {/* Botones grandes: se tocan con el pulgar, no con un ratón. */}
                {(r.status === 'PENDING' || r.status === 'IN_PROGRESS') && (canFulfill || mine) && (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    {canFulfill && r.status === 'PENDING' && (
                      <Button
                        variant="primary"
                        size="lg"
                        block
                        loading={working}
                        icon={<Clock className="h-4 w-4" />}
                        onClick={() =>
                          repo &&
                          user &&
                          run(r.id, () => acceptRequest(repo, r.id, user), 'Solicitud tomada')
                        }
                      >
                        La tomo
                      </Button>
                    )}
                    {canFulfill && r.status === 'IN_PROGRESS' && (
                      <Button
                        variant="primary"
                        size="lg"
                        block
                        loading={working}
                        icon={<Truck className="h-4 w-4" />}
                        onClick={() =>
                          repo &&
                          user &&
                          run(r.id, () => deliverRequest(repo, r.id, user), 'Marcada como entregada')
                        }
                      >
                        Entregado
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="lg"
                      block={!canFulfill}
                      icon={<X className="h-4 w-4" />}
                      onClick={() => setCancelling(r)}
                      className="sm:max-w-[160px]"
                    >
                      Cancelar
                    </Button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <CreateModal
        open={creating}
        onClose={() => setCreating(false)}
        onSave={async (v) => {
          if (!repo || !user) return
          try {
            await createRequest(repo, v, user)
            toast.success('Solicitud enviada', `${v.quantity} × ${v.item}`)
            setCreating(false)
          } catch (err) {
            toast.error('No se pudo enviar', reportError('crear solicitud', err).message)
          }
        }}
      />

      <CancelModal
        request={cancelling}
        onClose={() => setCancelling(null)}
        onSave={async (reason) => {
          if (!repo || !user || !cancelling) return
          await run(
            cancelling.id,
            () => cancelRequest(repo, cancelling.id, reason, user),
            'Solicitud cancelada',
          )
          setCancelling(null)
        }}
      />
    </div>
  )
}

// ──────────────────────────────── Modales ───────────────────────────────────

function CreateModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (v: { item: string; quantity: number; note: string; urgent: boolean }) => Promise<void>
}) {
  const [item, setItem] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [note, setNote] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setItem('')
    setQuantity('1')
    setNote('')
    setUrgent(false)
  }, [open])

  const valid = item.trim().length >= 2 && Number(quantity) > 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Solicitar insumo"
      description="Llega al personal de mantenimiento en cuanto lo envíes."
      size="sm"
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
                await onSave({ item, quantity: Number(quantity), note, urgent })
              } finally {
                setBusy(false)
              }
            }}
          >
            Enviar solicitud
          </Button>
        </>
      }
    >
      <Input
        label="¿Qué necesitas?"
        required
        value={item}
        onChange={(e) => setItem(e.target.value)}
        placeholder="Papel higiénico"
        autoFocus
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {COMMON_SUPPLIES.slice(0, 6).map((s) => (
          <button
            key={s}
            onClick={() => setItem(s)}
            className="rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[11.5px] text-ink-300 transition hover:border-white/20 hover:text-ink-100"
          >
            {s}
          </button>
        ))}
      </div>

      <Input
        label="Cantidad"
        type="number"
        min={1}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        containerClassName="mt-4 max-w-[160px]"
      />

      <Textarea
        label="Nota (opcional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Ya quedan pocos en recepción."
        containerClassName="mt-4"
        rows={2}
      />

      <div className="mt-4 rounded-xl border border-white/[.07] bg-white/[.02] p-3.5">
        <Toggle
          checked={urgent}
          onChange={setUrgent}
          label="Es urgente"
          description="Aparece primero en la lista de quien lo va a atender."
        />
      </div>
    </Modal>
  )
}

function CancelModal({
  request,
  onClose,
  onSave,
}: {
  request: SupplyRequest | null
  onClose: () => void
  onSave: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (request) setReason('')
  }, [request])

  return (
    <Modal
      open={request !== null}
      onClose={onClose}
      title="Cancelar la solicitud"
      description={request ? `${request.quantity} × ${request.item}` : ''}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Volver
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={async () => {
              setBusy(true)
              try {
                await onSave(reason)
              } finally {
                setBusy(false)
              }
            }}
          >
            Cancelar solicitud
          </Button>
        </>
      }
    >
      <Input
        label="¿Por qué se cancela?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Ya había en bodega"
        autoFocus
      />
      <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-ink-500">
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Quien la pidió recibe el aviso con el motivo. La solicitud no se borra: queda en el historial.
      </p>
    </Modal>
  )
}
