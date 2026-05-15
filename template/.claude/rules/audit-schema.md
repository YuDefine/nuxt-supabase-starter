<!--
🔒 LOCKED — managed by clade
Source: rules/modules/db-schema/supabase/audit-schema.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Supabase audit table schema 慣例（audit_logs）
paths: ["supabase/migrations/**/*.sql", "server/utils/audit*.ts", "server/api/**/*.ts"]
---

# Audit Schema Conventions（supabase variant）

通用 `audit_logs` 表名 + D-pattern hash chain 慣例。適用 perno / yuntech / agentic-rag 等 Supabase Cloud / self-hosted 走通用 schema 的 consumer。

## 表名與基本欄位

預設 audit table 命名為 `public.audit_logs`，**MUST** 含下列欄位：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `event_id` | `uuid PK` | audit row primary key |
| `tenant_id` | `uuid` | per-tenant chain（multi-tenant consumer 必填；single-tenant 可移除） |
| `actor_id` | `uuid` | 操作者 user.id；nullable 容納 system event |
| `action` | `text` | 操作動作識別（`<verb>.<entity>` 格式，例如 `data.export`、`role.check`） |
| `target_type` | `text` | 受影響 entity 類型 |
| `target_id` | `text` | 受影響 entity PK |
| `outcome` | `text` | `success` / `denied` / `failure` 三選一 |
| `reason` | `text` | denied / failure 時的原因 |
| `business_keys` | `jsonb` | 結構化業務鍵；不可放 PII / raw prompt / large payload |
| `prev_hash` | `text` | 上一筆同 tenant 的 hash（per-tenant chain）|
| `hash` | `text` | 本筆 hash（trigger 在 INSERT 時計算） |
| `idempotency_key` | `text` | 高風險外部 webhook / payment callback 用 |
| `span_id` | `uuid` | 同批操作共用 span id |
| `created_at` | `timestamptz` | 自動 `now()` |

## D-pattern Hash Chain 規約

audit_logs 是 **D-pattern canonical truth**（DB row 是 source of truth；evlog wide event 是 derived stream）。

- **MUST** 用 trigger 計算 `prev_hash` / `hash`（SECURITY DEFINER + advisory lock 避免 race）
- **MUST** hash payload function 標 `STABLE` 並用 deterministic 欄位列表
- **MUST** RLS 只允許 service insert / service select / tenant select；**沒有** UPDATE / DELETE policy
- **MUST** 所有 audit row 走 Postgres outbox dispatcher（`claim_audit_outbox_batch` + `mark_audit_evlog_drained`），不分 tenant tier 不分流
- **NEVER** 在 DB row 寫 `ip_address` / `user_agent` / device fingerprint（PII envelope 只放 evlog）

## Audit helper 接口

每個 consumer **MUST** 用 `server/utils/audit.ts` 統一 helper（vendor template 在 clade `vendor/snippets/audit-pattern/helper.ts`）：

```ts
const result = await audit(event, {
  tenantId,
  actorId: user.id,
  action: 'data.export',
  targetType: 'report',
  targetId: reportId,
  outcome: 'success',
  reason: 'user_requested_export',
  businessKeys: { format: 'csv', rowCount },
})

log.audit({ action: 'data.export', auditEventId: result.auditEventId })
```

拒絕路徑用 `auditDeny()`。

## 高風險 mutation atomicity

**MUST** 對下列情境用 SQL RPC 包 business + audit insert 同 transaction（不能用 helper 兩步走）：

- refund / billing
- role / permission mutation
- data export / GDPR-touch action
- regulated report finalization
- AI agent autonomous decision / tool invoke

**MAY** 對一般 CUD 用 helper baseline（business write 成功後緊接 `await audit(...)`）。

## Audit chain verifier

CI / scheduled task **MUST** 跑 chain verifier query 驗證 0 row：

```sql
WITH ordered AS (
  SELECT tenant_id, event_id, prev_hash, hash,
         lag(hash) OVER (PARTITION BY tenant_id ORDER BY created_at, event_id) AS expected_prev
  FROM public.audit_logs
)
SELECT *
FROM ordered
WHERE prev_hash IS DISTINCT FROM expected_prev
  AND prev_hash IS NOT NULL;
```

## evlog signed chain overlay（O1，optional）

consumer 可額外套 `vendor/snippets/evlog-audit-signed/` O1 overlay：

- 加 `audit_signed_chain` table（per-tenant chain，evlog HMAC sign DB hash）
- `auditDiff` cron 比對 DB hash vs evlog signed hash，drift 寫進 `audit_chain_drift` table
- secret 走 `EVLOG_AUDIT_SECRET`（不能跟 D-pattern DB hash secret 共用，rotation 分離）

詳見 clade `docs/evlog-master-plan.md` § 12 + `vendor/snippets/evlog-audit-signed/rotation-runbook.md`。

## Reference

- clade `vendor/snippets/audit-pattern/`：完整 migration.sql + helper.ts + drain.ts + README
- clade `docs/d-pattern-master-plan.md`：D-pattern 完整治理模式
- clade `vendor/snippets/evlog-audit-signed/`：O1 signed chain overlay
