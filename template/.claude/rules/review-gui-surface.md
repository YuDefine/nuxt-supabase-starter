---
description: 所有呼叫 review-gui 的外圍 agent surface 統一 SoP——入口 scan、compound item 拆解、multi-screenshot annotation、self-rationalize 禁令、annotation format contract；觸及 screenshots / spectra change / HANDOFF 時 path-scoped 載入
paths:
  - 'screenshots/**'
  - 'openspec/changes/**'
  - 'HANDOFF.md'
  - 'vendor/scripts/review-gui*.ts'
  - 'vendor/scripts/lib/evidence-store.ts'
  - 'scripts/spectra-advanced/**'
  - '.claude/agents/**'
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/review-gui-surface.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Review-GUI Surface SoP

**核心命題**：`vendor/scripts/review-gui.ts` 本體經 fixtures gate hardened 後，incident 漂移到**外圍 agent surface**。本 rule 對所有**呼叫** review-gui 的 surface 統一規約。

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
| `/commit` 0-MR gate block | `plugins/hub-core/skills/commit/SKILL.md` Step 0-MR | block 後 **MUST** auto-triage pending items（MUST 9）；Claude 可處理的先自行推進，只有 `bucket=ready` 才引導 user 到 review-gui |
| `/handoff` Mode B 2B.0 | `plugins/hub-core/skills/handoff/SKILL.md` Step 2B.0/2B.1.7 | 推薦 user 跑 review:ui **前** MUST 先跑 `review-gui.ts --scan` 寫入 HANDOFF.md |
| `screenshot-review` verify mode | 主線直派 codex（per [[agent-routing]]） | item 含 compound visual state → 分成 scoped sub-items 或 multi-screenshot annotation |
| `verified-ui` evidence collection（spectra-apply Step 8a） | `vendor/snippets/verify-channels/ui-final-state-brief*.template.md` | compound state evidence 必拆 / 必標多 screenshot |
| `codex-dispatch-screenshot-verify.ts` dispatcher | clade vendor script | dispatcher 內 invoke external CLI 前 verify CLI contract（per [[agent-self-verification]] § MUST 4） |
| review-gui detail page 互動 | `vendor/scripts/review-gui.ts` server-side handlers | impl 完成率 < threshold → manual review block readonly + amber banner（已 implemented v1.4.30+） |

## Hard rule

### MUST

