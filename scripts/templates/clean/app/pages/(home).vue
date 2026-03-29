<script setup lang="ts">
  useSeoMeta({
    title: 'Welcome',
  })
</script>

<template>
  <div class="flex min-h-[60vh] flex-col items-center justify-center">
    <h1 class="text-4xl font-bold text-(--ui-text-highlighted)">
      {{ PROJECT_NAME }}
    </h1>
    <p class="mt-4 text-lg text-(--ui-text-muted)">Your project is ready. Start building!</p>
    <div class="mt-8 flex gap-4">
      <UButton
        to="https://nuxt.com/docs"
        target="_blank"
        variant="outline"
        icon="i-lucide-book-open"
      >
        Nuxt Docs
      </UButton>
      <UButton
        to="https://supabase.com/docs"
        target="_blank"
        variant="outline"
        icon="i-lucide-database"
      >
        Supabase Docs
      </UButton>
    </div>
  </div>
</template>
