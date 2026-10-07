---
description: evlog server plugin wiring 全文（drain pipeline 強制包覆、Cloudflare Workers afterResponse flush／waitUntil、三條 meta-event、Enricher stack 5 件套）；常駐 pointer 在 [[logging]]，觸發時機是「動 server/plugins 的 evlog drain / enricher wiring 之前」，由 [[logging]] 的 MUST-Read 指針叫醒
paths:
  - 'server/plugins/evlog-*.ts'
  - 'packages/**/server/plugins/evlog-*.ts'
  - 'nuxt.config.ts'
  - 'packages/**/nuxt.config.ts'
---
<!-- Clade native rule; source: rules/modules/capabilities/evlog/logging.drain-pipeline.md; edit canonical source -->
<!-- clade-targets: claude,codex -->

# Logging — Drain pipeline 與 enricher（全文）

> 本檔是 [[logging]] 的下推全文之一。本檔管 `server/plugins/evlog-*` 的 wiring：drain pipeline、Workers flush、meta-event、enricher stack。

## Drain pipeline 規範

**MUST**：所有自家 drain 都必須走 `createDrainPipeline(opts)(drain)`，**禁止** raw drain 直接 ship event。T3 NuxtHub stack 例外：`@evlog/nuxthub` module 自動 wire drain，consumer code 不需要直接出現 `createDrainPipeline`。

```ts
// server/plugins/evlog-drain.ts
import { createDrainPipeline } from 'evlog/pipeline'
import { createSentryDrain } from 'evlog/sentry'

const pipeline = createDrainPipeline({
  batch: { size: 50, intervalMs: 1000 },
  retry: { maxAttempts: 3, backoff: 'exponential', initialDelayMs: 200, maxDelayMs: 3000 },
  maxBufferSize: 1_000_000,
  onDropped: (events, reason) => {
    // evlog-exempt: drain failure fallback must not recurse through evlog itself
    console.error('[evlog drain pipeline dropped]', reason, events.length)
  },
})

const drain = pipeline(createSentryDrain({ dsn: process.env.SENTRY_DSN }))

// 反模式：raw drain 直接 ship event
const rawDrain = createSentryDrain({ dsn: process.env.SENTRY_DSN })
```

### 為什麼強制 pipeline

- Workers 50 subrequest budget — 沒 batch 一次 request 50 個 event 就用光
- Sentry / Axiom 限速會 429 — 沒 retry = drop = wide event 信號斷
- pipeline 失敗本身要可觀測 — 否則只看到「event 怎麼少了」沒線索

### Cloudflare Workers flush

Nuxt drain 以 `nitroApp.hooks.hook('evlog:drain', drain)` 註冊；Cloudflare Workers consumer **MUST** 另在 `afterResponse` hook 把 `drain.flush()` 掛到 platform `waitUntil`，否則 worker 回收時 in-memory batch 可能被丟掉。

```ts
nitroApp.hooks.hook('evlog:drain', drain)
nitroApp.hooks.hook('close', () => drain.flush())

// 用 afterResponse 而非 request：current request 的 wide event 在 afterResponse
// 才由 evlog emit 進 buffer。在 request 時 flush 只會處理先前殘留 batch、漏掉
// 當前 event；低流量場景 worker 回收前不會再有 request 觸發下一次 flush。
nitroApp.hooks.hook('afterResponse', (event) => {
  const ctx = event.context.cloudflare?.context
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(drain.flush())
  }
})
```

**禁止**把 `waitUntil` 從 `ExecutionContext` 解下來裸呼（`const waitUntil = ctx.waitUntil` 再 `waitUntil(promise)`）——真 Workers 會 `TypeError: Illegal invocation`；dev nitro shim 已 bind 所以不會浮現。若必須存成變數，用 `ctx.waitUntil.bind(ctx)`，或 `import { waitUntil } from 'cloudflare:workers'`。

**禁止**改回 `request` hook + `waitUntil(drain.flush())` pattern — `request` hook 早於該次 request 的 wide event 被 evlog emit 進 buffer（evlog 在 `afterResponse` 才 emit），低流量 Workers 環境下會永久遺失當前 event。

### 三條 meta-event 必接

drain pipeline emit 以下 meta-event，consumer **MUST** 接這三個並 ship 到 Sentry meta-channel：

| Event | 觸發 | 處理 |
| --- | --- | --- |
| `pipeline.overflow` | batch 滿 + onOverflow 啟動 | warn channel；> 10/min 必告警 |
| `pipeline.retry_exhausted` | retry 用光仍失敗 | error channel；ship 到自家 `evlog_dropped` 留底 |
| `pipeline.memory_warning` | batch buffer >1MB | warn channel；review batch size |

review 抓 `createSentryDrain\(` 同檔沒有 `createDrainPipeline` 包覆 → 🟠 Major。

## Enricher stack 標準（5 件套）

**每一個** consumer 必裝 enricher（順序重要）：

```ts
// server/plugins/evlog-enrich.ts
import {
  createGeoEnricher,
  createRequestSizeEnricher,
  createTraceContextEnricher,
  createUserAgentEnricher,
} from 'evlog/enrichers'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:enrich', createUserAgentEnricher())
  nitroApp.hooks.hook('evlog:enrich', createRequestSizeEnricher())
  nitroApp.hooks.hook('evlog:enrich', createGeoEnricher())
  nitroApp.hooks.hook('evlog:enrich', createTraceContextEnricher())

  // H3 event only exists in request hook; write to the same wide event.
  nitroApp.hooks.hook('request', cfGeoEnricher)
  nitroApp.hooks.hook('request', tenantEnricher)
})
```

| Enricher | 加什麼欄位 |
| --- | --- |
| `createUserAgentEnricher()` | `event.userAgent.{raw,browser,os,device}` |
| `createRequestSizeEnricher()` | `event.requestSize.{requestBytes,responseBytes}` |
| `createGeoEnricher()` | `event.geo.country`（從 header 抽） |
| `createTraceContextEnricher()` | `event.traceContext` / `event.traceId` / `event.spanId` |
| `cfGeoEnricher` | `event.geo.{region,city,latitude,longitude}`（從 Cloudflare `request.cf` 抽） |
| `tenantEnricher` | `event.tenant.id`（multi-tenant 必裝） |

`EnrichContext` 不暴露 H3 event；要拿 `request.cf` 或 auth middleware 寫入的 tenant context，必須在 `request` hook 透過 `event.context.log.set({...})` 寫入同一筆 wide event。

review 抓 `evlog:enrich` / `request` hook 內缺前 4 個 built-in enricher 或 cf-workers 缺 `cfGeoEnricher` → 🟠 Major。