1. **入口 SoP scan**：`/handoff` Mode B 在推薦 user 跑 `pnpm review:ui` **前**，主線 **MUST**：
   ```bash
   cd ~/offline/clade && node vendor/scripts/review-gui.ts --scan
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
   完整 keyword 清單以 `scripts/audit-modern-web-skill.ts` `TOPIC_KEYWORDS.performance` 為真相源。
   - **命中** → **MUST** 在 clade home 跑 chrome-devtools-mcp 實測，把 LCP / INP / CLS + 關鍵 insight **inline 寫進 review report**；改善前後**各**跑一次寫前後對比。how 見 `~/.claude/rules/modern-web-mcp.md` § Performance 主題：實測閉環 + `~/offline/clade/vendor/snippets/modern-web-guidance/README.md`。
   - **沒命中** → silent skip；但若改動觸及 hero image / above-the-fold layout / 字體載入，即使 keyword 未命中也 **SHOULD** 實測（keyword 偵測是下界）。

   chrome-devtools-mcp entry 已散播至所有 consumer `.mcp.json` 並全 fleet 啟用（enabledMcpjsonServers）；perf-trace review 建議仍在 clade home 集中跑（profile/量測環境一致）。
6. **Ball-ownership 答案依 bucket 判讀（single source）**：回答任何 change 狀態問題（「等你還是等我」/「ready 了沒」）**MUST** 依 `reviewBucketForChange()` 算出的 bucket 判讀 —— GUI 端讀 `change.bucket`、headless 讀 `--scan` 輸出 bucket。`bucket` 是 server canonical single source（review-gui.ts）。**禁止**從 tasks.md 散文、checkbox leaf count、或自己對 item 的印象推測 ball-ownership。bucket 對照：`awaitingUserReEval` = 等 user 重評、`awaitingUserDecision` = 等 user 商業決策（Claude 已標 `(awaiting-user-decision:)` 交還 user，master 排除）、`feedbackGiven` = 等 Claude、`readyForEvidence` = 等 Claude 補 evidence、`applyInProgress` = impl 未完、`applyBlocked` = impl 卡外部 blocker（`@apply-blocked` marker，交還 user，master 排除）、`awaitArchiveWalkthrough` = 等 archive walkthrough、`ready` = 可開始檢查。
7. **route E 結論 MUST 同步寫 annotation（不留散文 orphan）**：triage 一個帶 `（issue:）` 的 item，路由結論為 **(E)**（out-of-scope / false-positive / 修法已落地等 user 重評）時，**MUST 在同一動作**寫 `(claude-analyzed: <ISO> route=E[ note=...])` annotation（per [[manual-review]] § `(claude-analyzed: ...)` annotation）。**禁止**只留散文分析 / 只開 `@followup[TD-NNN]` 卻漏寫 machine annotation —— `analyzedIssuedCount` 只認 annotation，漏寫會讓 bucket 仍判 `feedbackGiven`（等 Claude），與「等 user」結論矛盾。

8. **Post-work scan 回報 MUST 逐條標 bucket（hard rule）**：完成 evidence collection / annotation 修正 / issue triage 等批次工作後向 user 回報 scan 結果時，**MUST** 對每條 change 個別標示實際 `bucket`。只有 `bucket=ready` 的 change 才能寫「可以在 review-gui 驗收」或列 review-gui URL 引導 user 開始檢查。非 `ready` 的 change **MUST** 如實報告實際 bucket + 卡住原因（例：「`readyForEvidence` — evidence 已收齊但有 2 條 `（issue:）` 待 user 重評」），**NEVER** 混入「可以驗收」的清單。反模式：3 條 change 中 1 條 `ready`、2 條 `readyForEvidence`，結尾寫「三條都可以在 review-gui 做最後驗收」— 這直接誤導 user。

9. **引導 user 到 review-gui 前 MUST 跑 mechanical gate + 自行推進到 ready（hard rule）**：**任何**要把 user 導向 `pnpm review:ui` 的場景（`/commit` 0-MR block、handoff、spectra-apply Step 8b、session 結尾回報），Claude **MUST** 先跑 mechanical gate script **取得 exit 0** 才能引導：

   ```bash
   node ~/offline/clade/vendor/scripts/check-review-readiness.ts \
     --repo <consumer-path> --change <change-name>
   ```

   - **exit 0**（`status: "ready"`）→ 可以引導 user 到 review-gui
   - **exit 1**（`status: "NOT_READY"`）→ **MUST** 讀 stdout JSON 的 `bucket` + blocking 數據，auto-triage 推進後**重跑 script**直到 exit 0
   - **exit 2**（change not found / script error）→ **STOP**，回報 user 排查

   **NEVER** 自己判斷 bucket、NEVER 從 tasks.md checkbox 推論 ready、NEVER 用「看起來只剩 user 驗收」當 ready 的理由。Script 是唯一 truth source — Claude 的判斷已被多條同根因 pitfall 證明不可靠。

   **時間線**（同根因家族：Claude 自判 ready 推 user 去 review-gui 但實際 non-ready）：
   2026-05-23 sonnet self-rationalize / 05-26 evidence handoff / 06-24 skip Step 8a / 06-25 copy prompt no verify / 06-28 dispatch unready + env assumption / 07-02 checkbox without evidence / 07-04 fix-requested misclassification / 07-05 commit gate non-ready（本 session 建規約後同 session 再犯）。

   **Auto-triage 分流**：

   | Pending item 狀態 | 誰處理 | Claude 動作 |
   | --- | --- | --- |
   | `（fix-requested）` | Claude | dispatch `/wt` 修 code → merge-back → 重拍截圖 → strip annotation → 重跑 gate |
   | evidence missing（無 `(verified-*:)` annotation） | Claude | 走 [[agent-self-verification]] fallback chain 收 evidence |
   | `（issue:）` 無 `(claude-analyzed:)` | Claude | triage issue → 走 (A)-(E) 路由 |
   | `[review:ui]` 純 user 驗收（無上述阻塞） | User | **只有這類**才引導 user 到 review-gui |
   | `[discuss]` 等外部 signal | Archive walkthrough | 不在此處處理 |

   **實證（2026-07-05）**：<consumer-b> `/commit` 0-MR 擋下 `sop-case-ux-phase-a1`（2 個 pending leaf），Claude 直接叫 user 去 review-gui，但兩個 item 都帶 `（fix-requested）` — user 去了也做不了任何事。正確做法是 Claude 先 dispatch fix → merge-back → 更新 evidence → 重跑 0-MR，全部自己推完。

### 狀態時效與檔案同步（MUST 10–12）

Review-gui 的狀態全部落在 `tasks.md` 這個**雙寫**檔上——user 在 GUI 點按鈕會寫，Claude 改 annotation 也會寫。兩邊都在寫的檔案，任何「上一次看到的樣子」都只是快照。以下三條各綁一個可觀察 predicate。

10. **陳述狀態前，本 turn 內 MUST 有一次 scan**：回答任何 change / item 的狀態問題（「還剩幾條」「ready 了沒」「這條過了嗎」「現在輪到誰」）之前，若**本 turn 尚未**跑過 `review-gui.ts --scan`，**MUST** 先跑再答。

    Predicate 就是字面的「本 turn 有沒有跑過」：跑過 → 直接引用該次輸出；沒跑過 → 先跑。**上一則訊息跑過不算**——user 在兩則訊息之間點按鈕正是最常見的情形。**NEVER** 引用本 turn 之前取得的 scan 輸出、`/api/changes` 回應、或 `tasks.md` 讀取結果來陳述現況。

11. **user 說「我點了 X」→ MUST 立刻重掃驗證，檔案沒反映就自己處理**：user 陳述自己在 GUI 做過動作（點了 OK / 標了有問題 / 勾了某條）時，**MUST** 立即重跑 `--scan`（或直接讀該 change 的 `tasks.md`）驗證，再回應。

    - 檔案已反映 → 照新狀態繼續
    - 檔案**未**反映 → **MUST** 回報「你的動作沒寫進檔案（可能撞 409），我直接處理」，並**當場**把該動作寫進 `tasks.md`。**NEVER** 要求 user 重點一次

    **NEVER** 回「你還沒點」「我這邊看到還是未勾」「請你再點一次確認」。`persistReviewAction()` 帶樂觀鎖（`version.hash` / `mtimeMs`）：檔案在該分頁載入之後被改過，user 的點擊就回 409 並 silently 失敗。**「沒寫進檔案」是系統的失敗，不是 user 的疏漏**——把它講成 user 沒做，是拿自己的 stale 讀取去反駁 user 的第一手事實。

12. **改寫過 tasks.md MUST 主動說**：Claude 改寫過某 change 的 `tasks.md`（寫 annotation / 改 checkbox / 加 marker）之後，同一次回報 **MUST** 含這句：

    > 我改了 `<change>` 的 tasks.md，你開著的 review-gui 分頁請 reload，否則按鈕會撞 409。

    對**每一張**被改過的 change 都要說，不是只說最後一張。這句話的觸發條件是「**你改了檔**」，不是「你確定 user 開著分頁」——不確定時照樣說。

   **NEVER**：
   - ❌ `/commit` 0-MR block 後直接印「請去 review-gui 完成人工檢查」而不 triage pending items 的阻塞原因
   - ❌ 把帶 `（fix-requested）` 的 item 當「需要 user 驗收」推給 user — 那是 Claude 的工作
   - ❌ 把 evidence missing 的 item 推給 user 補 — Claude 應先跑 self-collect
   - ❌ 在任何 non-ready bucket 狀態引導 user 到 review-gui（與 MUST 8 / NEVER 第一條重疊，此處明確擴展到 `/commit` gate 場景）

### NEVER

- ❌ 把非 `bucket=ready` 的 change 寫進「可以在 review-gui 驗收」的清單或引導訊息 — `readyForEvidence` / `feedbackGiven` / `applyInProgress` 等 bucket 都**不是** ready，**禁止**混報（per MUST 8）
- ❌ 推 review-gui URL 給 user 自看（除非已耗盡 [[agent-self-verification]] § fallback chain）— review-gui「📋 補 evidence prompt」按鈕是 **fallback**，**不是 default**（per [[manual-review]] § review-gui 補 evidence prompt 路徑分類）
- ❌ 對 compound item 只收一張截圖代表多 state；annotation 寫 `screenshot=path` 但 description 含 paired-state marker（`before/after` / `A→B` / `hover` / `focus` 等）
- ❌ 在 detail page 試圖重刻或繞過 impl gate — server-side gate 是 final guard
- ❌ `/handoff` Mode B 推薦 `pnpm review:ui` 後就放手，**不**先跑 `--scan` 預備 HANDOFF.md state
- ❌ review web UI change 時 skip perf keyword 偵測、或偵測命中後不實測就讓 review pass（per MUST 5）
- ❌ 回答 change「卡在誰 / ready 了沒」時從 tasks.md 散文或 checkbox leaf count 推測，而非讀 `change.bucket` / `--scan` bucket（per MUST 6）
- ❌ 對 route E 結論的 issue 只寫散文分析或只開 `@followup[TD]`、卻漏寫 `(claude-analyzed: route=E)` annotation（per MUST 7）
- ❌ 寫 `(verified-*:)` 短 marker 卻沒先跑 `evidence-store.mjs --write` 把 payload 進 sidecar — 兩邊都沒有 payload 時 parser 仍計 `malformed`，item 卡 `evidenceMissing`（per Annotation Format Contract § Evidence 寫入路徑）
- ❌ 為了套用新契約去改寫**既有**行內 payload annotation — 那是 rewrite 當時的 evidence，本契約只管新寫入（per 同上）
- ❌ annotation 寫在 `- [ ] #N` 下一行（即使 indent 正確）而非 inline 同行末尾（per Annotation MUST 5）
- ❌ scan 結果 non-ready 時直接回報 user「bucket=readyForEvidence」/「healthCheckNeeded」而不先自己讀 blocking reason + 修正（per Annotation MUST 6）
- ❌ user 說「我點了 X」時，拿自己本 turn 之前的 scan / tasks.md 讀取回「你還沒點」——那是用 stale 快照反駁 user 的第一手事實（per MUST 10 / 11）

