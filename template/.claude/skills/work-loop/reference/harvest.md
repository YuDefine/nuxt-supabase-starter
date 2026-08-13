<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# 收割（每個 notification 到達時做）

> 主檔 pointer：「每一個 `<task-notification>` 到達時立即走收割 SOP，MUST 先完整讀本檔」。

## 收割不是階段，是 pipeline 的一段

**觸發條件**：任一 in-flight agent 回報（`<task-notification>` 或 SendMessage）。**不需要**等 priority list 清空——收割 SOP 每一步都只用到**該 agent 自己**的產出，沒有一步需要「全部 agent 的結果」。把它做成 dispatch 之後的獨立階段，會讓先完成的 agent 成果乾等最慢的那個。

收割完 → 從扇出組補一個 dispatch → 主線回去做序列組。dispatch 與收割全程交錯。

**為什麼一定要收割**：dispatch 是非同步的——agent 完成時會產生**新的 actionable items**（apply 完成 → 可補 evidence / 可 archive），只有 re-scan 才看得到。不收割的 loop 在 dispatch 完就退出，archive / commit 全部懸空。

### 等待機制

`in-flight ledger > 0` 且四組皆空時，loop **不退出、不釋放 lock**。

| 機制 | 行為 |
| --- | --- |
| Notification-only 等待 | 每個 in-flight agent 完成時系統送 `<task-notification>`（或 SendMessage 回報），主線收到才處理——不短輪詢。無 task id 的條目仍在 `inFlight` 持久記錄 `dispatchedAt`、`owner`、`deadline` 與 `lifecycle`。這類條目的 claim key 是 **owner ref**（`taskId: null`），狀態機與 task-id claim 相同：`pending → harvesting → harvested`，已是 `harvesting` / `harvested` 則 no-op |
| 安全網 fallback | 有 `Bash(run_in_background)` harness task id 的 dispatch：把 `taskId`、`owner`、`deadline`、`lifecycle=pending` 記入 `inFlight`，並排 1500s generic control wakeup（SoT：[[agent-routing]] § Generic async keepalive prompt）。只有 terminal 才排 `ASYNC_LIFECYCLE_HANDOFF` 並 claim；deadline / unknown 一律保留 ledger ownership，走下列 deadline protocol。無 task id 的 dispatch 改排 [[agent-routing]] § Notification-only keepalive prompt，並用 ledger deadline 觸發同一 deadline protocol。**NEVER** 放原 `/work-loop` prompt，或在 control turn 做任何 mutation |
| 等待期間 | 主線工作來源見 [dispatch-topology.md](dispatch-topology.md) § 主線在做什麼。四組與 HANDOFF 補件皆空、且 in-flight > 0 時的等待是收斂，不是閒置 |
| Hang 上限 | 每個 `deadline` = dispatch 後 **2 小時**。deadline 到達時先把 `lifecycle` 寫為 `cancelling`，停止 control wakeup，並以 `TaskStop` 取消可取消的 task；無 task id 的 owner 走自身 cancel protocol。**確認 terminal 前 NEVER** 記 fail-streak、移除 ledger、釋放 lock 或重派。terminal 通知到達後才 claim、按 dispatch failure 收尾、寫 HANDOFF 與釋放 lock |

### pre-scan 通知的輕量收割（不走 8 步 SOP）

`inFlight` 條目 `agent` 為 `codex:<label>` 者，收到通知只做三步：

1. `BashOutput` 讀 dispatcher 的單行 JSON，依 [dispatch-topology.md](dispatch-topology.md) § pre-scan 的 exit code 分流 判處置
2. `git status --short` 驗零新增改動（read-only 契約）；有改動 → revert 後按 exit 3 機械故障處置
3. 消費 report，該 item 回 Step 3 續判

ledger 移除照做、2h hang 上限照算。8 步 SOP 的 scope-verify / checker / re-scan 是為**寫入型** dispatch 設計的，對 read-only pre-scan 無對象。

### 每收到一個 notification → 立即處理（收割 SOP）

