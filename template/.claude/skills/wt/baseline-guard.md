# `/wt` — Pre-fork baseline guard（`wt-helper add` 的策略分流）

> 從 [[worktree-default]] §1 抽出（2026-07-31）。主檔留的是**任何 session 都要遵守的四條契約**（預設不 capture、要帶 WIP 必須顯式 flag、傳了 flag 之後不准宣稱 main 沒被動到、不准手寫 pathspec stash）；本檔是**真的要跑 `wt-helper add` 時**的策略分流與命令細節。
>
> 決定要 fork worktree 之後、送出 `wt-helper add` 之前 MUST 讀本檔。

## 策略分流

Fork 出 worktree 之前，`wt-helper add` **MUST** 先跑 `detect-main-dirty` 偵測 main working tree 狀態，再依路徑決定策略：

- **Unmerged 非空** → 跑 `classifyUnmergedSafety` 分流：
  - **Safe-resolvable**（檔內無 conflict markers + 無 merge / rebase / cherry-pick in-progress state）→ helper 自動 `git add <paths>` 標 resolved 後 proceed（stale UU 是 index residue，無資料風險）。
  - **Unsafe**（任一條件命中）→ **STOP**，refuse to fork，列每條 unsafe path + reason。**NEVER** 自動處理真衝突 / 中段 merge — 任何動作都可能丟資料。
- **Clean** → 直接 fork（既有行為）。
- **Dirty 非空** → 依 caller 路徑：
  - **有 carrier 的工作**（`tasks/<date>-<slug>.md` 或 `specs/plans/NNN-<slug>/`）走 **commit-then-fork**：主線從 carrier 的 scope 段與已知影響面萃取 affected paths（scope-in），確認實作 checkout，呼叫 `wt-helper add ... --task-summary "<一句話>" --precheck-baseline <slug> --baseline-strategy commit --baseline-scope-paths <comma>` — helper selective stage + commit `baseline: <slug> pre-fork sync` 上 main 再 fork；scope-out（跨 session WIP）留在 main 不動。
    - **`--baseline-scope-paths` MUST 對齊 目前 canonical intent 列出的*每一條* scope-in path，NEVER 過度保守只挑核心 code** — 漏帶會讓同一條 change 的改動分散 main + worktree 兩處（scope 分裂，<consumer-a> `per-client-module-isolation` 實證）。Detection：fork 後 `git status` 若 main 仍有該 change impact 列的 dirty path = baseline 漏帶。
  - **Ad-hoc `/wt` 路徑**（無 change context）走 **stash-apply**：`wt-helper add ... --task-summary "<一句話>" --precheck-baseline --baseline-strategy stash`。Helper 內部在 main `git stash push -u -m wt-baseline/<slug>/<ISO>`，fork 後進 worktree `git stash apply` → **pin stash sha 到 `refs/wt-baseline/<slug>/<ISO>` 永久 ref** → `git stash drop`（物件仍 reachable）。Subagent 收到 [[wt]] Step 2 warn 段落知道哪些檔是 baseline 不該動。Pin 機制防 cleanup 後 baseline 永久消失 — 可用 `wt-helper rescue` 列出救回。
  - **Ambiguous**（scope-in 為空但 scope-out 非空、或三來源都對不上）→ **STOP** + 回 user 拍策略。**NEVER** 主線亂猜。

詳細 cookbook（4 種情境 + 完整 trace + scope filter 細節）見 `~/offline/clade/vendor/snippets/worktree-baseline/`。

## Stash strategy 的隱性風險（hard rule）

`--baseline-strategy stash` 假設 dirty main = safe to stash，實際可能含 in-flight feature code 或別 session WIP — stash 不區分全部捲進 pinned ref，後續走 Path X 救援會讓 feature 從 main 整段消失（typecheck 不抓）。

**NEVER**：
- `--baseline-strategy stash` 跑完未 pre-fork audit 就直接 dispatch subagent
- merge-back 撞 conflict 時不查 baseline 內容、直接 `git reset --hard <subagent-commit>` 走 Path X
- cleanup `--force-discard-uncommitted` 不先 `wt-helper rescue` 確認 baseline 內容

