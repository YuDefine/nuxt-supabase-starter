<script setup lang="ts">
  import { zh_tw } from '@nuxt/ui/locale'
</script>
<template>
  <UApp :locale="zh_tw">
    <UContainer class="py-8">
      <NuxtPage />
    </UContainer>
  </UApp>
</template>
