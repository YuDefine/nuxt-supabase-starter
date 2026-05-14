<!--
🔒 LOCKED — managed by clade
Source: rules/core/worktree-default.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Session-level git worktree 預設機制——每個會修改 code 的 session 走獨立 worktree，禁止 silent branch 建立，避免跨 session 的 staging / branch 狀態污染
globs: ['vendor/scripts/wt-helper.mjs', 'plugins/hub-core/skills/wt/**']
---

# Worktree Default

繁體中文

**核心命題**：multi-session 並行開發共用單一 working tree，staged 區、branch HEAD、partial WIP 都會跨 session 滲漏。最痛的兩次：
- TDMS `bcfde9c8` — `git add -A` 把另一 session 的 WIP + clade 投影層全 stage 起來一起 commit，22 個檔案被推進 origin/main
- `clade publish` — 並行 session 的 feature branch 還 checked out 時直接 publish，把 user 還沒準備好的 commit 一起推 + propagate

git worktree 從根本解掉這兩件事（per-session 獨立檔案系統 + 獨立 HEAD + 獨立 staging）。

此規則優先於全域 `~/.claude/CLAUDE.md` 的「git workflow」相關段落（若存在）。

---

## §1 預設用 worktree

要寫、改、刪 tracked file 的 session **MUST** 跑在獨立 worktree，**NEVER** 直接在 main 改。

**判定「要動 code」**：使用者請求中出現 implement / fix / refactor / add / edit / 部署準備 / migration / config 寫入 等動詞，且目標是 tracked file。

**例外：read-only session**。只跑 grep / 看 log / 列檔案 / 跑 audit / 查 git history / 解釋 code（不寫檔），**MAY** 在 main worktree。

**判定「已在 worktree」**：`git rev-parse --git-dir` 結果若包含 `/worktrees/` 子路徑，則 cwd 已在某個 worktree，**不要**疊建新 worktree。

### Session 開頭固定動作

1. **判斷**：使用者請求是 read-only 還是會動 code？
2. **若會動 code**：用 `/wt <slug>` 建 worktree；session **SHALL** 提示使用者開新 agent session 到 worktree 路徑（**不要**在當前 session mid-conversation 切 cwd）
3. **若只是 read-only**：直接做事，不必建

## §2 禁止 silent branch 建立

Agent **MUST NOT** 跑 `git checkout -b`、`git branch <name>`、或任何會產生新 ref 的指令，**除非**先取得使用者明確同意。

**唯一例外**：`/wt <slug>` 規約定義的 `session/<YYYY-MM-DD-HHMM>-<slug>` 自動命名。這個命名完全由 convention 決定（不是 agent 自由發揮），`/wt` 的 invocation 本身就是 user 對該 branch 的授權。

### 工具內部 branch 建立不受此規約限制

User 顯式呼叫的 script（例如 `scripts/propagate.mjs` 建 `bump/<version>` branch、`git flow init` 等）有 documented behavior，**屬於 user authorized invocation**。此類 branch 建立屬於工具行為，不算 agent silent creation。

判定原則：「branch 是不是 user 透過工具 invocation 隱含授權的？」是 → 通過；不是 → 必須先問。

### Agent 想自由發揮命名（如 `feature/x` / `fix-bug-y`）

**ASK FIRST**。即使 agent 認為 branch 很合理（例如為 isolate 一個 PR），仍須先取得 user 同意。**NEVER** 偷偷建好再說。

## §3 Worktree 命名與位置

### Branch 命名

`session/<YYYY-MM-DD-HHMM>-<slug>`

- 時間戳對齊 [[session-tasks]] 的 `tasks/<YYYY-MM-DD-HHMM>-<slug>.md` 慣例
- `<slug>` 經 `wt-helper` 的 normalization：lowercase、空白與特殊字元轉 `-`、collapse 重複 `-`、trim 首尾 `-`

### 檔案系統位置

`<consumer-parent>/<consumer-name>-wt/<slug>/`

對真實 consumer 結構（`~/offline/<consumer>/`），等同 `~/offline/<consumer>-wt/<slug>/`。

**Monorepo 子目錄 consumer**（例：`~/offline/nuxt-supabase-starter/template/`）：`wt-helper` 走最外層 `.git` 解析 consumer root，worktree 落在 `~/offline/nuxt-supabase-starter-wt/<slug>/`，**不是** `~/offline/template-wt/<slug>/`。

## §4 與 propagate 的互動

`scripts/propagate.mjs` 的 worktree-aware preflight：偵測 cwd 是否在非 main worktree（`git rev-parse --git-common-dir` ≠ `git rev-parse --git-dir`），是則 exit non-zero，**不**自動 cd 回去、**不**自動同步多 worktree。

也就是說 **publish + propagate 必須在 clade 主 worktree 跑**，session worktree 內想 propagate 必須先 `cd ~/offline/clade`。理由：跨 worktree 寫投影層在 file watcher / staging 區會撞，refuse-and-guide 比悄悄出錯安全。

Worktree 內如果想拉 main 最新投影層，自己跑 `git merge origin/main`；`/wt` skill 建立 worktree 時已經做過一次。

## §5 操作工具：`/wt` 與 `wt-helper.mjs`

| 動作 | 指令 |
| --- | --- |
| 建 worktree | `/wt <slug>` （內部呼叫 `wt-helper add`） |
| 列出 session worktree | `node scripts/wt-helper.mjs list` 或 `--json` |
| 互動式清掉 merged worktree | `node scripts/wt-helper.mjs prune` |
| 清掉某條（需 merged） | `node scripts/wt-helper.mjs cleanup <slug>` |
| 強制清掉 unmerged | `node scripts/wt-helper.mjs cleanup <slug> --force` |

Source：`~/offline/clade/vendor/scripts/wt-helper.mjs`（散播投影到各 consumer 的 `scripts/wt-helper.mjs`）。

## §6 升級路徑與 grandfathered worktree

既有的、命名不符 `session/*` 的 worktree（例如 clade 上的 `[perno-session-treat-publish-untracked]`）**grandfathered**，不強制重命名。`wt-helper list` 與 `prune` 只認 `session/` 前綴的 worktree，舊命名不受影響。

新建一律走 `/wt` + `session/<date>-<slug>` 規約。

## 相關規則

- [[session-tasks]] — 共用時間戳 + slug 慣例
- [[commit]] — staging 區規範（worktree 隔離後 staging 污染風險降到最低）
- [[scope-discipline]] — 「不屬於當前 scope 的 worktree」應該另開 session
