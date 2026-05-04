<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-routing.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Agent / model routing 規則——某些工作必須 handoff 到指定的 runtime + model，而不是在當前 agent / model 直接執行
globs: ['**/*']
---

# Agent Routing

**核心命題**：不是所有工作都該由當前 agent / model 直接做。當某類工作交給另一個 runtime + model 組合的成本/品質明顯更好時，必須 handoff 而不是硬幹。

此規則優先於個別 skill 內嵌的工具呼叫指示。

## Routing Table

| 工作類別 | 由誰執行 | 為什麼 |
| --- | --- | --- |
| **Web search**（網頁搜尋、即時資料、外部資訊查詢） | **Codex（GPT-5.5 medium）** | 搜尋型查詢適合中等思考預算 + Codex 的搜尋整合；不浪費 Claude Code 的 context 與 token。 |
| **Code review（commit 0-A）** | **Codex（`codex review --uncommitted`，GPT-5.5；最多 2 輪：Round 1 = `high` → Round 2 = `xhigh`）** | code review 適合 codex CLI 的 diff-aware 機制 + 漸進加深 reasoning；改由 codex 統一執行 review、Claude Code 主線負責修。詳見 `.claude/commands/commit.md` Step 0-A（consumer 端由 plugin loader 載入）。 |
| **Spectra `propose` 階段**（discuss → propose 銜接） | **使用者選擇 A. Codex GPT-5.5 xhigh / B. Claude Code 繼續做** | propose 牽涉抽象決策、需高思考預算；給使用者選擇權。詳見 `spectra-propose` Step 0 與 `ux-completeness.md` Workflow Integration。 |

## Codex 派工的標準流程（所有 routing 共用）

派 Codex 出去工作**一律走原生 `codex` CLI + background bash**——**禁止**任何 `codex:rescue` / `codex:setup` / `codex:codex-rescue` plugin 路線（已驗證無法使用）。

主線 Claude 自己派、自己等通知、自己讀檔回報，**禁止**叫使用者切到 Codex CLI、**禁止**「Stop here」純文字 handoff。

模板：

1. 用 **Write** 把指示寫到 `/tmp/codex-<topic>-<slug>-prompt.md`（prompt 太長不要 inline）
2. **Bash** tool（`run_in_background=true`）：

   ```bash
   cd <cwd> && codex exec \
     --model gpt-5.5 \
     --dangerously-bypass-approvals-and-sandbox \
     --skip-git-repo-check \
     -c model_reasoning_effort=<medium|high|xhigh> \
     < /tmp/codex-<topic>-<slug>-prompt.md 2>&1
   ```

   > ⚠️ `--dangerously-bypass-approvals-and-sandbox` 在背景非互動 codex 是**必要**的，不是偷懶 — codex `exec` 沒人可批准時，sandbox 為非 `danger-full-access` 的 MCP tool call 全部會被自動回 `user cancelled`（codebase-memory-mcp 等都會死）。Codex 官方文檔 `agent-approvals-security` 把這個 flag 與 `-s danger-full-access` 並列為「非互動信任環境」的標準寫法。**禁止**把它換回 `-s read-only` / `-s workspace-write` — 那會讓 codex 失去 MCP 能力（`approval_mode = "auto"` 在 `mcp_servers.*` 不是合法 codex config key，無法作為替代）。

3. 立刻簡短回報 bash job ID 給使用者
4. 立刻啟動 **Codex Watch Protocol**（見下節）— **MUST** `ScheduleWakeup` 第一次進度檢查，**禁止**只乾等 `<task-notification>`
5. 收到 `<task-notification> status=completed` → 立刻 BashOutput 讀 stdout → 整理結果回報；watch loop 自然終止
6. **NEVER** 沉默等使用者來問進度

各 routing 的參數差異：

| Routing | `<topic>` | `<cwd>` | reasoning effort | 預期動作 |
| --- | --- | --- | --- | --- |
| WebSearch | `websearch` | `/tmp` | `medium` | 純讀（搜尋網頁/查文件） |
| Spectra propose（A 路徑） | `spectra-propose` | consumer repo root | `xhigh` | 寫 spec/proposal 到 `openspec/changes/<change>/` |

