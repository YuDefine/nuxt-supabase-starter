---
name: change-loop
description: "Use when 使用者要把 change 自主推進到 ready（「自動推」），或 routine --unattended fire。NOT for 一次性任務、interval 盲跑（用 /loop）、逐項拍板（用 /goal）。"
effort: xhigh
metadata:
  author: clade
  version: "2.0"
permission_tier: action
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/change-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# /change-loop — Autonomous Change Progression Loop

> 2026-07-05 前名 `/loop-engineer`（銳評改名：舊名指「loop 工程能力」、實為 spectra change 推進的單一 instance；通用方法論在 cookbook `vendor/snippets/loop-engineering/`）。相容 stub 已於 2026-07-17 移除——routine prompt 若仍寫 `/loop-engineer` 需改為 `/change-loop`。

本 skill 是 loop 四型分類中的 **proactive loop**——trigger 交給 routine 排程、工作清單交給 scan 自己找（你交出的是 prompt）。四型分類與通用設計方法論見 cookbook `vendor/snippets/loop-engineering/` § Loop 四型分類。

核心 contract：**每次被叫起來，把待辦清單裡的 change 盡可能推到「可驗收」或「已 shipped」狀態。NEVER 留半成品等 user 來推。能自主決策的自主完成；不確定的主動問 user（request_user_input），不要靜默跳過。**

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

**Flags**：

- `--unattended`（routine fire 帶）：**保留 3-item cap**（避免 runaway）+ **禁止 request_user_input**（user 不在場，卡點一律 log + skip）。不帶時無 item cap + 不確定的卡點**MUST request_user_input**。
- `--turbo`：**擴充 scope 到全部待辦**——spectra changes 處理完（或 idle 等待中）後，從 HANDOFF.md 和 `openspec/ROADMAP.md` 的非 spectra 待辦段拉工作繼續推進。不帶時只做 spectra change lifecycle（預設行為不變）。兩 flag 可疊加：`--turbo --unattended` = 擴充 scope + 3-item cap（spectra + turbo 合計）。
- 使用者說「turbo」「全部都做」「不只 spectra」「把 HANDOFF 的也做」→ 等同 `--turbo`。

**Continuous invocation（attended MUST，hard rule）**：

單次 `/change-loop turbo` = 一輪 scan→dispatch→收割。一輪結束後常有 user-bound blocker（review-gui 點 OK、`/commit` 清 staged、staging bootstrap）需等 user 完成才能繼續。**Agent MUST 用 `/loop` 持續運行**，而非跑一輪就宣告完成：

- **直接呼叫**（非從 `/loop` 或 `--unattended` routine fire）→ agent **MUST** 立即改走 `Skill invoke: /loop /change-loop turbo`（dynamic mode，自我 pace），**NEVER** 自己跑完一輪就停
- **從 `/loop` 呼叫**（正常路徑）→ 每輪結束後由 `/loop` 的 ScheduleWakeup 決定下次間隔：
  - 有 actionable item 剛 dispatch / in-flight → 短 interval（60-180s）
  - 全部 blocked on user → 長 interval（1200-1800s fallback heartbeat）
  - 所有 change shipped + turbo list 空 + in-flight ledger 空 → `/loop` 可 stop
- **「完成」的定義**：HANDOFF `## Loop Engineer Status` 的 Shipped + Skipped + Escalated + Ready for Review 涵蓋**所有** scan entries，且 in-flight ledger = 0，且 turbo list 空。任一不成立 → 不是完成，是「本輪無 actionable，等下一輪 re-scan」
- **NEVER** 把「本輪無 actionable item」當成「任務完成」寫 `(final)` 然後釋放 lock 結束 — 那只代表這一輪 scan 沒新東西可推，user 做完 blocker 後下一輪 scan 就會有

判定觸發（使用者說以下任一 → 等同要求 continuous）：「自動推」「loop」「幫我把 change 推到 ready」「change-loop turbo」「持續做」「不要停」

**Loop 互斥鎖（防重疊觸發）**：單輪 dispatch 可能耗時數小時 > routine 2h 間隔，無鎖會對同一 consumer 疊第二輪。進 Step 1 前：

