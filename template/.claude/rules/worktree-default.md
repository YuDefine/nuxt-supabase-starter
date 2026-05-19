<!--
🔒 LOCKED — managed by clade
Source: rules/core/worktree-default.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->

# Worktree Default

> **無 frontmatter — unconditional always-load**。規約意圖是「每個會改 code 的 session 開始時就要判斷是否走 worktree」，必須在 Read 任何檔之前生效。

繁體中文

**核心命題**：multi-session 並行開發共用單一 working tree，staged 區、branch HEAD、partial WIP 都會跨 session 滲漏。

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

### §1.x 階段間 setup chore：主線一行式 `cd` 進 worktree 自動跑

Multi-phase worktree orchestration 中，subagent 完成階段性 commit 後、下一階段 dispatch 之前若需要在 worktree 跑 setup chore（**local-only** 操作），主線 **MUST** 自己用 Bash `cd <worktree-path> && <cmd>` 一行式跑掉，**NEVER** 把指令清單貼給 user 叫他切 cd 去跑。

**為什麼不違反 §1 invariant**：Bash tool 每次呼叫是獨立子 shell，`cd` 只在該子 shell 內生效，session cwd 不變、後續 Bash 呼叫不受影響。invariant 講的是「parent session 的 persistent cwd 不動」（影響 file watcher / Read window / Bash tool state 那種跨呼叫的 sticky cwd），不是「禁止 subshell 內用 cd」。

**為什麼主線該自己跑**：user 已把 worktree orchestration 託付給主線；把「cd 過去跑 4 條命令」chore 推回 user 等於白白拉一輪 context switch + 等回報，違背並行 worktree 自動化的初衷。對齊 [[scope-discipline]] 自給自足、`~/.claude/CLAUDE.md` 自主修 bug / 不要把工作往後放 原則。

**自動代勞 OK 的操作**：
- 依賴安裝：`pnpm install` / `npm install` / `yarn install`
- Local DB 操作：`pnpm db:reset` / `pnpm db:push` / `pnpm db:types` / `pnpm supabase:sync`（worktree 隔離 local DB，不 touch prod）
- Build / lint / test：`pnpm build` / `pnpm lint` / `pnpm test` / `vitest run` / `vp check`
- Type generation：`pnpm db:types` / `tsc --noEmit`
- Project local script：`pnpm <local-script>`（無 push / publish / deploy 副作用）

**仍需 user 拍板的真 destructive**：
- `rm -rf <worktree>` 砍 worktree
- `git push --force` / `git push origin <branch>`（worktree 內 push 已被 §5 禁止）
- Prod DB migration：`supabase db push --linked` / `wrangler d1 execute --remote` / prod-targeting alembic
- Prod creds / secrets：`wrangler secret put`（prod env）/ touch `.env.production`
- Outbound 訊息：Slack / email / GitHub issue / PR comment
- Shared infra：Cloudflare DNS / KV namespace / R2 bucket 改動

**失敗處理**：跑爆了主線自己診斷（讀 error log + `git status` + 修），不要把錯訊息丟回 user 叫他看。

**反模式偵測**（看到自己準備寫這些立刻停手）：
- 「請你在 worktree 跑：\n cd <path>\n pnpm install\n pnpm <cmd>...」
- 「跑完回我 OK，有錯誤貼錯訊息」
- 進度表 + 卡在某 Phase 之間 + 列 N 條 bash 命令叫 user 切 cd 跑

**例外**：user 明確說「我自己跑」「我要先看一下」「先別動」就尊重。

### §1 Pre-fork baseline guard

Fork 出 worktree 之前（無論透過 `/wt` ad-hoc 或 `/spectra-apply` Step 0 自動 dispatch），`wt-helper add` **MUST** 先跑 `detect-main-dirty` 偵測 main working tree 狀態，再依路徑決定策略：

- **Unmerged 非空** → 跑 `classifyUnmergedSafety` 分流：
  - **Safe-resolvable**（檔內無 conflict markers + 無 `.git/MERGE_HEAD` / `REBASE_HEAD` / `rebase-merge/` / `rebase-apply/` / `CHERRY_PICK_HEAD`）→ helper 自動 `git add <paths>` 標 resolved 後 proceed。Stale UU 通常來自上次 merge/rebase 未收尾的 index residue，無資料風險。
  - **Unsafe**（任一條件命中）→ **STOP**，refuse to fork，列每條 unsafe path + reason（`markers` / `merge-head` / `rebase-head` / `cherry-pick-head`）。**NEVER** 自動處理真衝突 / 中段 merge — 任何動作都可能丟資料。
