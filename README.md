<div align="center">

# EasyGym

**Más que software, tu aliado en el crecimiento**

Plataforma SaaS multi-tenant para administrar gimnasios: socios, membresías,
cobros, control de acceso, visitas, clases, reservaciones y mapa de bicicletas.

<sub>EasyGym es un producto de **EasyTap**</sub>

</div>

---

## Qué es esto

Un **prototipo funcional y navegable** de EasyGym. No son pantallas estáticas:
los datos se crean, se leen y se actualizan de verdad, con tiempo real,
transacciones atómicas, agregados incrementales y aislamiento entre gimnasios.

Arranca sin credenciales: por defecto usa un driver de datos en `localStorage`
con tres gimnasios de ejemplo ya cargados. Cambiando **una variable de entorno**
pasa a Firestore + Firebase Authentication reales, sin tocar una sola pantalla.

```bash
npm install
npm run dev          # http://localhost:5173
```

Entra en `/login` y toca cualquier usuario del panel «Acceso rápido a la demo».

> **Marca.** El producto se llama **EasyGym**. **EasyTap** es la marca matriz —
> la empresa que lo desarrolla — y solo aparece en el pie de la landing y en los
> textos legales. Ambos nombres viven en [`src/config/brand.ts`](src/config/brand.ts).

### Lo que conviene saber antes de leer el resto

