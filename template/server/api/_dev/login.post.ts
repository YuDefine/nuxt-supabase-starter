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

/** 未設定 DEV_LOGIN_EMAIL_DOMAINS 時，允許自動建帳號的 email domain。 */
export const DEFAULT_DEV_LOGIN_DOMAINS = ['test.local']

export function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * 判定「signIn 失敗後可否自動建立這個 email 的帳號」。
 *
 * 沒有這道檢查時，任何能連到 dev server 的人都能用自選密碼替**任意** email 開帳號
 * 並拿到 session cookie —— 包含尚未註冊的真實使用者 email。`import.meta.dev` 只
 * 保證「不是 production build」，不保證「只有你連得到」：dev server 綁 0.0.0.0、
 * 開 tunnel 分享預覽、或在共用開發機上跑，都會讓這條路由對外可達。
 *
 * 只限制**新建**帳號，不限制既有帳號登入 —— 既有帳號是誰建的與這條路由無關，
 * 擋掉只會讓開發者無法用真實帳號 debug。
 *
 * 這裡刻意不用 loopback IP gate：那會讓 dev tunnel 上的每個 dev-login 連結都
 * 404（screenshot review / 遠端驗收都走 tunnel），是 trade-off 不是免費硬化。
 * 見 clade rules/modules/auth/better-auth/dev-login.md。
 */
export function assertSignUpAllowed(email: string, allowedDomains: string[]): void {
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

export function resolveDevLoginRole(input: {
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

  // TODO(project): if real auth syncs role into a profile / users table, mirror
  // that here so dev-login users land with the same shape. NEVER write `admin`
  // unless the allowlist check above has already passed.
  //
  // 這個 starter 目前**刻意不實作**寫入，缺的是兩個前置條件，不是這幾行 code：
  //
  //   1. clade rules/modules/auth/better-auth/dev-login.md 要求「任何由 dev-login
  //      建立的持久 row MUST 帶 dev/test provider marker」（provider='dev-login'
  //      或 provider_id='e2e-*'）。profiles 表沒有這個欄位，現在寫進去就是造出
  //      一批與真實使用者無法區分的 row。
  //   2. Better Auth 在本專案沒有接資料庫 —— @onmax/nuxt-better-auth 只有在偵測到
  //      NuxtHub 的 hub.db 時才提供 drizzle adapter，否則 createDatabase() 回
  //      undefined。使用者 id 目前沒有穩定的持久來源，寫進 profiles 會產生孤兒 row。
  //
  // 補上 provider marker 欄位、並替 Better Auth 接上資料庫之後，這裡才有東西可同步。
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

  // signIn 失敗 → 準備自動建帳號。這是唯一會產生持久狀態的分支，先過 domain 白名單。
  const allowedDomains = parseCsv(process.env.DEV_LOGIN_EMAIL_DOMAINS)
  assertSignUpAllowed(
    body.email,
    allowedDomains.length > 0 ? allowedDomains : DEFAULT_DEV_LOGIN_DOMAINS,
  )

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
