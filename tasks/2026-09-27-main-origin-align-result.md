# 本機 main 既有 WIP 收斂、升版 commit 推上 origin（結果）

來源：clade W-2026-09-26-main-origin-auto-align。v1.13.37 propagate（2026-09-27 11:41）因 tracked WIP 未 rebase，
v1.13.36／v1.13.37 兩筆升版 commit 留在本機，desk `origin/main...main` = `3 2`。

## 逐筆去向

| 路徑 | 判定 | 依據 | 處置 |
| --- | --- | --- | --- |
| `CLAUDE.md`（縮成 `# CLAUDE.md\n`） | 誤投影 | 12 bytes 正是 clade `scripts/sync-rules.ts` 的 `CLAUDE_MD_SHELL`；同一瞬間（2026-09-26T20:34:08Z）root 也多出 `AGENTS.md` = `# AGENTS.md\n`（`adapters/codex/rules.ts`）。registry 登記的 consumer 路徑是 `nuxt-supabase-starter/template`（`registry/consumers.json` `local_dir`），root 是 meta 層不是 consumer，不該被投影成空殼。被刪的內容（語言、Meta vs Template 邊界表）沒有搬到任何地方 | `git checkout` 還原；刪除 untracked 的 `AGENTS.md` 空殼（沒有內容） |
| `template/RTK.md` 刪除 | 有效 | clade `37cac7535` 退役 RTK，`scripts/lib/rtk-retirement.ts:1290` 會刪除 `<repo>/RTK.md`；origin 上 `template/` 已沒有 `@RTK.md` 引用（第一輪說 `template/CLAUDE.md` 仍有引用，但重查 origin/main 並沒有） | 落地 |
| `template/.pi/settings.json` pin v1.13.4 → v1.13.37 | 有效 | 與 `template/.clade/manifest.json` 的 `version: 1.13.37` 一致，由 clade projection 寫出 | 落地 |
| `.clade/ai-control-plane/runtime-events.jsonl`、`.clade/flow/events.jsonl`、`.clade/ownership/journal.jsonl` 的追加行 | 不該進版控 | clade 自己管理的 `.clade/ai-control-plane/.gitignore`（`*-events.jsonl`）、`.clade/ownership/.gitignore`（`*`）都寫明是 runtime 產物；flow 事件脊椎依 clade 規約是 gitignored、只留在本機（`vendor/snippets/flow/README.md`）。三個檔是早期 commit（例如 `54ef74f2`）強制 track 進來的，之後每次追加都會變成擋住 propagate 的 WIP | `git rm --cached`（本機內容保留、不丟事件）；root `.gitignore` 補 `.clade/flow/`（連帶涵蓋 untracked 的 `work-source-mutex.sqlite`） |

## 驗證

見 commit 後 desk 實測：`git rev-list --left-right --count origin/main...main` 回傳 `0 0`、
`git status --short --untracked-files=no` 沒有輸出。

## 事故：本機 runtime 檔被 rebase 刪除（已大部分還原）

`git rm --cached` 之後跑 `git pull --rebase`：rebase 先 checkout origin/main（這三個檔在那裡仍是 tracked），
接著重放「刪除」commit，**連同 working tree 的本機檔一起刪掉**。git 把 ignored 檔視為可覆寫，所以沒有警告。

還原來源是 `git fsck --unreachable` 找到的 blob，比對條件是「內容以 e29c9c60 版本開頭」：

| 檔 | 還原 blob | 結果 |
| --- | --- | --- |
| `.clade/flow/events.jsonl` | `7ce38db3` | 完整（+123 行、478971 bytes，與遺失前一致） |
| `.clade/ownership/journal.jsonl` | `30fc969e` | 完整（+4 行，與 diff stat 一致） |
| `.clade/ai-control-plane/runtime-events.jsonl` | `668338c5` | **不完整**：只救回 +3 行，原本 +97 行；約 94 行 runtime telemetry 遺失（第一輪已判定這段序號 121–132 與既有紀錄重疊，本來就不能當乾淨日誌） |

教訓（交給 clade）：取消追蹤本機 runtime 檔時，**先把檔案複製到 repo 外面**，再 rebase／pull，之後複製回來；
或者改成 merge，不要用 rebase。

## 交給 clade 的問題（不在 consumer 端修）

1. **clade 工具把 nuxt-supabase-starter 的 repo root 當成 consumer root**：有東西在 root 跑了 rule projection
   （`sync-rules` 的 `consumerRoot = process.cwd()`，外加 codex adapter），把 root `CLAUDE.md` 改成空殼、
   寫出 root `AGENTS.md`。ownership journal 只記到 mtime-window 共存的 session `01a0df67-53cc-72e0-a7f4-bb663c7afabc`
   （cwd=clade、tool=Bash），無法確定是誰寫的。應以 `local_dir` 為 consumer root，並拒絕寫入沒有
   `.clade/manifest.json` 的目錄。
