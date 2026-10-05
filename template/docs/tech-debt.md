---
audience: both
applies-to: post-scaffold
---

# Tech Debt Register

追蹤 `@followup[TD-NNN]` marker 對應的未解決項目。所有在 `openspec/changes/**/tasks.md` 裡出現的 marker 都必須在此有對應 entry，否則 `spectra-archive` 會被 `pre-archive-followup-gate.sh` 攔截。

規則詳見 `.claude/rules/follow-up-register.md`。

---

## Index

| ID  | Title | Priority | Status | Discovered | Owner |
| --- | ----- | -------- | ------ | ---------- | ----- |

---

<!--
Entry template — 複製下列區塊到 Index 之下，依 TD-NNN 順序新增。

## TD-NNN — {一行標題}

**Status**: open | in-progress | done | wontfix
**Priority**: critical | high | mid | low
**Discovered**: YYYY-MM-DD — {change name / 人工檢查 #N / ADR / ...}
**Location**: {file path(s) with optional line ranges}
**Related markers**: search `@followup[TD-NNN]` in repo

### Problem

{為什麼這是個問題？使用者 / 開發者 / 系統會看到什麼}

### Fix approach

{建議修法；可列多個選項比較}

### Acceptance

{解完後怎麼驗收；可指向 spec 檔、測試、metric}

-->

## 決策紀錄（已拍板 — NEVER 重開）

<!-- flow:decision-log — 本節由 `flow answer`／`flow relend` 寫入，每段以 span id 錨定。整理本檔時 NEVER 刪除本節段落：刪掉的答案會以 answer-not-filed 出現在 `flow status --stalled`。要歸檔就整段搬進 docs/archives/（搬走不算遺失）。 -->

### 決策紀錄 2026-10-05 — TD-026 D1：使用者 id 策略——Better Auth 預設 generateId 產 32 字元英數串（非 UUID），profiles.id 是 Postgres uuid 存不進去；seed.sql 三個 id 也不合 RFC 4122 variant。怎麼收斂？

**答案**：A：id 改 uuid（Charles 2026-10-05 CDB-160 對話）

來源：flow spine `decision.request` span `87fd63aad4697919`（Charles 在 chat 回答，由主線代填）。

### 決策紀錄 2026-10-05 — TD-026 D2：profiles 列表 search 直接進 ILIKE、% 與 _ 不跳脫；sanitizePostgrestSearch 寫好了但零引用。是缺陷還是刻意行為？

**答案**：A：缺陷，接跳脫（Charles 2026-10-05 CDB-160 對話）

來源：flow spine `decision.request` span `4372d609398f478f`（Charles 在 chat 回答，由主線代填）。

### 決策紀錄 2026-10-05 — TD-026 D3：session 角色機制——requireRole/[id].get.ts 讀 session.user.role，但沒有任何機制讓 session 帶 role（syncDevLoginRole 是 no-op、auth.config 無 admin plugin）；且 session 值域（admin/member/guest）與 profiles.role（admin/user）不同步。admin Example 全數卡死，怎麼落地角色？

**答案**：A：handler 改讀 DB（Charles 2026-10-05 CDB-160 對話）

來源：flow spine `decision.request` span `fcd9fc30200c4819`（Charles 在 chat 回答，由主線代填）。

### 決策紀錄 2026-10-05 — TD-026 D4：dev-login 要不要接受指定 id？目前 bodySchema 只有 email/password/name/as，id 由 Better Auth 指派；字面 UUID（種子 id）的呼叫者句型無法實作——但 D1 選 uuid 後那條 seed-id Rule 會整條刪除。

**答案**：A：不擴 dev-login（Charles 2026-10-05 CDB-160 對話）

**落地理由**：使用者身分只能由 Better Auth 簽發（D1 的 `generateId: 'uuid'`）；讓測試請求自選 `id` 會使 fixture 與正式 auth 行為分歧、並能偽造任意 id 的身分繞過 ownership 語意。fixture DSL 的呼叫者別名一律綁定 dev-login 實際回傳的 `user.id`。已於 `server/api/_dev/login.post.ts` `bodySchema` 註記，並由 `test/unit/server/api/_dev/login-schema.test.ts` 鎖定 schema 不含 `id`。

來源：flow spine `decision.request` span `6a005594c9763c11`（Charles 在 chat 回答，由主線代填）。

### 決策紀錄 2026-10-05 — TD-026 D5：BDD runner 選型——manifest 已宣告 aixbdd＋specformula，但目前無 isa.yml、無 test:bdd。truth 句型是 wire-oriented（呼叫 GET by path、回應狀態碼/欄位/pagination 斷言、呼叫者是使用者、資料表沒有被查詢、讀取失敗注入），內建指令是 summary/table-oriented。

**答案**：A：SpecFormula（Charles 2026-10-05 CDB-160 對話）

來源：flow spine `decision.request` span `1ea88317da746fe2`（Charles 在 chat 回答，由主線代填）。
