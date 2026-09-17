import type {
  AppUser,
  Attendance,
  Bike,
  DailyStat,
  Device,
  Employee,
  EmployeeAttendance,
  GymClass,
  Gym,
  InternalNotification,
  Member,
  Membership,
  MembershipPlan,
  Millis,
  Payment,
  PaymentMethod,
  PlanId,
  Product,
  PublicGym,
  Reservation,
  Subscription,
  SupplyRequest,
  Visit,
  Weekday,
} from '@/types'
import { emptyCounters, emptyDailyStat } from '@/services/aggregates'
import { DEFAULT_PLANS, PLAN_ORDER, getPlan } from '@/config/plans'
import { entitlementsFrom } from '@/services/planCatalog'
import { GYM_ACCENT_PRESETS } from '@/config/brand'
import { addDays, combine, dayKey, startOfDay, timeKey } from '@/lib/date'
import { auth } from '@/services/auth'
import { defaultSettings } from '@/services/defaults'
import { generateBikeLayout } from '@/services/reservations'
import { computeStatus } from '@/lib/memberStatus'
import {
  defaultSchedule,
  evaluateEntry,
  evaluateExit,
  isRestDay,
  resolveStatus,
  workedMinutesBetween,
} from '@/lib/workSchedule'
import { norm } from '@/lib/utils'
import { mockDriver } from '@/services/mockDriver'

// ═══════════════════════════════════════════════════════════════════════════
// Datos de demostración.
//
// Se crean TRES gimnasios con planes distintos. No es adorno: es lo que
// permite demostrar las dos cosas que definen el producto —
//
//   · el aislamiento por gymId (cada dueño solo ve lo suyo)
//   · las restricciones por plan (Starter no puede reservar clases)
//
// Todo es generado con un PRNG con semilla fija: la demo es idéntica en
// cualquier máquina, lo que hace que un bug sea reproducible.
// ═══════════════════════════════════════════════════════════════════════════