> sandbox flag 統一使用 `--dangerously-bypass-approvals-and-sandbox`，不再分 `-s read-only` / `-s workspace-write`（在背景 codex 會擋 MCP）。「預期動作」由主線在 prompt 內陳述，靠 codex 自律。

## Codex Watch Protocol（防止主線乾等與卡住盲區）

**核心命題**：派出 codex 後**主線不能單純等 `<task-notification>`**。codex 中途可能 `fetch failed`、sandbox 拒絕、互動 prompt、或長時間靜默；若沒有監看，主線完全不知道進度，使用者也只能空等。

### 監看排程

| 時機 | 動作 |
| --- | --- |
| 派出 background bash 後**立刻** | `ScheduleWakeup(180, "codex <topic> <slug> 首次進度檢查")` |
| 每次 wakeup（系統自動觸發） | 1) 若已收到 `<task-notification status=completed>` → 走既有結束流程，**不再 wakeup**；2) 否則 BashOutput 讀 tail（≤200 行） → 套用「健康判斷」 → 決定下次 wakeup 間隔 |
| 累計 wakeup ≥ 30 min 仍未完成 | **MUST** 用 `AskUserQuestion` 給使用者 [1] 繼續等 N 分 / [2] kill jobId 重派 / [3] 中止 — **禁止**自行決定 |

### 健康判斷（每次 wakeup 必跑）

讀 BashOutput tail，依末尾訊號決定下一步：

| 訊號 | 判定 | 下次 wakeup |
| --- | --- | --- |
| 末尾持續有新 `exec` 行、`succeeded in`、`tokens used` 或 diff 輸出 | 健康 | `600` 秒（10 分，跨一次 cache TTL，可接受） |
| 末尾出現 `Codex Report` 或 `tokens used:` 後無新行 | 即將完成 | `60` 秒（cache 內，便宜） |
| 末尾 60s+ 無新輸出（看 BashOutput timestamp） | 輕度可疑 | `120` 秒；連續兩次無輸出 → 視為卡住，跳「介入觸發」 |
| 末尾出現 `fetch failed` / `sandbox: rejected` / `Permission denied` / `EACCES` / 認證失敗 | 阻塞 | **立刻**跳「介入觸發」，不再 wakeup |
| 末尾出現互動 prompt（`Continue?`、`y/N`、`Press Enter`、`waiting for input`） | 異常（codex sandbox 不該有） | **立刻**跳「介入觸發」 |
| codex 自我宣告 blocker（「無法繼續」「需要使用者決定」「missing context」等） | 阻塞 | **立刻**跳「介入觸發」 |

### 介入觸發（用 AskUserQuestion）

偵測到阻塞或卡住時，**MUST** 立刻向使用者開問題，**禁止**自行 kill 或調整 prompt：

```
codex 跑了 N 分鐘，目前狀態：<一句話卡點>

末尾輸出（≤10 行）：
<tail>

要怎麼處理？
[1] 繼續等 N 分 — 主線再 wakeup 看一次
[2] kill <jobId> 後重派（請告知 prompt 要怎麼調整）
[3] 直接中止
```

選項數量與內容可依情境調整，但**必須**包含至少 [繼續等 / kill 重派 / 中止] 三類其中兩類。

### `ScheduleWakeup` 用法守則

`delaySeconds` 遵守 prompt-cache TTL（300s 是 worst-of-both）：

| 情境 | 建議值 |
| --- | --- |
| 健康、跨 cache 一次性可接受 | `600`–`900`（10–15 分） |
| 即將完成 / 等通知收尾 | `60`–`120`（cache 內） |
| 輕度可疑、要近距離觀察 | `120`–`180` |

**禁止** `< 60`（runtime clamp 也會擋）或 `> 1800`（跨多次 TTL，偵測太遲）。

`reason` 欄位**必須**具體：例如「kiosk-multilingual codex 進度檢查（已派出 3 分）」，**NEVER** 寫「waiting」「monitoring codex」這種空泛字眼。

### 與「不要把工作往後放」禁令的關係

