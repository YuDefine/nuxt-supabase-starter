---
description: Cloudflare Workers / NuxtHub gating + wrangler.jsonc 格式統一 + deploy 命令規約（dual-track：wrangler-action / void.cloud）。依 DB 選擇分派（D1 → NuxtHub mandatory；Supabase / 外部 DB → 禁帶 @nuxthub/core dep），杜絕 unused NuxtHub dep 污染、wrangler 檔格式 drift、以及 void.cloud track 的 compat_flags 致命誤配
paths: ['wrangler.{toml,jsonc}', 'void.json', 'nuxt.config.*', 'package.json', '.github/workflows/**/*.yml']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/cloudflare-workers.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Cloudflare Workers / NuxtHub Configuration

> Fleet 內絕大多數 consumer 走 **「Nuxt + Nitro `cloudflare_module` preset + GitHub Actions `cloudflare/wrangler-action@v3` deploy」** 共通骨幹（Track A — wrangler-action）。少數 consumer 改走 **void.cloud**（Track B — VoidZero 部署平台，建在 Cloudflare Workers 上；current SDK 以 official Nuxt integration 與 OIDC workflow 為準）。
>
> 差異維度：(1) NuxtHub 是否該帶 (2) wrangler 檔該長什麼樣 (3) deploy 派別（wrangler-action vs void.cloud）。
>
> Cookbook 範本：`~/offline/clade/vendor/snippets/cloudflare-workers/`。
>
> 與 [[data-layer-d1]] 互補：本 rule 規 **架構選擇 + 設定格式 + deploy track**；data-layer-d1 規 **D1 + Drizzle runtime sharp edges**（subquery alias、dev binding fallback、schema patch 等）。
> 與 `/yudefine-deploy` skill 互補：本 rule 規 **跨 fleet 通用 hard rule**；skill 規 **YuDefine fleet 部署 SOP**（含 void.cloud Step 3A 決策樹詳述）。

## § 1 — DB × deploy track NuxtHub gating（hard rule）

**NuxtHub (`@nuxthub/core`) 的唯一實質作用是 wrangler-action deploy track 上的 Cloudflare 原生 binding (D1 / KV / R2 / AI / Vectorize / Durable Objects) 的 runtime 抽象**。它**不**提供 deploy 簡化（fleet 內目前無 consumer 用 `nuxthub deploy`，以 registry 為準），而且：

- 不用 D1/KV/R2/AI 的 consumer（Supabase / Postgres / 純外部 DB）帶 `@nuxthub/core` 是純冗餘 dep
- **void.cloud track**（即使用 D1）帶 `@nuxthub/core` 也是冗餘 — void 提供自家 `void/db` + `void/schema-d1` abstraction，與 NuxtHub helper 同層但獨立

### MUST（採二維 matrix 判定）

| Deploy track | DB | 規約 |
|---|---|---|
| **Track A (wrangler-action)** | Cloudflare D1 / KV / R2 / AI | **MUST** 在 `package.json` 帶 `@nuxthub/core` + 在 `nuxt.config.ts` `modules` 登記 + 設 `hub: { db: 'sqlite', ... }` + server code 用 `hubDatabase()` / `hubKV()` / `hubBlob()` |
| **Track A (wrangler-action)** | Supabase / Postgres / 純外部 DB | **MUST NOT** 帶 `@nuxthub/core` |
| **Track B (void.cloud)** | D1（void 自家 provision）| **MUST NOT** 帶 `@nuxthub/core`；自己寫 `server/utils/db.ts` 包 `createDb(env.DB)` + `server/utils/blob.ts` 包 R2 raw binding（範本見 `/yudefine-deploy` Phase 5）|
| **Track B (void.cloud)** | 純外部 DB（罕見）| **MUST NOT** 帶 `@nuxthub/core`（同上） |

### MUST NOT

