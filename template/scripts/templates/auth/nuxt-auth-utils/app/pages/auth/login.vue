<script setup lang="ts">
  definePageMeta({
    layout: 'auth',
    auth: false,
  })

  const { loggedIn } = useUserSession()
  const { message: errorMessage, hasError, setError, clearError } = useAuthError()
  const route = useRoute()
  const redirectTo = computed(() => (route.query.redirect as string) || '/')

  // If already logged in, redirect
  watch(
    loggedIn,
    (val) => {
      if (val) navigateTo(redirectTo.value)
    },
    { immediate: true }
  )

  // Check for error in URL (e.g., session expired)
  const urlError = route.query.error as string | undefined
  if (urlError === 'session_expired') {
    setError('Session expired, please sign in again.')
  }
</script>

<template>
  <div class="space-y-6">
    <div class="text-center">
      <h1 class="text-2xl font-bold text-(--ui-text-highlighted)">Welcome Back</h1>
      <p class="mt-1 text-sm text-(--ui-text-muted)">Sign in to your account to continue</p>
    </div>

    <!-- Error message -->
    <UAlert
      v-if="hasError"
      color="error"
      icon="i-lucide-alert-circle"
      :title="errorMessage"
      :close-button="{ onClick: clearError }"
    />

    <!-- OAuth providers -->
    <div class="space-y-3">
      <UButton
        color="neutral"
        variant="outline"
        block
        icon="i-lucide-chrome"
        label="Continue with Google"
        to="/auth/google"
        external
      />
      <UButton
        color="neutral"
        variant="outline"
        block
        icon="i-lucide-github"
        label="Continue with GitHub"
        to="/auth/github"
        external
      />
    </div>
  </div>
</template>
