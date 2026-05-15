<!--
🔒 LOCKED — managed by clade
Source: rules/core/worktree-default.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Session-level git worktree 預設機制——每個會修改 code 的 session 走獨立 worktree，禁止 silent branch 建立，避免跨 session 的 staging / branch 狀態污染
paths: ['vendor/scripts/wt-helper.mjs', 'plugins/hub-core/skills/wt/**']
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

**例外：main-bound skill（`/spectra-archive`）**。`/spectra-archive` 語意就是「把 change 合併進 main」（mv change folder 進 `openspec/changes/archive/`、delta sync 進 `openspec/specs/<capability>/spec.md`、screenshot sweep、`.spectra/touched/<change>.json` 清理），所有寫入目標都是 main。走 worktree 反而多一道 merge-back，無 isolation benefit。因此 `/spectra-archive` **MAY** 在 main worktree 直接跑（cwd 已在某 session worktree 內也 OK，skill cwd-idempotent）。其他 spectra-* skill（`/spectra-apply` / `/spectra-ingest` / `/spectra-debug`）**不在此例外**，仍須走 worktree。

**判定「已在 worktree」**：`git rev-parse --git-dir` 結果若包含 `/worktrees/` 子路徑，則 cwd 已在某個 worktree，**不要**疊建新 worktree。

### Session 開頭固定動作

1. **判斷**：使用者請求是 read-only 還是會動 code？
2. **若會動 code**：用 `/wt <slug>` 建 worktree；session **SHALL** 吐 oneliner 形式的指引讓 user 一鍵接續（見下方「oneliner 慣例」），**不要**在當前 session mid-conversation 切 cwd。**唯一例外**：當 `/handoff` Mode B 接續路徑內呼 `/wt <slug> --dispatch-from-handoff <next-skill>` 時，`/wt` **MAY** 遷移 parent cwd 並接著 dispatch 下一個 skill（見 §7 分支 C；此 flag 僅 `/handoff` skill 可用）
3. **若只是 read-only**：直接做事，不必建

### oneliner 慣例（refuse-and-guide 輸出格式）

當 skill / agent 偵測到「該動 code 但 cwd 在 main」、或 propose / discuss 結束要 user 開新 session 接 apply 時，**MUST** 吐以下格式：

```
請執行：

cd <worktree-absolute-path> && claude "<next-skill-invocation>"
```

- `<worktree-absolute-path>`：剛建好或既有的 worktree 絕對路徑（例 `/Users/charles/offline/TDMS-wt/fix-auth`）
- `<next-skill-invocation>`：下一步要跑的 skill 加 argument（例 `/spectra-apply fix-auth`），**optional** — 純建 worktree 不知道下一步時省略，user 自己決定
- **禁止**拆成「先 cd、再 claude、再輸入 command」三步指引 — user 痛點就是三跳

Claude Code CLI 支援 `claude [prompt]` 啟動 session 時預填第一個 prompt（見 `claude --help`），所以 oneliner 物理可行；接續 session 第一個 turn 自動 dispatch 該 skill。

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

## §7 Stop hook 死鎖 fallback

§1 規定 mid-conversation 不切 cwd，但實際會撞到一個死鎖：Stop hook 攔住代表 acceptance 未滿足要繼續做、cwd 卻在 main 上、main 又因別 session WIP 不能 commit / stash 整碗。此時三條路都被堵：

- 繼續寫 main：`git add -A` 會混進別 session WIP 一起 commit（TDMS `bcfde9c8` 教訓）
- mid-conversation 切 cwd 到 worktree：§1 禁止（破壞 file watcher / Bash state / 已讀檔的 path reference）
- 開新 session：當前 session 已積累的上下文（哪幾個檔已 Read、acceptance 卡哪、debug 走到哪）會浪費

**死鎖判定**（三條都成立）：
- Stop hook 攔住、acceptance criterion 未滿足
- 當前 cwd 在 main worktree（違反 §1 預設 — session 開頭就該建 worktree）
- main 已有 dirty WIP（不論來自當前 session 或別 session）

### 分支 A：MAY 建 worktree + 切 cwd 繼續

**全部**條件成立才允許：

- 自評當前 chat context 還有充裕餘地容納 cold-load 新 worktree path + 已讀檔重新 Read（**自評不確定就保守走 B**；不堆數字門檻是因為 Claude 無法可靠自我觀察 token %）
- 剩餘要做的事範圍小（自評 ≤5 turn 可收尾到 acceptance）
- 已 selective stash 當前 session 的 WIP：`git stash push -m "<slug>-handoff" -- <列舉自己改的檔>`；**NEVER** `git stash` 不指定路徑（會吃別 session WIP）

