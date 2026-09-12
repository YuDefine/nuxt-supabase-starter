<!-- Clade native rule; source: rules/core/codebase-memory-index.md; edit canonical source -->
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

**兩支已接通的 hook 覆蓋什麼、hook 未接通時的自跑程序、以及 REQUIRED 欄位，在 [[codebase-memory-index.freshness]]**（path-scoped：碰 `.mcp.json` / `cbm-index.sh` / `cbm-health.ts` / 兩支 cbm hook 時載入）。沒有自動檢查證據時 **NEVER** 把缺少自動觸發當成 index 新鮮，**也 NEVER** 啟用 `auto_index`／`auto_watch` 補洞。
