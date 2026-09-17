import { useMemo, useState } from 'react'
import { Check, RefreshCw } from 'lucide-react'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { computeStatus, daysLeft, memberTag } from '@/services/members'
import { fmtDate } from '@/lib/date'
import { money } from '@/lib/format'
import { cx } from '@/lib/utils'
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card'
import { Badge, LoadingBlock, Progress, StatusChip } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { RenewSheet } from './RenewSheet'

export default function PortalMembership() {
  const { member, settings, gym } = useSession()
  const plans = useCollection('membershipPlans')
  const memberships = useCollection(
    'memberships',
    member ? { where: [{ field: 'memberId', op: '==', value: member.id }] } : undefined,
  )
  const [renewOpen, setRenewOpen] = useState(false)

  const history = useMemo(
    () => [...memberships.data].sort((a, b) => b.createdAt - a.createdAt),
    [memberships.data],
  )

  if (!member) return <LoadingBlock />

  const nearDays = settings?.nearExpirationDays ?? 7
  const status = computeStatus(member, nearDays)
  const left = daysLeft(member)
  const plan = plans.data.find((p) => p.id === member.membershipPlanId)
  const progress =
    member.startsAt && member.expiresAt
      ? Math.max(0, Math.min(100, ((Date.now() - member.startsAt) / (member.expiresAt - member.startsAt)) * 100))
      : 0

  return (
    <div className="space-y-4">
      <Card lit>
        <CardHeader
          title="Mi membresía"
          subtitle={gym?.name}
          action={<StatusChip status={status} />}
        />
        <CardBody>
          <p className="text-[28px] font-bold tracking-tight text-ink-50">{plan?.name ?? 'Sin membresía'}</p>
          {plan && <p className="mt-1 text-[14px] text-gym tnum">{money(plan.price)}</p>}

          {member.expiresAt && (
            <>
              <Progress
                className="mt-5"
                value={progress}
                tone={left < 0 ? 'danger' : left <= nearDays ? 'warn' : 'gym'}
              />
              <div className="mt-2 flex justify-between text-[11.5px] text-ink-500 tnum">
                <span>{fmtDate(member.startsAt)}</span>
                <span>{fmtDate(member.expiresAt)}</span>
              </div>
            </>
          )}

          <div className="mt-5 divide-y divide-white/[.05]">
            <DetailRow label="Número de socio">{memberTag(member.memberNumber)}</DetailRow>
            <DetailRow label="Inicio">{fmtDate(member.startsAt)}</DetailRow>
            <DetailRow label="Vencimiento">{fmtDate(member.expiresAt)}</DetailRow>
            <DetailRow label="Días restantes">
              <span
                className={cx(
                  left < 0 ? 'text-danger-400' : left <= nearDays ? 'text-warn-400' : 'text-gym',
                )}
              >
                {member.expiresAt ? (left < 0 ? `Venció hace ${Math.abs(left)}` : left) : '—'}
              </span>
            </DetailRow>
            <DetailRow label="Próximo pago">{fmtDate(member.expiresAt)}</DetailRow>
          </div>

          <Button
            variant="primary"
            size="lg"
            block
            className="mt-5"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => setRenewOpen(true)}
          >
            Renovar membresía
          </Button>
        </CardBody>
      </Card>

      {plan && plan.benefits.length > 0 && (
        <Card>
          <CardHeader title="Qué incluye tu membresía" />
          <CardBody>
            <ul className="space-y-2.5">
              {plan.benefits.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-[13.5px] text-ink-200">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-gym" />
                  {b}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Historial de membresías" subtitle={`${history.length} contrataciones`} />
        <CardBody>
          {history.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-500">Sin historial todavía.</p>
          ) : (
            <ul className="divide-y divide-white/[.05]">
              {history.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink-100">{m.planName}</p>
                    <p className="text-[11.5px] text-ink-500 tnum">
                      {fmtDate(m.startsAt)} — {fmtDate(m.expiresAt)}
                    </p>
                  </div>
                  <Badge tone={m.kind === 'RENEWAL' ? 'cyber' : 'gym'}>
                    {m.kind === 'RENEWAL' ? 'Renovación' : 'Nueva'}
                  </Badge>
                  <span className="shrink-0 text-[13px] font-semibold text-ink-100 tnum">
                    {money(m.price)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <RenewSheet
        open={renewOpen}
        onClose={() => setRenewOpen(false)}
        plans={plans.data.filter((p) => p.active && p.duration !== 'DAILY')}
        currentPrice={plan?.price ?? 0}
      />
    </div>
  )
}
