<!--
🔒 LOCKED — managed by clade
Source: rules/core/logging.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

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

# Logging

evlog（https://www.evlog.dev/）是 wide-event-style structured logger。clade 5 consumer 全跑 Nuxt + Cloudflare Workers，本 rule 是其上 14 區塊功能的最低治理線。完整 adoption plan 見 `docs/evlog-master-plan.md`。

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

## log.error 使用時機

**只記錄非預期錯誤**，不記錄正常業務分支：

```typescript
// ✅ 非預期 — 要 log.error
if (error) {
  log.error(error as Error, { step: 'db-insert' })
  const result = handleDbError(error)
  throw createError({
    status: result.statusCode,
    message: result.message,
    why: result.why,
    fix: result.fix,
  })
}

// ❌ 預期 — 不要 log.error
if (error?.code === 'PGRST116') {
  // 404 是正常情況，直接 throw
  throw createError({ status: 404, message: '找不到資料' })
}
```

**判斷標準**：如果這個錯誤代表 caller 的錯誤（404、422）或已知業務狀態，不記錄。只記錄代表系統異常的錯誤（5xx、非預期 DB error）。

## log.error 只呼叫一次

每個錯誤路徑只能有 **一個** `log.error` 呼叫。重複記錄 = 重複告警 = 告警疲勞。

## handleDbError 注意事項

此專案的 `handleDbError` **returns**（不 throw），必須自行 throw：

```typescript
// ✅ 正確 — log + handle + throw
if (error) {
  log.error(error as Error, { step: 'db-insert' })
  const result = handleDbError(error)
  throw createError({
    status: result.statusCode,
    message: result.message,
    why: result.why,
    fix: result.fix,
  })
}

// ❌ 忘記 throw — 錯誤被吞掉，程式繼續執行
if (error) {
  handleDbError(error) // returns but doesn't throw!
}
```

## createError 必帶 why（structured error 必填欄位）

> 新增 endpoint 應改走 catalog factory（`throw billingErrors.PAYMENT_DECLINED({ ... })`）；catalog 內的 `why` / `fix` / `link` 預先宣告，呼叫端不需重複。詳見 `evlog-adoption.md` 「Catalogs 採用」段。本節規則套用在 catalog 尚未涵蓋的場景與既存未遷移的 ad-hoc createError。

`server/api/**` 的非預期錯誤路徑，`throw createError(...)` **MUST** 帶 `why`，視情況補 `fix` / `link` / `cause` / `code` / `internal`：

| 欄位 | 必填？ | 用途 |
| --- | --- | --- |
| `status` | ✅ | HTTP status code |
| `message` | ✅ | 給使用者看的中文訊息（i18n-ready） |
| `why` | ✅（5xx） | 給排障的英文說明（為什麼會走到這裡） |
| `fix` | ⬜ 建議 | 給開發者的下一步（怎麼修） |
| `link` | ⬜ 選用 | 對應 docs / runbook URL |
| `cause` | ✅（有 wrap） | 原始 error 物件，evlog 自動 unwrap |
| `code` | ⬜ 建議 | 機器可讀錯誤代號（例：`PG_UNIQUE_VIOLATION`、`AUDIT_HASH_DRIFT`） |
| `internal` | ⬜ 選用 | 標記不送 client 的欄位（debug-only） |

```typescript
// ✅ 結構化錯誤
throw createError({
  status: 500,
  message: '稽核紀錄寫入失敗',
  why: 'business mutation must commit with audit row in same transaction',
  fix: '檢查 audit_logs RLS、trigger、hash advisory lock 與 service_role 設定',
  link: 'https://internal/runbook/audit-failure',
  code: 'AUDIT_TX_FAIL',
  cause: error,
  internal: { auditEventId: result.auditEventId, prevHash: result.prevHash },
})

// ❌ 只給 message
throw createError({ status: 500, message: '失敗' })
```

只給 `message` = 浪費 evlog `error.data.why` / `error.data.fix` 結構化錯誤的核心特色。
review 時 grep 抓 `createError\(\{[^}]*\}\)` 不含 `why:` 一律列 🟠 Major。

### `internal` 機制

`internal` 內欄位會進 evlog wide event（debug 用），但**不**會被序列化進 HTTP response。用於把敏感 / 內部 metadata 送進 observability 卻不洩漏給 client：

```ts
throw createError({
  status: 500,
  message: '操作失敗',
  why: 'downstream service rejected payload',
  internal: {
    upstreamRequestId: result.requestId,
    upstreamStatus: result.upstreamStatus,
    actorId: user.id, // 不送 client，但需要進 evlog
  },
})
```

`message` / `why` / `fix` / `link` / `code` 仍會送 client。`cause` 由 evlog unwrap 但不入 response body。

### `code` 欄位

`code` 是機器可讀錯誤代號，client 用以做 i18n / 行為分支。命名規則：

- 全大寫 + underscore：`AUDIT_HASH_DRIFT`、`RATE_LIMIT_EXCEEDED`
- 不含 status code（已在 `status` 欄位）
- 跨 endpoint 共用代號（例：`UNIQUE_VIOLATION` 不分 table）

