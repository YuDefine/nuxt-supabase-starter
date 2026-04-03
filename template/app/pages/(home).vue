<script setup lang="ts">
  const features = [
    {
      icon: 'i-lucide-layout-dashboard',
      name: 'Nuxt UI',
      desc: '元件庫 + Tailwind CSS',
      bgClass: 'bg-primary-100 dark:bg-primary-900',
      iconClass: 'text-primary-600 dark:text-primary-400',
    },
    {
      icon: 'i-lucide-database',
      name: 'Supabase',
      desc: 'PostgreSQL + Auth',
      bgClass: 'bg-green-100 dark:bg-green-900',
      iconClass: 'text-green-600 dark:text-green-400',
    },
    {
      icon: 'i-lucide-shield-check',
      name: 'TypeScript',
      desc: '型別安全',
      bgClass: 'bg-orange-100 dark:bg-orange-900',
      iconClass: 'text-orange-600 dark:text-orange-400',
    },
    {
      icon: 'i-lucide-test-tube',
      name: 'Vitest',
      desc: '單元 + E2E 測試',
      bgClass: 'bg-purple-100 dark:bg-purple-900',
      iconClass: 'text-purple-600 dark:text-purple-400',
    },
  ]
</script>

<template>
  <div class="space-y-12">
    <header class="py-12 text-center">
      <h1 class="text-4xl font-bold text-(--ui-text-highlighted)">Nuxt Supabase Starter</h1>
      <p class="mt-3 text-lg text-(--ui-text-muted)">Production-ready 全端開發範本</p>
      <div class="mt-8 flex justify-center gap-4">
        <UButton to="/demo" variant="outline" icon="i-lucide-eye"> 元件展示 </UButton>
        <UButton to="/auth/login" icon="i-lucide-log-in"> 登入 </UButton>
      </div>
    </header>

    <section>
      <h2 class="mb-6 text-center text-2xl font-semibold">內建功能</h2>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <UCard v-for="f in features" :key="f.name">
          <div class="flex items-center gap-3">
            <div class="rounded-lg p-2" :class="f.bgClass">
              <UIcon :name="f.icon" class="size-5" :class="f.iconClass" />
            </div>
            <div>
              <h3 class="font-medium">{{ f.name }}</h3>
              <p class="text-sm text-gray-500">{{ f.desc }}</p>
            </div>
          </div>
        </UCard>
      </div>
    </section>

    <section class="pb-8 text-center">
      <h2 class="mb-4 text-2xl font-semibold">快速開始</h2>
      <div class="inline-block rounded-lg bg-(--ui-bg-elevated) p-6 text-left">
        <code class="text-sm">
          <span class="text-(--ui-text-muted)">$</span> git clone
          https://github.com/YuDefine/nuxt-supabase-starter my-project<br />
          <span class="text-(--ui-text-muted)">$</span> cd my-project<br />
          <span class="text-(--ui-text-muted)">$</span> pnpm setup
        </code>
      </div>
      <p class="mt-4 text-sm text-(--ui-text-muted)">
        📖
        <a
          href="https://github.com/YuDefine/nuxt-supabase-starter/blob/main/docs/QUICK_START.md"
          target="_blank"
          class="underline"
          >完整設定步驟</a
        >
      </p>
    </section>
  </div>
</template>
