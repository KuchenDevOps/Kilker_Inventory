// Extiende RouteMeta con los campos que usa el guard global (requiresRole).
import 'vue-router'
import type { UserRole } from './inventario'

declare module 'vue-router' {
  interface RouteMeta {
    /**
     * Rol (o roles) permitidos para entrar a la ruta. Lo aplica
     * middleware/auth.global.ts. Un arreglo significa "cualquiera de estos".
     */
    requiresRole?: UserRole | UserRole[]
  }
}

export {}
