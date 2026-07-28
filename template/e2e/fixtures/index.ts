/**
 * Three-role Playwright fixtures
 *
 * Each fixture spins up its own browser context, hits `/api/_dev/login` to
 * mint a real Better Auth session, and yields a `Page` already authenticated
 * as that role.
 *
 * Roles match the dev-login enum:
 *   - admin  : email must appear in ADMIN_EMAIL_ALLOWLIST
 *   - member : default authenticated user
 *   - guest  : low-privilege account (semantically equivalent to "member"
 *              for projects without a guest tier — adjust per project)
 *
 * Default test emails (override per-fixture if your seed uses different ones):
 *   - e2e-admin@test.local
 *   - e2e-member@test.local
 *   - e2e-guest@test.local
 *
 * For the admin fixture to succeed, set:
 *   ADMIN_EMAIL_ALLOWLIST=e2e-admin@test.local
 *   NUXT_DEV_LOGIN_PASSWORD=<any password >= 8 chars>
 */
// 從 @nuxt/test-utils 的 test 延伸，而不是 @playwright/test 的 —— 前者才帶
// 啟動 Nuxt server 的 worker fixture，`url()` 也才有值可回。
import { url } from '@nuxt/test-utils/e2e'
import { test as base } from '@nuxt/test-utils/playwright'
import type { Browser, BrowserContext, Page } from '@playwright/test'

type DevLoginRole = 'admin' | 'member' | 'guest'

const DEFAULT_EMAILS: Record<DevLoginRole, string> = {
  admin: 'e2e-admin@test.local',
  member: 'e2e-member@test.local',
  guest: 'e2e-guest@test.local',
}

async function loginAs(
  context: BrowserContext,
  role: DevLoginRole,
  email = DEFAULT_EMAILS[role],
): Promise<void> {
  const response = await context.request.post('/api/_dev/login', {
    data: { email, as: role },
  })

  if (!response.ok()) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `[fixtures] dev-login failed for role=${role} email=${email} status=${response.status()} body=${body.slice(0, 200)}`,
    )
  }
}

interface RoleFixtures {
  adminPage: Page
  memberPage: Page
  guestPage: Page
  unauthPage: Page
}

// `browser.newContext()` 不像內建的 `page` / `context` fixture 會帶上 base URL：
// 手動建的 context 沒有 base，於是 `context.request.post('/api/_dev/login')` 丟
// `Invalid URL`、`page.goto('/profile')` 丟 `Cannot navigate to invalid URL`。
// @nuxt/test-utils 的 server 是執行期才挑 port，位址只能跟它要，不能寫死也不能
// 從 config 讀。
const freshContext = (browser: Browser) =>
  browser.newContext({ baseURL: url('/'), storageState: { cookies: [], origins: [] } })

export const test = base.extend<RoleFixtures>({
  adminPage: async ({ browser }, use) => {
    const context = await freshContext(browser)
    const page = await context.newPage()
    await loginAs(context, 'admin')
    await use(page)
    await context.close()
  },

  memberPage: async ({ browser }, use) => {
    const context = await freshContext(browser)
    const page = await context.newPage()
    await loginAs(context, 'member')
    await use(page)
    await context.close()
  },

  guestPage: async ({ browser }, use) => {
    const context = await freshContext(browser)
    const page = await context.newPage()
    await loginAs(context, 'guest')
    await use(page)
    await context.close()
  },

  unauthPage: async ({ browser }, use) => {
    // Explicitly empty storage state — the default `chromium` project may load
    // a shared storage state file; tests that need an unauthenticated context
    // must start clean.
    const context = await freshContext(browser)
    const page = await context.newPage()
    await use(page)
    await context.close()
  },
})

export { expect } from '@playwright/test'
