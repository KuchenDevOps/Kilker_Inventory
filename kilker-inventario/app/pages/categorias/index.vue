<script setup lang="ts">
import type { ApiCategory } from '~/types/inventario'

definePageMeta({ requiresRole: 'admin' })
useHead({ title: 'Categorías · Inventario Kilker' })

const toast = useToast()
const { data: categories, pending, error, refresh } = useCategories()
const apiFetch = useApiFetch()

// Estado del formulario: null = cerrado; 0 = nueva; >0 = editando esa categoría.
const editingId = ref<number | null>(null)
const formName = ref('')
const formParentId = ref<number>(0) // 0 = sin padre (raíz)
const saving = ref(false)
const confirmingId = ref<number | null>(null)
const deletingId = ref<number | null>(null)

const isOpen = computed(() => editingId.value !== null)
const isNew = computed(() => editingId.value === 0)

// Opciones de padre: todas menos la que se edita (evita auto-padre obvio).
const parentItems = computed(() => [
  { label: '— Ninguna (raíz) —', value: 0 },
  ...categories.value
    .filter((c) => c.id !== editingId.value)
    .map((c) => ({ label: c.name, value: c.id }))
])

function openNew() {
  editingId.value = 0
  formName.value = ''
  formParentId.value = 0
  confirmingId.value = null
}

function openEdit(c: ApiCategory) {
  editingId.value = c.id
  formName.value = c.name
  formParentId.value = c.parentId ?? 0
  confirmingId.value = null
}

function closeForm() {
  editingId.value = null
}

async function save() {
  const name = formName.value.trim()
  if (!name) {
    toast.add({ title: 'El nombre es obligatorio', color: 'error', icon: 'i-lucide-triangle-alert' })
    return
  }
  saving.value = true
  try {
    const body = { name, parentId: formParentId.value || null }
    if (isNew.value) {
      await apiFetch('/api/categories', { method: 'POST', body })
      toast.add({ title: 'Categoría creada', color: 'success', icon: 'i-lucide-circle-check' })
    } else {
      await apiFetch(`/api/categories/${editingId.value}`, { method: 'PATCH', body })
      toast.add({ title: 'Categoría actualizada', color: 'success', icon: 'i-lucide-circle-check' })
    }
    await refresh()
    closeForm()
  } catch (e) {
    toast.add({
      title: 'No se pudo guardar',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    saving.value = false
  }
}

async function confirmDelete(c: ApiCategory) {
  deletingId.value = c.id
  try {
    await apiFetch(`/api/categories/${c.id}`, { method: 'DELETE' })
    toast.add({ title: 'Categoría eliminada', color: 'success', icon: 'i-lucide-circle-check' })
    await refresh()
  } catch (e) {
    toast.add({
      title: 'No se pudo eliminar',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    deletingId.value = null
    confirmingId.value = null
  }
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Categorías</h1>
        <p class="text-sm text-muted">
          {{ categories.length }} categoría(s) · líneas de producto del catálogo
        </p>
      </div>
      <UButton icon="i-lucide-plus" color="primary" :disabled="isNew" @click="openNew">
        Nueva categoría
      </UButton>
    </header>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar las categorías"
      :description="error.message"
    />

    <!-- Formulario de alta/edición (inline) -->
    <UCard v-if="isOpen">
      <template #header>
        <h2 class="font-semibold">
          {{ isNew ? 'Nueva categoría' : 'Editar categoría' }}
        </h2>
      </template>
      <form class="space-y-4" @submit.prevent="save">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Nombre" name="name" required>
            <UInput v-model="formName" placeholder="Ej. Esmaltes" class="w-full" autofocus />
          </UFormField>
          <UFormField label="Categoría padre" name="parentId" help="Opcional (jerarquía)">
            <USelect v-model="formParentId" :items="parentItems" class="w-full" />
          </UFormField>
        </div>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="ghost" @click="closeForm">
            Cancelar
          </UButton>
          <UButton type="submit" icon="i-lucide-save" color="primary" :loading="saving">
            Guardar
          </UButton>
        </div>
      </form>
    </UCard>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">Nombre</th>
              <th class="px-4 py-3 font-medium">Padre</th>
              <th class="px-4 py-3 font-medium text-right">Productos</th>
              <th class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="4" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!categories.length">
              <td colspan="4" class="px-4 py-8 text-center text-muted">
                Aún no hay categorías. Crea la primera.
              </td>
            </tr>
            <tr v-for="c in categories" v-else :key="c.id" class="hover:bg-elevated/50">
              <td class="px-4 py-3 font-medium">{{ c.name }}</td>
              <td class="px-4 py-3 text-muted">{{ c.parentName ?? '—' }}</td>
              <td class="px-4 py-3 text-right tabular-nums">{{ c.productCount ?? 0 }}</td>
              <td class="px-4 py-3">
                <!-- Confirmación inline de borrado -->
                <div v-if="confirmingId === c.id" class="flex items-center justify-end gap-2">
                  <span class="text-xs text-muted">¿Eliminar?</span>
                  <UButton
                    size="xs"
                    color="error"
                    variant="solid"
                    :loading="deletingId === c.id"
                    @click="confirmDelete(c)"
                  >
                    Sí
                  </UButton>
                  <UButton size="xs" color="neutral" variant="ghost" @click="confirmingId = null">
                    No
                  </UButton>
                </div>
                <div v-else class="flex items-center justify-end gap-1">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-pencil"
                    @click="openEdit(c)"
                  />
                  <UButton
                    size="xs"
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    @click="confirmingId = c.id"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </UContainer>
</template>
