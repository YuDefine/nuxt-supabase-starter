<script setup lang="ts">
  definePageMeta({
    layout: 'auth',
    auth: false,
  })

  const { client } = useUserSession()
  const { message: errorMessage, hasError, setError, clearError } = useAuthError()

  const email = ref('')
  const loading = ref(false)
  const submitted = ref(false)

  async function handleSubmit() {
    clearError()
    loading.value = true

    try {
      // Note: actual reset flow should be handled through your auth provider
      // For now, we'll show a placeholder implementation
      if (!client) {
        throw new Error('No auth client available')
      }
      // Placeholder: in real implementation, call your server API
      submitted.value = true
    } catch (err) {
      setError(err)
    } finally {
      loading.value = false
    }
  }
</script>

<template>
  <div class="space-y-6">
    <div class="text-center">
      <h1 class="text-2xl font-bold text-(--ui-text-highlighted)">Forgot Password</h1>
      <p class="mt-1 text-sm text-(--ui-text-muted)">
        Enter your email and we'll send you a reset link.
      </p>
    </div>

    <!-- Success state -->
    <template v-if="submitted">
      <UAlert
        color="success"
        icon="i-lucide-mail-check"
        title="Check your email"
        description="If an account exists with that email, we've sent a password reset link."
      />
      <UButton variant="outline" block to="/auth/login"> Back to Sign In </UButton>
    </template>

    <!-- Form state -->
    <template v-else>
      <!-- Error message -->
      <UAlert
        v-if="hasError"
        color="error"
        icon="i-lucide-alert-circle"
        :title="errorMessage"
        :close-button="{ onClick: clearError }"
      />

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <UFormField label="Email">
          <UInput
            v-model="email"
            type="email"
            placeholder="you@example.com"
            icon="i-lucide-mail"
            required
            autocomplete="email"
          />
        </UFormField>

        <UButton type="submit" block :loading="loading" :disabled="!email">
          Send Reset Link
        </UButton>
      </form>

      <p class="text-center text-sm text-(--ui-text-muted)">
        Remember your password?
        <NuxtLink to="/auth/login" class="font-medium text-primary hover:underline">
          Sign in
        </NuxtLink>
      </p>
    </template>
  </div>
</template>
