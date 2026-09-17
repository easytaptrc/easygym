import type { AppUser, AuditAction, AuditLog, Role } from '@/types'
import { newId } from '@/lib/utils'
import { platform } from './db'

// ═══════════════════════════════════════════════════════════════════════════
// Auditoría: QUIÉN hizo QUÉ, CUÁNDO y SOBRE QUÉ GIMNASIO.
//
// POR QUÉ IMPORTA
//
// En un gimnasio pasan por el sistema varias personas al día: recepción cobra,
// un administrador edita una membresía, el dueño cambia un precio. Cuando algo
// no cuadra —y siempre acaba no cuadrando— la pregunta es «¿quién hizo esto?».
// Sin bitácora, la respuesta es una discusión; con bitácora, es un dato.
//
// QUÉ SE GUARDA Y QUÉ NO
//
// `before`/`after` llevan SOLO los campos que cambiaron. Un log que copia el
// documento entero deja de ser un log: multiplica el almacenamiento, duplica
// datos personales y hace que nadie lo lea.
//
// AISLAMIENTO
//
// Cada registro lleva `gymId`. Un OWNER ve la bitácora de SU gimnasio; el
// SUPERADMIN ve la de toda la plataforma. Las acciones de plataforma (editar
// un plan, suspender un gimnasio) llevan `gymId: null` o el del gimnasio
// afectado, y solo las ve el SUPERADMIN.
//
// ▸ PRODUCCIÓN: los registros los escribe el servidor (triggers de Firestore),
//   y las reglas cierran `auditLogs` a escritura desde el cliente. Una
//   bitácora que el auditado puede editar no es una bitácora.
// ═══════════════════════════════════════════════════════════════════════════

export type Actor = Pick<AppUser, 'uid' | 'name' | 'role'>

export interface AuditInput {
  gymId: string | null
  /** Si se omite, se usa quien tiene la sesión abierta en esta pestaña. */
  actor?: Actor | null
  action: AuditAction
  entityType: string
  entityId?: string | null
  summary: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

// ─────────────────────────── Quién está operando ────────────────────────────
//
// En una aplicación de una sola página hay exactamente UNA sesión por pestaña,
// así que el actor es un dato del entorno, no un parámetro que cada función de
// servicio deba arrastrar hasta el fondo. `SessionContext` lo fija al iniciar
// sesión y lo borra al cerrarla.
//
// Se puede pasar `actor` explícito cuando quien actúa no es quien tiene la
// sesión — por ejemplo, un proceso del servidor.
//
// ▸ PRODUCCIÓN: el actor lo determina el servidor a partir del token
//   (`context.auth.uid`), no el cliente. Mientras la bitácora la escriba el
//   navegador, este valor es una declaración del propio auditado; por eso las
//   reglas ya prohíben modificar o borrar registros: como mucho puede mentir
//   al escribir, nunca puede tapar lo que ya quedó escrito.

let currentActor: Actor | null = null

export function setAuditActor(actor: Actor | null): void {
  currentActor = actor
}

export function auditActor(): Actor | null {
  return currentActor
}

/**
 * Registra una acción. NUNCA lanza: que la bitácora falle no puede impedir
 * que se cobre una membresía. Si se pierde un registro, se pierde un registro.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const actor = input.actor === undefined ? currentActor : input.actor
    const entry: AuditLog = {
      id: newId('aud'),
      gymId: input.gymId,
      actorId: actor?.uid ?? null,
      actorName: actor?.name ?? 'Sistema',
      actorRole: (actor?.role as Role) ?? 'SYSTEM',
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      before: input.before ?? null,
      after: input.after ?? null,
      createdAt: Date.now(),
    }
    await platform.create('auditLogs', entry)
  } catch (err) {
    console.warn('[EasyGym] No se pudo registrar la auditoría:', err)
  }
}

/** Versión que no hay que esperar. Para no meter latencia en el mostrador. */
export function audit(input: AuditInput): void {
  void recordAudit(input)
}

/**
 * Compara dos objetos y devuelve solo lo que cambió.
 * Es lo que evita que la bitácora se convierta en una copia de la base.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: Array<keyof T>,
): { before: Record<string, unknown>; after: Record<string, unknown>; changed: boolean } {
  const b: Record<string, unknown> = {}
  const a: Record<string, unknown> = {}
  for (const f of fields) {
    if (after[f] === undefined) continue
    if (JSON.stringify(before[f]) !== JSON.stringify(after[f])) {
      b[f as string] = before[f]
      a[f as string] = after[f]
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 }
}

// ───────────────────────────────── Consulta ─────────────────────────────────

export interface AuditQuery {
  /** `null` = toda la plataforma (solo SUPERADMIN). */
  gymId: string | null
  action?: AuditAction
  actorId?: string
  from?: number
  to?: number
  limit?: number
}

