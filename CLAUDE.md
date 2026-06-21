# CLAUDE.md — Inventario Kilker (empresa de pinturas)

> Manual operativo para agentes (Claude Code) y desarrolladores que trabajen este repo.
> **Idioma de toda la documentación del proyecto: español.**
> Última actualización: 2026-06-21 · Estado: **Fase 1 — primeras pantallas** (specs aún
> pendientes; UI inicial sobre datos mock en memoria).

---

## 1. Resumen del proyecto

Sistema de **inventario web** para una empresa de pinturas con **varias sucursales**.

- **Solo navegador.** Los equipos de las sucursales tienen **bloqueo de instalación**, así
  que no se puede instalar software de escritorio ni desplegar app por app en cada lugar.
  Por eso es una aplicación web centralizada a la que se accede vía navegador.
- **Multi-sucursal.** El stock se controla por sucursal; debe soportar varios usuarios y
  roles trabajando en paralelo.

> ⚠️ Las **especificaciones funcionales aún no están definidas**. No inventes requisitos.
> Cuando falte un dato, márcalo como **supuesto** y regístralo en
> [`docs/CONTEXTO.md`](docs/CONTEXTO.md) → "Preguntas abiertas".

---

## 2. Stack tecnológico

| Capa             | Tecnología                                                       |
|------------------|------------------------------------------------------------------|
| App (front+back) | **Nuxt 4 (Vue 3 + TypeScript)** — UI + servidor Nitro            |
| Estado UI        | **Pinia** (`@pinia/nuxt`), Vue Router (incluido en Nuxt)         |
| UI               | Librería por decidir (Nuxt UI / PrimeVue / Element Plus)         |
| ORM              | **Drizzle ORM** + `drizzle-kit` (migraciones)                    |
| Base de datos    | **Supabase (PostgreSQL gestionado)**                             |
| Auth             | **Supabase Auth** (módulo `@nuxtjs/supabase`) + roles propios    |
| Hosting          | **Vercel** (despliegue del Nuxt)                                 |

### Historia de la decisión (por qué este stack)

La idea original era **Nuxt + TS + Drizzle**. Como el único hosting era **cPanel solo-PHP**,
se pivotó a un backend PHP/Laravel… pero el cPanel **no tiene SSH ni Composer**, lo que hace
**inviable operar Laravel** ahí (no se pueden instalar dependencias ni correr migraciones de
forma razonable). La empresa autorizó **Vercel**, una plataforma Node/serverless, lo que
**devuelve la viabilidad del stack original**: **Nuxt + Drizzle**, con **Supabase**
(Postgres + Auth) como base de datos gestionada. Decisión completa con alternativas en
[`docs/CONTEXTO.md`](docs/CONTEXTO.md).

---

## 3. Arquitectura y despliegue 

```
Equipo en sucursal (navegador)
        │  HTTPS
        ▼
Vercel  ── Nuxt 4 (Vue SPA + servidor Nitro) ──────────────┐
 ├── pages/ + components/        → interfaz (Vue)           │
 └── server/api/                 → API + lógica de negocio  │  (Drizzle)
                                                            ▼
Supabase
 ├── Auth      → login, sesiones, JWT
 └── Postgres  → datos del inventario  ◄── Drizzle se conecta aquí
```

- **Vercel** hospeda toda la app Nuxt (UI + servidor). Despliegue automático por cada push
  al conectar el repositorio.
- **Lógica de negocio** (movimientos de stock, transferencias) vive en `server/api/` y usa
  **Drizzle** contra el Postgres de Supabase, con **transacciones** para mantener
  consistencia entre sucursales/usuarios concurrentes.
- **Auth:** Supabase Auth gestiona login/sesiones; `@nuxtjs/supabase` aporta middleware de
  rutas y clientes (servidor/cliente).
- **Conexión a Postgres en serverless:** usar el **pooler de Supabase (Supavisor)** en
  runtime y la **conexión directa** para migraciones (ver §8).

---

## 4. Estructura de carpetas (propuesta)

```
Kilker_Inventory/
├── CLAUDE.md                ← este archivo
├── docs/
│   ├── CONTEXTO.md          ← negocio, decisiones (ADR), preguntas abiertas
│   ├── MODELO-DATOS.md      ← borrador del modelo de datos (Drizzle/Postgres)
│   └── ROADMAP.md           ← fases del proyecto
├── nuxt.config.ts
├── pages/                   ← rutas/páginas (Vue)
├── components/              ← componentes de UI
├── composables/  stores/    ← lógica reutilizable / estado Pinia
├── server/
│   ├── api/                 ← endpoints REST (lógica de negocio + Drizzle)
│   ├── db/
│   │   ├── schema.ts        ← schema Drizzle (fuente de verdad del esquema)
│   │   └── index.ts         ← cliente Drizzle
│   └── middleware/          ← verificación de auth/roles
├── drizzle/                 ← migraciones SQL generadas por drizzle-kit
└── drizzle.config.ts
```

