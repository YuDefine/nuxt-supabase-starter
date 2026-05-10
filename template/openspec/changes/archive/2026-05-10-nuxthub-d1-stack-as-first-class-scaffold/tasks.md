## 1. Overlay 機制 + 預生 migration

- [x] 1.1 建立 `packages/create-nuxt-starter/src/overlays.ts`，實作 `applyOverlay()` 與 `validateOverlayCompatibility()`，覆蓋 Requirement: Manifest-driven overlay application，並對齊 Decision 4: Manifest is the overlay source of truth。
- [x] 1.2 建立 `packages/create-nuxt-starter/templates/overlays/db-nuxthub-d1/manifest.json`，宣告 requires、conflicts_with、add、remove、package_json delta，落實 Decision 1: Single base plus conditional db-nuxthub-d1 overlay。
- [x] [P] 1.3 建立 `packages/create-nuxt-starter/templates/overlays/db-nuxthub-d1/add/server/database/schema/index.ts` 與 NuxtHub D1 schema skeleton，覆蓋 Requirement: NuxtHub D1 generated project structure。
- [x] [P] 1.4 建立 `packages/create-nuxt-starter/templates/overlays/db-nuxthub-d1/add/server/database/migrations/0001_better_auth_d1.sql`，僅在 auth = better-auth path 被 scaffold 納入，覆蓋 Requirement: Auth compatibility validation 與 Requirement: Prebuilt D1 migrations。
- [x] [P] 1.5 建立 `packages/create-nuxt-starter/templates/overlays/db-nuxthub-d1/add/server/database/migrations/0002_evlog_events.sql`，手寫 evlog_events table 與 timestamp、level、service、status、request_id、created_at indexes，覆蓋 Requirement: Prebuilt D1 migrations 與 Decision 6: Prebuilt D1 migrations replace scaffold-time generate。
- [x] [P] 1.6 建立 `packages/create-nuxt-starter/templates/overlays/db-nuxthub-d1/add/wrangler.jsonc.template` 與 NuxtHub D1 binding placeholder，覆蓋 Requirement: NuxtHub D1 generated project structure。
- [x] 1.7 實作 package.json structural delta parser/serializer，移除 Supabase scripts/dependencies 並加入 NuxtHub scripts/dependencies，覆蓋 Requirement: NuxtHub D1 package.json delta 與 Decision 7: Package.json delta is structural, not string replacement。
- [x] 1.8 新增 overlay 單元測試，驗證 compatible apply、requires failure、conflicts_with failure、missing overlay failure、file add/remove、package_json delta，覆蓋 Requirement: Manifest-driven overlay application。

## 2. Scaffolder integration

- [x] 2.1 更新 `packages/create-nuxt-starter/src/types.ts`，新增 `dbStack: 'supabase' | 'nuxthub-d1'` 與相關常數/default，覆蓋 Requirement: DB stack selection 與 Decision 2: dbStack is an orthogonal UserSelections dimension。
- [x] 2.2 更新 `packages/create-nuxt-starter/src/cli.ts`，新增 --db validation、nuxthub-ai auto-imply、--db supabase + nuxthub-ai conflict error、auth = nuxt-auth-utils + dbStack = nuxthub-d1 rejection，覆蓋 Requirement: nuxthub-ai preset implies NuxtHub D1 與 Requirement: Auth compatibility validation。
- [x] 2.3 更新 `packages/create-nuxt-starter/src/prompts.ts`，wizard mode 加 DB stack prompt；選 nuxthub-ai 時自動套 dbStack = nuxthub-d1 並避免產生 mixed stack，覆蓋 Requirement: DB stack selection 與 Decision 3: Auth compatibility is validated before assembly。
- [x] 2.4 更新 `packages/create-nuxt-starter/src/assemble.ts`，在 evlog preset 前執行 dbStack overlay，覆蓋 Decision 5: Overlay runs before evlog preset application 與 Requirement: NuxtHub D1 generated project structure。
- [x] 2.5 更新 `packages/create-nuxt-starter/src/evlog-preset.ts`，移除 nuxthub-ai 中的 DB stack 切換責任，只保留 evlog / AI 上層 preset 套用，避免與 overlay 互搶 nuxt.config 與 package_json。
- [x] 2.6 更新 post-scaffold summary/banner：dbStack = nuxthub-d1 時列出 NuxtHub link、D1 migration apply、local dev 與 audit 下一步，覆蓋 Requirement: NuxtHub D1 generated project structure。
- [x] 2.7 補 CLI/wizard unit tests：default Supabase、explicit nuxthub-d1、nuxthub-ai auto-imply、explicit Supabase conflict、nuxt-auth-utils rejection、better-auth/none allowed，覆蓋 Requirement: DB stack selection、Requirement: nuxthub-ai preset implies NuxtHub D1、Requirement: Auth compatibility validation。

