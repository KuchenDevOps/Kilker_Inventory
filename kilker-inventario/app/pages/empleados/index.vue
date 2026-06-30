<script setup lang="ts">
import type { ApiUser, UserRole } from '~/types/inventario'

definePageMeta({ requiresRole: 'admin' })
useHead({ title: 'Empleados · Inventario Kilker' })

const toast = useToast()
const { users, pending, error, refresh } = useUsers()
const { data: stores } = useStores()
const { me } = useMe()
const apiFetch = useApiFetch()

onMounted(refresh)

const roleItems = [
  { label: 'Empleado', value: 'empleado' as UserRole },
  { label: 'Administrador', value: 'admin' as UserRole }
]
const storeItems = computed(() =>
  stores.value
    .filter((s) => s.isActive)
    .map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
)

// Estado del formulario: null = cerrado; '' = nuevo; uuid = editando.
const editingId = ref<string | null>(null)
const formEmail = ref('')
const formPassword = ref('')
const formName = ref('')
const formRole = ref<UserRole>('empleado')
const formStoreId = ref<number>(0)
const formIsActive = ref(true)
const saving = ref(false)
const togglingId = ref<string | null>(null)

const isOpen = computed(() => editingId.value !== null)
const isNew = computed(() => editingId.value === '')

function openNew() {
  editingId.value = ''
  formEmail.value = ''
  formPassword.value = ''
  formName.value = ''
  formRole.value = 'empleado'
  formStoreId.value = 0
  formIsActive.value = true
}

function openEdit(u: ApiUser) {
  editingId.value = u.id
  formEmail.value = u.email ?? ''
  formPassword.value = ''
  formName.value = u.fullName
  formRole.value = u.role
  formStoreId.value = u.storeId ?? 0
  formIsActive.value = u.isActive
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
  if (formRole.value === 'empleado' && !formStoreId.value) {
    toast.add({ title: 'El empleado requiere una sucursal', color: 'error', icon: 'i-lucide-triangle-alert' })
    return
  }
  if (isNew.value) {
    if (!formEmail.value.trim().includes('@')) {
      toast.add({ title: 'Email válido es obligatorio', color: 'error', icon: 'i-lucide-triangle-alert' })
      return
    }
    if (formPassword.value.length < 8) {
      toast.add({ title: 'La contraseña debe tener al menos 8 caracteres', color: 'error', icon: 'i-lucide-triangle-alert' })
      return
    }
  } else if (formPassword.value.length > 0 && formPassword.value.length < 8) {
    toast.add({ title: 'La contraseña debe tener al menos 8 caracteres', color: 'error', icon: 'i-lucide-triangle-alert' })
    return
  }

  const storeId = formRole.value === 'empleado' ? formStoreId.value : null

  saving.value = true
  try {
    if (isNew.value) {
      await apiFetch('/api/users', {
        method: 'POST',
        body: {
          email: formEmail.value.trim(),
          password: formPassword.value,
          fullName: name,
          role: formRole.value,
          storeId
        }
      })
      toast.add({ title: 'Usuario creado', color: 'success', icon: 'i-lucide-circle-check' })
    } else {
      await apiFetch(`/api/users/${editingId.value}`, {
        method: 'PATCH',
        body: {
          fullName: name,
          role: formRole.value,
          storeId,
          isActive: formIsActive.value,
          password: formPassword.value || undefined
        }
      })
      toast.add({ title: 'Usuario actualizado', color: 'success', icon: 'i-lucide-circle-check' })
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

async function toggleActive(u: ApiUser) {
  togglingId.value = u.id
  try {
    await apiFetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      body: { isActive: !u.isActive }
    })
    toast.add({
      title: u.isActive ? 'Usuario desactivado' : 'Usuario activado',
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

const roleLabel = (r: UserRole) => (r === 'admin' ? 'Administrador' : 'Empleado')
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Empleados</h1>
        <p class="text-sm text-muted">
          {{ users.length }} usuario(s) · cuentas de acceso al sistema
        </p>
      </div>
      <UButton icon="i-lucide-plus" color="primary" :disabled="isNew" @click="openNew">
        Nuevo usuario
      </UButton>
    </header>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar los usuarios"
      :description="error"
    />

    <!-- Formulario de alta/edición (inline) -->
    <UCard v-if="isOpen">
      <template #header>
        <h2 class="font-semibold">{{ isNew ? 'Nuevo usuario' : 'Editar usuario' }}</h2>
      </template>
      <form class="space-y-4" @submit.prevent="save">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Email" name="email" :required="isNew" :help="isNew ? 'Será su usuario para entrar.' : 'El email no se edita.'">
            <UInput
              v-model="formEmail"
              type="email"
              placeholder="empleado@kilker.mx"
              class="w-full"
              :disabled="!isNew"
            />
          </UFormField>
          <UFormField
            label="Contraseña"
            name="password"
            :required="isNew"
            :help="isNew ? 'Mínimo 8 caracteres. Entrégala al empleado.' : 'Déjala en blanco para no cambiarla.'"
          >
            <UInput
              v-model="formPassword"
              type="password"
              :placeholder="isNew ? '••••••••' : 'Sin cambios'"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Nombre completo" name="fullName" required>
            <UInput v-model="formName" placeholder="Ej. Juan Pérez" class="w-full" />
          </UFormField>
          <UFormField label="Rol" name="role" required>
            <USelect v-model="formRole" :items="roleItems" class="w-full" />
          </UFormField>
          <UFormField
            v-if="formRole === 'empleado'"
            label="Sucursal"
            name="storeId"
            required
            class="sm:col-span-2"
          >
            <USelect
              v-model="formStoreId"
              :items="storeItems"
              placeholder="Selecciona una sucursal"
              class="w-full"
            />
          </UFormField>
        </div>
        <div v-if="!isNew" class="flex items-center gap-2">
          <USwitch v-model="formIsActive" />
          <span class="text-sm">{{ formIsActive ? 'Activo' : 'Inactivo' }}</span>
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
              <th class="px-4 py-3 font-medium">Email</th>
              <th class="px-4 py-3 font-medium">Rol</th>
              <th class="px-4 py-3 font-medium">Sucursal</th>
              <th class="px-4 py-3 font-medium text-center">Estado</th>
              <th class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="6" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!users.length">
              <td colspan="6" class="px-4 py-8 text-center text-muted">
                Aún no hay usuarios.
              </td>
            </tr>
            <tr v-for="u in users" v-else :key="u.id" class="hover:bg-elevated/50">
              <td class="px-4 py-3 font-medium">{{ u.fullName }}</td>
              <td class="px-4 py-3 text-muted">{{ u.email ?? '—' }}</td>
              <td class="px-4 py-3">
                <UBadge
                  :label="roleLabel(u.role)"
                  :color="u.role === 'admin' ? 'primary' : 'neutral'"
                  variant="subtle"
                />
              </td>
              <td class="px-4 py-3 text-muted">
                {{ u.storeCode ? `${u.storeCode} · ${u.storeName}` : '—' }}
              </td>
              <td class="px-4 py-3 text-center">
                <UBadge
                  :label="u.isActive ? 'Activo' : 'Inactivo'"
                  :color="u.isActive ? 'success' : 'neutral'"
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
                    @click="openEdit(u)"
                  />
                  <UButton
                    size="xs"
                    :color="u.isActive ? 'error' : 'success'"
                    variant="ghost"
                    :icon="u.isActive ? 'i-lucide-user-x' : 'i-lucide-user-check'"
                    :loading="togglingId === u.id"
                    :disabled="u.id === me?.id"
                    @click="toggleActive(u)"
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
