<script setup lang="ts">
// Tickets de corrección de GASTOS. Toda la lógica vive en TicketsPanel,
// compartida con /tickets/ventas y /tickets/entradas.
useHead({ title: 'Correcciones de gastos · Inventario Kilker' })
</script>

<template>
  <TicketsPanel target="gasto" />
</template>
