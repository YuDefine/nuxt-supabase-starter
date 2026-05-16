<!-- AUTO-GENERATED from .claude/ — 請勿手動編輯 -->

## Language

- 一律使用繁體中文，不要使用簡體中文。

## Source Of Truth

兩層來源 — 上游進來、下游投影出去，**永遠單向**：

```
clade（~/offline/clade）         ← 跨專案共用中央倉
  └→ .claude/                     ← 本專案 source（AI Agent First）
       └→ .codex/ / .agents/ / AGENTS.md    ← sync-to-agents 投影
```

- 上游：`rules/`、`skills/`、部分 `hooks/`、`scripts/` 由 clade 治理（見 `.claude/.hub-state.json` 的 checksum 清單）。要改這些**先改 clade 中央倉**，跑 `pnpm hub:sync` 投到本專案；直接在 `.claude/rules/` 等改 → SessionStart `_bootstrap-check.sh` 會自動還原 + commit hook 會擋。
- 本層：`.claude/` 是本專案唯一 source（settings.json、hub.json、本地 commands/agents、business-specific hooks）。
- 下游：`.codex/`、`.agents/`、`AGENTS.md` 全是 sync-to-agents 從 `.claude/` 投影出來。**禁止**直接編輯，要改先回 `.claude/` 改、再跑 `node ~/.claude/scripts/sync-to-agents.mjs` 重投影。

常用命令：

| 動作                                | 命令                                        |
| ----------------------------------- | ------------------------------------------- |
| 從 clade 拉新版到本專案             | `pnpm hub:sync`                             |
| 檢查本專案 vs clade drift           | `pnpm hub:check`                            |
| 從 `.claude/` 重投影到 codex/agents | `node ~/.claude/scripts/sync-to-agents.mjs` |
| 完整 bootstrap（首次）              | `pnpm hub:bootstrap`                        |

<!-- SPECTRA:START v1.0.2 -->

# Spectra Instructions

This project uses Spectra for Spec-Driven Development(SDD). Specs live in `openspec/specs/`, change proposals in `openspec/changes/`.

## Use `/spectra-*` skills when:

- A discussion needs structure before coding → `/spectra-discuss`
- User wants to plan, propose, or design a change → `/spectra-propose`
- Tasks are ready to implement → `/spectra-apply`
- There's an in-progress change to continue → `/spectra-ingest`
- User asks about specs or how something works → `/spectra-ask`
- Implementation is done → `/spectra-archive`
- Commit only files related to a specific change → `/spectra-commit`

## Workflow

discuss? → propose → apply ⇄ ingest → archive

- `discuss` is optional — skip if requirements are clear
- Requirements change mid-work? Plan mode → `ingest` → resume `apply`

## Parked Changes

Changes can be parked（暫存）— temporarily moved out of `openspec/changes/`. Parked changes won't appear in `spectra list` but can be found with `spectra list --parked`. To restore: `spectra unpark <name>`. The `/spectra-apply` and `/spectra-ingest` skills handle parked changes automatically.

<!-- SPECTRA:END -->

> Spectra 版號對照：app 版本（如 `2.2.5`，你日常看到的）跟上方 SPECTRA marker（如 `v1.0.2`）是兩條獨立軌道 — marker 只在 Spectra 改 instruction template 時才跳號。

## Project Focus

- 這是可直接執行的 Nuxt + Supabase starter template；入口文件見 `../docs/QUICK_START.md`、`../docs/INTEGRATION_GUIDE.md` 與 `docs/WORKFLOW.md`。

## Rule Entry Points

- API / DB / 開發約定：`.claude/rules/api-patterns.md`、`.claude/rules/database-access.md`、`.claude/rules/development.md`
- UX / Spectra workflow：`.claude/rules/ux-completeness.md`、`.claude/rules/proactive-skills.md`
- 其餘 shared rules：`.claude/rules/`
- workflow / skills：`.agents/skills/`、`.agents/commands/`

## Codex Projection

- 定期執行 `node ~/.claude/scripts/sync-to-agents.mjs`，讓 Codex surface 與 `.claude/` 保持一致。
- 專案特化 promotion 規則放在 `.claude/sync-to-agents.config.json`。
- 若 source 與投影不一致，以 `.claude/` 為準，之後再同步生成。

<!-- CLADE:SNIPPET:post-push-ci-watch:START -->

