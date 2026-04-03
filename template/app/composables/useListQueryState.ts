import { watchDebounced } from '@vueuse/core'

export interface ListQueryStateConfig<T extends Record<string, string>> {
  filters: T
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  pageSize?: number
}

export function useListQueryState<T extends Record<string, string>>(
  config: ListQueryStateConfig<T>
) {
  const {
    filters: defaults,
    sortBy: defaultSortBy = '',
    sortDir: defaultSortDir = 'asc',
    pageSize: defaultPageSize = 20,
  } = config

  const route = useRoute()
  const router = useRouter()

  const filters = reactive<T>(
    Object.keys(defaults).reduce((acc, key) => {
      const k = key as keyof T
      acc[k] = ((route.query[key] as string) || defaults[k]) as T[keyof T]
      return acc
    }, {} as T)
  )

  const search = ref((route.query.q as string) || '')
  const page = ref(Number(route.query.page) || 1)
  const pageSize = ref(Number(route.query.pageSize) || defaultPageSize)
  const sortBy = ref((route.query.sortBy as string) || defaultSortBy)
  const sortDir = ref<'asc' | 'desc'>(
    ((route.query.sortDir as string) || defaultSortDir) as 'asc' | 'desc'
  )

  const hasActiveFilters = computed(() => {
    if (search.value) return true
    for (const key of Object.keys(defaults)) {
      if ((filters as Record<string, string>)[key] !== defaults[key as keyof T]) {
        return true
      }
    }
    return false
  })

  const params = computed(() => ({
    ...filters,
    q: search.value,
    page: page.value,
    pageSize: pageSize.value,
    sortBy: sortBy.value,
    sortDir: sortDir.value,
  }))

  watch([() => ({ ...filters }), search, sortBy, sortDir], () => {
    page.value = 1
  })

  // Omit empty/default values for clean URLs
  watchDebounced(
    [() => ({ ...filters }), search, page, pageSize, sortBy, sortDir],
    () => {
      const query: Record<string, string> = {}

      for (const key of Object.keys(defaults)) {
        const value = (filters as Record<string, string>)[key]
        if (value && value !== defaults[key as keyof T]) {
          query[key] = value
        }
      }

      if (search.value) {
        query.q = search.value
      }

      if (page.value > 1) {
        query.page = String(page.value)
      }

      if (pageSize.value !== defaultPageSize) {
        query.pageSize = String(pageSize.value)
      }

      if (sortBy.value && sortBy.value !== defaultSortBy) {
        query.sortBy = sortBy.value
      }

      if (sortDir.value !== defaultSortDir) {
        query.sortDir = sortDir.value
      }

      router.replace({ query })
    },
    { debounce: 300 }
  )

  function reset() {
    search.value = ''
    page.value = 1
    pageSize.value = defaultPageSize
    sortBy.value = defaultSortBy
    sortDir.value = defaultSortDir

    for (const key of Object.keys(defaults)) {
      const k = key as keyof T
      ;(filters as Record<string, string>)[k as string] = defaults[k] as string
    }
  }

  return {
    filters,
    search,
    page,
    pageSize,
    sortBy,
    sortDir,
    hasActiveFilters,
    params: readonly(params),
    reset,
  }
}
