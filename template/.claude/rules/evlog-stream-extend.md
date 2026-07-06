---
description: evlog 讀端 opt-in 擴充（stream/fs-reader/enricher/tail-sampling）適用時載入
paths:
  - 'server/api/**/*.ts'
  - 'server/plugins/evlog-*.ts'
  - 'app/plugins/evlog-*.ts'
  - 'nuxt.config.ts'
  - 'packages/**/server/api/**/*.ts'
  - 'packages/**/server/plugins/evlog-*.ts'
  - 'packages/**/app/plugins/evlog-*.ts'
  - 'template/server/api/**/*.ts'
  - 'template/server/plugins/evlog-*.ts'
  - 'template/app/plugins/evlog-*.ts'
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/evlog-stream-extend.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# evlog Extend 標準（讀端 + 進階 hook）

> <https://www.evlog.dev/extend/>（未列章節 need-driven）；寫端 → `evlog-adoption.md` / `logging.md`
> Templates / SSE envelope 表 / 採用 SOP / anti-pattern grep → `~/offline/clade/vendor/snippets/evlog-stream-extend/`（下文檔名指此）

## 何時用

evlog 預設只「寫」wide event 出去（FS / Sentry / Postgres / 自家 drain）。/extend/ 章節提供「讀端」API，讓 consumer 端可以：

- **內部 devtool**：dev / staging 環境即時看 wide event stream（類 Sentry breadcrumbs 但 local）
- **客服 / debug**：對單一 user / request 重放歷史 event chain，定位錯誤
- **自家 dashboard**：把 evlog event drill-down 嵌進 admin 頁
- **CLI replay**：對 `.evlog/logs/*.jsonl` 跑歷史分析 / regression 驗

如果 consumer 只有「寫到 Sentry / Postgres」需求，**不需要**動讀端 — 寫端 drain 已經夠。讀端 API 是 opt-in 進階擴充，不是預設標準。

## API surface

1. `import { createStreamDrain } from 'evlog/stream'` — in-process ring buffer，event 不出 process（`startStreamServer` 內部用，無獨立 template）
2. `import { startStreamServer } from 'evlog/stream'` — SSE bridge 暴露 stream；envelope 表見 README。Templates：`nuxt-stream-{server,info,client}.template.ts`
3. `import { readFsLogs, tailFsLogs } from 'evlog/fs'` — `.evlog/logs/*.jsonl` NDJSON replay / tail。Template：`fs-replay.template.mjs`

## 設計原則

- **MUST opt-in**：streaming server / stream-info endpoint 都是 opt-in；nuxt module 預設不啟，要明確設 `evlog.stream: true`（或詳細 options object）
- **MUST token-gate prod**：非 local（127.0.0.1 / localhost / [::1]）來源**必**要求 token；token 缺漏即拒
- **MUST NOT 部署到 serverless**：Cloudflare Workers / Vercel Edge / AWS Lambda 等 isolated process 不適用 `startStreamServer`（process 間不共享 ring buffer），fs reader 也不適用（無 durable fs）
- **MUST NOT 把 stream 當 audit canonical**：stream / fs reader 是 derived view，audit truth 仍在 DB（見 `rules/core/audit-pattern.md`），D-pattern row 是源頭，stream 是衍生
- **MUST NOT 用 `evlog/fs` 當 prod durable journal**：FS writer 是 dev / Nitro self-host only；Workers VFS 不 durable，FS reader 在 Workers 也讀不到（沒對應 writer）

## Anti-pattern

| 反模式 | 為何錯 | 正解 |
| --- | --- | --- |
| prod stream server 無 token | 同 host 可 dump 全 event（PII） | env token，非空才啟 |
| `stream-info` 無 auth gate | 拿 URL 直連 = auth bypass | `requireRole('admin')` gate |
| Workers / Edge 用 `evlog/stream` | isolate 不共享 buffer | Postgres drain；UI 讀 DB |
| prod 跑 `readFsLogs` | prod 無 FS writer | Postgres SQL / SaaS query |
| stream event 寫回 DB 當 audit | derived 缺 prev_hash | D-pattern outbox（`audit()`） |

## Custom enrichers