## Annotation Format Contract

review-gui parser 對 annotation key 和 status tag **嚴格字面匹配**。寫錯 = silent malformed（item 卡 `evidenceMissing`、bucket 不收斂）。

### Evidence 寫入路徑（行內只到時間戳，payload 走 sidecar）

**寫新 evidence 時，payload MUST 進 sidecar（`.spectra/evidence/<change>.jsonl`），行內 MUST 只留短 marker。** 對 **每一個** kind、**每一條** 新寫的 evidence 都適用，不是只有 `verified-ui`。

一條命令做完兩件事——寫 sidecar，並印出要貼進 `tasks.md` 的行內 marker：

```bash
node ~/offline/clade/vendor/scripts/lib/evidence-store.ts \
  --repo <consumer-path> --change <change-name> --write \
  --item '#3' --kind verified-ui \
  --screenshot 'screenshots/local/<change-name>/#3-final.png' \
  --dom '<one-liner-observation>'
# stdout: (verified-ui: 2026-07-30T09:12:33.421Z)
```

把 stdout **原樣**貼到該 item 行末（inline 位置照 § MUST（annotation 寫入時）第 5 條）。**NEVER** 自己另外編一個時間戳——sidecar 記的與行內貼的必須是同一個，CLI 印出來的就是它剛寫進去的那一個。

