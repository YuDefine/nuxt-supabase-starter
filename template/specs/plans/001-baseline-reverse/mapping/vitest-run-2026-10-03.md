# Vitest 實跑（2026-10-03）

指令（cwd：`template/`）：`pnpm install --frozen-lockfile` 後 `pnpm exec vp test run --project=unit`

結果：`Test Files 17 passed (17)`、`Tests 161 passed (161)`、exit 0。

未跑：`nuxt` project（2 檔，需 Nuxt 執行環境）、Playwright e2e（需 Supabase 與瀏覽器）。這兩項歸 PR CI。

這些測試以 mock 直接呼叫 handler，**不**驗證 `specs/truth/features/**`；feature 在 Gherkin runner 接線前一律 `@unverified`。
