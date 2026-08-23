import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['templates/**'],
    // 這個套件的多數測試會跑一次完整 `assembleProject`（複製數百個檔案 + 套 overlay
    // + 產設定檔），單次就遠超 vitest 預設的 5000ms。之前沒設，所以測試在單獨跑時
    // 過、在全套平行跑時隨機 `Test timed out in 5000ms` —— 表象是 flaky，成因只是
    // 門檻訂得比工作量小。
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
