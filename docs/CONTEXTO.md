# CONTEXTO — Inventario Kilker

> Contexto de negocio y técnico, decisiones de arquitectura y preguntas abiertas.
> Idioma: español. Última actualización: 2026-08-04.
>
> ⚠️ Nunca llegó un documento formal de specs: los requisitos se resolvieron por **QA con
> el cliente** y viven en el código. Las respuestas de §5 se marcan como **resueltas por
> implementación** cuando se dedujeron de lo construido, no de un documento firmado.

---

## 1. Problema

La empresa de pinturas necesita controlar su **inventario en varias sucursales**. Hoy no
hay un sistema centralizado. Se requiere una herramienta que:

- Funcione en **todas las sucursales a la vez**, sin instalaciones por equipo.
- Permita registrar **entradas, salidas y existencias por sucursal**.
- Sea usable por personal no técnico, desde un navegador.

---

## 2. Usuarios y contexto de uso

- **Sucursales:** varias, administrables desde la app (alta/edición/desactivación); el
  número exacto lo define el cliente al capturarlas.
- **Equipos con bloqueo de instalación:** solo se puede usar el **navegador**. No se
  pueden instalar programas de escritorio ni desplegar app por app → **app web central**.
- **Roles (implementados):** **`admin`** (acceso global a todas las sucursales, gestiona
  catálogo, usuarios, sucursales y autoriza anulaciones) y **`empleado`** (atado a una
  sucursal: vende, registra entradas, transfiere, captura gastos/clientes y hace cortes;
  no anula, solo **solicita** correcciones vía ticket). Se descartó el desglose
  bodega/ventas del planteamiento inicial.

---

## 3. Restricciones

| Restricción                          | Implicación                                              |
|--------------------------------------|---------------------------------------------------------|
| Bloqueo de instalación en sucursales | Solo navegador → app web centralizada                   |
| cPanel **sin SSH ni Composer**       | Inviable operar Laravel/PHP ahí → se descartó cPanel    |
| Empresa autorizó **Vercel**          | Plataforma Node/serverless → viable Nuxt + Drizzle      |
| Serverless (Vercel)                  | La base de datos va en un servicio gestionado aparte    |
| Conectividad de sucursales (¿?)      | Si es inestable, evaluar PWA/offline (pendiente)        |

---

## 4. Decisión de arquitectura (ADR ligero)

### Recorrido de la decisión

1. **Idea original:** stack todo-TypeScript, **Nuxt/Vue + TS + Drizzle**.
2. **Restricción de hosting:** el único hosting disponible era **cPanel solo-PHP + MySQL**.
   Como Drizzle corre en Node, se pivotó a **backend PHP/Laravel** sobre ese cPanel.
3. **Bloqueo real:** el cPanel **no tiene SSH ni Composer** → instalar dependencias y correr
   migraciones de Laravel es inviable en la práctica. El camino cPanel/Laravel queda muerto.
4. **Autorización de la empresa:** se aprobó usar **Vercel**. Al ser Node/serverless,
   **vuelve a ser viable el stack original** (Nuxt + Drizzle).
5. **Datos:** como Vercel es serverless (no hospeda una base propia), se eligió **Supabase**
   (Postgres gestionado + Auth). Se descartó reusar la MySQL del cPanel vía Remote MySQL.

### Alternativas consideradas

| Opción | Descripción | Resultado |
|--------|-------------|-----------|
| **Nuxt + Drizzle + Supabase en Vercel** ✅ | Todo TypeScript: UI + API (Nitro) en Vercel; Drizzle sobre Postgres de Supabase; Supabase Auth | **ELEGIDA.** Recupera el stack original, un solo lenguaje, base + auth gestionadas, despliegue automático. |
| Vue SPA + Supabase directo (RLS) | SPA habla directo a Supabase, sin backend propio ni Drizzle | Descartada: la lógica transaccional de stock (varias tablas, concurrencia) es más difícil y arriesgada solo con RLS. |
| Vue SPA + Laravel en cPanel | Backend PHP en el cPanel existente | Descartada: el cPanel **no tiene SSH ni Composer** → inviable. |
| Reusar MySQL de cPanel (Remote MySQL) | Conectar Vercel a la MySQL del cPanel | Descartada: serverless + MySQL compartido = problemas de conexiones/latencia y exposición de la base. |
| PlanetScale (MySQL serverless) | Mantener MySQL | Descartada por ahora: ya no tiene plan gratis. |

### Decisión

**Nuxt 4 (Vue 3 + TypeScript) + Drizzle ORM + Supabase (Postgres + Auth), desplegado en
Vercel.**

### Consecuencias

- ✅ Stack **todo-TypeScript** en un único codebase (UI + API en Nuxt).
- ✅ Base de datos y autenticación **gestionadas** (Supabase), sin administrar servidores.
- ✅ Despliegue automático y sencillo (Vercel).
- ➖ Motor de base de datos pasa de MySQL a **PostgreSQL** (sin impacto: proyecto nuevo).
- ➖ Costos: **Vercel Pro** (uso comercial) y posiblemente **Supabase Pro** en producción.

> Detalle del stack y despliegue en [`../CLAUDE.md`](../CLAUDE.md).

---

## 5. Preguntas abiertas

> Lo marcado **[x]** ya está **resuelto por implementación** (así funciona el código hoy).
> Lo marcado **[ ]** sigue sin confirmar.

