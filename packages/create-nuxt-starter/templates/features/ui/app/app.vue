<script setup lang="ts">
  import { zh_tw } from '@nuxt/ui/locale'

  useSeoMeta({
    title: '{{projectName}}',
    description: 'Built with Nuxt Starter',
  })
</script>

<template>
  <UApp :locale="zh_tw">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
