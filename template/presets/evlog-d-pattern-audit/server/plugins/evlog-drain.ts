/**
 * 🔒 LOCKED — managed by clade sync-evlog-presets.mjs
 * preset: evlog-d-pattern-audit
 * source: vendor/snippets/evlog-drain-pipeline/pipeline.ts
 * to: presets/evlog-d-pattern-audit/server/plugins/evlog-drain.ts
 * do not edit consumer-side; modify clade vendor snippet then re-propagate
 */
/**
 * evlog drain pipeline template — batch + retry + buffer overflow + Workers-safe
 *
 * Source: clade docs/evlog-master-plan.md § 3.2 + § 7
 *
 * 使用：
 *   cp vendor/snippets/evlog-drain-pipeline/pipeline.ts server/plugins/evlog-drain.ts
 *
 * 為什麼強制 pipeline（rules/core/logging.md「Drain pipeline 規範」）：
 * - Workers `fetch` subrequest 50 個上限 — 沒 batch 一次 request 就把 budget 吃光
 * - Sentry / Axiom 限速會 429 — 沒 retry = drop = wide event 信號斷
 * - pipeline 失敗本身要可觀測 — 否則只看到「event 怎麼少了」沒線索
 *
 * 注意：
 * - Cloudflare Workers `event.waitUntil` **MUST** wire 進 `request:end` hook，否則 worker
 *   結束時 in-memory batch 會被丟掉
 * - `onDropped` callback 是唯一的失敗訊號（buffer overflow + retry exhausted 共用）；
 *   分辨來源用 `error` 參數：有 error = retry exhausted；無 error = buffer overflow
 * - dev `node-server` preset 跑 nitro 時 `waitUntil` 是 noop；只能用 production
 *   `wrangler dev` 驗證 drain flush 真的發生
 */

import { consola } from 'consola'
import { createDrainPipeline } from 'evlog/pipeline'
import { createSentryDrain } from 'evlog/sentry'

import type { DrainContext } from 'evlog'

const logger = consola.withTag('evlog-drain')

export default defineNitroPlugin((nitroApp) => {
  // DSN 透過 Nuxt runtime config 注入；dev / SSR Node 接受 env override
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

  // ── Pipeline configuration ────────────────────────────────────────────
  // 預設值對齊 Workers 50 subrequest budget + 5s flush interval：
  // - batch.size 50 → 一次 fetch 帶 50 events，吃 1 個 subrequest
  // - batch.intervalMs 5000 → 5 秒沒滿 batch 也強制 flush，避免 event 卡太久
  // - retry.maxAttempts 3 + exponential backoff → 對 Sentry 429 / 短暫 502 有彈性
  // - maxBufferSize 1000 → 累積超過 1000 events buffer overflow，drop 最舊
  // - onDropped → 把 drop 事件 ship 到 console + Sentry meta-channel
  const pipeline = createDrainPipeline<DrainContext>({
    batch: {
      size: 50,
      intervalMs: 5000,
    },
    retry: {
      maxAttempts: 3,
      backoff: 'exponential',
      initialDelayMs: 1000,
      maxDelayMs: 30_000,
    },
    maxBufferSize: 1000,
    onDropped: (events, error) => {
      // 區分 overflow vs retry-exhausted（前者無 error，後者有）
      const reason = error ? 'retry_exhausted' : 'buffer_overflow'
      logger.error(
        `Dropped ${events.length} events (${reason})`,
        error ? { error: error.message } : {}
      )
      // 反模式（不要做）：在這裡再 throw / 丟回 evlog 製造遞迴
      // 想要把 drop 也 ship 到 Sentry，建議用 Sentry SDK 直送 captureMessage
      // 不要再走 evlog drain（會無窮迴圈）
    },
  })

  const drain = pipeline(createSentryDrain({ dsn }))

  nitroApp.hooks.hook('evlog:drain', drain)

  // Workers worker shutdown / nitro close 時把 buffered events flush 出去
  nitroApp.hooks.hook('close', () => drain.flush())

  // Workers per-request flush — 用 event.waitUntil 確保 worker 結束前 batch 送出
  // 沒 wire 這個 hook 時：dev mode OK（process 不 die），prod Workers 會丟 batch
  nitroApp.hooks.hook('request', (event) => {
    const waitUntil = event.context.cloudflare?.context?.waitUntil
    if (typeof waitUntil === 'function') {
      // request 結束時推一次（不阻塞 response）
      event.context._evlogFlushPromise = drain.flush()
      waitUntil(event.context._evlogFlushPromise)
    }
  })
})

// Multi-drain composition / sampling 整合範例 — 見 README.md 的「進階用法」章節，
// 不在此檔列 reference comment（避免 audit script 把 example createSentryDrain 當 raw drain
// 觸發 false positive；example 內 `error: 1.0` 也會被 sampling.errorSampled 誤抓）。