| kind | 必填 flag | 選填 flag |
| --- | --- | --- |
| `verified-ui` | `--screenshot` | `--dom` |
| `verified-e2e` | `--spec --trace` | — |
| `verified-api` | `--method --url --status` | `--body` |
| `claude-analyzed` | `--route` | `--note` |
| `awaiting-user-decision` | — | `--packet` |
| `claude-discussed` | — | — |

**MUST 保留短 marker，NEVER 整條拿掉**：consumer 端仍有 legacy 讀取者用 `grep '\(verified-ui:[^)]*\)'` 做粗判斷，行內完全沒有 marker 會讓它們全部誤判成缺 evidence。

**Parser 對短 marker 的接受條件**：無 payload 的 `(verified-e2e:)` / `(verified-api:)` / `(verified-ui:)` 只在 **sidecar 已有對應 `(itemId, kind)` 記錄**時合法；sidecar 也沒有 → 仍計 `malformed`，行為與本契約之前完全一致。所以「先跑 `--write`、再貼 marker」的順序不可顛倒。

**既有行內 payload annotation 一律不動**：`(verified-ui: <ISO> screenshot=...)` 這種舊格式**仍然合法**、仍照舊解析。**NEVER** 為了套用本契約去改寫既有 annotation 把 payload 搬進 sidecar——那是 rewrite 別人當時記下的 evidence，而且對行長沒有收益：本契約只管**新寫入**。

