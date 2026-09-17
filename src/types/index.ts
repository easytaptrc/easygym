// ═══════════════════════════════════════════════════════════════════════════
// EasyGym — Modelo de dominio
//
// REGLA DE ORO: toda entidad que pertenece a un gimnasio lleva `gymId`.
// No existe ninguna colección con nombre fijo por gimnasio (nada de
// "gym1_members"): un solo conjunto de colecciones, particionadas por gymId.
// ═══════════════════════════════════════════════════════════════════════════

/** Marca de tiempo. Se guarda como epoch ms para ser agnóstico al driver. */
export type Millis = number

/** Documento que vive dentro del espacio de un gimnasio. */
export interface TenantDoc {
  id: string
  gymId: string
  createdAt: Millis
  updatedAt?: Millis
}

// ───────────────────────────── Planes de EasyGym ────────────────────────────

export type PlanId = 'STARTER' | 'PRO' | 'BUSINESS' | 'ENTERPRISE'

/** Interruptores de funcionalidad. `hasFeature(gym, f)` consulta este mapa. */
export type FeatureKey =
  | 'members'
  | 'memberships'
  | 'attendance'
  | 'visits'
  | 'manualPayments'
  | 'memberPortal'
  | 'paymentHistory'
  | 'basicReports'
  | 'stripeAutoPayments'
  | 'autoRenewals'
  | 'advancedPortal'
  | 'pwa'
  | 'reservations'
  | 'classes'
  | 'spinningMap'
  | 'configurableSchedules'
  | 'accessControl'
  | 'fingerprint'
  | 'advancedReports'
  | 'posBasic'
  | 'posFull'
  | 'notifications'
  | 'multipleBranches'
  | 'inventory'
  | 'whatsapp'
  | 'automations'
  | 'customBranding'
  | 'api'
  | 'integrations'
  | 'enterpriseReports'
  // ── Operación interna (Fase 4) ──
  | 'employees'
  | 'employeeAttendance'
  | 'biometrics'
  | 'usbBiometrics'
  | 'lanBiometrics'
  | 'offlineMode'
  | 'supplyRequests'
  | 'internalNotifications'

export type FeatureMap = Record<FeatureKey, boolean>

export interface Plan {
  id: PlanId
  name: string
  tagline: string
  /** Precio mensual en MXN. `null` = precio a cotizar (Enterprise). */
  price: number | null
  currency: 'MXN'
  interval: 'month'
  popular?: boolean
  /** Límite de socios. `null` = ilimitado. */
  maxMembers: number | null
  /** Límite de usuarios administrativos. `null` = ilimitado. */
  maxStaff: number | null
  /** Límite de sucursales. `null` = ilimitado. */
  maxBranches: number | null
  support: string
  highlights: string[]
  features: FeatureMap
  /** ID del Price de Stripe (se inyecta desde el backend en producción). */
  stripePriceId?: string
  accent: 'tap' | 'cyber' | 'plasma' | 'ink'
  /** Un plan inactivo deja de ofrecerse a gimnasios nuevos. */
  active?: boolean
  /** Se muestra en la página pública de precios. */
  publiclyVisible?: boolean
  updatedAt?: Millis
  updatedBy?: string | null
}

/**
 * Plan tal como vive en Firestore (`plans/{planId}`).
 *
 * Es el MISMO `Plan`, con `id` de documento. Existe como tipo aparte para
 * dejar explícito que el catálogo de planes dejó de estar escrito en el
 * código: lo edita el SuperAdmin desde /superadmin/planes y se lee en runtime.
 * `config/plans.ts` ya solo aporta los valores iniciales.
 */
export interface PlanDoc extends Plan {
  id: PlanId
}

// ────────────────────────── Límites efectivos de un gym ─────────────────────

/**
 * Límites y funcionalidades DESNORMALIZADOS dentro del documento del gimnasio.
 *
 * Existen para que las reglas de Firestore puedan decidir con UNA sola lectura
 * (`get(/gyms/{gymId})`) en vez de dos (gimnasio + plan). Los mantiene una
 * Cloud Function cuando cambia el plan del gimnasio o cuando el SuperAdmin
 * edita el plan.
 *
 * Son una CACHÉ: la verdad está en `plans/{planId}`.
 */
export interface GymEntitlements {
  planId: PlanId
  features: Partial<Record<FeatureKey, boolean>>
  maxMembers: number | null
  maxStaff: number | null
  maxBranches: number | null
  syncedAt: Millis
}

// ─────────────────────────────── Gimnasio ───────────────────────────────────

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'SUSPENDED'

