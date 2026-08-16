<script setup lang="ts">
// /tickets se partió en dos pantallas: /tickets/ventas y /tickets/entradas.
// Esta ruta se conserva solo para que los enlaces y marcadores viejos sigan
// funcionando; manda a la de ventas, que es la que ya existía aquí.
definePageMeta({ redirect: '/tickets/ventas' })
</script>

<template>
  <div />
</template>
