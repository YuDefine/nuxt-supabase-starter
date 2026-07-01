<!--
🔒 LOCKED — managed by clade
Source: rules/core/manual-review.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->

# 人工檢查（Manual Review）

> **本檔是 always-load 主檔**，只列核心 invariant、Item Kind Marker 一覽、claude-analyzed annotation、@evidence-via-marker、Parent State Derivation、Post-Edit Gate、禁止事項。  
> 詳細規約依場景 path-scoped 載入：
>
> | Sub-file | Path-scoped 觸發 | 內容 |
> | --- | --- | --- |
> | [[manual-review.backend]] | `server/**`、`test/**`、`e2e/**`、`supabase/**` | Backend-only change 規約 + 標準流程 verify channels + review:ui flow |
> | [[manual-review.data-readiness]] | `openspec/changes/**/proposal.md`、`tasks.md` | Pre-Review Data Readiness + step actionability + `@no-manual-review-check` marker + 截圖檔名配對 |
> | [[manual-review.evidence]] | `openspec/changes/**/tasks.md`、`docs/manual-review-archive.md` | 給 propose/spec 寫作者 + Kind 分類指引 + 反例 + `@no-screenshot` marker + annotation / marker 細節（claude-analyzed、awaiting-user-decision、@evidence-via-manual-review、@apply-blocked、ADR、真相層責任分工） |
> | [[manual-review.discuss]] | `openspec/changes/**/tasks.md`、`plugins/hub-core/skills/spectra-archive/**`、`HANDOFF.md` | `[discuss]` flow + Defer-to-HANDOFF + Resume mode + HANDOFF.md schema + 混合 kind change + 人工檢查時機詳解 |

## 核心規則

**NEVER** 自行標記 `## 人工檢查` 區塊中**屬於 `[review:ui]` kind** 的 `- [ ]` 為 `- [x]`。

**既有 `[x]` ≠ 已驗收**：archive / 收尾前遇到 `[review:ui]` 已是 `[x]` 但無對應 agent 自拍 screenshot evidence（`screenshots/local/<change>/#<id>-*.png`）時，一律視為 **false-green**，主線 **MUST** 無視 checkbox 自起 dev server + agent-browser 自拍自驗（跨 session 也自足），**NEVER** 假設 user 有截圖或信任前 session 代勾 — 自拍動作本身會撞出被 checkbox 掩蓋的 bug。詳見 [[agent-self-verification]] MUST item 8 + [[pitfall-review-ui-checkbox-without-agent-evidence-masks-bug]]。

`[review:ui]` items 的 checkbox 只能在以下流程中勾選：

1. 先派遣 screenshot review 流程截圖
2. 向使用者展示每個檢查項的實際畫面或證據
3. 使用者回覆 OK → 標記該項 `[x]`
4. 使用者回覆有問題 → 不標記，記錄問題
5. 使用者回覆 skip → 標記 `[x]` 並加註 `（skip）`
6. 使用者回覆 skip all → 全部標記 `[x]` 並註記

**`[discuss]` items 例外**：spectra-archive Step 2.5 walkthrough 中，主線 Claude 主動準備 evidence、向使用者展示後取得明確 OK，可由 Claude 勾選 `[x]` + 插入 `(claude-discussed: <ISO-8601-timestamp>)` annotation。詳見下方「Item Kind Marker」與「標準流程」章節。

**`[verify:e2e]` / `[verify:api]` automatic channel 例外**：spectra-apply Step 8a 寫入對應 `(verified-e2e/api: ...)` annotation 後，review-gui auto-check helper 可自動勾 `[x]`，不需使用者在 GUI 再確認；`[verify:ui]` 仍需使用者在 GUI 確認 visual evidence。

**前提不成立直接 skip 例外**：item 前提**可由程式碼 / 架構事實驗證為不成立**時（例：route 不存在、column 被 migration 移除、feature flag 永久關閉），Claude **MAY** 直接標 `[x]` + `（skip: <一行事實原因>）`，不走 `(awaiting-user-decision:)` 也不走 review-gui 迴圈。判定條件（**全部**成立才適用）：

- 前提不成立是**可程式碼驗證的事實**（grep auth middleware / route config / schema / feature flag），不是主觀商業判斷
- Claude 已實際跑驗證（grep / read / curl）確認事實成立
- annotation 內寫明事實根據（哪個檔 / 哪行 / 什麼機制）

