---
description: 多 session 並行下「哪些路徑屬於別 session 還活著的工作」的判定規格——claim 檔 schema、寫 / refresh / drop 時機、誰讀、stale 處理、claim-helper CLI，以及 ownership provenance journal 的寫入時證據與 other-live / orphan / unknown 三分類
paths: ['.clade/claims/**', 'HANDOFF.md', 'capabilities/core/hooks/pre-bash-ownership-stamp.sh', 'scripts/claim-helper.ts', 'vendor/scripts/claim-helper.ts', 'vendor/scripts/ownership-journal.ts', 'vendor/scripts/flow/who.ts', '.clade/ownership/**', 'capabilities/core/hooks/post-tool-ownership-journal.sh', 'capabilities/core/hooks/pre-edit-claim-conflict.sh']
---
<!-- Clade native rule; source: rules/core/session-claims.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Session Claims

> 判定「**哪些路徑屬於別 session 還活著的工作**」，避免誤殺別 session WIP、錯誤 commit 分組、或清掉 active worktree。

## 1. 什麼是 claim

每個活躍的 AI session（supported AI runtime）在 worktree 開出來時，會在 consumer 的 `.clade/claims/<session-id>.json` 寫一份 claim 檔。Schema：

```json
{
  "session_id": "...",
  "agent": "claude-code|codex|cursor",
  "started_at": "<iso>",
  "consumer": "<consumer-b>",
  "worktree_path": "/Users/.../<consumer>-wt/<slug>",
  "branch": "session/<date>-<slug>",
  "change_id": "<slug>",
  "expected_paths": ["server/api/foo/**", "layers/bar/**"],
  "work_id": "W-2026-08-29-<slug>",
  "last_heartbeat": "<iso>",
  "expires_at": "<iso, started+24h>"
}
```

- `session_id` 純 ID（由 `claim-helper.ts` 生成；含 timestamp + random + hostname 片段）
- `expected_paths` 是這個 session 預期會碰的檔案 glob（可空，越精確越好）。**實務上幾乎恆為 `[]`** —— 所以讀 claim 的那一側 **MUST** 走 § 3.3 的導出值，**NEVER** 只讀這個欄位就下「這棵樹沒碰任何檔」的結論
- `work_id` 是這個 session 正在執行的 flow work item。由 `writeClaim()` 從 ambient `CLADE_WORK_ID` 自動帶入 —— **NEVER** 改成要每個呼叫端記得傳：`expected_paths` 就是那樣變成全空的。舊 claim 沒有這個欄位是正常態，讀側 **NEVER** 把它當必填
- `expires_at` = `last_heartbeat + 24h`；過期 claim 視為失活，prune 階段會自動刪

## 2. Claim 寫 / refresh / drop 時機

下表的 CLI lifecycle 與已實作 Claude hook 接線分開判讀；事件名稱、handler 存在與其他產品已接入不是同一件事。各 runtime 的實際寫入證據依 § 6 與對應 adapter，未接入時保持未驗。

| 時機 | 動作 | 由誰 |
|---|---|---|
| `wt-helper add <slug> --task-summary <text>` 開 worktree | 寫 claim（`--task-summary` 必填） | `wt-helper.ts` |
| AI session 啟動 in worktree | refresh `last_heartbeat` + `expires_at` | SessionStart hook `session-start-claim-heartbeat.sh` |
| **每次 Edit / Write 寫檔**（throttle ≥5 分鐘） | refresh `last_heartbeat` + `expires_at` | PostToolUse hook `post-tool-ownership-journal.sh` |
| `wt-helper cleanup <slug>` | drop claim | `wt-helper.ts` |
| merge-back 的來源 lifecycle | 只有實際 cleanup 成功才 drop；squash／staging 成功不證明來源已回收 | `wt-helper.ts` 的 cleanup receipt |
| 過期超過 24h | prune | `claim-helper.ts prune`（手動 / cron） |

