<script setup lang="ts">
  definePageMeta({ layout: 'auth', auth: false })

  const { signUp } = useUserSession()
  const { parseAuthError } = useAuthError()
  const name = ref('')
  const email = ref('')
  const password = ref('')
  const loading = ref(false)
  const errorMessage = ref('')

  async function handleRegister() {
    loading.value = true
    errorMessage.value = ''
    try {
      await signUp.email({ name: name.value, email: email.value, password: password.value })
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
      <h1 class="text-2xl font-bold">註冊</h1>
    </div>

    <UAlert v-if="errorMessage" color="error" :title="errorMessage" />

    <form class="flex flex-col gap-4" @submit.prevent="handleRegister">
      <UFormField label="名稱">
        <UInput v-model="name" type="text" required placeholder="你的名稱" />
      </UFormField>
      <UFormField label="Email">
        <UInput v-model="email" type="email" required placeholder="you@example.com" />
      </UFormField>
      <UFormField label="密碼">
        <UInput v-model="password" type="password" required placeholder="••••••••" />
      </UFormField>
      <UButton block size="lg" type="submit" :loading="loading"> 註冊 </UButton>
    </form>

    <p class="text-center text-sm">
      已有帳號？
      <NuxtLink to="/auth/login" class="text-primary hover:underline">登入</NuxtLink>
    </p>
  </div>
</template>
