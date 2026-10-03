# 模組覆蓋矩陣（backend 逆向基準線）

每列一個模組或盤點分群。狀態只有四種：`既有覆蓋`、`逆向補齊`、`刻意不補（理由）`、`未展開`。盤點葉檔來自 `mapping/inventory.md`。
`tools/check-truth.mjs` ⑥ 檢查狀態合法且「刻意不補」附理由；試點模組的葉檔逐項見 `profiles.md`。

| 模組 | 介面 | 盤點葉檔 | 狀態 | 備註 |
| --- | --- | --- | --- | --- |
| profiles | backend | `server/api/v1/profiles/**`、`profiles` 資料表、對應單元測試 | 逆向補齊 | 試點；逐項見 `profiles.md` |
| dev-login | backend | `server/api/_dev/login.post.ts`、`test/unit/server/api/_dev/login.*.test.ts` | 未展開 | 行為依賴 runner 才能分辨已驗證／未驗證 |
| audit | backend | `audit_logs` 資料表、`test/unit/server/utils/audit.test.ts` | 未展開 | 無 HTTP 路由，只有資料表與 util |
| observability | backend | `evlog_events` 資料表、`test/unit/server/api/_dev/login.observability.dev.test.ts` | 未展開 | evlog 欄位不入 profiles feature，留給此模組 |
| shared-utils | backend | `server/utils/**`、`test/unit/server/utils/{api-response,validation,supabase,drizzle,db-errors}.test.ts` | 未展開 | 第二個模組展開時，被共用的句型提升到介面根 `dsl.md` |
| auth | frontend | `app/pages/auth/*`、`e2e/auth.spec.ts` | 未展開 | frontend 另開 `002-frontend-reverse` |
| profile-page | frontend | `app/pages/profile/index.vue` | 未展開 | 同上 |
| admin-users | frontend | `app/pages/admin/users.vue` | 未展開 | 同上 |
| shell-and-demo | frontend | `app/pages/(home).vue`、`demo.vue`、`walkthrough.vue`、`e2e/{smoke,roles.example}.spec.ts`、`test/nuxt/**`、`test/unit/composables/useModalForm.test.ts` | 未展開 | 同上 |
| starter-tooling | meta | `test/unit/scripts/*.test.ts`、`test/unit/example.test.ts`、`test/unit/vue-warn-guard.test.ts` | 刻意不補（starter 維護與範例測試，不是使用者可見的產品行為） | 不進 truth |
