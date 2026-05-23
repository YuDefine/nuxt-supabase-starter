---
description: Cloudflare Workers / NuxtHub gating + wrangler.jsonc 格式統一 + deploy 命令規約。依 DB 選擇分派（D1 → NuxtHub mandatory；Supabase / 外部 DB → 禁帶 @nuxthub/core dep），杜絕 unused NuxtHub dep 污染與 wrangler 檔格式 drift
paths: ['wrangler.{toml,jsonc}', 'nuxt.config.*', 'package.json', '.github/workflows/**/*.yml']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/cloudflare-workers.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Cloudflare Workers / NuxtHub Configuration

> Fleet 內全部 active consumer + paused starter 都是「Nuxt + Nitro `cloudflare_module` preset + GitHub Actions `cloudflare/wrangler-action@v3` deploy」這個共通骨幹。差異只在 NuxtHub 是否該帶 + wrangler 檔該長什麼樣。
>
> Cookbook 範本：`~/offline/clade/vendor/snippets/cloudflare-workers/`。
>
> 與 [[data-layer-d1]] 互補：本 rule 規 **架構選擇 + 設定格式**；data-layer-d1 規 **D1 + Drizzle runtime sharp edges**（subquery alias、dev binding fallback、schema patch 等）。

## § 1 — DB-driven NuxtHub gating（hard rule）

**NuxtHub (`@nuxthub/core`) 的唯一實質作用是 Cloudflare 原生 binding (D1 / KV / R2 / AI / Vectorize / Durable Objects) 的 runtime 抽象**。不用這些 binding 的 consumer 帶 `@nuxthub/core` 是純冗餘 dep（增加 install 時間 + 污染 type space + 引入不必要的 lock-in），且 Fleet 內**沒有任何 consumer 使用 `nuxthub deploy`** — deploy 都走 `cloudflare/wrangler-action@v3`，所以 NuxtHub 也不提供 deploy 簡化。

### MUST

| 條件 | 規約 |
|---|---|
| Consumer 使用 **Cloudflare D1 / KV / R2 / AI** 作為 binding | **MUST** 在 `package.json` 帶 `@nuxthub/core` + 在 `nuxt.config.ts` 的 `modules` 登記 `'@nuxthub/core'` + 設 `hub: { db: 'sqlite', ... }` config + server code 用 `hubDatabase()` / `hubKV()` / `hubBlob()` 等 runtime helper 取 binding |
| Consumer 使用 **Supabase / Postgres / 純外部 DB**（**沒**用 D1/KV/R2/AI 任何一個） | **MUST NOT** 帶 `@nuxthub/core` 在 `package.json`；**MUST NOT** 在 `nuxt.config.ts` 登記 `@nuxthub/core` module |

### MUST NOT

- **MUST NOT** 同時把 `@nuxthub/core` 列在 `package.json dependencies` 但**未**登記為 module（這是「冗餘 dep」反模式，目前 fleet 內 4 個 consumer 命中此反例：<consumer-a> / <consumer-d> / <consumer-b> / nuxt-supabase-starter — 已由 2026-05-23 cloudflare-workers 標準化 sweep 修正）
- **MUST NOT** 在 NuxtHub 派 consumer 把 D1/KV/R2 bindings **同時**寫進 `wrangler.jsonc` 的 `d1_databases` / `kv_namespaces` / `r2_buckets` **與** `nuxt.config.ts` 的 `hub: {}` — 兩處宣告會造成 deploy time duplicate binding error。NuxtHub 派 bindings 來源 SoT 在 `nuxt.config.ts hub: {}`；wrangler.jsonc 只放 `name` / `compatibility_date` / `routes` / `vars` / `triggers` 等 NuxtHub 不管的欄位

### Why

- NuxtHub 對 Supabase consumer 幫不上忙：Supabase 走 HTTP API，binding 抽象沒用武之地
- Unused dep 會被 Nitro auto-import 掃到、type generator 帶進來、IDE 出現假 `hub*()` 補完，誤導 maintainer
- 已驗證移除安全：2026-05-23 對 4 個 Supabase consumer ripgrep `hub*()` API 呼叫 = 0

## § 2 — wrangler config format（hard rule）

### MUST

- **MUST** 使用 `wrangler.jsonc`（**禁** `wrangler.toml`）
  - Cloudflare wrangler 4.x 官方文檔 prefer jsonc：支援 `$schema` autocomplete、`//` 註解、跟 nuxt.config.ts 同 JS 系語法
  - 統一 audit script 解析路徑（避免雙 parser 維護）
- **MUST** 在根目錄存在 `wrangler.jsonc`（即使 minimal），至少含三個欄位：
  ```jsonc
  {
    "$schema": "node_modules/wrangler/config-schema.json",
    "name": "<worker-name>",
    "compatibility_date": "<YYYY-MM-DD>"
  }
  ```
  - 即使 Nitro `cloudflare_module` preset 會在 build 時生 `.output/server/wrangler.json`，根目錄仍需有 wrangler.jsonc 給 dev 階段（`wrangler types` / `wrangler dev --remote` / IDE schema）+ deploy 階段（CI 用 `--config` flag 指向時 fallback）
