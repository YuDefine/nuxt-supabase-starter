---
description: Cloudflare Workers 單軌規約（void 優先、cf CLI 補位、禁用 wrangler）。Workers 部署 / 本機 dev / 型別 / secret / D1 migration 一律走 `void`（自有 CF 帳號），void 做不到的帳號資源操作才走 `cf` CLI；依 DB 選擇分派 NuxtHub gating（D1 + 舊派 → `@nuxthub/core`；void 自帶 `void/db` → 禁帶），並定義遷移期對 wrangler 殘留的處置
paths: ['void.config.ts', 'void.lock.json', 'wrangler.{toml,jsonc}', 'nuxt.config.*', 'package.json', '.github/workflows/**/*.yml']
---
<!-- Clade native rule; source: rules/modules/runtime/cf-workers/cloudflare-workers.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Cloudflare Workers Configuration

> 單軌：Workers 一律 `void deploy`（自有 CF 帳號，`--platform cloudflare`）；設定持有者是 `void.config.ts` ＋ `void.lock.json`。**徹底刪除 wrangler**——部署、dev、型別、secret、D1、log 優先只用 `void`，void 做不到的才用 `cf`（§ 8）。標準由 `W-2026-10-26-fleet-wrangler-void-void-cf-cli-plan-clade-propa` 推動；尚未遷移的 consumer 見 § 6（遷移期）。Cookbook：`~/offline/clade/vendor/snippets/cloudflare-workers/`。D1 + Drizzle runtime 細節見 [[data-layer-d1]]；YuDefine 部署 SOP 見 `/yudefine-deploy` skill。

## § 1 — DB × NuxtHub gating（hard rule）

`@nuxthub/core` 是 Cloudflare 原生 binding（D1 / KV / R2 / AI / DO）的 runtime 抽象，只屬**遷移期**仍保留 NuxtHub 的 consumer；走 void 的 consumer 自帶 `void/db`，帶它是冗餘 dep（污染 auto-import 與 type space）。

| 部署方式 | DB | 規約 |
|---|---|---|
| void（目標） | D1（void 自家 provision）| **MUST NOT** 帶 `@nuxthub/core`；自己寫 `server/utils/db.ts` 包 `createDb(env.DB)` + `server/utils/blob.ts` 包 R2 raw binding（取用方式照官方 void skill 的 `docs/integrations/frameworks/nuxt.md`；NuxtHub 遷移差異見 `/yudefine-deploy` `rules/Track遷移判準.md` Rule 3）|
| void（目標） | 純外部 DB（Supabase / Postgres）| **MUST NOT** 帶 `@nuxthub/core` |
| 遷移期（尚未改 void，§ 6） | Cloudflare D1 / KV / R2 / AI | 沿用現狀：`package.json` 帶 `@nuxthub/core` + `nuxt.config.ts` `modules` 登記 + `hub: {...}`；是否與 `void/nitro` 並存或改 `void/db` 由該 repo 的遷移件驗證 |
| 遷移期 | Supabase / 純外部 DB | **MUST NOT** 帶 `@nuxthub/core` |

### MUST NOT

- **MUST NOT** 把 `@nuxthub/core` 列在 `package.json dependencies` 但**未**登記為 module（「冗餘 dep」反模式）
- **MUST NOT** 把同一個 binding 同時宣告在兩處（`hub.db.connection.databaseId` 與 `void.config.ts` 的 binding 並列即屬此類）
- **MUST NOT** 在已改 void 的 consumer 保留 `@nuxthub/core` dep 不刪——migration 時典型 leftover

移除前先 ripgrep `hub*()` API 呼叫，確認為 0 再刪 dep。

## § 2 — 設定檔歸屬（hard rule）

### MUST

- **MUST** Workers 設定（name、compatibility date／flags、bindings、routes、cron、vars）由 `void.config.ts` ＋ `void.lock.json` 持有；非 void 的純 Worker 由 `cloudflare.config.ts` 持有（走 `cf deploy`，§ 8）
- **MUST** `nuxt.config.ts` 加 `voidPlugin()`；Nitro 開發用的 wrangler 設定指向 gitignored 的 `.void-wrangler.jsonc`（`nitro.cloudflare.dev.configPath`），該檔由 void 產生，**NEVER** tracked

### MUST NOT

- **MUST NOT** tracked 任何 `wrangler.toml` / `wrangler.json` / `wrangler.jsonc` / `wrangler.*.jsonc`，也不得有檔名含 `wrangler` 的 tracked 腳本或產生器（例：`scripts/render-staging-wrangler.mjs`）
- **MUST NOT** 在 `package.json` 的 `dependencies` / `devDependencies` / `optionalDependencies` 直接依賴 `wrangler`
- **MUST NOT** 在 CI、腳本、`package.json` scripts、README 操作段呼叫 `wrangler <子指令>`（含 `npx` / `pnpm` / `pnpm exec` / `pnpm dlx` / `yarn` / `bunx` 前綴）或使用 `cloudflare/wrangler-action`

