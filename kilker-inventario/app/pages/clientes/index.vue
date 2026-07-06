<script setup lang="ts">
import type { ApiCustomer } from '~/types/inventario'

useHead({ title: 'Clientes · Inventario Kilker' })

const { data: customers, pending, error, refresh } = useCustomers()
const { me } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')

const toast = useToast()
const apiFetch = useApiFetch()

const search = ref('')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return customers.value
  return customers.value.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.rfc ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.phone ?? '').toLowerCase().includes(q)
  )
})

// ───────────────────────────────────────────────
//  ALTA / EDICIÓN (modal)
// ───────────────────────────────────────────────
const editingId = ref<number | null>(null) // null = alta nueva, number = editando ese id
const showModal = ref(false)
const submitting = ref(false)

const form = reactive<{
  name: string
  rfc: string
  address: string
  email: string
  phone: string
  isActive: boolean
}>({
  name: '',
  rfc: '',
  address: '',
  email: '',
  phone: '',
  isActive: true
})

function openCreate() {
  editingId.value = null
  Object.assign(form, { name: '', rfc: '', address: '', email: '', phone: '', isActive: true })
  showModal.value = true
}

function openEdit(c: ApiCustomer) {
  editingId.value = c.id
  Object.assign(form, {
    name: c.name,
    rfc: c.rfc ?? '',
    address: c.address ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    isActive: c.isActive
  })
  showModal.value = true
}

const canSubmit = computed(() => form.name.trim().length > 0)

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const body = {
      name: form.name.trim(),
      rfc: form.rfc.trim() || null,
      address: form.address.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      isActive: form.isActive
    }
    if (editingId.value != null) {
      await apiFetch(`/api/customers/${editingId.value}`, { method: 'PATCH', body })
      toast.add({ title: 'Cliente actualizado', color: 'success', icon: 'i-lucide-circle-check' })
    } else {
      await apiFetch('/api/customers', { method: 'POST', body })
      toast.add({ title: 'Cliente creado', color: 'success', icon: 'i-lucide-circle-check' })
    }
    showModal.value = false
    await refresh()
  } catch (e) {
    toast.add({
      title: 'No se pudo guardar el cliente',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submitting.value = false
  }
}

// ───────────────────────────────────────────────
//  DESACTIVAR / REACTIVAR
// ───────────────────────────────────────────────
const confirmingId = ref<number | null>(null)
const togglingId = ref<number | null>(null)

async function toggleActive(c: ApiCustomer) {
  togglingId.value = c.id
  try {
    if (c.isActive) {
      await apiFetch(`/api/customers/${c.id}`, { method: 'DELETE' })
      toast.add({ title: `${c.name} desactivado`, color: 'success', icon: 'i-lucide-circle-check' })
    } else {
      await apiFetch(`/api/customers/${c.id}`, { method: 'PATCH', body: { isActive: true } })
      toast.add({ title: `${c.name} reactivado`, color: 'success', icon: 'i-lucide-circle-check' })
    }
    confirmingId.value = null
    await refresh()
  } catch (e) {
    toast.add({
      title: 'No se pudo actualizar',
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
        <h1 class="text-2xl font-semibold">Clientes</h1>
        <p class="text-sm text-muted">{{ customers.length }} cliente(s)</p>
      </div>
      <UButton v-if="isAdmin" icon="i-lucide-plus" color="primary" @click="openCreate">
        Nuevo cliente
      </UButton>
    </header>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar los clientes"
      :description="error.message"
    />

    <UInput
      v-model="search"
      icon="i-lucide-search"
      placeholder="Buscar por nombre, RFC, correo o teléfono…"
      class="w-full sm:max-w-sm"
    />

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">Nombre</th>
              <th class="px-4 py-3 font-medium">RFC</th>
              <th class="px-4 py-3 font-medium">Correo</th>
              <th class="px-4 py-3 font-medium">Teléfono</th>
              <th class="px-4 py-3 font-medium">Domicilio</th>
              <th class="px-4 py-3 font-medium text-center">Estado</th>
              <th class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="7" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!filtered.length">
              <td colspan="7" class="px-4 py-8 text-center text-muted">Sin resultados.</td>
            </tr>
            <tr v-else v-for="c in filtered" :key="c.id" class="hover:bg-elevated/50">
              <td class="px-4 py-3 font-medium">{{ c.name }}</td>
              <td class="px-4 py-3 text-muted font-mono text-xs">{{ c.rfc ?? '—' }}</td>
              <td class="px-4 py-3 text-muted">{{ c.email ?? '—' }}</td>
              <td class="px-4 py-3 text-muted">{{ c.phone ?? '—' }}</td>
              <td class="px-4 py-3 text-muted truncate max-w-48">{{ c.address ?? '—' }}</td>
              <td class="px-4 py-3 text-center">
                <UBadge
                  :label="c.isActive ? 'Activo' : 'Inactivo'"
                  :color="c.isActive ? 'success' : 'neutral'"
                  variant="subtle"
                />
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1">
                  <template v-if="confirmingId === c.id">
                    <span class="text-xs text-muted mr-1">
                      {{ c.isActive ? '¿Desactivar?' : '¿Reactivar?' }}
                    </span>
                    <UButton
                      size="xs"
                      :color="c.isActive ? 'error' : 'success'"
                      variant="soft"
                      icon="i-lucide-check"
                      :loading="togglingId === c.id"
                      @click="toggleActive(c)"
                    />
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-x"
                      :disabled="togglingId === c.id"
                      @click="confirmingId = null"
                    />
                  </template>
                  <template v-else-if="isAdmin">
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-pencil"
                      @click="openEdit(c)"
                    />
                    <UButton
                      size="xs"
                      :color="c.isActive ? 'error' : 'success'"
                      variant="ghost"
                      :icon="c.isActive ? 'i-lucide-user-x' : 'i-lucide-user-check'"
                      @click="confirmingId = c.id"
                    />
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <!-- Modal de alta/edición -->
    <UModal v-model:open="showModal">
      <template #content>
        <UCard>
          <template #header>
            <h2 class="font-semibold">
              {{ editingId != null ? 'Editar cliente' : 'Nuevo cliente' }}
            </h2>
          </template>

          <form class="space-y-4" @submit.prevent="onSubmit">
            <UFormField label="Nombre" required>
              <UInput v-model="form.name" placeholder="Nombre completo o razón social" class="w-full" />
            </UFormField>

            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="RFC">
                <UInput v-model="form.rfc" placeholder="XAXX010101000" class="w-full" />
              </UFormField>
              <UFormField label="Teléfono">
                <UInput v-model="form.phone" placeholder="55..." class="w-full" />
              </UFormField>
            </div>

            <UFormField label="Correo">
              <UInput v-model="form.email" type="email" placeholder="cliente@correo.com" class="w-full" />
            </UFormField>

            <UFormField label="Domicilio">
              <UTextarea v-model="form.address" placeholder="Calle, número, colonia…" class="w-full" />
            </UFormField>

            <UFormField v-if="editingId != null" name="isActive">
              <USwitch v-model="form.isActive" label="Cliente activo" />
            </UFormField>

            <div class="flex justify-end gap-2 pt-2">
              <UButton
                type="button"
                variant="ghost"
                color="neutral"
                @click="showModal = false"
              >
                Cancelar
              </UButton>
              <UButton type="submit" color="primary" :loading="submitting" :disabled="!canSubmit">
                Guardar
              </UButton>
            </div>
          </form>
        </UCard>
      </template>
    </UModal>
  </UContainer>
</template>