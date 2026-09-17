import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Fingerprint,
  IdCard,
  LayoutDashboard,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  Ticket,
  X,
  XCircle,
} from 'lucide-react'
import type { Member, PaymentMethod } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { useToast } from '@/hooks/useToast'
import { evaluateAccess, recordAttendance, type AccessResult } from '@/services/access'
import { Fingerprint as FingerprintService } from '@/services/fingerprint'
import { contractMembership, memberTag, parseQrPayload } from '@/services/members'
import { registerVisit } from '@/services/billing'
import { searchProvider } from '@/services/search'
import { printMemberCard, printReceipt, printVisitTicket } from '@/services/printing'
import { dayKey, fmtDate, timeKey } from '@/lib/date'
import { money0, phoneFmt } from '@/lib/format'
import { reportError } from '@/lib/errors'
import { cx } from '@/lib/utils'
import { Logo } from '@/components/ui/Logo'
import { Backdrop } from '@/components/ui/Backdrop'
import { Avatar, Badge, StatusChip } from '@/components/ui/Feedback'
import { Button, IconButton } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, SearchInput, Select } from '@/components/ui/Inputs'
import { MemberPicker } from '@/components/MemberPicker'
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus'
import { IfFeature } from '@/components/PlanGuard'

// ═══════════════════════════════════════════════════════════════════════════
// Recepción — pantalla completa, sin sidebar.
//
// Se diseña para que alguien la opere de pie, con gente esperando: la
// respuesta ocupa media pantalla y se lee desde dos metros. Tres acciones,
// nada más: escanear, buscar, cobrar visita.
// ═══════════════════════════════════════════════════════════════════════════

