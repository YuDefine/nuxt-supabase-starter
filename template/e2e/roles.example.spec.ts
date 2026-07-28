/**
 * Three-role fixture example
 *
 * Demonstrates the fixture pattern from `e2e/fixtures/index.ts`. Each test
 * receives a fresh browser context already authenticated as the requested
 * role, so assertions can focus on role-specific behavior (visible menus,
 * accessible routes, allowed mutations) without re-implementing login.
 *
 * This file is intentionally low-stakes — it only checks that each role can
 * reach the home page. Real role-aware specs should:
 *   - exercise routes that the role is allowed to see
 *   - exercise routes the role must be redirected away from
 *   - exercise API mutations the role is allowed / forbidden to perform
 *
 * Requires (in `.env`):
 *   NUXT_DEV_LOGIN_PASSWORD=<any password >= 8 chars>
 *   ADMIN_EMAIL_ALLOWLIST=e2e-admin@test.local
 *
 * 這幾條**只在 dev server 下跑得起來**：全部經由 `POST /api/_dev/login` 取得
 * session，而該路由對非 `nuxt dev` 的環境刻意回 404（見 server/api/_dev/login.post.ts
 * 的 Hard guard），CI 走的又是 production build（playwright.config.ts 的
 * `dev: !process.env.CI`）。因此 CI 一律 skip —— 不是為了讓 CI 變綠而繞過，
 * 是這個前置條件在 CI 的組態下不成立。
 *
 * 代價要講清楚：這份 example 因此不受 CI 保護，壞掉不會有人知道（實證：
 * 2026-07-28 fixtures 缺 baseURL 的 bug 就是這樣一路潛伏到全量盤點才被發現）。
 * 想讓它真的被守住，要嘛給 E2E workflow 一組 dev-mode 專用的 project，
 * 要嘛把角色驗證改走 seed 出來的真實帳號登入而非 dev-login。
 */
import { expect, test } from './fixtures'

test.describe('Three-role smoke', () => {
  test.skip(
    Boolean(process.env.CI),
    'dev-login 在 CI 的 production build 下刻意 404；本地 `pnpm test:e2e` 會跑',
  )

  test('admin can reach the home page', async ({ adminPage }) => {
    await adminPage.goto('/')
    await expect(adminPage).toHaveURL(/\//)
  })

  test('member can reach the home page', async ({ memberPage }) => {
    await memberPage.goto('/')
    await expect(memberPage).toHaveURL(/\//)
  })

  test('guest can reach the home page', async ({ guestPage }) => {
    await guestPage.goto('/')
    await expect(guestPage).toHaveURL(/\//)
  })

  test('unauthenticated user is redirected away from a protected route', async ({ unauthPage }) => {
    await unauthPage.goto('/profile')
    await expect(unauthPage).toHaveURL(/\/auth\/login/)
  })
})
