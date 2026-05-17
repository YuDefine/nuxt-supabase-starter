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

**例外：main-bound skill（`/spectra-archive`）**。`/spectra-archive` 語意就是「把 change 合併進 main」— 從 v3 開始這語意更嚴格：archive **先吸收**對應的 session worktree（Step 0 跑 `wt-helper merge-back`），再做 archive bookkeeping（mv change folder 進 `openspec/changes/archive/`、delta sync 進 `openspec/specs/<capability>/spec.md`、screenshot sweep、`.spectra/touched/<change>.json` 清理）。所有寫入目標仍是 main。走 worktree 反而多一道 merge-back，無 isolation benefit。因此 `/spectra-archive` **MAY** 在 main worktree 直接跑。其他 spectra-* skill（`/spectra-apply` / `/spectra-ingest` / `/spectra-debug`）**不在此例外**，仍須走 `/wt` 進 worktree。

**判定「已在 worktree」**：`git rev-parse --git-dir` 結果若包含 `/worktrees/` 子路徑，則 cwd 已在某個 worktree，**不要**疊建新 worktree。User 應直接在當前 worktree 做事。

### §1 invariant：parent session cwd 不動

`/wt` 的所有 invocation form **SHALL NOT** 遷移 parent session 的 cwd。worktree 內的操作由 subagent（cwd = worktree path）執行，主線（cwd = main）負責 dispatch + squash merge + cleanup。

**無例外**。先前 `wt-relax-for-archive-and-handoff` change 引入的 `--dispatch-from-handoff` flag 已**移除**；新的 orchestration model 透過 subagent 隔離 cwd 達到同樣的「user 不切 terminal」UX，且更嚴格地保留 parent cwd invariant。

理由：mid-conversation 切 parent cwd 會破壞 file watcher、Bash tool 內部 cwd state、未完成的 file Read window — 這些是 prior wt-relax design 的主要 risk surface。新 model 完全避開。

### §1 Pre-fork baseline guard

Fork 出 worktree 之前（無論透過 `/wt` ad-hoc 或 `/spectra-apply` Step 0 自動 dispatch），`wt-helper add` **MUST** 先跑 `detect-main-dirty` 偵測 main working tree 狀態，再依路徑決定策略：

- **Unmerged 非空** → 永遠 **STOP**，refuse to fork。**NEVER** 自動處理 unmerged paths — 任何操作都可能丟資料。
- **Clean** → 直接 fork（既有行為）。
- **Dirty 非空** → 依 caller 路徑：
  - **Spectra workflow 路徑**（有 change context）走 **commit-then-fork**：主線從 `openspec/changes/<change>/` proposal + specs + `.spectra/touched/<change>.json` 萃取 affected paths（scope-in），呼叫 `wt-helper add ... --precheck-baseline <change> --baseline-strategy commit --baseline-scope-paths <comma>`。Helper 內部 selective stage + commit `baseline: <change> pre-fork sync` 上 main 再 fork。Scope-out（跨 session WIP）留在 main 不動。
  - **Ad-hoc `/wt` 路徑**（無 change context）走 **stash-apply**：`wt-helper add ... --precheck-baseline --baseline-strategy stash`。Helper 內部 `git stash push -u -m wt-baseline/<slug>/<ISO>` 在 main，fork 後 cd 進 worktree `git stash apply` + `git stash drop`。Subagent 收到 [[wt]] Step 2 warn 段落，知道哪些檔是 main 的 starting state、不該動。
  - **Ambiguous**（scope-in 為空但 scope-out 非空、或三來源都對不上）→ **STOP** + 回 user 拍策略。**NEVER** 主線亂猜。

詳細 cookbook（4 種情境 + 完整 trace + scope filter 細節）見 `vendor/snippets/worktree-baseline/`。

**為什麼**：worktree 從 main HEAD 分出，看不到 working tree 的 untracked / modified。沒這道 guard 時 subagent 進 worktree 看 baseline 全缺 fail-fast，主線只能 AskUserQuestion 要 user 拍 baseline strategy（commit / cross-wt stash / 全包同 worktree / inspect first）。Pre-fork guard 讓 main 完成過的 baseline（典型 case：spectra Section 1+2.1 寫了 schema/migration 沒 commit 就轉 Section 2）能進 worktree，避免每次 fork 都打擾 user。

