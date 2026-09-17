import type { AppNotification, GymSettings, Member, NotificationChannel, NotificationKind } from '@/types'
import { daysUntil, fmt12h, fmtDayKey } from '@/lib/date'
import { money } from '@/lib/format'
import type { TenantRepo } from './db'

// ═══════════════════════════════════════════════════════════════════════════
// Notificaciones — servicio MOCK.
//
// Las plantillas y el encolado son REALES: lo simulado es el envío.
// En producción cada canal se resuelve así:
//
//   email     → Cloud Function + SendGrid / Resend
//   whatsapp  → WhatsApp Business API (plantillas pre-aprobadas por Meta)
//   push      → Firebase Cloud Messaging con el token del dispositivo
//   inapp     → ya funciona: se lee de la colección `notifications`
//
// El disparador real es una Cloud Function programada (`pubsub.schedule`)
// que cada mañana busca membresías por vencer y encola los mensajes.
// ═══════════════════════════════════════════════════════════════════════════

export interface TemplateContext {
  memberName: string
  gymName: string
  days?: number
  date?: string
  time?: string
  className?: string
  amount?: number
}

type Template = { title: (c: TemplateContext) => string; body: (c: TemplateContext) => string }

export const TEMPLATES: Record<NotificationKind, Template> = {
  MEMBERSHIP_NEAR_EXPIRATION: {
    title: (c) => `Tu membresía vence en ${c.days} ${c.days === 1 ? 'día' : 'días'}`,
    body: (c) =>
      `Hola ${c.memberName.split(' ')[0]}, tu membresía en ${c.gymName} vence el ${c.date}. Renuévala desde la app y no pierdas tu racha 💪`,
  },
  MEMBERSHIP_EXPIRED: {
    title: () => 'Tu membresía venció',
    body: (c) =>
      `${c.memberName.split(' ')[0]}, tu membresía en ${c.gymName} venció. Renuévala en un minuto desde tu portal y vuelve a entrenar.`,
  },
  PAYMENT_CONFIRMED: {
    title: () => 'Pago confirmado',
    body: (c) => `Recibimos tu pago de ${money(c.amount ?? 0)} en ${c.gymName}. ¡Gracias!`,
  },
  RESERVATION_CONFIRMED: {
    title: () => 'Reservación confirmada',
    body: (c) => `Te esperamos en ${c.className} el ${c.date} a las ${c.time}.`,
  },
  RESERVATION_CANCELLED: {
    title: () => 'Reservación cancelada',
    body: (c) => `Tu lugar en ${c.className} del ${c.date} a las ${c.time} fue liberado.`,
  },
  CLASS_REMINDER: {
    title: (c) => `${c.className} empieza pronto`,
    body: (c) => `Tu clase de ${c.className} comienza a las ${c.time}. ¡No faltes!`,
  },
  SYSTEM: {
    title: () => 'Aviso',
    body: (c) => `${c.gymName} tiene un aviso para ti.`,
  },
}

export interface QueueInput {
  kind: NotificationKind
  channel?: NotificationChannel
  memberId?: string | null
  context: TemplateContext
}

/** Encola (y "envía") una notificación. */
export async function notify(repo: TenantRepo, input: QueueInput): Promise<AppNotification> {
  const tpl = TEMPLATES[input.kind]
  const channel = input.channel ?? 'inapp'
  const notification = await repo.create('notifications', {
    kind: input.kind,
    channel,
    title: tpl.title(input.context),
    body: tpl.body(input.context),
    memberId: input.memberId ?? null,
    status: 'QUEUED',
    readAt: null,
    sentAt: null,
  })

  // [MOCK] Aquí, en producción, la Cloud Function hace la llamada al proveedor.
  await repo.update('notifications', notification.id, { status: 'SENT', sentAt: Date.now() })
  if (channel !== 'inapp') {
    console.info(`[EasyGym · ${channel}] → ${notification.title}: ${notification.body}`)
  }

  return { ...notification, status: 'SENT', sentAt: Date.now() }
}

export async function markRead(repo: TenantRepo, id: string): Promise<void> {
  await repo.update('notifications', id, { status: 'READ', readAt: Date.now() })
}

