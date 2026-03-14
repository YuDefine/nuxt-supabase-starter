<script setup lang="ts">
  definePageMeta({ auth: false })

  const steps = [
    {
      step: 1,
      title: '首頁',
      description: '乾淨的歡迎頁面，展示專案功能概覽與快速開始指引。',
      icon: 'i-lucide-home',
      link: '/',
      color: 'primary' as const,
    },
    {
      step: 2,
      title: '元件展示',
      description: '完整的 Nuxt UI 元件庫展示：按鈕、表單、圖表、Modal 等互動元件。',
      icon: 'i-lucide-layout-dashboard',
      link: '/demo',
      color: 'info' as const,
    },
    {
      step: 3,
      title: '註冊 / 登入',
      description: '支援 Email + 密碼註冊，以及 Google、GitHub、LINE 等 OAuth 登入。',
      icon: 'i-lucide-log-in',
      link: '/auth/login',
      color: 'success' as const,
    },
    {
      step: 4,
      title: '個人檔案',
      description: '登入後可編輯個人資料，資料透過 Server API 寫入 Supabase。',
      icon: 'i-lucide-user',
      link: '/profile',
      color: 'secondary' as const,
    },
    {
      step: 5,
      title: '管理後台',
      description: 'Admin 角色可瀏覽所有使用者，支援分頁搜尋與角色管理。',
      icon: 'i-lucide-shield',
      link: '/admin/users',
      color: 'warning' as const,
    },
  ]
</script>

<template>
  <div class="space-y-8">
    <header class="py-8 text-center">
      <h1 class="text-3xl font-bold">應用程式導覽</h1>
      <p class="mt-2 text-(--ui-text-muted)">了解這個 Starter 包含哪些功能，跟著步驟體驗完整流程</p>
    </header>

    <div class="mx-auto max-w-2xl space-y-4">
      <UCard v-for="s in steps" :key="s.step">
        <div class="flex items-start gap-4">
          <div class="flex-shrink-0">
            <UBadge
              :color="s.color"
              size="lg"
              class="flex h-8 w-8 items-center justify-center rounded-full"
            >
              {{ s.step }}
            </UBadge>
          </div>
          <div class="flex-1">
            <div class="mb-1 flex items-center gap-2">
              <UIcon :name="s.icon" class="size-5" />
              <h3 class="text-lg font-semibold">{{ s.title }}</h3>
            </div>
            <p class="text-sm text-(--ui-text-muted)">{{ s.description }}</p>
            <div class="mt-3">
              <ULink :to="s.link" class="text-sm font-semibold text-(--ui-primary)"> 前往 → </ULink>
            </div>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
