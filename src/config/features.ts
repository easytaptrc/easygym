import type { FeatureKey } from '@/types'

// ═══════════════════════════════════════════════════════════════════════════
// Catálogo central de funcionalidades.
//
// Es la ÚNICA lista de qué puede hacer EasyGym. El SuperAdmin la usa para
// pintar la matriz de planes, las reglas de Firestore comprueban estas mismas
// claves, y `hasFeature()` las resuelve en runtime.
//
// Añadir una funcionalidad nueva es:
//   1. añadir su clave a `FeatureKey` en types/
//   2. añadir su entrada aquí
//   3. usarla con <PlanGuard feature="…"> o hasFeature()
//
// Lo que NO hay que hacer es escribir `if (plan === 'PRO')` en ningún sitio.
// ═══════════════════════════════════════════════════════════════════════════

export type FeatureCategory =
  | 'Operación'
  | 'Cobros'
  | 'Clases'
  | 'Acceso'
  | 'Negocio'
  | 'Plataforma'
  | 'Personal'

export interface FeatureDefinition {
  key: FeatureKey
  name: string
  description: string
  category: FeatureCategory
  /**
   * Funcionalidad esencial: sin ella el producto no sirve. El SuperAdmin no
   * puede apagarla en ningún plan — apagar "Socios" en Starter dejaría a esos
   * gimnasios con una aplicación vacía y sin forma de operar.
   */
  core?: boolean
  /**
   * Colección de Firestore que esta funcionalidad protege. Las reglas
   * comprueban `gyms/{gymId}.features[key]` antes de permitir escrituras ahí.
   * Sirve de documentación viva de qué se valida en el servidor.
   */
  guardsCollections?: string[]
}

