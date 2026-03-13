<script setup lang="ts">
  import type { NuxtError } from '#app'

  const props = defineProps<{
    error: NuxtError
  }>()

  const statusCode = computed(() => props.error?.statusCode || 500)

  const title = computed(() => {
    switch (statusCode.value) {
      case 404:
        return 'Page not found'
      case 403:
        return 'Access denied'
      case 500:
        return 'Server error'
      default:
        return 'Something went wrong'
    }
  })

  const description = computed(() => {
    switch (statusCode.value) {
      case 404:
        return 'The page you are looking for does not exist or has been moved.'
      case 403:
        return 'You do not have permission to access this page.'
      case 500:
        return 'An unexpected error occurred. Please try again later.'
      default:
        return props.error?.message || 'An unexpected error occurred.'
    }
  })

  function handleError() {
    clearError({ redirect: '/' })
  }
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center bg-(--ui-bg) px-4">
    <div class="text-center">
      <p class="text-7xl font-bold text-(--ui-primary)">
        {{ statusCode }}
      </p>

      <h1 class="mt-4 text-2xl font-semibold text-(--ui-text-highlighted)">
        {{ title }}
      </h1>

      <p class="mt-2 max-w-md text-(--ui-text-muted)">
        {{ description }}
      </p>

      <div class="mt-8 flex justify-center gap-3">
        <UButton icon="i-lucide-home" @click="handleError"> Back to home </UButton>
        <UButton variant="outline" icon="i-lucide-rotate-ccw" @click="$router.go(0)">
          Try again
        </UButton>
      </div>
    </div>
  </div>
</template>
