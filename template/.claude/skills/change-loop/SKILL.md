---
name: change-loop
description: "Use when 使用者說「自動推」「loop」「幫我把 change 推到 ready」「不在的時候繼續做」、或 routine fire 自動觸發（--unattended）。適用於推進既有 spectra change；NOT for 非 spectra 工作、一次性任務、interval 盲跑命令（用 /loop）、user 在場想逐項拍板（用 /goal）、或想設計新 loop（看 vendor/snippets/loop-engineering cookbook）。"
effort: xhigh
metadata:
  author: clade
  version: "1.4"
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/change-loop/
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# /change-loop — Autonomous Change Progression Loop

> 2026-07-05 前名 `/loop-engineer`（銳評改名：舊名指「loop 工程能力」、實為 spectra change 推進的單一 instance；通用方法論在 cookbook `vendor/snippets/loop-engineering/`）。舊名 stub 保留供既有 routine 相容。

本 skill 是 loop 四型分類中的 **proactive loop**——trigger 交給 routine 排程、工作清單交給 scan 自己找（你交出的是 prompt）。四型分類與通用設計方法論見 cookbook `vendor/snippets/loop-engineering/` § Loop 四型分類。

核心 contract：**每次被叫起來，把待辦清單裡的 change 盡可能推到「可驗收」或「已 shipped」狀態。NEVER 留半成品等 user 來推。NEVER 停下問 user — 所有決策自主完成。**

**Output contract**：loop 的 output 是**進度報告**，不是 user call-to-action。

- ✅ 「`<change>` 標 🟢 ready-for-review（寫入 HANDOFF）」— 報告事實
- ✅ 「推進 `<change>` 從 0% → 40%，剩 18 tasks」— 報告進度
- ❌ 「待 user 驗收：請執行 `pnpm review:ui` 開本地 GUI」— user call-to-action
- ❌ 「下一步：你在 review-gui 驗收，或我繼續 dispatch」— 把 ball 丟回 user
- ❌ 「下一輪可推進：1. ... 2. ...」— 列選單讓 user 決定

ready-for-review 項目寫 HANDOFF 就完成交接，loop 立即繼續 dispatch 其他 actionable item。**不在 output 重複 HANDOFF 內容來催 user 行動。**

## Step 0 — Mode Detection

```text
$ARGUMENTS
```

**單一自主模式** — 所有決策自主完成，卡點 log 到 HANDOFF + skip，archive 後落地方式依 § Workflow model 感知（trunk-based 直接 push）。

`--unattended` flag（routine fire 帶）唯一差異：**保留 3-item cap**（避免 runaway）。不帶 flag 時無 item cap。

**Loop 互斥鎖（防重疊觸發）**：單輪 dispatch 可能耗時數小時 > routine 2h 間隔，無鎖會對同一 consumer 疊第二輪。進 Step 1 前：

```bash
LOCK="$(git rev-parse --show-toplevel)/.spectra/change-loop.lock"
# lock 存在且（第一行 pid 存活 && 第二行 timestamp < 6h 前）→ 另一輪進行中：
#   輸出一行「change-loop already running (pid <pid>, since <ts>)」直接結束本輪
# 否則（無 lock / pid 死亡 / ≥6h stale）→ 覆寫接手：
mkdir -p "$(dirname "$LOCK")" && printf '%s\n%s\n' "$$" "$(date -u +%FT%TZ)" > "$LOCK"
# Step 5 完成後 MUST rm -f "$LOCK"（含失敗提早結束的路徑）
```

宣布模式一句話後進 Step 1。

## Step 1 — Scan

複用 handoff-scan.mjs 一次掃四段：

```bash
SCAN_JSON=$(node ~/offline/clade/vendor/scripts/handoff-scan.mjs --json 2>/dev/null)
```

**失敗 fallback**：handoff-scan.mjs 不存在或回傳 error → **STOP**，寫 HANDOFF 一行 `change-loop: scan failed at <ISO>` 後結束。不要憑記憶或 HANDOFF 既有 narrative 猜工作狀態。

從 JSON 取：

- `reviewGuiReadiness.raw.entries[]` — 每個 active change 的 `bucket` + `pending` + `total` + `userActionPending` + `reviewUrl` + `consumerId`
- `reviewGuiReadiness.raw.counts.buckets` — 各 bucket 計數
- `worktreeStash.raw.worktrees[]` — active worktree 清單
- `healthGate` / `techDebtHygiene` — 備用（本 skill 不主動處理，但 health warn 會 log）

**Consumer filter**：只處理 `consumerId` = 當前 cwd consumer 的 entries（避免從 clade home 誤觸別 consumer）。判斷 consumer：

