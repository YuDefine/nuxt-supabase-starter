import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E 測試配置
 *
 * - Chrome-only：快速回饋，避免跨瀏覽器維護成本
 * - WebServer：自動啟動 Nuxt dev server
 * - Storage state：支援 authenticated 測試
 */
export { defineConfig }

export const config = defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  /* Chrome-only：快速回饋 */
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'chromium-no-auth',
      use: {
        ...devices['Desktop Chrome'],
      },
      testMatch: /.*smoke\.spec\.ts/,
    },
  ],

  /* WebServer：自動啟動 Nuxt dev server */
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})

export default config
