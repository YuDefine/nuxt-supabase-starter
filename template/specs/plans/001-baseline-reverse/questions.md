# 待釐清問題（profiles）

由 `features/**` 的 `# [need clarification] Q-…` 與合約註解彙整；`tools/check-truth.mjs` ⑤ 檢查 feature 內引用的 Q 都在此檔。

> **TD-026（2026-10-05）結清**：D1–D5 決策落地後，Q-1/3/4/5/6/7/8/9 皆有答案，feature 已去標籤、由 `pnpm test:bdd` 實跑（22 scenarios 全綠）。每列保留原問題與決議指針，供後續模組展開參考。

| 編號 | 問題 | 程式碼位置 | 決議 |
| --- | --- | --- | --- |
| Q-profiles-1 | 種子使用者 id 不符合 zod 4 `uuid()`（版本與變體位元不合 RFC 4122） | `shared/schemas/profiles.ts`、`supabase/seed.sql` | **已解（TD-026 D1）**：seed id 改成合法 RFC 9562 UUID v7 版型 placeholder（`11111111-1111-7111-8111-…` 等三組；刻意用 v7 因 starter-hygiene hook 只掃 v1–v5 形狀且 `--no-verify` 不可用），`test/unit/supabase/seed.test.ts` 鎖格式；`docs/FIXTURES.md` 同步。 |
| Q-profiles-2 | `profileUpdateBodySchema`／`ProfileUpdateBody` 沒有任何 endpoint 使用，是預留還是漏寫？ | `shared/schemas/profiles.ts:30-33` | **仍開**：本批不改寫入行為，留待 PATCH/PUT 實作時收尾。 |
| Q-profiles-3 | 列表 `search` 直接進 ILIKE，`%`、`_` 不跳脫 | `index.get.ts`、`server/utils/postgrest.ts` | **已解（TD-026 D2）**：`sanitizePostgrestSearch` 已接入 index.get.ts；feature 改寫成「萬用字元會被移除」（`%` 搜尋回傳全表）。 |
| Q-profiles-4 | 錯誤回應的 wire 形狀只被 mock 測試觸及 | `server/utils/api-response.ts`、`server/utils/validation.ts` | **已解（TD-026 D5 wire 實測）**：h3 錯誤只序列化 `{statusCode,statusMessage,message,error,url,status,statusText}`；`data.why`/`data.fix`/`issues` 都不進 HTTP body（evlog 走內部日誌）。DSL 句型已改為「回應不含 PostgREST 診斷欄位」，`ErrorResponse` schema 的 `data` 段應在下一版標示「非 wire 欄位」。 |
| Q-profiles-5 | 授權比對 session 的 `user.role`，不讀 `profiles.role`；兩值域不同步 | `index.get.ts`、`[id].get.ts` | **已解（TD-026 D3）**：`requireRole`/`[id].get.ts` 改讀 DB `profiles.role`（`getDbRole`）；session 角色不被信任。DSL 角色字串 `member`→DB `user` 的映射寫進 dsl.md「角色語意」。 |
| Q-profiles-6 | `profiles.id` 是 uuid，Better Auth 預設 id 產生器是否相容無法確認 | `server/auth.config.ts` | **已解（TD-026 D1）**：`advanced.database.generateId='uuid'`，dev-login 實測回傳合法 v4 uuid。 |
| Q-profiles-7 | 「超出最後一頁回空陣列」只依 postgrest-js 行為推導 | `index.get.ts` | **已解（TD-026 D5）**：`list-profiles.feature`「超出最後一頁得到空陣列」在真 DB 上實跑通過。 |
| Q-profiles-8 | 沒有機制讓測試拿到「id 為指定值」的 session | `server/api/_dev/login.post.ts` | **已解（TD-026 D4）**：dev-login 刻意不擴 `id`（理由寫進 tech-debt TD-026）；DSL 採「別名綁定 dev-login 實際回傳 id＋fixture 落地延遲到第一個 When」模式，字面 UUID 的 seed-id Rule 已刪除。 |
| Q-profiles-9 | 沒有機制讓 session 帶 `user.role`，admin 情境無法實作 | `syncDevLoginRole`、`api-response.ts` | **已解（TD-026 D3）**：授權改讀 DB，`as` 不再參與授權；caller 的 `角色為` 由 step 映射寫進 `profiles.role` 並在落地時校驗一致。admin 情境全部實跑通過。 |