1. **驗收 agent 結果**：`git -C <worktree> log --oneline` + `git -C <worktree> status --short` + 讀 `WORKTREE-BRIEF.md` 的 Progress / frontmatter status——agent 的完成宣稱是未驗證主張（per [[agent-routing]] § Subagent 回報契約），MUST 有 commit 佐證
   - **主線自走 worktree 時（SKILL.md § `/wt` 不可用時的 dispatch 形狀）這一步不放寬**：commit
     照樣要有，只是由主線在 worktree 內產生。要放棄的是「讀 agent 的完成宣稱」那一半——
     沒有 agent 可讀，也沒有未驗證主張要拆穿；`git log` 與 `git status --short` 兩條照跑
2. **驗 scope**：`node ~/offline/clade/scripts/scope-verify.ts --repo <repo> --scope '<brief 宣告的每一條路徑>'`。scope 外的**實質**改動 → `git checkout HEAD -- <file>` revert 後 re-run 該 agent 交付的驗證（per [[subagent-scope-discipline]]）。subagent 自報「No changes outside scope」是未驗證主張，**NEVER** 採信
3. **高擴散半徑 change MUST 派 checker**：該 dispatch 的 change 觸及跨 consumer 共用 SoT（`rules/core/` / `vendor/` / `hub-*` skill / `claude-md/`）或高擴散半徑 consumer 資產（DB migration / auth 路徑 / 多處 import 的共用 util / 對外 API contract）時，依 [[checker-subagent]] 派一個 **fresh-context** checker subagent（只給 diff + spec 的驗收標準；gate 全綠是派 checker 的**前置條件**，NEVER 塞進 brief 當判定材料），拿 PASS / FAIL。**phase 數不是判準**——3 個 phase 的純 UI 調整不派，1 個 phase 的 migration 要派。主線自己讀一遍 diff **不算**複核——主線是派工方，帶著「我知道我要它做什麼」的記憶，正是 Iron Law 指的有偏差裁判。FAIL 的 blocker finding 修完 MUST 重派新 checker
4. **更新 HANDOFF progress 段**：`📊 Progress` 條目即時反映該 change 的推進
5. **Re-scan**：重跑 `handoff-scan.ts --json`
6. **檢查新 actionable**：bucket 位移（`applyInProgress` → `readyForEvidence` / `ready` / `done`）= 新 actionable → 回 Step 3 分類 + 分組 → 依組別 dispatch，計入 unattended cap
7. **更新 in-flight ledger**：移除已處理的 agent；步驟 6 的新 dispatch 記進 ledger
8. **補滿扇出組**：扇出 in-flight < 4 且扇出組還有未 dispatch 的 item → 補一個（4 只計扇出組，dev-port dispatch 另計）

### 進 Step 6 停止判定的條件（兩者**同時**成立）

- In-flight ledger = 0（所有派出的 agent 已回報並走完收割 SOP）
- 最後一次 re-scan 後四組皆空，且 HANDOFF 補件來源也空

任一不成立 → 繼續 dispatch / 繼續等下一個 notification。

### 實例（2026-07 <consumer-a> `/change-loop turbo`，本段落的由來）

1. Loop dispatch 4 個 background agent：3 個 `/wt /spectra-apply` worktree（`admin-permission-gate-alignment` / `admin-dashboard-action-center` 等）+ 1 個 Fable dump script
2. ❌ 不收割的行為：可 dispatch 的 item 都派完 → 主線寫 HANDOFF → 釋放 lock → 結束 loop
3. Agent 陸續完成（`admin-permission-gate-alignment` Phase 1-6 done、`admin-dashboard-action-center` Phase 1-5 done、v1 migration 14/14）——但 loop 已死，沒人 re-scan，user 被迫手動下指令觸發 archive / commit
4. ✅ 收割行為：每收到一個 agent notification 就驗收 + re-scan，`applyInProgress` 位移成可 archive → 立即 dispatch archive + commit；期間主線繼續做序列組與非 spectra work；in-flight 歸零且四組皆空後才寫 HANDOFF + 釋放 lock
