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

## 交給 clade 的問題（不在 consumer 端修）

1. **clade 工具把 nuxt-supabase-starter 的 repo root 當成 consumer root**：有東西在 root 跑了 rule projection
   （`sync-rules` 的 `consumerRoot = process.cwd()`，外加 codex adapter），把 root `CLAUDE.md` 改成空殼、
   寫出 root `AGENTS.md`。ownership journal 只記到 mtime-window 共存的 session `01a0df67-53cc-72e0-a7f4-bb663c7afabc`
   （cwd=clade、tool=Bash），無法確定是誰寫的。應以 `local_dir` 為 consumer root，並拒絕寫入沒有
   `.clade/manifest.json` 的目錄。
2. **SessionStart hook 也用 repo root 判斷**：在本 repo root 開 session 會印「`.clade/manifest.json`
   與 `.claude/hub.json` 都不存在 —— registry 宣告與 repo 實況不符」，但 `audit-registry-reality.ts --consumer nuxt-supabase-starter`
   回報 OK。這和第 1 點是同一類問題：沒有套用 `local_dir`。
