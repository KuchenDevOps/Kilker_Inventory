# CLAUDE.md — Inventario Kilker (empresa de pinturas)

> Manual operativo para agentes (Claude Code) y desarrolladores que trabajen este repo.
> **Idioma de toda la documentación del proyecto: español.**
> Última actualización: 2026-08-04 · Estado: **app funcional end-to-end contra Supabase**
> (inventario, ventas, transferencias, gastos, cortes y reportes). Sin specs formales:
> los requisitos se han ido definiendo por QA con el cliente.
>
> ⚠️ **La fuente de verdad es el código**, no estos documentos. Ante cualquier duda:
> `kilker-inventario/server/db/schema.ts` (esquema), `server/api/` (reglas de negocio)
> y `app/` (UI).

---

## 1. Resumen del proyecto

Sistema de **inventario web** para una empresa de pinturas con **varias sucursales**.

- **Solo navegador.** Los equipos de las sucursales tienen **bloqueo de instalación**, así
  que no se puede instalar software de escritorio ni desplegar app por app en cada lugar.
  Por eso es una aplicación web centralizada a la que se accede vía navegador.
- **Multi-sucursal.** El stock se controla por sucursal; debe soportar varios usuarios y
  roles trabajando en paralelo.

> ⚠️ **No hay documento formal de especificaciones.** Los requisitos se han ido
> definiendo en rondas de QA con el cliente y quedaron plasmados **en el código**.
> No inventes requisitos: cuando falte un dato, márcalo como **supuesto** y regístralo en
> [`docs/CONTEXTO.md`](docs/CONTEXTO.md) → "Preguntas abiertas".

---

## 2. Stack tecnológico

| Capa             | Tecnología                                                       |
|------------------|------------------------------------------------------------------|
| App (front+back) | **Nuxt 4 (Vue 3 + TypeScript)** — UI + servidor Nitro            |
| Estado UI        | **Pinia** (`@pinia/nuxt`), Vue Router (incluido en Nuxt)         |
| UI               | **Nuxt UI v4** (Tailwind v4) + iconos `@iconify-json/lucide`     |
| ORM              | **Drizzle ORM** + `drizzle-kit` (migraciones)                    |
| Base de datos    | **Supabase (PostgreSQL gestionado)**                             |
| Auth             | **Supabase Auth** (módulo `@nuxtjs/supabase`) + roles propios    |
| Exportación      | **SheetJS (`xlsx`)** para exportar a Excel desde el cliente      |
| Hosting          | **Vercel** (despliegue del Nuxt)                                 |

> `pdfmake` y `@canvasjs/charts` están instalados pero **hoy no se usan** en `app/`
> (candidatos a limpiar o a usar cuando entren PDF/gráficas).

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

## 4. Estructura de carpetas (real)

La app Nuxt vive en el subdirectorio **`kilker-inventario/`** (no en la raíz del repo).
Nuxt 4 usa `app/` como `srcDir`.

```
Kilker_Inventory/
├── CLAUDE.md                    ← este archivo
├── docs/
│   ├── CONTEXTO.md              ← negocio, decisiones (ADR), preguntas abiertas
│   ├── MODELO-DATOS.md          ← modelo de datos real (resumen de schema.ts)
│   ├── ROADMAP.md               ← fases del proyecto
│   └── CONVENCIONES-AGENTE.md   ← acuerdos de trabajo agente ↔ usuario
└── kilker-inventario/
    ├── nuxt.config.ts  ·  drizzle.config.ts  ·  eslint.config.mjs
    ├── app/
    │   ├── pages/               ← rutas (productos, ventas, movimientos, transferencias,
    │   │                          gastos, clientes, cortes, tickets, tiendas, empleados…)
    │   ├── layouts/default.vue  ← sidebar + header (nav por rol, badge de sucursal)
    │   ├── components/          ← FiltroPeriodo.vue, FiltroCortePeriodo.vue
    │   ├── composables/         ← useInventoryApi.ts, usePages.ts, useExpenses.ts…
    │   ├── middleware/auth.global.ts  ← guard de sesión/rol (solo cliente)
    │   ├── types/               ← inventario.ts (contratos de la API), route.d.ts
    │   └── assets/css/main.css
    ├── server/
    │   ├── api/                 ← endpoints REST (lógica de negocio + Drizzle)
    │   ├── db/
    │   │   ├── schema.ts        ← schema Drizzle (FUENTE DE VERDAD del esquema)
    │   │   ├── index.ts         ← cliente Drizzle (useDb)
    │   │   ├── migrations/      ← SQL generado por drizzle-kit (0000–0022)
    │   │   └── seed.ts · seed-auth.ts
    │   └── utils/               ← auth.ts, corrections.ts, inventoryFifo.ts,
    │                              supabaseAdmin.ts
    └── scripts/                 ← utilidades puntuales (fix-transfer-costs.ts)
```

