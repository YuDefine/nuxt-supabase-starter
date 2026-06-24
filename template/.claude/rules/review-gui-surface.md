<!--
🔒 LOCKED — managed by clade
Source: rules/core/review-gui-surface.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->

# Review-GUI Surface SoP

**核心命題**：`vendor/scripts/review-gui.mts` 本體經 fixtures gate hardened 後，incident 漂移到**外圍 agent surface**。本 rule 對所有**呼叫** review-gui 的 surface 統一規約。

本 rule 是 [[agent-self-verification]] 的特例化（review-gui 是其中一個 evidence collection surface），同時延伸 [[manual-review]] 對 review-gui 互動的規約。

## 為什麼這條 rule 存在

2026-05-{22,23} 累積 3 條 surface pitfall，共通失敗模式：surface agent / wrapper 把 review-gui 當「黑箱」，沒對其 contract 做主線預檢與後驗：

- [[pitfall-handoff-mode-b-skips-review-gui-scan]]
- [[pitfall-verified-ui-compound-item-single-screenshot-evidence-gap]]
- [[pitfall-review-gui-detail-page-no-impl-gate]]

## 適用範圍

任何**呼叫** review-gui flow 的 agent / wrapper / handoff branch：

| Surface | 入口 | 預期 contract |
| --- | --- | --- |
| `/handoff` Mode B 2B.0 | `plugins/hub-core/skills/handoff/SKILL.md` Step 2B.0/2B.1.7 | 推薦 user 跑 review:ui **前** MUST 先跑 `review-gui.mts --scan` 寫入 HANDOFF.md |
| `screenshot-review` verify mode | 主線直派 codex（per [[agent-routing]]） | item 含 compound visual state → 分成 scoped sub-items 或 multi-screenshot annotation |
| `verified-ui` evidence collection（spectra-apply Step 8a） | `vendor/snippets/verify-channels/ui-final-state-brief*.template.md` | compound state evidence 必拆 / 必標多 screenshot |
| `codex-dispatch-screenshot-verify.mjs` dispatcher | clade vendor script | dispatcher 內 invoke external CLI 前 verify CLI contract（per [[agent-self-verification]] § MUST 4） |
| review-gui detail page 互動 | `vendor/scripts/review-gui.mts` server-side handlers | impl 完成率 < threshold → manual review block readonly + amber banner（已 implemented v1.4.30+） |

## Hard rule

### MUST

1. **入口 SoP scan**：`/handoff` Mode B 在推薦 user 跑 `pnpm review:ui` **前**，主線 **MUST**：
   ```bash
   cd ~/offline/clade && node vendor/scripts/review-gui.mts --scan
   ```
   把 active changes 的 `bucket` / `pending` / `userActionPending` 寫進 HANDOFF.md `## Review-gui Readiness` §。Outstanding steps（2B.2–2B.4）**MUST** 引用 scan result，**禁止**從 HANDOFF.md narrative 或 tasks.md leaf count 推測 review-gui bucket。
2. **Compound item evidence**：一個 `[verify:ui]` / `[review:ui]` item 含多 visual state（hover / focus / before-after / step1→step2）→ **MUST** 採以下之一：
   - **拆 scoped sub-items**：`#N.M` 各帶獨立 `[verify:ui]` + 獨立 `(verified-ui: ...)` annotation
   - **Multi-screenshot annotation**：使用 `screenshots=path1,path2[,path3]` annotation form（待 review-gui parser 支援後）

   單 screenshot 對應多 state 是**反模式**：archive-gate 會把 item 翻 `[x]` 造成 silent miss。
3. **Impl gate（已 enforced）**：review-gui detail page mutation handler 已 gate impl 完成率 < `APPLY_COMPLETE_THRESHOLD` (0.90) 時 422 拒收。Surface agent **MUST** 依賴此 gate，**禁止**在 detail page client-side 繞過或重刻 mutation。
4. **review-gui scan result trust**：對 scan 回傳的 `bucket / pending / userActionPending` 視為 truth source；**不**從 HANDOFF.md 或 tasks.md 重推。兩者對不上 → 跑 `--scan --refresh` 重 build 後更新 HANDOFF.md，**不**手動編輯對齊。
5. **Performance 實測自動檢測**：review / verify **每一個** web UI change 時，**MUST** 先對該 change 的改動檔機械 grep perf keyword：
   ```bash
   git diff --name-only <base>..<head> -- '*.vue' '*.tsx' '*.jsx' '*.css' '*.scss' '*.html' \
     | xargs -r grep -lE 'fetchpriority|content-visibility|scheduler\.(yield|postTask)|requestIdleCallback|speculationrules|web-vitals|onLCP|onINP|onCLS'
   ```
   完整 keyword 清單以 `scripts/audit-modern-web-skill.mjs` `TOPIC_KEYWORDS.performance` 為真相源。
   - **命中** → **MUST** 在 clade home 跑 chrome-devtools-mcp 實測，把 LCP / INP / CLS + 關鍵 insight **inline 寫進 review report**；改善前後**各**跑一次寫前後對比。how 見 `~/.claude/rules/modern-web-mcp.md` § Performance 主題：實測閉環 + `~/offline/clade/vendor/snippets/modern-web-guidance/README.md`。
   - **沒命中** → silent skip；但若改動觸及 hero image / above-the-fold layout / 字體載入，即使 keyword 未命中也 **SHOULD** 實測（keyword 偵測是下界）。

   chrome-devtools-mcp **只在 clade home session 可用** → 此偵測與實測**僅在 clade home review 流程執行**。
