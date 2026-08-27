---
description: 多 session 並行下「哪些路徑屬於別 session 還活著的工作」的判定規格——claim 檔 schema、寫 / refresh / drop 時機、誰讀、stale 處理、claim-helper CLI，以及 ownership provenance journal 的寫入時證據與 other-live / orphan / unknown 三分類
paths: ['.clade/claims/**', 'plugins/hub-core/hooks/pre-bash-ownership-stamp.sh', 'scripts/claim-helper.ts', 'scripts/spectra-advanced/claim*.ts', 'scripts/spectra-advanced/claims-lib.ts', 'scripts/spectra-advanced/release-work.ts', 'vendor/scripts/claim-helper.ts', 'vendor/scripts/ownership-journal.ts', 'vendor/scripts/flow/who.ts', '.clade/ownership/**', 'plugins/hub-core/hooks/post-tool-ownership-journal.sh', 'vendor/scripts/spectra-advanced/claim*.ts', 'vendor/scripts/spectra-advanced/claims-lib.ts', 'vendor/scripts/spectra-advanced/release-work.ts']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/session-claims.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Session Claims

> 多 session AI 並行開發時，主線（publish / propagate / `/commit` / `wt-helper merge-back` / 別 session 的工作）需要知道「**哪些路徑屬於別 session 還活著的工作**」，避免誤殺別 session WIP、做出錯誤 commit 分組、或把 active session 的 worktree 當成可清理的 stale state。

## 1. 什麼是 claim

每個活躍的 AI session（Claude Code 或 Codex）在 worktree 開出來時，會在 consumer 的 `.clade/claims/<session-id>.json` 寫一份 claim 檔。Schema：

```json
{
  "session_id": "...",
  "agent": "claude-code|codex",
  "started_at": "<iso>",
  "consumer": "<consumer-b>",
  "worktree_path": "/Users/.../<consumer>-wt/<slug>",
  "branch": "session/<date>-<slug>",
  "change_id": "<slug>",
  "expected_paths": ["server/api/foo/**", "layers/bar/**"],
  "last_heartbeat": "<iso>",
  "expires_at": "<iso, started+24h>"
}
```

- `session_id` 純 ID（由 `claim-helper.ts` 生成；含 timestamp + random + hostname 片段）
- `expected_paths` 是這個 session 預期會碰的檔案 glob（可空，越精確越好）。**實測恆為 `[]`** —— 所以讀 claim 的那一側 **MUST** 走 § 3.3 的導出值，**NEVER** 只讀這個欄位就下「這棵樹沒碰任何檔」的結論
- `expires_at` = `last_heartbeat + 24h`；過期 claim 視為失活，prune 階段會自動刪

## 2. Claim 寫 / refresh / drop 時機

| 時機 | 動作 | 由誰 |
|---|---|---|
| `wt-helper add <slug> --task-summary <text>` 開 worktree | 寫 claim（`--task-summary` 必填，TD-664 Phase 4） | `wt-helper.ts` |
| AI session 啟動 in worktree | refresh `last_heartbeat` + `expires_at` | SessionStart hook `session-start-claim-heartbeat.sh` |
| **每次 Edit / Write 寫檔**（throttle ≥5 分鐘） | refresh `last_heartbeat` + `expires_at` | PostToolUse hook `post-tool-ownership-journal.sh`（TD-664 Phase 2） |
| `wt-helper cleanup <slug>` | drop claim | `wt-helper.ts` |
| `wt-helper merge-back <slug>` 成功 | drop claim（透過 cmdCleanup 轉發） | `wt-helper.ts` |
| 過期超過 24h | prune | `claim-helper.ts prune`（手動 / cron） |

**heartbeat 的寫者 MUST 是 hook，NEVER 是 model。** SessionStart 那列只證明「這個 session 開過」，
所以在它是唯一寫者的期間，`last_heartbeat` 實測恆等於 `started_at`（17 個 claim 檔全數如此）——
量到的是開機時刻，不是「還在推進」。PostToolUse 那列量的才是後者。**NEVER** 改成由 model 記得去
呼叫 `claim-helper refresh`：那讓它退回宣告型欄位，而宣告型欄位不被維護正是 TD-664 的前提本身。