- **Clean** → 直接 fork（既有行為）。
- **Dirty 非空** → 依 caller 路徑：
  - **Spectra workflow 路徑**（有 change context）走 **commit-then-fork**：主線從 `openspec/changes/<change>/` proposal + specs + `.spectra/touched/<change>.json` 萃取 affected paths（scope-in），呼叫 `wt-helper add ... --precheck-baseline <change> --baseline-strategy commit --baseline-scope-paths <comma>`。Helper 內部 selective stage + commit `baseline: <change> pre-fork sync` 上 main 再 fork。Scope-out（跨 session WIP）留在 main 不動。
  - **Ad-hoc `/wt` 路徑**（無 change context）走 **stash-apply**：`wt-helper add ... --precheck-baseline --baseline-strategy stash`。Helper 內部 `git stash push -u -m wt-baseline/<slug>/<ISO>` 在 main，fork 後 cd 進 worktree `git stash apply` → **pin stash sha 到 `refs/wt-baseline/<slug>/<ISO>` 永久 ref** → `git stash drop`（從 stash list 移除但物件仍 reachable）。Subagent 收到 [[wt]] Step 2 warn 段落，知道哪些檔是 main 的 starting state、不該動。Pin 機制：原本 stash drop 後物件變 unreachable，若 worktree 內 baseline 檔沒被任何 commit 帶走，cleanup 砍 worktree 就**永久消失**；pin 後可用 `wt-helper rescue` 列出救回。
  - **Ambiguous**（scope-in 為空但 scope-out 非空、或三來源都對不上）→ **STOP** + 回 user 拍策略。**NEVER** 主線亂猜。

詳細 cookbook（4 種情境 + 完整 trace + scope filter 細節）見 `vendor/snippets/worktree-baseline/`。

#### Stash strategy 的隱性風險（hard rule）

`--baseline-strategy stash` 設計**假設** dirty main = clade projection drift（`.agents/` / `.codex/` / `.claude/` 等 LOCKED 投影層的 lint sync），safe to stash and later drop。**實際 dirty main 可能包含**：

- ✅ clade projection drift（預期）
- ❌ **in-flight feature code 還沒 commit**（屬於某 spectra change 在 `deferred-to-user: db:reset / db:types must run on main before /commit` 之類的 deferred 階段）
- ❌ 另一 parallel session 的 user WIP

stash 不區分這三類，全部一起 push 進 pinned ref + apply 到 worktree。後續 merge-back 撞 conflict 時若 agent 走「reset worktree branch 到 subagent commit + 乾淨 squash + cleanup」（即俗稱 Path X 救援），baseline 中的 in-flight feature code 會從 main working tree 整段消失，只活在 `refs/wt-baseline/<slug>/<ISO>` pinned ref，typecheck / runtime 都不會抓（main HEAD 從沒 commit 過該 feature，import / type 在 HEAD 視角下「合理消失」）。

**Pre-fork audit（agent MUST 跑）**：

```bash
# wt-helper add --baseline-strategy stash 之前
git status --porcelain | grep '^??' \
  | grep -vE '^\?\? (\.agents/|\.codex/|\.claude/)' \
  | head -20
# 非空 → baseline 含非 projection untracked 檔，高機率是 in-flight feature；
# 建議先 commit baseline、或改走 commit-then-fork（如果有 change context）
```

**Merge-back 撞 conflict 時（agent MUST 跑）**：

```bash
# 撞到 'untracked working tree files would be overwritten by merge' 之類
SLUG=<your-slug>
REF=$(git for-each-ref refs/wt-baseline/$SLUG/ --format='%(refname)' | head -1)
git ls-tree -r "$REF^3" --name-only \
  | grep -vE '^(\.agents/|\.codex/|\.claude/(rules|skills|commands|agents|scripts|hooks)/|scripts/wt-helper\.mjs$|AGENTS\.md$|CLAUDE\.md$)' \
  | head -20
# 非空 → baseline 含非 LOCKED projection 路徑，NEVER 走 Path X
# 改走：手動 git checkout "$REF^3" -- <feature-paths> + git checkout "$REF" -- <tracked-modified-paths> 把 baseline 帶回 main，再手動 squash / cherry-pick
```

**Recovery（已撞坑後）**：

```bash
SLUG=<your-slug>
REF=$(git for-each-ref refs/wt-baseline/$SLUG/ --format='%(refname)' | head -1)
# 列消失的檔案
git ls-tree -r "$REF^3" --name-only   # untracked tree（feature 通常在這）
git ls-tree -r "$REF" --name-only      # tracked-modified tree
# 選擇性還原
git checkout "$REF^3" -- <untracked-paths>
git checkout "$REF" -- <tracked-modified-paths>
```