**不適用**：「要不要改 auth 讓 staff 進」「要不要加這功能」等涉及商業取捨的判斷 — 仍走 `(awaiting-user-decision:)` 或 AskUserQuestion。

**`(claude-analyzed: route=E)` annotation 不勾 checkbox**：review-gui「接手分析」prompt 路由結論為 **(E) false positive / 等 user 重新評估** 時，Claude 可在帶 `（issue:）` 的 item 同行寫入 `(claude-analyzed: <ISO> route=E[ note=<...>])` annotation（語意：「已分析、ball in user's court」），但 **NEVER** 翻 checkbox。詳見下方「`(claude-analyzed: ...)` annotation」段。

## 人工檢查時機（Hard rule）

人工檢查 OK/Issue/Skip 是「最終驗收」性質的動作，**MUST** 集中在所有 implementation 改動（含 ingest 補 spec、apply 落 code、bug fix）完成後**一次性**做，**NEVER** 穿插在 ingest / apply 中段。

### 為什麼 / 正確 sequence / 例外 / Cross-ref

細節見 [[manual-review.discuss]] § 人工檢查時機詳解（為什麼 4 點、正確 sequence 全圖、archive-commit-order 對齊理由、例外 4 條、cross-ref）。

### 禁止事項

- **NEVER** 在 ingest 完、apply 還沒跑時引導 user 回 review-gui 評估 OK/Issue/Skip
- **NEVER** 在 (C) 路徑中段（ingest 跟 apply 之間、或 fix 跟 ingest 之間）跑 `/commit`
- **NEVER** 在 `/spectra-archive` **之前**跑 `/commit` 收 fix — 先 archive 再單一 commit，對齊 `archive-commit-order`
- **NEVER** 把 round N 評估結果當作「change 整體驗收完成」訊號
- **NEVER** 在 round N OK 後直接 archive；archive trigger 必須是「round N+1（含 ingest 新增 verify item 與 (A)/(B) fix）全綠」
- **NEVER** 用「先 fix 後 ingest」順序跑 commit — 同一輪 review:ui 觸發的改動 spec 跟 code 必須同 commit 出現

## 人工檢查與靜態 QA 的差別

screenshot review / 靜態截圖 QA（確認畫面、文案、佈局、狀態）**不能直接代勾**人工檢查；使用者確認（確認功能與結果符合期待）**可以**。截圖是證據，不是使用者確認本身。

## Screenshot Review ≠ Functional Verification（Hard Rule）

Screenshot review **只覆蓋視覺層**，**不**覆蓋功能 round-trip。下列工作 screenshot review **不能**算驗收完成：

- ✅ Screenshot 能驗：按鈕 / 控件**存在**、layout / 字級 / 色彩 / a11y attribute、empty / loading / error state 的**視覺呈現**
- ❌ Screenshot 不能驗（必須使用者實際驗收）：**form submit 真的送到 server**、**server 真的回 200 + DB 真的變更**、**dialog 提交後 list refetch + 顯示新狀態**、**edge case payload（null / 空 / 邊界）**、**權限拒絕 path**

### 為什麼這條 rule 存在 + 規約 + 寫作者指南

完整真實案例（2026-05-08 loan-conflict-prompt screenshot review 全綠 → 撞 ZodError）、`## 人工檢查` 區寫作的「動詞 → 結果」格式、給 propose / spec 寫作者的詳細指引：詳見 [[manual-review.evidence]] § 給 propose / spec 寫作者 + [[manual-review.backend]] § Screenshot Review ≠ Functional Verification。

核心 invariant（**MUST** 都做）：

- `## 人工檢查` 項目用「動詞 → 結果」format
- functional round-trip（form submit / mutation / API call → response → state update）**MUST** 列為使用者人工檢查項目，**NEVER** 把 screenshot review 「按鈕存在」當成 round-trip 已驗證
- **NEVER** 在使用者尚未真實互動驗收前 archive UI change

### Pre-Review Data Readiness（hard rule，摘要）

每條 `[review:ui]` / `[verify:ui]` item **MUST**：

