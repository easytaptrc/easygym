import type { Member, MemberStatus } from '@/types'
import { daysUntil } from './date'

// ═══════════════════════════════════════════════════════════════════════════
// Estado de un socio — derivación pura.
//
// Vive en `lib/` y no en `services/` a propósito: es una función sin efectos
// que necesitan tanto `services/members.ts` (al escribir) como
// `services/aggregates.ts` (al recalcular contadores). Si estuviera dentro de
// members, aggregates tendría que importarlo y members importar aggregates —
// un ciclo de módulos.
//
// El estado NO es una verdad guardada: se DERIVA de `expiresAt` cada vez que
// se consulta. El campo `status` del documento es una caché para poder filtrar
// en el servidor, y se refresca cuando cambia algo relevante. Derivarlo evita
// el clásico fallo de "quedó ACTIVO pero venció anoche".
// ═══════════════════════════════════════════════════════════════════════════

export function computeStatus(
  member: Pick<Member, 'expiresAt' | 'status'>,
  nearExpirationDays = 7,
): MemberStatus {
  if (member.status === 'INACTIVE') return 'INACTIVE'
  if (!member.expiresAt) return 'EXPIRED'
  const remaining = daysUntil(member.expiresAt)
  if (remaining < 0) return 'EXPIRED'
  if (remaining <= nearExpirationDays) return 'NEAR_EXPIRATION'
  return 'ACTIVE'
}

export function daysLeft(member: Pick<Member, 'expiresAt'>): number {
  return member.expiresAt ? daysUntil(member.expiresAt) : 0
}

export const STATUS_LABEL: Record<MemberStatus, string> = {
  ACTIVE: 'Activo',
  NEAR_EXPIRATION: 'Por vencer',
  EXPIRED: 'Vencido',
  INACTIVE: 'Inactivo',
}

/** Clases de Tailwind por estado — un solo lugar para el color de los chips. */
export const STATUS_CLASS: Record<MemberStatus, string> = {
  ACTIVE: 'bg-tap-500/15 text-tap-300 ring-1 ring-inset ring-tap-500/30',
  NEAR_EXPIRATION: 'bg-warn-500/15 text-warn-300 ring-1 ring-inset ring-warn-500/30',
  EXPIRED: 'bg-danger-500/15 text-danger-300 ring-1 ring-inset ring-danger-500/30',
  INACTIVE: 'bg-ink-700/40 text-ink-400 ring-1 ring-inset ring-white/10',
}

export const STATUS_DOT: Record<MemberStatus, string> = {
  ACTIVE: 'bg-tap-400',
  NEAR_EXPIRATION: 'bg-warn-400',
  EXPIRED: 'bg-danger-400',
  INACTIVE: 'bg-ink-500',
}