允許的例外：void 的 transitive 依賴（lockfile 出現 wrangler 系套件不算）、gitignored 的 `.void-wrangler.jsonc` / `.void/**` / `.wrangler/` local state、偵測與排除 wrangler 用的字面、歷史紀錄。完整驗收與例外清單見上述 plan 的「驗收定義」。

## § 3 — Deploy command（hard rule，單軌 void）

### § 3.1 — current void（MUST／MUST NOT）

#### MUST

- **MUST** 新建或升級中的 consumer 使用 current `void@1.x`（以專案 `package.json` 為準）；`void@0.8.x` 是 legacy migration 狀態，不當 baseline
- **MUST** 部署走 `void deploy`（自有 CF 帳號，`--platform cloudflare`）；CI 以 `CLOUDFLARE_API_TOKEN`（必要）與 `CLOUDFLARE_ACCOUNT_ID`（token 可存取多帳號時）走 `env:` 注入。workflow 片段見 § 7.2，完整樣板見 `/yudefine-deploy` 的 `templates/void-deploy-workflow.md`；Worker 沒有 preview URL 時再加 `CLOUDFLARE_WORKERS_SUBDOMAIN`
- **MUST** deploy script **不可命名** `deploy`（pnpm 保留字，`ERR_PNPM_NOTHING_TO_DEPLOY`），用 `void:deploy`，內部呼叫 **local** `void`（global void 的 drift-check 會解析到 global 的 drizzle-kit 而撞 `Please install latest version of drizzle-orm`；與 node-linker 無關，**NEVER** 為此改 `node-linker=hoisted`）
- **MUST** void CLI / config / runtime helper / `env.ts` / migration 等通用知識**走 official `void` skill**：consumer 內讀 `node_modules/void/skills/void/SKILL.md` 與同套件的 `docs/`，consumer 還沒裝 void 時用 user 層 `void` skill（dev-node 依 `registry/dev-nodes.json` `toolchain.vp_globals` 安裝）；**NEVER** 從 consumer-side rule / project-specific note 複製 void CLI 命令當權威——那些 cache 容易跟 void 升版 drift。void 1.x 沒有 `void init --agents` 與 `void mcp`
- **MUST** `wrangler` 套件只作 void 依賴（`@cloudflare/vite-plugin`）要求的 peer devDependency；**NEVER** 呼叫 `wrangler <子指令>`（`/yudefine-deploy` `rules/void政策層判準.md` Rule 4）
- **MUST** `compatibility_date` 只寫在 `void.config.ts`，對齊 official void Nuxt example（void skill 的 `docs/integrations/frameworks/nuxt.md`）——跟 official 已驗證範例同步，避免不必要的 baseline drift
- **MUST** 既有 Worker 接管走 `void deploy` 連結（保留 bindings / secrets / routes，把根目錄 wrangler 檔遷入 `void.config.ts`，備份在 `.void/config-migration/`）或 `void migrate`

#### MUST NOT

