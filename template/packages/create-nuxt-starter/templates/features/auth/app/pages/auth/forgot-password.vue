<script setup lang="ts">
  definePageMeta({ layout: 'auth', auth: false })

  // 0.1.x 的 auth client 從 `useAuthClient()` 取（`useUserSession().client` 已不存在）；
  // clientOnly / SSR 期間可能是 null，所以呼叫前 MUST 判。
  const authClient = useAuthClient()
  const email = ref('')
  const loading = ref(false)
  const sent = ref(false)
  const errorMessage = ref('')

  async function handleSubmit() {
    loading.value = true
    errorMessage.value = ''
    try {
      if (!authClient) {
        errorMessage.value = '認證用戶端尚未就緒，請稍後再試'
        return
      }

      // TODO(project): 接上實際的重設密碼流程，例如
      // `await authClient.requestPasswordReset({ email: email.value, redirectTo: '/auth/reset' })`
      // —— 需要先在 server/auth.config.ts 設定寄信。
      sent.value = true
    } finally {
      loading.value = false
    }
  }
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-center">
      <h1 class="text-2xl font-bold">忘記密碼</h1>
    </div>

    <UAlert v-if="errorMessage" color="error" :title="errorMessage" />

    <UAlert v-if="sent" color="success" :title="`重設連結已寄送至 ${email}`" />

    <form v-else class="flex flex-col gap-4" @submit.prevent="handleSubmit">
      <UFormField label="Email">
        <UInput v-model="email" type="email" required placeholder="you@example.com" />
      </UFormField>
      <UButton block size="lg" type="submit" :loading="loading"> 送出重設連結 </UButton>
    </form>

    <p class="text-center text-sm">
      <NuxtLink to="/auth/login" class="text-primary hover:underline">返回登入</NuxtLink>
    </p>
  </div>
</template>