export interface GymBranding {
  /** Tripleta RGB "34 224 107" — se inyecta en la variable CSS --gym-accent. */
  accent: string
  accentSoft: string
  accentDeep: string
  logoUrl?: string | null
  /** Nombre visible en el portal del socio. Por defecto el nombre del gimnasio. */
  displayName?: string
}

export interface Gym {
  id: string
  /** Identificador legible en la URL: easygym.com/g/iron-fitness */
  slug: string
  name: string
  legalName?: string
  email: string
  phone: string
  address: string
  city: string
  state: string
  zip: string
  logoUrl?: string | null
  timezone: string
  currency: 'MXN'

  ownerId: string
  planId: PlanId
  subscriptionStatus: SubscriptionStatus
  subscriptionId?: string | null
  trialEndsAt?: Millis | null

  branding: GymBranding
  onboarding: OnboardingState

  /**
   * Funcionalidades y límites efectivos, copiados del plan.
   *
   * Es lo que leen las REGLAS de Firestore para decidir si este gimnasio
   * puede escribir en `reservations`, `bikes`, `inventory`… sin tener que
   * leer también el documento del plan.
   */
  entitlements?: GymEntitlements

  /** Contadores desnormalizados para el panel de SuperAdmin. */
  stats?: { members: number; activeMembers: number }

  /** Cuenta conectada de Stripe (cobros del socio a ESTE gimnasio). */
  stripeAccountId?: string | null

  createdAt: Millis
  updatedAt?: Millis
}

export interface OnboardingState {
  dismissed: boolean
  steps: Record<OnboardingStepId, boolean>
}

export type OnboardingStepId =
  | 'gymInfo'
  | 'firstMembership'
  | 'firstMember'
  | 'classes'
  | 'spinning'
  | 'staff'
  | 'payments'

// ─────────────────────────────── Usuarios ───────────────────────────────────

export type Role =
  | 'SUPERADMIN'
  | 'OWNER'
  | 'ADMIN'
  | 'RECEPCIONISTA'
  | 'ENTRENADOR'
  /**
   * Personal de mantenimiento y limpieza (Fase 4).
   *
   * Entra desde su teléfono, ve las solicitudes de insumos que le tocan y las
   * marca. No ve socios, ni dinero, ni configuración: no lo necesita, y darle
   * más sería ampliar la superficie de riesgo sin ganar nada.
   */
  | 'MANTENIMIENTO'
  | 'MEMBER'

export interface AppUser {
  uid: string
  email: string
  name: string
  phone?: string
  role: Role
  /** '' solo para el SUPERADMIN de la plataforma. */
  gymId: string
  /** Si el usuario es un socio, apunta a su documento en `members`. */
  memberId?: string | null
  avatarUrl?: string | null
  active: boolean
  lastLoginAt?: Millis | null
  createdAt: Millis
}

// ─────────────────────────────── Socios ─────────────────────────────────────

export type MemberStatus = 'ACTIVE' | 'NEAR_EXPIRATION' | 'EXPIRED' | 'INACTIVE'

export interface Member extends TenantDoc {
  memberNumber: number
  name: string
  /**
   * Nombre normalizado (minúsculas, sin acentos) para buscar en el SERVIDOR.
   *
   * Firestore no hace búsqueda de texto, pero sí rangos sobre strings: con
   * `searchKey >= "mar"` y `searchKey <= "mar"` se resuelve la búsqueda
   * por prefijo sin traerse la colección entera. Para búsqueda real (por
   * cualquier parte del nombre, con tolerancia a erratas) hace falta Algolia
   * o Typesense — ver README.
   */
  searchKey: string
  email: string
  phone: string
  birthDate?: string | null // YYYY-MM-DD
  gender?: 'M' | 'F' | 'X' | null
  photoUrl?: string | null
  emergencyContact?: { name: string; phone: string } | null

  /** Plan de membresía contratado actualmente (membershipPlans.id). */
  membershipPlanId?: string | null
  /** Contrato vigente (memberships.id). */
  membershipId?: string | null
  startsAt?: Millis | null
  expiresAt?: Millis | null

  status: MemberStatus
  notes?: string
  /** Solo un identificador del template biométrico. NUNCA la imagen cruda. */
  fingerprintId?: string | null
  branchId?: string | null
}

// ───────────────────────── Catálogo de membresías ───────────────────────────

export type MembershipDuration = 'MONTHLY' | 'QUARTERLY' | 'BIANNUAL' | 'ANNUAL' | 'WEEKLY' | 'DAILY'