全域 CLAUDE.md 規定**禁止**把工作排到未來（不主動推薦 `/schedule`、`/loop`、「N 週後再做」）。本 protocol 的 `ScheduleWakeup` 屬於**主動監看**，不是延後工作 — 它存在的目的是**縮短**「主線發現問題的時間」，不是把責任往後推。兩者方向相反，**不衝突**。

判別準則：

- 合法用途 → 派出 background job 後監看其進度、卡住偵測、收尾通知
- 仍禁止 → 把當下可處理的事推遲到未來、為「等使用者反應」排 follow-up、用 schedule 填充看似貼心的提醒

### 監看期間的紀律

- **NEVER** 在 wakeup loop 中跑與監看無關的探索動作（grep / 額外 Read / 開新 subagent）— 監看就是監看
- **NEVER** 在 watch 中途自行決定殺掉 / 重派 codex — 必須先 AskUserQuestion
- **NEVER** 看到健康訊號就提早終止 watch loop（例如「應該快好了」直接放著） — 必須跑到收到 `<task-notification>` 為止
- **MUST** 收到 `<task-notification>` 後**不再** ScheduleWakeup（否則 wakeup 會在 codex 已結束後重複觸發）

## WebSearch Handoff（具體做法）

Claude Code session 內偵測到「需要 WebSearch」時：

1. **NEVER** 直接呼叫 Claude Code 內建的 `WebSearch` 工具
2. **MUST** 走「Codex 派工的標準流程」（見上節），參數：`<topic>=websearch`、`<cwd>=/tmp`、`-c model_reasoning_effort=medium`（sandbox flag 已統一在模板內）
3. prompt 內容固定包含：要查的問題 + 期望輸出格式（連結 / 摘要 / 條列重點）

### 例外（仍可在當前 session 直接處理）

- **本機檔案 / 已下載文件**內容查詢——用 Read / Grep 即可，不算 web search
- **使用者明確要求** 「直接用 WebSearch」——尊重使用者指令
- **Codex 本身就是當前 runtime**——已經在對的位置，不需要 handoff
- **`WebFetch` 抓單一已知 URL**——這是抓取，不是搜尋；可直接做

## 為什麼集中寫在這

- 跨 skill / 跨情境的 routing 規則散落在各 SKILL.md 會漂移
- 集中一處方便加新 routing rule（例如未來 image gen / long-doc summary 的最佳 runtime）
- consumer 端 `.claude/rules/agent-routing.md` 帶 `🔒 LOCKED` banner，**禁止**本地 override

## 必禁事項

- **NEVER** 在 Claude Code session 直接呼叫 `WebSearch` 工具（改派背景 codex GPT-5.5 medium）
- **NEVER** 印「請開啟 Codex CLI」「Stop here」「請貼 prompt」這類純文字 handoff 訊息要使用者手動切 — 主線必須自己派背景 codex
- **NEVER** 嘗試 `codex:rescue` / `codex:setup` plugin 路線（已驗證無法使用，2026-04-29 已 uninstall + 全清；`/assign` skill 也已於 2026-05-02 移除）
- **NEVER** 沉默等使用者問進度；收到 `<task-notification> status=completed` 必須立刻自己讀檔回報
- **NEVER** 派出 codex 後不啟動 Codex Watch Protocol — 「乾等盲區」是已驗證會吃使用者體驗的根因
- **NEVER** 偵測到 `fetch failed` / sandbox 拒絕 / 互動 prompt 還繼續 wakeup — 必須立刻 `AskUserQuestion` 介入
- **NEVER** 在 watch loop 中跑與監看無關的工作（grep、Read、subagent）— 監看純粹只看進度
- **NEVER** 在 Spectra discuss → propose 銜接點省略 A/B 詢問（除非 discuss 已明示選擇並標記）
- **NEVER** 在 commit 0-A 用 `simplify` skill / `code-review` agent 自行 review（改派 codex），也 **NEVER** 改用其他模型或顛倒兩輪 reasoning effort
- **NEVER** 把 routing 例外寫死在個別 skill；要加例外請改本檔的 Routing Table
