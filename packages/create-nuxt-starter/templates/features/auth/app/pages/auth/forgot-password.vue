<script setup lang="ts">
  definePageMeta({ layout: 'auth', auth: false })

  const { forgetPassword } = useUserSession()
  const email = ref('')
  const loading = ref(false)
  const sent = ref(false)

  async function handleSubmit() {
    loading.value = true
    try {
      await forgetPassword({ email: email.value })
      sent.value = true
    } finally {
      loading.value = false
    }
  }
</script>

<template>
  <div class="mx-auto w-full max-w-sm space-y-6">
    <div class="text-center">
      <h1 class="text-2xl font-bold">忘記密碼</h1>
    </div>

    <div v-if="sent" class="text-center text-green-600">重設連結已寄送至 {{ email }}</div>

    <form v-else @submit.prevent="handleSubmit" class="space-y-4">
      <div>
        <label class="mb-1 block text-sm font-medium">Email</label>
        <input v-model="email" type="email" required class="w-full rounded border px-3 py-2" />
      </div>
      <button
        type="submit"
        :disabled="loading"
        class="w-full rounded bg-blue-600 py-2 text-white hover:bg-blue-700"
      >
        {{ loading ? '送出中...' : '送出重設連結' }}
      </button>
    </form>

    <p class="text-center text-sm">
      <NuxtLink to="/auth/login" class="text-blue-600 hover:underline">返回登入</NuxtLink>
    </p>
  </div>
</template>
