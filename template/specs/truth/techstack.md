# Techstack（逆向基準線）

> 逆向自建置檔與設定檔，不是新決策。出處欄是檔案；判斷與程式碼衝突時以程式碼為準。
> 本檔歸 `/technical-research`；逆向產生的第一版由 `specs/plans/001-baseline-reverse/` 帶入。

## 系統有哪些端

| 端 | 內容 | 出處 |
| --- | --- | --- |
| backend | Nuxt 4 的 Nitro server routes（`server/api/v1/**`、`server/api/_dev/**`），部署目標 Cloudflare Workers | `package.json`、`nuxt.config.ts`、`wrangler.jsonc` |
| frontend | Nuxt 4 + Vue 3 + Nuxt UI 的頁面（`app/pages/**`） | `package.json`、`app/` |
| database | Supabase（PostgreSQL），schema 由 `supabase/migrations/*.sql` 管理 | `supabase/config.toml`、`supabase/migrations/` |

## 技術堆疊

| 面向 | 選用 | 出處 |
| --- | --- | --- |
| 執行環境 | Node 24 開發、Cloudflare Workers 部署（`wrangler.jsonc`） | `package.json` `engines`、`wrangler.jsonc` |
| 框架 | `nuxt@^4.4`、`@nuxt/ui@^4.6` | `package.json` |
| 認證 | Better Auth（`better-auth@^1.7`、`@nuxtjs/better-auth`）；Supabase 不簽發使用者 JWT，授權在 handler 層做 | `server/auth.config.ts`、`server/utils/supabase.ts` module JSDoc |
| 資料庫存取 | `@supabase/supabase-js`（service-role client，PostgREST）；`drizzle-orm` 已安裝但 `server/db/schema/index.ts` 目前是空的 | `server/utils/supabase.ts`、`server/db/schema/index.ts` |
| 驗證 | `zod@^4`，schema 放 `shared/schemas/` | `shared/schemas/profiles.ts` |
| 可觀測性 | `evlog`（request event、結構化錯誤 `createError({message,why,fix})`） | `server/plugins/evlog-*.ts` |
| 套件與工具鏈 | `pnpm@11`、`vite-plus`（`vp` 負責 test / lint / fmt / check） | `package.json` `packageManager`、`scripts` |

## 測試

| 端 | 現行 runner | 測試策略（現況） | Gherkin runner |
| --- | --- | --- | --- |
| backend | Vitest（`unit` project，Node 環境） | handler 以 mock 的 Supabase client 與 `requireAuth` 直接呼叫；不起 HTTP、不連真資料庫 | **尚未接線**。`.clade/manifest.json` 宣告了 `specformula`，但 repo 內沒有 `isa.yml`、沒有 `test:bdd` script（見 coverage 與 tech-debt） |
| frontend（元件） | Vitest（`nuxt` project，`@nuxt/test-utils`） | `mountSuspended()` 元件測試 | 尚未接線 |
| frontend（端到端） | Playwright（`e2e/`，`chromium` ＋ `chromium-no-auth`） | 起 Nuxt、經瀏覽器操作；`auth.setup.ts` 以 `/api/_dev/login` 取得 session | 尚未接線（`playwright-bdd` 未安裝） |

本檔不替使用者選擇 Gherkin runner：該選擇留給 `/technical-research` 三題必問，由使用者拍板。在拍板前，`specs/truth/features/**` 的 feature 一律標 `@unverified`。