**NEVER**：

- `--baseline-strategy stash` 跑完未 pre-fork audit 就直接 dispatch subagent
- merge-back 撞 conflict 時不查 baseline 內容、直接 `git reset --hard <subagent-commit>` 走 Path X
- cleanup `--force-discard-uncommitted` 不先 `wt-helper rescue` 確認 baseline 內容

完整 root cause + recovery：[`pitfall-pre-fork-baseline-hides-in-flight-feature`](../../docs/pitfalls/2026-05-18-pre-fork-baseline-hides-in-flight-feature.md)。

> Rationale (2026-05-18)：原規約「unmerged 永遠 STOP」過嚴，stale UU（index residue 無實際衝突）會強制 user 介入解 `git add`，跟 worktree 自動化目標衝突。Helper 端兩條 safety check（marker scan + in-progress state 偵測）對 stale 場景 false-positive 風險極低，對真衝突仍 fail-safe。

**為什麼**：worktree 從 main HEAD 分出，看不到 working tree 的 untracked / modified。沒這道 guard 時 subagent 進 worktree 看 baseline 全缺 fail-fast，主線只能 AskUserQuestion 要 user 拍 baseline strategy（commit / cross-wt stash / 全包同 worktree / inspect first）。Pre-fork guard 讓 main 完成過的 baseline（典型 case：spectra Section 1+2.1 寫了 schema/migration 沒 commit 就轉 Section 2）能進 worktree，避免每次 fork 都打擾 user。

### Pre-flight guard 不適用範圍：spectra-propose

`spectra-propose` Step 11 的 `wt-helper add "<change-name>"` 呼叫**預設不帶** `--precheck-baseline`，因此上述整套 dirty / unmerged / scope guard **不適用**於 propose 流程。

**理由**：

- **Step 1–10 不寫 user WIP 路徑**：propose 全程只寫 `openspec/changes/<change-name>/`（proposal.md / design.md / tasks.md / specs/），跟 main 的 staged / modified / untracked 路徑完全不撞檔。
- **Step 11 fork 不在乎 dirty**：`git worktree add` 基於 main HEAD **commit** 分出新 worktree，main 的 working tree state 完全留在 main worktree，不會帶到新 fork。
- **Apply 階段才動 product code**：apply 階段在 propose 建好的 worktree 跑，主 session 的 staged / WIP 留在 main worktree 不被打擾。

**操作守則**：

- 看到 main dirty / staged / unmerged 時**直接** `/spectra-propose <name>`，**NEVER** 反射性建議 user 先 commit / stash / 詢問 staged 內容
- Propose 進行時 main worktree 仍可被其他 session 改動，無 race（propose 只寫 `openspec/changes/<change-name>/`）
- 例外：若 user 的 staged / WIP **就在** `openspec/changes/<change-name>/` 子目錄裡（重跑 propose 同名 change 的場景），先 inspect、跟 user 對齊是否覆蓋 — 但這不是 main dirty 的一般情況，是 path collision 的特殊情況

> Anti-pattern 警示：別把這條鬆綁推廣到 `/spectra-apply` / `/spectra-ingest` / `/spectra-debug` — 這些 skill **會**寫 tracked product code，**仍須**走 §1 Pre-fork baseline guard（apply Step 0 是 commit-then-fork，per [[worktree-default]] §1）。本例外**僅限** propose，因為 propose 的 fork 純粹是「為後續 apply 預備 worktree」，不寫 product code。

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


v3 atomic landing 解這些：
- Main 永遠 deployable — 只有 archive 完整通過（含 archive-gate.sh 5 條 hard rule）的 change 才會進
- 多 session 平行不污染 main — 每條 worktree 各自保留到 archive
- 一個 ceremony land 全部（merge-back + cleanup + archive bookkeeping 在 archive Step 0 + Step 6 之間原子完成）
- 人工檢查 Gate 與 archive gate 對齊 — 都是「進 main 的關卡」而非「進 main 後另外擋」

### Mechanic

**Codex 派工規約**（per [[agent-routing.codex-watch-protocol]] § Commit Authorization）：派 codex 跑 phase 時 **codex 可在 worktree 內 commit**，但 **MUST** 遵守：