export interface MembershipPlan extends TenantDoc {
  name: string
  price: number
  duration: MembershipDuration
  /** Días que otorga. Se deriva de `duration` pero es configurable. */
  days: number
  benefits: string[]
  active: boolean
  /** ¿Permite reservar clases? (solo tiene efecto en planes PRO/BUSINESS) */
  allowsReservations: boolean
  /** IDs de clases permitidas. Vacío = todas. */
  allowedClassIds: string[]
  color?: string
}

/** Contrato de membresía de un socio (histórico). */
export interface Membership extends TenantDoc {
  memberId: string
  membershipPlanId: string
  planName: string
  price: number
  startsAt: Millis
  expiresAt: Millis
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELED'
  paymentId?: string | null
  /** 'NEW' primera contratación · 'RENEWAL' renovación. */
  kind: 'NEW' | 'RENEWAL'
}

// ─────────────────────────────── Pagos ──────────────────────────────────────

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'stripe'
export type PaymentStatus = 'PAID' | 'PENDING' | 'FAILED' | 'REFUNDED'

/** Categoría para separar las ventas en el dashboard y los reportes. */
export type RevenueCategory = 'MEMBERSHIP' | 'RENEWAL' | 'VISIT' | 'PRODUCT' | 'OTHER'

export interface Payment extends TenantDoc {
  memberId?: string | null
  memberName?: string | null
  concept: string
  category: RevenueCategory
  amount: number
  method: PaymentMethod
  status: PaymentStatus
  transactionId?: string | null
  /** Quién cobró (uid del staff). */
  collectedBy?: string | null
  membershipId?: string | null
  visitId?: string | null
  saleId?: string | null
}

// ─────────────────────────────── Visitas ────────────────────────────────────
// Una VISITA NO ES UNA MEMBRESÍA. Es un pase de un día.
// No requiere ser socio. Un socio puede comprar una visita para un invitado.

export interface Visit extends TenantDoc {
  /** Opcional: si un socio la compró para alguien, o si es un socio de paso. */
  memberId?: string | null
  name: string
  phone?: string | null
  /** YYYY-MM-DD */
  date: string
  /** HH:mm */
  time: string
  amount: number
  method: PaymentMethod
  status: 'PAID' | 'PENDING' | 'CANCELED'
  /** Socio que invitó/pagó la visita, si aplica. */
  invitedByMemberId?: string | null
  /**
   * Nombre del socio que invitó, copiado al registrar.
   *
   * Está desnormalizado a propósito: sin él, listar 200 visitas obligaría a
   * tener cargada la colección `members` entera solo para escribir un nombre
   * en una columna. Es el mismo criterio que `Payment.memberName`.
   */
  invitedByMemberName?: string | null
  notes?: string
  registeredBy?: string | null
}

// ───────────────────────────── Asistencias ──────────────────────────────────

export type CheckInMethod = 'fingerprint' | 'qr' | 'reception' | 'manual' | 'card'

export interface Attendance extends TenantDoc {
  memberId: string
  memberName: string
  /** YYYY-MM-DD */
  date: string
  /** HH:mm */
  time: string
  method: CheckInMethod
  /** Resultado del control de acceso en ese momento. */
  granted: boolean
  branchId?: string | null
}

// ─────────────────────────────── Clases ─────────────────────────────────────

/** 0 = domingo … 6 = sábado (igual que Date.getDay). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface ClassSchedule {
  /** Días en los que se imparte. */
  days: Weekday[]
  /** Horas de inicio "HH:mm". */
  times: string[]
}

export type ClassKind = 'SPINNING' | 'BOX' | 'YOGA' | 'CROSSFIT' | 'FUNCIONAL' | 'ZUMBA' | 'OTRA'

export interface GymClass extends TenantDoc {
  name: string
  kind: ClassKind
  instructor: string
  /** Duración en minutos. */
  durationMin: number
  capacity: number
  schedule: ClassSchedule
  active: boolean
  color?: string
  description?: string
  /** IDs de planes de membresía permitidos. Vacío = todos. */
  allowedMembershipPlanIds: string[]
  /** Si es true, la reservación se hace eligiendo bicicleta en el mapa. */
  usesBikeMap: boolean
  branchId?: string | null
}

// ───────────────────────────── Bicicletas ───────────────────────────────────

export type BikeStatus = 'AVAILABLE' | 'BLOCKED' | 'MAINTENANCE'

export interface Bike extends TenantDoc {
  /** Número visible al socio. */
  number: number
  row: number
  col: number
  status: BikeStatus
  notes?: string
}

// ──────────────────────────── Reservaciones ─────────────────────────────────

export type ReservationStatus = 'CONFIRMED' | 'CANCELLED' | 'ATTENDED' | 'NO_SHOW'