1. **Sample inline 引用** — item 描述直寫具體 sample identifier（PK / UUID / business key），**禁止**模糊指代（「某張」「任一筆」「pick one」等）
2. **多步驟驗收條列 Step** — 含分支 / 互斥狀態 / 對稱驗證時 **MUST** 拆 `#N.M` scoped sub-items
3. **Sample 持久化寫進 seed** — 對應 sample **MUST** 由 propose 階段對應的 Fixtures / Seed Plan task 寫進專案 seed 檔（`supabase/seed.sql` 或等價）

完整禁止指代詞清單、必填三件事細節、互斥 / 對稱驗收範例、適用範圍、規則 rationale：詳見 [[manual-review.data-readiness]] § Pre-Review Data Readiness。

### `[review:ui]` 純功能驗證 step actionability（hard rule，摘要）

每條 `[review:ui]` item **MUST**：

- **明確 URL**（不要只寫頁面暱稱，寫出完整 route / URL）
- **逐步動作 sub-items**（`#N.M` scoped，每條一個原子動作）
- **預期觀察具體化**（具體 toast 文字 / badge 狀態 / route 變化，**禁止**「畫面正常」「狀態正確」）
- **實體裝置 / 規格外輸入 MUST 提供 dev 替代輸入路徑**（dev card UID input box、QR paste、dev inbound webhook stub 等）

完整通則、範例、規則 rationale、baseline 缺漏處理：詳見 [[manual-review.data-readiness]] § `[review:ui]` 純功能驗證 step actionability。

### Backend-only change 的特別規約

當 `proposal.md` 宣告 `**No user-facing journey (backend-only)**` 時，`## 人工檢查` 區塊適用更嚴的規約 — 只允許三類項目（production 授權 / 商業判斷 / production 觀察）。其餘 SSH / psql / curl / schema 驗證 evidence collection **MUST** 寫進 `## N. Backend Verification Evidence` section 由 apply 階段 Claude 自跑自貼。

完整三類定義、模板、例外宣告固定文字、反面範例：詳見 [[manual-review.backend]] § Backend-only change 的特別規約 + [[ux-completeness]] § 必填 Backend-only Manual Review 規約。

## 可解析格式（hard rule）

`tasks.md` 的 `## 人工檢查` 區塊必須使用可被工具穩定解析的 `#N` schema：parent item 用 `- [ ] #1 ...`；scoped sub-item 必須剛好縮排兩個空白並使用 `#N.M`。禁止在 `## 人工檢查` checkbox line 使用 legacy section ids（例如 `8.1`、`9.3`），也禁止省略 `#N` / `#N.M`。這個 schema 只讓 tooling 能定位與寫回項目，不改變人工檢查 ownership：agent 仍然 **NEVER** 在未取得使用者明確 OK、Issue handling、skip 或 skip all 前自行勾選 `[review:ui]` items。完整格式範例見 [[manual-review.evidence]] § 可解析格式。

### Parent State Derivation（hard rule）

Parent item `#N` 若有 scoped sub-items（`#N.M`），parent state **MUST** 由所有 children AND derive，不接受 user 或 agent 直接對 parent line 給 feedback：

- 所有 children `[x]` 且無 `（issue: ...）` annotation → parent line `[x]`
- 任一 child `[ ]`、或帶 `（issue: ...）` → parent line `[ ]`（rollup 後若 child 改 issue 也要 un-rollup 回 `[ ]`）

#### 真相層責任分工

細節見 [[manual-review.evidence]] § Parent State Derivation — 真相層責任分工（各真相層 leaf-only count MUST 責任表）。

#### 禁止項

- User 透過 GUI 對 parent line 直接 OK / Issue / Skip — GUI **MUST** 隱藏 parent 的 feedback 控制（既有行為：「母項不需要回饋，請對下方子項分別作回饋」）
- Agent 自行 Edit tasks.md 把 parent flip `[x]` — 違反本段 + 「NEVER 代勾 review:ui」核心規則。Parent state 由 children 透過 GUI 自動 rollup，**不**經 agent 操作
- 任何 gate / tooling 用 naive `grep '- \[ \]'` 或同義邏輯計 pending — **MUST** 排除 parent-with-scoped-children

## Item Kind Marker（hard rule）

每條 `## 人工檢查` checkbox 行 **MUST** 在 `#N` / `#N.M` 後緊接一個 leading kind marker。合法 marker：