## Post-Push CI Watcher

當主線執行 `git push --tags`（或推單一 tag、或 push commit 觸發發版 workflow）**成功**後，**若**該 repo 含 `.github/workflows/*.yml` 且 `gh` CLI 可用：

**MUST** 立刻用 `Agent(run_in_background=true)` 開 watcher subagent 監看 GitHub Actions 結果，**NEVER** 自己同步 block 等待 — 主線繼續對話，watcher 完成時系統會自動通知主線。

### Watcher subagent prompt 模板

Subagent 任務應包含（cwd 設為 push 發生的 repo path）：

1. `gh run list --limit 1 --json databaseId,name,status,conclusion,url,headBranch,event,createdAt`
   - 若 list 空 / `gh` 未登入 / 無權限 → 回報 `status: unavailable` + 原因，結束
   - 若最新 run 的 `createdAt` 早於 push 時間（不是這次 push 觸發的） → 同上回報 unavailable
2. `timeout 900 gh run watch <databaseId> --exit-status`
   - exit 0 → `status: success`
   - exit 124 → `status: timeout`（15 min 上限）
   - 其他非 0 → `status: fail`；補跑 `gh run view <databaseId> --log-failed` 截前 200 行作 `logExcerpt`
3. 結構化回報（≤200 字）：
   - `status`、`runUrl`、`version`（由 `git describe --tags --abbrev=0` 抓；無 tag 則填 commit short sha）
   - 若 fail：`failedJob`、`logExcerpt`（節錄前 30 行）

### Watcher 完成後主線必做

- **success** → 一行報 `v<version> CI 綠燈 — <runUrl>` 後結束本話題，**NEVER** 多嘴
- **fail / timeout** → **MUST** 用 `request_user_input` 給使用者二選一：
  - `[1] 立刻 root-cause + 修` — 讀 `logExcerpt` 找根因，進除錯流程；修完前 **NEVER** 主動 push
  - `[2] 登記 HANDOFF.md` — 在 repo root 的 `HANDOFF.md` 末尾 append：

    ```
    - [ ] [<YYYY-MM-DD>] v<version> CI <fail|timeout> — <failedJob>
      - Run: <runUrl>
      - 根因猜測: <一行>
    ```

    若 `HANDOFF.md` 不存在 → 先建立骨架：

    ```
    # HANDOFF

    ## CI 紅燈待辦
    ```

- **unavailable** → 一行報「watcher 無法啟動（<原因>），略過」結束，**NEVER** 追問使用者

### 禁忌

- **NEVER** 在 watcher 回報前主動結束話題或叫 user 自己看
- **NEVER** 在 user 未選 `[1]` 前替他改 code / push commit 修 CI
- **NEVER** 對沒有 `.github/workflows/` 的 repo 套用這條規則（直接跳過 watcher）
- **NEVER** 重開新 watcher 取代尚在跑的 watcher（避免重複監看同一個 run）
<!-- CLADE:SNIPPET:post-push-ci-watch:END -->

<!-- CLADE:SNIPPET:archive-commit-order:START -->

## Spectra Change 收尾：先 archive 再 /commit

當 Spectra change 的 M.1-M.8 + archive gate 全綠、要收尾時，**MUST** 走以下順序：

1. **先**跑 `/spectra-archive`（不要先 /commit fix）
2. **再**跑單一 `/commit` — 一次包掉 manual review fix + archive directory rename + spec snapshot

### 為什麼

`/commit` 是慢路徑（review、message 生成、hooks），分兩段跑時間翻倍；archive 純 bookkeeping（rename + 落 snapshot），不值得獨立 ceremony，跟 fix 一起 commit 反而最省時。commit message 用雙標題 `fix: ...; archive: ...` 表達即可。

### 禁忌

- **NEVER** 先跑 `/commit` 收 fix 再跑 archive — 等於強迫雙倍慢路徑
- **NEVER** 用 `/spectra-commit` 收尾 — 速度優先，selective stage 不值得
- **NEVER** 在 archive 之後分兩個 `/commit`（一個包 fix、一個包 archive）— 同上理由
<!-- CLADE:SNIPPET:archive-commit-order:END -->

<!-- CLADE:SNIPPET:worktree-default:START -->

## Session-level Worktree

