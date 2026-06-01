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

### §1 archive-on-main 的 clobber 窗口（pitfall 2026-06-01）

archive-on-main 例外讓「已驗證但未 commit 的 archive batch」躺在 **shared main working tree**；若 `/commit` 因 gate（0-C / codex / 人工檢查）halt，這批 dirty 會**長期**留在 main。多 session 並行時，**別 session 的 `wt-helper add --baseline-strategy stash`** 會把它當 unclaimed dirty bulk-stash 捲走（已實證：archive batch + 收尾 follow-up 36 檔被別 session fork 捲進 `refs/wt-baseline/*`，working tree 清空 — 見 `docs/pitfalls/2026-06-01-prefork-baseline-stash-sweeps-unclaimed-main-work.md`）。

**MUST**（縮短 / 消除窗口）：

- **archive 收尾的 follow-up fix（修測試 / 補 code / 加 migration）走 `/wt` 進隔離 worktree**，**NEVER** 在 main working tree 累積多步 in-flight 工作等 commit。archive bookkeeping 本身（mv folder / delta sync）才 MAY 在 main 跑，後續 code fix 不是。
- `/commit` 因可恢復的 gate 失敗 halt 時，若 batch 需要進一步 code 改動才能過 gate，**SHOULD** 立即把 batch 移進隔離 worktree（restore + 從那邊修 + commit），不要留在 shared main 邊修邊等。
- 跨多步在 main 累積 batch 且無法立刻 commit 時，**SHOULD** 寫 coarse claim 保護（見 [[session-claims]] § 主線無 claim 的保護缺口）。

### §1 invariant：parent session cwd 不動

`/wt` 的所有 invocation form **SHALL NOT** 遷移 parent session 的 cwd。worktree 內的操作由 subagent（cwd = worktree path）執行，主線（cwd = main）負責 dispatch + squash merge + cleanup。

**無例外**。先前 `wt-relax-for-archive-and-handoff` change 引入的 `--dispatch-from-handoff` flag 已**移除**；新的 orchestration model 透過 subagent 隔離 cwd 達到同樣的「user 不切 terminal」UX，且更嚴格地保留 parent cwd invariant。

理由：mid-conversation 切 parent cwd 會破壞 file watcher、Bash tool 內部 cwd state、未完成的 file Read window — 這些是 prior wt-relax design 的主要 risk surface。新 model 完全避開。

### §1.x 階段間 setup chore：主線一行式 `cd` 進 worktree 自動跑

Multi-phase orchestration 中，phase 切換之間若需在 worktree 跑 **local-only** setup chore，主線 **MUST** 用 Bash `cd <wt> && <cmd>` 一行式自跑，**NEVER** 把指令清單推回 user。Bash 每呼叫是獨立子 shell，subshell `cd` 不影響 parent session cwd（§1 invariant 講的是 sticky cwd，不是禁 subshell cd）。

**自動代勞 OK**：`pnpm install` / `pnpm db:reset` / `pnpm db:push` / `pnpm db:types` / `pnpm supabase:sync` / `pnpm build` / `pnpm lint` / `pnpm test` / `vp check` / `tsc --noEmit` / local pnpm script（無 push/publish/deploy 副作用）。

**仍需 user 拍板（真 destructive）**：`rm -rf <wt>`、`git push --force` / `git push origin`（已被 §5 禁）、Prod DB migration（`supabase db push --linked` / `wrangler d1 execute --remote`）、Prod creds（`wrangler secret put`、`.env.production`）、outbound 訊息、shared infra。

**失敗處理**：跑爆主線自己診斷（讀 log + `git status` + 修），不丟回 user。

**反模式**（立刻停手）：列「請你 cd 過去跑」清單、進度表卡在 phase 間貼 N 條 bash 叫 user 切 cd 跑、「跑完回我 OK」。

**例外**：user 明確說「我自己跑」/「先別動」尊重。

### §1 Pre-fork baseline guard

Fork 出 worktree 之前（無論透過 `/wt` ad-hoc 或 `/spectra-apply` Step 0 自動 dispatch），`wt-helper add` **MUST** 先跑 `detect-main-dirty` 偵測 main working tree 狀態，再依路徑決定策略：

