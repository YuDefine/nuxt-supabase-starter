<script setup lang="ts">
  definePageMeta({ layout: 'auth', auth: false })

  const { signUp } = useUserSession()
  const name = ref('')
  const email = ref('')
  const password = ref('')
  const loading = ref(false)
  const error = ref('')

  async function handleRegister() {
    loading.value = true
    error.value = ''
    try {
      await signUp.email({ name: name.value, email: email.value, password: password.value })
      await navigateTo('/')
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Registration failed'
    } finally {
      loading.value = false
    }
  }
</script>

<template>
  <div class="mx-auto w-full max-w-sm space-y-6">
    <div class="text-center">
      <h1 class="text-2xl font-bold">註冊</h1>
    </div>

    <form @submit.prevent="handleRegister" class="space-y-4">
      <div v-if="error" class="text-sm text-red-500">{{ error }}</div>
      <div>
        <label class="mb-1 block text-sm font-medium">名稱</label>
        <input v-model="name" type="text" required class="w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium">Email</label>
        <input v-model="email" type="email" required class="w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium">密碼</label>
        <input
          v-model="password"
          type="password"
          required
          class="w-full rounded border px-3 py-2"
        />
      </div>
      <button
        type="submit"
        :disabled="loading"
        class="w-full rounded bg-blue-600 py-2 text-white hover:bg-blue-700"
      >
        {{ loading ? '註冊中...' : '註冊' }}
      </button>
    </form>

    <p class="text-center text-sm">
      已有帳號？
      <NuxtLink to="/auth/login" class="text-blue-600 hover:underline">登入</NuxtLink>
    </p>
  </div>
</template>