主線 session（**非** worktree）目前**不自動寫** claim — 主線預設可動全部，是 worktree session 需要宣告「我擁有這條 branch + 這些 paths」。

### ⚠️ 主線無 claim 的保護缺口（pitfall 2026-06-01）

主線不寫 claim 有一個**已實證的危害**：主線在 main working tree 累積的 dirty（典型：archive batch 等 commit、跨多步的 in-flight 工作）對**別 session 的 `wt-helper add --baseline-strategy stash`** 是「unclaimed」→ pre-fork claim guard 的 `otherSession` STOP **看不到** → 被 bulk-stash 捲走（見 `docs/pitfalls/2026-06-01-prefork-baseline-stash-sweeps-unclaimed-main-work.md`）。

**現有緩解（已落地，P1 / TD-181，commit `b75667fb`）**：`wt-helper.ts` cmdAdd 的 stash strategy **預設完全不 capture** main dirty（留 main 原封不動、worktree fork clean from HEAD）。要把 main WIP 帶進 worktree 必須**顯式** `--include-unrelated-dirty`（bulk 全帶）或 `--baseline-scope-paths`（scoped，走 commit strategy）。原 incident 路徑（stash strategy silent bulk-capture）已從**工具層**消除。

**SHOULD（治本，pending 自動化）**：主線 / 長駐 session 在 main 累積 dirty（尤其是會跨多個 tool-call 才 commit 的 batch）時，**SHOULD** 寫一個 coarse claim 涵蓋當前 dirty paths，讓既有 `otherSession` guard 直接保護：

```bash
node scripts/claim-helper.ts add --change-id main-session-wip \
  --branch main --worktree-path "$(pwd)" \
  --expected-paths "$(git status --porcelain | awk '{print $2}' | paste -sd, -)"
```

完成 / commit 後 `claim-helper.ts drop <session-id>`。**自動觸發機制**（main session 累積 dirty 時自動 claim + commit 後自動 drop）經評估 **reject-by-design**（2026-06-12）：clade home main tree 經常 dirty（多 session / propagate 投影寫入 / 跨 tool-call WIP），auto-claim 整個 `git status` 快照會讓**每個**別 session 的 `wt-helper add --precheck-baseline` / `merge-back --auto-stash` 在任何路徑重疊時 `otherSession` STOP → 持續誤擋合法 fork；對 shared trunk 而言過度封鎖比偶發 WIP loss 更糟。主要 incident vector 已被機制層覆蓋（P1 default-no-capture / merge-back TD-175 claim-guard / `scripts/audit-shared-tree-safety.ts`）。**手動 coarse claim 是「主線跨多步累積大 batch」這種刻意、罕見場景的標準逃生口**，其非自動化是可接受的。

## 3. 誰讀 claim

**MUST** 任何「即將動 working tree」的工具（stash / bulk commit / 投影寫入）都走 `claim-helper.ts` 的 `classifyDirtyPaths()` 判所有權，**NEVER** 各自重寫一份路徑比對。這條是 TD-435 的結論：同型失敗累積 7 條 high severity pitfall，每條的 mitigation 都只綁住當時那一條寫入路徑，於是每開一條新路徑就重踩一次。

判準只有三分類，讀法固定：

| 分類 | 意義 | 允許的動作 |
| --- | --- | --- |
| `locked` | clade 投影層 | 依各工具既有投影規則處理 |
| `otherSession` | 命中別 session active claim | **NEVER** 掃進 bulk stash / commit。fail-loud 指名 session_id |
| `other` | **無 claim 覆蓋 = 擁有者未知** | **NEVER** 讀成「是我的、可以掃」。主線 session 不寫 claim（§2 刻意如此），user WIP 全部落在這裡 |

第三列是最容易誤讀的一列 —— `other` 為空不代表安全，只代表沒有人宣告過。

### 3.1 `other` 的三分類（TD-664，寫入時證據）

`other` 把兩個相反的處境塌縮成同一個字：「有人**現在正在**寫它」與「寫它的人**早就死了**」。
於是讀的人只能對兩者採同一種行為 —— 而那兩種處境該做的事正好相反。2026-08-26 實測代價：
publish 的 gate 對一個已經 commit 完並退出的持有者盲等（gate 自己的措辭是「最多 90 分鐘」），
三個 session 互等約兩小時。

