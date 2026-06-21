<script setup lang="ts">
// Página de inicio de sesión. Usa Supabase Auth (email + contraseña).
// Sin layout (pantalla completa). Al autenticarse, redirige al dashboard.
definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref<string | null>(null)

// Si ya hay sesión activa, no mostrar el login.
watchEffect(() => {
  if (user.value) router.replace('/dashboard')
})

async function onSubmit() {
  loading.value = true
  errorMsg.value = null
  const { error } = await supabase.auth.signInWithPassword({
    email: email.value.trim(),
    password: password.value
  })
  loading.value = false
  if (error) {
    errorMsg.value = 'Correo o contraseña incorrectos.'
    return
  }
  await router.replace('/dashboard')
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-default text-default p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-paint-roller" class="size-6 text-primary" />
          <div class="leading-tight">
            <p class="font-semibold">Kilker Inventario</p>
            <p class="text-xs text-muted">Inicia sesión para continuar</p>
          </div>
        </div>
      </template>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <UFormField label="Correo" name="email">
          <UInput
            v-model="email"
            type="email"
            placeholder="tucorreo@kilker.mx"
            autocomplete="email"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField label="Contraseña" name="password">
          <UInput
            v-model="password"
            type="password"
            placeholder="••••••••"
            autocomplete="current-password"
            required
            class="w-full"
          />
        </UFormField>

        <UAlert
          v-if="errorMsg"
          color="error"
          variant="soft"
          icon="i-lucide-triangle-alert"
          :title="errorMsg"
        />

        <UButton type="submit" block :loading="loading" icon="i-lucide-log-in">
          Entrar
        </UButton>
      </form>
    </UCard>
  </div>
</template>
