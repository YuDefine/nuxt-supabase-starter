<!--
🔒 LOCKED — managed by clade
Source: rules/core/codebase-memory-index.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- clade-targets: claude,codex,cursor -->
# codebase-memory index

跑 codebase-memory 的 index **MUST** 經 `scripts/cbm-index.sh`（clade 端為
`vendor/scripts/cbm-index.sh`）。**NEVER** 裸跑 `codebase-memory-mcp cli index_repository`，
**也 NEVER** 為了「只跑一次、很快」而繞過它——wrapper 提供以下控制：

- `flock -n`：每個 repo 同時只有一個 index。去抖語義是「有人在跑就放棄」，不是排隊
- user systemd 可用時，以 `MemoryMax` / `CPUQuota` 限制本次 CLI 與其子行程。CLI 若把工作交給既有 daemon，該 daemon 不在這個 cgroup；沒有 user systemd 時亦沒有此限制
- 索引 receipt 保存開始與結束的 HEAD、dirty 狀態、CLI 結果及原始輸出證據；進行中或不明回應不算成功

**NEVER 把 `auto_index` / `auto_watch` 設回 true。** 它們是 per-instance 生效，而每個
agent session 各起一份 MCP server——N 個 session 就是 N 份併發 index 同一批 repo。
2026-08-25 實測：單一 worker anon-rss 衝到 16.2G，18 分鐘內 6 次 OOM kill；SIGKILL 打斷
`journal_mode=delete` 的 SQLite 寫入，13 個 repo 的 DB 全部損毀。損毀後每份 instance 各自
rebuild，形成自我維持的迴圈，直到人從「打字卡頓」發現為止。

逐字反開脫：「關掉 auto 會沒人更新 index」——**保鮮不靠 auto**，靠下面兩條，而 auto 開著的
那 15 天產出的是 13 個 `.db.corrupt`，不是新鮮的 index。

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