- `[review:ui]` — 需要使用者親自確認的 UI / UX 驗收。例：收 email / 收 webhook / 實體裝置 / 視覺主觀美感 / 真機跨機器。**MUST** 由使用者完成，agent 禁止代勾。
- `[discuss]` — Claude 主導的 evidence-based 討論項目。例：production 授權、商業判斷、production 觀察、後端 evidence 查驗。spectra-archive Step 2.5 walkthrough 流程下，Claude 主動準備證據與使用者討論、取得 OK 後可代勾並寫入 `(claude-discussed: <ISO-8601-timestamp>)` annotation。**`[discuss]` items MUST 由 `/spectra-archive` Step 2.5 walkthrough 觸發推進，NEVER 由 review:ui home page handoff prompt（含「等 Claude 接手」群「接手分析 prompt」按鈕）dispatch 給接手 Claude**。理由：production-observation / production 授權 / 商業判斷類 item 的勾選 trigger 是外部 signal（deploy / soak / 商業決策），Claude 提前分析只會回「等外部 signal」、tasks.md 無更新、change 永遠卡在 review:ui pending state、archive 不了。對應 review-gui 行為：純 D-only pending（I=0、V=0、evidenceMissing=0）的 change MUST 進「🗓 等 archive walkthrough」群、無接手 prompt 按鈕。
- `[verify:e2e]` — Playwright spec-based automated round-trip。主線在 `e2e/verify/<change>/<topic>.spec.ts` 寫 spec、跑 `pnpm test:e2e:verify <change>`，通過後寫 `(verified-e2e: <ISO> spec=<path> trace=<path>)` annotation。
- `[verify:api]` — 純 HTTP round-trip（curl / ofetch / fetch）。主線跑 request，通過後寫 `(verified-api: <ISO> <METHOD> <URL> <STATUS>[ body=<hash>])` annotation。**裝 `nuxt-csurf` 的 consumer** MUST 走 dual-token recipe（否則 POST 第一次就撞 403）— 見 `~/offline/clade/vendor/snippets/verify-channels/api-roundtrip.template.sh`。
- `[verify:ui]` — final-state screenshot + DOM observation。主線派 screenshot-review agent `mode: verify` 只開已知 URL、等待載入、截 final-state screenshot、記錄 DOM 觀察，回來後寫 `(verified-ui: <ISO> screenshot=<path>[ dom=<obs>])` annotation；使用者仍需在 review GUI 點 OK 才勾 `[x]`。
- `[verify:<a>+<b>]` / `[verify:<a>+<b>+<c>]` — multi-marker，僅允許組合 `e2e` / `api` / `ui` verify channels，例如 `[verify:api+ui]` 或 `[verify:e2e+ui]`。
- `[verify:auto]` — **DEPRECATED alias**，僅為既有 consumer tasks.md 相容保留；解析時視為 synthetic `[verify:api+ui]` 並 emit deprecation warning。新項目 **NEVER** 使用 `[verify:auto]`。

### Canonical line format

```
- [ ] #N [<kind>] <description> [(verified-<channel>: ...)]... [(claude-analyzed: ...)] [@followup[TD-NNN]] [@no-screenshot]
```

- Marker **MUST** 是 `#N` / `#N.M` 後第一個 token，與 id 之間僅一個空白。
- Marker 出現在 description 中間（例：`Click the [discuss] button`）視為 plain text，**MUST NOT** 被解析成 marker。
- `[review:ui]` / `[discuss]` 不得與 verify multi-marker 混用。`[verify:api+review:ui]`、`[verify:api+discuss]` 都是非法 marker。
- Verify multi-marker 的 channel canonical order 是 `e2e → api → ui`；annotation 寫回也 **MUST** 依此順序。

### `(claude-analyzed: ...)` annotation（Claude-writable）

當 review-gui 「🤖 等 Claude 接手」群 → 「接手分析」prompt 走完後，Claude 路由結論為 **(E) false positive / item 應改回 OK 或翻 [x] / 需 user 重新評估** 時，**MAY** 在帶 `（issue:）` 的 item 同行寫入此 annotation 作為 evidence trail，告訴 GUI「我已分析過、ball in user's court」。

#### Schema / Claude 可寫條件（hard rule）

