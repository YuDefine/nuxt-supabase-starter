---
description: User lifecycle 規範（soft-delete / suspend / hard-delete 的 FK 策略與 guard pattern）
paths: ['server/api/**/user*', 'packages/*/server/api/**/user*', 'template/server/api/**/user*', 'server/api/**/admin/user*', 'packages/*/server/api/**/admin/user*', 'template/server/api/**/admin/user*', 'supabase/migrations/**/*.sql', 'server/database/migrations/**/*.sql', 'packages/*/server/database/migrations/**/*.sql', 'template/server/database/migrations/**/*.sql']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/user-lifecycle.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# User Lifecycle

Consumer 刪除或停用使用者時，FK 策略與 guard pattern 的標準治理。三種 variant 任選其一，FK 策略矩陣與 delete guard 跨 variant 共用。

Reference: `vendor/snippets/user-lifecycle/README.md`（variant 決策樹 + 範本安裝 SOP）

## 三種 Variant

| Variant | 語意 | 適用場景 |
| --- | --- | --- |
| **status-based** | `suspended_at` / `status` 欄，使用者永不從表消失 | SaaS、校務、多角色平台（大多數 consumer） |
| **suspend-and-delete** | 先 suspend 冷卻期，到期 hard delete（scheduler / cron） | GDPR right-to-erasure、資料保留政策有硬限 |
| **hard-delete-explicit** | 無 suspend，直接 hard delete + cascade | 單租戶 internal tool、無合規需求 |

## FK Strategy Decision Matrix

設計 user 相關 FK 時，依**被引用表的語意**選 ON DELETE 行為：

| 被引用資料類型 | ON DELETE 行為 | 理由 |
| --- | --- | --- |
| User-owned data（profile / settings / preference） | `CASCADE` | 屬使用者私有，人刪資料跟著刪 |
| Membership / role assignment | `CASCADE` | 成員關係隨人消失 |
| `created_by` / `updated_by` / `assigned_to` | `SET NULL` | 保留資料但去除人員連結 |
| Audit trail / operation log | **No FK** or `SET NULL` | Audit canonical 不可因刪人斷鏈（見 `audit-pattern.md`） |
| Financial / compliance record | `RESTRICT` | 有帳務 / 合規紀錄的使用者不可刪 |
| Manager / supervisor reference | `SET NULL` | 組織樹不因離職斷裂 |

**MUST** 在 migration PR 對每個新 FK 標註選用的行為與理由。

## Delete Guard Pattern

不論哪個 variant，刪除 / 停用 endpoint **MUST** 實作以下 5 道 guard（順序即優先序）：

| # | Guard | 拒絕條件 | 錯誤碼 |
| --- | --- | --- | --- |
| 1 | No self-delete | `actor.id === target.id` | 403 |
| 2 | No delete/suspend admin | target 有 admin role（須先 demote） | 403 |
| 3 | No delete owner | target 是 org/tenant owner（須先 transfer） | 403 |
| 4 | No delete last admin | org/tenant 內只剩一個 admin | 403 |
| 5 | Session invalidation | 依 session-store 類型 — revocable store 即時 revoke;stateless cookie 走 per-request 重驗（見 § Session 失效策略） | — |

Guard 5 非 pre-check 而是 post-action side-effect；其餘 4 道在 mutation 前 fail-fast。

Template: `vendor/snippets/user-lifecycle/delete-guard.ts.template`

## Auth Layer Enforcement

Status-based / suspend-and-delete variant **MUST** 在 auth middleware（`requireAuth` 或等價）檢查 `suspended_at IS NOT NULL` 或 `status = 'suspended'`，拒絕已停用帳號的所有 API 請求（回 403 `ACCOUNT_SUSPENDED`）。

**禁止**只在前端擋 — server-side middleware 是唯一可信層。

Template: `vendor/snippets/user-lifecycle/suspend-guard.ts.template`

## Session 失效策略（依 session-store 類型）

Guard 5「session invalidation」的具體做法**取決於 session 是否可由 server 端 revoke**，兩條路徑不可混用：