**heartbeat 的寫者 MUST 是 hook，NEVER 是 model**（SessionStart 只證明開過，PostToolUse 才證明還在推進；由 model 記得 refresh 的欄位不會被維護）。

主線 session（**非** worktree）**不自動寫** claim — 主線預設可動全部，是 worktree session 需要宣告「我擁有這條 branch + 這些 paths」。

### 主線無 claim 的保護缺口

主線在 main 累積的 dirty 對別 session 是 unclaimed（`otherSession` guard 看不到）。緩解：`wt-helper add` 的 stash strategy **預設完全不 capture** main dirty；要帶 main WIP 必須**顯式** `--include-unrelated-dirty` 或 `--baseline-scope-paths`（[[pitfall-prefork-baseline-stash-sweeps-unclaimed-main-work]]）。

**SHOULD**：主線在 main 累積會跨多個 tool-call 才 commit 的 batch 時，寫一個 coarse claim 涵蓋當前 dirty paths：

```bash
node scripts/claim-helper.ts add --change-id main-session-wip \
  --branch main --worktree-path "$(pwd)" \
  --expected-paths "$(git status --porcelain | awk '{print $2}' | paste -sd, -)"
```

完成後 `claim-helper.ts drop <session-id>`。**不自動化**——自動 claim 整個 `git status` 會讓別 session 在任何路徑重疊時被誤擋。主要 incident vector 由機制層覆蓋（merge-back claim-guard、propagate 時的 `scripts/audit-shared-tree-safety.ts`）。

## 3. 誰讀 claim

**MUST** 任何「即將動 working tree」的工具（stash / bulk commit / 投影寫入）都走 `claim-helper.ts` 的 `classifyDirtyPaths()` 判所有權，**NEVER** 各自重寫一份路徑比對。

判準只有三分類，讀法固定：

| 分類 | 意義 | 允許的動作 |
| --- | --- | --- |
| `locked` | clade 投影層 | 依各工具既有投影規則處理 |
| `otherSession` | 命中別 session active claim | **NEVER** 掃進 bulk stash / commit。fail-loud 指名 session_id |
| `other` | **無 claim 覆蓋 = 擁有者未知** | **NEVER** 讀成「是我的、可以掃」。主線 session 不寫 claim（§2 刻意如此），user WIP 全部落在這裡 |

第三列是最容易誤讀的一列 —— `other` 為空不代表安全，只代表沒有人宣告過。

### 3.1 `other` 的三分類（寫入時證據）

`other` 把「有人正在寫」與「寫的人早就死了」塌成同一格，gate 只能盲等。`classifyDirtyPaths()` 因此**在 `other` 之外**額外回三個陣列（`other` 內容不變，舊呼叫端行為不變）：

| 分類 | 證據 | 允許的動作 |
| --- | --- | --- |
| `other-live` | journal 記到寫入者，且**兩個存活訊號任一說活著** | 等待**只准對這一類成立**。有 pane 就先 `herdr agent prompt` 談，per [[clade-role-and-todo-discipline]]。**NEVER** 代它 stash / commit |
| `orphan` | journal 記到寫入者，且**兩個訊號都說死** | **NEVER 盲等**。轉 adjudicate：自己 `git commit --only -- <path>` 落地或 stash |
| `unknown` | journal 沒有這個檔，或兩個訊號**沒有同時成立死亡** | 承接 `other` 今天的**全部**禁令。**NEVER sweep**、**NEVER** 讀成 `orphan` |

**判死 MUST 兩個獨立訊號同時缺席**，只缺一個一律 `unknown`。兩個訊號逐字是：

| 訊號 | 證據 | 取不到時 |
| --- | --- | --- |
| process | `/proc/<pid>` 存在 ∧ `stat` 第 22 欄 starttime 與 journal 記的 `pid_start` 吻合（**pid 會被重用，單看 pid 不算**） | `null`（非 Linux / 沒記 pid） |
| session presence | `herdr agent list` 的 `agent_session.value` 仍列出該 `session_id` —— 與 journal 的 `session_id` 是**同一個** harness id，可直接比對 | `null`（`HERDR_ENV != 1` / `herdr` 不可達） |