```text
(claude-analyzed: <ISO-8601> route=E[ note=<sanitized one-liner>])
```

核心可寫條件：**MUST** 路由 **(E)** 結論 + item 已帶 `（issue:）` 時才寫；**MUST NOT** 翻 checkbox、**MUST NOT** strip 既有 `（issue:）`、**MUST NOT** 在路由 (A)–(D) 結論時寫（那些情境 user 仍需要 Claude 動作）。

#### 欄位細節 / Strip semantics / 與 `(claude-discussed:)` 的差異 / Home page 影響 / 範例

見 [[manual-review.evidence]] § `(claude-analyzed:)` / `(awaiting-user-decision:)` Schema 欄位與可寫條件、§ `(claude-analyzed: ...)` annotation 細節。

### `(awaiting-user-decision: ...)` annotation（Claude-writable）

當 Claude 判定某 pending item 是**純 user 商業決策**（production 授權 / 商業判斷），自己推不動、已準備好 decision packet 呈 user 時，**MAY** 在該 item 同行寫入此 annotation 把球交還 user。與 `(claude-analyzed:)` 對稱，但語意是「等 user 商業拍板」而非「等 user 重新評估 UI」。寫入後 change 落 **`awaitingUserDecision`** bucket（review-gui home page「🧑‍⚖️ 等 user 決策」群），master button 排除、不再抓回硬做。

#### Schema / Claude 可寫條件（hard rule）

```text
(awaiting-user-decision: <ISO-8601>[ packet=<path>])
```

核心可寫條件：**MUST** 在判定該 item 是純 user 商業決策、且已準備 decision packet 後才寫（**不**要求 item 已帶 `（issue:）`）；**MUST NOT** 翻 checkbox；**MUST NOT** 用此 annotation 規避該 item 其實 actionable 的情況 — 可走 (A)/(B)/(C) 路徑就 **MUST** 走。

#### 欄位細節 / Strip semantics / CLI 寫入入口 / Home page 影響

見 [[manual-review.evidence]] § `(claude-analyzed:)` / `(awaiting-user-decision:)` Schema 欄位與可寫條件、§ `(awaiting-user-decision: ...)` annotation 細節（含 `mark-claude-analyzed.mjs` CLI helper）。

### `@apply-blocked[<reason>]` marker（impl 卡外部 blocker）

當 change 的 implementation 卡在**外部 blocker**（等決策 / 等別 change / 缺資源），Claude 推不動、不該被 master button 反覆抓回硬做時，在 **tasks.md 任意處獨立一行**加 `@apply-blocked[<reason>]`（檔層級 marker，非 `## 人工檢查` item 行）。bearing change 分到 `applyBlocked` bucket、master button 排除；解 blocker 後 **MUST** 移除 marker 讓 change 回 `applyInProgress`。bucket 條件、`<reason>` 寫法、HANDOFF paper-trail SHOULD：見 [[manual-review.evidence]] § `@apply-blocked[<reason>]` marker 細節。

### Default Kind Derivation Rule（fallback）

當 item 行無 leading marker（典型情境：legacy in-flight change），parser 依 `proposal.md` 推導 default kind：

- proposal 含 `**No user-facing journey (backend-only)**` → default kind = `discuss`
- 其餘 → default kind = `review:ui`

**Fallback 不涵蓋任何 `verify:*`** — 不能由 proposal default silent derive；新寫 verify items **MUST** 顯式標 marker。

**Fallback ≠ 允許省略**：所有**新寫**或**ingest 修改**的 `## 人工檢查` items **MUST** 顯式標 marker；default 只給既有 in-flight change 過渡用（propose / ingest 的 Marker Hygiene Check hook 會擋）。

> **ADR (2026-05-22) — Default Kind Flip 未採用，勿再提案**：看到 missing marker 的正解是補 explicit marker（hook 已 fail-fast 擋），**不該**反射性提案改 default。完整 4 點理由與 future-agent 指引見 [[manual-review.evidence]] § ADR (2026-05-22) — Default Kind Flip 未採用。

### 與 `@no-screenshot` / `@followup[TD-NNN]` 共存 ordering

