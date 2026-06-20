# CONTEXTO — Inventario Kilker

> Contexto de negocio y técnico, decisiones de arquitectura y preguntas abiertas.
> Idioma: español. Última actualización: 2026-06-19.

---

## 1. Problema

La empresa de pinturas necesita controlar su **inventario en varias sucursales**. Hoy no
hay un sistema centralizado. Se requiere una herramienta que:

- Funcione en **todas las sucursales a la vez**, sin instalaciones por equipo.
- Permita registrar **entradas, salidas y existencias por sucursal**.
- Sea usable por personal no técnico, desde un navegador.

---

## 2. Usuarios y contexto de uso

- **Sucursales:** varias (número exacto **pendiente de specs**).
- **Equipos con bloqueo de instalación:** solo se puede usar el **navegador**. No se
  pueden instalar programas de escritorio ni desplegar app por app → **app web central**.
- **Roles (preliminar, a confirmar):** administrador, bodega/almacén, ventas.

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

> No bloquean la Fase 0 (documentación). Resolver al llegar las specs / Fase 1.

### Plataforma / costos
- [ ] **Vercel Pro** confirmado para uso comercial (~$20 USD/mes/usuario)?
- [ ] **Plan de Supabase**: ¿Free para arrancar y Pro (~$25/mes) en producción? Límites.
- [ ] **Región** de Vercel y Supabase más cercana a México (latencia).
- [ ] Dominio propio para la app.

### Auth
- [ ] ¿Proveedores de login? (email/contraseña, invitaciones por admin, etc.)
- [ ] **Roles** concretos y sus **permisos** (admin, bodega, ventas…).

### Negocio / dominio
- [ ] **Nº de sucursales** y de **usuarios**.
- [ ] **Estabilidad de internet** en sucursales → ¿se necesita **offline/PWA**?
- [ ] **Atributos reales del catálogo** de pinturas (color, código de color, base,
      acabado, tamaño/litros, marca, línea).
- [ ] **Valores provisionales (supuestos) usados en la UI de Fase 1** — confirmar y ajustar:
      `base` ∈ {agua, aceite, latex, epoxica, otro}; `unidad` ∈ {L, gal, ml, kg, pieza}.
      Definidos en `kilker-inventario/app/types/inventario.ts` (`PRODUCT_BASES`,
      `PRODUCT_UNITS`). También se asume que un producto = **una variante vendible (1 SKU)**.
- [ ] ¿Manejo de **lotes/caducidad**? ¿**Códigos de barras**?
- [ ] ¿**Transferencias** entre sucursales? ¿**Órdenes de compra/venta** o solo stock?
- [ ] ¿**Reportes** y exportación (Excel/PDF)? ¿Integración con **facturación/POS**?
- [ ] **Idioma de la interfaz** (se asume español).

---

## 6. Glosario (preliminar)

- **Sucursal (location):** punto físico con su propio stock.
- **Movimiento (stock movement):** entrada, salida, ajuste o transferencia que cambia el
  stock de un producto en una sucursal.
- **Transferencia (transfer):** movimiento de existencias de una sucursal a otra.
- **SKU:** identificador único de un producto/variante.
- **RLS (Row Level Security):** reglas de acceso a nivel de fila en Postgres/Supabase.
