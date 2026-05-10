/**
 * 🔒 LOCKED — managed by clade sync-evlog-presets.mjs
 * preset: evlog-d-pattern-audit
 * source: vendor/snippets/evlog-audit-signed/enricher.ts
 * to: presets/evlog-d-pattern-audit/server/plugins/evlog-audit-enricher.ts
 * do not edit consumer-side; modify clade vendor snippet then re-propagate
 */
/**
 * O1: audit enricher — 把 D-pattern audit_logs row 的 hash chain 帶進 evlog event
 *
 * Source: clade docs/evlog-master-plan.md § 12.2
 *
 * 使用：
 *   cp vendor/snippets/evlog-audit-signed/enricher.ts \
 *      packages/core/server/plugins/evlog-audit-enricher.ts
 *
 * **重大設計修正（M3a-perno wave 4.5）**：
 * 早期版本 dbChainEnricher 在 evlog:enrich 階段透過 `ctx.h3Event` 取 service-role client
 * 並 await DB query — 兩個問題：
 * 1. EnrichContext 不暴露 h3Event（type fail）
 * 2. enricher 不能 await DB query（hot path 拖慢；CLAUDE.md 規則）
 *
 * 正確做法：dbChain hash 已在 `audit()` helper 內 RETURNING 拿到（同 transaction 內 INSERT）；
 * 由 helper / handler 直接 `useLogger(event).set({ audit: { dbChain: { ... } } })` 寫進 wide
 * event。本 plugin 只負責 evlog 內建 `auditEnricher`（bridge auth context → event.audit）。
 */

import { auditEnricher } from 'evlog'
import type { H3Event } from 'h3'

export default defineNitroPlugin((nitroApp) => {
  // ── 1. evlog 內建 auditEnricher — 從 auth session 帶 actor 進 event.audit ───
  // tenantId 從 'request' hook 階段（H3 event 可訪）已寫進 e.context.tenantId 後再給 enricher
  // 之所以走 enricher 而非直接 'request' hook，是因為 evlog 內建 auditEnricher 還會處理
  // bridge auth integration（per-consumer auth provider 的 user/tenant resolution）
  nitroApp.hooks.hook(
    'evlog:enrich',
    auditEnricher({
      // 注意：evlog 內建 auditEnricher options 不接 ctx.h3Event；tenantId 必須由 audit()
      // helper 在 INSERT audit_logs 時就一起 set 進 wide event：
      //   useLogger(event).set({ audit: { tenantId: ... } })
      // 此處留空（或對齊 perno auth context 的 read 邏輯）
    })
  )

  // ── 2. dbChainEnricher 已被 audit() helper 直接 set 取代（見上方 design 註解）─
  // **不要**重新加 nitroApp.hooks.hook('evlog:enrich', dbChainEnricher) — enricher 不能 await DB
})

/**
 * 反模式（M3a-perno wave 4.5 確認不可）：
 *
 * function dbChainEnricher() {
 *   return async (ctx: EnrichContext) => {
 *     const client = serverSupabaseServiceRole(ctx.h3Event) // ❌ ctx.h3Event 不存在
 *     const { data } = await client.from('audit_logs').select(...)  // ❌ enricher 內 await DB
 *   }
 * }
 *
 * 正確做法（在 audit() helper / handler 內）：
 *
 * export async function audit(event: H3Event, input: AuditInput) {
 *   const client = serverSupabaseServiceRole(event)
 *   const { data, error } = await client.from('audit_logs').insert({ ... })
 *     .select('event_id, prev_hash, hash')
 *     .single()
 *   if (error) throw createError({ ... })
 *   // 直接 set 進 wide event；signed() drain 階段就能讀到
 *   useLogger(event).set({
 *     audit: {
 *       eventId: data.event_id,
 *       dbChain: { auditLogsPrevHash: data.prev_hash, auditLogsHash: data.hash },
 *     },
 *   })
 *   return { auditEventId: data.event_id, hash: data.hash }
 * }
 */

/**
 * tenantId enricher（multi-tenant consumer 必加）— 用 'request' hook 階段
 *
 * import type { H3Event } from 'h3'
 *
 * nitroApp.hooks.hook('request', (event: H3Event) => {
 *   const tenantId = (event.context as { tenantId?: string }).tenantId
 *   const log = (event.context as { log?: { set: (f: Record<string, unknown>) => void } }).log
 *   if (!tenantId || !log) return
 *   log.set({ audit: { tenantId } })
 * })
 *
 * 注意：tenantId 由 auth middleware 寫進 e.context.tenantId；本 hook 必須在 auth 之後跑。
 */

// 標記未用 import（避免 lint）— H3Event 留作上方註解 reference
export type _AuditH3 = H3Event
