---
description: Cloudflare Workers / NuxtHub gating + wrangler.jsonc 格式統一 + deploy 命令規約（dual-track：wrangler-action / void.cloud）。依 DB 選擇分派（D1 → NuxtHub mandatory；Supabase / 外部 DB → 禁帶 @nuxthub/core dep），杜絕 unused NuxtHub dep 污染、wrangler 檔格式 drift、以及 void.cloud track 的 compat_flags 致命誤配
paths: ['wrangler.{toml,jsonc}', 'void.json', 'nuxt.config.*', 'package.json', '.github/workflows/**/*.yml']
---
<!-- Clade native rule; source: rules/core/cloudflare-workers.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Cloudflare Workers / NuxtHub Configuration

> 兩條 deploy track：**Track A**（Nitro `cloudflare_module` preset + `cloudflare/wrangler-action@v3`，default）與 **Track B**（void.cloud，建在 Workers 上）。Cookbook：`~/offline/clade/vendor/snippets/cloudflare-workers/`。D1 + Drizzle runtime 細節見 [[data-layer-d1]]；YuDefine 部署 SOP 見 `/yudefine-deploy` skill。

## § 1 — DB × deploy track NuxtHub gating（hard rule）

NuxtHub (`@nuxthub/core`) 唯一的作用是 Track A 上 Cloudflare 原生 binding（D1 / KV / R2 / AI / DO）的 runtime 抽象；外部 DB consumer 與 void.cloud track（自帶 `void/db`）帶它都是冗餘 dep（會污染 auto-import 與 type space）。

### MUST（採二維 matrix 判定）

| Deploy track | DB | 規約 |
|---|---|---|
| **Track A (wrangler-action)** | Cloudflare D1 / KV / R2 / AI | **MUST** 在 `package.json` 帶 `@nuxthub/core` + 在 `nuxt.config.ts` `modules` 登記 + 設 `hub: { db: 'sqlite', ... }` + server code 用 `hubDatabase()` / `hubKV()` / `hubBlob()` |
| **Track A (wrangler-action)** | Supabase / Postgres / 純外部 DB | **MUST NOT** 帶 `@nuxthub/core` |
| **Track B (void.cloud)** | D1（void 自家 provision）| **MUST NOT** 帶 `@nuxthub/core`；自己寫 `server/utils/db.ts` 包 `createDb(env.DB)` + `server/utils/blob.ts` 包 R2 raw binding（範本見 `/yudefine-deploy` Phase 5）|
| **Track B (void.cloud)** | 純外部 DB（罕見）| **MUST NOT** 帶 `@nuxthub/core`（同上） |

### MUST NOT

- **MUST NOT** 同時把 `@nuxthub/core` 列在 `package.json dependencies` 但**未**登記為 module（「冗餘 dep」反模式）
- **MUST NOT** 把同一個 binding 同時宣告在兩處 — 例如 `hub.db.connection.databaseId` 已指定的 binding 又出現在 `wrangler.jsonc d1_databases`。**詳見 § 4 § 4.3 衝突偵測**
- **MUST NOT** 在 void.cloud track consumer 保留 `@nuxthub/core` dep 不刪（即使 module 未登記）— migration 時典型 leftover，要清乾淨避免 type space 污染

移除前先 ripgrep `hub*()` API 呼叫，確認為 0 再刪 dep。

## § 2 — wrangler config format（hard rule）

### MUST

- **MUST** 使用 `wrangler.jsonc`（**禁** `wrangler.toml`）
- **MUST** 在根目錄存在 `wrangler.jsonc`（即使 minimal；dev / IDE schema / deploy fallback 都用得到），至少含三個欄位：
  ```jsonc
  {
    "$schema": "node_modules/wrangler/config-schema.json",
    "name": "<worker-name>",
    "compatibility_date": "<YYYY-MM-DD>"
  }
  ```
- **MUST** 用 `nitro: { preset: 'cloudflare_module', cloudflare: { deployConfig: true, nodeCompat: true } }` 在 `nuxt.config.ts`（不是 legacy `cloudflare-pages`）

