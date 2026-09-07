## Why

starter TD-002 已確認 nuxthub-ai preset 不是單純缺一條 migration，而是 fresh scaffold 仍停在 Supabase base，導致生成的專案同時帶 Supabase DB layout 與 NuxtHub evlog 上層 wiring，無法作為能跑的 NuxtHub AI starter。

這個 change 將 NuxtHub D1 納入 scaffolder 的 first-class DB stack，讓 starter 正式支援 Supabase 與 NuxtHub D1 雙軌，並以 single base + conditional overlay 避免維護兩套 base template。

## What Changes

- scaffolder 新增 dbStack 維度，合法值為 supabase 與 nuxthub-d1，並保留 Supabase 作為預設路徑。
- --evlog-preset nuxthub-ai 自動 imply dbStack = nuxthub-d1；CLI flag 衝突時必須拒絕，wizard mode 必須自動帶入而不是要求 user 手動切整套 DB stack。
- 新增 overlay manifest 機制，支援 file add、file remove、package.json scripts/dependencies delta，以及 requires/conflicts_with 相容性檢查。
- 新增 db-nuxthub-d1 overlay，移除 Supabase DB layout，加入 NuxtHub D1 schema/migration layout、wrangler D1 binding template、NuxtHub scripts 與必要 package delta。
- 以預生 D1 migration SQL 取代 scaffolder 階段呼叫 drizzle-kit generate，避開 starter TD-003 的 non-TTY 問題。
- 改寫 nuxthub-ai preset 文件與 scaffolder banner，讓 DB stack 切換由 overlay 接手，preset 只保留 NuxtHub AI / evlog T3 上層說明。

## Non-Goals

- 不建立 template-supabase 與 template-nuxthub 兩套 base；本 change 明確採用 single base + conditional overlay。
- 不在 starter 內 retroactively 修改既有 agentic-rag repo；只產出 TD-069 collateral note / user-action path，真正手動命令留在 agentic-rag 端執行。
- 不支援 Supabase 與 NuxtHub D1 共存的混合 DB stack；本 change 僅支援二選一。
- 不新增 UI view、瀏覽器頁面、Vue component、seed fixture 或 screenshot review scope。

## Capabilities

### New Capabilities

- `scaffolder-nuxthub-d1-stack`: scaffolder SHALL support NuxtHub D1 as a first-class DB stack via dbStack selection, nuxthub-ai auto-imply behavior, conditional overlay application, and prebuilt D1 migrations.

### Modified Capabilities

(none)

## Impact

- Affected specs: new `scaffolder-nuxthub-d1-stack` capability.
- Affected code:
  - New: `packages/create-nuxt-starter/src/overlays.ts`
  - New: `packages/create-nuxt-starter/templates/overlays/db-nuxthub-d1/manifest.json`
  - New: `packages/create-nuxt-starter/templates/overlays/db-nuxthub-d1/add/server/database/migrations/0001_better_auth_d1.sql`
  - New: `packages/create-nuxt-starter/templates/overlays/db-nuxthub-d1/add/server/database/migrations/0002_evlog_events.sql`
  - New: `packages/create-nuxt-starter/templates/overlays/db-nuxthub-d1/add/server/database/schema/index.ts`
  - New: `packages/create-nuxt-starter/templates/overlays/db-nuxthub-d1/add/wrangler.jsonc.template`
  - Modified: `packages/create-nuxt-starter/src/cli.ts`
  - Modified: `packages/create-nuxt-starter/src/prompts.ts`
  - Modified: `packages/create-nuxt-starter/src/assemble.ts`
  - Modified: `packages/create-nuxt-starter/src/evlog-preset.ts`
  - Modified: `packages/create-nuxt-starter/src/types.ts`
  - Modified: `packages/create-nuxt-starter/test/scaffold.test.ts`
  - Modified: `presets/evlog-nuxthub-ai/PRESET.md`
  - Modified: repository-root maintainer docs/SCAFFOLD_RECIPES.md
  - Modified: repository-root maintainer tech-debt register for TD-002 status transitions
  - Removed from generated NuxtHub D1 scaffold only: `server/db/`, `drizzle.config.ts`, `scripts/db-types.sh`, `scripts/db-reset.sh`, `scripts/backup-supabase.sh`, `scripts/supabase-tunnel.sh`
- Affected dependencies/scripts: generated package.json gains NuxtHub D1 scripts and packages, and removes Supabase DB scripts/packages when dbStack = nuxthub-d1.
- Affected runtime behavior: fresh scaffold with nuxthub-ai produces a NuxtHub D1 project containing D1 migrations and no Supabase DB layout.

## Affected Entity Matrix

### Entity: UserSelections.dbStack

