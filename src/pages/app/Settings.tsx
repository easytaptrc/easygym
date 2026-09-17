import { useEffect, useMemo, useState } from 'react'
import {
  Bell,
  Bike,
  Building2,
  CalendarClock,
  CreditCard,
  Fingerprint,
  Palette,
  Plug,
  Printer,
  RefreshCw,
  Save,
  Ticket,
} from 'lucide-react'
import type { CancellationWindow, CheckInMethod, GymSettings, NotificationChannel, PaymentMethod } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useToast } from '@/hooks/useToast'
import { platform } from '@/services/db'
import { syncPublicGymQuietly } from '@/services/publicGym'
import { rebuildAggregates } from '@/services/aggregates'
import { audit, diffFields } from '@/services/audit'
import { reportError } from '@/lib/errors'
import { useCounters } from '@/hooks/useAggregates'
import { fmtDateTime } from '@/lib/date'
import { PAYMENT_METHOD_LABEL } from '@/services/billing'
import { CHECKIN_METHOD_LABEL } from '@/services/access'
import { CANCELLATION_OPTIONS } from '@/services/reservations'
import { CHANNEL_LABEL } from '@/services/notifications'
import { GYM_ACCENT_PRESETS } from '@/config/brand'
import { applyGymTheme } from '@/lib/theme'
import { ALL_WEEKDAYS, WEEKDAYS_ES } from '@/lib/date'
import { cx } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ColorPicker, Input, Select, Toggle } from '@/components/ui/Inputs'
import { Badge, LoadingBlock } from '@/components/ui/Feedback'
import { IfFeature, UpgradeNotice } from '@/components/PlanGuard'
import { completeOnboardingStep } from './OnboardingChecklist'

// ═══════════════════════════════════════════════════════════════════════════
// Configuración del gimnasio.
//
// Aquí vive TODO lo que en un software peor estaría escrito en el código:
// horarios, precios de visita, ventana de cancelación, métodos de acceso,
// distribución del salón de spinning y el color de la marca.
// ═══════════════════════════════════════════════════════════════════════════

type Section =
  | 'general'
  | 'marca'
  | 'horarios'
  | 'clases'
  | 'acceso'
  | 'visitas'
  | 'pagos'
  | 'notificaciones'
  | 'impresion'
  | 'integraciones'
  | 'mantenimiento'

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Building2 }> = [
  { id: 'general', label: 'Información general', icon: Building2 },
  { id: 'marca', label: 'Marca y color', icon: Palette },
  { id: 'horarios', label: 'Horarios', icon: CalendarClock },
  { id: 'clases', label: 'Clases y reservaciones', icon: Bike },
  { id: 'acceso', label: 'Control de acceso', icon: Fingerprint },
  { id: 'visitas', label: 'Visitas', icon: Ticket },
  { id: 'pagos', label: 'Cobros', icon: CreditCard },
  { id: 'notificaciones', label: 'Notificaciones', icon: Bell },
  { id: 'impresion', label: 'Impresión', icon: Printer },
  { id: 'mantenimiento', label: 'Mantenimiento', icon: RefreshCw },
  { id: 'integraciones', label: 'Integraciones', icon: Plug },
]

/** Nombre de la sección tal como se lee en la bitácora. */
const SECTION_LABEL: Record<string, string> = Object.fromEntries(SECTIONS.map((s) => [s.id, s.label]))

