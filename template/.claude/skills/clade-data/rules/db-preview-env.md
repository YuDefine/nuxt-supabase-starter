---
description: PR-isolated DB preview environment capability + safety contract（不限工具、不限 topology）
paths: ['supabase/migrations/**/*.sql', '.github/workflows/**/*.yml', 'docker-compose*.yml', 'infra/**/*', 'scripts/dev-session*', 'scripts/worktree-*', 'scripts/singleton*', '.claude/consumer-meta.json']
---
<!-- Clade native rule; source: rules/core/db-preview-env.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# DB Preview Environment（capability + safety contract）

**核心命題**：兩條 PR 同時改 schema 不能在 shared staging 互踩。本檔規約「應該具備什麼能力、應該守住什麼風險邊界」，**不**規定 topology — 用 docker-compose / LXC / cloud preview / 任何方案都可以，只要滿足下列契約。

> Self-host Supabase 的實作細節（compose-per-PR / schema-migration-gate / role password alignment / image quirk）見 `rules/modules/db-runtime/supabase-self-hosted/preview-env.md`。
>
> Cookbook 範本：`~/offline/clade/vendor/snippets/db-preview-env/`。
>
> Audit signal：`vendor/scripts/db-preview-env-audit.ts`。

## 為什麼不規定 topology

- ❌ **Schema-per-branch**：Auth/Storage/Realtime/RLS 共用狀態，假隔離
- ❌ **PG TEMPLATE clone**（PR preview）：不是 CoW，Auth/Storage 仍共用；補齊 service stack 就等於 compose-per-PR
- ✅ **schema-migration-gate**（CI throwaway-DB replay + diff）：**MUST 第一階段必備**
- ✅ **compose-per-PR**（unique JWT/port/volume）：可選升級路徑
- ⏸️ **LXC-per-PR**：rare high-fidelity lane，不自動化
- ⚠️ **clone + PostgREST sidecar**：只適用 worktree-level dev 隔離、不是 PR preview；見下節

### 窄例外：clone + PostgREST sidecar（worktree-level dev 隔離）

同一台 dev 主機上多個 worktree 各自要一份可 reset 的 DB（共用 dev 身分、只需 REST）時，clone + 每 clone 一個 PostgREST sidecar 成立，**但六個前提 MUST 全部滿足**：

1. **Dedicated zero-connection template** —— 專用 template DB（`datistemplate=true`、`datallowconn=false`、0 active connection），**NEVER** 拿正在服務的 DB 當 template
2. **小 DB** —— `CREATE DATABASE ... TEMPLATE` 是實體 copy 不是 CoW；DB 大到 clone 時間／磁碟不可接受就不適用
3. **無 GoTrue / Realtime per-clone 需求** —— 只要 REST；需要 per-clone Auth／Realtime 就退回 compose-per-PR
4. **Storage 明確 gate** —— 預設 `storageEnabled=false`；要 Storage 而無 verified strategy 時 **MUST** fail closed，**NEVER** 讓 clone 去動 shared storage bucket
5. **完整 lifecycle 與 destructive target guard** —— deterministic 命名、ownership marker、`reconcile` 預設 report-only、drop 前驗 ownership；**NEVER** 讓 target 解析到 `postgres` / template 本身 / 非本工具建立的 DB
6. **Connection pool 預算控管** —— 每 sidecar 固定 pool size，start 前依 `max_connections` 與現有用量估算，超過 headroom 即拒絕

任一條不滿足 → 回到既有路徑（schema-migration-gate 必備、compose-per-PR 可選），**NEVER** 把本例外當成「PG TEMPLATE 其實可以用」的一般結論。

#### 缺席側：存在性檢查綁在「起 dev server」，不是「建 worktree」

前提 5 規範的是**銷毀**側。缺席側同樣 MUST 有把關：

> 凡 worktree 專屬的 backing service（DB clone、PostgREST sidecar、任何 per-worktree daemon），其**存在性檢查 MUST 綁在「起 dev server」這個動作上**，不能只綁在「建 worktree」那一刻 —— 後者是一次性的，服務會在之後消失（`reconcile` 清掉、手動清理、主機重啟）。缺席時 **MUST** fail-loud 或自動補建，**NEVER** 讓它留到 runtime 由 app 層錯誤代言。