- **一 phase 一 commit**：每完成 phase 全部 tasks + 自驗 view-layer + 自驗 scope 後 commit 一次（不可跨 phase 混 commit、不可 `git commit --amend`）
- **Commit message**：`wt: <change>-phase-<N> — <short>` 強制格式（主線用 `git log main..HEAD` 機械化對齊 phase 邊界）
- **`--no-verify`**：commitlint emoji-conventional 會擋 `wt:` prefix
- **Selective stage**：`git add -- <each scoped file>`，**禁止** `git add -A` / `git add .`（會撈到 baseline）
- **Commit 前自跑** view-layer drift check + scope discipline check（命中即 abort，**禁止** commit、回報主線）
- **仍禁止**：`git push` / `git stash`（中途）/ `git commit --amend` / `/commit` / `/spectra-commit`

主線（Claude Code main session 或 `/wt` 派出的 Claude subagent）收到 codex 完工通知後 **MUST**：(1) `git log main..HEAD` 確認 commit 邊界對齊 phase 數量 + format；(2) 跑 view-layer drift double-check 保險；(3) 跑 scope discipline cross-check；(4) drift 發現 → `git -C <wt> reset --soft main` 退 staging + 重派 codex；(5) 跑 typecheck / 相關 test。

本段「Subagent 在 worktree commit」**對 Claude subagent 與 codex 都適用**（兩者規約相同：`wt:` prefix + `--no-verify` + selective stage + self-check）。差別只在 commit message 後綴：Claude subagent 用 `wt: <slug> — <free-form>`，codex 派工強制 `wt: <change>-phase-<N> — <short>` 以利主線對齊 phase。

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

`/wt` 此處故意保留 deferred-landing — 因為 `/wt` 是「通用 worktree 建造器 primitive」，user 可能想連續開多條 worktree、靠 review 完一輪再 land、或讓多 session 累積進度由 `/spectra-archive` 統一吸收。**這條 deferred-landing 例外只屬於 `/wt` 本身**；任何把 `/wt` 包進更大 lifecycle 的 skill 都受下面「Skill-owned worktree lifecycle」管轄。

### Skill-owned worktree lifecycle（auto merge-back contract）

當某 skill **自己** fork worktree（無論透過 `wt-helper add` 直呼或 `/wt` 委派），且該 skill 有**清楚的 end-of-skill 完成點**、**無下游 skill 接手 landing**，則該 skill **MUST** 在完成點自主執行 merge-back + selective stage on main，**NEVER** 把這幾步當「下一步」丟給 user 自己跑。

**典型符合**（自主 land 必為）：

- `/upgrade-packages` — 跑完所有 package codex 派工就是終點，沒下游 skill
- 任何未來「fork worktree 做機械化工作（migration、codemod、bulk rename、批次重構）→ 跑完就收工」的 skill

**典型不符合**（保留 deferred-landing 例外）：

- `/wt`（primitive，per 上節「Ad-hoc Form-1 worktree」）
- `/spectra-apply` — 完成點交給 `/spectra-archive`，archive Step 0 已自動 `wt-helper merge-back --auto-stash --noop-if-missing`（per [[spectra-archive]] Step 0）
- `/spectra-ingest` / `/spectra-debug` — 同 apply，後續 archive 吸收
- `/spectra-propose` — fork 純粹預備 worktree 給後續 apply 寫 product code，propose 本身不寫 product code（per §1「Pre-flight guard 不適用範圍」），無 merge-back 對象

**Auto merge-back 標準流程**（skill 內部實作必含）：

1. **主線 cd 回 main consumer root**：merge-back 完成會 cleanup worktree，parent session cwd 若還停在 worktree 內會撞「no such file or directory」；先跑 `MAIN_PATH=$(git worktree list --porcelain | head -1 | awk '{print $2}'); cd "$MAIN_PATH"`
2. **跑 `node scripts/wt-helper.mjs merge-back <slug> --auto-stash`**：捕捉 stdout/stderr
3. **Pre-fork baseline blocker 自動清理**：撞 `merge-back blocked: worktree '<wt>' has N uncommitted edit(s)` 時，解析 blocker paths，對每條跑 `git -C <wt-path> checkout HEAD -- <path>` 退回 HEAD，再重跑 merge-back。**安全性**靠 §1 Pre-fork baseline guard 的 pinned `refs/wt-baseline/<slug>/<ISO>` 永久 ref 兜底（IDENTICAL data 在 main 還在、DIVERGED 可用 `wt-helper rescue --show <ref>` 救回）
4. **真衝突（pre-sync / squash conflict）STOP**：wt-helper 已內部 abort + 救 stash + 保留 worktree；skill **NEVER** 主線自決，AskUserQuestion 給 user 拍板（手動解 / 丟掉 / 先看一下）
5. **Selective stage on main**：merge-back 成功後 main 上有 squash diff + 並行 session 的 staged WIP；skill **MUST** 跑 `git reset HEAD && git add <skill 範圍檔>`（**禁止** `git add -A` / `git add .`），把並行 session 的 staged WIP 退回 unstaged 留 working tree
6. **NEVER 自動 `/commit`**：commit 時機 / message / sign-off 留給 user（per 「禁止項」）

