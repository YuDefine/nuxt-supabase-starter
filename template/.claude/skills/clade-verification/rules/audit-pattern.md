---
description: D-pattern audit 規範（DB outbox canonical + evlog derived stream + hash anchor），以及業務寫入觸發的非同步副作用（domain events：寄信、webhook、索引、通知）要怎麼落 DB、派送、重試與 replay
paths: ['server/api/**/*.ts', 'packages/*/server/api/**/*.ts', 'server/utils/audit.ts', 'packages/*/server/utils/audit.ts', 'supabase/migrations/**/*.sql']
---
<!-- Clade native rule; source: rules/core/audit-pattern.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Audit Pattern

D-pattern audit 是 clade 對 audit / operation log 的標準治理模式。決策已定：
不採 DB-only、evlog-only、雙寫並行；新建與升級都走 DB transactional outbox
canonical、evlog derived stream、DB hash anchor。

Reference: `docs/d-pattern-master-plan.md`

## 三段定義

1. **DB outbox canonical**：audit row 與業務 mutation 必須在同一個 PostgreSQL transaction 內完成。business commit 成功時 audit row 必須存在；business rollback 時 audit row 也 rollback。
2. **evlog derived stream**：evlog 只從 canonical audit event 衍生，用於 ops、security monitoring、cross-service trace、短 TTL PII envelope。handler 不能只送 fire-and-forget audit event 就宣稱 audit 完成。
3. **Hash anchor in DB**：`prev_hash` 與 `hash` 直接寫在 canonical DB row，不依賴 fs journal（Workers `node:fs` 不 durable、多 instance 會 race）。

Source-of-truth 規則：任何 audit 問題先查 DB row，evlog 是衍生視圖；evlog miss 是 monitoring 缺口，不改變 canonical audit truth。

## MUST

- Audit canonical truth **MUST** live in DB transactional outbox。
- Audit row **MUST** 與業務 mutation 在同一個 PostgreSQL transaction 內完成；Supabase JS 多次 `.from().insert()` 不是 transaction，必要時用 SQL RPC。
- evlog audit events **MUST** 帶 `auditEventId`，且該值必須對應 DB canonical row 的 `event_id`。
- DB row **MUST** 包含 `prev_hash` / `hash`。
- DB row **MUST NOT** 包含 `ip_address` / `user_agent` / device fingerprint 等 PII 欄位（migration 也不得新增）。
- Multi-tenant consumer **MUST** 使用 per-tenant chain；實作可用 PostgreSQL advisory lock per tenant，或用 partition / tenant-scoped chain owner。
- `business_keys` **MUST** 只放結構化業務鍵，例如 `invoiceId`、`reportVersion`、`policyVersion`、`rowCount`。
- `business_keys` **MUST NOT** 放 PII、姓名、email、raw LLM prompt、raw request body、大型 payload。
- 拒絕操作（auth 失敗、role 失敗、policy deny、quota deny）**MUST** 呼叫 `auditDeny()`。
- `requireAuth()` / `requireRole()` / policy helper 若會拒絕使用者，失敗路徑 **MUST** 自動寫入 `auditDeny()`，不可要求每個 handler 手寫。
- Audit drain reliability **MUST** 透過 Postgres outbox dispatcher（`claim_audit_outbox_batch` + `FOR UPDATE SKIP LOCKED` + idempotent `mark_audit_evlog_drained`）；**MUST NOT** 依 tenant tier 或事件等級降級成 fire-and-forget evlog。Drain 端 **MUST** 以 `auditEventId` idempotently 去重（at-least-once 語意）。
- Atomicity 依事件 **風險等級** 分流，不依商業 tier：高風險 mutation（refund / billing、role / permission、data export、regulated report finalization、AI agent autonomous decision / tool invoke）**MUST** 用 SQL RPC 包 business mutation + audit insert 同 transaction；一般 CUD 用 helper baseline，但 audit insert **MUST** 緊接 business write，**MUST NOT** 先 response 或丟 background promise。
- Outbox dispatcher state **MUST** 放在 Postgres（`evlog_drained_at` / `attempts` / `next_attempt_at` / `lease_until`），**MUST NOT** 用 KV / D1 / Worker memory 作 durability source。LISTEN/NOTIFY、Realtime、Worker memory buffer 只能作 wake-up / best-effort signal，**MUST NOT** 被當成 durable queue。

