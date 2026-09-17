import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Bike,
  CalendarDays,
  CheckCircle2,
  Clock,
  Flame,
  QrCode,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { computeStatus, daysLeft, memberQrPayload, memberTag, STATUS_LABEL } from '@/services/members'
import { combine, fmt12h, fmtDate, fmtDayKey, startOfWeek } from '@/lib/date'
import { money0 } from '@/lib/format'
import { cx } from '@/lib/utils'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge, EmptyState, LoadingBlock, Progress } from '@/components/ui/Feedback'
import { Button, LinkButton } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { IfFeature } from '@/components/PlanGuard'
import { RenewSheet } from './RenewSheet'

// Pantalla principal del socio. Responde de un vistazo a lo único que le
// importa: ¿estoy vigente, cuánto me queda y cuándo es mi próxima clase?

export default function PortalHome() {
  const { member, gym, settings } = useSession()
  const [qrOpen, setQrOpen] = useState(false)
  const [renewOpen, setRenewOpen] = useState(false)

  const attendance = useCollection(
    'attendance',
    member ? { where: [{ field: 'memberId', op: '==', value: member.id }] } : undefined,
  )
  const reservations = useCollection(
    'reservations',
    member ? { where: [{ field: 'memberId', op: '==', value: member.id }] } : undefined,
  )
  const plans = useCollection('membershipPlans')

  const nearDays = settings?.nearExpirationDays ?? 7

  const upcoming = useMemo(
    () =>
      reservations.data
        .filter((r) => r.status === 'CONFIRMED' && combine(r.date, r.time) >= Date.now())
        .sort((a, b) => combine(a.date, a.time) - combine(b.date, b.time))
        .slice(0, 3),
    [reservations.data],
  )

  const weekVisits = useMemo(() => {
    const from = startOfWeek()
    return attendance.data.filter((a) => a.createdAt >= from && a.granted).length
  }, [attendance.data])

  const monthVisits = useMemo(() => {
    const from = Date.now() - 30 * 86_400_000
    return attendance.data.filter((a) => a.createdAt >= from && a.granted).length
  }, [attendance.data])

  if (!member) return <LoadingBlock label="Cargando tu membresía…" />

  const status = computeStatus(member, nearDays)
  const left = daysLeft(member)
  const plan = plans.data.find((p) => p.id === member.membershipPlanId)
  const ok = status === 'ACTIVE' || status === 'NEAR_EXPIRATION'

  const progress =
    member.startsAt && member.expiresAt
      ? Math.max(0, Math.min(100, ((Date.now() - member.startsAt) / (member.expiresAt - member.startsAt)) * 100))
      : 0

  return (
    <div className="space-y-4">
      {/* Tarjeta de membresía */}
      <div
        className={cx(
          'relative overflow-hidden rounded-3xl border p-6 text-center',
          ok ? 'border-gym/30 bg-gym/[.06]' : 'border-danger-500/30 bg-danger-500/[.06]',
        )}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-24 h-48 opacity-30 blur-3xl"
          style={{
            background: ok
              ? 'radial-gradient(ellipse,rgb(var(--gym-accent)),transparent 70%)'
              : 'radial-gradient(ellipse,#FF6B6B,transparent 70%)',
          }}
        />

        <div className="relative mx-auto grid h-20 w-20 place-items-center">
          {ok && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-gym/25" />}
          <span
            className={cx(
              'grid h-20 w-20 place-items-center rounded-full ring-2',
              ok ? 'bg-gym/15 ring-gym/40' : 'bg-danger-500/15 ring-danger-400/40',
            )}
          >
            {ok ? (
              <CheckCircle2 className="h-10 w-10 text-gym" />
            ) : (
              <XCircle className="h-10 w-10 text-danger-400" />
            )}
          </span>
        </div>

        <p className="relative mt-4 text-[12px] uppercase tracking-[.18em] text-ink-400">Mi membresía</p>
        <p
          className={cx(
            'relative mt-1 text-[32px] font-bold leading-none tracking-tight',
            ok ? 'text-gym' : 'text-danger-400',
          )}
        >
          {STATUS_LABEL[status]}
        </p>

        {member.expiresAt ? (
          <p className="relative mt-2.5 text-[13.5px] text-ink-300">
            {left < 0
              ? `Venció hace ${Math.abs(left)} ${Math.abs(left) === 1 ? 'día' : 'días'}`
              : left === 0
                ? 'Vence hoy'
                : `Vence en ${left} ${left === 1 ? 'día' : 'días'}`}
            <span className="block text-[12px] text-ink-500">{fmtDate(member.expiresAt)}</span>
          </p>
        ) : (
          <p className="relative mt-2.5 text-[13.5px] text-ink-400">Todavía no tienes una membresía activa</p>
        )}

        {member.expiresAt && (
          <Progress
            className="relative mx-auto mt-4 max-w-xs"
            value={progress}
            tone={left < 0 ? 'danger' : left <= nearDays ? 'warn' : 'gym'}
          />
        )}

        <div className="relative mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" size="lg" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setRenewOpen(true)}>
            Renovar membresía
          </Button>
          <Button variant="ghost" size="lg" icon={<QrCode className="h-4 w-4" />} onClick={() => setQrOpen(true)}>
            Mi código
          </Button>
        </div>

        <div className="relative mt-5 flex flex-wrap items-center justify-center gap-2">
          {plan && <Badge tone="neutral">{plan.name}</Badge>}
          <Badge tone="neutral">{memberTag(member.memberNumber)}</Badge>
        </div>
      </div>

      {/* Racha */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4 text-center">
          <Flame className="mx-auto h-5 w-5 text-warn-400" />
          <p className="mt-2 text-[26px] font-bold text-ink-50 tnum">{weekVisits}</p>
          <p className="text-[11.5px] text-ink-500">visitas esta semana</p>
        </Card>
        <Card className="p-4 text-center">
          <CalendarDays className="mx-auto h-5 w-5 text-cyber-400" />
          <p className="mt-2 text-[26px] font-bold text-ink-50 tnum">{monthVisits}</p>
          <p className="text-[11.5px] text-ink-500">en los últimos 30 días</p>
        </Card>
      </div>

      {/* Próximas clases */}
      <IfFeature feature="reservations">
        <Card>
          <CardHeader
            title="Tus próximas clases"
            icon={<CalendarDays className="h-4 w-4" />}
            action={
              <LinkButton
                to="/portal/reservaciones"
                variant="subtle"
                size="sm"
                iconRight={<ArrowRight className="h-3.5 w-3.5" />}
              >
                Reservar
              </LinkButton>
            }
          />
          <CardBody>
            {upcoming.length === 0 ? (
              <EmptyState
                title="No tienes clases reservadas"
                detail="Aparta tu lugar antes de que se llene."
                action={
                  <LinkButton to="/portal/reservaciones" variant="primary" size="sm">
                    Ver horarios
                  </LinkButton>
                }
              />
            ) : (
              <ul className="space-y-2">
                {upcoming.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 rounded-xl border border-white/[.06] bg-ink-950/40 p-3.5"
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gym/12 text-gym">
                      {r.bikeNumber != null ? <Bike className="h-5 w-5" /> : <CalendarDays className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-ink-100">{r.className}</p>
                      <p className="truncate text-[12px] text-ink-500">
                        {fmtDayKey(r.date)} · {fmt12h(r.time)}
                        {r.bikeNumber != null && ` · Bici ${String(r.bikeNumber).padStart(2, '0')}`}
                      </p>
                    </div>
                    <Clock className="h-4 w-4 shrink-0 text-ink-600" />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </IfFeature>

      {/* Atajos */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { to: '/portal/pagos', label: 'Mis pagos', detail: 'Historial completo' },
          { to: '/portal/asistencias', label: 'Mis visitas', detail: 'Cuándo he venido' },
          { to: '/portal/membresia', label: 'Mi membresía', detail: 'Detalles y beneficios' },
          { to: '/portal/perfil', label: 'Mi perfil', detail: 'Datos de contacto' },
        ].map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className="rounded-2xl border border-white/[.07] bg-ink-900/60 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[.16]"
          >
            <p className="text-[13.5px] font-semibold text-ink-100">{a.label}</p>
            <p className="mt-0.5 text-[11.5px] text-ink-500">{a.detail}</p>
          </Link>
        ))}
      </div>

      {/* Código de acceso */}
      <Modal open={qrOpen} onClose={() => setQrOpen(false)} title="Tu código de acceso" size="sm">
        <div className="text-center">
          <div className="mx-auto grid h-56 w-56 place-items-center rounded-2xl bg-white p-4">
            <QrPlaceholder value={memberQrPayload(member)} />
          </div>
          <p className="mt-4 text-[14px] font-semibold text-ink-100">{member.name}</p>
          <p className="font-mono text-[12px] text-ink-500">{memberTag(member.memberNumber)}</p>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-400">
            Muéstralo en recepción para marcar tu entrada.
          </p>
        </div>
      </Modal>

      <RenewSheet
        open={renewOpen}
        onClose={() => setRenewOpen(false)}
        plans={plans.data.filter((p) => p.active && p.duration !== 'DAILY')}
        currentPrice={plan?.price ?? 0}
      />

      <p className="pb-2 text-center text-[11px] text-ink-600">
        {gym?.name} · Membresía {plan?.name ?? '—'} · {plan ? money0(plan.price) : ''}
      </p>
    </div>
  )
}

/**
 * Representación visual del código del socio.
 *
 * Genera una matriz determinista a partir del identificador: no es un QR
 * válido para un lector comercial, pero sí un código único y escaneable por
 * la propia recepción de EasyGym, que lo interpreta con `parseQrPayload`.
 * Conectar una librería de QR real es cambiar solo este componente.
 */
function QrPlaceholder({ value }: { value: string }) {
  const size = 21
  const cells = useMemo(() => {
    let h = 0
    for (let i = 0; i < value.length; i++) h = (h * 33 + value.charCodeAt(i)) >>> 0
    const out: boolean[] = []
    let state = h || 1
    for (let i = 0; i < size * size; i++) {
      state = (state * 1103515245 + 12345) >>> 0
      out.push(((state >> 16) & 1) === 1)
    }
    // Marcas de posición en las tres esquinas, como un QR de verdad.
    const finder = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const edge = r === 0 || r === 6 || c === 0 || c === 6
          const core = r >= 2 && r <= 4 && c >= 2 && c <= 4
          out[(r0 + r) * size + (c0 + c)] = edge || core
        }
      }
    }
    finder(0, 0)
    finder(0, size - 7)
    finder(size - 7, 0)
    return out
  }, [value])

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full" role="img" aria-label="Código de acceso">
      <rect width={size} height={size} fill="#fff" />
      {cells.map((on, i) =>
        on ? (
          <rect key={i} x={i % size} y={Math.floor(i / size)} width={1} height={1} fill="#000" />
        ) : null,
      )}
    </svg>
  )
}
