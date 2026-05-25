---
description: Manual Review backend 規約——backend-only change 特別規約 + 標準流程（含 verify channel baseline）；動 server / test / e2e / supabase 時 path-scoped 載入
paths: ['server/**/*.ts', 'test/**/*.ts', 'e2e/**/*.ts', 'supabase/**']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/manual-review.backend.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Manual Review — Backend Verification Flow

> Reference 檔。核心規約見 [`manual-review.md`](./manual-review.md)。本檔聚焦 backend-only change 的人工檢查特別規約，與所有 verify channel 的標準流程（含 `[verify:e2e]` / `[verify:api]` / `[verify:ui]` / multi-marker / `[review:ui]` flow / `[discuss]` flow / 混合 kind change），以及 dispatch 前必驗的 pre-verify baseline。

## Backend-only change 的特別規約

當 `proposal.md` 宣告 `**No user-facing journey (backend-only)**` 時，`## 人工檢查` 區塊適用更嚴的規約 — **只**允許三類項目（production 授權 / 商業判斷 / production 觀察），其餘 SSH / psql / curl / schema 驗證等 evidence collection **MUST** 寫進新的 `## N. Backend Verification Evidence` section 由 apply 階段 Claude 自跑自貼，**禁止**塞進 `## 人工檢查` 讓使用者扛。

完整規約（含三類定義、`## N. Backend Verification Evidence` 模板、例外宣告固定文字、反面範例）見 `ux-completeness.md` 的「必填 Backend-only Manual Review 規約」。`manual-review.evidence.md` 的「動詞 → 結果」格式只適用於有 user-facing journey 的 change。

## 標準流程

依 item 的 kind marker 走不同 flow。**MUST** 覆蓋 verify channels、`[review:ui]`、`[discuss]` — 一個 change 的 `## 人工檢查` 區塊可同時包含多種 kind 的 items。

### `[verify:*]` flow（spectra-apply Step 8a Verify Channel Pass）

tasks.md 有未勾 `[verify:e2e]` / `[verify:api]` / `[verify:ui]` / multi-marker items 時，spectra-apply Step 8a **MUST** 依 channel 分流處理。Cookbook 與範本見 `vendor/snippets/verify-channels/README.md`。

#### `[verify:e2e]` channel

**Dispatch**：主線 Claude **自己寫** Playwright spec 到 `e2e/verify/<change>/<topic>.spec.ts`（參考 `vendor/snippets/verify-channels/e2e-spec.template.ts`），跑：

```bash
pnpm test:e2e:verify <change>
```

**Evidence trail**：spec pass 後，主線在 item line 寫：

```text
(verified-e2e: <ISO-8601> spec=<repo-relative-path> trace=<repo-relative-path>)
```

**Archive-gate 結果**：`verify:e2e` 是 automatic channel；annotation present 即通過，可由 `autoCheckCompletedAutomaticItems(...)` 自動 flip `[x]`。缺 annotation 時 archive-gate **MUST** block。

#### `[verify:api]` channel

**Dispatch**：主線 Claude **自己跑** curl / ofetch HTTP round-trip（參考 `vendor/snippets/verify-channels/api-roundtrip.template.sh`），不得派 screenshot-review agent 代跑 API mutation。

**Evidence trail**：request 通過後，主線在 item line 寫：

```text
(verified-api: <ISO-8601> <METHOD> <URL> <STATUS>[ body=<sha256-12chars>])
```

**Archive-gate 結果**：`verify:api` 是 automatic channel；annotation present 即通過，可由 `autoCheckCompletedAutomaticItems(...)` 自動 flip `[x]`。缺 annotation 時 archive-gate **MUST** block。

#### `[verify:ui]` channel

**Dispatch**：主線 Claude 派 screenshot-review agent `mode: verify`，但 scope **只限** open known URL + wait for load + capture final-state screenshot + DOM observation（參考 `vendor/snippets/verify-channels/ui-final-state-brief.template.md`）。agent **NEVER** 負責 mutation / form fill / multi-role login；那些屬於 `verify:api` 或 `verify:e2e` channel。

**Evidence trail**：agent 回報 final-state screenshot 與 DOM 觀察後，主線在 item line 寫：

```text
(verified-ui: <ISO-8601> screenshot=<repo-relative-path>[ dom=<short-observation>])
```

**Archive-gate 結果**：`verify:ui` 是 semi-automatic channel；annotation present 只是 visual evidence，使用者仍 **MUST** 在 review GUI 點 OK 才能 flip `[x]`。缺 annotation 時 GUI 顯示 evidence missing；未勾 `[x]` 時 archive-gate **MUST** block。

