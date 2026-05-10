# Decision — NuxtHub D1 Stack as First-Class Scaffold Path (TD-002 Direction A)

> Status: **Proposed** — pending review + implementation in next session
> Discovered: 2026-05-10 (clade HANDOFF §2.1 C 群 / TD-002)
> Closes: starter `docs/tech-debt.md` TD-002 once implemented
> Mirror impact: agentic-rag `docs/tech-debt.md` TD-069 (consumer-side after this lands)

## Context

`pnpm create nuxt-supabase-starter <name> --evlog-preset nuxthub-ai` 目前**不能 scaffold 出能跑的真專案** — preset 只覆蓋 evlog 上層 wiring，DB stack 仍是 Supabase（`server/db/`、`db:drizzle:pull`、無 `server/database/migrations/`）。

`@evlog/nuxthub` module 載入後找不到 NuxtHub D1 binding、drizzle pipeline 無 `evlog_events` migration、deploy 後 D1 沒 table → drain dead-write、user 必手動切整套 DB stack 才能跑。

User 拍板（2026-05-10）：走方向 **A — nuxthub-ai 升級為 fresh-scaffold first-class**，starter 正式支援雙 DB 軌（Supabase / NuxtHub D1）。

## Decision

starter scaffolder 加 **DB stack 維度**作為 orthogonal 選項（與 auth provider 同層）：

```
auth: { nuxt-auth-utils | better-auth | none }
db:   { supabase | nuxthub-d1 }   ← 新增維度
```

`--evlog-preset nuxthub-ai` 自動 imply `db: nuxthub-d1`（且強制 auth ∈ {better-auth | none}，因 nuxt-auth-utils session-only 不需 D1，但 better-auth 需要 D1 driver 配合）。

選 `db: nuxthub-d1` 時 scaffolder 走 **NuxtHub variant** base layout：
- `server/database/`（取代 `server/db/`）
- drizzle.config 指 NuxtHub
- package.json scripts: `hub:db:migrations:create` / `hub:db:migrations:apply`（取代 `db:drizzle:pull`）
- nuxt.config modules: `@nuxthub/core` + (選擇性) `@evlog/nuxthub`
- wrangler.jsonc: `d1_databases` binding template + `hub.db: 'sqlite'` config
- 預生 `server/database/migrations/0001_better_auth_d1.sql`（若 auth=better-auth）+ `0002_evlog_events.sql`（若 evlog-preset != none）

## Architecture choice：overlay 機制（不雙 base）

兩個方案：

| 方案 | 描述 | 評估 |
| --- | --- | --- |
| A.1 雙 base 模板 | `template/template-supabase/` + `template/template-nuxthub/` 兩套 base | 維護成本 2x；base feature drift 風險高 |
| A.2 single base + 條件 overlay | base 維持 Supabase；`db: nuxthub-d1` 時 scaffolder run 「remove + replace」overlay 把 Supabase 部分換成 NuxtHub | 維護成本接近 1x；overlay 覆蓋細節需設計 |

選 **A.2**（單 base + 條件 overlay）。原因：
1. 現有 base 已成熟，Supabase 路徑是現役 5 consumer 中 4 個的真實架構，break 它代價高
2. NuxtHub D1 軌目前只 1 consumer（agentic-rag）+ 未來新 scaffold，overlay 機制延後 base fork 決策
3. scaffolder 已有 feature 系統（`features.ts` / `assembleProject`），overlay 是擴充而非重寫

### Overlay 機制設計

新增 `template/overlays/db-nuxthub-d1/` 目錄：

```
overlays/db-nuxthub-d1/
├── manifest.json                    # 描述 add / remove / replace
├── add/                             # cp 過去的新檔
│   ├── server/database/schema/index.ts
│   ├── server/database/migrations/0002_evlog_events.sql  # 預生（@evlog/nuxthub schema）
│   ├── wrangler.jsonc.template       # 含 d1_databases binding
│   └── nuxt.config.modules.delta    # @nuxthub/core 加進 modules
├── remove/                           # rm 掉的 Supabase 檔
│   ├── server/db/                    # 整個目錄
│   ├── drizzle.config.ts             # Supabase pull config
│   ├── scripts/db-types.sh           # supabase types
│   ├── scripts/db-reset.sh
│   ├── scripts/backup-supabase.sh
│   └── scripts/supabase-tunnel.sh
└── package-json.delta.json          # scripts add/remove + dependencies
```

`manifest.json` 範例：

