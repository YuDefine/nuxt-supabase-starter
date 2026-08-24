<script setup lang="ts">
  definePageMeta({ layout: 'auth', auth: false })

  // `@nuxtjs/better-auth` 0.1.x 起 signIn/signUp 不再掛在 `useUserSession()` 上，
  // 改成各自的 action handle：`execute()` NEVER throw，成敗看 `status` / `error`。
  const signIn = useSignIn('email')
  const { parseAuthError } = useAuthError()
  const email = ref('')
  const password = ref('')
  const errorMessage = ref('')
  const loading = computed(() => signIn.status.value === 'pending')

  async function handleLogin() {
    errorMessage.value = ''
    await signIn.execute({ email: email.value, password: password.value })

    if (signIn.error.value) {
      errorMessage.value = parseAuthError(signIn.error.value)
      return
    }

    await navigateTo('/')
  }
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-center">
      <h1 class="text-2xl font-bold">登入</h1>
    </div>

    <UAlert v-if="errorMessage" color="error" :title="errorMessage" />

    <form class="flex flex-col gap-4" @submit.prevent="handleLogin">
      <UFormField label="Email">
        <UInput v-model="email" type="email" required placeholder="you@example.com" />
      </UFormField>
      <UFormField label="密碼">
        <UInput v-model="password" type="password" required placeholder="••••••••" />
      </UFormField>
      <UButton block size="lg" type="submit" :loading="loading"> 登入 </UButton>
    </form>

    <div class="flex items-center justify-between text-sm">
      <NuxtLink to="/auth/register" class="text-primary hover:underline">還沒有帳號？註冊</NuxtLink>
      <NuxtLink to="/auth/forgot-password" class="text-gray-500 hover:underline">忘記密碼</NuxtLink>
    </div>
  </div>
</template>
