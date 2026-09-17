import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Ban,
  Banknote,
  CalendarCheck,
  CreditCard,
  Fingerprint,
  IdCard,
  Mail,
  Pencil,
  Phone,
  Printer,
  RefreshCw,
  RotateCcw,
  Ticket,
  TriangleAlert,
} from 'lucide-react'
import type { MembershipPlan, PaymentMethod } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection, useDocument } from '@/hooks/useCollection'
import { useToast } from '@/hooks/useToast'
import {
  contractMembership,
  daysLeft,
  deactivateMember,
  memberTag,
  reactivateMember,
  computeStatus,
} from '@/services/members'
import { CATEGORY_LABEL, PAYMENT_METHOD_LABEL } from '@/services/billing'
import { CHECKIN_METHOD_LABEL } from '@/services/access'
import { Fingerprint as FingerprintService } from '@/services/fingerprint'
import { printContract, printMemberCard, printReceipt } from '@/services/printing'
import { ageFrom, fmtDate, fmtDateTime, fmt12h } from '@/lib/date'
import { money, money0, phoneFmt } from '@/lib/format'
import { cx } from '@/lib/utils'
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card'
import { Avatar, Badge, EmptyState, FullPageLoader, Progress, StatusChip } from '@/components/ui/Feedback'
import { Button, IconButton, LinkButton } from '@/components/ui/Button'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Segmented, Select, Toggle } from '@/components/ui/Inputs'
import { MemberFormModal } from './MemberFormModal'
import { IfFeature } from '@/components/PlanGuard'

type Tab = 'resumen' | 'pagos' | 'asistencias' | 'reservaciones' | 'visitas'

