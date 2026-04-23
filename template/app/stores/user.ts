/**
 * User profile store
 *
 * Manages user state from session, computes display name / role,
 * and loads full profile from API when needed.
 */
import type { Profile, ProfileResponse } from '#shared/schemas/profiles'

export const useUserStore = defineStore('user', () => {
  const { user: sessionUser, loggedIn } = useUserSession()

  // State
  const profile = ref<Profile | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Computed
  const displayName = computed(() => {
    if (profile.value?.display_name) return profile.value.display_name
    if (sessionUser.value?.name) return sessionUser.value.name
    if (sessionUser.value?.email) return sessionUser.value.email
    return 'User'
  })

  const role = computed(() => {
    if (profile.value?.role) return profile.value.role
    if (sessionUser.value && 'role' in sessionUser.value) {
      return (sessionUser.value as Record<string, unknown>).role as string
    }
    return 'user'
  })

  const isAdmin = computed(() => role.value === 'admin')
  const isManager = computed(() => role.value === 'manager' || role.value === 'admin')

  /**
   * Hydrate store from session data (no API call)
   */
  function hydrateFromSession() {
    if (sessionUser.value) {
      profile.value = null
    }
  }

  /**
   * Load full user profile from API
   */
  async function loadProfile() {
    if (!loggedIn.value) return

    loading.value = true
    error.value = null

    try {
      const response = await $fetch<ProfileResponse>('/api/v1/profiles/me')
      profile.value = response.data
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load profile'
    } finally {
      loading.value = false
    }
  }

  /**
   * Clear store state (on logout)
   */
  function $reset() {
    profile.value = null
    loading.value = false
    error.value = null
  }

  return {
    // State
    profile,
    loading,
    error,

    // Computed
    displayName,
    role,
    isAdmin,
    isManager,

    // Actions
    hydrateFromSession,
    loadProfile,
    $reset,
  }
})