6. **Ball-ownership 答案依 bucket 判讀（single source）**：回答任何 change 狀態問題（「等你還是等我」/「ready 了沒」）**MUST** 依 `reviewBucketForChange()` 算出的 bucket 判讀 —— GUI 端讀 `change.bucket`、headless 讀 `--scan` 輸出 bucket。`bucket` 是 server canonical single source（review-gui.mts）。**禁止**從 tasks.md 散文、checkbox leaf count、或自己對 item 的印象推測 ball-ownership。bucket 對照：`awaitingUserReEval` = 等 user 重評、`awaitingUserDecision` = 等 user 商業決策（Claude 已標 `(awaiting-user-decision:)` 交還 user，master 排除）、`feedbackGiven` = 等 Claude、`readyForEvidence` = 等 Claude 補 evidence、`applyInProgress` = impl 未完、`applyBlocked` = impl 卡外部 blocker（`@apply-blocked` marker，交還 user，master 排除）、`awaitArchiveWalkthrough` = 等 archive walkthrough、`ready` = 可開始檢查。
7. **route E 結論 MUST 同步寫 annotation（不留散文 orphan）**：triage 一個帶 `（issue:）` 的 item，路由結論為 **(E)**（out-of-scope / false-positive / 修法已落地等 user 重評）時，**MUST 在同一動作**寫 `(claude-analyzed: <ISO> route=E[ note=...])` annotation（per [[manual-review]] § `(claude-analyzed: ...)` annotation）。**禁止**只留散文分析 / 只開 `@followup[TD-NNN]` 卻漏寫 machine annotation —— `analyzedIssuedCount` 只認 annotation，漏寫會讓 bucket 仍判 `feedbackGiven`（等 Claude），與「等 user」結論矛盾。

### NEVER

- ❌ 推 review-gui URL 給 user 自看（除非已耗盡 [[agent-self-verification]] § fallback chain）— review-gui「📋 補 evidence prompt」按鈕是 **fallback**，**不是 default**（per [[manual-review]] § review-gui 補 evidence prompt 路徑分類）
- ❌ 對 compound item 只收一張截圖代表多 state；annotation 寫 `screenshot=path` 但 description 含 paired-state marker（`before/after` / `A→B` / `hover` / `focus` 等）
- ❌ 在 detail page 試圖重刻或繞過 impl gate — server-side gate 是 final guard
- ❌ `/handoff` Mode B 推薦 `pnpm review:ui` 後就放手，**不**先跑 `--scan` 預備 HANDOFF.md state
- ❌ review web UI change 時 skip perf keyword 偵測、或偵測命中後不實測就讓 review pass（per MUST 5）
- ❌ 回答 change「卡在誰 / ready 了沒」時從 tasks.md 散文或 checkbox leaf count 推測，而非讀 `change.bucket` / `--scan` bucket（per MUST 6）
- ❌ 對 route E 結論的 issue 只寫散文分析或只開 `@followup[TD]`、卻漏寫 `(claude-analyzed: route=E)` annotation（per MUST 7）

## Annotation Format Contract

review-gui parser 對 annotation key 和 status tag **嚴格字面匹配**。寫錯 = silent malformed（item 卡 `evidenceMissing`、bucket 不收斂）。

### Canonical annotation keys

| Key | 格式 | Parser 行為 |
| --- | --- | --- |
| `screenshot=<path>` | **單數**，value 是單一 relative path | `findKeyValue('screenshot')` strict match |
| `screenshots=<p1>,<p2>` | **複數**，逗號分隔多 path | review-gui parser **不認**（fallback null）— 待 parser 支援前**禁用** |
| `(verified-ui: <ISO>)` | 括號內、冒號後空格 | `hasEvidenceFor` 認為 evidence 已收集 |
| `(issue: <description>)` | 括號內、冒號後空格 | `evidenceMissing` 排除此 item（視為 handled） |
| `(claude-analyzed: <ISO> route=<X>[ note=...])` | 括號內、space-separated KV | `analyzedIssuedCount` 計數；bucket 從 `feedbackGiven` 翻為 `awaitingUserReEval` |
| `(awaiting-user-decision: <description>)` | 括號內 | bucket 翻為 `awaitingUserDecision`（master 排除） |