### MUST NOT

- **MUST NOT** 同時存在 `wrangler.toml` 與 `wrangler.jsonc`
- **MUST NOT** 在 wrangler.jsonc 寫死 `main` entry path，除非不走 nitro 標準 build（會與 Nitro 產生的 entry 衝突）

## § 3 — Deploy command（hard rule，dual-track）

### § 3.1 Track A — wrangler-action（**default**，fleet 多數）

#### MUST

- **MUST** CI workflow（`.github/workflows/deploy*.yml`）使用 `cloudflare/wrangler-action`（v3，依 [[ci-workflow]] SHA-pin）+ `command: deploy` + `workingDirectory: .output`

#### MUST NOT

- **MUST NOT** 在 CI 用 `npx nuxthub deploy`（需綁 NuxtHub 帳號、與 secrets 流程衝突）
- **MUST NOT** 在 CI 直接 invoke `npx wrangler deploy`（失去 wrangler-action 的 retry / token 注入）

### § 3.2 Track B — void.cloud

#### MUST

- **MUST** 跑 `npx void init --agents` 安裝與本地 `void` package 版本一致的 official skills；依下表確認每個啟用 target 的 skill 與 MCP 實際送達，完成該 target 必要的註冊步驟。
- **MUST** 對本 consumer 實際啟用的每個 runtime target 驗證 official agent setup 的實際落點；`init --agents` 的 auto-detection 只處理它偵測到或使用者選定的 target，**NEVER** 當成所有 target 都已送達的證據：

  | runtime | official skill projection | MCP delivery |
  |---|---|---|
  | Claude | `.claude/skills/void/` + `.claude/skills/migrate-vite-cloudflare-to-void/` | `void init --agents` writes `.claude/settings.json` (or `settings.local.json`) |
  | Codex | `.agents/skills/void/` + `.agents/skills/migrate-vite-cloudflare-to-void/` | **MUST** follow and verify the printed `codex mcp add void -- npx void mcp` registration against the actual Codex MCP surface; initializer success alone does not prove MCP delivery |
  | Cursor | `.agents/skills/void/` + `.agents/skills/migrate-vite-cloudflare-to-void/` | `void init --agents` writes `.cursor/mcp.json` |

  These paths and behaviors come from the official Void package's published coding-agent integration guide and agent implementation in the official package tarball (`void@0.10.13`, [npm registry package](https://registry.npmjs.org/void/-/void-0.10.13.tgz)); preserve the consumer's selected target set and do not claim runtime invocation from configuration presence alone.
- **MUST** 後續 void CLI / config / runtime helper / `env.ts` / migration 等通用知識**走 official `void` skill 或 `void mcp`** (`search_docs` / `get_page docs/<path>.md`)；**NEVER** 從 consumer-side rule / project-specific note 複製 void CLI 命令當權威 — 那些 cache 容易跟 void 升版 drift
- **MUST** 新建或升級中的 consumer 使用 current `void@0.10.x`；`void@0.8.x` 是 legacy migration 狀態，不當 current baseline
- **MUST** 在根目錄存在 `void.json`，至少含 `target: "cloudflare"` 與 framework inference；保留 `wrangler.jsonc` 給 Nuxt dev、IDE schema 與 compatibility config
- **MUST** `void@0.8.x` 的 `void.json.worker.compatibility_flags` 依 `inference.appType` 分流：
  - **`appType: "framework"` (Nuxt / SvelteKit / Astro 等)**：**MUST** 走**配置 3**（`["nodejs_compat", "nodejs_als", "no_nodejs_compat_v2"]`）— 顯式停 workerd 原生 v2，unenv v1 polyfill 獨佔。配置 2（純 v2）對 Nitro `cloudflare-module` preset **不可用** — Nitro build 主動 warn「`Please consider replacing nodejs_compat_v2 with nodejs_compat ... or USE IT AT YOUR OWN RISK as it can cause issues with nitro`」+ deploy 撞 `Cannot read private member #t in get stdout`
  - **`appType: "void"` (pure Vite+ void app，無 meta framework)**：**MUST** 走**配置 2**（`["nodejs_compat_v2", "nodejs_als"]`）— 直接吃 workerd 原生 v2，無 Nitro 中間層 polyfill 衝突
