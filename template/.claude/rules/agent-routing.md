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
     -s <read-only|workspace-write> \
     --skip-git-repo-check \
     -c model_reasoning_effort=<medium|high|xhigh> \
     < /tmp/codex-<topic>-<slug>-prompt.md 2>&1
   ```

3. 立刻簡短回報 bash job ID 給使用者
4. 收到 `<task-notification> status=completed` → 立刻 BashOutput 讀 stdout → 整理結果回報
5. **NEVER** 沉默等使用者來問進度

各 routing 的參數差異：

| Routing | `<topic>` | `<cwd>` | sandbox | reasoning effort |
| --- | --- | --- | --- | --- |
| WebSearch | `websearch` | `/tmp` | `read-only` | `medium` |
| Spectra propose（A 路徑） | `spectra-propose` | consumer repo root | `workspace-write` | `xhigh` |

## WebSearch Handoff（具體做法）

Claude Code session 內偵測到「需要 WebSearch」時：

1. **NEVER** 直接呼叫 Claude Code 內建的 `WebSearch` 工具
2. **MUST** 走「Codex 派工的標準流程」（見上節），參數：`<topic>=websearch`、`<cwd>=/tmp`、`-s read-only`、`-c model_reasoning_effort=medium`
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
- **NEVER** 在 Spectra discuss → propose 銜接點省略 A/B 詢問（除非 discuss 已明示選擇並標記）
- **NEVER** 在 commit 0-A 用 `simplify` skill / `code-review` agent 自行 review（改派 codex），也 **NEVER** 改用其他模型或顛倒兩輪 reasoning effort
- **NEVER** 把 routing 例外寫死在個別 skill；要加例外請改本檔的 Routing Table
