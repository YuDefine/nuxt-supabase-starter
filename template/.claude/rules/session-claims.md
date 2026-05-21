<!--
🔒 LOCKED — managed by clade
Source: rules/core/session-claims.md
Edit at: /Users/charles/offline/clade
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
  "consumer": "TDMS",
  "worktree_path": "/Users/.../<consumer>-wt/<slug>",
  "branch": "session/<date>-<slug>",
  "change_id": "<slug>",
  "expected_paths": ["server/api/foo/**", "layers/bar/**"],
  "last_heartbeat": "<iso>",
  "expires_at": "<iso, started+24h>"
}
```

- `session_id` 純 ID（由 `claim-helper.mjs` 生成；含 timestamp + random + hostname 片段）
- `expected_paths` 是這個 session 預期會碰的檔案 glob（可空，越精確越好）
- `expires_at` = `last_heartbeat + 24h`；過期 claim 視為失活，prune 階段會自動刪

## 2. Claim 寫 / refresh / drop 時機

| 時機 | 動作 | 由誰 |
|---|---|---|
| `wt-helper add <slug>` 開 worktree | 寫 claim | `wt-helper.mjs` |
| AI session 啟動 in worktree | refresh `last_heartbeat` + `expires_at` | SessionStart hook `session-start-claim-heartbeat.sh` |
| `wt-helper cleanup <slug>` | drop claim | `wt-helper.mjs` |
| `wt-helper merge-back <slug>` 成功 | drop claim（透過 cmdCleanup 轉發） | `wt-helper.mjs` |
| 過期超過 24h | prune | `claim-helper.mjs prune`（手動 / cron） |

主線 session（**非** worktree）目前**不自動寫** claim — 主線預設可動全部，是 worktree session 需要宣告「我擁有這條 branch + 這些 paths」。

## 3. 誰讀 claim

| 讀者 | 用途 |
|---|---|
| `scripts/publish.mjs` (clade) | 跨 consumer scan，warn 「別 session 還活著」 |
| `scripts/propagate.mjs` (clade) | per-consumer warn 同上 |
| `wt-helper.mjs merge-back` | Phase 3 audit：偵測「main dirty 屬於別 session 路徑」 |
| `/commit` skill (spectra-commit) | Phase 4 partition：別 session 路徑 fail-closed |
| `wt-helper.mjs` stash namespace | Phase 7：stash slug 帶 session_id |

## 4. 儲存與 gitignore

- 位置：consumer-local `.clade/claims/<session-id>.json`
- 整個 `.clade/claims/` 子目錄被 `.clade/claims/.gitignore`（內含 `*`）shadow，**永遠不會** commit 進 repo
- per-machine state；不同機器之間不共享 claim

## 5. Stale claim 處理

- 過期 claim（`expires_at` < now）視為失活
- `claim-helper.mjs prune` 手動清理
- 若 worktree 仍存在但 claim 過期 → session 可能跑得太久沒 refresh，下次 SessionStart 會自動補回；不影響 worktree 安全

## 6. Agent-agnostic

- Claude Code：靠 SessionStart hook 自動 refresh heartbeat
- Codex：目前**沒有等效 SessionStart hook**；fallback 路徑（未來）走 `bin/vp` PATH shim 或 git pre-commit adapter（per `rules/local/improvement-loop.md` 既有 pattern）
- 兩種 agent 都共用同一份 `claim-helper.mjs` CLI

## 7. 失敗模式（fail-open）

任何 claim 讀寫失敗**永遠不 block** publish / propagate / merge-back / commit。Claim 是 awareness signal，不是 enforcement gate（enforcement 由 Phase 3 audit 提供，仍可選擇 fail-closed）。

## 8. CLI

```
node scripts/claim-helper.mjs list               # 列當前 consumer 活躍 claim
node scripts/claim-helper.mjs list --all         # 含過期
node scripts/claim-helper.mjs add --change-id <slug> --branch <branch> --worktree-path <path> --expected-paths "a/**,b/**"
node scripts/claim-helper.mjs refresh <session-id>
node scripts/claim-helper.mjs refresh-by-cwd     # 由 SessionStart hook 跑
node scripts/claim-helper.mjs drop <session-id>
node scripts/claim-helper.mjs prune              # 清過期
```
