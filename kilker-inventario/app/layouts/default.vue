<script setup lang="ts">
import type { UserRole } from '~/types/inventario'

const route = useRoute()
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { me, refresh: refreshMe } = useMe()
const { data: stores } = useStores()

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
    label: 'Categorías',
    to: '/categorias',
    icon: 'i-lucide-tags',
    roles: ['admin']
  },
  {
    label: 'Sucursales',
    to: '/tiendas',
    icon: 'i-lucide-store',
    roles: ['admin']
  },
  {
    label: 'Empleados',
    to: '/empleados',
    icon: 'i-lucide-users',
    roles: ['admin']
  },
  {
    label: 'Entrada de stock',
    to: '/movimientos/entrada',
    icon: 'i-lucide-arrow-down-to-line',
    roles: ['admin', 'empleado']
  },
  {
    label: 'Venta',
    to: '/ventas/nueva',
    icon: 'i-lucide-receipt-text',
    roles: ['admin', 'empleado']
  },
  {
    label: 'Ventas (historial)',
    to: '/ventas',
    icon: 'i-lucide-scroll-text',
    roles: ['admin', 'empleado']
  },
  {
    label: 'Correcciones',
    to: '/tickets',
    icon: 'i-lucide-ticket',
    roles: ['admin', 'empleado']
  },
  {
    label: 'Cortes de caja',
    to: '/cortes',
    icon: 'i-lucide-scissors',
    roles: ['admin', 'empleado']
  }
]

// Filtra por rol: ítems sin `roles` son públicos; el resto requiere el rol actual.
const nav = computed(() =>
  allNav.filter((item) => !item.roles || (me.value && item.roles.includes(me.value.role)))
)

// Ítem activo: el de prefijo más largo que coincide con la ruta.
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

// Sucursal del usuario: el empleado ve la suya; el admin opera global.
const myStore = computed(() => stores.value.find((s) => s.id === me.value?.storeId))
const storeLabel = computed(() => {
  if (!me.value) return null
  if (me.value.role === 'admin') return 'Todas las sucursales'
  return myStore.value ? myStore.value.name : 'Sin sucursal'
})
const storeIcon = computed(() =>
  me.value?.role === 'admin' ? 'i-lucide-globe' : 'i-lucide-store'
)

const sidebarOpen = ref(false)

// Cierra la sidebar al navegar (útil en móvil tras hacer clic en un ítem).
watch(() => route.path, () => { sidebarOpen.value = false })

async function logout() {
  await supabase.auth.signOut()
  await refreshMe()
  await navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen bg-default text-default">
    <!-- Overlay semitransparente (solo móvil, cuando la sidebar está abierta) -->
    <Transition name="fade">
      <div
        v-if="sidebarOpen"
        class="fixed inset-0 z-20 bg-black/50 md:hidden"
        @click="sidebarOpen = false"
      />
    </Transition>

    <!-- Barra lateral — fija siempre; slide-in en móvil, siempre visible en desktop -->
    <aside
      class="fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-default bg-elevated transition-transform duration-200 ease-in-out md:translate-x-0"
      :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="flex h-16 shrink-0 items-center gap-2 border-b border-default px-4">
        <UIcon name="i-lucide-paint-roller" class="size-6 text-primary" />
        <div class="leading-tight">
          <p class="font-semibold">Kilker</p>
          <p class="text-xs text-muted">Inventario</p>
        </div>
        <!-- Botón cerrar sidebar (solo visible en móvil) -->
        <UButton
          class="ml-auto md:hidden"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          square
          @click="sidebarOpen = false"
        />
      </div>

      <nav class="flex-1 space-y-1 overflow-y-auto p-2">
        <UButton
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          :icon="item.icon"
          :color="activeTo === item.to ? 'primary' : 'neutral'"
          :variant="activeTo === item.to ? 'soft' : 'ghost'"
          block
          class="justify-start"
          @click="sidebarOpen = false"
        >
          {{ item.label }}
        </UButton>
      </nav>

      <div class="shrink-0 border-t border-default p-3">
        <p class="text-xs text-muted">Fase 1 · datos reales (Supabase)</p>
      </div>
    </aside>

    <!-- Contenido principal — ocupa toda la pantalla en móvil, deja espacio a la sidebar en desktop -->
    <div class="flex min-h-screen flex-col md:pl-64">
      <header
        class="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b border-default bg-elevated/80 px-4 backdrop-blur"
      >
        <!-- Botón hamburguesa (solo visible en móvil) -->
        <UButton
          class="md:hidden"
          color="neutral"
          variant="ghost"
          icon="i-lucide-menu"
          square
          @click="sidebarOpen = true"
        />

        <!-- Sesión -->
        <div class="ml-auto flex items-center gap-2">
          <template v-if="user">
            <div class="hidden sm:flex flex-col items-end gap-1 leading-tight">
              <span class="text-sm">{{ user.email }}</span>
              <div class="flex items-center gap-1">
                <UBadge
                  v-if="roleLabel"
                  :label="roleLabel"
                  color="neutral"
                  variant="subtle"
                  size="xs"
                />
                <UBadge
                  v-if="storeLabel"
                  :label="storeLabel"
                  :icon="storeIcon"
                  color="primary"
                  variant="subtle"
                  size="xs"
                />
              </div>
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

      <main class="flex-1">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