```bash
basename "$(git rev-parse --show-toplevel)"
```

**In-flight filter（防單 change 雙派）**：`worktreeStash.raw.worktrees[]` 內已有對應 worktree 的 change = 另一輪 loop / 別 session 正在推 → **本輪跳過該 change** 並在 Step 5 Skipped 段記 `in-flight (worktree exists)`。**每一個** dispatch 前都要對照，不是只在開場檢查一次。

若 scan 回空 list（0 active changes）→ 跳 Step 5 寫「無可推進項目」。

## Step 1.5 — 讀上一輪 fail-streak

從 HANDOFF.md 的 `<!-- BEGIN: loop-engineer-status -->` 段解析上一輪 `⏸ Skipped` 與 `🧯 Escalated` 條目尾端的 `fail-streak: N` 標記，建出 `{change-name: N}` 對照表；條目無標記或整段不存在＝0。

**Escalated 離場規則**（對上一輪每一條 Escalated 條目逐項判定，兩條 predicate 任一成立＝已有人介入，streak 歸零、移出 Escalated）：

- 該 change 不再出現在本輪 scan entries（已 archive / 已刪除）
- 該 change 本輪 bucket ≠ Escalated 條目記錄的 bucket（狀態已被推動）

兩條都不成立 → 該 change 續留 Escalated（本輪**不 dispatch**），Step 5 原樣 re-emit。

## Step 2 — Prioritize

對 Step 1 過濾後的 entries 排序。優先序（從高到低）：

| 優先 | Bucket | 理由 | 動作 |
| --- | --- | --- | --- |
| 0 | `done` | review 全通過，零工作量 | archive → merge-back → commit + push |
| 1 | `feedbackGiven` | user 已留 review feedback，ball in Claude | 處理 feedback → 補 evidence |
| 2 | `readyForEvidence` | apply 完成，只缺 evidence annotation | 補 evidence |
| 3 | `awaitArchiveWalkthrough` | 只剩 `[discuss]`，可完成 archive | 跑 archive Step 3.5 |
| 4 | `ready` + `userActionPending=0` | 全部 OK，可直接 ship | auto-archive + commit |
| 5 | `ready` + `userActionPending>0` | review 需 user 目視 | 標 🟢 ready-for-review |
| 6 | `applyInProgress` | 實作未完成，可推進 | 繼續 apply |
| 7 | `healthCheckNeeded` | tasks.md 格式問題 | 修格式 |
| — | `applyBlocked` | ball in user（外部 blocker） | **跳過** |
| — | `awaitingUserDecision` | ball in user（商業決策） | **跳過** |
| — | `crossWtDirty` / `malformed` | 異常狀態 | **跳過**（log 到 HANDOFF） |

同 bucket 內依 `pending/total` 比率排序（完成度高的優先，更快 ship）。

**Escalation filter**：Step 1.5 對照表中 fail-streak ≥ 3 且未離場的 change → 不進 priority list，直接列入 Step 5 `🧯 Escalated` 段。

輸出排序清單一句話摘要：「Prioritized N items: done ×A, feedbackGiven ×B, ...」

## Step 3 — Execute

對 priority list 從頭取 item，依 bucket dispatch。每完成一個 item，**立即** commit progress + 重跑 scan 更新狀態，再取下一個。

### 3z. done

Review 全部通過（pending=0, issued=0），可直接 ship。

1. 直接 archive：
   ```
   Skill invoke: /spectra-archive <change-name>
   ```

2. Archive → merge-back → commit：
   ```bash
   git commit --only -m "✅ archive <change-name>" -- openspec/changes/archive/
   git push
   ```

3. 標 ✅ shipped。

### 3a. feedbackGiven

User 已在 review-gui 留 issue feedback。

1. 讀 review-gui feedback：
   ```bash
   cd ~/offline/clade
   node vendor/scripts/review-gui.mts --feedback <changeKey> 2>/dev/null
   ```
   若無 `--feedback` 子命令，fallback：從 `openspec/changes/<name>/tasks.md` 搜尋 `(issued:` / `(verify-pending:` annotation 定位 feedback 項目。

2. 在 worktree 修改 code / 補 evidence 回應每條 feedback：
   ```
   Skill invoke: /wt <change-name>: /spectra-apply <change-name>
   ```
   Brief 明確指出要回應哪些 feedback items（item ID + 描述）。

3. Worktree 內 typecheck + test + lint 必須綠燈。

4. 重跑 scan 確認 bucket 變化。

### 3b. readyForEvidence

Apply 完成，只缺 verify evidence annotation。