**摘要彙報硬性**：skill 結束前**必印**摘要含「worktree absorbed + cleaned」「main staged 了哪些檔」「並行 session WIP 退回 unstaged」「下一步走 `/commit`」四要素，讓 user 知道現況不必猜。

**例外**：user 在 skill 啟動前明確說「先別 land」/「我要 review worktree 內容」/「保留 worktree」等字眼 → skill 跳過 auto merge-back，只印手動指令清單。**NEVER** 主動延遲 — 預設一律自主完成。

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
| `--dry-run` | 預覽 blocker + worktree WIP 清單，不執行 squash / stash / cleanup |
| `--auto-stash` | 把 main blockers stash 起來（`wt-merge-block/<slug>/<ISO>` 前綴）後再 squash |
| `--include-worktree-wip` | Worktree 內有 uncommitted user WIP 時自動 `git add -- <paths> && git commit --amend --no-edit` 到 branch HEAD。**不建議** — 顯式 commit 比較安全（commit message 有語意） |
| `--no-cleanup` | squash 成功後不 cleanup worktree（debug 用） |
| `--noop-if-missing` | 找不到對應 worktree 時 silent no-op（給 archive hook 用） |
| `--skip-pre-sync` | 跳過 wt-side pre-sync 直接 squash（emergency / 確知無交集；不建議——衝突會落在 main 不在 wt） |

### 預設行為

1. 找 slug 對應的 session worktree（依 branch name `session/<date>-<slug>` + path `<consumer>-wt/<slug>` 比對）。找不到 → 預設 error（除非 `--noop-if-missing`）。
2. **偵測 worktree 內 uncommitted user WIP**：`git -C <wtPath> status --porcelain` 列出 modified + untracked，過濾掉 clade-managed projection（`.agents/`、`.codex/`、`.claude/hub.json`、`.claude/.hub-state.json`、`scripts/wt-helper.mjs`），剩下的就是 user WIP。**有 user WIP 但無 `--include-worktree-wip` → throw with 修法**：建議 user `cd <wtPath> && git add <files> && git commit --amend --no-edit` 後再回來跑 merge-back。Atomic-landing 要求 worktree 的所有 user 變更都要 commit，否則 `git merge --squash` 不會帶走，cleanup 還會永久砍掉。**有 `--include-worktree-wip` → auto-amend**（不建議；commit message 會空）。
2.5. **Pre-sync wt with main**（預設開啟；`--skip-pre-sync` 關閉）：在 `<wtPath>` 跑 `git fetch origin main`（若 `origin/main` 存在；否則用 local main）+ `git rev-list --count <branch>..<targetRef>` 算落差。落差為 0 → no-op。落差 > 0 → `git merge --no-ff -m "wt: pre-sync main into <branch>" <targetRef>` 把 main 灌進 wt 分支。Conflict 留在 wt 內（不 auto-abort），main working tree **完全不動**；user 在 wt 解完衝突 + commit 後重跑 merge-back。設計動機：把衝突隔離在 wt path，避免汙染 main（過往 squash conflict 一炸 main 就要靠 stash 救，多次造成 publish / propagate 流程不穩——對應 `clade_publish_interleaved_wip_same_file` / `clade_propagate_stash_pop_loop` 教訓）。
3. 偵測 main worktree 的 blockers：`git diff --name-only main..<branch>` 列出 branch 動過的檔，跟 main `git status --porcelain` 的 M / untracked 路徑取交集。
4. 有 blocker 但無 `--auto-stash` → throw with 建議「re-run with --auto-stash」+ 列出 blocker（最多 10 筆）。
5. 有 `--auto-stash`：`git stash push -u -m "wt-merge-block/<slug>/<ISO>" -- <blocker paths>`，stash entry 保留待 user 後續用 `stash-reconcile.mjs` 處理。
6. 沒 blocker 或 stash 完成 → `git merge --squash <branch>` 把改動 land 到 main 的 working tree + index（**不** commit）。
7. 偵測 conflict：若有 unmerged file，`git merge --abort` + pop 回 stash + 保留 worktree + throw with 衝突檔清單。Worktree + branch 保留供 user 手動 reconcile，user 跑修完後再 `merge-back` 一次。
8. Squash 成功 → 跑 `cmdCleanup(slug, { force: true, forceDiscardUnland: true })` 移除 worktree dir + delete branch。

