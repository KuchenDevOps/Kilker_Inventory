# ROADMAP — Inventario Kilker

> Cómo dirigir el proyecto por fases. Idioma: español.
> Última actualización: 2026-08-04 · Fase actual: **Fase 5 (hardening y producción)**.
>
> ⚠️ El proyecto **no siguió el orden original de fases**: al no llegar specs formales, se
> construyó producto directamente con QA del cliente. Este documento ya refleja lo que
> **realmente está hecho** (fuente: el código, no los docs).

---

## Visión

Entregar un sistema de inventario web, multi-sucursal, accesible solo por navegador.
Stack: **Nuxt 4 (Vue 3 + TS) + Drizzle + Supabase**, desplegado en **Vercel**.

---

## Fase 0 — Documentación y decisiones · **completada**

`CLAUDE.md`, `docs/CONTEXTO.md`, `docs/MODELO-DATOS.md`, `docs/ROADMAP.md` escritos y
consistentes. Stack decidido (ADR en `CONTEXTO.md`).

---

## Fase 1 — Specs y entorno · **parcial (no bloquea)**

- ❌ **No hubo documento formal de especificaciones.** Los requisitos se definieron en
  rondas de QA con el cliente y quedaron **codificados en la app**.
- ✅ Modelo de datos validado en la práctica (22 migraciones de ajustes reales).
- ⏳ **Pendiente:** confirmar planes y regiones (Vercel Pro para uso comercial, plan de
  Supabase, región cercana a México) y dominio propio. Ver "Preguntas abiertas" de
  [`CONTEXTO.md`](CONTEXTO.md).

---

## Fase 2 — Scaffold y cimientos · **completada**

- Nuxt 4 + TS + Pinia + **Nuxt UI v4** (Tailwind v4) en `kilker-inventario/`.
- **Supabase Auth** vía `@nuxtjs/supabase` (login, guard de rutas por rol).
- **Drizzle + drizzle-kit** configurados (`server/db/schema.ts`, migraciones en
  `server/db/migrations/`, pooler en runtime / `DIRECT_URL` para migrar).
- Esquema inicial + seeds (`db:seed`, `db:seed:auth`), ESLint y `npm run typecheck`.

---

## Fase 3 — Núcleo del inventario · **completada**

- **Catálogo** de productos (alta/edición/borrado admin, unidades, precio, costo, mín/máx,
  código de barras) y **categorías** (CRUD jerárquico).
- **Sucursales** y **stock por sucursal** (desglose `byStore` en el catálogo).
- **Movimientos:** entradas de stock (con folio interno y factura de proveedor) y ventas,
  ambas transaccionales sobre el kardex append-only.
- **Auth + roles** aplicados a UI (nav filtrada, guard) y a `server/api/` (401/403).
- **Extras del núcleo:** clientes, métodos de pago, canal de venta, descuento por factura,
  ventas con fecha retroactiva validada contra el kardex.

---

## Fase 4 — Transferencias, reportes y auditoría · **casi completa**

**Hecho:**
- **Transferencias entre sucursales en dos fases** (despacho → `en_transito` → recepción o
  cancelación), valuadas por FIFO.
- **Anulación de ventas y de entradas** (admin) + **tickets de corrección** (el empleado
  solicita, el admin aprueba/rechaza).
- **Cortes de caja** por turno con snapshot inmutable (efectivo/tarjeta/transferencia).
- **Gastos** con conceptos, retenciones IVA/ISR y pagos en parcialidades.
- **Reportes:** valuación mensual de inventario, valor de inventario a una fecha, costo
  promedio y productos más vendidos con **costo y utilidad FIFO**. Dashboard con filtros de
  sucursal y periodo.
- **Exportación a Excel** (SheetJS) de catálogo/valor de inventario, entradas y ventas.

**Falta:**
- Movimientos de **ajuste** de inventario (enum listo, sin endpoint ni pantalla).
- **Kardex unificado**: hoy `/movimientos` solo muestra entradas.
- `GET /api/reports/unsold-products` es un **stub**.
- Exportación a **PDF** (`pdfmake` instalado, sin usar).

---

## Fase 5 — Hardening y producción · **en curso**

- Policies de **RLS** (hoy innecesarias: todo el acceso es server-side; obligatorias si
  algún día el cliente habla directo con Supabase).
- Migrar `SUPABASE_SERVICE_KEY` → `NUXT_SUPABASE_SECRET_KEY`.
- Quitar logs de depuración (`top-products`) y dependencias sin uso.
- **Backups** de Supabase y estrategia de recuperación.
- **Producción en Vercel:** plan Pro, dominio, variables de entorno, región.
- Decidir si la app pasa a **SPA (`ssr: false`)** para eliminar el *hydration mismatch* del
  guard solo-cliente.
- **Capacitación** a los usuarios de sucursales.

**Hecho cuando:** la app corre en producción (Vercel + Supabase) y las sucursales la usan.

---

## Fase 6 — Mejoras (futuro)

- **PWA / offline** si la conectividad de las sucursales lo exige.
- **Códigos de barras**: el campo existe en `products`; falta lectura/impresión.
- Integración con **facturación/POS** (hoy el comprobante es interno, sin CFDI).
- Lotes/caducidad y costeo por lote, si se confirman.
- Descuentos por línea/combo (`discount_type` ya está declarado en el esquema).

---

## Cómo deben proceder los próximos agentes

1. Leer primero [`../CLAUDE.md`](../CLAUDE.md) y [`CONTEXTO.md`](CONTEXTO.md).
2. **La fuente de verdad es el código**, no estos `.md`. Verifica en
   `server/db/schema.ts` y `server/api/` antes de asumir cualquier cosa.
3. Registrar como supuesto en "Preguntas abiertas" lo que no esté confirmado.
4. Mantener los documentos sincronizados con cada decisión (regla 3 de `CLAUDE.md`).
5. Todo el stack es TypeScript: backend en `server/` de Nuxt; esquema solo vía Drizzle.