**任一訊號說活著就是 `other-live`**；兩個都說死才是 `orphan`；其餘全部 `unknown`（hook 是 fail-open，單靠證據缺席會把「hook 壞了」誤讀成「全員陣亡」）。

- **NEVER** 拿「unknown 太多、gate 太吵」當理由改成單訊號判死或放寬 `unknown` 的禁令；也 **NEVER** 為了湊出 `orphan` 偽造 session 清單（它是參數不是環境變數）。Bash / Codex / 人手寫的檔常駐在 `unknown`
- **session presence 比對的是 session id，NEVER 是 pane**（pane 會被下一棒接手）

### 3.3 `expected_paths` 由 journal 導出

`expected_paths` 不會被維護（`otherSession` 恆為空、guard 恆放行），而開 worktree 時也還不知道會改哪些檔，所以方向是**導出**不是宣告：`derivedClaimPaths()` 把 journal 裡屬於該 worktree 的寫入路徑 join 回 claim，每一列帶 `via: 'declared' | 'derived'`。

三條邊界，**NEVER** 放寬任何一條：

| 邊界 | 逐字 | 放寬會怎樣 |
| --- | --- | --- |
| join key 是 `worktree` | claim 的 `session_id` 由 `claim-helper.ts` 生成，journal 的來自 harness —— **兩個不同命名空間**，拿它比對永遠不相等 | 安靜回空陣列，而空陣列與「這棵樹什麼都沒寫」長得一模一樣 |
| 只有 `alive` 才導出 | 持有者 `orphan` / `unknown` 一律不導出，那些路徑回到 § 3.1 拿自己的 verdict 與證據 | TTL 未到期的死 claim 會把一批路徑鎖成 `otherSession`（永不可掃）—— 就是 § 3.1 要消滅的盲等從新的門走回來 |
| 導出排在 journal 查詢**之後** | main 的 dirty 檔若有自己的寫入時證據，那個人就是答案 | 別棵樹的同名相對路徑會蓋過去，把「我自己剛寫的檔」判成別人的 |

導出值**不回寫進 claim 檔**（derived 值落成 store 就是 drift 起點；journal 是唯一新增的寫入面）。

### 3.2 Provenance journal

`.clade/ownership/journal.jsonl`，每行一次寫入：`{ts, path, worktree, session_id, pane_id, cwd, tool, pid, pid_start, attribution}`。
已實作的寫入入口是 Claude PostToolUse hook `post-tool-ownership-journal.sh`（Edit / Write / NotebookEdit / Bash）；其他 runtime 須提供同等真實事件的 adapter 接線與落檔證據，不能用主線自報補成 provenance。

**兩種證據等級，`attribution` 欄分辨**：

| `attribution` | 怎麼來 | 可信度 |
| --- | --- | --- |
| `hook` | harness 在 payload 裡直接給路徑（Edit / Write / NotebookEdit） | 強 —— model 動不了 |
| `mtime-diff` | Bash：PreToolUse `pre-bash-ownership-stamp.sh` 開時間窗，post hook 只收 mtime 落在窗內的 dirty 路徑——掃 cwd 的樹，外加命令字串**明確提及**的樹（絕對路徑、`~/`、`-C` / `cd` / `--git-dir` / `--work-tree` 的值，不做 glob 展開，最多 8 棵）；別棵樹的列寫進**那棵樹 consumer** 的 journal（TD-734） | 較弱 —— 窗內別 session 的併發寫入（含被提及那棵樹裡的）會被記成我的 |

