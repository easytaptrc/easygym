import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing'

// ═══════════════════════════════════════════════════════════════════════════
// Andamiaje de las pruebas de reglas.
//
// Monta dos gimnasios completos con usuarios de cada rol y comprueba, contra
// el emulador real de Firestore, que un gimnasio no puede tocar al otro.
//
// Los datos de partida se escriben con `withSecurityRulesDisabled`: sembrar
// pasando por las reglas haría que el propio montaje fuese lo que se prueba.
//
// ⚠️ ESTOS FICHEROS NO PUEDEN CORRER EN PARALELO.
//
// `clearFirestore()` borra el proyecto ENTERO del emulador, y todos los
// ficheros comparten el mismo. Con paralelismo, el `clearFirestore()` de uno
// vacía los datos que otro acaba de sembrar y los fallos salen donde no está
// el error: documentos que "no existen", `Null value error` al leer el
// gimnasio, y pruebas que pasan o fallan según quién llegue antes.
//
// Lo garantiza `fileParallelism: false` en vitest.config.ts. Si alguna vez se
// quita, esta suite se vuelve inútil sin avisar de que lo es.
//
// Requisitos: JDK 11+ (recomendado 21 LTS) y firebase-tools. Ver el README.
// ═══════════════════════════════════════════════════════════════════════════

export const PROJECT_ID = 'easygym-rules-test'

export const GYM_A = 'gym_alpha'
export const GYM_B = 'gym_beta'

/** Identidades. El token lleva rol y gymId, como en producción. */
export const USERS = {
  superadmin: { uid: 'u_super', role: 'SUPERADMIN', gymId: '' },
  ownerA: { uid: 'u_owner_a', role: 'OWNER', gymId: GYM_A },
  adminA: { uid: 'u_admin_a', role: 'ADMIN', gymId: GYM_A },
  receptionA: { uid: 'u_recep_a', role: 'RECEPCIONISTA', gymId: GYM_A },
  trainerA: { uid: 'u_coach_a', role: 'ENTRENADOR', gymId: GYM_A },
  memberA: { uid: 'u_member_a', role: 'MEMBER', gymId: GYM_A, memberId: 'mem_a1' },
  /** Adrián, el de mantenimiento del gimnasio A (Fase 4). */
  maintenanceA: { uid: 'u_maint_a', role: 'MANTENIMIENTO', gymId: GYM_A },
  ownerB: { uid: 'u_owner_b', role: 'OWNER', gymId: GYM_B },
  memberB: { uid: 'u_member_b', role: 'MEMBER', gymId: GYM_B, memberId: 'mem_b1' },
  maintenanceB: { uid: 'u_maint_b', role: 'MANTENIMIENTO', gymId: GYM_B },
} as const

export type UserKey = keyof typeof USERS

let testEnv: RulesTestEnvironment

export async function setupTestEnv(): Promise<RulesTestEnvironment> {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
  return testEnv
}

export function env(): RulesTestEnvironment {
  return testEnv
}

/** Contexto autenticado con los custom claims de ese usuario. */
export function as(key: UserKey): RulesTestContext {
  const u = USERS[key]
  return testEnv.authenticatedContext(u.uid, {
    role: u.role,
    gymId: u.gymId,
    ...('memberId' in u ? { memberId: u.memberId } : {}),
  })
}

export function anonymous(): RulesTestContext {
  return testEnv.unauthenticatedContext()
}

export function db(key: UserKey) {
  return as(key).firestore()
}

export function anonDb() {
  return anonymous().firestore()
}

// ───────────────────────────── Datos de partida ─────────────────────────────

/** Funcionalidades de cada plan, tal como las copia el servidor al gimnasio. */
const PRO_FEATURES = {
  members: true,
  memberships: true,
  attendance: true,
  visits: true,
  manualPayments: true,
  memberPortal: true,
  classes: true,
  reservations: true,
  spinningMap: true,
  posBasic: true,
  notifications: true,
  inventory: false,
  multipleBranches: false,
  // Operación interna (Fase 4): el gimnasio A la tiene contratada.
  employees: true,
  employeeAttendance: true,
  biometrics: true,
  supplyRequests: true,
  internalNotifications: true,
}