### Anti-pattern：手動 `git stash push -u -- <pathspec>` 做 selective baseline sync

**NEVER** 主線自己跑 `git stash push -u -m "<msg>" -- <pathspec>` 試圖 scope 部分檔案進 stash，再 cd 到別處 `stash apply` 做 cross-worktree baseline sync。

**為什麼禁**：git 2.50.1 (Apple Git-155) 在 dirty working tree 撞到 scope leak — pathspec 正確 scope working tree 端的移除，但 stash commit 包整個 tracked tree 的所有 modifications。apply 到 fresh worktree 會帶進大量 cross-session noise。詳見 [[pitfall-git-stash-pathspec-scope-leak]]。

**正解**：

1. **Worktree baseline sync** → 走 `wt-helper add --precheck-baseline`（§1 上文）。helper internal 對 stash strategy 用 bulk stash（不帶 pathspec）+ subagent prompt warn，避開此 bug
2. **非 worktree 場景的 selective sync** → 用 patch + 檔案複製組合：
   ```bash
   # Tracked file modifications
   git diff --binary -- <paths> | git -C <target> apply

   # Untracked files
   rsync -R <paths> <target>/
   # 或 cp <src> <dst>
   ```
3. **長期 cross-branch sync** → 用 `git format-patch` + `git am`（commit-level transfer，含 message）

**判別**：任何「想把 X、Y、Z 三個檔的改動搬去別 worktree」的場景，**第一反應應該是 wt-helper 或 patch route**，**禁止**自己手寫 `git stash push -u -- <paths>`。

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

## §5 Commit 階段：subagent commit → archive 吸收 → user `/commit`

**v3 atomic landing model**（取代 v2 「`/wt` 返回時 squash」）：

`/wt` orchestration 跑完後，subagent 在 worktree branch 上有 commit，**worktree 連同 branch 保留**（不 squash 不 cleanup）。當該 change 的人工檢查完成、跑 `/spectra-archive <change-name>` 時，archive Step 0 跑 `wt-helper merge-back` 把 worktree atomic 吸收進 main、cleanup worktree，然後做 archive bookkeeping（mv folder、delta sync、screenshot sweep）。User 之後在 main 跑 `/commit` 一次 commit 累積的 diff。

### 為什麼從 v2 改 v3

v2 失敗模式（perno 2026-05-17 session 完整暴露）：

- 多 session 平行 fan-out subagent，各自在 worktree commit → 各自在 main squash → main 累積 cross-session unstaged WIP
- `/commit` 被 `commit.md` 人工檢查 Gate 擋（main/master + 實作 [x] + 人工檢查 [ ]），main 越積越多沒人能 commit
- 別 session 同樣 squash 進 main 後，第 N+1 個 worktree squash 時撞 13 個 blocker 檔（M tasks.md + M code + untracked），需要 7 條 `cross-session-block-*` stash 才強推進去
- `wt-helper cleanup` `--force` vs `--force-discard-unland` 訊息互相 deflect，user 要兩次才知道兩個 flag 都得加
- 5/5 M1 worktree HANDOFF entries stale（branch HEAD 早已 commit P7 但 HANDOFF 還寫「P7 進行中」）

v3 atomic landing 解這些：
- Main 永遠 deployable — 只有 archive 完整通過（含 archive-gate.sh 5 條 hard rule）的 change 才會進
- 多 session 平行不污染 main — 每條 worktree 各自保留到 archive
- 一個 ceremony land 全部（merge-back + cleanup + archive bookkeeping 在 archive Step 0 + Step 6 之間原子完成）
- 人工檢查 Gate 與 archive gate 對齊 — 都是「進 main 的關卡」而非「進 main 後另外擋」

### Mechanic