```bash
LOCK="$(git rev-parse --show-toplevel)/.spectra/change-loop.lock"
# lock 存在且（第一行 pid 存活 && 第二行 timestamp < 6h 前）→ 另一輪進行中：
#   輸出一行「change-loop already running (pid <pid>, since <ts>)」直接結束本輪
# 否則（無 lock / pid 死亡 / ≥6h stale）→ 覆寫接手：
mkdir -p "$(dirname "$LOCK")" && printf '%s\n%s\n' "$$" "$(date -u +%FT%TZ)" > "$LOCK"
# Step 5 完成後 MUST rm -f "$LOCK"（含失敗提早結束的路徑；in-flight ledger > 0 時 NEVER 提前釋放）
```

宣布模式一句話後進 Step 1。

## Step 1 — Scan

複用 handoff-scan.ts 一次掃四段：

```bash
SCAN_JSON=$(node ~/offline/clade/vendor/scripts/handoff-scan.ts --json 2>/dev/null)
```

**失敗 fallback**：handoff-scan.ts 不存在或回傳 error → **STOP**，寫 HANDOFF 一行 `change-loop: scan failed at <ISO>` 後結束。不要憑記憶或 HANDOFF 既有 narrative 猜工作狀態。

從 JSON 取：

- `reviewGuiReadiness.raw.entries[]` — 每個 active change 的 `bucket` + `pending` + `total` + `userActionPending` + `reviewUrl` + `consumerId`
- `reviewGuiReadiness.raw.counts.buckets` — 各 bucket 計數
- `worktreeStash.raw.worktrees[]` — active worktree 清單
- `healthGate` / `techDebtHygiene` — 備用（本 skill 不主動處理，但 health warn 會 log）

**Parked changes 掃描**：scan 只回傳 active changes；parked changes 另外撈：

```bash
PARKED_JSON=$(spectra list --parked --json 2>/dev/null)
```

`parked` array 內的每個 change 視為 **priority 5.5**（介於 `ready+userActionPending>0` 和 `applyInProgress` 之間）加入 entries list，bucket 標記為 `parked`。Parked change 的推進路徑：unpark → dispatch `/spectra-apply`（見 § 3h. parked）。

**Consumer filter**：只處理 `consumerId` = 當前 cwd consumer 的 entries（避免從 clade home 誤觸別 consumer）。判斷 consumer：

```bash
basename "$(git rev-parse --show-toplevel)"
```

**In-flight filter（防單 change 雙派）**：`worktreeStash.raw.worktrees[]` 內已有對應 worktree 的 change → **不一定跳過**，先查 session claim 鮮度：

```bash
# 找對應 worktree 的 session claim
CLAIMS=$(find "$(git rev-parse --show-toplevel)/.clade/claims/" -name '*.json' 2>/dev/null)
# 每個 claim 含 sessionId / startedAt / lastActivity / changeName
```

判定：
- **Session claim 存在且 lastActivity < 30 min** → 別 session 正在推，**跳過**（log `in-flight (active session)`）
- **Session claim 存在但 lastActivity > 2h** → session 可能已離場，**request_user_input**：「`<change>` 有 worktree 但 session 已 >2h 無活動，要接手推進還是跳過？」
- **Session claim 不存在但 worktree 存在** → 孤兒 worktree，**直接接手**（先 `wt-helper.mjs cleanup` 清理再重新 dispatch）
- **HANDOFF 有「designated to X session」標記** → **不自動跳過**。讀 HANDOFF 標記的 session 是否仍 active（同上查 claim）；不 active 則接手。真 active 的才跳過

**每一個** dispatch 前都要對照，不是只在開場檢查一次。

若 scan 回空 list + parked 也空（0 個可推進 change）→ 跳 Step 5 寫「無可推進項目」。帶 `--turbo`，或 § Dispatch 共通規則 的「主線工作來源」補件非空時**不適用**——改走補件，補件也空才跳 Step 5。

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
| 5.5 | `parked` | 暫存但未完成，可 unpark 推進 | unpark → apply |
| 6 | `applyInProgress` | 實作未完成，可推進 | 繼續 apply |
| 7 | `healthCheckNeeded` | tasks.md 格式問題 | 修格式 |
| 8 | `applyBlocked` | 外部 blocker | **評估 blocker**（見 § 3i） |
| 9 | `awaitingUserDecision` | 商業決策 | **評估決策需求**（見 § 3j） |
| — | `crossWtDirty` / `malformed` | 異常狀態 | **跳過**（log 到 HANDOFF） |

