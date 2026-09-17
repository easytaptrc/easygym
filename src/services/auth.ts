import type { AppUser, Role } from '@/types'
import { platform, isMockDriver } from './db'
import { getFirebaseAuth } from './firebase'

// ═══════════════════════════════════════════════════════════════════════════
// Autenticación.
//
// En modo mock las credenciales viven en localStorage: sirve para demostrar
// los 6 roles sin crear cuentas reales. En modo firebase se usa Firebase
// Authentication y el documento /users/{uid} aporta rol y gymId.
//
// El rol y el gymId NUNCA se leen de algo que el navegador pueda editar:
// en producción son custom claims firmados por el servidor, y /users/{uid}
// no es escribible por el propio usuario (ver firestore.rules).
// ═══════════════════════════════════════════════════════════════════════════

const SESSION_KEY = 'easygym:session:v1'
const CREDS_KEY = 'easygym:creds:v1'

export interface Credentials {
  email: string
  password: string
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid-credentials' | 'email-in-use' | 'inactive' | 'unknown' = 'unknown',
  ) {
    super(message)
  }
}

type CredStore = Record<string, { uid: string; password: string }>

function readCreds(): CredStore {
  try {
    return JSON.parse(localStorage.getItem(CREDS_KEY) ?? '{}') as CredStore
  } catch {
    return {}
  }
}

function writeCreds(store: CredStore): void {
  localStorage.setItem(CREDS_KEY, JSON.stringify(store))
}

const normEmail = (e: string) => e.trim().toLowerCase()

// ───────────────────────────────── API pública ──────────────────────────────

