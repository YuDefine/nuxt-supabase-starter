/**
 * Dev-only login route for screenshot automation and local testing.
 * Creates a real session without OAuth flow.
 * Tree-shaken out of production builds via import.meta.dev.
 *
 * Usage:
 *   /auth/_dev-login                          → login as first user
 *   /auth/_dev-login?email=user@example.com   → login as specific user
 *   /auth/_dev-login?redirect=/admin          → login and redirect
 */
export default defineEventHandler(async (event) => {
  if (!import.meta.dev) {
    throw createError({ statusCode: 404 })
  }

  const query = getQuery(event)
  const email = (query.email as string) || 'dev@example.com'

  await setUserSession(event, {
    user: {
      id: 'dev-user-001',
      email,
      name: 'Dev User',
      provider: 'dev',
    },
    loggedInAt: Date.now(),
  })

  const redirect = (query.redirect as string) || '/'
  const safePath = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
  return sendRedirect(event, safePath)
})
