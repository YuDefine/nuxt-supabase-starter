<script setup lang="ts">
  const links = [{ label: '首頁', to: '/' }]
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="border-b">
      <UContainer>
        <UNavigationMenu :items="links" class="py-3" />
      </UContainer>
    </header>

    <main class="flex-1">
      <UContainer class="py-8">
        <slot />
      </UContainer>
    </main>

    <footer class="border-t py-4">
      <UContainer>
        <p class="text-center text-sm text-gray-500">{{ projectName }}</p>
      </UContainer>
    </footer>
  </div>
</template>
