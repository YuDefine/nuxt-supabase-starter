import { test as setup, expect } from '@playwright/test'

/**
 * Auth Setup — 建立 authenticated storage state
 *
 * 此 setup 會在所有需要登入的測試之前執行一次，
 * 將登入狀態儲存到 e2e/.auth/user.json，
 * 後續測試可直接載入已認證的 session。
 *
 * 環境變數：
 * - E2E_USER_EMAIL: 測試用帳號 email
 * - E2E_USER_PASSWORD: 測試用帳號密碼
 */

const AUTH_FILE = 'e2e/.auth/user.json'

setup('authenticate as default user', async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL
  const password = process.env.E2E_USER_PASSWORD

  if (!email || !password) {
    // 如果沒有提供測試帳號，建立空的 storage state
    // 這讓 CI 可以只跑不需要認證的測試
    await page.goto('/')
    await page.context().storageState({ path: AUTH_FILE })
    return
  }

  // 前往登入頁面
  await page.goto('/auth/login')

  // 填入測試帳號
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder('Enter your password').fill(password)

  // 送出登入表單
  await page.getByRole('button', { name: 'Sign In' }).click()

  // 等待登入完成（重導至首頁或 dashboard）
  await expect(page).not.toHaveURL(/\/auth\/login/)

  // 儲存 authenticated state
  await page.context().storageState({ path: AUTH_FILE })
})