export interface Reservation extends TenantDoc {
  classId: string
  className: string
  memberId: string
  memberName: string
  /** Bicicleta asignada (solo clases con mapa). */
  bikeId?: string | null
  bikeNumber?: number | null
  /** YYYY-MM-DD */
  date: string
  /** HH:mm — identifica el horario concreto dentro del día. */
  time: string
  status: ReservationStatus
  cancelledAt?: Millis | null
  checkedInAt?: Millis | null
}

// ─────────────────────── POS / Productos / Inventario ───────────────────────

export interface Product extends TenantDoc {
  name: string
  sku?: string
  category: 'BEBIDA' | 'SUPLEMENTO' | 'ACCESORIO' | 'ROPA' | 'OTRO'
  price: number
  cost: number
  stock: number
  minStock: number
  active: boolean
  imageUrl?: string | null
}

export interface SaleItem {
  productId: string
  name: string
  qty: number
  unitPrice: number
  total: number
}

export interface Sale extends TenantDoc {
  items: SaleItem[]
  subtotal: number
  discount: number
  total: number
  method: PaymentMethod
  soldBy: string
  memberId?: string | null
  /** YYYY-MM-DD */
  date: string
}

export type InventoryMovementKind = 'IN' | 'OUT' | 'ADJUST'

export interface InventoryMovement extends TenantDoc {
  productId: string
  productName: string
  kind: InventoryMovementKind
  qty: number
  reason: string
  by: string
}

// ──────────────────────────── Sucursales ────────────────────────────────────

export interface Branch extends TenantDoc {
  name: string
  address: string
  phone?: string
  active: boolean
}

// ─────────────────────────── Notificaciones ─────────────────────────────────

export type NotificationKind =
  | 'MEMBERSHIP_NEAR_EXPIRATION'
  | 'MEMBERSHIP_EXPIRED'
  | 'PAYMENT_CONFIRMED'
  | 'RESERVATION_CONFIRMED'
  | 'RESERVATION_CANCELLED'
  | 'CLASS_REMINDER'
  | 'SYSTEM'

export type NotificationChannel = 'inapp' | 'email' | 'whatsapp' | 'push'

export interface AppNotification extends TenantDoc {
  kind: NotificationKind
  channel: NotificationChannel
  title: string
  body: string
  memberId?: string | null
  status: 'QUEUED' | 'SENT' | 'FAILED' | 'READ'
  readAt?: Millis | null
  sentAt?: Millis | null
}

// ────────────────────────── Configuración del gym ───────────────────────────

export interface DayHours {
  open: string // HH:mm
  close: string // HH:mm
  closed: boolean
}

export type CancellationWindow = 30 | 120 | 720 | 1440 // minutos

export interface SpinningLayout {
  rows: number
  cols: number
  /** Posición del instructor respecto al mapa. */
  instructorAt: 'top' | 'bottom'
  /** Pasillos: índices de columna (0-based) después de los cuales hay hueco. */
  aisles: number[]
}

export interface GymSettings {
  /** El id del documento es el gymId. */
  id: string
  gymId: string

  hours: Record<Weekday, DayHours>

  /** Días antes del vencimiento para marcar "POR VENCER". */
  nearExpirationDays: number

  /** Minutos antes de la clase en los que aún se puede cancelar. */
  cancellationWindowMin: CancellationWindow
  /** Minutos antes de la clase en los que abre la reservación. */
  reservationOpensHoursBefore: number
  /** Máximo de reservaciones activas por socio. */
  maxActiveReservationsPerMember: number

  spinning: SpinningLayout

  access: {
    /** ¿Una visita pagada da acceso ese día? */
    visitGrantsAccess: boolean
    /** ¿Se permite entrar con membresía vencida? */
    allowExpiredEntry: boolean
    /** Tolerancia en días tras el vencimiento. */
    graceDays: number
    /** Métodos de check-in habilitados. */
    methods: CheckInMethod[]
  }

  visits: {
    /** Precio por defecto del pase de un día. */
    defaultPrice: number
    /** Precio para invitados de socios. */
    memberGuestPrice: number
  }

  payments: {
    /** Métodos que la recepción puede cobrar. */
    methods: PaymentMethod[]
    taxRate: number
    receiptFooter: string
  }

  notifications: {
    channels: NotificationChannel[]
    nearExpirationDaysBefore: number
    classReminderHoursBefore: number
  }

  printing: {
    receiptWidth: '58mm' | '80mm' | 'A4'
    printLogo: boolean
  }

  updatedAt?: Millis
}

// ───────────────────── Suscripción del dueño con EasyGym ────────────────────

