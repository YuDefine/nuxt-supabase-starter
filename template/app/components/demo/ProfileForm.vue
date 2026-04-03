<script setup lang="ts">
  /**
   * Profile 編輯表單（簡化版本）
   *
   * @module app/components/demo/ProfileForm
   */

  import type { Profile } from '#shared/types/profiles'

  const props = defineProps<{
    profile: Profile
  }>()

  const _emit = defineEmits<{
    updated: [profile: Profile]
  }>()

  const toast = useToast()

  const form = reactive({
    display_name: props.profile?.display_name ?? '',
  })

  async function onSubmit() {
    toast.add({
      title: '更新成功',
      description: 'Profile 已成功更新',
      color: 'success',
    })
  }
</script>

<template>
  <form class="space-y-4" @submit.prevent="onSubmit">
    <UFormField label="顯示名稱">
      <UInput v-model="form.display_name" placeholder="請輸入顯示名稱" />
    </UFormField>

    <div class="flex items-center gap-3 pt-2">
      <UButton type="submit">儲存變更</UButton>
    </div>
  </form>
</template>
