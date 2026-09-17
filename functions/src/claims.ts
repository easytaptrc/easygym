import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { auth } from './lib/admin'

// ═══════════════════════════════════════════════════════════════════════════
// Custom claims: rol y tenant firmados en el token.
//
// POR QUÉ IMPORTA
//
// Las reglas de Firestore necesitan saber a qué gimnasio pertenece quien
// escribe. Tienen dos formas:
//
//   a) `get(/users/$(uid))`  → una LECTURA EXTRA por cada documento evaluado
//   b) `request.auth.token.gymId` → gratis, viene firmado en el token
//
// Con (a), listar 500 socios son 500 lecturas adicionales solo para
// autorizar. Con (b), cero.
//
// `firestore.rules` prefiere el claim y cae al documento solo mientras el
// claim no exista (el token tarda hasta una hora en refrescarse, o hasta el
// siguiente `getIdToken(true)`).
//
// El usuario NUNCA puede alterar su claim: solo se escribe desde aquí.
// ═══════════════════════════════════════════════════════════════════════════

export const syncCustomClaims = onDocumentWritten('users/{uid}', async (event) => {
  const after = event.data?.after.data()
  const uid = event.params.uid

  if (!after) {
    // El perfil se borró: se revocan los permisos del token.
    await auth.setCustomUserClaims(uid, {}).catch(() => undefined)
    return
  }

  const before = event.data?.before.data()
  if (before && before.role === after.role && before.gymId === after.gymId && before.active === after.active) {
    return
  }

  await auth.setCustomUserClaims(uid, {
    role: after.active === false ? 'NONE' : after.role,
    gymId: after.gymId ?? '',
    memberId: after.memberId ?? null,
  })

  // Fuerza a que los tokens vigentes se renueven en la próxima petición.
  await auth.revokeRefreshTokens(uid).catch(() => undefined)
})