完整 audit script / conflict diagnostic / recovery 命令見 [[pitfall-pre-fork-baseline-hides-in-flight-feature]]。

## `--include-unrelated-dirty`：顯式 bulk-capture（hard rule）

預設行為是**完全不 capture** main dirty——main 原封不動、worktree 從 HEAD fork clean。要把 main WIP 帶進 worktree 必須顯式傳 flag，這是 [[pitfall-prefork-baseline-stash-sweeps-unclaimed-main-work]] 的修法刻意建立的 opt-in 閘門。

`--include-unrelated-dirty`（stash strategy 專用）語意是 **bulk-capture main 上全部 dirty**——不分主題、不分歸屬、不管是不是別 session 的 WIP，一律搬進新 worktree，main 端變乾淨。

**NEVER** 在傳了這個 flag 之後，對 user 宣稱「main working tree 不變」/「main 沒被動到」/「你的 WIP 還在 main」。傳了它，那三句話**必然**是假的。記得「wt-helper 預設不碰 main dirty」這條結論、卻沒把「我這次傳了 flag」納入判斷，正是 [[pitfall-include-unrelated-dirty-claimed-main-untouched]] 的實證失敗路徑（<consumer-k> 2026-07-15）。

**MUST** 在傳了它之後，明確告訴 user：main 上原有的 N 個 dirty 檔已搬進 worktree `<path>`，main 端現在是乾淨的。

**還原三步驟**（把 bulk-capture 的內容拿回 main）：

```bash
# 1. 找 pinned baseline ref（cleanup 過後仍在）
git for-each-ref --format='%(refname) %(objectname)' 'refs/wt-baseline/<slug>/*'

# 2. 在 main 還原（--index 保留原本的 staged / unstaged 分界）
git stash apply --index <objectname>

# 3. 實核，NEVER 憑 apply 沒報錯就宣告成功
git status --short
```

Scoped 替代方案：只帶某幾條路徑用 `--baseline-scope-paths <comma>`（走 commit strategy），scope 外的跨 session WIP 留在 main 不動——這才是有 change context 時的正解，`--include-unrelated-dirty` 是無從 scope 時的鈍器。

可直接貼的完整 recipe 見 `~/offline/clade/vendor/snippets/worktree-baseline/restore-main-after-bulk-capture.md`。

> Rationale (2026-05-18)：原「unmerged 永遠 STOP」過嚴 — helper 兩條 safety check 對 stale UU false-positive 極低、對真衝突仍 fail-safe。

**為什麼需要這道 guard**：worktree 從 main HEAD 分出，看不到 working tree 的 untracked / modified — 沒這道 guard 時 subagent 進 worktree 看 baseline 全缺 fail-fast，每次 fork 都得回頭打擾 user 拍策略。

## Anti-pattern：手動 `git stash push -u -- <pathspec>` 做 selective baseline sync

**NEVER** 主線自己跑 `git stash push -u -m "<msg>" -- <pathspec>` 試圖 scope 部分檔案進 stash，再 cd 到別處 `stash apply` 做 cross-worktree baseline sync。

**為什麼禁**：git 2.50.1 pathspec stash 有 scope leak — stash commit 包整個 tracked tree 的 modifications，apply 到 fresh worktree 帶進大量 cross-session noise。詳見 [[pitfall-git-stash-pathspec-scope-leak]]。

**正解**：worktree baseline sync 走 `wt-helper add --precheck-baseline`（上文，bulk stash 不帶 pathspec 避開此 bug）；非 worktree 場景的 selective sync（patch + rsync）與長期 cross-branch sync（format-patch + am）命令塊見 `~/offline/clade/vendor/snippets/worktree-baseline/README.md` § 手動 selective sync 正解。

**判別**：任何「想把 X、Y、Z 三個檔的改動搬去別 worktree」的場景，**第一反應應該是 wt-helper 或 patch route**，**禁止**自己手寫 `git stash push -u -- <paths>`。
