# profiles 覆蓋矩陣

試點模組的逐項對照。目標模組是權威、次要模組只參考（見 `mapping/vitest-to-profiles.md`）。

| 盤點葉檔 | 類型 | 對應 truth | 狀態 | 備註 |
| --- | --- | --- | --- | --- |
| `server/api/v1/profiles/index.get.ts` | 路由 | `features/backend/profiles/list-profiles.feature`、`contracts/profiles.yaml#listProfiles` | 逆向補齊 | runner 實跑通過（TD-026 D5） |
| `server/api/v1/profiles/me.get.ts` | 路由 | `get-my-profile.feature`、`getMyProfile` | 逆向補齊 | runner 實跑通過 |
| `server/api/v1/profiles/[id].get.ts` | 路由 | `get-profile-by-id.feature`、`getProfileById` | 逆向補齊 | runner 實跑通過 |
| `supabase/migrations/20260313091145_create_profiles.sql` | 資料表 | `data/profiles.dbml` | 逆向補齊 | |
| `test/unit/server/api/v1/profiles/index.get.test.ts` | 既有測試 | list-profiles | 既有覆蓋 | mock 測試，非 wire |
| `test/unit/server/api/v1/profiles/me.get.test.ts` | 既有測試 | get-my-profile | 既有覆蓋 | 同上 |
| `test/unit/server/api/v1/profiles/[id].get.test.ts` | 既有測試 | get-profile-by-id | 既有覆蓋 | 同上 |
| `test/unit/shared/schemas/profiles.test.ts` | 既有測試 | list-profiles 查詢參數、get-profile-by-id 的 id 驗證 | 既有覆蓋 | |
| `test/unit/server/api/v1/profiles/observability.test.ts` | 既有測試 | 三支皆有（500、404 同訊息） | 刻意不補（evlog 欄位屬 observability 模組，feature 只記對外行為） | 見 `modules.md` observability |
| `test/unit/server/utils/api-response.test.ts` | 既有測試（次要） | list-profiles totalPages、三支 401／403 | 未展開 | shared-utils 為權威 |
| `test/unit/server/utils/validation.test.ts` | 既有測試（次要） | list-profiles、get-profile-by-id 的 400 | 未展開 | 同上 |
| `test/unit/server/utils/supabase.test.ts` | 既有測試（次要） | 三支的 401 | 未展開 | 同上 |
| `test/unit/server/utils/db-errors.test.ts` | 既有測試 | 無 | 刻意不補（profiles 未使用 `handleDbError`） | |
| `e2e/*.spec.ts` | 既有測試 | 無 | 刻意不補（未涉及 profiles API） | |
| `shared/schemas/profiles.ts` 的 `profileUpdateBodySchema` | 程式碼 | 無 | 刻意不補（沒有任何 endpoint 使用，見 Q-profiles-2） | 無行為可描述 |