/**
 * Barrido diario de membresías por vencer / vencidas.
 * En producción: Cloud Scheduler → Pub/Sub → Function, todas las mañanas.
 */
export async function runExpirationSweep(
  repo: TenantRepo,
  gymName: string,
  settings: GymSettings | null,
): Promise<{ nearExpiration: number; expired: number }> {
  const before = settings?.notifications.nearExpirationDaysBefore ?? 5
  const channels = settings?.notifications.channels ?? ['inapp']

  // Solo los socios cuya fecha cae en la ventana que se avisa: los que vencen
  // dentro de `before` días y los que acaban de vencer. Recorrer la colección
  // entera para encontrarlos sería leer 100 000 documentos para escribir
  // cincuenta avisos.
  const todayStart = new Date().setHours(0, 0, 0, 0)
  const windowEnd = todayStart + (before + 1) * 86_400_000
  const windowStart = todayStart - 2 * 86_400_000
  const members = await repo.list('members', {
    where: [
      { field: 'expiresAt', op: '>=', value: windowStart },
      { field: 'expiresAt', op: '<=', value: windowEnd },
    ],
    orderBy: { field: 'expiresAt', dir: 'asc' },
    limit: 1000,
  })

  // No repetir el aviso si ya se mandó hoy.
  const sentToday = await repo.list('notifications', {
    where: [{ field: 'createdAt', op: '>=', value: todayStart }],
    limit: 2000,
  })
  const alreadyNotified = new Set(sentToday.map((n) => `${n.memberId}:${n.kind}`))

  let nearExpiration = 0
  let expired = 0

  for (const m of members) {
    if (m.status === 'INACTIVE' || !m.expiresAt) continue
    const left = daysUntil(m.expiresAt)
    const ctx: TemplateContext = {
      memberName: m.name,
      gymName,
      days: left,
      date: fmtDayKey(new Date(m.expiresAt).toISOString().slice(0, 10)),
    }

    if (left >= 0 && left <= before && !alreadyNotified.has(`${m.id}:MEMBERSHIP_NEAR_EXPIRATION`)) {
      for (const ch of channels) {
        await notify(repo, { kind: 'MEMBERSHIP_NEAR_EXPIRATION', channel: ch, memberId: m.id, context: ctx })
      }
      nearExpiration++
    } else if (left < 0 && left >= -1 && !alreadyNotified.has(`${m.id}:MEMBERSHIP_EXPIRED`)) {
      for (const ch of channels) {
        await notify(repo, { kind: 'MEMBERSHIP_EXPIRED', channel: ch, memberId: m.id, context: ctx })
      }
      expired++
    }
  }

  return { nearExpiration, expired }
}

/** Mensaje de WhatsApp listo para la API (plantilla + variables). */
export function whatsappPayload(member: Member, kind: NotificationKind, ctx: TemplateContext) {
  return {
    messaging_product: 'whatsapp',
    to: member.phone.replace(/\D/g, ''),
    type: 'template',
    template: {
      name: kind.toLowerCase(),
      language: { code: 'es_MX' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: ctx.memberName },
            { type: 'text', text: ctx.gymName },
            { type: 'text', text: String(ctx.days ?? ctx.date ?? '') },
          ],
        },
      ],
    },
  }
}

export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  inapp: 'En la app',
  email: 'Correo',
  whatsapp: 'WhatsApp',
  push: 'Push',
}

export const KIND_LABEL: Record<NotificationKind, string> = {
  MEMBERSHIP_NEAR_EXPIRATION: 'Membresía por vencer',
  MEMBERSHIP_EXPIRED: 'Membresía vencida',
  PAYMENT_CONFIRMED: 'Pago confirmado',
  RESERVATION_CONFIRMED: 'Reservación confirmada',
  RESERVATION_CANCELLED: 'Reservación cancelada',
  CLASS_REMINDER: 'Recordatorio de clase',
  SYSTEM: 'Aviso del sistema',
}

export function reminderLabel(hours: number, time: string): string {
  return `Recordatorio ${hours} h antes · clase de las ${fmt12h(time)}`
}
