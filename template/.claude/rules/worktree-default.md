<!--
🔒 LOCKED — managed by clade
Source: rules/core/worktree-default.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

# Worktree Default

> **無 frontmatter — unconditional always-load**。規約意圖是「每個會改 code 的 session 開始時就要判斷是否走 worktree」，必須在 Read 任何檔之前生效。

繁體中文

**核心命題**：multi-session 並行開發共用單一 working tree，staged 區、branch HEAD、partial WIP 都會跨 session 滲漏。最痛的兩次：
- TDMS `bcfde9c8` — `git add -A` 把另一 session 的 WIP + clade 投影層全 stage 起來一起 commit，22 個檔案被推進 origin/main
- `clade publish` — 並行 session 的 feature branch 還 checked out 時直接 publish，把 user 還沒準備好的 commit 一起推 + propagate

git worktree 從根本解掉這兩件事（per-session 獨立檔案系統 + 獨立 HEAD + 獨立 staging）。

操作層面由 `/wt` 全自動 orchestrate — user 不需手動 add / merge / cleanup worktree，主線 session cwd 全程不動，subagent 進 worktree 做事完回來 squash merge。

此規則優先於全域 `~/.claude/CLAUDE.md` 的「git workflow」相關段落（若存在）。

---

## §1 預設用 worktree

要寫、改、刪 tracked file 的工作 **MUST** 在獨立 worktree 內執行，**NEVER** 直接在 main 改。

**操作方式**：user 在 main 直接打 `/wt <task>` — `/wt` 會建 worktree、dispatch subagent 進 worktree 做事、subagent commit 完後主線 squash-merge 把改動 land 到 main 的 working tree、cleanup worktree（細節見 [[wt]]）。主線 chat session 全程 cwd 不動、不切 terminal、不開新 session。

**判定「要動 code」**：使用者請求中出現 implement / fix / refactor / add / edit / 部署準備 / migration / config 寫入 等動詞，且目標是 tracked file。

**例外：read-only session**。只跑 grep / 看 log / 列檔案 / 跑 audit / 查 git history / 解釋 code（不寫檔），**MAY** 在 main worktree。

**例外：main-bound skill（`/spectra-archive`）**。`/spectra-archive` 語意就是「把 change 合併進 main」（mv change folder 進 `openspec/changes/archive/`、delta sync 進 `openspec/specs/<capability>/spec.md`、screenshot sweep、`.spectra/touched/<change>.json` 清理），所有寫入目標都是 main。走 worktree 反而多一道 merge-back，無 isolation benefit。因此 `/spectra-archive` **MAY** 在 main worktree 直接跑。其他 spectra-* skill（`/spectra-apply` / `/spectra-ingest` / `/spectra-debug`）**不在此例外**，仍須走 `/wt` 進 worktree。

**判定「已在 worktree」**：`git rev-parse --git-dir` 結果若包含 `/worktrees/` 子路徑，則 cwd 已在某個 worktree，**不要**疊建新 worktree。User 應直接在當前 worktree 做事。

### §1 invariant：parent session cwd 不動

`/wt` 的所有 invocation form **SHALL NOT** 遷移 parent session 的 cwd。worktree 內的操作由 subagent（cwd = worktree path）執行，主線（cwd = main）負責 dispatch + squash merge + cleanup。

**無例外**。先前 `wt-relax-for-archive-and-handoff` change 引入的 `--dispatch-from-handoff` flag 已**移除**；新的 orchestration model 透過 subagent 隔離 cwd 達到同樣的「user 不切 terminal」UX，且更嚴格地保留 parent cwd invariant。

理由：mid-conversation 切 parent cwd 會破壞 file watcher、Bash tool 內部 cwd state、未完成的 file Read window — 這些是 prior wt-relax design 的主要 risk surface。新 model 完全避開。

## §2 禁止 silent branch 建立

Agent **MUST NOT** 跑 `git checkout -b`、`git branch <name>`、或任何會產生新 ref 的指令，**除非**先取得使用者明確同意。

**唯一例外**：`/wt` 規約定義的 `session/<YYYY-MM-DD-HHMM>-<slug>` 自動命名。這個命名完全由 convention 決定（不是 agent 自由發揮），`/wt` 的 invocation 本身就是 user 對該 branch 的授權。

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

