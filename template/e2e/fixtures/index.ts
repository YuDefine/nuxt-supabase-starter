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
import { test as base, type Browser, type BrowserContext, type Page } from '@playwright/test'

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

// `browser.newContext()` does NOT inherit `use.baseURL` the way the built-in
// `page` / `context` fixtures do — a hand-rolled context starts with no base,
// so `page.goto('/profile')` throws `Cannot navigate to invalid URL`. Under
// @nuxt/test-utils the base is assigned at runtime (the dev/preview server
// picks a free port), so it has to be threaded through from the `baseURL`
// fixture rather than hard-coded.
const freshContext = (browser: Browser, baseURL: string | undefined) =>
  browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })

export const test = base.extend<RoleFixtures>({
  adminPage: async ({ browser, baseURL }, use) => {
    const context = await freshContext(browser, baseURL)
    const page = await context.newPage()
    await loginAs(context, 'admin')
    await use(page)
    await context.close()
  },

  memberPage: async ({ browser, baseURL }, use) => {
    const context = await freshContext(browser, baseURL)
    const page = await context.newPage()
    await loginAs(context, 'member')
    await use(page)
    await context.close()
  },

  guestPage: async ({ browser, baseURL }, use) => {
    const context = await freshContext(browser, baseURL)
    const page = await context.newPage()
    await loginAs(context, 'guest')
    await use(page)
    await context.close()
  },

  unauthPage: async ({ browser, baseURL }, use) => {
    // Explicitly empty storage state — the default `chromium` project may load
    // a shared storage state file; tests that need an unauthenticated context
    // must start clean.
    const context = await freshContext(browser, baseURL)
    const page = await context.newPage()
    await use(page)
    await context.close()
  },
})

export { expect } from '@playwright/test'
