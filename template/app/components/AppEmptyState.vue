<script setup lang="ts">
  interface AppEmptyStateProps {
    icon?: string
    message: string
    description?: string
    actionLabel?: string
    actionTo?: string
  }

  withDefaults(defineProps<AppEmptyStateProps>(), {
    icon: 'i-lucide-inbox',
  })

  const emit = defineEmits<{
    action: []
  }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 py-10 text-center">
    <div class="flex size-12 items-center justify-center rounded-full bg-primary/10">
      <UIcon :name="icon" class="size-6 text-primary" />
    </div>
    <p class="max-w-xs text-sm text-muted">
      {{ message }}
    </p>
    <p v-if="description" class="max-w-sm text-xs text-muted/70">
      {{ description }}
    </p>
    <UButton v-if="actionLabel" variant="outline" size="sm" :to="actionTo" @click="emit('action')">
      {{ actionLabel }}
    </UButton>
  </div>
</template>