Fail-loud 的訊息 **MUST 點名 backing service 本身與修復指令**（例：`DB clone <consumer-b>_wt_<slug> 不存在 → node scripts/worktree-db.mjs create --slug <slug>`）。**NEVER** 只說「後端連線失敗」——那正是要避免的那層代言。

launcher 的「port LISTENING」判準對本問題恆為真（app 起得來、只是打不到 DB）。**NEVER** 拿「修復很便宜」當省略檢查的理由。跑 integration test、收 verify evidence 等預期 backing service 在的入口同樣適用。

Cookbook（naming / ownership / template refresh / path adapter / pool / cleanup 的 contract 與範例）：`vendor/snippets/worktree-db-isolation/`。

#### Schema cache 側：套用 migration 後 MUST 通知 PostgREST 重載

PostgREST 的 schema cache 只在收到 `NOTIFY <PGRST_DB_CHANNEL>` 時重建。因此**每一個**會套用
DDL 的入口——CI 的 migrate job、本機 `db:reset`、手動補 migration、integration test 的 setup——
在套用完成後 **MUST** 發一次 NOTIFY：

```bash
psql "$DATABASE_URL" -c "NOTIFY <PGRST_DB_CHANNEL>, 'reload schema'"
```

channel 名字 **MUST 從該 sidecar 的 `PGRST_DB_CHANNEL` 讀，NEVER 猜**——per-schema sidecar
拓樸下每個 schema 有自己的 channel，發錯 channel 不報錯、也不生效。

不發時新表在 PostgREST 回 `PGRST205` / 404，常被 app 包成 503；唯一會分岔的觀測是「經 PostgREST 打那張表」，migration exit 0 對 schema cache 零訊號。**NEVER** 把「記得手動發 NOTIFY」當成防線，要自動化。

實證與 detection 指令見 [[pitfall-migration-creates-table-postgrest-schema-cache-not-reloaded]]。

**in-memory Postgres（PGlite）已評估、不採用**（單 client、繞過 RLS、extension 對不上）；重啟條件見 `docs/discussions/2026-08-03-pglite-in-memory-db-rejected.md`。

## MUST

### 1. Schema migration gate（必備）

- **MUST** migration change 時 CI 跑 schema diff 或 migration replay（trigger 由 `workflow_model` 決定）
- **MUST** diff 結果以 commit comment / PR comment / artifact / status 形式可被 reviewer 看到
- **MUST** disposable DB instance 完全脫離 shared staging — 不允許用 staging schema 當 diff baseline
- **MUST** schema-gate 結果**真的擋住** staging migration（trunk-based: `deploy-staging.yml` 的 migrate job `needs: [schema-gate]`；pr-based: required check 鎖 merge）

### Trigger 由 `workflow_model` 決定

| Consumer `workflow_model` | Schema-gate trigger | 評論去處 | 阻擋方式 |
| --- | --- | --- | --- |
| `trunk-based` | `on: push: [main]`，pre-deploy step | commit comment | deploy-staging.yml migrate `needs: schema-gate` |
| `pr-merge-based` | `on: pull_request:` | PR comment | required status check |

**有 PR-CI infra 的 trunk-based consumer** 可同時跑 pr-based template 當早期 gate — 兩個並存無衝突。範本：`vendor/snippets/db-preview-env/schema-migration-gate/{trunk-based,pr-based}.workflow.yml.template`。

### 2. Staging isolation（必備）

- **MUST** staging environment 不承擔 pre-validation 角色 — schema 變動**MUST** 先過 schema-migration-gate 才能套 staging
- **NEVER** 讓 main push 直接觸發 staging migrate 而**跳過** schema-gate
- **MUST** PR / push validation 用 disposable PG（schema-migration-gate 即可滿足）

如果 consumer 目前 staging migrate 沒擋 schema-gate（即 main push 直接到 staging migrate 不經 throwaway diff），**MUST** 在 `docs/tech-debt.md` 開 TD 追蹤；不能無限延期。

### 3. Production data sanitization（必備條件）

凡 production data subset 進 non-prod 環境（無論是 preview、staging、本機）：

