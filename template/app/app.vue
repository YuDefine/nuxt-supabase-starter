<script setup lang="ts">
  import { zh_tw } from '@nuxt/ui/locale'

  useSeoMeta({
    title: 'Nuxt Supabase Starter',
    ogTitle: 'Nuxt Supabase Starter',
    description: 'Production-ready Nuxt + Supabase starter template',
    ogDescription: 'Production-ready Nuxt + Supabase starter template',
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