執行順序：

1. `/wt <slug>` 建 worktree
2. Selective stash 當前 session 的改動
3. cd 到 worktree、`git stash pop`
4. **明告 user**：「先前對話 Read 過的檔案路徑都對應 main worktree，後續若引用會失效，會重新 Read」
5. 繼續做 acceptance 收尾

### 分支 B：MUST 走 handoff

分支 A 任一條件不成立 → 跑 `/handoff`（Mode A 自動偵測，見 [[handoff]]）。HANDOFF.md `## In Progress` 條目 MUST 含：

- Stop hook 攔點 + missing acceptance criterion
- 當前 session 改過的檔案清單（**若已 selective stash 則註明 stash ref**，例 `stash@{0}: <slug>-handoff`）
- 下一 session oneliner（per §1 oneliner 慣例）：`cd <worktree-path> && claude "<next-skill-invocation>"`

結束當前 session。**NEVER** 為「不想 user 換 session」繞 §1 切 cwd。

### 分支 C：`/handoff` Mode B → `/wt` 內呼 dispatch（非死鎖場景）

跟分支 A / B 不同，**分支 C 不是死鎖 fallback**——它是 `/handoff` Mode B 結束、user 選定下一條工作後的標準接續路徑，目的是消除「請執行 cd ... && claude ...」這個 user UX 痛點。

**觸發條件**（三條都要成立）：

- 當前 session 剛跑完 `/handoff` Mode B 且 user 已透過 AskUserQuestion 選定下一步 change
- 當前 cwd 在 main worktree
- 下一步 change 對應的 skill 需要 worktree（`/spectra-apply` / `/spectra-ingest` / `/spectra-debug` 等寫 code 路徑）

**例外不適用**：

- 下一步是 `/spectra-archive`（main-bound 例外，見 §1）→ `/handoff` 跳過 `/wt`、直接 dispatch archive
- 下一步不動 code（如 `/spectra-ask`、read-only 探索）→ 直接 dispatch、不必 worktree

**執行流程**：

1. `/handoff` Mode B 偵測上述觸發條件成立
2. `/handoff` 透過 Skill tool 內呼 `/wt <slug> --dispatch-from-handoff <next-skill-invocation>`
3. `/wt` 跑 wt-helper add（同既有路徑），**接著遷移 parent cwd** 到新 worktree 路徑
4. `/wt` 印一行確認（path / branch / 「parent session cwd 已遷移、dispatch 中」+ 「先前 Read 過的 path 對應 main worktree，後續若引用會失效、需重新 Read」notice，對齊分支 A 的 stale-path 提醒）
5. `/wt` 透過 Skill tool 內呼 named next skill

**Flag 限制**：`--dispatch-from-handoff` 是內部 flag、**僅** `/handoff` skill 可使用：

- Agent 在其他場景（手動 `/wt`、mid-session 升級成要動 code）**MUST NOT** 自己加這 flag 繞過 default 行為——這是 silent 違規，等同分支 B 路徑該走 `/handoff`
- User 手打 `/wt fix-auth`（沒 flag）**MUST** 走 refuse-and-guide oneliner、不遷 cwd

**Rationale**：handoff 本身就是 session boundary，cd 後 prior context 不會再 reference 舊 cwd 的相對 path。用 flag 而非「Claude 自評 fresh」是因為 self-evaluation 不可靠（同 §7 既有原則：不堆數字門檻是因為 Claude 無法可靠自我觀察 token %）。

**失敗處理**：`/wt --dispatch-from-handoff` 在 worktree 建立失敗時（slug collision、base branch 缺失等）**MUST**：印 wt-helper 錯誤後停下，**不**遷 cwd、**不**呼 next skill。

### 預防原則（比 fallback 更重要）

死鎖根因是 session 開頭判定 read-only、中途升級成要動 code。Session 第一個 turn 偵測到「要動 code 但 cwd 在 main」就 **SHOULD** 立刻吐 oneliner 讓 user 開新 session（per §1「Session 開頭固定動作」），**不要**等到 acceptance 階段才補 worktree。§7 分支 A / B 是 fallback、不是常用路徑；分支 C 是 `/handoff` Mode B 接續的標準路徑、不算 fallback。

## 相關規則

- [[session-tasks]] — 共用時間戳 + slug 慣例
- [[commit]] — staging 區規範（worktree 隔離後 staging 污染風險降到最低）
- [[scope-discipline]] — 「不屬於當前 scope 的 worktree」應該另開 session
- [[handoff]] — §7 分支 B 升級寫入入口
