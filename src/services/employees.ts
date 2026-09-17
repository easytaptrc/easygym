import type { Employee, EmployeeStatus, WorkSchedule } from '@/types'
import { norm } from '@/lib/utils'
import { defaultSchedule, weeklyScheduledMinutes } from '@/lib/workSchedule'
import type { TenantRepo } from './db'
import { audit, diffFields } from './audit'
import { assertCurrentGymCanOperate } from './gymStatus'

// ═══════════════════════════════════════════════════════════════════════════
// Personal del gimnasio.
//
// UN EMPLEADO NO ES UN USUARIO.
//
// El de limpieza ficha con la huella cada mañana y no inicia sesión nunca. El
// recepcionista tiene cuenta porque cobra. El dueño tiene cuenta y además es
// empleado en su propio gimnasio si se paga nómina.
//
// Por eso `employees` y `users` son colecciones distintas, enlazadas por
// `userId` cuando procede. Meterlas en una sola obligaría a inventar una
// contraseña para alguien que no la necesita, y a que cada alta de personal
// consumiera un hueco del límite de usuarios del plan.
// ═══════════════════════════════════════════════════════════════════════════

export interface CreateEmployeeInput {
  name: string
  lastName: string
  phone: string
  email: string
  position: string
  hireDate?: string | null
  notes?: string
  photoUrl?: string | null
  userId?: string | null
  toleranceMinutes?: number | null
  schedule?: WorkSchedule
}

/** Nombre completo, sin espacios dobles cuando falta el apellido. */
export function fullName(e: Pick<Employee, 'name' | 'lastName'>): string {
  return `${e.name} ${e.lastName ?? ''}`.trim()
}

export function employeeTag(n: number): string {
  return `E-${String(n).padStart(3, '0')}`
}

export async function createEmployee(
  repo: TenantRepo,
  input: CreateEmployeeInput,
): Promise<Employee> {
  assertCurrentGymCanOperate()

  // Número consecutivo. Se pide UNO ordenado al revés, no la colección entera.
  const last = await repo.list('employees', {
    orderBy: { field: 'employeeNumber', dir: 'desc' },
    limit: 1,
  })
  const employeeNumber = (last[0]?.employeeNumber ?? 0) + 1

  const employee = await repo.create('employees', {
    employeeNumber,
    name: input.name.trim(),
    lastName: input.lastName.trim(),
    searchKey: norm(`${input.name} ${input.lastName}`),
    photoUrl: input.photoUrl ?? null,
    phone: input.phone.trim(),
    email: input.email.trim().toLowerCase(),
    position: input.position,
    status: 'ACTIVE',
    hireDate: input.hireDate ?? null,
    notes: input.notes ?? '',
    userId: input.userId ?? null,
    fingerprintId: null,
    toleranceMinutes: input.toleranceMinutes ?? null,
    schedule: input.schedule ?? defaultSchedule(),
  })

  audit({
    gymId: repo.gymId,
    action: 'EMPLOYEE_CREATED',
    entityType: 'employees',
    entityId: employee.id,
    summary: `Alta de ${fullName(employee)} (${employee.position})`,
    after: { nombre: fullName(employee), puesto: employee.position, número: employeeTag(employeeNumber) },
  })

  return employee
}

/** Campos cuya edición interesa en la bitácora. */
const AUDITED = ['name', 'lastName', 'phone', 'email', 'position', 'hireDate', 'toleranceMinutes', 'notes']

export async function updateEmployee(
  repo: TenantRepo,
  employeeId: string,
  patch: Partial<Employee>,
): Promise<Employee | null> {
  assertCurrentGymCanOperate()

  const before = await repo.get('employees', employeeId)
  if (!before) return null

  const next: Partial<Employee> = { ...patch }
  // Nombre y clave de búsqueda van siempre juntos: si se separan, el buscador
  // deja de encontrar a la persona y nadie entiende por qué.
  if (patch.name !== undefined || patch.lastName !== undefined) {
    const name = (patch.name ?? before.name).trim()
    const lastName = (patch.lastName ?? before.lastName ?? '').trim()
    next.name = name
    next.lastName = lastName
    next.searchKey = norm(`${name} ${lastName}`)
  }

  await repo.update('employees', employeeId, next)

  const d = diffFields(
    before as unknown as Record<string, unknown>,
    next as Record<string, unknown>,
    AUDITED,
  )
  if (d.changed) {
    audit({
      gymId: repo.gymId,
      action: 'EMPLOYEE_UPDATED',
      entityType: 'employees',
      entityId: employeeId,
      summary: `Edición de ${fullName(before)}`,
      before: d.before,
      after: d.after,
    })
  }

  return { ...before, ...next }
}

