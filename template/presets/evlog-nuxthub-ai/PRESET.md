<!-- 🔒 LOCKED — managed by clade sync-evlog-presets.mjs -->
<!-- preset: evlog-nuxthub-ai (auto-generated) -->

# Preset: evlog-nuxthub-ai

T3 全套（NuxtHub D1 drain + AI SDK convention + SSE/MCP child logger）。適用：AI agent / RAG / agentic workflow。對應 master plan § 8.4。

## 安裝步驟

1. `pnpm add evlog@^2.16.0 @evlog/nuxthub @nuxthub/core ai @ai-sdk/anthropic`
2. cp 本目錄全部檔案到對應路徑
3. `nuxt.config.ts` `modules` 加 `@evlog/nuxthub` + 套下方範例（含 D1 binding + retention）
4. AI endpoint 內呼叫 `recordAIGeneration` / `recordToolCall` / `recordModeration` / `recordEmbedding`
5. SSE / MCP endpoint 改用 `forkChildLogger` + `emitChildLogger` pattern
6. Better Auth `createAuthMiddleware` 內注入 evlog identity
7. `wrangler dev --region apac` 觸發 chat endpoint，D1 應有 row + `event.ai.cost_usd` 落地

## nuxt.config.ts pre-applied 範例

```ts
// nuxt.config.ts — evlog-nuxthub-ai preset (T3)
// NuxtHub D1 + AI agent stack；不走 Sentry baseline
export default defineNuxtConfig({
  modules: [
    '@nuxthub/core',
    '@evlog/nuxthub', // 自動 install evlog/nuxt
    'better-auth/nuxt',
  ],
  evlog: {
    env: { service: 'YOUR_AI_APP_NAME' },
    include: ['/api/**'],
    retention: '90d', // NuxtHub D1 cron 自動 drop > 90 day rows
    sampling: {
      // rates 0-100；audit forceKeep 由 server/plugins/evlog-enrich.ts 末尾
      // evlog:emit:keep hook wire (evlog 2.16 無內建 — master plan §14 第 12 條校正)
      rates: { error: 100, warn: 100, info: 50, debug: 0 },
      keep: [{ status: 400 }, { duration: 1000 }],
      // cost-based forceKeep 走 server/plugins/evlog-cost-keep.ts 用 'evlog:emit:keep' Nitro hook
      // （keep[] 不接 callback，要 cost / event-shape filter 必走 Nitro hook）
    },
    redact: {
      paths: ['user.password', 'headers.authorization'],
      builtins: ['jwt', 'bearer', 'email'],
    },
    transport: {
      enabled: true,
      endpoint: '/api/_evlog/ingest',
    },
  },
  hub: {
    database: true, // D1 binding for evlog_events
    kv: true,
  },
})
```

## 檔案清單

- `docs/evlog-nuxthub-config.md` ← `vendor/snippets/evlog-nuxthub-drain/nuxt.config-snippet.ts`
- `docs/evlog-nuxthub-drain.md` ← `vendor/snippets/evlog-nuxthub-drain/README.md`
- `server/plugins/evlog-enrich.ts` ← `vendor/snippets/evlog-enrichers-stack/enrichers.ts`
- `server/utils/ai-logger.ts` ← `vendor/snippets/evlog-ai-sdk-logger/ai-logger.ts`
- `docs/evlog-ai-sdk-logger.md` ← `vendor/snippets/evlog-ai-sdk-logger/README.md`
- `server/utils/sse-child-logger.ts` ← `vendor/snippets/evlog-mcp-sse-child-logger/child-logger.ts`
- `docs/evlog-mcp-sse-child-logger.md` ← `vendor/snippets/evlog-mcp-sse-child-logger/README.md`

## 來源

clade `~/offline/clade/scripts/sync-evlog-presets.mjs` 自動同步。
consumer 端 fork 修改 = drift；改回 clade vendor snippets 並 propagate。
