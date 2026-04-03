<script setup lang="ts">
  definePageMeta({ layout: 'auth', auth: false })

  const { signIn } = useUserSession()
  const { parseAuthError } = useAuthError()
  const email = ref('')
  const password = ref('')
  const loading = ref(false)
  const errorMessage = ref('')

  async function handleLogin() {
    loading.value = true
    errorMessage.value = ''
    try {
      await signIn.email({ email: email.value, password: password.value })
      await navigateTo('/')
    } catch (e: unknown) {
      errorMessage.value = parseAuthError(e)
    } finally {
      loading.value = false
    }
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