/**
 * Lee la bitácora. SIEMPRE acotada por rango y con tope: una bitácora crece
 * más rápido que cualquier otra colección y no se puede listar entera.
 */
export async function readAuditLogs(query: AuditQuery): Promise<AuditLog[]> {
  const where: Array<{ field: string; op: '=='; value: unknown }> = []
  if (query.gymId) where.push({ field: 'gymId', op: '==', value: query.gymId })
  if (query.action) where.push({ field: 'action', op: '==', value: query.action })
  if (query.actorId) where.push({ field: 'actorId', op: '==', value: query.actorId })

  const rows = await platform.list('auditLogs', {
    where,
    orderBy: { field: 'createdAt', dir: 'desc' },
    limit: query.limit ?? 100,
  })

  return rows.filter((r) => {
    if (query.from && r.createdAt < query.from) return false
    if (query.to && r.createdAt > query.to) return false
    return true
  })
}

export function watchAuditLogs(query: AuditQuery, cb: (rows: AuditLog[]) => void) {
  const where: Array<{ field: string; op: '=='; value: unknown }> = []
  if (query.gymId) where.push({ field: 'gymId', op: '==', value: query.gymId })
  if (query.action) where.push({ field: 'action', op: '==', value: query.action })

  return platform.watch(
    'auditLogs',
    { where, orderBy: { field: 'createdAt', dir: 'desc' }, limit: query.limit ?? 100 },
    cb,
  )
}

// ───────────────────────── Presentación de las acciones ─────────────────────

export const ACTION_LABEL: Record<AuditAction, string> = {
  EMPLOYEE_CREATED: 'Alta de empleado',
  EMPLOYEE_UPDATED: 'Edición de empleado',
  EMPLOYEE_DEACTIVATED: 'Baja de empleado',
  EMPLOYEE_REACTIVATED: 'Reactivación de empleado',
  EMPLOYEE_SCHEDULE_CHANGED: 'Cambio de horario',
  WORK_ATTENDANCE_MANUAL: 'Fichaje manual',
  WORK_ABSENCE_JUSTIFIED: 'Falta justificada',
  DEVICE_ADDED: 'Dispositivo agregado',
  DEVICE_UPDATED: 'Dispositivo editado',
  DEVICE_REMOVED: 'Dispositivo eliminado',
  SUPPLY_REQUEST_CREATED: 'Solicitud de insumo',
  SUPPLY_REQUEST_ASSIGNED: 'Solicitud tomada',
  SUPPLY_REQUEST_DELIVERED: 'Solicitud entregada',
  SUPPLY_REQUEST_CANCELLED: 'Solicitud cancelada',
  MEMBER_CREATED: 'Alta de socio',
  MEMBER_UPDATED: 'Edición de socio',
  MEMBER_DEACTIVATED: 'Baja de socio',
  MEMBER_REACTIVATED: 'Reactivación de socio',
  MEMBER_FINGERPRINT_ENROLLED: 'Alta de huella',
  MEMBER_FINGERPRINT_REMOVED: 'Baja de huella',
  MEMBERSHIP_CONTRACTED: 'Membresía contratada',
  MEMBERSHIP_RENEWED: 'Membresía renovada',
  MEMBERSHIP_PLAN_CREATED: 'Membresía creada',
  MEMBERSHIP_PLAN_UPDATED: 'Membresía editada',
  MEMBERSHIP_PLAN_DELETED: 'Membresía eliminada',
  PAYMENT_REGISTERED: 'Pago registrado',
  PAYMENT_REFUNDED: 'Pago devuelto',
  VISIT_REGISTERED: 'Visita registrada',
  SALE_REGISTERED: 'Venta registrada',
  ATTENDANCE_RECORDED: 'Asistencia registrada',
  ACCESS_DENIED: 'Acceso denegado',
  CLASS_CREATED: 'Clase creada',
  CLASS_UPDATED: 'Clase editada',
  CLASS_DELETED: 'Clase eliminada',
  RESERVATION_CREATED: 'Reservación creada',
  RESERVATION_CANCELLED: 'Reservación cancelada',
  BIKES_REGENERATED: 'Salón de spinning regenerado',
  SETTINGS_UPDATED: 'Configuración modificada',
  STAFF_CREATED: 'Usuario creado',
  STAFF_UPDATED: 'Usuario editado',
  STAFF_ROLE_CHANGED: 'Cambio de rol',
  STAFF_DEACTIVATED: 'Usuario desactivado',
  AGGREGATES_REBUILT: 'Estadísticas recalculadas',
  GYM_CREATED: 'Gimnasio creado',
  GYM_STATUS_CHANGED: 'Estado del gimnasio',
  GYM_PLAN_CHANGED: 'Cambio de plan',
  PLAN_UPDATED: 'Plan modificado',
  PLAN_FEATURE_TOGGLED: 'Funcionalidad de plan',
  PLAN_LIMITS_CHANGED: 'Límites de plan',
  PLAN_PRICE_CHANGED: 'Precio de plan',
}