2. **SessionStart hook 也用 repo root 判斷**：在本 repo root 開 session 會印「`.clade/manifest.json`
   與 `.claude/hub.json` 都不存在 —— registry 宣告與 repo 實況不符」，但 `audit-registry-reality.ts --consumer nuxt-supabase-starter`
   回報 OK。這和第 1 點是同一類問題：沒有套用 `local_dir`。
3. 上面「事故」的教訓：評估 `/oops` 收進 clade `docs/pitfalls/`。

## Relay 繼任者須知

你是**繼任者**，不是被派出去做子工作的 worker。前一個 session（W-2026-09-27-nuxt-supabase-starter-main-wip）
已經完成 starter 端的收斂並推上 origin（`11838d0d`），因此交棒；手上**沒有** in-flight dispatch。

- **cwd**：`<home>/offline/nuxt-supabase-starter`（已乾淨、與 origin 對齊）。clade 端的修改依 clade 規約在 clade 自己的 worktree 進行，**NEVER** 直接改共用的 clade main checkout
- **工作**：處理上面「交給 clade 的問題」1、2、3——找出在 nuxt-supabase-starter repo root（而非 registry
  `local_dir` = `nuxt-supabase-starter/template`）跑 rule projection／SessionStart 判定的呼叫端，修成以 `local_dir`
  作為 consumer root，並對沒有 `.clade/manifest.json` 的目錄 fail closed（不寫空殼）。
- **起點**：`scripts/sync-rules.ts`（`consumerRoot = process.cwd()`、`CLAUDE_MD_SHELL`）、`adapters/codex/rules.ts`、
  SessionStart 印「registry 宣告與 repo 實況不符」的 hook（grep 該字串）、`node vendor/scripts/flow/flow.ts who --transcripts`
  可用來查 2026-09-26T20:34:08Z 寫入 root `CLAUDE.md`／`AGENTS.md` 的是誰。
- **規約**：照 clade 的 CLAUDE.md、tech-debt／plan 流程；需要時先登記 TD 再修。**NEVER** 回頭在 nuxt-supabase-starter
  手改 clade 投影檔。
- **gate**：遇到 gate 失敗就停，不要向原 session 輪詢。

## Relay 繼任者結果（2026-09-27）

### 問題 1：歸因更正——不是 clade 工具

2026-09-26T20:34:08Z 寫入 root `CLAUDE.md` 空殼與 root `AGENTS.md` 的是 codex session
`01a0df67-53cc-72e0-a7f4-bb663c7afabc`（cwd=clade），依使用者指令「starter 那邊也要改掉 一致化」手寫 python 直接覆寫
（`~/.codex/archived_sessions/rollout-2026-09-27T04-28-05-01a0df67-*.jsonl`，20:34:08.384Z 那筆 exec；
同一筆也把 clade `AGENTS.md` 縮成 1 行，之後已回到 HEAD）。`sync-rules` 沒有在 root 跑過，所以「以 `local_dir`
為 consumer root、拒絕寫入無 manifest 目錄」這項修正沒有實證，不做。

`11838d0d` 還原 root `CLAUDE.md` 等於撤回了使用者當時的指令。要不要重做已放進待決佇列
（flow ask，work `W-2026-09-27-orphan-9289b0`，掛在本 work 底下；推薦保留 37 行）。

### 問題 2：SessionStart hook 沒套 `local_dir`——已修，待合併

clade PR #428（work `W-2026-09-27-session-start-signal-local-dir`）：hook 改以 registry `local_dir` 判投影層，
語意對齊 `audit-registry-reality.ts` 的 `resolveLocalPaths`。starter root 實跑不再報「都不存在」。

### 問題 3：`/oops`——已收，並修上游成因

clade plan `W-2026-09-27-untrack-runtime-file-rebase-deletes`（四條件、最小重現、fleet 掃描皆 none）。
上游成因：propagate 只補 consumer root（`template/`）的 `.gitignore`，spine 卻寫在 git toplevel。
clade PR #429 讓 `.clade/flow/` 自帶 `.gitignore`（比照 claims／ownership），五個寫入點共用。

### starter 端補做

`59fb81bf`：取消追蹤前一棒漏掉的 `.clade/ownership/.bash-stamp-*`（2 個）與 `.heartbeat-stamp`。
推送前先確認與 origin `0 0`，沒有經過 rebase。
