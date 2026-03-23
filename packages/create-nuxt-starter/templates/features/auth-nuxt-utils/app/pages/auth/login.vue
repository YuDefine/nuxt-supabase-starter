<script setup lang="ts">
  definePageMeta({ layout: 'auth', auth: false })

  const route = useRoute()
  const router = useRouter()
  const { loggedIn } = useUserSession()
  const { parseError } = useAuthError()

  const isLoading = ref(false)
  const errorMessage = ref('')

  if (route.query.error && typeof route.query.error === 'string') {
    errorMessage.value = parseError(route.query.error)
  }

  const redirectTo = computed(() => {
    const target = route.query.redirect
    return typeof target === 'string' && target.startsWith('/') ? target : '/'
  })

  watch(
    loggedIn,
    (val) => {
      if (val) router.replace(redirectTo.value)
    },
    { immediate: true }
  )

  function handleGoogleSignIn() {
    isLoading.value = true
    const cookie = useCookie('auth-redirect', { path: '/', maxAge: 300 })
    cookie.value = redirectTo.value
    navigateTo('/auth/google', { external: true })
  }
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-center">
      <h1 class="text-2xl font-bold">Welcome</h1>
      <p class="mt-1 text-sm text-gray-500">Sign in to continue</p>
    </div>

    <UAlert v-if="errorMessage" color="error" :title="errorMessage" />

    <UButton
      block
      size="lg"
      color="neutral"
      variant="outline"
      :loading="isLoading"
      @click="handleGoogleSignIn"
    >
      使用 Google 登入
    </UButton>
  </div>
</template>
