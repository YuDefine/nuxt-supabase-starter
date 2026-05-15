<!--
🔒 LOCKED — managed by clade
Source: rules/core/evlog-stream-extend.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

# evlog Stream Extend（讀端擴充）

> Reference：<https://www.evlog.dev/extend/stream> / <https://www.evlog.dev/extend/fs-reader> / <https://www.evlog.dev/extend/consumer-recipes>
>
> 寫端（drain / sampling / redaction）→ 見 `rules/core/evlog-adoption.md`
>
> Catalogs（typed error code / audit action）→ 見 `rules/core/evlog-adoption.md` § Catalogs

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

`scripts/evlog-adoption-audit.mjs` 加 2 條 reference signal 度量 consumer 對 /extend/ 的採用狀態（純度量，不參與 block gate）：

```
extend.streamConsumer  consumer 端 useEvlogStream / EventSource _evlog stream 命中數
extend.fsReader        readFsLogs / tailFsLogs 命中數
```

兩者 > 0 即代表 consumer 已開始用 /extend/ 讀端能力；clade 不對採用度設目標值，consumer 自評需求。

## 反採用條件（明確不採用）

- consumer runtime 是 Cloudflare Workers / Vercel Edge / Lambda（process-isolated）
- consumer 端只需「prod 端 wide event 進 Sentry / Axiom」做 monitoring（SaaS 已有 query / replay UI）
- consumer 沒有 admin 端真實需求要看 stream / replay