要動 code 的工作（implement / fix / refactor / migration）**MUST** 在獨立 git worktree 內執行，**NEVER** 直接在 main 改。操作上由 `/wt <task>` 全自動 orchestrate — `/wt` 建 worktree、dispatch subagent 進去做事、subagent commit 完回來主線 squash-merge 進 main 的 working tree、cleanup worktree。主線 chat session cwd 全程不動，user 不必開新 terminal、不必複製 oneliner、不必手動 `git worktree` 任何子命令。

Read-only session（grep、看 log、解釋 code 不寫檔）可留在 main worktree。

**例外：`/spectra-archive` 在 main 跑**。Archive 語意是「把 change 合併進 main」（mv folder、delta sync 進 specs、screenshot sweep），全部寫入 main，走 worktree 反而多一道 merge-back。其他 spectra-\* skill（`/spectra-apply` / `/spectra-ingest` / `/spectra-debug`）仍須走 `/wt` 進 worktree。

**Parent cwd 不動 invariant**：`/wt` **SHALL NOT** 遷移 parent session 的 cwd — 所有 worktree 內的操作由 subagent 執行（subagent cwd = worktree path），主線（cwd = main）負責 dispatch + squash + cleanup。先前 `--dispatch-from-handoff` flag 機制已移除；新 orchestration model 透過 subagent 隔離 cwd 達到同樣的「不切 terminal」UX，且更嚴格地保留 parent cwd invariant。

**`/wt` invocation forms**：

- `/wt <task description>` — 單條 ad-hoc。
- `/wt A: ... B: ...` — 平行多 task，每 task 一 worktree + subagent。
- `/wt <slug>: /<next-skill> <args>` — `/handoff` Mode B 內部 dispatch（subagent 在 worktree 跑指定 skill）。

**Silent branch 禁令**：Claude **MUST NOT** 跑 `git checkout -b` / `git branch <name>` 或任何會建新 ref 的指令，**除非**先取得 user 明確同意。`/wt` 用的 `session/<date-slug>` 規約命名是唯一例外（`/wt` 呼叫本身就是 user 對該 branch 的授權）。

**Commit 階段：subagent commit in worktree → 主線 squash 進 main → user 跑 `/commit`**。subagent 在 worktree 做 `git add + commit -m "wt: <slug>"`（可多 commit、**禁止** push / `/commit`）；主線跑 `git -C <main> merge --squash <session-branch>` 把改動 land 到 main 的 working tree（**不** commit on main）+ `wt-helper cleanup <slug> --force` 清 worktree；user 累積夠了在 main 主動 `/commit` 走 ceremony（lint / type / test / selective stage / push）。

**Failure fallback**：subagent fail（test 不過、沒 commit）→ 保留 worktree + branch，主線回報路徑，user 從 main 跑 `git -C <wt> diff/log` 檢查；squash conflict（平行 task 改同檔）→ 保留該 worktree，main 維持上一個成功 squash 的狀態；cleanup 失敗 → 改動已在 main，報告 worktree 殘留路徑由 user 手動 `wt-helper cleanup --force`。

詳見 `.claude/rules/worktree-default.md`。

<!-- CLADE:SNIPPET:worktree-default:END -->

# RTK Instructions

Use RTK (Rust Token Killer) to reduce token-heavy shell output when running commands through an AI coding assistant.

## Command Routing

- Prefer `rtk git status`, `rtk git diff`, `rtk git log`, `rtk gh ...` for Git and GitHub CLI output.
- Prefer `rtk pnpm ...`, `rtk npm ...`, `rtk vitest`, `rtk playwright test`, `rtk lint`, and `rtk tsc` for package manager, test, lint, and typecheck output.
- Prefer `rtk grep`, `rtk find`, `rtk read`, and `rtk ls` when the expected output is large.
- Use raw shell commands for small, structural, or shell-native operations such as `pwd`, `cd`, `mkdir`, `test`, `[ ... ]`, `[[ ... ]]`, `true`, `false`, `export`, `printf`, and `echo`.
- Do not rewrite shell builtins as RTK subcommands. For example, use `test -d path`, not `rtk test -d path`.
- For shell syntax, compound commands, heredocs, or commands RTK does not understand, use the raw command or `rtk proxy <command>` only when compact tracking is still useful.

## Sandbox Database

RTK tracking must use a Codex-writable database path:

```toml
[tracking]
database_path = "/Users/charles/.codex/memories/rtk/history.db"
```
