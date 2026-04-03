<script setup lang="ts">
  /**
   * 使用者列表表格
   *
   * 展示 Nuxt UI UTable + 分頁 + 搜尋整合 Pinia Colada query。
   *
   * @module app/components/demo/UserTable
   */

  import type { Profile, ProfileListQuery } from '#shared/types/profiles'
  import type { PaginationMeta } from '#shared/types/pagination'
  import type { TableColumn } from '#ui/types'

  const props = defineProps<{
    profiles: Profile[]
    pagination: PaginationMeta
    filters: ProfileListQuery
    loading: boolean
  }>()

  const emit = defineEmits<{
    'update:filters': [filters: Partial<ProfileListQuery>]
  }>()

  // 搜尋 debounce
  const searchInput = ref(props.filters.search ?? '')
  const debouncedSearch = refDebounced(searchInput, 300)

  watch(debouncedSearch, (value) => {
    emit('update:filters', { search: value || undefined, page: 1 })
  })

  // 角色篩選選項
  const roleOptions = [
    { label: '全部', value: '' },
    { label: 'Admin', value: 'admin' },
    { label: 'Manager', value: 'manager' },
    { label: 'User', value: 'user' },
  ]
  const selectedRole = ref('')

  watch(selectedRole, () => {
    // 角色篩選目前由前端過濾（API 不支援 role filter）
    // 如果需要 server-side 篩選，可擴充 API
    emit('update:filters', { page: 1 })
  })

  // 前端角色篩選
  const filteredProfiles = computed(() => {
    if (!selectedRole.value) return props.profiles
    return props.profiles.filter((p) => p.role === selectedRole.value)
  })

  // 表格欄位定義
  const columns: TableColumn<Profile>[] = [
    {
      accessorKey: 'display_name',
      header: '名稱',
    },
    {
      accessorKey: 'role',
      header: '角色',
    },
    {
      accessorKey: 'created_at',
      header: '建立時間',
    },
  ]

  // 分頁
  function goToPage(page: number) {
    emit('update:filters', { page })
  }

  const dateFormatter = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  function formatDate(dateStr: string): string {
    return dateFormatter.format(new Date(dateStr))
  }
</script>

<template>
  <div class="space-y-4">
    <!-- 搜尋 + 篩選列 -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <UInput
        v-model="searchInput"
        placeholder="搜尋名稱..."
        icon="i-lucide-search"
        class="w-full sm:max-w-xs"
      />
      <USelect
        v-model="selectedRole"
        :items="roleOptions"
        value-key="value"
        placeholder="篩選角色"
        class="w-full sm:w-40"
      />
    </div>

    <!-- 表格 -->
    <UTable :data="filteredProfiles" :columns="columns" :loading="loading">
      <template #display_name-cell="{ row }">
        <div class="flex items-center gap-2">
          <UAvatar
            :src="row.original.avatar_url ?? undefined"
            :alt="row.original.display_name ?? ''"
            size="xs"
          />
          <span>{{ row.original.display_name ?? '(未設定)' }}</span>
        </div>
      </template>

      <template #role-cell="{ row }">
        <UBadge
          :color="
            row.original.role === 'admin'
              ? 'error'
              : row.original.role === 'manager'
                ? 'warning'
                : 'info'
          "
          variant="subtle"
        >
          {{ row.original.role }}
        </UBadge>
      </template>

      <template #created_at-cell="{ row }">
        {{ formatDate(row.original.created_at) }}
      </template>
    </UTable>

    <!-- 分頁 -->
    <div v-if="pagination.totalPages > 1" class="flex items-center justify-between">
      <span class="text-sm text-(--ui-text-muted)">
        共 {{ pagination.total }} 筆，第 {{ pagination.page }} / {{ pagination.totalPages }} 頁
      </span>
      <UPagination
        :default-page="pagination.page"
        :total="pagination.total"
        :items-per-page="pagination.perPage"
        @update:page="goToPage"
      />
    </div>
  </div>
</template>