#### Multi-marker items

Multi-marker item **MUST** 由主線依 channel order `e2e → api → ui` 逐一執行，每完成一個 channel 就寫對應 annotation。例：

```markdown
- [ ] #1 [verify:api+ui] admin 改 offset → 200 + grid 顯示更新 (verified-api: 2026-05-11T08:00:00Z PATCH /api/v1/machines/4/slots/403 200) (verified-ui: 2026-05-11T08:00:30Z screenshot=screenshots/local/<change>/#1-final.png dom=grid-updated)
```

- 若 item 只含 automatic channels（`verify:e2e` / `verify:api`），最後一個 channel annotation 寫入後 `autoCheckCompletedAutomaticItems(...)` 可自動 flip `[x]`。
- 若 item 含 `verify:ui` 或 `review:ui`，automatic channel 只完成 evidence；checkbox **MUST** 保持 `[ ]`，等使用者在 GUI 確認。
- Archive-gate **MUST** 對每個 kind 獨立驗證並取 worst-case（block > warn > pass）。

#### `[verify:auto]` deprecated alias

`[verify:auto]` 僅為 backward compatibility。解析時 **SHALL** 視為 synthetic `[verify:api+ui]`：

1. 主線先跑 `verify:api` channel，寫 `(verified-api: ...)`
2. 再跑 `verify:ui` channel，寫 `(verified-ui: ...)`
3. 使用者仍需在 review GUI 對 UI evidence 點 OK 才能勾 `[x]`

Archive-gate / parser **MUST** emit deprecation warning。新 authoring **NEVER** 使用 `[verify:auto]`；新項目必須使用 explicit `[verify:e2e]` / `[verify:api]` / `[verify:ui]` 或 multi-marker。

#### Pre-verify baseline 假設（hard rule）

Verify channel baseline 是 consumer 端**已預先 ready** 的 codebase 層長期狀態。主線 **MUST** 在 dispatch 前 grep / read 檢查 baseline；缺任何必要項即 stop + 回報 user 補齊，**NEVER** 派出去讓 agent / spec / curl 撞到再升 UNCERTAIN。

| Channel | Baseline |
| --- | --- |
| all `verify:*` | env-gated dev-login route 已就緒（用 audit script / detection helper 偵測，詳見下方 § Dev-login route missing → scaffold-first hard rule） |
| `verify:e2e` | Playwright config + `e2e/fixtures/index.ts` style three-role fixture（`adminPage` / `managerPage` / `staffPage`） |
| `verify:api` | `__test-login` 或等價 session bypass route，可讓 curl / ofetch 建立 role session |
| `verify:ui` | canonical seed data（`supabase/seed.sql` 或專案等價 seed 檔）覆蓋 final-state URL 所需 entity |

**Why**：baseline 維護不是任何單一 spectra change 的臨時工作。每次 verify dispatch 才問 user 或讓 agent 補 seed，會把長期 codebase baseline 拖進錯誤時機，且會製造 seed.sql source-of-truth 漂移。

**Agent 端對應行為**：`screenshot-review` verify mode 撞 baseline 缺（dev-login route 不存在 / seed 缺 entity / known URL 只能呈現空資料）屬 Fail-Fast UNCERTAIN；agent **NEVER** 補 seed、patch auth、或升級成 mutation runner。

**主線端對應行為**：

- Dispatch `verify:e2e` 前 **MUST** 確認 Playwright config、dev-login / `__test-login`、three-role fixture 存在。
- Dispatch `verify:api` 前 **MUST** 確認可用 session bypass route。
- Dispatch `verify:ui` 前 **MUST** 確認 dev-login route + seed file 存在。
- Baseline 不完整時，將缺口登記到 consumer 的 `ROADMAP.md` / `docs/tech-debt.md` / dedicated infra change，而不是降低 verification channel。

#### Dev-login route missing → scaffold-first hard rule

##### Detection（hard rule）

任何時候要**斷定** consumer **有沒有** dev-login route——不論目的是 (a) 決定要不要 scaffold、(b) 判斷某 `[verify:api]` item 是否 baseline-blocked、(c) **向 user 報告 dev-login 不存在 / verify 被 baseline 擋住**、還是 (d) **確認 review-gui「🚧 baseline 不齊」badge**——**MUST** 使用以下兩種路徑之一，**NEVER** 用 lazy grep / narrow `find`（如 `find server app -path "*_dev-login*"`、`grep -r _dev-login server/`）。這類 root-only 搜尋對 monorepo consumer（<consumer-a> 的 route 在 `packages/core/server/...`）**必** false-negative：