## log.error 參數必須非 null

```typescript
// ✅ 安全
if (fetchError.value) {
  log.error(fetchError.value as Error)
}

// ❌ fetchError.value 可能是 null
log.error(fetchError.value as Error) // null → runtime error or no-op
```

## 搜尋字串消毒

所有 `.or()` / `.ilike` 搜尋 **MUST** 使用 `sanitizePostgrestSearch()`：

```typescript
// ✅ 消毒後插值
const s = sanitizePostgrestSearch(search.trim())
query.or(`name.ilike.%${s}%,code.ilike.%${s}%`)

// ❌ 直接插值 — filter injection + ILIKE 萬用字元注入
query.or(`name.ilike.%${search}%`)
```

`sanitizePostgrestSearch` 處理 `,` `.` `(` `)` `%` `_` 六種特殊字元。

## log.set 時機

| 時機                 | 設定內容                             |
| -------------------- | ------------------------------------ |
| `requireAuth()` 之後 | `{ user: { id }, operation, table }` |
| 成功回傳前           | `{ result: { id, ...key fields } }`  |

GET endpoint 可省略 `log.set`，只需初始化 `useLogger(event)` + 錯誤時 `log.error`。

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
  const waitUntil = event.context.cloudflare?.context?.waitUntil
  if (typeof waitUntil === 'function') {
    waitUntil(drain.flush())
  }
})
```

**禁止**改回 `request` hook + `waitUntil(drain.flush())` pattern — `request` hook 早於該次 request 的 wide event 被 evlog emit 進 buffer（evlog 在 `afterResponse` 才 emit），低流量 Workers 環境下會永久遺失當前 event。

### 三條 meta-event 必接

drain pipeline emit 以下 meta-event，consumer **MUST** 接這三個並 ship 到 Sentry meta-channel：

| Event | 觸發 | 處理 |
| --- | --- | --- |
| `pipeline.overflow` | batch 滿 + onOverflow 啟動 | warn channel；> 10/min 必告警 |
| `pipeline.retry_exhausted` | retry 用光仍失敗 | error channel；ship 到自家 `evlog_dropped` 留底 |
| `pipeline.memory_warning` | batch buffer >1MB | warn channel；review batch size |

review 抓 `createSentryDrain\(` 同檔沒有 `createDrainPipeline` 包覆 → 🟠 Major。

## Sampling 強制下限

production sampling **MUST** 滿足以下下限：

| Level | 預設 | 強制最低 | 備註 |
| --- | --- | --- | --- |
| `error` | 100% | **100%** | 永遠不 sample |
| `audit` | 100% | **100%**（forceKeep） | audit 是合規剛需 |
| `warn` | 100% | 50% | 高量 warn route 可降到 50% |
| `info` | 50% | 10% | 預設 50%；無價值 info（health check）可降到 10% |
| `debug` | 0%（production） | — | production 不送 |

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['evlog/nuxt'],
  evlog: {
    sampling: {
      // rates 是百分比 0-100，不是 0-1
      rates: {
        error: 100,
        warn: 100,
        info: 50,
        debug: 0,
      },
      // tail sampling；任一條件符合就 force keep（OR logic）
      keep: [
        { status: 400 },
        { duration: 1000 },
        { path: '/api/critical/**' },
      ],
    },
  },
})
```

evlog 2.16 無內建 `kind === 'audit'` force keep。需要 audit forceKeep 的 consumer **MUST** 在 Nitro plugin 內 wire `evlog:emit:keep`：

```ts
nitroApp.hooks.hook('evlog:emit:keep', (ctx) => {
  if ((ctx.context as { kind?: string }).kind === 'audit') ctx.shouldKeep = true
})
```

review 抓 `sampling.rates.error` < 100 或 audit consumer 缺 `evlog:emit:keep` + `kind === 'audit'` → 🔴 Critical。

## Redaction 強制條件

production **MUST** 開 `evlog.redact`。可直接 `redact: true` 啟用 builtins；要追加自家欄位時用 `paths` / `patterns` / `builtins` / `replacement`。

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['evlog/nuxt'],
  evlog: {
    redact: {
      paths: [
        'user.password',
        'body.password',
        'headers.authorization',
        'headers.cookie',
        'access_token',
        'refresh_token',
        'id_token',
      ],
      patterns: [/sk-[A-Za-z0-9_-]{20,}/],
      builtins: ['jwt', 'bearer', 'email', 'creditCard'],
      replacement: '[REDACTED]',
    },
  },
})
```

audit drain 的 PII 過濾走 evlog root export 的 `auditRedactPreset`，在 audit drain branch 套用；不要使用不存在的 `redactionPolicy.presets`。

### PII 分層

| 欄位 | server log | audit chain | client log |
| --- | --- | --- | --- |
| password / token / API key | ❌ redact | ❌ redact | ❌ redact |
| email | ✅ 可保留 | ❌ redact | ❌ redact |
| `client.ua` | ✅ 保留 | ❌ redact（PII） | ✅ 保留 |
| `req.geo.country` | ✅ 保留 | ✅ 保留（非 PII） | ✅ 保留 |
| `cf-ip*` headers | ❌ enricher 不准抓 | ❌ | ❌ |
| LLM raw prompt / output | ✅ 保留（短 TTL） | ❌ redact | — |

review 抓 `redact` 不存在，或 `redact: { paths: [...] }` 缺 `password` 與 `token|authorization` 任一 → 🔴 Critical。`redact: true` 視為啟用 builtins，不算缺 core redaction。

## Client logging 規範

client transport **MUST** 走 evlog/nuxt module 內建 transport + `evlog/client` runtime helper。高量 consumer 才轉自家 `createHttpLogDrain`。

### 安裝

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['evlog/nuxt'],
  evlog: {
    transport: {
      enabled: true,
      endpoint: '/api/_evlog/ingest',
      credentials: 'same-origin',
    },
  },
})
```