### Canonical annotation keys

| Key | 格式 | Parser 行為 |
| --- | --- | --- |
| `screenshot=<path>` | **單數**，value 是單一 relative path | `findKeyValue('screenshot')` strict match。**僅 legacy 行內格式**；新寫入走 `--screenshot` 進 sidecar |
| `screenshots=<p1>,<p2>` | **複數**，逗號分隔多 path | review-gui parser **不認**（fallback null）— 待 parser 支援前**禁用**。多 screenshot 走 sidecar：同 `(itemId, kind)` 跑多次 `--write`（append-only），或拆 sub-items |
| `(verified-ui: <ISO>)` | 括號內、冒號後空格 | **新契約 canonical 形式**。`hasEvidenceFor` 認為 evidence 已收集；screenshot 路徑從 sidecar 取 |
| `(verified-api: <ISO> <METHOD> <URL> <STATUS>)` | 括號內、四段 space-separated | **legacy 行內格式**，仍合法。新寫入用 `(verified-api: <ISO>)` + `--method --url --status` 進 sidecar |
| `(issue: <description>)` | 括號內、冒號後空格 | `evidenceMissing` 排除此 item（視為 handled） |
| `(claude-analyzed: <ISO> route=<X>[ note=...])` | 括號內、space-separated KV | `analyzedIssuedCount` 計數；bucket 從 `feedbackGiven` 翻為 `awaitingUserReEval` |
| `（fix-requested）` | 全形括號、無 payload | **invalidates** 同行 `(claude-analyzed:)` — user 拒絕 route=E 結論、要求 code fix。`analyzedIssuedCount` 排除帶此 annotation 的 item → bucket 回 `feedbackGiven`（等 Claude 接手修） |
| `(awaiting-user-decision: <description>)` | 括號內 | bucket 翻為 `awaitingUserDecision`（master 排除） |

### Status tags parser 不認的常見錯誤

| 錯誤寫法 | 為什麼不認 | 正確寫法 |
| --- | --- | --- |
| `(deferred: ...)` | parser 只認 `issue` / `verified-*` / `claude-analyzed` / `awaiting-user-decision`；`deferred` 不在辭典 → item 卡 `evidenceMissing` | `(issue: self-collect failed — <reason>)` |
| `screenshots=a,b` | `findKeyValue('screenshot')` 只配 singular key | 對同一 `(itemId, kind)` 跑多次 `--write`（sidecar append-only），或拆成 sub-items 各自 `--write` |
| `screenshot = <path>`（等號前後空格） | KV parser 不 trim 等號兩側 | `screenshot=<path>`（無空格） |
| `#4-xxx.png` 配 item `#4.1` | filename prefix match `#4-` 只配 `#4`，不配 `#4.1` | sub-item `#4.1` 用 `#4.1-xxx.png` |