> **Ubicación real del código:** la app Nuxt vive en el subdirectorio
> **`kilker-inventario/`** (no en la raíz del repo). Nuxt 4 usa `app/` como `srcDir`, así
> que las páginas/componentes/stores van en **`kilker-inventario/app/`**
> (`app/pages/`, `app/layouts/`, `app/components/`, `app/stores/`, `app/types/`,
> `app/assets/css/main.css`) y el backend en **`kilker-inventario/server/`** (aún sin crear).
> El esquema mostrado arriba es la organización lógica de referencia.

---

## 5. Comandos de desarrollo

> Ejecutar **dentro de `kilker-inventario/`** (es donde vive la app Nuxt). Los comandos de
> Drizzle son placeholders hasta crear `server/db/` (pendiente).

```bash
cd kilker-inventario
npm install
npm run dev                  # servidor de desarrollo Nuxt (http://localhost:3000)
npm run build                # build de producción
npx eslint .                 # lint (config en eslint.config.mjs vía @nuxt/eslint)

# (pendientes hasta crear server/db/schema.ts)
npx drizzle-kit generate     # genera SQL de migración desde server/db/schema.ts
npx drizzle-kit migrate      # aplica migraciones a Supabase
# (desarrollo rápido) npx drizzle-kit push
```

**Despliegue:** conectar el repo a **Vercel** → deploy automático en cada push. Configurar
variables de entorno (Supabase + `DATABASE_URL`) en el panel de Vercel (ver §8).

---

## 6. Convenciones

- **TypeScript strict**. **ESLint + Prettier**.
- **Esquema y datos:** se modifican **solo** vía **Drizzle** (`schema.ts` + migraciones de
  `drizzle-kit`). **Nunca** alterar el esquema a mano en el panel de Supabase (se
  desincroniza del `schema.ts`).
- **Secretos** (service_role key de Supabase, `DATABASE_URL`) **solo en el servidor**
  (`server/`), nunca en código cliente. Usar `runtimeConfig` de Nuxt.
- **Ramas:** `main` (estable) ← `Development` (integración). Feature branches → PR a
  `Development`.
- **Commits:** imperativo, Conventional Commits (`feat:`, `fix:`, `docs:`…).
- **Convención de trabajo del agente (acuse al usuario):** cada vez que el agente
  **termina de implementar un componente o una función**, debe cerrar ese mensaje con el
  nombre del usuario y una carita feliz, exactamente: **`Fernando 😊`**. Se aplica **una
  vez por componente/función completada**. Detalle y futuros acuerdos de trabajo en
  [`docs/CONVENCIONES-AGENTE.md`](docs/CONVENCIONES-AGENTE.md).

---

## 7. Auth y roles

- **Supabase Auth** vía `@nuxtjs/supabase` (email/contraseña; roles `admin | empleado`).
- Tabla **`profiles`** (1:1 con `auth.users`) guarda datos de aplicación + **rol** + `store_id`.
- Roles/permisos se verifican en `server/utils/auth.ts` → `requireProfile(event,{role})`
  (en endpoints de escritura) y `getOptionalProfile(event)` (para `GET /api/me`); reforzado
  con **RLS** en Supabase (sin policies = acceso solo server-side, que bypassa RLS).
- ⚠️ **Auth en la UI se hace con Bearer, NO con cookie.** Con este setup
  (`@nuxtjs/supabase` v2 + Nuxt 4), `serverSupabaseUser(event)` **no resuelve el usuario
  desde la cookie** aunque ésta sea válida y no esté expirada (verificado). El path
  `Authorization: Bearer <access_token>` sí funciona. Por eso las llamadas autenticadas del
  cliente (`/api/me` y todas las escrituras) adjuntan el Bearer tomado de la sesión viva de
  Supabase (`supabase.auth.getSession()`), que siempre está fresca. `requireProfile` acepta
  ambos paths. Las lecturas públicas (`/api/products`, `/api/stores`, `/api/categories`) no
  requieren auth y se sirven por SSR con `useFetch`.

---

## 8. Despliegue a Vercel + Supabase — caveats