### Status tags parser 不認的常見錯誤

| 錯誤寫法 | 為什麼不認 | 正確寫法 |
| --- | --- | --- |
| `(deferred: ...)` | parser 只認 `issue` / `verified-*` / `claude-analyzed` / `awaiting-user-decision`；`deferred` 不在辭典 → item 卡 `evidenceMissing` | `(issue: self-collect failed — <reason>)` |
| `screenshots=a,b` | `findKeyValue('screenshot')` 只配 singular key | 拆成 sub-items 各帶 `screenshot=<path>` |
| `screenshot = <path>`（等號前後空格） | KV parser 不 trim 等號兩側 | `screenshot=<path>`（無空格） |
| `#4-xxx.png` 配 item `#4.1` | filename prefix match `#4-` 只配 `#4`，不配 `#4.1` | sub-item `#4.1` 用 `#4.1-xxx.png` |

### MUST（annotation 寫入時）

1. evidence collection 完成寫 annotation 時，**MUST** 用上表 canonical key（singular `screenshot=`）
2. self-collect fallback chain 全失敗 → **MUST** 寫 `(issue: self-collect failed after (a)(b)(c)(d): <reason>)`，**NEVER** `(deferred: ...)`
3. sub-item `#N.M` 的 screenshot 檔名 **MUST** 用 `#N.M-` prefix，**NEVER** 複用 parent `#N-` prefix
4. route E 結論 **MUST** 同步寫 `(claude-analyzed: <ISO> route=E)` annotation（per MUST 7）

### Cross-ref

- [[pitfall-verified-ui-annotation-format-drift]] — plural key + sub-item ID mismatch
- [[pitfall-deferred-vs-issue-annotation-contract-conflict-review-gui]] — `(deferred:)` vs `(issue:)` 辭典衝突

## 界線（不在本 rule 範圍）

下列**不**屬本 rule：

- **review-gui.mts 本體 bug**（endpoint、SPA、aggregation logic）→ 由 [[review-gui-change-discipline]] § Hard rule (fixtures gate) 管
- **review-gui server-side gate 實作細節**（impl gate threshold、422 response shape）→ vendor script 本體 source-of-truth，本 rule 只規約 surface 該遵守的 contract
- **跨 consumer 觀感 bug**（review-gui CSS / 字級 / 字色）→ audit-ux-drift 管

## Cross-ref

| 主題 | 真相層 |
| --- | --- |
| Agent self-verification meta rule（fallback chain / 不踢 user） | [[agent-self-verification]] |
| Review-gui core 本體 change SLA（fixtures gate） | [[review-gui-change-discipline]]（clade 自治區） |
| Verify channel annotation 格式（含 verified-ui screenshot=） | [[manual-review.backend]] § 標準流程 § `[verify:ui]` channel |
| Compound item 拆分 / multi-screenshot annotation 規約 | [[manual-review.evidence]] § Item Kind Marker `verify:ui` |
| Handoff Mode B Step 2B.0 / 2B.1.7 review-gui readiness scan | `plugins/hub-core/skills/handoff/SKILL.md`（pending TD-151 implementation） |
| review-gui detail page impl gate（已 implemented） | `vendor/scripts/review-gui.mts` `countImplementationProgress` / `persistReviewAction` |

## Audit signal

規格細節見各 script 頭註解 + TD entry（`docs/archives/tech-debt-closed-2026-06.md`）：

| Signal | TD | 狀態 | SoT |
| --- | --- | --- | --- |
| `compound_verify_ui_single_screenshot` | TD-142 / TD-143 | done | `vendor/scripts/audit-screenshot-quality.mts` |
| `stale_screenshot_after_ui_change` | TD-178 | done | `vendor/scripts/audit-screenshot-staleness.mts` |
| `claude-analyzed-drift`（MUST 6/7 違反偵測） | TD-179 | done | `vendor/scripts/audit-claude-analyzed-drift.mjs` |

**Performance 實測（MUST 5）升級路徑**：目前 advisory；若漏驗頻繁 → archive 前 hard gate 或 review-gui 自動生成 perf-trace sub-item（動本體，須走 [[review-gui-change-discipline]] fixtures gate）。

## 違反時的回報方式

```text
[review-gui-surface] Hard rule violation
修正方式：
  - skip scan → 跑 `--scan` 寫進 HANDOFF.md 再推薦
  - compound 單截圖 → 拆 sub-items 或補 multi-screenshot annotation
  - 繞 impl gate → 等 impl ≥ 90% 再做 manual review
  - 推 URL 給 user → 先跑 [[agent-self-verification]] fallback chain
繞過：無 escape hatch — review-gui contract 是真相層
```
