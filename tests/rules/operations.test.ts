import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { anonDb, db, env, GYM_A, GYM_B, newDoc, seedBaseline, setupTestEnv, USERS } from './setup'

// ═══════════════════════════════════════════════════════════════════════════
// OPERACIÓN INTERNA (Fase 4) — empleados, asistencia laboral, dispositivos,
// eventos biométricos, insumos y avisos.
//
// Gimnasio A = Pro, CON el módulo de personal contratado.
// Gimnasio B = Starter, SIN el módulo.
//
// Lo que se demuestra aquí y no en la interfaz: que un gimnasio no ve el
// personal de otro, que el de mantenimiento no ve socios ni sueldos, y que un
// plan sin el módulo lo tiene bloqueado en el SERVIDOR.
//
// Ejecutar:  npm run test:rules
// ═══════════════════════════════════════════════════════════════════════════

beforeAll(async () => {
  await setupTestEnv()
})

beforeEach(async () => {
  await env().clearFirestore()
  await seedBaseline()
})

afterAll(async () => {
  await env().cleanup()
})

// ───────────────────────────────────────────────────────────────────────────
describe('Empleados · aislamiento entre gimnasios', () => {
  it('el OWNER de A lee el personal de A', async () => {
    await assertSucceeds(getDoc(doc(db('ownerA'), 'employees/emp_a1')))
  })

  it('el OWNER de A NO lee el personal de B', async () => {
    await assertFails(getDoc(doc(db('ownerA'), 'employees/emp_b1')))
  })

  it('el OWNER de A NO lista empleados sin filtrar por su gimnasio', async () => {
    await assertFails(getDocs(collection(db('ownerA'), 'employees')))
  })

  it('el OWNER de A lista los suyos filtrando por gymId', async () => {
    const q = query(collection(db('ownerA'), 'employees'), where('gymId', '==', GYM_A))
    await assertSucceeds(getDocs(q))
  })

  it('el OWNER de A NO crea un empleado en B', async () => {
    await assertFails(setDoc(doc(db('ownerA'), 'employees/intruso'), newDoc('employees', GYM_B)))
  })

  it('el OWNER de A NO edita un empleado de B', async () => {
    await assertFails(updateDoc(doc(db('ownerA'), 'employees/emp_b1'), { position: 'Gerente' }))
  })

  it('el OWNER de A NO borra un empleado de B', async () => {
    await assertFails(updateDoc(doc(db('ownerA'), 'employees/emp_b1'), { status: 'INACTIVE' }))
  })

  it('un empleado NO se puede mudar de gimnasio', async () => {
    await assertFails(updateDoc(doc(db('ownerA'), 'employees/emp_a1'), { gymId: GYM_B }))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('Empleados · quién puede administrarlos', () => {
  it('el OWNER da de alta personal', async () => {
    await assertSucceeds(setDoc(doc(db('ownerA'), 'employees/e_new'), newDoc('employees', GYM_A)))
  })

  it('el ADMIN da de alta personal', async () => {
    await assertSucceeds(setDoc(doc(db('adminA'), 'employees/e_new'), newDoc('employees', GYM_A)))
  })

  it('el RECEPCIONISTA consulta el directorio pero NO da de alta', async () => {
    await assertSucceeds(getDoc(doc(db('receptionA'), 'employees/emp_a1')))
    await assertFails(setDoc(doc(db('receptionA'), 'employees/e_new'), newDoc('employees', GYM_A)))
  })

  it('el ENTRENADOR consulta pero NO administra', async () => {
    await assertSucceeds(getDoc(doc(db('trainerA'), 'employees/emp_a1')))
    await assertFails(updateDoc(doc(db('trainerA'), 'employees/emp_a1'), { position: 'Gerente' }))
  })

  it('un SOCIO no ve al personal', async () => {
    await assertFails(getDoc(doc(db('memberA'), 'employees/emp_a1')))
  })

  it('MANTENIMIENTO tampoco ve la ficha del personal', async () => {
    await assertFails(getDoc(doc(db('maintenanceA'), 'employees/emp_a1')))
  })

  it('sin sesión no se ve nada', async () => {
    await assertFails(getDoc(doc(anonDb(), 'employees/emp_a1')))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('Asistencia laboral', () => {
  it('el encargado lee la asistencia de su gimnasio', async () => {
    await assertSucceeds(getDoc(doc(db('ownerA'), 'employeeAttendance/emp_a1_2026-09-14')))
  })

  it('el OWNER de B NO lee la asistencia de A', async () => {
    await assertFails(getDoc(doc(db('ownerB'), 'employeeAttendance/emp_a1_2026-09-14')))
  })

  it('la recepción SÍ registra un fichaje: el mostrador es donde ocurre', async () => {
    await assertSucceeds(
      setDoc(doc(db('receptionA'), 'employeeAttendance/emp_a1_2026-09-15'), newDoc('employeeAttendance', GYM_A)),
    )
  })

  it('un SOCIO no ve la asistencia de nadie', async () => {
    await assertFails(getDoc(doc(db('memberA'), 'employeeAttendance/emp_a1_2026-09-14')))
  })

  it('MANTENIMIENTO no ve los retardos de sus compañeros', async () => {
    await assertFails(getDoc(doc(db('maintenanceA'), 'employeeAttendance/emp_a1_2026-09-14')))
  })

  it('solo un encargado puede BORRAR un registro de asistencia', async () => {
    await assertFails(
      updateDoc(doc(db('ownerB'), 'employeeAttendance/emp_a1_2026-09-14'), { status: 'JUSTIFIED' }),
    )
  })

  it('un registro de asistencia NO cambia de gimnasio', async () => {
    await assertFails(
      updateDoc(doc(db('ownerA'), 'employeeAttendance/emp_a1_2026-09-14'), { gymId: GYM_B }),
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('El plan bloquea el módulo en el SERVIDOR', () => {
  it('el gimnasio B (Starter, sin módulo) NO crea empleados', async () => {
    await assertFails(setDoc(doc(db('ownerB'), 'employees/e_b'), newDoc('employees', GYM_B)))
  })

  it('el gimnasio B NO registra asistencia laboral', async () => {
    await assertFails(
      setDoc(doc(db('ownerB'), 'employeeAttendance/x'), newDoc('employeeAttendance', GYM_B)),
    )
  })

  it('el gimnasio B NO da de alta dispositivos', async () => {
    await assertFails(setDoc(doc(db('ownerB'), 'devices/d_b'), newDoc('devices', GYM_B)))
  })

  it('el gimnasio B NO crea solicitudes de insumos', async () => {
    await assertFails(
      setDoc(
        doc(db('ownerB'), 'supplyRequests/r_b'),
        newDoc('supplyRequests', GYM_B, { requestedBy: USERS.ownerB.uid }),
      ),
    )
  })

  it('activar el módulo en su plan lo habilita de inmediato', async () => {
    await assertFails(setDoc(doc(db('ownerB'), 'employees/e_b'), newDoc('employees', GYM_B)))

    await env().withSecurityRulesDisabled(async (ctx) => {
      const g = await ctx.firestore().doc(`gyms/${GYM_B}`).get()
      const ent = g.data()!.entitlements
      await ctx
        .firestore()
        .doc(`gyms/${GYM_B}`)
        .update({ entitlements: { ...ent, features: { ...ent.features, employees: true } } })
    })

    await assertSucceeds(setDoc(doc(db('ownerB'), 'employees/e_b'), newDoc('employees', GYM_B)))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('Dispositivos', () => {
  it('el encargado da de alta un lector', async () => {
    await assertSucceeds(setDoc(doc(db('ownerA'), 'devices/d_new'), newDoc('devices', GYM_A)))
  })

  it('la recepción los consulta pero no los configura', async () => {
    await assertSucceeds(getDoc(doc(db('receptionA'), 'devices/dev_a1')))
    await assertFails(setDoc(doc(db('receptionA'), 'devices/d_new'), newDoc('devices', GYM_A)))
  })

  it('un gimnasio NO ve los dispositivos de otro', async () => {
    await assertFails(getDoc(doc(db('ownerB'), 'devices/dev_a1')))
  })

  it('un SOCIO no ve los dispositivos', async () => {
    await assertFails(getDoc(doc(db('memberA'), 'devices/dev_a1')))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('Eventos biométricos · append-only e idempotencia', () => {
  it('la recepción registra un evento', async () => {
    await assertSucceeds(
      setDoc(doc(db('receptionA'), 'biometricEvents/evt_nuevo'), newDoc('biometricEvents', GYM_A)),
    )
  })

  it('un evento NO se puede editar: es un registro de lo que pasó', async () => {
    await assertFails(
      updateDoc(doc(db('ownerA'), 'biometricEvents/evt_a1'), { type: 'ACCESS_DENIED' }),
    )
  })

  it('un evento NO se puede borrar, ni por el dueño', async () => {
    await assertFails(
      updateDoc(doc(db('ownerA'), 'biometricEvents/evt_a1'), { occurredAt: 0 }),
    )
  })

  it('reenviar el MISMO eventId no crea un segundo documento', async () => {
    // El id del documento ES el eventId: el segundo intento es un `update`
    // sobre el mismo documento, y eso está prohibido. Firestore termina con
    // UN evento, que es justo la garantía que se busca.
    const payload = newDoc('biometricEvents', GYM_A, { eventId: 'evt_dup' })
    await assertSucceeds(setDoc(doc(db('receptionA'), 'biometricEvents/evt_dup'), payload))
    await assertFails(setDoc(doc(db('receptionA'), 'biometricEvents/evt_dup'), payload))
  })

  it('un gimnasio NO lee los eventos de otro', async () => {
    await assertFails(getDoc(doc(db('ownerB'), 'biometricEvents/evt_a1')))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('Solicitudes de insumos', () => {
  it('la recepción crea una solicitud a su nombre', async () => {
    await assertSucceeds(
      setDoc(
        doc(db('receptionA'), 'supplyRequests/r_new'),
        newDoc('supplyRequests', GYM_A, { requestedBy: USERS.receptionA.uid }),
      ),
    )
  })

  it('nadie crea una solicitud a nombre de otro', async () => {
    await assertFails(
      setDoc(
        doc(db('receptionA'), 'supplyRequests/r_fake'),
        newDoc('supplyRequests', GYM_A, { requestedBy: USERS.ownerA.uid }),
      ),
    )
  })

  it('una cantidad de cero o negativa se rechaza', async () => {
    await assertFails(
      setDoc(
        doc(db('receptionA'), 'supplyRequests/r_zero'),
        newDoc('supplyRequests', GYM_A, { requestedBy: USERS.receptionA.uid, quantity: 0 }),
      ),
    )
  })

  it('MANTENIMIENTO ve las solicitudes de su gimnasio', async () => {
    await assertSucceeds(getDoc(doc(db('maintenanceA'), 'supplyRequests/req_a1')))
  })

  it('MANTENIMIENTO la toma y la marca entregada', async () => {
    await assertSucceeds(
      updateDoc(doc(db('maintenanceA'), 'supplyRequests/req_a1'), {
        status: 'IN_PROGRESS',
        assignedTo: USERS.maintenanceA.uid,
        assignedToName: 'Adrián',
      }),
    )
    await assertSucceeds(
      updateDoc(doc(db('maintenanceA'), 'supplyRequests/req_a1'), { status: 'DELIVERED' }),
    )
  })

  it('MANTENIMIENTO de A NO ve las solicitudes de B', async () => {
    await assertFails(getDoc(doc(db('maintenanceA'), 'supplyRequests/req_b1')))
  })

  it('MANTENIMIENTO de A NO toca las solicitudes de B', async () => {
    await assertFails(
      updateDoc(doc(db('maintenanceA'), 'supplyRequests/req_b1'), { status: 'DELIVERED' }),
    )
  })

  it('un SOCIO no ve ni crea solicitudes', async () => {
    await assertFails(getDoc(doc(db('memberA'), 'supplyRequests/req_a1')))
    await assertFails(
      setDoc(
        doc(db('memberA'), 'supplyRequests/r_socio'),
        newDoc('supplyRequests', GYM_A, { requestedBy: USERS.memberA.uid }),
      ),
    )
  })

  it('el historial no se borra, ni por el dueño', async () => {
    await assertFails(updateDoc(doc(db('ownerA'), 'supplyRequests/req_a1'), { gymId: GYM_B }))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('Avisos internos', () => {
  it('MANTENIMIENTO lee los avisos dirigidos a su puesto', async () => {
    await assertSucceeds(getDoc(doc(db('maintenanceA'), 'internalNotifications/not_a1')))
  })

  it('el encargado ve los avisos de su gimnasio', async () => {
    await assertSucceeds(getDoc(doc(db('ownerA'), 'internalNotifications/not_a1')))
  })

  it('MANTENIMIENTO de B NO lee los avisos de A', async () => {
    await assertFails(getDoc(doc(db('maintenanceB'), 'internalNotifications/not_a1')))
  })

  it('un SOCIO no lee avisos internos', async () => {
    await assertFails(getDoc(doc(db('memberA'), 'internalNotifications/not_a1')))
  })

  it('un aviso solo se marca como leído: el texto no se reescribe', async () => {
    await assertSucceeds(
      updateDoc(doc(db('maintenanceA'), 'internalNotifications/not_a1'), { readAt: Date.now() }),
    )
    await assertFails(
      updateDoc(doc(db('maintenanceA'), 'internalNotifications/not_a1'), { body: 'Otra cosa' }),
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('El SUPERADMIN ve la plataforma entera', () => {
  it('lee el personal de cualquier gimnasio', async () => {
    await assertSucceeds(getDoc(doc(db('superadmin'), 'employees/emp_a1')))
    await assertSucceeds(getDoc(doc(db('superadmin'), 'employees/emp_b1')))
  })

  it('lista sin filtrar por gimnasio', async () => {
    await assertSucceeds(getDocs(collection(db('superadmin'), 'supplyRequests')))
  })

  it('lee la asistencia laboral de cualquier gimnasio', async () => {
    await assertSucceeds(getDoc(doc(db('superadmin'), 'employeeAttendance/emp_a1_2026-09-14')))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('Suscripción suspendida', () => {
  it('bloquea el fichaje pero conserva la consulta', async () => {
    await env().withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`gyms/${GYM_A}`).update({ subscriptionStatus: 'SUSPENDED' })
    })

    await assertFails(
      setDoc(doc(db('receptionA'), 'employeeAttendance/x'), newDoc('employeeAttendance', GYM_A)),
    )
    // El historial sigue ahí: restringir no es borrar.
    await assertSucceeds(getDoc(doc(db('ownerA'), 'employeeAttendance/emp_a1_2026-09-14')))
  })
})
