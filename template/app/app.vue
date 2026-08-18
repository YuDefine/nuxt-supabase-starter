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
    <!-- Tier 1 路由級進度條（clade rules/modules/framework/nuxt/page-loading-golden-path.md）：
         零 per-page code、自帶 a11y，解掉導航空白感。MUST 掛在 UApp 內、NuxtLayout 前。 -->
    <NuxtLoadingIndicator />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