- **MUST** `wrangler.jsonc` 的 `compatibility_flags` 與 `void.json` **對齊**，避免 dev / prod 行為漂移；current void 會從 wrangler config 讀取 compatibility settings，不能假設 deploy 忽略 wrangler config
- **MUST** GitHub Actions 使用 void.cloud 的 GitHub OIDC：workflow 加 `permissions: { contents: read, id-token: write }`，以 `void github connect <project> --repo <owner/repo> --executor github_actions` 做一次性授權；**不使用**長效 `VOID_TOKEN`
- **MUST** CI workflow 走 `pnpm run void:deploy`（內部使用 local `void deploy`），並以 `VOID_PROJECT` 明確指定 project slug
- **MUST** package.json 帶 current `void@0.10.x`（**不是** legacy `@void-sdk/void@^0.6.x` 或 `void@0.8.x`）
- **MUST** 在 `pnpm-workspace.yaml` 把 `vite` / `vitest` override 成 VoidZero fork（voidPlugin 需要 `parseSync` export，純 vite 沒有）
- **MUST** void deploy script **不可命名** `deploy`（pnpm 保留字，`ERR_PNPM_NOTHING_TO_DEPLOY`），用 `void:deploy`
- **MUST** `void.json` + `wrangler.jsonc` 的 `compatibility_date` 對齊 official void Nuxt example（`<該 target 的 void skill root>/docs/integrations/frameworks/nuxt.md`（skill root 依上表））— 保持跟 official 已驗證範例同步，避免不必要的 baseline drift
- **MUST** 只有仍停在 legacy `void@0.8.x` 且使用 `void/schema-d1` 的 consumer 暫時保留 `patch-void-deploy.ts`；上游 issue [void-sdk/void#52](https://github.com/void-sdk/void/issues/52) 已在上游修正，升到 current void 後**必須移除** patch、postinstall hook 與 `patchedDependencies`
- **MUST** deploy 走 `pnpm run void:deploy`（用 **local** void；global void 的 drift-check 會解析到 global 的 drizzle-kit 而撞 `Please install latest version of drizzle-orm`）。與 node-linker 無關，**NEVER** 為此改 `node-linker=hoisted`

#### MUST NOT

- **MUST NOT** `void@^0.8.x` 用配置 1（`["nodejs_compat", "nodejs_als"]` 不含 `no_nodejs_compat_v2`）— legacy SDK 會撞 worker upload err 10021。這是 0.8 限定 workaround，**不得**套用成 current void 0.10 的通則。詳見 [pitfall doc](../../docs/pitfalls/2026-05-25-void-cloud-voidjson-compat-flags-10021.md)
- **MUST NOT** legacy `void@0.8.x` 的 `appType: "framework"` consumer 用配置 2（純 v2）— 同樣撞 `#t` error。這條限制不得無版本區分地套到 current void
- **MUST NOT** 在 void SDK ≥0.10 的 consumer 保留 `patch-void-deploy.ts` 或 unenv patch；這些 workaround 只屬 legacy void 0.8
- **MUST NOT** 用 nitro `cloudflare.nodeCompat` 取代平台 compatibility config；legacy 0.8 以 void.json 為準，current void 依 official integration 的 wrangler / void config 契約
- **MUST NOT** 在 GitHub Actions 保存 `VOID_TOKEN`；deploy 身分走 GitHub OIDC。runtime secrets 走 `void secret put`，不得混入 wrangler-action 的 Cloudflare secret 流程

## § 4 — Binding declaration（依 track + binding 複雜度分派）

Track A 的 NuxtHub 派依 binding 複雜度有兩個合法 pattern（§ 4.1 / § 4.2），§ 4.4 是外部 DB，§ 4.5 是 void.cloud。

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

Single SoT，且能用 `NITRO_PRESET` 條件做 dev binding fallback（`vendor/snippets/d1-drizzle/nuxthub-dev-binding-fallback.ts`）。

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

適用：有 Durable Objects（NuxtHub 無 abstraction）、AI Gateway 自訂設定、或多 binding。

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

遷移 runbook 與 sharp edges 見 `/yudefine-deploy` skill。

## § 5 — 違反偵測

`scripts/audit-wrangler-config.ts` 偵測：

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
   - `inference.appType: "framework"` + `compatibility_flags` 為配置 2（純 `["nodejs_compat_v2", "nodejs_als"]`，無 `no_nodejs_compat_v2`）→ `void.compat_flags_unsafe_framework`（framework type 用配置 2 撞 Nitro polyfill 衝突 + `#t` error）
9. Track B + 帶 `@nuxthub/core` dep → `void.redundant_nuxthub_dep`（per § 1 矩陣第三/四列）
10. Legacy `void@0.8.x` + `void.json inference.bindings.db: true`（或 `db/schema.ts` 含 `void/schema-d1` import）但 `package.json scripts.postinstall` 不含 `patch-void-deploy.ts` 呼叫 → `void.missing_handler_emit_patch`；current void 不檢查此已修正 workaround
11. Track B npm scripts 使用 pnpm 保留字（例如 `deploy`）→ `pnpm.reserved_script_name`
12. Current void workflow 仍使用 `VOID_TOKEN` 或缺 `permissions.id-token: write` → `void.legacy_token_auth` / `void.missing_oidc_permission`
13. self-hosted runner 使用 `cache: pnpm` → `ci.self_hosted_pnpm_cache`

Track 判定：根目錄有 `void.json` 且 `package.json` 含 `void` dep → Track B；否則 Track A。

## § 6 — 派別現況與改派

各 consumer 現況以 `scripts/audit-wrangler-config.ts` 輸出為準。新 consumer 依 § 1 矩陣決定派別。改派必須同步：

- 改 Track A → B：移除 `@nuxthub/core` + 建 void.json + 加 voidPlugin + 寫 `server/utils/db.ts` + `blob.ts` helper + 改 deploy.yml 走 `pnpm run void:deploy` + GitHub OIDC（詳見 `/yudefine-deploy` Phase 1-10 runbook）
- 改 Supabase → D1（Track A）：補 `@nuxthub/core` + 改 `hub: {}` config + 跑 audit 重驗
- 跑 audit script 重驗（`scripts/audit-wrangler-config.ts`）必須 0 violation 才算改派完成

## § 7 — Self-hosted runner CI 反 pattern

> Runner 標籤設計與 job 路由見 [[self-hosted-runner]]；本節只講 CI **step 寫法**。

### § 7.1 — NEVER `cache: pnpm`（用 LXC 本地 persistent store）

`cache: pnpm`（與 `actions/cache`）走 GHA cache backend；persistent 的 self-hosted runner 本地已有 store，改走它是每次跨洋下載整包 tarball。

- **NEVER** 在 self-hosted runner 的 `actions/setup-node` 加 `cache: pnpm`（或任何 `actions/cache` step 快取 pnpm store）
- **MUST** 改用 LXC 本地 persistent store：

  ```yaml
  - name: Install node
    uses: actions/setup-node@<40-char-sha> # v6（SHA-pin per ci-workflow）
    with:
      node-version: 24
      # 不用 cache: pnpm — GHA cache backend 對 self-hosted runner 反 pattern
      # 改用 LXC 本地 persistent store。

  - name: Configure pnpm store
    run: pnpm config set store-dir "$HOME/.pnpm-store"

  - name: Install dependencies
    run: pnpm install --frozen-lockfile
  ```

### § 7.2 — CI 看不到 gitignored env / 本機 link state

- **NEVER** 在 workflow 假設 `.env*` / 本機 link state（`.void/project.json`）存在——checkout 只含 tracked file
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

現況以 `scripts/audit-wrangler-config.ts`（`ci.self_hosted_pnpm_cache`、`void.legacy_token_auth`）輸出為準；<consumer-k> 的 `.github/workflows/deploy.yml` 是 current void.cloud + OIDC reference。
