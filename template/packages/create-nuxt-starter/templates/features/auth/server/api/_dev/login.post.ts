/**
 * Dev-only login route for screenshot automation and local testing (Better Auth).
 *
 * POST /api/_dev/login
 *
 * Body:
 *   { email: string, password?: string, name?: string, as?: 'admin' | 'member' | 'guest' }
 *
 * Behavior:
 *   - Tries `auth.api.signInEmail`; falls back to `signUpEmail` for first-time
 *     dev fixtures.
 *   - Copies the upstream `set-cookie` header onto the response so the caller
 *     gets a real session.
 *   - Returns JSON; the caller (browser / Playwright) is responsible for the
 *     subsequent navigation. There is intentionally no `redirect` param.
 *
 * Hard guard:
 *   - 404 (NOT 403) on non-local environments to keep this route invisible.
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

interface RuntimeConfigWithDevLogin {
  devLoginPassword?: string
  devLogin?: {
    environment?: string
  }
  knowledge?: {
    environment?: string
  }
}

interface AuthPayload {
  user?: {
    id: string
    email: string
    name?: string | null
    role?: string | null
  }
  message?: string
}

function runtimeEnvironment(config: RuntimeConfigWithDevLogin): string {
  return config.devLogin?.environment ?? config.knowledge?.environment ?? 'local'
}

/** 未設定 DEV_LOGIN_EMAIL_DOMAINS 時，允許自動建帳號的 email domain。 */
const DEFAULT_DEV_LOGIN_DOMAINS = ['test.local']

function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * 判定「signIn 失敗後可否自動建立這個 email 的帳號」。
 *
 * 沒有這道檢查時，任何能連到 dev server 的人都能用自選密碼替**任意** email 開帳號
 * 並拿到 session cookie —— 包含尚未註冊的真實使用者 email。dev 環境判定只保證
 * 「不是 production build」，不保證「只有你連得到」：dev server 綁 0.0.0.0、開
 * tunnel 分享預覽、或在共用開發機上跑，都會讓這條路由對外可達。
 *
 * 只限制**新建**帳號，不限制既有帳號登入。
 */
function assertSignUpAllowed(email: string, allowedDomains: string[]): void {
  const domain = email.toLowerCase().split('@')[1] ?? ''

  if (!allowedDomains.includes(domain)) {
    throw createError({
      statusCode: 401,
      message:
        `dev-login refuses to create an account for "${email}": domain not in ` +
        `DEV_LOGIN_EMAIL_DOMAINS (${allowedDomains.join(', ')}). ` +
        'Sign-up fallback exists for test fixtures only.',
    })
  }
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
  input: { userId: string; role: DevLoginRole; email: string },
): Promise<void> {
  void event
  void input

  // TODO(project): update the better-auth user row or profile row if the
  // auth hook does not already produce this role. NEVER write `admin` here
  // unless the same allowlist check used by real auth has already passed.
}

async function finishAuthResponse(
  event: H3Event,
  response: Response,
  input: { role: DevLoginRole; email: string; action: 'signed_in' | 'created_and_signed_in' },
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

  // Structured log — canonical fields:
  //   route, requestedAs, requestedEmail, resolvedUserId, action, environment
  // Projects with evlog/monitoring enabled SHOULD swap this for:
  //   const log = useLogger(event)
  //   log.set({ operation: 'dev-login', result: { ... } })
  console.info('[dev-login]', {
    route: '/api/_dev/login',
    requestedAs: input.role,
    requestedEmail: input.email,
    resolvedUserId: payload.user?.id ?? null,
    action: input.action,
    environment: 'local',
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
  const runtimeConfig = useRuntimeConfig() as RuntimeConfigWithDevLogin

  // Hard guard: 404 (not 403) so the route is invisible in non-local envs.
  if (runtimeEnvironment(runtimeConfig) !== 'local') {
    throw createError({ statusCode: 404 })
  }

  const body = await readValidatedBody(event, bodySchema.parse)
  const password = body.password ?? runtimeConfig.devLoginPassword

  if (!password) {
    throw createError({
      statusCode: 500,
      message: 'devLoginPassword is required when password is omitted',
    })
  }

  // TODO(project): wire ADMIN_EMAIL_ALLOWLIST to the same source as real auth
  // (env, runtime config, or feature flag service). NEVER hard-code admin
  // emails here.
  const role = resolveDevLoginRole({
    as: body.as,
    email: body.email,
    adminEmailAllowlist: parseCsv(process.env.ADMIN_EMAIL_ALLOWLIST),
  })

  // TODO(project): replace `serverAuth(event)` with the project's actual
  // server-side better-auth handle (the helper exposed by the chosen
  // better-auth integration, e.g. `@onmax/nuxt-better-auth`).
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

  // signIn 失敗 → 準備自動建帳號。這是唯一會產生持久狀態的分支，先過 domain 白名單。
  const allowedDomains = parseCsv(process.env.DEV_LOGIN_EMAIL_DOMAINS)
  assertSignUpAllowed(
    body.email,
    allowedDomains.length > 0 ? allowedDomains : DEFAULT_DEV_LOGIN_DOMAINS,
  )

  const displayName = body.name ?? body.email.split('@')[0]
  const signUpResponse = await auth.api.signUpEmail({
    body: {
      email: body.email,
      password,
      name: displayName,
      displayName,
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