同 bucket 內依 `pending/total` 比率排序（完成度高的優先，更快 ship）。

**排序完 MUST 分組**：優先序決定「先做哪個」，**分組**決定「哪些可以同時做」。**每一個** item 都要落進 [dispatch-topology.md](reference/dispatch-topology.md) 的四組之一（扇出組 ≤4 併發 / dev-port 組 1 / main 組 1 / 主線即時組），Step 3 依組別 dispatch，不是依單一佇列逐一取。

**Claude-actionable override（hard rule，bucket 之上的修正層）**：

Bucket 是粗粒度聚合。以下 scan 欄位代表**即使 bucket 看起來是 user-bound，仍有 Claude 該做的工作**——change-loop **MUST** 在 bucket routing 之後、skip 之前檢查每一條：

| Scan 欄位 | 意義 | bucket=ready 時的正確動作 | bucket=applyBlocked 時的正確動作 |
| --- | --- | --- | --- |
| `issued > 0` | user 在 review-gui 留了 issue feedback 給 Claude | 走 § 3a feedbackGiven 邏輯（triage issue → fix / route=E / TD），**NEVER** 標 🟢 就跳過 | 走 § 3a 處理 review items（impl blocked ≠ review items blocked） |
| `verifyClaudePendingCount > 0` | verify:e2e/api/ui 項 evidence 未收齊 | 走 § 3b readyForEvidence 邏輯補 evidence | 同上 |
| `discussPendingCount > 0` | [discuss] items 待 walkthrough | 走 § 3c awaitArchiveWalkthrough 邏輯 | 同上 |
| `staleEvidenceCount > 0` | 截圖已 stale（code 改動後未重拍） | 重拍 stale evidence | 同上 |
| review-gui 顯示「🤖 等 Claude 接手」群 | 有 items 落在 Claude-ball 群（issued 未 analyzed / verify pending / discuss pending） | **MUST** 讀 review-gui 的接手 prompt 並逐條處理 | 同上 |
| `（issue: ... 需跑 <CLI command>）` | issue 描述含操作性前置步驟（staging bootstrap / DB fixture / env setup） | 若 target 是 staging（非 production）→ 主動跑 CLI 解除 blocker；production → request_user_input | 同上 |

**判定流程**（每條 change 在 bucket routing 後 MUST 跑）：

```
IF issued > 0 OR verifyClaudePendingCount > 0 OR discussPendingCount > 0 OR staleEvidenceCount > 0:
  → 有 Claude-actionable review work，走對應 § 3a/3b/3c 邏輯
  → 處理完後 re-scan，bucket 可能位移（ready → feedbackGiven → ready 等）
  → 只有 Claude-actionable 全部處理完、re-scan 確認 0 後，才能走 bucket 的 skip/ready-for-review 路徑
ELSE:
  → 走原 bucket routing
```

**「bucket=ready 但 issued>0」是最致命的盲區**（2026-07-21 <consumer-a> 實證：5 個 issued items 被 `ready` bucket 掩蓋，change-loop 宣告 user-bound 然後 30min idle，user 被迫在 review-gui 等 Claude 不會來的接手）。

**「bucket=applyBlocked 但人工檢查有 Claude-actionable」同理**：impl 卡 blocker ≠ review items 也卡。人工檢查 lifecycle 獨立於 impl lifecycle — applyBlocked change 的 review items 照樣要 triage。

**Escalation filter**：Step 1.5 對照表中 fail-streak ≥ 3 且未離場的 change → 不進 priority list，直接列入 Step 5 `🧯 Escalated` 段。

輸出排序清單一句話摘要：「Prioritized N items: done ×A, feedbackGiven ×B, ...」

## Step 3 — Execute

Dispatch 前 **MUST** 先完整讀 [dispatch-topology.md](reference/dispatch-topology.md) 取得四組契約、扇出上限與 lease 紀律。

執行模型（**不是**單一佇列逐一取）：

1. **先把扇出組填到 4 個 in-flight**（3f / 3h / turbo code task / 不需起 dev server 的 3a、3b，各自 `/wt` worktree）
2. **主線接著推進序列組**：main 組（archive/commit/push，主線自己做，一次一個）→ dev-port 組（evidence，取得 lease 後**仍走 `/wt` dispatch**，一次一個）→ 主線即時組（3g / 3e / 3i / 3j / investigation，主線自己做）
3. **收到 `<task-notification>`** → 走 Step 4.5 收割 SOP → 從扇出組補一個新 dispatch
4. 每完成一個 item，**立即** commit progress + 重跑 scan 更新該 change 的狀態

