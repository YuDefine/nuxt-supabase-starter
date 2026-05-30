<!--
🔒 LOCKED — managed by clade
Source: rules/core/review-gui-surface.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->

# Review-GUI Surface SoP

**核心命題**：`vendor/scripts/review-gui.mts` 本體經 fixtures gate hardened 後，incident 漂移到**外圍 agent surface** — 呼叫 review-gui 的 agent / wrapper / handoff flow 各自為政、共同 SoP 沒抽象，導致 scan miss / annotation 漏層 / 操作未 gate。本 rule 對所有**呼叫** review-gui 的 surface 統一規約。

本 rule 是 [[agent-self-verification]] 的特例化（review-gui 是其中一個 evidence collection surface），同時延伸 [[manual-review]] 對 review-gui 互動的規約。

## 為什麼這條 rule 存在

2026-05-{22,23} 累積 3 條 surface pitfall + 達 promote threshold（≥ 5 條 incl. 邊界案）：

| Pitfall | Surface anti-pattern |
| --- | --- |
| [[pitfall-handoff-mode-b-skips-review-gui-scan]] | `/handoff` Mode B 建議 user 跑 `pnpm review:ui` 但主線**未**跑 `review-gui.mts --scan` 把 active changes 寫進 HANDOFF.md `## Review-gui Readiness` |
| [[pitfall-verified-ui-compound-item-single-screenshot-evidence-gap]] | compound item（一條 item 含多狀態 hover/focus/before-after）只收一張截圖；annotation 寫 `screenshot=path` 但 description 暗示多 state |
| [[pitfall-review-gui-detail-page-no-impl-gate]] | review-gui detail page 允許 user 在 impl 未完成時勾 manual review checkbox，導致 tasks.md / manual-review-archive.md 被假性翻 `[x]` |

共通失敗模式：surface agent / wrapper 把 review-gui 當「黑箱」使用，沒對 review-gui 期待的 contract 做主線預檢與後驗。

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
   把每個 consumer active changes 的 `bucket` / `pending` / `userActionPending` 寫進 HANDOFF.md `## Review-gui Readiness` § 。Outstanding recommendation steps（2B.2 / 2B.3 / 2B.4）**MUST** 引用 scan result，**禁止**從 HANDOFF.md narrative 或 tasks.md leaf count 推測 review-gui bucket。
2. **Compound item evidence**：一個 `[verify:ui]` / `[review:ui]` item 含多 visual state（hover / focus / before-after / step1→step2）→ **MUST** 採以下之一：
   - **拆 scoped sub-items**：`#N.M` 各帶獨立 `[verify:ui]` + 獨立 `(verified-ui: ...)` annotation
   - **Multi-screenshot annotation**：使用 `screenshots=path1,path2[,path3]` annotation form（待 review-gui parser 支援後）

   單 screenshot 對應多 state 是**反模式**，annotation present 但實際只 cover 部分 state，archive-gate 會把 item 翻 `[x]` 造成 silent miss。
