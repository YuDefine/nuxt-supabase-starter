<!--
🔒 LOCKED — managed by clade
Source: rules/core/evlog-stream-extend.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

# evlog Extend 標準（讀端 + 進階 hook）

> Reference：<https://www.evlog.dev/extend/stream> / <https://www.evlog.dev/extend/fs-reader> / <https://www.evlog.dev/extend/consumer-recipes> / <https://www.evlog.dev/extend/custom-enrichers> / <https://www.evlog.dev/extend/tail-sampling>
>
> 寫端（drain / head sampling / redaction）→ 見 `rules/core/evlog-adoption.md` / `rules/core/logging.md`
>
> Catalogs（typed error code / audit action）→ 見 `rules/core/evlog-adoption.md` § Catalogs
>
> 本 rule 涵蓋的 /extend/* 章節：`stream` / `fs-reader` / `consumer-recipes` / `custom-enrichers` / `tail-sampling`。其餘（`plugins` / `identity-headers` / `custom-framework` / `custom-drains`）：5 consumer 全 Nuxt + 用既有 Sentry/Postgres drain，無實際 use case，未納入標準（need-driven 再補）。

## 何時用

evlog 預設只「寫」wide event 出去（FS / Sentry / Postgres / 自家 drain）。/extend/ 章節提供「讀端」API，讓 consumer 端可以：

- **內部 devtool**：dev / staging 環境即時看 wide event stream（類 Sentry breadcrumbs 但 local）
- **客服 / debug**：對單一 user / request 重放歷史 event chain，定位錯誤
- **自家 dashboard**：把 evlog event drill-down 嵌進 admin 頁
- **CLI replay**：對 `.evlog/logs/*.jsonl` 跑歷史分析 / regression 驗

如果 consumer 只有「寫到 Sentry / Postgres」需求，**不需要**動讀端 — 寫端 drain 已經夠。讀端 API 是 opt-in 進階擴充，不是預設標準。

## 三條 API surface

### 1. `createStreamDrain()` — in-process pub/sub

From `evlog/stream`。本地建立 ring buffer + subscribe 機制，把 wide event 留在 process 內、不出 process。

```ts
import { createStreamDrain } from 'evlog/stream'

const stream = createStreamDrain({
  buffer: 500,              // ring buffer 大小，預設 500
  perSubscriberQueue: 1000, // async iterator 佇列上限，預設 1000
  filter: (e) => e.level === 'error',
})

stream.drain(events)         // accept single / batch
const unsub = stream.subscribe((e) => console.log(e))
for await (const e of stream.events()) { /* ... */ }
const snapshot = stream.recent()  // oldest → newest
```

### 2. `startStreamServer()` — network bridge（SSE）

From `evlog/stream`。起本地 HTTP server，用 Server-Sent Events 把 stream 暴露給外部消費者（browser devtool / curl / 自家 dashboard）。

```ts
import { startStreamServer } from 'evlog/stream'

