---
description: Manual Review backend 規約——backend-only change 特別規約 + 標準流程（含 verify channel baseline）；動 server / test / e2e / supabase 時 path-scoped 載入
paths: ['server/**/*.ts', 'packages/*/server/**/*.ts', 'test/**/*.ts', 'packages/*/test/**/*.ts', 'e2e/**/*.ts', 'packages/*/e2e/**/*.ts', 'supabase/**']
---
<!-- Clade native rule; source: rules/core/manual-review.backend.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

## Runtime adapter boundary

The obligations, predicates, evidence schema, failure handling, and review timing in this source are shared. Concrete browser, dispatch, question, filesystem, and command mechanics are target-native and MUST come from the selected runtime fragment at the matching adapter path. A fragment declares only the capability it can prove; an absent or unverified capability remains blocked and MUST NOT be silently replaced by a neighbouring runtime.



# Manual Review — Backend Verification Flow

> 核心規約見 [[manual-review]]。本檔是 backend-only 規約、各 kind 的執行流程與 verify baseline。

## Backend-only change 的特別規約

`proposal.md` 宣告 `**No user-facing journey (backend-only)**` 時，`## 人工檢查` **只**允許 production 授權 / 商業判斷 / production 觀察三類；SSH / psql / curl / schema 驗證等 evidence collection **MUST** 寫進 `## N. Backend Verification Evidence` 由 session owner 自跑自貼，**禁止**塞給使用者。模板與反例見 [[ux-completeness]] § 必填 Backend-only Manual Review 規約。

## 標準流程

### `[verify:*]` flow（`/implement` 收尾的 Verify Channel Pass）

tasks 檔有未勾 `[verify:e2e]` / `[verify:api]` / `[verify:ui]` / multi-marker items 時，`/implement` 收尾 **MUST** 依 channel 分流處理**每一條**，不是只跑最後一條。Cookbook 與範本見 `vendor/snippets/verify-channels/README.md`。

#### `[verify:e2e]` channel

**Dispatch**：主線 session owner **自己寫** reproducible browser runner spec 到 `e2e/verify/<change>/<topic>.spec.ts`（參考 `vendor/snippets/verify-channels/e2e-spec.template.ts`），跑：

```bash
pnpm test:e2e:verify <change>
```

**Evidence**：pass 後跑 `evidence-store.mjs --write --kind verified-e2e --spec <path> --trace <path>`，把印出的 `(verified-e2e: <ISO-8601>)` 貼到行尾（[[review-gui-surface]] § Evidence 寫入路徑）。

**Gate 結果**（e2e 與 api 相同）：automatic channel，annotation present 即通過，session owner 可直接勾 `[x]`（per [[manual-review]] § automatic channel 例外）。缺 annotation 時 item 留在未勾狀態，**NEVER** 在那個狀態下報完成。

#### `[verify:api]` channel

**Dispatch**：主線 session owner **自己跑** curl / ofetch HTTP round-trip（參考 `vendor/snippets/verify-channels/api-roundtrip.template.sh`），不得派 target adapter visual verifier 代跑 API mutation。

**Evidence**：跑 `evidence-store.mjs --write --kind verified-api --method <M> --url <U> --status <S> [--body <sha256-12chars>]`，貼印出的 `(verified-api: <ISO-8601>)`。

#### `[verify:ui]` channel

**Dispatch**：主線 session owner 派 target adapter visual verifier `mode: verify`，但 scope **只限** open known URL + wait for load + capture final-state screenshot + DOM observation（參考 `vendor/snippets/verify-channels/ui-final-state-brief.template.md`）。agent **NEVER** 負責 mutation / form fill / multi-role login；那些屬於 `verify:api` 或 `verify:e2e` channel。

**Evidence**：跑 `evidence-store.mjs --write --kind verified-ui --screenshot <path> [--dom <obs>]`，貼印出的 `(verified-ui: <ISO-8601>)`。

- **NEVER** 一次 `--screenshot` 傳多個逗號分隔 path——多張圖就對同一 `(itemId, kind)` 跑多次 `--write`，或拆 `#N.M`
- sub-item `#4.1` 的截圖 **MUST** 以 `#4.1-` 開頭，**NEVER** 引用 parent 的 `#4-*.png`（讀端按 `#<item-id>-*` 配對）
- **MUST** 寫完立即讀回：`node <clade>/vendor/scripts/lib/evidence-store.ts --repo . --change <change> --item '#N' --kind verified-ui --json`，確認記錄存在、basename 前綴正確、檔案存在，**NEVER** 帶病 handoff

