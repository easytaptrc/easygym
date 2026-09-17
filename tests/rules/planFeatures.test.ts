import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore'
import { db, env, GYM_A, GYM_B, newDoc, seedBaseline, setupTestEnv, USERS } from './setup'

// ═══════════════════════════════════════════════════════════════════════════
// EL SERVIDOR HACE CUMPLIR EL PLAN
//
// Esconder un botón no es proteger nada: quien escriba la URL a mano, o llame
// a Firestore desde la consola, llega igual. Lo que impide de verdad que un
// gimnasio Starter use reservaciones es esta capa.
//
// Gimnasio A = plan Pro    (reservaciones SÍ, inventario NO, tope 10 socios)
// Gimnasio B = plan Starter (reservaciones NO, clases NO)
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
describe('Funcionalidades bloqueadas por plan', () => {
  it('Starter NO puede crear reservaciones, aunque lo intente por API', async () => {
    await assertFails(
      setDoc(doc(db('ownerB'), 'reservations/r1'), newDoc('reservations', GYM_B, { memberId: 'mem_b1' })),
    )
  })

  it('Starter NO puede crear clases', async () => {
    await assertFails(setDoc(doc(db('ownerB'), 'classes/c1'), newDoc('classes', GYM_B)))
  })

  it('Starter NO puede crear bicicletas', async () => {
    await assertFails(setDoc(doc(db('ownerB'), 'bikes/b1'), newDoc('bikes', GYM_B)))
  })

  it('Starter NO puede crear productos del punto de venta', async () => {
    await assertFails(setDoc(doc(db('ownerB'), 'products/p1'), newDoc('products', GYM_B)))
  })

  it('Starter SÍ puede lo que su plan incluye: socios, pagos, visitas', async () => {
    await assertSucceeds(setDoc(doc(db('ownerB'), 'members/m1'), newDoc('members', GYM_B)))
    await assertSucceeds(setDoc(doc(db('ownerB'), 'payments/p1'), newDoc('payments', GYM_B)))
    await assertSucceeds(setDoc(doc(db('ownerB'), 'visits/v1'), newDoc('visits', GYM_B)))
  })

  it('Pro SÍ puede crear reservaciones, clases y bicicletas', async () => {
    await assertSucceeds(setDoc(doc(db('ownerA'), 'classes/c1'), newDoc('classes', GYM_A)))
    await assertSucceeds(setDoc(doc(db('ownerA'), 'bikes/b1'), newDoc('bikes', GYM_A)))
    await assertSucceeds(
      setDoc(doc(db('ownerA'), 'reservations/r1'), newDoc('reservations', GYM_A, { memberId: 'mem_a1' })),
    )
  })

  it('Pro NO puede usar inventario ni sucursales: no están en su plan', async () => {
    await assertFails(setDoc(doc(db('ownerA'), 'inventory/i1'), newDoc('inventory', GYM_A)))
    await assertFails(setDoc(doc(db('ownerA'), 'branches/b1'), newDoc('branches', GYM_A)))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('El SuperAdmin cambia el plan y el servidor obedece', () => {
  it('activar reservaciones en Starter las habilita de inmediato', async () => {
    // Antes: bloqueado.
    await assertFails(
      setDoc(doc(db('ownerB'), 'reservations/r0'), newDoc('reservations', GYM_B, { memberId: 'mem_b1' })),
    )

    // El SuperAdmin enciende la funcionalidad y el servidor propaga los
    // entitlements al gimnasio (en producción lo hace el trigger onPlanWritten).
    await env().withSecurityRulesDisabled(async (ctx) => {
      const g = await ctx.firestore().doc(`gyms/${GYM_B}`).get()
      const ent = g.data()!.entitlements
      await ctx
        .firestore()
        .doc(`gyms/${GYM_B}`)
        .update({ entitlements: { ...ent, features: { ...ent.features, reservations: true } } })
    })

    // Después: permitido. Sin recompilar ni desplegar nada.
    await assertSucceeds(
      setDoc(doc(db('ownerB'), 'reservations/r1'), newDoc('reservations', GYM_B, { memberId: 'mem_b1' })),
    )
  })

  it('desactivar el mapa de bicicletas en Pro lo bloquea de inmediato', async () => {
    await assertSucceeds(setDoc(doc(db('ownerA'), 'bikes/b1'), newDoc('bikes', GYM_A)))

    await env().withSecurityRulesDisabled(async (ctx) => {
      const g = await ctx.firestore().doc(`gyms/${GYM_A}`).get()
      const ent = g.data()!.entitlements
      await ctx
        .firestore()
        .doc(`gyms/${GYM_A}`)
        .update({ entitlements: { ...ent, features: { ...ent.features, spinningMap: false } } })
    })

    await assertFails(setDoc(doc(db('ownerA'), 'bikes/b2'), newDoc('bikes', GYM_A)))
    // Lo demás del plan sigue funcionando.
    await assertSucceeds(setDoc(doc(db('ownerA'), 'classes/c2'), newDoc('classes', GYM_A)))
  })

  it('un OWNER NO puede editar el catálogo de planes para regalarse funciones', async () => {
    await assertFails(
      updateDoc(doc(db('ownerA'), 'plans/STARTER'), { features: { reservations: true } }),
    )
  })

  it('un OWNER NO puede editar sus propios entitlements', async () => {
    // Sería el atajo evidente: darse el plan Business desde la consola.
    await assertFails(
      updateDoc(doc(db('ownerA'), `gyms/${GYM_A}`), {
        entitlements: {
          planId: 'BUSINESS',
          features: { inventory: true, multipleBranches: true },
          maxMembers: null,
          maxStaff: null,
          maxBranches: null,
          syncedAt: Date.now(),
        },
      }),
    )
  })

  it('un OWNER NO puede cambiarse solo de plan', async () => {
    await assertFails(updateDoc(doc(db('ownerA'), `gyms/${GYM_A}`), { planId: 'BUSINESS' }))
  })

  it('un OWNER NO puede reactivarse la suscripción', async () => {
    // El gimnasio tiene que estar SUSPENDIDO para que esto pruebe algo. La
    // primera versión partía de un gimnasio ACTIVE y escribía 'ACTIVE': era un
    // cambio nulo, las reglas lo permitían con razón, y la prueba fallaba
    // acusando a las reglas de un error que no existía.
    await env().withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`gyms/${GYM_A}`).update({ subscriptionStatus: 'SUSPENDED' })
    })

    await assertFails(
      updateDoc(doc(db('ownerA'), `gyms/${GYM_A}`), { subscriptionStatus: 'ACTIVE' }),
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('Límite de socios del plan', () => {
  it('con cupo libre, el alta pasa', async () => {
    // El contador dice 3 y el tope es 10.
    await assertSucceeds(setDoc(doc(db('ownerA'), 'members/m_nuevo'), newDoc('members', GYM_A)))
  })

  it('al llegar al tope, el SERVIDOR rechaza el alta', async () => {
    await env().withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`counters/${GYM_A}`).update({
        'members.total': 10,
      })
    })
    await assertFails(setDoc(doc(db('ownerA'), 'members/m_tope'), newDoc('members', GYM_A)))
  })

  it('subir el tope del plan vuelve a permitir altas', async () => {
    await env().withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`counters/${GYM_A}`).update({ 'members.total': 10 })
    })
    await assertFails(setDoc(doc(db('ownerA'), 'members/m1'), newDoc('members', GYM_A)))

    await env().withSecurityRulesDisabled(async (ctx) => {
      const g = await ctx.firestore().doc(`gyms/${GYM_A}`).get()
      await ctx
        .firestore()
        .doc(`gyms/${GYM_A}`)
        .update({ entitlements: { ...g.data()!.entitlements, maxMembers: 50 } })
    })
    await assertSucceeds(setDoc(doc(db('ownerA'), 'members/m2'), newDoc('members', GYM_A)))
  })

  it('un plan sin tope (null) nunca bloquea', async () => {
    await env().withSecurityRulesDisabled(async (ctx) => {
      const g = await ctx.firestore().doc(`gyms/${GYM_A}`).get()
      await ctx.firestore().doc(`counters/${GYM_A}`).update({ 'members.total': 99_999 })
      await ctx
        .firestore()
        .doc(`gyms/${GYM_A}`)
        .update({ entitlements: { ...g.data()!.entitlements, maxMembers: null } })
    })
    await assertSucceeds(setDoc(doc(db('ownerA'), 'members/m_ilimitado'), newDoc('members', GYM_A)))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('Estado de la suscripción', () => {
  async function setStatus(gymId: string, status: string) {
    await env().withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`gyms/${gymId}`).update({ subscriptionStatus: status })
    })
  }

  it('SUSPENDED bloquea las escrituras', async () => {
    await setStatus(GYM_A, 'SUSPENDED')
    await assertFails(setDoc(doc(db('ownerA'), 'members/m1'), newDoc('members', GYM_A)))
    await assertFails(setDoc(doc(db('receptionA'), 'payments/p1'), newDoc('payments', GYM_A)))
  })

  it('SUSPENDED conserva la LECTURA: los datos no se pierden', async () => {
    await setStatus(GYM_A, 'SUSPENDED')
    await assertSucceeds(getDoc(doc(db('ownerA'), 'members/mem_a1')))
    await assertSucceeds(getDoc(doc(db('ownerA'), 'payments/pay_a1')))
  })

  it('CANCELED bloquea las escrituras y conserva la lectura', async () => {
    await setStatus(GYM_A, 'CANCELED')
    await assertFails(setDoc(doc(db('ownerA'), 'members/m1'), newDoc('members', GYM_A)))
    await assertSucceeds(getDoc(doc(db('ownerA'), 'members/mem_a1')))
  })

  it('PAST_DUE sigue operando: un cargo fallido no cierra el gimnasio', async () => {
    await setStatus(GYM_A, 'PAST_DUE')
    await assertSucceeds(setDoc(doc(db('receptionA'), 'payments/p1'), newDoc('payments', GYM_A)))
    await assertSucceeds(setDoc(doc(db('ownerA'), 'members/m1'), newDoc('members', GYM_A)))
  })

  it('reactivar devuelve la operación', async () => {
    await setStatus(GYM_A, 'SUSPENDED')
    await assertFails(setDoc(doc(db('ownerA'), 'members/m1'), newDoc('members', GYM_A)))
    await setStatus(GYM_A, 'ACTIVE')
    await assertSucceeds(setDoc(doc(db('ownerA'), 'members/m2'), newDoc('members', GYM_A)))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('Pagos y dinero', () => {
  it('el cliente NO puede crear un pago marcado como Stripe', async () => {
    // Un pago con tarjeta solo lo confirma el webhook del servidor: si el
    // navegador pudiera, cualquiera se daría por pagado.
    await assertFails(
      setDoc(doc(db('receptionA'), 'payments/fake'), newDoc('payments', GYM_A, { method: 'stripe' })),
    )
  })

  it('un pago con importe negativo se rechaza', async () => {
    await assertFails(
      setDoc(doc(db('receptionA'), 'payments/neg'), newDoc('payments', GYM_A, { amount: -500 })),
    )
  })

  it('una asistencia no se puede editar después de registrada', async () => {
    await setDoc(doc(db('receptionA'), 'attendance/a1'), newDoc('attendance', GYM_A))
    await assertFails(updateDoc(doc(db('ownerA'), 'attendance/a1'), { granted: false }))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('Auditoría', () => {
  it('un manager lee la auditoría de SU gimnasio', async () => {
    await env().withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('auditLogs/a1').set({
        id: 'a1',
        gymId: GYM_A,
        actorId: USERS.ownerA.uid,
        actorName: 'Owner A',
        actorRole: 'OWNER',
        action: 'MEMBER_CREATED',
        entityType: 'members',
        entityId: 'mem_a1',
        summary: 'Alta',
        createdAt: Date.now(),
      })
    })
    await assertSucceeds(getDoc(doc(db('ownerA'), 'auditLogs/a1')))
  })

  it('un manager NO lee la auditoría de otro gimnasio', async () => {
    await env().withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('auditLogs/b1').set({
        id: 'b1',
        gymId: GYM_B,
        actorId: USERS.ownerB.uid,
        actorName: 'Owner B',
        actorRole: 'OWNER',
        action: 'MEMBER_CREATED',
        entityType: 'members',
        entityId: 'mem_b1',
        summary: 'Alta',
        createdAt: Date.now(),
      })
    })
    await assertFails(getDoc(doc(db('ownerA'), 'auditLogs/b1')))
  })

  it('la auditoría NO se puede editar ni borrar, ni por el SUPERADMIN', async () => {
    await env().withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('auditLogs/a1').set({
        id: 'a1',
        gymId: GYM_A,
        actorId: 'x',
        actorName: 'x',
        actorRole: 'OWNER',
        action: 'MEMBER_CREATED',
        entityType: 'members',
        entityId: 'm',
        summary: 'Alta',
        createdAt: Date.now(),
      })
    })
    await assertFails(updateDoc(doc(db('superadmin'), 'auditLogs/a1'), { summary: 'Editado' }))
    await assertFails(updateDoc(doc(db('ownerA'), 'auditLogs/a1'), { summary: 'Borrado' }))
  })

  it('un recepcionista NO lee la auditoría', async () => {
    await env().withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('auditLogs/a1').set({
        id: 'a1',
        gymId: GYM_A,
        actorId: 'x',
        actorName: 'x',
        actorRole: 'OWNER',
        action: 'MEMBER_CREATED',
        entityType: 'members',
        entityId: 'm',
        summary: 'Alta',
        createdAt: Date.now(),
      })
    })
    await assertFails(getDoc(doc(db('receptionA'), 'auditLogs/a1')))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('Agregados', () => {
  it('un gimnasio NO puede tocar los contadores de otro', async () => {
    await assertFails(updateDoc(doc(db('ownerA'), `counters/${GYM_B}`), { 'members.total': 0 }))
  })

  it('un socio NO puede tocar los contadores de su gimnasio', async () => {
    await assertFails(updateDoc(doc(db('memberA'), `counters/${GYM_A}`), { 'members.total': 9999 }))
  })

  it('los resúmenes diarios de otro gimnasio no se leen', async () => {
    await env().withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .doc(`dailyStats/${GYM_B}_2026-01-01`)
        .set({ id: `${GYM_B}_2026-01-01`, gymId: GYM_B, date: '2026-01-01', revenueTotal: 1000 })
    })
    await assertFails(getDoc(doc(db('ownerA'), `dailyStats/${GYM_B}_2026-01-01`)))
  })
})
