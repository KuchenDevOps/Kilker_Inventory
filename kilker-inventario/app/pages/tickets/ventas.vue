<script setup lang="ts">
// Tickets de corrección de VENTAS. Toda la lógica vive en TicketsPanel,
// compartida con /tickets/entradas.
useHead({ title: 'Correcciones de ventas · Inventario Kilker' })
</script>

<template>
  <TicketsPanel target="factura" />
</template>