`[<kind>]` 永遠在最前（緊接 `#N`），`@no-screenshot` 永遠在最後；`@followup[TD-NNN]` 若存在須夾在 description 與 `@no-screenshot` 之間（見上方 Canonical line format）。所有寫回 annotation（`（issue:）` / `（skip）` / `（note:）` / `（finding:）` 與 `(claude-discussed:)` / `(claude-analyzed:)` / `(awaiting-user-decision:)` / `(verified-*:)`）**MUST** 插在 description 後、所有 trailing markers 前。`（finding: ...）` 與其他 action annotation 正交（可共存於同一行），其餘 action annotation 之間仍互斥；`(claude-analyzed:)` 與 `（issue:）` 必須共存。

### Kind 分類指引（摘要）

寫 `## 人工檢查` 時的判定原則：主線能用 Playwright spec 重現 journey / persistence → `[verify:e2e]`；能用 curl / ofetch 重現 HTTP round-trip → `[verify:api]`；只需 final-state screenshot + DOM observation → `[verify:ui]`；同一 business assertion 需多種 evidence → `[verify:<a>+<b>]`；需 SSH / psql / cron 等不可由 HTTP 重現的 walkthrough → `[discuss]`；真的需要人（email / webhook / 實體裝置 / 視覺主觀 / 真機 / SMS）→ `[review:ui]`。

完整 kind by-kind 詳細描述、反面範例（「按鈕應隱藏」「authz status matrix」「persistence」常見誤標）、`[review:ui]` 收斂原則 hard rule：詳見 [[manual-review.evidence]] § Kind 分類指引。

## `@no-screenshot` Marker（hard rule，摘要）

純 functional round-trip 且 screenshot review 無法提供視覺證據時，在 checkbox line 行尾加 `@no-screenshot` marker。`pnpm review` 視為 round-trip-only manual-review item，使用者親自操作後直接勾 OK、不需截圖。

Marker schema、canonical ordering（與 `@followup` / `@no-manual-review-check` 共存）、範例：詳見 [[manual-review.evidence]] § `@no-screenshot` Marker。

## `@no-manual-review-check` Marker（hard rule，摘要）

針對 hook regex 誤判（false positive）或合法例外（如真機掃 SMS 驗證碼等無 dev replay endpoint 場景），在 checkbox line 行尾加 `@no-manual-review-check[<reason>]` marker，跳過 Pre-Review Data Readiness regex 檢查（hook + review-gui banner 都 skip）。

Marker schema、`<reason>` 必填規約、canonical ordering、audit trail、跟 hook regex 的關係：詳見 [[manual-review.data-readiness]] § `@no-manual-review-check` Marker。

## `@evidence-via-manual-review` Marker（hard rule）

針對「impl 已做、verification evidence 必須在 review-gui `## 人工檢查` 區蒐集」的 phase task，加 `@evidence-via-manual-review` marker 把該 task 從 review-gui 90% implementation-progress threshold 計數中排除。**這條 marker 用在 phase task line（regex `^- \[([ x])\] N.M `），不用在 `## 人工檢查` `#N` / `#N.M` items**。

### Schema（核心）

- Marker 形式：`@evidence-via-manual-review`，**MUST** 是 trailing token（位於 phase task line 行尾）；沒有 brackets / reason 欄位
- 同一行 **MUST NOT** 出現多個 marker；出現在 description 中間視為 plain text，**MUST NOT** 被解析成 marker
- Bearing task 的 `[ ]` / `[x]` 由 author 決定，**不**受 review-gui 強制；archive gate 仍依 `## 人工檢查` items 完成度獨立判斷

### 解決什麼問題 / 何時該用、不該用 / Review-gui 行為 / Audit trail / 與其他 marker 共存

細節見 [[manual-review.evidence]] § `@evidence-via-manual-review` Marker 細節（threshold deadlock 圖、canonical line format 與範例、「驗證」clause 字眼清單、excluded 計數行為）。

## 截圖檔名與 item id 配對（hard rule，摘要）

`pnpm review` 自動把截圖配到 item，**MUST** 用：

```text
#<item-id>[<variant>]-<descriptor>.<ext>
```

例：item `#1` → `#1-clock-light.png`、`#1a-clock-dark.png`；scoped item `#3.1` → `#3.1-mobile.png`。

完整命名規範（含變體、legacy fallback、違反處理）：詳見 [[screenshot-strategy]] + [[manual-review.data-readiness]] § 截圖檔名與 item id 配對。