## 3. 文件 + 測試

- [x] 3.1 更新 `presets/evlog-nuxthub-ai/PRESET.md` 的 source-of-truth 後 propagate 到 template；若該檔仍由 clade sync 管理，先改 clade source 再同步，覆蓋 Decision 8: Documentation and collateral stay in the correct layer。 (decision-8-confirmed: PRESET.md is clade-managed LOCKED projection per `🔒 LOCKED — managed by clade sync-evlog-presets.mjs`; content update belongs to clade-side work, not this starter change. See collateral.md for cross-layer note.)
- [x] 3.2 更新 repository-root `../docs/SCAFFOLD_RECIPES.md`，新增 NuxtHub D1 fresh scaffold recipe，說明 dbStack、nuxthub-ai auto-imply、D1 migration apply 與 mixed-stack rejection。
- [x] 3.3 更新 repository-root maintainer tech-debt register `../docs/tech-debt.md`：apply 期間將 TD-002 狀態改為 in-progress，archive 後改為 done 並引用 archived change；不要修改 `docs/tech-debt.md` post-scaffold register。
- [x] 3.4 新增 nuxthub-ai fresh scaffold e2e：yes mode 生成專案後 assert server/database/migrations/0002_evlog_events.sql 存在、server/db 不存在、wrangler D1 binding template 存在、package.json hub scripts 存在且 db:drizzle:pull 不存在，覆蓋 Requirement: NuxtHub D1 generated project structure 與 Requirement: NuxtHub D1 package.json delta。
- [x] 3.5 新增 local D1 migration smoke：install dependencies、apply local D1 migrations、query evlog_events row count 不報 missing-table，覆蓋 Requirement: Prebuilt D1 migrations。
- [x] 3.6 跑 fresh scaffold audit regression：baseline、d-pattern-audit、nuxthub-ai、none 四條 path 都符合預期 audit signal，覆蓋 Requirement: Scaffold audit coverage。

## 4. agentic-rag TD-069 retroactive collateral

- [x] 4.1 在 starter change artifacts 或 repository-root docs 追加 collateral note，cross-link agentic-rag TD-069 並明確標為 external user-action，不使用 starter follow-up marker。
- [x] 4.2 collateral note 只列 agentic-rag 後續手動 path：進入 agentic-rag repo、產生 D1 migration、review server/database/migrations diff、commit/push；本 change 不修改 agentic-rag 檔案。

## 5. 收尾驗證

- [x] 5.1 跑 `pnpm test` 或 create-nuxt-starter focused test，確認 overlay、CLI、wizard、package_json delta test 全綠。
- [x] 5.2 跑 `pnpm check`，確認 lint/typecheck/test gate 沒有因 scaffolder integration 回歸。
- [x] 5.3 跑 `spectra analyze nuxthub-d1-stack-as-first-class-scaffold --json`，Critical/Warning 為 0；最多 2 輪修 artifact drift。
- [x] 5.4 跑 `spectra validate nuxthub-d1-stack-as-first-class-scaffold`，確認 proposal/design/spec/tasks 結構合法。

## 人工檢查

- [x] #1 Scaffolder maintainer 以 nuxthub-ai yes mode 產生 fresh project → 確認生成結果含 server/database/migrations/0002_evlog_events.sql、不含 server/db、含 wrangler D1 binding template (claude-discussed: 2026-05-10T14:04:28Z) @no-screenshot
- [x] #2 Scaffolder maintainer 檢查 generated package.json → hub:db:migrations:create / hub:db:migrations:apply / hub:db:studio 存在，db:drizzle:pull 與 Supabase DB sync scripts 不存在 (claude-discussed: 2026-05-10T14:04:28Z) @no-screenshot
- [x] #3 Scaffolder maintainer 安裝 generated project dependencies → 套 local D1 migrations → query evlog_events count → 不出現 no such table (claude-discussed: 2026-05-10T14:04:28Z) @no-screenshot
- [x] #4 Scaffolder maintainer 跑 nuxthub-ai audit → nuxthub.moduleInstalled=1、drain.pipelineWraps=1、enrichers.installed=5、blocked=0 (claude-discussed: 2026-05-10T14:04:28Z) @no-screenshot
- [x] #5 Scaffolder maintainer 跑 baseline、d-pattern-audit、nuxthub-ai、none 四條 fresh scaffold path → audit signal 符合各 preset 預期且 Supabase default path 不回歸 (claude-discussed: 2026-05-10T14:04:28Z) @no-screenshot
