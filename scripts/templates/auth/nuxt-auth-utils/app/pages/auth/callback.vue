<script setup lang="ts">
  definePageMeta({
    layout: 'auth',
    auth: false,
  })

  const { fetch: fetchSession, loggedIn } = useUserSession()
  const { message: errorMessage, hasError, setError } = useAuthError()
  const loading = ref(true)

  onMounted(async () => {
    try {
      await fetchSession()

      if (loggedIn.value) {
        await navigateTo('/', { replace: true })
      } else {
        setError('Authentication failed. Please try again.')
      }
    } catch (err) {
      setError(err)
    } finally {
      loading.value = false
    }
  })
</script>

<template>
  <div class="space-y-6 text-center">
    <template v-if="loading">
      <div class="flex flex-col items-center gap-4 py-8">
        <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-(--ui-text-muted)" />
        <p class="text-sm text-(--ui-text-muted)">Completing sign in...</p>
      </div>
    </template>

    <template v-else-if="hasError">
      <UAlert color="error" icon="i-lucide-alert-circle" :title="errorMessage" />
      <UButton variant="outline" block to="/auth/login"> Back to Sign In </UButton>
    </template>
  </div>
</template>