- **NEVER 解析 Bash command 字串推「哪個檔是我寫的」**：命令字串只用來選樹，檔一律由時間窗決定。也 **NEVER** 把選樹擴成「掃所有已知 consumer／所有 worktree」，**NEVER** 在拿不到 stamp 時退化成「掃 `git status` 把所有 dirty 記成本 session 的」——沒有 stamp 就整段不記
- `mtime-diff` 列 **NEVER** 讀成與 `hook` 同級
- **`session_id` MUST 取自 harness 的 hook input JSON，NEVER 由 model 自報**
- **`path` 相對 `worktree`**（main 與所有 linked worktree 共寫一份 journal），**NEVER** 拿掉 `worktree` 欄位
- **NEVER 把 verdict 回寫成 store**

查詢入口：`node vendor/scripts/flow/flow.ts who [--json] [--session <id>]` ——
一行一資源（dirty path / worktree / stash），含 verdict 與具名 `action`（沿用 `stall.ts` 的 action 契約）。
任何一列不屬於自己時 exit 3，與 `flow status --stalled` / `herdr-patrol` 同慣例。

| 讀者 | 用途 |
|---|---|
| `scripts/publish.ts` (clade) | 跨 consumer scan，warn 「別 session 還活著」；`ensureCleanOrAutoStash` 在**所有** dirty 分支之前跑 `classifyDirtyPaths`，`otherSession` 非空即 fail-loud |
| `scripts/propagate.ts` (clade) | per-consumer warn 同上 |
| `wt-helper.ts merge-back` | Phase 3 audit：偵測「main dirty 屬於別 session 路徑」 |
| `/commit` skill（走 [[commit]]） | Phase 4 partition：別 session 路徑 fail-closed |
| `wt-helper.ts` stash namespace | Phase 7：stash slug 帶 session_id |
| `flow who` / `herdr-patrol` | 人與 agent 查「現在誰持有什麼」的同一份 JSON |

### 3.4 動筆之前的消費端

`claimConflictsForPath()` 回答「別人的活 claim 已經涵蓋這個檔了嗎」。Claude 消費端是 PreToolUse hook `pre-edit-claim-conflict.sh`（`Edit|Write`），命中才遞**一行**；其他 runtime 的 edit-time adapter 須逐入口證明已接入。沒有這個讀取端時持有者只能廣播，所以 **NEVER 把那個廣播記成紀律問題**。

三條，**NEVER 放寬任何一條**：

| 邊界 | 逐字 | 放寬會怎樣 |
| --- | --- | --- |
| 只有 `declared` 與 `derived-hook` 出聲 | journal 的 `mtime-diff` 列 **NEVER** 用來出聲 | clade 自身 journal 實測（2026-08-29，1748 列）：可由 `hook` 列裁決的 `mtime-diff` 有 87.5% 歸錯 session。一個大多時候是錯的告警會訓練所有人跳過它，連同少數真陽性一起丟掉 |
| 文案 MUST 帶 `via` | `[via=declared]`（有人說會碰）與 `[via=derived-hook]`（有人確實碰過）要看得出差別 | 兩者要的答案不同——宣告會過期，寫入不會 |
| 無命中 = 零輸出、exit 0 | 沒有「查過了，沒事」這種訊息 | 無事發生時仍要人讀一段字，就是同一個廣播換個地方發 |

**NEVER 用「提高召回」當理由把 `mtime-diff` 收進來**——實測它大多歸錯 session；要改善召回就修上游（讓 Bash 寫入說得出路徑）。**NEVER 讓 hook 補 `permissionDecision`**（爭用的正解是兩個 session 談），也 **NEVER** 在命中時塞整段來源溯及。導出值一律不回寫（`test/claim-conflict-consumer.test.ts` 釘住）。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 目標路徑落在別人活 claim 的 `declared` 或 `derived-hook` 範圍內 → 遞一行（最多 3 行）。**warn-only，NEVER block** |
| 消費端 | 正要 Edit / Write 的那個 agent（本節）；`wt-helper add` 開樹時對宣告範圍做同一查詢 |
| 載入路徑 | 本節（`rules/core/session-claims.md`，paths-gated 於 `.clade/claims/**`、`vendor/scripts/claim-helper.ts`、`capabilities/core/hooks/pre-edit-claim-conflict.sh`） |