**為什麼步驟 2 必要**：worktree 的「helper 在 commit、wiring 在 working tree」切錯型錯誤是無聲 footgun — 沒這道 check 時 squash 只搬 commit，cleanup 把 worktree 砍掉，wiring WIP 永久遺失沒 recovery path（baseline ref 只 cover fork 前 main 的 WIP，沒 cover worktree 內事後新增的 user edit）。

### Stash reconcile（後續清理）

```bash
node scripts/stash-reconcile.mjs                       # 寫 markdown report 到 .spectra/stash-reconcile-<date>.md
node scripts/stash-reconcile.mjs --interactive         # 互動式 apply / drop / view
node scripts/stash-reconcile.mjs --json                # CI-friendly 機器輸出
node scripts/stash-reconcile.mjs --slug <slug>         # 只看跟某 slug 相關的 stash（merge-back 收尾 hint 會帶這 flag）
node scripts/stash-reconcile.mjs --stale-days 7        # 只看 >7d 的；handoff Mode B §2B.1.5 用此模式掃 audit
node scripts/stash-reconcile.mjs --include-all         # 含 unnamespaced（手命名 / legacy 雜項）
```

報告會列每條 namespaced stash + 殘留 baseline stash，給每條建議 `apply` / `drop` / `view-diff first` 加可貼上的 git 命令。**永遠不 auto-pop / auto-stage / auto-commit**：apply 後 user WIP 在 working tree，必須走 `/spectra-commit` 或 `/commit` 的 selective stage（**禁止** `git add -A`）。

`wt-helper merge-back` 成功收尾若產出 `wt-merge-block/<slug>/<ISO>` stash，自動印 reconcile hint 帶 `--slug <slug>` 參數，user 直接複製貼上即可走互動流程。

### Stash 命名空間

| 前綴 / 樣態 | 何時產生 | 何時清掉 |
| --- | --- | --- |
| `wt-baseline/<slug>/<ISO>` (stash list) | `wt-helper add ... --baseline-strategy stash`（§1 Pre-fork baseline guard / `/wt` ad-hoc 路徑）fork 之前 stash main dirty | Fork 後 worktree 內 `git stash apply` 成功 → pin sha 到 `refs/wt-baseline/<slug>/<ISO>` 永久 ref → `git stash drop` 從 stash list 移除（物件仍 reachable）；apply 失敗則殘留供手動恢復；殘留時 `stash-reconcile` 偵測對應 `refs/wt-baseline/` 已 pin 會推薦 `drop` |
| `wt-final-baseline/<slug>/<ISO>` | `wt-helper add` 變種（rare：second snapshot 在 apply 前/後） | 同上；`stash-reconcile` 視為 `wt-baseline` 等價處理 |
| `refs/wt-baseline/<slug>/<ISO>` (永久 ref) | 由 `wt-helper add --baseline-strategy stash` 在 apply 成功後 pin（2026-05-17 後） | **不自動清** — 由 `wt-helper rescue --prune <ref>` 或 user 手動 `git update-ref -d <ref>` 釋放給 gc。設計理念：救援優先於 ref namespace 整潔 |
| `wt-merge-block/<slug>/<ISO>` | `wt-helper merge-back ... --auto-stash` squash 之前 stash main blockers | merge-back 收尾印 `--slug <slug>` reconcile hint，user 跑 `stash-reconcile --interactive` 自決 apply / drop |
| `clade-propagate-v<ver>-<ts>` | `scripts/propagate.mjs` dirty consumer 流程 stash pop 失敗時保留（v0.3.45+） | publish 收尾跑 `stash-reconcile --include-all --stale-days 1` 收掉；通常 user WIP 已自動 restore，stash 可 drop |
| `clade-publish: <free-form>` | clade-publish skill Step 3 selective stage 前 user 手動 stash 並行 session WIP | publish + propagate 收尾跑 `stash-reconcile --interactive` 看 recommendAction 自決 |
| Legacy `cross-session-block-*` | v2 失敗 squash 累積（v3 已不再產生） | `stash-reconcile` 給建議命令處理 |
| spectra-apply phase suffixes（`-baseline-drift` / `-p7-wip` / 其他） | spectra-apply / change 內部 phase 切換時手動 stash | `stash-reconcile` 偵測 change 是否 archive，已 archive 推薦 `view-diff` 再決定 drop |

`wt-baseline/*` stash 殘留是 rare — worktree 起步從 main HEAD 分出，stash apply 理論不該衝突，除非 .gitignore 或 worktree-init hook 寫入撞檔。出現時用 `stash-reconcile --slug <slug>` 看建議或人工 `git stash apply <ref>` 進 worktree 內 / `git stash drop` 放棄。

