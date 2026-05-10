/**
 * Dev-only login route for screenshot automation and local testing.
 *
 * Lookup-only template — does not invent users. Consumer MUST seed at least one
 * active user (and one per role/scenario used in screenshots/E2E) before this
 * route can resolve a session.
 *
 * Canonical query params:
 *   ?as=<role>            — role/scenario lookup (preferred)
 *   ?email=<email>        — exact user lookup
 *   ?redirect=<safePath>  — same-origin redirect after session is set
 *   (?role=...)           — accepted as legacy alias of `as`
 *
 * Tree-shaken out of production builds via `import.meta.dev`.
 *
 * Source of truth: clade rules/modules/auth/nuxt-auth-utils/dev-login.md
 */
import type { H3Event } from 'h3'

interface DevLoginUserRecord {
  id: string
  email: string
  name: string
  role?: string
  tenantId?: string
  departmentId?: string | null
}

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) return firstString(value[0])
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function safeRedirect(value: unknown): string {
  const redirect = firstString(value) ?? '/'
  return redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
}

async function findDevLoginUser(
  event: H3Event,
  input: { email?: string; as?: string }
): Promise<DevLoginUserRecord> {
  void event
  void input

  // TODO(project): wire this to the same user/profile source as the real OAuth
  // callback. Recommended resolution order:
  //   1. input.email -> exact active user lookup.
  //   2. input.as    -> role/scenario lookup against the project's role source.
  //   3. no params   -> deterministic first active seeded user.
  //
  // For role-as-data systems, validate input.as against the role table.
  // For enum role systems, validate input.as against a local const enum.
  //
  // NEVER invent users on the fly — keep this lookup-only so dev-login behaves
  // like real OAuth and screenshot baselines stay reproducible.
  throw createError({
    statusCode: 501,
    message: 'Dev-login user lookup is not wired for this project yet',
  })
}

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) {
    throw createError({ statusCode: 404 })
  }

  const query = getQuery(event)
  const requestedEmail = firstString(query.email)
  const requestedAs = firstString(query.as) ?? firstString(query.role)
  const redirectTarget = safeRedirect(query.redirect)

  const user = await findDevLoginUser(event, { email: requestedEmail, as: requestedAs })

  await setUserSession(event, {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      departmentId: user.departmentId,
      provider: 'dev-login',
    },
    loggedInAt: Date.now(),
  })

  // Structured log — canonical fields:
  //   route, requestedAs, requestedEmail, resolvedUserId, action, environment
  // Projects with evlog/monitoring enabled SHOULD swap this for:
  //   const log = useLogger(event)
  //   log.set({ operation: 'dev-login', result: { ... } })
  console.info('[dev-login]', {
    route: '/auth/_dev-login',
    requestedAs: requestedAs ?? null,
    requestedEmail: requestedEmail ?? null,
    resolvedUserId: user.id,
    resolvedRole: user.role ?? null,
    action: 'set-user-session',
    environment: 'dev',
  })

  return sendRedirect(event, redirectTarget)
})
