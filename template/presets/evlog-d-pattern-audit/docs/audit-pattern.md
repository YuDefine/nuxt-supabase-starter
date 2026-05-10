<!-- 🔒 LOCKED — managed by clade sync-evlog-presets.mjs -->
<!-- preset: evlog-d-pattern-audit -->
<!-- source: vendor/snippets/audit-pattern/README.md -->
<!-- to: presets/evlog-d-pattern-audit/docs/audit-pattern.md -->
<!-- do not edit consumer-side; modify clade vendor snippet then re-propagate -->

# D-pattern Audit Snippets

D-pattern audit 是 clade 的標準 audit 治理模式：DB transactional outbox 是 canonical truth，evlog 是 derived stream，DB row 自帶 `prev_hash` / `hash` 作為 hash anchor。任何 audit 問題先查 DB row；evlog 用於 monitoring、ops trace 與短 TTL PII envelope。

Reference: `docs/d-pattern-master-plan.md`

## 為什麼不選 A/B/C

DB-only 缺少 production monitoring stream，事件進 DB 後 ops 不一定看得到；evlog-only 是 fire-and-forget，不能證明 business commit 後 audit row 存在；雙寫並行會產生「DB 成功但 evlog 失敗」或「evlog 成功但 DB rollback」的不一致。D-pattern 把 DB row 定為唯一 canonical，再讓 evlog 從 `auditEventId` cross-reference 衍生。

## 安裝 SOP

1. 複製 `migration.sql` 到 `supabase/migrations/<timestamp>_create_audit_logs.sql`。
2. 視 consumer 調整 schema：multi-tenant 必填 `tenant_id` 並使用 per-tenant chain；single-tenant 可移除 `tenant_id` 與 tenant RLS；TDMS 可保留 `tdms.operation_logs` 命名但需補齊 D-pattern 欄位。
3. 複製 `helper.ts` 到 `server/utils/audit.ts`。
4. 複製 `drain.ts` 到 `server/plugins/evlog-drain.ts`。
5. 確認 consumer 已安裝並設定 evlog / Supabase server client。
6. 跑 migration。
7. 寫一筆 smoke audit row，確認 `event_id`、`prev_hash`、`hash`、`business_keys` 正常。
8. 呼叫 `audit(event, ...)`，確認成功時回傳 `auditEventId`。
9. 呼叫 `auditDeny(event, ...)`，確認拒絕操作有 DB row。
10. 跑 chain verifier query，確認沒有不連續 row。

## Consumer 調整點

- `public.get_tenant_id()`：若 consumer 沒有此函式，改成既有 tenant resolver，或 single-tenant 移除 tenant select policy。
- `audit_logs` table name：若 consumer 已有 `operation_logs`，可改表名，但 helper、trigger、index、review rule 要一致。
- `business_keys`：只放結構化業務鍵，不放 PII、raw prompt、raw request body 或大型 payload。
- `actor_id`：建議只存 UUID。需要 email / 姓名時放 evlog 短 TTL envelope，不寫 DB row。
- `idempotency_key`：高風險外部 webhook / payment callback 建議填；一般 internal mutation 可不填。
- `span_id`：大量操作或 agent run 建議填，用來串同批 audit rows。

## Atomicity vs Drain reliability（兩維度決策）

Atomicity 與 drain reliability 是兩個正交決策，不應綁成同一條分流，也不應用商業 tier 定義技術保證。

| Axis              | Baseline                                                            | Stronger path                                                      |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Atomicity         | 一般 mutation：handler business write 成功後緊接 `await audit(...)` | 高風險 mutation：SQL RPC 包 business + audit insert 同 transaction |
| Drain reliability | 所有 audit row 一律進 Postgres outbox dispatcher                    | 不分流；只調整 priority、retry、alert severity                     |

**Drain 一律走 outbox dispatcher**：所有 audit canonical row 帶 `evlog_drained_at` / `attempts` / `next_attempt_at` / `lease_until` outbox state，由 cron / scheduled task `claim → send → mark` 推到 evlog SaaS。Helper 在 request 內 emit derived evlog event 仍允許（含 `auditEventId` 與 PII envelope），但只是 best-effort；reliability 來自 dispatcher 從 outbox 重送，不來自 fire-and-forget。詳細 dispatcher 工程設計（`claim_audit_outbox_batch` + `FOR UPDATE SKIP LOCKED`、idempotent `mark_audit_evlog_drained`、5 條 fail mode、不能當 durable queue 的東西）見 master plan §6。

