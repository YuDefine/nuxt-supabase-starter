export function useUserRole() {
  const { user } = useUserSession()

  const isAdmin = computed(() => user.value?.role === 'admin')

  function hasRole(role: string): boolean {
    return user.value?.role === role
  }

  return { isAdmin, hasRole }
}
