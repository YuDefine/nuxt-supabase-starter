import { expect, test as setup } from '@nuxt/test-utils/playwright'

/**
 * Auth Setup — build an authenticated storage state for the default
 * Playwright project.
 *
 * Runs once before the `chromium` project. Hits the dev-login route
 * (`POST /api/_dev/login`) to mint a real Better Auth session, then writes
 * cookies + origins to `e2e/.auth/user.json`. Subsequent specs in the
 * `chromium` project load this state and start already authenticated as the
 * default member.
 *
 * Project-specific role fixtures (admin / guest) live in
 * `e2e/fixtures/index.ts` and create their own contexts per-test — they do
 * not share storage state.
 *
 * Required env (loaded from `.env`):
 *   NUXT_DEV_LOGIN_PASSWORD   any password >= 8 chars; the dev-login route
 *                             uses this when the request body omits `password`
 *
 * If `NUXT_DEV_LOGIN_PASSWORD` is missing the setup writes an empty storage
 * state so unauthenticated smoke specs can still run in CI without the secret.
 */

const AUTH_FILE = 'e2e/.auth/user.json'
const DEFAULT_MEMBER_EMAIL = 'e2e-member@test.local'

setup('authenticate as default member', async ({ page, goto }) => {
  const hasPassword = Boolean(process.env.NUXT_DEV_LOGIN_PASSWORD)

  if (!hasPassword) {
    // Allow CI to run unauthenticated smoke specs without the secret.
    await goto('/')
    await page.context().storageState({ path: AUTH_FILE })
    return
  }

  const response = await page.context().request.post('/api/_dev/login', {
    data: { email: DEFAULT_MEMBER_EMAIL, as: 'member' },
  })

  expect(response.ok(), `dev-login failed: ${response.status()} ${await response.text()}`).toBe(
    true
  )

  await goto('/')
  await page.context().storageState({ path: AUTH_FILE })
})