同一個 change 的 item 之間仍然序列（bucket 位移要看上一步結果）；**不同 change 之間沒有依賴**，NEVER 讓 B 等 A 完成。

### 3z / 3c / 3d / 3h / 3g — 固定步驟 bucket

這五個步驟固定、無分支判斷：`3z` done、`3c` awaitArchiveWalkthrough、`3d` ready(userActionPending=0) 是 archive→ship 三條路徑；`3h` parked 是 unpark 後轉 § 3f（parked 是 actionable 狀態，不是「永遠跳過」）；`3g` healthCheckNeeded 是 Edit tasks.md 修格式後 re-scan。

命中任一 → **MUST 讀 [simple-buckets.md](reference/simple-buckets.md) § 對應 bucket** 照步驟走。**NEVER** 憑印象跑三條 ship 路徑——它們的 commit pathspec 不同（`openspec/changes/archive/` vs `openspec/`），弄錯會漏 commit 或誤納其他 change 的檔案。

### 3a. feedbackGiven

User 已在 review-gui 留 issue feedback。

1. 讀 review-gui feedback：
   ```bash
   cd ~/offline/clade
   node vendor/scripts/review-gui.ts --feedback <changeKey> 2>/dev/null
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

### 3e. ready (userActionPending>0)

**先跑 Claude-actionable override（Step 2 hard rule）**，再決定是否 skip：

1. **Check Claude-actionable sub-items**：讀 scan 的 `issued` / `verifyClaudePendingCount` / `discussPendingCount` / `staleEvidenceCount`。任一 > 0 → **MUST** 先走對應 § 3a/3b/3c 處理完畢並 re-scan，**NEVER** 直接標 ready-for-review。

2. **Check 操作性 blocker**：讀 tasks.md `## 人工檢查` 的 `（issue:）` annotations，若描述含 CLI 命令（如 `pnpm ops:bootstrap-system-admin -- --env staging --apply`）且 target 是 staging（非 production）→ 主動跑 CLI 解除 blocker，讓 user 可以繼續驗收。**user 說「堵塞讓我無法繼續驗」= 這類 blocker 是 Claude 的責任，不是 user 的。**

3. **Claude-actionable 全部處理完且 re-scan 仍 `ready`**：
   - 在 HANDOFF 標 🟢 ready-for-review，附 review-gui deep-link URL
   - **立即**跳到 next item

4. **NEVER** 在 `issued > 0` 時標 🟢 ready-for-review — issued items 是 user 給 Claude 的 feedback，必須先 triage。

### 3f. applyInProgress

實作未完成，**MUST** 推進 — 不論 change 大小、不論進度 0% 或 50%。

> **入口**：Step 1 scan 的 `applyInProgress` bucket（主路徑）**或** turbo dispatch（§ 3t）的 spectra change association 命中。turbo 來源且該 change 已被 Step 1 scan 涵蓋、本輪已 dispatch 過 → 跳過（防重複 dispatch）。

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

### 3i. applyBlocked / 3j. awaitingUserDecision

Bucket 為 `applyBlocked` 或 `awaitingUserDecision` 時 **MUST** 先完整讀 [blocker-evaluation.md](reference/blocker-evaluation.md) 取得完整評估流程（blocker 鮮度判定表、自主解決嘗試表、impl blocked ≠ review items blocked hard rule）再執行。

### 3t. Turbo dispatch

啟用 `--turbo` 時 **MUST** 先完整讀 [turbo-dispatch.md](reference/turbo-dispatch.md) 取得完整 turbo 掃描來源、Spectra change association、分類與 dispatch 表、skip 合法理由窮舉。

### Workflow model 感知（3z/3c/3d 落地前 MUST）

**每一次** archive 後 push 前，讀 `~/offline/clade/registry/consumers.json` 取當前 consumer 的 `workflow_model`：

- `trunk-based` → 直接 `git push`（現行全 fleet 皆此類）
- `pr-merge-based` → **NEVER 直推 main**：push feature branch + `gh pr create --fill`；`gh` 不可用 → 不 push、log 到 HANDOFF `## Loop Engineer Status`「PR 待開」+ skip to next
- registry 查不到當前 consumer → 當 `pr-merge-based` 保守處理