- **MUST** 先 sanitize（PII / secrets / credentials 全 masked）才能離開 production host
- **MUST** sanitization script version-controlled + reviewer-checkable
- **MUST** sanitize 以 `supabase_admin` / postgres super 等 RLS bypass 角色跑（否則 RLS 隱藏的 row 永遠不會 mask，是 leak risk）
- **MUST** masking 是 deterministic（FK / cross-table join 保留）+ type-preserving（email 還是 @-formed、phone 還是 +886-9...）
- **MUST** salt 來自 secret manager、每次 sanitize run 重抽，**NEVER** 把 salt commit 進 repo
- **NEVER** 把 sanitization 留到「preview runner 內」做 — 那已經太晚，raw PII 已進 non-prod

範本：`vendor/snippets/db-preview-env/sanitize/`（pgcrypto-based 因為 `postgresql-anonymizer` 不在 supabase/postgres image）。

### 4. Preview lifecycle（compose-stack / lxc-stack 才適用）

如果採用 ephemeral preview env（非僅 CI gate）：

- **MUST** 每 preview 有 unique secrets（JWT secret、DB password）— **NEVER** 跨 preview 共用
- **MUST** 有 TTL 或 close-signal 觸發的 teardown（trunk-based: tag-based / branch-deleted 觸發；pr-based: PR close 觸發）
- **MUST** 有 reconciliation job 清孤兒 stack
- **MUST** 命名規範 `<consumer>-<scope>-<n>`，避免跨 consumer 撞名（trunk-based scope 可為 commit-sha-prefix / branch-name；pr-based 為 pr-<n>）

### 5. Production migration classification + gate

沿用既有 supabase-migration skill 的三分類：

- `online-safe`：直接 push 即可
- `expand-contract`：需 N+1 deploy 流程 + 暫態驗證
- `maintenance-required`：需停機窗口

**MUST** commit / PR 描述標出 migration 風險分類；reviewer **MUST** 對 `expand-contract` / `maintenance-required` 拍板才能 merge / tag。

自動分類工具：`vendor/scripts/postgrest-migration-risk.mjs`（配 `postgrest-ready-gate.mjs`、`postgrest-smoke.mjs`），可串 `workflow_dispatch` input 做成手動 gate。

### 6. 主幹 deploy gate

至少**兩條獨立 workflow**：一條 **PR-validation gate**（schema-migration-gate 即滿足），一條 **production deploy**（tag-triggered）。

- **MUST** PR-validation gate 在 PR 階段跑，**NEVER** 用 shared staging 當 validation 環境
- **MUST** production deploy 走 tag-trigger（tag pattern 由 consumer 自選）
- **MUST** production workflow 內有明確 confirm gate（環境變數 / GitHub environment protection / approval reviewer / `workflow_dispatch` approve input 都算）
- **NEVER** 讓 PR / main push 直接打到 production
- **NEVER** 把 production deploy 跟 PR-validation 寫在同一條 workflow 內共用 trigger

`main → staging` + `tag → production`（有 persistent staging）與 `PR → schema-migration-gate` + `tag → production`（無 staging）都滿足契約；重點是 PR 驗證不污染 shared writeable env。

## SHOULD

- **SHOULD** PR comment 包含 schema diff 行數 + lint 結果 + 自動產出的 TypeScript types diff
- **SHOULD** preview env 大小限制（per-host concurrent preview cap）寫進 cookbook，避免 host RAM/disk 爆掉
- **SHOULD** sanitize script 同步維護「reviewer PII checklist」— 每次 schema 加新欄位，checklist 標註是否 PII + masking strategy

## Managed-platform preview（`shared-preview-db`）

Managed platform（Cloudflare Workers 等）自帶 per-version preview URL，缺的通常不是「怎麼生出一個環境」，而是「preview 別接 production DB」。這條路徑因此比 compose-per-PR 便宜一個數量級，但**能力也少一截**。

### 能力邊界 —— 先讀這段再決定要不要宣告

`shared-preview-db` 指**一個持久的 non-prod DB，所有 preview 共用**。它解掉的是：

- ✅ preview 不再讀寫 production 資料
- ✅ 每個 change 有自己的 URL，驗收時不會點錯環境
- ✅ 資料由 CI seed，打開就有可用 fixture

它**沒有**解掉本檔開頭的核心命題：

- ❌ **兩條 change 同時改 schema 仍然互踩** —— 它們共用同一個 preview DB
- ❌ **NEVER** 拿它當 § MUST 1 schema-migration-gate 的替代品

**MUST** 宣告 `shared-preview-db` 的 consumer 另外具備 `diff-only` 等級的 schema migration gate；尚未具備時 **MUST** 在 `docs/tech-debt.md` 開 TD 追蹤，不能無限延期。

