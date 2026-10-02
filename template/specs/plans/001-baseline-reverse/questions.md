# 待釐清問題（profiles）

由 `features/**` 的 `# [need clarification] Q-…` 與合約註解彙整；`tools/check-truth.mjs` ⑤ 檢查 feature 內引用的 Q 都在此檔。

| 編號 | 問題 | 程式碼位置 | 影響 |
| --- | --- | --- | --- |
| Q-profiles-1 | 種子使用者 id（`a1111111-1111-1111-1111-111111111111` 等）不符合 zod 4 的 `uuid()`（版本與變體位元不合 RFC 4122；實測 zod 4.3.6 `safeParse` 為 false）。依程式碼推導：`GET /api/v1/profiles/<種子 id>` 回 400；`/me` 與列表在回應經 `profileSchema.parse` 時會丟出未處理的 ZodError（預期 500，**未實跑**）。`docs/FIXTURES.md` 仍把這些 id 當可用範例。 | `shared/schemas/profiles.ts:14,37`、`supabase/seed.sql`、`docs/FIXTURES.md` | 需裁決：改種子 id 或放寬 schema |
| Q-profiles-2 | `profileUpdateBodySchema` 與型別 `ProfileUpdateBody` 已宣告，但沒有任何 endpoint 使用（沒有 PATCH／PUT）。是預留，還是漏掉 endpoint？ | `shared/schemas/profiles.ts:30-33` | 無行為可描述，不寫 Rule |
| Q-profiles-3 | 列表的 `search` 直接放進 `ILIKE`，`%`、`_` 不跳脫；`sanitizePostgrestSearch` 存在但沒有任何 handler 使用。是缺陷還是刻意？ | `server/api/v1/profiles/index.get.ts:40-43`、`server/utils/postgrest.ts` | feature 以「現況鎖定」記錄 |
| Q-profiles-4 | 錯誤回應的確切 wire 形狀（`statusCode`／`statusMessage`／`message`／`data.why`／`data.fix` 各在何處）只被 mock 測試觸及，尚未對真伺服器驗證。 | `server/utils/api-response.ts:40-71`、`server/utils/validation.ts` | OpenAPI `ErrorResponse` 是依測試與程式碼的推測 |
| Q-profiles-5 | 授權比對的是 session 的 `user.role`（`admin`／`member`…），不讀 `profiles.role`（資料庫 CHECK 只允許 `admin`／`user`）。兩者的值域不同；session 角色如何與 `profiles.role` 同步，程式碼內看不到。 | `server/api/v1/profiles/index.get.ts:25`、`[id].get.ts:40`、`supabase/migrations/…create_profiles.sql:43-44` | feature 的 Given 以 session 角色驅動 |
| Q-profiles-6 | `profiles.id` 是 `uuid`，且 id 是 Better Auth 的 user id；`server/auth.config.ts` 沒有設定 id 產生器。Better Auth 預設產生的 id 格式是否為 UUID，程式碼內無法確認。 | `supabase/migrations/…create_profiles.sql:40`、`server/auth.config.ts` | 若不是，`GET /api/v1/profiles/:id` 對真實使用者都回 400 |
| Q-profiles-7 | 「超出最後一頁回空陣列」依 postgrest-js 的 offset／limit 行為推導，尚未對真資料庫實跑。 | `server/api/v1/profiles/index.get.ts:45-49` | `list-profiles` 一個 Example |
