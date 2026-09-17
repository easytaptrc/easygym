import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Banknote, Download, Plus, Printer, Undo2 } from 'lucide-react'
import type { Payment, PaymentMethod, RevenueCategory } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { useToast } from '@/hooks/useToast'
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  PAYMENT_METHOD_LABEL,
  refundPayment,
  registerPayment,
} from '@/services/billing'
import { useDailyStats } from '@/hooks/useAggregates'
import { presetRange, fmtDateTime, type DateRange } from '@/lib/date'
import { money, money0 } from '@/lib/format'
import { cx, downloadCsv, norm } from '@/lib/utils'
import { printReceipt } from '@/services/printing'
import { PageHeader } from '@/components/layout/PageHeader'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { Card } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Badge, EmptyState } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, SearchInput, Select } from '@/components/ui/Inputs'

// Todos los cobros del gimnasio, con el desglose que el dueño necesita ver:
// membresías, renovaciones, visitas, productos y otros, separados.

/** Tope de documentos que esta pantalla trae de una vez. */
const DETAIL_LIMIT = 1500

export default function Payments() {
  const { repo, gym, settings, user } = useSession()
  const toast = useToast()
  const navigate = useNavigate()

  const [range, setRange] = useState<DateRange>(() => presetRange('month'))
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<RevenueCategory | 'ALL'>('ALL')
  const [method, setMethod] = useState<PaymentMethod | 'ALL'>('ALL')
  const [manualOpen, setManualOpen] = useState(false)

  // Acotado al rango y con tope: el histórico completo de pagos de un gimnasio
  // con años de operación no cabe —ni hace falta— en una pantalla.
  const payments = useCollection('payments', {
    where: [
      { field: 'createdAt', op: '>=', value: range.from },
      { field: 'createdAt', op: '<=', value: range.to },
    ],
    orderBy: { field: 'createdAt', dir: 'desc' },
    limit: DETAIL_LIMIT,
  })
  const members = useCollection('members', { limit: 300 })

  // Las tarjetas de desglose salen de los resúmenes diarios: son exactas
  // aunque la tabla esté truncada.
  const rollup = useDailyStats(range)

  const rows = useMemo(() => {
    const q = norm(query.trim())
    return payments.data
      .filter((p) => (category === 'ALL' ? true : p.category === category))
      .filter((p) => (method === 'ALL' ? true : p.method === method))
      .filter((p) =>
        !q ? true : norm(p.concept).includes(q) || norm(p.memberName ?? '').includes(q),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [payments.data, query, category, method])

  const total = useMemo(
    () => rows.filter((p) => p.status === 'PAID').reduce((acc, p) => acc + p.amount, 0),
    [rows],
  )
  const byCategory = rollup.revenueByCategory

  const columns: Column<Payment>[] = [
    {
      key: 'date',
      header: 'Fecha',
      sortValue: (p) => p.createdAt,
      cell: (p) => <span className="whitespace-nowrap text-[12.5px] text-ink-300 tnum">{fmtDateTime(p.createdAt)}</span>,
    },
    {
      key: 'member',
      header: 'Socio',
      sortValue: (p) => p.memberName ?? '',
      cell: (p) =>
        p.memberId ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/socios/${p.memberId}`)
            }}
            className="truncate text-[13px] font-medium text-ink-100 transition hover:text-gym"
          >
            {p.memberName ?? '—'}
          </button>
        ) : (
          <span className="text-[13px] text-ink-400">{p.memberName ?? 'Público general'}</span>
        ),
    },
    {
      key: 'concept',
      header: 'Concepto',
      cell: (p) => <span className="truncate text-[13px] text-ink-200">{p.concept}</span>,
    },
    {
      key: 'category',
      header: 'Categoría',
      hideOnMobile: true,
      sortValue: (p) => p.category,
      cell: (p) => (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-300">
          <span className="h-2 w-2 rounded-sm" style={{ background: CATEGORY_COLOR[p.category] }} />
          {CATEGORY_LABEL[p.category]}
        </span>
      ),
    },
    {
      key: 'method',
      header: 'Método',
      hideOnMobile: true,
      cell: (p) => <Badge tone="neutral">{PAYMENT_METHOD_LABEL[p.method]}</Badge>,
    },
    {
      key: 'amount',
      header: 'Importe',
      align: 'right',
      sortValue: (p) => p.amount,
      cell: (p) => (
        <span
          className={cx(
            'whitespace-nowrap text-[13.5px] font-semibold tnum',
            p.status === 'REFUNDED' ? 'text-ink-500 line-through' : 'text-ink-50',
          )}
        >
          {money(p.amount)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (p) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              const m = members.data.find((x) => x.id === p.memberId) ?? null
              if (gym) printReceipt({ gym, settings }, p, m)
            }}
            className="rounded-md p-1.5 text-ink-500 transition hover:bg-white/5 hover:text-ink-100"
            title="Imprimir recibo"
          >
            <Printer className="h-3.5 w-3.5" />
          </button>
          {p.status === 'PAID' && (
            <button
              onClick={async (e) => {
                e.stopPropagation()
                if (!repo) return
                await refundPayment(repo, p.id)
                toast.info('Pago marcado como devuelto', p.concept)
              }}
              className="rounded-md p-1.5 text-ink-500 transition hover:bg-white/5 hover:text-danger-400"
              title="Marcar como devuelto"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Pagos"
        description="Todo lo que ha entrado al gimnasio, con su categoría y método."
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={() =>
                downloadCsv(
                  `pagos-${new Date().toISOString().slice(0, 10)}.csv`,
                  rows.map((p) => ({
                    Fecha: fmtDateTime(p.createdAt),
                    Socio: p.memberName ?? '',
                    Concepto: p.concept,
                    Categoria: CATEGORY_LABEL[p.category],
                    Metodo: PAYMENT_METHOD_LABEL[p.method],
                    Importe: p.amount,
                    Estado: p.status,
                    Transaccion: p.transactionId ?? '',
                  })),
                )
              }
            >
              Exportar
            </Button>
            <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setManualOpen(true)}>
              Registrar pago
            </Button>
          </>
        }
      />

      {/* Desglose */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="p-3.5">
          <p className="text-[11.5px] text-ink-400">Total del periodo</p>
          <p className="mt-1.5 text-[22px] font-bold text-gym tnum">{money0(rollup.revenueTotal)}</p>
        </Card>
        {CATEGORY_ORDER.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(category === c ? 'ALL' : c)}
            className={cx(
              'rounded-2xl border p-3.5 text-left transition-all duration-200',
              category === c
                ? 'border-white/20 bg-white/[.06]'
                : 'border-white/[.07] bg-ink-900/60 hover:border-white/[.14]',
            )}
          >
            <p className="flex items-center gap-1.5 text-[11.5px] text-ink-400">
              <span className="h-2 w-2 rounded-sm" style={{ background: CATEGORY_COLOR[c] }} />
              {CATEGORY_LABEL[c]}
            </p>
            <p className="mt-1.5 text-[18px] font-bold text-ink-50 tnum">{money0(byCategory[c])}</p>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRangeFilter value={range} onChange={setRange} />
        <SearchInput value={query} onValueChange={setQuery} placeholder="Buscar concepto o socio…" className="w-full sm:w-64" />
        <Select
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod | 'ALL')}
          containerClassName="w-full sm:w-44"
        >
          <option value="ALL">Todos los métodos</option>
          {(['cash', 'card', 'transfer', 'stripe'] as PaymentMethod[]).map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABEL[m]}
            </option>
          ))}
        </Select>
      </div>

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id}
          loading={payments.loading}
          pageSize={40}
          empty={
            <EmptyState
              icon={<Banknote className="h-6 w-6" />}
              title="Sin pagos en este periodo"
              detail="Cambia el rango de fechas o registra un cobro manual."
            />
          }
        />
        {rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-white/[.07] bg-ink-950/40 px-4 py-3">
            <span className="text-[12.5px] text-ink-400">{rows.length} movimientos</span>
            <span className="text-[15px] font-bold text-gym tnum">{money(total)}</span>
          </div>
        )}
      </Card>

      {/* Cobro manual */}
      <ManualPaymentModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        members={members.data.map((m) => ({ id: m.id, name: m.name }))}
        methods={settings?.payments.methods ?? ['cash', 'card', 'transfer']}
        onSave={async (values) => {
          if (!repo) return
          await registerPayment(repo, {
            memberId: values.memberId || null,
            memberName: members.data.find((m) => m.id === values.memberId)?.name ?? null,
            concept: values.concept,
            category: values.category,
            amount: values.amount,
            method: values.method,
            collectedBy: user?.uid ?? null,
          })
          toast.success('Pago registrado', `${values.concept} · ${money0(values.amount)}`)
          setManualOpen(false)
        }}
      />
    </div>
  )
}

function ManualPaymentModal({
  open,
  onClose,
  members,
  methods,
  onSave,
}: {
  open: boolean
  onClose: () => void
  members: Array<{ id: string; name: string }>
  methods: PaymentMethod[]
  onSave: (v: {
    memberId: string
    concept: string
    category: RevenueCategory
    amount: number
    method: PaymentMethod
  }) => Promise<void>
}) {
  const [memberId, setMemberId] = useState('')
  const [concept, setConcept] = useState('')
  const [category, setCategory] = useState<RevenueCategory>('OTHER')
  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState<PaymentMethod>(methods[0] ?? 'cash')
  const [busy, setBusy] = useState(false)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar un pago"
      description="Para cobros que no vienen de una membresía, una visita o el punto de venta."
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!concept.trim() || amount <= 0}
            onClick={async () => {
              setBusy(true)
              try {
                await onSave({ memberId, concept, category, amount, method })
                setConcept('')
                setAmount(0)
                setMemberId('')
              } finally {
                setBusy(false)
              }
            }}
          >
            Registrar {amount > 0 ? money0(amount) : ''}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Concepto"
          required
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          placeholder="Casillero mensual, inscripción, evaluación…"
          containerClassName="sm:col-span-2"
        />
        <Input
          label="Importe"
          type="number"
          min={0}
          value={amount || ''}
          onChange={(e) => setAmount(Number(e.target.value))}
          prefix="$"
        />
        <Select label="Método" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {methods.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABEL[m]}
            </option>
          ))}
        </Select>
        <Select
          label="Categoría"
          value={category}
          onChange={(e) => setCategory(e.target.value as RevenueCategory)}
        >
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>
        <Select label="Socio (opcional)" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="">Público general</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </div>
    </Modal>
  )
}
