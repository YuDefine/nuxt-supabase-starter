import { test, expect } from '@playwright/test'

/**
 * Smoke Tests — 頁面渲染基本驗證
 *
 * 這些測試不需要登入，驗證：
 * 1. 公開頁面可正常渲染
 * 2. 受保護頁面會重導至登入頁
 * 3. 基本導航正常運作
 */

test.describe('Public pages render correctly', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/')

    // 頁面應成功載入（非 error page）
    await expect(page).toHaveTitle(/.+/)
    expect(page.url()).not.toContain('/error')
  })

  test('login page renders with form', async ({ page }) => {
    await page.goto('/auth/login')

    // 應顯示登入表單元素
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible()
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
    await expect(page.getByPlaceholder('Enter your password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()
  })

  test('register page renders', async ({ page }) => {
    await page.goto('/auth/register')

    // 應顯示註冊頁面
    await expect(page.locator('form')).toBeVisible()
  })

  test('forgot-password page renders', async ({ page }) => {
    await page.goto('/auth/forgot-password')

    // 應顯示忘記密碼頁面
    await expect(page.locator('form')).toBeVisible()
  })
})

test.describe('Protected pages redirect to login', () => {
  test('profile page redirects unauthenticated user', async ({ page }) => {
    await page.goto('/profile')

    // 應重導至登入頁面（帶 redirect query）
    await expect(page).toHaveURL(/\/auth\/login/)
  })
})

test.describe('Navigation works correctly', () => {
  test('login page has link to register', async ({ page }) => {
    await page.goto('/auth/login')

    // 點擊 "Sign up" 連結
    const signUpLink = page.getByRole('link', { name: 'Sign up' })
    await expect(signUpLink).toBeVisible()
    await signUpLink.click()

    // 應導航到註冊頁面
    await expect(page).toHaveURL(/\/auth\/register/)
  })

  test('login page has link to forgot password', async ({ page }) => {
    await page.goto('/auth/login')

    // 點擊 "Forgot password?" 連結
    const forgotLink = page.getByRole('link', { name: 'Forgot password?' })
    await expect(forgotLink).toBeVisible()
    await forgotLink.click()

    // 應導航到忘記密碼頁面
    await expect(page).toHaveURL(/\/auth\/forgot-password/)
  })
})
