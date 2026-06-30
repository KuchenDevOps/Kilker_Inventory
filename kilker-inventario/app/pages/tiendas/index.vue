<script setup lang="ts">
import type { ApiStore } from '~/types/inventario'

definePageMeta({ requiresRole: 'admin' })
useHead({ title: 'Sucursales · Inventario Kilker' })

const toast = useToast()
const { data: stores, pending, error, refresh } = useStores()
const apiFetch = useApiFetch()

// Estado del formulario: null = cerrado; 0 = nueva; >0 = editando esa sucursal.
const editingId = ref<number | null>(null)
const formCode = ref('')
const formName = ref('')
const formAddress = ref('')
const formIsActive = ref(true)
const saving = ref(false)
const togglingId = ref<number | null>(null)

const isOpen = computed(() => editingId.value !== null)
const isNew = computed(() => editingId.value === 0)

function openNew() {
  editingId.value = 0
  formCode.value = ''
  formName.value = ''
  formAddress.value = ''
  formIsActive.value = true
}

function openEdit(s: ApiStore) {
  editingId.value = s.id
  formCode.value = s.code
  formName.value = s.name
  formAddress.value = s.address ?? ''
  formIsActive.value = s.isActive
}

function closeForm() {
  editingId.value = null
}

async function save() {
  const name = formName.value.trim()
  const code = formCode.value.trim()
  if (!name) {
    toast.add({ title: 'El nombre es obligatorio', color: 'error', icon: 'i-lucide-triangle-alert' })
    return
  }
  if (isNew.value && !code) {
    toast.add({ title: 'El código es obligatorio', color: 'error', icon: 'i-lucide-triangle-alert' })
    return
  }
  saving.value = true
  try {
    if (isNew.value) {
      await apiFetch('/api/stores', {
        method: 'POST',
        body: { name, code, address: formAddress.value.trim() || null }
      })
      toast.add({ title: 'Sucursal creada', color: 'success', icon: 'i-lucide-circle-check' })
    } else {
      await apiFetch(`/api/stores/${editingId.value}`, {
        method: 'PATCH',
        body: {
          name,
          address: formAddress.value.trim() || null,
          isActive: formIsActive.value
        }
      })
      toast.add({ title: 'Sucursal actualizada', color: 'success', icon: 'i-lucide-circle-check' })
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

async function toggleActive(s: ApiStore) {
  togglingId.value = s.id
  try {
    await apiFetch(`/api/stores/${s.id}`, {
      method: 'PATCH',
      body: { isActive: !s.isActive }
    })
    toast.add({
      title: s.isActive ? 'Sucursal desactivada' : 'Sucursal activada',
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    await refresh()
  } catch (e) {
    toast.add({
      title: 'No se pudo cambiar el estado',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    togglingId.value = null
  }
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Sucursales</h1>
        <p class="text-sm text-muted">
          {{ stores.length }} sucursal(es) · administra las tiendas de la empresa
        </p>
      </div>
      <UButton icon="i-lucide-plus" color="primary" :disabled="isNew" @click="openNew">
        Nueva sucursal
      </UButton>
    </header>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar las sucursales"
      :description="error.message"
    />

    <!-- Formulario de alta/edición (inline) -->
    <UCard v-if="isOpen">
      <template #header>
        <h2 class="font-semibold">
          {{ isNew ? 'Nueva sucursal' : 'Editar sucursal' }}
        </h2>
      </template>
      <form class="space-y-4" @submit.prevent="save">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            label="Código"
            name="code"
            :required="isNew"
            :help="isNew ? 'Identificador corto (se usa en folios). No se podrá cambiar después.' : 'El código no es editable.'"
          >
            <UInput
              v-model="formCode"
              placeholder="Ej. MTZ"
              class="w-full"
              :disabled="!isNew"
            />
          </UFormField>
          <UFormField label="Nombre" name="name" required>
            <UInput v-model="formName" placeholder="Ej. Matriz Centro" class="w-full" autofocus />
          </UFormField>
          <UFormField label="Dirección" name="address" help="Opcional" class="sm:col-span-2">
            <UInput v-model="formAddress" placeholder="Calle, número, ciudad…" class="w-full" />
          </UFormField>
        </div>
        <div v-if="!isNew" class="flex items-center gap-2">
          <USwitch v-model="formIsActive" />
          <span class="text-sm">{{ formIsActive ? 'Activa' : 'Inactiva' }}</span>
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
              <th class="px-4 py-3 font-medium">Código</th>
              <th class="px-4 py-3 font-medium">Nombre</th>
              <th class="px-4 py-3 font-medium">Dirección</th>
              <th class="px-4 py-3 font-medium text-right">Empleados</th>
              <th class="px-4 py-3 font-medium text-center">Estado</th>
              <th class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="6" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!stores.length">
              <td colspan="6" class="px-4 py-8 text-center text-muted">
                Aún no hay sucursales. Crea la primera.
              </td>
            </tr>
            <tr v-for="s in stores" v-else :key="s.id" class="hover:bg-elevated/50">
              <td class="px-4 py-3 font-mono text-xs">{{ s.code }}</td>
              <td class="px-4 py-3 font-medium">{{ s.name }}</td>
              <td class="px-4 py-3 text-muted">{{ s.address ?? '—' }}</td>
              <td class="px-4 py-3 text-right tabular-nums">{{ s.employeeCount ?? 0 }}</td>
              <td class="px-4 py-3 text-center">
                <UBadge
                  :label="s.isActive ? 'Activa' : 'Inactiva'"
                  :color="s.isActive ? 'success' : 'neutral'"
                  variant="subtle"
                />
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-end gap-1">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-pencil"
                    @click="openEdit(s)"
                  />
                  <UButton
                    size="xs"
                    :color="s.isActive ? 'error' : 'success'"
                    variant="ghost"
                    :icon="s.isActive ? 'i-lucide-power-off' : 'i-lucide-power'"
                    :loading="togglingId === s.id"
                    @click="toggleActive(s)"
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
