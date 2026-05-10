## Context

starter maintainer register 的 TD-002 已確認 nuxthub-ai preset 與 NuxtHub D1 stack 整體未對齊：scaffolder 目前生成 Supabase DB layout，nuxthub-ai 只疊上 @evlog/nuxthub 與 AI logging files，導致 fresh scaffold 後沒有 NuxtHub D1 binding、沒有 server/database/migrations、沒有 evlog_events migration，也沒有 hub migration scripts。

設計來源是 `decisions/2026-05-10-nuxthub-d1-stack-as-first-class-scaffold.md`。本 change 只處理 starter scaffolder 與 template overlay，不 retroactively 修改 agentic-rag 既有 repo。TD-003 指出非 TTY 下 drizzle-kit generate 容易失敗，因此 fresh scaffold 路徑必須採預生 migration SQL，而不是在 scaffolder 階段互動式產 migration。

現有 scaffolder 已有 single base + feature overlay 模式：`assembleProject()` 先 copy base，再套 feature templates，接著生成 package.json、nuxt.config.ts、.env.example、agent runtime assets，最後套 evlog preset。NuxtHub D1 stack 應作為同層架構 overlay 插在 evlog preset 之前，先完成 DB base 切換，再套 nuxthub-ai 上層 wiring。

## Goals / Non-Goals

**Goals:**

- 新增 dbStack 選項，支援 supabase 與 nuxthub-d1，並維持 supabase 為預設。
- 讓 --evlog-preset nuxthub-ai 自動 imply dbStack = nuxthub-d1，且在 CLI flag 衝突時 fail fast。
- 建立 generic overlay 機制，支援 manifest-driven file add、file remove、package_json scripts/dependencies delta、requires/conflicts_with validation。
- 建立 db-nuxthub-d1 overlay，將 generated project 從 Supabase DB layout 切成 NuxtHub D1 layout。
- 用預生 0001_better_auth_d1.sql 與 0002_evlog_events.sql 取代 scaffold-time drizzle-kit generate。
- 用 unit test、fresh scaffold e2e、audit script 與 local D1 migration apply 驗證 first-class fresh scaffold 行為。

**Non-Goals:**

- 不建立雙 base template；base 仍是 Supabase，NuxtHub D1 走條件 overlay。
- 不支援 Supabase + NuxtHub D1 混合 DB stack。
- 不在 starter 內直接修改 agentic-rag；只在本 change 留 collateral note，指向 agentic-rag TD-069 的手動收尾路徑。
- 不新增 UI view、Vue component、browser journey、fixtures 或 screenshot review。
- 不改 clade 管理的 preset source；`presets/evlog-nuxthub-ai/PRESET.md` 若為投影產物，apply 階段必須回 source-of-truth 更新後 propagate，不能只在 consumer projection 熱修。

## Decisions

### Decision 1: Single base plus conditional db-nuxthub-d1 overlay

保留現有 Supabase base，新增 `packages/create-nuxt-starter/templates/overlays/db-nuxthub-d1/` 作為條件 overlay。這避免維護 `template-supabase/` 與 `template-nuxthub/` 兩套 base，也讓既有 Supabase scaffold path 的 blast radius 最小。

替代方案是雙 base template。雙 base 初期直覺簡單，但 auth、agent runtime、evlog baseline、CI、docs 等共用能力每次都要同步兩份，長期 drift 風險高於 overlay 的 manifest 維護成本。

### Decision 2: dbStack is an orthogonal UserSelections dimension

`UserSelections` 新增 `dbStack: 'supabase' | 'nuxthub-d1'`，與 auth、feature list、evlogPreset 同層。CLI 新增 --db flag，wizard mode 新增 DB stack prompt；未指定時 default supabase。

`--evlog-preset nuxthub-ai` 是特殊 preset，必須 auto-imply dbStack = nuxthub-d1。若 user 同時明確指定 --db supabase 與 --evlog-preset nuxthub-ai，CLI 必須報錯，不可產出 mixed stack。wizard mode 選到 nuxthub-ai 時跳過 DB prompt或顯示已自動選 NuxtHub D1，避免 user 以為還要手動切換底層。

### Decision 3: Auth compatibility is validated before assembly

NuxtHub D1 stack 僅允許 auth = better-auth 或 none。`auth = nuxt-auth-utils` 與 `dbStack = nuxthub-d1` 必須在 CLI/wizard validation 階段拒絕。

這個限制避免產生語義模糊的 scaffold：nuxt-auth-utils 是 cookie/session utility，不提供 D1-backed user/account schema；better-auth path 才需要 0001_better_auth_d1.sql。若 user 選 none，overlay 仍可產出 NuxtHub D1 + evlog migration，用於無登入或自行接 auth 的 AI app。

### Decision 4: Manifest is the overlay source of truth

`packages/create-nuxt-starter/templates/overlays/db-nuxthub-d1/manifest.json` 是 overlay 真相層，描述：

- `requires`: selection constraints，例如 auth 可接受 better-auth 或 none。
- `conflicts_with`: 與 db-supabase 或其他互斥 overlay 的衝突。
- `add`: 要複製進 target project 的 overlay files。
- `remove`: 要從 target project 移除的 Supabase base files/directories。
- `package_json`: scripts/dependencies/devDependencies 的 add/remove delta。