- **Unmerged 非空** → 跑 `classifyUnmergedSafety` 分流：
  - **Safe-resolvable**（檔內無 conflict markers + 無 `.git/MERGE_HEAD` / `REBASE_HEAD` / `rebase-merge/` / `rebase-apply/` / `CHERRY_PICK_HEAD`）→ helper 自動 `git add <paths>` 標 resolved 後 proceed。Stale UU 通常來自上次 merge/rebase 未收尾的 index residue，無資料風險。
  - **Unsafe**（任一條件命中）→ **STOP**，refuse to fork，列每條 unsafe path + reason（`markers` / `merge-head` / `rebase-head` / `cherry-pick-head`）。**NEVER** 自動處理真衝突 / 中段 merge — 任何動作都可能丟資料。
- **Clean** → 直接 fork（既有行為）。
- **Dirty 非空** → 依 caller 路徑：
  - **Spectra workflow 路徑**（有 change context）走 **commit-then-fork**：主線從 `openspec/changes/<change>/` proposal + specs + `.spectra/touched/<change>.json` 萃取 affected paths（scope-in），呼叫 `wt-helper add ... --precheck-baseline <change> --baseline-strategy commit --baseline-scope-paths <comma>`。Helper 內部 selective stage + commit `baseline: <change> pre-fork sync` 上 main 再 fork。Scope-out（跨 session WIP）留在 main 不動。
    - **`--baseline-scope-paths` MUST 對齊 proposal `## Impact` `Affected code` 列的*每一條* scope-in path，NEVER 過度保守只挑核心 code**。漏帶的 scope-in path 會留在 main，導致同一條 change 的改動分散在 main + worktree 兩處（scope 分裂），後續才發現難收斂。實證：<consumer-a> `per-client-module-isolation` 漏帶 §2.4 的 workflows / playwright / package.json / e2e（全屬該 change scope-in），補 §2.1 時才發現。Detection：fork 後 `git status` 若 main 仍有該 change proposal `## Impact` 列的 dirty path = baseline 漏帶。
  - **Ad-hoc `/wt` 路徑**（無 change context）走 **stash-apply**：`wt-helper add ... --precheck-baseline --baseline-strategy stash`。Helper 內部 `git stash push -u -m wt-baseline/<slug>/<ISO>` 在 main，fork 後 cd 進 worktree `git stash apply` → **pin stash sha 到 `refs/wt-baseline/<slug>/<ISO>` 永久 ref** → `git stash drop`（從 stash list 移除但物件仍 reachable）。Subagent 收到 [[wt]] Step 2 warn 段落，知道哪些檔是 main 的 starting state、不該動。Pin 機制：原本 stash drop 後物件變 unreachable，若 worktree 內 baseline 檔沒被任何 commit 帶走，cleanup 砍 worktree 就**永久消失**；pin 後可用 `wt-helper rescue` 列出救回。
  - **Ambiguous**（scope-in 為空但 scope-out 非空、或三來源都對不上）→ **STOP** + 回 user 拍策略。**NEVER** 主線亂猜。

詳細 cookbook（4 種情境 + 完整 trace + scope filter 細節）見 `vendor/snippets/worktree-baseline/`。

#### Stash strategy 的隱性風險（hard rule）

`--baseline-strategy stash` **假設** dirty main = clade projection drift（safe to stash）。**實際**可能含 in-flight feature code 或別 session WIP，stash 不區分全部 push 進 pinned ref。後續 merge-back 撞 conflict 走 Path X 救援會讓 feature 從 main 整段消失（只活在 `refs/wt-baseline/` ref，typecheck 不抓）。

**NEVER**：
- `--baseline-strategy stash` 跑完未 pre-fork audit 就直接 dispatch subagent
- merge-back 撞 conflict 時不查 baseline 內容、直接 `git reset --hard <subagent-commit>` 走 Path X
- cleanup `--force-discard-uncommitted` 不先 `wt-helper rescue` 確認 baseline 內容

