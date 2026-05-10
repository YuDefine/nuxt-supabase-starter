/**
 * 🔒 LOCKED — managed by clade sync-evlog-presets.mjs
 * preset: evlog-d-pattern-audit
 * source: vendor/snippets/evlog-audit-signed/diff-cron.ts
 * to: presets/evlog-d-pattern-audit/server/api/_cron/audit-chain-diff.get.ts
 * do not edit consumer-side; modify clade vendor snippet then re-propagate
 */
/**
 * O1: auditDiff cron — 偵測 audit_logs vs audit_signed_chain drift
 *
 * Source: clade docs/evlog-master-plan.md § 12.4
 *
 * 使用：
 *   cp vendor/snippets/evlog-audit-signed/diff-cron.ts \
 *      packages/core/server/api/_cron/audit-chain-diff.get.ts
 *
 * cron schedule（wrangler.toml 或 vercel.json）：
 *   "0 *​/6 * * *"   # 每 6 小時跑
 *
 * 5 種 drift 種類（migration.sql 的 audit_chain_drift.drift_type CHECK）：
 *   1. evlog_hash_mismatch     — evlog_hash 重算與 stored 不符（secret 換 / payload 漂）
 *   2. evlog_chain_break       — evlog_prev_hash 對不上前一筆 chain head
 *   3. audit_logs_missing      — chain 有 row 但 audit_logs 沒對應 event_id
 *   4. audit_signed_missing    — audit_logs 有 row 但 chain 沒（drain 漏）
 *   5. business_keys_drift     — audit_logs.business_keys 與簽署時的 payload 不一致
 */

import { defineEventHandler } from 'h3'
import { serverSupabaseServiceRole } from '#supabase/server'
// 用 evlog 的 createError（擴充版，接受 why/fix/code）— 不要 import 自 h3（原版只接 statusCode/message/cause，會 type fail）
import { createError, useLogger } from 'evlog'
import { createHmac } from 'node:crypto'

interface AuditLogsRow {
  event_id: string
  tenant_id: string | null
  action: string
  actor_id: string | null
  target_type: string
  target_id: string
  outcome: string
  business_keys: Record<string, unknown> | null
  prev_hash: string | null
  hash: string
  created_at: string
}

interface SignedChainRow {
  event_id: string
  tenant_id: string | null
  evlog_prev_hash: string | null
  evlog_hash: string
  signed_secret_version: number
  signed_at: string
}