1. **Subagent 在 worktree 內 commit**（由 `/wt` Form 1 / 2 / 3 的 prompt template 強制執行）：

   ```bash
   # 在 subagent cwd（= worktree path）
   git add -A
   git commit -m "wt: <slug> — <short>"   # 可多個 commit
   ```

   **NEVER**：`git push` / `/commit` / `/spectra-commit` — 都在 subagent prompt 內顯式禁止。

2. **`/wt` 返回時**：**不** squash，**不** cleanup。worktree + branch 保留，主線只報告 status。

3. **`/spectra-archive <change-name>` Step 0 — atomic merge-back**（per [[spectra-archive]] Step 0）：

   ```bash
   node scripts/wt-helper.mjs merge-back <change-name> --auto-stash --noop-if-missing
   ```

   `merge-back` 內部執行：
   - 偵測 main worktree blockers（branch changeset 路徑上的 M / untracked 檔）
   - `--auto-stash`：把 blockers 用 `wt-merge-block/<slug>/<ISO>` 前綴 stash 起來
   - `git merge --squash <branch>` 把 branch 改動 land 到 main 的 working tree（**不** commit）
   - cleanup worktree（`git worktree remove --force` + `git branch -D`）
   - conflict → abort + 復原 stash + 保留 worktree + report
   - `--noop-if-missing`：找不到對應 worktree 時 silent no-op（solo path — change 是直接在 main 做的）

4. **Archive 後續 step**（gates / spec sync / screenshot sweep / archive folder mv）跑於 post-squash main 狀態。所有 gate 檢查看到的是 worktree 工作 + main 既有狀態 merge 後的結果。

5. **User 在 main 跑 `/commit`**（時機由 user 決定，可累積多個 archive 的結果再一次 commit）：

   ```bash
   claude "/commit"        # 或 user 在當前 main session 直接 invoke
   ```

   `/commit` 走 selective stage + 0-A/B/C 品質閘門（lint/type/test）+ commit + push。

   **此時 commit gate 不應被 人工檢查 Gate 擋** — 該 change 已 archive，tasks.md 已 mv 到 `openspec/changes/archive/`，commit.md 人工檢查 Gate 的 scope rule 排除 archive 子目錄。

### Ad-hoc Form-1 worktree（非 spectra change）

`/wt <task>` Form-1 ad-hoc 任務不對應任何 spectra change，因此沒有 `/spectra-archive` 觸發 merge-back。User 要 land 時手動跑：

```bash
node scripts/wt-helper.mjs merge-back <slug> --auto-stash
```

之後同樣走 `/commit` 收尾。

### 禁止項

- **NEVER** 在 subagent prompt 內叫它跑 `/commit` / `/spectra-commit` — subagent commit 是 worktree-local，main commit 才是 ceremony
- **NEVER** 在 `/wt` orchestration 自動跑 `/commit` 收尾 — 那會剝奪 user 對 commit 時機的控制
- **NEVER** 在 worktree 內 `git push` session branch — 那條 branch 短命，push 上去只會在 origin 留 stale ref
- **NEVER** 在 `/wt` 返回時 squash（v3 的核心改動 — squash 推延到 archive）
- **NEVER** 略過 `/spectra-archive` Step 0 直接做 archive bookkeeping — gates 會跑於 false-clean main，產出誤導 archive
- **NEVER** 用 `wt-helper cleanup <slug> --force --force-discard-unland` 不先跑 `merge-back` — 會永久丟失 branch 的 commits。要保留工作必先 `merge-back`

## §5.5 Merge-back ceremony

`wt-helper merge-back <slug>` 是 atomic landing 的核心命令，由 `/spectra-archive` Step 0 自動呼叫，或 user 對 ad-hoc worktree 手動呼叫。

### 命令簽名

```bash
node scripts/wt-helper.mjs merge-back <slug> [flags]
```

| Flag | 行為 |
| --- | --- |
| `--dry-run` | 預覽 blocker 清單，不執行 squash / stash / cleanup |
| `--auto-stash` | 把 main blockers stash 起來（`wt-merge-block/<slug>/<ISO>` 前綴）後再 squash |
| `--no-cleanup` | squash 成功後不 cleanup worktree（debug 用） |
| `--noop-if-missing` | 找不到對應 worktree 時 silent no-op（給 archive hook 用） |

