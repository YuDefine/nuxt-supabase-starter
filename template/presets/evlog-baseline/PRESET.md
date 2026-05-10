<!-- 🔒 LOCKED — managed by clade sync-evlog-presets.mjs -->
<!-- preset: evlog-baseline (auto-generated) -->

# Preset: evlog-baseline

T1 全套（drain pipeline + Sentry drain + 5 件套 enricher + sampling/redaction + client transport）。適用：內部工具 / SROI 報告 / 教學系統。對應 master plan § 2.3。

## 安裝步驟

1. `pnpm add evlog@^2.16.0 @sentry/nuxt`
2. cp 本目錄全部檔案到對應路徑（見「檔案清單」）
3. `nuxt.config.ts` 套下方 pre-applied 範例（補 `evlog` block + `modules`）
4. `.env` 補 `SENTRY_DSN` / `NUXT_PUBLIC_SENTRY_DSN` / `EVLOG_CLIENT_RATE_LIMIT_PER_MIN=100`
5. login handler 加 `setIdentity({ userId })`；logout 加 `clearIdentity()`
6. `wrangler dev` 觸發 endpoint，Sentry Logs 應收到 wide event

## nuxt.config.ts pre-applied 範例

```ts
// nuxt.config.ts — evlog-baseline preset (T1 全套)
export default defineNuxtConfig({
  modules: ['nuxt-auth-utils', '@nuxtjs/supabase', '@sentry/nuxt/module', 'evlog/nuxt'],
  evlog: {
    env: { service: 'YOUR_APP_NAME' },
    include: ['/api/**'],
    sampling: {
      // rates 是百分比 0-100（**不是** 0-1）；error 預設 100 不可降
      rates: { error: 100, warn: 100, info: 50, debug: 0 },
      // keep[] 是 OR-logic TailSamplingCondition[]：{ status?, duration?, path? }
      // audit forceKeep 由 server/plugins/evlog-enrich.ts 末尾 evlog:emit:keep hook wire
      // (evlog 2.16 無內建 audit forceKeep — master plan §14 第 12 條校正)
      keep: [
        { status: 400 }, // 4xx / 5xx 永遠 keep
        { duration: 1000 }, // 慢 endpoint (≥ 1s) 永遠 keep
        { path: '/api/critical/**' }, // critical path 永遠 keep
      ],
    },
    redact: true, // 啟用 builtins: jwt / bearer / email / ipv4 / phone / creditCard / iban
    // 如要追加自家 paths，改 object：
    // redact: {
    //   paths: ['user.password', 'body.password', 'headers.authorization'],
    //   patterns: [/sk-[A-Za-z0-9_-]{20,}/],
    //   replacement: '[REDACTED]',
    // },
    transport: {
      enabled: true,
      endpoint: '/api/_evlog/ingest',
      credentials: 'include',
    },
  },
  vite: {
    plugins: [
      // build-time source location 注入（配合 Sentry source maps 才有意義）
      // import { createSourceLocationPlugin } from 'evlog/vite'
      // createSourceLocationPlugin(),
    ],
  },
  sentry: {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
  },
  runtimeConfig: {
    sentry: { dsn: process.env.SENTRY_DSN },
    public: { sentry: { dsn: process.env.NUXT_PUBLIC_SENTRY_DSN } },
  },
})
```

## 檔案清單

- `server/plugins/evlog-drain.ts` ← `vendor/snippets/evlog-drain-pipeline/pipeline.ts`
- `server/plugins/_evlog-drain.README.md` ← `vendor/snippets/evlog-drain-pipeline/README.md`
- `server/plugins/evlog-sentry-drain.ts` ← `vendor/snippets/evlog-sentry-drain/drain.ts`
- `server/plugins/evlog-enrich.ts` ← `vendor/snippets/evlog-enrichers-stack/enrichers.ts`
- `app/utils/evlog-identity.ts` ← `vendor/snippets/evlog-client-transport/identity-helper.ts`
- `docs/evlog-client-transport.md` ← `vendor/snippets/evlog-client-transport/README.md`

## 來源

clade `~/offline/clade/scripts/sync-evlog-presets.mjs` 自動同步。
consumer 端 fork 修改 = drift；改回 clade vendor snippets 並 propagate。
