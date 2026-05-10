/\*\*

- 🔒 LOCKED — managed by clade sync-evlog-presets.mjs
- preset: evlog-nuxthub-ai
- source: vendor/snippets/evlog-nuxthub-drain/nuxt.config-snippet.ts
- to: presets/evlog-nuxthub-ai/docs/evlog-nuxthub-config.md
- do not edit consumer-side; modify clade vendor snippet then re-propagate
  \*/
  /\*\*
- @evlog/nuxthub 安裝 — NuxtHub D1 storage + 自動 retention cron
-
- Source: clade docs/evlog-master-plan.md § 3 + § 8.4 (agentic-rag)
-
- 使用：
- 1.  pnpm add @evlog/nuxthub
- 2.  把以下片段 merge 進 nuxt.config.ts
-
- @evlog/nuxthub 是 nuxt module（不是 import 一個 drain function）：
- - 自動安裝 evlog/nuxt + @nuxthub/core
- - 加 server plugin（drain.js）寫進 D1
- - 加 cron handler /api/\_cron/evlog-cleanup
- - 加 retention 配置選項
-
- 對 T3（agentic-rag）是預設 baseline；其他 NuxtHub consumer 可選裝。
  \*/

export default defineNuxtConfig({
modules: [
'@nuxthub/core',
'@evlog/nuxthub', // 必在 evlog/nuxt 之前；@evlog/nuxthub 會自動 install evlog/nuxt
// 'evlog/nuxt', // @evlog/nuxthub 自動裝，不用顯式列
],

hub: {
database: true, // D1 binding 必開（drain 寫入目標）
kv: true, // 選用：rate-limit 等
},

evlog: {
enabled: true,
pretty: true, // dev mode 美化輸出，production 自動 false
silent: false,

    // ── retention（@evlog/nuxthub 提供）──────────────────────────────
    // 過此期限的 row 自動由 cron 清掉
    // 7d (預設) / 14d / 30d / 90d；超過 90d 建議改用 R2 cold storage
    retention: '7d',

    // ── sampling（evlog/nuxt 內建）──────────────────────────────────
    sampling: {
      default: 0.5,
      byLevel: {
        error: 1.0,
        warn: 1.0,
        info: 0.5,
        debug: 0,
      },
      byRoute: {
        'GET /api/_cron/evlog-cleanup': 0.01, // cron 自身 log 不要 spam D1
        'POST /api/_evlog/ingest': 1.0, // client transport 不採樣
      },
      // 對 audit force-keep（evlog/nuxt sampling forceKeep 預設）
    },

    // ── redaction（evlog/nuxt 內建）────────────────────────────────
    redact: true, // production 自動套 PII patterns + auditRedactPreset

},
})

/\*\*

- vercel.json 整合（@evlog/nuxthub onInstall 互動式詢問是否建）
-
- @evlog/nuxthub install 流程會問 "Do you want to create a vercel.json with
- a cron schedule for evlog cleanup?" — 選 Y 後自動寫入：
-
- {
-     "crons": [
-       { "path": "/api/_cron/evlog-cleanup", "schedule": "0 *​/4 * * *" }
-     ]
- }
-
- Cloudflare Workers 不用 vercel.json — 改用 wrangler.toml `[triggers] crons`：
-
- [triggers]
- crons = ["0 *​/4 * * *"]
-
- 然後在 server/api/\_cron/evlog-cleanup.ts 確認 cron handler 還在
- （@evlog/nuxthub 自動加，不用自己寫）。
  \*/

/\*\*

- 並存 Sentry：T3 (agentic-rag) 目前無 Sentry，但若要加：
-
- 1.  pnpm add @sentry/nuxt
- 2.  加 server/plugins/evlog-sentry-drain.ts（見 evlog-sentry-drain/ snippet）
- 3.  兩條 drain 同時 register；Sentry 接 hot path issues、D1 接 long-tail query
-
- 注意：D1 100 writes/s（free tier）— 高量 consumer 必加 sampling 把 info 率降低
  \*/
