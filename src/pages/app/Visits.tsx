import { useMemo, useState } from 'react'
import { Download, Printer, Ticket, UserPlus, X } from 'lucide-react'
import type { PaymentMethod, Visit } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { useToast } from '@/hooks/useToast'
import { PAYMENT_METHOD_LABEL, registerVisit, visitPrice } from '@/services/billing'
import { printVisitTicket } from '@/services/printing'
import { presetRange, dayKey, fmtDateTime, type DateRange } from '@/lib/date'
import { money, money0, phoneFmt } from '@/lib/format'
import { reportError } from '@/lib/errors'
import { downloadCsv, norm } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { Card } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Badge, EmptyState } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, SearchInput, Select, Toggle } from '@/components/ui/Inputs'
import { MemberPicker } from '@/components/MemberPicker'

// ═══════════════════════════════════════════════════════════════════════════
// Visitas — pases de un día.
//
// UNA VISITA NO ES UNA MEMBRESÍA:
//   · no exige que la persona sea socio
//   · no crea ni modifica ninguna membresía
//   · se contabiliza aparte en el panel y en los reportes
//
// Un socio puede pagar una visita para un invitado: en ese caso se guarda
// quién invitó, pero quien entra es el invitado.
// ═══════════════════════════════════════════════════════════════════════════

export default function Visits() {
  const { repo, gym, settings, user } = useSession()
  const toast = useToast()

  const [range, setRange] = useState<DateRange>(() => presetRange('month'))
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  // El rango se resuelve en el SERVIDOR, sobre el campo `date`. La versión que
  // se traía la colección entera y filtraba en memoria funcionaba mientras
  // hubo pocas visitas; con un gimnasio que registra 30 al día, el primer año
  // ya son 11 000 documentos descargados para enseñar los de este mes.
  const visits = useCollection(
    'visits',
    useMemo(
      () => ({
        where: [
          { field: 'date', op: '>=' as const, value: dayKey(range.from) },
          { field: 'date', op: '<=' as const, value: dayKey(range.to) },
        ],
        orderBy: { field: 'date' as const, dir: 'desc' as const },
        limit: 500,
      }),
      [range.from, range.to],
    ),
  )

  const rows = useMemo(() => {
    const q = norm(query.trim())
    return visits.data
      .filter((v) => (!q ? true : norm(v.name).includes(q) || (v.phone ?? '').includes(q)))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [visits.data, query])

  const total = useMemo(
    () => rows.filter((v) => v.status === 'PAID').reduce((a, v) => a + v.amount, 0),
    [rows],
  )
  const guestCount = useMemo(() => rows.filter((v) => v.invitedByMemberId).length, [rows])


  const columns: Column<Visit>[] = [
    {
      key: 'date',
      header: 'Fecha y hora',
      sortValue: (v) => v.createdAt,
      cell: (v) => <span className="whitespace-nowrap text-[12.5px] text-ink-300 tnum">{fmtDateTime(v.createdAt)}</span>,
    },
    {
      key: 'name',
      header: 'Visitante',
      sortValue: (v) => v.name,
      cell: (v) => (
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium text-ink-100">{v.name}</p>
          {v.phone && <p className="truncate text-[11.5px] text-ink-500">{phoneFmt(v.phone)}</p>}
        </div>
      ),
    },
    {
      key: 'invited',
      header: 'Invitado por',
      hideOnMobile: true,
      cell: (v) =>
        v.invitedByMemberId ? (
          <Badge tone="cyber">{v.invitedByMemberName ?? 'Socio'}</Badge>
        ) : (
          <span className="text-[12.5px] text-ink-500">Público general</span>
        ),
    },
    {
      key: 'method',
      header: 'Método',
      hideOnMobile: true,
      cell: (v) => <Badge tone="neutral">{PAYMENT_METHOD_LABEL[v.method]}</Badge>,
    },
    {
      key: 'amount',
      header: 'Importe',
      align: 'right',
      sortValue: (v) => v.amount,
      cell: (v) => <span className="text-[13.5px] font-semibold text-ink-50 tnum">{money(v.amount)}</span>,
    },
    {
      key: 'print',
      header: '',
      align: 'right',
      cell: (v) => (
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (gym) printVisitTicket({ gym, settings }, v)
          }}
          className="rounded-md p-1.5 text-ink-500 transition hover:bg-white/5 hover:text-ink-100"
          title="Imprimir pase"
        >
          <Printer className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ]

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Visitas"
        description="Pases de un día. No son membresías: no requieren que la persona sea socio y se contabilizan aparte."
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={() =>
                downloadCsv(
                  `visitas-${new Date().toISOString().slice(0, 10)}.csv`,
                  rows.map((v) => ({
                    Fecha: v.date,
                    Hora: v.time,
                    Visitante: v.name,
                    Telefono: v.phone ?? '',
                    InvitadoPor: v.invitedByMemberName ?? '',
                    Importe: v.amount,
                    Metodo: PAYMENT_METHOD_LABEL[v.method],
                  })),
                )
              }
            >
              Exportar
            </Button>
            <Button variant="primary" size="sm" icon={<Ticket className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
              Registrar visita
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-2.5">
        <Card className="p-4">
          <p className="text-[11.5px] text-ink-400">Visitas del periodo</p>
          <p className="mt-1.5 text-[24px] font-bold text-ink-50 tnum">{rows.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11.5px] text-ink-400">Ingresos por visitas</p>
          <p className="mt-1.5 text-[24px] font-bold text-warn-400 tnum">{money0(total)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11.5px] text-ink-400">Invitados por socios</p>
          <p className="mt-1.5 text-[24px] font-bold text-cyber-400 tnum">{guestCount}</p>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRangeFilter value={range} onChange={setRange} />
        <SearchInput value={query} onValueChange={setQuery} placeholder="Buscar visitante…" className="w-full sm:w-64" />
      </div>

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(v) => v.id}
          loading={visits.loading}
          pageSize={40}
          empty={
            <EmptyState
              icon={<Ticket className="h-6 w-6" />}
              title="Sin visitas en este periodo"
              detail="Cuando alguien llegue sin membresía y quiera entrenar solo por hoy, regístralo aquí."
              action={
                <Button variant="primary" icon={<Ticket className="h-4 w-4" />} onClick={() => setOpen(true)}>
                  Registrar visita
                </Button>
              }
            />
          }
        />
      </Card>

      <VisitModal
        open={open}
        onClose={() => setOpen(false)}
        defaultPrice={settings?.visits.defaultPrice ?? 100}
        guestPrice={settings?.visits.memberGuestPrice ?? 80}
        methods={settings?.payments.methods ?? ['cash', 'card', 'transfer']}
        onSave={async (v) => {
          if (!repo) return
          try {
            const { visit } = await registerVisit(repo, {
              name: v.name,
              phone: v.phone,
              amount: v.amount,
              method: v.method,
              invitedByMemberId: v.invitedBy?.id ?? null,
              invitedByMemberName: v.invitedBy?.name ?? null,
              registeredBy: user?.uid ?? null,
            })
            toast.success('Visita registrada', `${v.name} · ${money0(v.amount)}`)
            if (v.print && gym) printVisitTicket({ gym, settings }, visit)
            setOpen(false)
          } catch (err) {
            // El cobro puede rechazarse por suscripción suspendida o por
            // permisos. El modal se queda abierto con los datos escritos: que
            // el error no obligue a teclearlo todo otra vez.
            toast.error('No se pudo registrar la visita', reportError('registrar visita', err).message)
          }
        }}
      />
    </div>
  )
}