### 適用前提（任一不滿足就不是這個變體）

- **MUST** preview 接的 DB 與 production **不同 instance** —— 只換 URL 不換 DB 的不算，那是「拿 production 當 preview」
- **MUST** seed 失敗**擋住** preview 發佈
- **MUST** 有一道機械檢查確認建置產物真的綁到 preview DB（build-time binding 的框架如 NuxtHub 會安靜地接回 production DB）
- **MUST** preview URL 的存取控制與 production 分開評估。平台的 preview URL 多半**預設公開**

### Cloudflare Workers trip-wires

| 事實 | 後果 |
| --- | --- |
| Preview URL **不會**為含 Durable Object 的 Worker 產生（官方明文） | 有 DO binding 的 consumer **不能**用這個變體，要先把 DO 拆成獨立 Worker |
| `preview_database_id` 只在 `wrangler dev --remote` 生效；`deploy` 與 `versions upload` 一律用 `database_id` | **NEVER** 靠它讓 preview 接不同 D1 —— 施力點是 `[env.*]` 區塊或 build-time env var |
| `preview_urls` 是 **non-versioned setting** | `versions upload` 不會套用它。首次啟用需要一次 `deploy`／`versions deploy`，或直接打 account API |
| `versions upload` 不支援 per-version env vars／secrets | secret 是 Worker 層級、由 production deploy 設定，preview version 直接繼承 —— 這也代表**preview 流程 NEVER 重設 secret**，那會動到 production 狀態 |

### 平台沒有這個能力時：宣告 `none`，不要繞

不是每個部署平台都做得出 per-change preview。**MUST** 先確認平台原生支援，再決定要不要投；平台沒有就宣告 `preview_db: none` 收工，**NEVER** 自己拼一個假的。

已查證的死路：**void.cloud**（`void@0.8.x`／`0.10.x`）無 per-change preview；`--project <name>` 開的是第二個 production，**NEVER** 拿它假裝 preview。

## Capability declaration

`registry/consumers.json` 每個有 DB 的 consumer **MUST** 宣告（不限 self-host Supabase —— managed platform 走 `shared-preview-db` 的一樣要宣告）：

```jsonc
"capabilities": {
  "preview_db": "none | diff-only | shared-preview-db | compose-stack | lxc-stack | clone-sidecar",
  "data_branching": "none | synthetic | sanitized-subset"
}
```

同一個值域也適用 `.claude/consumer-meta.json` 的 `database.previewEnvCapability`；兩處**MUST** 一致。URL 形狀另外宣告在 `deploy.previewUrlShape`（自由字串，填實際模板如 `https://<branch-slug>-<worker>.<subdomain>.workers.dev`）。

`db-preview-env-audit.ts` 比對宣告 vs 現實 — drift 進 `improvement-digest`，由人判斷是否該升 capability。

## 反模式

- ❌ 「先用 staging 驗 PR，merge 後 staging 跟 prod 同步」：靜默把 staging 變 PR 互踩戰場
- ❌ 「production dump 直接給 dev 同事」：raw PII 出 prod boundary
- ❌ 「自建 image 裝 postgresql-anonymizer」：image 升版會破壞、portable 差；用 pgcrypto-based deterministic SQL
- ❌ 「PR preview 共用 JWT secret」：跨 stack token 互用 = preview env 等於 prod
- ❌ 「migration 改動只跑 lint、不跑 disposable replay」：lint 只看 SQL 文法、不抓「這條 migration 跟既有 schema 衝突」
- ❌ 「有了 per-change preview URL 就不用 schema-migration-gate」：`shared-preview-db` 的所有 preview 共用同一個 DB，兩條 change 同時改 schema 照樣互踩 — URL 隔離不等於資料隔離
- ❌ 「preview 用 production DB，反正只是看畫面」：只要 preview 能寫入就會污染 prod，而「只是看畫面」在有登入 / 有表單的 app 從來不成立

## 相關

- D-pattern audit（`audit-pattern.md`）**不**等於 schema diff，兩者都要做
- preview env 同樣適用 `rules/modules/db-runtime/supabase-self-hosted/postgrest-resilience.md` 的 topology / reload channel 規則
- variant 選擇、cookbook 用法與 image 已知問題見 `rules/modules/db-runtime/supabase-self-hosted/preview-env.md`；migration 操作見 `supabase-migration` skill
