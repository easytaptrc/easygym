import {
  Banknote,
  BarChart3,
  Bike,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  FileClock,
  Fingerprint,
  LayoutDashboard,
  Package,
  PackageOpen,
  ScanLine,
  Settings,
  ShoppingCart,
  Ticket,
  UserCog,
  Users,
  Users2,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { FeatureKey } from '@/types'
import type { Permission } from '@/services/auth'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Permiso necesario; si falta, el enlace no se pinta. */
  permission: Permission
  /** Funcionalidad de plan; si falta, se pinta con candado. */
  feature?: FeatureKey
  /** Agrupación en el sidebar. */
  group: 'Operación' | 'Gestión' | 'Negocio' | 'Personal' | 'Sistema'
  /** Marca visual para funciones nuevas. */
  badge?: string
}

export const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Panel', icon: LayoutDashboard, permission: 'reports.read', group: 'Operación' },
  { to: '/recepcion', label: 'Recepción', icon: ScanLine, permission: 'reception.use', group: 'Operación' },
  { to: '/socios', label: 'Socios', icon: Users, permission: 'members.read', group: 'Operación' },
  { to: '/visitas', label: 'Visitas', icon: Ticket, permission: 'visits.write', group: 'Operación' },
  {
    to: '/asistencias',
    label: 'Asistencias',
    icon: Fingerprint,
    permission: 'attendance.write',
    group: 'Operación',
  },

  {
    to: '/membresias',
    label: 'Membresías',
    icon: CalendarCheck,
    permission: 'memberships.manage',
    group: 'Gestión',
  },
  { to: '/pagos', label: 'Pagos', icon: Banknote, permission: 'payments.read', group: 'Gestión' },
  {
    to: '/clases',
    label: 'Clases',
    icon: CalendarDays,
    permission: 'classes.manage',
    feature: 'classes',
    group: 'Gestión',
  },
  {
    to: '/reservaciones',
    label: 'Reservaciones',
    icon: CalendarCheck,
    permission: 'reservations.manage',
    feature: 'reservations',
    group: 'Gestión',
  },
  {
    to: '/spinning',
    label: 'Spinning',
    icon: Bike,
    permission: 'reservations.manage',
    feature: 'spinningMap',
    group: 'Gestión',
  },

  { to: '/pos', label: 'Punto de venta', icon: ShoppingCart, permission: 'pos.use', feature: 'posBasic', group: 'Negocio' },
  {
    to: '/inventario',
    label: 'Inventario',
    icon: Package,
    permission: 'inventory.manage',
    feature: 'inventory',
    group: 'Negocio',
  },
  { to: '/reportes', label: 'Reportes', icon: BarChart3, permission: 'reports.read', group: 'Negocio' },
  {
    to: '/reportes/personal',
    label: 'Reporte de personal',
    icon: FileClock,
    permission: 'workAttendance.read',
    feature: 'employeeAttendance',
    group: 'Negocio',
  },

  // ── Personal (Fase 4) ──
  {
    to: '/empleados',
    label: 'Empleados',
    icon: Users2,
    permission: 'employees.read',
    feature: 'employees',
    group: 'Personal',
  },
  {
    to: '/empleados/asistencia',
    label: 'Asistencia',
    icon: CalendarClock,
    permission: 'workAttendance.read',
    feature: 'employeeAttendance',
    group: 'Personal',
  },
  {
    to: '/insumos',
    label: 'Insumos',
    icon: PackageOpen,
    permission: 'supplies.request',
    feature: 'supplyRequests',
    group: 'Personal',
  },

  { to: '/usuarios', label: 'Usuarios', icon: UserCog, permission: 'staff.manage', group: 'Sistema' },
  { to: '/actividad', label: 'Actividad', icon: FileClock, permission: 'settings.manage', group: 'Sistema' },
  {
    to: '/configuracion/dispositivos',
    label: 'Dispositivos',
    icon: Fingerprint,
    permission: 'devices.manage',
    feature: 'biometrics',
    group: 'Sistema',
  },
  { to: '/configuracion', label: 'Configuración', icon: Settings, permission: 'settings.manage', group: 'Sistema' },
  { to: '/suscripcion', label: 'Mi suscripción', icon: Wallet, permission: 'gym.manage', group: 'Sistema' },
]

export const NAV_GROUPS: Array<NavItem['group']> = [
  'Operación',
  'Gestión',
  'Negocio',
  'Personal',
  'Sistema',
]

// ────────────────────────── Portal del socio (móvil) ────────────────────────

export interface PortalNavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

export const PORTAL_NAV: PortalNavItem[] = [
  { to: '/portal', label: 'Inicio', icon: LayoutDashboard, end: true },
  { to: '/portal/reservaciones', label: 'Clases', icon: CalendarDays },
  { to: '/portal/asistencias', label: 'Historial', icon: Fingerprint },
  { to: '/portal/pagos', label: 'Pagos', icon: Banknote },
  { to: '/portal/perfil', label: 'Perfil', icon: UserCog },
]
