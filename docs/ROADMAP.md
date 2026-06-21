# ROADMAP — Inventario Kilker

> Cómo dirigir el proyecto por fases. Idioma: español.
> Última actualización: 2026-06-20 · Fase actual: **Fase 1**.

---

## Visión

Entregar un sistema de inventario web, multi-sucursal, accesible solo por navegador.
Stack: **Nuxt 4 (Vue 3 + TS) + Drizzle + Supabase**, desplegado en **Vercel**. Construir
por fases, validando specs, planes y capacidades antes de escribir código de producto.

---

## Fase 0 — Documentación y decisiones · **(completada)**

**Objetivo:** dejar por escrito stack, arquitectura, modelo de datos preliminar y plan.

**Entregables:**
- `CLAUDE.md`, `docs/CONTEXTO.md`, `docs/MODELO-DATOS.md`, `docs/ROADMAP.md`.

**Hecho cuando:**
- Los 4 documentos existen, son consistentes entre sí y el usuario los aprueba.

---

## Fase 1 — Specs, planes y entorno · **(en curso)**

**Objetivo:** convertir las preguntas abiertas en requisitos confirmados.

**Tareas:**
- Recolectar **especificaciones funcionales** (flujos, roles, reportes).
- **Validar el modelo de datos** (`MODELO-DATOS.md`) contra esas specs.
- Confirmar **planes y regiones**: Vercel Pro (uso comercial), plan de Supabase, región
  cercana a México; crear proyecto de Supabase y cuenta/equipo de Vercel.

**Adelanto de UI + backend (ya conectados, mientras llegan las specs):**
- Scaffold Nuxt 4 + Pinia + **Nuxt UI v4** en `kilker-inventario/`.
- **BD migrada/sembrada en Supabase** + `server/api/` con Drizzle (ver §10 de `CLAUDE.md`).
- **El mock de Pinia se eliminó**; la UI consume datos reales: dashboard, catálogo, alta de
  producto, **entrada de stock** y **venta** llaman a `server/api/` (lecturas por SSR;
  escrituras autenticadas con Bearer). Navegación por rol (admin/empleado).
- Adelanta trabajo de **Fase 3** (núcleo de inventario): catálogo, entradas y ventas ya
  funcionan end-to-end contra la BD. Falta validar contra specs y construir ajuste /
  transferencia / tickets-anulación, y proteger rutas.

**Hecho cuando:**
- Las "Preguntas abiertas" de `CONTEXTO.md` están resueltas y el modelo de datos está
  congelado para v1.

---

## Fase 2 — Scaffold y cimientos

**Objetivo:** dejar el esqueleto del proyecto listo para desarrollar features.

**Tareas:**
- Inicializar **Nuxt 4** (TS) + **Pinia** (`@pinia/nuxt`) + librería UI elegida.
- Integrar **Supabase** (`@nuxtjs/supabase`) para Auth y cliente.
- Configurar **Drizzle** + `drizzle-kit` (`server/db/schema.ts`, `drizzle.config.ts`,
  cliente con pooler de Supabase).
- **Esquema inicial:** primer `schema.ts` + migración (perfiles, roles, sucursales de
  prueba) y seed básico.
- Lint/format (ESLint+Prettier), variables de entorno, **deploy inicial a Vercel**.

**Hecho cuando:**
- Se levanta Nuxt en local, un usuario puede autenticarse (Supabase Auth) y una ruta
  `server/api/` lee/escribe datos vía Drizzle. La app despliega en Vercel.

---

## Fase 3 — Núcleo del inventario

**Objetivo:** funcionalidad central de control de stock.

**Tareas:**
- Catálogo de **productos** y **categorías**.
- **Sucursales** y **stock por sucursal**.
- **Movimientos**: entradas y salidas (transacciones Drizzle en `server/api/`).
- **Auth + roles** aplicados a la UI y a las rutas del servidor.

**Hecho cuando:**
- Un usuario con rol adecuado puede dar de alta productos y registrar entradas/salidas que
  actualizan correctamente las existencias por sucursal.

---

## Fase 4 — Transferencias, reportes y auditoría

**Tareas:**
- **Transferencias** entre sucursales (con estados).
- **Ajustes** de inventario y **kardex**/historial (`stock_movements`).
- **Reportes** básicos y exportación (Excel/PDF) — según specs.

**Hecho cuando:**
- Se puede transferir stock entre sucursales y consultar el historial/reportes.

---

## Fase 5 — Hardening y producción

**Tareas:**
- Validaciones, manejo de errores, **permisos finos** (server middleware) y **RLS** en
  Supabase donde aplique.
- **Backups** de Supabase y estrategia de recuperación.
- **Producción en Vercel**: plan Pro, dominio propio, variables de entorno, región.
- **Capacitación** a usuarios de sucursales.

**Hecho cuando:**
- La app corre en producción (Vercel + Supabase) y las sucursales la usan.

---

## Fase 6 — Mejoras (futuro)

- **PWA / offline** si la conectividad de las sucursales lo exige.
- **Códigos de barras** (lectura/impresión).
- Integración con **facturación/POS** existente.
- Lotes/caducidad si se confirman.

---

## Cómo deben proceder los próximos agentes

1. Leer primero [`../CLAUDE.md`](../CLAUDE.md) y [`CONTEXTO.md`](CONTEXTO.md).
2. No avanzar de fase con preguntas abiertas sin resolver: registrarlas y/o consultarlas.
3. Mantener los documentos sincronizados con cada decisión (regla 3 de `CLAUDE.md`).
4. Todo el stack es TypeScript: backend en `server/` de Nuxt; esquema solo vía Drizzle.