```json
{
  "name": "db-nuxthub-d1",
  "description": "Switch from Supabase to NuxtHub D1 stack",
  "requires": { "auth": ["better-auth", "none"] },
  "conflicts_with": ["db-supabase"],
  "add": ["add/**"],
  "remove": [
    "server/db/**",
    "drizzle.config.ts",
    "scripts/db-types.sh",
    "scripts/db-reset.sh",
    "scripts/backup-supabase.sh",
    "scripts/supabase-tunnel.sh"
  ],
  "package_json": {
    "remove_scripts": ["db:drizzle:pull", "db:lint", "db:backup", "supabase:sync", "supabase:check"],
    "add_scripts": {
      "hub:db:migrations:create": "drizzle-kit generate --config=drizzle.config.ts",
      "hub:db:migrations:apply": "wrangler d1 migrations apply $D1_DB_NAME --local",
      "hub:db:studio": "drizzle-kit studio --config=drizzle.config.ts"
    },
    "remove_dependencies": ["@nuxtjs/supabase", "@supabase/supabase-js"],
    "add_dependencies": ["@nuxthub/core", "@evlog/nuxthub", "drizzle-orm"]
  }
}
```

### scaffolder src 改動

新檔：`packages/create-nuxt-starter/src/overlays.ts`（~150 lines）
- `applyOverlay(targetDir, overlayName)`：read manifest → apply add/remove/package_json delta
- `validateOverlayCompatibility(overlay, selections)`：check `requires` + `conflicts_with`

修 `assemble.ts` step ~10：
- 加 `if (selections.dbStack === 'nuxthub-d1') applyOverlay(targetDir, 'db-nuxthub-d1')`
- step 11 evlog overlay 之前跑（先切 base stack，再 wire evlog 上層）

修 `prompts.ts` / `cli.ts`：
- 加 `--db <supabase|nuxthub-d1>` flag
- wizard mode：`evlog-preset === 'nuxthub-ai'` 時自動 imply `dbStack = 'nuxthub-d1'`，跳過 db prompt
- wizard mode：`evlog-preset !== 'nuxthub-ai'` 時 default `supabase`（向後兼容）

修 `types.ts`：`UserSelections` 加 `dbStack: 'supabase' | 'nuxthub-d1'`

修 `evlog-preset.ts` / `presets/evlog-nuxthub-ai/PRESET.md`：
- preset 不再負責替換 DB stack（由 overlay 負責）
- PRESET.md 改寫：「本 preset 自動 imply NuxtHub D1 base，prerequisite 由 overlay 處理」

### 預生 migration

`overlays/db-nuxthub-d1/add/server/database/migrations/0001_better_auth_d1.sql`（若 auth=better-auth）
- 從 better-auth doc 拷貝最新 D1 schema（auth 表 + sessions 表 + accounts 表）

`overlays/db-nuxthub-d1/add/server/database/migrations/0002_evlog_events.sql`（若 evlog-preset != none）
- hand-written 對齊 `@evlog/nuxthub@2.16.x` `events.sqlite.js` schema：
  ```sql
  CREATE TABLE evlog_events (
    id TEXT PRIMARY KEY NOT NULL,
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL,
    service TEXT NOT NULL,
    environment TEXT NOT NULL,
    method TEXT,
    path TEXT,
    status INTEGER,
    duration_ms INTEGER,
    request_id TEXT,
    source TEXT,
    error TEXT,
    data TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX evlog_events_timestamp_idx ON evlog_events(timestamp);
  CREATE INDEX evlog_events_level_idx ON evlog_events(level);
  CREATE INDEX evlog_events_service_idx ON evlog_events(service);
  CREATE INDEX evlog_events_status_idx ON evlog_events(status);
  CREATE INDEX evlog_events_request_id_idx ON evlog_events(request_id);
  CREATE INDEX evlog_events_created_at_idx ON evlog_events(created_at);
  ```

維護策略：`@evlog/nuxthub` 升版時 starter 跑 e2e 驗 migration 仍對齊（diff schema vs migration），對不上印 warning。

### 後置 banner

scaffolder 結尾若 `dbStack === 'nuxthub-d1'`，banner 印：

```
🚀 NuxtHub D1 stack scaffolded.

接下來：
  cd <name>
  pnpm install
  npx nuxthub link              # 連 NuxtHub project
  pnpm hub:db:migrations:apply  # 套 0001/0002 migration 到 D1
  pnpm dev
```

## Alternatives considered

### B：retrofit-only（被 user 否決）
nuxthub-ai preset 純上層 overlay，明示要求 user 已切 NuxtHub D1。**否決原因**：用 starter 的 user 期望 scaffold 出能跑的 fresh 專案，retrofit-only 違反 first-class 預期。

### A.1：雙 base 模板
`template/template-supabase/` + `template/template-nuxthub/` 各自獨立。**否決原因**：base feature drift 風險（auth / e2e / ui-kit 等改動要在兩邊同步），長期維護成本高。

### A.3：feature 系統內把 db 當 feature
把 `db-supabase` / `db-nuxthub-d1` 加進 `features.ts` 列表。**部分採用**：features.ts 確實要登記新 feature id，但實際的 file add/remove 邏輯走 overlay 機制（feature 系統目前不支援 file 移除）。

## Implementation phases

### Phase 1 — Overlay 機制 + 預生 migration（半天）

- [ ] 新建 `packages/create-nuxt-starter/src/overlays.ts`
- [ ] 新建 `template/overlays/db-nuxthub-d1/` 目錄結構
- [ ] 寫 `overlays/db-nuxthub-d1/manifest.json`
- [ ] 預生 0002_evlog_events.sql（hand-written + unit test 對齊 @evlog/nuxthub schema）
- [ ] 預生 0001_better_auth_d1.sql（從 better-auth doc 拷貝）
- [ ] `applyOverlay()` 實作 + unit test

