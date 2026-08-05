# CONVENCIONES DE TRABAJO DEL AGENTE — Inventario Kilker

> Acuerdos de trabajo entre el usuario y el agente (Claude Code) para este repo.
> Aquí se recogen las reglas de **cómo** colaboramos (no las reglas de arquitectura,
> que viven en [`../CLAUDE.md`](../CLAUDE.md)).
> Idioma: español. Última actualización: 2026-06-20.

---

## 1. Acuse al completar un componente o función

**Regla:** cada vez que el agente **termina de implementar un componente o una función**,
debe **cerrar ese mensaje** con el nombre del usuario y una carita feliz, exactamente:
-No generes comentarios largos en el codigo usa una linea para cada funcion y genera un
menasje con la explicacion del script creado solo si es pedido por el usuario.

```
Fernando 😊
```

### Detalles de aplicación

- Se aplica **una vez por cada componente o función completada** (no por cada mensaje
  suelto ni por cada cambio menor).
- Va **al final del mensaje** en el que se reporta el trabajo terminado.
- El texto debe ser **exacto**: `Fernando 😊` (nombre + espacio + carita feliz).
- Si en un mismo mensaje se completan varios componentes/funciones, basta con **un** cierre
  `Fernando 😊` al final del mensaje.
- Aplica tanto a componentes de UI (Vue) como a funciones (composables, endpoints
  `server/api/`, utilidades, etc.).

### Propósito

Sirve como **acuse de entrega**: deja claro, de un vistazo, que la unidad de trabajo
quedó implementada y reportada.

---

## 2. Futuros acuerdos de trabajo

> Este archivo es el lugar para registrar próximos acuerdos sobre la forma de trabajar
> (formato de reportes, idioma, flujo de revisión, etc.). Añádelos como nuevas secciones.

- _(pendiente)_