interface Inviter {
  id: string
  name: string
}

function VisitModal({
  open,
  onClose,
  defaultPrice,
  guestPrice,
  methods,
  onSave,
}: {
  open: boolean
  onClose: () => void
  defaultPrice: number
  guestPrice: number
  methods: PaymentMethod[]
  onSave: (v: {
    name: string
    phone: string
    amount: number
    method: PaymentMethod
    invitedBy: Inviter | null
    print: boolean
  }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [invitedBy, setInvitedBy] = useState<Inviter | null>(null)
  const [pickOpen, setPickOpen] = useState(false)
  const [amount, setAmount] = useState(defaultPrice)
  const [method, setMethod] = useState<PaymentMethod>(methods[0] ?? 'cash')
  const [print, setPrint] = useState(true)
  const [busy, setBusy] = useState(false)

  // El precio sugerido cambia solo si es invitado de un socio.
  function pickInviter(inviter: Inviter | null) {
    setInvitedBy(inviter)
    setAmount(
      visitPrice({ visits: { defaultPrice, memberGuestPrice: guestPrice } } as never, Boolean(inviter)),
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar visita"
      description="Un pase de un día. No crea membresía ni ocupa lugar en tu límite de socios."
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={name.trim().length < 3 || amount < 0}
            onClick={async () => {
              setBusy(true)
              try {
                await onSave({ name, phone, amount, method, invitedBy, print })
                setName('')
                setPhone('')
                setInvitedBy(null)
                setAmount(defaultPrice)
              } finally {
                setBusy(false)
              }
            }}
          >
            Cobrar {money0(amount)}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Nombre del visitante"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre de quien entra"
          containerClassName="sm:col-span-2"
          autoFocus
        />
        <Input
          label="Teléfono (opcional)"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="33 0000 0000"
        />
        <div className="min-w-0">
          <p className="mb-1.5 text-[12.5px] font-medium text-ink-300">¿Lo invita un socio?</p>
          {invitedBy ? (
            <div className="flex h-10 items-center gap-2 rounded-xl border border-cyber-400/30 bg-cyber-400/[.07] px-3">
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-100">{invitedBy.name}</span>
              <button
                onClick={() => pickInviter(null)}
                aria-label="Quitar invitador"
                className="rounded-md p-1 text-ink-400 transition hover:bg-white/5 hover:text-ink-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Button variant="ghost" block className="h-10" onClick={() => setPickOpen(true)}>
              No, llega por su cuenta
            </Button>
          )}
          <p className="mt-1 text-[12px] text-ink-500">
            {invitedBy ? `Tarifa de invitado: ${money0(guestPrice)}` : `Tarifa normal: ${money0(defaultPrice)}`}
          </p>
        </div>
        <Input
          label="Importe"
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          prefix="$"
        />
        <Select label="Método de pago" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {methods.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABEL[m]}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[.07] bg-ink-950/40 p-4">
        <Toggle
          checked={print}
          onChange={setPrint}
          label="Imprimir el pase"
          description="Se abre el ticket listo para la impresora."
        />
        <span className="rounded-xl bg-warn-500/10 px-3 py-2 text-[20px] font-bold text-warn-300 tnum">
          {money0(amount)}
        </span>
      </div>

      <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-ink-500">
        <UserPlus className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Si esta persona quiere entrenar seguido, conviértela en socio desde{' '}
        <b className="text-ink-300">Socios → Nuevo socio</b>. Una visita nunca se convierte sola en
        membresía.
      </p>

      <Modal
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        title="¿Qué socio lo invita?"
        description="Se le aplica la tarifa de invitado."
        size="sm"
      >
        <MemberPicker
          onPick={(m) => {
            pickInviter({ id: m.id, name: m.name })
            setPickOpen(false)
          }}
        />
      </Modal>
    </Modal>
  )
}
