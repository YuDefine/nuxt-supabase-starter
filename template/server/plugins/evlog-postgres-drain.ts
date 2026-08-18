/**
 * evlog Postgres drain — wide events 寫進自家 evlog_events table
 *
 * Source: clade vendor/snippets/evlog-postgres-drain/drain.ts，改用本專案的
 * getServerSupabaseClient()（上游 snippet 走 serverSupabaseServiceRole 並塞假的
 * H3Event；本專案有 module-level service-role singleton，不需要那個繞法）。
 *
 * 為什麼這條是必配、而 Sentry drain 不是（clade rules/core/evlog-adoption.md
 * § Drain 選擇指引）：Supabase stack 的 evlog consumer MUST 有一個 **queryable
 * durable** drain 當事後鑑識的資料源。Sentry 是 alerting / triage 的補充層，
 * 不能查、不留長尾，替代不了這張表。兩條 drain 並存，各司其職。
 *
 * Workers subrequest budget：一次 batch insert = 1 個 subrequest（batch.size 100），
 * 比 Sentry drain 更大更慢，因為 DB 容忍延遲。**NEVER** 從 hot path 直接寫
 * evlog_events——drain 是唯一寫入點。量超過 ~1000 events/s 要改走 outbox 模式。
 *
 * Retention：migration 附的 public.evlog_events_retention(days) 由 cron 以
 * service_role 呼叫；本 plugin 不負責清理。
 */

import { consola } from 'consola'
import { createDrainPipeline } from 'evlog/pipeline'

import type { DrainContext } from 'evlog'

import { getServerSupabaseClient } from '../utils/supabase'

const logger = consola.withTag('evlog-postgres-drain')

export default defineNitroPlugin((nitroApp) => {
  const pipeline = createDrainPipeline<DrainContext>({
    // 比 Sentry drain 大且慢：DB 寫入容忍延遲，換取更少的 subrequest。
    batch: { size: 100, intervalMs: 10_000 },
    retry: {
      maxAttempts: 3,
      backoff: 'exponential',
      initialDelayMs: 2000,
      maxDelayMs: 60_000,
    },
    maxBufferSize: 5000,
    onDropped: (events, error) => {
      // 無 error = buffer overflow；有 error = retry 用光。這是本 drain 唯一的失敗訊號。
      const reason = error ? 'retry_exhausted' : 'buffer_overflow'
      logger.error(`Dropped ${events.length} events to Postgres (${reason})`, error?.message)
      // 反模式：不要在這裡再走 evlog（會遞迴）。
    },
  })

  const drain = pipeline(async (batch: DrainContext[]) => {
    if (batch.length === 0) return

    // service-role 寫入（drain 是系統動作；evlog_events 是 deny-all RLS）
    const client = getServerSupabaseClient()

    const rows = batch.map((ctx) => {
      const event = ctx.event as Record<string, unknown>
      const request = ctx.request as Record<string, unknown> | undefined
      return {
        ts: event.timestamp ?? new Date().toISOString(),
        level: event.level ?? 'info',
        service: event.service ?? null,
        environment: event.environment ?? null,
        method: request?.method ?? event.method ?? null,
        path: request?.path ?? event.path ?? null,
        status: typeof event.status === 'number' ? event.status : null,
        duration_ms: extractDurationMs(event),
        request_id: request?.requestId ?? event.requestId ?? null,
        user_id: (event.user as { id?: string } | undefined)?.id ?? null,
        source: event.source ?? null,
        error_json: event.error ?? null,
        attributes: extractAttributes(event),
      }
    })

    const { error } = await client.from('evlog_events').insert(rows)
    if (error) {
      // throw 交給 pipeline 重試；retry 用光後走 onDropped。
      throw new Error(`evlog_events insert failed: ${error.message}`)
    }
  })

  nitroApp.hooks.hook('evlog:drain', drain)
  nitroApp.hooks.hook('close', () => drain.flush())

  // Workers per-request flush — 用 afterResponse 而非 request：當前 request 的 wide
  // event 要到 afterResponse 才被 evlog emit 進 buffer。掛 request 只會 flush 到前一批，
  // 漏掉當前這筆；低流量時 worker 回收前不會再有 request 來補這次 flush。
  nitroApp.hooks.hook('afterResponse', (event) => {
    const waitUntil = event.context.cloudflare?.context?.waitUntil
    if (typeof waitUntil === 'function') {
      waitUntil(drain.flush())
    }
  })
})

function extractDurationMs(event: Record<string, unknown>): number | null {
  if (typeof event.durationMs === 'number') return event.durationMs
  if (typeof event.duration === 'number') return event.duration
  if (typeof event.duration === 'string') {
    const ms = event.duration.match(/^([0-9.]+)\s*ms$/)
    if (ms) return Math.round(Number.parseFloat(ms[1]))
    const s = event.duration.match(/^([0-9.]+)\s*s$/)
    if (s) return Math.round(Number.parseFloat(s[1]) * 1000)
  }
  return null
}

// 已有專屬欄位的 wide event key；其餘一律收進 attributes JSONB。
// 單租戶 starter 沒有租戶專欄，所以 event 的租戶欄位（若上層有加）會落進 attributes，
// 不會被靜默丟掉。多租戶專案照 clade snippet 原版加回專欄後，記得把它加進本清單。
const INDEXED_FIELDS = new Set([
  'timestamp',
  'level',
  'service',
  'environment',
  'method',
  'path',
  'status',
  'durationMs',
  'duration',
  'requestId',
  'source',
  'error',
  'user',
])

function extractAttributes(event: Record<string, unknown>): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event)) {
    if (!INDEXED_FIELDS.has(key) && value !== undefined) {
      attrs[key] = value
    }
  }
  return attrs
}
