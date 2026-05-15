---
name: wt
description: 建立 session-level git worktree。`/wt <slug>` 建 isolated worktree 在 sibling dir、開 timestamped session branch、merge origin/main 拉投影層到位、回傳 path + branch + 「請開新 session 過去」指示。不會改變呼叫端 session 的 cwd（mid-conversation 切目錄會破壞 file watcher / Bash state）。Use when user types /wt 或請求新開 session worktree。
license: MIT
metadata:
  author: clade
  version: "1.0"
---

# /wt — 建立 session worktree

實作 [[worktree-default]] §5 規約。

## 使用情境

User 即將開始一條會修改 code 的工作（implement、fix、refactor、deploy 準備等）且當前 cwd 在 main worktree。`/wt <slug>` 把該工作隔離到獨立 worktree，避免 staging / branch / WIP 跨 session 污染。

**不要在以下情境用**：
- 只是 read-only 探索（grep、看 log、解釋 code 不寫檔）
- 當前 cwd 已在某個 session worktree（`git rev-parse --git-dir` 含 `/worktrees/`）
- User 沒明確要求建 worktree 而 agent 自己想開（先問再做）

## Step 1 — Slug 解析

從 `/wt <slug>` 的 `<slug>` argument 取使用者提供的 short identifier。常見形式：`fix-auth`、`add-export`、`debug-cron`。

若 user 沒給 slug，**問**他要用什麼 slug，**不要**自己編。

## Step 2 — 呼叫 wt-helper

```bash
node scripts/wt-helper.mjs add <slug>
```

從當前 consumer cwd 跑（helper 自己用 `findConsumerRoot` 走最外層 `.git` 解析 consumer root）。

Helper 行為：
- Slug normalize（lowercase、空白轉 `-`、collapse 重複 `-`、trim 首尾 `-`）
- 建 branch `session/<YYYY-MM-DD-HHMM>-<slug>` 從 `main`
- `git worktree add` 到 `<consumer-parent>/<consumer-name>-wt/<slug>/`
- 若 `origin/main` 存在，跑 `git merge --ff-only origin/main` 拉最新投影層
- 印出 path + branch + 開新 session 提示

## Step 3 — 回報給 user（oneliner 格式）

把 helper output 原樣呈現，**加一段** oneliner 形式的接續指引（per [[worktree-default]] §1「oneliner 慣例」）：

```
Worktree 建好了：

  Path:   <path>
  Branch: session/<date>-<slug>

請執行：

  cd <path> && claude
```

若 `/wt <slug>` 是被其他 skill 內部呼叫且**有**明確的下一步 skill（例：spectra-apply 偵測 cwd 在 main 後內呼 wt，下一步要跑 `/spectra-apply <change-name>`），把該 skill invocation 接在後面：

```
  cd <path> && claude "/spectra-apply <change-name>"
```

`claude [prompt]` 啟動 session 時可預填第一個 prompt（見 `claude --help`），user 整段複製貼一次到位。

當前 session 保持在 main worktree，繼續做你原本的事或結束。

## 重要：絕對不要改當前 session 的 cwd

`/wt` 是 **utility skill**：它建好 worktree，**回報路徑給 user**，**到此為止**。**MUST NOT**：

- 在當前 session 跑 `cd <new-worktree-path>`
- 在當前 session 開始往 worktree 內寫檔
- 假設 user 接下來會繼續在當前 session 工作

理由：mid-conversation 切 cwd 會打壞 file watcher、Bash tool 內部 cwd state、未完成的 file read window。要在新 worktree 做事，是**另一個 agent session** 的工作。

## 失敗處理

| Helper 錯誤 | 原因 | 處理 |
| --- | --- | --- |
| `Worktree path already exists` | 同名 slug 已建過 worktree | 改名 / 用 `wt-helper cleanup <slug>` 先清掉舊的 |
| `Base branch "main" not found` | Consumer 沒 main branch（用 master 等舊名） | 先 `git branch -m master main` 或暫時手動建 worktree |
| `Not inside a git repository` | cwd 不在 git repo 內 | `cd` 到 consumer 後重跑 |
| `warn: could not fast-forward merge origin/main` | local main 已 diverge 或 origin/main 不存在 | 進 worktree 後手動 `git merge`，**不影響** worktree 已建立 |

## 後續維運

User 想清理 worktree 時：

```bash
node scripts/wt-helper.mjs list                    # 看所有 session worktree
node scripts/wt-helper.mjs prune                   # 互動清掉所有 merged worktree
node scripts/wt-helper.mjs cleanup <slug>          # 清單一條（必 merged）
node scripts/wt-helper.mjs cleanup <slug> --force  # 強制清未 merged
```

## 相關

- [[worktree-default]] — 完整規約（含禁止 silent branch、propagate refuse-and-guide）
- [[session-tasks]] — 共用 `<YYYY-MM-DD-HHMM>-<slug>` 命名慣例