### 預設行為

1. 找 slug 對應的 session worktree（依 branch name `session/<date>-<slug>` + path `<consumer>-wt/<slug>` 比對）。找不到 → 預設 error（除非 `--noop-if-missing`）。
2. 偵測 main worktree 的 blockers：`git diff --name-only main..<branch>` 列出 branch 動過的檔，跟 main `git status --porcelain` 的 M / untracked 路徑取交集。
3. 有 blocker 但無 `--auto-stash` → throw with 建議「re-run with --auto-stash」+ 列出 blocker（最多 10 筆）。
4. 有 `--auto-stash`：`git stash push -u -m "wt-merge-block/<slug>/<ISO>" -- <blocker paths>`，stash entry 保留待 user 後續用 `stash-reconcile.mjs` 處理。
5. 沒 blocker 或 stash 完成 → `git merge --squash <branch>` 把改動 land 到 main 的 working tree + index（**不** commit）。
6. 偵測 conflict：若有 unmerged file，`git merge --abort` + pop 回 stash + 保留 worktree + throw with 衝突檔清單。Worktree + branch 保留供 user 手動 reconcile，user 跑修完後再 `merge-back` 一次。
7. Squash 成功 → 跑 `cmdCleanup(slug, { force: true, forceDiscardUnland: true })` 移除 worktree dir + delete branch。

### Stash reconcile（後續清理）

```bash
node scripts/stash-reconcile.mjs                # 寫 markdown report 到 .spectra/stash-reconcile-<date>.md
node scripts/stash-reconcile.mjs --interactive  # 互動式 apply / drop / view
node scripts/stash-reconcile.mjs --json         # CI-friendly 機器輸出
```

報告會列每條 `wt-merge-block/<slug>/<ISO>` stash + legacy `cross-session-block-*` stash + 殘留的 `wt-baseline/<slug>/<ISO>` stash，給每條建議 `apply` / `drop` / `view-diff first` 加可貼上的 git 命令。

### Stash 命名空間

| 前綴 | 何時產生 | 何時清掉 |
| --- | --- | --- |
| `wt-baseline/<slug>/<ISO>` | `wt-helper add ... --baseline-strategy stash`（§1 Pre-fork baseline guard / `/wt` ad-hoc 路徑）fork 之前 stash main dirty | Fork 後 worktree 內 `git stash apply` 成功就 `git stash drop`；apply 失敗則殘留供手動恢復 |
| `wt-merge-block/<slug>/<ISO>` | `wt-helper merge-back ... --auto-stash` squash 之前 stash main blockers | 保留待 `stash-reconcile.mjs` 後續處理（user 自決 apply / drop） |
| Legacy `cross-session-block-*` | v2 失敗 squash 累積（v3 已不再產生） | `stash-reconcile.mjs` 給建議命令處理 |

`wt-baseline/*` 殘留是 rare — worktree 起步從 main HEAD 分出，stash apply 理論不該衝突，除非 .gitignore 或 worktree-init hook 寫入撞檔。出現時人工 `git stash apply <ref>` 進 worktree 內或 `git stash drop` 放棄。

### 失敗 fallback

| 情境 | 處理 |
| --- | --- |
| Subagent 在 worktree 跑爆（沒 commit）| 保留 worktree + branch；user 從 main `git -C <wt-path> log/diff` 檢查；修完用同一 `/wt` Form 重派 subagent，或 `wt-helper cleanup <slug> --force --force-discard-unland` 放棄 |
| `merge-back` blocker 偵測命中但 user 不想 stash | 不加 `--auto-stash`，user 手動處理 main 上 blocker（commit / stash / discard）後再 `merge-back` |
| `merge-back` squash 撞 conflict（branch 改動跟 main 既有 commit 衝突）| auto-abort + pop stash + 保留 worktree；user 在 worktree 內 rebase / cherry-pick 修衝突後再 `merge-back` |
| `merge-back` 成功但 cleanup 失敗（rare：stale lock）| 改動已在 main、squash 已成功；report 「worktree 殘留」+ 命令 `wt-helper cleanup <slug> --force --force-discard-unland`，user 手動清 |