`applyOverlay(targetDir, overlayName, selections)` 只根據 manifest 執行，不把 db-nuxthub-d1 的特殊清單散落在 assemble.ts。`validateOverlayCompatibility()` 必須可單元測試，並在任何 file operation 前先檢查 compatibility。

### Decision 5: Overlay runs before evlog preset application

assemble order 必須是：copy base → apply feature overlays → generate package/config/env → apply dbStack overlay → apply evlog preset → post-scaffold cleanup/banner。

NuxtHub D1 overlay 要先移除 Supabase layout 並加入 D1 migration/scripts，nuxthub-ai preset 再套 AI logger、enrichers、@evlog/nuxthub module wiring。若順序相反，evlog preset 可能先對 Supabase-shaped project 做修改，之後被 DB overlay remove/replace 掉。

### Decision 6: Prebuilt D1 migrations replace scaffold-time generate

`packages/create-nuxt-starter/templates/overlays/db-nuxthub-d1/add/server/database/migrations/0001_better_auth_d1.sql` 與 `0002_evlog_events.sql` 隨 overlay 預置。scaffolder 不在 generate 階段呼叫 drizzle-kit generate，也不要求 TTY。

0002_evlog_events.sql 必須手寫對齊 @evlog/nuxthub 2.16.x events.sqlite.js schema，包含 evlog_events table 與 timestamp、level、service、status、request_id、created_at indexes。@evlog/nuxthub 或 better-auth 升版時，starter maintainer 必須跑 e2e schema-diff 驗證 migration 是否仍對齊。

### Decision 7: Package.json delta is structural, not string replacement

overlay 對 package.json 的修改必須 parse JSON 後更新 scripts、dependencies、devDependencies，再穩定排序輸出。禁止用字串 replace 移除 script 或 dependency，避免格式與 trailing comma 造成不可預測輸出。

NuxtHub D1 scaffold 必須移除 Supabase DB scripts/packages，加入 hub:db:migrations:create、hub:db:migrations:apply、hub:db:studio、@nuxthub/core、@evlog/nuxthub 與 drizzle runtime needs。若 generated package 同時保留 db:drizzle:pull 與 hub scripts，測試必須失敗。

### Decision 8: Documentation and collateral stay in the correct layer

starter maintainer TD-002 在 apply 期間改為 in-progress，archive 後改為 done 並引用 archived change。repository-root maintainer docs/SCAFFOLD_RECIPES.md 新增 NuxtHub D1 fresh scaffold recipe；nuxthub-ai PRESET.md 改寫為 overlay 接手 DB stack，preset 只描述 NuxtHub AI / evlog T3 上層能力。

agentic-rag TD-069 是既有 consumer 的 retroactive migration debt，不在本 repo 修改。starter 只在 tasks collateral section 留 cross-link note，說明本 change archive 後，agentic-rag 需依自身 TD-069 執行手動 4 命令路徑。

## Risks / Trade-offs

- [Risk] Overlay remove list 漏掉新的 Supabase base file → generated NuxtHub D1 project 變成 mixed stack。Mitigation: e2e scaffold test assert server/db absent、db:drizzle:pull absent、@nuxtjs/supabase absent、@nuxthub/core present；每次 base DB layout 改動跑 NuxtHub D1 scaffold audit。
- [Risk] Prebuilt migration schema 隨 @evlog/nuxthub 或 better-auth 升版 drift。Mitigation: starter release checklist 加 schema-diff e2e；升版時 local D1 apply + SELECT count(\*) FROM evlog_events 必跑。
- [Risk] `presets/evlog-nuxthub-ai/PRESET.md` 是 clade projection，直接改 template 可能被下次 sync 還原。Mitigation: apply 階段先查 LOCKED banner 與 source route；若屬 clade 管理，先改 clade source 再 propagate，不在 projection 熱修。
- [Risk] Wizard mode auto-imply 與 explicit --db flag 行為不一致。Mitigation: unit tests 覆蓋 explicit nuxthub-ai + db supabase conflict、wizard nuxthub-ai auto-imply、default evlog baseline remains supabase。
- [Risk] D1 binding template 的 database_name / binding placeholder 需 user 後續填。Mitigation: generated wrangler.jsonc.template 與 post-scaffold banner 明確列 nuxthub link、migration apply、D1 binding update steps。

## Migration Plan

1. 建 overlay helper 與 db-nuxthub-d1 manifest/add/remove/package delta，先用 unit test 鎖住 validation 與 package_json delta。
2. 將 dbStack 接入 types、CLI、wizard prompt、assemble order 與 post-scaffold banner。
3. 改寫 nuxthub-ai preset doc 與 scaffold recipe，並補 fresh scaffold e2e / audit regression。
4. apply 階段把 starter maintainer TD-002 狀態改為 in-progress；archive 後改為 done，並留下 archived change reference。
5. 若 validation 發現 NuxtHub D1 scaffold broken，可回滾本 change 的 overlay integration；Supabase default path 因仍走原 base，應能保持不受影響。

## Open Questions

(none)

## Resolved Questions

- 預生 migrations 維護人：starter maintainer owner，@evlog/nuxthub 或 better-auth 升版時 review schema diff。
- NuxtHub/evlog 升版驗證：每個 starter release 或相關 dependency bump 都跑 NuxtHub D1 fresh scaffold e2e。
- Supabase + NuxtHub D1 coexistence：本 change 明確不支援；user 必須選 supabase 或 nuxthub-d1 其中一條。
