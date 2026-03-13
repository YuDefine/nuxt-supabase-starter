/**
 * 角色檢查 helpers composable
 *
 * 基於 user store 的 computed，提供便捷的角色檢查函式。
 *
 * @module app/composables/useUserRole
 */

export interface UseUserRoleReturn {
  role: ComputedRef<string>
  isAdmin: ComputedRef<boolean>
  isManager: ComputedRef<boolean>
  hasRole: (targetRole: string) => boolean
  hasAnyRole: (roles: string[]) => boolean
}

export function useUserRole(): UseUserRoleReturn {
  const userStore = useUserStore()

  const role = computed(() => userStore.role)
  const isAdmin = computed(() => userStore.isAdmin)
  const isManager = computed(() => userStore.isManager)

  /**
   * 檢查當前使用者是否具有指定角色
   */
  function hasRole(targetRole: string): boolean {
    return role.value === targetRole
  }

  /**
   * 檢查當前使用者是否具有任一指定角色
   */
  function hasAnyRole(roles: string[]): boolean {
    return roles.includes(role.value)
  }

  return {
    role,
    isAdmin,
    isManager,
    hasRole,
    hasAnyRole,
  }
}
