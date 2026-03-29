<script setup lang="ts">
  import type { BreadcrumbItem } from '@nuxt/ui'

  interface AppPageShellProps {
    title: string
    description?: string
    breadcrumb?: BreadcrumbItem[]
  }

  defineProps<AppPageShellProps>()
</script>

<template>
  <div class="flex flex-col gap-6 py-2">
    <!-- Breadcrumb (hidden on mobile) -->
    <UBreadcrumb v-if="breadcrumb?.length" :items="breadcrumb" class="hidden sm:flex" />

    <!-- Page header -->
    <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div class="min-w-0">
        <h1 class="truncate text-xl font-semibold tracking-tight text-highlighted sm:text-2xl">
          {{ title }}
        </h1>
        <p v-if="description" class="mt-1 text-sm text-muted">
          {{ description }}
        </p>
      </div>

      <!-- Actions slot -->
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </div>

    <!-- Stats slot (summary KPIs, badges) -->
    <div v-if="$slots.stats">
      <slot name="stats" />
    </div>

    <!-- Subnav slot (tabs, segmented control) -->
    <div v-if="$slots.subnav">
      <slot name="subnav" />
    </div>

    <!-- Toolbar slot (filters, view toggles, bulk actions) -->
    <div v-if="$slots.toolbar">
      <slot name="toolbar" />
    </div>

    <!-- Page content -->
    <slot />
  </div>
</template>
