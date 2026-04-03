<script setup lang="ts">
  import { zh_tw } from '@nuxt/ui/locale'

  useSeoMeta({
    title: '{{PROJECT_NAME}}',
    ogTitle: '{{PROJECT_NAME}}',
    description: '{{PROJECT_NAME}}',
    ogDescription: '{{PROJECT_NAME}}',
    ogType: 'website',
    twitterCard: 'summary_large_image',
  })
</script>

<template>
  <UApp :locale="zh_tw">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