export interface Subscription {
  id: string
  gymId: string
  ownerId: string
  planId: PlanId
  stripeCustomerId: string
  stripeSubscriptionId: string
  status: SubscriptionStatus
  currentPeriodStart: Millis
  currentPeriodEnd: Millis
  cancelAtPeriodEnd: boolean
  amount: number
  currency: 'MXN'
  createdAt: Millis
  updatedAt?: Millis
  /** Historial de facturas simuladas / reales. */
  invoices?: Array<{ id: string; amount: number; paidAt: Millis; status: 'PAID' | 'FAILED' }>
}

// ───────────────────────── Bitácora de plataforma ───────────────────────────

export interface ActivityLog {
  id: string
  gymId: string | null
  actorId: string | null
  actorName: string
  action: string
  detail: string
  createdAt: Millis
}

// ─────────────────────────── Auditoría detallada ────────────────────────────

/**
 * Qué acciones se auditan. La lista es cerrada a propósito: un `action: string`
 * libre acaba con veinte variantes del mismo evento y hace imposible filtrar.
 */
export type AuditAction =
  // Personal (Fase 4)
  | 'EMPLOYEE_CREATED'
  | 'EMPLOYEE_UPDATED'
  | 'EMPLOYEE_DEACTIVATED'
  | 'EMPLOYEE_REACTIVATED'
  | 'EMPLOYEE_SCHEDULE_CHANGED'
  | 'WORK_ATTENDANCE_MANUAL'
  | 'WORK_ABSENCE_JUSTIFIED'
  | 'DEVICE_ADDED'
  | 'DEVICE_UPDATED'
  | 'DEVICE_REMOVED'
  | 'SUPPLY_REQUEST_CREATED'
  | 'SUPPLY_REQUEST_ASSIGNED'
  | 'SUPPLY_REQUEST_DELIVERED'
  | 'SUPPLY_REQUEST_CANCELLED'
  // Socios
  | 'MEMBER_CREATED'
  | 'MEMBER_UPDATED'
  | 'MEMBER_DEACTIVATED'
  | 'MEMBER_REACTIVATED'
  | 'MEMBER_FINGERPRINT_ENROLLED'
  | 'MEMBER_FINGERPRINT_REMOVED'
  // Membresías y dinero
  | 'MEMBERSHIP_CONTRACTED'
  | 'MEMBERSHIP_RENEWED'
  | 'MEMBERSHIP_PLAN_CREATED'
  | 'MEMBERSHIP_PLAN_UPDATED'
  | 'MEMBERSHIP_PLAN_DELETED'
  | 'PAYMENT_REGISTERED'
  | 'PAYMENT_REFUNDED'
  | 'VISIT_REGISTERED'
  | 'SALE_REGISTERED'
  // Operación
  | 'ATTENDANCE_RECORDED'
  | 'ACCESS_DENIED'
  | 'CLASS_CREATED'
  | 'CLASS_UPDATED'
  | 'CLASS_DELETED'
  | 'RESERVATION_CREATED'
  | 'RESERVATION_CANCELLED'
  | 'BIKES_REGENERATED'
  // Administración del gimnasio
  | 'SETTINGS_UPDATED'
  | 'STAFF_CREATED'
  | 'STAFF_UPDATED'
  | 'STAFF_ROLE_CHANGED'
  | 'STAFF_DEACTIVATED'
  | 'AGGREGATES_REBUILT'
  // Plataforma (SUPERADMIN)
  | 'GYM_CREATED'
  | 'GYM_STATUS_CHANGED'
  | 'GYM_PLAN_CHANGED'
  | 'PLAN_UPDATED'
  | 'PLAN_FEATURE_TOGGLED'
  | 'PLAN_LIMITS_CHANGED'
  | 'PLAN_PRICE_CHANGED'

/**
 * Registro de auditoría: QUIÉN hizo QUÉ, CUÁNDO y SOBRE QUÉ GIMNASIO.
 *
 * `before` y `after` guardan solo los campos que cambiaron, nunca el documento
 * entero: un log que duplica la base de datos deja de ser un log y se vuelve
 * un problema de almacenamiento y de privacidad.
 */
export interface AuditLog {
  id: string
  /** `null` solo para acciones de plataforma que no son de un gimnasio. */
  gymId: string | null
  actorId: string | null
  actorName: string
  actorRole: Role | 'SYSTEM'
  action: AuditAction
  /** Colección o concepto afectado: 'members', 'plans', 'settings'… */
  entityType: string
  entityId: string | null
  /** Descripción legible, ya redactada para mostrarse en pantalla. */
  summary: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  createdAt: Millis
}

// ──────────────────────── Espejo público del gimnasio ───────────────────────