### Dispatch 共通規則

- **Per-item task 追蹤（MUST）**：每條 dispatch item **MUST** 在 dispatch 前用 `update_plan` 建獨立 task（subject 用 `<change-name>: <bucket> → <動作>`，description 寫具體 dispatch 內容）。dispatch 開始 `update_plan` 標 `in_progress`；完成/skip/blocked 立即 `update_plan` 標 `completed`。Loop 結束時 `TaskList` 應反映所有 dispatch item 的最終狀態。**NEVER** 只建概括性收割 task 而不追蹤個別 dispatch item — user 看 task list 判斷 loop 在幹嘛，概括 task 提供零資訊。
- **Dev server 協調（evidence collection 前 MUST）**：evidence collection（3a/3b）或 Design Review 需要 dev server 時，**主線自行協調**，**NEVER** 把 dev server 切換當 user 協調事項跳過。協調 SOP：
  1. 檢查 `zellij list-sessions | grep dev-`，列出所有 dev session
  2. 對每個 dev session 判定：
     - 對應 change 已 archived / merged → **stale，直接 `zellij delete-session <name> --force`**（安全：change 已不需要 dev server）
     - 對應 change 仍 active 但 session claim lastActivity > 2h → **可能 stale，`dev-session.mjs stop` 停掉**
     - 對應 change 有 active claim < 30min → **真 conflict，此時才 request_user_input 讓 user 拍板 takeover**
  3. 清掉 stale session 後，用 `node scripts/dev-session.ts --cwd <需要的 worktree path>` 起新 dev server（per [[proactive-skills]] § Dev Server Auto-Spawn）
  4. Dev server ready 後繼續 dispatch evidence collection / Design Review
  - **判定 key**：`verification-lease.md` 的「NEVER 自行 takeover」只在**有 active lease conflict**（另一個 live session 正在用）時生效。**無 lease 檔 + stale session = 不是 conflict**，主線 MUST 自行清理 + 重起，**NEVER** 包裝成「需 user 協調」跳過
  - **NEVER** 因為 port 被佔就跳過 evidence collection — 先清 stale、再起 dev server、最後才 dispatch
- **Worktree 路由**：涉及 tracked code 修改的 dispatch（3a/3b/3f）一律走 `/wt` worktree 隔離。Archive（3z/3c/3d）免 worktree（per spectra-archive worktree exemption）。
- **Commit 紀律**：每個 item 完成後獨立 commit。用 `git commit --only -- <paths>` 避免 cross-session staged pollution。
- **Error handling（dispatch failure vs fixable issue）**：
  - **Dispatch failure**（skill 本身報錯 / infra 不可達 / 無法啟動）→ log + skip + fail-streak，繼續下一個 item
  - **Fixable issue found during dispatch**（E2E spec selector bug / guard missing path / annotation format drift / test assertion 需更新）→ **MUST 就地修 → 重跑 → re-scan → 繼續 loop**，**NEVER** 當成 dispatch failure skip 掉。判定：「我能在當前 session 用 Edit + Bash 修好嗎？」是 → fixable issue，就地修；否 → dispatch failure
  - **NEVER** 在單一 item 卡住時停止整個 loop。失敗時記 `fail-streak = Step 1.5 對照表值 + 1`（首次失敗＝1），寫進 Step 5 Skipped 條目尾端 `— fail-streak: N`；fail-streak ≥ 3 → 該 item 移入 `🧯 Escalated` 段，下一輪起不再 dispatch（見 Step 2 Escalation filter）