- **MUST NOT** 在 CI 用 `npx nuxthub deploy`（需綁 NuxtHub 帳號、與 secrets 流程衝突）
- **MUST NOT** 在 void 1.x consumer 保留 `patch-void-deploy.ts` 或 unenv patch；這些 workaround 只屬 legacy `void@0.8.x`（上游 [void-sdk/void#52](https://github.com/void-sdk/void/issues/52) 已修）
- **MUST NOT** 用 nitro `cloudflare.nodeCompat` 取代平台 compatibility config
- **MUST NOT** 把 `void@0.8.x` 的 compat flag 對照套到 current void（§ 3.2）
- **MUST NOT** 用 Void Cloud 的 GitHub OIDC 或 `VOID_TOKEN` 部署（官方已叫停；見 `W-2026-10-21-charles-fleet-void-cloud-cloudflare` Decisions）

### § 3.2 — legacy `void@0.8.x`

仍停在 `void@0.8.x`（`void.json`）的 consumer **MUST** 先跑 `void migrate` 升到 1.x，再套 § 3.1；0.8 專屬的 compat flag 對照與 patch 一律不帶進 1.x（舊條目 [[pitfall-void-cloud-voidjson-compat-flags-10021]]）。

## § 4 — Binding declaration

D1 / R2 / KV 的 binding 由 `void.config.ts` ＋ `void.lock.json` 宣告，prod ID 由 void provision 並寫入 lock，**不**寫死在任何手寫 config。

```ts
// nuxt.config.ts — 不帶 @nuxthub/core，加 voidPlugin
import { voidPlugin } from 'void'
export default defineNuxtConfig({
  modules: [/* NO '@nuxthub/core' */],
  vite: { plugins: [voidPlugin()] },
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

binding 的具體欄位以 official void skill docs 為準，本規約不複製。遷移 runbook 與 sharp edges 見 `/yudefine-deploy` skill。

### § 4.1 — 遷移期：NuxtHub 派 binding（改 void 後作廢）

尚未改 void 的 NuxtHub consumer 沿用兩個 pattern，改 void 時移入 `void.config.ts`：

- **Pattern A（default）**：binding ID 寫進 `nuxt.config.ts` 的 `hub.db.connection`（`NITRO_PRESET` 條件做 dev fallback，見 `vendor/snippets/d1-drizzle/nuxthub-dev-binding-fallback.ts`），wrangler 檔不寫 `d1_databases`
- **Pattern B（例外）**：binding 複雜（Durable Objects、AI Gateway 自訂、multi-binding）時宣告在 wrangler 檔，`hub: { db: 'sqlite', kv: true, blob: true }` 只啟用 helper
- **MUST NOT** 同一 binding 兩處宣告（`hub.db.connection.databaseId` 與 wrangler 檔 `d1_databases`；`hub.kv` 含 `id` 與 `kv_namespaces`；`hub.blob` 含 `bucketName` 與 `r2_buckets`）——deploy 時 duplicate binding error；純 `hub.db: 'sqlite'` 配 `d1_databases` 是 Pattern B 正常用法，不算衝突

## § 5 — 違反偵測

`scripts/audit-wrangler-config.ts` 目前仍是遷移期的偵測器（T12 改寫為 `audit-cloudflare-config.ts`，先 warn 後 error）。其規則碼（`wrangler.format_drift`、`wrangler.missing`、`nuxthub.*`、`binding.duplicate_declaration`、`deploy.non_standard_command`、`void.*`、`pnpm.reserved_script_name`、`ci.self_hosted_pnpm_cache`）以腳本輸出為準；本節只定方向：

1. 出現 tracked wrangler 設定檔、`wrangler <子指令>`、`wrangler-action` → 一律報（遷移期 warn）；`wrangler` 只作 void 依賴要求的 peer devDependency 不算違反（§ 3.1）
2. 已改 void 的 consumer 帶 `@nuxthub/core` dep → `void.redundant_nuxthub_dep`
3. void npm scripts 使用 pnpm 保留字（例如 `deploy`）→ `pnpm.reserved_script_name`
4. self-hosted runner 使用 `cache: pnpm` → `ci.self_hosted_pnpm_cache`

## § 6 — 遷移期現況

仍用 `wrangler-action` + 手寫 `wrangler.jsonc` 的 consumer 是**待遷移**，不是另一條合法軌道：

- **NEVER** 新增 wrangler 用法、新 consumer 一律 void
- 既有 consumer 依 plan 的分波（W0 quotation-generator → W2 Nuxt on Workers → W3 純 Worker）逐個遷移；每個 repo 的遷移由該 repo 的 session 做，遷移前其 CI 的 wrangler 步驟維持原狀，不得為了「提早合規」自行拆掉部署
- 遷移期仍合法的只有兩條，都**只限**既有、`registry/consumers.json` 的 `deploy-track` 仍為舊值的 consumer，**NEVER** 用於新 consumer 或新設定：
  - `wrangler-action`：沿用現有 deploy workflow 與其現有的 runtime secret 注入，原狀維持、不另補寫新規；遷移時改成 [[secrets]] 的 `void secret sync` 流程
  - `void-cloud`：沿用現有部署不拆；**NEVER** 新設或重建 OIDC／`VOID_TOKEN`（§ 3.1 MUST NOT）
- 退場：該 repo 的遷移件（plan T8–T10）改走 `void deploy` 並把 `deploy-track` 改成 `void` 時，該 repo 的舊軌道失效；fleet 層的退場點是收尾件 T11（audit 改 error、刪舊值）。`/yudefine-deploy` 已改 void 單軌（Phase 6 是 wrangler-action → void 遷移）；[[secrets]] 已於 T3 改寫為 `void secret sync` 流程，wrangler-action 的舊 secret 注入只適用本節的待遷移 consumer
- 各 consumer 現況以 `scripts/audit-wrangler-config.ts` 輸出為準；`registry/consumers.json` 的 `deploy-track` 舊值（`wrangler-action`、`void-cloud`）到收尾件才刪

## § 7 — Self-hosted runner CI 反 pattern

> Runner 標籤設計、job 路由與通用 CI step 寫法見 [[self-hosted-runner]]（§ 14）；本節只講 Cloudflare Workers 專屬的 step 寫法。

### § 7.1 — NEVER `cache: pnpm`（用 LXC 本地 persistent store）

規則與 workflow 片段在 [[self-hosted-runner]] § 14.1（core，所有 self-hosted runner consumer 都載入）。

### § 7.2 — CI 看不到 gitignored env / 本機 link state

- 通用規則（checkout 只含 tracked file、secret 走 `env:` 注入）見 [[self-hosted-runner]] § 14.2；以下是 void 專屬寫法
- **MUST** deploy 身分走 `CLOUDFLARE_API_TOKEN` secret，經 `env:` 注入 `void deploy`：

  ```yaml
  - name: Deploy via void
    run: pnpm run void:deploy
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
  ```

- **MUST** runtime app secret（DB URL / session secret 等）SoT = GitHub repo secret，deploy 前由 workflow 寫暫存 dotenv 後 `void secret sync <dotenv>` 同步；SoT、命名、rotation、Notion custody 與例外照 [[secrets]]；**NEVER** 手動推（`void secret put` 逐筆 / `cf workers secrets`），bootstrap／incident 唯一例外見該檔

完整 workflow 範本見 `~/offline/clade/vendor/snippets/cloudflare-workers/self-hosted-runner-ci.workflow.yml.template` （隨 T5 改為 void 版）與 `/yudefine-deploy` 的 `templates/void-deploy-workflow.md`。

### § 7.3 — Fleet 現況

現況以 `scripts/audit-wrangler-config.ts`（`ci.self_hosted_pnpm_cache` 等）輸出為準。

## § 8 — Cloudflare 操作工具：void 優先，`cf` 補位（hard rule）

**MUST** 依序判斷：① `void` 能做 → 用 `void`（指令語法先看專案 `node_modules/void/skills/void/SKILL.md`）；② void 不涵蓋的帳號資源操作 → 官方 `cf` CLI，照 `cf-cli` skill（指令探索、輸出格式、void↔cf 語意差都在那裡）；③ 兩者都沒有 → HTTP API。**NEVER** 用 wrangler；**NEVER** 用 Cloudflare Developer Platform MCP 做帳號操作。

**認證**：手動操作（人或 agent）用的 Cloudflare API token 依帳號存在不同位置，帳號 → token 位置與取法以 `cf-cli` skill `rules/安裝與認證判準.md` Rule 2 的位置表為唯一出處（FC 公司帳號在 Notion FC 公司層 Secret 頁的指定 block，只准指定 block id 取值；YuDefine 等帳號在本機檔），自己照表去取，**NEVER** 再問 Charles 要 token；取到後以 `CLOUDFLARE_API_TOKEN` 環境變數注入當次 shell，**NEVER** 把值寫進檔案、commit、argv 或回報。CI 照 § 7.2 走 GitHub secret。

| 動作 | void（優先） | cf CLI（void 不涵蓋時） |
|---|---|---|
| 部署 | `void deploy`（自有帳號；CI 用 `CLOUDFLARE_API_TOKEN`） | 非 void Worker：`cf deploy`（需 `cloudflare.config.ts`） |
| 本機 dev | `nuxt dev` / `vite dev` + `voidPlugin()`（內建 miniflare） | `cf dev` |
| 型別 | `tsconfig` `types: ["void/env"]`；`void env types` | `cf workers types`（讀 `cloudflare.config.ts`） |
| 即時 log | `void project logs`（自有帳號為 live tail） | 無（非 void 純 Worker 暫缺，plan 缺口 G1） |
| secret | `void secret put\|sync\|list\|delete` | `cf workers secrets bulk` |
| D1 查詢 | `void db execute <sql> [--remote]`（預設本機，可查 dev server 的資料） | `cf d1 query <uuid>`（預設 production） |
| D1 migration | `void db status` / `void db migrate`；`void deploy` 自動套用 | `cf d1 migrations list\|apply --dir` |
| D1 還原點 | `void deploy` 套 migration 前自動存 | `cf d1 time-travel get-bookmark\|restore` |
| R2 物件 | — | `cf r2 objects put` |
| KV | `void/kv`（程式內） | `cf kv` |
| 自訂網域 | `void domain add\|list\|status` | 以 `cf cli search` 確認 |
| rollback | `void project rollback` | `cf workers deployments` |
| tunnel | — | `cf tunnels` |
| 程式碼內的 API 呼叫（`fetch` / script 內嵌 client） | HTTP API — 不為了本節改成 spawn CLI | |
| `cf cli search` 查無對應指令的端點（例如 zone 層級 ruleset rule） | HTTP API，並在該處註明「cf 未覆蓋」 | |

`cf --local` 看不到 dev server 的資料——查 dev 資料用 `void db execute`。`cf` 仍是 beta；上表 cf 欄是方向，實際語法以 `cf-cli` skill 實測規則與 `cf cli search` 為準。