- ⚠️ **Plan de Vercel:** el plan **Hobby es solo para uso NO comercial**. Para producción de
  empresa se requiere **Vercel Pro (~$20 USD/mes por usuario)**.
- ⚠️ **Plan de Supabase:** el **Free** pausa el proyecto tras inactividad y tiene límites de
  tamaño; producción probablemente requiera **Pro (~$25 USD/mes)**.
- **Conexión a Postgres en serverless:** usar la cadena del **pooler de transacciones
  (Supavisor, puerto 6543)** en runtime (con `prepare: false` en postgres.js) para no agotar
  conexiones; usar la **conexión directa (5432)** para `drizzle-kit migrate`.
- **Región:** elegir región de Vercel y de Supabase **cercana a México** para menor latencia.
- **Variables de entorno** en Vercel (nunca commitear `.env`): `SUPABASE_URL`,
  `SUPABASE_KEY` (anon/pública), `SUPABASE_SERVICE_KEY` (solo servidor), `DATABASE_URL`.

---

## 9. Reglas para agentes

1. **No inventes specs.** Si falta un requisito, márcalo como supuesto en "Preguntas
   abiertas" de [`docs/CONTEXTO.md`](docs/CONTEXTO.md).
2. **Documentación en español**, alineada con el resto de los `.md`.
3. **Mantén los docs sincronizados:** si cambias stack, arquitectura o modelo de datos,
   actualiza `CLAUDE.md`, `CONTEXTO.md`, `MODELO-DATOS.md` y `ROADMAP.md`.
4. **No alteres el esquema fuera de Drizzle** (ni a mano en Supabase).
5. **Sin PHP/Laravel ni servidores aparte:** el backend son las rutas `server/` de Nuxt
   (Node/TypeScript). Todo el stack es TypeScript.
6. **Secretos solo en el servidor.** Nunca exponer la service_role key ni `DATABASE_URL` al
   cliente.

---

## 10. Estado actual

