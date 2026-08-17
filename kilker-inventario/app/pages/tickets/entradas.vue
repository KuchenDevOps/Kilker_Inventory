<script setup lang="ts">
// Tickets de corrección de ENTRADAS DE STOCK. Toda la lógica vive en
// TicketsPanel, compartida con /tickets/ventas.
useHead({ title: 'Correcciones de entradas · Inventario Kilker' })
</script>

<template>
  <TicketsPanel target="movimiento" />
</template>