**Atomicity 風險等級判定**：

```bash
printf '%s\n' \
  "refund / billing mutation? -> SQL RPC" \
  "role / permission mutation? -> SQL RPC" \
  "data export / GDPR-touch action? -> SQL RPC" \
  "regulated report finalization? -> SQL RPC" \
  "AI agent autonomous decision / tool invoke? -> SQL RPC" \
  "auth / role / policy denial? -> auditDeny() guard helper baseline" \
  "一般 CUD / 一般 admin mutation? -> helper baseline (await audit())"
```

判定 **不依** 客戶是否付費 / tenant 是否 paid 分流；依 **事件本身的合規 / business / failure impact** 與 atomicity 需求。

## O1 evlog signed chain overlay 整合（optional）

如果 consumer 也套了 `vendor/snippets/evlog-audit-signed/` 的 O1 overlay（perno 已套）：

- `helper.ts` 會自動把 `audit_logs.prev_hash` / `audit_logs.hash` 透過 `log.set({ audit: { dbChain: ... } })` 寫進 wide event。
- O1 `signed()` drain 階段讀這塊 dbChain 並對其加 evlog signed hash 簽章，落地 `audit_signed_chain` table。
- O1 `auditDiff` cron 比對 `audit_logs.hash` 與 `audit_signed_chain.audit_logs_hash`，發現 drift 寫進 `audit_chain_drift` table。

沒套 O1 的 consumer：`log.set({ audit: { dbChain } })` 只是 wide event 上多一塊 field，沒副作用，不影響 baseline D-pattern。

## Handler 用法

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

log.audit({
  action: 'data.export',
  auditEventId: result.auditEventId,
})
```

拒絕操作：

```ts
await auditDeny(event, {
  tenantId: user.tenantId,
  actorId: user.id,
  action: 'role.check',
  targetType: 'role',
  targetId: 'billing_admin',
  reason: 'missing_required_role',
  businessKeys: { requiredRole: 'billing_admin' },
})
```

## Consumer onboarding checklist

- [ ] `audit_logs` / `operation_logs` 有 `event_id`、`prev_hash`、`hash`、`outcome`、`reason`、`business_keys`。
- [ ] DB 表沒有 `ip_address`、`user_agent`、device fingerprint。
- [ ] Hash payload function 使用 deterministic 欄位列表，且 `audit_log_hash_payload` 標為 `STABLE`。
- [ ] Insert trigger 會產生 `prev_hash` / `hash`。
- [ ] Multi-tenant consumer 使用 per-tenant advisory lock 或 partition。
- [ ] RLS 只允許 service insert / service select / tenant select；沒有 UPDATE / DELETE policy。
- [ ] `server/utils/audit.ts` 是唯一 handler 入口。
- [ ] Handler 沒有直接 `.from('audit_logs').insert(...)` 或 `.from('operation_logs').insert(...)`。
- [ ] `log.audit()` 都帶 `auditEventId`。
- [ ] `requireAuth()` / `requireRole()` / policy deny 路徑有 `auditDeny()`。
- [ ] `business_keys` 沒有 PII、email、姓名、raw prompt、raw request body。
- [ ] 高風險 mutation 已判斷是否需要 SQL RPC atomicity（refund / billing、role / permission、data export、regulated report finalization、AI agent autonomous action / tool invoke），並把判定理由寫進 change / PR。
- [ ] 所有 audit row（不分事件等級）走 Postgres outbox dispatcher：claim batch + `FOR UPDATE SKIP LOCKED` + idempotent `mark_audit_evlog_drained`；dev drain 餵 analyze-logs，prod drain 從 outbox 推到 Sentry / Axiom / OTLP。
- [ ] Dispatcher fail modes 已有 runbook 或測試：duplicate send（idempotent 去重）、send 成功 mark 失敗、poison row（attempt threshold + Sentry alert）、cron missed、lease stuck。
- [ ] Chain verifier query 回傳 0 row。

## Smoke test SQL

```sql
INSERT INTO public.audit_logs (
  tenant_id,
  actor_id,
  action,
  target_type,
  target_id,
  outcome,
  reason,
  business_keys
) VALUES (
  null,
  null,
  'audit.smoke_test',
  'system',
  'audit-pattern',
  'success',
  'install_check',
  jsonb_build_object('source', 'clade')
)
RETURNING event_id, prev_hash, hash;
```

## Chain verifier

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
