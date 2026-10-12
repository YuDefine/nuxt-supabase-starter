<script setup lang="ts">
  /**
   * Admin 使用者管理頁面（簡化版本）
   *
   * @module app/pages/admin/users
   */

  // 此頁面受全域 auth middleware 保護，未登入會自動導向登入頁
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6">
    <header>
      <h1 class="text-3xl font-bold text-(--ui-text-highlighted)">User Management</h1>
      <p class="mt-1 text-sm text-(--ui-text-muted)">
        Admin panel for managing users (Feature in development)
      </p>
    </header>

    <UCard>
      <div class="py-12 text-center text-(--ui-text-muted)">
        User management features coming soon
      </div>
    </UCard>
  </div>
</template>
