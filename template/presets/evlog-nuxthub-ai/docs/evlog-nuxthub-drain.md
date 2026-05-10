<!-- 🔒 LOCKED — managed by clade sync-evlog-presets.mjs -->
<!-- preset: evlog-nuxthub-ai -->
<!-- source: vendor/snippets/evlog-nuxthub-drain/README.md -->
<!-- to: presets/evlog-nuxthub-ai/docs/evlog-nuxthub-drain.md -->
<!-- do not edit consumer-side; modify clade vendor snippet then re-propagate -->

# evlog NuxtHub Drain（@evlog/nuxthub module）

T3 主要 drain — `@evlog/nuxthub` Nuxt module 把 wide events 寫進 NuxtHub D1，自帶 cron retention。

Reference: `docs/evlog-master-plan.md` § 3 + § 8.4 (agentic-rag)

**重要差異**：`@evlog/nuxthub` 是 **Nuxt module**（不是 import 一個 `createNuxtHubDrain` function）。安裝後：

- 自動 `installModule('evlog/nuxt')` + `installModule('@nuxthub/core')`
- 加 `server/plugins/_evlog-nuxthub-drain` server plugin（hooks `evlog:drain`）
- 加 `server/api/_cron/evlog-cleanup` handler（cron 觸發 retention）
- 加 type augmentation `ModuleOptions.retention?: string`

Schema 與寫入邏輯固定（不可自訂 column），與 `evlog-postgres-drain` 自家 schema 不同。

## 為什麼選 NuxtHub 而非自寫 D1 drain

| 替代                                         | 為什麼不選                                                  |
| -------------------------------------------- | ----------------------------------------------------------- |
| 手寫 D1 drain（類似 `evlog-postgres-drain`） | NuxtHub 已封 D1 schema + retry + retention，自寫等於重造    |
| `@nuxthub/core` 直接寫 + 自家 cron           | 沒 schema migration tooling；`@evlog/nuxthub` schema 已經穩 |
| Sentry only                                  | agentic-rag 沒 Sentry；NuxtHub 是 D1 stack 的自然選擇       |

## T3 完整 stack 組合

| Layer            | 用什麼                                                            |
| ---------------- | ----------------------------------------------------------------- |
| Drain            | `@evlog/nuxthub`（D1 主 sink）                                    |
| Pipeline         | `@evlog/nuxthub` 內建 retry（不需 `evlog-drain-pipeline` 額外包） |
| Enricher         | `evlog-enrichers-stack`（4 件 + tenant + cfGeo）                  |
| AI 子事件        | `evlog-ai-sdk-logger`（Workers AI / cost / tokens）               |
| Child logger     | `evlog-mcp-sse-child-logger`（SSE / MCP session）                 |
| Client transport | `evlog-client-transport`（標準）                                  |

## 安裝 SOP

1. 確認 consumer 已是 NuxtHub stack（`@nuxthub/core` 已裝、`hub.database = true`、`wrangler.jsonc` 有 D1 binding）。
2. ```bash
   pnpm add @evlog/nuxthub
   ```
   安裝過程會跳「Do you want to create a vercel.json with a cron schedule?」— Cloudflare Workers consumer 選 N（用 wrangler.toml）。
3. 把 `nuxt.config-snippet.ts` merge 進 consumer 的 `nuxt.config.ts`。
4. **Cloudflare Workers**：在 `wrangler.toml` 加 cron trigger：
   ```toml
   [triggers]
   crons = ["0 */4 * * *"]   # 每 4 小時跑一次 retention
   ```
5. **Vercel**：`@evlog/nuxthub` 安裝時自動建 `vercel.json`（如果你沒拒絕）。
6. `pnpm dev` 起 server，觸發 endpoint，到 NuxtHub admin / `wrangler d1 execute` 查 `_evlog` table 看 row。
7. Production smoke：deployed worker，cron 觸發後 retention 真的 drop 過期 row。

## D1 寫入限制

| 限制                              | 影響                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------- |
| 100 writes/s（free tier）         | 高量 consumer 必加 sampling 降 info 量                                          |
| 10MB 單一 statement               | batch 寫過大 row（含 attributes JSONB）會炸；retention cron 一次最多刪 1000 row |
| Cross-region eventual consistency | 寫入後 1-2s 才在所有 region 可見；debug 即時 query 可能 race                    |

對應對策：

- sampling：`info: 0.1`（10% 採樣），audit force-keep
- attributes 大 row：超過 100KB 的事件改走 `evlog-postgres-drain` 或 R2 cold storage
- Cross-region：讀取永遠 eventual；不用 D1 做 hot path query

## Retention 與 vercel.json / wrangler.toml

| Stack              | retention 觸發                                                 |
| ------------------ | -------------------------------------------------------------- |
| Vercel             | `vercel.json#crons[]` 觸發 `/api/_cron/evlog-cleanup`          |
| Cloudflare Workers | `wrangler.toml#triggers.crons` 觸發 `/api/_cron/evlog-cleanup` |

`@evlog/nuxthub` 自動加 cron handler；consumer 不用自己寫。

## sampling 與 redaction（必補）

NuxtHub 快滿時最痛。配 `evlog.sampling` 把 info 率降到 `0.1`：

```ts
evlog: {
  sampling: {
    byLevel: { error: 1.0, warn: 1.0, info: 0.1, debug: 0 },
  },
  redact: true,
}
```

production 不開 redact = PII 進 D1（`event.user.email` / `client.ua` 等）。

## 與其他 snippet 的關係

- `evlog-drain-pipeline/`：本 snippet **不需**這層（NuxtHub 內建 retry / batch）
- `evlog-sentry-drain/`：可並存（Sentry 接 hot path，D1 接 long-tail）— 對 agentic-rag 是 baseline
- `evlog-enrichers-stack/`：必裝，與 NuxtHub drain 並行運作（enricher 在 drain 之前）
- `evlog-ai-sdk-logger/`：T3 必補；AI cost / token 子事件進 D1 attributes
- `evlog-mcp-sse-child-logger/`：T3 必補；SSE / MCP session 用 child logger

## Consumer onboarding checklist（T3 baseline）

- [ ] `@nuxthub/core` + `@evlog/nuxthub` 都已裝，`hub.database = true`
- [ ] `wrangler.jsonc` 或 `wrangler.toml` 有 D1 binding `DB`
- [ ] cron schedule 已設（vercel.json 或 wrangler.toml triggers）
- [ ] `evlog.retention` 配置好（預設 `7d`；高合規 consumer 改 `30d`/`90d`）
- [ ] `evlog.sampling` info: 0.1（D1 100 writes/s 上限）
- [ ] `evlog.redact: true`（production）
- [ ] dev：觸發 endpoint 後 `wrangler d1 execute <db> 'SELECT count(*) FROM _evlog;'` 有 row
- [ ] production：cron 真的跑（檢查 `_evlog` 最舊 row 的 timestamp 不超過 retention）

## 何時不該用此 drain

- **無 NuxtHub stack**（5 consumer 中 4 個是 Supabase）：用 `evlog-postgres-drain`
- **量 > 100 writes/s**：D1 上限會丟；考慮升級 paid plan 或改用 Postgres
- **單一事件 > 100KB**：D1 row size 限制；改寫 R2 並只在 D1 存 reference
- **Cross-region 強一致需求**：D1 是 eventual；用 Postgres
