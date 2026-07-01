<script setup lang="ts">
import type { UserRole } from '~/types/inventario'

const route = useRoute()
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { me, refresh: refreshMe } = useMe()
const { data: stores } = useStores()

type NavLink = { label: string; to: string; icon: string; roles?: UserRole[] }
type NavSection = { section: string; icon: string; children: NavLink[] }
type NavEntry = NavLink | NavSection

const isSection = (e: NavEntry): e is NavSection => 'section' in e

// Estructura en secciones: Dashboard suelto; el resto agrupado (plegable).
const allNav: NavEntry[] = [
  { label: 'Dashboard', to: '/dashboard', icon: 'i-lucide-layout-dashboard' },
  {
    section: 'Productos',
    icon: 'i-lucide-package',
    children: [
      { label: 'Catálogo', to: '/productos', icon: 'i-lucide-package' },
      {
        label: 'Nuevo producto',
        to: '/productos/nuevo',
        icon: 'i-lucide-package-plus',
        roles: ['admin']
      },
      { label: 'Categorías', to: '/categorias', icon: 'i-lucide-tags', roles: ['admin'] }
    ]
  },
  {
    section: 'Entradas de stock',
    icon: 'i-lucide-arrow-down-to-line',
    children: [
      {
        label: 'Entrada',
        to: '/movimientos/entrada',
        icon: 'i-lucide-arrow-down-to-line',
        roles: ['admin', 'empleado']
      },
      {
        label: 'Historial',
        to: '/movimientos',
        icon: 'i-lucide-history',
        roles: ['admin', 'empleado']
      }
    ]
  },
  {
    section: 'Ventas',
    icon: 'i-lucide-receipt-text',
    children: [
      {
        label: 'Nueva venta',
        to: '/ventas/nueva',
        icon: 'i-lucide-receipt-text',
        roles: ['admin', 'empleado']
      },
      {
        label: 'Historial',
        to: '/ventas',
        icon: 'i-lucide-scroll-text',
        roles: ['admin', 'empleado']
      },
      {
        label: 'Correcciones',
        to: '/tickets',
        icon: 'i-lucide-ticket',
        roles: ['admin', 'empleado']
      }
    ]
  },
  {
    section: 'Caja',
    icon: 'i-lucide-scissors',
    children: [
      {
        label: 'Cortes de caja',
        to: '/cortes',
        icon: 'i-lucide-scissors',
        roles: ['admin', 'empleado']
      }
    ]
  },
  {
    section: 'Administración',
    icon: 'i-lucide-shield',
    children: [
      { label: 'Sucursales', to: '/tiendas', icon: 'i-lucide-store', roles: ['admin'] },
      { label: 'Empleados', to: '/empleados', icon: 'i-lucide-users', roles: ['admin'] }
    ]
  }
]

// Un ítem es visible si no exige rol o el rol actual coincide.
const allowed = (roles?: UserRole[]) =>
  !roles || (!!me.value && roles.includes(me.value.role))

// Filtra por rol: dentro de cada sección se filtran los hijos; si queda vacía, se omite.
const nav = computed<NavEntry[]>(() => {
  const out: NavEntry[] = []
  for (const entry of allNav) {
    if (isSection(entry)) {
      const children = entry.children.filter((c) => allowed(c.roles))
      if (children.length) out.push({ ...entry, children })
    } else if (allowed(entry.roles)) {
      out.push(entry)
    }
  }
  return out
})

// Todos los enlaces (planos) para detectar el ítem activo.
const allLinks = computed<NavLink[]>(() =>
  nav.value.flatMap((e) => (isSection(e) ? e.children : [e]))
)

// Ítem activo: el de prefijo más largo que coincide con la ruta.
const activeTo = computed(() => {
  const matches = allLinks.value
    .filter((i) => route.path === i.to || route.path.startsWith(`${i.to}/`))
    .sort((a, b) => b.to.length - a.to.length)
  return matches[0]?.to
})

// Sección que contiene la ruta activa (para auto-abrirla).
const activeSection = computed(() => {
  const at = activeTo.value
  if (!at) return undefined
  const found = nav.value.find((e) => isSection(e) && e.children.some((c) => c.to === at))
  return found && isSection(found) ? found.section : undefined
})

// Acordeón estricto: solo una sección abierta a la vez. Se auto-abre la de la página actual.
const openSection = ref<string | null>(null)
const isOpen = (name: string) => openSection.value === name
const toggleSection = (name: string) => {
  openSection.value = isOpen(name) ? null : name
}
watch(
  activeSection,
  (s) => {
    if (s) openSection.value = s
  },
  { immediate: true }
)

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
        <template v-for="entry in nav" :key="'section' in entry ? entry.section : entry.to">
          <!-- Enlace suelto (Dashboard) -->
          <UButton
            v-if="!('section' in entry)"
            :to="entry.to"
            :icon="entry.icon"
            :color="activeTo === entry.to ? 'primary' : 'neutral'"
            :variant="activeTo === entry.to ? 'soft' : 'ghost'"
            block
            class="justify-start"
            @click="sidebarOpen = false"
          >
            {{ entry.label }}
          </UButton>

          <!-- Sección plegable -->
          <div v-else>
            <UButton
              color="neutral"
              variant="ghost"
              block
              class="justify-start"
              @click="toggleSection(entry.section)"
            >
              <UIcon :name="entry.icon" class="size-5 shrink-0" />
              <span
                class="flex-1 text-left text-xs font-semibold uppercase tracking-wide text-muted"
              >
                {{ entry.section }}
              </span>
              <UIcon
                :name="isOpen(entry.section) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-4 shrink-0 text-muted"
              />
            </UButton>

            <div v-show="isOpen(entry.section)" class="mt-1 space-y-1 pl-3">
              <UButton
                v-for="child in entry.children"
                :key="child.to"
                :to="child.to"
                :icon="child.icon"
                :color="activeTo === child.to ? 'primary' : 'neutral'"
                :variant="activeTo === child.to ? 'soft' : 'ghost'"
                block
                class="justify-start"
                @click="sidebarOpen = false"
              >
                {{ child.label }}
              </UButton>
            </div>
          </div>
        </template>
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