export const auth = {
  /** Usuario de la sesión actual, o null. */
  async current(): Promise<AppUser | null> {
    if (isMockDriver) {
      const uid = localStorage.getItem(SESSION_KEY)
      if (!uid) return null
      return platform.get('users', uid)
    }
    const fbUser = getFirebaseAuth().currentUser
    if (!fbUser) return null
    return platform.get('users', fbUser.uid)
  },

  async signIn({ email, password }: Credentials): Promise<AppUser> {
    if (isMockDriver) {
      const entry = readCreds()[normEmail(email)]
      if (!entry || entry.password !== password) {
        throw new AuthError('Correo o contraseña incorrectos.', 'invalid-credentials')
      }
      const user = await platform.get('users', entry.uid)
      if (!user) throw new AuthError('Este usuario ya no existe.', 'invalid-credentials')
      if (!user.active) throw new AuthError('Tu cuenta está desactivada. Contacta al administrador.', 'inactive')
      localStorage.setItem(SESSION_KEY, user.uid)
      await platform.update('users', user.uid, { lastLoginAt: Date.now() })
      return { ...user, lastLoginAt: Date.now() }
    }

    const { signInWithEmailAndPassword } = await import('firebase/auth')
    try {
      const cred = await signInWithEmailAndPassword(getFirebaseAuth(), normEmail(email), password)
      const user = await platform.get('users', cred.user.uid)
      if (!user) throw new AuthError('Tu cuenta no tiene perfil asignado.', 'invalid-credentials')
      if (!user.active) throw new AuthError('Tu cuenta está desactivada.', 'inactive')
      return user
    } catch (err) {
      if (err instanceof AuthError) throw err
      throw new AuthError('Correo o contraseña incorrectos.', 'invalid-credentials')
    }
  },

  /**
   * Crea la cuenta de acceso. NO crea el gimnasio: eso lo hace
   * `provisioning.registerGym`, que es quien conoce el flujo completo.
   */
  async signUp(params: {
    email: string
    password: string
    name: string
    phone?: string
    role: Role
    gymId: string
    memberId?: string | null
  }): Promise<AppUser> {
    const email = normEmail(params.email)

    if (isMockDriver) {
      const creds = readCreds()
      if (creds[email]) throw new AuthError('Ese correo ya está registrado.', 'email-in-use')
      const uid = `u_${Math.random().toString(36).slice(2, 12)}`
      const user: AppUser = {
        uid,
        email,
        name: params.name,
        phone: params.phone ?? '',
        role: params.role,
        gymId: params.gymId,
        memberId: params.memberId ?? null,
        avatarUrl: null,
        active: true,
        lastLoginAt: null,
        createdAt: Date.now(),
      }
      await platform.create('users', { ...user, id: uid } as never)
      creds[email] = { uid, password: params.password }
      writeCreds(creds)
      return user
    }

    const { createUserWithEmailAndPassword, updateProfile } = await import('firebase/auth')
    const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), email, params.password)
    await updateProfile(cred.user, { displayName: params.name })
    const user: AppUser = {
      uid: cred.user.uid,
      email,
      name: params.name,
      phone: params.phone ?? '',
      role: params.role,
      gymId: params.gymId,
      memberId: params.memberId ?? null,
      avatarUrl: null,
      active: true,
      lastLoginAt: Date.now(),
      createdAt: Date.now(),
    }
    await platform.create('users', { ...user, id: cred.user.uid } as never)
    return user
  },

  async signOut(): Promise<void> {
    if (isMockDriver) {
      localStorage.removeItem(SESSION_KEY)
      return
    }
    const { signOut } = await import('firebase/auth')
    await signOut(getFirebaseAuth())
  },

  /** Inicia sesión directamente como un usuario demo (botones de la pantalla de acceso). */
  async signInAsDemo(uid: string): Promise<AppUser> {
    if (!isMockDriver) throw new AuthError('Los accesos demo solo existen en modo mock.')
    const user = await platform.get('users', uid)
    if (!user) throw new AuthError('Usuario demo no encontrado. Reinicia la demo.')
    localStorage.setItem(SESSION_KEY, uid)
    return user
  },

  /** Registra la contraseña de un usuario demo ya existente (usado por el seed). */
  registerMockCredential(email: string, password: string, uid: string): void {
    const creds = readCreds()
    creds[normEmail(email)] = { uid, password }
    writeCreds(creds)
  },

  clearMockCredentials(): void {
    localStorage.removeItem(CREDS_KEY)
    localStorage.removeItem(SESSION_KEY)
  },

  async changePassword(email: string, next: string): Promise<void> {
    if (isMockDriver) {
      const creds = readCreds()
      const entry = creds[normEmail(email)]
      if (!entry) throw new AuthError('Usuario no encontrado.')
      entry.password = next
      writeCreds(creds)
      return
    }
    const { updatePassword } = await import('firebase/auth')
    const u = getFirebaseAuth().currentUser
    if (!u) throw new AuthError('No hay sesión activa.')
    await updatePassword(u, next)
  },
}

// ─────────────────────────── Permisos por rol ───────────────────────────────

