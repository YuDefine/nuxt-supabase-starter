/**
 * 🔒 LOCKED — managed by clade sync-evlog-presets.mjs
 * preset: evlog-d-pattern-audit
 * source: vendor/snippets/evlog-audit-signed/drain.ts
 * to: presets/evlog-d-pattern-audit/server/plugins/evlog-audit-signed.ts
 * do not edit consumer-side; modify clade vendor snippet then re-propagate
 */
/**
 * O1: evlog audit signed drain — auditOnly + signed (HMAC) → audit_signed_chain
 *
 * Source: clade docs/evlog-master-plan.md § 12.2 + § 12.3
 *
 * 使用：
 *   1. 跑 migration.sql 建 audit_signed_chain + audit_chain_drift table
 *   2. cp vendor/snippets/evlog-audit-signed/drain.ts \
 *         packages/core/server/plugins/evlog-audit-signed.ts
 *   3. cp enricher.ts ... server/plugins/evlog-audit-enricher.ts
 *
 * 關鍵設計（lock 13）：
 * - 用 evlog signed() HMAC 模式，不用內建 hash-chain（chain 邏輯由 drain 寫死）
 * - chain head per tenant — `audit_signed_chain_head()` SQL function 取上一筆 evlog_hash
 * - secret 與 audit_logs.hash 的 secret 完全獨立（rotation 不影響 D-pattern canonical）
 *
 * 與既有 D-pattern 的疊加：
 * - 此 drain 只處理 audit event；business event 走主 evlog-drain.ts pipeline
 * - audit_logs row 是 source-of-truth；本 drain 失敗只是 monitoring miss，不影響業務
 */

import { consola } from 'consola'
import { auditOnly, signed } from 'evlog'
import { createDrainPipeline } from 'evlog/pipeline'
import { serverSupabaseServiceRole } from '#supabase/server'

import type { DrainContext } from 'evlog'

