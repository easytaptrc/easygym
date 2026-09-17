import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore'
import {
  anonDb,
  db,
  env,
  GYM_A,
  GYM_B,
  newDoc,
  seedBaseline,
  setupTestEnv,
  USERS,
} from './setup'

// ═══════════════════════════════════════════════════════════════════════════
// PRUEBAS DE AISLAMIENTO MULTI-TENANT
//
// Corren contra el emulador REAL de Firestore evaluando `firestore.rules`.
// Es la única forma de demostrar el aislamiento en vez de afirmarlo: lo que
// se comprueba aquí no depende de que la interfaz filtre bien.
//
// Ejecutar:   npm run test:rules
// Requiere:   Java 11+ y firebase-tools (el emulador los necesita)
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
describe('TEST 1 · El dueño lee lo suyo', () => {
  it('OWNER de A lee un socio de A', async () => {
    await assertSucceeds(getDoc(doc(db('ownerA'), 'members/mem_a1')))
  })

  it('OWNER de A lista los socios de A filtrando por su gymId', async () => {
    const q = query(collection(db('ownerA'), 'members'), where('gymId', '==', GYM_A))
    await assertSucceeds(getDocs(q))
  })

  it('OWNER de A lee los pagos de A', async () => {
    await assertSucceeds(getDoc(doc(db('ownerA'), 'payments/pay_a1')))
  })

  it('OWNER de A lee la configuración de A', async () => {
    await assertSucceeds(getDoc(doc(db('ownerA'), `settings/${GYM_A}`)))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('TEST 2 · El dueño NO lee lo del otro gimnasio', () => {
  it('OWNER de A NO lee un socio de B', async () => {
    await assertFails(getDoc(doc(db('ownerA'), 'members/mem_b1')))
  })

  it('OWNER de A NO lee los pagos de B', async () => {
    await assertFails(getDoc(doc(db('ownerA'), 'payments/pay_b1')))
  })

  it('OWNER de A NO lista socios SIN filtrar por gymId', async () => {
    // La query devolvería documentos de B, y la regla se evalúa documento a
    // documento: el servidor la rechaza entera.
    await assertFails(getDocs(collection(db('ownerA'), 'members')))
  })

  it('OWNER de A NO lista los socios de B aunque filtre por el gymId de B', async () => {
    const q = query(collection(db('ownerA'), 'members'), where('gymId', '==', GYM_B))
    await assertFails(getDocs(q))
  })

  it('OWNER de A NO lee la configuración de B', async () => {
    await assertFails(getDoc(doc(db('ownerA'), `settings/${GYM_B}`)))
  })

  it('OWNER de A NO lee los contadores de B', async () => {
    await assertFails(getDoc(doc(db('ownerA'), `counters/${GYM_B}`)))
  })

  it('OWNER de A NO lee el documento del gimnasio B', async () => {
    await assertFails(getDoc(doc(db('ownerA'), `gyms/${GYM_B}`)))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('TEST 3 · El dueño NO modifica datos del otro gimnasio', () => {
  it('OWNER de A NO edita un socio de B', async () => {
    await assertFails(updateDoc(doc(db('ownerA'), 'members/mem_b1'), { name: 'Secuestrado' }))
  })

  it('OWNER de A NO crea un socio dentro de B', async () => {
    await assertFails(setDoc(doc(db('ownerA'), 'members/intruso'), newDoc('members', GYM_B)))
  })

  it('OWNER de A NO mueve un socio suyo al gimnasio B', async () => {
    // El gymId de un documento es inmutable: cambiarlo sería exportar datos.
    await assertFails(updateDoc(doc(db('ownerA'), 'members/mem_a1'), { gymId: GYM_B }))
  })

  it('OWNER de A NO edita la configuración de B', async () => {
    await assertFails(updateDoc(doc(db('ownerA'), `settings/${GYM_B}`), { nearExpirationDays: 30 }))
  })

  it('OWNER de A NO edita el gimnasio B', async () => {
    await assertFails(updateDoc(doc(db('ownerA'), `gyms/${GYM_B}`), { name: 'Robado' }))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('TEST 4 · El dueño NO borra datos del otro gimnasio', () => {
  it('OWNER de A NO borra un socio de B', async () => {
    await assertFails(deleteDoc(doc(db('ownerA'), 'members/mem_b1')))
  })

  it('OWNER de A NO borra un pago de B', async () => {
    await assertFails(deleteDoc(doc(db('ownerA'), 'payments/pay_b1')))
  })

  it('OWNER de A SÍ borra un socio suyo', async () => {
    await assertSucceeds(deleteDoc(doc(db('ownerA'), 'members/mem_a2')))
  })

  it('OWNER de A NO borra el gimnasio B', async () => {
    await assertFails(deleteDoc(doc(db('ownerA'), `gyms/${GYM_B}`)))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('TEST 5 · El recepcionista solo hace lo suyo', () => {
  it('SÍ registra un pago', async () => {
    await assertSucceeds(setDoc(doc(db('receptionA'), 'payments/nuevo'), newDoc('payments', GYM_A)))
  })

  it('SÍ registra una visita', async () => {
    await assertSucceeds(setDoc(doc(db('receptionA'), 'visits/nueva'), newDoc('visits', GYM_A)))
  })

  it('SÍ registra una asistencia', async () => {
    await assertSucceeds(setDoc(doc(db('receptionA'), 'attendance/nueva'), newDoc('attendance', GYM_A)))
  })

  it('SÍ da de alta un socio', async () => {
    await assertSucceeds(setDoc(doc(db('receptionA'), 'members/nuevo'), newDoc('members', GYM_A)))
  })

  it('NO cambia la configuración del gimnasio', async () => {
    await assertFails(updateDoc(doc(db('receptionA'), `settings/${GYM_A}`), { nearExpirationDays: 30 }))
  })

  it('NO borra un socio', async () => {
    await assertFails(deleteDoc(doc(db('receptionA'), 'members/mem_a1')))
  })

  it('NO borra un pago', async () => {
    await assertFails(deleteDoc(doc(db('receptionA'), 'payments/pay_a1')))
  })

  it('NO crea usuarios del gimnasio', async () => {
    await assertFails(
      setDoc(doc(db('receptionA'), 'users/u_nuevo'), {
        uid: 'u_nuevo',
        role: 'ADMIN',
        gymId: GYM_A,
        active: true,
        email: 'x@x.mx',
        name: 'X',
        createdAt: Date.now(),
      }),
    )
  })

  it('NO toca nada del gimnasio B', async () => {
    await assertFails(setDoc(doc(db('receptionA'), 'payments/intruso'), newDoc('payments', GYM_B)))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('TEST 6 · El entrenador solo gestiona clases', () => {
  it('SÍ crea una clase', async () => {
    await assertSucceeds(setDoc(doc(db('trainerA'), 'classes/nueva'), newDoc('classes', GYM_A)))
  })

  it('SÍ edita las bicicletas', async () => {
    await assertSucceeds(setDoc(doc(db('trainerA'), 'bikes/b1'), newDoc('bikes', GYM_A)))
  })

  it('SÍ lee los socios de su gimnasio', async () => {
    await assertSucceeds(getDoc(doc(db('trainerA'), 'members/mem_a1')))
  })

  it('NO registra pagos: no maneja dinero', async () => {
    await assertFails(setDoc(doc(db('trainerA'), 'payments/nuevo'), newDoc('payments', GYM_A)))
  })

  it('NO registra visitas', async () => {
    await assertFails(setDoc(doc(db('trainerA'), 'visits/nueva'), newDoc('visits', GYM_A)))
  })

  it('NO cambia la configuración', async () => {
    await assertFails(updateDoc(doc(db('trainerA'), `settings/${GYM_A}`), { nearExpirationDays: 15 }))
  })

  it('NO borra clases (eso es de un manager)', async () => {
    await assertFails(deleteDoc(doc(db('trainerA'), 'classes/cls_a1')))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('TEST 7 · El socio solo ve y toca lo suyo', () => {
  it('SÍ lee su propia ficha', async () => {
    await assertSucceeds(getDoc(doc(db('memberA'), 'members/mem_a1')))
  })

  it('NO lee la ficha de otro socio del mismo gimnasio', async () => {
    await assertFails(getDoc(doc(db('memberA'), 'members/mem_a2')))
  })

  it('NO lee la ficha de un socio de otro gimnasio', async () => {
    await assertFails(getDoc(doc(db('memberA'), 'members/mem_b1')))
  })

  it('SÍ lee sus propios pagos', async () => {
    await assertSucceeds(getDoc(doc(db('memberA'), 'payments/pay_a1')))
  })

  it('NO se alarga su propia vigencia', async () => {
    // El fraude más obvio: regalarse un año de membresía.
    await assertFails(
      updateDoc(doc(db('memberA'), 'members/mem_a1'), { expiresAt: Date.now() + 365 * 86_400_000 }),
    )
  })

  it('NO se cambia su propio estado a ACTIVE', async () => {
    await assertFails(updateDoc(doc(db('memberA'), 'members/mem_a1'), { status: 'ACTIVE', expiresAt: 1 }))
  })

  it('SÍ actualiza su teléfono', async () => {
    await assertSucceeds(updateDoc(doc(db('memberA'), 'members/mem_a1'), { phone: '3311112222' }))
  })

  it('NO crea pagos: no se cobra a sí mismo', async () => {
    await assertFails(setDoc(doc(db('memberA'), 'payments/nuevo'), newDoc('payments', GYM_A)))
  })

  it('NO registra su propia asistencia', async () => {
    await assertFails(setDoc(doc(db('memberA'), 'attendance/nueva'), newDoc('attendance', GYM_A)))
  })

  it('SÍ crea una reservación a su nombre', async () => {
    await assertSucceeds(
      setDoc(doc(db('memberA'), 'reservations/r1'), newDoc('reservations', GYM_A, { memberId: 'mem_a1' })),
    )
  })

  it('NO crea una reservación a nombre de otro socio', async () => {
    await assertFails(
      setDoc(doc(db('memberA'), 'reservations/r2'), newDoc('reservations', GYM_A, { memberId: 'mem_a2' })),
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('TEST 8 · El SUPERADMIN administra toda la plataforma', () => {
  it('lee los socios de A y de B', async () => {
    await assertSucceeds(getDoc(doc(db('superadmin'), 'members/mem_a1')))
    await assertSucceeds(getDoc(doc(db('superadmin'), 'members/mem_b1')))
  })

  it('lista todos los gimnasios', async () => {
    await assertSucceeds(getDocs(collection(db('superadmin'), 'gyms')))
  })

  it('lista los socios SIN filtrar por gymId', async () => {
    await assertSucceeds(getDocs(collection(db('superadmin'), 'members')))
  })

  it('cambia el estado de un gimnasio', async () => {
    await assertSucceeds(
      updateDoc(doc(db('superadmin'), `gyms/${GYM_B}`), { subscriptionStatus: 'SUSPENDED' }),
    )
  })

  it('edita el catálogo de planes', async () => {
    await assertSucceeds(updateDoc(doc(db('superadmin'), 'plans/STARTER'), { price: 599 }))
  })

  it('lee la auditoría de toda la plataforma', async () => {
    await assertSucceeds(getDocs(collection(db('superadmin'), 'auditLogs')))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('TEST 9 · Sin sesión no se ve nada privado', () => {
  it('NO lee socios', async () => {
    await assertFails(getDoc(anonDb() && doc(anonDb(), 'members/mem_a1')))
  })

  it('NO lee pagos', async () => {
    await assertFails(getDoc(doc(anonDb(), 'payments/pay_a1')))
  })

  it('NO lee el documento del gimnasio', async () => {
    await assertFails(getDoc(doc(anonDb(), `gyms/${GYM_A}`)))
  })

  it('NO lee usuarios', async () => {
    await assertFails(getDoc(doc(anonDb(), `users/${USERS.ownerA.uid}`)))
  })

  it('NO lee la configuración', async () => {
    await assertFails(getDoc(doc(anonDb(), `settings/${GYM_A}`)))
  })

  it('NO escribe nada', async () => {
    await assertFails(setDoc(doc(anonDb(), 'members/intruso'), newDoc('members', GYM_A)))
  })

  it('SÍ lee el espejo público del gimnasio', async () => {
    // Es lo único abierto, y solo lleva nombre, dirección y precios.
    await env().withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`publicGyms/${GYM_A}`).set({
        id: GYM_A,
        slug: 'alpha',
        name: 'Alpha Fitness',
        active: true,
        plans: [],
      })
    })
    await assertSucceeds(getDoc(doc(anonDb(), `publicGyms/${GYM_A}`)))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('TEST 10 · Nadie se cambia de gimnasio', () => {
  it('un OWNER NO se cambia su propio gymId', async () => {
    // Si pudiera, entraría al gimnasio de al lado con todos sus permisos.
    await assertFails(updateDoc(doc(db('ownerA'), `users/${USERS.ownerA.uid}`), { gymId: GYM_B }))
  })

  it('un socio NO se cambia su propio gymId', async () => {
    await assertFails(updateDoc(doc(db('memberA'), `users/${USERS.memberA.uid}`), { gymId: GYM_B }))
  })

  it('un usuario NO se asciende a SUPERADMIN', async () => {
    await assertFails(updateDoc(doc(db('receptionA'), `users/${USERS.receptionA.uid}`), { role: 'SUPERADMIN' }))
  })

  it('un usuario NO se asciende a OWNER', async () => {
    await assertFails(updateDoc(doc(db('receptionA'), `users/${USERS.receptionA.uid}`), { role: 'OWNER' }))
  })

  it('un socio NO se apunta a la ficha de otro socio', async () => {
    await assertFails(updateDoc(doc(db('memberA'), `users/${USERS.memberA.uid}`), { memberId: 'mem_a2' }))
  })

  it('un manager NO mueve a un empleado a otro gimnasio', async () => {
    await assertFails(updateDoc(doc(db('adminA'), `users/${USERS.receptionA.uid}`), { gymId: GYM_B }))
  })

  it('un manager NO asciende a un empleado a SUPERADMIN', async () => {
    await assertFails(updateDoc(doc(db('adminA'), `users/${USERS.receptionA.uid}`), { role: 'SUPERADMIN' }))
  })

  it('un OWNER SÍ actualiza su propio nombre', async () => {
    await assertSucceeds(updateDoc(doc(db('ownerA'), `users/${USERS.ownerA.uid}`), { name: 'Nuevo nombre' }))
  })
})
