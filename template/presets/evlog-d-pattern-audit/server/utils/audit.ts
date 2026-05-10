/**
 * 🔒 LOCKED — managed by clade sync-evlog-presets.mjs
 * preset: evlog-d-pattern-audit
 * source: vendor/snippets/audit-pattern/helper.ts
 * to: presets/evlog-d-pattern-audit/server/utils/audit.ts
 * do not edit consumer-side; modify clade vendor snippet then re-propagate
 */
/**
 * D-pattern audit helper — DB canonical, evlog derived stream
 *
 * Source: clade docs/d-pattern-master-plan.md §4
 *
 * 使用：
 *   import { audit, auditDeny } from '~/server/utils/audit'
 *   await audit(event, { tenantId, actorId, action, targetType, targetId, outcome: 'success' })
 *
 * 注意：
 * - DB INSERT 失敗會 throw（業務必須跟著 fail）
 * - 同 request 內 emit 的 derived evlog event 是 best-effort；drain 失敗只 warn（業務不該 fail）
 * - Drain reliability 由 Postgres outbox dispatcher 統一保證（claim_audit_outbox_batch + idempotent mark）
 *   — 所有 audit row 不分事件等級都走 dispatcher，不依 tenant tier 降級。詳見 master plan §6
 * - PII envelope 只放在 evlog event；DB canonical row 不寫 ip / user_agent
 */

import type { H3Event } from 'h3'
import { createError, useLogger } from 'evlog'
import { serverSupabaseClient } from '#supabase/server'

export type AuditOutcome = 'success' | 'denied' | 'failure'

export interface AuditInput {
  tenantId?: string
  actorId?: string
  action: string
  targetType: string
  targetId: string
  outcome: AuditOutcome
  reason?: string
  businessKeys?: Record<string, unknown>
  spanId?: string
  idempotencyKey?: string
}

export interface AuditResult {
  auditEventId: string
  hash: string
}

interface AuditRow {
  event_id: string
  prev_hash: string | null
  hash: string
}

/**
 * 寫入 canonical DB audit row，並送出 derived evlog audit event。
 *
 * Contract:
 * - DB insert / hash trigger / RLS 失敗時會 throw，caller 的業務 mutation 必須跟著 fail。
 * - 回傳的 `auditEventId` 必須用於任何後續 `log.audit()` cross-reference。
 * - `businessKeys` 只能放結構化業務鍵，不可放 PII、raw prompt、raw body 或大型 payload。
 */
export async function audit(event: H3Event, input: AuditInput): Promise<AuditResult> {
  const log = useLogger(event)
  const supabase = await serverSupabaseClient(event)

  const { data, error } = await supabase
    .from('audit_logs')
    .insert({
      tenant_id: input.tenantId,
      actor_id: input.actorId,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      outcome: input.outcome,
      reason: input.reason,
      business_keys: input.businessKeys ?? {},
      span_id: input.spanId,
      idempotency_key: input.idempotencyKey,
    })
    .select('event_id, prev_hash, hash')
    .single<AuditRow>()

  if (error) {
    log.error(error as Error, { step: 'audit-insert', action: input.action })
    throw createError({
      status: 500,
      message: '稽核紀錄寫入失敗',
      why: '業務異動必須與 audit row 同步落地，不能只完成其中之一',
      fix: '檢查 audit_logs RLS、trigger、hash advisory lock 與 service_role 設定',
      cause: error,
    })
  }

  const result = { auditEventId: data.event_id, hash: data.hash }

  // O1 overlay: 把 DB canonical hash chain 寫進 wide event，讓 signed() drain 階段
  // 簽名同一筆 hash + prev_hash，後續 audit chain diff cron 可比對 DB hash 與 evlog signed hash。
  // 沒套 O1 的 consumer 不會讀這塊 field，純記錄無副作用。
  log.set?.({
    audit: {
      eventId: data.event_id,
      dbChain: { auditLogsPrevHash: data.prev_hash, auditLogsHash: data.hash },
    },
  })

  try {
    log.audit?.({
      action: input.action,
      actor: input.actorId ? { id: input.actorId } : undefined,
      target: { type: input.targetType, id: input.targetId },
      outcome: input.outcome,
      reason: input.reason,
      businessKeys: input.businessKeys ?? {},
      auditEventId: result.auditEventId,
    })
  } catch (auditError) {
    log.set({
      warning: 'audit evlog derived stream failed',
      auditError: auditError instanceof Error ? auditError.message : String(auditError),
      auditEventId: result.auditEventId,
    })
  }

  return result
}

/**
 * 寫入拒絕操作 audit row。
 *
 * Contract:
 * - auth / role / policy deny 路徑必須呼叫此函式。
 * - `reason` 應描述拒絕原因，例如 `missing_required_role` 或 `policy_denied`。
 */
export function auditDeny(
  event: H3Event,
  input: Omit<AuditInput, 'outcome'>
): Promise<AuditResult> {
  return audit(event, { ...input, outcome: 'denied' })
}

/**
 * 依序寫入同一批 audit rows，避免平行 insert 破壞 hash chain。
 *
 * Contract:
 * - 每筆 row 會共用同一個 `spanId`，方便後續追蹤同批操作。
 * - 不做 `Promise.all()`；per-tenant chain 需要穩定順序。
 */
export async function auditBulk(event: H3Event, inputs: AuditInput[]): Promise<AuditResult[]> {
  const spanId = crypto.randomUUID()
  const results: AuditResult[] = []

  for (const input of inputs) {
    results.push(await audit(event, { ...input, spanId: input.spanId ?? spanId }))
  }

  return results
}