const logger = consola.withTag('evlog-audit-signed')

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig()
  const evlogConfig = config.evlog as
    | { auditSecret?: string; auditSecretVersion?: number }
    | undefined
  const secret = evlogConfig?.auditSecret ?? process.env.EVLOG_AUDIT_SECRET
  const secretVersion = evlogConfig?.auditSecretVersion ?? 1

  if (!secret) {
    logger.error('EVLOG_AUDIT_SECRET missing — audit signed drain disabled')
    return
  }

  // ── 1. signed() — HMAC 對每筆 audit event 簽 evlog_hash ───────────────
  // 注意：用 'hmac' 模式而非 'hash-chain'，chain 邏輯由本檔 drain 自管理
  // （hash-chain 模式單一 global state，不支援 per-tenant chain）

  // ── 2. pipeline + writer — 把 signed event 寫進 audit_signed_chain ─────
  const pipeline = createDrainPipeline<DrainContext>({
    batch: { size: 20, intervalMs: 2000 }, // audit 量小但要快（chain integrity）
    retry: {
      maxAttempts: 5, // 比一般 drain 多一輪 — audit drop 風險高
      backoff: 'exponential',
      initialDelayMs: 500,
      maxDelayMs: 30_000,
    },
    maxBufferSize: 200,
    onDropped: (events, error) => {
      // **AUDIT DROPPED 是 chain integrity 風險** — 必 alert oncall
      logger.error(`AUDIT DROPPED ${events.length} events — chain integrity at risk`, error)
      // production 必補：Sentry captureMessage 直送（不走 evlog drain 避免遞迴）
    },
  })

  const auditWriter = pipeline(async (batch: DrainContext[]) => {
    if (batch.length === 0) return

    // serverSupabaseServiceRole 預設要 H3 event 拿 cookie / runtime config；drain 階段沒 H3 event。
    // 這裡傳 empty object hack — 對 service-role client 而言只要 SUPABASE_URL / service-role key
    // 從 env 拿即可。Consumer 若有自家 singleton（如 perno 的 useServiceClient()）建議改用，更乾淨。
    const client = serverSupabaseServiceRole(
      {} as unknown as Parameters<typeof serverSupabaseServiceRole>[0]
    )

    // 依 tenant 分組（不同 tenant chain 互不影響）
    const byTenant = new Map<string | null, DrainContext[]>()
    for (const ctx of batch) {
      const tenantId =
        (ctx.event as { audit?: { context?: { tenantId?: string } } }).audit?.context?.tenantId ??
        null
      const list = byTenant.get(tenantId) ?? []
      list.push(ctx)
      byTenant.set(tenantId, list)
    }

    // 每 tenant 串成一條 chain（按 event 順序）
    for (const [tenantId, tenantBatch] of byTenant) {
      // 取此 tenant 上一筆 chain head
      const { data: headResult, error: headError } = await client.rpc('audit_signed_chain_head', {
        p_tenant_id: tenantId,
      })
      if (headError) {
        throw new Error(`fetch chain head failed: ${headError.message}`)
      }
      let prevHash: string | null = (headResult as string | null) ?? null

      const rows: Array<Record<string, unknown>> = []
      for (const ctx of tenantBatch) {
        const event = ctx.event as Record<string, unknown>
        const audit = event.audit as Record<string, unknown> | undefined
        if (!audit) continue // 不是 audit event；安全跳過（理論上 auditOnly 已 filter）

        const eventId = (audit.eventId ?? event.eventId) as string | undefined
        if (!eventId) {
          logger.warn('audit event without auditEventId — skipped chain row')
          continue
        }

        // event.audit.signature 由 signed({ strategy: 'hmac' }) 計算（在 drain 進來前）
        // 注意：evlog HMAC 模式把簽章寫到 event.audit.signature（見 evlog source
        // node_modules/evlog/dist/audit-*.mjs L1471-1485），**不**是 event.signed.hash
        // master plan § 14 校正：「signed() 寫到 event.signed.hash」是早期文件臆測
        const evlogHash = (audit.signature ?? undefined) as string | undefined
        if (!evlogHash) {
          logger.warn(`audit event ${eventId} missing audit.signature`)
          continue
        }

        rows.push({
          event_id: eventId,
          tenant_id: tenantId,
          evlog_prev_hash: prevHash,
          evlog_hash: evlogHash,
          signed_secret_version: secretVersion,
        })

        prevHash = evlogHash // 下一筆的 prev_hash 是這筆的 hash
      }

      if (rows.length === 0) continue

      const { error: insertError } = await client.from('audit_signed_chain').insert(rows)
      if (insertError) {
        throw new Error(`audit_signed_chain insert failed: ${insertError.message}`)
      }
    }
  })

  // ── 3. signed wrapper + auditOnly filter — 組合順序：signed → auditOnly ──
  // 寫 evlog_hash 到 event.signed.hash，然後 auditOnly 過濾只送 audit event
  const signedAuditDrain = signed(auditWriter, {
    strategy: 'hmac',
    secret,
    algorithm: 'sha256',
  })

  nitroApp.hooks.hook(
    'evlog:drain',
    auditOnly(signedAuditDrain, { await: true }) // await: true → audit 必落盤後才 release request
  )

  nitroApp.hooks.hook('close', () => auditWriter.flush())
  nitroApp.hooks.hook('request', (event) => {
    const waitUntil = event.context.cloudflare?.context?.waitUntil
    if (typeof waitUntil === 'function') {
      waitUntil(auditWriter.flush())
    }
  })
})

/**
 * Secret rotation 期間（過渡）的策略
 *
 * rotation transition window 內可能：
 *   1. 部分 server instance 還在用舊 secret signing
 *   2. 部分用新 secret
 *
 * 解法：每次 rotation 把 secretVersion 遞增；diff cron 用版本號判斷該用哪個
 * secret 重算驗證。詳見 rotation-runbook.md
 */
