---
description: Manual Review backend 規約——backend-only change 特別規約 + 標準流程（含 verify channel baseline）；動 server / test / e2e / supabase 時 path-scoped 載入
paths: ['server/**/*.ts', 'test/**/*.ts', 'e2e/**/*.ts', 'supabase/**']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/manual-review.backend.md
Edit at: /Users/charles/offline/clade
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
| all `verify:*` | env-gated dev-login route 已就緒：`server/routes/auth/_dev-login.get.ts` 或 `server/routes/auth/__test-login.get.ts`（含 packages equivalent） |
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

### `[discuss]` flow（spectra-archive Step 2.5 Walkthrough）

tasks.md 有未勾 `[discuss]` 項時，**MUST** 走 spectra-archive Step 2.5 「Discuss Items Walkthrough」：

1. archive 階段主線 Claude **主動** Read tasks.md `## 人工檢查` 區塊，識別未勾 `[discuss]` items
2. 對每條 item，主線 Claude 主動準備 evidence（grep 結果、diff、command output、data summary、合理性分析）— **不要**等使用者開口
3. 向使用者展示 evidence + item description，請使用者明確 OK / Issue / Skip
4. **OK 路徑**：勾 `[x]` + 在 description 後、trailing markers 前插入 `(claude-discussed: <ISO-8601-timestamp>)` annotation
5. **Issue 路徑**：保持 `[ ]`、附 issue 註記、不擋 archive（使用者保留主導權）
6. **Skip 路徑**：勾 `[x]` + `（skip）` annotation

archive-gate.sh Check 4 會驗 `[discuss]` items 必須勾選或含 `(claude-discussed: ...)` evidence trail。

### 混合 kind change

一個 change 同時含未勾 `[verify:*]` + `[discuss]` + `[review:ui]` items 時，**MUST** 依以下順序執行（早→晚，讓 user 拿到的 review GUI 內容最完整）：

1. **apply 階段** — Step 8a Verify Channel Pass：主線依 `e2e → api → ui` 跑 verify channels，寫 `(verified-e2e:)` / `(verified-api:)` / `(verified-ui:)` annotations；automatic-only items 由 helper 自動勾 `[x]`
2. **archive 階段 Step 2.5** — Discuss Items Walkthrough：Claude 主動準備 `[discuss]` evidence、與 user 討論
3. **archive 階段 review GUI** — `pnpm review:ui` 一次處理所有未勾 `[review:ui]` + `[verify:ui]` items（user 在 GUI 看 evidence/screenshot 點 OK / Issue / Skip）

spectra orchestrator Archive Flow Step 1 已內建這個分流邏輯。