export default defineEventHandler(async (event) => {
  // 簡單 cron auth：Cloudflare Workers cron 觸發時 user-agent 是固定值
  // production 必補：自家 cron secret token 驗證
  const ua = event.headers.get('user-agent') ?? ''
  if (!ua.includes('Cloudflare') && !ua.includes('vercel-cron')) {
    throw createError({
      status: 403,
      message: 'cron only',
      why: 'audit chain diff cron 只接受 Cloudflare / Vercel cron header',
      fix: '設定 wrangler.toml triggers.crons 或 vercel.json crons',
      code: 'AUDIT_DIFF_NOT_CRON',
    })
  }

  const log = useLogger(event)
  const client = serverSupabaseServiceRole(event)
  const config = useRuntimeConfig()
  const secret =
    (config.evlog as { auditSecret?: string } | undefined)?.auditSecret ??
    process.env.EVLOG_AUDIT_SECRET
  if (!secret) {
    throw createError({
      status: 500,
      message: 'EVLOG_AUDIT_SECRET 缺失',
      why: 'cron 需要 secret 重算 evlog_hash 對 stored value',
      fix: '設 .env.production EVLOG_AUDIT_SECRET',
      code: 'AUDIT_DIFF_NO_SECRET',
    })
  }

  const drifts: Array<{
    drift_type: string
    event_id: string | null
    expected_hash?: string
    actual_hash?: string
    notes?: Record<string, unknown>
  }> = []

  // ── 1. 取最近 6 小時的 audit_logs + audit_signed_chain（time window 對齊 cron 頻率）──
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()

  const { data: auditLogs } = await client
    .from('audit_logs')
    .select(
      'event_id, tenant_id, action, actor_id, target_type, target_id, outcome, business_keys, prev_hash, hash, created_at'
    )
    .gte('created_at', since)
    .order('created_at', { ascending: true })

  const { data: signedChain } = await client
    .from('audit_signed_chain')
    .select('event_id, tenant_id, evlog_prev_hash, evlog_hash, signed_secret_version, signed_at')
    .gte('signed_at', since)
    .order('signed_at', { ascending: true })

  if (!auditLogs || !signedChain) return { ok: false, reason: 'fetch failed' }

  const signedByEventId = new Map<string, SignedChainRow>(
    signedChain.map((r) => [r.event_id, r as SignedChainRow])
  )
  const auditByEventId = new Map<string, AuditLogsRow>(
    auditLogs.map((r) => [r.event_id, r as AuditLogsRow])
  )

  // ── Drift type 4: audit_signed_missing ──
  for (const a of auditLogs) {
    if (!signedByEventId.has(a.event_id)) {
      drifts.push({
        drift_type: 'audit_signed_missing',
        event_id: a.event_id,
        notes: { tenant_id: a.tenant_id, created_at: a.created_at },
      })
    }
  }

  // ── Drift type 3: audit_logs_missing ──
  for (const s of signedChain) {
    if (!auditByEventId.has(s.event_id)) {
      drifts.push({
        drift_type: 'audit_logs_missing',
        event_id: s.event_id,
        notes: { tenant_id: s.tenant_id, signed_at: s.signed_at },
      })
    }
  }

  // ── Drift type 1: evlog_hash_mismatch — 重算驗證 ──
  for (const s of signedChain) {
    const a = auditByEventId.get(s.event_id)
    if (!a) continue // 已被 type 3 抓到

    const recomputed = computeEvlogHash(secret, a, s.evlog_prev_hash)
    if (recomputed !== s.evlog_hash) {
      drifts.push({
        drift_type: 'evlog_hash_mismatch',
        event_id: s.event_id,
        expected_hash: recomputed,
        actual_hash: s.evlog_hash,
        notes: { secret_version: s.signed_secret_version },
      })
    }
  }

  // ── Drift type 2: evlog_chain_break — 比對 prev_hash 連續性 ──
  // per tenant，依 signed_at 排序逐筆檢查
  const byTenant = new Map<string | null, SignedChainRow[]>()
  for (const s of signedChain) {
    const list = byTenant.get(s.tenant_id) ?? []
    list.push(s)
    byTenant.set(s.tenant_id, list)
  }
  for (const [, tenantChain] of byTenant) {
    let expectedPrev: string | null = null
    for (const s of tenantChain) {
      if (s.evlog_prev_hash !== expectedPrev) {
        drifts.push({
          drift_type: 'evlog_chain_break',
          event_id: s.event_id,
          expected_hash: expectedPrev ?? '(null, chain start)',
          actual_hash: s.evlog_prev_hash ?? '(null)',
        })
      }
      expectedPrev = s.evlog_hash
    }
  }

  // ── 寫入 audit_chain_drift ──
  if (drifts.length > 0) {
    await client.from('audit_chain_drift').insert(drifts)
    log.error(new Error(`audit chain drift detected: ${drifts.length} rows`), {
      audit_chain_drift_count: drifts.length,
      drift_types: [...new Set(drifts.map((d) => d.drift_type))],
    })
  }

  return {
    ok: true,
    audit_logs_checked: auditLogs.length,
    signed_chain_checked: signedChain.length,
    drifts: drifts.length,
  }
})

function computeEvlogHash(secret: string, audit: AuditLogsRow, prevHash: string | null): string {
  const payload = canonicalJSON({
    event_id: audit.event_id,
    action: audit.action,
    actor_id: audit.actor_id,
    target_type: audit.target_type,
    target_id: audit.target_id,
    outcome: audit.outcome,
    business_keys: audit.business_keys,
    audit_logs_prev_hash: audit.prev_hash,
    audit_logs_hash: audit.hash,
    evlog_prev_hash: prevHash,
  })
  return createHmac('sha256', secret).update(payload).digest('hex')
}

// 與 evlog signed() 對齊的 canonical JSON（key 排序）
function canonicalJSON(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) return `[${obj.map(canonicalJSON).join(',')}]`
  const keys = Object.keys(obj as Record<string, unknown>).toSorted()
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJSON((obj as Record<string, unknown>)[k])}`)
    .join(',')}}`
}
