// ═══════════════════════════════════════════════════════════════════════════
// EasyGym — Cloud Functions
//
// Qué vive aquí y por qué NO puede vivir en el navegador:
//
//   provisionTenant   crear un gimnasio con plan Business no puede ser algo
//                     que se dispare desde la consola del navegador
//   stripeSaas        la clave secreta de Stripe y la verificación de firma
//   stripeGym         lo mismo, para los cobros de socio → gimnasio
//   aggregates        contadores atómicos que no dependen del cliente
//   claims            rol y gymId firmados: la base del multi-tenant
//   publicGym         el espejo público, para poder cerrarlo a escritura
//   expirationSweep   recalcular vigencias cada madrugada
//   planFeatures      propagar los permisos del plan a cada gimnasio: escribir
//                     `entitlements` es darse permisos, y eso no se hace desde
//                     una pestaña del navegador
//   audit             la bitácora, con el actor sacado del documento y no de
//                     lo que el cliente declare
//   rateLimit         el contador de peticiones, que tiene que vivir donde el
//                     limitado no pueda tocarlo
//
// Desplegar:  cd functions && npm run deploy
// Secretos:   firebase functions:secrets:set STRIPE_SECRET_KEY
//             firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
//             firebase functions:secrets:set STRIPE_CONNECT_WEBHOOK_SECRET
//             firebase functions:secrets:set STRIPE_PRICE_STARTER
//             firebase functions:secrets:set STRIPE_PRICE_PRO
//             firebase functions:secrets:set STRIPE_PRICE_BUSINESS
// ═══════════════════════════════════════════════════════════════════════════

// Stripe A · el DUEÑO le paga a EasyGym
export { createSaasCheckout, saasWebhook } from './stripeSaas'

// Stripe B · el SOCIO le paga a SU gimnasio (Connect)
export { createConnectAccountLink, createMemberPaymentIntent, connectWebhook } from './stripeGym'

// Identidad y multi-tenant
export { syncCustomClaims } from './claims'

// Agregados (contadores y resúmenes diarios)
export {
  onPaymentCreated,
  onVisitCreated,
  onAttendanceCreated,
  onMembershipCreated,
  onReservationCreated,
  onMemberWritten,
  onMembershipExpiryChanged,
} from './aggregates'

// Espejo público de cada gimnasio
export { onGymWritten, onMembershipPlanWritten } from './publicGym'

// Planes y permisos: plans/{id} → gyms/{id}.entitlements → firestore.rules
export {
  onPlanWritten,
  onGymPlanChanged,
  resyncEntitlements,
  onMemberCreatedCheckLimit,
} from './planFeatures'

// Bitácora escrita por el servidor
export {
  auditPaymentCreated,
  auditPaymentUpdated,
  auditVisitCreated,
  auditMemberCreated,
  auditMemberUpdated,
  auditMemberDeleted,
  auditRoleChanged,
  auditGymStatusChanged,
  purgeOldAuditLogs,
} from './audit'

// Tareas programadas
export { dailyExpirationSweep } from './expirationSweep'