export default function MemberProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const { repo, gym, settings, user } = useSession()

  const { data: member, loading } = useDocument('members', id)
  const plans = useCollection('membershipPlans')
  const payments = useCollection(
    'payments',
    id ? { where: [{ field: 'memberId', op: '==', value: id }] } : undefined,
  )
  const attendance = useCollection(
    'attendance',
    id ? { where: [{ field: 'memberId', op: '==', value: id }] } : undefined,
  )
  const reservations = useCollection(
    'reservations',
    id ? { where: [{ field: 'memberId', op: '==', value: id }] } : undefined,
  )
  const visits = useCollection(
    'visits',
    id ? { where: [{ field: 'invitedByMemberId', op: '==', value: id }] } : undefined,
  )
  const [tab, setTab] = useState<Tab>('resumen')
  const [editOpen, setEditOpen] = useState(false)
  const [renewOpen, setRenewOpen] = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const [enrolling, setEnrolling] = useState(false)
  const [enrollProgress, setEnrollProgress] = useState<{ n: number; total: number } | null>(null)

  const nearDays = settings?.nearExpirationDays ?? 7
  const status = member ? computeStatus(member, nearDays) : 'EXPIRED'
  const left = member ? daysLeft(member) : 0
  const plan = plans.data.find((p) => p.id === member?.membershipPlanId) ?? null

  const sortedPayments = useMemo(
    () => [...payments.data].sort((a, b) => b.createdAt - a.createdAt),
    [payments.data],
  )
  const sortedAttendance = useMemo(
    () => [...attendance.data].sort((a, b) => b.createdAt - a.createdAt),
    [attendance.data],
  )
  const sortedReservations = useMemo(
    () => [...reservations.data].sort((a, b) => b.createdAt - a.createdAt),
    [reservations.data],
  )
  const totalPaid = useMemo(
    () => sortedPayments.filter((p) => p.status === 'PAID').reduce((a, p) => a + p.amount, 0),
    [sortedPayments],
  )

  if (loading) return <FullPageLoader label="Cargando socio…" />
  if (!member) {
    return (
      <EmptyState
        title="Este socio no existe"
        detail="Puede que haya sido eliminado, o que pertenezca a otro gimnasio."
        action={
          <LinkButton to="/socios" variant="primary">
            Volver a socios
          </LinkButton>
        }
      />
    )
  }

  async function enrollFingerprint() {
    if (!repo || !member) return
    setEnrolling(true)
    setEnrollProgress({ n: 0, total: 3 })
    try {
      const result = await FingerprintService.registerFingerprint(member.id, (n, total) =>
        setEnrollProgress({ n, total }),
      )
      await repo.update('members', member.id, { fingerprintId: result.fingerprintId })
      toast.success('Huella registrada', `Calidad ${result.quality}% · ${result.captures} capturas`)
    } catch {
      toast.error('No se pudo registrar la huella')
    } finally {
      setEnrolling(false)
      setEnrollProgress(null)
    }
  }

  const progressPct =
    member.startsAt && member.expiresAt
      ? Math.max(
          0,
          Math.min(100, ((Date.now() - member.startsAt) / (member.expiresAt - member.startsAt)) * 100),
        )
      : 0

  return (
    <div className="mx-auto max-w-[1200px]">
      <Link
        to="/socios"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-400 transition hover:text-ink-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Socios
      </Link>

      {/* Cabecera del socio */}
      <Card lit className="mb-4 overflow-hidden">
        <div className="flex flex-wrap items-start gap-5 p-5 sm:p-6">
          <div className="relative">
            <Avatar name={member.name} src={member.photoUrl} size={76} ring />
            {member.fingerprintId && (
              <span
                className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full bg-gym text-ink-950 ring-4 ring-ink-900"
                title="Huella registrada"
              >
                <Fingerprint className="h-3.5 w-3.5" />
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[24px] font-bold tracking-tight text-ink-50">{member.name}</h1>
              <StatusChip status={status} />
            </div>
            <p className="mt-1 font-mono text-[12px] text-ink-500">{memberTag(member.memberNumber)}</p>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
              <a
                href={`tel:${member.phone}`}
                className="flex items-center gap-1.5 text-[13px] text-ink-300 transition hover:text-gym"
              >
                <Phone className="h-3.5 w-3.5" />
                {phoneFmt(member.phone)}
              </a>
              {member.email && (
                <a
                  href={`mailto:${member.email}`}
                  className="flex items-center gap-1.5 text-[13px] text-ink-300 transition hover:text-gym"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {member.email}
                </a>
              )}
              {member.birthDate && (
                <span className="text-[13px] text-ink-400">{ageFrom(member.birthDate)} años</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <IconButton label="Editar" variant="ghost" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
            </IconButton>
            <IconButton
              label="Imprimir credencial"
              variant="ghost"
              onClick={() => gym && printMemberCard({ gym, settings }, member)}
            >
              <IdCard className="h-4 w-4" />
            </IconButton>
            <Button
              variant="primary"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => setRenewOpen(true)}
            >
              {member.expiresAt ? 'Renovar' : 'Contratar membresía'}
            </Button>
          </div>
        </div>

        {/* Franja de vigencia */}
        <div className="border-t border-white/[.06] bg-ink-950/40 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-500">Membresía</p>
                <p className="text-[14px] font-semibold text-ink-100">{plan?.name ?? 'Sin membresía'}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-500">Inicio</p>
                <p className="text-[14px] font-semibold text-ink-100 tnum">{fmtDate(member.startsAt)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-500">Vencimiento</p>
                <p className="text-[14px] font-semibold text-ink-100 tnum">{fmtDate(member.expiresAt)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-500">Días restantes</p>
                <p
                  className={cx(
                    'text-[14px] font-semibold tnum',
                    left < 0 ? 'text-danger-400' : left <= nearDays ? 'text-warn-400' : 'text-tap-400',
                  )}
                >
                  {member.expiresAt ? (left < 0 ? `Venció hace ${Math.abs(left)}` : left) : '—'}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-500">Total pagado</p>
                <p className="text-[14px] font-semibold text-gym tnum">{money0(totalPaid)}</p>
              </div>
            </div>
          </div>
          {member.expiresAt && (
            <Progress
              className="mt-3"
              value={progressPct}
              tone={left < 0 ? 'danger' : left <= nearDays ? 'warn' : 'gym'}
            />
          )}
        </div>
      </Card>

      {/* Pestañas */}
      <Segmented
        value={tab}
        onChange={setTab}
        className="mb-4"
        options={[
          { value: 'resumen', label: 'Resumen' },
          { value: 'pagos', label: `Pagos (${sortedPayments.length})` },
          { value: 'asistencias', label: `Asistencias (${sortedAttendance.length})` },
          { value: 'reservaciones', label: `Reservaciones (${sortedReservations.length})` },
          { value: 'visitas', label: `Invitados (${visits.data.length})` },
        ]}
      />

      {/* ── Resumen ── */}
      {tab === 'resumen' && (
        <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
          <Card>
            <CardHeader title="Datos del socio" />
            <CardBody className="divide-y divide-white/[.05]">
              <DetailRow label="Nombre">{member.name}</DetailRow>
              <DetailRow label="Número de socio">{memberTag(member.memberNumber)}</DetailRow>
              <DetailRow label="Teléfono">{phoneFmt(member.phone)}</DetailRow>
              <DetailRow label="Correo">{member.email || '—'}</DetailRow>
              <DetailRow label="Nacimiento">
                {member.birthDate ? `${member.birthDate} (${ageFrom(member.birthDate)} años)` : '—'}
              </DetailRow>
              <DetailRow label="Contacto de emergencia">
                {member.emergencyContact
                  ? `${member.emergencyContact.name} · ${phoneFmt(member.emergencyContact.phone)}`
                  : '—'}
              </DetailRow>
              <DetailRow label="Alta">{fmtDate(member.createdAt)}</DetailRow>
              {member.notes && (
                <div className="pt-3">
                  <p className="mb-1 text-[12.5px] text-ink-400">Notas</p>
                  <p className="text-[13px] leading-relaxed text-ink-200">{member.notes}</p>
                </div>
              )}
            </CardBody>
          </Card>

          <div className="space-y-3">
            {/* Huella */}
            <IfFeature feature="fingerprint">
              <Card>
                <CardHeader
                  title="Huella digital"
                  subtitle="Solo se guarda un identificador, nunca la imagen de la huella"
                  icon={<Fingerprint className="h-4 w-4" />}
                />
                <CardBody>
                  {enrolling ? (
                    <div className="scanner rounded-xl border border-gym/25 bg-gym/[.06] py-8 text-center">
                      <Fingerprint className="mx-auto h-9 w-9 animate-pulse text-gym" />
                      <p className="mt-3 text-[13px] font-medium text-gym">
                        Captura {enrollProgress?.n ?? 0} de {enrollProgress?.total ?? 3}
                      </p>
                      <p className="mt-1 text-[12px] text-ink-400">Coloca el dedo en el lector…</p>
                    </div>
                  ) : member.fingerprintId ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Badge tone="gym" dot>
                          Registrada
                        </Badge>
                        <p className="mt-2 truncate font-mono text-[11px] text-ink-500">
                          {member.fingerprintId}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          if (!repo) return
                          await FingerprintService.deleteFingerprint(repo, member.id)
                          toast.info('Huella eliminada')
                        }}
                      >
                        Eliminar
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-[13px] text-ink-400">Este socio no tiene huella registrada.</p>
                      <Button
                        variant="ghost"
                        className="mt-3"
                        icon={<Fingerprint className="h-4 w-4" />}
                        onClick={enrollFingerprint}
                      >
                        Registrar huella
                      </Button>
                    </div>
                  )}
                </CardBody>
              </Card>
            </IfFeature>

            {/* Documentos */}
            <Card>
              <CardHeader title="Documentos" icon={<Printer className="h-4 w-4" />} />
              <CardBody className="grid grid-cols-2 gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IdCard className="h-3.5 w-3.5" />}
                  onClick={() => gym && printMemberCard({ gym, settings }, member)}
                >
                  Credencial
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Printer className="h-3.5 w-3.5" />}
                  onClick={() =>
                    gym && printContract({ gym, settings }, member, plan?.name ?? '—', plan?.price ?? 0)
                  }
                >
                  Contrato
                </Button>
              </CardBody>
            </Card>

            {/* Zona delicada */}
            <Card>
              <CardHeader title="Estado de la cuenta" />
              <CardBody>
                {member.status === 'INACTIVE' ? (
                  <>
                    <p className="text-[13px] leading-relaxed text-ink-400">
                      Este socio está dado de baja. Su historial se conserva íntegro.
                    </p>
                    <Button
                      variant="ghost"
                      className="mt-3"
                      icon={<RotateCcw className="h-4 w-4" />}
                      onClick={async () => {
                        if (!repo) return
                        await reactivateMember(repo, member.id)
                        toast.success('Socio reactivado')
                      }}
                    >
                      Reactivar socio
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] leading-relaxed text-ink-400">
                      Dar de baja bloquea su acceso, pero <b className="text-ink-200">no borra nada</b>:
                      pagos, asistencias y reservaciones se conservan.
                    </p>
                    <Button
                      variant="ghost"
                      className="mt-3 text-danger-300"
                      icon={<Ban className="h-4 w-4" />}
                      onClick={() => setConfirmDeactivate(true)}
                    >
                      Dar de baja
                    </Button>
                  </>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {/* ── Pagos ── */}
      {tab === 'pagos' && (
        <Card>
          <CardHeader title="Historial de pagos" subtitle={`${money(totalPaid)} en total`} />
          {sortedPayments.length === 0 ? (
            <EmptyState icon={<Banknote className="h-6 w-6" />} title="Sin pagos registrados" />
          ) : (
            <ul className="divide-y divide-white/[.05] px-5 pb-4">
              {sortedPayments.map((p) => (
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
                      {fmtDateTime(p.createdAt)} · {PAYMENT_METHOD_LABEL[p.method]} ·{' '}
                      {CATEGORY_LABEL[p.category]}
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
                      className="text-[11px] text-ink-500 transition hover:text-gym"
                    >
                      Imprimir recibo
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ── Asistencias ── */}
      {tab === 'asistencias' && (
        <Card>
          <CardHeader
            title="Asistencias"
            subtitle={`${sortedAttendance.length} entradas registradas`}
            icon={<Fingerprint className="h-4 w-4" />}
          />
          {sortedAttendance.length === 0 ? (
            <EmptyState title="Este socio aún no registra entradas" />
          ) : (
            <ul className="divide-y divide-white/[.05] px-5 pb-4">
              {sortedAttendance.slice(0, 60).map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2.5">
                  <span
                    className={cx(
                      'h-2 w-2 shrink-0 rounded-full',
                      a.granted ? 'bg-tap-400' : 'bg-danger-400',
                    )}
                  />
                  <span className="min-w-0 flex-1 text-[13px] text-ink-200 tnum">
                    {fmtDateTime(a.createdAt)}
                  </span>
                  <Badge tone="neutral">{CHECKIN_METHOD_LABEL[a.method]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ── Reservaciones ── */}
      {tab === 'reservaciones' && (
        <Card>
          <CardHeader title="Reservaciones" icon={<CalendarCheck className="h-4 w-4" />} />
          {sortedReservations.length === 0 ? (
            <EmptyState title="Sin reservaciones" detail="Este socio no ha reservado ninguna clase." />
          ) : (
            <ul className="divide-y divide-white/[.05] px-5 pb-4">
              {sortedReservations.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink-100">
                      {r.className}
                      {r.bikeNumber != null && (
                        <span className="ml-2 font-mono text-[11.5px] text-gym">
                          Bici {String(r.bikeNumber).padStart(2, '0')}
                        </span>
                      )}
                    </p>
                    <p className="text-[11.5px] text-ink-500">
                      {r.date} · {fmt12h(r.time)}
                    </p>
                  </div>
                  <Badge
                    tone={
                      r.status === 'CANCELLED'
                        ? 'danger'
                        : r.status === 'ATTENDED'
                          ? 'tap'
                          : r.status === 'NO_SHOW'
                            ? 'warn'
                            : 'cyber'
                    }
                  >
                    {
                      {
                        CONFIRMED: 'Confirmada',
                        CANCELLED: 'Cancelada',
                        ATTENDED: 'Asistió',
                        NO_SHOW: 'No asistió',
                      }[r.status]
                    }
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ── Visitas invitadas ── */}
      {tab === 'visitas' && (
        <Card>
          <CardHeader
            title="Visitas que ha invitado"
            subtitle="Pases de un día comprados por este socio para otras personas"
            icon={<Ticket className="h-4 w-4" />}
          />
          {visits.data.length === 0 ? (
            <EmptyState title="No ha invitado a nadie todavía" />
          ) : (
            <ul className="divide-y divide-white/[.05] px-5 pb-4">
              {visits.data
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((v) => (
                  <li key={v.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-ink-100">{v.name}</p>
                      <p className="text-[11.5px] text-ink-500">
                        {v.date} · {v.time}
                      </p>
                    </div>
                    <span className="text-[13.5px] font-semibold text-ink-100 tnum">{money(v.amount)}</span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      )}

      {/* Modales */}
      <MemberFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        member={member}
        plans={plans.data}
        currentMemberCount={0}
      />

      <RenewModal
        open={renewOpen}
        onClose={() => setRenewOpen(false)}
        plans={plans.data.filter((p) => p.active)}
        currentPlanId={member.membershipPlanId ?? null}
        onConfirm={async (planId, method, chargeIt) => {
          if (!repo) return
          const selected = plans.data.find((p) => p.id === planId)
          if (!selected) return
          await contractMembership(repo, {
            member,
            plan: selected,
            kind: member.expiresAt ? 'RENEWAL' : 'NEW',
            method,
            skipPayment: !chargeIt,
            collectedBy: user?.uid ?? null,
          })
          toast.success(
            member.expiresAt ? '¡Membresía renovada!' : '¡Membresía contratada!',
            `${selected.name} · ${chargeIt ? money0(selected.price) + ' cobrados' : 'sin cobro'}`,
          )
          setRenewOpen(false)
        }}
        methods={settings?.payments.methods ?? ['cash', 'card', 'transfer']}
        currentExpiry={member.expiresAt ?? null}
      />

      <ConfirmModal
        open={confirmDeactivate}
        onClose={() => setConfirmDeactivate(false)}
        title="¿Dar de baja a este socio?"
        message={`${member.name} dejará de tener acceso al gimnasio. Su historial de pagos, asistencias y reservaciones se conserva y puedes reactivarlo en cualquier momento.`}
        confirmLabel="Dar de baja"
        onConfirm={async () => {
          if (!repo) return
          await deactivateMember(repo, member.id)
          toast.info('Socio dado de baja', member.name)
          setConfirmDeactivate(false)
          navigate('/socios')
        }}
      />
    </div>
  )
}

// ══════════════════════════ Modal de renovación ════════════════════════════

function RenewModal({
  open,
  onClose,
  plans,
  currentPlanId,
  onConfirm,
  methods,
  currentExpiry,
}: {
  open: boolean
  onClose: () => void
  plans: MembershipPlan[]
  currentPlanId: string | null
  onConfirm: (planId: string, method: PaymentMethod, charge: boolean) => Promise<void>
  methods: PaymentMethod[]
  currentExpiry: number | null
}) {
  const [planId, setPlanId] = useState(currentPlanId ?? plans[0]?.id ?? '')
  const [method, setMethod] = useState<PaymentMethod>(methods[0] ?? 'cash')
  const [charge, setCharge] = useState(true)
  const [busy, setBusy] = useState(false)

  const selected = plans.find((p) => p.id === planId)
  const stillValid = currentExpiry !== null && currentExpiry > Date.now()
  const newExpiry = selected
    ? (stillValid ? currentExpiry : Date.now()) + selected.days * 86_400_000
    : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={currentExpiry ? 'Renovar membresía' : 'Contratar membresía'}
      size="md"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!planId}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm(planId, method, charge)
              } finally {
                setBusy(false)
              }
            }}
          >
            {charge && selected ? `Cobrar ${money0(selected.price)}` : 'Aplicar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select label="Plan de membresía" value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {money0(p.price)} · {p.days} días
            </option>
          ))}
        </Select>

        <Select
          label="Método de pago"
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          disabled={!charge}
        >
          {methods.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABEL[m]}
            </option>
          ))}
        </Select>

        <Toggle
          checked={charge}
          onChange={setCharge}
          label="Registrar el cobro"
          description="Desactívalo si es cortesía o si ya pagó por otro medio."
        />

        {stillValid && (
          <div className="flex items-start gap-2.5 rounded-xl border border-cyber-400/20 bg-cyber-400/[.07] px-3.5 py-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-cyber-300" />
            <p className="text-[12.5px] leading-relaxed text-cyber-100">
              Su membresía sigue vigente. Los días nuevos se <b>suman</b> a partir del{' '}
              {fmtDate(currentExpiry)}: renovar antes no le quita días.
            </p>
          </div>
        )}

        {newExpiry && (
          <div className="rounded-xl border border-white/[.07] bg-ink-950/50 p-4">
            <DetailRow label="Vigencia actual">{fmtDate(currentExpiry)}</DetailRow>
            <DetailRow label="Nueva vigencia">
              <span className="text-gym">{fmtDate(newExpiry)}</span>
            </DetailRow>
            {selected && (
              <DetailRow label="Importe">
                <span className={cx(charge ? 'text-ink-50' : 'text-ink-500 line-through')}>
                  {money(selected.price)}
                </span>
              </DetailRow>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
