---
description: codebase-memory index 保鮮的機械層——兩支已接通的 Claude hook（PostToolUse 背景刷新 / SessionStart 健康判定）覆蓋什麼、hook 未接通時 agent 首次查圖譜前的自跑程序、以及 REQUIRED 欄位。觸發是「正要動 cbm config / wrapper，或要確認 index 新鮮度」，綁得到檔案故 path-scoped；「MUST 經 wrapper、NEVER 裸跑 CLI、NEVER 把 auto_index/auto_watch 設回 true」留在 [[codebase-memory-index]] 常駐層
paths:
  [
    '.mcp.json',
    '**/cbm-index.sh',
    '**/cbm-health.ts',
    'plugins/hub-core/hooks/session-start-cbm-index-check.sh',
    'plugins/hub-core/hooks/post-bash-cbm-index-refresh.sh',
  ]
---
<!-- Clade native rule; source: rules/core/codebase-memory-index.freshness.md; edit canonical source -->

<!-- clade-targets: claude,codex,cursor -->

# codebase-memory index 保鮮的機械層

> 本檔是 [[codebase-memory-index]] 的 path-scoped sibling。三條 NEVER（裸跑 CLI／繞過 wrapper／
> 把 `auto_index`・`auto_watch` 設回 true）留在常駐層，**NEVER** 因為本檔沒載入就當作可以裸跑。

| 已接通的 Claude hook | 覆蓋 |
| --- | --- |
| `post-bash-cbm-index-refresh.sh` / native PostToolUse | 比對當下 HEAD 與 provenance；已有索引且 working tree 乾淨時，背景更新過期索引 |
| `session-start-cbm-index-check.sh` / native SessionStart | 同一健康判定，涵蓋人手動 commit、rebase / pull；缺索引、未知來源、dirty 或失敗時提示，同 session 狀態不變不重複 |

上表的自動觸發以該產品入口已安裝、啟用並驗證 hook 為前提。Codex／Cursor 的 hook adapter
存在不代表這兩支 handler 已接通。沒有該入口的自動檢查證據時，agent 在首次使用圖譜前，
從目前 repo 執行 `bash ~/offline/clade/plugins/hub-core/hooks/session-start-cbm-index-check.sh`，
讀取提示再決定是否經 wrapper 更新；commit／rebase／pull 後若還要查圖譜，再做相同檢查。
Clade 不在預設位置時使用其實際 checkout 路徑。檢查程式缺席或無法執行就回報保鮮未驗，
不把缺少自動觸發當成 index 新鮮，也不啟用 `auto_index`／`auto_watch` 補洞。

改動 config 或 wrapper 參數前先讀 [[pitfall-cbm-auto-index-concurrent-oom]]。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | `session-start-cbm-index-check.sh` 在 index 落後 HEAD 或 DB 缺失 / 不可讀、dirty 或 provenance 不明時提示。**提示不 block**；已有索引且乾淨的過期 HEAD 自動背景刷新，缺索引仍由 bootstrap 或 wrapper 建立 |
| 消費端 | 要用 `search_graph` / `trace_path` / `get_code_snippet` 的 agent（讀提示決定要不要先 index）；Claude hooks、Codex / Cursor 原生投影與 Pi extension 共用 `cbm-health.ts` |
| 載入路徑 | 本檔由共同 rules planner 交付到所選 runtime 的原生規約入口；Claude 為 `.claude/rules/codebase-memory-index.md`，Codex baseline 為 AGENTS.md，Cursor 為 `.cursor/rules/`；clade home 經 `.claude/rules/local/` pointer。規約載入與 hook 自動觸發分別驗證 |
