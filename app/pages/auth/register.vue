<script setup lang="ts">
  definePageMeta({
    layout: 'auth',
    auth: false,
  })

  const { signUp } = useUserSession()
  const { message: errorMessage, hasError, setError, clearError } = useAuthError()

  const form = reactive({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const loading = ref(false)

  const passwordMismatch = computed(
    () => form.confirmPassword !== '' && form.password !== form.confirmPassword
  )

  const canSubmit = computed(
    () => form.name && form.email && form.password && form.confirmPassword && !passwordMismatch.value
  )

  async function handleRegister() {
    if (passwordMismatch.value) return

    clearError()
    loading.value = true

    try {
      await signUp.email(
        {
          name: form.name,
          email: form.email,
          password: form.password,
        },
        {
          onSuccess: async () => {
            await navigateTo('/')
          },
          onError: (ctx: any) => setError(ctx.error),
        }
      )
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
      <h1 class="text-2xl font-bold text-(--ui-text-highlighted)">Create Account</h1>
      <p class="mt-1 text-sm text-(--ui-text-muted)">Sign up to get started</p>
    </div>

    <!-- Error message -->
    <UAlert
      v-if="hasError"
      color="error"
      icon="i-lucide-alert-circle"
      :title="errorMessage"
      :close-button="{ onClick: clearError }"
    />

    <!-- Registration form -->
    <form class="space-y-4" @submit.prevent="handleRegister">
      <UFormField label="Name">
        <UInput
          v-model="form.name"
          placeholder="Your name"
          icon="i-lucide-user"
          autocomplete="name"
        />
      </UFormField>

      <UFormField label="Email">
        <UInput
          v-model="form.email"
          type="email"
          placeholder="you@example.com"
          icon="i-lucide-mail"
          autocomplete="email"
        />
      </UFormField>

      <UFormField label="Password">
        <UInput
          v-model="form.password"
          type="password"
          placeholder="••••••••"
          icon="i-lucide-lock"
          autocomplete="new-password"
        />
      </UFormField>

      <UFormField label="Confirm Password">
        <UInput
          v-model="form.confirmPassword"
          type="password"
          placeholder="••••••••"
          icon="i-lucide-lock"
          autocomplete="new-password"
          :class="{ 'is-error': passwordMismatch }"
        />
        <p v-if="passwordMismatch" class="mt-1 text-sm text-red-500">Passwords do not match</p>
      </UFormField>

      <UButton type="submit" block :loading="loading" :disabled="!canSubmit">
        Create Account
      </UButton>
    </form>

    <!-- OAuth providers -->
    <div class="space-y-2">
      <div class="relative">
        <div class="absolute inset-0 flex items-center">
          <div class="w-full border-t border-(--ui-border)" />
        </div>
        <div class="relative flex justify-center text-sm">
          <span class="bg-(--ui-bg) px-2 text-(--ui-text-muted)">Or continue with</span>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2">
        <UButton color="neutral" variant="outline" block icon="i-lucide-github" />
        <UButton color="neutral" variant="outline" block icon="i-lucide-chrome" />
        <UButton color="neutral" variant="outline" block icon="i-lucide-type" />
      </div>
    </div>

    <!-- Sign in link -->
    <p class="text-center text-sm text-(--ui-text-muted)">
      Already have an account?
      <NuxtLink to="/auth/login" class="font-medium text-primary hover:underline">
        Sign in
      </NuxtLink>
    </p>
  </div>
</template>
