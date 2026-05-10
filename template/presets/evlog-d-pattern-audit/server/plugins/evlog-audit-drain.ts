/**
 * 🔒 LOCKED — managed by clade sync-evlog-presets.mjs
 * preset: evlog-d-pattern-audit
 * source: vendor/snippets/audit-pattern/drain.ts
 * to: presets/evlog-d-pattern-audit/server/plugins/evlog-audit-drain.ts
 * do not edit consumer-side; modify clade vendor snippet then re-propagate
 */
/**
 * D-pattern evlog drain template — audit stream is derived from DB canonical rows
 *
 * Source: clade docs/d-pattern-master-plan.md §5
 *
 * 使用：
 *   cp vendor/snippets/audit-pattern/drain.ts server/plugins/evlog-drain.ts
 *
 * 注意：
 * - dev fs drain 只餵 analyze-logs / review-logging-patterns，不是 durable journal
 * - production audit stream 必須用 `auditOnly()` 繞過 sampling
 * - `auditEnricher()` 可注入短 TTL PII envelope；PII 不進 DB audit row
 * - Workers 上的 `node:fs` VFS 不是 durable journal；prod drain reliability 由 Postgres outbox dispatcher
 *   統一保證（claim_audit_outbox_batch + FOR UPDATE SKIP LOCKED + idempotent mark），這個 fs drain
 *   只是 helper 在 request 內 emit 的 derived stream 落地點，不是 reliability source。詳見 master plan §6
 */

import type { DrainContext } from 'evlog'
import { auditEnricher, auditOnly } from 'evlog'
import { createFsDrain } from 'evlog/fs'
import { createDrainPipeline } from 'evlog/pipeline'

export default defineNitroPlugin((nitroApp) => {
  const fsDrain = createFsDrain({ dir: '.evlog/audit' })
  const pipeline = createDrainPipeline<DrainContext>()

  const bufferedAuditDrain = pipeline(async (ctx) => {
    console.info('[evlog:audit]', JSON.stringify(ctx.event.audit ?? ctx.event))
    await fsDrain(ctx)
  })
  const auditDrain = auditOnly(bufferedAuditDrain, { await: false })

  nitroApp.hooks.hook('evlog:enrich', auditEnricher())
  nitroApp.hooks.hook('evlog:drain', auditDrain)
  nitroApp.hooks.hook('close', () => bufferedAuditDrain.flush())
})

/**
 * Production reference: Sentry
 *
 * import type { DrainContext } from 'evlog'
 * import { auditEnricher, auditOnly } from 'evlog'
 * import { createDrainPipeline } from 'evlog/pipeline'
 * import { createSentryDrain } from 'evlog/sentry'
 *
 * export default defineNitroPlugin((nitroApp) => {
 *   const pipeline = createDrainPipeline<DrainContext>()
 *   const sentryAuditDrain = pipeline(createSentryDrain({ dsn: process.env.SENTRY_DSN }))
 *
 *   nitroApp.hooks.hook('evlog:enrich', auditEnricher())
 *   nitroApp.hooks.hook('evlog:drain', auditOnly(sentryAuditDrain, { await: false }))
 *   nitroApp.hooks.hook('close', () => sentryAuditDrain.flush())
 * })
 */

/**
 * Production reference: Axiom
 *
 * import { createAxiomDrain } from 'evlog/axiom'
 *
 * createAxiomDrain({
 *   token: process.env.AXIOM_TOKEN,
 *   dataset: process.env.AXIOM_AUDIT_DATASET ?? 'audit-events',
 * })
 */

/**
 * Production reference: OTLP
 *
 * import { createOTLPDrain } from 'evlog/otlp'
 *
 * createOTLPDrain({
 *   url: process.env.OTLP_AUDIT_URL,
 *   headers: { authorization: `Bearer ${process.env.OTLP_AUDIT_TOKEN}` },
 * })
 */