- **MUST** 用 `nitro: { preset: 'cloudflare_module', cloudflare: { deployConfig: true, nodeCompat: true } }` 在 `nuxt.config.ts`
  - `cloudflare_module` 是 wrangler 4.x 的 module-format Worker preset（**不**是 legacy `cloudflare-pages` 或 `cloudflare-module-legacy`）
  - `deployConfig: true` 讓 Nitro 把 wrangler.jsonc top-level 設定 merge 進 `.output/server/wrangler.json`
  - `nodeCompat: true` 對應 wrangler.jsonc 的 `"compatibility_flags": ["nodejs_compat"]`

### MUST NOT

- **MUST NOT** 同時存在 `wrangler.toml` 與 `wrangler.jsonc`（wrangler 會 prefer jsonc 但歧義性是 audit gap）
- **MUST NOT** 在 wrangler.jsonc 寫死 `main` entry path（如 `".output/server/index.mjs"`），除非該 consumer 有自家 build script 不走 nitro 標準 build。Nitro `cloudflare_module` preset 會自動產 entry，寫死 `main` 會跟 Nitro 自動生的部分衝突

## § 3 — Deploy command（hard rule）

### MUST

- **MUST** CI workflow（`.github/workflows/deploy*.yml`）使用 `cloudflare/wrangler-action@v3` action + `command: deploy`
  - 這是 fleet 全部 consumer 現狀（包含 NuxtHub 派 <consumer-c>），document 它作為標準
- **MUST** 在 wrangler-action step 指定 `workingDirectory: .output`（Nitro build 產出位於 `.output/`，`.output/server/wrangler.json` 是 deploy 用的真檔案）

### MUST NOT

- **MUST NOT** 在 CI 用 `npx nuxthub deploy`（NuxtHub 自家 deploy CLI）
  - 它走 NuxtHub admin pipeline、需要 `npx nuxthub link` 綁定 NuxtHub 帳號
  - 跟 GitHub Actions secrets sync 流程衝突（secrets 走 `wrangler-action` 的 `secrets` field）
  - Fleet 內 0 consumer 用此模式，引入會破壞 deploy uniformity
- **MUST NOT** 在 CI 直接 invoke `npx wrangler deploy`（沒 wrangler-action 包裝 → 失去 retry / log 結構化 / API token 自動注入）

## § 4 — Binding declaration（依派別分流）

### NuxtHub 派（D1 / KV / R2 / AI）

- **MUST** bindings 全在 `nuxt.config.ts` 的 `hub: {}` 宣告：
  ```ts
  hub: {
    db: 'sqlite',          // D1
    kv: true,              // KV
    blob: true,            // R2
    ai: true,              // Workers AI
  }
  ```
- **MUST NOT** 在 wrangler.jsonc 重複宣告 `d1_databases` / `kv_namespaces` / `r2_buckets` / `ai` — NuxtHub 會在 build 時自動補進 `.output/server/wrangler.json`，wrangler.jsonc 重複會造成 deploy error
- 例外：**`durable_objects` 必須**寫在 wrangler.jsonc（NuxtHub 沒 abstraction，必須走 raw），且配對的 `migrations` 也寫在 wrangler.jsonc

### raw 派（Supabase / 外部 DB）

- 若該 consumer 仍需要少量 Cloudflare binding（罕見），**直接**在 wrangler.jsonc 宣告：
  ```jsonc
  {
    "kv_namespaces": [{ "binding": "RATE_LIMIT_KV", "id": "..." }]
  }
  ```
- 否則 wrangler.jsonc 只含 `name` / `compatibility_date` / `compatibility_flags` / 可選 `routes` / `triggers` / `observability` / `vars` / `env.<name>` 多環境

## § 5 — 違反偵測

`scripts/audit-wrangler-config.mjs` 偵測：

1. 根目錄存在 `wrangler.toml`（應改 jsonc）→ `wrangler.format_drift`
2. 根目錄完全缺 wrangler 檔 → `wrangler.missing`
3. wrangler.jsonc 缺 `$schema` / `name` / `compatibility_date` → `wrangler.missing_required_field`
4. Supabase consumer 帶 `@nuxthub/core` dep → `nuxthub.redundant_dep`
5. D1 consumer 缺 `@nuxthub/core` module 登記 → `nuxthub.missing_required`
6. NuxtHub 派 wrangler.jsonc 重複宣告 D1/KV/R2 bindings → `binding.duplicate_declaration`
7. CI workflow 用 `nuxthub deploy` 或直接 `wrangler deploy` → `deploy.non_standard_command`

每個 violation 帶 `consumer_id` + `path` + `rule_section` reference，per [[improvement-loop]] 五項分層 metric report。

## § 6 — Fleet 現況基準（2026-05-23 標準化後）

| Consumer | DB | NuxtHub 派 | wrangler 格式 |
|---|---|---|---|
| <consumer-c> | Cloudflare D1 | ✅ | wrangler.jsonc |
| rental-scout | Cloudflare D1 | ✅ | wrangler.jsonc |
| co-purchase | Cloudflare D1 | ✅ | wrangler.jsonc |
| <consumer-a> | Supabase | ❌ | wrangler.jsonc |
| <consumer-d> | Supabase | ❌ | wrangler.jsonc |
| <consumer-b> | Supabase | ❌ | wrangler.jsonc |
| nuxt-supabase-starter | Supabase | ❌ | wrangler.jsonc |

未來新 consumer 加入時，依此表決定派別 + 跟 cookbook 對齊。改派（例：某 consumer 從 Supabase 遷到 D1）必須同步補 `@nuxthub/core` + 改 `hub: {}` config + 跑 audit 重驗。