/**
 * Copia reducida de un gimnasio, legible SIN sesión.
 *
 * Existe para que `/g/:slug` funcione sin abrir la colección `gyms`, que
 * contiene el correo del dueño, su ownerId, el estado de la suscripción y los
 * contadores del negocio. Aquí solo va lo que el gimnasio quiere enseñar.
 *
 * La escribe el servidor (Cloud Function `syncPublicGym`) cada vez que cambian
 * el gimnasio o su catálogo de membresías.
 */
export interface PublicGym {
  /** Mismo id que el gimnasio. */
  id: string
  slug: string
  name: string
  city: string
  state: string
  address: string
  phone: string
  logoUrl: string | null
  branding: Pick<GymBranding, 'accent' | 'accentSoft' | 'accentDeep'>
  /** Lista de precios pública, desnormalizada para leerla de un solo tirón. */
  plans: Array<{ id: string; name: string; price: number; days: number; benefits: string[] }>
  /** Un gimnasio suspendido deja de aparecer públicamente. */
  active: boolean
  updatedAt: Millis
}

// ─────────────────────────── Contadores agregados ───────────────────────────

/**
 * Contadores de un gimnasio. Se mantienen con incrementos, nunca contando
 * documentos: con 100 000 socios, `count()` son 100 000 lecturas facturadas
 * cada vez que alguien abre el panel.
 *
 * El id del documento es el gymId.
 */
export interface GymCounters {
  id: string
  gymId: string
  members: {
    total: number
    active: number
    nearExpiration: number
    expired: number
    inactive: number
  }
  staff: number
  classes: number
  products: number
  branches: number
  /** Marca de la última reconstrucción completa. */
  rebuiltAt: Millis
  updatedAt: Millis
}

/**
 * Resumen diario de un gimnasio. Un documento por gimnasio y día.
 *
 * El panel de un año lee 365 documentos pequeños en vez de 200 000 pagos.
 * El id es `${gymId}_${YYYY-MM-DD}`.
 */
export interface DailyStat {
  id: string
  gymId: string
  /** YYYY-MM-DD */
  date: string
  revenue: Record<RevenueCategory, number>
  revenueTotal: number
  /** Desglose por método de pago. */
  byMethod: Partial<Record<PaymentMethod, number>>
  /** Asistencias por hora del día: { "7": 12, "19": 34 }. Dice cuándo se llena. */
  byHour: Record<string, number>
  visits: number
  attendance: number
  newMemberships: number
  renewals: number
  newMembers: number
  reservations: number
  updatedAt: Millis
}

// ─────────────────────── Mapa colección → tipo de doc ───────────────────────

// ════════════════════ OPERACIÓN INTERNA (Fase 4) ═══════════════════════════
//
// TRES CLASES DE PERSONA, TRES CLASES DE EVENTO. No se mezclan nunca:
//
//   SOCIO     entra al gimnasio        → `attendance`
//   EMPLEADO  ficha entrada y salida   → `employeeAttendance`
//   VISITANTE compra un pase de un día → `visits`
//
// Mezclarlos haría que «cuánta gente entró hoy» y «quién llegó tarde» fuesen
// la misma consulta, y no lo son: responden a preguntas distintas y las mira
// gente distinta.
// ════════════════════════════════════════════════════════════════════════════

export type EmployeeStatus = 'ACTIVE' | 'INACTIVE'

/**
 * Puestos sugeridos. NO es una unión cerrada a propósito: cada gimnasio
 * inventa los suyos («Nutrición», «Valet», «Coordinador de piso») y obligarles
 * a elegir de una lista ajena es la clase de rigidez que hace que un sistema se
 * abandone.
 */
export const DEFAULT_POSITIONS = [
  'Recepción',
  'Mantenimiento',
  'Limpieza',
  'Entrenador',
  'Gerente',
  'Administrador',
  'Otro',
] as const

export interface Employee extends TenantDoc {
  employeeNumber: number
  name: string
  lastName: string
  /** Nombre normalizado para buscar en el servidor. Ver services/search.ts. */
  searchKey: string
  photoUrl?: string | null
  phone: string
  email: string
  position: string
  status: EmployeeStatus
  hireDate: string | null
  notes?: string
  /**
   * Cuenta de acceso al sistema, si la tiene.
   *
   * Un empleado NO es necesariamente un usuario: el de limpieza ficha con la
   * huella y nunca inicia sesión. Cuando sí la tiene, esto los enlaza para que
   * las solicitudes de insumos sepan a quién notificar.
   */
  userId?: string | null
  /**
   * Identificador del template biométrico. NUNCA la huella en sí.
   * Ver services/biometric.ts.
   */
  fingerprintId?: string | null
  /** Minutos de tolerancia propios. Si falta, se usa el del gimnasio. */
  toleranceMinutes?: number | null
  schedule?: WorkSchedule
}

