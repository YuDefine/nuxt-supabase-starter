import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import type { ConfigOptions } from '@nuxt/test-utils/playwright'

/**
 * Playwright E2E 測試配置
 *
 * - Chrome-only：快速回饋，避免跨瀏覽器維護成本
 * - @nuxt/test-utils：自動 build + 啟動 Nuxt server（port 自動分配）
 * - Storage state：支援 authenticated 測試
 */
export { defineConfig }

export const config = defineConfig<ConfigOptions>({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    nuxt: {
      rootDir: fileURLToPath(new URL('.', import.meta.url)),
      dev: true,
    },
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
})

export default config