## review-gui 補 evidence prompt 路徑分類（hard rule）

review-gui 主頁卡片上的「📋 補 evidence prompt」按鈕是 **fallback** 不是 **default**。

**Default flow**（主線負責）：

- spectra-apply Step 8b handoff message **之前**，主線 **MUST** 對每個 evidence-missing item 跑一輪 self-collect（per spectra-apply SKILL.md Step 8a 自接路徑 (a)(b)(c)(d)）
- 成功 → 寫 `(verified-*:)` annotation，review-gui auto-check helper 自動勾 `[x]`
- 失敗 → 寫 `（deferred: tried (a)(b)(c)(d), <reason>）` annotation，註明已嘗試 path
- 跑完一輪後**仍** evidence-missing 的 item 才進 review-gui handoff — user 在 GUI 看到的是「剩下真需要 user 拍板」的收斂集合

**Fallback flow**（user 主動觸發才合用）：跨 session 補拍（已 archive 後補 visual / journey evidence）、主線 self-collect fail 後 user 想 ad-hoc 拍（瀏覽器手拍 / 條碼槍真機 / kiosk 平板等 agent 不能達的工具）、user 主動加 extra evidence。

**NEVER** 把「補 evidence prompt」當 default 入口 — 那等於把 self-automatable evidence collection 變成 user 手動儀式（per [[pitfall-verify-evidence-handoff-instead-of-self-collect]]）；**NEVER** 設計上預期 user 必須點按鈕才能由 Claude 接手 — Claude 在 Step 8b 就該已經跑過一輪。

判別測試：「user 打開 review-gui 看到 evidence missing 時，是否還需要點按鈕才能 Claude 接手？」是 → 規約缺；否 → 正確路徑。

## 標準流程（依 kind 分流）

依 item 的 kind marker 走不同 flow。**MUST** 覆蓋 verify channels、`[review:ui]`、`[discuss]`（同一 change 可多 kind 並存）。

| Kind | Flow 觸發點 | 完整 spec 位置 |
| --- | --- | --- |
| `[verify:e2e]` / `[verify:api]` / `[verify:ui]` / multi-marker | spectra-apply Step 8a Verify Channel Pass | [[manual-review.backend]] § `[verify:*]` flow |
| `[review:ui]` | spectra-archive `pnpm review` GUI 引導 | [[manual-review.backend]] § `[review:ui]` flow |
| `[discuss]` | spectra-archive Step 2.5 Walkthrough | [[manual-review.discuss]] § `[discuss]` flow |
| 混合 kind | apply Step 8a → archive Step 2.5 → review GUI | [[manual-review.discuss]] § 混合 kind change |

核心 invariant（**MUST** 都做，與「核心規則」一致）：

- `[verify:e2e]` / `[verify:api]` annotation 寫入後可自動 flip `[x]`；`[verify:ui]` annotation 後仍 **MUST** 使用者在 review GUI 點 OK
- `[review:ui]` **NEVER** 由 agent 代勾；`[discuss]` 由主線在 archive Step 2.5 主動準備 evidence 走 walkthrough，OK → 勾 `[x]` + `(claude-discussed: <ISO>)`

Verify channel pre-baseline 假設（all `verify:*` channel 都依賴 codebase-level baseline，**MUST** 主線預檢、缺則停下回報，**NEVER** 派 agent 撞 baseline 缺）、dev-login route missing → scaffold-first hard rule、Detection helper（`vendor/snippets/dev-auth/lib/detect-dev-login-route.mjs`）+ audit script（`scripts/audit-dev-login-adoption.mjs`）為 detection SoT、cookbook 範本（`vendor/snippets/verify-channels/`）：詳見 [[manual-review.backend]] § `[verify:*]` flow + Pre-verify baseline 假設 + Dev-login route missing → scaffold-first hard rule。

## Post-Edit Validation Gate（hard rule）

修改 `tasks.md` `## 人工檢查` 區（透過 `/spectra-ingest` / `/spectra-propose` / 手動 Edit）後，**MUST** 在 commit 前重跑 hook 驗證 0 violation，**NEVER** 只靠目測。

```bash
bash scripts/spectra-advanced/post-propose-manual-review-check.sh <change-name>
```