### Phase 2 — scaffolder integration（半天）

- [ ] `types.ts` 加 `dbStack`
- [ ] `cli.ts` 加 `--db` flag + validation
- [ ] `prompts.ts` 加 wizard mode db 選項（`evlog-preset === 'nuxthub-ai'` auto-imply）
- [ ] `assemble.ts` 加 `applyOverlay('db-nuxthub-d1')` step
- [ ] `evlog-preset.ts` 移除 nuxt.config modules 切換邏輯（改由 overlay 負責）
- [ ] post-scaffold banner 條件分支

### Phase 3 — 文件 + 測試（半天）

- [ ] 改 `presets/evlog-nuxthub-ai/PRESET.md`：移除 DB 切換說明（已自動），保留 evlog 上層說明
- [ ] 加 `docs/SCAFFOLD_RECIPES.md` 段落：「NuxtHub D1 軌」
- [ ] e2e test：`pnpm create ... --db nuxthub-d1` scaffold 後 audit script PASS、`server/database/migrations/` 有 evlog_events.sql、`pnpm hub:db:migrations:apply --local` 不報錯
- [ ] e2e test：`pnpm create ... --evlog-preset nuxthub-ai` 自動 imply `--db nuxthub-d1`（不需顯式帶）
- [ ] 跑 4 條 fresh scaffold（4 evlog preset × default db）audit 維持 PASS（不 regression）

### Phase 4 — agentic-rag TD-069 retroactive fix（後置）

agentic-rag 既有 NuxtHub 專案，用 starter overlay 機制不適用（要 retro fix 既有 repo）。**手動 path**：

```bash
cd ~/offline/nuxt-edge-agentic-rag
pnpm hub:db:migrations:create   # drizzle-kit 從 @evlog/nuxthub schema 生 migration
git diff server/database/migrations/   # review schema
git add . && git commit && git push   # staging deploy 套 migration
```

agentic-rag 端的 TD-069 acceptance 留 user 跑 上面 4 個命令完成。

## Risks

1. **drizzle-kit non-TTY**：scaffolder 跑 `hub:db:migrations:create` 在非 TTY (CI / Claude Code Bash) 可能撞 TTY init（同 starter TD-003）。Mitigation：預生 migration 取代 drizzle-kit generate（避開 TTY 問題）
2. **better-auth schema drift**：手寫 0001_better_auth_d1.sql 隨 better-auth 升版會 drift。Mitigation：starter e2e 跑 better-auth migrate dry-run 對齊；drift 時印 warning
3. **wrangler.jsonc 細節**：D1 binding name (`DB`)、database_name、hub.db sqlite 設定需用戶自填。Mitigation：scaffolder 留 `<%= projectName %>-db` placeholder，post-scaffold banner 提示替換
4. **base template Supabase feature 改動 break NuxtHub overlay**：未來 base 增刪 Supabase 檔案，overlay manifest 需同步改 `remove[]` 列表。Mitigation：CI e2e test 跑 NuxtHub 軌 scaffold，base 改動破壞 overlay 會被測掉

## Acceptance（總體）

- `pnpm create nuxt-supabase-starter test-ai --evlog-preset nuxthub-ai --yes --no-clone-clade --no-register-consumer --no-wire-pre-commit` 出來的專案：
  - `server/database/migrations/0002_evlog_events.sql` 存在
  - `server/db/` 不存在
  - `package.json` `hub:db:migrations:create` script 存在；`db:drizzle:pull` 不存在
  - `wrangler.jsonc` 含 `d1_databases` binding
  - `nuxt.config.ts` modules 含 `@nuxthub/core` + `@evlog/nuxthub`，不含 `@nuxtjs/supabase`
  - `pnpm install && npx wrangler d1 execute --local --command "SELECT count(*) FROM evlog_events"` 不報 `no such table`（migration 套上 local D1 後）
  - audit script 跑該專案 `nuxthub.moduleInstalled=1, drain.pipelineWraps=1, enrichers.installed=5, blocked=0`
- 既有 4 條 fresh scaffold path（baseline / d-pattern-audit / nuxthub-ai / none）audit signal 維持
- starter `docs/tech-debt.md` TD-002 status `done`；agentic-rag `docs/tech-debt.md` TD-069 移到「等 user 跑 4 命令收尾」狀態

## Open questions

- 預生 migrations 的維護人是誰？建議 starter team owner — `@evlog/nuxthub` 升版時要 review schema diff（人工）
- `@nuxthub/core` 升版若改 drizzle 流程（例如改 schema:extend hook），overlay manifest 是否需動？應每個 starter release 跑一次 e2e 驗
- 是否需要支援「supabase + nuxthub-d1 共存」（部分 schema 在 Supabase，evlog_events 在 D1）？**目前不支援**，user 自選一條