/** Agrupación para filtrar en la interfaz. */
export const ACTION_GROUPS: Array<{ label: string; actions: AuditAction[] }> = [
  {
    label: 'Socios',
    actions: [
      'MEMBER_CREATED',
      'MEMBER_UPDATED',
      'MEMBER_DEACTIVATED',
      'MEMBER_REACTIVATED',
      'MEMBER_FINGERPRINT_ENROLLED',
      'MEMBER_FINGERPRINT_REMOVED',
    ],
  },
  {
    label: 'Dinero',
    actions: [
      'PAYMENT_REGISTERED',
      'PAYMENT_REFUNDED',
      'VISIT_REGISTERED',
      'SALE_REGISTERED',
      'MEMBERSHIP_CONTRACTED',
      'MEMBERSHIP_RENEWED',
    ],
  },
  {
    label: 'Operación',
    actions: [
      'ATTENDANCE_RECORDED',
      'ACCESS_DENIED',
      'CLASS_CREATED',
      'CLASS_UPDATED',
      'CLASS_DELETED',
      'RESERVATION_CREATED',
      'RESERVATION_CANCELLED',
      'BIKES_REGENERATED',
    ],
  },
  {
    label: 'Administración',
    actions: [
      'SETTINGS_UPDATED',
      'STAFF_CREATED',
      'STAFF_UPDATED',
      'STAFF_ROLE_CHANGED',
      'STAFF_DEACTIVATED',
      'MEMBERSHIP_PLAN_CREATED',
      'MEMBERSHIP_PLAN_UPDATED',
      'MEMBERSHIP_PLAN_DELETED',
      'AGGREGATES_REBUILT',
    ],
  },
  {
    label: 'Personal',
    actions: [
      'EMPLOYEE_CREATED',
      'EMPLOYEE_UPDATED',
      'EMPLOYEE_DEACTIVATED',
      'EMPLOYEE_REACTIVATED',
      'EMPLOYEE_SCHEDULE_CHANGED',
      'WORK_ATTENDANCE_MANUAL',
      'WORK_ABSENCE_JUSTIFIED',
    ],
  },
  {
    label: 'Insumos y equipo',
    actions: [
      'SUPPLY_REQUEST_CREATED',
      'SUPPLY_REQUEST_ASSIGNED',
      'SUPPLY_REQUEST_DELIVERED',
      'SUPPLY_REQUEST_CANCELLED',
      'DEVICE_ADDED',
      'DEVICE_UPDATED',
      'DEVICE_REMOVED',
    ],
  },
  {
    label: 'Plataforma',
    actions: [
      'GYM_CREATED',
      'GYM_STATUS_CHANGED',
      'GYM_PLAN_CHANGED',
      'PLAN_UPDATED',
      'PLAN_FEATURE_TOGGLED',
      'PLAN_LIMITS_CHANGED',
      'PLAN_PRICE_CHANGED',
    ],
  },
]

/** Color del punto en la línea de tiempo, por severidad del evento. */
export function actionTone(action: AuditAction): 'gym' | 'cyber' | 'warn' | 'danger' | 'plasma' {
  if (action.startsWith('PLAN_') || action.startsWith('GYM_')) return 'plasma'
  if (
    action === 'MEMBER_DEACTIVATED' ||
    action === 'STAFF_DEACTIVATED' ||
    action === 'EMPLOYEE_DEACTIVATED' ||
    action === 'PAYMENT_REFUNDED' ||
    action === 'ACCESS_DENIED' ||
    action === 'SUPPLY_REQUEST_CANCELLED' ||
    action === 'DEVICE_REMOVED' ||
    action.endsWith('_DELETED')
  ) {
    return 'danger'
  }
  if (
    action === 'SETTINGS_UPDATED' ||
    action === 'STAFF_ROLE_CHANGED' ||
    action === 'WORK_ATTENDANCE_MANUAL' ||
    action === 'WORK_ABSENCE_JUSTIFIED' ||
    action === 'EMPLOYEE_SCHEDULE_CHANGED'
  ) {
    return 'warn'
  }
  if (action === 'SUPPLY_REQUEST_DELIVERED') return 'gym'
  if (action.startsWith('PAYMENT') || action.startsWith('MEMBERSHIP') || action === 'SALE_REGISTERED') {
    return 'gym'
  }
  return 'cyber'
}
