<script setup lang="ts">
  /**
   * 個人 Profile 頁面（簡化版本）
   *
   * @module app/pages/profile/index
   */

  const { loggedIn, user } = useUserSession()
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <header>
      <h1 class="text-2xl font-bold text-(--ui-text-highlighted)">個人資料</h1>
      <p class="mt-1 text-(--ui-text-muted)">查看與編輯您的個人資料</p>
    </header>

    <UCard v-if="loggedIn">
      <div class="space-y-4">
        <div class="flex items-center gap-4">
          <UAvatar :src="user?.image || ''" size="lg" />
          <div>
            <p class="text-sm font-medium">{{ user?.name ?? user?.email }}</p>
            <p class="text-sm text-(--ui-text-muted)">{{ user?.email }}</p>
          </div>
        </div>
      </div>
    </UCard>

    <UCard v-else>
      <div class="py-12 text-center text-(--ui-text-muted)">
        <p>Please sign in to view your profile</p>
      </div>
    </UCard>
  </div>
</template>