const STARTER_FEATURES = {
  members: true,
  memberships: true,
  attendance: true,
  visits: true,
  manualPayments: true,
  memberPortal: true,
  classes: false,
  reservations: false,
  spinningMap: false,
  posBasic: false,
  notifications: false,
  inventory: false,
  multipleBranches: false,
  // El gimnasio B NO tiene el módulo de personal: sirve para comprobar que el
  // servidor lo bloquea, no solo la interfaz.
  employees: false,
  employeeAttendance: false,
  biometrics: false,
  supplyRequests: false,
  internalNotifications: false,
}

export async function seedBaseline(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore()

    // Gimnasio A — plan Pro, 10 socios de tope para probar el límite.
    await d.doc(`gyms/${GYM_A}`).set({
      id: GYM_A,
      name: 'Alpha Fitness',
      slug: 'alpha',
      ownerId: USERS.ownerA.uid,
      planId: 'PRO',
      subscriptionStatus: 'ACTIVE',
      entitlements: {
        planId: 'PRO',
        features: PRO_FEATURES,
        maxMembers: 10,
        maxStaff: 10,
        maxBranches: 1,
        syncedAt: Date.now(),
      },
      createdAt: Date.now(),
    })

    // Gimnasio B — plan Starter, sin reservaciones.
    await d.doc(`gyms/${GYM_B}`).set({
      id: GYM_B,
      name: 'Beta Gym',
      slug: 'beta',
      ownerId: USERS.ownerB.uid,
      planId: 'STARTER',
      subscriptionStatus: 'ACTIVE',
      entitlements: {
        planId: 'STARTER',
        features: STARTER_FEATURES,
        maxMembers: 150,
        maxStaff: 2,
        maxBranches: 1,
        syncedAt: Date.now(),
      },
      createdAt: Date.now(),
    })

    // Perfiles de usuario (el respaldo de los custom claims).
    for (const [, u] of Object.entries(USERS)) {
      await d.doc(`users/${u.uid}`).set({
        uid: u.uid,
        email: `${u.uid}@test.mx`,
        name: u.uid,
        role: u.role,
        gymId: u.gymId,
        memberId: 'memberId' in u ? u.memberId : null,
        active: true,
        createdAt: Date.now(),
      })
    }

    // Contadores: el de A está por debajo de su tope de 10.
    await d.doc(`counters/${GYM_A}`).set({
      id: GYM_A,
      gymId: GYM_A,
      members: { total: 3, active: 3, nearExpiration: 0, expired: 0, inactive: 0 },
      staff: 4,
      classes: 1,
      products: 0,
      branches: 0,
      rebuiltAt: Date.now(),
      updatedAt: Date.now(),
    })
    await d.doc(`counters/${GYM_B}`).set({
      id: GYM_B,
      gymId: GYM_B,
      members: { total: 1, active: 1, nearExpiration: 0, expired: 0, inactive: 0 },
      staff: 1,
      classes: 0,
      products: 0,
      branches: 0,
      rebuiltAt: Date.now(),
      updatedAt: Date.now(),
    })

    // Un socio en cada gimnasio.
    await d.doc('members/mem_a1').set(member(GYM_A, 1))
    await d.doc('members/mem_a2').set(member(GYM_A, 2))
    await d.doc('members/mem_b1').set(member(GYM_B, 1))

    // Pagos, asistencias y clases de cada gimnasio.
    await d.doc('payments/pay_a1').set({
      id: 'pay_a1',
      gymId: GYM_A,
      memberId: 'mem_a1',
      concept: 'Mensual',
      category: 'MEMBERSHIP',
      amount: 500,
      method: 'cash',
      status: 'PAID',
      createdAt: Date.now(),
    })
    await d.doc('payments/pay_b1').set({
      id: 'pay_b1',
      gymId: GYM_B,
      memberId: 'mem_b1',
      concept: 'Mensual',
      category: 'MEMBERSHIP',
      amount: 500,
      method: 'cash',
      status: 'PAID',
      createdAt: Date.now(),
    })
    await d.doc('classes/cls_a1').set({
      id: 'cls_a1',
      gymId: GYM_A,
      name: 'Spinning',
      capacity: 20,
      usesBikeMap: true,
      active: true,
      createdAt: Date.now(),
    })
    await d.doc('settings/' + GYM_A).set({ id: GYM_A, gymId: GYM_A, nearExpirationDays: 7 })
    await d.doc('settings/' + GYM_B).set({ id: GYM_B, gymId: GYM_B, nearExpirationDays: 7 })

    // ── Operación interna (Fase 4) ──
    await d.doc('employees/emp_a1').set(employee(GYM_A, 1, 'Adrián', 'Mantenimiento'))
    await d.doc('employees/emp_b1').set(employee(GYM_B, 1, 'Beto', 'Limpieza'))

    await d.doc('employeeAttendance/emp_a1_2026-09-14').set({
      id: 'emp_a1_2026-09-14',
      gymId: GYM_A,
      employeeId: 'emp_a1',
      employeeName: 'Adrián Uno',
      position: 'Mantenimiento',
      date: '2026-09-14',
      scheduledEntry: '07:00',
      scheduledExit: '16:00',
      actualEntry: '06:58',
      actualExit: '16:02',
      toleranceMinutes: 15,
      status: 'ON_TIME',
      lateMinutes: 0,
      earlyExitMinutes: 0,
      workedMinutes: 544,
      method: 'MANUAL',
      createdAt: Date.now(),
    })

    await d.doc('devices/dev_a1').set({
      id: 'dev_a1',
      gymId: GYM_A,
      name: 'Lector recepción',
      type: 'FINGERPRINT',
      connectionType: 'USB',
      status: 'ONLINE',
      location: 'Recepción',
      createdAt: Date.now(),
    })

    await d.doc('biometricEvents/evt_a1').set({
      id: 'evt_a1',
      gymId: GYM_A,
      eventId: 'evt_a1',
      type: 'EMPLOYEE_ENTRY',
      employeeId: 'emp_a1',
      deviceId: 'dev_a1',
      occurredAt: Date.now(),
      method: 'FINGERPRINT_USB',
      createdAt: Date.now(),
    })

    await d.doc('supplyRequests/req_a1').set({
      id: 'req_a1',
      gymId: GYM_A,
      item: 'Papel higiénico',
      quantity: 4,
      note: 'Quedan pocos en recepción.',
      status: 'PENDING',
      requestedBy: USERS.receptionA.uid,
      requestedByName: 'Recepción A',
      assignedTo: null,
      assignedToName: null,
      createdAt: Date.now(),
    })
    await d.doc('supplyRequests/req_b1').set({
      id: 'req_b1',
      gymId: GYM_B,
      item: 'Jabón',
      quantity: 2,
      status: 'PENDING',
      requestedBy: USERS.ownerB.uid,
      requestedByName: 'Owner B',
      assignedTo: null,
      assignedToName: null,
      createdAt: Date.now(),
    })

    await d.doc('internalNotifications/not_a1').set({
      id: 'not_a1',
      gymId: GYM_A,
      kind: 'SUPPLY_REQUESTED',
      title: 'Nueva solicitud',
      body: 'Recepción A solicitó 4 × Papel higiénico.',
      toUserId: null,
      toRole: 'MANTENIMIENTO',
      entityType: 'supplyRequests',
      entityId: 'req_a1',
      readAt: null,
      channel: 'inapp',
      createdAt: Date.now(),
    })

    // Catálogo de planes.
    await d.doc('plans/PRO').set({ id: 'PRO', name: 'Pro', price: 899, features: PRO_FEATURES })
    await d.doc('plans/STARTER').set({
      id: 'STARTER',
      name: 'Starter',
      price: 499,
      features: STARTER_FEATURES,
    })
  })
}