## §6 操作工具：`/wt`、`wt-helper.mjs`、`stash-reconcile.mjs`

| 動作 | 指令 | 說明 |
| --- | --- | --- |
| 開始 worktree task（推薦入口） | `/wt <task description>` | `/wt` orchestrate build + dispatch + report；不 squash 不 cleanup（v3） |
| 平行多 task | `/wt A: ... B: ...` | 每 task 一個 worktree，subagent 平行跑；各自保留待 archive |
| Handoff dispatch（內部） | `/wt <slug>: /<next-skill> <args>` | `/handoff` Mode B 用，subagent 進 worktree 跑指定 skill |
| 列出 session worktree | `node scripts/wt-helper.mjs list` 或 `--json` | 看 pending worktrees |
| Atomic merge-back | `node scripts/wt-helper.mjs merge-back <slug>` | 把 worktree atomic land 進 main（squash + cleanup） |
| Merge-back 預覽 | `node scripts/wt-helper.mjs merge-back <slug> --dry-run` | 列 blockers 不執行 |
| Merge-back 自動 stash | `node scripts/wt-helper.mjs merge-back <slug> --auto-stash` | main blockers stash 成 `wt-merge-block/<slug>/<ISO>` |
| Land grandfathered worktree | `node scripts/wt-helper.mjs land-pending <slug>` | alias of merge-back，給 v2 留下的 worktree 用（§7 migration） |
| 互動清掉 merged worktree | `node scripts/wt-helper.mjs prune` | 處理 archive 後殘留 |
| 強制清掉 worktree（**丟工作**） | `node scripts/wt-helper.mjs cleanup <slug> --force --force-discard-unland` | 永久砍 branch commits；要保留工作必先 merge-back |
| Stash reconcile 報告 | `node scripts/stash-reconcile.mjs` | 列 `wt-merge-block/*` + legacy `cross-session-block-*` stash + 建議命令 |
| Stash reconcile 互動 | `node scripts/stash-reconcile.mjs --interactive` | 一條一條 apply / drop / view |
| HANDOFF drift scan | `node scripts/handoff-drift-scan.mjs` | 列 worktree branch 跟 HANDOFF.md 不一致；session-start hook 自動跑 |

`/wt` skill source：`~/offline/clade/plugins/hub-core/skills/wt/SKILL.md`。  
`wt-helper.mjs` / `stash-reconcile.mjs` / `handoff-drift-scan.mjs` source：`~/offline/clade/vendor/scripts/`，散播投影到各 consumer 的 `scripts/`。

## §7 升級路徑與 grandfathered worktree

### 命名 grandfather（v1 → v2 既有規約）

既有的、命名不符 `session/*` 的 worktree（例如 clade 上的 `[perno-session-treat-publish-untracked]`）**grandfathered**，不強制重命名。`wt-helper list` 與 `prune` 只認 `session/` 前綴的 worktree，舊命名不受影響。

新建一律走 `/wt` + `session/<date>-<slug>` 規約。

### Migration from pre-atomic worktree flow（v2 → v3）

v2 model：`/wt` 返回時 squash + cleanup。Consumer 端可能有從 v2 留下的 in-flight session worktree，subagent 已 commit 但還沒 squash（user 該 session 終止了 `/wt` 中途，或多 session 累積）。

V3 model 對這些 worktree 的處置：

1. **盤點現有 session worktree**：
   ```bash
   node scripts/wt-helper.mjs list
   ```
   每條都看 branch HEAD 是否 ahead of main（若 ahead = 有未 land 的 commit）。

