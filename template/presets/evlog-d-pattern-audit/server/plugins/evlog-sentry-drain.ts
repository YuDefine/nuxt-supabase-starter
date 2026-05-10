/**
 * 🔒 LOCKED — managed by clade sync-evlog-presets.mjs
 * preset: evlog-d-pattern-audit
 * source: vendor/snippets/evlog-sentry-drain/drain.ts
 * to: presets/evlog-d-pattern-audit/server/plugins/evlog-sentry-drain.ts
 * do not edit consumer-side; modify clade vendor snippet then re-propagate
 */
/**
 * evlog Sentry drain template — wide events ship to Sentry Structured Logs
 *
 * Source: clade docs/evlog-master-plan.md § 3 (drain decision tree) + § 7 (Workers)
 *
 * 使用：
 *   cp vendor/snippets/evlog-sentry-drain/drain.ts server/plugins/evlog-drain.ts
 *
 * 與 evlog-drain-pipeline/ 的關係：
 * - 本檔是「Sentry SaaS」這個 sink 的 wiring 範本
 * - 真正的 batch / retry / overflow 處理在 createDrainPipeline（見 evlog-drain-pipeline）
 * - 5/5 clade consumer baseline = 此 wiring + drain-pipeline
 *
 * Sentry 端可看到：
 * - Explore → Logs：wide event 顯示為 Structured Log
 * - Issues：log.error 自動產生 issue（依 Sentry 規則）
 * - Performance：trace_id / span_id 串連（透過 traceContextEnricher）
 *
 * 注意：
 * - DSN priority：override > runtimeConfig.evlog.sentry > runtimeConfig.sentry > env vars
 *   不要在程式碼內 hardcode DSN
 * - 高量 consumer 必加 `samplingPolicy`（見 nuxt.config.ts 範例）
 * - production 必開 `redact: true`（NitroModuleOptions）保護 PII
 */

import { consola } from 'consola'
import { createDrainPipeline } from 'evlog/pipeline'
import { createSentryDrain } from 'evlog/sentry'

import type { DrainContext } from 'evlog'

const logger = consola.withTag('evlog-sentry-drain')

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig()
  const dsn =
    (config.evlog as { sentry?: { dsn?: string } } | undefined)?.sentry?.dsn ||
    process.env.NUXT_SENTRY_DSN ||
    process.env.SENTRY_DSN ||
    process.env.NUXT_PUBLIC_SENTRY_DSN

  if (!dsn) {
    logger.warn('SENTRY_DSN missing — evlog Sentry drain disabled')
    return
  }

  const pipeline = createDrainPipeline<DrainContext>({
    batch: { size: 50, intervalMs: 5000 },
    retry: {
      maxAttempts: 3,
      backoff: 'exponential',
      initialDelayMs: 1000,
      maxDelayMs: 30_000,
    },
    maxBufferSize: 1000,
    onDropped: (events, error) => {
      const reason = error ? 'retry_exhausted' : 'buffer_overflow'
      logger.error(
        `Dropped ${events.length} events (${reason})`,
        error ? { error: error.message } : {}
      )
    },
  })

  // createSentryDrain() 零參數呼叫即可：DSN / environment / release 都從 runtime config 自動讀
  // 顯式參數只在需要 override 時用（例：multi-tenant 路由不同 DSN）
  const drain = pipeline(createSentryDrain({ dsn }))

  nitroApp.hooks.hook('evlog:drain', drain)
  nitroApp.hooks.hook('close', () => drain.flush())

  // Cloudflare Workers per-request flush
  nitroApp.hooks.hook('request', (event) => {
    const waitUntil = event.context.cloudflare?.context?.waitUntil
    if (typeof waitUntil === 'function') {
      waitUntil(drain.flush())
    }
  })
})

/**
 * Override 範例（只在預設不夠時用）
 *
 * createSentryDrain({
 *   dsn,
 *   environment: 'staging',  // override useRuntimeConfig().evlog.environment
 *   release: 'v1.2.3',       // override package.json version
 *   tags: { service: 'api', region: 'asia-east1' },
 *   timeout: 8000,           // 預設 5000ms；高延遲區域可調
 *   retries: 2,              // Sentry SDK 內部 retry（額外於 pipeline retry 之上）
 * })
 */

/**
 * 多 DSN 情境（例：audit event 用獨立 Sentry project）
 *
 * import { auditOnly } from 'evlog'
 *
 * const mainDrain = pipeline(createSentryDrain({ dsn: process.env.SENTRY_DSN }))
 * const auditDrain = auditOnly(
 *   auditPipeline(createSentryDrain({ dsn: process.env.SENTRY_AUDIT_DSN })),
 * )
 *
 * nitroApp.hooks.hook('evlog:drain', mainDrain)
 * nitroApp.hooks.hook('evlog:drain', auditDrain)
 */
