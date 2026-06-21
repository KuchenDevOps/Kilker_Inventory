<script setup lang="ts">
import type { UserRole } from '~/types/inventario'

const route = useRoute()
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { me, refresh: refreshMe } = useMe()

type NavItem = { label: string; to: string; icon: string; roles?: UserRole[] }

const allNav: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: 'i-lucide-layout-dashboard' },
  { label: 'Catálogo', to: '/productos', icon: 'i-lucide-package' },
  {
    label: 'Nuevo producto',
    to: '/productos/nuevo',
    icon: 'i-lucide-package-plus',
    roles: ['admin']
  },
  {
    label: 'Entrada de stock',
    to: '/movimientos/entrada',
    icon: 'i-lucide-arrow-down-to-line',
    roles: ['admin']
  },
  {
    label: 'Venta',
    to: '/ventas/nueva',
    icon: 'i-lucide-receipt-text',
    roles: ['admin', 'empleado']
  }
]

// Filtra por rol: ítems sin `roles` son públicos; el resto requiere el rol actual.
const nav = computed(() =>
  allNav.filter((item) => !item.roles || (me.value && item.roles.includes(me.value.role)))
)

// El ítem activo es el de prefijo más largo que coincide con la ruta actual
// (así /productos/nuevo resalta "Nuevo producto", no "Catálogo").
const activeTo = computed(() => {
  const matches = nav.value
    .filter((i) => route.path === i.to || route.path.startsWith(`${i.to}/`))
    .sort((a, b) => b.to.length - a.to.length)
  return matches[0]?.to
})

const roleLabel = computed(() =>
  me.value?.role === 'admin'
    ? 'Administrador'
    : me.value?.role === 'empleado'
      ? 'Empleado'
      : null
)

async function logout() {
  await supabase.auth.signOut()
  await refreshMe()
  await navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen flex bg-default text-default">
    <!-- Barra lateral -->
    <aside
      class="hidden md:flex w-64 shrink-0 flex-col border-r border-default bg-elevated/40"
    >
      <div class="h-16 flex items-center gap-2 px-4 border-b border-default">
        <UIcon name="i-lucide-paint-roller" class="size-6 text-primary" />
        <div class="leading-tight">
          <p class="font-semibold">Kilker</p>
          <p class="text-xs text-muted">Inventario</p>
        </div>
      </div>

      <nav class="flex-1 p-2 space-y-1">
        <UButton
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          :icon="item.icon"
          :color="activeTo === item.to ? 'primary' : 'neutral'"
          :variant="activeTo === item.to ? 'soft' : 'ghost'"
          block
          class="justify-start"
        >
          {{ item.label }}
        </UButton>
      </nav>

      <div class="p-3 border-t border-default">
        <p class="text-xs text-muted">Fase 1 · datos reales (Supabase)</p>
      </div>
    </aside>

    <!-- Contenido -->
    <div class="flex-1 flex flex-col min-w-0">
      <header
        class="h-16 shrink-0 flex items-center gap-3 px-4 border-b border-default bg-elevated/40"
      >
        <UIcon name="i-lucide-paint-roller" class="size-5 text-primary md:hidden" />
        <span class="font-semibold md:hidden">Kilker</span>

        <!-- Navegación compacta en móvil -->
        <nav class="flex md:hidden gap-1">
          <UButton
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            :icon="item.icon"
            :color="activeTo === item.to ? 'primary' : 'neutral'"
            :variant="activeTo === item.to ? 'soft' : 'ghost'"
            square
          />
        </nav>

        <!-- Sesión -->
        <div class="ml-auto flex items-center gap-2">
          <template v-if="user">
            <div class="hidden sm:flex flex-col items-end leading-tight">
              <span class="text-sm">{{ user.email }}</span>
              <UBadge
                v-if="roleLabel"
                :label="roleLabel"
                color="neutral"
                variant="subtle"
                size="xs"
              />
            </div>
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-log-out"
              @click="logout"
            >
              Salir
            </UButton>
          </template>
          <UButton
            v-else
            to="/login"
            color="primary"
            variant="soft"
            icon="i-lucide-log-in"
          >
            Entrar
          </UButton>
        </div>
      </header>

      <main class="flex-1 overflow-y-auto">
        <slot />
      </main>
    </div>
  </div>
</template>