> **review-gui 的「🚧 baseline 不齊」badge 不是 file-existence 真相。** 它是 derived signal（且曾因自身 root-only 偵測對 monorepo consumer false-positive）。看到 badge **不代表** route 不存在；要斷定 absence **MUST** 跑下方 helper / audit script 交叉確認，**NEVER** 把 badge 當證據直接回報 user。

1. **CLI**（一次性 / cross-consumer 全景；**MUST 從 clade home 跑**，script 不散播到 consumer）：
   ```bash
   cd ~/offline/clade
   node scripts/audit-dev-login-adoption.mjs --consumer <consumer-abs-path>  # 單 consumer
   node scripts/audit-dev-login-adoption.mjs --json                          # 全 consumer JSON
   ```
2. **Programmatic**（dispatcher / 自家 tool 內 inline；helper 住 clade 中央倉）：
   ```js
   // dispatcher / clade-side tool 用 relative import
   import { detectDevLoginRoute, detectAuthModule } from '../snippets/dev-auth/lib/detect-dev-login-route.mjs'
   // consumer-side ad-hoc 用 absolute path
   const helper = require('/Users/<you>/offline/clade/vendor/snippets/dev-auth/lib/detect-dev-login-route.mjs')
   const route = helper.detectDevLoginRoute(consumerPath)  // { kind, path, monorepoSubpath }
   const auth = helper.detectAuthModule(consumerPath)      // { module, source, stackHint }
   ```

**Why hard rule**：lazy grep 在 2026-05-24 <consumer-b> session 實證**漏判 4/6 consumer**（legacy `__test-login.*` / monorepo subpath / better-auth POST shape 全沒命中），誤升級「結構性 adoption gap」task，浪費一輪 subagent + publish + 主線 token。Audit script + helper module 是清掉這類錯誤推理的單一 SoT。

**2026-05-25 <consumer-a> incident（second occurrence，跨工具）**：主線看到 review-gui 對 3 個 <consumer-a> change 標「baseline 不齊」，再用 `find server app -path "*_dev-login*"`（root-only）「確認」後**向 user 斷言 dev-login 不存在**。兩個依據犯同一個 monorepo root-only 盲區——<consumer-a> 的 route 一直在 `packages/core/server/routes/auth/_dev-login.get.ts`。Root cause 雙重：(1) review-gui `detectVerifyBaseline()` 重刻 root-only path 清單、沒復用本 helper（**已修**，改 delegate `detectDevLoginRoute()`）；(2) 主線在「確認 badge → 向 user 報告」的框架下沒套用本 hard rule（觸發條件已於上方擴寫涵蓋 (c)/(d)）。詳見 [[pitfall-review-gui-baseline-detection-root-only-monorepo-miss]]。

##### Canonical route shapes by auth-module（detection 真相層）

下表跟 helper module 共用 SoT（`vendor/snippets/dev-auth/lib/detect-dev-login-route.mjs`）。新增 route shape 時 **MUST** 同步改 helper + 這張表 + 對應 helper unit test。

| Auth module | Route shape | Helper `kind` |
| --- | --- | --- |
| nuxt-auth-utils canonical | `server/routes/auth/_dev-login.get.ts` / `.post.ts` | `canonical` |
| nuxt-auth-utils legacy | `server/routes/auth/__test-login.get.ts` / `.post.ts` | `legacy` |
| Supabase canonical (API) | `server/api/_dev-login.{get,post}.ts` / `server/api/_dev-signin.{get,post}.ts` | `canonical` |
| better-auth POST | `server/api/_dev/login.post.ts` / `server/routes/_dev/login.post.ts` | `better-auth-post` |
| Monorepo subpath（任 auth-module） | `packages/<x>/server/...`、`clients/<y>/server/...`、`apps/<z>/server/...` 下任一上述 shape | 對應 kind + `monorepoSubpath` 非 null |

Helper 掃描 priority：**repo root canonical → repo root legacy → repo root better-auth → monorepo canonical → monorepo legacy → monorepo better-auth → `none`**。第一個 existsSync 命中即 return；`.output/` / `node_modules/` / hidden dirs 排除。

##### False-negative case study（2026-05-24）

<consumer-b> HANDOFF.md 跑 lazy grep `_dev-login*` → 報「5/6 missing」要求 clade 結構性 scaffold-everywhere。實際 audit:

| Consumer | 實際狀態 | Lazy grep 結果 |
| --- | --- | --- |
| <consumer-b> | ✅ `server/routes/auth/__test-login.get.ts` (legacy, 166 行) | ❌ false-negative |
| <consumer-a> | ✅ `packages/core/server/routes/auth/_dev-login.get.ts` (monorepo) | ❌ false-negative |
| <consumer-d> | ✅ `server/routes/auth/_dev-login.get.ts` | ✅ |
| <consumer-c> | ✅ `server/api/_dev/login.post.ts` (better-auth POST) | ❌ false-negative |
| rental-scout | ❌ MISSING (nuxt-auth-utils + libsql-drizzle, no cookbook template) | ✅ |
| co-purchase | ❌ MISSING (同上) | ✅ |

**真實 adoption 4/6 + 1 monorepo misdetected + 2 真缺**（不是 1/6）。修法源頭 clade 2026-05-24 land：audit script + helper module + dispatcher fix（`scripts/audit-dev-login-adoption.mjs` + `vendor/snippets/dev-auth/lib/detect-dev-login-route.mjs` + `vendor/scripts/codex-dispatch-screenshot-verify.mjs` 對齊）。下次 agent / 主線撞「is dev-login present？」即走上述 detection 路徑，**NEVER** 再 lazy grep。

##### Scaffold 行為

Detection 確認 missing **且** consumer 對應 auth-module 有 cookbook template 時，agent **MUST** scaffold（per `agent-routing.md` Routing Table § Dev/test admin session cookie 取得 row）— **NEVER** 要求 user 走 Google OAuth + DevTools 複製 cookie。

Cookbook template 不存在的情境（如 nuxt-auth-utils + libsql-drizzle，當前 cookbook 只有 supabase-flavored template）：留給對應 consumer session opt-in，**不**機械 scaffold（per `clade-role-and-todo-discipline.md § clade 主線不替 consumer 規劃實作`）。Track via `docs/tech-debt.md`（當前 entry: TD-158）。

### `[review:ui]` flow（真的需要人）

tasks.md 仍有未勾 `[review:ui]` 項時，第一動作 **MUST** 是引導使用者跑 `pnpm review:ui` — 本地 GUI 自動依 `#N` / `#N.M` schema 配對截圖、可鍵盤完成 OK / Issue / SKIP、conflict-aware 寫回 tasks.md，不在 chat 內燒 token。完整工具行為見 `vendor/scripts/review-gui.mts`。

**NEVER** 預設用 `AskUserQuestion` 在 chat 內逐項彈對話框 — 那是 fallback，不是 default path。

**Fallback**（`pnpm review:ui` 不可用時 — consumer 沒有該 script、使用者明確拒絕 GUI、或 pure backend 完全無 UI 證據需求）：

1. 依 task 清單逐項準備截圖或證據
2. 說明截圖中看到的狀態
3. 問使用者這一項是否通過
4. 依使用者答覆決定勾選、保留未勾、或註記 skip

#### review-gui pre-flight warning

`pnpm review:ui` 渲染 `[review:ui]` / `[verify:ui]` item 前會 client-side 偵測 Pre-Review Data Readiness hard rule 違反（模糊指代 / 缺 UID / 缺 URL / multi-step 未拆）。Patterns 來自 `vendor/snippets/manual-review-enforcement/patterns.json`（與 `scripts/spectra-advanced/post-propose-manual-review-check.sh` 共用 single source-of-truth）。

- 看到 amber warning banner → 該 item 在 propose 階段沒被 hook 攔到（hook 漏網或被 bypass），建議跑 `/spectra-ingest` 補上 inline sample / scoped sub-items
- Banner 列出 hit pattern 與 manual-review.md sub-section anchor，並提示「建議跑 /spectra-ingest 補上」
- Banner **non-blocking**：user 仍可 OK / Issue / SKIP（warning 不擋住操作）
- Banner 用 amber 色，跟 verify channel evidence missing 的 red banner 區分

##### Bypass

對 hook regex 誤判（false positive）或刻意例外的 item，可加 `@no-manual-review-check[<reason>]` marker（見 `manual-review.data-readiness.md` 的「`@no-manual-review-check` Marker」段）跳過 banner + hook 檢查。Banner 不顯示，但 GUI 診斷 console 仍寫 `[info] #N bypass: <reason>` 留 audit trail。

### `[discuss]` flow

`[discuss]` items 由 `/spectra-archive` Step 2.5 Walkthrough 觸發；主線 Claude 主動準備 evidence（含 backend grep / query / SSH / curl / migration check 結果）→ 使用者明確 OK / Issue / Skip / Defer。

完整 spec（Defer-to-HANDOFF schema、Resume mode、HANDOFF.md `## Deferred discuss items` HTML marker schema、混合 kind change 順序）：詳見 [[manual-review.discuss]]。