## MUST NOT

- Handler **MUST NOT** 直接 `db.from('audit_logs').insert(...)` 或 `db.from('operation_logs').insert(...)`。
- Handler **MUST NOT** 直接操作 hash 欄位；`prev_hash` / `hash` 必須由 DB trigger 或 canonical SQL helper 產生。
- Handler **MUST NOT** 把 `log.audit()` 當 canonical audit 完成條件；fire-and-forget 不算 audit 完成。
- Multi-tenant audit table **MUST NOT** 使用共用 global chain。Single-tenant consumer 可以用 global chain（tenant isolation 不適用）。
- `server/utils/audit.ts` 以外的檔案 **MUST NOT** 直接寫 audit 表；一次性 migration script 例外，但 PR 必須註明。

## Tamper Resistance（防竄改與保留）

hash chain 讓竄改可被偵測，但擋不住有寫權限者改 row 再重算整條 chain；必須在 DB 權限層做成 append-only，並在 DB 外留獨立錨點。

### Append-only DB permission（權限層強制）

- Audit table **MUST** 在 DB 權限層強制 append-only — 對任何 application role（含寫入 audit 用的 role）**只 GRANT INSERT + SELECT**，**MUST NOT** GRANT `UPDATE` / `DELETE`：
  ```sql
  revoke update, delete on <audit_schema>.<audit_table> from public;
  grant insert, select on <audit_schema>.<audit_table> to <audit_writer_role>;
  -- 明確不給 update / delete
  ```
- **權限分離**：能 INSERT **MUST NOT** 隱含能 UPDATE / DELETE。`service_role` 也 MUST 以 table-level `REVOKE UPDATE, DELETE` 擋住（BYPASSRLS 不 bypass table-level `GRANT`）。
- **MUST NOT** 在 audit table 上建 `UPDATE` / `DELETE` trigger 或 policy；只該有 `INSERT`（+ hash 的 `BEFORE INSERT` trigger）與 `SELECT`。

### External anchoring / WORM export（DB 外的獨立錨點）

- **MUST** 有 DB 之外的獨立防竄改機制（擇一或並用）：
  - **External anchoring**：定期把 chain head `hash`（或 Merkle root）錨定到不可回改的外部（object-lock storage、timestamping service）
  - **WORM export**：定期把 audit row export 到 write-once-read-many 儲存（S3 Object Lock 等）

### Retention / Legal hold（保留與法律凍結）

- **MUST** 定義 audit 的 **retention 政策**（保留多久、由誰、依什麼法規 / 合約要求），並確保清理只依該政策執行。
- **Retention 清理只能是「到期後的批次 purge」**，走可審計的 migration / job，**MUST NOT** 是 ad-hoc 的 `DELETE`。
- **Legal hold**：在調查 / 訴訟 / 稽核期間 **MUST** 能凍結相關 audit 不被 retention purge 清掉（標記 hold flag / 排除該範圍於 purge job）。**NEVER** 讓例行 retention 清掉正處於 legal hold 的紀錄。

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

## Domain events（非同步副作用）

業務寫入成功後要觸發的副作用（寄信、打 webhook、更新搜尋索引、推通知）走 domain event。它和 audit 是兩件事：audit 記「發生過什麼」，domain event 驅動「接著要做什麼」；**NEVER** 拿其中一個代替另一個。conventions 目錄條目是 `registry/conventions.json` 的 `domain-events`。

### 寫入：與業務同一次提交

event row **MUST** 與業務寫入一起提交，理由與上方 DB outbox 相同——業務 commit 了、event 沒寫到，副作用就永遠不會發生。