export const FEATURES: FeatureDefinition[] = [
  // ── Operación ──
  {
    key: 'members',
    name: 'Socios',
    description: 'Alta, edición, baja y ficha completa de cada socio.',
    category: 'Operación',
    core: true,
    guardsCollections: ['members'],
  },
  {
    key: 'memberships',
    name: 'Membresías',
    description: 'Catálogo de planes del gimnasio, contratación y renovación.',
    category: 'Operación',
    core: true,
    guardsCollections: ['membershipPlans', 'memberships'],
  },
  {
    key: 'attendance',
    name: 'Control de asistencia',
    description: 'Registro de entradas con su método y su resultado.',
    category: 'Operación',
    core: true,
    guardsCollections: ['attendance'],
  },
  {
    key: 'visits',
    name: 'Visitas',
    description: 'Pases de un día para quien no es socio.',
    category: 'Operación',
    guardsCollections: ['visits'],
  },
  {
    key: 'basicReports',
    name: 'Reportes básicos',
    description: 'Ingresos, socios y actividad del periodo.',
    category: 'Operación',
  },
  {
    key: 'advancedReports',
    name: 'Reportes avanzados',
    description: 'Ocupación por clase, constancia de socios y exportación.',
    category: 'Operación',
  },
  {
    key: 'enterpriseReports',
    name: 'Reportes empresariales',
    description: 'Consolidado entre sucursales y comparativas.',
    category: 'Operación',
  },

  // ── Cobros ──
  {
    key: 'manualPayments',
    name: 'Pagos manuales',
    description: 'Cobro en efectivo, tarjeta o transferencia desde recepción.',
    category: 'Cobros',
    core: true,
    guardsCollections: ['payments'],
  },
  {
    key: 'paymentHistory',
    name: 'Historial de pagos',
    description: 'Todos los cobros con su recibo imprimible.',
    category: 'Cobros',
  },
  {
    key: 'stripeAutoPayments',
    name: 'Cobros con Stripe',
    description: 'El socio paga con tarjeta desde su portal.',
    category: 'Cobros',
  },
  {
    key: 'autoRenewals',
    name: 'Renovación automática',
    description: 'Stripe cobra la membresía cada periodo sin intervención.',
    category: 'Cobros',
  },
  {
    key: 'posBasic',
    name: 'Punto de venta',
    description: 'Venta de bebidas, suplementos y accesorios.',
    category: 'Cobros',
    guardsCollections: ['products', 'sales'],
  },
  {
    key: 'posFull',
    name: 'POS completo',
    description: 'Descuentos, múltiples cajas y cierre de turno.',
    category: 'Cobros',
  },
  {
    key: 'inventory',
    name: 'Inventario',
    description: 'Existencias, entradas, salidas y alertas de stock bajo.',
    category: 'Cobros',
    guardsCollections: ['inventory'],
  },

  // ── Clases ──
  {
    key: 'classes',
    name: 'Clases',
    description: 'Spinning, box, yoga… con instructor, cupo y horario.',
    category: 'Clases',
    guardsCollections: ['classes'],
  },
  {
    key: 'reservations',
    name: 'Reservación de clases',
    description: 'El socio aparta su lugar desde el portal.',
    category: 'Clases',
    guardsCollections: ['reservations'],
  },
  {
    key: 'spinningMap',
    name: 'Mapa de bicicletas',
    description: 'El socio elige su bicicleta como una butaca de cine.',
    category: 'Clases',
    guardsCollections: ['bikes'],
  },
  {
    key: 'configurableSchedules',
    name: 'Horarios configurables',
    description: 'Días, horas, duración y cupo editables por clase.',
    category: 'Clases',
  },

  // ── Acceso ──
  {
    key: 'accessControl',
    name: 'Control de acceso',
    description: 'Pantalla de recepción con autorización y denegación.',
    category: 'Acceso',
  },
  {
    key: 'fingerprint',
    name: 'Huella digital',
    description: 'Identificación biométrica desde la app de recepción.',
    category: 'Acceso',
  },
  {
    key: 'memberPortal',
    name: 'Portal del socio',
    description: 'El socio ve su membresía, pagos y asistencias.',
    category: 'Acceso',
    core: true,
  },
  {
    key: 'advancedPortal',
    name: 'Portal avanzado',
    description: 'Reservaciones y renovación en línea desde el portal.',
    category: 'Acceso',
  },
  {
    key: 'pwa',
    name: 'App instalable (PWA)',
    description: 'El portal se instala en el teléfono del socio.',
    category: 'Acceso',
  },

  // ── Negocio ──
  {
    key: 'multipleBranches',
    name: 'Múltiples sucursales',
    description: 'Varias ubicaciones bajo el mismo gimnasio.',
    category: 'Negocio',
    guardsCollections: ['branches'],
  },
  {
    key: 'notifications',
    name: 'Notificaciones',
    description: 'Avisos de vencimiento, pagos y recordatorios de clase.',
    category: 'Negocio',
    guardsCollections: ['notifications'],
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Envío de recordatorios por WhatsApp.',
    category: 'Negocio',
  },
  {
    key: 'automations',
    name: 'Automatizaciones',
    description: 'Secuencias de recuperación y fidelización.',
    category: 'Negocio',
  },
  {
    key: 'customBranding',
    name: 'Branding personalizado',
    description: 'Nombre y color propios en el portal del socio.',
    category: 'Negocio',
  },

  // ── Plataforma ──
  {
    key: 'api',
    name: 'API pública',
    description: 'Acceso programático a los datos del gimnasio.',
    category: 'Plataforma',
  },
  {
    key: 'integrations',
    name: 'Integraciones',
    description: 'Conexiones con sistemas externos del cliente.',
    category: 'Plataforma',
  },

  // ── Personal (Fase 4) ──
  //
  // Ninguna viene activada en los planes existentes: se añaden al catálogo
  // para que el SuperAdmin decida qué paquete las incluye, que es justo lo
  // que se construyó en la Fase 3.
  {
    key: 'employees',
    name: 'Empleados',
    description: 'Alta del personal con puesto, horario y datos de contacto.',
    category: 'Personal',
    guardsCollections: ['employees'],
  },
  {
    key: 'employeeAttendance',
    name: 'Asistencia del personal',
    description: 'Entrada y salida laboral, tolerancias, retardos y faltas.',
    category: 'Personal',
    guardsCollections: ['employeeAttendance'],
  },
  {
    key: 'biometrics',
    name: 'Biometría',
    description: 'Identificación por huella para socios y personal.',
    category: 'Personal',
    guardsCollections: ['devices', 'biometricEvents'],
  },
  {
    key: 'usbBiometrics',
    name: 'Lector USB',
    description: 'Lector de huella conectado al equipo de recepción.',
    category: 'Personal',
  },
  {
    key: 'lanBiometrics',
    name: 'Lector en red',
    description: 'Lector biométrico o torniquete conectado por LAN o WiFi.',
    category: 'Personal',
  },
  {
    key: 'offlineMode',
    name: 'Modo sin conexión',
    description: 'Recepción y fichajes siguen funcionando cuando se cae Internet.',
    category: 'Personal',
  },
  {
    key: 'supplyRequests',
    name: 'Solicitudes de insumos',
    description: 'Pedidos internos de material, con estado y responsable.',
    category: 'Personal',
    guardsCollections: ['supplyRequests'],
  },
  {
    key: 'internalNotifications',
    name: 'Avisos internos',
    description: 'Notificaciones entre el personal del gimnasio.',
    category: 'Personal',
    guardsCollections: ['internalNotifications'],
  },
]

export const FEATURE_CATEGORIES: FeatureCategory[] = [
  'Operación',
  'Cobros',
  'Clases',
  'Acceso',
  'Personal',
  'Negocio',
  'Plataforma',
]

const BY_KEY = new Map(FEATURES.map((f) => [f.key, f]))

export function featureDefinition(key: FeatureKey): FeatureDefinition | undefined {
  return BY_KEY.get(key)
}

export function featureName(key: FeatureKey): string {
  return BY_KEY.get(key)?.name ?? key
}

/** Claves que el SuperAdmin no puede apagar en ningún plan. */
export const CORE_FEATURES: FeatureKey[] = FEATURES.filter((f) => f.core).map((f) => f.key)

export function isCoreFeature(key: FeatureKey): boolean {
  return CORE_FEATURES.includes(key)
}

/** Todas las claves declaradas, en el orden del catálogo. */
export const ALL_FEATURE_KEYS: FeatureKey[] = FEATURES.map((f) => f.key)

/**
 * Mapa featureKey → colecciones que protege.
 * Lo usa la documentación y los tests para comprobar que las reglas de
 * Firestore cubren lo que el catálogo promete.
 */
export const FEATURE_GUARDS: Partial<Record<FeatureKey, string[]>> = Object.fromEntries(
  FEATURES.filter((f) => f.guardsCollections?.length).map((f) => [f.key, f.guardsCollections!]),
)
