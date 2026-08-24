<script setup lang="ts">
  definePageMeta({
    layout: 'auth',
    auth: false,
  })

  // `@nuxtjs/better-auth` 0.1.x 起 signIn 不再掛在 `useUserSession()` 上，改成各自的
  // action handle：`execute()` NEVER throw，成敗一律看 `status` / `error`。
  const signIn = useSignIn('email')
  const signInSocial = useSignIn('social')
  const { message: errorMessage, hasError, setError, clearError } = useAuthError()
  const route = useRoute()

  // 只接受 site-relative 路徑，擋掉 `//evil.example` 這類 protocol-relative 的 open redirect。
  const redirectTo = computed(() => {
    const target = route.query.redirect
    if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')) return '/'
    return target
  })

  const form = reactive({
    email: '',
    password: '',
  })
  const loading = computed(() => signIn.status.value === 'pending')

  async function handleEmailLogin() {
    clearError()
    await signIn.execute({ email: form.email, password: form.password })

    if (signIn.error.value) {
      setError(signIn.error.value)
      return
    }

    await navigateTo(redirectTo.value)
  }

  // provider 是 typed —— 只吃 server/auth.config.ts 的 `socialProviders` 有列出來的 id。
  async function handleOAuthLogin(provider: 'google' | 'github' | 'line') {
    clearError()
    // 成功時瀏覽器會被導去 provider，這裡不會往下跑；失敗（例如未設定 credentials）才回來。
    await signInSocial.execute({ provider, callbackURL: redirectTo.value })

    if (signInSocial.error.value) {
      setError(signInSocial.error.value)
    }
  }
</script>

<template>
  <div class="space-y-6">
    <div class="text-center">
      <h1 class="text-2xl font-bold text-(--ui-text-highlighted)">Sign In</h1>
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

    <!-- Email login form -->
    <form class="space-y-4" @submit.prevent="handleEmailLogin">
      <UFormField label="Email">
        <UInput
          v-model="form.email"
          type="email"
          placeholder="you@example.com"
          icon="i-lucide-mail"
          autocomplete="email"
          required
        />
      </UFormField>

      <UFormField label="Password">
        <UInput
          v-model="form.password"
          type="password"
          placeholder="Enter your password"
          icon="i-lucide-lock"
          autocomplete="current-password"
          required
        />
      </UFormField>

      <div class="flex items-center justify-between">
        <NuxtLink
          to="/auth/forgot-password"
          class="text-sm font-medium text-primary hover:underline"
        >
          Forgot password?
        </NuxtLink>
      </div>

      <UButton type="submit" block :loading="loading" :disabled="!form.email || !form.password">
        Sign In
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
        <UButton
          color="neutral"
          variant="outline"
          block
          icon="i-lucide-github"
          aria-label="GitHub"
          @click="handleOAuthLogin('github')"
        />
        <UButton
          color="neutral"
          variant="outline"
          block
          icon="i-lucide-chrome"
          aria-label="Google"
          @click="handleOAuthLogin('google')"
        />
        <UButton
          color="neutral"
          variant="outline"
          block
          icon="i-lucide-type"
          aria-label="LINE"
          @click="handleOAuthLogin('line')"
        />
      </div>
    </div>

    <!-- Sign up link -->
    <p class="text-center text-sm text-(--ui-text-muted)">
      Don't have an account?
      <NuxtLink to="/auth/register" class="font-medium text-primary hover:underline">
        Sign up
      </NuxtLink>
    </p>
  </div>
</template>