完整 audit script / conflict diagnostic / recovery 命令：[`pitfall-pre-fork-baseline-hides-in-flight-feature`](../../docs/pitfalls/2026-05-18-pre-fork-baseline-hides-in-flight-feature.md)。

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
- **Commit message**：`🧹 chore: wt <change>-phase-<N> — <short>` 強制格式（emoji-conventional commitlint 合規；主線用 `git log main..HEAD --grep "^🧹 chore: wt "` 機械化對齊 phase 邊界）
- **不繞 hook**：pre-commit / commit-msg hook 正常跑，**禁止** `--no-verify`（per [[commit]] hard rule，主線/subagent/codex 一視同仁）
- **Selective stage**：`git add -- <each scoped file>`，**禁止** `git add -A` / `git add .`（會撈到 baseline）
- **Commit 前自跑** view-layer drift check + scope discipline check（命中即 abort，**禁止** commit、回報主線）
- **仍禁止**：`git push` / `git stash`（中途）/ `git commit --amend` / `/commit` / `/spectra-commit`

主線（Claude Code main session 或 `/wt` 派出的 Claude subagent）收到 codex 完工通知後 **MUST**：(1) `git log main..HEAD` 確認 commit 邊界對齊 phase 數量 + format；(2) 跑 view-layer drift double-check 保險；(3) 跑 scope discipline cross-check；(4) drift 發現 → `git -C <wt> reset --soft main` 退 staging + 重派 codex；(5) 跑 typecheck / 相關 test。

本段「Subagent 在 worktree commit」**對 Claude subagent 與 codex 都適用**（兩者規約相同：`🧹 chore: wt …` 前綴 + selective stage + self-check + hook 必跑）。差別只在 subject 後綴：Claude subagent 用 `🧹 chore: wt <slug> — <free-form>`，codex 派工強制 `🧹 chore: wt <change>-phase-<N> — <short>` 以利主線對齊 phase。

1. **Subagent 在 worktree 內 commit**（`/wt` prompt template 強制）：`git add -- <scoped file>` selective stage（**禁止** `git add -A`） + `git commit -m "🧹 chore: wt <slug> — <short>"`，可多 commit，pre-commit / commit-msg hook 必跑。**NEVER**：`git push` / `/commit` / `/spectra-commit`。
2. **`/wt` 返回時**：**不** squash，**不** cleanup。worktree + branch 保留，主線只報告 status。
3. **`/spectra-archive <name>` Step 0 — atomic merge-back**：跑 `node scripts/wt-helper.mjs merge-back <name> --auto-stash --noop-if-missing`。內部：偵測 main blockers → `--auto-stash` 把 blockers stash 成 `wt-merge-block/<slug>/<ISO>` → `git merge --squash <branch>` land 進 main → cleanup worktree；conflict → abort + 復原 stash + 保留 worktree。
4. **Archive 後續 step**（gates / spec sync / screenshot sweep / folder mv）跑於 post-squash main，gate 檢查看到 merge 後結果。
5. **User 在 main 跑 `/commit`**（時機 user 決定，可累積多 archive 再一次 commit）：selective stage + 0-A/B/C 品質閘門 + commit + push。Archive 後 tasks.md 已 mv 到 `openspec/changes/archive/`，commit.md 人工檢查 Gate scope rule 排除 archive 子目錄，不擋。

### Ad-hoc Form-1 worktree（非 spectra change）

無 `/spectra-archive` 觸發 merge-back，user 手動跑 `wt-helper merge-back <slug> --auto-stash` 後走 `/commit`。`/wt` 保留 deferred-landing 是「通用 primitive」設計——user 可連續開多 worktree、review 完一輪再 land。**此例外只屬於 `/wt` 本身**；包裝 `/wt` 的 skill 走下面 Skill-owned 管轄。

### Skill-owned worktree lifecycle（auto merge-back contract）

Skill 自己 fork worktree、有**清楚 end-of-skill 完成點**、**無下游 skill 接手 landing** → **MUST** 在完成點自主 merge-back + selective stage on main，**NEVER** 把這幾步丟回 user。

**符合**：`/dep-upgrade` § Outdated mode、機械化 codemod / bulk rename / 批次重構 skill。

**不符合（保留 deferred-landing）**：`/wt` primitive、`/spectra-apply`（archive 吸收）、`/spectra-ingest`、`/spectra-debug`、`/spectra-propose`（不寫 product code）。

**Auto merge-back 標準流程**：