1. 在 worktree 跑 spectra-apply 的 evidence 補強步驟：
   ```
   Skill invoke: /wt <change-name>: /spectra-apply <change-name>
   ```
   Brief：「只做 Step 8a evidence annotation 補強，不做新 implementation。」

2. 重跑 scan 確認 bucket → ready。

### 3c. awaitArchiveWalkthrough

只剩 `[discuss]` items 待 Step 3.5 walkthrough。

1. 直接 dispatch archive（archive 免 worktree）：
   ```
   Skill invoke: /spectra-archive <change-name>
   ```
   Archive 內部 Step 3.5 會處理 discuss walkthrough。

2. Archive 完成 → merge-back 已包含在 archive Step 0。

3. commit + push：
   ```bash
   git commit --only -m "✅ archive <change-name>" -- openspec/
   git push
   ```

4. 標 ✅ shipped。

### 3d. ready (userActionPending=0)

Review 全部 OK，可直接 ship。

1. 直接 archive：
   ```
   Skill invoke: /spectra-archive <change-name>
   ```

2. Archive → merge-back → commit + push。

3. 標 ✅ shipped。

### 3e. ready (userActionPending>0)

Review 通過但有些項目需 user 目視確認。

1. **不做 archive** — ball in user。

2. 在 HANDOFF 標 🟢 ready-for-review，附：
   - 改了什麼（一句話摘要）
   - 需要 user 驗什麼（`userActionPending` 項目的描述）
   - review-gui deep-link URL

3. **立即**跳到 next item。不在 loop output 提示 user 去驗收 — HANDOFF 已記錄，user 自己會看。

### 3f. applyInProgress

實作未完成，**MUST** 推進 — 不論 change 大小、不論進度 0% 或 50%。

1. **Unpark guard**（在 main 跑；worktree 內 unpark 有 data loss 風險，per spectra-apply Step 0c.5）：

   ```bash
   spectra list --parked --json | jq -r '.parked[]?' | grep -Fx "<change-name>"
   ```

   命中 → `spectra unpark "<change>"` + `git add openspec/changes/<change>/ && git commit --only -m "📝 docs(spectra): unpark <change>" -- openspec/changes/<change>/`。未命中 → skip。

2. **Dispatch spectra-apply**（worktree 內跑，spectra-apply 從 Step 1 接手全流程）：

   ```
   Skill invoke: /wt <change-name>: /spectra-apply <change-name>
   ```

3. spectra-apply 推進 phases + 收 evidence，progress 累積在 tasks.md。loop-engineer 不介入 spectra-apply 內部流程。

4. 完成 / pause 回報後，重跑 scan 看 bucket：readyForEvidence / ready → 本 iteration 繼續處理。pause → log 到 HANDOFF + skip to next。

**Timing**：一個 applyInProgress dispatch 可能耗時數十分鐘至數小時（取決於 change 規模 + phase 數量）。在 `--unattended` mode 計為 1 個 item（3-item cap 照常適用）。

**NEVER**：
- ❌ 因「change 太大」「0% 進度」「需要完整 session」「不適合 loop-engineer」跳過 — spectra-apply 自管步驟粒度、phase dispatch、pause 與 blocker
- ❌ Defer 到「另一個 session」「user 手動跑」
- ❌ 報告「剩餘 N 個 applyInProgress 不適合推進」然後收工 — scan 回傳 applyInProgress 就 dispatch，無例外

### 3g. healthCheckNeeded

Tasks.md 格式問題或 Pre-Review Data Readiness violation。

1. 讀 scan 的 `hitsByCode` 確認具體問題。

2. 直接 Edit tasks.md 修格式（不需 worktree，tasks.md 是 openspec metadata）。

3. 重跑 scan 確認修復。

### Workflow model 感知（3z/3c/3d 落地前 MUST）

**每一次** archive 後 push 前，讀 `~/offline/clade/registry/consumers.json` 取當前 consumer 的 `workflow_model`：

- `trunk-based` → 直接 `git push`（現行全 fleet 皆此類）
- `pr-merge-based` → **NEVER 直推 main**：push feature branch + `gh pr create --fill`；`gh` 不可用 → 不 push、log 到 HANDOFF `## Loop Engineer Status`「PR 待開」+ skip to next
- registry 查不到當前 consumer → 當 `pr-merge-based` 保守處理

### Dispatch 共通規則

