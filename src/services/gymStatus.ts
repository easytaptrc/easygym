import type { Gym, SubscriptionStatus } from '@/types'

// ═══════════════════════════════════════════════════════════════════════════
// Política de estados de la suscripción.
//
// Un solo archivo decide qué puede hacer un gimnasio según cómo esté su
// suscripción con EasyGym. Sin esto, la regla acaba repetida —y contradicha—
// en el sidebar, en las rutas, en los servicios y en las reglas de Firestore.
//
// PRINCIPIO RECTOR
//
// Restringir el acceso NUNCA significa borrar datos. Un gimnasio que vuelve a
// pagar recupera todo tal como lo dejó: sus socios, su historial, su
// configuración. Lo único que se pierde es el tiempo que estuvo bloqueado.
// ═══════════════════════════════════════════════════════════════════════════

export type GymCapability =
  /** Leer: ver socios, reportes, configuración. */
  | 'read'
  /** Operar: cobrar, dar de alta, registrar asistencia, reservar. */
  | 'write'
  /** Administrar la propia suscripción (pagar, cambiar de plan). */
  | 'billing'

export interface StatusPolicy {
  status: SubscriptionStatus
  label: string
  /** Qué puede hacer el gimnasio en este estado. */
  can: Record<GymCapability, boolean>
  /** Aviso que se muestra en la barra superior, si lo hay. */
  banner: {
    tone: 'info' | 'warn' | 'danger'
    title: string
    detail: string
    cta: string
    to: string
  } | null
  /** Motivo que se muestra cuando se bloquea una operación. */
  blockedReason: string | null
}

export const STATUS_POLICIES: Record<SubscriptionStatus, StatusPolicy> = {
  ACTIVE: {
    status: 'ACTIVE',
    label: 'Activa',
    can: { read: true, write: true, billing: true },
    banner: null,
    blockedReason: null,
  },

  TRIALING: {
    status: 'TRIALING',
    label: 'En prueba',
    can: { read: true, write: true, billing: true },
    banner: {
      tone: 'info',
      title: 'Estás en periodo de prueba',
      detail: 'Agrega tu método de pago para no interrumpir el servicio cuando termine.',
      cta: 'Activar suscripción',
      to: '/suscripcion',
    },
    blockedReason: null,
  },

  // Un cargo rechazado no puede dejar a un negocio sin poder cobrar a sus
  // socios. Se avisa fuerte y se le da margen; bloquear aquí haría más daño
  // que esperar unos días.
  PAST_DUE: {
    status: 'PAST_DUE',
    label: 'Pago pendiente',
    can: { read: true, write: true, billing: true },
    banner: {
      tone: 'warn',
      title: 'No pudimos procesar tu último pago',
      detail: 'Actualiza tu método de pago para no perder acceso a las funciones de tu plan.',
      cta: 'Actualizar pago',
      to: '/suscripcion',
    },
    blockedReason: null,
  },

  SUSPENDED: {
    status: 'SUSPENDED',
    label: 'Suspendida',
    can: { read: true, write: false, billing: true },
    banner: {
      tone: 'danger',
      title: 'Tu cuenta está suspendida',
      detail: 'Puedes consultar tu información, pero no registrar operaciones nuevas.',
      cta: 'Reactivar',
      to: '/suscripcion',
    },
    blockedReason:
      'Tu gimnasio está suspendido. Puedes consultar tu información, pero no registrar operaciones nuevas. Reactiva tu suscripción para volver a operar.',
  },

  CANCELED: {
    status: 'CANCELED',
    label: 'Cancelada',
    can: { read: true, write: false, billing: true },
    banner: {
      tone: 'danger',
      title: 'Tu suscripción fue cancelada',
      detail: 'Conservamos toda tu información. Vuelve a contratar cuando quieras.',
      cta: 'Ver planes',
      to: '/planes',
    },
    blockedReason:
      'Tu suscripción está cancelada. Tus datos siguen intactos: vuelve a contratar un plan para poder operar de nuevo.',
  },
}

export function policyFor(gym: Pick<Gym, 'subscriptionStatus'> | null | undefined): StatusPolicy {
  return STATUS_POLICIES[gym?.subscriptionStatus ?? 'ACTIVE'] ?? STATUS_POLICIES.ACTIVE
}

/** ¿Puede este gimnasio registrar operaciones nuevas? */
export function canOperate(gym: Pick<Gym, 'subscriptionStatus'> | null | undefined): boolean {
  return policyFor(gym).can.write
}

export function canRead(gym: Pick<Gym, 'subscriptionStatus'> | null | undefined): boolean {
  return policyFor(gym).can.read
}

/** Estados en los que el gimnasio aparece públicamente en /g/:slug. */
export function isPubliclyVisible(gym: Pick<Gym, 'subscriptionStatus'>): boolean {
  return gym.subscriptionStatus === 'ACTIVE' || gym.subscriptionStatus === 'TRIALING'
}

/** Error que se lanza cuando la suscripción impide la operación. */
export class GymSuspendedError extends Error {
  readonly code = 'gym-suspended'
  constructor(gym: Pick<Gym, 'subscriptionStatus'>) {
    super(policyFor(gym).blockedReason ?? 'Tu gimnasio no puede registrar operaciones en este momento.')
  }
}

/**
 * Comprobación que llaman los servicios antes de escribir.
 *
 * Es la defensa del lado cliente. La del servidor está en `firestore.rules`,
 * que comprueba `subscriptionStatus` del gimnasio antes de permitir escrituras.
 */
export function assertCanOperate(gym: Pick<Gym, 'subscriptionStatus'> | null | undefined): void {
  if (!gym) return
  if (!canOperate(gym)) throw new GymSuspendedError(gym)
}

// ────────────────────── Gimnasio de la sesión en curso ──────────────────────
//
// Los servicios reciben un `TenantRepo`, no el documento del gimnasio, así que
// no pueden consultar su estado por sí mismos. En vez de arrastrar el gimnasio
// como parámetro por toda la aplicación —donde bastaría con olvidarlo una vez
// para abrir un agujero—, `SessionContext` lo deja aquí cuando cambia.
//
// Esto es la cortesía: avisar antes de que la operación falle. Quien decide de
// verdad es `subscriptionAllowsWrites()` en firestore.rules, que no depende de
// que este valor esté puesto ni de que el navegador colabore.

let operatingGym: Pick<Gym, 'subscriptionStatus'> | null = null

export function setOperatingGym(gym: Pick<Gym, 'subscriptionStatus'> | null): void {
  operatingGym = gym
}

/** Comprobación que llaman los servicios sin conocer el gimnasio. */
export function assertCurrentGymCanOperate(): void {
  assertCanOperate(operatingGym)
}

export const STATUS_TONE: Record<SubscriptionStatus, 'gym' | 'cyber' | 'warn' | 'danger'> = {
  ACTIVE: 'gym',
  TRIALING: 'cyber',
  PAST_DUE: 'warn',
  SUSPENDED: 'danger',
  CANCELED: 'danger',
}
