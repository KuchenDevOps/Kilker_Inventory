<script setup lang="ts">
const route = useRoute()

const nav = [
  { label: 'Dashboard', to: '/dashboard', icon: 'i-lucide-layout-dashboard' },
  { label: 'Nuevo producto', to: '/productos/nuevo', icon: 'i-lucide-package-plus' }
]

function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
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
          :color="isActive(item.to) ? 'primary' : 'neutral'"
          :variant="isActive(item.to) ? 'soft' : 'ghost'"
          block
          class="justify-start"
        >
          {{ item.label }}
        </UButton>
      </nav>

      <div class="p-3 border-t border-default">
        <p class="text-xs text-muted">Fase 1 · datos de demostración</p>
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
        <nav class="flex md:hidden gap-1 ml-auto">
          <UButton
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            :icon="item.icon"
            :color="isActive(item.to) ? 'primary' : 'neutral'"
            :variant="isActive(item.to) ? 'soft' : 'ghost'"
            square
          />
        </nav>
      </header>

      <main class="flex-1 overflow-y-auto">
        <slot />
      </main>
    </div>
  </div>
</template>