`/wt` 建立 worktree 時已透過 `wt-helper add` 跑 `git merge --ff-only origin/main` 拉 main 最新投影層。一般情況下 worktree 內不需再手動 sync。

## §5 Commit 階段：subagent → 主線 squash → user `/commit`

`/wt` orchestration 跑完後，subagent 在 worktree branch 上有 commit，主線把那些 commit 的內容 squash 進 main 的 working tree（**不** commit），由 user 在 main 跑 `/commit` 收尾。

### Mechanic

1. **Subagent 在 worktree 內 commit**（由 `/wt` Form 1 / 2 / 3 的 prompt template 強制執行）：

   ```bash
   # 在 subagent cwd（= worktree path）
   git add -A
   git commit -m "wt: <slug> — <short>"   # 可多個 commit
   ```

   **NEVER**：`git push` / `/commit` / `/spectra-commit` — 都在 subagent prompt 內顯式禁止。

2. **主線 squash merge**（subagent 完成回報後，由 `/wt` 在 parent cwd 執行）：

   ```bash
   git -C <main-worktree-path> merge --squash <session-branch>
   ```

   `--squash` 把 branch 改動 land 到 main 的 working tree + index，但 **不** 在 main 上生 commit。

3. **主線 cleanup worktree**（squash 成功後）：

   ```bash
   node <main>/scripts/wt-helper.mjs cleanup <slug> --force
   ```

   `--force` 因為 branch 並非真的 merged（squash 不算 git 認知的 merge），不加 `--force` 會被擋。

4. **User 在 main 跑 `/commit`**（時機由 user 決定，可累積多個 `/wt` 的 squash 結果再一次 commit）：

   ```bash
   claude "/commit"        # 或 user 在當前 main session 直接 invoke
   ```

   `/commit` 走 selective stage + 0-A/B/C 品質閘門（lint/type/test）+ commit + push。

### 為什麼這樣設計

- **單一 ceremony**：subagent 在 worktree 是「做事」，main 是「shipping」。subagent 不跑 commit ceremony（lint/test/selective-stage），那由 user 在 main 跑 `/commit` 時一次到位。
- **Branch HEAD 乾淨**：worktree session branch 的 commit 是拋棄式的，cleanup 後 branch 連同 commit 一起消失，main 上線性 commit 從 user 的 `/commit` 發起。
- **`/commit` 0-C 在 main 跑**：`pnpm check` / `pnpm test` 在 main 環境跑，跟後續 push 的 CI 環境一致，避免 worktree-only env 漏跑。
- **User 控制節奏**：squash 自動進 main 但不自動 commit，user 可累積多條 `/wt` 結果再一起 commit，也可 `git diff` 檢查後 selective stage。

### 禁止項

- **NEVER** 在 subagent prompt 內叫它跑 `/commit` / `/spectra-commit` — subagent commit 是拋棄式的，main commit 才是 ceremony
- **NEVER** 在 `/wt` orchestration 自動跑 `/commit` 收尾 — 那會剝奪 user 對 commit 時機的控制
- **NEVER** 在 worktree 內 `git push` session branch — 那條 branch 短命，push 上去只會在 origin 留 stale ref

### Squash conflict fallback

`git merge --squash` 撞 conflict 的觸發條件：主 working tree 上有其他改動（典型情境 — 兩條平行 `/wt` 任務改了同一個檔）跟此 worktree branch 衝突。

依以下順序處理（在 `/wt` SKILL.md 的 Failure handling 段有完整步驟）：

1. **Abort 該次 squash**：`git -C <main> merge --abort` 或 `git -C <main> reset --merge`
2. **保留該 worktree + branch**：**NEVER** cleanup，讓 user 可從 main 跑 `git -C <wt-path> diff` 檢查
3. **不要 force land**：不要 `git checkout --ours` / 自動 rebase — 會丟失 subagent 工作成果

### Subagent fail fallback

Subagent 在 worktree 內跑爆（test fail / abort / 沒 commit 任何東西）：

