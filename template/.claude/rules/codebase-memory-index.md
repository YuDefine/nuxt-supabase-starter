<!--
🔒 LOCKED — managed by clade
Source: rules/core/codebase-memory-index.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# codebase-memory index

跑 codebase-memory 的 index **MUST** 經 `scripts/cbm-index.sh`（clade 端為
`vendor/scripts/cbm-index.sh`）。**NEVER** 裸跑 `codebase-memory-mcp cli index_repository`，
**也 NEVER** 為了「只跑一次、很快」而繞過它——兩道保護只在 wrapper 裡：

- `flock -n`：每個 repo 同時只有一個 index。去抖語義是「有人在跑就放棄」，不是排隊
- `MemoryMax` cgroup 天花板：index worker 記憶體無界成長，工具自報的 `budget_mb` 對它
  自己沒有約束力

**NEVER 把 `auto_index` / `auto_watch` 設回 true。** 它們是 per-instance 生效，而每個
agent session 各起一份 MCP server——N 個 session 就是 N 份併發 index 同一批 repo。
2026-08-25 實測：單一 worker anon-rss 衝到 16.2G，18 分鐘內 6 次 OOM kill；SIGKILL 打斷
`journal_mode=delete` 的 SQLite 寫入，13 個 repo 的 DB 全部損毀。損毀後每份 instance 各自
rebuild，形成自我維持的迴圈，直到人從「打字卡頓」發現為止。

逐字反開脫：「關掉 auto 會沒人更新 index」——**保鮮不靠 auto**，靠下面兩條，而 auto 開著的
那 15 天產出的是 13 個 `.db.corrupt`，不是新鮮的 index。

| 保鮮觸發 | 覆蓋 |
| --- | --- |
| `post-bash-cbm-index-refresh.sh` | agent 經 Bash 跑的 `git commit`（背景、非阻塞） |
| `session-start-cbm-index-check.sh` | 其餘全部——人手動 commit、其他工具 commit、rebase / pull。落後就在 session 開頭明說落後幾個 commit |

改動 config 或 wrapper 參數前先讀 [[pitfall-cbm-auto-index-concurrent-oom]]。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | `session-start-cbm-index-check.sh` 在 index 落後 HEAD 或 DB 缺失 / 損毀時提示。**提示不 block**——index 是重操作，跑不跑由 agent 依該 session 需要判斷 |
| 消費端 | 要用 `search_graph` / `trace_path` / `get_code_snippet` 的 agent（讀提示決定要不要先 index）；`post-bash-cbm-index-refresh.sh` 在 commit 後自動呼叫 wrapper |
| 載入路徑 | 本檔（`rules/core/codebase-memory-index.md` → consumer `.claude/rules/codebase-memory-index.md`，always-load）；clade home 經 `.claude/rules/local/` pointer |