- **El SUPERADMIN decide qué incluye cada plan desde una pantalla**, no desde el
  código, y el cambio llega hasta las reglas de seguridad → [Planes](#planes-y-control-de-funcionalidades)
- **Esconder botones no es seguridad**, y este producto no finge lo contrario →
  [Seguridad](#seguridad)
- **Nada que crezca se lee entero**: ni socios, ni pagos, ni reservaciones →
  [Escalabilidad](#escalabilidad)
- **Las reglas se comprueban contra el emulador real**, no se dan por buenas:
  154 pruebas, y la primera vez destaparon un agujero de privacidad →
  [Tests](#tests)
- **El navegador no habla con el hardware**, y el módulo de personal no finge lo
  contrario → [Biometría](#biometría-y-hardware)
- **Perder Internet no detiene el gimnasio**, y reconectar no duplica nada →
  [Modo sin conexión](#modo-sin-conexión-y-sincronización)

> **Para probar el módulo de Personal**, actívalo primero en
> `/superadmin/funcionalidades`: Empleados, Asistencia del personal, Biometría y
> Solicitudes de insumos. Vienen apagadas en todos los planes a propósito, para
> que el SuperAdmin decida qué paquete las incluye.

---

## Índice

1. [El modelo multi-tenant](#el-modelo-multi-tenant)
2. [Arquitectura](#arquitectura)
3. [Escalabilidad](#escalabilidad)
4. [Instalación](#instalación)
5. [Usuarios demo](#usuarios-demo)
6. [Rutas](#rutas)
7. [Planes y control de funcionalidades](#planes-y-control-de-funcionalidades)
8. [Los dos sistemas de pago](#los-dos-sistemas-de-pago)
9. [Visitas ≠ membresías](#visitas--membresías)
10. [Reservaciones y mapa de bicicletas](#reservaciones-y-mapa-de-bicicletas)
11. [Cloud Functions](#cloud-functions)
12. [Conectar Firebase real](#conectar-firebase-real)
13. [Conectar Stripe real](#conectar-stripe-real)
14. [Conectar el lector de huella real](#conectar-el-lector-de-huella-real)
15. [Búsqueda](#búsqueda)
16. [Impresión](#impresión)
17. [PWA](#pwa)
18. [Qué es MOCK y qué es real](#qué-es-mock-y-qué-es-real)
19. [Empleados y asistencia laboral](#empleados-y-asistencia-laboral)
20. [Biometría y hardware](#biometría-y-hardware)
21. [Modo sin conexión y sincronización](#modo-sin-conexión-y-sincronización)
22. [Solicitudes de insumos](#solicitudes-de-insumos)
23. [Seguridad](#seguridad)
24. [Auditoría](#auditoría)
25. [SuperAdmin](#superadmin)
26. [Tests](#tests)
27. [Estructura del código](#estructura-del-código)
28. [PRODUCTION CHECKLIST](#production-checklist)

---

## El modelo multi-tenant

**No se crean gimnasios a mano.** No existe `Gym1`, `Admin2` ni nada parecido.
Un dueño entra a easygym.com, elige plan, paga, y todo se provisiona solo:

```
/  →  /planes  →  /registro  →  /checkout  →  pago aprobado
                                                   │
                                                   ▼
                          gymId · gimnasio · usuario OWNER · configuración
                          suscripción · membresías base · espejo público
                          contadores · onboarding
                                                   │
                                                   ▼
                                              /dashboard
```

Todo eso lo hace [`provisionTenant()`](src/services/provisioning.ts).

### Cómo se garantiza el aislamiento

Cada entidad de un gimnasio lleva `gymId`. El aislamiento se aplica en **dos
capas independientes**:

| Capa | Dónde | Qué hace |
|------|-------|----------|
| Cliente | [`TenantRepo`](src/services/db.ts) | Inyecta `where('gymId','==',miGym)` en **toda** consulta. No existe forma de escribir «dame todos los socios» sin gimnasio: la API no lo permite. |
| Servidor | [`firestore.rules`](firestore.rules) | Compara el `gymId` de cada documento contra el del usuario autenticado, tomado de **custom claims**, no de lo que mande el navegador. |

La primera capa previene el error honesto. La segunda previene el ataque.

El **SUPERADMIN** es la única excepción, y el único módulo que consulta sin
filtrar es [`usePlatformData`](src/pages/superadmin/usePlatformData.ts), detrás
de `RequireRole roles={['SUPERADMIN']}` y de `allow list: if isSuperadmin()`.

### Colecciones cubiertas

Todas llevan `gymId` y todas tienen su regla en `firestore.rules`:

`members` · `membershipPlans` · `memberships` · `payments` · `visits` ·
`attendance` · `classes` · `bikes` · `reservations` · `products` · `sales` ·
`inventory` · `branches` · `notifications` · `settings` · `counters` ·
`dailyStats`

Los usuarios (`users`) viven en la colección de plataforma pero llevan `gymId`
y solo los lista un manager de ese gimnasio o el superadmin.

### Lectura pública

Solo hay **una** colección legible sin sesión: `publicGyms`, un espejo con el
nombre, la dirección, el teléfono, el color y la lista de precios. El documento
real de `gyms` —que lleva el correo del dueño, su `ownerId`, el estado de su
suscripción y sus contadores— exige sesión.

### URLs

No hay un dominio ni un build por gimnasio. Una sola aplicación resuelve el
gimnasio en runtime:

```
easygym.com/g/iron-fitness        ← funciona hoy
iron-fitness.easygym.com          ← preparado (mismo bundle, subdominio wildcard)
```

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│  React 18 · TypeScript · Vite 6 · Tailwind 3 · PWA          │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │   TenantRepo (gymId)    │   ← el filtro es innegociable
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │   Driver  (interfaz)    │
              └──────┬───────────┬──────┘
                     │           │
         ┌───────────▼──┐   ┌────▼──────────────┐
         │  mockDriver  │   │  firestoreDriver  │
         │ localStorage │   │    Firestore      │
         └──────────────┘   └───────────────────┘
                                     │
                          ┌──────────▼──────────┐
                          │   Cloud Functions   │  functions/
                          │  provisión · Stripe │
                          │  agregados · claims │
                          └─────────────────────┘
```

Ambos drivers implementan lo mismo: queries con `where`/`orderBy`/`limit`,
**paginación por cursor**, listeners en tiempo real y **transacciones
atómicas**. El resto de la aplicación nunca habla con Firestore directamente.

### Stack

- **React 18 + TypeScript** en modo estricto (`strict`, `noUnusedLocals`)
- **Vite 6** con carga diferida por ruta y Firebase SDK cargado bajo demanda
- **Tailwind 3** con el color de cada gimnasio inyectado como variable CSS
- **Firestore** como base central — **no** se usa Realtime Database
- **Firebase Authentication** + custom claims para identidad y tenant
- **Stripe** para los dos flujos de cobro, separados
- **vite-plugin-pwa** — una sola app instalable para todos los gimnasios
- **Cero dependencias de gráficas**: las visualizaciones son SVG propio

---

## Escalabilidad

El objetivo declarado: que funcione igual con **100 socios que con 100 000**, y
con **10 000 gimnasios** en la plataforma. Tres decisiones lo sostienen.

### 1 · Contadores, no conteos

Un panel que dice «1 284 socios activos» tiene dos formas de saberlo:

| | Coste con 100 000 socios |
|---|---|
| Leer los 100 000 documentos y contarlos | **100 000 lecturas, cada vez que se abre el panel** |
| Leer un documento que ya lo sabe | **1 lectura, siempre** |

EasyGym usa la segunda. [`counters/{gymId}`](src/services/aggregates.ts) mantiene
las cardinalidades y se actualiza con incrementos en cada operación.

### 2 · Resúmenes diarios

`dailyStats/{gymId}_{YYYY-MM-DD}` guarda un documento por gimnasio y día con
ingresos por categoría, por método de pago, visitas, asistencias por hora,
altas, renovaciones y reservaciones.

| Vista | Antes | Ahora |
|---|---|---|
| Panel de un mes | ~todos los pagos del gimnasio | ≤ 31 documentos |
| Reporte anual | ~200 000 pagos | ≤ 366 documentos |
| Panel de plataforma | todos los socios de todos los gimnasios | 1 documento por gimnasio |

Los agregados son **best-effort**: si un incremento falla, el cobro ya quedó
registrado igual. Nunca se bloquea una venta porque un contador no se actualizó.
La deriva se corrige con **Configuración → Mantenimiento → Recalcular**, que los
reconstruye desde los documentos originales.

### 3 · Paginación por cursor

[`usePagedCollection`](src/hooks/usePagedCollection.ts) pide páginas de 30 con
`startAfter`. **No usa offset**: saltarse 40 000 documentos cuesta como leerlos.

El cursor lleva el valor del campo de orden **y el id** del último documento; sin
el id, dos socios creados en el mismo milisegundo harían que la página siguiente
repita o se salte uno. Firestore ordena de forma estable añadiendo `__name__`
como último criterio, y el driver mock replica exactamente esa semántica.

Los filtros de estado y de plan viajan al servidor como `where`, no se aplican
sobre una lista ya cargada.

### 4 · Contar sin descargar

`repo.count(collection, query)` resuelve los recuentos en el servidor. En
Firestore es `getCountFromServer`, que se factura a **una lectura por cada mil
documentos contados**; en el driver de demostración es un filtro en memoria.

Es lo que sustituye al patrón de cargar `members` entera para escribir «42
socios tienen esta membresía» debajo de cada tarjeta. Lo usa
[`useCounts`](src/hooks/useCounts.ts) en Membresías y en Clases.

No sustituye a `counters/{gymId}` para los números que se pintan en **cada**
carga del panel: un documento leído gana a cualquier agregación. Es para los
recuentos puntuales que no vale la pena desnormalizar.

### 5 · Buscar en el servidor, nunca en memoria

Ninguna pantalla descarga la colección de socios para filtrarla en el navegador.
[`MemberPicker`](src/components/MemberPicker.tsx) consulta a `searchProvider` con
220 ms de retardo y descarta las respuestas que llegan tarde. Lo usan el punto de
venta, las visitas, las reservaciones y la recepción.

Con 6 000 socios, la versión anterior descargaba megabytes y facturaba 6 000
lecturas **cada vez que alguien abría el modal**.

### Pantallas con tope duro

Toda consulta de una colección que crece lleva filtro o `limit`:

| Pantalla | Acotación |
|---|---|
| `/pagos`, `/asistencias`, `/reportes` | rango de fechas + `limit: 1500` |
| `/visitas` | rango de fechas sobre `date` + `limit: 500` |
| `/reservaciones`, `/spinning` | `date == ` el día que se está viendo |
| `/recepcion` | asistencias de **hoy**, `limit: 40` |
| `/portal/reservaciones` | el día visible + **mis** reservaciones futuras |
| `/inventario` | los 12 últimos movimientos |
| `/socios` | páginas de 30 con cursor |
| SuperAdmin | gimnasios y suscripciones 500; usuarios, solo personal |

Las cifras de esas pantallas salen de los agregados, así que **siguen siendo
exactas aunque la tabla esté truncada**.

La única consulta que lee colecciones enteras es `rebuildAggregates`, y es
deliberada: es la reconstrucción manual, está en Mantenimiento, avisa de que es
cara y en producción vive en una Cloud Function invocable.

---

## Instalación

```bash
git clone <repo> && cd easygym
npm install
cp .env.example .env.local
npm run dev
```

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo en `:5173` |
| `npm run build` | Comprobación de tipos + build de producción |
| `npm run typecheck` | Solo TypeScript |
| `npm run preview` | Sirve el build |
| `node scripts/generate-icons.mjs` | Regenera los iconos PWA |

### Variables de entorno

Ver [`.env.example`](.env.example). Lo esencial:

```env
VITE_DATA_DRIVER=mock          # mock | firebase
VITE_FIREBASE_API_KEY=...      # solo si usas firebase
VITE_STRIPE_PUBLISHABLE_KEY=...
VITE_FUNCTIONS_URL=            # vacío = provisión local (demo)
```

> ⚠️ **`STRIPE_SECRET_KEY` nunca lleva el prefijo `VITE_` ni vive en este
> proyecto.** Va en Cloud Functions
> (`firebase functions:secrets:set STRIPE_SECRET_KEY`). Todo lo que empieza por
> `VITE_` se compila dentro del JavaScript que descarga cualquier visitante.
>
> Los valores `VITE_FIREBASE_*` **sí** son públicos por diseño: identifican el
> proyecto. Lo que protege los datos son `firestore.rules` y las restricciones
> de la API key en Google Cloud Console.

---

## Usuarios demo

Todos con la contraseña **`easygym123`**. En `/login` hay un botón por cada uno.

| Gimnasio | Plan | Usuario | Correo |
|---|---|---|---|
| — (plataforma) | — | Super administrador | `super@easygym.com` |
| **Iron Fitness** (Guadalajara) | Pro | Dueño | `owner@ironfitness.mx` |
| Iron Fitness | Pro | Administrador | `admin@iron-fitness.mx` |
| Iron Fitness | Pro | Recepcionista | `recepcion@iron-fitness.mx` |
| Iron Fitness | Pro | Entrenador | `coach@iron-fitness.mx` |
| Iron Fitness | Pro | Socio | `socio@iron-fitness.mx` |
| **Power House Gym** (Mérida) | Starter | Dueño | `owner@powerhouse.mx` |
| Power House Gym | Starter | Socio | `socio@power-house.mx` |
| **Olympia Gym** (Monterrey) | Business | Dueño | `owner@olympiagym.mx` |
| Olympia Gym | Business | Socio | `socio@olympia-gym.mx` |

Los datos son generados con un PRNG de semilla fija: la demo es **idéntica en
cualquier máquina**, así que un fallo siempre se puede reproducir.

### Qué demostrar en 5 minutos

1. **Dueño de Iron Fitness** → panel lleno, 100 socios, clases, spinning, huella.
2. **Dueño de Power House** → entra a *Reservaciones*: aparece
   «Esta función está disponible en **Pro**». Starter no reserva clases.
3. **Compara los listados de socios**: Iron Fitness ve 100, Power House ve 38.
   Ese es el aislamiento por `gymId`.
4. **Recepción** → «Escanear huella» → `ACCESO AUTORIZADO` o `DENEGADO` con foto,
   vigencia y días restantes.
5. **Socio** → portal móvil → reserva una bicicleta en el mapa → renueva con tarjeta.
6. **Super administrador** → los tres gimnasios, su MRR y sus suscripciones.

El botón **«Reiniciar demo»** en `/login` vuelve a generarlo todo.

---

## Rutas

<details open>
<summary><b>Públicas</b></summary>

| Ruta | Qué es |
|---|---|
| `/` | Landing |
| `/planes` | Precios y comparativa completa |
| `/registro` | Alta del gimnasio (3 pasos) |
| `/checkout` | Pago y provisión automática |
| `/login` | Acceso + usuarios demo |
| `/g/:slug` | Página pública del gimnasio (lee `publicGyms`) |

</details>

<details open>
<summary><b>Gimnasio</b> (OWNER · ADMIN · RECEPCIONISTA · ENTRENADOR · MANTENIMIENTO)</summary>

> **MANTENIMIENTO** (Fase 4) es el rol de Adrián: entra desde su teléfono, ve
> las solicitudes de insumos y las marca. No ve socios, ni dinero, ni
> configuración, ni la asistencia de sus compañeros. Queda **fuera** de
> `isStaffOf` en las reglas a propósito: darle acceso de personal sería
> regalarle todo eso de una vez.

| Ruta | Permiso | Plan mínimo |
|---|---|---|
| `/dashboard` | `reports.read` | Starter |
| `/recepcion` | `reception.use` | Starter |
| `/socios` · `/socios/:id` | `members.read` | Starter |
| `/visitas` | `visits.write` | Starter |
| `/asistencias` | `attendance.write` | Starter |
| `/membresias` | `memberships.manage` | Starter |
| `/pagos` | `payments.read` | Starter |
| `/clases` | `classes.manage` | **Pro** |
| `/reservaciones` | `reservations.manage` | **Pro** |
| `/spinning` | `reservations.manage` | **Pro** |
| `/pos` | `pos.use` | **Pro** |
| `/inventario` | `inventory.manage` | **Business** |
| `/reportes` | `reports.read` | Starter |
| `/usuarios` | `staff.manage` | Starter |
| `/actividad` | `settings.manage` | Starter |
| `/configuracion` | `settings.manage` | Starter |
| `/suscripcion` | `gym.manage` | Starter |
| `/empleados` | `employees.read` | **según SuperAdmin** |
| `/empleados/asistencia` | `workAttendance.read` | **según SuperAdmin** |
| `/insumos` | `supplies.request` | **según SuperAdmin** |
| `/configuracion/dispositivos` | `devices.manage` | **según SuperAdmin** |
| `/reportes/personal` | `workAttendance.read` | **según SuperAdmin** |

El **plan mínimo** de esta tabla son los valores por defecto. El SUPERADMIN
puede moverlos desde `/superadmin/funcionalidades` sin tocar código: activar
Reservaciones en Starter hace que `/reservaciones` se abra para esos gimnasios
de inmediato, y que las reglas acepten la escritura.

</details>

<details open>
<summary><b>Portal del socio</b> (MEMBER)</summary>

`/portal` · `/portal/membresia` · `/portal/pagos` · `/portal/asistencias` ·
`/portal/reservaciones` · `/portal/perfil`

</details>

<details open>
<summary><b>SuperAdmin</b></summary>

| Ruta | Qué es |
|---|---|
| `/superadmin` | Resumen de la plataforma |
| `/superadmin/gimnasios` | Alta, plan, suspensión, entrar a uno |
| `/superadmin/planes` | Precio, límites y visibilidad de cada paquete |
| `/superadmin/funcionalidades` | Matriz funcionalidad × plan |
| `/superadmin/suscripciones` | Estado de cobro |
| `/superadmin/usuarios` | Cuentas administrativas |
| `/superadmin/auditoria` | Bitácora de toda la plataforma |
| `/superadmin/configuracion` | Qué está conectado en este entorno |
| `/superadmin/mantenimiento` | Resincronizar, recalcular, detectar desvíos |

`/superadmin/plans` y `/superadmin/features` redirigen a sus equivalentes en
español.

</details>

---

## Planes y control de funcionalidades

| | Starter | Pro | Business |
|---|:---:|:---:|:---:|
| **Precio** | $499 | **$899** | $1,499 |
| Socios | 150 | 1,000 | ∞ |
| Usuarios | 2 | 10 | ∞ |
| Sucursales | 1 | 1 | ∞ |
| Socios, membresías, asistencias, visitas | ✅ | ✅ | ✅ |
| Pagos manuales · Portal del socio | ✅ | ✅ | ✅ |
| Stripe · Renovación automática | — | ✅ | ✅ |
| **Reservación de clases** | — | ✅ | ✅ |
| **Mapa de bicicletas** | — | ✅ | ✅ |
| Control de acceso + huella | — | ✅ | ✅ |
| Reportes avanzados · POS | — | ✅ | ✅ |
| Inventario · WhatsApp · API · Sucursales | — | — | ✅ |

Existe también **Enterprise** (precio a cotizar), ya modelado en
[`config/plans.ts`](src/config/plans.ts).

> ⚠️ **Esa tabla son los valores INICIALES, no la verdad en runtime.**
> Los planes viven en Firestore (`plans/{planId}`) y el SUPERADMIN los edita
> desde `/superadmin/planes` y `/superadmin/funcionalidades`. Lo que hay en
> `config/plans.ts` es solo la semilla con la que se crea el catálogo la
> primera vez.

### Cambiar qué incluye un plan, sin tocar código

Este es el recorrido completo de un cambio:

```
  /superadmin/funcionalidades
  el SUPERADMIN activa «Reservaciones» en Starter
            │
            ▼
  plans/STARTER.features.reservations = true        ← la verdad
            │
            │  onPlanWritten  (functions/src/planFeatures.ts)
            ▼
  gyms/{cada gym Starter}.entitlements.features     ← copia por gimnasio
            │
            ├──► hasFeature() en el navegador       esconde o muestra la interfaz
            ├──► <RequireFeature>                   bloquea la ruta
            └──► firestore.rules  planAllows()      RECHAZA la escritura
```

**Las dos primeras capas son cortesía. La tercera es la que protege.**

Esconder un botón no impide nada: quien escriba la URL a mano, o llame a
Firestore desde la consola del navegador, se salta la interfaz entera. Lo que
de verdad impide que un gimnasio Starter cree reservaciones es esta regla:

```js
function planAllows(gymId, feature) {
  let g = gymDoc(gymId);
  return !('entitlements' in g)
      || !('features' in g.entitlements)
      || g.entitlements.features.get(feature, false) == true;
}
```

Por eso los `entitlements` están **desnormalizados** dentro del gimnasio: así la
regla decide con **una** lectura (`get(/gyms/{gymId})`) en lugar de dos. Con una
tabla de 500 socios eso es la diferencia entre 500 y 1 000 lecturas extra solo
para autorizar.

Esa copia es una caché, y la mantiene el trigger `onPlanWritten`. Si alguna vez
se desincroniza, **Mantenimiento → Resincronizar permisos** la rehace.

### Funcionalidades esenciales

Algunas no se pueden apagar en ningún plan: socios, membresías, asistencia,
cobros manuales y portal del socio. Están marcadas con `core: true` en
[`config/features.ts`](src/config/features.ts) y `setPlanFeature()` lanza un
error si se intenta. Un plan de pago sin «Socios» sería una aplicación vacía que
igualmente se cobra, y ningún panel de administración debería permitir ese error.

### `hasFeature(gym, feature)`

Es el **único** punto de verdad. Ni la interfaz ni los servicios comparan
`planId` a mano:

```ts
hasFeature(gym, 'reservations')   // false en Starter, true en Pro y Business
hasFeature(gym, 'inventory')      // solo Business
```

Devuelve `false` también si la suscripción está `CANCELED` o `SUSPENDED`.
`PAST_DUE` **sí** conserva el acceso: dejar a un negocio sin poder cobrar por un
cargo rechazado hace más daño que esperar unos días.

Tres formas de usarlo:

```tsx
<PlanGuard feature="reservations"> … </PlanGuard>   {/* muestra el aviso de mejora */}
<IfFeature feature="inventory"> … </IfFeature>      {/* oculta sin dejar hueco */}
<RequireFeature feature="spinningMap"> … </RequireFeature>  {/* a nivel de ruta */}
```

Cuando falta el plan, el mensaje es siempre el mismo:
**«Esta función está disponible en Pro»** con un botón **«Actualizar plan»**.

---

## Los dos sistemas de pago

Son **independientes** y no se mezclan nunca.

```
Stripe A · SaaS                          Stripe B · Connect
─────────────────                        ──────────────────
DUEÑO ──paga──► EasyGym                  SOCIO ──paga──► SU GIMNASIO

functions/src/stripeSaas.ts              functions/src/stripeGym.ts
cuenta de EasyGym                        cuenta del gimnasio
STRIPE_WEBHOOK_SECRET                    STRIPE_CONNECT_WEBHOOK_SECRET
subscriptions/                           payments/ · memberships/
pantalla /suscripcion                    pantalla /pagos · /portal
```

### 1 · El dueño le paga a EasyGym

Suscripción SaaS mensual. Vive en `subscriptions` + `gyms.subscriptionStatus`.

```
ACTIVE ──pago falla──► PAST_DUE ──sigue fallando──► SUSPENDED
   ▲                       │                            │
   └──────pago exitoso─────┴────────reactivación────────┘
```

**Política ante impago: se restringe el acceso, nunca se borran los datos.**
Un gimnasio que vuelve a pagar recupera todo tal como lo dejó.

### 2 · El socio le paga a su gimnasio

Membresías, renovaciones, visitas y productos. Vive en `payments`, **con
`gymId`**. Cada pago lleva `category` para que el panel separe las ventas:

`MEMBERSHIP` · `RENEWAL` · `VISIT` · `PRODUCT` · `OTHER`

EasyGym **nunca toca el dinero de los socios**: cada gimnasio conecta su propia
cuenta de Stripe (Connect) y los cobros van directos ahí. No es un detalle
técnico — es lo que evita ser intermediario financiero.

> **El frontend nunca confirma un pago.** Quien marca un pago como `PAID` es el
> webhook corriendo en una Cloud Function, tras verificar la firma de Stripe. Por
> eso `firestore.rules` prohíbe crear pagos con `method == 'stripe'` desde el
> navegador, y el importe lo decide el servidor leyendo el plan.

---

## Visitas ≠ membresías

Esto es deliberado y está reforzado en el modelo, en las reglas y en los reportes:

- Una **visita** es un pase de un día.
- **No** exige que la persona sea socio.
- **No** crea ni modifica ninguna membresía, ni toca `expiresAt` de nadie.
- Un socio puede comprar una visita **para un invitado**: se guarda quién invitó
  (`invitedByMemberId`), pero quien entra es el invitado.
- Aparecen **separadas** en el panel y en todos los reportes (`category: VISIT`
  en ingresos, y `visits` como conteo propio en el resumen diario).
- Si el gimnasio lo configura así, una visita pagada **da acceso ese día** aunque
  la membresía esté vencida.

Precio normal y precio de invitado se configuran en `/configuracion → Visitas`.

---

## Reservaciones y mapa de bicicletas

Dos reglas que se cumplen siempre:

1. Nunca se sobrepasa el cupo de una clase.
2. Nunca dos socios acaban con la misma bicicleta.

Ambas se resuelven **dentro de una transacción** en
[`reserveSlot()`](src/services/reservations.ts): se lee el estado y se escribe la
reservación en la misma operación atómica. Validar en la interfaz y luego
escribir es exactamente como se producen los duplicados.

```
             INSTRUCTOR
      🚲01  🚲02  🚲03  🚲04  🚲05
      🚲06  🚲07  🚲08  🚲09  🚲10
      🚲11  🚲12  🚲13  🚲14  🚲15
      🚲16  🚲17  🚲18  🚲19  🚲20

  VERDE disponible · ROJO reservada · AZUL seleccionada
  GRIS bloqueada/mantenimiento · ANILLO tu reservación
```

El dueño configura filas, columnas, numeración, pasillos, posición del instructor
y qué bicicletas están en mantenimiento, desde `/spinning`. El número de
bicicletas es libre.

**Horarios:** no hay ninguno escrito en el código. Cada clase define sus días y
sus horas desde `/clases`. Los de la demo (spinning lunes a jueves 7, 8, 19 y
20 h; viernes 7 y 8 h; box lunes a viernes de 17 a 21 h) son **datos**, no
constantes.

**Cancelaciones:** el dueño elige la ventana — 30 min, 2 h, 12 h o 24 h antes.
Fuera de plazo el socio ve exactamente:

> No es posible cancelar esta reservación porque se encuentra fuera del periodo permitido.

---

## Cloud Functions

El backend está **escrito y listo para desplegar** en [`functions/`](functions/),
pero **todavía no desplegado**. Mientras tanto, la aplicación funciona en modo
demostración con los servicios mock del frontend.

| Función | Qué protege |
|---|---|
| `provisionTenant` | Crear un gimnasio con plan Business no puede dispararse desde la consola del navegador. |
| `createSaasCheckout` · `saasWebhook` | La clave secreta de Stripe y la verificación de firma. |
| `createConnectAccountLink` · `createMemberPaymentIntent` · `connectWebhook` | Los cobros del socio a **su** gimnasio. El importe lo decide el servidor. |
| `syncCustomClaims` | Pone `role` y `gymId` firmados en el token. Sin esto, cada regla paga una lectura extra por documento. |
| `aggregates.*` | Contadores con `FieldValue.increment()`, atómicos de verdad. |
| `onGymWritten` · `onMembershipPlanWritten` | Mantienen `publicGyms`. |
| `dailyExpirationSweep` | Recalcula vigencias cada madrugada y encola los avisos. |

Detalle completo en [`functions/README.md`](functions/README.md).

### El interruptor

```env
VITE_FUNCTIONS_URL=https://us-central1-<proyecto>.cloudfunctions.net
```

Con esa variable definida, `registerGym()` deja de provisionar en el cliente y
delega en la Cloud Function. Sin ella, corre local (demo).

---

## Conectar Firebase real

1. **Crear el proyecto** en [console.firebase.google.com](https://console.firebase.google.com).

2. **Habilitar** Authentication (proveedor Correo/contraseña) y Firestore en
   modo producción.

3. **Rellenar `.env.local`** y cambiar el driver:

   ```env
   VITE_DATA_DRIVER=firebase
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_PROJECT_ID=...
   ```

4. **Desplegar reglas e índices:**

   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use --add
   firebase deploy --only firestore:rules,firestore:indexes
   ```

5. **Desplegar las Functions** (imprescindible para custom claims y agregados):

   ```bash
   cd functions && npm install && npm run deploy
   ```

6. **Endurecer las reglas.** `firestore.rules` tiene marcadas con `▸ PRODUCCIÓN:`
   las líneas que hay que cerrar una vez desplegadas las Functions:

   | Colección | Cambiar a |
   |---|---|
   | `gyms` → `create` | `if false` |
   | `publicGyms` → `write` | `if false` |
   | `counters` → `write` | `if false` |
   | `dailyStats` → `create, update` | `if false` |
   | `activity` → `create` | `if false` |

7. **Probar con el emulador** antes de tocar producción:

   ```bash
   firebase emulators:start --only firestore,auth,functions
   ```

8. **Desplegar el sitio:**

   ```bash
   npm run build
   firebase deploy --only hosting
   ```

> El driver hace *fallback* automático al mock si `VITE_DATA_DRIVER=firebase`
> pero falta la configuración, con un aviso en consola. La aplicación nunca se
> queda en blanco por esto.

---

## Conectar Stripe real

El mock ([`services/stripe.ts`](src/services/stripe.ts)) mantiene **las mismas
firmas** que la API real, y las Functions ya están escritas.

### 1 · Crear los precios

```bash
stripe prices create --unit-amount 49900 --currency mxn \
  --recurring interval=month --product-data name="EasyGym Starter"
# repetir para Pro (89900) y Business (149900)
```

### 2 · Guardar los secretos

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:secrets:set STRIPE_CONNECT_WEBHOOK_SECRET
firebase functions:secrets:set STRIPE_PRICE_STARTER
firebase functions:secrets:set STRIPE_PRICE_PRO
firebase functions:secrets:set STRIPE_PRICE_BUSINESS
```

### 3 · Registrar los webhooks

| Endpoint | Eventos |
|---|---|
| `…/saasWebhook` | `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.*` |
| `…/connectWebhook` | `payment_intent.succeeded` (en **Connect**, no en la cuenta principal) |

### 4 · Probar en local

```bash
stripe listen --forward-to localhost:5001/<proyecto>/us-central1/saasWebhook
```

**Tarjetas de prueba** que ya funcionan en el prototipo:

| Tarjeta | Resultado |
|---|---|
| `4242 4242 4242 4242` | Pago exitoso |
| `4000 0000 0000 0002` | Rechazada por el banco |
| `4000 0000 0000 0069` | Tarjeta vencida |

---

## Conectar el lector de huella real

**El navegador no habla con el lector USB, y no debe.**

```
      LECTOR USB
          │ driver del fabricante
          ▼
  APP WINDOWS DE RECEPCIÓN
          │ SDK (ZKTeco · DigitalPersona · Suprema)
          ▼
   TEMPLATE BIOMÉTRICO          ← vector propietario, NO una imagen
          │
          ▼
   BASE LOCAL (SQLite)          ← el matching 1:N ocurre aquí, offline, en ms
          │ solo el identificador
          ▼
      FIRESTORE                 ← guarda `fingerprintId`, jamás la huella
```

> ⛔ **Nunca se almacena la imagen cruda de una huella.** Un template no permite
> reconstruir el dedo; una fotografía sí, y convierte una fuga de datos en un
> problema biométrico irreversible. En Firestore solo vive `fingerprintId`.

La app de Windows expone un servidor local y la web se suscribe. Sustituir el
mock es cambiar el cuerpo de tres funciones:

```ts
class WindowsBridgeFingerprintService {
  private ws = new WebSocket('ws://127.0.0.1:9123')

  async scanFingerprint() {
    this.ws.send(JSON.stringify({ cmd: 'identify' }))
    return this.once('identify')        // { fingerprintId, score }
  }
  async registerFingerprint(memberId: string) {
    this.ws.send(JSON.stringify({ cmd: 'enroll', memberId }))
    return this.once('enroll')
  }
}

export const Fingerprint = navigator.userAgent.includes('EasyGymDesktop')
  ? new WindowsBridgeFingerprintService()
  : MockFingerprintService
```

### Base local (SQLite)

Solo hace falta para lo que necesita hardware u operación sin red: huella,
impresoras térmicas y modo offline. **Firestore sigue siendo la fuente central**
— la base local no duplica todo, solo lo que el hardware necesita.

---

## Búsqueda

Firestore **no tiene búsqueda de texto**. EasyGym resuelve hoy lo que se puede
resolver bien, y documenta el resto.

### Lo que funciona ahora, en el servidor

Cada socio guarda `searchKey`: su nombre normalizado (minúsculas, sin acentos).
La búsqueda usa un rango sobre ese campo:

```ts
where('searchKey', '>=', q)
where('searchKey', '<=', q + '')
```

Buscar «vero» encuentra a «Verónica» sin cargar la colección. La búsqueda por
número de socio es exacta y directa.

### El límite

Solo encuentra por el **principio** del nombre. Buscar «herrera» no devuelve a
«María Herrera», y no se puede buscar por teléfono o correo.

### La solución para producción

| Opción | Cuándo |
|---|---|
| **Typesense** | Autoalojado, barato, `typesense-firestore` sincroniza solo. Recomendado para empezar. |
| **Algolia** | Gestionado, mejor tolerancia a erratas, extensión oficial de Firebase. Más caro al crecer. |

En ambos casos el patrón es el mismo: una Cloud Function con trigger en
`members` empuja el documento al índice, y el frontend consulta el índice en vez
de Firestore. El punto de cambio es una sola función:
[`searchMembersByName()`](src/services/members.ts).

---

## Impresión

Desde recepción y desde el perfil del socio se imprimen:

| Documento | Formato |
|---|---|
| Recibo de pago | 58 mm · 80 mm · A4 |
| Pase de visita | 58 mm · 80 mm · A4 |
| Credencial de socio | 86 × 54 mm |
| Contrato de membresía | A4 |

En el navegador se abre el documento y se llama a `window.print()`. En
producción, la app de recepción de Windows toma el mismo HTML y lo manda por
**ESC/POS** a una impresora térmica, sin diálogo. El ancho se configura en
`/configuracion → Impresión`.

---

## PWA

**Una sola aplicación EasyGym para todos los gimnasios.** No se genera una APK
por gimnasio: el gimnasio se resuelve en runtime por `gymId`, y su color de marca
se aplica con variables CSS.

Se instala desde el navegador:

- **Android:** menú del navegador → *Instalar aplicación*
- **iPhone:** compartir → *Agregar a pantalla de inicio*

El portal del socio está optimizado para móvil: navegación inferior al alcance
del pulgar y respeto de las áreas seguras de iOS.

---

## Qué es MOCK y qué es real

### Real y funcionando

- Multi-tenancy completo con aislamiento por `gymId` en cliente y servidor
- Autenticación, 6 roles y permisos por capacidad
- Alta automática de gimnasios (el flujo completo de provisión)
- Socios, membresías encadenadas, pagos, visitas, asistencias
- **Contadores incrementales y resúmenes diarios** (`counters`, `dailyStats`)
- **Paginación por cursor** y **búsqueda por prefijo en servidor**
- Control de acceso con su política configurable
- Clases con horarios configurables y reservaciones **transaccionales**
- Mapa de bicicletas con unicidad garantizada
- Portal del socio, punto de venta, inventario
- Panel, reportes y exportación a CSV
- Tiempo real: reservar una bicicleta se ve al instante en las demás pantallas
- Reglas de Firestore e índices listos para desplegar
- **Cloud Functions escritas** (sin desplegar)
- PWA instalable

### Simulado (con la misma forma que lo real)

| Mock | Archivo | Qué haría en producción |
|---|---|---|
| `mockDriver` | [`services/mockDriver.ts`](src/services/mockDriver.ts) | Firestore (`firestoreDriver` ya está escrito) |
| `MockStripeService` | [`services/stripe.ts`](src/services/stripe.ts) | Stripe + las Functions de `functions/` |
| `stripeWebhook` | [`services/stripe.ts`](src/services/stripe.ts) | `saasWebhook` con firma verificada |
| `MockFingerprintService` | [`services/fingerprint.ts`](src/services/fingerprint.ts) | App Windows + SDK del lector |
| Notificaciones | [`services/notifications.ts`](src/services/notifications.ts) | SendGrid · WhatsApp API · FCM |
| Código QR del socio | `PortalHome.tsx` | Librería de QR estándar |
| Autenticación mock | [`services/auth.ts`](src/services/auth.ts) | Firebase Authentication |

Las **plantillas** de notificación y el encolado son reales; lo simulado es el
envío.

---

## Empleados y asistencia laboral

### Tres clases de persona, tres clases de evento

Es la distinción que sostiene todo este módulo:

| Quién | Qué registra | Colección |
|---|---|---|
| **SOCIO** | entrada al gimnasio | `attendance` |
| **EMPLEADO** | entrada y salida laboral | `employeeAttendance` |
| **VISITANTE** | acceso de un día | `visits` |

No se mezclan. «Cuánta gente entrenó hoy» y «quién llegó tarde» son preguntas
distintas, las mira gente distinta y se responden con datos distintos.

### Un empleado NO es un usuario

`employees` y `users` son colecciones separadas, enlazadas por `userId` cuando
procede. El de limpieza ficha con la huella y no inicia sesión nunca; el
recepcionista tiene cuenta porque cobra. Unificarlas obligaría a inventar una
contraseña para quien no la necesita, y cada alta de personal consumiría un
hueco del límite de usuarios del plan.

### Horarios

Por empleado, por día, con **varios turnos en el mismo día**: la jornada
partida —7:00 a 12:00 y 14:00 a 18:00— es lo normal en mantenimiento y
limpieza, no una excepción. Un día sin turnos es descanso; no hace falta una
casilla aparte para decirlo.

Con jornada partida, quien ficha a las 13:52 está llegando al **segundo** turno,
no 352 minutos tarde al primero. Elegir «el turno cuyo inicio queda más cerca»
no sirve —las 11:00 están más cerca de las 14:00 que de las 7:00, y quien ficha
a las 11:00 está *dentro* de su primer turno—, así que la regla es: el turno que
contiene la hora; si ninguno, el primero que aún no empieza; si no, el último.

### Tolerancia y retardos

```
Horario 7:00 · tolerancia 15 minutos

  06:58  puntual   (llegó antes)
  07:00  puntual
  07:14  puntual   (dentro de tolerancia)
  07:15  puntual   (el último minuto de tolerancia CUENTA como dentro)
  07:16  RETARDO · 1 minuto
  07:20  RETARDO · 5 minutos
```

Los minutos de retardo se cuentan **desde el final de la tolerancia**, no desde
la hora del turno: quien llega a las 7:20 acumula 5 minutos, no 20. La
tolerancia es un margen concedido, no un adelanto del horario.

> **La hora real NUNCA se toca.** Si alguien llegó a las 7:20, el registro dice
> 7:20 aunque el estado sea LATE. El estado es una derivación que siempre se
> puede recalcular desde el dato original. El momento en que un sistema empieza
> a «ajustar» horas para que cuadren es el momento en que deja de servir como
> prueba de nada, ni a favor del empleado ni del gimnasio.

### Estados

| Estado | Cuándo |
|---|---|
| `ON_TIME` | dentro del horario más la tolerancia |
| `LATE` | se pasó de la tolerancia — `lateMinutes` dice cuánto |
| `ABSENT` | tenía turno y no fichó |
| `JUSTIFIED` | falta con permiso |
| `EARLY_EXIT` | llegó a tiempo pero se fue antes |
| `INCOMPLETE` | fichó entrada y nunca salida |

Precedencia: `JUSTIFIED` > `ABSENT` > `INCOMPLETE` > `LATE` > `EARLY_EXIT` >
`ON_TIME`. `lateMinutes` y `earlyExitMinutes` viajan **siempre aparte** del
estado, para que el resumen pueda contar «1 retardo Y 1 salida anticipada»
aunque el estado solo admita un valor.

### Las faltas no se escriben: se deducen

Una falta es la **ausencia** de un registro, no un documento que alguien cree.
Se deriva del horario y del rango, en vez de esperar a que un proceso nocturno
escriba «faltó» —que es justo lo que se rompe el día que el proceso no corre—.
`missingDays()` nunca inventa faltas futuras: el miércoles no ha faltado nadie
el viernes.

### Resumen semanal

`/empleados/asistencia` contesta **«¿cómo va mi equipo esta semana?»**, no «¿a
qué hora llegó Adrián el martes?». Lo primero que se ve es el resumen por
persona; el detalle día a día está un clic más abajo. Obligar al dueño a revisar
100 registros sueltos para enterarse de que alguien llegó tarde una vez es la
forma más segura de que no los revise.

`/reportes/personal` da la tabla completa, exportable a CSV. **Prepara** la
nómina, no la calcula: sueldos, ISR, IMSS y prestaciones son otra fase, y una
que se hace mal si se improvisa.

---

## Biometría y hardware

### El navegador no habla con el hardware. Nunca

No es una preferencia de diseño: una página web no puede abrir un lector USB
con el SDK del fabricante, ni debería poder.

```
  LECTOR USB / LAN
       │
       ▼
  EASYGYM AGENT          aplicación de escritorio en el equipo del gimnasio.
       │                 Carga el SDK del fabricante y guarda SUS credenciales.
       ▼
  DEVICE ADAPTER         traduce el protocolo concreto de ESE modelo
       │
       ▼
  TEMPLATE / EVENTO      un identificador, jamás la imagen de la huella
       │
       ▼
  BASE LOCAL             sobrevive a la caída de Internet
       │
       ▼
  SYNC SERVICE ────────► FIRESTORE
```

### Una interfaz, varios aparatos

[`services/biometric.ts`](src/services/biometric.ts) define `BiometricProvider`.
Añadir un modelo nuevo es implementarlo; ninguna pantalla cambia.

| Implementación | Estado |
|---|---|
| `MockUsbFingerprintProvider` | simulación, funcional |
| `MockLanFingerprintProvider` | simulación, funcional — empuja eventos |
| `FutureFaceProvider` | **no implementado**, lanza a propósito |
| `LanDeviceAdapter` | interfaz vacía, esperando marca y modelo |

**No hay ningún protocolo inventado.** `lanAdapters` está vacío, y hay una
prueba que lo comprueba. Escribir endpoints para un ZKTeco, un Suprema o un
Hikvision imaginario produciría código que habría que borrar el día que llegue
el aparato real. Lo que sí se puede escribir hoy es la forma del hueco.

Los simuladores reproducen la **latencia** y los **fallos** del hardware real
—una lectura tarda un segundo y a veces no reconoce— porque una interfaz que
siempre responde al instante y siempre acierta esconde justo los casos que hay
que diseñar: qué ve el recepcionista mientras espera, y qué ve cuando no lee.

### Privacidad biométrica

Lo que este sistema **NO** guarda: imágenes de huellas, fotografías de dedos,
minucias en bruto, ni nada de lo que pueda reconstruirse una huella.

Lo único que se guarda es `fingerprintId`: una referencia opaca que sirve para
preguntarle al aparato «¿es esta persona?» y para nada más. Si se cambia de
modelo de lector, esos identificadores dejan de valer — y eso es exactamente lo
que se quiere.

> Una huella filtrada no se puede cambiar como una contraseña. El criterio no es
> «guardar lo que quepa» sino «guardar lo mínimo que funcione».

### Reconocimiento facial

▸ **No implementado.** `FutureFaceProvider` existe, se declara no disponible y
**lanza** si se le pide dar de alta una cara. Un mock que devolviera datos
falsos haría creer que está integrado.

Antes de implementarlo hay que resolver, y no es opcional: consentimiento
explícito y revocable, qué se guarda (vector, jamás la fotografía), dónde y
quién puede leerlo, cuánto se conserva y cómo se borra, y el aviso de privacidad
conforme a la LFPDPPP. La cara tiene las mismas obligaciones legales que la
huella y algunas más: se puede capturar sin que la persona colabore.

### Torniquetes

La arquitectura recibe eventos (`ACCESS_GRANTED`, `ACCESS_DENIED`,
`EMPLOYEE_ENTRY`, `EMPLOYEE_EXIT`) a través de `IncomingDeviceEvent`.
`LanDeviceAdapter.grantAccess()` está declarado para abrir el relé.
**El protocolo real no está implementado**: falta el modelo.

### Dispositivos

`/configuracion/dispositivos`. Se configura qué aparato es, dónde está y cómo
se conecta — **nunca su contraseña**. Ese documento lo lee el navegador de todo
el personal del gimnasio; las credenciales del aparato viven en el Agente.

Incluye un **simulador** claramente marcado como tal, que permite probar el
flujo completo sin hardware: huella → evento → fichaje → cola → sincronización.

---

## Modo sin conexión y sincronización

### El problema real

Se cae Internet a las 7 de la mañana, con quince personas esperando para entrar.
Si EasyGym deja de funcionar, el gimnasio deja de funcionar. Un sistema de
operación diaria que exige conexión permanente no es un sistema de operación
diaria.

```
  Con Internet:   evento → base local → Firestore
  Sin Internet:   evento → base local → COLA (PENDING)
  Al volver:      COLA → sincronizar → Firestore
```

La recepción muestra 🟢 **En línea** o 🟠 **Sin internet**, con los eventos
pendientes. **Nada se bloquea**: un aviso que impide seguir operando es peor que
no tener aviso.

### Idempotencia

Reintentar es normal: se cae a media subida, el navegador se cierra, el
recepcionista recarga. Sin una clave estable, cada reintento crea un registro
nuevo y un empleado acaba fichando tres veces a la misma hora.

Hay **tres** defensas, y son independientes:

1. **La cola** — encolar el mismo `eventId` dos veces devuelve el elemento que
   ya estaba, no añade otro.
2. **El documento** — el id de `biometricEvents` **es** el `eventId`. Reenviarlo
   sobrescribe el mismo documento; las reglas lo hacen append-only.
3. **El fichaje** — `employeeAttendance` usa `{employeeId}_{fecha}` como id, y
   la entrada no se pisa: el primer marcaje del día es el bueno.

> `EVENT-123` enviado dos veces termina en **1** evento, no en 2. Hay pruebas de
> las tres capas.

### Lo que sube también aplica su consecuencia

Subir el evento no basta: un fichaje hecho sin conexión tiene que acabar siendo
una entrada en `employeeAttendance`, o el lunes por la mañana el dueño vería
«falta» de alguien que sí vino —solo que vino el día que se cayó Internet—. La
hora que se guarda es la del **fichaje**, no la de la subida.

### Reintentos

Cinco intentos automáticos. Después el evento queda como `FAILED` y deja de
reintentarse solo: a partir de ahí hace falta que alguien mire qué pasa, y la
recepción ofrece un botón de reintento manual.

▸ **PRODUCCIÓN**: la cola vive hoy en `localStorage` porque el prototipo corre
en el navegador. En el Agente de Windows será SQLite, sobrevivirá al reinicio
del equipo y no dependerá de que la pestaña siga abierta. La **interfaz** de
[`services/syncQueue.ts`](src/services/syncQueue.ts) es la que el Agente
implementará.

---

## Solicitudes de insumos

`/insumos` sustituye al papelito pegado en la puerta de la oficina.

```
  PENDIENTE ──► EN PROCESO ──► ENTREGADO
       └────────────────────► CANCELADO
```

Lo que el papel no da: quién pidió, quién lo tomó, cuándo se resolvió, y el
historial para saber cuánto papel se consume al mes.

**Pensada para el teléfono.** Adrián no tiene computadora: abre EasyGym desde el
celular entre una cosa y otra. Tarjetas grandes, botones que ocupan el ancho, y
lo primero que se ve es lo que falta por hacer —no el historial—.

### Avisos internos

`internalNotifications` es distinta de `notifications`, que va del gimnasio a
sus **socios**. Esta es interna: de Paulina a Adrián. Separarlas evita que un
recordatorio de vencimiento y «te tomaron la solicitud» compitan por el mismo
buzón.

Cuando Paulina crea una solicitud, el aviso va al **puesto** de mantenimiento,
no a una persona: no se sabe quién está de turno, y lo toma el primero que
pueda. A partir de ahí los avisos van a quien la pidió.

▸ **FUTURO**: hoy solo `inapp`. Push, correo y WhatsApp entran detrás de
`notifyStaff()` sin tocar a quien la llama. Lo que falta no es el código: son
las credenciales del proveedor y decidir quién consiente recibir qué.

---

## Seguridad

### Qué protege de verdad y qué no

Conviene decirlo sin rodeos, porque es la confusión más cara de este tipo de
producto:

| Capa | Qué hace | ¿Es seguridad? |
|---|---|---|
| Ocultar botones (`PlanGuard`, `IfFeature`) | Que no se vea lo que no se puede usar | **No.** Es comodidad |
| Bloquear rutas (`RequireFeature`, `RequireRole`) | Que la URL escrita a mano no abra la pantalla | **No.** Es comodidad |
| Minificar el bundle | Que el código sea incómodo de leer | **No.** Es empaquetado |
| **`firestore.rules`** | Rechazar la lectura o escritura en el servidor | **Sí** |
| **Custom claims** | Rol y `gymId` firmados, que el cliente no puede falsificar | **Sí** |
| **Cloud Functions** | Decidir importes, provisionar, escribir agregados | **Sí** |
| **App Check** | Que solo tu aplicación use tus credenciales | **Sí** (complementa) |

**Todo el JavaScript que corre en el navegador de un cliente es visible para ese
cliente.** La minificación lo ofusca, no lo esconde. Bloquear el clic derecho o
F12 no impide nada a nadie que quiera mirar: basta abrir las herramientas del
navegador, o pedir el bundle con `curl`. Este producto **no depende de esconder
nada**: depende de que el servidor rechace lo que no corresponde, y eso sigue
funcionando igual aunque alguien tenga el código delante.

Lo que sí se hace en el frontend, y por lo que sí vale la pena:

- **Build de producción** con minificación y *tree-shaking* — tamaño, no secreto
- **Code splitting** por ruta: la landing no arrastra el punto de venta
- **Carga diferida** del SDK de Firebase (~400 KB que la demo no descarga)
- **Ningún secreto en el bundle** — ver la auditoría de secretos, abajo

### Auditoría de secretos

Lo que sí viaja al navegador, y por qué no importa:

| Variable | Qué es | ¿Secreto? |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | Identificador del proyecto | **No.** No autoriza nada; autorizan las reglas |
| `VITE_FIREBASE_*` | Dominio, bucket, appId | **No.** Son públicos por diseño |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Clave publicable (`pk_`) | **No.** Está pensada para el cliente |
| `VITE_FUNCTIONS_URL` | URL de las Functions | **No.** Es un endpoint público |

Lo que **nunca** sale del servidor: `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, los `STRIPE_PRICE_*`
y las credenciales del Admin SDK. Viven en
`firebase functions:secrets:set` y solo los lee el runtime de las Functions.

Comprobado en este repositorio:

```bash
# Ningún secreto en el código del cliente ni en el bundle compilado
grep -rE "sk_live|sk_test|whsec_|BEGIN PRIVATE KEY" src/ dist/   # sin resultados
```

`.gitignore` cubre `.env`, `.env.local`, `serviceAccount*.json` y
`functions/.env*`.

### Estados de la suscripción

Una sola pieza decide qué puede hacer un gimnasio según cómo esté su cuenta:
[`services/gymStatus.ts`](src/services/gymStatus.ts).

| Estado | Leer | Operar | Facturar | Aviso |
|---|:---:|:---:|:---:|---|
| `ACTIVE` | ✅ | ✅ | ✅ | — |
| `TRIALING` | ✅ | ✅ | ✅ | Agrega tu método de pago |
| `PAST_DUE` | ✅ | ✅ | ✅ | No pudimos procesar tu último pago |
| `SUSPENDED` | ✅ | ❌ | ✅ | Tu cuenta está suspendida |
| `CANCELED` | ✅ | ❌ | ✅ | Tu suscripción fue cancelada |

**Restringir nunca significa borrar.** Un gimnasio suspendido conserva íntegros
sus socios, sus pagos y su historial, y los recupera tal cual al reactivarse. Lo
único que pierde es el tiempo que estuvo bloqueado.

`PAST_DUE` conserva la operación a propósito: dejar a un negocio sin poder
cobrar a sus socios por un cargo rechazado hace más daño que esperar unos días.

Se hace cumplir en dos sitios: `assertCurrentGymCanOperate()` en los servicios
(el aviso) y `subscriptionAllowsWrites()` en `firestore.rules` (la decisión).

### Errores que ve el usuario

Nunca se muestra el error crudo del SDK. Quien está en el mostrador no puede
hacer nada con `FirebaseError: PERMISSION_DENIED: Missing or insufficient
permissions`.

[`lib/errors.ts`](src/lib/errors.ts) traduce cada código a una frase accionable:

| Código | Lo que se muestra |
|---|---|
| `permission-denied` | «No tienes permisos para realizar esta acción.» |
| `unauthenticated` | «Tu sesión expiró.» |
| `unavailable` | «No hay conexión con el servidor.» |
| `resource-exhausted` | «Demasiadas peticiones seguidas.» |
| `gym-suspended` | «Tu gimnasio está suspendido…» |

Los errores del propio dominio (`ReservationError`, `GymSuspendedError`,
`PlanCatalogError`) ya traen un mensaje escrito para una persona y pasan tal
cual. El detalle técnico va a la consola por `reportError()`, que es el único
punto de registro — el sitio donde enchufar Sentry el día que haga falta.

### Limitación de peticiones

[`functions/src/rateLimit.ts`](functions/src/rateLimit.ts). Ventana fija por
(identidad, acción), en una transacción de Firestore.

| Acción | Tope |
|---|---|
| `provisionTenant` | 3 / hora |
| `createSaasCheckout` | 10 / 10 min |
| `createMemberPaymentIntent` | 60 / min |
| `createConnectAccountLink` | 5 / 10 min |
| `resyncEntitlements` | 5 / hora |

Protege las operaciones caras o sensibles que pasan por el servidor. **No**
protege el acceso directo a Firestore desde el SDK del navegador: ahí no hay
función que interceptar, y de eso se encargan las reglas, App Check y las cuotas
del proyecto. Los webhooks de Stripe quedan fuera a propósito: los llama Stripe,
y limitarlos significaría descartar eventos de pago.

La colección `rateLimits` está **cerrada por completo** al cliente — un contador
que el limitado puede reiniciar no limita nada.

---

## Auditoría

`auditLogs` responde a la pregunta que siempre acaba apareciendo: *«¿quién le
cambió la fecha de vencimiento a este socio?»*. Sin bitácora eso es una
discusión; con bitácora es un dato.

```ts
{
  id, gymId,                       // null = acción de plataforma
  actorId, actorName, actorRole,
  action,                          // unión cerrada: MEMBER_CREATED, PAYMENT_REFUNDED…
  entityType, entityId,
  summary,                         // ya redactado para mostrarse
  before, after,                   // SOLO los campos que cambiaron
  createdAt,
}
```

`before`/`after` llevan solo lo que cambió. Un log que copia el documento entero
deja de ser un log: multiplica el almacenamiento, duplica datos personales y
hace que nadie lo lea.

**Quién ve qué**

- **OWNER / ADMIN** → `/actividad`, solo su gimnasio
- **SUPERADMIN** → `/superadmin/auditoria`, toda la plataforma, con filtro por gimnasio
- **Recepción y entrenadores** → nada. No es su información

**Nadie la edita ni la borra**, ni siquiera el SUPERADMIN:

```js
match /auditLogs/{id} {
  allow update, delete: if false;
}
```

Una bitácora que el auditado puede modificar no sirve como bitácora.

**Qué se registra**: dinero (cobros, devoluciones, visitas, ventas), socios
(altas, ediciones, bajas, huellas), permisos (cambios de rol, usuarios
desactivados), operación (asistencias, accesos denegados, clases,
reservaciones) y plataforma (planes, precios, estados de gimnasio). No se
registran lecturas: eso convertiría la bitácora en la colección más grande del
producto y en la más inútil.

**Retención**: dos años para los registros de gimnasio, purgados por
`purgeOldAuditLogs` los domingos a las 4 a.m. Los de plataforma se conservan:
son pocos y son justo los que interesan en una disputa años después.

▸ **PRODUCCIÓN**: los escribe el servidor (`functions/src/audit.ts`), que saca
el actor del documento y no de lo que declare el cliente. Entonces
`allow create` pasa a `if false`.

---

## SuperAdmin

Consola de plataforma, con acento violeta para que nadie confunda *«estoy
administrando EasyGym»* con *«estoy administrando un gimnasio»*.

| Sección | Qué permite |
|---|---|
| **Resumen** | MRR, gimnasios, socios totales, distribución por plan |
| **Gimnasios** | Entrar a uno, cambiar de plan, suspender, reactivar |
| **Planes** | Nombre, precio, límites, visibilidad — con confirmación en lo delicado |
| **Funcionalidades** | Matriz funcionalidad × plan, con interruptores |
| **Suscripciones** | Estado de cobro de cada gimnasio |
| **Usuarios** | Cuentas administrativas (los socios **no** se listan aquí) |
| **Auditoría** | Toda la bitácora, filtrable por gimnasio, acción y periodo |
| **Configuración** | Qué piezas están conectadas de verdad en este entorno |
| **Mantenimiento** | Resincronizar permisos, recalcular estadísticas, detectar desvíos |

Dos decisiones que merecen explicación:

**Los cambios delicados piden confirmación.** Cambiar el precio o el tope de
socios de un plan afecta a todos sus gimnasios a la vez. La pantalla dice
exactamente qué cambia, a cuántos gimnasios llega, y avisa si alguno ya está por
encima del tope nuevo. Bajar Starter a 50 socios con gimnasios que tienen 120 no
se hace por accidente.

**Los socios no se listan en Usuarios.** `users` tiene una fila por cada socio
con portal: en una plataforma con 300 gimnasios de 2 000 socios son 600 000
documentos. La pantalla consulta solo el personal (`role in [...]`) y el total de
socios sale de `counters`.

---

## Tests

```bash
npm test          # lógica pura — planes, funcionalidades y límites (vitest)
npm run test:rules # reglas de Firestore contra el emulador
npm run test:all   # los dos
```

### `npm test` — 28 pruebas, sin red ni emulador

[`tests/features/plans.test.ts`](tests/features/plans.test.ts) comprueba la
promesa comercial del producto: que lo que se cobra sea exactamente lo que se
entrega.

- El catálogo declara todas las claves que usan los planes, sin duplicados
- Todas las funcionalidades esenciales están activas en Starter
- Starter no tiene reservaciones ni mapa de bicicletas; Pro sí; Business añade inventario y sucursales
- **Activar una funcionalidad desde el SuperAdmin cambia `hasFeature`** — el escenario completo
- `SUSPENDED` y `CANCELED` pierden todo; `PAST_DUE` conserva el acceso
- Límites por plan, y el SuperAdmin subiéndolos sin tocar código
- Los entitlements son una copia, no una referencia al plan

[`tests/features/workSchedule.test.ts`](tests/features/workSchedule.test.ts) —
42 pruebas sobre horarios, tolerancia y retardos, incluido el caso completo de
Adrián: 4 puntuales, 1 retardo de 5 minutos, 0 faltas, y la hora real intacta.

[`tests/features/syncQueue.test.ts`](tests/features/syncQueue.test.ts) —
offline, cola, reintentos y las tres capas de idempotencia.

[`tests/features/biometric.test.ts`](tests/features/biometric.test.ts) — el
contrato de los lectores, que el facial lanza en vez de fingir, y que no hay
ningún adaptador de fabricante inventado.

### `npm run test:rules` — el servidor hace cumplir el aislamiento

Tres archivos contra el emulador real de Firestore, con dos gimnasios completos
y un usuario de cada rol:

[`tests/rules/multiTenant.test.ts`](tests/rules/multiTenant.test.ts)

1. El OWNER de A lee lo suyo
2. El OWNER de A **no** lee nada de B, ni lista sin filtrar por `gymId`
3. El OWNER de A **no** modifica datos de B, ni mueve un socio a B
4. El OWNER de A **no** borra datos de B, pero sí los suyos
5. RECEPCIÓN cobra y registra, pero no cambia la configuración ni borra
6. ENTRENADOR gestiona clases, pero no toca dinero
7. El SOCIO se lee a sí mismo, y **no** puede alargarse su propia vigencia
8. El SUPERADMIN lee entre gimnasios y edita planes
9. Sin sesión no se lee nada privado; `publicGyms` sí
10. Nadie cambia su `gymId` ni se asciende a SUPERADMIN

[`tests/rules/planFeatures.test.ts`](tests/rules/planFeatures.test.ts)

- Starter **no** puede crear reservaciones, clases, bicicletas ni productos — *por API, no solo en la interfaz*
- Activar la funcionalidad en el plan la habilita **de inmediato**
- Un OWNER **no** edita el catálogo de planes, ni sus propios `entitlements`, ni se cambia de plan
- Al llegar al tope de socios, el **servidor** rechaza el alta
- `SUSPENDED`/`CANCELED` bloquean escrituras y conservan lecturas
- El cliente **no** puede crear un pago marcado como `stripe`, ni con importe negativo
- La bitácora no se edita ni se borra, ni por el SUPERADMIN
- Nadie toca los contadores de otro gimnasio

[`tests/rules/operations.test.ts`](tests/rules/operations.test.ts) — el módulo
de personal (Fase 4)

- Un gimnasio **no** ve el personal, la asistencia ni los dispositivos de otro
- MANTENIMIENTO ve **solo** las solicitudes de insumos: ni socios, ni pagos, ni
  los retardos de sus compañeros
- Un plan sin el módulo lo tiene bloqueado en el **servidor**, y activarlo desde
  el SuperAdmin lo habilita de inmediato
- Los eventos biométricos son append-only: reenviar el mismo `eventId` no crea
  un segundo documento
- Nadie crea una solicitud a nombre de otro, ni con cantidad cero
- Una suscripción suspendida bloquea el fichaje y conserva la consulta

### Requisitos para `npm run test:rules`

El emulador de Firestore es una aplicación Java. Sin JDK no arranca.

| Requisito | Versión | Comprobar |
|---|---|---|
| **JDK** | 11 o superior (recomendado **21 LTS**) | `java -version` |
| **firebase-tools** | 13+ | `firebase --version` |
| `JAVA_HOME` | apuntando al JDK | `echo $env:JAVA_HOME` |

En este equipo está instalado **Microsoft OpenJDK 21.0.12.1 LTS**, en
`%USERPROFILE%\.jdks\jdk-21.0.12.1+1`, con `JAVA_HOME` y `Path` fijados a nivel
de usuario. Es una instalación portable, sin registro ni permisos de
administrador: se desinstala borrando esa carpeta y las dos variables.

Si hay que rehacerlo en otra máquina:

```bash
winget install --id Microsoft.OpenJDK.21    # necesita permisos de administrador
npm install -g firebase-tools
```

Si no hay permisos de administrador, sirve el mismo JDK en ZIP:
descomprimirlo donde sea y apuntar `JAVA_HOME` a esa carpeta.

### Resultado esperado

```
 ✓ tests/rules/operations.test.ts   (54 tests)
 ✓ tests/rules/planFeatures.test.ts (32 tests)
 ✓ tests/rules/multiTenant.test.ts  (68 tests)

 Test Files  3 passed (3)
      Tests  154 passed (154)
+  Script exited successfully (code 0)
```

### Qué encontraron estas pruebas la primera vez que se ejecutaron

No pasaron a la primera, y por eso valía la pena ejecutarlas. De 100 pruebas,
**13 fallaron**, y entre ellas había un agujero de privacidad real:

> **Cualquier socio podía leer el padrón completo de su gimnasio.**
> `canReadTenantDoc()` solo comprobaba `belongsToGym()`, que incluye a los
> socios. Con una cuenta de portal se leían todos los nombres, correos,
> teléfonos y vigencias del gimnasio, todos los pagos, todas las visitas y los
> ingresos diarios. Lo detectó el TEST 7 con
> *«Expected request to fail, but it succeeded»*.
>
> Corregido: `canReadTenantDoc()` ahora exige rol de **personal**. Los socios
> siguen leyendo lo suyo por las cláusulas `isSelfMember(...)` y los catálogos
> compartidos por las de `belongsToGym(...)`.

Los otros dos hallazgos eran de la propia suite, no del producto:

- **Los dos ficheros corrían en paralelo contra el mismo emulador.** Cada uno
  empieza con `clearFirestore()`, que borra el proyecto entero, así que uno
  vaciaba los datos del otro a media prueba. Los fallos aparecían donde no
  estaba el error. Corregido con `fileParallelism: false` en `vitest.config.ts`.
- **La prueba «un OWNER no puede reactivarse la suscripción» no probaba nada**:
  partía de un gimnasio ya `ACTIVE` y escribía `ACTIVE`. Era un cambio nulo que
  las reglas permitían con razón. Ahora suspende el gimnasio primero.

---

## Estructura del código

```
├── functions/            ← Cloud Functions (escritas, sin desplegar)
│   └── src/
│       ├── provisionTenant.ts   Alta del tenant, atómica
│       ├── stripeSaas.ts        Stripe A · dueño → EasyGym
│       ├── stripeGym.ts         Stripe B · socio → su gimnasio (Connect)
│       ├── aggregates.ts        Contadores con FieldValue.increment()
│       ├── claims.ts            role y gymId firmados en el token
│       ├── publicGym.ts         Espejo público
│       ├── planFeatures.ts      plans → gyms.entitlements → reglas
│       ├── audit.ts             Bitácora escrita por el servidor
│       ├── rateLimit.ts         Tope de peticiones por identidad y acción
│       └── expirationSweep.ts   Barrido diario de vigencias
│
│   ── Fase 4 · operación interna ──
│   src/lib/workSchedule.ts      Horarios, tolerancia y retardos (lógica PURA)
│   src/services/employees.ts    Personal: alta, horario, baja
│   src/services/employeeAttendance.ts  Fichajes y faltas
│   src/services/biometric.ts    BiometricProvider + simuladores + FutureFace
│   src/services/biometricEvents.ts     Evento del aparato → fichaje
│   src/services/syncQueue.ts    Cola sin conexión e idempotencia
│   src/services/supplies.ts     Insumos y avisos internos
├── tests/
│   ├── features/         ← lógica pura (vitest, sin red)
│   └── rules/            ← firestore.rules contra el emulador
└── src/
    ├── components/
    │   ├── charts/       SVG propio: área, barras, dona, KPI, sparkline
    │   ├── layout/       AppShell · PortalShell · SuperAdminShell
    │   ├── ui/           Botones, campos, modales, tabla, tarjetas, logotipo
    │   ├── BikeMap.tsx   Mapa de bicicletas
    │   └── PlanGuard.tsx Control de funcionalidades por plan
    ├── config/
    │   ├── brand.ts      EasyGym (producto) · EasyTap (marca matriz)
    │   ├── plans.ts      Catálogo de planes + hasFeature()
    │   └── navigation.ts Menú por permiso y por plan
    ├── data/seed.ts      3 gimnasios demo, deterministas, con agregados
    ├── hooks/
    │   ├── useCollection.ts      Tiempo real sobre conjuntos acotados
    │   ├── usePagedCollection.ts Paginación por cursor
    │   └── useAggregates.ts      Contadores y resúmenes diarios
    ├── lib/              date · format · theme · utils · memberStatus
    ├── pages/
    │   ├── public/       Landing · Planes · Registro · Checkout · Login · /g/:slug
    │   ├── app/          16 pantallas del gimnasio
    │   ├── reception/    Recepción a pantalla completa
    │   ├── portal/       6 pantallas del socio
    │   └── superadmin/   4 pantallas de plataforma
    ├── routes/           Router + guards (auth, rol, permiso, plan)
    ├── services/         ← toda la lógica de negocio vive aquí
    │   ├── driver.ts     Contrato del driver (query, cursor, transacción)
    │   ├── mockDriver.ts · firestoreDriver.ts · db.ts (TenantRepo)
    │   ├── aggregates.ts Contadores y resúmenes diarios
    │   ├── publicGym.ts  Espejo público del gimnasio
    │   ├── auth.ts       Identidad, roles y permisos
    │   ├── provisioning.ts  Alta automática (lista para mover al servidor)
    │   ├── members.ts · billing.ts · access.ts · reservations.ts
    │   ├── stripe.ts · fingerprint.ts · printing.ts · notifications.ts
    │   └── analytics.ts  Utilidades puras sobre conjuntos acotados
    ├── state/            SessionContext (usuario + gimnasio + repo)
    └── types/            Modelo de dominio completo
```

### Convenciones

- **Toda** entidad de gimnasio lleva `gymId`. Sin excepciones.
- El estado de un socio se **deriva** de `expiresAt` en cada lectura; el campo
  `status` es solo una caché para poder filtrar en el servidor.
- Las renovaciones se **encadenan** desde el vencimiento actual: quien renueva
  antes no pierde días.
- Nada de horarios, precios ni límites escritos en el código: todo es
  configuración del gimnasio o del plan.
- Ningún contador se calcula recorriendo documentos.

---

## PRODUCTION CHECKLIST

Lo que falta para poner esto delante de gimnasios reales, en orden.

### 🔴 Bloqueantes — nada sale a producción sin esto

Lo demás se puede negociar. Esto no.

- [x] ~~**Ejecutar `npm run test:rules` y que pase.**~~ **HECHO.** 100/100 en
      verde. Encontraron un agujero real —los socios leían el padrón completo de
      su gimnasio— que ya está corregido. Volver a ejecutarlas antes de cada
      despliegue de reglas
- [ ] **Cerrar los `▸ PRODUCCIÓN:` de `firestore.rules`.** Están marcados uno a
      uno en el archivo. Mientras sigan abiertos, el cliente puede escribir
      contadores, crear gimnasios y escribir en la bitácora
- [ ] **Desplegar las Cloud Functions** — sin ellas, cerrar las reglas del punto
      anterior deja la aplicación sin poder operar. Van juntos
- [ ] **Verificar los custom claims** después del primer alta real:
      `getIdTokenResult().claims` debe traer `role` y `gymId`
- [ ] **Firestore en modo producción**, nunca en modo prueba
- [ ] **Probar el aislamiento a mano**: entrar con el OWNER del gimnasio A e
      intentar leer un documento de B desde la consola del navegador. Debe
      fallar

### Infraestructura

- [ ] **Proyecto Firebase de producción** separado del de desarrollo
- [ ] **Firestore rules** desplegadas — `firebase deploy --only firestore:rules`
- [ ] **Firestore indexes** desplegados — `firebase deploy --only firestore:indexes`
- [ ] **TTL activado** en `rateLimits.expiresAt` (ya declarado en `firestore.indexes.json`)
- [ ] **Firebase Authentication** con dominios autorizados restringidos
- [ ] **Restringir la API key** en Google Cloud Console (referrers HTTP)
- [ ] **Dominio propio** + **HTTPS** (Firebase Hosting lo da automático)
- [ ] **Subdominios wildcard** si se activa `gimnasio.easygym.com`

### Pagos

- [ ] **Stripe en modo live** con los tres precios creados
- [ ] **Secretos cargados** (`functions:secrets:set`), ninguno con prefijo `VITE_`
- [ ] **Webhook SaaS** registrado y verificando firma
- [ ] **Webhook Connect** registrado (cuenta conectada, no la principal)
- [ ] **Onboarding de Connect** probado con un gimnasio real
- [ ] **Prueba de impago**: tarjeta que falla → `PAST_DUE` → sin borrar datos

### Datos y escala

- [ ] **Backups automáticos** de Firestore: exportación programada a Cloud
      Storage, con retención. Un respaldo que nunca se ha restaurado es una
      suposición, no un respaldo
- [ ] **Prueba de restauración** en un proyecto aparte, al menos una vez
- [ ] **Política de retención** definida (qué se conserva y cuánto)
- [ ] **Paginación** verificada en un gimnasio con >10 000 socios
- [ ] **Búsqueda** conectada a Typesense o Algolia — con `filter_by: gymId`
      **obligatorio**: un buscador mal filtrado es una fuga entre gimnasios
- [ ] **Contadores** verificados tras el `dailyExpirationSweep`
- [ ] **Firebase Storage** para fotos de socios y logotipos
- [ ] **Colección `publicGyms`** poblada por trigger para todos los gimnasios
- [ ] **Resincronizar permisos** una vez tras el despliegue, para que todos los
      gimnasios tengan `entitlements` (Mantenimiento → Resincronizar)

### Operación

- [ ] **Monitoring**: alertas de Cloud Monitoring sobre errores de Functions
- [ ] **Logs**: retención configurada, con alerta sobre `saasWebhook` fallando
- [ ] **Sentry** (o equivalente) para errores del frontend
- [ ] **Presupuesto y alertas de gasto** en Google Cloud
- [ ] **Runbook** de qué hacer si el webhook de Stripe se cae

### Seguridad

- [ ] **Revisión de la superficie pública**: solo `publicGyms` sin sesión
- [ ] **Firebase App Check** activado (reCAPTCHA Enterprise en web)
- [ ] **Rate limiting verificado**: agotar el cupo de `createSaasCheckout` y
      comprobar que devuelve 429 con el mensaje correcto
- [ ] **Auditoría escrita por el servidor**: pasar `auditLogs` a
      `allow create: if false` una vez desplegado `functions/src/audit.ts`
- [ ] **Purga de bitácora** programada (`purgeOldAuditLogs`) y verificada
- [ ] **Sesiones**: revisar `revokeRefreshTokens` al desactivar un usuario —
      un empleado despedido debe perder el acceso en la siguiente petición, no
      cuando le caduque el token
- [ ] **Segunda auditoría de secretos** sobre el bundle desplegado, no solo sobre
      el repositorio
- [ ] **Aviso de privacidad** y consentimiento para datos biométricos
- [ ] **Confirmar** que no se guarda ninguna imagen de huella

### Calidad

- [ ] **Tests de las transacciones** de reservación (cupo y bicicleta única)
- [ ] **Tests de `contractMembership`** (encadenado de días)
- [ ] **Prueba de carga** del panel con un gimnasio de 50 000 socios
- [ ] **Auditoría de accesibilidad** (foco, contraste, lectores de pantalla)
- [ ] **Prueba en dispositivos reales**: iPhone, Android, tablet
- [ ] **Revisar las consultas sin `limit`** que queden: `rebuildAggregates` es
      cara a propósito y está documentada, pero conviene comprobar que no ha
      aparecido ninguna nueva

### Operación interna (Fase 4)

- [ ] **Activar las funciones de Personal** en `/superadmin/funcionalidades`.
      Vienen **apagadas** en todos los planes a propósito: el catálogo las
      declara y el SuperAdmin decide qué paquete las incluye
- [ ] **Agente de Windows**: es lo que falta para TODO el hardware. Sin él no
      hay lector USB, ni LAN, ni torniquete, ni impresión térmica
- [ ] **Marca y modelo** de cada aparato, para escribir su `LanDeviceAdapter`.
      Hoy `lanAdapters` está vacío a propósito
- [ ] **Cola en SQLite** dentro del Agente, en lugar de `localStorage`
- [ ] **Consentimiento biométrico** firmado por cada empleado, revocable
- [ ] **Aviso de privacidad** actualizado con el tratamiento de la huella
- [ ] **Retención** de `biometricEvents` — crece con cada paso de huella

### Producto

- [ ] **Facturación CFDI** con un PAC mexicano
- [ ] **App de recepción para Windows** (Electron o .NET) con el puente al lector
- [ ] **Envío real** de correo y WhatsApp
- [ ] **Importador** de socios desde CSV/Excel para migrar desde otro sistema
- [ ] **Nómina**: sueldos, ISR, IMSS y prestaciones. Los minutos trabajados ya
      están; el cálculo es otra fase y no debe improvisarse

---

<div align="center">

**EasyGym** · Gimnasios más fuertes, negocios más grandes

<sub>un producto de EasyTap</sub>

</div>
