<!--
🔒 LOCKED — managed by clade
Source: rules/core/audit-pattern.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: D-pattern audit 規範（DB outbox canonical + evlog derived stream + hash anchor）
globs: ['server/api/**/*.ts', 'server/utils/audit.ts', 'supabase/migrations/**/*.sql']
---

# Audit Pattern

D-pattern audit 是 clade 對 audit / operation log 的標準治理模式。決策已定：
不採 DB-only、evlog-only、雙寫並行；新建與升級都走 DB transactional outbox
canonical、evlog derived stream、DB hash anchor。

Reference: `docs/d-pattern-master-plan.md`

## 三段定義

1. **DB outbox canonical**：audit row 與業務 mutation 必須在同一個 PostgreSQL transaction 內完成。business commit 成功時 audit row 必須存在；business rollback 時 audit row 也 rollback。
2. **evlog derived stream**：evlog 只從 canonical audit event 衍生，用於 ops、security monitoring、cross-service trace、短 TTL PII envelope。handler 不能只送 fire-and-forget audit event 就宣稱 audit 完成。
3. **Hash anchor in DB**：`prev_hash` 與 `hash` 直接寫在 canonical DB row。Cloudflare Workers 的 `node:fs` VFS 不是 durable journal，多 instance hash chain 也會 race，所以 hash chain 不依賴 fs journal。

Source-of-truth 規則：任何 audit 問題先查 DB row，evlog 是衍生視圖；evlog miss 是 monitoring 缺口，不改變 canonical audit truth。

## MUST

- Audit canonical truth **MUST** live in DB transactional outbox。
- Audit row **MUST** 與業務 mutation 在同一個 PostgreSQL transaction 內完成；Supabase JS 多次 `.from().insert()` 不是 transaction，必要時用 SQL RPC。
- evlog audit events **MUST** 帶 `auditEventId`，且該值必須對應 DB canonical row 的 `event_id`。
- DB row **MUST** 包含 `prev_hash` / `hash`。
- DB row **MUST NOT** 包含 `ip_address` / `user_agent` / device fingerprint 等 PII 欄位。
- Multi-tenant consumer **MUST** 使用 per-tenant chain；實作可用 PostgreSQL advisory lock per tenant，或用 partition / tenant-scoped chain owner。
- `business_keys` **MUST** 只放結構化業務鍵，例如 `invoiceId`、`reportVersion`、`policyVersion`、`rowCount`。
- `business_keys` **MUST NOT** 放 PII、姓名、email、raw LLM prompt、raw request body、大型 payload。
- 拒絕操作（auth 失敗、role 失敗、policy deny、quota deny）**MUST** 呼叫 `auditDeny()`。
- `requireAuth()` / `requireRole()` / policy helper 若會拒絕使用者，失敗路徑 **MUST** 自動寫入 `auditDeny()`，不可要求每個 handler 手寫。
- 對 paid SaaS security event、regulated report finalization、AI tool invoke、data export 等高風險事件，**MUST** 評估 Option B dispatcher，不能只憑 Option A fire-and-forget evlog。

## MUST NOT

- Handler **MUST NOT** 直接 `db.from('audit_logs').insert(...)` 或 `db.from('operation_logs').insert(...)`。
- Handler **MUST NOT** 直接操作 hash 欄位；`prev_hash` / `hash` 必須由 DB trigger 或 canonical SQL helper 產生。
- Handler **MUST NOT** 把 `log.audit()` 當 canonical audit 完成條件；fire-and-forget 不算 audit 完成。
- DB migration **MUST NOT** 新增 `audit_logs.ip_address` / `audit_logs.user_agent`。
- Multi-tenant audit table **MUST NOT** 使用共用 global chain，除非 consumer 本身確定 single-tenant。
- `server/utils/audit.ts` 以外的檔案 **MUST NOT** 直接寫 audit 表；一次性 migration script 例外，但 PR 必須註明。

## Handler 標準流程

```typescript
const result = await mutateInvoiceWithAudit({
  actorId: user.id,
  targetId: invoiceId,
  amount,
})

log.audit({
  action: 'invoice.refund',
  actor: { id: user.id },
  target: { type: 'invoice', id: invoiceId },
  outcome: 'success',
  auditEventId: result.auditEventId,
})
```

`auditEventId` 指向 DB canonical row。evlog drain 失敗只代表 monitoring miss / retry，不代表 audit 不存在。

## 拒絕操作

拒絕操作是合規剛需，不能只靠 `throw createError({ status: 403 })`：

```typescript
await auditDeny(event, {
  tenantId: user.tenantId,
  actorId: user.id,
  action: 'role.check',
  targetType: 'role',
  targetId: requiredRole,
  reason: 'missing_required_role',
  businessKeys: { requiredRole, policyVersion },
})
```

`reason` 與 `business_keys` 要能解釋 decision，但不得塞姓名、email、raw policy input、raw prompt。

## 失敗模式

| 失敗 | 業務 mutation | DB audit row | evlog | 判定 |
| --- | --- | --- | --- | --- |
| 業務 DB insert/update 失敗 | rollback | rollback | 不送 | 整個 request fail |
| audit DB insert 失敗 | rollback | 無 row | 不送 | 整個 request fail |
| hash trigger 失敗 | rollback | 無 row | 不送 | 整個 request fail |
| evlog drain 失敗 | commit | 有 row | miss / retry | 業務成功，monitoring warn |
| hash chain race | retry / block | 不允許錯鏈 | 不送 | advisory lock 或 retry 解 |

## Review 檢查

```bash
rg -n "from\\(['\"]audit_logs['\"]\\)\\.insert|from\\(['\"]operation_logs['\"]\\)\\.insert" server packages clients
rg -n "log\\.audit\\(" server packages clients
rg -n "auditEventId" server plugins packages
rg -n "ip_address|user_agent|getRequestIP|getHeader\\(.*user-agent" server supabase
rg -n "prev_hash|audit_logs_set_hash|operation_logs_set_hash" supabase/migrations server/database/migrations
```

直接 insert audit 表、`log.audit()` 沒 `auditEventId`、migration 寫入 PII 欄位、multi-tenant 沒 per-tenant chain，review 一律列 🟠 Major。
