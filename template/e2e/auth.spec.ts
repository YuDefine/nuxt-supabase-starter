import { expect, test } from '@nuxt/test-utils/playwright'

/**
 * Auth E2E Tests — 認證流程測試
 *
 * 驗證：
 * 1. Login 頁面完整渲染
 * 2. 表單驗證錯誤
 * 3. 登入流程（需要 E2E 測試帳號）
 */

test.describe('Login page', () => {
  test.beforeEach(async ({ goto }) => {
    await goto('/auth/login', { waitUntil: 'hydration' })
  })

  test('renders all form elements', async ({ page }) => {
    // 標題
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible()

    // Email 輸入欄位
    const emailInput = page.getByPlaceholder('you@example.com')
    await expect(emailInput).toBeVisible()
    await expect(emailInput).toHaveAttribute('type', 'email')
    await expect(emailInput).toHaveAttribute('required', '')

    // Password 輸入欄位
    const passwordInput = page.getByPlaceholder('Enter your password')
    await expect(passwordInput).toBeVisible()
    await expect(passwordInput).toHaveAttribute('type', 'password')
    await expect(passwordInput).toHaveAttribute('required', '')

    // 登入按鈕
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()

    // OAuth 按鈕
    await expect(page.getByRole('button', { name: 'Google' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'GitHub' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'LINE' })).toBeVisible()
  })

  test('sign in button is disabled when fields are empty', async ({ page }) => {
    const signInButton = page.getByRole('button', { name: 'Sign In' })

    // 欄位為空時，按鈕應 disabled
    await expect(signInButton).toBeDisabled()
  })

  test('sign in button becomes enabled after filling fields', async ({ page }) => {
    const signInButton = page.getByRole('button', { name: 'Sign In' })

    // 填入 email 和 password
    await page.getByPlaceholder('you@example.com').fill('test@example.com')
    await page.getByPlaceholder('Enter your password').fill('password123')

    // 按鈕應變為 enabled
    await expect(signInButton).toBeEnabled()
  })

  test('shows error on invalid credentials', async ({ page }) => {
    // 填入無效的登入資訊
    await page.getByPlaceholder('you@example.com').fill('invalid@example.com')
    await page.getByPlaceholder('Enter your password').fill('wrongpassword')

    // 點擊登入
    await page.getByRole('button', { name: 'Sign In' }).click()

    // 應顯示錯誤訊息（UAlert with error color）
    const errorAlert = page.locator('[class*="alert"]').first()
    await expect(errorAlert).toBeVisible({ timeout: 10_000 })
  })

  test('navigates to register page', async ({ page }) => {
    await page.getByRole('link', { name: 'Sign up' }).click()
    await expect(page).toHaveURL(/\/auth\/register/)
  })

  test('navigates to forgot password page', async ({ page }) => {
    await page.getByRole('link', { name: 'Forgot password?' }).click()
    await expect(page).toHaveURL(/\/auth\/forgot-password/)
  })
})

test.describe('Login flow with test account', () => {
  const email = process.env.E2E_USER_EMAIL
  const password = process.env.E2E_USER_PASSWORD

  // 如果沒有測試帳號，跳過這些測試
  test.skip(!email || !password, 'E2E_USER_EMAIL and E2E_USER_PASSWORD required')

  test('successful login redirects to home', async ({ page, goto }) => {
    await goto('/auth/login', { waitUntil: 'hydration' })

    await page.getByPlaceholder('you@example.com').fill(email!)
    await page.getByPlaceholder('Enter your password').fill(password!)
    await page.getByRole('button', { name: 'Sign In' }).click()

    // 登入成功後應離開登入頁面
    await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 15_000 })
  })

  test('login with redirect query parameter', async ({ page, goto }) => {
    await goto('/auth/login?redirect=/profile', { waitUntil: 'hydration' })

    await page.getByPlaceholder('you@example.com').fill(email!)
    await page.getByPlaceholder('Enter your password').fill(password!)
    await page.getByRole('button', { name: 'Sign In' }).click()

    // 登入成功後應重導至指定頁面
    await expect(page).toHaveURL(/\/profile/, { timeout: 15_000 })
  })
})
