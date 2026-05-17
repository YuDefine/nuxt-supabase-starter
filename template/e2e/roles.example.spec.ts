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
 */
import { test, expect } from './fixtures'

test.describe('Three-role smoke', () => {
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