- **Fase 0:** documentación y decisiones de arquitectura — **completada**.
- **Fase 1 (en curso):** UI conectada al backend real (specs aún pendientes).
  - Scaffold Nuxt 4 + Pinia + **Nuxt UI v4** (Tailwind v4) en `kilker-inventario/`.
  - **BD migrada y sembrada en Supabase** (12 tablas, enums, RLS, kardex append-only;
    incluye `cash_closeouts` para cortes de caja, migración `0003`).
  - **El mock de Pinia fue eliminado.** La UI consume el backend real:
    - **Lecturas públicas** vía `useFetch` (SSR): `GET /api/products`, `/api/stores`,
      `/api/categories`. Composables en `app/composables/useInventoryApi.ts`.
    - **Pantallas**: dashboard (`app/pages/dashboard.vue`), catálogo
      (`app/pages/productos/index.vue`), alta de producto (`app/pages/productos/nuevo.vue`),
      **entrada de stock** (`app/pages/movimientos/entrada.vue`) y **venta**
      (`app/pages/ventas/nueva.vue`).
    - **Layout responsivo** en `app/layouts/default.vue`: sidebar fija en desktop (md+);
      en móvil se oculta fuera de pantalla y se abre/cierra con un botón hamburguesa
      (overlay semitransparente, cierre al navegar o pulsar X). No hay nav compacta
      en el header: la sidebar es el único punto de navegación en todos los breakpoints.
    - Tipos alineados al backend en `app/types/inventario.ts` (ids numéricos; `unit`
      ∈ litro|galon|cubeta; los `numeric` llegan como **string** desde la API).
    - **Categorías (CRUD, admin)**: `app/pages/categorias/index.vue` (tabla con
      nombre/padre/nº productos + alta/edición inline + borrado con confirmación).
    - **Historial de ventas**: `app/pages/ventas/index.vue` (listado con filtros de
      estado y sucursal; empleado ve solo su tienda, admin todas; admin **anula** directo,
      empleado **solicita anulación** (abre ticket) o ve **"Esperando corrección"** si la
      venta ya tiene un ticket abierto — `GET /api/sales` expone `pendingCorrection`).
    - **Tickets de corrección**: `app/pages/tickets/index.vue` (empleado ve/solicita,
      admin aprueba→anula o rechaza). Composable `useTickets()`.
    - **Cortes de caja**: `app/pages/cortes/index.vue` (historial + "Hacer corte" +
      detalle/estado de cuenta del periodo). La venta (`ventas/nueva.vue`) ahora pide
      **método de pago** (efectivo/tarjeta). Composable `useCortes()`.
  - **Endpoints añadidos**: `GET /api/me` (perfil/rol; 204 si no hay sesión),
    `GET /api/categories` (enriquecido: `productCount`+`parentName`), `POST /api/products`
    (admin). Ya existían `POST /api/movements/entrada` (admin) y `POST /api/sales`
    (empleado/admin).
  - **Categorías (endpoints, admin)**: `POST /api/categories`, `PATCH /api/categories/:id`
    (valida ciclos de jerarquía), `DELETE /api/categories/:id` (bloquea 409 si tiene
    productos o subcategorías).
  - **Ventas / anulación (endpoints)**: `GET /api/sales` (lista; empleado→su tienda,
    admin→todas, filtros `status`/`storeId`), `GET /api/sales/:id` (detalle con líneas),
    `POST /api/sales/:id/void` (**solo admin**): en una transacción inserta movimientos
    `anulacion` que revierten cada `venta` (`reversesMovementId`), repone `inventory` y
    marca la factura `anulada` (`voidedAt/By/Reason`). Kardex append-only: el original no
    se toca. La lógica vive en `server/utils/corrections.ts` (`voidInvoiceTx`), compartida
    con la aprobación de tickets. El empleado **sí vende** (restringido a su tienda).
  - **Tickets de corrección (endpoints)**: `POST /api/tickets` (empleado/admin abre un
    ticket de anulación sobre una factura de su tienda; valida factura emitida y sin ticket
    abierto duplicado), `GET /api/tickets` (empleado→su tienda, admin→todos, filtro
    `status`), `POST /api/tickets/:id/resolve` (**solo admin**): `aprobar` ejecuta
    `voidInvoiceTx` y marca el ticket `aprobado` en una transacción; `rechazar` solo cierra
    el ticket. El empleado NO anula directo (403); abre ticket → admin resuelve. v1 solo
    target `factura` (target `movimiento` queda para después).
  - **Corte de caja (endpoints + esquema)**: enum `payment_method` (efectivo|tarjeta) +
    columna `invoices.payment_method` (default efectivo) + tabla `cash_closeouts`
    (migración `0003`). `POST /api/sales` guarda el método de pago. `POST /api/cortes`
    (empleado→su tienda, admin→cualquiera): toma la ventana **desde el corte anterior** de
    esa tienda (turnos) hasta ahora, suma las ventas EMITIDAS separando efectivo/tarjeta y
    cuenta las anuladas, y guarda el **snapshot** (resumen automático, sin conteo físico de
    efectivo). `GET /api/cortes` (lista) y `GET /api/cortes/:id` (detalle: snapshot + ventas
    del periodo). ⚠️ Los totales del corte son **inmutables** (foto al cierre); el detalle
    re-consulta el estado ACTUAL de cada venta (puede diferir si se anula después del corte).
  - **Auth en la UI (Bearer, no cookie):** ver §7 — el path por cookie de
    `serverSupabaseUser` NO resuelve aquí; las llamadas autenticadas (`/api/me` y
    escrituras) van con `Authorization: Bearer <access_token>` desde la sesión viva.
  - **Protección de rutas por rol (hecho):** guard global **solo-cliente** en
    `app/middleware/auth.global.ts` (la auth es client-only, el SSR no resuelve sesión).
    Sin sesión → `/login`; con sesión en `/login` → `/dashboard`; rutas marcadas con
    `definePageMeta({ requiresRole: 'admin' })` (alta de producto y entrada de stock)
    redirigen a `/dashboard` si el rol no coincide (carga el perfil con Bearer, reusa el
    estado `me`). Defensa en profundidad: los endpoints siguen exigiendo auth/rol
    (401/403). `RouteMeta.requiresRole` tipado en `app/types/route.d.ts`. ⚠️ Costo
    conocido: en cargas SSR de una ruta protegida **sin** sesión, el servidor renderiza
    la página y el cliente redirige → *hydration mismatch* + flash breve (solo afecta
    accesos sin sesión, que terminan en login igual). Se elimina si se pasa la app a
    SPA (`ssr:false`) — decisión pendiente del usuario.
- **Decidido:** Nuxt 4 + Drizzle + Supabase, desplegado en Vercel.
- **Pendiente / bloqueante:** especificaciones funcionales; movimientos de **ajuste** y
  **transferencia** entre sucursales; tickets target `movimiento` (v1 solo `factura`);
  folio secuencial formal; (opcional) corte con conteo físico de efectivo y detalle
  congelado; confirmación de planes/regiones.
- Ver el plan completo por fases en [`docs/ROADMAP.md`](docs/ROADMAP.md).
