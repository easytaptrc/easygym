import { useMemo } from 'react'
import { Banknote, CreditCard, Printer } from 'lucide-react'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { CATEGORY_LABEL, PAYMENT_METHOD_LABEL } from '@/services/billing'
import { printReceipt } from '@/services/printing'
import { fmtDateTime } from '@/lib/date'
import { money, money0 } from '@/lib/format'
import { cx } from '@/lib/utils'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState, LoadingBlock } from '@/components/ui/Feedback'

export default function PortalPayments() {
  const { member, gym, settings } = useSession()
  const payments = useCollection(
    'payments',
    member ? { where: [{ field: 'memberId', op: '==', value: member.id }] } : undefined,
  )

  const rows = useMemo(() => [...payments.data].sort((a, b) => b.createdAt - a.createdAt), [payments.data])
  const total = useMemo(
    () => rows.filter((p) => p.status === 'PAID').reduce((a, p) => a + p.amount, 0),
    [rows],
  )
  const thisYear = useMemo(() => {
    const start = new Date(new Date().getFullYear(), 0, 1).getTime()
    return rows.filter((p) => p.status === 'PAID' && p.createdAt >= start).reduce((a, p) => a + p.amount, 0)
  }, [rows])

  if (!member) return <LoadingBlock />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="text-[11.5px] text-ink-400">Este año</p>
          <p className="mt-1.5 text-[24px] font-bold text-gym tnum">{money0(thisYear)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11.5px] text-ink-400">Histórico</p>
          <p className="mt-1.5 text-[24px] font-bold text-ink-50 tnum">{money0(total)}</p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Mis pagos" subtitle={`${rows.length} movimientos`} icon={<Banknote className="h-4 w-4" />} />
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState icon={<Banknote className="h-6 w-6" />} title="Todavía no tienes pagos registrados" />
          ) : (
            <ul className="divide-y divide-white/[.05]">
              {rows.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[.04] text-ink-400">
                    {p.method === 'stripe' || p.method === 'card' ? (
                      <CreditCard className="h-4 w-4" />
                    ) : (
                      <Banknote className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink-100">{p.concept}</p>
                    <p className="truncate text-[11.5px] text-ink-500">
                      {fmtDateTime(p.createdAt)} · {PAYMENT_METHOD_LABEL[p.method]} · {CATEGORY_LABEL[p.category]}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={cx(
                        'text-[14px] font-semibold tnum',
                        p.status === 'REFUNDED' ? 'text-ink-500 line-through' : 'text-ink-50',
                      )}
                    >
                      {money(p.amount)}
                    </p>
                    <button
                      onClick={() => gym && printReceipt({ gym, settings }, p, member)}
                      className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-ink-500 transition hover:text-gym"
                    >
                      <Printer className="h-3 w-3" />
                      Recibo
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