/** Capacidades atómicas del producto. La UI pregunta por estas, no por el rol. */
export type Permission =
  | 'gym.manage'
  | 'members.read'
  | 'members.write'
  | 'memberships.manage'
  | 'payments.read'
  | 'payments.write'
  | 'visits.write'
  | 'attendance.write'
  | 'reception.use'
  | 'classes.manage'
  | 'reservations.manage'
  | 'staff.manage'
  | 'settings.manage'
  | 'reports.read'
  | 'pos.use'
  | 'inventory.manage'
  | 'portal.use'
  | 'platform.admin'
  // ── Operación interna (Fase 4) ──
  /** Ver la ficha del personal. No incluye editarla. */
  | 'employees.read'
  /** Alta, edición, baja, horario y tolerancia. */
  | 'employees.manage'
  /** Ver asistencia laboral, resúmenes y reportes de personal. */
  | 'workAttendance.read'
  /** Fichar a mano y justificar faltas. Tiene consecuencias: se audita. */
  | 'workAttendance.write'
  /** Pedir insumos. Lo hace cualquiera que trabaje en el mostrador. */
  | 'supplies.request'
  /** Tomar una solicitud y marcarla entregada. */
  | 'supplies.fulfill'
  /** Dar de alta lectores, controladores y torniquetes. */
  | 'devices.manage'

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPERADMIN: [
    'platform.admin',
    'gym.manage',
    'members.read',
    'members.write',
    'memberships.manage',
    'payments.read',
    'payments.write',
    'visits.write',
    'attendance.write',
    'reception.use',
    'classes.manage',
    'reservations.manage',
    'staff.manage',
    'settings.manage',
    'reports.read',
    'pos.use',
    'inventory.manage',
    'employees.read',
    'employees.manage',
    'workAttendance.read',
    'workAttendance.write',
    'supplies.request',
    'supplies.fulfill',
    'devices.manage',
  ],
  OWNER: [
    'gym.manage',
    'members.read',
    'members.write',
    'memberships.manage',
    'payments.read',
    'payments.write',
    'visits.write',
    'attendance.write',
    'reception.use',
    'classes.manage',
    'reservations.manage',
    'staff.manage',
    'settings.manage',
    'reports.read',
    'pos.use',
    'inventory.manage',
    'employees.read',
    'employees.manage',
    'workAttendance.read',
    'workAttendance.write',
    'supplies.request',
    'supplies.fulfill',
    'devices.manage',
  ],
  ADMIN: [
    'members.read',
    'members.write',
    'memberships.manage',
    'payments.read',
    'payments.write',
    'visits.write',
    'attendance.write',
    'reception.use',
    'classes.manage',
    'reservations.manage',
    'reports.read',
    'pos.use',
    'inventory.manage',
    'settings.manage',
    'employees.read',
    'employees.manage',
    'workAttendance.read',
    'workAttendance.write',
    'supplies.request',
    'supplies.fulfill',
    'devices.manage',
  ],
  RECEPCIONISTA: [
    'members.read',
    'members.write',
    'payments.read',
    'payments.write',
    'visits.write',
    'attendance.write',
    'reception.use',
    'pos.use',
    // Consulta el directorio del personal y pide insumos, pero NO da de alta
    // empleados ni justifica faltas: eso decide sobre el sueldo de otro.
    'employees.read',
    'supplies.request',
  ],
  ENTRENADOR: [
    'members.read',
    'classes.manage',
    'reservations.manage',
    'attendance.write',
    // Ve quién es quién y puede pedir material para su clase. Nada más: no
    // administra personal ni toca configuración financiera.
    'employees.read',
    'supplies.request',
  ],
  // Adrián, el de mantenimiento. Entra desde su teléfono, ve lo que le toca
  // hacer y lo marca. No necesita —ni debe tener— nada más.
  MANTENIMIENTO: ['supplies.request', 'supplies.fulfill'],
  MEMBER: ['portal.use'],
}

export function can(user: AppUser | null, permission: Permission): boolean {
  if (!user || !user.active) return false
  return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPERADMIN: 'Super administrador',
  OWNER: 'Dueño',
  ADMIN: 'Administrador',
  RECEPCIONISTA: 'Recepcionista',
  ENTRENADOR: 'Entrenador',
  MANTENIMIENTO: 'Mantenimiento',
  MEMBER: 'Socio',
}

/** A dónde mandar a cada rol después de iniciar sesión. */
export function homeFor(user: AppUser): string {
  switch (user.role) {
    case 'SUPERADMIN':
      return '/superadmin'
    case 'MEMBER':
      return '/portal'
    case 'RECEPCIONISTA':
      return '/recepcion'
    case 'ENTRENADOR':
      return '/clases'
    // Adrián abre la aplicación para una cosa: ver qué le han pedido.
    case 'MANTENIMIENTO':
      return '/insumos'
    default:
      return '/dashboard'
  }
}