1. **cd 回 main consumer root**（merge-back 完會 cleanup worktree，cwd 停在 worktree 會炸）：`cd "$(git worktree list --porcelain | head -1 | awk '{print $2}')"`
2. `node scripts/wt-helper.mjs merge-back <slug> --auto-stash`
3. **Pre-fork baseline blocker 自動清理**：撞 `merge-back blocked: ... N uncommitted edit(s)` → 解析 blocker paths，對每條 `git -C <wt> checkout HEAD -- <path>` 後重跑。安全性靠 §1 pinned `refs/wt-baseline/` 兜底。
4. **真衝突 STOP**：wt-helper 已 abort + 救 stash + 保留 worktree；**NEVER** 主線自決，AskUserQuestion 拍板。
5. **Selective stage on main**：`git reset HEAD && git add <skill 範圍檔>`（**禁止** `git add -A`），並行 session WIP 退回 unstaged。
6. **NEVER 自動 `/commit`**：commit 時機留 user。

**摘要彙報硬性**：skill 結束**必印**「worktree absorbed + cleaned」「main staged 哪些檔」「並行 WIP 退回 unstaged」「下一步走 `/commit`」四要素。

**例外**：user 明確說「先別 land」/「保留 worktree」→ skip auto，印手動指令。**NEVER** 預設主動延遲。

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
| `--auto-stash` | 把 main **全部** dirty bulk-stash 起來（`wt-merge-block/<slug>/<ISO>` 前綴，非只 blockers）後再 squash。bulk-stash 前先跑 claim guard 比對全部 dirty，差集含別 session WIP 即 refuse（見 § Claim guard scope ⊇ bulk-stash scope） |
| `--include-worktree-wip` | Worktree 內有 uncommitted user WIP 時自動 `git add -- <paths> && git commit --amend --no-edit` 到 branch HEAD。**不建議** — 顯式 commit 比較安全（commit message 有語意） |
| `--no-cleanup` | squash 成功後不 cleanup worktree（debug 用） |
| `--noop-if-missing` | 找不到對應 worktree 時 silent no-op（給 archive hook 用） |
| `--skip-pre-sync` | 跳過 wt-side pre-sync 直接 squash（emergency / 確知無交集；不建議——衝突會落在 main 不在 wt） |

### 預設行為

1. 找 slug 對應 session worktree（branch `session/<date>-<slug>` + path `<consumer>-wt/<slug>`）。找不到 → error（除非 `--noop-if-missing`）。
2. **偵測 worktree 內 uncommitted user WIP**：filter 掉 clade projection（`.agents/`、`.codex/`、`.claude/hub.json`、`.claude/.hub-state.json`、`scripts/wt-helper.mjs`），剩下是 user WIP。**有 WIP 無 `--include-worktree-wip` → throw**：建議 `cd <wtPath> && git add <files> && git commit --amend --no-edit` 後重跑。否則 squash 不帶走，cleanup 永久砍掉。
3. **Pre-sync wt with main**（預設；`--skip-pre-sync` 關閉）：fetch + `git rev-list --count <branch>..<targetRef>` 算落差，>0 跑 `git merge --no-ff <targetRef>` 灌進 wt 分支。Conflict 留 wt 內（**不** auto-abort），main working tree 不動。動機：隔離衝突避免汙染 main（對應 `clade_publish_interleaved_wip_same_file` / `clade_propagate_stash_pop_loop` 教訓）。
4. 偵測 main blockers：`git diff --name-only main..<branch>` ∩ main `status --porcelain`。
5. 有 blocker 無 `--auto-stash` → throw 建議 re-run。有 `--auto-stash` → 先跑 claim guard（見 § Claim guard scope ⊇ bulk-stash scope）比對 main 全部 dirty，通過後 `git stash push -u -m "wt-merge-block/<slug>/<ISO>"`（**bulk-stash，不帶 pathspec** — 因 git 2.50.1 pathspec stash 有 scope leak bug，見 `pitfall-git-stash-pathspec-scope-leak`；故捲走的是 main 全部 dirty，不只 blockers）。
6. `git merge --squash <branch>` land 進 main working tree + index（**不** commit）。Conflict → abort + pop stash + 保留 worktree + throw。
7. Squash 成功 → cleanup（remove worktree dir + delete branch）。

**為什麼步驟 2 必要**：worktree 的「helper 在 commit、wiring 在 working tree」切錯型錯誤是無聲 footgun — 沒這道 check 時 squash 只搬 commit，cleanup 砍 worktree 後 wiring WIP 永久遺失（baseline ref 只 cover fork 前的 WIP，沒 cover 事後 user edit）。

### Claim guard scope ⊇ bulk-stash scope（hard rule）