`refs/wt-baseline/*` 永久 ref 是事故救援的最後保險絲：subagent 守 scope discipline 只 commit 它的範圍時，baseline 47+ 檔可能整批留在 worktree working tree 但沒被任何 commit 帶走；merge-back squash 不會帶走未 commit 檔，cleanup `--force-discard-uncommitted` 才會砍 worktree。即使整條鏈走完導致 working tree 消失，`refs/wt-baseline/` 還活著 → `wt-helper rescue --show <ref>` 看 patch → `git stash apply <ref>` 或 `git checkout <ref> -- <paths>` 救回。

### 失敗 fallback

| 情境 | 處理 |
| --- | --- |
| Subagent 在 worktree 跑爆（沒 commit）| 保留 worktree + branch；user 從 main `git -C <wt-path> log/diff` 檢查；修完用同一 `/wt` Form 重派 subagent，或 `wt-helper cleanup <slug> --force --force-discard-unland` 放棄 |
| `merge-back` blocker 偵測命中但 user 不想 stash | 不加 `--auto-stash`，user 手動處理 main 上 blocker（commit / stash / discard）後再 `merge-back` |
| `merge-back` pre-sync 撞 conflict（branch 改動跟 main 既有 commit 衝突）| Wt 留在 unmerged 狀態（**不** auto-abort），main working tree 不動；user 在 wt path 內解 conflict markers + `git commit --no-edit` 完成 merge commit 後重跑 `merge-back`。常見情境：multi-day session 期間 main 推進到撞同檔。 |
| `merge-back` squash 撞 conflict（pre-sync 後 rare：branch 改動跟 main 取交集仍 conflict）| auto-abort + pop stash + 保留 worktree；user 在 worktree 內 rebase / cherry-pick 修衝突後再 `merge-back`。**若用 `--skip-pre-sync` 跳過 pre-sync**，conflict 會直接炸在 main 的 working tree（legacy path），救法同此列。 |
| `merge-back` 成功但 cleanup 失敗（rare：stale lock）| 改動已在 main、squash 已成功；report 「worktree 殘留」+ 命令 `wt-helper cleanup <slug> --force --force-discard-unland`，user 手動清 |
| `cleanup` 拒絕：worktree 內有 uncommitted（典型：pre-fork baseline 沒被 commit 帶走）| `--force-discard-uncommitted` gate 擋住 — 別急著加 flag。先 `wt-helper rescue` 列 pinned baseline ref，用 `--show <ref>` 看 patch 確認哪些是真要救的；要救的用 `git checkout <ref> -- <paths>` 撈進 main 再 cleanup |

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
| 強制清掉 worktree（**丟工作**） | `node scripts/wt-helper.mjs cleanup <slug> --force --force-discard-unland --force-discard-uncommitted` | 永久砍 branch commits + worktree 內未 commit 檔；要保留工作必先 merge-back + 從 `wt-helper rescue` 撈 baseline |
| List pre-fork baseline 救援候選 | `node scripts/wt-helper.mjs rescue` | 列 `refs/wt-baseline/*` pinned ref + fsck dangling stash；`--show <ref\|sha>` 看 patch（read-only） |
| Stash reconcile 報告 | `node scripts/stash-reconcile.mjs` | 列 namespaced stash（含 `wt-merge-block/*`、`wt-baseline/*`、`clade-publish:*`、`clade-propagate-v*`、legacy `cross-session-block-*`、spectra-apply phase suffix）+ 建議命令 |
| Stash reconcile 互動 | `node scripts/stash-reconcile.mjs --interactive` | 一條一條 apply / drop / view（never auto-pop） |
| Stash reconcile by slug | `node scripts/stash-reconcile.mjs --slug <slug>` | merge-back 收尾 hint 帶此 flag，只看跟此 slug 相關的 stash |
| Stash reconcile stale 掃描 | `node scripts/stash-reconcile.mjs --stale-days 7` | 只看 >7d；handoff Mode B §2B.1.5 用此模式 |
| HANDOFF drift scan | `node scripts/handoff-drift-scan.mjs` | 列 worktree branch 跟 HANDOFF.md 不一致；session-start hook 自動跑 |

`/wt` skill source：`~/offline/clade/plugins/hub-core/skills/wt/SKILL.md`。  
`wt-helper.mjs` / `stash-reconcile.mjs` / `handoff-drift-scan.mjs` source：`~/offline/clade/vendor/scripts/`，散播投影到各 consumer 的 `scripts/`。

## §7 升級路徑與 grandfathered worktree

### 命名 grandfather（v1 → v2 既有規約）