2. **依 worktree 對應的 spectra change 是否已完成人工檢查**分流：

   - **若該 change 已完成人工檢查、ready archive** → 跑 `/spectra-archive <change-name>`。Archive Step 0 自動 merge-back 吸收 worktree。
   - **若該 change 還在 implementation 中（人工檢查未完）** → 不動 worktree，繼續做。Archive 時自動吸收。
   - **若 worktree 是 ad-hoc Form-1 task（無 spectra change）** → user 自決時機跑 `wt-helper land-pending <slug>`（alias of `merge-back`），手動 land 進 main。
   - **若 worktree 已過時 / 工作不要了** → `wt-helper cleanup <slug> --force --force-discard-unland`（**永久砍 commit**，要保留工作必先 land-pending）。

3. **Legacy `cross-session-block-*` stash**（從 v2 失敗 squash 累積的）：
   ```bash
   node scripts/stash-reconcile.mjs
   ```
   產出 markdown report 含 17 條 perno legacy stash 的建議命令。User 自決定 apply / drop / view。

4. **HANDOFF.md drift**：session-start 時 `handoff-drift-scan.mjs` 自動跑（透過 `session-start-roadmap-sync.sh` hook），對每條 session worktree 比對 branch HEAD 跟 HANDOFF.md 內 slug 提及，drift → stderr 警告。User 看到警告 → 跑 `/handoff` refresh。

### 為什麼需要這條 migration 路徑

V2 → V3 切換時，consumer 端可能正好有 mid-flow 的 worktree（subagent 已 commit 但還沒 squash）。直接套用 V3 規約會讓 `/wt` 不再自動 squash，舊 worktree 永遠不 land。`land-pending` 是 explicit migration tool — 同 `merge-back` 但容忍 multi-commit branch（V2 path 留下的 worktree 通常有多 commit），文件層面更清楚標明「這是給遷移用的」。

## §8 Stop hook 死鎖 fallback

新 orchestration model 大幅降低死鎖機率：因為 `/wt` 在當前 session 直接跑、parent cwd 不動，「Stop hook 攔住 + 要動 code + cwd 在 main」這組情境不再構成死鎖 — 直接打 `/wt <task>` 就解掉。

殘留場景只剩一條：**主線在 main 上累積了當前 session 的 dirty WIP（不是別 session 的）+ Stop hook 攔住 + 還要繼續做**。這時：

- 若剩下的事可以靠 `/wt` 隔離（例如「再加一個 feature」），跑 `/wt <剩下要做的事>`。新 worktree 從 main HEAD 開，看不到主線的 dirty WIP，互不干擾；squash 回來時若不撞同檔就乾淨整合，撞了走 §5 squash conflict fallback。
- 若剩下的事必須在 main 直接處理（罕見），escalate to `/handoff`（Mode A 自動偵測，per [[handoff]]）。HANDOFF.md `## In Progress` 條目應含：Stop hook 攔點 + missing acceptance criterion + 當前 session 改過的檔案清單 + 下一 session 接手指引（直接從 main 跑 `/<next-skill> <change-name>`；apply / ingest / debug 內建 worktree dispatch，archive 直接從 main 跑）。

**移除**：先前的 §8 分支 A（建 worktree 並切 cwd 繼續）— 主線不切 cwd，新 model 沒這條路徑。先前的 §8 分支 C（`/handoff` 內呼 `/wt --dispatch-from-handoff` 路徑）— flag 已移除，dispatch 改走新 `/wt <slug>: /<next-skill>` form per [[wt]] Form 3。

### 預防原則

Session 開頭判定要動 code 就 **SHOULD** 立刻打 `/wt <task>`，不要先在 main 改一改才想到該開 worktree。這條原則跟前一版本一樣 — 只是現在 `/wt` 是同 session 內的自動 orchestration，不再要求 user 另開 terminal。

## 相關規則

- [[wt]] — `/wt` skill 完整使用手冊（三種 invocation form、subagent contract、failure handling）
- [[session-tasks]] — 共用時間戳 + slug 慣例
- [[commit]] — main 上的 commit ceremony；`/wt` squash 完後 user 跑 `/commit` 的入口
- [[scope-discipline]] — 「不屬於當前 scope 的 worktree」應該另開 `/wt` task
- [[handoff]] — §8 fallback 升級寫入入口；Mode B dispatch 用新 `/wt <slug>: /<next-skill>` form