- **Unattended guard**：`--unattended` mode 最多處理 3 個 items。超過 3 個 → 停止，剩餘寫進 HANDOFF。
- **主線工作來源（正向定義）**：主線是序列組的執行者，不是扇出後的等待者。任一時刻的工作依 [dispatch-topology.md](reference/dispatch-topology.md) § 主線在做什麼 的順序取。四組都空之後才輪到 HANDOFF 待辦段補件：
  1. `## Loop Engineer Status` 的 ⏸ Skipped 中 fail-streak < 3 且本輪尚未嘗試的 item
  2. `📊 Progress` 中上一輪推進但本輪 scan 仍 actionable 的 item
  3. consumer 端 `## Outstanding` / `## Follow-up` 中明確標記為 spectra change 且當前 consumer 匹配的條目 → 當作 applyInProgress dispatch

  補件工作遵守所有既有護欄（worktree 路由 / commit 紀律 / error handling / unattended cap）。收到 notification 後，若當前補件 task 可安全中斷（尚未開始 Edit / 未進 worktree）則切回走收割 SOP；否則做完再處理。

  **補件邊界**：只拉已存在的 spectra change 進 dispatch。**NEVER** 自創新 change（`/spectra-propose`）、動 tech-debt、或跨 consumer 操作——護欄 #3 同樣適用，唯一鬆綁是允許從 HANDOFF 待辦段拉已登記的 change。

  **NEVER 只更新 HANDOFF 然後掛著等通知**——四組或 HANDOFF 補件還有 item 時的等待就是違規，不論有沒有帶 `--turbo`。HANDOFF status 是 Step 5（四組皆空、補件皆空、in-flight 歸零之後）的事，不是中途的 exit ramp。

## Step 4 — Loop

每完成一個 item 後：

1. 重跑 `handoff-scan.ts --json`（輕量 scan，確保狀態即時）
2. 重新跑 Step 2 排序 + 分組
3. 回 Step 3 的執行模型（補滿扇出組 → 主線做序列組）

**In-flight ledger（Step 3 每次 background dispatch 都 MUST 記）**：主線維護一份本輪自己派出的 background agent 清單——每 dispatch 一個（`/wt` subagent / codex / 具名 Agent）記一條 `{agent 名, change/item, dispatch 時間}`；收到該 agent 的 `<task-notification>`（或 SendMessage 回報）並處理完後移除。此 ledger 追蹤的是**本輪自己的 dispatch**，與 Step 1 in-flight filter（別 session 的 worktree）是兩回事；它是 Step 4 停止判定與 Step 4.5 收割判定的依據。

**停止條件**（任一成立即停；**每一條**停止路徑都 MUST `rm -f .spectra/change-loop.lock`）：

- **四組皆空**（扇出 / dev-port / main / 主線即時，全部 shipped / blocked / ready-for-review / skipped / in-flight（別 session）/ escalated）**且 § 主線工作來源 的 HANDOFF 補件也空**、**且 in-flight ledger = 0**（本輪自己 dispatch 的 background agent 全部已回報並走完收割）；`--turbo` 時含 turbo item 也已分組完畢且各組皆空
- `--unattended` mode 已處理 3 個 items（spectra + turbo 合計，**含收割後補 dispatch 的 items**）
- 連續 2 個 item dispatch 失敗（可能系統性問題，避免 loop 空轉）。Escalated 項不計入此判定——它們本輪未 dispatch，沒有新失敗事件

**in-flight ledger > 0 就不是停止狀態**，即使四組都空。Background agent 完成後 change 狀態會位移（`applyInProgress` → `readyForEvidence` / `ready` / `done`），loop 此時退出 = 沒人 re-scan + 收割，agent 成果懸空等 user 手動觸發善後。

## Step 4.5 — 收割（每個 notification 到達時做，不是階段）

收割**不是** dispatch 全部結束後才開始的階段——它跟 dispatch 交錯進行。**每一個** `<task-notification>` 到達時立即走收割 SOP，收完從扇出組補一個 dispatch，然後繼續主線的序列組工作。

收割 SOP、等待機制（notification-only + ScheduleWakeup 1500s 安全網 + 2h 強制退出）、in-flight ledger 維護，**MUST** 先完整讀 [harvest.md](reference/harvest.md)。

**反模式**（任一出現 = 立即停手自查）：

- 有 actionable item 未處理卻停下來「等 user」= 違反核心 contract＋護欄 #11
- in-flight agent 還在跑就寫 HANDOFF、釋放 lock 收工 = 違反護欄 #12
- 寫「下一輪要做的」「下次 session 處理」然後收工 = **最常見違反**（2026-07-21 <consumer-a> 實證）。E2E spec failure / guard bug / annotation drift 都是 fixable issues——MUST 就地修 → 重跑 → re-scan → 繼續 loop，**NEVER** 列 TODO 然後釋放 lock
- 把 evidence 收集過程中發現的 code bug（guard 漏路徑 / spec selector 錯）分類成「下一輪」→ 違反 Error handling § fixable issue 規約

## Step 5 — Update HANDOFF

