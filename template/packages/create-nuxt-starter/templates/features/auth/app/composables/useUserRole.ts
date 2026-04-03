export function useUserRole() {
  const { user } = useUserSession()

  const role = computed(() => {
    const currentUser = user.value as { role?: string } | null
    return currentUser?.role ?? 'user'
  })

  const isAdmin = computed(() => role.value === 'admin')

  function hasRole(targetRole: string): boolean {
    return role.value === targetRole
  }

  return { role, isAdmin, hasRole }
}
