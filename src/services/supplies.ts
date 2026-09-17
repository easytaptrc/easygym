import type { AppUser, InternalNotification, SupplyRequest, SupplyRequestStatus } from '@/types'
import type { TenantRepo } from './db'
import { audit } from './audit'
import { assertCurrentGymCanOperate } from './gymStatus'

// ═══════════════════════════════════════════════════════════════════════════
// SOLICITUDES DE INSUMOS.
//
// Esto sustituye al papelito pegado en el mostrador.
//
// El flujo real que reemplaza: Paulina ve que quedan dos rollos de papel,
// escribe una nota, la pega en la puerta de la oficina, y Adrián la ve —o no—
// cuando pasa por ahí. Nadie sabe si se pidió, si alguien lo está haciendo, ni
// cuándo se resolvió.
//
//   PENDIENTE ──► EN PROCESO ──► ENTREGADO
//        └────────────────────► CANCELADO
//
// Lo que el papel no da y esto sí: quién pidió, quién lo tomó, cuándo, y el
// historial para saber cuánto papel se consume al mes.
// ═══════════════════════════════════════════════════════════════════════════

export const SUPPLY_STATUS_LABEL: Record<SupplyRequestStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En proceso',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
}

export const SUPPLY_STATUS_TONE: Record<SupplyRequestStatus, 'warn' | 'cyber' | 'gym' | 'neutral'> = {
  PENDING: 'warn',
  IN_PROGRESS: 'cyber',
  DELIVERED: 'gym',
  CANCELLED: 'neutral',
}

/** Sugerencias del mostrador. Son atajos, no una lista cerrada. */
export const COMMON_SUPPLIES = [
  'Papel higiénico',
  'Jabón de manos',
  'Toallas',
  'Bolsas de basura',
  'Desinfectante',
  'Agua embotellada',
  'Gel antibacterial',
  'Cloro',
  'Focos',
  'Pilas',
] as const

export interface CreateSupplyInput {
  item: string
  quantity: number
  note?: string
  urgent?: boolean
}

export async function createRequest(
  repo: TenantRepo,
  input: CreateSupplyInput,
  requester: Pick<AppUser, 'uid' | 'name'>,
): Promise<SupplyRequest> {
  assertCurrentGymCanOperate()

  const request = await repo.create('supplyRequests', {
    item: input.item.trim(),
    quantity: Math.max(1, Math.round(input.quantity)),
    note: input.note?.trim() ?? '',
    status: 'PENDING' as SupplyRequestStatus,
    requestedBy: requester.uid,
    requestedByName: requester.name,
    assignedTo: null,
    assignedToName: null,
    acceptedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    urgent: input.urgent ?? false,
  })

  // Aviso a todo el personal de mantenimiento: no se sabe quién está de turno,
  // así que se avisa al puesto y lo toma el primero que pueda.
  await notifyStaff(repo, {
    kind: 'SUPPLY_REQUESTED',
    title: 'Nueva solicitud',
    body: `${requester.name} solicitó ${request.quantity} × ${request.item}.`,
    toRole: 'MANTENIMIENTO',
    entityType: 'supplyRequests',
    entityId: request.id,
  })

  audit({
    gymId: repo.gymId,
    action: 'SUPPLY_REQUEST_CREATED',
    entityType: 'supplyRequests',
    entityId: request.id,
    summary: `Solicitud de ${request.quantity} × ${request.item}`,
    after: { artículo: request.item, cantidad: request.quantity, urgente: request.urgent ?? false },
  })

  return request
}

/** Alguien la toma. De aquí en adelante hay un responsable con nombre. */
export async function acceptRequest(
  repo: TenantRepo,
  requestId: string,
  worker: Pick<AppUser, 'uid' | 'name'>,
): Promise<void> {
  assertCurrentGymCanOperate()

  const request = await repo.get('supplyRequests', requestId)
  if (!request || request.status !== 'PENDING') return

  await repo.update('supplyRequests', requestId, {
    status: 'IN_PROGRESS',
    assignedTo: worker.uid,
    assignedToName: worker.name,
    acceptedAt: Date.now(),
  })

  await notifyStaff(repo, {
    kind: 'SUPPLY_ACCEPTED',
    title: 'Tu solicitud está en proceso',
    body: `${worker.name} está atendiendo tu solicitud de ${request.item}.`,
    toUserId: request.requestedBy,
    entityType: 'supplyRequests',
    entityId: requestId,
  })

  audit({
    gymId: repo.gymId,
    action: 'SUPPLY_REQUEST_ASSIGNED',
    entityType: 'supplyRequests',
    entityId: requestId,
    summary: `${worker.name} tomó la solicitud de ${request.item}`,
    before: { estado: 'PENDING' },
    after: { estado: 'IN_PROGRESS', responsable: worker.name },
  })
}