預設 5 件套（`vendor/snippets/evlog-enrichers-stack/`）夠用；附自家業務 metadata 才寫。`defineEnricher({ name, field, compute })`（`evlog/toolkit`）：compute 回傳 merge 到 `event[field]`，`undefined` 跳過；wiring 見 `custom-enricher.template.ts`。

### MUST

- **enricher 純函式**：`compute` 不得 `await`、不得 `throw`、不得 I/O — enricher 在 hot path，failure 會破整個 wide event chain（rule `evlog-adoption.md` § enricher 約束）
- **field 命名 lower.dot.case**：對齊 catalog prefix 慣例（`tenant` / `tenant.org` / `agent.run_id`），便於 cross-event aggregation
- **MUST 用 `composeEnrichers` 串 5 件套 + 自家**，禁止覆寫 default enricher

### MUST NOT

- **MUST NOT throw 在 enricher**：失敗回 `undefined` 即可；throw 會 cascade 破 evlog emit
- **MUST NOT 在 enricher I/O**：不查 DB、不打 HTTP；要用查得到的資訊需在 `requireAuth` 階段先放進 `event.context.headers` 或 `logger.set(...)`
- **MUST NOT 把 PII raw 寫進 enricher field**：PII 走 redact 層（rule `evlog-adoption.md` § Redaction）
- **MUST NOT 用 `definePlugin` 包單純 enricher**：用 `defineEnricher` 即可；多 hook 共享狀態才升級到 `definePlugin`（本 rule 不涵蓋；need-driven 再補）

## Tail sampling

「事後採樣」— request 完成後依結果決定 keep/drop。`composeKeep`（`evlog/toolkit`）wiring 見 `tail-sampling.template.ts`。

`evlog:emit:keep` 同時承載 audit forceKeep（`kind==='audit'` 一律 keep，見 `logging.md`）與 tail sampling，預期同個 nitro plugin；`extend.tailSamplingKeep` 不區分兩者，>0 即已啟 hook。

### MUST

- **MUST 同步 + zero I/O**：keep hook 在每 request 結束後跑，必須極快；不 await、不 throw、不查 DB
- **MUST 跟 head sampling 互補**：tail sampling **不**取代 `sampling.rates.error: 100`；用 tail 撈 head 丟掉的「健康但長」trace
- **MUST 保留 error 全集**：`event.level === 'error'` → 一律 `shouldKeep = true`（regardless of head sample rate）
- **MUST `composeKeep` 用 `undefined` 表 no-opinion**：predicate 回 `true` 即 keep，回 `undefined` 留給下一條，回 `false` 強制 drop（少用）

### MUST NOT

- **MUST NOT 把 head sampling 全 set 0 後靠 tail 補**：head 是流量控制（cost 防爆），tail 是品質提升（保證 critical 留）；兩者目的不同
- **MUST NOT 在 keep hook 內依賴非同步 context**：`context.user` 必須是 `requireAuth` 階段同步寫入的；await 拿 user 違反 hot path 約束
- **MUST NOT 用 tail sampling 取代 audit canonical**：audit row 在 DB（D-pattern），tail-sampled evlog event 是衍生 view

## Adoption / Reference signal

```
真實需求（admin 即時 chain / 客服重放 / CLI 歷史分析）？
├─ 否 → 不採用（非預設標準，不強推）
└─ 是 → 過「反採用條件」→ 導入對應 template
```

`scripts/evlog-adoption-audit.mjs` 4 條 reference signal（純度量不 block；>0 即採用，不設目標值）：

```
extend.streamConsumer    useEvlogStream / EventSource _evlog stream 命中數（/extend/stream）
extend.fsReader          readFsLogs / tailFsLogs 命中數（/extend/fs-reader）
extend.customEnricher    defineEnricher( 命中數（/extend/custom-enrichers）
extend.tailSamplingKeep  composeKeep / evlog:emit:keep 命中數（/extend/tail-sampling）
```

## 反採用條件（明確不採用）

- consumer runtime 是 Cloudflare Workers / Vercel Edge / Lambda（process-isolated）
- consumer 端只需「prod 端 wide event 進 Sentry / Axiom」做 monitoring（SaaS 已有 query / replay UI）
- consumer 沒有 admin 端真實需求要看 stream / replay