既有的、命名不符 `session/*` 的 worktree（例如 clade 上的 `[<consumer-a>-session-treat-publish-untracked]`）**grandfathered**，不強制重命名。`wt-helper list` 與 `prune` 只認 `session/` 前綴的 worktree，舊命名不受影響。

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
   產出 markdown report 含 17 條 <consumer-a> legacy stash 的建議命令。User 自決定 apply / drop / view。

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

## §9 spectra DB 跨 worktree 共享心智模型

`.git/spectra-app/spectra.db` 是 **單一 SQLite 檔案、跨所有 worktree 共享**（住在 `.git/` 共用目錄）。從任何 worktree 跑 `spectra list / status / park / unpark / archive / task done` 都讀寫同一個 DB。後果：

- `spectra list` 從 main 跑會列出 **所有 sibling worktree 內的 active change**（不只 main disk 上看得到的）
- 「main disk 沒對應 directory + spectra list 顯示 active + spectra park/unpark 回 'does not exist' / 'is not parked'」**不**代表 zombie / DB 髒；多半是別 session 在 sibling worktree 物化內容


### MUST

- **NEVER** 對 `.git/spectra-app/spectra.db` 跑 `DELETE` / `UPDATE` / `INSERT` — 跨 worktree 共享，本 session 的 surgery 會影響別 worktree 的 in_progress / parked / archived state
- **NEVER** 把「main disk 無 directory + spectra list 顯示 active + park/unpark 失敗」直接判為 zombie 或系統性 bug
- 偵測 "zombie" 前 **MUST** 先跑：
  - `git worktree list` 看是否有 sibling worktree
  - `find ~/offline/<consumer>-wt -path "*<change-name>*"` 找實際物化位置
  - `mdfind "<change-name>"` 全機 search 確認沒漏
- 啟動 active / parked change `apply` 前 **MUST** 先 `git worktree list`，確認別 session 沒在同一 change 上做（避免雙 session apply 同一 change）

### Workaround / Recovery

碰到看似 zombie pattern 一律 **STOP + AskUserQuestion**，不擅自 DB surgery。

若已誤動 DB：`cp /tmp/spectra-db-backup-*.db .git/spectra-app/spectra.db` restore（前提是 session 內有先 backup；若未 backup，看 `.git/logs/` 或 SQLite WAL 復原可能性）。

### 可選 helper

未來可加 `vendor/scripts/spectra-worktree-check.mjs` 對 `<change-name>` 比對 main disk vs sibling worktree disk，輸出物化位置，避免每次 session 手動跑 `find` / `mdfind`。

## §10 review-gui 與 worktree 互動的已知坑

`vendor/scripts/review-gui.mts` 跑 home page 時要從多個 worktree（main + active worktree disks）aggregate `openspec/changes/`。aggregation 邏輯與 singleton process 有 3 條已記錄的踩坑（看到對應 symptom 時直接跳 pitfall 不要重 debug）：

- **home list silent skip main change** — active worktree 存在時 `listPendingChanges` 可能 silent skip main 上的 change（個別 `/api/changes/<name>` detail 仍能取到）。見 [[pitfall-review-gui-collision-typo-and-worktree-startup]]
- **source aggregation collision** — main 端 hook 報 0 violation 但 GUI 顯示 N hits + banner 顯示無關 worktree slug → review-gui 對 worktree-inherited-untouched files 過度 prefer worktree 副本。見 [[pitfall-review-gui-source-aggregation-collision]]
- **apply-pending 群 batch button 陷阱** — 「等 apply 後就可處理」群把 impl 完成度天差地別的 change 混在一起；按 batch evidence button 前 **MUST** spot check 每張 change impl 完成度（§3 UI / §6 Fixtures 沒做完按下去會把 agent 推進 404 trap）。見 [[pitfall-review-gui-apply-pending-mid-apply-changes]]

review-gui singleton 跑在共享 SQLite 端口；改 review-gui.mts 後 consumer 端需 `pnpm review:ui:kill` + `pnpm review:ui` 重啟才會吃到新版（與 §9 spectra DB 共享心智模型同源）。

## 相關規則

- [[wt]] — `/wt` skill 完整使用手冊（三種 invocation form、subagent contract、failure handling）
- [[session-tasks]] — 共用時間戳 + slug 慣例
- [[commit]] — main 上的 commit ceremony；`/wt` squash 完後 user 跑 `/commit` 的入口
- [[scope-discipline]] — 「不屬於當前 scope 的 worktree」應該另開 `/wt` task
- [[handoff]] — §8 fallback 升級寫入入口；Mode B dispatch 用新 `/wt <slug>: /<next-skill>` form
