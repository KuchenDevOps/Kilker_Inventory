<script setup lang="ts">
  const model = defineModel<string>({ required: true});
  const visible = ref(false)
</script>

<template>
  <UInput
    v-model="model"
    :type="visible ? 'text' : 'password'"
  >
    <template #trailing>
      <UButton
        type="button"
        color="neutral"
        variant="link"
        size="xs"
        tabindex="-1"
        :icon="visible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        :aria-label="visible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
        :aria-pressed="visible"
        :title="visible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
        @click="visible = !visible"
      />
    </template>
  </UInput>
</template>
