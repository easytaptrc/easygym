// ═══════════════════════════════════════════════════════════════════════════
// Traducción de errores a lenguaje humano.
//
// A nadie que atiende un mostrador le sirve leer:
//
//   FirebaseError: Missing or insufficient permissions.
//
// Eso le dice al programador qué pasó y al usuario, nada. Peor: expone la
// forma interna del sistema a quien no debería conocerla.
//
// Aquí se convierte cada error conocido en una frase que explica qué ocurrió y
// qué hacer. El detalle técnico se manda a la consola —y en producción, al
// servicio de errores— pero nunca a la pantalla.
// ═══════════════════════════════════════════════════════════════════════════

export interface FriendlyError {
  /** Lo que ve el usuario. */
  message: string
  /** Sugerencia de qué hacer, si la hay. */
  hint?: string
  /** Para la consola y el servicio de errores. Nunca se pinta. */
  technical: string
  /** Permite decidir si merece reportarse. */
  kind: 'permission' | 'not-found' | 'network' | 'conflict' | 'validation' | 'payment' | 'unknown'
}

const FIREBASE_MESSAGES: Record<string, { message: string; hint?: string; kind: FriendlyError['kind'] }> = {
  'permission-denied': {
    message: 'No tienes permisos para realizar esta acción.',
    hint: 'Si crees que deberías tenerlos, pide a un administrador que revise tu rol.',
    kind: 'permission',
  },
  unauthenticated: {
    message: 'Tu sesión expiró.',
    hint: 'Vuelve a iniciar sesión para continuar.',
    kind: 'permission',
  },
  'not-found': { message: 'No encontramos ese registro.', kind: 'not-found' },
  'already-exists': { message: 'Ese registro ya existe.', kind: 'conflict' },
  'failed-precondition': {
    message: 'No se pudo completar la operación con el estado actual de los datos.',
    hint: 'Recarga la página e inténtalo de nuevo.',
    kind: 'conflict',
  },
  aborted: {
    message: 'Otra persona modificó esto al mismo tiempo.',
    hint: 'Vuelve a intentarlo.',
    kind: 'conflict',
  },
  unavailable: {
    message: 'No hay conexión con el servidor.',
    hint: 'Revisa tu internet e inténtalo de nuevo.',
    kind: 'network',
  },
  'deadline-exceeded': {
    message: 'La operación tardó demasiado.',
    hint: 'Revisa tu conexión e inténtalo de nuevo.',
    kind: 'network',
  },
  'resource-exhausted': {
    message: 'Demasiadas peticiones seguidas.',
    hint: 'Espera unos segundos antes de volver a intentarlo.',
    kind: 'conflict',
  },
  'invalid-argument': { message: 'Algunos datos no son válidos.', kind: 'validation' },
  // Authentication
  'auth/invalid-email': { message: 'Ese correo no es válido.', kind: 'validation' },
  'auth/user-not-found': { message: 'Correo o contraseña incorrectos.', kind: 'permission' },
  'auth/wrong-password': { message: 'Correo o contraseña incorrectos.', kind: 'permission' },
  'auth/invalid-credential': { message: 'Correo o contraseña incorrectos.', kind: 'permission' },
  'auth/email-already-in-use': {
    message: 'Ese correo ya tiene una cuenta.',
    hint: 'Inicia sesión o usa otro correo.',
    kind: 'conflict',
  },
  'auth/weak-password': { message: 'La contraseña es demasiado corta.', kind: 'validation' },
  'auth/too-many-requests': {
    message: 'Demasiados intentos fallidos.',
    hint: 'Espera unos minutos antes de volver a intentarlo.',
    kind: 'permission',
  },
  'auth/network-request-failed': {
    message: 'No hay conexión con el servidor.',
    kind: 'network',
  },
  'auth/requires-recent-login': {
    message: 'Por seguridad, vuelve a iniciar sesión antes de hacer este cambio.',
    kind: 'permission',
  },
}

/** Códigos que ya vienen con un mensaje escrito por nosotros: se respeta. */
const APP_ERROR_CODES = new Set([
  'gym-suspended',
  'class-full',
  'bike-taken',
  'already-reserved',
  'too-many',
  'closed',
  'not-allowed',
  'cancel-window',
  'past',
  'invalid-credentials',
  'email-in-use',
  'inactive',
  'card_declined',
  'invalid_number',
  'expired_card',
  'processing_error',
])

function codeOf(err: unknown): string | null {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const c = (err as { code?: unknown }).code
    if (typeof c === 'string') return c
  }
  return null
}

/**
 * Convierte cualquier error en algo que se puede enseñar.
 *
 * Los errores que lanza el propio dominio (`ReservationError`, `AuthError`,
 * `GymSuspendedError`…) ya traen un mensaje pensado para el usuario y se
 * dejan pasar tal cual. Los de Firebase se traducen. El resto cae en un
 * mensaje genérico, porque un error inesperado no debería contarle al usuario
 * más de lo necesario.
 */
export function toFriendlyError(err: unknown): FriendlyError {
  const technical = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  const code = codeOf(err)

  // Errores propios: su mensaje ya está escrito para una persona.
  if (code && APP_ERROR_CODES.has(code) && err instanceof Error) {
    return { message: err.message, technical, kind: 'validation' }
  }

  if (code) {
    // Firestore devuelve 'permission-denied'; Auth devuelve 'auth/...'.
    const known = FIREBASE_MESSAGES[code] ?? FIREBASE_MESSAGES[code.replace(/^[a-z]+\//, '')]
    if (known) {
      return {
        message: known.message,
        ...(known.hint ? { hint: known.hint } : {}),
        technical,
        kind: known.kind,
      }
    }
  }

  // Mensajes de Firebase que llegan sin `code` utilizable.
  if (technical.includes('Missing or insufficient permissions')) {
    const known = FIREBASE_MESSAGES['permission-denied']
    return { message: known.message, ...(known.hint ? { hint: known.hint } : {}), technical, kind: 'permission' }
  }

  // Errores del dominio sin código: el mensaje suele estar ya redactado en
  // español, así que se aprovecha en lugar de esconderlo tras un genérico.
  if (err instanceof Error && err.message && !/[{}[\]]|Error:/.test(err.message)) {
    return { message: err.message, technical, kind: 'unknown' }
  }

  return {
    message: 'Algo salió mal. Inténtalo de nuevo.',
    hint: 'Si vuelve a pasar, avísanos con la hora exacta en la que ocurrió.',
    technical,
    kind: 'unknown',
  }
}

/**
 * Registra el detalle técnico donde corresponde.
 *
 * ▸ PRODUCCIÓN: aquí va la llamada a Sentry / Cloud Logging. Se deja como un
 *   único punto para no tener `console.error` repartido por veinte archivos.
 */
export function reportError(context: string, err: unknown, extra?: Record<string, unknown>): FriendlyError {
  const friendly = toFriendlyError(err)
  console.error(`[EasyGym] ${context}:`, friendly.technical, extra ?? '')
  return friendly
}