**Gate 結果**：semi-automatic channel，annotation 只是 visual evidence，仍 **MUST** 由人判（`ui-judgement` 卡 → `flow receipt`）才能 flip `[x]`。缺 annotation 時沒有卡，**NEVER** 在那個狀態下報完成。

#### Multi-marker items

Multi-marker item **MUST** 由主線依 channel order `e2e → api → ui` 逐一執行，每完成一個 channel 就寫對應 annotation。例：

```markdown
- [ ] #1 [verify:api+ui] admin 改 offset → 200 + grid 顯示更新 (verified-api: 2026-05-11T08:00:00Z) (verified-ui: 2026-05-11T08:00:30Z)
```

- 若 item 只含 verify channels（`verify:e2e` / `verify:api` / `verify:ui`），最後一個 channel annotation 寫入後 session owner 可直接勾 `[x]`。
- 若 item 含 `review:ui`，automatic channel 只完成 evidence；checkbox **MUST** 保持 `[ ]`，等人判畫面。
- 每個 kind **MUST** 獨立驗證，任一 kind 缺 annotation 整條 item 就不勾（對 `item.kinds` 是 `every`，不是 `some`）。**沒有機器在 archive 那一刻再驗一次**。

#### `[verify:auto]` deprecated alias

既有 `[verify:auto]` 解析為 `[verify:api+ui]`：先跑 api、再跑 ui，`(verified-ui:)` 寫入後 session owner 勾 `[x]`（人不再判）。沒有 deprecation warning 替你攔，新 authoring **NEVER** 使用。

#### Pre-verify baseline 假設（hard rule）

Verify channel baseline 是 consumer 端**已預先 ready** 的 codebase 層長期狀態。主線 **MUST** 在 dispatch 前 grep / read 檢查 baseline；缺任何必要項即 stop + 回報 user 補齊，**NEVER** 派出去讓 agent / spec / curl 撞到再升 UNCERTAIN。

| Channel | Baseline |
| --- | --- |
| all `verify:*` | env-gated dev-login route 已就緒（用 audit script / detection helper 偵測，詳見下方 § Dev-login route missing → scaffold-first hard rule） |
| `verify:e2e` | reproducible browser runner config + `e2e/fixtures/index.ts` style three-role fixture（`adminPage` / `managerPage` / `staffPage`） |
| `verify:api` | `__test-login` 或等價 session bypass route，可讓 curl / ofetch 建立 role session |
| `verify:ui` | canonical seed data 覆蓋 final-state URL 所需 entity，**且該 fixture 在 verify 連的 dev DB 實際可查得到**——remote db-runtime（非 `supabase-local`）的 `seed.sql` 檔有 ≠ dev DB 有，見下方 § Seed-file ≠ dev-DB |

Visual verifier 撞 baseline 缺屬 Fail-Fast UNCERTAIN，agent **NEVER** 補 seed、patch auth、或升級成 mutation runner。Baseline 不完整時登記到 consumer 的 `ROADMAP.md` / `docs/tech-debt.md` / infra change，**NEVER** 降低 verification channel。

#### Seed-file ≠ dev-DB（remote db-runtime 的 fixture baseline，hard rule）

`verify:ui` / `verify:e2e` 的 seed baseline **不是「`seed.sql` 檔裡有 sample」**，而是「**該 fixture 在 verify 實際連的 dev DB 可查得到**」。兩者在 remote db-runtime 會分離：

- `db-runtime` 非 `supabase-local` 時 dev DB 是遠端實例，`seed.sql` 有 fixture **不代表** dev DB 已載入。
- **MUST**：dispatch verify 前用 **API / MCP 實際查** fixture（`?search=<sample>` 回 ≥1 筆、或 MCP `execute_sql` count），**NEVER** 只 grep `seed.sql`。
- 檔有但 dev DB 沒 → 走該 consumer 的 sanctioned fixture-apply 路徑（self-hosted：`pnpm supabase:sync` + `pnpm db:reset`，⚠️ 共享 dev DB **先協調**），**NEVER** 起 local supabase 繞過（per [[db-topology-invariant]]）。
- `supabase-local` consumer 不受此限：seed.sql + 本地 `supabase db reset` 即 dev DB 真實狀態。

#### 禁止用 ephemeral API data 拍 verify 截圖（hard rule）

Step 8a evidence collection 發現 seed 缺 fixture 時，**MUST** 先補 seed 再拍，**NEVER** 用 API 臨時建 ephemeral data：

- **MUST**：把 fixture INSERT 寫進 `seed.sql` → `pnpm supabase:sync` → `pnpm db:reset` → 確認 dev DB 有 → 拍截圖
- **NEVER**：`curl POST /api/v1/<entity>` / `$fetch` / browser form submit 建 ephemeral data → 拍截圖