1. **NEVER** 嘗試 squash（沒 commit 可以 land）
2. **保留 worktree + branch**：user 從 main 用 `git -C <wt-path> log/diff` 檢查
3. **不切 cwd**：parent session 仍在 main，user 不必開新 session 進 worktree 也能看狀態

## §6 操作工具：`/wt` 與 `wt-helper.mjs`

| 動作 | 指令 | 說明 |
| --- | --- | --- |
| 開始 worktree task（推薦入口） | `/wt <task description>` | `/wt` orchestrate 整段 lifecycle，user 不必管 worktree |
| 平行多 task | `/wt A: ... B: ...` | 每 task 一個 worktree，subagent 平行跑，回來 squash 進 main |
| Handoff dispatch（內部） | `/wt <slug>: /<next-skill> <args>` | `/handoff` Mode B 用，subagent 進 worktree 跑指定 skill |
| 列出 session worktree | `node scripts/wt-helper.mjs list` 或 `--json` | 一般不需 |
| 互動清掉 merged worktree | `node scripts/wt-helper.mjs prune` | `/wt` 正常路徑會自己 cleanup；只有 failed worktree 殘留時用 |
| 強制清掉殘留 worktree | `node scripts/wt-helper.mjs cleanup <slug> --force` | 同上 |

`/wt` skill source：`~/offline/clade/plugins/hub-core/skills/wt/SKILL.md`。  
`wt-helper.mjs` source：`~/offline/clade/vendor/scripts/wt-helper.mjs`，散播投影到各 consumer 的 `scripts/wt-helper.mjs`。

## §7 升級路徑與 grandfathered worktree

既有的、命名不符 `session/*` 的 worktree（例如 clade 上的 `[perno-session-treat-publish-untracked]`）**grandfathered**，不強制重命名。`wt-helper list` 與 `prune` 只認 `session/` 前綴的 worktree，舊命名不受影響。

新建一律走 `/wt` + `session/<date>-<slug>` 規約。

## §8 Stop hook 死鎖 fallback

新 orchestration model 大幅降低死鎖機率：因為 `/wt` 在當前 session 直接跑、parent cwd 不動，「Stop hook 攔住 + 要動 code + cwd 在 main」這組情境不再構成死鎖 — 直接打 `/wt <task>` 就解掉。

殘留場景只剩一條：**主線在 main 上累積了當前 session 的 dirty WIP（不是別 session 的）+ Stop hook 攔住 + 還要繼續做**。這時：

- 若剩下的事可以靠 `/wt` 隔離（例如「再加一個 feature」），跑 `/wt <剩下要做的事>`。新 worktree 從 main HEAD 開，看不到主線的 dirty WIP，互不干擾；squash 回來時若不撞同檔就乾淨整合，撞了走 §5 squash conflict fallback。
- 若剩下的事必須在 main 直接處理（罕見），escalate to `/handoff`（Mode A 自動偵測，per [[handoff]]）。HANDOFF.md `## In Progress` 條目應含：Stop hook 攔點 + missing acceptance criterion + 當前 session 改過的檔案清單 + 下一 session oneliner。

**移除**：先前的 §8 分支 A（建 worktree 並切 cwd 繼續）— 主線不切 cwd，新 model 沒這條路徑。先前的 §8 分支 C（`/handoff` 內呼 `/wt --dispatch-from-handoff` 路徑）— flag 已移除，dispatch 改走新 `/wt <slug>: /<next-skill>` form per [[wt]] Form 3。

### 預防原則

Session 開頭判定要動 code 就 **SHOULD** 立刻打 `/wt <task>`，不要先在 main 改一改才想到該開 worktree。這條原則跟前一版本一樣 — 只是現在 `/wt` 是同 session 內的自動 orchestration，不再要求 user 另開 terminal。

## 相關規則

- [[wt]] — `/wt` skill 完整使用手冊（三種 invocation form、subagent contract、failure handling）
- [[session-tasks]] — 共用時間戳 + slug 慣例
- [[commit]] — main 上的 commit ceremony；`/wt` squash 完後 user 跑 `/commit` 的入口
- [[scope-discipline]] — 「不屬於當前 scope 的 worktree」應該另開 `/wt` task
- [[handoff]] — §8 fallback 升級寫入入口；Mode B dispatch 用新 `/wt <slug>: /<next-skill>` form