- **Worktree 路由**：涉及 tracked code 修改的 dispatch（3a/3b/3f）一律走 `/wt` worktree 隔離。Archive（3z/3c/3d）免 worktree（per spectra-archive worktree exemption）。
- **Commit 紀律**：每個 item 完成後獨立 commit。用 `git commit --only -- <paths>` 避免 cross-session staged pollution。
- **Error handling**：任何 dispatch 失敗（skill 報錯 / typecheck 紅燈 / merge conflict）→ log 失敗原因到 HANDOFF `## Loop Engineer Status` → skip to next item。**NEVER** 在單一 item 卡住時停止整個 loop。失敗時記 `fail-streak = Step 1.5 對照表值 + 1`（首次失敗＝1），寫進 Step 5 Skipped 條目尾端 `— fail-streak: N`；fail-streak ≥ 3 → 該 item 移入 `🧯 Escalated` 段，下一輪起不再 dispatch（見 Step 2 Escalation filter）。
- **Unattended guard**：`--unattended` mode 最多處理 3 個 items。超過 3 個 → 停止，剩餘寫進 HANDOFF。

## Step 4 — Loop

每完成一個 item 後：

1. 重跑 `handoff-scan.mjs --json`（輕量 scan，確保狀態即時）
2. 重新跑 Step 2 排序
3. 取下一個 item → Step 3

**停止條件**（任一成立即停；**每一條**停止路徑都 MUST `rm -f .spectra/change-loop.lock`）：

- Priority list 為空（全部 shipped / blocked / ready-for-review / skipped / in-flight / escalated — **0 個 actionable item 剩餘**）
- `--unattended` mode 已處理 3 個 items
- 連續 2 個 item dispatch 失敗（可能系統性問題，避免 loop 空轉）。Escalated 項不計入此判定——它們本輪未 dispatch，沒有新失敗事件

**反模式**：有 applyInProgress / feedbackGiven / readyForEvidence item 未處理卻停下來「等 user 驗收」或「列出下一步選項」= 違反核心 contract。ready-for-review 項目寫完 HANDOFF 後 loop **MUST** 繼續 dispatch 剩餘 actionable items。

## Step 5 — Update HANDOFF

在 `HANDOFF.md` 寫入 / 覆寫 `## Loop Engineer Status` section（BEGIN/END marker 包夾，每次整段覆寫）：

```markdown
<!-- BEGIN: loop-engineer-status -->
## Loop Engineer Status

_Updated: <YYYY-MM-DD HH:MM> by change-loop_

### ✅ Shipped (本輪)

- `<change-name>` — archived + committed as `<short-hash>` (<commit-message>)

_(空時寫 `_(none)_`)_

### 🟢 Ready for Review

- `<change-name>` — <一句話摘要改了什麼>
  - 驗收方式：<具體描述 user 要看什麼>
  - review-gui: `<reviewUrl>`

_(空時寫 `_(none)_`)_

### ⏸ Skipped

- `<change-name>` — bucket=`<bucket>` — <跳過原因>（dispatch 失敗的條目加 ` — fail-streak: N`）

_(空時寫 `_(none)_`)_

### 🧯 Escalated (fail-streak ≥ 3，已停止自動 retry)

- `<change-name>` — bucket=`<bucket>` — <最近一次失敗原因一句話> — fail-streak: N
  - 候選系統性修正：走 /oops 登 pitfall、或補 audit signal / eval，讓失敗可被 deterministic check 捕捉

_(空時寫 `_(none)_`；條目每輪原樣 re-emit，直到 Step 1.5 離場規則成立)_

### 📊 Progress (本輪推進但未完成)

- `<change-name>` — <N>% → <M>%（推進 <K> tasks，剩 <R>）

_(空時寫 `_(none)_`)_
<!-- END: loop-engineer-status -->
```

**寫入規則**：

1. 有舊 `<!-- BEGIN: loop-engineer-status -->` marker → 整段覆寫
2. 無 marker → append 到 HANDOFF.md 尾部
3. 路徑 **MUST** 用 main worktree absolute path（同 /handoff Step 1.5 解析邏輯）

最後 commit HANDOFF.md 更新 + push：

```bash
git commit --only -m "docs(handoff): loop-engineer status update" -- HANDOFF.md
git push
```

## 安全護欄