### MUST（annotation 寫入時）

1. evidence collection 完成時，**MUST** 先跑 `evidence-store.mjs --write` 寫 sidecar，再把它印出的短 marker 原樣貼進行內（per § Evidence 寫入路徑）。讀既有 legacy 行內 payload 時照上表 canonical key（singular `screenshot=`）
2. self-collect fallback chain 全失敗 → **MUST** 寫 `(issue: self-collect failed after (a)(b)(c)(d): <reason>)`，**NEVER** `(deferred: ...)`
3. sub-item `#N.M` 的 screenshot 檔名 **MUST** 用 `#N.M-` prefix，**NEVER** 複用 parent `#N-` prefix
4. route E 結論 **MUST** 同步寫 `(claude-analyzed: <ISO> route=E)` annotation（per MUST 7）
5. **annotation MUST inline（同一行）**：`(verified-*:)` / `(issue:)` / `(claude-discussed:)` 等 annotation **MUST** 寫在 `- [ ] #N ...` marker 的**同一行末尾**，**NEVER** 寫在下一行（即使 indent 正確）。Parser 只解析 item marker 行內的 annotation token；獨立行 annotation = silent miss → `evidenceMissing` → bucket 不收斂。（per [[pitfall-scan-non-ready-passive-report-instead-of-self-fix]]）
6. **write-scan-fix convergence loop（hard rule）**：annotation 寫完後 **MUST** 立刻跑 `review-gui.ts --scan`，讀 scan output 的 `bucket` + `evidenceMissing` + `hitsByCode` + `malformed` + `readinessHits`。若 bucket ≠ `ready`（且非純 user-dependent items），**MUST** 自行 root-cause（讀 scan 的 blocking 原因）→ 修正 annotation / item 描述 → 重新 scan → **loop 直到 bucket=ready 或確認剩餘全是 user-dependent**。**NEVER** 在 non-ready 時回報 user「bucket=readyForEvidence」或「healthCheckNeeded」讓 user 問為什麼 — 那是把 Claude 該做的 root-cause 工作轉嫁給 user。（per [[pitfall-scan-non-ready-passive-report-instead-of-self-fix]]）

   常見 blocking reason 自修表：

   | hitsByCode | 原因 | 自修方式 |
   | --- | --- | --- |
   | `UI_ITEM_NO_URL` | `[review:ui]` / `[verify:ui]` item 描述缺 URL path | 補具體 `/admin/...` path 到 item 描述 |
   | `ABSTRACT_REFERENCE` | item 描述含 `{any}` / `{id}` 等 placeholder | 改成具體 fixture UUID / employee_no |
   | `malformed > 0` | annotation 格式不符 parser 預期 | 讀 scan stderr 的 `malformed ... expected ...` 訊息，照格式修 |
   | `evidenceMissing` 含某 item | 該 item 缺 `(verified-*:)` 或 annotation 不在同行 | 補 annotation 或移到 inline |
   | `readinessHits > 0` | 有 readiness check 未通過 | 讀 `hitsByCode` 對照上表修 |

### Cross-ref

- [[pitfall-verified-ui-annotation-format-drift]] — plural key + sub-item ID mismatch
- [[pitfall-deferred-vs-issue-annotation-contract-conflict-review-gui]] — `(deferred:)` vs `(issue:)` 辭典衝突

## 截圖進主線 context 的成本（MUST）

**Iron Law：主線 `Read` 一張截圖 = 一次約 163k 字元的 context 支出，而且往後每一 turn 都重付。**

本節適用**每一張**截圖、**所有** consumer——不是只有批次審視那次。

| 可觀察 predicate | MUST |
| --- | --- |
| 要對 `[verify:ui]` / `[review:ui]` item 收 evidence | 走 `codex-dispatch-screenshot-verify.ts`（唯一入口，見 § Hard rule），主線只消費它回的 JSON 摘要 |
| 已經拿到 dispatcher 的 JSON 且某 item 判 FAIL / UNCERTAIN | 才准 `Read` **那一張**。**NEVER** 為了「順便看一下其他張」連讀 |
| 想確認一批截圖是否都拍到東西 | 跑 audit / dispatcher 的 emptiness preflight，**NEVER** 逐張 Read 目視 |