ephemeral data 在下一次 db:reset 就消失，截圖跟著 stale（[[pitfall-verify-evidence-ephemeral-fixture-washed-by-db-reset]]）。

#### Dev-login route missing → scaffold-first hard rule

##### Detection（hard rule）

任何時候要**斷定** consumer **有沒有** dev-login route（決定 scaffold、判 baseline-blocked、向 user 報告不存在、確認 review-gui「🚧 baseline 不齊」badge）——**MUST** 使用以下兩種路徑之一，**NEVER** 用 lazy grep / narrow `find`（root-only 搜尋對 monorepo 必 false-negative），也 **NEVER** 把 badge（derived signal）當證據直接回報 user：

1. **CLI**（一次性 / cross-consumer 全景；**MUST 從 clade home 跑**，script 不散播到 consumer）：
   ```bash
   cd ~/offline/clade
   node scripts/audit-dev-login-adoption.ts --consumer <consumer-abs-path>  # 單 consumer
   node scripts/audit-dev-login-adoption.ts --json                          # 全 consumer JSON
   ```
2. **Programmatic**（dispatcher / 自家 tool 內 inline；helper 住 clade 中央倉）：
   ```js
   // dispatcher / clade-side tool 用 relative import
   import { detectDevLoginRoute, detectAuthModule } from '../snippets/dev-auth/lib/detect-dev-login-route.ts'
   // consumer-side ad-hoc 用 absolute path
   const helper = require('<clade-home-abs-path>/vendor/snippets/dev-auth/lib/detect-dev-login-route.ts')
   const route = helper.detectDevLoginRoute(consumerPath)  // { kind, path, monorepoSubpath }
   const auth = helper.detectAuthModule(consumerPath)      // { module, source, stackHint }
   ```

lazy grep 會漏 legacy `__test-login.*`、monorepo subpath、better-auth POST shape（[[pitfall-review-gui-baseline-detection-root-only-monorepo-miss]]）。

##### Canonical route shapes by auth-module（detection 真相層）

下表跟 helper module 共用 SoT（`vendor/snippets/dev-auth/lib/detect-dev-login-route.ts`）。新增 route shape 時 **MUST** 同步改 helper + 這張表 + 對應 helper unit test。

| Auth module | Route shape | Helper `kind` |
| --- | --- | --- |
| nuxt-auth-utils canonical | `server/routes/auth/_dev-login.get.ts` / `.post.ts` | `canonical` |
| nuxt-auth-utils legacy | `server/routes/auth/__test-login.get.ts` / `.post.ts` | `legacy` |
| Supabase canonical (API) | `server/api/_dev-login.{get,post}.ts` / `server/api/_dev-signin.{get,post}.ts` | `canonical` |
| better-auth POST | `server/api/_dev/login.post.ts` / `server/routes/_dev/login.post.ts` | `better-auth-post` |
| Monorepo subpath（任 auth-module） | `packages/<x>/server/...`、`clients/<y>/server/...`、`apps/<z>/server/...` 下任一上述 shape | 對應 kind + `monorepoSubpath` 非 null |

Helper 掃描 priority：**repo root canonical → repo root legacy → repo root better-auth → monorepo canonical → monorepo legacy → monorepo better-auth → `none`**。第一個 existsSync 命中即 return；`.output/` / `node_modules/` / hidden dirs 排除。

##### Scaffold 行為

Detection 確認 missing **且**有對應 auth-module 的 cookbook template 時，agent **MUST** scaffold，**NEVER** 要求 user 走 Google OAuth + DevTools 複製 cookie。沒有 template 時 **relay 給該 consumer 的 session 決定 opt-in**，**NEVER** 只登記 `docs/tech-debt.md` 就結束。

### `[review:ui]` flow（真的需要人）

tasks.md 仍有未勾 `[review:ui]` 項時，第一動作 **MUST** 是 auto-triage 後跑 `flow gates --repo-only --require-empty`（[[proactive-skills.manual-review-entry]]）；exit 3 才把人導向面板（`pnpm review:ui --print`）。**NEVER** 預設在 chat 內逐項彈對話框——那只在面板不可用（服務起不來、使用者拒絕 GUI、純 backend 無 UI 證據）時當 fallback：逐項展示證據、問是否通過、依答覆勾選 / 保留 / 註記 skip。

Pre-Review Data Readiness 的違反由 `vendor/scripts/manual-review-check.sh`（patterns 在 `vendor/snippets/manual-review-enforcement/patterns.json`）在寫入時攔；沒有第二道攔截，發現漏網就直接改 tasks 檔並重跑。

### `[discuss]` flow

見 [[manual-review]] § `[discuss]` walkthrough。