`--auto-stash` 實際執行的是 **bulk-stash（`git stash push -u`，不帶 pathspec）**，捲走 main **全部** dirty —— 不只 `blockers`（= branch changeset ∩ main dirty）。因此 `--auto-stash` 在真正 bulk-stash **之前**，claim guard 的檢查範圍 **MUST ⊇ 將被 bulk-stash 捲走的全部 dirty**，**NEVER** 只查 `blockers` 子集。

- bulk-stash 前 **MUST** 對 main **全部** dirty（`detectMainDirty`）跑 claim 比對（`classifyDirtyPaths`，`excludeClaim` 為本 merge-back worktree 的 claim）；
- 差集（`allDirty \ blockers`）若含**別 session 認領**（`otherSession`）的 dirty → **fail-loud STOP / refuse auto-stash**（與既有 blocker-only / pre-fork guard 一致），列出 `<path> → <session-id>` 並要 user 等別 session 收斂或協調，**NEVER** 默默 bulk-stash 捲走別 session WIP；
- 差集為空 / 全屬本 change / 為**無主**（unclaimed）dirty → 維持既有正常 flow（`--auto-stash` 本就設計來吞無主 dirty，user 後續走 `stash-reconcile`）。

**為什麼**：claim guard 原本只假設「危險 = branch 要 land 的改動撞到別 session 改同檔」，但 bulk-stash 的副作用是「為清出乾淨 working tree 做 squash，把**所有** dirty 移走」——範圍遠大於 branch changeset。不在 branch changeset 的別 session 認領檔不是 blocker，guard 從未檢查，bulk-stash 照捲（2026-05-29 <consumer-b>：vending merge-back `--auto-stash` 捲走別 session my-kpi 19 檔 WIP）。**正解是擴大 guard 檢查範圍，不是縮小 stash 範圍**（pathspec stash 會踩 git 2.50.1 scope leak，見 `pitfall-git-stash-pathspec-scope-leak`）。詳見 `pitfall-merge-back-autostash-bulk-captures-other-session-wip`。

### Stash 操作必 verify create

`git stash push -u -m <msg>` 對乾淨 working tree exit 0 + stdout `No local changes to save`，**不會丟 exception**、stash list 不會多 entry。任何 wt-helper / spectra script 跑 `git stash push` 都 **MUST** 在 push 前後比對 `git rev-parse --verify refs/stash` 確認 stash entry 真的建立；mismatch → 把 stashRef 設 null 並 warn，**禁止**仍宣稱 stashed。詳見 `pitfall-wt-helper-merge-back-silent-stash-miss`。未來新加 stash push 路徑（spectra-apply phase suffixes、clade-propagate、clade-publish 等）皆套同樣 contract。

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

| 前綴 | 來源 | 收尾 |
| --- | --- | --- |
| `wt-baseline/<slug>/<ISO>` | `wt-helper add --baseline-strategy stash` fork 前 stash main dirty | apply 成功 pin 到 `refs/wt-baseline/<slug>/<ISO>` 後 drop；apply 失敗殘留 → `stash-reconcile --slug` 自決 |
| `wt-final-baseline/<slug>/<ISO>` | rare second snapshot 變種 | 同上 |
| `refs/wt-baseline/<slug>/<ISO>` (永久 ref) | apply 成功後 pin（2026-05-17 後） | **不自動清** — `wt-helper rescue --prune <ref>` 或手動 `git update-ref -d` |
| `wt-merge-block/<slug>/<ISO>` | `wt-helper merge-back --auto-stash` 前 bulk-stash main 全部 dirty（含 blockers + 無主 unrelated dirty；別 session 認領的差集會在 stash 前被 claim guard refuse，見 § Claim guard scope ⊇ bulk-stash scope） | merge-back 收尾印 `--slug` reconcile hint，跑 `stash-reconcile --interactive` |
| `clade-propagate-v<ver>-<ts>` | `propagate.mjs` dirty consumer stash pop 失敗保留（v0.3.45+） | publish 收尾 `stash-reconcile --include-all --stale-days 1` |
| `clade-publish: <free-form>` | clade-publish Step 3 selective stage 前手動 stash | publish/propagate 收尾走 reconcile |
| Legacy `cross-session-block-*` | v2 失敗 squash 累積（v3 不再產生） | reconcile 給命令處理 |
| spectra-apply phase suffix（`-baseline-drift` / `-p7-wip` 等） | apply phase 切換手動 stash | reconcile 偵測 change 已 archive 推薦 view-diff |