export function employee(gymId: string, n: number, name: string, position: string) {
  return {
    id: `emp_${gymId}_${n}`,
    gymId,
    employeeNumber: n,
    name,
    lastName: 'Uno',
    searchKey: `${name.toLowerCase()} uno`,
    phone: '3300000000',
    email: `${name.toLowerCase()}@test.mx`,
    position,
    status: 'ACTIVE',
    hireDate: '2026-01-15',
    userId: null,
    fingerprintId: null,
    toleranceMinutes: 15,
    schedule: {
      mon: [{ start: '07:00', end: '16:00' }],
      tue: [{ start: '07:00', end: '16:00' }],
      wed: [{ start: '07:00', end: '16:00' }],
      thu: [{ start: '07:00', end: '16:00' }],
      fri: [{ start: '07:00', end: '16:00' }],
      sat: [],
      sun: [],
    },
    createdAt: Date.now(),
  }
}

export function member(gymId: string, n: number) {
  return {
    id: `mem_${gymId}_${n}`,
    gymId,
    memberNumber: n,
    name: `Socio ${n}`,
    searchKey: `socio ${n}`,
    email: `s${n}@test.mx`,
    phone: '3300000000',
    status: 'ACTIVE',
    membershipId: null,
    expiresAt: Date.now() + 30 * 86_400_000,
    createdAt: Date.now(),
  }
}