`classifyDirtyPaths()` 因此**在 `other` 之外**額外回三個陣列。`other` 內容一個不少，
四個既有呼叫端一行不改就沿用今天的保守行為；要停止盲等的呼叫端才讀新欄位。

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

**任一訊號說活著就是 `other-live`**；兩個都說死才是 `orphan`；其餘全部 `unknown`。
成因：provenance hook 是 fail-open 的，**單靠證據缺席會把「hook 壞了」誤讀成「全員陣亡」**
—— 而那個誤讀的方向正好是會 sweep 掉別人 WIP 的方向。

**不在 Herdr 裡跑的 session 會讓 `unknown` 變多**（第二個訊號整個取不到，process 已死的檔
一律降級成 `unknown`）。那是**正確的保守方向**，**NEVER** 拿「unknown 太多、gate 太吵」
當理由改成單訊號判死，也 **NEVER** 為了湊出 `orphan` 去偽造 session 清單 —— 在
`classifyDirtyPaths` / `buildWhoRows` 上，live session 清單是**參數**不是環境變數，
正是為了讓「扣住某個 session 以製造 orphan」做不到。

**session presence 比對的是 session id，NEVER 是 pane。** pane 會被下一棒接手、terminal title
會繼承上一棒 —— 那兩個正是本條要停止依賴的四個不可信訊號中的兩個。

**`unknown` 不是暫時狀態，是常駐的一大類**：Bash 寫的檔（`sed -i` / heredoc）、Codex 寫的檔
（沒有 PostToolUse hook）、人手改的、journal 上線前就存在的，全部落在這裡。
**NEVER** 因為「`unknown` 太多、判不出來很煩」就放寬它的禁令 —— 數量多正是它必須保守的理由。

### 3.3 `expected_paths` 由 journal 導出（TD-664 Phase 4）

`expected_paths` 是宣告型欄位，而本 TD 的整個前提是宣告型欄位不被維護：17 個 claim 全 `[]`。
後果不是「少一個欄位」，是 **`classifyDirtyPaths` 的 claim 比對永遠比不中，`otherSession`
恆為空、guard 恆放行**（2026-08-03 <consumer-a> 實證：3 個 active claim 的 `expected_paths` 全空，
88 條 unclaimed dirty 全數被 bulk-stash 捲走而 guard 零告警）。

`--task-summary` 那條用「改成必填」解決，**這條不能照抄**：開 worktree 的當下還不知道會改哪些檔。
所以方向是**導出**不是宣告 —— `derivedClaimPaths()` 把 journal 裡屬於該 worktree 的寫入路徑
join 回 claim，宣告值與導出值並存，每一列帶 `via: 'declared' | 'derived'`。

三條邊界，**NEVER** 放寬任何一條：

| 邊界 | 逐字 | 放寬會怎樣 |
| --- | --- | --- |
| join key 是 `worktree` | claim 的 `session_id` 由 `claim-helper.ts` 生成，journal 的來自 harness —— **兩個不同命名空間**，拿它比對永遠不相等 | 安靜回空陣列，而空陣列與「這棵樹什麼都沒寫」長得一模一樣 |
| 只有 `alive` 才導出 | 持有者 `orphan` / `unknown` 一律不導出，那些路徑回到 § 3.1 拿自己的 verdict 與證據 | TTL 未到期的死 claim 會把一批路徑鎖成 `otherSession`（永不可掃）—— 就是本 TD 要消滅的盲等從新的門走回來 |
| 導出排在 journal 查詢**之後** | main 的 dirty 檔若有自己的寫入時證據，那個人就是答案 | 別棵樹的同名相對路徑會蓋過去，把「我自己剛寫的檔」判成別人的 |

導出值**不回寫進 claim 檔**。verdict 與 derived 值落成 store 就是 drift 的起點（同
`flow/serve.ts` 的 READ-ONLY 鐵律）—— journal 仍是唯一新增的寫入面。

### 3.2 Provenance journal

`.clade/ownership/journal.jsonl`，每行一次寫入：`{ts, path, worktree, session_id, pane_id, cwd, tool, pid, pid_start, attribution}`。
唯一寫入者是 PostToolUse hook `post-tool-ownership-journal.sh`（Edit / Write / NotebookEdit / Bash）。