- **MUST NOT** 同時把 `@nuxthub/core` 列在 `package.json dependencies` 但**未**登記為 module（這是「冗餘 dep」反模式，目前 fleet 內 4 個 consumer 命中此反例：<consumer-a> / <consumer-d> / <consumer-b> / nuxt-supabase-starter — 已由 2026-05-23 cloudflare-workers 標準化 sweep 修正）
- **MUST NOT** 把同一個 binding 同時宣告在兩處 — 例如 `hub.db.connection.databaseId` 已指定的 binding 又出現在 `wrangler.jsonc d1_databases`。**詳見 § 4 § 4.3 衝突偵測**
- **MUST NOT** 在 void.cloud track consumer 保留 `@nuxthub/core` dep 不刪（即使 module 未登記）— migration 時典型 leftover，要清乾淨避免 type space 污染

### Why

- NuxtHub 對 Supabase consumer 幫不上忙：Supabase 走 HTTP API，binding 抽象沒用武之地
- void.cloud + D1 場景下，`void/db` + `env.DB` raw R2 已足夠；NuxtHub helper 在此 track 沒對應 runtime injection 機制（void 不 auto-import `hub*()`）
- Unused dep 會被 Nitro auto-import 掃到、type generator 帶進來、IDE 出現假 `hub*()` 補完，誤導 maintainer
- 已驗證移除安全：2026-05-23 對 4 個 Supabase consumer ripgrep `hub*()` API 呼叫 = 0；2026-05-26 對 co-purchase（void.cloud migrate 後）同樣驗證 `hub*()` 呼叫 = 0

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

## § 3 — Deploy command（hard rule，dual-track）

### § 3.1 Track A — wrangler-action（**default**，fleet 多數）

#### MUST

- **MUST** CI workflow（`.github/workflows/deploy*.yml`）使用 `cloudflare/wrangler-action@v3` action + `command: deploy`
  - Fleet 多數 consumer 走此 track；包含 NuxtHub 派與 Supabase 派
- **MUST** 在 wrangler-action step 指定 `workingDirectory: .output`（Nitro build 產出位於 `.output/`，`.output/server/wrangler.json` 是 deploy 用的真檔案）

#### MUST NOT

- **MUST NOT** 在 CI 用 `npx nuxthub deploy`（NuxtHub 自家 deploy CLI）
  - 它走 NuxtHub admin pipeline、需要 `npx nuxthub link` 綁定 NuxtHub 帳號
  - 跟 GitHub Actions secrets sync 流程衝突（secrets 走 `wrangler-action` 的 `secrets` field）
  - Fleet 內目前無 consumer 用此模式（以 registry 為準），引入會破壞 deploy uniformity
- **MUST NOT** 在 CI 直接 invoke `npx wrangler deploy`（沒 wrangler-action 包裝 → 失去 retry / log 結構化 / API token 自動注入）

### § 3.2 Track B — void.cloud（2026-07-14 current baseline）

