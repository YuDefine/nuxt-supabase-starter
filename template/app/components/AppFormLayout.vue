<script setup lang="ts">
  interface FormSection {
    title: string
    description?: string
  }

  interface AppFormLayoutProps {
    title?: string
    description?: string
    loading?: boolean
    submitLabel?: string
    cancelLabel?: string
    destructive?: boolean
    sections?: FormSection[]
  }

  withDefaults(defineProps<AppFormLayoutProps>(), {
    loading: false,
    submitLabel: 'Save',
    cancelLabel: 'Cancel',
    destructive: false,
  })

  const emit = defineEmits<{
    submit: []
    cancel: []
  }>()
</script>

<template>
  <form class="flex max-w-2xl flex-col gap-6" @submit.prevent="emit('submit')">
    <!-- Form header -->
    <div v-if="title || description" class="flex flex-col gap-1">
      <h2 v-if="title" class="text-base font-semibold sm:text-lg">
        {{ title }}
      </h2>
      <p v-if="description" class="text-sm text-muted">
        {{ description }}
      </p>
    </div>

    <div class="flex gap-8">
      <!-- Main form content -->
      <div class="min-w-0 flex-1">
        <!-- Sectioned layout -->
        <template v-if="sections?.length">
          <div
            v-for="(section, i) in sections"
            :key="i"
            class="flex flex-col gap-4"
            :class="{ 'mt-2 border-t border-default pt-6': i > 0 }"
          >
            <div class="flex flex-col gap-1">
              <h3 class="text-sm font-medium">{{ section.title }}</h3>
              <p v-if="section.description" class="text-xs text-muted">{{ section.description }}</p>
            </div>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-4">
              <slot :name="`section-${i}`" />
            </div>
          </div>
        </template>

        <!-- Default single-section layout -->
        <template v-else>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-4">
            <slot />
          </div>
        </template>

        <!-- Full-width slot (for fields that span both columns) -->
        <div v-if="$slots['full-width']" class="mt-4">
          <slot name="full-width" />
        </div>
      </div>

      <!-- Aside panel (desktop only) -->
      <div v-if="$slots.aside" class="hidden w-64 shrink-0 lg:block">
        <div class="sticky top-6">
          <slot name="aside" />
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-end gap-3 border-t border-default pt-4">
      <UButton variant="outline" :label="cancelLabel" :disabled="loading" @click="emit('cancel')" />
      <UButton
        type="submit"
        icon="i-lucide-check"
        :label="submitLabel"
        :loading="loading"
        :color="destructive ? 'error' : 'primary'"
      />
    </div>
  </form>
</template>
