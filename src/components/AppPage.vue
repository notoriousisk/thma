<template>
  <div class="page">
    <slot name="header" />
    <div class="content">
      <slot />
    </div>
    <NavBar />
  </div>
</template>

<script setup lang="ts">
import NavBar from "@/components/NavBar.vue";

defineProps<{ title: string; disclaimer?: string }>();
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background-color: var(--color-background);
  height: 100dvh;
  max-width: 700px;
  margin: 0 auto;
  overflow: hidden;
  position: relative;
}

.content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
}
</style>