// ───────────────────────────── Horario laboral ──────────────────────────────

/** Un turno dentro de un día. `HH:mm` en 24 h, hora local del gimnasio. */
export interface WorkShift {
  start: string
  end: string
}

/**
 * Horario semanal.
 *
 * Un día con array vacío es DESCANSO. Varios turnos en el mismo día son el
 * caso normal de quien parte la jornada: 7:00–12:00 y 14:00–18:00.
 */
export interface WorkSchedule {
  mon: WorkShift[]
  tue: WorkShift[]
  wed: WorkShift[]
  thu: WorkShift[]
  fri: WorkShift[]
  sat: WorkShift[]
  sun: WorkShift[]
}

// ─────────────────────────── Asistencia laboral ─────────────────────────────

export type WorkAttendanceStatus =
  /** Llegó dentro de su horario más la tolerancia. */
  | 'ON_TIME'
  /** Se pasó de la tolerancia. `lateMinutes` dice por cuánto. */
  | 'LATE'
  /** Tenía turno y no hay entrada. */
  | 'ABSENT'
  /** Falta con permiso. Lleva `justification`. */
  | 'JUSTIFIED'
  /** Llegó a tiempo pero se fue antes de cerrar su turno. */
  | 'EARLY_EXIT'
  /** Fichó entrada y nunca salida. */
  | 'INCOMPLETE'

export type WorkCheckMethod = 'FINGERPRINT_USB' | 'FINGERPRINT_LAN' | 'MANUAL' | 'FUTURE_FACE'

export interface EmployeeAttendance extends TenantDoc {
  employeeId: string
  /** Copiado al registrar: el reporte semanal no debe leer 40 empleados. */
  employeeName: string
  position: string
  /** YYYY-MM-DD, fecha LOCAL. */
  date: string
  /** `HH:mm` del turno. `null` si fichó un día sin horario asignado. */
  scheduledEntry: string | null
  scheduledExit: string | null
  /**
   * La hora REAL, sin redondear ni maquillar.
   *
   * Si alguien llegó a las 7:20, aquí dice 7:20 aunque el estado sea LATE. El
   * momento en que un sistema empieza a «ajustar» horas para que cuadren es el
   * momento en que deja de servir como prueba de nada.
   */
  actualEntry: string | null
  actualExit: string | null
  toleranceMinutes: number
  status: WorkAttendanceStatus
  /** Minutos MÁS ALLÁ de la tolerancia. 0 si llegó dentro. */
  lateMinutes: number
  /** Minutos que faltaron para cerrar el turno. 0 si lo cerró. */
  earlyExitMinutes: number
  workedMinutes: number
  deviceId?: string | null
  method: WorkCheckMethod
  /** Motivo cuando la falta se justifica. Sin datos médicos. */
  justification?: string | null
  justifiedBy?: string | null
}

// ──────────────────────────────── Dispositivos ──────────────────────────────

export type DeviceType = 'FINGERPRINT' | 'ACCESS_CONTROLLER' | 'TURNSTILE'
export type DeviceConnection = 'USB' | 'LAN' | 'WIFI'
export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | 'DISABLED'

export interface Device extends TenantDoc {
  name: string
  type: DeviceType
  connectionType: DeviceConnection
  /** Solo para LAN/WIFI. Vacío en USB. */
  ip?: string | null
  port?: number | null
  status: DeviceStatus
  location: string
  /** Marca y modelo, cuando se conocen. Decide qué adaptador se usa. */
  vendor?: string | null
  model?: string | null
  lastSeenAt?: Millis | null
  /**
   * ⚠️ AQUÍ NO VA NINGÚN SECRETO.
   *
   * La contraseña o el token del aparato vive en el Agente de Windows, en la
   * máquina del gimnasio. Este documento lo lee el navegador: cualquier cosa
   * que se guarde aquí es pública para quien tenga sesión en ese gimnasio.
   */
}

// ─────────────────────────── Eventos biométricos ────────────────────────────

export type BiometricEventType =
  | 'ACCESS_GRANTED'
  | 'ACCESS_DENIED'
  | 'EMPLOYEE_ENTRY'
  | 'EMPLOYEE_EXIT'

export interface BiometricEvent extends TenantDoc {
  /**
   * Identificador que genera el ORIGEN del evento (lector o agente).
   *
   * Es la clave de la idempotencia: el mismo `eventId` reenviado no crea un
   * segundo registro. Sin esto, una reconexión con la cola a medias duplica
   * asistencias, y un empleado aparece fichando dos veces a la misma hora.
   */
  eventId: string
  type: BiometricEventType
  employeeId?: string | null
  memberId?: string | null
  deviceId?: string | null
  /** Momento en que ocurrió DE VERDAD, no en que llegó al servidor. */
  occurredAt: Millis
  method: WorkCheckMethod
  /** Identificador del template. Nunca la huella. */
  fingerprintId?: string | null
  reason?: string | null
}

