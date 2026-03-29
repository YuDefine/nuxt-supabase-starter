<script setup lang="ts">
  const colorMode = useColorMode()
  const currentYear = new Date().getFullYear()

  function toggleColorMode() {
    colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
  }
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center bg-(--ui-bg) px-4">
    <!-- Dark mode toggle (top-right) -->
    <div class="fixed top-4 right-4">
      <UButton
        :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
        variant="ghost"
        color="neutral"
        @click="toggleColorMode"
      />
    </div>

    <!-- Centered card -->
    <div class="w-full max-w-md">
      <div class="mb-8 text-center">
        <NuxtLink to="/" class="text-2xl font-bold text-(--ui-text-highlighted)">
          {{ PROJECT_NAME }}
        </NuxtLink>
      </div>

      <UCard>
        <slot />
      </UCard>

      <p class="mt-6 text-center text-sm text-(--ui-text-muted)">
        &copy; {{ currentYear }} {{ PROJECT_NAME }}
      </p>
    </div>
  </div>
</template>