/** Documento nuevo válido para una colección del gimnasio indicado. */
export function newDoc(collection: string, gymId: string, extra: Record<string, unknown> = {}) {
  const base = { gymId, createdAt: Date.now() }
  switch (collection) {
    case 'members':
      return { ...member(gymId, 99), ...base, ...extra }
    case 'employees':
      return { ...employee(gymId, 99, 'Nuevo', 'Limpieza'), ...base, ...extra }
    case 'employeeAttendance':
      return {
        ...base,
        employeeId: 'emp_a1',
        employeeName: 'Adrián Uno',
        position: 'Mantenimiento',
        date: '2026-09-15',
        scheduledEntry: '07:00',
        scheduledExit: '16:00',
        actualEntry: '07:02',
        actualExit: null,
        toleranceMinutes: 15,
        status: 'INCOMPLETE',
        lateMinutes: 0,
        earlyExitMinutes: 0,
        workedMinutes: 0,
        method: 'MANUAL',
        ...extra,
      }
    case 'devices':
      return {
        ...base,
        name: 'Lector nuevo',
        type: 'FINGERPRINT',
        connectionType: 'USB',
        status: 'UNKNOWN',
        location: 'Entrada',
        ...extra,
      }
    case 'biometricEvents':
      return {
        ...base,
        eventId: 'evt_nuevo',
        type: 'EMPLOYEE_ENTRY',
        employeeId: 'emp_a1',
        deviceId: 'dev_a1',
        occurredAt: Date.now(),
        method: 'FINGERPRINT_USB',
        ...extra,
      }
    case 'supplyRequests':
      return {
        ...base,
        item: 'Papel higiénico',
        quantity: 4,
        note: '',
        status: 'PENDING',
        requestedBy: 'u_recep_a',
        requestedByName: 'Recepción A',
        assignedTo: null,
        assignedToName: null,
        ...extra,
      }
    case 'internalNotifications':
      return {
        ...base,
        kind: 'SUPPLY_REQUESTED',
        title: 'Aviso',
        body: 'Cuerpo del aviso',
        toUserId: null,
        toRole: 'MANTENIMIENTO',
        readAt: null,
        channel: 'inapp',
        ...extra,
      }
    case 'payments':
      return {
        ...base,
        memberId: null,
        concept: 'Prueba',
        category: 'OTHER',
        amount: 100,
        method: 'cash',
        status: 'PAID',
        ...extra,
      }
    case 'attendance':
      return {
        ...base,
        memberId: 'mem_a1',
        memberName: 'Socio',
        date: '2026-01-01',
        time: '10:00',
        method: 'reception',
        granted: true,
        ...extra,
      }
    case 'reservations':
      return {
        ...base,
        classId: 'cls_a1',
        className: 'Spinning',
        memberId: 'mem_a1',
        memberName: 'Socio',
        date: '2026-01-01',
        time: '19:00',
        status: 'CONFIRMED',
        ...extra,
      }
    case 'classes':
      return { ...base, name: 'Clase', capacity: 10, active: true, usesBikeMap: false, ...extra }
    case 'bikes':
      return { ...base, number: 1, row: 0, col: 0, status: 'AVAILABLE', ...extra }
    case 'visits':
      return {
        ...base,
        name: 'Visitante',
        date: '2026-01-01',
        time: '10:00',
        amount: 100,
        method: 'cash',
        status: 'PAID',
        ...extra,
      }
    case 'products':
      return { ...base, name: 'Agua', category: 'BEBIDA', price: 20, cost: 9, stock: 10, minStock: 5, active: true, ...extra }
    case 'inventory':
      return { ...base, productId: 'p1', productName: 'Agua', kind: 'IN', qty: 5, reason: 'compra', by: 'u', ...extra }
    case 'branches':
      return { ...base, name: 'Sucursal', address: 'x', active: true, ...extra }
    default:
      return { ...base, ...extra }
  }
}