const { drain } = await startStreamServer({
  port: 4444,               // 不給就 auto-select
  host: '127.0.0.1',        // 預設 127.0.0.1
  token: process.env.EVLOG_STREAM_TOKEN,
  heartbeatMs: 15000,
  buffer: 500,
})
```

**SSE envelope**：`{ evlog: '1', type, data }`

| type | data shape |
| --- | --- |
| `hello` | `{ evlogVersion, bufferSize, heartbeatMs }` |
| `event` | `WideEvent` |
| `replay` | `WideEvent`（client 給 `?since=<iso>` 時觸發） |
| `ping` | `{ ts: number }` |

**Discovery**：`.evlog/stream.url` 檔（CLI / standalone）或 `GET /api/_evlog/stream-info` endpoint（Nuxt module）。

### 3. `readFsLogs()` / `tailFsLogs()` — NDJSON replay

From `evlog/fs`。讀 `.evlog/logs/*.jsonl`（NDJSON，一行一 event）。`readFsLogs` 一次性走完歷史；`tailFsLogs` 先回放再 tail 新寫入。

```ts
import { readFsLogs, tailFsLogs } from 'evlog/fs'

// 一次性歷史
for await (const e of readFsLogs({ since: '2026-03-01', level: 'error' })) {
  console.log(e.timestamp, e.action ?? e.message)
}

// 即時追蹤
const ac = new AbortController()
for await (const e of tailFsLogs({ pollIntervalMs: 500, signal: ac.signal })) {
  console.log('live:', e.action)
}
```

兩函式回傳 `AsyncIterable<WideEvent>`，malformed line 靜默跳過。檔名 `YYYY-MM-DD.jsonl`，size-rotation 加 `.1.jsonl` 後綴。

## 設計原則

- **MUST opt-in**：streaming server / stream-info endpoint 都是 opt-in；nuxt module 預設不啟，要明確設 `evlog.stream: true`（或詳細 options object）
- **MUST token-gate prod**：非 local（127.0.0.1 / localhost / [::1]）來源**必**要求 token；token 缺漏即拒
- **MUST NOT 部署到 serverless**：Cloudflare Workers / Vercel Edge / AWS Lambda 等 isolated process 不適用 `startStreamServer`（process 間不共享 ring buffer），fs reader 也不適用（無 durable fs）
- **MUST NOT 把 stream 當 audit canonical**：stream / fs reader 是 derived view，audit truth 仍在 DB（見 `rules/core/audit-pattern.md`），D-pattern row 是源頭，stream 是衍生
- **MUST NOT 用 `evlog/fs` 當 prod durable journal**：FS writer 是 dev / Nitro self-host only；Workers VFS 不 durable，FS reader 在 Workers 也讀不到（沒對應 writer）

## Anti-pattern

| 反模式 | 為何錯 | 正解 |
| --- | --- | --- |
| Production `startStreamServer({ token: undefined })` | 任何 local 同 host process 都能 dump 全部 wide event（含 PII） | `token: process.env.EVLOG_STREAM_TOKEN`，並驗 token 非空才啟 |
| `stream-info` endpoint 沒 auth gate | client devtool 用 `fetch('/api/_evlog/stream-info')` 拿 URL 後直連 stream，等於 auth bypass | endpoint 必過 `requireAuth` / `requireRole('admin')` 才回 URL |
| Workers / Edge 環境 `import { startStreamServer } from 'evlog/stream'` | isolate 間不共享 buffer，每個 request 拿到不同 view；FS 不 durable | Workers 走自家 Postgres drain + admin UI 從 Postgres 讀；不用 `/extend/` |
| `for await (const e of readFsLogs(...))` 在 production 跑分析 | FS writer 在 prod Workers 不可用，根本沒檔案可讀 | Postgres drain SQL query；或 SaaS（Sentry / Axiom）後端 query API |
| 把 stream event 寫回 DB 當 audit | wide event 是 derived，缺 prev_hash / hash anchor | 走 D-pattern transactional outbox（`audit()` helper） |

## Custom enrichers（/extend/custom-enrichers）

### 何時用

預設 5 件套 enricher（UA / Geo / RequestSize / TraceContext / Tenant — 見 `vendor/snippets/evlog-enrichers-stack/`）覆蓋通用情境。當 consumer 需要把**自家業務 metadata**附到每個 wide event 時，才寫自家 enricher：

- **perno**: multi-tenant `tenant.id` / `tenant.org` 已是 production 需求
- **TDMS**: 製造業 `station.id` / `workstation.kind` / `inspection.batch_id`
- **edge-rag**: AI agent `agent.id` / `agent.run_id` / `retrieval.scope`

### API surface

```ts
import { defineEnricher, composeEnrichers, getHeader } from 'evlog/toolkit'
```

`defineEnricher<T>({ name, field, compute })`：把 `compute(ctx)` 回傳值 merge 到 `event[field]`，回 `undefined` 即跳過。

### Wiring

```ts
// server/utils/enrichers.ts
import { defineEnricher, getHeader } from 'evlog/toolkit'

export const tenantEnricher = defineEnricher<{ id: string }>({
  name: 'tenant',
  field: 'tenant',
  compute: ({ headers }) => {
    const id = getHeader(headers, 'x-tenant-id')
    return id ? { id } : undefined
  },
})

// server/plugins/evlog-enrich.ts
import { composeEnrichers } from 'evlog/toolkit'
import { createDefaultEnrichers } from 'evlog/enrichers'
import { tenantEnricher } from '~/server/utils/enrichers'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:enrich', composeEnrichers([
    createDefaultEnrichers(),
    tenantEnricher,
  ]))
})
```

### MUST

- **enricher 純函式**：`compute` 不得 `await`、不得 `throw`、不得 I/O — enricher 在 hot path，failure 會破整個 wide event chain（rule `evlog-adoption.md` § enricher 約束）
- **field 命名 lower.dot.case**：對齊 catalog prefix 慣例（`tenant` / `tenant.org` / `agent.run_id`），便於 cross-event aggregation
- **MUST 用 `composeEnrichers` 串 5 件套 + 自家**，禁止覆寫 default enricher

### MUST NOT

- **MUST NOT throw 在 enricher**：失敗回 `undefined` 即可；throw 會 cascade 破 evlog emit
- **MUST NOT 在 enricher I/O**：不查 DB、不打 HTTP；要用查得到的資訊需在 `requireAuth` 階段先放進 `event.context.headers` 或 `logger.set(...)`
- **MUST NOT 把 PII raw 寫進 enricher field**：PII 走 redact 層（rule `evlog-adoption.md` § Redaction）
- **MUST NOT 用 `definePlugin` 包單純 enricher**：用 `defineEnricher` 即可；多 hook 共享狀態才升級到 `definePlugin`（本 rule 不涵蓋；need-driven 再補）

## Tail sampling（/extend/tail-sampling）

### 何時用

「事後採樣」— request 完成後依結果（status / duration / context）決定 keep/drop，跟 head sampling（`sampling.rates.error` 預先比率）正交。低流量 consumer 也適用：保留所有 error / slow request、丟健康雜訊。

典型 use case：

- **perno**: enterprise tier user 的 5xx 全留（debug critical customer）
- **TDMS**: 製造端 `inspection.failed` 全留 + `duration > 2000ms` 全留
- **edge-rag**: AI agent `policy.deny` / `tool.invoke.failed` 全留

### API surface

```ts
import { definePlugin, composeKeep } from 'evlog/toolkit'
// 或直接 hook 'evlog:emit:keep'
```

### 跟 audit forceKeep 的關係

`evlog:emit:keep` hook 同時承載**兩個 use case**：

1. **audit forceKeep**（既有規約，5 consumer 已採用） — `kind === 'audit'` event 一律 `shouldKeep = true`，繞 head sampling 確保 audit 不被丟（見 `rules/core/logging.md` § audit forceKeep）
2. **tail sampling decision**（本 §） — 依 `duration` / `status` / `context` 做事後 keep 判斷

兩個 use case 共用同個 hook，預期 wire 在**同個 nitro plugin** 裡（拆兩 plugin 也行但無必要）。`extend.tailSamplingKeep` audit signal 偵測 hook 採用度，**不**區分這兩個 use case — 計數 > 0 即代表 consumer 已啟 hook（無論是 audit forceKeep 還是 tail sampling decision）。

### Wiring（推薦 hook 形式，無需 plugin）

```ts
// server/plugins/evlog-tail-sampling.ts
import { composeKeep } from 'evlog/toolkit'

const keep = composeKeep([
  ({ duration }) => duration && duration > 2000 ? true : undefined,
  ({ event }) => event.level === 'error' ? true : undefined,
  ({ context, status }) =>
    context.user?.plan === 'enterprise' && status && status >= 500 ? true : undefined,
])

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:emit:keep', (ctx) => {
    if (keep(ctx)) ctx.shouldKeep = true
  })
})
```

### MUST

- **MUST 同步 + zero I/O**：keep hook 在每 request 結束後跑，必須極快；不 await、不 throw、不查 DB
- **MUST 跟 head sampling 互補**：tail sampling **不**取代 `sampling.rates.error: 100`；用 tail 撈 head 丟掉的「健康但長」trace
- **MUST 保留 error 全集**：`event.level === 'error'` → 一律 `shouldKeep = true`（regardless of head sample rate）
- **MUST `composeKeep` 用 `undefined` 表 no-opinion**：predicate 回 `true` 即 keep，回 `undefined` 留給下一條，回 `false` 強制 drop（少用）

### MUST NOT

- **MUST NOT 把 head sampling 全 set 0 後靠 tail 補**：head 是流量控制（cost 防爆），tail 是品質提升（保證 critical 留）；兩者目的不同
- **MUST NOT 在 keep hook 內依賴非同步 context**：`context.user` 必須是 `requireAuth` 階段同步寫入的；await 拿 user 違反 hot path 約束
- **MUST NOT 用 tail sampling 取代 audit canonical**：audit row 在 DB（D-pattern），tail-sampled evlog event 是衍生 view

## 跟既有 layer 的關係

- **寫端 drain**（evlog-adoption.md §「Drain pipeline」）：consumer 端設置 evlog write pipeline；本 rule 是讀端 view，必依賴寫端有 event 進來
- **D-pattern audit**（audit-pattern.md）：audit canonical 在 DB；stream / fs reader 是 evlog 端的衍生 view，**不**取代 audit
- **Catalogs**（evlog-adoption.md § Catalogs）：catalog 提供 typed event shape，stream consumer 用 `WideEvent['action']` 等同 catalog augment 後的 union 型別自動 narrow

## Adoption guidance

當 consumer 出現以下 signal 才考慮導入：

- 內部 admin 頁需要「即時看當前 request 的 wide event chain」做 debug
- 客服面板需要「對單一 user / order ID 重放 evlog event chain」
- CLI 工具需要對歷史 `.evlog/logs/` 跑 regression 分析

沒有上述 signal 時 — **不採用**。`/extend/` API 不是預設標準，clade 不強推。

## Reference signal（不 block）

`scripts/evlog-adoption-audit.mjs` 加 4 條 reference signal 度量 consumer 對 /extend/ 的採用狀態（純度量，不參與 block gate）：

```
extend.streamConsumer    useEvlogStream / EventSource _evlog stream 命中數（/extend/stream）
extend.fsReader          readFsLogs / tailFsLogs 命中數（/extend/fs-reader）
extend.customEnricher    defineEnricher( 命中數（/extend/custom-enrichers）
extend.tailSamplingKeep  composeKeep / evlog:emit:keep 命中數（/extend/tail-sampling）
```

各 signal > 0 即代表 consumer 已採用對應擴充點；clade 不對採用度設目標值，consumer 自評需求。

## 反採用條件（明確不採用）

- consumer runtime 是 Cloudflare Workers / Vercel Edge / Lambda（process-isolated）
- consumer 端只需「prod 端 wide event 進 Sentry / Axiom」做 monitoring（SaaS 已有 query / replay UI）
- consumer 沒有 admin 端真實需求要看 stream / replay
