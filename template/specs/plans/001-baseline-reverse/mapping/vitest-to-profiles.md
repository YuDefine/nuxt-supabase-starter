# 既有測試 → profiles 模組

目標模組是權威、次要模組只參考。案例數見 `inventory.md`（機械產生）。

| 既有測試 | 對應 feature | 角色 |
| --- | --- | --- |
| `test/unit/server/api/v1/profiles/index.get.test.ts` | list-profiles | 權威 |
| `test/unit/server/api/v1/profiles/me.get.test.ts` | get-my-profile | 權威 |
| `test/unit/server/api/v1/profiles/[id].get.test.ts` | get-profile-by-id | 權威 |
| `test/unit/server/api/v1/profiles/observability.test.ts` | 三支皆有（500、404 同訊息）；evlog 欄位不入 feature | 權威（可觀測性部分留待 observability 模組） |
| `test/unit/shared/schemas/profiles.test.ts` | list-profiles（查詢參數）、get-profile-by-id（id 驗證） | 權威 |
| `test/unit/server/utils/api-response.test.ts` | list-profiles（totalPages）、三支（401／403） | 次要（shared-utils 模組為權威） |
| `test/unit/server/utils/validation.test.ts` | list-profiles、get-profile-by-id（400） | 次要 |
| `test/unit/server/utils/supabase.test.ts` | 三支（401） | 次要 |
| `test/unit/server/utils/db-errors.test.ts` | 無（profiles 未使用 `handleDbError`） | 不對應 |
| `e2e/*.spec.ts` | 無（未涉及 profiles API） | 不對應 |
