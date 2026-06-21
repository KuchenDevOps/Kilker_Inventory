// Aumenta el tipo de meta de ruta con los campos propios que usa el guard global
// (app/middleware/auth.global.ts) y que se declaran con definePageMeta en cada page.
import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    /** Rol requerido para entrar a la ruta. Lo aplica middleware/auth.global.ts. */
    requiresRole?: 'admin' | 'empleado'
  }
}

export {}
