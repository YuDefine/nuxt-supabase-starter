/**
 * Global auth middleware (nuxt-auth-utils)
 *
 * - Pages with `definePageMeta({ auth: false })` are public
 * - All other pages require authentication
 * - Unauthenticated users are redirected to /auth/login
 */
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()

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
})