export default function Settings() {
  const { gym, settings, hasFeature, repo } = useSession()
  const toast = useToast()
  const { counters } = useCounters()

  const [section, setSection] = useState<Section>('general')
  const [draft, setDraft] = useState<GymSettings | null>(null)
  const [gymDraft, setGymDraft] = useState(gym)
  const [busy, setBusy] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)

  async function rebuild() {
    if (!repo) return
    setRebuilding(true)
    try {
      const result = await rebuildAggregates(repo, settings?.nearExpirationDays ?? 7)
      toast.success(
        'Estadísticas recalculadas',
        `${result.counters.members.total} socios · ${result.days} días de historial`,
      )
      audit({
        gymId: repo.gymId,
        action: 'AGGREGATES_REBUILT',
        entityType: 'counters',
        entityId: repo.gymId,
        summary: `Estadísticas recalculadas (${result.counters.members.total} socios)`,
      })
    } catch (err) {
      const friendly = reportError('recalcular estadísticas', err)
      toast.error('No se pudo recalcular', friendly.message)
    } finally {
      setRebuilding(false)
    }
  }

  useEffect(() => setDraft(settings ? structuredClone(settings) : null), [settings])
  useEffect(() => setGymDraft(gym), [gym])

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(settings) || JSON.stringify(gymDraft) !== JSON.stringify(gym),
    [draft, settings, gymDraft, gym],
  )

  if (!gym || !draft || !gymDraft) return <LoadingBlock />

  const upd = (patch: Partial<GymSettings>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  async function save() {
    if (!gym || !draft || !gymDraft) return
    setBusy(true)
    try {
      await platform.update('settings', gym.id, { ...draft, updatedAt: Date.now() })
      await platform.update('gyms', gym.id, {
        name: gymDraft.name,
        email: gymDraft.email,
        phone: gymDraft.phone,
        address: gymDraft.address,
        city: gymDraft.city,
        state: gymDraft.state,
        zip: gymDraft.zip,
        branding: gymDraft.branding,
        updatedAt: Date.now(),
      })
      await completeOnboardingStep(gym, 'gymInfo')
      if (section === 'pagos') await completeOnboardingStep(gym, 'payments')
      // El nombre, la dirección y el color salen en la página pública.
      syncPublicGymQuietly(gym.id)

      // La configuración cambia cómo se comporta el gimnasio con todos sus
      // socios: tolerancias de acceso, precios de visita, ventana de
      // cancelación. Quién la tocó y cuándo importa tanto como el cambio.
      const changes = diffFields(
        settings as unknown as Record<string, unknown>,
        draft as unknown as Record<string, unknown>,
        ['nearExpirationDays', 'access', 'visits', 'reservationOpensHoursBefore', 'maxActiveReservationsPerMember', 'receipt', 'notifications'],
      )
      audit({
        gymId: gym.id,
        action: 'SETTINGS_UPDATED',
        entityType: 'settings',
        entityId: gym.id,
        summary: `Configuración modificada (${SECTION_LABEL[section] ?? section})`,
        before: changes.before,
        after: changes.after,
      })

      toast.success('Configuración guardada')
    } catch (err) {
      const friendly = reportError('guardar configuración', err)
      toast.error('No se pudo guardar', friendly.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Configuración"
        description="Todo lo que hace que EasyGym se comporte como TU gimnasio."
        actions={
          <Button variant="primary" size="sm" icon={<Save className="h-3.5 w-3.5" />} loading={busy} disabled={!dirty} onClick={save}>
            {dirty ? 'Guardar cambios' : 'Todo guardado'}
          </Button>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[236px_1fr]">
        {/* Menú de secciones */}
        <nav className="no-scrollbar -mx-4 overflow-x-auto px-4 lg:mx-0 lg:h-fit lg:overflow-visible lg:px-0">
          <ul className="flex gap-1.5 lg:flex-col">
            {SECTIONS.map((s) => (
              <li key={s.id} className="shrink-0">
                <button
                  onClick={() => setSection(s.id)}
                  className={cx(
                    'flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200',
                    section === s.id
                      ? 'bg-gym/[.12] text-gym'
                      : 'text-ink-400 hover:bg-white/[.04] hover:text-ink-100',
                  )}
                >
                  <s.icon className="h-4 w-4 shrink-0" />
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-3">
          {/* ── General ── */}
          {section === 'general' && (
            <Card>
              <CardHeader title="Información general" subtitle="Aparece en recibos, contratos y en el portal de tus socios" />
              <CardBody className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Nombre del gimnasio"
                  value={gymDraft.name}
                  onChange={(e) => setGymDraft((g) => (g ? { ...g, name: e.target.value } : g))}
                  containerClassName="sm:col-span-2"
                />
                <Input
                  label="Correo de contacto"
                  type="email"
                  value={gymDraft.email}
                  onChange={(e) => setGymDraft((g) => (g ? { ...g, email: e.target.value } : g))}
                />
                <Input
                  label="Teléfono"
                  type="tel"
                  value={gymDraft.phone}
                  onChange={(e) => setGymDraft((g) => (g ? { ...g, phone: e.target.value } : g))}
                />
                <Input
                  label="Dirección"
                  value={gymDraft.address}
                  onChange={(e) => setGymDraft((g) => (g ? { ...g, address: e.target.value } : g))}
                  containerClassName="sm:col-span-2"
                />
                <Input
                  label="Ciudad"
                  value={gymDraft.city}
                  onChange={(e) => setGymDraft((g) => (g ? { ...g, city: e.target.value } : g))}
                />
                <Input
                  label="Estado"
                  value={gymDraft.state}
                  onChange={(e) => setGymDraft((g) => (g ? { ...g, state: e.target.value } : g))}
                />
                <Input
                  label="Código postal"
                  value={gymDraft.zip}
                  onChange={(e) => setGymDraft((g) => (g ? { ...g, zip: e.target.value } : g))}
                />
                <Input
                  label="Dirección pública"
                  value={`easygym.com/g/${gym.slug}`}
                  disabled
                  hint="Tus socios pueden entrar desde aquí"
                />
              </CardBody>
            </Card>
          )}

          {/* ── Marca ── */}
          {section === 'marca' && (
            <Card>
              <CardHeader
                title="Color de tu gimnasio"
                subtitle="El acento se aplica al panel, al portal del socio y a las gráficas"
              />
              <CardBody>
                <ColorPicker
                  value={gymDraft.branding.accent}
                  options={GYM_ACCENT_PRESETS}
                  onChange={(accent, soft, deep) => {
                    setGymDraft((g) =>
                      g ? { ...g, branding: { ...g.branding, accent, accentSoft: soft, accentDeep: deep } } : g,
                    )
                    // Vista previa inmediata: el color se aplica mientras eliges.
                    applyGymTheme({ accent, accentSoft: soft, accentDeep: deep })
                  }}
                />

                <div className="mt-6 rounded-2xl border border-white/[.07] bg-ink-950/40 p-5">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.16em] text-ink-500">
                    Vista previa
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="primary">Botón principal</Button>
                    <Button variant="outline-gym">Botón secundario</Button>
                    <Badge tone="gym" dot>
                      Activo
                    </Badge>
                    <span className="text-gym font-semibold">Texto destacado</span>
                    <div className="h-2 w-28 overflow-hidden rounded-full bg-ink-800">
                      <div className="h-full w-2/3 rounded-full bg-gym" />
                    </div>
                  </div>
                </div>

                <IfFeature feature="customBranding">
                  <Input
                    label="Nombre visible en el portal del socio"
                    className="mt-5"
                    value={gymDraft.branding.displayName ?? gymDraft.name}
                    onChange={(e) =>
                      setGymDraft((g) =>
                        g ? { ...g, branding: { ...g.branding, displayName: e.target.value } } : g,
                      )
                    }
                    containerClassName="mt-5"
                  />
                </IfFeature>

                {!hasFeature('customBranding') && (
                  <div className="mt-5">
                    <UpgradeNotice feature="customBranding" compact />
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {/* ── Horarios ── */}
          {section === 'horarios' && (
            <Card>
              <CardHeader title="Horarios de apertura" subtitle="Cuándo abre y cierra tu gimnasio cada día" />
              <CardBody>
                <ul className="space-y-2">
                  {ALL_WEEKDAYS.map((d) => {
                    const h = draft.hours[d]
                    return (
                      <li
                        key={d}
                        className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[.06] bg-ink-950/40 p-3"
                      >
                        <span className="w-24 shrink-0 text-[13px] font-medium text-ink-200">
                          {WEEKDAYS_ES[d]}
                        </span>
                        <Toggle
                          checked={!h.closed}
                          onChange={(openDay) =>
                            upd({ hours: { ...draft.hours, [d]: { ...h, closed: !openDay } } })
                          }
                        />
                        {h.closed ? (
                          <span className="text-[12.5px] text-ink-500">Cerrado</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              type="time"
                              value={h.open}
                              onChange={(e) =>
                                upd({ hours: { ...draft.hours, [d]: { ...h, open: e.target.value } } })
                              }
                              className="h-9 rounded-lg border border-white/10 bg-ink-950/60 px-2.5 text-[13px] text-ink-100 outline-none [color-scheme:dark]"
                            />
                            <span className="text-ink-600">—</span>
                            <input
                              type="time"
                              value={h.close}
                              onChange={(e) =>
                                upd({ hours: { ...draft.hours, [d]: { ...h, close: e.target.value } } })
                              }
                              className="h-9 rounded-lg border border-white/10 bg-ink-950/60 px-2.5 text-[13px] text-ink-100 outline-none [color-scheme:dark]"
                            />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>

                <Input
                  label="Días de aviso antes del vencimiento"
                  type="number"
                  min={1}
                  max={30}
                  value={draft.nearExpirationDays}
                  onChange={(e) => upd({ nearExpirationDays: Number(e.target.value) })}
                  hint="Un socio se marca POR VENCER cuando le quedan estos días o menos"
                  containerClassName="mt-5 max-w-xs"
                />
              </CardBody>
            </Card>
          )}

          {/* ── Clases ── */}
          {section === 'clases' && (
            <>
              {hasFeature('reservations') ? (
                <>
                  <Card>
                    <CardHeader title="Reservaciones" subtitle="Reglas que aplican a todas las clases" />
                    <CardBody className="grid gap-4 sm:grid-cols-2">
                      <Select
                        label="Se puede cancelar hasta"
                        value={String(draft.cancellationWindowMin)}
                        onChange={(e) =>
                          upd({ cancellationWindowMin: Number(e.target.value) as CancellationWindow })
                        }
                        hint="Después de ese momento el socio ya no puede liberar su lugar"
                      >
                        {CANCELLATION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                      <Input
                        label="Las reservaciones abren (horas antes)"
                        type="number"
                        min={1}
                        max={336}
                        value={draft.reservationOpensHoursBefore}
                        onChange={(e) => upd({ reservationOpensHoursBefore: Number(e.target.value) })}
                        hint="Evita que alguien aparte todo el mes"
                      />
                      <Input
                        label="Reservaciones activas por socio"
                        type="number"
                        min={1}
                        max={20}
                        value={draft.maxActiveReservationsPerMember}
                        onChange={(e) => upd({ maxActiveReservationsPerMember: Number(e.target.value) })}
                        hint="Máximo de lugares apartados a la vez"
                      />
                    </CardBody>
                  </Card>

                  <IfFeature feature="spinningMap">
                    <Card>
                      <CardHeader title="Salón de spinning" subtitle="La distribución detallada se edita en la sección Spinning" />
                      <CardBody className="grid gap-4 sm:grid-cols-3">
                        <Input
                          label="Filas"
                          type="number"
                          min={1}
                          max={12}
                          value={draft.spinning.rows}
                          onChange={(e) =>
                            upd({ spinning: { ...draft.spinning, rows: Number(e.target.value) } })
                          }
                        />
                        <Input
                          label="Columnas"
                          type="number"
                          min={1}
                          max={12}
                          value={draft.spinning.cols}
                          onChange={(e) =>
                            upd({ spinning: { ...draft.spinning, cols: Number(e.target.value) } })
                          }
                        />
                        <Select
                          label="Instructor"
                          value={draft.spinning.instructorAt}
                          onChange={(e) =>
                            upd({
                              spinning: {
                                ...draft.spinning,
                                instructorAt: e.target.value as 'top' | 'bottom',
                              },
                            })
                          }
                        >
                          <option value="top">Al frente</option>
                          <option value="bottom">Al fondo</option>
                        </Select>
                      </CardBody>
                    </Card>
                  </IfFeature>
                </>
              ) : (
                <UpgradeNotice feature="reservations" />
              )}
            </>
          )}

          {/* ── Acceso ── */}
          {section === 'acceso' && (
            <Card>
              <CardHeader title="Control de acceso" subtitle="Qué pasa cuando alguien llega a recepción" />
              <CardBody className="space-y-4">
                <Toggle
                  checked={draft.access.visitGrantsAccess}
                  onChange={(v) => upd({ access: { ...draft.access, visitGrantsAccess: v } })}
                  label="Una visita pagada da acceso ese día"
                  description="Aunque su membresía esté vencida, si pagó visita hoy puede entrar."
                />
                <Toggle
                  checked={draft.access.allowExpiredEntry}
                  onChange={(v) => upd({ access: { ...draft.access, allowExpiredEntry: v } })}
                  label="Permitir entrar con membresía vencida"
                  description="Úsalo solo si tu gimnasio es de confianza total. Se sigue registrando la asistencia."
                />
                <Input
                  label="Días de tolerancia tras el vencimiento"
                  type="number"
                  min={0}
                  max={15}
                  value={draft.access.graceDays}
                  onChange={(e) => upd({ access: { ...draft.access, graceDays: Number(e.target.value) } })}
                  hint="0 = sin tolerancia. La recepción verá el aviso igualmente."
                  containerClassName="max-w-xs"
                />

                <div>
                  <p className="mb-2 text-[12.5px] font-medium text-ink-300">Métodos de entrada habilitados</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(['fingerprint', 'qr', 'reception', 'manual', 'card'] as CheckInMethod[]).map((m) => {
                      const on = draft.access.methods.includes(m)
                      const locked = m === 'fingerprint' && !hasFeature('fingerprint')
                      return (
                        <button
                          key={m}
                          disabled={locked}
                          onClick={() =>
                            upd({
                              access: {
                                ...draft.access,
                                methods: on
                                  ? draft.access.methods.filter((x) => x !== m)
                                  : [...draft.access.methods, m],
                              },
                            })
                          }
                          className={cx(
                            'rounded-lg px-3 py-2 text-[12.5px] font-medium transition disabled:opacity-40',
                            on ? 'bg-gym text-ink-950' : 'bg-white/[.04] text-ink-400 hover:bg-white/[.08]',
                          )}
                        >
                          {CHECKIN_METHOD_LABEL[m]}
                          {locked && ' 🔒'}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {/* ── Visitas ── */}
          {section === 'visitas' && (
            <Card>
              <CardHeader
                title="Visitas"
                subtitle="Pases de un día. No son membresías y se contabilizan aparte."
              />
              <CardBody className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Precio de visita"
                  type="number"
                  min={0}
                  value={draft.visits.defaultPrice}
                  onChange={(e) => upd({ visits: { ...draft.visits, defaultPrice: Number(e.target.value) } })}
                  prefix="$"
                  hint="Para quien llega por su cuenta"
                />
                <Input
                  label="Precio para invitado de socio"
                  type="number"
                  min={0}
                  value={draft.visits.memberGuestPrice}
                  onChange={(e) =>
                    upd({ visits: { ...draft.visits, memberGuestPrice: Number(e.target.value) } })
                  }
                  prefix="$"
                  hint="Cuando un socio lo trae y paga por él"
                />
              </CardBody>
            </Card>
          )}

          {/* ── Pagos ── */}
          {section === 'pagos' && (
            <Card>
              <CardHeader title="Cobros" subtitle="Cómo puede pagar la gente en tu mostrador" />
              <CardBody className="space-y-4">
                <div>
                  <p className="mb-2 text-[12.5px] font-medium text-ink-300">Métodos aceptados</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(['cash', 'card', 'transfer', 'stripe'] as PaymentMethod[]).map((m) => {
                      const on = draft.payments.methods.includes(m)
                      const locked = m === 'stripe' && !hasFeature('stripeAutoPayments')
                      return (
                        <button
                          key={m}
                          disabled={locked}
                          onClick={() =>
                            upd({
                              payments: {
                                ...draft.payments,
                                methods: on
                                  ? draft.payments.methods.filter((x) => x !== m)
                                  : [...draft.payments.methods, m],
                              },
                            })
                          }
                          className={cx(
                            'rounded-lg px-3 py-2 text-[12.5px] font-medium transition disabled:opacity-40',
                            on ? 'bg-gym text-ink-950' : 'bg-white/[.04] text-ink-400 hover:bg-white/[.08]',
                          )}
                        >
                          {PAYMENT_METHOD_LABEL[m]}
                          {locked && ' 🔒'}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <Input
                  label="IVA / impuesto (%)"
                  type="number"
                  min={0}
                  max={30}
                  value={draft.payments.taxRate}
                  onChange={(e) => upd({ payments: { ...draft.payments, taxRate: Number(e.target.value) } })}
                  containerClassName="max-w-xs"
                />

                <Input
                  label="Pie del recibo"
                  value={draft.payments.receiptFooter}
                  onChange={(e) =>
                    upd({ payments: { ...draft.payments, receiptFooter: e.target.value } })
                  }
                  hint="Se imprime al final de cada ticket"
                />
              </CardBody>
            </Card>
          )}

          {/* ── Notificaciones ── */}
          {section === 'notificaciones' && (
            <Card>
              <CardHeader title="Notificaciones" subtitle="Avisos automáticos a tus socios" />
              <CardBody className="space-y-4">
                <div>
                  <p className="mb-2 text-[12.5px] font-medium text-ink-300">Canales</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(['inapp', 'email', 'whatsapp', 'push'] as NotificationChannel[]).map((c) => {
                      const on = draft.notifications.channels.includes(c)
                      const locked =
                        (c === 'whatsapp' && !hasFeature('whatsapp')) ||
                        (c !== 'inapp' && !hasFeature('notifications'))
                      return (
                        <button
                          key={c}
                          disabled={locked}
                          onClick={() =>
                            upd({
                              notifications: {
                                ...draft.notifications,
                                channels: on
                                  ? draft.notifications.channels.filter((x) => x !== c)
                                  : [...draft.notifications.channels, c],
                              },
                            })
                          }
                          className={cx(
                            'rounded-lg px-3 py-2 text-[12.5px] font-medium transition disabled:opacity-40',
                            on ? 'bg-gym text-ink-950' : 'bg-white/[.04] text-ink-400 hover:bg-white/[.08]',
                          )}
                        >
                          {CHANNEL_LABEL[c]}
                          {locked && ' 🔒'}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Avisar días antes del vencimiento"
                    type="number"
                    min={1}
                    max={30}
                    value={draft.notifications.nearExpirationDaysBefore}
                    onChange={(e) =>
                      upd({
                        notifications: {
                          ...draft.notifications,
                          nearExpirationDaysBefore: Number(e.target.value),
                        },
                      })
                    }
                  />
                  <Input
                    label="Recordatorio de clase (horas antes)"
                    type="number"
                    min={1}
                    max={48}
                    value={draft.notifications.classReminderHoursBefore}
                    onChange={(e) =>
                      upd({
                        notifications: {
                          ...draft.notifications,
                          classReminderHoursBefore: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>

                <p className="rounded-xl border border-cyber-400/20 bg-cyber-400/[.06] px-3.5 py-3 text-[12.5px] leading-relaxed text-cyber-100">
                  En el prototipo los envíos se simulan y quedan registrados en la colección
                  <code className="mx-1 font-mono">notifications</code>. En producción los dispara una
                  Cloud Function programada cada mañana.
                </p>
              </CardBody>
            </Card>
          )}

          {/* ── Impresión ── */}
          {section === 'impresion' && (
            <Card>
              <CardHeader title="Impresión" subtitle="Recibos, pases de visita, credenciales y contratos" />
              <CardBody className="space-y-4">
                <Select
                  label="Ancho del recibo"
                  value={draft.printing.receiptWidth}
                  onChange={(e) =>
                    upd({
                      printing: {
                        ...draft.printing,
                        receiptWidth: e.target.value as GymSettings['printing']['receiptWidth'],
                      },
                    })
                  }
                  containerClassName="max-w-xs"
                  hint="58 mm y 80 mm son los estándares de impresora térmica"
                >
                  <option value="58mm">58 mm (térmica angosta)</option>
                  <option value="80mm">80 mm (térmica estándar)</option>
                  <option value="A4">Hoja carta / A4</option>
                </Select>

                <Toggle
                  checked={draft.printing.printLogo}
                  onChange={(v) => upd({ printing: { ...draft.printing, printLogo: v } })}
                  label="Incluir encabezado del gimnasio"
                  description="Nombre, dirección y teléfono en la parte superior."
                />

                <p className="rounded-xl border border-white/[.07] bg-ink-950/40 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-400">
                  En el navegador la impresión usa el diálogo del sistema. La aplicación de recepción
                  para Windows podrá enviar directo a impresoras térmicas por ESC/POS, sin diálogo.
                </p>
              </CardBody>
            </Card>
          )}

          {/* ── Integraciones ── */}
          {section === 'integraciones' && (
            <Card>
              <CardHeader title="Integraciones" subtitle="Conexiones con servicios externos" />
              <CardBody className="space-y-2.5">
                {[
                  {
                    name: 'Stripe',
                    detail: 'Cobros automáticos y renovaciones con tarjeta.',
                    feature: 'stripeAutoPayments' as const,
                    status: 'Simulado en el prototipo',
                  },
                  {
                    name: 'WhatsApp Business',
                    detail: 'Recordatorios de vencimiento y confirmaciones.',
                    feature: 'whatsapp' as const,
                    status: 'Listo para conectar',
                  },
                  {
                    name: 'Lector de huella USB',
                    detail: 'Vía la aplicación de recepción para Windows.',
                    feature: 'fingerprint' as const,
                    status: 'Simulado en el prototipo',
                  },
                  {
                    name: 'API pública',
                    detail: 'Consulta tus datos desde tus propios sistemas.',
                    feature: 'api' as const,
                    status: 'En el plan Business',
                  },
                ].map((i) => (
                  <div
                    key={i.name}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[.07] bg-ink-950/40 p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-ink-100">{i.name}</p>
                      <p className="mt-0.5 text-[12.5px] text-ink-400">{i.detail}</p>
                    </div>
                    {hasFeature(i.feature) ? (
                      <Badge tone="gym" dot>
                        {i.status}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">No incluido en tu plan</Badge>
                    )}
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          {/* ── Mantenimiento ── */}
          {section === 'mantenimiento' && (
            <Card>
              <CardHeader
                title="Recalcular estadísticas"
                subtitle="Reconstruye contadores y resúmenes diarios desde los datos originales"
                icon={<RefreshCw className="h-4 w-4" />}
              />
              <CardBody className="space-y-4">
                <p className="text-[13px] leading-relaxed text-ink-400">
                  El panel no cuenta documentos: lee contadores que se van sumando con cada operación.
                  Eso es lo que hace que funcione igual de rápido con 100 socios que con 100 000.
                </p>
                <p className="text-[13px] leading-relaxed text-ink-400">
                  Si alguna vez una cifra no te cuadra —por una importación, una migración o una
                  operación que se cortó a medias—, este botón los vuelve a calcular desde cero
                  recorriendo los socios, pagos y asistencias reales.
                </p>

                <div className="rounded-xl border border-white/[.07] bg-ink-950/40 p-4">
                  <dl className="grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-4">
                    <div>
                      <dt className="text-ink-500">Socios</dt>
                      <dd className="mt-0.5 font-semibold text-ink-100 tnum">{counters.members.total}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Activos</dt>
                      <dd className="mt-0.5 font-semibold text-tap-400 tnum">{counters.members.active}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Por vencer</dt>
                      <dd className="mt-0.5 font-semibold text-warn-400 tnum">
                        {counters.members.nearExpiration}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Vencidos</dt>
                      <dd className="mt-0.5 font-semibold text-danger-400 tnum">
                        {counters.members.expired}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-[11.5px] text-ink-600">
                    Último recálculo completo:{' '}
                    {counters.rebuiltAt ? fmtDateTime(counters.rebuiltAt) : 'nunca'}
                  </p>
                </div>

                <Button
                  variant="ghost"
                  loading={rebuilding}
                  icon={<RefreshCw className="h-4 w-4" />}
                  onClick={rebuild}
                >
                  Recalcular ahora
                </Button>

                <p className="rounded-xl border border-white/[.07] bg-ink-950/40 px-3.5 py-3 text-[12px] leading-relaxed text-ink-500">
                  Es una operación cara: recorre todo el gimnasio. En producción la ejecuta una Cloud
                  Function bajo demanda, no el navegador.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {/* Barra de guardado flotante */}
      {dirty && (
        <div className="no-print sticky bottom-4 mt-4 flex justify-center">
          <div className="flex items-center gap-3 rounded-2xl border border-white/[.1] bg-ink-900/95 px-4 py-3 shadow-pop backdrop-blur-xl">
            <span className="text-[13px] text-ink-300">Tienes cambios sin guardar</span>
            <Button variant="primary" size="sm" loading={busy} icon={<Save className="h-3.5 w-3.5" />} onClick={save}>
              Guardar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
