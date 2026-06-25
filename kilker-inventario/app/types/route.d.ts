// Extiende RouteMeta con los campos que usa el guard global (requiresRole).
import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    /** Rol requerido para entrar a la ruta. Lo aplica middleware/auth.global.ts. */
    requiresRole?: 'admin' | 'empleado'
  }
}

export {}