3. **Impl gate（已 enforced）**：review-gui detail page mutation handler (`persistReviewAction` / `applyReviewActionToContent` / `invokeReviewArchive`) 已 gate impl 完成率 < `APPLY_COMPLETE_THRESHOLD` (0.90) 時 422 拒收。Surface agent **MUST** 依賴此 gate，**禁止**在 detail page client-side 繞過或重刻 mutation。
4. **review-gui scan result trust**：對 scan 回傳的 `bucket / pending / userActionPending` 視為 truth source；**不**從 HANDOFF.md 或 tasks.md 重推。Scan 結果與 HANDOFF.md 對不上 → 跑 `node vendor/scripts/review-gui.mts --scan --refresh` 重 build 並更新 HANDOFF.md，**不**手動編輯 HANDOFF.md 對齊。
5. **Performance 實測自動檢測**：review / verify **每一個** web UI change 時，**MUST** 先對該 change 的改動檔機械 grep perf keyword（不靠主觀判斷「這個有沒有影響效能」）：
   ```bash
   git diff --name-only <base>..<head> -- '*.vue' '*.tsx' '*.jsx' '*.css' '*.scss' '*.html' \
     | xargs -r grep -lE 'fetchpriority|content-visibility|scheduler\.(yield|postTask)|requestIdleCallback|speculationrules|web-vitals|onLCP|onINP|onCLS'
   ```
   完整 keyword 清單以 `scripts/audit-modern-web-skill.mjs` `TOPIC_KEYWORDS.performance` 為真相源。
   - **命中** → **MUST** 在 clade home 跑 chrome-devtools-mcp 實測（`navigate_page` → `performance_start_trace` → `performance_analyze_insight` → `lighthouse_audit`），把 LCP / INP / CLS + 關鍵 insight **inline 寫進 review report**；改善前後**各**跑一次寫前後對比。how 見 `~/.claude/rules/modern-web-mcp.md` § Performance 主題：實測閉環，recipe 見 `~/offline/clade/vendor/snippets/modern-web-guidance/README.md` § 實測閉環。
   - **沒命中** → silent skip；但若改動觸及 hero image / above-the-fold layout / 字體載入，即使 keyword 未命中也 **SHOULD** 實測（keyword 偵測是下界，不是上界）。

   chrome-devtools-mcp 採中央自用，**只在 clade home session 可用**（local scope）；consumer session 內無此工具 → 此偵測與實測**僅在 clade home review 流程執行**，不要在 consumer session 假裝能跑或硬找工具。

### NEVER

- ❌ 推 review-gui URL 給 user 自看（除非已耗盡 [[agent-self-verification]] § fallback chain）— review-gui「📋 補 evidence prompt」按鈕是 **fallback**，**不是 default**（per [[manual-review]] § review-gui 補 evidence prompt 路徑分類）
- ❌ 對 compound item 只收一張截圖代表多 state；annotation 寫 `screenshot=path` 但 description 含 `預設 → filter`、`before/after`、`A→B`、`step1→step2`、`hover`、`focus` 等 paired-state marker
- ❌ 在 detail page 試圖重刻或繞過 impl gate — server-side gate 是 final guard，client-side 繞過會被 422 拒收
- ❌ `/handoff` Mode B 推薦 `pnpm review:ui` 後就放手，**不**先跑 `--scan` 預備 HANDOFF.md state — 那等於把「review-gui 該顯示什麼」交給 user 自己探索
- ❌ review web UI change 時 skip perf keyword 偵測、或偵測命中後不實測就讓 review pass — Performance 是 review surface 的 mandatory 維度（per MUST 5），不是「想到才量」的 optional

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

## Audit signal（pending）

`vendor/scripts/audit-screenshot-quality.mts` 擴 signal `compound-verify-ui-single-screenshot`：

- 掃 `[verify:ui]` annotation `screenshot=<path>` 與 description 內 paired-state marker（`預設.*filter` / `default.*filter` / `before.*after` / `→.*→` / `hover` / `focus` / step1/2/3 之間）
- 命中 → emit warning signal「compound item 用單 screenshot」
- Signal 落入 improvement-digest 候選清單

對應 TD: TD-142 / TD-143（accepted, pending implementation）。

## 違反時的回報方式

```text
[review-gui-surface] Hard rule violation

問題：surface agent skip scan / 對 compound item 只收一張截圖 / 試圖繞過 impl gate / 推 review-gui URL 給 user 自看

修正方式：
  - skip scan → 跑 `node vendor/scripts/review-gui.mts --scan` 寫進 HANDOFF.md 再推薦
  - compound 單截圖 → 拆 sub-items 或補 multi-screenshot annotation
  - 繞 impl gate → 等 impl ≥ 90% 再做 manual review
  - 推 URL 給 user → 先跑 [[agent-self-verification]] fallback chain

繞過：本 rule 無 escape hatch；review-gui 互動的 contract 是 user-facing flow 真相層，繞過 = silent corruption
```
