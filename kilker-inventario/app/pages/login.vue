<script setup lang="ts">
// Login con Supabase Auth (email + contraseña); sin layout.
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
  if (user.value) router.replace(HOME_ROUTE)
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
  // useMe() (en el layout) carga el perfil al detectar la sesión.
  await router.replace(HOME_ROUTE)
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-default text-default p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <!-- Igual que en el sidebar: una variante por modo de color. -->
        <div class="flex flex-col items-center gap-3 py-2 text-center">
          <img
            src="/kilker-logo.png"
            alt="Kilker Industrial Coatings"
            width="600"
            height="273"
            class="h-14 w-auto dark:hidden"
          >
          <img
            src="/kilker-logo-dark.png"
            alt="Kilker Industrial Coatings"
            width="600"
            height="273"
            class="hidden h-14 w-auto dark:block"
          >
          <p class="text-xs text-muted">Inventario · inicia sesión para continuar</p>
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
