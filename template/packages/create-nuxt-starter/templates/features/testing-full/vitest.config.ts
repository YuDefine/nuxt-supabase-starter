import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    // `environment: 'nuxt'` 讓每個 test 檔在 beforeAll boot 一次完整的 Nuxt build，
    // 首次跑（尚無 .nuxt 快取）遠超過 vitest 預設的 10s hookTimeout —— 於是 scaffold
    // 出來的專案連唯一那支 example test 都會失敗，而它的內容只是 expect(1 + 1).toBe(2)。
    // 錯誤訊息指向 @nuxt/test-utils 的 entry.mjs，看起來像 starter 壞了。
    hookTimeout: 60_000,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['app/**/*.{ts,vue}', 'server/**/*.ts'],
      exclude: ['app/types/**', '**/*.d.ts'],
    },
  },
})
