import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 排除 e2e 測試（由 Playwright 獨立執行）
    exclude: ['e2e/**', 'node_modules/**', '.nuxt/**', '.output/**'],
    coverage: {
      provider: 'v8',
    },
  },
})
