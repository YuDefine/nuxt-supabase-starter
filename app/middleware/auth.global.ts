/**
 * Global auth middleware
 *
 * - Pages with `definePageMeta({ auth: false })` are public
 * - All other pages require authentication
 * - Unauthenticated users are redirected to /auth/login with a `redirect` query param
 * - Supports `requiredRole` meta for role-based access (future use)
 */
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, ready, user } = useUserSession()

  // Skip middleware until session is ready (avoid flash redirect on first load)
  if (!ready.value) return

  // Public pages (marked with `auth: false`) — skip auth check
  const isPublic = to.meta.auth === false
  if (isPublic) {
    // If user is already logged in and visiting auth pages, redirect to home
    if (loggedIn.value && to.path.startsWith('/auth/')) {
      return navigateTo('/')
    }
    return
  }

  // Protected pages — require authentication
  if (!loggedIn.value) {
    return navigateTo({
      path: '/auth/login',
      query: { redirect: to.fullPath },
    })
  }

  // Role-based access check (reserved for future use)
  const requiredRole = to.meta.requiredRole as string | undefined
  if (requiredRole && user.value) {
    const userRole = (user.value as unknown as Record<string, unknown>)?.role
    if (userRole !== requiredRole) {
      return navigateTo('/')
    }
  }
})