| Session-store 類型 | 代表 | delete/suspend 後的做法 |
| --- | --- | --- |
| **Revocable session store** | Supabase server session、Better Auth DB sessions | delete/suspend **成功後** server 端即時 revoke（`auth.admin.deleteUser` / `signOut` scope `global` / `revokeSession by userId`） |
| **Stateless cookie session** | nuxt-auth-utils `setUserSession`（cookie-only，無 server store） | cookie 已發出即無法 server revoke，會有效到 `maxAge`（預設 7 天）→ **MUST** 改在 auth middleware **per-request 重驗 session user 是否仍存在於 DB**，不存在 → `clearUserSession(event)` + 401 |

**Stateless 場景關鍵**：光在 delete endpoint 動作**不足以**讓既有 cookie 失效——deleted user 的 cookie session 仍可用到過期。唯一可信的失效點是**每個 API 請求重驗**。

這條 per-request 重驗（查 user **是否存在**）跟 § Auth Layer Enforcement 的 suspend check（查 `suspended_at`）是**不同檢查**，但 status-based + stateless 同時成立時**可合併成單一 query** 避免每請求兩次 DB round-trip：select `suspended_at` → row 不存在 = deleted → 401；`suspended_at` 有值 = suspended → 403。

Template: `vendor/snippets/user-lifecycle/user-validation.ts.template`（stateless cookie session 專用）

## MUST

- **MUST** 在 `proposal.md` 或 ADR 明確宣告採用哪個 variant。
- **MUST** 對每條新增 user FK 填寫 Decision Matrix 欄位（migration comment 或 PR 說明）。
- **MUST** 實作全部 5 道 delete guard（guard 1–4 pre-check + guard 5 post-action）。
- **MUST** 在 auth middleware 檢查 suspend 狀態（status-based / suspend-and-delete variant）。
- **MUST** 在 suspend/delete 成功後讓該使用者所有 active session 失效，做法依 session-store 類型（見 § Session 失效策略）：revocable store（Supabase `auth.admin.deleteUser` / `signOut` scope `global`、Better Auth revoke session by userId）即時 revoke；**stateless cookie session（nuxt-auth-utils）MUST 改在 auth middleware per-request 重驗 user 仍存在，不存在即 `clearUserSession` + 401**。
- **MUST** 對 financial / compliance FK 使用 `RESTRICT`，讓刪除在 DB 層 fail-fast。

## NEVER

- **NEVER** hard-delete 有 audit trail 的使用者而不先處理 audit FK（No FK 或 SET NULL）。
- **NEVER** 用 `CASCADE` 在 `created_by` / `updated_by` — 刪人不該連帶刪內容。
- **NEVER** 在 migration 不寫 `ON DELETE` 行為依賴 DB 預設（Postgres 預設 `NO ACTION` ≈ `RESTRICT`，但隱式依賴無法 review）。
- **NEVER** 只在前端 disable 按鈕而不在 server guard 擋 self-delete / admin-delete。
- **NEVER** 刪除 / 停用使用者後遺留 active session（安全漏洞）。stateless cookie 場景僅靠 delete-time 動作不足 — 缺 per-request 重驗 middleware 視同遺留 active session。
- **NEVER** 對 suspend-and-delete variant 跳過冷卻期直接 hard delete（除非使用者明確選 hard-delete-explicit variant）。

## Review 檢查

```bash
# FK 行為是否顯式宣告
rg -n "REFERENCES.*user" supabase/migrations server/database/migrations | grep -v "ON DELETE"

# delete guard 是否齊備
rg -n "self.delete\|selfDelete\|no.self\|SELF_DELETE" server/api server/utils

# suspend check 是否在 middleware
rg -n "suspended_at\|ACCOUNT_SUSPENDED\|status.*suspended" server/middleware server/utils

# session invalidation — revocable store
rg -n "deleteUser\|signOut.*global\|revokeSession\|invalidateSession" server/api server/utils

# session invalidation — stateless cookie（nuxt-auth-utils）per-request 重驗
rg -n "clearUserSession\|user-validation" server/middleware server/api
```

FK 無 `ON DELETE` 行為、缺 delete guard、auth middleware 沒 suspend check → review 一律列 Major。stateless cookie session（nuxt-auth-utils）缺 per-request 重驗 middleware（`clearUserSession` 那條 grep 0 命中）同列 Major。