### setIdentity / clearIdentity

login 成功後 **MUST** 呼叫 `setIdentity({ userId, tenantId })`，logout 時呼叫 `clearIdentity()`。否則 client event 無法跟 server `requireAuth()` 後的 user 對齊。

```ts
import { setIdentity, clearIdentity } from 'evlog/client'

watch(() => useUserSession().user, (user) => {
  if (user) {
    setIdentity({ userId: user.id, tenantId: user.tenantId })
  } else {
    clearIdentity()
  }
}, { immediate: true })
```

### `/api/_evlog/ingest` 必要保護

| 保護 | 強制？ | 為什麼 |
| --- | --- | --- |
| CSRF | ✅ | module 自動註冊的 endpoint 接 client POST；需由 consumer 的安全 middleware / platform policy 保護 |
| rate-limit | ✅ | 建議 100 req/min/user；防 client bug 暴量 |
| body schema validation | module 內建 | client 端可能誤送 password / token |
| `evlog.redact` 二次套用 | ✅ | 信任邊界：client 送來的 event 必須再過一次 redaction |

### `minLevel` / `suppressConsole`

- `setMinLevel('warn')`：production 可用；info 不送 server（量太大 + 大多無價值）
- `console: false`：由 nuxt module config 控制 console suppression
- dev 階段可 `setMinLevel('debug')`，方便 debug

反模式：
- 自寫 `app/plugins/evlog-client.client.ts` 包 `createHttpLogDrain` + `initLog({ drain })`
- 自寫 `server/api/_evlog/ingest.post.ts` 跟 module handler 搶同一路徑

### 不該用 client transport 的場景

- 純 SPA / 純 SSG — 沒 server endpoint 可以 ingest
- Edge-only worker — 沒 nuxt client plugin

## Typed fields 何時用

evlog typed fields 是「在 build time 確認 wide event 欄位 schema」的機制。evlog 2.16 用 plain TypeScript `interface` + `useLogger<T>(event)` generic 達成；**不**強制全用，但跨 endpoint 共用的 5 個核心欄位**建議**typed：

```ts
// server/utils/evlog-fields.ts
// 真實 evlog 2.16 API：plain interface（無 defineFields factory）
export interface EvlogFields {
  tenant?: { id: string }
  actor?: { id: string; role?: string }
  target?: { type: string; id: string }
  outcome?: 'success' | 'denied' | 'failure'
  auditEventId?: string
}

// 用法：
// import { useLogger } from 'evlog'
// const log = useLogger<EvlogFields>(event)
// log.info('action.done', { actor: { id }, target: { type, id }, outcome: 'success' })
```

> 反模式：`import { defineFields } from 'evlog/typed'` — 該 API 不存在於 evlog 2.16（早期 master plan 誤寫）。

### 採用判斷

| 情境 | 建議 |
| --- | --- |
| 跨 endpoint 共用欄位（user / target / tenant） | ✅ typed |
| endpoint-local debug 欄位（步驟 step / 計時 ms） | ⬜ 不需要 typed |
| audit 欄位（`auditEventId` / `prev_hash` / `hash`） | ✅ typed |
| AI 子事件（cost / tokens / tool） | ✅ typed（跨 AI endpoint 共用） |

### 為什麼不全用

- typed fields 增加維護成本（schema 改一處全 endpoint 重 build）
- evlog wide event 本身允許任意欄位；typed 只是給跨 endpoint 共用的核心欄位上鎖

### 反模式

- 把 client request body 整包塞進 typed fields → 失去 wide event 的彈性
- 為單一 endpoint 開 typed schema → 過度工程
- typed fields 與 redaction keys 命名不一致 → redaction 失效（typed 標記不會自動 redact）

## Enricher stack 標準（5 件套）

5 consumer 必裝 enricher（順序重要）：

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

完整 review automation 在 M2 階段補：`scripts/evlog-adoption-audit.mjs`（spec 見 `docs/evlog-master-plan.md` § 10）。