| DB | 同一次提交的做法 | 派送 |
| --- | --- | --- |
| Supabase／Postgres | SQL RPC 內同一 transaction 寫業務 row 與 event outbox row（或在同一 transaction 內 `pgmq.send`） | outbox dispatcher（`FOR UPDATE SKIP LOCKED` 認領）或 pgmq consumer |
| Cloudflare D1 | `db.batch([業務寫入, event insert])` 同批提交；**NEVER** 分兩次 `await` 寫 | 有 Queue binding → `send` 只帶 event id；沒有 binding → `ctx.waitUntil()` 在同一個 request 內 inline 派送 |

上方 § MUST「dispatcher state 只能放 Postgres」管的是 audit drain；D1 consumer 的 domain event 與 delivery 表以 D1 為事實來源，不受該條限制。

- **沒設 Queue binding 時行為 MUST 仍然正確**：event row 已在 DB，inline 派送失敗只是留下未成功的 delivery 紀錄，由下方 replay（或排程補跑）補上；**NEVER** 讓「沒有 queue」退化成不寫 event 或吞掉錯誤。
- **payload 入 DB 前 MUST 欄位級 redact 並截斷單欄長度**（例如單欄 8KB）：event 表不經 evlog 的 `redact`，PII 分層照 [[logging.sampling-redaction]] § PII 分層的 audit chain 欄套用。

### 派送：訊息只帶 id

- Queue／pgmq 訊息 **MUST** 只帶 event id，handler 從 DB 讀 payload——訊息內容不是事實來源，DB row 才是。
- **壞訊息直接 ack 丟棄並 log**（沒有 id、id 查不到 row、格式不符）：retry 不會讓它變好，只會塞住佇列。**handler 執行失敗才 retry**。

### 冪等：每個 (event, handler) 一列 delivery

- **MUST** 有 delivery 表，`(event_id, handler_name)` unique；每次執行 upsert 累加 `attempts`、記 `last_error`，成功時寫 `delivered_at`。
- handler 執行前 **MUST** 先查該列，已成功就跳過——佇列是 at-least-once，重送是常態不是例外。
- `handler_name` 是冪等 key，**MUST** 是寫死的穩定字串；**NEVER** 從函式名、檔案路徑或 bundle 後的識別字推導（改名或 minify 後，已成功的 handler 會被當成沒跑過而重跑）。

### 命名與訂閱

- event 名 **MUST** 是 `<entity>.<action>`（`invoice.paid`）或 `<entity>.<field>.<action>`（`user.email.changed`），過去式動作、全小寫。
- 訂閱支援 `*`（單段）與 `**`（多段）萬用字元；同一個 handler 訂多個 event 時，冪等仍以 `(event_id, handler_name)` 計。

### Replay

- replay endpoint **MUST** 限 superuser，且只重跑**尚未成功**的 handler（delivery 列沒有 `delivered_at`，或訂閱了該 event 卻根本沒有 delivery 列）；**NEVER** 提供「整個 event 全部重跑」的捷徑——已寄出的信、已打出的 webhook 會再發一次。
- replay 本身是敏感操作，**MUST** 寫 audit（照上方 Handler 標準流程；被拒時走 `auditDeny()`）。

## Review 檢查

```bash
rg -n "from\\(['\"]audit_logs['\"]\\)\\.insert|from\\(['\"]operation_logs['\"]\\)\\.insert" server packages clients
rg -n "log\\.audit\\(" server packages clients
rg -n "auditEventId" server plugins packages
rg -n "ip_address|user_agent|getRequestIP|getHeader\\(.*user-agent" server supabase
rg -n "prev_hash|audit_logs_set_hash|operation_logs_set_hash" supabase/migrations server/database/migrations
```

直接 insert audit 表、`log.audit()` 沒 `auditEventId`、migration 寫入 PII 欄位、multi-tenant 沒 per-tenant chain，review 一律列 🟠 Major。