export async function deliverRequest(
  repo: TenantRepo,
  requestId: string,
  worker: Pick<AppUser, 'uid' | 'name'>,
): Promise<void> {
  assertCurrentGymCanOperate()

  const request = await repo.get('supplyRequests', requestId)
  if (!request || request.status === 'DELIVERED' || request.status === 'CANCELLED') return

  await repo.update('supplyRequests', requestId, {
    status: 'DELIVERED',
    completedAt: Date.now(),
    // Quien entrega se queda como responsable aunque no la hubiera tomado.
    assignedTo: request.assignedTo ?? worker.uid,
    assignedToName: request.assignedToName ?? worker.name,
  })

  await notifyStaff(repo, {
    kind: 'SUPPLY_DELIVERED',
    title: 'Solicitud entregada',
    body: `${request.quantity} × ${request.item} — entregado por ${worker.name}.`,
    toUserId: request.requestedBy,
    entityType: 'supplyRequests',
    entityId: requestId,
  })

  audit({
    gymId: repo.gymId,
    action: 'SUPPLY_REQUEST_DELIVERED',
    entityType: 'supplyRequests',
    entityId: requestId,
    summary: `Entregado: ${request.quantity} × ${request.item}`,
    before: { estado: request.status },
    after: { estado: 'DELIVERED', entregó: worker.name },
  })
}

export async function cancelRequest(
  repo: TenantRepo,
  requestId: string,
  reason: string,
  actor: Pick<AppUser, 'uid' | 'name'>,
): Promise<void> {
  assertCurrentGymCanOperate()

  const request = await repo.get('supplyRequests', requestId)
  if (!request || request.status === 'DELIVERED') return

  await repo.update('supplyRequests', requestId, {
    status: 'CANCELLED',
    cancelledAt: Date.now(),
    cancelReason: reason.trim(),
  })

  await notifyStaff(repo, {
    kind: 'SUPPLY_CANCELLED',
    title: 'Solicitud cancelada',
    body: `${request.item}: ${reason.trim()}`,
    toUserId: request.requestedBy,
    entityType: 'supplyRequests',
    entityId: requestId,
  })

  audit({
    gymId: repo.gymId,
    action: 'SUPPLY_REQUEST_CANCELLED',
    entityType: 'supplyRequests',
    entityId: requestId,
    summary: `Cancelada la solicitud de ${request.item}: ${reason.trim()}`,
    before: { estado: request.status },
    after: { estado: 'CANCELLED', motivo: reason.trim(), canceló: actor.name },
  })
}

// ─────────────────────────────── Consultas ──────────────────────────────────

/**
 * Lo que está abierto. Acotado y ordenado por urgencia.
 *
 * Es la consulta que abre Adrián en el teléfono: no quiere el historial, sino
 * lo que le falta por hacer.
 */
export async function openRequests(repo: TenantRepo, limit = 60): Promise<SupplyRequest[]> {
  const rows = await repo.list('supplyRequests', {
    where: [{ field: 'status', op: 'in', value: ['PENDING', 'IN_PROGRESS'] }],
    orderBy: { field: 'createdAt', dir: 'desc' },
    limit,
  })
  return rows.sort(
    (a, b) => Number(b.urgent ?? false) - Number(a.urgent ?? false) || b.createdAt - a.createdAt,
  )
}

/** Historial, siempre acotado por rango. */
export function readHistory(
  repo: TenantRepo,
  fromMs: number,
  limit = 200,
): Promise<SupplyRequest[]> {
  return repo.list('supplyRequests', {
    where: [{ field: 'createdAt', op: '>=', value: fromMs }],
    orderBy: { field: 'createdAt', dir: 'desc' },
    limit,
  })
}

// ───────────────────────── Notificaciones internas ──────────────────────────

interface NotifyInput {
  kind: InternalNotification['kind']
  title: string
  body: string
  toUserId?: string | null
  toRole?: InternalNotification['toRole']
  entityType?: string
  entityId?: string
}

/**
 * Aviso entre compañeros.
 *
 * NUNCA lanza: que falle un aviso no puede impedir que se entregue el papel.
 *
 * ▸ FUTURO: hoy solo `inapp`. Push, correo y WhatsApp entran aquí, detrás de
 *   esta misma función, sin tocar a quien la llama. Lo que falta no es el
 *   código de este archivo: son las credenciales del proveedor y decidir quién
 *   consiente recibir qué.
 */
export async function notifyStaff(repo: TenantRepo, input: NotifyInput): Promise<void> {
  try {
    await repo.create('internalNotifications', {
      kind: input.kind,
      title: input.title,
      body: input.body,
      toUserId: input.toUserId ?? null,
      toRole: input.toRole ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      readAt: null,
      channel: 'inapp' as const,
    })
  } catch (err) {
    console.warn('[EasyGym] No se pudo crear el aviso interno:', err)
  }
}

/** Avisos para una persona: los suyos y los de su puesto. */
export async function readMyNotifications(
  repo: TenantRepo,
  user: Pick<AppUser, 'uid' | 'role'>,
  limit = 30,
): Promise<InternalNotification[]> {
  const [mine, byRole] = await Promise.all([
    repo.list('internalNotifications', {
      where: [{ field: 'toUserId', op: '==', value: user.uid }],
      orderBy: { field: 'createdAt', dir: 'desc' },
      limit,
    }),
    repo.list('internalNotifications', {
      where: [{ field: 'toRole', op: '==', value: user.role }],
      orderBy: { field: 'createdAt', dir: 'desc' },
      limit,
    }),
  ])

  const seen = new Set<string>()
  return [...mine, ...byRole]
    .filter((n) => (seen.has(n.id) ? false : seen.add(n.id)))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}

export async function markNotificationRead(repo: TenantRepo, id: string): Promise<void> {
  await repo.update('internalNotifications', id, { readAt: Date.now() })
}