## 3.5 接手別人留下的工作之前 MUST 先 claim

`HANDOFF.md` 與 `ROADMAP.md` 都是可讀狀態，但真正避免撞工的是**可機器寫入的 claim**。
下列**每一種**情況都 MUST 先建立或更新 claim，不是只有「看起來會撞到」的那些：

- 接手 `HANDOFF.md` 裡的項目
- 新 session 決定繼續某個還在跑的 work item（per [[flow-work-tracking]]）
- 使用者明確把某件工作指派給你
- 你要開始修改某個 work item 的 carrier（`tasks/<date>-<slug>.md` 或 `specs/plans/NNN-<slug>/`）或它的實作檔

順序固定：`claim-helper.ts add` 成立 → 才從 `HANDOFF.md` 移除該項目 → 才開始做。
**不是「讀了就刪」**，而是**「claim 已成立後再刪」**。工作完成、交棒或放棄時 `claim-helper.ts drop`。

- **NEVER** 在沒有 claim 的狀況下開始接手別人留下的工作
- **NEVER** 看到過期 claim 就直接無聲接管——過期只代表 awareness 訊號失活，處置照 § 3.1 的三分類走
- **NEVER** 把 `ROADMAP.md` 或 `HANDOFF.md` 當成 claim 的替代品；claim 才是 ownership ground truth

## 4. 儲存與 gitignore

- 位置：consumer-local `.clade/claims/<session-id>.json`
- 整個 `.clade/claims/` 子目錄被 `.clade/claims/.gitignore`（內含 `*`）shadow，**永遠不會** commit 進 repo
- per-machine state；不同機器之間不共享 claim

## 5. Stale claim 處理

- 過期 claim（`expires_at` < now）視為失活
- `claim-helper.ts prune` 手動清理
- 若 worktree 仍存在但 claim 過期 → 先確認 § 6 的 heartbeat handler 是否有實際寫入；過期只表示 awareness 訊號失活，不構成接管 worktree 或 WIP 的授權。

## 6. Agent-agnostic

所有 runtime 共用 `claim-helper.ts` 的 claim 契約；原生事件支援與 heartbeat handler 的接入、實際寫入分開驗證（只驗到事件通道不等於 handler 已接入，見 clade `docs/runtime-hooks.md`）。沒有寫入證據時 heartbeat 覆蓋標為未驗，缺證據維持 unknown，不因 claim 過期接管他人的工作。新增 adapter 時保留原生 runtime／session identity。

## 7. 失敗模式（fail-open）

任何 claim 讀寫失敗**永遠不 block** publish / propagate / merge-back / commit。Claim 是 awareness signal，不是 enforcement gate（enforcement 由 Phase 3 audit 提供，仍可選擇 fail-closed）。

## 8. CLI

```
node scripts/claim-helper.ts list               # 列當前 consumer 活躍 claim
node scripts/claim-helper.ts list --all         # 含過期
node scripts/claim-helper.ts add --change-id <slug> --branch <branch> --worktree-path <path> --expected-paths "a/**,b/**"
node scripts/claim-helper.ts refresh <session-id>
node scripts/claim-helper.ts refresh-by-cwd     # 由 SessionStart hook 跑
node scripts/claim-helper.ts drop <session-id>
node scripts/claim-helper.ts prune              # 清過期
node scripts/claim-helper.ts conflicts <repo-relative-path> [--worktree <abs>] [--json]
                                                # 動筆前的一路徑查詢（§ 3.4）。exit 3 = 有衝突，
                                                # 0 = 沒有。3 而不是 1：查詢失敗與查到衝突
                                                # NEVER 共用一個 exit code
```

`add` 另接 `--work-id <id>`；不給就吃 ambient `CLADE_WORK_ID`。