/**
 * Cambia el horario.
 *
 * Va aparte de `updateEmployee` porque tiene otras consecuencias: a partir de
 * aquí cambia qué días cuentan como falta y a qué hora se es puntual. Merece
 * su propia entrada en la bitácora, y poder filtrarse por ella.
 */
export async function setSchedule(
  repo: TenantRepo,
  employeeId: string,
  schedule: WorkSchedule,
  toleranceMinutes: number | null,
): Promise<void> {
  assertCurrentGymCanOperate()

  const before = await repo.get('employees', employeeId)
  if (!before) return

  await repo.update('employees', employeeId, { schedule, toleranceMinutes })

  const antes = weeklyScheduledMinutes(before.schedule)
  const despues = weeklyScheduledMinutes(schedule)

  audit({
    gymId: repo.gymId,
    action: 'EMPLOYEE_SCHEDULE_CHANGED',
    entityType: 'employees',
    entityId: employeeId,
    summary: `Horario de ${fullName(before)}: ${Math.round(antes / 60)} h → ${Math.round(despues / 60)} h semanales`,
    before: { horasSemanales: Math.round(antes / 60), tolerancia: before.toleranceMinutes ?? null },
    after: { horasSemanales: Math.round(despues / 60), tolerancia: toleranceMinutes },
  })
}

/**
 * Baja lógica. Nunca se borra un empleado.
 *
 * Su historial de asistencia es el respaldo de lo que se le pagó: borrarlo
 * dejaría al gimnasio sin cómo justificar una nómina pasada.
 */
export async function setEmployeeStatus(
  repo: TenantRepo,
  employeeId: string,
  status: EmployeeStatus,
): Promise<void> {
  assertCurrentGymCanOperate()

  const employee = await repo.get('employees', employeeId)
  if (!employee) return

  await repo.update('employees', employeeId, { status })

  audit({
    gymId: repo.gymId,
    action: status === 'ACTIVE' ? 'EMPLOYEE_REACTIVATED' : 'EMPLOYEE_DEACTIVATED',
    entityType: 'employees',
    entityId: employeeId,
    summary: `${status === 'ACTIVE' ? 'Reactivación' : 'Baja'} de ${fullName(employee)}`,
    before: { estado: employee.status },
    after: { estado: status },
  })
}

/**
 * Asocia el identificador del template biométrico.
 *
 * Guarda un IDENTIFICADOR, nunca la huella. Ver services/biometric.ts.
 */
export async function enrollFingerprint(
  repo: TenantRepo,
  employeeId: string,
  fingerprintId: string | null,
): Promise<void> {
  assertCurrentGymCanOperate()
  await repo.update('employees', employeeId, { fingerprintId })
}

// ─────────────────────────────── Consultas ──────────────────────────────────

/** Personal activo. Acotado: un gimnasio no tiene miles de empleados. */
export function activeEmployees(repo: TenantRepo, limit = 200): Promise<Employee[]> {
  return repo.list('employees', {
    where: [{ field: 'status', op: '==', value: 'ACTIVE' }],
    orderBy: { field: 'employeeNumber', dir: 'asc' },
    limit,
  })
}

/** Busca por prefijo de nombre, resuelto en el servidor. */
export function searchEmployees(repo: TenantRepo, term: string, limit = 20): Promise<Employee[]> {
  const q = norm(term.trim())
  if (!q) return Promise.resolve([])
  return repo.list('employees', {
    where: [
      { field: 'searchKey', op: '>=', value: q },
      { field: 'searchKey', op: '<=', value: `${q}` },
    ],
    orderBy: { field: 'searchKey', dir: 'asc' },
    limit,
  })
}

/** Empleado enlazado a una cuenta de usuario, si lo hay. */
export async function employeeForUser(repo: TenantRepo, uid: string): Promise<Employee | null> {
  const rows = await repo.list('employees', {
    where: [{ field: 'userId', op: '==', value: uid }],
    limit: 1,
  })
  return rows[0] ?? null
}