/** Mulberry32 — PRNG determinista, 4 líneas, suficiente para datos falsos. */
function makeRandom(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NOMBRES_M = [
  'Carlos','Luis','Miguel','Juan','José','Fernando','Ricardo','Alejandro','Jorge','Roberto',
  'Eduardo','Diego','Javier','Andrés','Rafael','Sergio','Óscar','Héctor','Pablo','Emiliano',
  'Santiago','Mateo','Iván','Rodrigo','Gerardo','Arturo','Mauricio','César','Raúl','Adrián',
]
const NOMBRES_F = [
  'María','Ana','Laura','Sofía','Valeria','Fernanda','Gabriela','Daniela','Carmen','Patricia',
  'Alejandra','Mariana','Paola','Andrea','Claudia','Verónica','Lucía','Regina','Ximena','Karla',
  'Diana','Brenda','Mónica','Elena','Rocío','Itzel','Jimena','Renata','Camila','Abril',
]
const APELLIDOS = [
  'García','Hernández','López','Martínez','González','Pérez','Rodríguez','Sánchez','Ramírez','Cruz',
  'Flores','Gómez','Morales','Vázquez','Reyes','Jiménez','Torres','Díaz','Ruiz','Mendoza',
  'Aguilar','Ortiz','Castillo','Romero','Álvarez','Moreno','Rojas','Medina','Guerrero','Vega',
  'Chávez','Herrera','Ramos','Domínguez','Salazar','Navarro','Campos','Fuentes','Cortés','Ibarra',
]

const INSTRUCTORES = [
  'Coach Ana Ruiz','Coach Diego Salas','Coach Karla Méndez','Coach Iván Robles',
  'Coach Paola Ríos','Coach Bruno Vera','Coach Sofía Lugo',
]

const PRODUCTOS = [
  { name: 'Agua natural 1L', category: 'BEBIDA' as const, price: 20, cost: 9 },
  { name: 'Bebida isotónica', category: 'BEBIDA' as const, price: 35, cost: 18 },
  { name: 'Proteína en polvo 2kg', category: 'SUPLEMENTO' as const, price: 890, cost: 610 },
  { name: 'Creatina 300g', category: 'SUPLEMENTO' as const, price: 450, cost: 290 },
  { name: 'Pre-entreno', category: 'SUPLEMENTO' as const, price: 520, cost: 340 },
  { name: 'Barra proteica', category: 'SUPLEMENTO' as const, price: 45, cost: 24 },
  { name: 'Guantes de gimnasio', category: 'ACCESORIO' as const, price: 260, cost: 140 },
  { name: 'Cinturón de fuerza', category: 'ACCESORIO' as const, price: 580, cost: 330 },
  { name: 'Shaker 600ml', category: 'ACCESORIO' as const, price: 150, cost: 70 },
  { name: 'Playera del gym', category: 'ROPA' as const, price: 280, cost: 130 },
  { name: 'Toalla deportiva', category: 'ACCESORIO' as const, price: 120, cost: 55 },
]

interface GymBlueprint {
  key: string
  name: string
  slug: string
  planId: PlanId
  city: string
  state: string
  address: string
  zip: string
  phone: string
  accentIndex: number
  memberCount: number
  historyDays: number
  ownerName: string
  ownerEmail: string
  /** Solo el gimnasio principal recibe el elenco completo de usuarios demo. */
  fullStaff: boolean
  seed: number
}

const BLUEPRINTS: GymBlueprint[] = [
  {
    key: 'iron',
    name: 'Iron Fitness',
    slug: 'iron-fitness',
    planId: 'PRO',
    city: 'Guadalajara',
    state: 'Jalisco',
    address: 'Av. Chapultepec 1450, Col. Americana',
    zip: '44160',
    phone: '3312457890',
    accentIndex: 0,
    memberCount: 100,
    historyDays: 45,
    ownerName: 'Bruno Ramírez',
    ownerEmail: 'owner@ironfitness.mx',
    fullStaff: true,
    seed: 20260101,
  },
  {
    key: 'power',
    name: 'Power House Gym',
    slug: 'power-house',
    planId: 'STARTER',
    city: 'Mérida',
    state: 'Yucatán',
    address: 'Calle 60 #312, Centro',
    zip: '97000',
    phone: '9992310044',
    accentIndex: 4,
    memberCount: 38,
    historyDays: 20,
    ownerName: 'Lorena Uc',
    ownerEmail: 'owner@powerhouse.mx',
    fullStaff: false,
    seed: 777001,
  },
  {
    key: 'olympia',
    name: 'Olympia Gym',
    slug: 'olympia-gym',
    planId: 'BUSINESS',
    city: 'Monterrey',
    state: 'Nuevo León',
    address: 'Av. Gómez Morín 900, San Pedro',
    zip: '66220',
    phone: '8118002233',
    accentIndex: 2,
    memberCount: 120,
    historyDays: 22,
    ownerName: 'Ricardo Santoscoy',
    ownerEmail: 'owner@olympiagym.mx',
    fullStaff: false,
    seed: 55510,
  },
]

/** Credenciales demo que se muestran en la pantalla de acceso. */
export interface DemoCredential {
  label: string
  email: string
  password: string
  role: string
  gym: string
  uid: string
  accent: 'tap' | 'cyber' | 'plasma' | 'ink'
}

export const DEMO_PASSWORD = 'easygym123'

let cachedCredentials: DemoCredential[] | null = null

export function getDemoCredentials(): DemoCredential[] {
  if (cachedCredentials) return cachedCredentials
  try {
    const raw = localStorage.getItem('easygym:demo-credentials')
    if (raw) {
      cachedCredentials = JSON.parse(raw) as DemoCredential[]
      return cachedCredentials
    }
  } catch {
    /* noop */
  }
  return []
}

// ═══════════════════════════════════════════════════════════════════════════

type Bucket = Record<string, Record<string, unknown>>

class SeedWriter {
  data: Record<string, Bucket> = {}
  put<T extends { id: string }>(col: string, doc: T): T {
    ;(this.data[col] ??= {})[doc.id] = doc as unknown as Record<string, unknown>
    return doc
  }
  /** Documentos de una colección que pertenecen a un gimnasio. */
  of<T>(col: string, gymId: string): T[] {
    return Object.values(this.data[col] ?? {}).filter(
      (d) => (d as { gymId?: string }).gymId === gymId,
    ) as T[]
  }
}

/**
 * Calcula contadores y resúmenes diarios del gimnasio recién sembrado.
 *
 * Se hace aquí, en memoria, en lugar de llamar a `rebuildAggregates()`: esa
 * función lee de la base con la latencia simulada del driver y tardaría varios
 * segundos en el arranque. El resultado es exactamente el mismo.
 */
function buildAggregates(w: SeedWriter, gymId: string, nearDays: number): void {
  const members = w.of<Member>('members', gymId)
  const counters = emptyCounters(gymId)
  counters.members.total = members.length
  for (const m of members) {
    const key = computeStatus(m, nearDays)
    if (key === 'ACTIVE') counters.members.active++
    else if (key === 'NEAR_EXPIRATION') counters.members.nearExpiration++
    else if (key === 'EXPIRED') counters.members.expired++
    else counters.members.inactive++
  }
  counters.classes = w.of('classes', gymId).length
  counters.products = w.of('products', gymId).length
  counters.branches = w.of('branches', gymId).length
  counters.staff = w.of<AppUser>('users', gymId).filter((u) => u.role !== 'MEMBER').length
  counters.rebuiltAt = Date.now()
  w.put('counters', counters)

  const byDay = new Map<string, DailyStat>()
  const day = (date: string) => {
    let d = byDay.get(date)
    if (!d) {
      d = emptyDailyStat(gymId, date)
      byDay.set(date, d)
    }
    return d
  }

  for (const p of w.of<Payment>('payments', gymId)) {
    if (p.status !== 'PAID') continue
    const d = day(dayKey(p.createdAt))
    d.revenue[p.category] += p.amount
    d.revenueTotal += p.amount
    d.byMethod[p.method] = (d.byMethod[p.method] ?? 0) + p.amount
  }
  for (const v of w.of<Visit>('visits', gymId)) day(v.date).visits++
  for (const a of w.of<Attendance>('attendance', gymId)) {
    if (!a.granted) continue
    const d = day(a.date)
    d.attendance++
    const hour = String(Number(a.time.split(':')[0]))
    d.byHour[hour] = (d.byHour[hour] ?? 0) + 1
  }
  for (const ms of w.of<Membership>('memberships', gymId)) {
    const d = day(dayKey(ms.createdAt))
    if (ms.kind === 'RENEWAL') d.renewals++
    else d.newMemberships++
  }
  for (const m of members) day(dayKey(m.createdAt)).newMembers++
  for (const r of w.of<Reservation>('reservations', gymId)) {
    if (r.status !== 'CANCELLED') day(dayKey(r.createdAt)).reservations++
  }

  for (const stat of byDay.values()) w.put('dailyStats', stat)
}

export async function seedDemoData(): Promise<DemoCredential[]> {
  const w = new SeedWriter()
  const credentials: DemoCredential[] = []
  const pendingCreds: Array<{ email: string; uid: string }> = []
  const today = startOfDay()

  // ── Catálogo de planes ──────────────────────────────────────────────────
  // Los planes son DATO, no código: viven en Firestore y el SuperAdmin los
  // edita desde /superadmin/planes. Aquí solo se siembran sus valores
  // iniciales para que la demo arranque con algo coherente.
  for (const id of PLAN_ORDER) {
    w.put('plans', { ...DEFAULT_PLANS[id], id, updatedAt: today, updatedBy: null })
  }

  // ── SuperAdmin de la plataforma ─────────────────────────────────────────
  const superUid = 'u_superadmin'
  const superUser: AppUser & { id: string } = {
    id: superUid,
    uid: superUid,
    email: 'super@easygym.com',
    name: 'Equipo EasyGym',
    phone: '5500000000',
    role: 'SUPERADMIN',
    gymId: '',
    memberId: null,
    avatarUrl: null,
    active: true,
    lastLoginAt: null,
    createdAt: today - 400 * 86_400_000,
  }
  w.put('users', superUser)
  pendingCreds.push({ email: superUser.email, uid: superUid })
  credentials.push({
    label: 'Super administrador',
    email: superUser.email,
    password: DEMO_PASSWORD,
    role: 'SUPERADMIN',
    gym: 'Toda la plataforma',
    uid: superUid,
    accent: 'ink',
  })

  for (const bp of BLUEPRINTS) {
    const rnd = makeRandom(bp.seed)
    const gymId = `gym_${bp.key}`
    const preset = GYM_ACCENT_PRESETS[bp.accentIndex] ?? GYM_ACCENT_PRESETS[0]
    const plan = getPlan(bp.planId)
    const createdAt = today - (bp.historyDays + 60) * 86_400_000
    const accent: DemoCredential['accent'] =
      plan.accent === 'ink' ? 'ink' : (plan.accent as 'tap' | 'cyber' | 'plasma')

    // ── Usuarios del gimnasio ───────────────────────────────────────────
    const ownerUid = `u_${bp.key}_owner`
    w.put('users', {
      id: ownerUid,
      uid: ownerUid,
      email: bp.ownerEmail,
      name: bp.ownerName,
      phone: bp.phone,
      role: 'OWNER',
      gymId,
      memberId: null,
      avatarUrl: null,
      active: true,
      lastLoginAt: today,
      createdAt,
    } satisfies AppUser & { id: string })
    pendingCreds.push({ email: bp.ownerEmail, uid: ownerUid })
    credentials.push({
      label: `Dueño · ${bp.name}`,
      email: bp.ownerEmail,
      password: DEMO_PASSWORD,
      role: 'OWNER',
      gym: `${bp.name} (${plan.name})`,
      uid: ownerUid,
      accent,
    })

    if (bp.fullStaff) {
      const staff: Array<[string, string, AppUser['role'], string]> = [
        ['admin', 'Marisol Aguirre', 'ADMIN', `admin@${bp.slug}.mx`],
        ['recepcion', 'Daniela Cortés', 'RECEPCIONISTA', `recepcion@${bp.slug}.mx`],
        ['coach', 'Iván Robles', 'ENTRENADOR', `coach@${bp.slug}.mx`],
      ]
      for (const [suffix, name, role, email] of staff) {
        const uid = `u_${bp.key}_${suffix}`
        w.put('users', {
          id: uid,
          uid,
          email,
          name,
          phone: bp.phone,
          role,
          gymId,
          memberId: null,
          avatarUrl: null,
          active: true,
          lastLoginAt: today - 86_400_000,
          createdAt,
        } satisfies AppUser & { id: string })
        pendingCreds.push({ email, uid })
        credentials.push({
          label: `${role === 'ADMIN' ? 'Administrador' : role === 'RECEPCIONISTA' ? 'Recepcionista' : 'Entrenador'} · ${bp.name}`,
          email,
          password: DEMO_PASSWORD,
          role,
          gym: bp.name,
          uid,
          accent,
        })
      }
    }

    // ── Catálogo de membresías ──────────────────────────────────────────
    // ══ Personal, asistencia laboral e insumos (Fase 4) ══════════════════
    //
    // Se siembra la semana de Adrián tal como se describe en el enunciado:
    // cuatro días puntual y un martes con 5 minutos de retardo. Sirve para
    // comprobar de un vistazo que la tolerancia hace lo que dice.
    const maintUid = `u_${bp.key}_mantenimiento`
    w.put('users', {
      id: maintUid,
      uid: maintUid,
      email: `mantenimiento@${bp.slug}.mx`,
      name: 'Adrián Rivera',
      phone: bp.phone,
      role: 'MANTENIMIENTO',
      gymId,
      memberId: null,
      avatarUrl: null,
      active: true,
      lastLoginAt: today - 86_400_000,
      createdAt,
    } satisfies AppUser & { id: string })
    pendingCreds.push({ email: `mantenimiento@${bp.slug}.mx`, uid: maintUid })
    credentials.push({
      label: `Mantenimiento · ${bp.name}`,
      email: `mantenimiento@${bp.slug}.mx`,
      password: DEMO_PASSWORD,
      role: 'MANTENIMIENTO',
      gym: bp.name,
      uid: maintUid,
      accent,
    })

    const staffRoster: Array<[string, string, string, string | null]> = [
      ['Adrián', 'Rivera', 'Mantenimiento', maintUid],
      ['Paulina', 'Serrano', 'Recepción', null],
      ['Alejandra', 'Nava', 'Limpieza', null],
      ['Iván', 'Robles', 'Entrenador', null],
    ]

    staffRoster.forEach(([name, lastName, position, userId], i) => {
      const employeeId = `emp_${bp.key}_${i + 1}`
      w.put('employees', {
        id: employeeId,
        gymId,
        employeeNumber: i + 1,
        name,
        lastName,
        searchKey: norm(`${name} ${lastName}`),
        photoUrl: null,
        phone: bp.phone,
        email: `${norm(name).replace(/\s/g, '')}@${bp.slug}.mx`,
        position,
        status: 'ACTIVE',
        hireDate: null,
        notes: '',
        userId,
        fingerprintId: i === 0 ? `fp_demo_${bp.key}_1` : null,
        toleranceMinutes: 15,
        schedule: defaultSchedule('07:00', '16:00'),
        createdAt,
      } satisfies Employee & { id: string })

      // Últimos 7 días de fichajes. El martes de Adrián llega 7:20.
      for (let back = 6; back >= 0; back--) {
        const when = addDays(today, -back)
        const date = dayKey(when)
        if (isRestDay(defaultSchedule('07:00', '16:00'), date)) continue

        const isAdrian = i === 0
        const weekday = new Date(when).getDay()
        const late = isAdrian && weekday === 2 // martes
        const entry = late ? '07:20' : ['06:58', '07:01', '07:03', '07:00', '06:59'][(i + back) % 5]
        const exit = ['16:02', '16:00', '16:05', '16:01', '15:58'][(i + back) % 5]

        const evaluation = evaluateEntry('07:00', entry, 15)
        const earlyExitMinutes = evaluateExit('16:00', exit)

        w.put('employeeAttendance', {
          id: `${employeeId}_${date}`,
          gymId,
          employeeId,
          employeeName: `${name} ${lastName}`,
          position,
          date,
          scheduledEntry: '07:00',
          scheduledExit: '16:00',
          actualEntry: entry,
          actualExit: exit,
          toleranceMinutes: 15,
          status: resolveStatus({
            hasSchedule: true,
            actualEntry: entry,
            actualExit: exit,
            lateMinutes: evaluation.lateMinutes,
            earlyExitMinutes,
          }),
          lateMinutes: evaluation.lateMinutes,
          earlyExitMinutes,
          workedMinutes: workedMinutesBetween(entry, exit),
          deviceId: `dev_${bp.key}_1`,
          method: i === 0 ? 'FINGERPRINT_USB' : 'MANUAL',
          createdAt: when,
        } satisfies EmployeeAttendance & { id: string })
      }
    })

    // Un lector de huella y un torniquete, para poder enseñar la pantalla.
    w.put('devices', {
      id: `dev_${bp.key}_1`,
      gymId,
      name: 'Lector de recepción',
      type: 'FINGERPRINT',
      connectionType: 'USB',
      ip: null,
      port: null,
      status: 'ONLINE',
      location: 'Recepción',
      vendor: null,
      model: null,
      lastSeenAt: today,
      createdAt,
    } satisfies Device & { id: string })

    w.put('devices', {
      id: `dev_${bp.key}_2`,
      gymId,
      name: 'Torniquete entrada',
      type: 'TURNSTILE',
      connectionType: 'LAN',
      ip: '192.168.1.50',
      port: 4370,
      status: 'UNKNOWN',
      location: 'Acceso principal',
      vendor: null,
      model: null,
      lastSeenAt: null,
      createdAt,
    } satisfies Device & { id: string })

    // Solicitudes de insumos en los tres estados, para ver el flujo completo.
    const supplies: Array<[string, number, string, SupplyRequest['status']]> = [
      ['Papel higiénico', 4, 'Ya quedan pocos en recepción.', 'PENDING'],
      ['Jabón de manos', 2, 'Los dispensadores del área de pesas.', 'IN_PROGRESS'],
      ['Bolsas de basura', 1, '', 'DELIVERED'],
    ]
    supplies.forEach(([item, quantity, note, status], i) => {
      const at = today - i * 3_600_000 - 3_600_000
      w.put('supplyRequests', {
        id: `sup_${bp.key}_${i + 1}`,
        gymId,
        item,
        quantity,
        note,
        status,
        requestedBy: `u_${bp.key}_recepcion`,
        requestedByName: 'Daniela Cortés',
        assignedTo: status === 'PENDING' ? null : maintUid,
        assignedToName: status === 'PENDING' ? null : 'Adrián Rivera',
        acceptedAt: status === 'PENDING' ? null : at + 600_000,
        completedAt: status === 'DELIVERED' ? at + 1_800_000 : null,
        cancelledAt: null,
        cancelReason: null,
        urgent: i === 0,
        createdAt: at,
      } satisfies SupplyRequest & { id: string })
    })

    w.put('internalNotifications', {
      id: `notif_${bp.key}_1`,
      gymId,
      kind: 'SUPPLY_REQUESTED',
      title: 'Nueva solicitud',
      body: 'Daniela Cortés solicitó 4 × Papel higiénico.',
      toUserId: null,
      toRole: 'MANTENIMIENTO',
      entityType: 'supplyRequests',
      entityId: `sup_${bp.key}_1`,
      readAt: null,
      channel: 'inapp',
      createdAt: today - 3_600_000,
    } satisfies InternalNotification & { id: string })

    const priceScale = bp.planId === 'BUSINESS' ? 1.6 : bp.planId === 'STARTER' ? 0.75 : 1
    const planDefs = [
      { name: 'Mensual', price: Math.round(550 * priceScale), duration: 'MONTHLY' as const, days: 30, weight: 0.5 },
      { name: 'Trimestral', price: Math.round(1450 * priceScale), duration: 'QUARTERLY' as const, days: 90, weight: 0.22 },
      { name: 'Semestral', price: Math.round(2600 * priceScale), duration: 'BIANNUAL' as const, days: 180, weight: 0.13 },
      { name: 'Anual', price: Math.round(4600 * priceScale), duration: 'ANNUAL' as const, days: 365, weight: 0.1 },
      { name: 'Semanal', price: Math.round(220 * priceScale), duration: 'WEEKLY' as const, days: 7, weight: 0.05 },
    ]
    const membershipPlans: MembershipPlan[] = planDefs.map((p, i) => ({
      id: `mp_${bp.key}_${i}`,
      gymId,
      name: p.name,
      price: p.price,
      duration: p.duration,
      days: p.days,
      benefits:
        p.days >= 180
          ? ['Acceso ilimitado', 'Todas las clases', 'Evaluación física', 'Invitado gratis al mes']
          : p.days >= 90
            ? ['Acceso ilimitado', 'Clases grupales', 'Casillero']
            : ['Acceso ilimitado', 'Área de pesas y cardio'],
      active: true,
      allowsReservations: p.days >= 30,
      allowedClassIds: [],
      createdAt,
    }))
    for (const mp of membershipPlans) w.put('membershipPlans', mp)

    // Reparto ponderado de planes entre los socios.
    const planPicker: MembershipPlan[] = []
    planDefs.forEach((p, i) => {
      for (let k = 0; k < Math.round(p.weight * 100); k++) planPicker.push(membershipPlans[i])
    })

    // ── Clases ──────────────────────────────────────────────────────────
    const classes: GymClass[] = []
    const hasClasses = plan.features.classes
    if (hasClasses) {
      classes.push({
        id: `cls_${bp.key}_spin`,
        gymId,
        name: 'Spinning',
        kind: 'SPINNING',
        instructor: INSTRUCTORES[0],
        durationMin: 45,
        capacity: 20,
        schedule: { days: [1, 2, 3, 4] as Weekday[], times: ['07:00', '08:00', '19:00', '20:00'] },
        active: true,
        color: '#22E06B',
        description: 'Ciclismo indoor de alta intensidad con música en vivo.',
        allowedMembershipPlanIds: [],
        usesBikeMap: true,
        createdAt,
        branchId: null,
      })
      classes.push({
        id: `cls_${bp.key}_spin_vie`,
        gymId,
        name: 'Spinning Express',
        kind: 'SPINNING',
        instructor: INSTRUCTORES[4],
        durationMin: 30,
        capacity: 20,
        schedule: { days: [5] as Weekday[], times: ['07:00', '08:00'] },
        active: true,
        color: '#38D9FF',
        description: 'Sesión corta e intensa para cerrar la semana.',
        allowedMembershipPlanIds: [],
        usesBikeMap: true,
        createdAt,
        branchId: null,
      })
      classes.push({
        id: `cls_${bp.key}_box`,
        gymId,
        name: 'Box',
        kind: 'BOX',
        instructor: INSTRUCTORES[1],
        durationMin: 60,
        capacity: 16,
        schedule: { days: [1, 2, 3, 4, 5] as Weekday[], times: ['17:00', '18:00', '19:00', '20:00', '21:00'] },
        active: true,
        color: '#FF6B6B',
        description: 'Técnica, costal y acondicionamiento.',
        allowedMembershipPlanIds: [],
        usesBikeMap: false,
        createdAt,
        branchId: null,
      })
      classes.push({
        id: `cls_${bp.key}_yoga`,
        gymId,
        name: 'Yoga',
        kind: 'YOGA',
        instructor: INSTRUCTORES[2],
        durationMin: 60,
        capacity: 14,
        schedule: { days: [2, 4, 6] as Weekday[], times: ['09:00', '18:00'] },
        active: true,
        color: '#A970FF',
        description: 'Movilidad, respiración y fuerza consciente.',
        allowedMembershipPlanIds: [],
        usesBikeMap: false,
        createdAt,
        branchId: null,
      })
      classes.push({
        id: `cls_${bp.key}_func`,
        gymId,
        name: 'Funcional',
        kind: 'FUNCIONAL',
        instructor: INSTRUCTORES[3],
        durationMin: 50,
        capacity: 18,
        schedule: { days: [1, 3, 5] as Weekday[], times: ['06:00', '19:00'] },
        active: true,
        color: '#FFBE3D',
        description: 'Circuito de fuerza y resistencia con material variado.',
        allowedMembershipPlanIds: [],
        usesBikeMap: false,
        createdAt,
        branchId: null,
      })
      for (const c of classes) w.put('classes', c)
    }

    // ── Bicicletas ──────────────────────────────────────────────────────
    const bikes: Bike[] = []
    if (plan.features.spinningMap) {
      const layout = generateBikeLayout(4, 5)
      layout.forEach((b, i) => {
        const bike: Bike = {
          ...b,
          id: `bike_${bp.key}_${b.number}`,
          gymId,
          createdAt,
          // Un par de bicis en mantenimiento: el mapa tiene que saber pintarlas.
          status: i === 7 ? 'MAINTENANCE' : i === 13 ? 'BLOCKED' : 'AVAILABLE',
        }
        bikes.push(bike)
        w.put('bikes', bike)
      })
    }

    // ── Sucursales (solo Business) ──────────────────────────────────────
    if (plan.features.multipleBranches) {
      for (const [i, b] of [
        { name: 'Olympia San Pedro', address: 'Av. Gómez Morín 900' },
        { name: 'Olympia Valle Oriente', address: 'Av. Lázaro Cárdenas 2400' },
        { name: 'Olympia Cumbres', address: 'Av. Paseo de los Leones 1500' },
      ].entries()) {
        w.put('branches', {
          id: `br_${bp.key}_${i}`,
          gymId,
          name: b.name,
          address: b.address,
          phone: bp.phone,
          active: true,
          createdAt,
        })
      }
    }

    // ── Productos (POS) ─────────────────────────────────────────────────
    if (plan.features.posBasic) {
      PRODUCTOS.forEach((p, i) => {
        w.put('products', {
          id: `prod_${bp.key}_${i}`,
          gymId,
          name: p.name,
          sku: `SKU-${String(i + 1).padStart(3, '0')}`,
          category: p.category,
          price: p.price,
          cost: p.cost,
          stock: 6 + Math.floor(rnd() * 40),
          minStock: 5,
          active: true,
          imageUrl: null,
          createdAt,
        } satisfies Product & { id: string })
      })
    }

    // ── Socios + su historial ───────────────────────────────────────────
    const members: Member[] = []
    for (let i = 0; i < bp.memberCount; i++) {
      const isF = rnd() > 0.48
      const first = isF
        ? NOMBRES_F[Math.floor(rnd() * NOMBRES_F.length)]
        : NOMBRES_M[Math.floor(rnd() * NOMBRES_M.length)]
      const last1 = APELLIDOS[Math.floor(rnd() * APELLIDOS.length)]
      const last2 = APELLIDOS[Math.floor(rnd() * APELLIDOS.length)]
      const name = `${first} ${last1} ${last2}`
      const mp = planPicker[Math.floor(rnd() * planPicker.length)]

      // Distribución realista de estados: ~62% al corriente, ~10% por vencer,
      // ~20% vencidos, ~8% de baja. Un dashboard con todo en verde no sirve
      // para nada porque nadie aprende a leerlo.
      //
      // El vencimiento se deriva de los DÍAS QUE DURA SU PLAN, no de un número
      // al azar: si no, aparecerían membresías semanales venciendo en 73 días.
      const roll = rnd()
      let status: Member['status'] = 'ACTIVE'
      let startsAt: Millis
      if (roll < 0.08) {
        // De baja: venció hace bastante.
        status = 'INACTIVE'
        startsAt = today - (mp.days + Math.floor(rnd() * 120 + 30)) * 86_400_000
      } else if (roll < 0.28) {
        // Vencido: terminó entre ayer y hace 45 días.
        startsAt = today - (mp.days + Math.floor(rnd() * 45 + 1)) * 86_400_000
      } else if (roll < 0.38) {
        // Por vencer: le quedan entre 0 y 6 días.
        startsAt = today - (mp.days - Math.floor(rnd() * 7)) * 86_400_000
      } else {
        // Vigente: lleva consumida una fracción de su plan.
        const elapsed = Math.floor(rnd() * Math.max(1, mp.days - 8))
        startsAt = today - elapsed * 86_400_000
      }
      const expiresAt: Millis = startsAt + mp.days * 86_400_000
      const joinedAt = startsAt - Math.floor(rnd() * 400) * 86_400_000

      const memberId = `mem_${bp.key}_${String(i + 1).padStart(3, '0')}`
      const member: Member = {
        id: memberId,
        gymId,
        memberNumber: i + 1,
        name,
        searchKey: norm(name),
        email: `${first.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.${last1
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')}${i + 1}@correo.mx`,
        phone: `${33 + Math.floor(rnd() * 50)}${Math.floor(rnd() * 90000000 + 10000000)}`.slice(0, 10),
        birthDate: dayKey(new Date(1972 + Math.floor(rnd() * 34), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28))),
        gender: isF ? 'F' : 'M',
        photoUrl: null,
        emergencyContact: null,
        membershipPlanId: mp.id,
        membershipId: null,
        startsAt,
        expiresAt,
        status: status === 'INACTIVE' ? 'INACTIVE' : computeStatus({ expiresAt, status: 'ACTIVE' }),
        notes: '',
        // Solo una parte tiene huella registrada: es lo que pasa en la realidad.
        fingerprintId: plan.features.fingerprint && rnd() > 0.45 ? `fp_${memberId}` : null,
        branchId: null,
        createdAt: joinedAt,
      }
      members.push(member)
      w.put('members', member)

      // Historial de contratos y pagos de este socio.
      const renewals = Math.min(5, Math.floor(rnd() * 4))
      for (let k = renewals; k >= 0; k--) {
        const mStart = startsAt - k * mp.days * 86_400_000
        const mEnd = mStart + mp.days * 86_400_000
        const kind: Membership['kind'] = k === renewals ? 'NEW' : 'RENEWAL'
        const msId = `ms_${memberId}_${k}`
        const method: PaymentMethod = (['cash', 'card', 'transfer', 'stripe'] as PaymentMethod[])[
          Math.floor(rnd() * (plan.features.stripeAutoPayments ? 4 : 3))
        ]
        w.put('memberships', {
          id: msId,
          gymId,
          memberId,
          membershipPlanId: mp.id,
          planName: mp.name,
          price: mp.price,
          startsAt: mStart,
          expiresAt: mEnd,
          status: k === 0 ? 'ACTIVE' : 'EXPIRED',
          paymentId: `pay_${msId}`,
          kind,
          createdAt: mStart,
        } satisfies Membership & { id: string })

        w.put('payments', {
          id: `pay_${msId}`,
          gymId,
          memberId,
          memberName: name,
          concept: `${kind === 'RENEWAL' ? 'Renovación' : 'Membresía'} ${mp.name}`,
          category: kind === 'RENEWAL' ? 'RENEWAL' : 'MEMBERSHIP',
          amount: mp.price,
          method,
          status: 'PAID',
          transactionId: method === 'stripe' ? `pi_${msId.slice(-12)}` : null,
          collectedBy: ownerUid,
          membershipId: msId,
          visitId: null,
          saleId: null,
          createdAt: mStart,
        } satisfies Payment & { id: string })
      }
      if (members[i]) members[i].membershipId = `ms_${memberId}_0`
      w.put('members', { ...member, membershipId: `ms_${memberId}_0` })
    }

    const activeMembers = members.filter((m) => m.status === 'ACTIVE' || m.status === 'NEAR_EXPIRATION')

    // ── Asistencias ─────────────────────────────────────────────────────
    let attIdx = 0
    for (let d = bp.historyDays; d >= 0; d--) {
      const ts = today - d * 86_400_000
      const dow = new Date(ts).getDay()
      if (dow === 0) continue // domingo cerrado
      const visitorsToday = Math.floor(activeMembers.length * (dow === 6 ? 0.16 : 0.3) * (0.75 + rnd() * 0.5))
      const shuffled = [...activeMembers].sort(() => rnd() - 0.5).slice(0, visitorsToday)
      for (const m of shuffled) {
        // Dos picos: mañana (6–9) y tarde (17–21). Es como entrena la gente.
        const morning = rnd() > 0.45
        const hour = morning ? 6 + Math.floor(rnd() * 4) : 17 + Math.floor(rnd() * 5)
        const minute = Math.floor(rnd() * 60)
        const at = new Date(ts).setHours(hour, minute, 0, 0)
        w.put('attendance', {
          id: `att_${bp.key}_${attIdx++}`,
          gymId,
          memberId: m.id,
          memberName: m.name,
          date: dayKey(at),
          time: timeKey(at),
          method: m.fingerprintId ? 'fingerprint' : rnd() > 0.5 ? 'qr' : 'reception',
          granted: true,
          branchId: null,
          createdAt: at,
        } satisfies Attendance & { id: string })
      }
    }

    // ── Visitas (pases de un día) ───────────────────────────────────────
    let visitIdx = 0
    for (let d = bp.historyDays; d >= 0; d--) {
      const ts = today - d * 86_400_000
      if (new Date(ts).getDay() === 0) continue
      const count = Math.floor(rnd() * 5)
      for (let v = 0; v < count; v++) {
        const isF = rnd() > 0.5
        const first = isF
          ? NOMBRES_F[Math.floor(rnd() * NOMBRES_F.length)]
          : NOMBRES_M[Math.floor(rnd() * NOMBRES_M.length)]
        const vName = `${first} ${APELLIDOS[Math.floor(rnd() * APELLIDOS.length)]}`
        const invitedBy = rnd() > 0.65 ? activeMembers[Math.floor(rnd() * activeMembers.length)] : null
        const amount = invitedBy ? 80 : 100
        const hour = 8 + Math.floor(rnd() * 12)
        const at = new Date(ts).setHours(hour, Math.floor(rnd() * 60), 0, 0)
        const vid = `vis_${bp.key}_${visitIdx++}`
        w.put('visits', {
          id: vid,
          gymId,
          memberId: null,
          name: vName,
          phone: `33${Math.floor(rnd() * 90000000 + 10000000)}`,
          date: dayKey(at),
          time: timeKey(at),
          amount,
          method: rnd() > 0.35 ? 'cash' : 'card',
          status: 'PAID',
          invitedByMemberId: invitedBy?.id ?? null,
          notes: invitedBy ? `Invitado de ${invitedBy.name}` : '',
          registeredBy: ownerUid,
          createdAt: at,
        } satisfies Visit & { id: string })
        w.put('payments', {
          id: `pay_${vid}`,
          gymId,
          memberId: invitedBy?.id ?? null,
          memberName: vName,
          concept: `Visita — ${vName}`,
          category: 'VISIT',
          amount,
          method: 'cash',
          status: 'PAID',
          transactionId: null,
          collectedBy: ownerUid,
          membershipId: null,
          visitId: vid,
          saleId: null,
          createdAt: at,
        } satisfies Payment & { id: string })
      }
    }

    // ── Ventas del POS ──────────────────────────────────────────────────
    if (plan.features.posBasic) {
      let saleIdx = 0
      for (let d = Math.min(bp.historyDays, 25); d >= 0; d--) {
        const ts = today - d * 86_400_000
        if (new Date(ts).getDay() === 0) continue
        const count = 1 + Math.floor(rnd() * 4)
        for (let s = 0; s < count; s++) {
          // Se vende mucha agua y pocos botes de proteína: sin ese sesgo, el
          // reporte del gimnasio parecería el de una tienda de suplementos.
          const p =
            rnd() < 0.62
              ? PRODUCTOS[Math.floor(rnd() * 2)]
              : PRODUCTOS[2 + Math.floor(rnd() * (PRODUCTOS.length - 2))]
          const qty = 1 + Math.floor(rnd() * 2)
          const total = p.price * qty
          const at = new Date(ts).setHours(9 + Math.floor(rnd() * 12), Math.floor(rnd() * 60), 0, 0)
          const sid = `sale_${bp.key}_${saleIdx++}`
          w.put('payments', {
            id: `pay_${sid}`,
            gymId,
            memberId: null,
            memberName: null,
            concept: `${p.name} ×${qty}`,
            category: 'PRODUCT',
            amount: total,
            method: rnd() > 0.4 ? 'cash' : 'card',
            status: 'PAID',
            transactionId: null,
            collectedBy: ownerUid,
            membershipId: null,
            visitId: null,
            saleId: sid,
            createdAt: at,
          } satisfies Payment & { id: string })
        }
      }
    }

    // ── Reservaciones (solo planes con clases) ──────────────────────────
    if (hasClasses && plan.features.reservations) {
      let resIdx = 0
      const bikeIds = bikes.filter((b) => b.status === 'AVAILABLE')
      // Del pasado reciente al futuro cercano, para que las pantallas de
      // "próximas clases" y el historial tengan contenido a la vez.
      for (let d = -4; d <= 6; d++) {
        const ts = today + d * 86_400_000
        const date = dayKey(ts)
        const dow = new Date(ts).getDay() as Weekday
        for (const cls of classes) {
          if (!cls.schedule.days.includes(dow)) continue
          for (const time of cls.schedule.times) {
            // Ocupación variable: algunos horarios llenos, otros a medias.
            const fill = rnd()
            const target = Math.floor(cls.capacity * (fill > 0.82 ? 1 : fill > 0.5 ? 0.7 : 0.35))
            const pool = [...activeMembers].sort(() => rnd() - 0.5).slice(0, target)
            const usedBikes = new Set<string>()
            for (const m of pool) {
              let bikeId: string | null = null
              let bikeNumber: number | null = null
              if (cls.usesBikeMap) {
                const free = bikeIds.filter((b) => !usedBikes.has(b.id))
                if (free.length === 0) continue
                const bike = free[Math.floor(rnd() * free.length)]
                usedBikes.add(bike.id)
                bikeId = bike.id
                bikeNumber = bike.number
              }
              const past = combine(date, time) < Date.now()
              const cancelled = rnd() > 0.93
              w.put('reservations', {
                id: `res_${bp.key}_${resIdx++}`,
                gymId,
                classId: cls.id,
                className: cls.name,
                memberId: m.id,
                memberName: m.name,
                bikeId,
                bikeNumber,
                date,
                time,
                status: cancelled ? 'CANCELLED' : past ? (rnd() > 0.15 ? 'ATTENDED' : 'NO_SHOW') : 'CONFIRMED',
                cancelledAt: cancelled ? combine(date, time) - 7_200_000 : null,
                checkedInAt: past && !cancelled ? combine(date, time) : null,
                createdAt: combine(date, time) - Math.floor(rnd() * 48 + 2) * 3_600_000,
              } satisfies Reservation & { id: string })
            }
          }
        }
      }
    }

    // ── Documento del gimnasio ──────────────────────────────────────────
    const gym: Gym = {
      id: gymId,
      slug: bp.slug,
      name: bp.name,
      email: bp.ownerEmail,
      phone: bp.phone,
      address: bp.address,
      city: bp.city,
      state: bp.state,
      zip: bp.zip,
      logoUrl: null,
      timezone: 'America/Mexico_City',
      currency: 'MXN',
      ownerId: ownerUid,
      planId: bp.planId,
      subscriptionStatus: 'ACTIVE',
      subscriptionId: `sub_${bp.key}`,
      trialEndsAt: null,
      branding: {
        accent: preset.accent,
        accentSoft: preset.soft,
        accentDeep: preset.deep,
        logoUrl: null,
        displayName: bp.name,
      },
      // Los gimnasios demo ya están configurados: el onboarding se ve al
      // registrar uno nuevo desde /registro.
      onboarding: {
        dismissed: true,
        steps: {
          gymInfo: true,
          firstMembership: true,
          firstMember: true,
          classes: hasClasses,
          spinning: plan.features.spinningMap,
          staff: bp.fullStaff,
          payments: true,
        },
      },
      // Funcionalidades y límites copiados del plan. Es lo que consultan las
      // reglas de Firestore, así que sin esto un gimnasio Pro no podría
      // escribir reservaciones aunque su plan las incluya.
      entitlements: entitlementsFrom(plan),
      stats: { members: members.length, activeMembers: activeMembers.length },
      createdAt,
    }
    w.put('gyms', gym)
    const settings = defaultSettings(gymId)
    w.put('settings', settings)

    // Espejo público legible sin sesión (lo que ve /g/:slug).
    w.put('publicGyms', {
      id: gymId,
      slug: bp.slug,
      name: bp.name,
      city: bp.city,
      state: bp.state,
      address: bp.address,
      phone: bp.phone,
      logoUrl: null,
      branding: { accent: preset.accent, accentSoft: preset.soft, accentDeep: preset.deep },
      plans: membershipPlans
        .filter((p) => p.duration !== 'DAILY')
        .sort((a, b) => a.days - b.days)
        .map((p) => ({ id: p.id, name: p.name, price: p.price, days: p.days, benefits: p.benefits })),
      active: true,
      updatedAt: Date.now(),
    } satisfies PublicGym)

    // Contadores y resúmenes diarios, para que el panel no cuente documentos.
    buildAggregates(w, gymId, settings.nearExpirationDays)

    w.put('subscriptions', {
      id: `sub_${bp.key}`,
      gymId,
      ownerId: ownerUid,
      planId: bp.planId,
      stripeCustomerId: `cus_demo_${bp.key}`,
      stripeSubscriptionId: `sub_stripe_${bp.key}`,
      status: 'ACTIVE',
      currentPeriodStart: today - 12 * 86_400_000,
      currentPeriodEnd: today + 18 * 86_400_000,
      cancelAtPeriodEnd: false,
      amount: plan.price ?? 0,
      currency: 'MXN',
      createdAt,
      invoices: Array.from({ length: 4 }, (_, k) => ({
        id: `in_${bp.key}_${k}`,
        amount: plan.price ?? 0,
        paidAt: today - (3 - k) * 30 * 86_400_000,
        status: 'PAID' as const,
      })),
    } satisfies Subscription & { id: string })

    // ── Un socio con acceso al portal ───────────────────────────────────
    const portalMember = activeMembers.find((m) => m.status === 'ACTIVE') ?? members[0]
    if (portalMember) {
      const uid = `u_${bp.key}_socio`
      const email = `socio@${bp.slug}.mx`
      w.put('users', {
        id: uid,
        uid,
        email,
        name: portalMember.name,
        phone: portalMember.phone,
        role: 'MEMBER',
        gymId,
        memberId: portalMember.id,
        avatarUrl: null,
        active: true,
        lastLoginAt: today,
        createdAt: portalMember.createdAt,
      } satisfies AppUser & { id: string })
      pendingCreds.push({ email, uid })
      credentials.push({
        label: `Socio · ${bp.name}`,
        email,
        password: DEMO_PASSWORD,
        role: 'MEMBER',
        gym: bp.name,
        uid,
        accent,
      })
    }

    w.put('activity', {
      id: `act_${bp.key}`,
      gymId,
      actorId: ownerUid,
      actorName: bp.ownerName,
      action: 'GYM_CREATED',
      detail: `${bp.name} contrató el plan ${plan.name}`,
      createdAt,
    })
  }

  // ── Escritura masiva + credenciales ───────────────────────────────────
  mockDriver.bulkLoad(w.data as never)
  for (const c of pendingCreds) auth.registerMockCredential(c.email, DEMO_PASSWORD, c.uid)
  localStorage.setItem('easygym:demo-credentials', JSON.stringify(credentials))
  cachedCredentials = credentials
  return credentials
}

/** Siembra solo si la base local está vacía. */
export async function ensureSeed(): Promise<DemoCredential[]> {
  if (!mockDriver.isEmpty()) return getDemoCredentials()
  return seedDemoData()
}

/** Reinicia la demo por completo. */
export async function resetDemo(): Promise<DemoCredential[]> {
  mockDriver.reset()
  auth.clearMockCredentials()
  localStorage.removeItem('easygym:demo-credentials')
  cachedCredentials = null
  return seedDemoData()
}

export function seedStats(): { docs: number; sizeKb: number } {
  return { docs: 0, sizeKb: mockDriver.sizeKb() }
}

export { addDays }