`refs/wt-baseline/*` 永久 ref 是事故救援的最後保險絲：subagent 守 scope discipline 時 baseline 可能整批留在 worktree 未 commit，cleanup 砍 worktree 後 → `wt-helper rescue --show <ref>` 看 patch → `git checkout <ref> -- <paths>` 救回。

### 失敗 fallback

| 情境 | 處理 |
| --- | --- |
| Subagent 跑爆沒 commit | 保留 worktree；main 端 `git -C <wt> log/diff` 檢查；修完重派或 `cleanup --force --force-discard-unland` |
| blocker 命中不想 stash | 移掉 `--auto-stash`，手動處理 main 上 blocker 後再 `merge-back` |
| Pre-sync conflict | wt 留 unmerged，main 不動；wt 內解衝突 + commit 後重跑 `merge-back` |
| Squash conflict（pre-sync 後 rare） | auto-abort + pop stash + 保留 worktree；wt 內 rebase / cherry-pick 修完再 `merge-back`。`--skip-pre-sync` 場景 conflict 落 main 救法同此列 |
| 成功但 cleanup 失敗（stale lock） | 改動已 land；手動 `cleanup --force --force-discard-unland` |
| `cleanup` 拒絕 uncommitted | **NEVER** 急加 `--force-discard-uncommitted`。先 `wt-helper rescue --show <ref>` 看 patch，要救的 `git checkout <ref> -- <paths>` 撈進 main 再 cleanup |

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

命名不符 `session/*` 的舊 worktree **grandfathered**，不強制重命名；`wt-helper list` / `prune` 只認 `session/` 前綴。新建一律走 `/wt` + `session/<date>-<slug>`。

V2 → V3 in-flight worktree（subagent 已 commit 但還沒 squash）處置：

- 對應 spectra change ready archive → `/spectra-archive <name>`（Step 0 自動 merge-back）
- 還在 implementation → 不動，archive 時吸收
- ad-hoc Form-1（無 change）→ `wt-helper land-pending <slug>`（alias of merge-back，容忍 multi-commit branch）
- 過時不要 → `cleanup --force --force-discard-unland`（**永久砍 commit**）

Legacy `cross-session-block-*` stash 用 `stash-reconcile.mjs` 處理。HANDOFF drift 由 session-start `handoff-drift-scan.mjs` 偵測，drift → `/handoff` refresh。

## §8 Stop hook 死鎖 fallback

新 orchestration model 大幅降低死鎖機率：因為 `/wt` 在當前 session 直接跑、parent cwd 不動，「Stop hook 攔住 + 要動 code + cwd 在 main」這組情境不再構成死鎖 — 直接打 `/wt <task>` 就解掉。

殘留場景只剩一條：**主線在 main 上累積了當前 session 的 dirty WIP（不是別 session 的）+ Stop hook 攔住 + 還要繼續做**。這時：

- 若剩下的事可以靠 `/wt` 隔離（例如「再加一個 feature」），跑 `/wt <剩下要做的事>`。新 worktree 從 main HEAD 開，看不到主線的 dirty WIP，互不干擾；squash 回來時若不撞同檔就乾淨整合，撞了走 §5 squash conflict fallback。
- 若剩下的事必須在 main 直接處理（罕見），escalate to `/handoff`（Mode A 自動偵測，per [[handoff]]）。HANDOFF.md `## In Progress` 條目應含：Stop hook 攔點 + missing acceptance criterion + 當前 session 改過的檔案清單 + 下一 session 接手指引（直接從 main 跑 `/<next-skill> <change-name>`；apply / ingest / debug 內建 worktree dispatch，archive 直接從 main 跑）。

**移除**：先前的 §8 分支 A（建 worktree 並切 cwd 繼續）— 主線不切 cwd，新 model 沒這條路徑。先前的 §8 分支 C（`/handoff` 內呼 `/wt --dispatch-from-handoff` 路徑）— flag 已移除，dispatch 改走新 `/wt <slug>: /<next-skill>` form per [[wt]] Form 3。

### 預防原則

