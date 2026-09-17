import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { db } from './lib/admin'

// ═══════════════════════════════════════════════════════════════════════════
// Limitación de peticiones.
//
// QUÉ PROBLEMA RESUELVE Y CUÁL NO
//
// Resuelve el abuso de las operaciones CARAS o SENSIBLES que pasan por el
// servidor: crear gimnasios, iniciar cobros, resincronizar la plataforma
// entera. Sin tope, una sola cuenta puede disparar mil veces la función que
// crea un tenant y llenar la base de basura, o provocar una factura de Stripe
// a base de intentos.
//
// NO resuelve el acceso directo a Firestore desde el SDK del navegador: ahí no
// hay función que interceptar. Para eso están, en este orden:
//
//   · las reglas de seguridad     (deciden QUÉ se puede escribir)
//   · App Check                   (decide DESDE DÓNDE)
//   · las cuotas del proyecto     (el techo de gasto, el último freno)
//
// Escribir esto en el navegador no serviría de nada: el contador viviría en la
// máquina de quien se quiere limitar.
//
// CÓMO FUNCIONA
//
// Ventana fija por (identidad, acción). Es menos preciso que una ventana
// deslizante —permite una ráfaga a caballo entre dos ventanas— pero cuesta una
// sola escritura atómica en vez de mantener una lista de marcas de tiempo. El
// objetivo aquí es frenar el abuso, no medir el tráfico con exactitud.
//
// COLECCIÓN
//
//   rateLimits/{clave}  →  { count, windowStart, action, subject }
//
// Es interna: `firestore.rules` la cierra por completo al cliente.
//
// ▸ PRODUCCIÓN: con volumen alto conviene mover esto a Redis (Memorystore) o a
//   Cloud Armor. Firestore aguanta ~1 escritura por segundo y documento, lo
//   que basta para límites por usuario y se queda corto para límites globales.
// ═══════════════════════════════════════════════════════════════════════════

export interface RateLimitRule {
  /** Cuántas veces se permite dentro de la ventana. */
  max: number
  /** Duración de la ventana, en segundos. */
  windowSec: number
}

/**
 * Límites por acción.
 *
 * Los números salen de lo que hace una persona trabajando, con margen:
 * un dueño no crea diez gimnasios en una hora, y una recepción no inicia
 * treinta cobros con tarjeta en un minuto.
 */
export const RATE_LIMITS: Record<string, RateLimitRule> = {
  // Crear un gimnasio: caro, irreversible y objetivo evidente de abuso.
  provisionTenant: { max: 3, windowSec: 3600 },
  // Checkout de la suscripción: cada intento toca la API de Stripe.
  createSaasCheckout: { max: 10, windowSec: 600 },
  // Cobro de un socio a su gimnasio: legítimo en ráfagas en hora pico.
  createMemberPaymentIntent: { max: 60, windowSec: 60 },
  // Enlace de la cuenta de Stripe Connect.
  createConnectAccountLink: { max: 5, windowSec: 600 },
  // Resincronizar la plataforma: solo SuperAdmin y es una operación pesada.
  resyncEntitlements: { max: 5, windowSec: 3600 },
  // Alta de socio desde el servidor.
  createMember: { max: 120, windowSec: 60 },
}

/** Ventana actual de una acción, para que la clave cambie sola al expirar. */
function windowKey(action: string, subject: string, windowSec: number): string {
  const bucket = Math.floor(Date.now() / (windowSec * 1000))
  // El sujeto puede traer caracteres que Firestore no admite en un id.
  const safe = subject.replace(/[^\w.-]/g, '_').slice(0, 120)
  return `${action}__${safe}__${bucket}`
}

/**
 * Consume una unidad del cupo. Lanza `resource-exhausted` si ya no queda.
 *
 * La cuenta se lleva en una TRANSACCIÓN: sin ella, veinte peticiones
 * simultáneas leerían todas el mismo valor y pasarían todas.
 */
export async function consume(action: string, subject: string): Promise<void> {
  const rule = RATE_LIMITS[action]
  if (!rule) return // Acción sin límite declarado: no se inventa uno.

  const ref = db.collection('rateLimits').doc(windowKey(action, subject, rule.windowSec))

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const count = (snap.data()?.count as number | undefined) ?? 0

      if (count >= rule.max) {
        throw new HttpsError(
          'resource-exhausted',
          'Has hecho esta operación demasiadas veces seguidas. Espera un momento e inténtalo de nuevo.',
        )
      }

      tx.set(
        ref,
        {
          action,
          subject,
          count: FieldValue.increment(1),
          // TTL de Firestore sobre este campo: la colección se limpia sola.
          expiresAt: new Date(Date.now() + rule.windowSec * 2000),
        },
        { merge: true },
      )
    })
  } catch (err) {
    if (err instanceof HttpsError) throw err
    // Un fallo del limitador NO puede tumbar la operación: se deja pasar y se
    // registra. Preferimos un límite que a veces no se aplica a un producto
    // que deja de funcionar porque su contador falló.
    logger.error(`[EasyGym] El limitador falló para ${action}:`, err)
  }
}

/**
 * Envoltorio para funciones invocables.
 *
 * ```ts
 * export const createSaasCheckout = onCall(
 *   rateLimited('createSaasCheckout', async (request) => { … }),
 * )
 * ```
 *
 * Limita por uid cuando hay sesión y por IP cuando no. La IP es un sujeto
 * pobre —una oficina entera comparte una— pero es lo único que hay antes de
 * autenticarse, y por eso las acciones anónimas llevan topes más generosos.
 */
export function rateLimited<T, R>(
  action: string,
  handler: (request: CallableRequest<T>) => Promise<R>,
): (request: CallableRequest<T>) => Promise<R> {
  return async (request) => {
    const subject = request.auth?.uid ?? `ip:${request.rawRequest.ip ?? 'desconocida'}`
    await consume(action, subject)
    return handler(request)
  }
}

/**
 * Limita por IP aunque haya sesión.
 *
 * Para lo que no debería multiplicarse abriendo cuentas nuevas, como el alta
 * de gimnasios.
 */
export function rateLimitedByIp<T, R>(
  action: string,
  handler: (request: CallableRequest<T>) => Promise<R>,
): (request: CallableRequest<T>) => Promise<R> {
  return async (request) => {
    await consume(action, `ip:${request.rawRequest.ip ?? 'desconocida'}`)
    if (request.auth?.uid) await consume(action, request.auth.uid)
    return handler(request)
  }
}

// ──────────────── Endpoints HTTP (onRequest) ────────────────────────────────

/**
 * Versión para `onRequest`, que no tiene `CallableRequest`.
 *
 * Devuelve `false` y responde 429 cuando el cupo está agotado, para que el
 * endpoint solo tenga que hacer `if (!(await guardRequest(...))) return`.
 *
 * Los webhooks de Stripe NO pasan por aquí: los llama Stripe, no un usuario,
 * y limitarlos significaría descartar eventos de pago. Su protección es la
 * verificación de firma.
 */
export async function guardRequest(
  action: string,
  req: { ip?: string; headers: Record<string, unknown> },
  res: { status: (code: number) => { json: (body: unknown) => void } },
  subjectOverride?: string,
): Promise<boolean> {
  try {
    await consume(action, subjectOverride ?? `ip:${req.ip ?? 'desconocida'}`)
    return true
  } catch (err) {
    if (err instanceof HttpsError && err.code === 'resource-exhausted') {
      res.status(429).json({
        error: 'Has hecho esta operación demasiadas veces seguidas. Espera un momento e inténtalo de nuevo.',
      })
      return false
    }
    throw err
  }
}
