/**
 * Global auth middleware
 *
 * - Pages with `definePageMeta({ auth: false })` are public
 * - All other pages require authentication
 * - Unauthenticated users are redirected to /auth/login with a `redirect` query param
 */
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, ready, user } = useUserSession()

  if (!ready.value) return

  const isPublic = to.meta.auth === false
  if (isPublic) {
    if (loggedIn.value && to.path.startsWith('/auth/')) {
      return navigateTo('/')
    }
    return
  }

  if (!loggedIn.value) {
    return navigateTo({
      path: '/auth/login',
      query: { redirect: to.fullPath },
    })
  }

  const requiredRole = to.meta.requiredRole as string | undefined
  if (requiredRole && user.value) {
    const userRole = (user.value as unknown as Record<string, unknown>)?.role
    if (userRole !== requiredRole) {
      return navigateTo('/')
    }
  }
})