走 [void.cloud](https://void.cloud) VoidZero 部署平台的 consumer（建在 Cloudflare Workers 上，但 deploy pipeline 由 void 接管）。Fleet 採用：yudefine-blog、co-purchase、quotation-generator（migration 中）。

#### MUST

- **MUST** 跑 `npx void init --agents` 取得 official void skill + MCP — 這會 symlink `.claude/skills/void/` + `.claude/skills/migrate-vite-cloudflare-to-void/`（跟 `void` npm package version lockstep）、寫 `void mcp` 進 `.claude/settings.json`、patch `CLAUDE.md` + `.gitignore` + `nuxt.config.ts`（voidPlugin auto-patch）
- **MUST** 後續 void CLI / config / runtime helper / `env.ts` / migration 等通用知識**走 official `void` skill 或 `void mcp`** (`search_docs` / `get_page docs/<path>.md`)；**NEVER** 從 consumer-side rule / project-specific note 複製 void CLI 命令當權威 — 那些 cache 容易跟 void 升版 drift
- **MUST** 新建或升級中的 consumer 使用 current `void@0.10.x`；`void@0.8.x` 只視為 legacy migration 狀態，不再當 current baseline
- **MUST** 在根目錄存在 `void.json`，至少含 `target: "cloudflare"` 與 framework inference；保留 `wrangler.jsonc` 給 Nuxt dev、IDE schema 與 compatibility config
- **MUST** `void@0.8.x` 的 `void.json.worker.compatibility_flags` 依 `inference.appType` 分流：
  - **`appType: "framework"` (Nuxt / SvelteKit / Astro 等)**：**MUST** 走**配置 3**（`["nodejs_compat", "nodejs_als", "no_nodejs_compat_v2"]`）— 顯式停 workerd 原生 v2，unenv v1 polyfill 獨佔。配置 2（純 v2）對 Nitro `cloudflare-module` preset **不可用** — Nitro build 主動 warn「`Please consider replacing nodejs_compat_v2 with nodejs_compat ... or USE IT AT YOUR OWN RISK as it can cause issues with nitro`」+ deploy 撞 `Cannot read private member #t in get stdout`（yudefine-blog 2026-05-27 first-ever CI deploy 實證；blog 之前 prod live 是 user 本機 manual deploy 沒踩到）
  - **`appType: "void"` (pure Vite+ void app，無 meta framework)**：**MUST** 走**配置 2**（`["nodejs_compat_v2", "nodejs_als"]`）— 直接吃 workerd 原生 v2，無 Nitro 中間層 polyfill 衝突
- **MUST** `wrangler.jsonc` 的 `compatibility_flags` 與 `void.json` **對齊**，避免 dev / prod 行為漂移；current void 可從 wrangler config 讀取 compatibility settings，不能再假設 deploy 永遠忽略 wrangler config
- **MUST** GitHub Actions 使用 void.cloud 的 GitHub OIDC：workflow 加 `permissions: { contents: read, id-token: write }`，以 `void github connect <project> --repo <owner/repo> --executor github_actions` 做一次性授權；**不使用**長效 `VOID_TOKEN`
- **MUST** CI workflow 走 `pnpm run void:deploy`（內部使用 local `void deploy`），並以 `VOID_PROJECT` 明確指定 project slug
- **MUST** package.json 帶 current `void@0.10.x`（**不是** legacy `@void-sdk/void@^0.6.x` 或 `void@0.8.x`）
- **MUST** 在 `pnpm-workspace.yaml` 把 `vite` / `vitest` override 成 VoidZero fork（voidPlugin 需要 `parseSync` export，純 vite 沒有）
- **MUST** `package.json scripts` 內 void deploy 命令**不可命名** `deploy` — pnpm 把 `deploy` 當保留字（workspace deploy 命令），跑 `pnpm deploy` 撞 `ERR_PNPM_NOTHING_TO_DEPLOY` 不會觸發 script。改用 `void:deploy`（或其他帶 prefix 的 name）；CI workflow / chat 引用走 `pnpm run void:deploy`。詳見 `docs/pitfalls/2026-05-27-pnpm-deploy-reserved-word.md`
- **MUST** `void.json` + `wrangler.jsonc` 的 `compatibility_date` 對齊 official void Nuxt example（`.claude/skills/void/docs/integrations/frameworks/nuxt.md`；2026-07-14 驗證的範例為 `2026-02-24`）— 保持跟 official 已驗證範例同步，避免不必要的 baseline drift
- **MUST** 只有仍停在 legacy `void@0.8.x` 且使用 `void/schema-d1` 的 consumer 暫時保留 `patch-void-deploy.mjs`；上游 issue [void-sdk/void#52](https://github.com/void-sdk/void/issues/52) 已於 2026-05-27 關閉並在當日 release 修正，升到 current void 後**必須移除** patch、postinstall hook 與 `patchedDependencies`
- **MUST** deploy 走 `pnpm run void:deploy`（pnpm script，PATH 把 `node_modules/.bin` 放最前 → 用 **local** void）— deploy-time Drizzle drift-check spawn 的 drizzle-kit 由 `import.meta.resolve("drizzle-kit")` 從 **void module 自己位置**解析；local void 解析到 consumer node_modules 的 drizzle-kit（能 resolve peer drizzle-orm），global void（PATH 直跑 `void`，pnpm global bin）解析到 global store 的 drizzle-kit → 找不到 consumer peer drizzle-orm → drift-check 撞 `Please install latest version of drizzle-orm`。**與 node-linker 無關**（isolated + local void 已實測通過，**NEVER** 為此改 `.npmrc` `node-linker=hoisted`）。詳見 [pitfall](../../docs/pitfalls/2026-05-28-void-deploy-drift-check-global-vs-local-void.md)

#### MUST NOT

- **MUST NOT** `void@^0.8.x` 用配置 1（`["nodejs_compat", "nodejs_als"]` 不含 `no_nodejs_compat_v2`）— legacy SDK 會撞 worker upload err 10021。這是 0.8 限定 workaround，**不得**套用成 current void 0.10 的通則。詳見 [pitfall doc](../../docs/pitfalls/2026-05-25-void-cloud-voidjson-compat-flags-10021.md)
- **MUST NOT** legacy `void@0.8.x` 的 `appType: "framework"` consumer 用配置 2（純 v2）— 同樣撞 `#t` error。這條限制不得無版本區分地套到 current void
- **MUST NOT** 在 current void 0.10 consumer 保留 `patch-void-deploy.mjs` 或 unenv patch；這些 workaround 只屬 legacy void 0.8
- **MUST NOT** 用 nitro `cloudflare.nodeCompat` 取代平台 compatibility config；legacy 0.8 以 void.json 為準，current void 依 official integration 的 wrangler / void config 契約
- **MUST NOT** 在 GitHub Actions 保存 `VOID_TOKEN`；deploy 身分走 GitHub OIDC。runtime secrets 走 `void secret put`，不得混入 wrangler-action 的 Cloudflare secret 流程

#### legacy void 0.8 的 config 陷阱

Nitro `cloudflare-module` preset build 時會在 `.output/server/wrangler.json` 自動加 `no_nodejs_compat_v2`，但 legacy void 0.8 deploy 曾只採用 `void.json.worker.compatibility_flags`，導致兩份 config 漂移。current void 已能從 wrangler config 讀取 compatibility settings；保留兩份檔時仍應對齊，並以 current official integration 為準。

→ Fleet 為什麼沒事到 2026-05：所有 wrangler-action consumer 讀 `.output/server/wrangler.json`，flag 自動對齊；只有 void.cloud track 暴露 void.json 與 wrangler.json 的 flag 落差。yudefine-blog（2026-05-25）+ co-purchase（2026-05-27）兩例撞 10021 後 promote 成本 §。

#### void.cloud 派可帶 NuxtHub 嗎

**不帶**。void.cloud 自己提供 `void/db` runtime helper + `void/schema-d1` schema 抽象（thin re-export of `drizzle-orm/sqlite-core`），與 NuxtHub `hubDatabase()` / `hubBlob()` 同層級但獨立。void.cloud 派 consumer 應該：

- **MUST NOT** 帶 `@nuxthub/core` 在 `package.json`
- **MUST NOT** 在 `nuxt.config.ts` 登記 `@nuxthub/core` module
- **MUST** 自己寫 `server/utils/db.ts` + `blob.ts` helper 包 `createDb(env.DB)` + `env.BLOB` raw R2 binding（範本見 `/yudefine-deploy` skill Phase 5）

→ § 1 DB-driven NuxtHub gating 第二列「Supabase / Postgres / 純外部 DB」**對 void.cloud + D1 也適用**（雖然底層是 D1，但 NuxtHub abstraction 用不上 = 冗餘 dep）。

## § 4 — Binding declaration（依 track + binding 複雜度分派）

依 deploy track 與 binding 複雜度分五個 sub-section：

- § 4.1 / § 4.2：Track A (wrangler-action) + NuxtHub 派內 Pattern A / B
- § 4.3：兩派共通衝突偵測
- § 4.4：Track A + 純外部 DB（無 NuxtHub）
- § 4.5：Track B (void.cloud) + D1（void provision）

Track A 的 NuxtHub 派內部依 binding 複雜度有兩個合法 pattern：

### § 4.1 Pattern A — hub.db 內含 connection（**default**）

binding ID 寫進 `nuxt.config.ts` 的 `hub.db.connection`，**禁**寫進 wrangler.jsonc。適合 D1 only 或 D1 + 少量 binding 的 consumer。

```ts
// nuxt.config.ts
hub: {
  db: {
    dialect: 'sqlite',
    ...(process.env.NITRO_PRESET?.includes('cloudflare')
      ? {
          driver: 'd1' as const,
          connection: { databaseId: '<d1-database-id>' },
        }
      : {}), // dev 走 local sqlite/libsql（dev binding fallback，見 d1-drizzle cookbook）
  },
}
```

```jsonc
// wrangler.jsonc — 完全不寫 d1_databases
{
  "name": "<consumer>",
  "compatibility_date": "...",
  "routes": [...]
}
```

**Pattern A 優勢**：
- Single SoT — 改 binding 一次，整套生效
- **dev binding fallback**：用 `process.env.NITRO_PRESET` 條件切換 local sqlite / prod D1（wrangler.jsonc 沒法寫 conditional），dev 不用 wrangler dev 就能跑
- 對齊 `vendor/snippets/d1-drizzle/nuxthub-dev-binding-fallback.ts` cookbook

**Fleet 採用**：rental-scout（co-purchase 2026-05-26 前採此 pattern，遷 void.cloud 後改走 § 4.5）

### § 4.2 Pattern B — wrangler.jsonc 完整宣告 + hub: 啟用 helper（**例外**）

binding ID 寫進 `wrangler.jsonc`（標準 Cloudflare 格式），`hub: {}` 只啟用 runtime helper。適合 binding 複雜（Durable Objects + AI Gateway 自訂 + multi-binding）的 consumer。

```ts
// nuxt.config.ts
hub: {
  db: 'sqlite',  // ← 簡形：只啟用 hubDatabase() helper，binding 細節走 wrangler
  kv: true,
  blob: true,
}
```

```jsonc
// wrangler.jsonc — 完整宣告所有 binding ID
{
  "d1_databases": [{ "binding": "DB", "database_id": "..." }],
  "kv_namespaces": [{ "binding": "KV", "id": "..." }],
  "r2_buckets": [{ "binding": "BLOB", "bucket_name": "..." }],
  "ai": { "binding": "AI" },
  "durable_objects": { "bindings": [...] }
}
```

**Pattern B 適用場景**：
- 有 **Durable Objects**（NuxtHub 無 abstraction，**必須**寫 wrangler.jsonc，那其他 binding 一起寫也合理保持 SoT 一致）
- 有 **AI Gateway 自訂 routing / cache config**（hub.ai: true 不夠用）
- 多 binding（D1 + KV + R2 + AI + DO + custom migrations）

**Fleet 採用**：<consumer-c>（有 DO + AI + 5 種 binding + custom DO migrations）

### § 4.3 衝突偵測（hard rule）

**MUST NOT** 把同一 binding 同時宣告在兩處 — audit 偵測：

| 反例 | 說明 |
|---|---|
| `hub.db.connection.databaseId` 已設 **且** wrangler.jsonc 有 `d1_databases` | Pattern A + B 混用，deploy 時 duplicate binding error |
| `hub.kv` 為物件含 `id` **且** wrangler.jsonc 有 `kv_namespaces` | 同上 |
| `hub.blob` 為物件含 `bucketName` **且** wrangler.jsonc 有 `r2_buckets` | 同上 |

純 `hub.db: 'sqlite'`（簡形）配 wrangler.jsonc `d1_databases` 是 Pattern B 正常用法，**不**算衝突。

### § 4.4 raw 派（Supabase / 外部 DB；Track A wrangler-action）

- 若該 consumer 仍需要少量 Cloudflare binding（罕見），**直接**在 wrangler.jsonc 宣告：
  ```jsonc
  {
    "kv_namespaces": [{ "binding": "RATE_LIMIT_KV", "id": "..." }]
  }
  ```
- 否則 wrangler.jsonc 只含 `name` / `compatibility_date` / `compatibility_flags` / 可選 `routes` / `triggers` / `observability` / `vars` / `env.<name>` 多環境

### § 4.5 void.cloud 派（Track B）

void.cloud + D1 走第三種 binding pattern — D1 / R2 binding ID 由 void provision，**不**寫死在任何 config 檔。

```jsonc
// void.json — void.cloud deploy 真相層
{
  "$schema": "./node_modules/void/schema.json",
  "target": "cloudflare",
  "inference": {
    "appType": "framework",
    "build": "pnpm build",
    "scanDirs": ["server", "db"],
    "bindings": {
      "db": true,           // ← 聲明要 D1，void deploy 自動 provision
      "storage": "BLOB"     // ← 聲明要 R2，void deploy 自動 provision
    }
  },
  "worker": {
    "compatibility_date": "2026-02-24",
    "compatibility_flags": ["nodejs_compat", "nodejs_als", "no_nodejs_compat_v2"]  // ← per § 3.2
  }
}
```

```jsonc
// wrangler.jsonc — 給 IDE schema + dev binding（不寫死 prod ID）
{
  "name": "<consumer>",
  "compatibility_date": "2026-02-24",
  "compatibility_flags": ["nodejs_compat", "nodejs_als", "no_nodejs_compat_v2"],  // ← 對齊 void.json
  "d1_databases": [{
    "binding": "DB",
    "database_name": "default",
    "database_id": "local",                   // ← 占位，void 在 deploy 時 merge 真實 ID
    "migrations_dir": "db/migrations"
  }],
  "r2_buckets": [{
    "binding": "BLOB",
    "bucket_name": "<consumer>-blob"
  }]
}
```

```ts
// nuxt.config.ts — 不帶 @nuxthub/core，加 voidPlugin
import { voidPlugin } from 'void'
export default defineNuxtConfig({
  modules: [/* NO '@nuxthub/core' */],
  vite: { plugins: [voidPlugin()] },
  nitro: { preset: process.env.NITRO_PRESET?.includes('cloudflare') ? 'cloudflare-module' : undefined },
})
```

```ts
// server/utils/db.ts — 取代 NuxtHub 的 hubDatabase()
import type { H3Event } from 'h3'
import { createDb } from 'void/db'
import * as schema from '@schema'

let cachedDb: ReturnType<typeof createDb> | undefined
export function getDb(event: H3Event) {
  if (!cachedDb) cachedDb = createDb(event.context.cloudflare.env.DB)
  return cachedDb
}
```

詳細遷移 runbook（Phase 1-10）+ Schema migration 與 NuxtHub `blob.put` API 差異等 sharp edges 見 `/yudefine-deploy` skill。

**Fleet 採用**：yudefine-blog、co-purchase、quotation-generator（migration 中）

## § 5 — 違反偵測

`scripts/audit-wrangler-config.mjs` 偵測：

1. 根目錄存在 `wrangler.toml`（應改 jsonc）→ `wrangler.format_drift`
2. 根目錄完全缺 wrangler 檔 → `wrangler.missing`
3. wrangler.jsonc 缺 `$schema` / `name` / `compatibility_date` → `wrangler.missing_required_field`
4. Track A + Supabase consumer 帶 `@nuxthub/core` dep → `nuxthub.redundant_dep`
5. Track A + D1 consumer 缺 `@nuxthub/core` module 登記 → `nuxthub.missing_required`
6. NuxtHub 派 binding 同時宣告在 hub.* connection + wrangler.jsonc → `binding.duplicate_declaration`（per § 4.3）
7. Track A consumer CI workflow 用 `nuxthub deploy` 或直接 `wrangler deploy` → `deploy.non_standard_command`
8. Track B legacy 偵測 — 根目錄存在 `void.json` 且 `package.json` 含 `void@^0.8.x`（不是 `@void-sdk/void`）時，檢查 `void.json.worker.compatibility_flags`：
   - 含 `nodejs_compat` 但**不含** `nodejs_compat_v2` 且**不含** `no_nodejs_compat_v2` → `void.compat_flags_unsafe`（配置 1 in void@^0.8 = 必撞 10021）
   - `wrangler.jsonc` `compatibility_flags` ≠ `void.json` `worker.compatibility_flags` → `void.compat_flags_drift`（IDE / dev parity gap）
   - **（新增 2026-05-27 PM）** `inference.appType: "framework"` + `compatibility_flags` 為配置 2（純 `["nodejs_compat_v2", "nodejs_als"]`，無 `no_nodejs_compat_v2`）→ `void.compat_flags_unsafe_framework`（framework type 用配置 2 撞 Nitro polyfill 衝突 + `#t` error）
9. **（新增 2026-05-27）** Track B + 帶 `@nuxthub/core` dep → `void.redundant_nuxthub_dep`（per § 1 矩陣第三/四列）
10. Legacy `void@0.8.x` + `void.json inference.bindings.db: true`（或 `db/schema.ts` 含 `void/schema-d1` import）但 `package.json scripts.postinstall` 不含 `patch-void-deploy.mjs` 呼叫 → `void.missing_handler_emit_patch`；current void 不檢查此已修正 workaround
11. Track B npm scripts 使用 pnpm 保留字（例如 `deploy`）→ `pnpm.reserved_script_name`
12. Current void workflow 仍使用 `VOID_TOKEN` 或缺 `permissions.id-token: write` → `void.legacy_token_auth` / `void.missing_oidc_permission`
13. self-hosted runner 使用 `cache: pnpm` → `ci.self_hosted_pnpm_cache`

每個 violation 帶 `consumer_id` + `path` + `rule_section` reference，per [[improvement-loop]] 五項分層 metric report。

> Audit script 對 Track 的判定：根目錄存在 `void.json` 且 `package.json` 含 `void` dep（非 `@void-sdk/void@<0.8`）→ Track B；否則 → Track A。

## § 6 — Fleet 現況基準（2026-07-14 更新）

| Consumer | DB | Deploy track | NuxtHub | void.json compat flags |
|---|---|---|---|---|
| <consumer-c> | Cloudflare D1 | A (wrangler-action) | ✅ | n/a |
| rental-scout | Cloudflare D1 | A (wrangler-action) | ✅ | n/a |
| <consumer-a> | Supabase | A (wrangler-action) | ❌ | n/a |
| <consumer-d> | Supabase | A (wrangler-action) | ❌ | n/a |
| <consumer-b> | Supabase | A (wrangler-action) | ❌ | n/a |
| nuxt-supabase-starter | Supabase | A (wrangler-action) | ❌ | n/a |
| **co-purchase** | Cloudflare D1（void 自管）| **B (void.cloud)** | ❌ | legacy 0.8：配置 3（v1 + no_v2）+ patch-void-deploy；待升 current void 後退役 patch |
| **yudefine-blog** | Cloudflare D1（void 自管，via @nuxt/content adapter）| **B (void.cloud)** | ❌ | current void 0.10；配置 3 沿用已驗證 production baseline；workflow 已改 GitHub OIDC，需一次性 connect |
| quotation-generator（非 registry）| Cloudflare D1（void 自管）| B (void.cloud) | ❌ | main：配置 1 + `@void-sdk/void@^0.6.x` 舊 SDK；vp-void-migration worktree：配置 3 + `void@^0.8.x` |

未來新 consumer 加入時，依此表決定派別 + 跟 cookbook 對齊。改派（例：某 consumer 從 Supabase 遷 D1、從 wrangler-action 遷 void.cloud）必須同步：

- 改 Track A → B：移除 `@nuxthub/core` + 建 void.json + 加 voidPlugin + 寫 `server/utils/db.ts` + `blob.ts` helper + 改 deploy.yml 走 `pnpm run void:deploy` + GitHub OIDC（詳見 `/yudefine-deploy` Phase 1-10 runbook）
- 改 Supabase → D1（Track A）：補 `@nuxthub/core` + 改 `hub: {}` config + 跑 audit 重驗
- 跑 audit script 重驗（`scripts/audit-wrangler-config.mjs`）必須 0 violation 才算改派完成

## § 7 — Self-hosted runner CI 反 pattern

YuDefine fleet 多個 consumer（rental-scout / co-purchase / yudefine-blog）的 CI / deploy workflow 跑在自架 runner `runs-on: [self-hosted, gh-runner-lxc]`（YuDefine LXC，省 GitHub-hosted minutes）。Self-hosted runner 跟 GitHub-hosted runner 有兩個關鍵差異，沿用 GitHub-hosted 的 workflow 寫法會踩坑：

### § 7.1 — NEVER `cache: pnpm`（用 LXC 本地 persistent store）

`actions/setup-node` 的 `cache: pnpm`（與 `actions/cache`）走 **GitHub Actions cache backend**（cross-Atlantic object store）。GitHub-hosted runner 每次 fresh VM、cache restore 划算；但 self-hosted LXC runner **檔案系統 persistent**（跨 job 留存），改走 GHA cache backend 反而把本地已有的 store 換成跨洋下載 227MB tarball（實測 ~37s），純損失。

- **NEVER** 在 self-hosted runner 的 `actions/setup-node` 加 `cache: pnpm`（或任何 `actions/cache` step 快取 pnpm store）
- **MUST** 改用 LXC 本地 persistent store：

  ```yaml
  - name: Install node
    uses: actions/setup-node@v6
    with:
      node-version: 24
      # 不用 cache: pnpm — GHA cache backend 對 self-hosted runner 反 pattern
      # （cross-Atlantic 227MB tarball ~37s）。改用 LXC 本地 persistent store。

  - name: Configure pnpm store
    run: pnpm config set store-dir "$HOME/.pnpm-store"

  - name: Install dependencies
    run: pnpm install --frozen-lockfile
  ```

- store 路徑（`$HOME/.pnpm-store`）在 LXC 跨 job 留存 → 第二次 install 直接命中本地，毋須任何 cache action

### § 7.2 — CI 看不到 gitignored env / 本機 link state

Self-hosted runner 的 working dir 是 `actions/checkout` clone 的乾淨 repo，**只含 tracked file**。`.env` / `.env.local` / void link state（`.void/project.json`）/ NuxtHub link state 都 gitignored，CI **拿不到**。

- **NEVER** 在 workflow 假設 `.env*` / 本機 link state 存在（self-hosted runner 不繼承開發者本機檔案，跟 GitHub-hosted 一樣乾淨）
- **MUST** Track B deploy 身分走 GitHub OIDC；workflow 明確設定 project slug，但不注入長效 token：

  ```yaml
  permissions:
    contents: read
    id-token: write

  - name: Deploy via void
    run: pnpm run void:deploy
    env:
      # VOID_PROJECT 對應本機 .void/project.json 的 slug；CI 拿不到本機 link state，
      # 必須 env 顯式給（slug 從 `void project list` 取）。
      VOID_PROJECT: <consumer-slug>
  ```

  - Track A（wrangler-action）：CF token 走 `cloudflare/wrangler-action@v3` 的 `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}`
  - Track B（void.cloud）：GitHub OIDC + `VOID_PROJECT`（link state 不在 CI，slug 必顯式給）
- **MUST** runtime app secret（DB URL / session secret 等）由 user 在平台端預設一次（Track B：`void secret put <NAME>`；wrangler：`wrangler secret put`），**不**從 GH Actions 注入 runtime secret

完整 workflow 範本見 `~/offline/clade/vendor/snippets/cloudflare-workers/self-hosted-runner-ci.workflow.yml.template`。

### § 7.3 — Fleet 現況

| Consumer | runs-on | `cache: pnpm` 已移除 | LXC store-dir | env via secrets |
| --- | --- | --- | --- | --- |
| co-purchase | self-hosted, gh-runner-lxc | ✅ | ✅ | legacy VOID_TOKEN；待遷 GitHub OIDC |
| rental-scout | self-hosted, gh-runner-lxc | ❌（仍 `cache: pnpm`） | ❌ | — |
| yudefine-blog | self-hosted, gh-runner-lxc | ✅ | ✅ | GitHub OIDC + VOID_PROJECT |

yudefine-blog 的 `.github/workflows/deploy.yml` 是 current void.cloud + GitHub OIDC reference；co-purchase / rental-scout 的遷移屬 consumer 自家工作（clade 只散播標準 + 稽核，不替 consumer 改 workflow）。