// ──────────────────────────── Cola de sincronización ────────────────────────

export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED'

export interface SyncQueueItem {
  queueId: string
  gymId: string
  /** El mismo `eventId` del evento de origen. Ver idempotencia. */
  eventId: string
  type: 'BIOMETRIC_EVENT' | 'EMPLOYEE_ATTENDANCE' | 'MEMBER_ATTENDANCE' | 'SUPPLY_REQUEST'
  payload: Record<string, unknown>
  status: SyncStatus
  retryCount: number
  createdAt: Millis
  lastAttempt?: Millis | null
  syncedAt?: Millis | null
  lastError?: string | null
}

// ────────────────────────── Solicitudes de insumos ──────────────────────────

export type SupplyRequestStatus = 'PENDING' | 'IN_PROGRESS' | 'DELIVERED' | 'CANCELLED'

export interface SupplyRequest extends TenantDoc {
  item: string
  quantity: number
  note?: string
  status: SupplyRequestStatus
  /** Quién lo pidió: uid de la cuenta. */
  requestedBy: string
  requestedByName: string
  /** Quién lo tomó. Se llena al pasar a IN_PROGRESS. */
  assignedTo?: string | null
  assignedToName?: string | null
  acceptedAt?: Millis | null
  completedAt?: Millis | null
  cancelledAt?: Millis | null
  cancelReason?: string | null
  /** Para ordenar lo urgente primero sin inventar un flujo de aprobación. */
  urgent?: boolean
}

// ────────────────────────── Notificaciones internas ─────────────────────────

export type InternalNotificationKind =
  | 'SUPPLY_REQUESTED'
  | 'SUPPLY_ACCEPTED'
  | 'SUPPLY_DELIVERED'
  | 'SUPPLY_CANCELLED'
  | 'EMPLOYEE_LATE'
  | 'EMPLOYEE_ABSENT'

/**
 * Aviso entre compañeros de trabajo.
 *
 * Distinto de `notifications`, que va del gimnasio a sus SOCIOS. Esta es
 * interna: de Paulina a Adrián. Separarlas evita que un recordatorio de
 * vencimiento y «te tomaron la solicitud» compitan por el mismo buzón.
 */
export interface InternalNotification extends TenantDoc {
  kind: InternalNotificationKind
  title: string
  body: string
  /** uid del destinatario. `null` = para todo el personal. */
  toUserId: string | null
  /** Rol destinatario, cuando va dirigida a un puesto y no a una persona. */
  toRole?: Role | null
  entityType?: string | null
  entityId?: string | null
  readAt?: Millis | null
  /**
   * ▸ FUTURO: `channels: ['push','email','whatsapp']`. Hoy solo 'inapp'.
   *   La arquitectura ya separa el aviso de su entrega; falta el transporte.
   */
  channel: 'inapp'
}

export interface CollectionMap {
  gyms: Gym
  publicGyms: PublicGym
  counters: GymCounters
  dailyStats: DailyStat
  plans: PlanDoc
  auditLogs: AuditLog
  users: AppUser
  members: Member
  membershipPlans: MembershipPlan
  memberships: Membership
  payments: Payment
  visits: Visit
  attendance: Attendance
  classes: GymClass
  bikes: Bike
  reservations: Reservation
  products: Product
  sales: Sale
  inventory: InventoryMovement
  branches: Branch
  notifications: AppNotification
  settings: GymSettings
  subscriptions: Subscription
  activity: ActivityLog
  // ── Operación interna (Fase 4) ──
  employees: Employee
  employeeAttendance: EmployeeAttendance
  devices: Device
  biometricEvents: BiometricEvent
  supplyRequests: SupplyRequest
  internalNotifications: InternalNotification
}

export type CollectionName = keyof CollectionMap

/** Colecciones que SIEMPRE se consultan filtrando por gymId. */
export const TENANT_COLLECTIONS = [
  'members',
  'membershipPlans',
  'memberships',
  'payments',
  'visits',
  'attendance',
  'classes',
  'bikes',
  'reservations',
  'products',
  'sales',
  'inventory',
  'branches',
  'notifications',
  'employees',
  'employeeAttendance',
  'devices',
  'biometricEvents',
  'supplyRequests',
  'internalNotifications',
] as const satisfies readonly CollectionName[]

export type TenantCollectionName = (typeof TENANT_COLLECTIONS)[number]