在 `HANDOFF.md` 寫入 / 覆寫 `## Loop Engineer Status` section（BEGIN/END marker 包夾，每次整段覆寫）。寫入前 **MUST** 先完整讀 [handoff-template.md](reference/handoff-template.md) 取得模板。

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
2. **Blocked/Decision items 先評估再處理** — `applyBlocked` 走 § 3i 評估 blocker 是否已解除；`awaitingUserDecision` 走 § 3j 自主嘗試解決（技術決策自決、只有商業決策才問 user）。兩者都不是「永遠跳過」
3. **不做超出登記的工作** — 只處理 scan 回傳的 active changes + parked changes + HANDOFF 待辦段已登記的 spectra change（見 § 主線工作來源），不自創新 change、不 propose、不動 tech-debt
4. **不 force push** — 所有 git 操作都是 safe 的（no `--force`）
5. **commit 走 --only** — 避免 cross-session staged pollution（per [[pitfall-consumer-ad-hoc-commit-eats-other-session-staged]]）
6. **每個 item 獨立 commit** — 不混合多個 change 的修改進同一 commit
7. **重複 invocation safe（shipped + in-flight 雙層）** — 已 shipped 的 change 不會出現在 scan；in-flight change（有 active worktree）由 Step 1 in-flight filter 排除；整輪重疊由 Step 0 互斥鎖擋。三層合起來才算 idempotent——只靠「shipped 不再出現」不夠（2026-07-05 銳評：舊版對 applyInProgress 無防護，2h routine 會疊派）
8. **不碰 user 的 stash** — worktree / stash audit 只讀不寫
9. **Error isolation ＋跨輪升級** — 單輪內：單一 item 失敗不停整個 loop，skip + log 後繼續。跨輪：同 item 重複失敗由 fail-streak 承接（≥ 3 → Escalated，不再 dispatch）——同錯重複該產出系統性修正（pitfall / audit signal / eval），不是無限 retry（Ng「同錯重複→建 eval」＋ CC team「system-level fixes」）
10. **不因 size/progress 跳過 dispatch** — applyInProgress item 不管進度 0% 或 change 看起來多大，MUST invoke `/spectra-apply`；dispatch 後 spectra-apply 自管 pause / blocker / timeout。「需要完整 session」「不適合 loop-engineer」等判斷 = 違反本條
11. **主動 contract ＋ Output contract** — 能自主決策的自主完成；不確定時**MUST request_user_input**（blocker 是否解除、designated session 是否接手、商業決策），**NEVER 靜默跳過可以問 user 就解決的卡點**。Output 是純進度報告（shipped N / progressed N / skipped N），不是讓 user 做決定的選單——正向定義見開頭 § Output contract（✅ / ❌ 範例表）。scan 結果有 actionable item 就 MUST dispatch 或 ask，NEVER 停下「先等 user 驗收再繼續」
12. **收割護欄** — in-flight ledger > 0 時**不是**停止狀態，即使四組皆空：**MUST** 走 Step 4.5 收割每一個回報，**NEVER** 提早寫 HANDOFF 收工；lock 在 in-flight > 0 期間**不釋放**（防第二輪 routine 疊上來）；超過 **2 小時**無任何 agent 回報 → 強制退出（尚未回報的 in-flight 條目按 dispatch 失敗記 fail-streak、寫 HANDOFF + 釋放 lock），防 hang；`--unattended` 的 3-item cap **包含**收割後補 dispatch 的 items
13. **Bucket ≠ ball ownership（Claude-actionable override 護欄）** — `bucket=ready` 不等於 user-bound；`bucket=applyBlocked` 不等於 Claude 無事可做。**MUST** 在每條 change 的 bucket routing 後檢查 `issued` / `verifyClaudePendingCount` / `discussPendingCount` / `staleEvidenceCount`。任一 > 0 = Claude 仍有工作，**NEVER** 以 bucket 為由 skip。實證（2026-07-21 <consumer-a>）：bucket=`ready` + issued=5 → change-loop 宣告 user-bound + 30min idle，user 在 review-gui 等 Claude 接手永遠等不到。**「所有 change 卡 user action」這句話在 issued>0 時就是錯誤判斷。**

## Reference

建立 routine 或查看 skill 依賴關係時讀 [routine-and-relations.md](reference/routine-and-relations.md)（Routine 設定指引、與其他 skill 的關係、scope 排除清單）。