### 實測

2026-08-04 對最重的 30 個主線 session 量 `tool_result` 位元組：

| 成分 | 佔 tool_result | 細節 |
| --- | --- | --- |
| `Read` | 63.7% | 630 次，平均 25k 字元 |
| └ 其中截圖 / 圖片 | **88.8% of Read** | **86 次，平均 163k 字元/次** |
| `Bash` | 32.3% | 9,640 次，平均僅 830 字元 |

換算：截圖約佔重量級 session 全部 `tool_result` 位元組的 **56%**——單一最大項，且是 96% 全檔讀
（`Read` 只有 4% 的量帶 `offset` / `limit`）。

這是 § Hard rule 那條 dispatcher 禁令的**成本面證據**：[[agent-routing]] 已記「147 條
`(verified-ui:)` annotation 0 次走 codex、92 個 session 全部走 bypass 形狀」。bypass 不只
繞過跨模型驗證，它同時把每張 163k 直接灌進主線 context，並乘上該 session 的剩餘 turn 數
（成本模型見 [[session-tasks]] § Session context 預算）。

### 自我開脫（看到自己這樣說就停下）

| 開脫 | 實際 |
| --- | --- |
| 「我自己看比較快，dispatcher 要跑好幾分鐘」 | 快的是 wall-clock，付的是 context × 剩餘 turn。一張圖等於 200 次 Bash 呼叫的量 |
| 「只看一張確認一下」 | 86 次的實測平均就是這樣累出來的，沒有任何一次是打算讀 86 張 |
| 「dispatcher 回的 JSON 看不出細節」 | 那是 items-json 的 `ready_signal` / 判準沒寫夠，補那裡。**NEVER** 用目視補契約的洞 |

## 界線（不在本 rule 範圍）

下列**不**屬本 rule：

- **review-gui.ts 本體 bug**（endpoint、SPA、aggregation logic）→ 由 [[review-gui-change-discipline]] § Hard rule (fixtures gate) 管
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
| review-gui detail page impl gate（已 implemented） | `vendor/scripts/review-gui.ts` `countImplementationProgress` / `persistReviewAction` |

## Audit signal

規格細節見各 script 頭註解 + TD entry（`docs/archives/tech-debt-closed-2026-06.md`）：

| Signal | TD | 狀態 | SoT |
| --- | --- | --- | --- |
| `compound_verify_ui_single_screenshot` | TD-142 / TD-143 | done | `vendor/scripts/audit-screenshot-quality.ts` |
| `stale_screenshot_after_ui_change` | TD-178 | done | `vendor/scripts/audit-screenshot-staleness.ts` |
| `claude-analyzed-drift`（MUST 6/7 違反偵測） | TD-179 | done | `vendor/scripts/audit-claude-analyzed-drift.ts` |

**Performance 實測（MUST 5）升級路徑**：目前 advisory；若漏驗頻繁 → archive 前 hard gate 或 review-gui 自動生成 perf-trace sub-item（動本體，須走 [[review-gui-change-discipline]] fixtures gate）。

## 違反時的回報方式

```text
[review-gui-surface] Hard rule violation
修正方式：
  - skip scan → 跑 `--scan` 寫進 HANDOFF.md 再推薦
  - compound 單截圖 → 拆 sub-items 或補 multi-screenshot annotation
  - 繞 impl gate → 等 impl ≥ 90% 再做 manual review
  - 推 URL 給 user → 先跑 [[agent-self-verification]] fallback chain
  - 引用舊快照答狀態 → 本 turn 先重跑 `--scan` 再答
  - 回「你還沒點」→ 重掃驗證；檔案沒反映就當場代寫，並告知可能撞 409
繞過：無 escape hatch — review-gui contract 是真相層
```