export default function Reception() {
  const { repo, gym, settings, user } = useSession()
  const toast = useToast()
  const navigate = useNavigate()

  const plans = useCollection('membershipPlans')

  // Solo las entradas de HOY. Antes se traía la colección entera para enseñar
  // las últimas doce: en un gimnasio con 500 entradas diarias, eso son 180 000
  // documentos al año descargados cada vez que alguien abre la recepción.
  const attendance = useCollection(
    'attendance',
    useMemo(
      () => ({
        where: [{ field: 'date', op: '==' as const, value: dayKey() }],
        orderBy: { field: 'createdAt' as const, dir: 'desc' as const },
        limit: 40,
      }),
      [],
    ),
  )

  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<Member[]>([])
  const [searching, setSearching] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<AccessResult | null>(null)
  const [visitOpen, setVisitOpen] = useState(false)
  const [renewOpen, setRenewOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const clearTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => () => clearTimeout(clearTimer.current), [])

  // Búsqueda resuelta en el SERVIDOR. Antes se filtraba en memoria sobre la
  // colección entera de socios, lo que obligaba a tenerla toda descargada.
  useEffect(() => {
    if (!repo) return
    const term = query.trim()
    if (!term) {
      setCandidates([])
      setSearching(false)
      return
    }

    let live = true
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        // Un código QR pegado en la caja de búsqueda también entra por aquí.
        const qr = parseQrPayload(term)
        if (qr) {
          const m = await repo.get('members', qr.memberId)
          if (live) setCandidates(m ? [m] : [])
          return
        }
        const found = await searchProvider.searchMembers(repo, term, 6)
        if (live) setCandidates(found.map((r) => r.member))
      } catch (err) {
        reportError('buscar socio en recepción', err)
        if (live) setCandidates([])
      } finally {
        if (live) setSearching(false)
      }
    }, 200)

    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [repo, query])

  // `attendance` ya viene del día de hoy y ordenada: aquí solo se recorta.
  //
  // dayKey() usa la fecha LOCAL. `toISOString()` daría la fecha UTC, que a
  // partir de las 18:00 en México ya es el día siguiente: la recepción se
  // quedaría en blanco justo en la hora pico.
  const todayAttendance = useMemo(() => attendance.data.slice(0, 12), [attendance.data])

  /** Evalúa el acceso y registra la asistencia. Núcleo de esta pantalla. */
  const checkIn = useCallback(
    async (member: Member, method: 'fingerprint' | 'qr' | 'reception') => {
      if (!repo) return
      try {
        const evaluation = await evaluateAccess(repo, member, settings)
        await recordAttendance(repo, member, method, evaluation.granted)
        setResult(evaluation)
        setQuery('')
        // La pantalla vuelve sola a su estado de espera.
        clearTimeout(clearTimer.current)
        clearTimer.current = setTimeout(() => setResult(null), evaluation.granted ? 9000 : 14000)
      } catch (err) {
        // Suscripción suspendida, permisos o red. Nunca se deja la pantalla
        // en silencio: quien está en el mostrador tiene que saber qué pasó.
        toast.error('No se pudo registrar la entrada', reportError('registrar entrada', err).message)
      }
    },
    [repo, settings, toast],
  )

  async function scan() {
    if (!repo) return
    setScanning(true)
    setResult(null)
    try {
      const scanResult = await FingerprintService.scanFingerprint(repo)
      if (!scanResult.ok || !scanResult.fingerprintId) {
        toast.warning('Huella no reconocida', 'Pide al socio que lo intente de nuevo.')
        return
      }
      const member = await FingerprintService.identifyMember(repo, scanResult.fingerprintId)
      if (!member) {
        toast.warning('Huella sin socio asociado', 'Regístrala desde el perfil del socio.')
        return
      }
      await checkIn(member, 'fingerprint')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="relative min-h-screen">
      <Backdrop variant="app" />

      {/* Barra superior */}
      <header className="sticky top-0 z-30 border-b border-white/[.06] bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
          <Logo size="xs" still />
          <span className="hidden text-[13px] text-ink-500 sm:inline">·</span>
          <span className="hidden truncate text-[13px] font-medium text-ink-300 sm:inline">
            {gym?.name} · Recepción
          </span>
          {/* Quien está en el mostrador tiene que ver de un vistazo si sigue
              habiendo conexión — y que puede seguir trabajando si no la hay. */}
          <span className="ml-auto flex items-center gap-2.5">
            <ConnectionStatus compact />
            <span className="font-mono text-[13px] text-ink-400 tnum">{timeKey(now)}</span>
          </span>
          <IconButton label="Ir al panel" variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
            <LayoutDashboard className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
        {/* Solo aparece cuando hay algo que decir: sin conexión o con eventos
            esperando. En condiciones normales no ocupa sitio. */}
        <OfflineBanner />

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            {/* Panel de acceso */}
            {result ? (
              <AccessPanel
                result={result}
                onClose={() => setResult(null)}
                onRenew={() => setRenewOpen(true)}
                onPrintCard={() => result.member && gym && printMemberCard({ gym, settings }, result.member)}
                onVisit={() => setVisitOpen(true)}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Huella */}
                <IfFeature feature="fingerprint">
                  <div
                    className={cx(
                      'relative overflow-hidden rounded-2xl border p-8 text-center transition-all duration-300',
                      scanning
                        ? 'scanner border-gym/40 bg-gym/[.07]'
                        : 'border-white/[.08] bg-ink-900/60 hover:border-gym/30',
                    )}
                  >
                    <div className="relative mx-auto grid h-24 w-24 place-items-center">
                      {scanning && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-gym/25" />}
                      <span
                        className={cx(
                          'grid h-24 w-24 place-items-center rounded-full ring-1 transition-colors',
                          scanning ? 'bg-gym/15 ring-gym/40' : 'bg-white/[.04] ring-white/10',
                        )}
                      >
                        <Fingerprint
                          className={cx('h-12 w-12 transition-colors', scanning ? 'animate-pulse text-gym' : 'text-ink-400')}
                        />
                      </span>
                    </div>
                    <p className="mt-5 text-[16px] font-semibold text-ink-50">
                      {scanning ? 'Leyendo huella…' : 'Escanear huella'}
                    </p>
                    <p className="mt-1.5 text-[12.5px] text-ink-400">
                      {scanning ? 'Coloca el dedo en el lector' : 'El socio marca su entrada en un segundo'}
                    </p>
                    <Button
                      variant="primary"
                      size="lg"
                      className="mt-5"
                      loading={scanning}
                      onClick={scan}
                      icon={<Fingerprint className="h-4 w-4" />}
                    >
                      {scanning ? 'Leyendo…' : 'Escanear'}
                    </Button>
                    <p className="mt-3 text-[11px] text-ink-600">Lector simulado · listo para hardware real</p>
                  </div>
                </IfFeature>

                {/* Búsqueda */}
                <div className="rounded-2xl border border-white/[.08] bg-ink-900/60 p-6">
                  <p className="flex items-center gap-2 text-[15px] font-semibold text-ink-50">
                    <Search className="h-4 w-4 text-gym" />
                    Buscar socio
                  </p>
                  <p className="mt-1 text-[12.5px] text-ink-400">
                    Por nombre, teléfono, correo, número de socio o código QR.
                  </p>
                  <SearchInput
                    value={query}
                    onValueChange={setQuery}
                    placeholder="Escribe o escanea el QR…"
                    className="mt-4"
                    autoFocus
                  />

                  {candidates.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {candidates.map((m) => (
                        <li key={m.id}>
                          <button
                            onClick={() => checkIn(m, parseQrPayload(query.trim()) ? 'qr' : 'reception')}
                            className="flex w-full items-center gap-3 rounded-xl border border-white/[.06] bg-white/[.02] px-3 py-2.5 text-left transition hover:border-gym/30 hover:bg-gym/[.05]"
                          >
                            <Avatar name={m.name} src={m.photoUrl} size={34} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13.5px] font-medium text-ink-100">{m.name}</p>
                              <p className="truncate text-[11.5px] text-ink-500">
                                {memberTag(m.memberNumber)} · {phoneFmt(m.phone)}
                              </p>
                            </div>
                            <StatusChip status={m.status} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {query.trim() && searching && candidates.length === 0 && (
                    <p className="mt-4 text-center text-[13px] text-ink-500">Buscando…</p>
                  )}

                  {query.trim() && !searching && candidates.length === 0 && (
                    <div className="mt-4 rounded-xl border border-white/[.06] bg-ink-950/40 p-4 text-center">
                      <p className="text-[13px] text-ink-400">No encontramos a nadie con eso.</p>
                      <p className="mt-1 text-[11.5px] text-ink-600">
                        Busca por el principio del nombre o por número de socio.
                      </p>
                      <Button variant="ghost" size="sm" className="mt-3" icon={<Ticket className="h-3.5 w-3.5" />} onClick={() => setVisitOpen(true)}>
                        Registrar como visita
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Acciones rápidas */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <QuickAction icon={Ticket} label="Cobrar visita" tone="text-warn-400" onClick={() => setVisitOpen(true)} />
              <QuickAction icon={QrCode} label="Nuevo socio" tone="text-cyber-400" onClick={() => navigate('/socios')} />
              <QuickAction icon={Printer} label="Imprimir" tone="text-plasma-400" onClick={() => window.print()} />
              <QuickAction
                icon={RefreshCw}
                label="Limpiar"
                tone="text-ink-400"
                onClick={() => {
                  setResult(null)
                  setQuery('')
                }}
              />
            </div>
          </div>

          {/* Entradas de hoy */}
          <aside className="rounded-2xl border border-white/[.08] bg-ink-900/60 p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-[14px] font-semibold text-ink-50">
                <Clock className="h-4 w-4 text-gym" />
                Entradas de hoy
              </p>
              <Badge tone="neutral">{todayAttendance.length}</Badge>
            </div>

            {todayAttendance.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-ink-500">
                Todavía no ha entrado nadie hoy.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-white/[.05]">
                {todayAttendance.map((a) => (
                  <li key={a.id} className="flex items-center gap-2.5 py-2.5">
                    <span
                      className={cx('h-1.5 w-1.5 shrink-0 rounded-full', a.granted ? 'bg-tap-400' : 'bg-danger-400')}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-200">{a.memberName}</span>
                    <span className="shrink-0 font-mono text-[11.5px] text-ink-500 tnum">{a.time}</span>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </main>

      {/* Modal de visita */}
      <VisitQuickModal
        open={visitOpen}
        onClose={() => setVisitOpen(false)}
        defaultName={query.trim()}
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
            toast.success('Visita cobrada', `${v.name} · ${money0(v.amount)}`)
            if (gym) printVisitTicket({ gym, settings }, visit)
            setVisitOpen(false)
            setQuery('')
          } catch (err) {
            // En el mostrador, un botón que no hace nada es lo peor que puede
            // pasar: siempre hay que decir por qué no se cobró.
            toast.error('No se pudo cobrar la visita', reportError('cobrar visita', err).message)
          }
        }}
      />

      {/* Renovación rápida desde el panel de acceso denegado */}
      <Modal
        open={renewOpen}
        onClose={() => setRenewOpen(false)}
        title="Renovar membresía"
        description={result?.member?.name}
        size="sm"
        footer={null}
      >
        <div className="space-y-2">
          {plans.data
            .filter((p) => p.active)
            .map((p) => (
              <button
                key={p.id}
                onClick={async () => {
                  if (!repo || !result?.member) return
                  const { member } = await contractMembership(repo, {
                    member: result.member,
                    plan: p,
                    kind: result.member.expiresAt ? 'RENEWAL' : 'NEW',
                    method: 'cash',
                    collectedBy: user?.uid ?? null,
                  })
                  toast.success('¡Membresía renovada!', `${member.name} · ${p.name}`)
                  setRenewOpen(false)
                  await checkIn(member, 'reception')
                }}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/[.07] bg-white/[.02] px-4 py-3 text-left transition hover:border-gym/35 hover:bg-gym/[.06]"
              >
                <div>
                  <p className="text-[14px] font-semibold text-ink-100">{p.name}</p>
                  <p className="text-[11.5px] text-ink-500">{p.days} días</p>
                </div>
                <span className="text-[17px] font-bold text-gym tnum">{money0(p.price)}</span>
              </button>
            ))}
        </div>
      </Modal>
    </div>
  )
}

// ══════════════════════════ Panel de resultado ══════════════════════════════

function AccessPanel({
  result,
  onClose,
  onRenew,
  onPrintCard,
  onVisit,
}: {
  result: AccessResult
  onClose: () => void
  onRenew: () => void
  onPrintCard: () => void
  onVisit: () => void
}) {
  const ok = result.granted
  const member = result.member

  return (
    <div
      className={cx(
        'relative animate-scale-in overflow-hidden rounded-2xl border p-6 sm:p-8',
        ok
          ? 'border-tap-500/35 bg-tap-500/[.07]'
          : 'border-danger-500/35 bg-danger-500/[.07]',
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-28 h-56 opacity-25 blur-3xl"
        style={{
          background: ok
            ? 'radial-gradient(ellipse,#22E06B,transparent 70%)'
            : 'radial-gradient(ellipse,#FF6B6B,transparent 70%)',
        }}
      />

      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-lg p-2 text-ink-400 transition hover:bg-white/5 hover:text-ink-100"
        aria-label="Cerrar"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="relative flex flex-wrap items-center gap-6">
        <div className="relative">
          <span
            className={cx(
              'grid h-24 w-24 place-items-center rounded-full ring-2',
              ok ? 'bg-tap-500/15 ring-tap-400/50' : 'bg-danger-500/15 ring-danger-400/50',
            )}
          >
            {ok ? (
              <CheckCircle2 className="h-12 w-12 text-tap-400" />
            ) : (
              <XCircle className="h-12 w-12 text-danger-400" />
            )}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p
            className={cx(
              'text-[28px] font-bold leading-tight tracking-tight sm:text-[36px]',
              ok ? 'text-tap-300' : 'text-danger-300',
            )}
          >
            {result.headline}
          </p>
          <p className="mt-1.5 text-[14px] text-ink-300">{result.reason}</p>
        </div>
      </div>

      {member && (
        <div className="relative mt-6 flex flex-wrap items-center gap-5 rounded-2xl border border-white/[.07] bg-ink-950/50 p-5">
          <Avatar name={member.name} src={member.photoUrl} size={64} ring />
          <div className="min-w-0 flex-1">
            <p className="text-[20px] font-bold text-ink-50">{member.name}</p>
            <p className="font-mono text-[12px] text-ink-500">{memberTag(member.memberNumber)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusChip status={member.status} />
              {result.membershipPlan && <Badge tone="neutral">{result.membershipPlan.name}</Badge>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-right">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-500">Vence</p>
              <p className="text-[15px] font-semibold text-ink-100 tnum">{fmtDate(member.expiresAt)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-500">Días restantes</p>
              <p
                className={cx(
                  'text-[15px] font-semibold tnum',
                  result.daysRemaining < 0
                    ? 'text-danger-400'
                    : result.daysRemaining <= 7
                      ? 'text-warn-400'
                      : 'text-tap-400',
                )}
              >
                {result.daysRemaining < 0 ? `−${Math.abs(result.daysRemaining)}` : result.daysRemaining}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="relative mt-5 flex flex-wrap gap-2">
        {!ok && (
          <>
            <Button variant="primary" size="lg" icon={<Check className="h-4 w-4" />} onClick={onRenew}>
              Renovar ahora
            </Button>
            <Button variant="ghost" size="lg" icon={<Ticket className="h-4 w-4" />} onClick={onVisit}>
              Cobrar visita de hoy
            </Button>
          </>
        )}
        {ok && (
          <Button variant="ghost" size="lg" icon={<IdCard className="h-4 w-4" />} onClick={onPrintCard}>
            Imprimir credencial
          </Button>
        )}
        <Button variant="subtle" size="lg" icon={<Ban className="h-4 w-4" />} onClick={onClose}>
          Siguiente persona
        </Button>
      </div>
    </div>
  )
}

function QuickAction({
  icon: Icon,
  label,
  tone,
  onClick,
}: {
  icon: typeof Ticket
  label: string
  tone: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-start gap-2.5 rounded-2xl border border-white/[.07] bg-ink-900/60 p-4 transition-all duration-200 ease-spring hover:-translate-y-0.5 hover:border-white/[.16] active:scale-[.98]"
    >
      <Icon className={cx('h-5 w-5', tone)} />
      <span className="text-[13px] font-medium text-ink-200">{label}</span>
    </button>
  )
}

// ═════════════════════════ Modal rápido de visita ═══════════════════════════

function VisitQuickModal({
  open,
  onClose,
  defaultName,
  defaultPrice,
  guestPrice,
  methods,
  onSave,
}: {
  open: boolean
  onClose: () => void
  defaultName: string
  defaultPrice: number
  guestPrice: number
  methods: PaymentMethod[]
  onSave: (v: {
    name: string
    phone: string
    amount: number
    method: PaymentMethod
    invitedBy: { id: string; name: string } | null
  }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [invitedBy, setInvitedBy] = useState<{ id: string; name: string } | null>(null)
  const [pickOpen, setPickOpen] = useState(false)
  const [amount, setAmount] = useState(defaultPrice)
  const [method, setMethod] = useState<PaymentMethod>(methods[0] ?? 'cash')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(defaultName)
    setPhone('')
    setInvitedBy(null)
    setAmount(defaultPrice)
  }, [open, defaultName, defaultPrice])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cobrar visita"
      description="Pase de un día. No crea membresía."
      size="md"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="lg"
            loading={busy}
            disabled={name.trim().length < 3}
            onClick={async () => {
              setBusy(true)
              try {
                await onSave({ name, phone, amount, method, invitedBy })
              } finally {
                setBusy(false)
              }
            }}
          >
            Cobrar {money0(amount)} e imprimir
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Nombre"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          containerClassName="sm:col-span-2"
          autoFocus
        />
        <Input label="Teléfono (opcional)" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <div className="min-w-0">
          <p className="mb-1.5 text-[12.5px] font-medium text-ink-300">¿Lo invita un socio?</p>
          {invitedBy ? (
            <div className="flex h-10 items-center gap-2 rounded-xl border border-cyber-400/30 bg-cyber-400/[.07] px-3">
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-100">{invitedBy.name}</span>
              <button
                onClick={() => {
                  setInvitedBy(null)
                  setAmount(defaultPrice)
                }}
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
        </div>
        <Input
          label="Importe"
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          prefix="$"
        />
        <Select label="Método" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {methods.map((m) => (
            <option key={m} value={m}>
              {m === 'cash' ? 'Efectivo' : m === 'card' ? 'Tarjeta' : m === 'transfer' ? 'Transferencia' : 'Stripe'}
            </option>
          ))}
        </Select>
      </div>

      <Modal
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        title="¿Qué socio lo invita?"
        description={`Se le aplica la tarifa de invitado: ${money0(guestPrice)}.`}
        size="sm"
      >
        <MemberPicker
          onPick={(m) => {
            setInvitedBy({ id: m.id, name: m.name })
            setAmount(guestPrice)
            setPickOpen(false)
          }}
        />
      </Modal>
    </Modal>
  )
}

export { printReceipt }