1. **不搶 working tree** — code 修改走 worktree（/wt dispatch），merge-back 只在 archive 時
2. **不動 blocked items** — `applyBlocked` / `awaitingUserDecision` 永遠跳過，不嘗試 unblock
3. **不做超出登記的工作** — 只處理 scan 回傳的 active changes，不自創新 change、不 propose、不動 tech-debt
4. **不 force push** — 所有 git 操作都是 safe 的（no `--force`）
5. **commit 走 --only** — 避免 cross-session staged pollution（per [[pitfall-consumer-ad-hoc-commit-eats-other-session-staged]]）
6. **每個 item 獨立 commit** — 不混合多個 change 的修改進同一 commit
7. **重複 invocation safe（shipped + in-flight 雙層）** — 已 shipped 的 change 不會出現在 scan；in-flight change（有 active worktree）由 Step 1 in-flight filter 排除；整輪重疊由 Step 0 互斥鎖擋。三層合起來才算 idempotent——只靠「shipped 不再出現」不夠（2026-07-05 銳評：舊版對 applyInProgress 無防護，2h routine 會疊派）
8. **不碰 user 的 stash** — worktree / stash audit 只讀不寫
9. **Error isolation ＋跨輪升級** — 單輪內：單一 item 失敗不停整個 loop，skip + log 後繼續。跨輪：同 item 重複失敗由 fail-streak 承接（≥ 3 → Escalated，不再 dispatch）——同錯重複該產出系統性修正（pitfall / audit signal / eval），不是無限 retry（Ng「同錯重複→建 eval」＋ CC team「system-level fixes」）
10. **不因 size/progress 跳過 dispatch** — applyInProgress item 不管進度 0% 或 change 看起來多大，MUST invoke `/spectra-apply`；dispatch 後 spectra-apply 自管 pause / blocker / timeout。「需要完整 session」「不適合 loop-engineer」等判斷 = 違反本條
11. **NEVER AskUserQuestion** — 所有決策自主完成，卡點 log 到 HANDOFF + skip
12. **NEVER output user call-to-action** — 不在 loop output 寫「待 user 驗收」「請執行 pnpm review:ui」「下一步建議」「下一輪可推進」。ready-for-review 狀態寫 HANDOFF 即完成，loop 繼續 dispatch 其他 item。end-of-loop output 是純進度報告（shipped N / progressed N / skipped N），不是讓 user 做決定的選單
13. **NEVER 有 actionable item 卻停下** — scan 結果有 applyInProgress / feedbackGiven / readyForEvidence 就 MUST dispatch，即使同時有 ready-for-review 項目。「先等 user 驗收再繼續」= 違反自主 contract

## Routine 設定指引

Per-consumer routine，用 `/schedule` 建立：

```
Name: change-loop-<consumer-id>
Schedule: 0 */2 * * *  (每 2 小時，或 user 調整)
Mode: create_new_session_on_fire
Notifications: push: true

Prompt:
"你是 <consumer-name> 的自動化 change loop。
cd ~/offline/<consumer-path> && 執行 /change-loop --unattended
規則已寫在 skill 內，照做即可。"
```

建 routine 是 user 手動做的事（`/schedule` skill），本 skill 不自動建。

**Cadence 提醒**：單輪 applyInProgress dispatch 可能 > 2h——重疊由 Step 0 互斥鎖擋（後到的輪次直接結束），不需為此調長 interval；但若觀察到連續多輪都被鎖擋，代表 change 規模 > cadence，把 interval 調成 4-6h 更省 routine fire 成本。

## 與其他 skill 的關係

| Skill | 本 skill 如何用它 / 邊界 |
| --- | --- |
| handoff-scan.mjs | Step 1 + Step 4 scan state |
| /spectra-apply | 3a/3b/3f dispatch（透過 /wt） |
| /spectra-archive | 3z/3c/3d dispatch（直接，免 worktree） |
| /wt | worktree 建立 + dispatch subagent |
| /handoff | 不直接調用（本 skill 取代 handoff Mode B 的「推薦 + 等 user 選」環節，改為自動執行） |
| **/goal** | **attended 版姊妹**：user 在場、可 AskUserQuestion、先讓 user 選 dispatch 優先序（見 [[goal-mode]] § 與 change-loop 的差異）。user 在電腦前想逐項拍板 → 用 /goal 不用本 skill |
| **/loop**（內建） | interval 盲跑某 prompt/命令、stateless 無 verifier。「每 N 分鐘重跑 X」→ /loop；「狀態驅動推進 spectra change」→ 本 skill |
| **/schedule**（內建） | 建 routine 的入口（見 § Routine 設定指引）；本 skill 不自動建 routine |

## 不做

- ❌ 自動建 spectra change（`/spectra-propose`）— 創建工作是 user 的職責
- ❌ 處理 tech-debt — 初版只做 spectra change lifecycle
- ❌ Cross-consumer 編排 — per-consumer 各自一個 loop
- ❌ 自動 unblock blocked changes — ball in user
- ❌ 修改 `.claude/rules/` 或 `CLAUDE.md` — 標準層不在 scope
- ❌ 停下來問 user 問題 — user 不在電腦前，一切自主