Session 開頭判定要動 code 就 **SHOULD** 立刻打 `/wt <task>`，不要先在 main 改一改才想到該開 worktree。這條原則跟前一版本一樣 — 只是現在 `/wt` 是同 session 內的自動 orchestration，不再要求 user 另開 terminal。

## §9 spectra DB 跨 worktree 共享心智模型

`.git/spectra-app/spectra.db` 是**單一 SQLite，跨所有 worktree 共享**。任一 worktree 跑 `spectra list / park / unpark / archive` 都讀寫同一 DB。`spectra list` 從 main 跑會列出所有 sibling worktree 的 active change；「main disk 無 directory + spectra list 顯示 active + park/unpark 失敗」**不**代表 zombie，多半是別 session 在 sibling worktree 物化。

**MUST**：
- **NEVER** 對 `spectra.db` 跑 `DELETE` / `UPDATE` / `INSERT` — 會影響別 worktree state
- **NEVER** 把「main 無 directory + list 顯示 active + park/unpark 失敗」當 zombie / 系統性 bug
- 偵測「zombie」前 **MUST** 先 `git worktree list` + `find ~/offline/<consumer>-wt -path "*<name>*"` + `mdfind "<name>"`
- 啟動 active / parked change `apply` 前 **MUST** `git worktree list` 確認別 session 沒在同 change 做

碰到看似 zombie 一律 **STOP + AskUserQuestion**。誤動 DB 後：`cp /tmp/spectra-db-backup-*.db .git/spectra-app/spectra.db` restore。

## §9.5 Spectra change artifact 必須活在 git，禁止靠 ephemeral worktree park/unpark

`Agent` tool 把 subagent 隔離進 `~/offline/<consumer>/.claude/worktrees/agent-<hex>/` ephemeral worktree（session 結束 GC）。Subagent cwd **不是** `<consumer>-wt/<slug>/`。後果（per [[pitfall-agent-tool-subagent-worktree-bypass]]）：subagent 跑 `spectra unpark` → artifacts 寫進 ephemeral cwd → GC 後永久遺失（parked_changes 仍指 change 但 `.git/spectra-app/changes/<name>/` empty = ghost park）。未 commit 的 proposal / specs / tasks **無 recovery path**。

**MUST**：
- `/spectra-propose` 收尾把 artifacts **commit 進 git**（不要光 park 交給下游 dispatch）
- `/spectra-apply` Step 2 把 `spectra unpark` 移到主線預先做，artifacts 落 main disk 後再 dispatch；**禁止**派 unpark 給 subagent
- **NEVER** 假設 subagent cwd = `<consumer>-wt/<slug>/`：派工前 echo cwd 確認，看到 `.claude/worktrees/agent-*` 立刻 STOP

**Detection**：`spectra list --parked --json` empty 但 `spectra list --json` 顯示 in-progress + `.git/spectra-app/changes/` empty → ghost-park。Recovery：`git log -- openspec/changes/<name>/` + `git show <sha>:<path>` 復原 committed 部分。

## §10 review-gui 與 worktree 互動的已知坑

`vendor/scripts/review-gui.mts` 從多 worktree aggregate `openspec/changes/`，3 條已記坑：

- **home list silent skip main change**：active worktree 存在時 `listPendingChanges` 可能 skip main change（detail 仍可取）。見 [[pitfall-review-gui-collision-typo-and-worktree-startup]]
- **source aggregation collision**：main hook 報 0 但 GUI 顯示 N hits + 無關 wt slug。見 [[pitfall-review-gui-source-aggregation-collision]]
- **apply-pending batch button 陷阱**：按前 **MUST** spot check 每張 change impl 完成度。見 [[pitfall-review-gui-apply-pending-mid-apply-changes]]

改 review-gui.mts 後 consumer 端 `pnpm review:ui:kill && pnpm review:ui` 重啟才吃到新版。

## 相關規則

- [[wt]] — `/wt` skill 完整使用手冊（三種 invocation form、subagent contract、failure handling）
- [[session-tasks]] — 共用時間戳 + slug 慣例
- [[commit]] — main 上的 commit ceremony；`/wt` squash 完後 user 跑 `/commit` 的入口
- [[scope-discipline]] — 「不屬於當前 scope 的 worktree」應該另開 `/wt` task
- [[handoff]] — §8 fallback 升級寫入入口；Mode B dispatch 用新 `/wt <slug>: /<next-skill>` form