**兩種證據等級，`attribution` 欄分辨**：

| `attribution` | 怎麼來 | 可信度 |
| --- | --- | --- |
| `hook` | harness 在 payload 裡直接給路徑（Edit / Write / NotebookEdit） | 強 —— model 動不了 |
| `mtime-diff` | Bash：PreToolUse `pre-bash-ownership-stamp.sh` 開時間窗，post hook 只收 mtime 落在窗內的 dirty 路徑 | 較弱 —— 窗內別 session 的併發寫入會被記成我的 |

- **NEVER 解析 Bash command 字串推路徑**，也 **NEVER** 在拿不到 stamp 時退化成「掃 `git status`
  把所有 dirty 記成本 session 的」—— 後者把偶爾誤歸換成必定誤歸，正是 § 3.1 唯一會毀掉工作的方向。
  沒有 stamp 就整段不記
- `flow who` 對 `mtime-diff` 的列會在 action 裡明說證據較弱；**NEVER** 把它讀成與 `hook` 同級

- **`session_id` MUST 取自 harness 的 hook input JSON，NEVER 由 model 自報。** 本機制的全部價值
  就在於它是 model 動不了的證據；一旦可自報，它立刻退化成又一個宣告型欄位 —— 也就是本節要繞開的東西
- **`path` 相對 `worktree`，不是相對 consumer root。** 一個 consumer 一份 journal，main 與所有
  linked worktree 共寫，所以同一個相對路徑在兩棵樹裡是兩個檔。**NEVER** 拿掉 `worktree` 欄位
- **NEVER 把 verdict 回寫成 store** —— verdict 是 derived 值，落盤就是 drift 起點
  （同 `flow/serve.ts` 的 READ-ONLY 鐵律）。journal 是本機制唯一新增的寫入面，其餘全部 derived
- **NEVER 把 verdict 或 `unknown` 的處置寫死成「反正判不出來就當沒人要」** —— `unknown` 的禁令
  在 § 3.1，一行不放寬

查詢入口：`node vendor/scripts/flow/flow.ts who [--json] [--session <id>]` ——
一行一資源（dirty path / worktree / stash），含 verdict 與具名 `action`（沿用 `stall.ts` 的 action 契約）。
任何一列不屬於自己時 exit 3，與 `flow status --stalled` / `herdr-patrol` 同慣例。

| 讀者 | 用途 |
|---|---|
| `scripts/publish.ts` (clade) | 跨 consumer scan，warn 「別 session 還活著」；`ensureCleanOrAutoStash` 在**所有** dirty 分支之前跑 `classifyDirtyPaths`，`otherSession` 非空即 fail-loud |
| `scripts/propagate.ts` (clade) | per-consumer warn 同上 |
| `wt-helper.ts merge-back` | Phase 3 audit：偵測「main dirty 屬於別 session 路徑」 |
| `/commit` skill（走 [[commit]]；spectra-commit 已停用，不是替代路徑） | Phase 4 partition：別 session 路徑 fail-closed |
| `wt-helper.ts` stash namespace | Phase 7：stash slug 帶 session_id |
| `flow who` / `herdr-patrol` | 人與 agent 查「現在誰持有什麼」的同一份 JSON |

## 4. 儲存與 gitignore

- 位置：consumer-local `.clade/claims/<session-id>.json`
- 整個 `.clade/claims/` 子目錄被 `.clade/claims/.gitignore`（內含 `*`）shadow，**永遠不會** commit 進 repo
- per-machine state；不同機器之間不共享 claim

## 5. Stale claim 處理

- 過期 claim（`expires_at` < now）視為失活
- `claim-helper.ts prune` 手動清理
- 若 worktree 仍存在但 claim 過期 → session 可能跑得太久沒 refresh，下次 SessionStart 會自動補回；不影響 worktree 安全

## 6. Agent-agnostic

- Claude Code：靠 SessionStart hook 自動 refresh heartbeat
- Codex：目前**沒有等效 SessionStart hook**；fallback 路徑（未來）走 `bin/vp` PATH shim 或 git pre-commit adapter（per `rules/local/improvement-loop.md` 既有 pattern）
- 兩種 agent 都共用同一份 `claim-helper.ts` CLI

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
```