| Dimension      | Values                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| Fields touched | New dbStack selection, values supabase and nuxthub-d1                                                           |
| Roles          | scaffolder maintainer, starter adopter                                                                          |
| Actions        | CLI select, wizard select, auto-imply from evlog preset, validate conflict                                      |
| States         | default supabase, implied nuxthub-d1, explicit nuxthub-d1, invalid auth/db conflict, invalid preset/db conflict |
| Surfaces       | scaffolder CLI flags, wizard prompts, generated project summary/banner                                          |

### Entity: overlay manifest schema

| Dimension      | Values                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fields touched | name, description, requires, conflicts_with, add, remove, package_json.remove_scripts, package_json.add_scripts, package_json.remove_dependencies, package_json.add_dependencies |
| Roles          | scaffolder maintainer                                                                                                                                                            |
| Actions        | define overlay, validate compatibility, apply add/remove/package delta, reject conflicts                                                                                         |
| States         | valid overlay, missing overlay, incompatible selection, file removal target absent, package delta conflict                                                                       |
| Surfaces       | internal scaffolder overlay loader and unit tests                                                                                                                                |

### Entity: drizzle migration files

| Dimension      | Values                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Fields touched | 0001_better_auth_d1.sql, 0002_evlog_events.sql                                                 |
| Roles          | scaffolder maintainer, starter adopter                                                         |
| Actions        | scaffold prebuilt SQL, apply local D1 migration, validate evlog_events exists                  |
| States         | migration present, migration missing, schema drift with @evlog/nuxthub, local D1 apply failure |
| Surfaces       | generated server/database/migrations directory, migration apply command, e2e scaffold smoke    |

### Entity: package.json scripts/dependencies

| Dimension      | Values                                                                          |
| -------------- | ------------------------------------------------------------------------------- |
| Fields touched | Supabase DB scripts/packages removed; NuxtHub D1 scripts/packages added         |
| Roles          | starter adopter, scaffolder maintainer                                          |
| Actions        | install dependencies, run migration apply, run audit, inspect generated scripts |
| States         | Supabase stack package set, NuxtHub D1 package set, mixed-stack conflict        |
| Surfaces       | generated package.json, scaffolder unit/e2e tests                               |

## User Journeys

**No user-facing journey (backend-only)**

理由：本 change 只改 scaffolder CLI 與生成專案的 DB stack layout；終端使用者不會在瀏覽器中走新的 app journey，驗收重點是 dev tool 生成的專案是否能安裝、套 D1 migration 並通過 audit。

### Scaffolder dev acceptance journey

- Scaffolder maintainer runs a fresh scaffold with nuxthub-ai preset and yes mode.
- Generated project contains server/database/migrations/0002_evlog_events.sql and does not contain server/db/.
- Generated package.json contains hub:db:migrations:create and does not contain db:drizzle:pull.
- After install and local D1 migration apply, querying evlog_events does not fail with no such table.
- Audit reports nuxthub.moduleInstalled=1, drain.pipelineWraps=1, enrichers.installed=5, blocked=0.

## Implementation Risk Plan

- Truth layer / invariants: The decision document `decisions/2026-05-10-nuxthub-d1-stack-as-first-class-scaffold.md` is the design source of truth; overlay `manifest.json` is the file add/remove/package_json delta truth; prebuilt D1 migration SQL is the schema truth and must stay aligned with @evlog/nuxthub 2.16.x events.sqlite.js via e2e schema-diff verification when evlog is upgraded.
- Review tier: Tier 2 — medium scaffolder feature touching CLI parsing, prompts, assembly, generated package.json, tests, and docs; no UI view, auth permission, RLS, billing, or security-critical runtime behavior change in an existing app.
- Contract / failure paths: Reject overlay conflicts through conflicts_with; reject preset = nuxthub-ai with incompatible explicit Supabase db flag; in wizard mode auto-imply nuxthub-d1 for nuxthub-ai; reject auth = nuxt-auth-utils with dbStack = nuxthub-d1 and require auth in better-auth or none.
- Test plan: Add unit tests for applyOverlay and validateOverlayCompatibility; add e2e scaffold workflow for nuxthub-ai yes mode; verify migration apply and evlog_events query; run 4 fresh scaffold audit regression paths for baseline, d-pattern-audit, nuxthub-ai, and none.
- Artifact sync: Update maintainer TD-002 status from open/design proposed to in-progress during apply and done after archive; update repository-root maintainer docs/SCAFFOLD_RECIPES.md with a NuxtHub D1 path; rewrite presets/evlog-nuxthub-ai/PRESET.md so overlay owns DB stack switching; include a starter-side collateral note for agentic-rag TD-069 as an external cross-link only, without using a starter follow-up marker and without modifying agentic-rag in this change.