### Zona horaria del negocio
- [ ] **¿Todas las sucursales operan en el centro de México (UTC−6)?** Las columnas
  `date` (p. ej. `supplier_invoice_date`) no traen hora, y los periodos del dashboard
  se arman en hora local del navegador. Para que una entrada fechada el día 1 no caiga
  en el mes anterior, `server/utils/businessTime.ts` fija el offset en **UTC−6** (el
  país dejó el horario de verano en octubre de 2022). **Supuesto del agente.** Si
  llega a haber sucursales en Quintana Roo (UTC−5) o Baja California (con horario de
  verano), el offset tiene que pasar a ser por sucursal.

### Plataforma / costos — **siguen pendientes, hoy son lo bloqueante**
- [ ] **Vercel Pro** confirmado para uso comercial (~$20 USD/mes/usuario)?
- [ ] **Plan de Supabase**: ¿Free para arrancar y Pro (~$25/mes) en producción? Límites.
- [ ] **Región** de Vercel y Supabase más cercana a México (latencia).
- [ ] Dominio propio para la app.

### Auth
- [x] **Proveedor de login:** email + contraseña de Supabase Auth. **No hay invitación por
      correo**: el admin crea la cuenta y **define la contraseña** (`POST /api/users`, con
      `email_confirm`). Dar de baja = `is_active = false` (no se borra el usuario de Auth).
- [x] **Roles y permisos:** `admin` y `empleado` (detalle en §2 y en `CLAUDE.md` §7).

### Negocio / dominio
- [x] **Atributos del catálogo:** se descartaron `base`/`acabado`/`volumen`/`marca`. El
      producto tiene `color` (texto libre) + `unit` ∈ **{litro, galon, cubeta, pieza,
      cuarto, tambo}** (se ampliaron por QA), `price`, `cost`, `min_quantity`,
      `max_quantity` y `barcode`. Un producto = **una variante vendible (1 SKU)**.
- [x] **Transferencias entre sucursales:** **sí**, implementadas en dos fases (despacho →
      recepción/cancelación).
- [x] **Reportes y exportación:** **sí**, hay reportes de valuación, costo promedio y
      utilidad por producto, con **exportación a Excel**. PDF sigue sin hacerse.
- [x] **Facturación:** el comprobante es **interno** (folio propio por sucursal), **sin
      CFDI/SAT**. El IVA (16%) se muestra como dato informativo calculado en la app.
- [x] **Costeo:** **FIFO calculado sobre el kardex** para valuación y utilidad; la captura
      de entradas usa el **costo estándar** del producto (`products.cost`), sin costeo por
      lote.
- [x] **Alcance más allá del stock:** además de inventario se maneja **caja** (cortes por
      turno), **clientes** y **gastos** (con parcialidades y retenciones IVA/ISR).
- [x] **Idioma de la interfaz:** español.
- [ ] **Nº de sucursales** y de **usuarios** reales en producción.
- [ ] **Estabilidad de internet** en sucursales → ¿se necesita **offline/PWA**?
- [ ] ¿Manejo de **lotes/caducidad**? (hoy no) ¿Uso real de **códigos de barras**? (el
      campo existe, falta lectura/impresión)
- [ ] ¿**Órdenes de compra** o basta con las entradas de stock?
- [ ] ¿Hace falta capturar **movimientos de ajuste** de inventario? (enum listo, sin UI)
- [ ] ¿El corte de caja debe incluir **conteo físico de efectivo** (hoy es solo el resumen
      automático de ventas)?
- [ ] **Ventas retroactivas vs. cortes de caja — decisión pendiente.** El corte toma la
      ventana `[último periodTo, ahora)` sobre `invoices.issued_at`, pero una venta se
      puede capturar con fecha pasada. Si esa fecha es anterior al último corte, la venta
      **no entra en ningún corte, nunca**. Opciones sobre la mesa:
      **(a)** cortar por `created_at` (la venta se corta cuando se capturó, que es cuando
      entró el dinero al cajón) — el corte cuadra con la caja física, pero el corte deja de
      coincidir con la fecha declarada de la venta;
      **(b)** bloquear la captura de ventas con fecha anterior al último corte de esa
      sucursal — el corte queda intacto, pero obliga a que las correcciones tardías pasen
      por anulación en vez de por fecha retroactiva.
      Mientras se decide, el corte ya es **transaccional** (candado sobre la tienda), así
      que el doble conteo por cortes simultáneos está resuelto; lo retroactivo no.

---

## 6. Glosario

- **Sucursal (`stores`):** punto físico con su propio stock. Su `code` se usa en los folios.
- **Movimiento (`stock_movements`):** cualquier cambio de stock (venta, entrada, ajuste,
  transferencia de salida/entrada, anulación) en un producto y sucursal.
- **Kardex:** el libro de movimientos. Es **append-only**: no se edita ni se borra; corregir
  significa agregar un movimiento de `anulacion` que apunta al original.
- **Transferencia (`transfers`):** envío de existencias de una sucursal a otra. Descuenta al
  despachar y suma al **recibir**.
- **Ticket de corrección (`tickets`):** solicitud del empleado para anular una venta; solo
  el admin la aprueba (y ahí se ejecuta la anulación) o la rechaza.
- **Corte de caja (`cash_closeouts`):** resumen inmutable de las ventas de una sucursal
  desde el corte anterior, separando efectivo / tarjeta / transferencia.
- **Folio:** consecutivo interno por sucursal. Ventas `<CODE>-0001`; entradas
  `<CODE>-E-0001`. No es un folio fiscal.
- **FIFO:** método de costeo (primeras entradas, primeras salidas) con el que se valúa el
  inventario y se calcula la utilidad. Se reconstruye desde el kardex, no se guarda.
- **SKU:** identificador único de un producto/variante.
- **RLS (Row Level Security):** reglas de acceso a nivel de fila en Postgres/Supabase. Aquí
  está **habilitado sin policies**: nadie entra desde el cliente, todo pasa por el servidor.
