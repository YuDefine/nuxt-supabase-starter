/**
 * Profile Pinia Colada Queries
 *
 * 展示 query key factory pattern + defineQuery / defineMutation 用法。
 * 所有 API 呼叫透過 $fetch 與 server API 溝通。
 *
 * @module app/queries/profiles
 */

import type {
  ProfileListQuery,
  ProfileListResponse,
  ProfileResponse,
  ProfileUpdateBody,
} from '../../shared/types/profiles'

// ---------------------------------------------------------------------------
// Query Key Factory
// ---------------------------------------------------------------------------

export const profileKeys = {
  /** 所有 profile 相關的根 key */
  all: ['profiles'] as const,
  /** 列表查詢群組 key */
  lists: () => [...profileKeys.all, 'list'] as const,
  /** 帶有篩選條件的列表 key */
  list: (filters: Partial<ProfileListQuery>) => [...profileKeys.lists(), filters] as const,
  /** 單筆查詢群組 key */
  details: () => [...profileKeys.all, 'detail'] as const,
  /** 帶 ID 的單筆查詢 key */
  detail: (id: string) => [...profileKeys.details(), id] as const,
  /** 當前使用者 profile key */
  me: () => [...profileKeys.all, 'me'] as const,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * 查詢 Profile 列表（admin only）
 *
 * 支援分頁與搜尋，staleTime 設為 30 秒避免過度請求。
 */
export const useProfileListQuery = defineQuery(() => {
  const filters = reactive<ProfileListQuery>({
    page: 1,
    perPage: 20,
    search: undefined,
  })

  const { data, status, error, refetch } = useQuery({
    key: () => profileKeys.list(toRaw(filters)),
    query: () =>
      $fetch<ProfileListResponse>('/api/v1/profiles', {
        query: { ...toRaw(filters) },
      }),
    staleTime: 30_000,
  })

  return {
    profiles: data,
    filters,
    status,
    error,
    refetch,
  }
})

/**
 * 查詢單筆 Profile
 */
export const useProfileDetailQuery = defineQuery(() => {
  const profileId = ref('')

  const { data, status, error, refetch } = useQuery({
    key: () => profileKeys.detail(profileId.value),
    query: () => $fetch<ProfileResponse>(`/api/v1/profiles/${profileId.value}`),
    enabled: () => !!profileId.value,
    staleTime: 60_000,
  })

  const profile = computed(() => data.value?.data ?? null)

  return {
    profileId,
    profile,
    status,
    error,
    refetch,
  }
})

/**
 * 查詢當前登入使用者的 Profile
 */
export const useMyProfileQuery = defineQuery(() => {
  const { loggedIn } = useUserSession()

  const { data, status, error, refetch } = useQuery({
    key: () => profileKeys.me(),
    query: () => $fetch<ProfileResponse>('/api/v1/profiles/me'),
    enabled: loggedIn,
    staleTime: 60_000,
  })

  const profile = computed(() => data.value?.data ?? null)

  return {
    profile,
    status,
    error,
    refetch,
  }
})

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * 更新 Profile mutation
 *
 * 成功後自動 invalidate 相關 query cache。
 */
export const useUpdateProfileMutation = defineMutation(() => {
  const queryCache = useQueryCache()

  const { mutate, mutateAsync, status, error, data } = useMutation({
    mutation: (vars: { id: string; body: ProfileUpdateBody }) =>
      $fetch<ProfileResponse>(`/api/v1/profiles/${vars.id}`, {
        method: 'PATCH',
        body: vars.body,
      }),
    onSettled: () => {
      // 成功或失敗都 invalidate，確保 cache 與 server 同步
      queryCache.invalidateQueries({ key: profileKeys.all })
    },
  })

  const updatedProfile = computed(() => data.value?.data ?? null)

  return {
    updateProfile: mutate,
    updateProfileAsync: mutateAsync,
    updatedProfile,
    status,
    error,
  }
})
