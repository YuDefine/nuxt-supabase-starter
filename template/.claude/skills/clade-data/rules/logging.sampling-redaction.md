---
description: evlog sampling 強制下限與 redaction 強制條件全文（含 PII 分層表、audit forceKeep wiring）；常駐 pointer 在 [[logging]]，觸發時機是「改 nuxt.config 的 evlog.sampling / evlog.redact 或 audit forceKeep wiring 之前」，由 [[logging]] 的 MUST-Read 指針叫醒
paths:
  - 'nuxt.config.ts'
  - 'packages/**/nuxt.config.ts'
  - 'server/plugins/evlog-*.ts'
  - 'packages/**/server/plugins/evlog-*.ts'
---
<!-- Clade native rule; source: rules/modules/capabilities/evlog/logging.sampling-redaction.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Logging — Sampling 與 redaction（全文）

> 本檔是 [[logging]] 的下推全文之一。本檔管 `nuxt.config` 的 `evlog.sampling` / `evlog.redact` 政策與 PII 分層。

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

evlog（floor ^2.17.0，見 [[evlog-adoption.catalogs]]）無內建 `kind === 'audit'` force keep。需要 audit forceKeep 的 consumer **MUST** 在 Nitro plugin 內 wire `evlog:emit:keep`：

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
