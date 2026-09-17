# EasyGym · Cloud Functions

El backend que el prototipo todavía no tiene desplegado, escrito y listo para
`firebase deploy`.

> **Estado:** código completo, **sin desplegar**. Mientras no se despliegue, la
> aplicación funciona en modo demostración con los servicios mock del frontend.

---

## Por qué existe cada función

| Función | Qué protege |
|---|---|
| `provisionTenant` | Crear un gimnasio con plan Business no puede dispararse desde la consola del navegador. |
| `createSaasCheckout` · `saasWebhook` | La clave secreta de Stripe y la verificación de firma. El navegador nunca confirma un pago. |
| `createConnectAccountLink` · `createMemberPaymentIntent` · `connectWebhook` | Los cobros del socio a **su** gimnasio, por Stripe Connect. El importe lo decide el servidor leyendo el plan, nunca el cliente. |
| `syncCustomClaims` | Pone `role` y `gymId` firmados en el token. Sin esto, cada regla de Firestore paga una lectura extra por documento evaluado. |
| `aggregates.*` | Contadores con `FieldValue.increment()`. Permite cerrar `counters` y `dailyStats` a escritura. |
| `onGymWritten` · `onMembershipPlanWritten` | Mantienen `publicGyms`, la única colección legible sin sesión. |
| `dailyExpirationSweep` | Recalcula vigencias cada madrugada y encola los avisos de vencimiento. |

---

## Los dos Stripe, separados

```
Stripe A · SaaS                          Stripe B · Connect
─────────────────                        ──────────────────
DUEÑO ──paga──► EasyGym                  SOCIO ──paga──► SU GIMNASIO

stripeSaas.ts                            stripeGym.ts
cuenta de EasyGym                        cuenta del gimnasio
STRIPE_WEBHOOK_SECRET                    STRIPE_CONNECT_WEBHOOK_SECRET
subscriptions/                           payments/ · memberships/
```

EasyGym **nunca toca el dinero de los socios**: cada gimnasio conecta su propia
cuenta y los cobros van directos ahí. No es un detalle técnico — es lo que
evita ser intermediario financiero y responder por dinero de terceros.

---

## Puesta en marcha

```bash
cd functions
npm install
npm run build
```

### Secretos

Ninguna clave se escribe en el código ni lleva prefijo `VITE_`:

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:secrets:set STRIPE_CONNECT_WEBHOOK_SECRET
firebase functions:secrets:set STRIPE_PRICE_STARTER
firebase functions:secrets:set STRIPE_PRICE_PRO
firebase functions:secrets:set STRIPE_PRICE_BUSINESS
```

### Local

```bash
npm run serve            # emuladores: functions + firestore + auth
stripe listen --forward-to localhost:5001/<proyecto>/us-central1/saasWebhook
```

### Desplegar

```bash
npm run deploy
```

Después, en la raíz del proyecto, apunta el frontend al backend:

```env
VITE_FUNCTIONS_URL=https://us-central1-<proyecto>.cloudfunctions.net
```

Con esa variable definida, `registerGym()` deja de provisionar en el cliente y
delega en la Cloud Function.

---

## Endurecer las reglas al desplegar

`firestore.rules` tiene marcadas con `▸ PRODUCCIÓN:` las líneas que hay que
cerrar en cuanto estas funciones estén activas:

| Colección | Cambiar a |
|---|---|
| `gyms` → `create` | `if false` |
| `publicGyms` → `write` | `if false` |
| `counters` → `write` | `if false` |
| `dailyStats` → `create, update` | `if false` |
| `activity` → `create` | `if false` |

Mientras el cliente las escriba, un empleado podría falsear sus propios
contadores. El daño está acotado a su gimnasio, pero es deuda que se paga aquí.