> ⚠️ No hay `stores/` de Pinia en uso: el estado compartido se resuelve con `useState`
> dentro de los composables. `@pinia/nuxt` sigue instalado pero sin stores propios.
> Las migraciones **no** están en `drizzle/` sino en **`server/db/migrations/`**
> (ver `drizzle.config.ts`).

---

## 5. Comandos de desarrollo

> Ejecutar **dentro de `kilker-inventario/`** (es donde vive la app Nuxt).

```bash
cd kilker-inventario
npm install
npm run dev                  # servidor de desarrollo Nuxt (http://localhost:3000)
npm run build                # build de producción
npx eslint .                 # lint (config en eslint.config.mjs vía @nuxt/eslint)
npm run typecheck            # chequeo de tipos (vue-tsc); eslint y dev NO chequean tipos

npm run db:generate          # genera SQL de migración desde server/db/schema.ts
npm run db:migrate           # aplica migraciones a Supabase (usa DIRECT_URL, puerto 5432)
npm run db:seed              # datos de prueba          (server/db/seed.ts)
npm run db:seed:auth         # usuarios de prueba en Auth (server/db/seed-auth.ts)
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

- **Supabase Auth** vía `@nuxtjs/supabase` (email/contraseña; roles
  `admin | empleado | observador | admin_tienda`).
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
  requieren auth; el resto de endpoints sí (`requireProfile`).
- **Reparto de permisos vigente (lo que hace el código hoy):**
  - **Solo admin:** alta/edición/borrado de productos y categorías, alta/edición de
    sucursales y usuarios, anulación de ventas (`POST /api/sales/:id/void`), resolución de
    tickets, anulación de entradas de stock (`POST /api/movements/:id/void`).
  - **Admin + empleado:** vender, registrar entradas, crear/recibir/cancelar
    transferencias, gastos y sus pagos, clientes, cortes de caja y abrir tickets.
  - **`admin_tienda` (administrador de sucursal):** es el encargado de UNA tienda,
    distinto del `admin` de la empresa. **Opera acotado a su sucursal igual que un
    empleado** (vende, captura entradas, transfiere, gastos, cortes, tickets) y
    además **gestiona el catálogo compartido**: alta y edición de productos, kits,
    **muestras** y categorías (rutas `/productos/nuevo`, `/productos/:id/editar`,
    `/categorias`).
    **No puede:** borrar del catálogo, anular ventas o entradas (abre ticket de
    corrección como el empleado), resolver tickets, ni administrar sucursales y
    usuarios. Lleva `store_id` obligatorio, igual que el empleado.
  - **Solo lectura (`observador`):** ve **todo** (todas las sucursales, todos los
    listados, tickets, cortes, gastos, sucursales y empleados) pero **no puede
    escribir nada**. El candado es central: `requireProfile` rechaza con 403
    cualquier método distinto de `GET` para los roles de `READ_ONLY_ROLES`
    (`server/utils/auth.ts`). Está ahí a propósito y no endpoint por endpoint —
    hay 14 rutas de escritura que llaman `requireProfile(event)` sin exigir rol,
    y así un endpoint nuevo nace protegido sin que nadie lo recuerde. En la UI el
    espejo es `canWrite` de `useMe()`, que **solo esconde botones**; la
    autorización real es la del servidor. Va sin sucursal (`store_id` null).
  - ⚠️ **Aislamiento por sucursal: el corte es `isStoreScopedRole(role)`, NO
    `role === 'empleado'`** (`server/utils/auth.ts`, espejo en la UI:
    `STORE_SCOPED_ROLES` de `app/types/inventario.ts` y `isStoreScoped`/
    `seesAllStores` de `useMe()`). Los roles acotados —hoy `empleado` y
    `admin_tienda`— solo operan y solo ven su tienda (el backend ignora el
    `storeId` del body y usa `profile.storeId`); `admin` y `observador` ven todas y
    pueden filtrar por `?storeId`. El literal `role === 'empleado'` estaba repetido
    en ~30 endpoints: cada copia era un sitio donde olvidar un rol acotado nuevo lo
    dejaba leyendo las ventas de las demás sucursales. **Un rol acotado nuevo se
    agrega en `STORE_SCOPED_ROLE_LIST` y nada más**; uno global no requiere tocar
    ningún `GET`. Los roles acotados exigen `store_id` (lo validan
    `POST /api/users` y `PATCH /api/users/:id`) y la baja de una sucursal los
    desactiva en cascada.
  - **Catálogo compartido:** `CATALOG_MANAGER_ROLES` (`admin`, `admin_tienda`) es lo
    que exigen los `POST`/`PATCH` de products (productos **y muestras**: es el mismo
    endpoint, con `sampleOfProductId`), kits y categories. Los `DELETE` siguen
    pidiendo `role: 'admin'` a secas. En la UI el espejo es `canManageCatalog` de
    `useMe()` (esconde botones; la autorización real es la del servidor).
- ⚠️ **`requireProfile` cachea el perfil** en dos niveles (`server/utils/auth.ts`):
  por request (`event.context`) y por token con **TTL de 60 s** a nivel de módulo.
  Sin esto, cada petición autenticada costaba un round-trip HTTP a
  `/auth/v1/user` de Supabase, y una sola carga del dashboard generaba ~50.
  **Consecuencia:** desactivar un usuario o cambiarle rol/sucursal tarda hasta 60 s
  en aplicar, salvo que se llame `invalidateProfileCache(userId)` — ya lo hacen
  `PATCH /api/users/:id` y `PATCH /api/stores/:id` (este último para la cascada a
  sus empleados). El caché es **por proceso**: en Vercel cada instancia tiene el suyo.

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
  `SUPABASE_KEY` (anon/pública), `SUPABASE_SERVICE_KEY` (solo servidor), `DATABASE_URL`
  (runtime, pooler 6543) y **`DIRECT_URL`** (5432, la que consume `drizzle.config.ts`
  para generar/aplicar migraciones).

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

## 10. Estado actual (agosto 2026)

La app **funciona end-to-end contra Supabase**: catálogo, entradas, ventas, transferencias,
clientes, gastos, cortes de caja, tickets, administración y reportes. Ya no queda nada de
datos mock. **Base de datos:** 17 tablas + 11 enums, migraciones `0000`–`0029` en
`server/db/migrations/` (RLS habilitado sin policies → acceso solo server-side).

> Este apartado es un **resumen**, no un changelog. La verdad está en el código:
> `server/db/schema.ts`, `server/api/**` y `app/**`.

### 10.1 Módulos implementados

| Módulo | Pantallas | Endpoints |
|--------|-----------|-----------|
| **Catálogo** | `productos/index`, `productos/nuevo` (pestañas Producto / Kit / **Muestras**; `?tipo=muestra\|kit` la preselecciona), **`productos/muestras`** (listado de muestras: SKU, nombre, base y precio $0 — sin existencias, porque son las del base), `productos/[id]/editar` | `GET/POST /api/products` (`?samples=exclude\|include\|only`), `GET/PATCH/DELETE /api/products/:id`, `GET /api/products/:id/inventory-value` |
| **Categorías** | `categorias/index` | `GET/POST /api/categories`, `PATCH/DELETE /api/categories/:id` |
| **Entradas de stock** | `movimientos/entrada`, `movimientos/index` | `POST /api/movements/entrada`, `GET /api/movements`, `POST /api/movements/:id/void` |
| **Ventas** | `ventas/nueva`, `ventas/index` | `POST/GET /api/sales`, `GET /api/sales/:id`, `POST /api/sales/:id/void` |
| **Transferencias** | `transferencias/nueva`, `transferencias/index` | `POST/GET /api/transfers`, `GET /api/transfers/:id`, `POST /api/transfers/:id/receive`, `POST /api/transfers/:id/cancel` |
| **Clientes** | `clientes/index` | `GET/POST /api/customers`, `PATCH/DELETE /api/customers/:id` |
| **Gastos** | `gastos/index` | `GET/POST /api/expenses` (filtros `?q`, `?paidBy`, `?type`, `?storeId`, fechas), `PATCH /api/expenses/:id`, `GET/POST /api/expenses/:id/payments` |
| **Cortes de caja** | `cortes/index` | `GET/POST /api/cortes`, `GET /api/cortes/:id` |
| **Tickets de corrección** | `tickets/ventas`, `tickets/entradas` (ambas montan `components/TicketsPanel.vue`; `tickets/index` solo redirige a ventas) | `GET/POST /api/tickets` (filtro `?target=factura\|movimiento`), `POST /api/tickets/:id/resolve` |
| **Administración** | `tiendas/index`, `empleados/index` | `GET/POST /api/stores`, `PATCH /api/stores/:id`, `GET/POST /api/users`, `PATCH /api/users/:id` |
| **Reportes / Dashboard** | `dashboard` | `GET /api/dashboard/summary` (agregado del dashboard), `GET /api/reports/monthly-inventory`, `/api/reports/top-products`, `/api/reports/inventory-value`, `/api/average-costs` |

- **Auth/UI:** login por Supabase Auth, guard global solo-cliente
  (`app/middleware/auth.global.ts`), nav en secciones plegables filtrada por rol y badge de
  sucursal en el header (`app/layouts/default.vue`). Layout responsivo (sidebar fija en
  desktop, drawer en móvil).
- **Paginación** (`?page&pageSize`, respuesta `{data,total,page,pageSize}`) en products,
  movements, sales, transfers, tickets, cortes, customers, expenses y users. Sin `page` en
  la query, esos endpoints devuelven el arreglo completo (lo usan las exportaciones).
  ⚠️ **Excepción: `GET /api/sales`.** Sin `?page` recorta a **200 filas** salvo que se
  mande `?all=true`, y lo hace en silencio (devuelve un arreglo que parece completo). Por
  eso las exportaciones de `/ventas` salían truncadas. Usar siempre `useAllSales()`
  (`useInventoryApi.ts`), que manda el flag, en vez de pegarle al endpoint a mano.
- **Filtros compartidos:** `app/components/FiltroPeriodo.vue` y `FiltroCortePeriodo.vue`
  (Todo/Día/Semana/Mes sobre el periodo concreto elegido + búsqueda `?q`).
- **Exportación a Excel** (SheetJS, en el cliente) desde catálogo (valor de inventario),
  historial de entradas e historial de ventas (hoja resumen + hoja de líneas), con dos
  variantes: "Exportar todo" y "Exportar con filtro".

### 10.2 Reglas de negocio implementadas (lo no obvio)

- **Kardex append-only.** `stock_movements` nunca se actualiza ni se borra (trigger en la
  migración `0001`); toda corrección es una fila nueva `anulacion` ligada por
  `reverses_movement_id`. `inventory.quantity` es el saldo materializado que se mueve en la
  misma transacción.
- ⚠️ **Toda operación que valida un estado y luego actúa bloquea la fila primero**
  (`SELECT … FOR UPDATE` dentro de la transacción). En READ COMMITTED, leer
  `status` y decidir sin candado deja pasar dos peticiones simultáneas —basta un
  doble clic— y el efecto se aplica dos veces (stock duplicado, corte repetido).
  Ya lo hacen: `transfers/:id/receive`, `transfers/:id/cancel`, `tickets/:id/resolve`,
  `voidInvoiceTx`, `voidMovementTx`, `POST /api/sales` (folio **y existencias**) y
  `POST /api/cortes`. ⚠️ En ventas el candado de la tienda se toma **antes** de validar
  el stock: cuando se tomaba después (solo para el folio), dos ventas simultáneas del
  último artículo leían el mismo saldo, las dos pasaban y el stock quedaba en negativo
  — que es como nacen las ventas sin respaldo que descuadran el inventario.
  **Cualquier endpoint nuevo con el patrón "leer estado → actuar" debe hacer lo mismo.**
- **Fecha efectiva de un movimiento** (`server/utils/movementDates.ts`):
  `coalesce(supplier_invoice_date, created_at)` — la de la factura del proveedor si
  existe, si no la de captura. `supplier_invoice_date` es **nullable**, y compararla a
  secas hacía desaparecer del filtro por periodo toda entrada sin factura (`NULL >= …`
  es falso en SQL). El helper existe en las dos formas —`effectiveMovementDateSql()`
  para los filtros y `effectiveMovementDate()` para las reconstrucciones FIFO en TS—
  precisamente para que las dos no vuelvan a divergir. Úsalo siempre; no compares
  `supplier_invoice_date` directamente.
- **Costeo FIFO** — motor único en **`server/utils/fifoEngine.ts`**. Reconstruye capas de
  costo desde el histórico completo (entradas, transferencias, ajustes, anulaciones y
  ventas emitidas, ordenadas por fecha efectiva —`supplier_invoice_date` cuando existe—).
  Lo consumen `monthlyInventory.ts` (valuación), `topProducts.ts` (costo de lo vendido) e
  `inventoryFifo.ts` (transferencias, vía `getFifoUnitCost`). **Estaba triplicado y las
  tres copias divergían**, y de ahí salía el descuadre entre el inventario final y
  "inicial + compras − costo". Dos reglas no obvias:
  - **Vender sin existencia deja una deuda explícita** (capa negativa), costeada con la
    compra que termina cubriéndola. Antes el faltante se cobraba a *precio de venta* en el
    costo y el inventario lo borraba de golpe cuando el saldo volvía a cero, sin dejar
    rastro. El valor al corte **puede ser negativo**: significa que se vendió lo que no
    había.
  - **Anular una entrada revierte su propia capa**, no la más antigua (por
    `reverses_movement_id`). Si no, anular una entrada capturada con costo $0 sacaba del
    almacén una pieza que valía miles.
  - `computeMonthlyInventory` devuelve `inflowsValue`, `soldCost`, `otherOutflowsCost` y
    `uncoveredSale*`: con ellos **cuadra exacto** `inicial + entradas − costo de lo vendido
    − otras salidas = final` (verificado a $0.00 en ene–ago 2026, global y por sucursal).
  **No hay costeo por lote en la captura**: la entrada toma `products.cost` salvo que se
  mande `unitValue` explícito. ⚠️ `products.cost` está en **NULL en 254 de 264 productos**,
  así que hoy ese respaldo no existe y hay 23 entradas capturadas con costo $0.
- **Valuación de inventario a un corte arbitrario** (`server/utils/monthlyInventory.ts`):
  pese al nombre, ya no es solo "por mes cerrado". Acepta `from`/`to` (`to` **exclusivo**) y
  valúa el inventario **al instante `to`**; sin ellos cae al mes completo de `month`. El
  dashboard le pasa el rango del filtro de periodo, así que con "Semana" (o "Día") el
  inventario queda cortado al último día del rango, no al fin de mes. Ojo: los flujos que
  devuelve (`entriesValue`, `exitsValue`, transferencias, anulaciones, ajustes) también se
  miden sobre esa ventana, no sobre el mes. `month` se sigue mandando y sirve de etiqueta y
  de default; el dashboard lo deriva del **último día** del rango (`derivedMonth`).
- **Folios.** Ventas: `<CODE_TIENDA>-0001`, correlativo por tienda (`count(*)+1` bajo
  `SELECT … FOR UPDATE` de la tienda). Entradas: `<CODE_TIENDA>-E-0001`, con contador
  dedicado `entry_folio_counters` (upsert atómico).
- **Ventas.** Método de pago (efectivo/tarjeta/transferencia), canal (mostrador/en línea),
  cliente opcional, **descuento en % a nivel factura** (`discount_pct`/`discount_amount`).
  Admiten **fecha retroactiva**: si la fecha es pasada, además del stock actual se valida
  que **a esa fecha** el kardex ya tuviera existencia suficiente. La anulación revierte
  kardex e inventario y marca la factura `anulada`.
- ⚠️ **Muestras: producto propio, inventario del base.** Una muestra es una fila de
  `products` con `sample_of_product_id` → producto base: tiene SKU y nombre propios y
  se elige al vender como cualquier otro producto, pero **no tiene inventario ni
  kardex propios**. `POST /api/sales` la **resuelve al producto base antes de validar
  existencias** (`stockProductId()` de `server/utils/samples.ts`), y a partir de ahí
  todo —`inventory`, `stock_movements` e `invoice_items.product_id`— habla del base:
  es el mismo truco con el que un kit se "explota" en sus productos. De la muestra
  solo queda el marcador `invoice_items.sample_product_id` (+ snapshot sku/name) y el
  precio, que **siempre es 0** (constraint `products_sample_price_zero`; el servidor
  ignora el `unitPrice` que mande el cliente). Consecuencias no obvias:
  - **Resolver ANTES de validar el stock no es cosmético:** es lo que hace que
    `requiredByProduct` sume en el mismo cubo el producto vendido normal y el
    entregado como muestra en la misma venta. Al revés, cada uno validaría contra el
    saldo completo por separado y en conjunto podrían pasar de las existencias.
  - **Si la muestra moviera stock con su propio id**, tendría capas FIFO propias sin
    una sola entrada que las cubriera: cada muestra nacería como venta descubierta
    (deuda negativa) y el inventario del producto real nunca bajaría.
  - **No se compra, no se transfiere y no entra en kits** — `assertNotSample()` lo
    rechaza en entradas, transferencias y kits; eso va contra el producto base.
  - **`GET /api/products` NO devuelve muestras por omisión** (`?samples=exclude`). Es
    el fail-safe: ese endpoint alimenta el catálogo, el dashboard, las exportaciones
    de valor de inventario y los pickers de entradas/kits/transferencias, y una
    pantalla nueva no debe heredar muestras sin pedirlas. Las piden `?samples=include`
    (venta, vía `useSellableProducts()`) y `?samples=only`. En una muestra,
    `totalStock`/`byStore` vienen ya resueltos con los del producto base.
  - **Una muestra sale como venta de $0 con folio** y entra al corte de caja; su costo
    cae en *costo de lo vendido* con ingreso 0. Separarlo en un reporte propio no
    requiere migración: la marca ya está en la línea.
- ⚠️ **El descuento es de la FACTURA, no de la línea.** `invoice_items.line_total` es
  **bruto**: no lleva descuento aplicado. Todo reporte que sume ingresos por línea tiene
  que prorratearlo (`line_total * (1 - discount_pct/100)`) o dará una cifra de ventas
  distinta a `sum(invoices.total_amount)`. Ya lo hacen `topProducts` (ingreso y
  `soldTotals`) y `monthlyInventory` (`exitsValue`). Si algún día hay descuento por
  línea, lo correcto será guardar el neto en la BD (`line_total_net`) en vez de seguir
  reconstruyéndolo.
- **IVA (16%) es informativo y se calcula en la app**, no se guarda en la BD: en el detalle
  de venta y en gastos. Las ventas se registran sin desglose fiscal (no hay CFDI/SAT).
- **Transferencias en dos fases.** Al crearlas descuentan el origen y quedan
  `en_transito`; el destino (o un admin) confirma la recepción y ahí se suma el inventario
  destino; cancelar repone el origen. Un empleado solo despacha desde su tienda y solo
  recibe en la suya.
  ⚠️ **La reversa de una cancelación es `anulacion`, no `ajuste`** (ligada por
  `reverses_movement_id` a la `transferencia_salida`). Con `ajuste` los reportes la leían
  como una **entrada nueva**: creaba una capa FIFO fechada el día de la cancelación en
  vez de restaurar la original, y contaminaba `adjustmentsValue` del dashboard.
  Y en todas las reconstrucciones FIFO (`inventoryFifo`, `monthlyInventory`,
  `topProducts`, ambos `inventory-value`) los movimientos de una transferencia
  `cancelada` **se ignoran por completo** —la salida *y* su reversa— con un
  `if (transfer.status === 'cancelada') continue`. Así el FIFO queda como si nunca
  hubiera salido, y una transferencia cancelada deja de inflar `transfersOut*`.
- **Gastos.** Cabecera + `expense_items` (conceptos) + `expense_payments` (parcialidades,
  con `paid_by` y método). Tipo `Fijo|Operativo`, retenciones IVA/ISR opcionales; el
  endpoint deriva `subtotal`, `iva`, `totalToPay`, `totalPaid`, `balance` y
  `paymentStatus` (pendiente/parcial/pagado).
- **Bajas suaves en todo:** productos, sucursales, clientes y empleados se **desactivan**
  (`is_active`), no se borran. El único `DELETE` duro es de productos sin historial y de
  categorías sin hijos ni productos (si no, 409). Desactivar una sucursal **propaga** el
  estado a sus empleados (y reactivarla los reactiva).

### 10.3 Pendiente / deuda técnica

- ⚠️ **Ventas retroactivas vs. cortes de caja — abierto, decisión del cliente.** El corte
  toma la ventana `[último periodTo, ahora)` sobre `invoices.issued_at`, pero una venta se
  puede capturar con fecha pasada: si esa fecha es anterior al último corte, la venta **no
  cae en ningún corte, nunca**. El doble conteo por cortes simultáneos ya está resuelto
  (el corte es transaccional, con la tienda bloqueada); esto no. Las dos salidas —cortar
  por `created_at`, o prohibir capturar ventas anteriores al último corte— están en
  [`docs/CONTEXTO.md`](docs/CONTEXTO.md) → "Preguntas abiertas".
- **Movimientos de `ajuste`:** el enum y el soporte en los cálculos FIFO existen, pero
  **no hay endpoint ni pantalla** para capturarlos. Ojo: hoy **ninguna** fila de la BD es
  un `ajuste` real, así que el tipo está libre para cuando se implemente.
- **Vista de kardex unificado:** `/movimientos` solo lista `type='entrada'`. Faltan
  ventas/anulaciones/transferencias/ajustes en una sola vista.
- **`GET /api/reports/unsold-products` es un stub** (devuelve `'Hello Nitro'`); la UI cubre
  el caso vía `?includeUnsold` de `top-products`.
- **Limpieza:** `pdfmake` y `@canvasjs/charts` instalados sin uso; `MODELO-DATOS.md` se
  mantiene como resumen del esquema real.
- **Caché de reportes:** `top-products` cachea 60 s **en memoria del proceso** (ahora en
  `server/utils/topProducts.ts`); con varias instancias en Vercel cada una tendrá la suya
  (mover a Redis si hace falta coherencia). Lo mismo aplica al caché de perfiles de §7.
- **Composables muertos:** tras mover el dashboard a `/api/dashboard/summary`, quedaron sin
  usar `useSales`, `useMovements` (ambos en `useInventoryApi.ts`) y `useAllExpenses` (en
  `useExpenses.ts`). Las páginas usan las variantes paginadas de `usePages.ts`
  (`useSalesHistory`, `useMovementsHistory`) y `useExpenses`. `useSales` además registra su
  `watch` y su listener de `visibilitychange` **sin guard** (cada montaje acumulaba otro);
  está inerte mientras nadie lo llame, pero conviene borrarlo antes de que alguien lo use.
- **Tickets:** cubren los dos `target`, con **una pantalla por tipo** —
  `/tickets/ventas` y `/tickets/entradas`, ambas montando el mismo
  `components/TicketsPanel.vue` parametrizado por `target`. `factura` → aprobar anula la
  venta; `movimiento` → aprobar anula la entrada de stock. Ambos comparten
  `voidInvoiceTx`/`voidMovementTx` de `server/utils/corrections.ts` con los endpoints de
  anulación directa del admin.
  ⚠️ `useTicketsHistory(target)` **namespacea su `useState` por target**: con claves
  compartidas, una pantalla pisaba el listado y el filtro de la otra.
- **Hardening:** policies de RLS (hoy innecesarias: todo el acceso es server-side),
  migrar `SUPABASE_SERVICE_KEY` → `NUXT_SUPABASE_SECRET_KEY`, confirmar planes/regiones de
  Vercel y Supabase, backups.
- **Conocido:** en cargas SSR de una ruta protegida sin sesión hay *hydration mismatch* +
  flash breve (el guard es solo-cliente). Se elimina pasando la app a SPA (`ssr: false`).

- Ver el plan por fases en [`docs/ROADMAP.md`](docs/ROADMAP.md) y el modelo de datos en
  [`docs/MODELO-DATOS.md`](docs/MODELO-DATOS.md).
