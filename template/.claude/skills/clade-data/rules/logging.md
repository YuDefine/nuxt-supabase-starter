---
description: Server / client logging 與錯誤記錄規範（evlog）
paths:
  - 'server/api/**/*.ts'
  - 'server/plugins/evlog-*.ts'
  - 'app/plugins/evlog-*.ts'
  - 'nuxt.config.ts'
  - 'packages/**/server/api/**/*.ts'
  - 'packages/**/server/plugins/evlog-*.ts'
  - 'packages/**/app/plugins/evlog-*.ts'
---
<!-- Clade native rule; source: rules/modules/capabilities/evlog/logging.md; edit canonical source -->
<!-- clade-targets: claude,codex -->

# Logging

evlog（https://www.evlog.dev/）是 wide-event-style structured logger。clade consumer fleet（名單與 runtime 以 registry/consumers.json 為準）以 Nuxt 為主，本 rule 是其上 14 區塊功能的最低治理線。完整 adoption plan 見 `docs/evlog-master-plan.md`。

## 強制載入指針（thin pointer；全文在四支 path-scoped detail）

本檔只常駐：**Logger 選擇**、**log.set 時機**、**Review 檢查指令**——每一條觸發路徑都會用到。其餘全文按觸發面拆進四支同目錄 detail 檔；命中下表左欄的具名時機時 **MUST 先讀對應 detail**，沒讀到就等於沒有該段規約（detail 檔的 `paths:` 只涵蓋各自觸發面的子集，不能靠順帶載入賭它在場）。

| 觸發時機（具名） | MUST 讀 | 搬走的段 |
| --- | --- | --- |
| 在 server handler 寫 `throw createError` / `log.error` / `handleDbError` / `.or()` 搜尋插值之前 | [[logging.error-contract]] | log.error 時機與單次呼叫、handleDbError、`createError` 必帶 `why`（`internal` / `code` 欄位契約 SoT）、參數非 null、搜尋字串消毒 |
| 動 `server/plugins/evlog-*` 的 drain / enricher wiring（含 Cloudflare Workers `waitUntil` flush）之前 | [[logging.drain-pipeline]] | Drain pipeline 強制包覆、CF Workers `afterResponse` flush、三條 meta-event 必接、Enricher stack 5 件套 |
| 改 `nuxt.config` 的 `evlog.sampling` / `evlog.redact` 或 audit forceKeep wiring 之前 | [[logging.sampling-redaction]] | Sampling 強制下限、Redaction 強制條件、PII 分層 |
| 寫 client transport（`setIdentity` / `_evlog/ingest` / `minLevel`）或 typed fields schema 之前 | [[logging.client-fields]] | Client logging 規範、Typed fields 採用判斷與反模式 |

## Logger 選擇

- **API handler** → `const log = useLogger(event)` from `evlog`（第一行）
- **Request 呼叫的 utils** → 優先讓 caller 傳入 `RequestLogger`，用同一個 request-scoped wide event 累積 context
- **非 request job / cron / script** → `initLogger()` + `createLogger()` / `createRequestLogger()`，一個 logical operation 最後 `emit()`
- **Drain pipeline failure fallback** → 只允許帶 `evlog-exempt` 註解的 `console.error`，避免 drain 壞掉時再透過同一條 drain 記錄自己
- **NEVER** 新增或使用 `consola` — evlog 已提供 request、standalone job、drain pipeline 三種場景的原生 API

```ts
import type { RequestLogger } from 'evlog'

export async function runDomainOperation(options: {
  log?: RequestLogger
}) {
  options.log?.set({ operation: 'domain-operation' })
}
```

```ts
import { createRequestLogger } from 'evlog'

const log = createRequestLogger({ path: 'cron/stale-lifespan-check' })
try {
  log.set({ operation: 'stale-lifespan-check' })
} catch (error) {
  log.error(error as Error, { step: 'cron-run' })
} finally {
  log.emit()
}
```

## log.set 時機

| 時機                 | 設定內容                             |
| -------------------- | ------------------------------------ |
| `requireAuth()` 之後 | `{ user: { id }, operation, table }` |
| 成功回傳前           | `{ result: { id, ...key fields } }`  |

GET endpoint 可省略 `log.set`，只需初始化 `useLogger(event)` + 錯誤時 `log.error`。

## Review 檢查

```bash
# Drain pipeline
rg -n 'createSentryDrain\(' server packages/**/server | rg -v 'createDrainPipeline'
rg -n 'createDrainPipeline\(' server packages/**/server | wc -l

# Sampling
rg -nM 'rates:\s*\{[\s\S]*error:\s*100' nuxt.config.ts packages/**/nuxt.config.ts

# Redaction
rg -n 'redact:\s*(true|\{)' nuxt.config.ts packages/**/nuxt.config.ts

# Client transport
rg -nM "transport:\\s*\\{[\\s\\S]{0,200}?enabled:\\s*true" nuxt.config.ts packages/**/nuxt.config.ts

# Structured error（PCRE2 lookahead — rg 預設 Rust regex 引擎不支援，必須 -P）
rg -P -n 'createError\(\{(?![^}]*why)' server packages clients

# Enricher stack
rg -n "createUserAgentEnricher\\(|createGeoEnricher\\(|createTraceContextEnricher\\(" server/plugins packages/**/server/plugins

# Workers flush hook（必須 afterResponse，不可 request）
rg -nP "hooks\.hook\(['\"]request['\"][\s\S]{0,200}?waitUntil\(drain\.flush" server/plugins packages/**/server/plugins
```

Review automation：`node scripts/evlog-adoption-audit.ts`（欄位說明見 `docs/evlog-master-plan.md` § 10）。
