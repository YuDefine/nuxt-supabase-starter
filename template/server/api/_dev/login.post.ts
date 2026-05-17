/**
 * Dev-only login route for screenshot automation, E2E, and developer
 * identity switching (Better Auth).
 *
 * POST /api/_dev/login
 *
 * Body:
 *   {
 *     email: string
 *     password?: string     // falls back to NUXT_DEV_LOGIN_PASSWORD env var
 *     name?: string         // display name; defaults to email local-part
 *     as?: 'admin' | 'member' | 'guest'
 *   }
 *
 * Behavior:
 *   - Tries `auth.api.signInEmail`; falls back to `signUpEmail` for first-time
 *     dev fixtures so a fresh DB can boot Playwright without manual seed.
 *   - Copies the upstream `set-cookie` onto the response so the caller gets a
 *     real session.
 *   - Returns JSON; the caller (browser / Playwright) is responsible for the
 *     subsequent navigation. There is intentionally no `redirect` param.
 *
 * Hard guard:
 *   - 404 (NOT 403) outside `nuxt dev` to keep this route invisible in
 *     production builds.
 *
 * Role / authorization model:
 *   - `as: 'admin'` requires the email to appear in `ADMIN_EMAIL_ALLOWLIST`.
 *   - The same allowlist must be checked by real auth (login / OAuth callback)
 *     for promotion to admin. NEVER mint admin through dev-login alone.
 *
 * Source of truth: clade rules/modules/auth/better-auth/dev-login.md
 */
import { z } from 'zod'
import type { H3Event } from 'h3'

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).optional(),
  name: z.string().min(1).optional(),
  as: z.enum(['admin', 'member', 'guest']).optional(),
})

type DevLoginRole = 'admin' | 'member' | 'guest'

interface AuthPayload {
  user?: {
    id: string
    email: string
    name?: string | null
    role?: string | null
  }
  message?: string
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function resolveDevLoginRole(input: {
  as?: DevLoginRole
  email: string
  adminEmailAllowlist: string[]
}): DevLoginRole {
  const email = input.email.toLowerCase()
  const isAllowlistedAdmin = input.adminEmailAllowlist.includes(email)

  if (input.as === 'admin' && !isAllowlistedAdmin) {
    throw createError({
      statusCode: 400,
      message: 'as=admin requires an email in ADMIN_EMAIL_ALLOWLIST',
    })
  }

  if (input.as) return input.as
  return isAllowlistedAdmin ? 'admin' : 'member'
}

async function syncDevLoginRole(
  event: H3Event,
  input: { userId: string; role: DevLoginRole; email: string }
): Promise<void> {
  void event
  void input

  // TODO(project): if real auth syncs role into a profile / users table, mirror
  // that here so dev-login users land with the same shape. NEVER write `admin`
  // unless the allowlist check above has already passed.
}

async function finishAuthResponse(
  event: H3Event,
  response: Response,
  input: { role: DevLoginRole; email: string; action: 'signed_in' | 'created_and_signed_in' }
) {
  const payload = (await response.json().catch(() => ({}))) as AuthPayload

  if (payload.user?.id) {
    await syncDevLoginRole(event, {
      userId: payload.user.id,
      role: input.role,
      email: input.email,
    })
  }

  const setCookie = response.headers.get('set-cookie')
  if (setCookie) {
    appendResponseHeader(event, 'set-cookie', setCookie)
  }

  // Structured log — canonical fields (mirror real OAuth callback for audit
  // parity). Swap for `useLogger(event).set({...})` if evlog is wired.
  console.info('[dev-login]', {
    route: '/api/_dev/login',
    requestedAs: input.role,
    requestedEmail: input.email,
    resolvedUserId: payload.user?.id ?? null,
    action: input.action,
    environment: 'dev',
  })

  return {
    success: true,
    action: input.action,
    user: payload.user
      ? {
          id: payload.user.id,
          email: payload.user.email,
          name: payload.user.name,
          role: input.role,
        }
      : undefined,
  }
}

export default defineEventHandler(async (event) => {
  // Hard guard: 404 (not 403) so the route is invisible in non-dev builds.
  // `import.meta.dev` is tree-shaken out of production bundles by Nuxt/Nitro.
  if (!import.meta.dev) {
    throw createError({ statusCode: 404 })
  }

  const body = await readValidatedBody(event, bodySchema.parse)
  const password = body.password ?? process.env.NUXT_DEV_LOGIN_PASSWORD

  if (!password) {
    throw createError({
      statusCode: 500,
      message:
        'Dev-login password missing. Pass `password` in the body or set NUXT_DEV_LOGIN_PASSWORD.',
    })
  }

  const role = resolveDevLoginRole({
    as: body.as,
    email: body.email,
    adminEmailAllowlist: parseCsv(process.env.ADMIN_EMAIL_ALLOWLIST),
  })

  const auth = serverAuth(event)
  const signInResponse = await auth.api
    .signInEmail({
      body: { email: body.email, password },
      asResponse: true,
    })
    .catch(() => null)

  if (signInResponse?.ok) {
    return await finishAuthResponse(event, signInResponse, {
      email: body.email,
      role,
      action: 'signed_in',
    })
  }

  const displayName = body.name ?? body.email.split('@')[0] ?? 'Dev User'
  const signUpResponse = await auth.api.signUpEmail({
    body: {
      email: body.email,
      password,
      name: displayName,
    },
    asResponse: true,
  })

  if (!signUpResponse.ok) {
    const payload = (await signUpResponse.json().catch(() => ({}))) as AuthPayload
    throw createError({
      statusCode: signUpResponse.status,
      message: payload.message ?? 'Failed to create dev-login user',
    })
  }

  return await finishAuthResponse(event, signUpResponse, {
    email: body.email,
    role,
    action: 'created_and_signed_in',
  })
})