預期輸出 `✓ post-propose-manual-review-check passed (N items)` 才能 commit。出現 finding 即修，修完重跑直到綠燈。

### Stale-hook fallback（worktree drift 場景）

Worktree-local hook / patterns.json 是 pre-update stale 版本撞 false positive 時的 recovery 三路徑：見 `~/offline/clade/vendor/snippets/manual-review-enforcement/README.md` § Stale-hook recovery。

## 禁止事項

- **NEVER** 問「要不要我直接幫你勾完」
- **NEVER** 在未展示證據的情況下代勾任何 item（含 `[discuss]` items — Step 2.5 walkthrough 的 evidence 展示是強制前提）
- **NEVER** 對 `[review:ui]` items 在使用者尚未親自 round-trip 的情況下代勾，即使 Claude 已分析過程式碼
- **NEVER** 對 `[verify:e2e]` / `[verify:api]` items 在 annotation 寫入後仍要求 user 在 GUI 確認（automatic channel 自動 done）
- **NEVER** 對 `[verify:ui]` items 在使用者尚未於 review GUI 確認 visual evidence 前代勾 `[x]`
- **NEVER** 新增 `[verify:auto]` marker 給新 item
- **NEVER** 在 `verify:ui` agent dispatch 時讓 agent 同時負責 mutation / form fill / multi-role login（那些屬 api / e2e channel）
- **NEVER** 對任何 `verify:*` channel 在 evidence 沒成功產出時寫 `(verified-<channel>:)` annotation
- **NEVER** 寫 `screenshots=`（複數 key）— 唯一合法 key 是 `screenshot=`（單數）；review-gui parser 不認複數，直接 malformed → user 被迫手動排查
- **NEVER** 在 scoped sub-item `#N.M` 的 `(verified-ui:)` annotation 引用 parent `#N` 的截圖檔名 — screenshot path basename **MUST** 以 `#<this-item-id>-` 開頭（例：`#4.1` → `#4.1-*.png`，**NEVER** `#4-*.png`）；review-gui 按 item ID 配對，ID 不符 → evidence missing
- **NEVER** 把 screenshot review 當成等同於人工功能驗證
- **NEVER** 為了通過 gate 而批次勾選未確認的項目
- **NEVER** 對 `[discuss]` items 寫入 `(claude-discussed: ...)` annotation 而沒有實際與使用者討論並取得 OK
- **NEVER** 對非「External signal pending」trigger 分類的 `[discuss]` item 走 Defer-to-HANDOFF 路徑
- **NEVER** 在 Resume mode 外（archived change directory）寫 `(deferred-to-handoff: ...)` annotation
- **NEVER** 對沒帶 `（issue: ...）` 的 item 寫 `(claude-analyzed: ...)` annotation
- **NEVER** 用 `route` 值不為 `E` 的 claude-analyzed（目前 hard rule 限 `E`）
- **NEVER** 在寫 `(claude-analyzed: ...)` 時翻 checkbox
- **NEVER** 在 GUI 寫回 user action（OK / Issue / Skip）時遺漏 strip `(claude-analyzed: ...)` annotation
- **NEVER** 用 `(awaiting-user-decision: ...)` annotation 規避該 item 其實 actionable 的情況 — 可走 (A)/(B)/(C) 路徑就 **MUST** 走，不可推給 user
- **NEVER** 用 `(awaiting-user-decision: ...)` 標註前提事實上不成立的 item — 那是可驗證事實，走「前提不成立直接 skip 例外」（核心規則段）
- **NEVER** 在寫 `(awaiting-user-decision: ...)` 時翻 checkbox
- **NEVER** 把 `@apply-blocked[<reason>]` 當「不想做就標一下」的逃生口 — 只在真正卡外部 blocker 時用
- **NEVER** dispatch verify channels 前不檢查 per-channel baseline — 主線預先 grep / read 確認，缺則停下回報 user 補齊
- **NEVER** 在 verify dispatch 當下才問 user「dev-login / seed 準備好了嗎」— baseline 是 codebase 層長期狀態
- **NEVER** 修完 `## 人工檢查` 區後直接 commit 而沒重跑 `post-propose-manual-review-check.sh` 驗 0 violation — 見「Post-Edit Validation Gate」
