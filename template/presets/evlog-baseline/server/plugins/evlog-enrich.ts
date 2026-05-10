/**
 * 🔒 LOCKED — managed by clade sync-evlog-presets.mjs
 * preset: evlog-baseline
 * source: vendor/snippets/evlog-enrichers-stack/enrichers.ts
 * to: presets/evlog-baseline/server/plugins/evlog-enrich.ts
 * do not edit consumer-side; modify clade vendor snippet then re-propagate
 */
/**
 * evlog enricher stack template — wide event 上下文欄位 5 件套
 *
 * Source: clade docs/evlog-master-plan.md § 4 (post-M3a-TDMS wave 3 重設計)
 *
 * 使用：
 *   cp vendor/snippets/evlog-enrichers-stack/enrichers.ts \
 *      server/plugins/evlog-enrich.ts
 *
 * 兩段設計（不同 hook 階段）：
 * - **evlog:enrich 階段** — 4 件 evlog built-in enricher（UA / RequestSize / Geo / TraceContext）
 *   只能讀 `EnrichContext` (event, request, headers, response)，**不**暴露 H3 event。
 *   `createGeoEnricher` 因此只能從 `cf-ipcountry` HTTP header 抽 country。
 * - **`request` hook 階段** — 自家 cfGeoEnricher / tenantEnricher
 *   有完整 H3 event access，可讀 `event.context.cloudflare.request.cf` 物件補完
 *   region / city / lat / lng；可從 `event.context.tenantId` 取 multi-tenant id。
 *   寫法：透過 `event.context.log.set({...})` 把欄位寫進 wide event（evlog 已在
 *   request hook 第一步 attach `e.context.log`）。
 *
 * 順序：built-in evlog:enrich (UA, RequestSize, Geo, TraceContext)
 *      → 'request' hook (cfGeoEnricher, tenantEnricher)
 *      tenantEnricher 必在 auth middleware **之後** 才能讀到 tenantId
 */

import {
  createGeoEnricher,
  createRequestSizeEnricher,
  createTraceContextEnricher,
  createUserAgentEnricher,
} from 'evlog/enrichers'

import type { H3Event } from 'h3'

export default defineNitroPlugin((nitroApp) => {
  // ── evlog:enrich 階段：4 件 built-in（順序固定，不要改）────────────
  // createDefaultEnrichers() 會一次套全部，但個別套法給日後想加 tracing
  // sampling / per-route enable 留彈性
  nitroApp.hooks.hook('evlog:enrich', createUserAgentEnricher())
  nitroApp.hooks.hook('evlog:enrich', createRequestSizeEnricher())

  // createGeoEnricher 在 Workers 上只抓得到 cf-ipcountry header；其他 region /
  // city / lat / lng 在 request.cf 物件，由下方 cfGeoEnricher 在 'request' hook
  // 階段透過 H3 event 拿並寫進 wide event。
  nitroApp.hooks.hook('evlog:enrich', createGeoEnricher())

  nitroApp.hooks.hook('evlog:enrich', createTraceContextEnricher())

  // ── 'request' hook 階段：cfGeoEnricher / tenantEnricher（自家補強）───
  // evlog plugin 已在 request hook 第一步 attach e.context.log；後跑的 hook
  // 可呼叫 e.context.log.set({...}) 把欄位寫進 wide event。
  nitroApp.hooks.hook('request', cfGeoEnricher)

  // tenant enricher（multi-tenant 必裝；single-tenant 可註解）
  // 必在 auth middleware **之後**，才能讀到 e.context.tenantId
  // nitroApp.hooks.hook('request', tenantEnricher)

  // ── audit forceKeep（evlog 2.16 無內建，必由 consumer wire 此 hook）──
  // sampling.keep[{kind: 'audit'}] type 不接（TailSamplingCondition 只接
  // status/duration/path），故走 'evlog:emit:keep' Nitro hook：對 audit-class
  // event mutate ctx.shouldKeep = true。
  // 詳見 master plan § 14「audit forceKeep wiring」row（M3a-yuntech wave 5）。
  // 影響：sampling.rates.info < 100 時，audit-class events 仍 100% keep；
  // 不 wire 此 hook = audit event 走一般 sampling rate（會被 drop）。
  nitroApp.hooks.hook('evlog:emit:keep', (ctx) => {
    const kind = (ctx.context as { kind?: string }).kind
    if (kind === 'audit') ctx.shouldKeep = true
  })
})

// ────────────────────────────────────────────────────────────────────────
// Cloudflare extras: cf-region / cf-city / cf-latitude / cf-longitude
// 來源：request.cf 屬性（非 HTTP headers）；只在 Cloudflare Workers 環境有
// ────────────────────────────────────────────────────────────────────────
function cfGeoEnricher(event: H3Event) {
  const cf = (event.context.cloudflare?.request as { cf?: Record<string, unknown> } | undefined)?.cf
  if (!cf) return

  const requestLog = (event.context as { log?: { set: (fields: Record<string, unknown>) => void } })
    .log
  if (!requestLog || typeof requestLog.set !== 'function') return

  requestLog.set({
    geo: {
      region: typeof cf.region === 'string' ? cf.region : undefined,
      regionCode: typeof cf.regionCode === 'string' ? cf.regionCode : undefined,
      city: typeof cf.city === 'string' ? cf.city : undefined,
      latitude: typeof cf.latitude === 'string' ? Number(cf.latitude) : undefined,
      longitude: typeof cf.longitude === 'string' ? Number(cf.longitude) : undefined,
    },
  })
}

// ────────────────────────────────────────────────────────────────────────
// Tenant enricher: 從 H3 context 取 tenantId 寫進 wide event
// resolve 部分由 consumer 客製：把 e.context.tenantId 的設定寫在 auth middleware
// （`requireAuth` / `requireRole` 等 helper 內）— 這裡只負責 read + log.set
// ────────────────────────────────────────────────────────────────────────
// function tenantEnricher(event: H3Event) {
//   const tenantId = (event.context as { tenantId?: string }).tenantId
//   if (!tenantId) return
//   const requestLog = (
//     event.context as { log?: { set: (fields: Record<string, unknown>) => void } }
//   ).log
//   if (!requestLog || typeof requestLog.set !== 'function') return
//   requestLog.set({ tenant: { id: tenantId } })
// }
