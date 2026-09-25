---
description: 人工檢查（Manual Review）主檔——核心 invariant、Item Kind Marker、annotation schema、[discuss] walkthrough、Parent State Derivation、Post-Edit Gate；有進行中的 work item（動 tasks/**、specs/plans/**）或在整理 screenshots 時載入
paths: ['tasks/**', 'specs/plans/**', 'screenshots/**']
---
<!-- Clade native rule; source: rules/core/manual-review.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

## Runtime adapter boundary

The obligations, predicates, evidence schema, failure handling, and review timing in this source are shared. Concrete browser, dispatch, question, filesystem, and command mechanics are target-native and MUST come from the selected runtime fragment at the matching adapter path. A fragment declares only the capability it can prove; an absent or unverified capability remains blocked and MUST NOT be silently replaced by a neighbouring runtime.



# 人工檢查（Manual Review）

> 子檔：[[manual-review.backend]]（verify channel flow、backend-only、baseline）、[[manual-review.data-readiness]]（sample / step actionability / `@no-manual-review-check`）、[[manual-review.evidence]]（authoring schema、Kind 分類、`@no-screenshot`、legacy 對照）。後兩者與本檔同在 `tasks/**` 載入，本檔不複述它們。

## 這套機制在解什麼問題（先讀，決定你該不該用它）

截圖證據是**防偽**——證明 agent 真的做了、成品真的長那樣，擋 `[x]` 但沒做的 false-green；它不做美學判斷。**美學判斷 MUST 在設計階段做完**（`design` skill § Step 1.8 Component Candidates）。所以 `[review:ui]` 的驗收問題只有一個：**有沒有做到設計階段說好的樣子**；review 時才冒出「另一個組合更好」就回設計階段補，**NEVER** 在 review 迴圈裡迭代設計。

## 核心規則

**NEVER** 自行標記 `## 人工檢查` 區塊中**屬於 `[review:ui]` kind** 的 `- [ ]` 為 `- [x]`（誰可勾什麼見 § Checkbox ownership）。

**既有 `[x]` ≠ 已驗收**：archive / 收尾前遇到 `[review:ui]` 已是 `[x]` 但無對應 agent 自拍 screenshot evidence（`screenshots/local/<change>/#<id>-*.png`）時，一律視為 **false-green**，主線 **MUST** 無視 checkbox 自起 dev server + 依環境自拍自驗（依 target adapter 的 browser carrier），**NEVER** 假設 user 有截圖或信任前 session 代勾。詳見 [[agent-self-verification.screenshot-evidence]] MUST 8 + [[pitfall-review-ui-checkbox-without-agent-evidence-masks-bug]]。

`[review:ui]` items 的 checkbox 只能在以下流程中勾選：

1. 先派遣 screenshot review 流程截圖
2. 向使用者展示每個檢查項的實際畫面或證據
3. 使用者回覆 OK → 標記該項 `[x]`
4. 使用者回覆有問題 → 不標記，記錄問題
5. 使用者回覆 skip → 標記 `[x]` 並加註 `（skip）`
6. 使用者回覆 skip all → 全部標記 `[x]` 並註記

**`[discuss]` items 例外**：§ `[discuss]` walkthrough 取得使用者明確 OK 後，session owner 勾 `[x]` + `(claude-discussed: <ISO-8601-timestamp>)`。

**`[verify:e2e]` / `[verify:api]` automatic channel 例外**：Verify Channel Pass 寫入 `(verified-e2e/api: ...)` 後 session owner 可直接勾 `[x]`；`[verify:ui]` 仍需使用者判 visual evidence（`ui-judgement` 卡，`flow receipt` 落判定）。

**前提不成立直接 skip 例外**：item 前提**可由程式碼 / 架構事實驗證為不成立**時（例：route 不存在、column 被 migration 移除、feature flag 永久關閉），session owner **MAY** 直接標 `[x]` + `（skip: <一行事實原因>）`，不開 `flow ask` 卡也不走人工驗收迴圈。判定條件（**全部**成立才適用）：

- 前提不成立是**可程式碼驗證的事實**（grep auth middleware / route config / schema / feature flag），不是主觀商業判斷
- session owner 已實際跑驗證（grep / read / curl）確認事實成立
- annotation 內寫明事實根據（哪個檔 / 哪行 / 什麼機制）

**不適用**：涉及商業取捨的判斷（「要不要改 auth 讓 staff 進」）— 走 `flow ask`（`ruling` 卡）。

## 人工檢查時機（Hard rule）

人工檢查 OK/Issue/Skip 是「最終驗收」性質的動作，**MUST** 集中在所有 implementation 改動（含 ingest 補 spec、apply 落 code、bug fix）完成後**一次性**做，**NEVER** 穿插在 ingest / apply 中段。

### 為什麼

拆開做會讓 round N 看不到新增的 verify item（誤判全完成）、commit ceremony 翻倍、留下 spec / code 不同步的中間 commit。

### 正確 sequence

```
review:ui (round N) → user 留 N 條 issue
  ↓
主線 triage 每條 issue 到 (A) UX/copy / (B) Behavior / (C) 規格缺口
  ↓
(A)/(B) fix 落 code；(C) 規格缺口 → 回交 truth owner skill（/dsl-refine 等）補規格 → 實作落 code
  ↓ ALL DONE
review:ui (round N+1, FINAL) — user 對既有 + 新增 verify item 一次性評估
  ↓ 全綠
worktree merge-back → 單一 /commit（一次包 fix + 規格產出 + 實作 code）
```

### 例外

- **(A) / (B) only**（純 code fix）：fix → review:ui 最終評估 → 單一 commit
- **`[discuss]` items**：走下方 § `[discuss]` walkthrough，不受本節「一次性」約束
- **跨 session handoff**：user 主動切到別 session 處理實作時，本 session 視為 handoff 完成；新 session 接手後仍須遵守本節
- **獨立外部 trigger 撞進來**（與本輪 review:ui issue 無關的緊急 bug fix）：可在中段獨立 commit，但**不**觸發 review-gui 評估 round

### Auto-triage 前置條件（per [[review-gui-surface]] MUST 8）

**NEVER** 在 `flow gates --repo-only --require-empty` 回 exit 3 以外時引導 user 到面板（含 `/commit` 0-MR block、handoff、session 結尾回報等所有場景）。引導前 **MUST** auto-triage 所有 pending leaf items：`（fix-requested）` → 修 code；evidence missing → self-collect；`（issue:）` 無分析 → triage。推進完畢 `flow gates` 仍列出卡片時才引導 user，並逐張列 family。

### 禁止事項

- `/commit` 0-MR 對一件工作判 BLOCK 時，withheld 的只有該工作 carrier 的 pathspec 交集（`/commit` gates.md § 0-MR 判定粒度）。其他 group 放行是 commit 粒度的事，**NEVER** 讀成該工作的人工檢查已完成——auto-triage 對它一條沒少
- **NEVER** 在補完規格、實作還沒跑時引導 user 回 review-gui 評估 OK/Issue/Skip
- **NEVER** 在 (C) 路徑中段（補規格與實作之間、或 fix 與補規格之間）跑 `/commit`
- **NEVER** 在 round N OK 後直接標 `work.done`；done 的 trigger 是 round N+1（含新增 verify item 與 (A)/(B) fix）全綠
- **NEVER** 用「先 fix 後補規格」順序跑 commit — 同一輪 review:ui 觸發的改動，spec 跟 code 必須同 commit 出現

## Screenshot Review ≠ Functional Verification（Hard Rule）

截圖是證據，不是使用者確認本身；screenshot review **只覆蓋視覺層**（控件存在、layout、狀態的視覺呈現），**不**覆蓋功能 round-trip（form submit 真的送到 server、DB 真的變更、refetch 後的新狀態、edge case payload、權限拒絕 path）。

- `## 人工檢查` 項目用「動詞 → 結果」format（[[manual-review.evidence]] § 給 propose / spec 寫作者）
- functional round-trip **MUST** 列為人工檢查項目或 verify channel，**NEVER** 把「按鈕存在」當成 round-trip 已驗證
- **NEVER** 在使用者尚未真實互動驗收前 archive UI change
- 驗收資料與步驟（sample inline、`#N.M` 拆步、seed、URL、預期觀察、dev 替代輸入）見 [[manual-review.data-readiness]]

### Backend-only change 的特別規約

`proposal.md` 宣告 `**No user-facing journey (backend-only)**` 時，`## 人工檢查` 只允許 production 授權 / 商業判斷 / production 觀察三類；其餘 evidence collection **MUST** 寫進 `## N. Backend Verification Evidence` 由 session owner 自跑自貼。詳見 [[manual-review.backend]] § Backend-only change 的特別規約。

## 可解析格式（hard rule）

parent `- [ ] #1 ...`；scoped sub-item 剛好縮排兩個空白並用 `#N.M`；禁止 legacy section ids（`8.1`）或省略 id。範例見 [[manual-review.evidence]] § 可解析格式。

### Parent State Derivation（hard rule）

Parent item `#N` 若有 scoped sub-items（`#N.M`），parent state **MUST** 由所有 children AND derive，不接受 user 或 agent 直接對 parent line 給 feedback：

- 所有 children `[x]` 且無 `（issue: ...）` annotation → parent line `[x]`
- 任一 child `[ ]`、或帶 `（issue: ...）` → parent line `[ ]`（rollup 後若 child 改 issue 也要 un-rollup 回 `[ ]`）

#### 禁止項

- GUI **MUST** 隱藏 parent line 的 OK / Issue / Skip 控制
- Agent **NEVER** 自行 Edit tasks.md 把 parent flip `[x]`——parent 由 children 自動 rollup
- 任何計 pending 的 gate / tooling **MUST** leaf-only count，NEVER naive `grep '- \[ \]'`（責任表見 [[manual-review.evidence]] § Parent State Derivation — 真相層責任分工）

## Item Kind Marker（hard rule）

每條 `## 人工檢查` checkbox 行 **MUST** 在 `#N` / `#N.M` 後緊接一個 leading kind marker。合法 marker：

- `[review:ui]` — 需要使用者親自確認的 UI / UX 驗收。例：收 email / 收 webhook / 實體裝置 / 視覺主觀美感 / 真機跨機器。**MUST** 由使用者完成，agent 禁止代勾。
- `[discuss]` — session owner 主導的 evidence-based 討論項目（production 授權、商業判斷、production 觀察、後端 evidence 查驗）。**MUST** 由交付前收尾 walkthrough 推進（§ `[discuss]` walkthrough），**NEVER** 由 review:ui 面板的接手 prompt dispatch——它的 trigger 是外部 signal，提前分析只會卡住收尾。純 D-only pending 的工作進「🗓 等收尾 walkthrough」群、無接手 prompt 按鈕。
- `[verify:e2e]` — reproducible runner spec round-trip：主線寫 `e2e/verify/<change>/<topic>.spec.ts`、跑 `pnpm test:e2e:verify <change>` → `(verified-e2e: <ISO>)`
- `[verify:api]` — 純 HTTP round-trip（curl / ofetch）→ `(verified-api: <ISO>)`。**裝 `nuxt-csurf` 的 consumer** MUST 走 dual-token recipe（`~/offline/clade/vendor/snippets/verify-channels/api-roundtrip.template.sh`）
- `[verify:ui]` — final-state screenshot + DOM observation → `(verified-ui: <ISO>)`；使用者仍需判過才勾 `[x]`
- `[verify:<a>+<b>]` — multi-marker，只能組合 `e2e` / `api` / `ui`
- `[verify:auto]` — **DEPRECATED alias**（解析為 `[verify:api+ui]`），新項目 **NEVER** 使用

各 channel 的執行方式見 [[manual-review.backend]] § `[verify:*]` flow；判哪個 kind 見 [[manual-review.evidence]] § Kind 分類指引。

### Canonical line format

```
- [ ] #N [<kind>] <description> [(verified-<channel>: ...)]... [@followup[TD-NNN]] [@no-screenshot]
```

- Marker **MUST** 是 `#N` / `#N.M` 後第一個 token，與 id 之間僅一個空白。
- Marker 出現在 description 中間（例：`Click the [discuss] button`）視為 plain text，**MUST NOT** 被解析成 marker。
- `[review:ui]` / `[discuss]` 不得與 verify multi-marker 混用。`[verify:api+review:ui]`、`[verify:api+discuss]` 都是非法 marker。
- Verify multi-marker 的 channel canonical order 是 `e2e → api → ui`；annotation 寫回也 **MUST** 依此順序。

### Evidence payload 走 sidecar（hard rule）

寫**任何一條**新 evidence annotation 時：payload **MUST** 進 sidecar（`.spectra/evidence/<work-slug>.jsonl`），行內 **MUST** 只留 `(<kind>: <ISO>)` 短 marker。適用 **每一個** annotation kind，不是只有 `verified-ui`。

寫入一律用 `vendor/scripts/lib/evidence-store.ts --write`——它寫完 sidecar 會把該貼進行內的短 marker 印到 stdout，**原樣**貼上即可。**NEVER** 自己另編時間戳，**NEVER** 先貼 marker 再補 sidecar（順序顛倒時 parser 計 `malformed`）。

細節見 [[review-gui-surface]] § Annotation Format Contract § Evidence 寫入路徑。

### 要人接手的結論：開卡，不寫 annotation（hard rule）

session owner 判定某 pending item 的球在人手上時，**MUST** 開一張 gate 卡，**NEVER** 只在 tasks 檔寫行內 annotation（沒有讀取者，人永遠看不到）。

| 情境 | 指令 | 出現在 `flow gates` 的 family |
| --- | --- | --- |
| triage `（issue:）` 結論為 route **(E)**（false positive／修法已落地，等人重評） | `flow ask --question '<一句判斷題>' --option '<短標籤> :: <後果>' ... --recommended '<短標籤>' --why '<理由>' --work-id <W> --carrier <tasks 檔>` | `ruling` |
| 純商業決策／production 授權，packet 已備妥 | 同上，`--question-page` 可掛決策頁 | `ruling` |
| implementation 卡**外部 blocker**（等人到場、等帳號、等別家交付） | `flow ask --category human-action --step '<要人做的動作>' ...`；dispatched child 走 `--complete blocked` | `external-action` |

**MUST NOT** 翻 checkbox、**MUST NOT** strip 既有 `（issue:）`、**MUST NOT** 在 (A)–(D) 結論時開卡（那些情境球仍在 session owner）、**MUST NOT** 用開卡規避其實 actionable 的 item——可走 (A)/(B)/(C) 路徑就 **MUST** 走。

**legacy 寫法**：`(claude-analyzed:)`、`(awaiting-user-decision:)`、`@apply-blocked[<reason>]`、`@evidence-via-manual-review` 的寫入器已退役（既有記錄讀取端略過或照舊解析），**NEVER** 新寫（對照見 [[manual-review.evidence]] § Legacy annotation 退役對照）。

### Default Kind Derivation Rule（fallback）

當 item 行無 leading marker（典型情境：legacy in-flight change），parser 依 `proposal.md` 推導 default kind：

- proposal 含 `**No user-facing journey (backend-only)**` → default kind = `discuss`
- 其餘 → default kind = `review:ui`

**Fallback ≠ 允許省略**：所有**新寫**或**ingest 修改**的 items **MUST** 顯式標 marker（fallback 不涵蓋 `verify:*`）。看到 missing marker 的正解是補 marker，**不**提案改 default（[[manual-review.evidence]] § ADR (2026-05-22) — Default Kind Flip 未採用）。

### 與 `@no-screenshot` / `@followup[TD-NNN]` 共存 ordering

`[<kind>]` 永遠在最前（緊接 `#N`），`@no-screenshot` 永遠在最後；`@followup[TD-NNN]` 若存在須夾在 description 與 `@no-screenshot` 之間（見上方 Canonical line format）。所有寫回 annotation（`（issue:）` / `（skip）` / `（note:）` / `（finding:）` 與 `(claude-discussed:)` / `(verified-*:)`）**MUST** 插在 description 後、所有 trailing markers 前。`（finding: ...）` 與其他 action annotation 正交（可共存於同一行），其餘 action annotation 之間仍互斥。

Marker 語法：`@no-screenshot` 見 [[manual-review.evidence]] § `@no-screenshot` Marker；`@no-manual-review-check[<reason>]` 見 [[manual-review.data-readiness]] § `@no-manual-review-check` Marker。

## review-gui 補 evidence prompt 路徑分類（hard rule）

review-gui 主頁卡片上的「📋 補 evidence prompt」按鈕是 **fallback** 不是 **default**。

**Default flow**（主線負責）：

- 交付人工檢查**之前**，主線 **MUST** 對**每一個** evidence-missing item 跑一輪 self-collect（[[manual-review.backend]] § `[verify:*]` flow）
- 成功 → 寫 `(verified-*:)`；失敗 → 寫 `（deferred: tried (a)(b)(c)(d), <reason>）`
- 跑完**仍** evidence-missing 的 item 才進 review-gui handoff

**Fallback flow** 只在 user 主動觸發時用：跨 session 補拍、agent 到不了的工具（條碼槍真機、kiosk 平板）、user 主動加 evidence。

**NEVER** 把「補 evidence prompt」當 default 入口（[[pitfall-verify-evidence-handoff-instead-of-self-collect]]）。

## 標準流程（依 kind 分流）

依 item 的 kind marker 走不同 flow。**MUST** 覆蓋 verify channels、`[review:ui]`、`[discuss]`（同一件工作可多 kind 並存）。

| Kind | Flow 觸發點 | 完整 spec 位置 |
| --- | --- | --- |
| `[verify:e2e]` / `[verify:api]` / `[verify:ui]` / multi-marker | `/implement` 收尾的 Verify Channel Pass | [[manual-review.backend]] § `[verify:*]` flow |
| `[review:ui]` | 交付人工檢查時的 review GUI 引導 | [[manual-review.backend]] § `[review:ui]` flow |
| `[discuss]` | 交付前收尾 walkthrough | 本檔 § `[discuss]` walkthrough |
| 混合 kind | verify channel pass → 收尾 walkthrough → review GUI | 本檔 § 混合 kind 的執行順序 |

所有 `verify:*` 依賴 codebase-level baseline：dispatch 前 **MUST** 預檢，缺則停下回報，**NEVER** 派 agent 撞 baseline 缺（[[manual-review.backend]] § Pre-verify baseline 假設、§ Dev-login route missing → scaffold-first hard rule）。

## `[discuss]` walkthrough（交付前收尾）

`[discuss]` item 的推進 trigger 是**外部 signal**（deploy / soak / 商業拍板），不是「有人想到要看它」。所以它排在收尾——**把工作標 `work.done` 或送 `/handoff` 之前**，**MUST** 對 tasks 檔裡**每一條**未勾的 `[discuss]` item 走完下列七步，不是只處理看起來有答案的那幾條。

1. 主線主動 Read tasks 檔 `## 人工檢查` 區，列出未勾的 `[discuss]` items
2. 逐條分類 trigger condition：
   - **Internal evidence available now** — code / schema / migration / cron 等可立刻 grep / query
   - **External signal already occurred** — staging / production 已 deploy、soak 已過、商業決策已拍板
   - **External signal pending** — 需要的 deploy / soak / 授權**尚未**發生，目前無法用分析合成 evidence
3. 對非 pending 的兩類，主線**主動**準備 evidence（grep 結果、diff、command output、data summary），**NEVER** 等使用者開口
4. 向使用者展示 evidence + item description，請他明確回 OK / Issue / Skip / Defer。**`Defer` 只在 trigger 是 External signal pending 時才出現**，另兩類 **NEVER** 顯示 Defer
5. **OK** → 勾 `[x]` ＋ 在 description 後、trailing markers 前插入 `(claude-discussed: <ISO-8601>)`
6. **Issue** → 保持 `[ ]` ＋ 附 `（issue: <note>）`，不擋收尾（使用者保留主導權）；**Skip** → 勾 `[x]` ＋ `（skip[: reason]）`
7. **Defer** → 勾 `[x]` ＋ `(deferred-to-handoff: <ISO>)` ＋ `(awaiting-signal: <signal-desc>)`，同時把 entry 寫進 `HANDOFF.md` 的 `## Deferred discuss items` 段（schema 見下），收尾流程**繼續走完**，不 STOP

### `HANDOFF.md ## Deferred discuss items` schema

```md
## Deferred discuss items

<!-- deferred-begin:<work-slug>:<item-id> -->
- **<work-slug>** #<item-id> — <一句話 description>
  - Awaiting signal: <staging deploy / production deploy / N-day soak / 商業授權 / ...>
  - Resume: 對 <work-slug> 重跑本節第 1–7 步
  - Deferred at: <ISO-8601-timestamp>
<!-- deferred-end:<work-slug>:<item-id> -->
```

Signal 發生後回流：對該條重新走第 2 步分類（signal 通常已 occurred），四個結果分支——**OK** 翻成 `(claude-discussed: <new-ISO>)` 並刪掉 `(deferred-to-handoff:)` 與 `(awaiting-signal:)`；**Issue** 翻回 `[ ]` ＋ `（issue:）`；**Skip** 翻成 `（skip[: reason]）`；**Still pending** 保持原樣。結案後清掉 HANDOFF 對應 entry（依 HTML marker）。

### `[discuss]` 不進人眼驗收（hard rule）

`[discuss]` **NEVER** 成為 `ui-judgement` 卡，也 **NEVER** 在面板上提供 ✓/⚠（沒有畫面可點）。packet 已備妥的商業／prod 授權走 `flow ask`（`ruling` 卡）；其餘走七步 walkthrough；External signal pending 走第 7 步的 Defer-to-HANDOFF。

## 混合 kind 的執行順序

一件工作同時含未勾 `[verify:*]` ＋ `[discuss]` ＋ `[review:ui]` items 時，**MUST** 依以下順序執行：

1. **實作階段** — Verify Channel Pass，依 `e2e → api → ui` 寫 annotations；automatic-only items 直接勾 `[x]`
2. **Discuss** — 能現在拍板的（packet 已備妥／internal evidence 齊）走 `flow ask`；其餘走收尾 walkthrough。**NEVER** 塞進人眼驗收
3. **人眼驗收** — 只處理 `flow gates` 列出的 `ui-judgement` 卡。User 在面板看 evidence/screenshot 判通過／有問題／跳過（寫 `flow receipt`）

## Post-Edit Validation Gate（hard rule）

修改 tasks 檔 `## 人工檢查` 區（不論是 `/tasks` 產出、truth owner skill 回寫、還是手動 Edit）後，**每一次**都 **MUST** 在 commit 前重跑 pattern check 驗證 0 violation，**NEVER** 只靠目測。

```bash
bash ~/offline/clade/vendor/scripts/manual-review-check.sh <work-slug>
```

預期輸出 `✓ manual-review-check passed (N items ...)` 才能 commit。worktree 內 hook / patterns.json 過期撞 false positive 時見 `~/offline/clade/vendor/snippets/manual-review-enforcement/README.md` § Stale-hook recovery。

## Checkbox ownership（誰可勾什麼）

| Kind | 誰勾 `[x]` | 前置條件 |
| --- | --- | --- |
| `[review:ui]` | **僅 user** 在 review GUI 親自 round-trip 後 | agent NEVER 代勾，即使已分析程式碼 |
| `[verify:e2e]` / `[verify:api]` | **agent** annotation 寫入後自動完成 | annotation 必須含成功 evidence；寫完不再要求 user 在 GUI 確認 |
| `[verify:ui]` | **user** 在 review GUI 確認 visual evidence 後 | agent NEVER 代勾 |
| `[discuss]` | **agent** 在收尾 walkthrough 展示 evidence 並取得 user OK 後 | 未實際討論＋未取得 OK → NEVER 勾 |

- 為了通過 gate 而批次勾選未確認項目 = 違反本表

## Annotation 寫入契約（正向 canonical——形狀問題）

每條 annotation 的合法寫入條件與格式限制：

| Annotation | 合法條件 | 格式 |
| --- | --- | --- |
| `(verified-<channel>: ...)` | evidence 成功產出 | key = `screenshot=`（單數，NEVER `screenshots=`） |
| `(verified-ui: ...)` sub-item | — | screenshot basename 以 `#<this-item-id>-` 開頭（`#4.1` → `#4.1-*.png`，不用 parent `#4`）；按 item ID 配對 |
| `(claude-discussed: ...)` | 收尾 walkthrough 實際討論並取得 OK | — |
| `(deferred-to-handoff: ...)` | 僅 Resume mode（archived change directory） | — |

## Routing guard（何時走哪條路——條件句）

- `[verify:ui]` agent 只負責 screenshot capture，NEVER 同時負責 mutation / form fill / multi-role login
- 問「要不要我直接幫你勾完」= NEVER
- **NEVER** 對前提事實上不成立的 item 開 `flow ask` 卡——走「前提不成立直接 skip 例外」
- **NEVER** 把 `flow ask --category human-action` 當「不想做就標一下」的逃生口
- **NEVER** 在 verify dispatch 當下才問 user「dev-login / seed 準備好了嗎」——baseline 是 codebase 層長期狀態
