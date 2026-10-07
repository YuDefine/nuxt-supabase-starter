# Rule 1 - cleanup 只在六項條件全成立時進行，不確定就保留

- Level: `MUST`
- 移除 worktree 或 session branch 前，下列條件 **MUST** 全部成立：
  1. 沒有 active claim、活寫入者或 lock。
  2. 使用者的 WIP 已保存（沒有未 commit、未救回的改動）。
  3. 來源 HEAD 與就緒 receipt 記錄的 HEAD 相符。
  4. 正式落地紀錄或 content receipt 可驗證（main 上看得到正式 commit，或逐檔的取代證據）。
  5. ignored artifacts 可復原（或確認不需要）。
  6. teardown 本身成功（沒有中途失敗留下半拆狀態）。
- `merged`、`clean`、`done`、`work.done` 任何一個**單獨**都不是刪除證據。
- 不確定時 **retain**，並在回報寫明：owner、保留理由、下一個可觀察的落地訊號（例如「PR #742 合入 main 後」）。
- 回收只走 `wt-helper` 的 lifecycle 子命令；**NEVER** 用 raw `git worktree remove`、`git branch -D` 或 force flag 繞過 helper。
- 使用者明示保留的 worktree 不納入自動回收。
- 分類與工具步驟另依 [[handoff]]、[[wip-orphan-recovery]]；落地後的批次清理屬 commit skill 的 `batch.md`。

## Good Example

- 這個例子是好的，因為條件缺一就保留，並寫出可觀察的下一個訊號。

```md
auth-refresh：PR #742 仍是 draft（條件 4 不成立）→ retain，owner = 本 session coordinator，
下一訊號：PR #742 合入 main。
```

## Bad Example

- 這個例子是壞的，因為它把單一狀態當成刪除依據，並繞過 helper。

```md
worktree `git status` clean → `git worktree remove ~/offline/clade-wt/auth-refresh && git branch -D session/...`
```

# Rule 2 - 丟棄或取代未落地成果前先救援，force flag 是最後手段

- Level: `MUST`
- `cleanup` 因有 uncommitted 改動而拒絕時，**NEVER** 急著加 `--force-discard-uncommitted`：先 `wt-helper rescue --show <ref>` 看 patch，救完再 cleanup。
- `cleanup --force --force-discard-unland` 會**永久砍掉** branch 上的 commit；只在呼叫端或使用者確認這份成果不要時使用，執行前同樣先 `wt-helper rescue` 確認 pre-fork baseline 內容沒有混入別人的 in-flight 工作（見 [[pitfall-pre-fork-baseline-hides-in-flight-feature]]）。
- branch 只是因為 main 後來改寫了相同 hunk 而顯示「未落地」（內容被取代、不是遺失）時，改用 `cleanup <slug> --superseded-by <commit|file=commit|file=path>[,…] --reason <text>`：每個未落地檔都要有 main 上的證據，tip 會釘在 `refs/wt-superseded/`，只要有一個檔沒被覆蓋就不移除任何東西。
- `reclaim-stale` 預設只釋放過期的 dev-port slot，不動樹；加 `--remove-landed` 才會清理「已在 main 歷史中、乾淨、無人認領」的來源。`prune` 只處理已合入的 `session/` 樹，且逐一互動確認。
- 指令細節讀 `wt-helper指令.md`。

## Good Example

- 這個例子是好的，因為它先看 patch，再依內容是遺失還是被取代選工具。

```md
cleanup 拒絕：2 個未落地檔 → `rescue --show refs/wt-baseline/auth-refresh/...` 檢視
→ main 已在 a1b2c3d 改寫同段 → `cleanup auth-refresh --superseded-by server/auth/token.ts=a1b2c3d,server/auth/session.ts=a1b2c3d --reason "main 重寫 token 流程"`
```

## Bad Example

- 這個例子是壞的，因為它被拒絕就直接加 force flag。

```md
cleanup 拒絕 → `cleanup auth-refresh --force --force-discard-uncommitted --force-discard-unland`
```

# Rule 3 - legacy `merge-back` 只供遷移，已登記批次的來源不得走它

- Level: `MUST`
- 新流程入口是 `wt-helper batch`：來源固定、隔離整合、驗證落地後才清理。舊的單棵 `wt-helper merge-back` 只保留給尚未遷移的 caller，squash 後**保留來源**，不在正式 commit 前清理。
- 使用者說「merge back」→ 走 manual batch（見 `rules/就緒池交接判準.md`），不走 legacy。
- 已登記批次的來源 **NEVER** 用 legacy 路徑落地或刪除。
- legacy 的 main 帶有 unrelated dirty／staged WIP 時，可用 `merge-back <slug> --patch`：
  - 只套 committed changeset；正式套用前核對重疊路徑並 `git apply --check`；不 stash、不 pre-sync、不碰 index。
  - `--dry-run` 同樣只讀。
  - source 有 WIP、main dirty 與 patch 重疊或 patch 衝突 → 拒絕。
  - 成功只代表 main working tree 有待 commit 的改動；來源保留，不寫 landing marker。
  - 它與 batch admission、正式 commit／驗收規約並行，**NEVER** 用它繞過現行 PR／batch 流程（TD-863）。
- 下面 Rule 4–6 的 guard 仍約束 legacy stash 路徑與存量救援，但不是 batch 的搬運機制。

## Good Example

- 這個例子是好的，因為使用者的 merge back 意圖被導向 manual batch。

```md
使用者：「把 auth-refresh merge back」→ batch status --trigger manual --workflow <workflow_model> → /commit
```

## Bad Example

- 這個例子是壞的，因為已登記批次的來源走了 legacy，並把 `--patch` 成功當成已落地。

```md
auth-refresh 已 batch ready → `merge-back auth-refresh --patch` 成功 → 回報已落地並 cleanup。
```

# Rule 4 - claim guard 的檢查範圍必須涵蓋 bulk-stash 會捲走的全部 dirty

- Level: `MUST`
- `--auto-stash` 實際執行的是 **bulk-stash（`git stash push -u`，不帶 pathspec）**，會捲走 main **全部** dirty，不只 `blockers`（＝ branch changeset ∩ main dirty）。因此真正 bulk-stash **之前**，claim guard 的檢查範圍**要涵蓋（⊇）**將被捲走的全部 dirty：
  - 對 main **全部** dirty（`detectMainDirty`）跑 claim 比對（`classifyDirtyPaths`，`excludeClaim` 為本次 merge-back worktree 的 claim）。
  - 差集（`allDirty \ blockers`）若含**別 session 認領**（`otherSession`）的 dirty → **fail-loud STOP／拒絕 auto-stash**，列出 `<path> → <session-id>`；並**先跑 [[session-tasks]] § 並行爭用 的 Step 0 判出對方性質再決定動作**：
    - 前景 session → 主動 `SendMessage` 協調。
    - unattended runner → 讓位，不要等它「收斂」。
    - 人類 → 才是需要使用者介入的那一種。
    - 不要默默 bulk-stash 捲走別 session 的 WIP，也不要在判出對方性質前就把這題丟回給使用者。
  - 差集為空、全屬本 change、或為**無主**（unclaimed）dirty → 維持正常流程（`--auto-stash` 本就設計來吞無主 dirty，squash 落地後**自動 pop 回 main**，不留 stash tail；只有 pop 撞真衝突才走 stash reconcile）。
- ⚠️ **guard 的輸入有兩個來源，宣告的那個實務上幾乎恆空**：
  - 第一個來源：`classifyDirtyPaths` 拿 dirty path 比對 claim 的 `expected_paths`；claim 沒帶 paths 就**永遠比不中**，無主 dirty 會被整批捲走而 guard 零告警。
  - 第二個來源：比不中、且該路徑在 main 沒有自己的寫入時證據時，改問「有沒有哪個**還活著**的 worktree 寫過同名路徑」（[[session-claims]] § 3.3 的導出值）。
  - 因此 [[session-claims]] § 主線無 claim 的保護缺口 那條「main 累積 dirty 時寫 coarse claim **要帶 `--expected-paths`**」仍然要做——導出值只涵蓋 worktree 有實際寫入、且持有者仍活著的路徑，**NEVER** 讀成「現在不宣告也沒關係」。
- **正解是擴大 guard 的檢查範圍，不是縮小 stash 範圍**：pathspec stash 會踩 git 2.50.1 的 scope leak（[[pitfall-git-stash-pathspec-scope-leak]]）。

## Good Example

- 這個例子是好的，因為它對全部 dirty 做 claim 比對，並先判對方性質再處理。

```md
main dirty 5 條，blockers 1 條；差集 4 條中 `server/billing/invoice.ts → session-7f2e`（前景 session）
→ STOP，拒絕 auto-stash → SendMessage 給 session-7f2e 協調落地時點。
```

## Bad Example

- 這個例子是壞的，因為它只查 blockers，或為了縮小影響改用 pathspec stash。

```md
blockers 只有 1 條、沒有別人認領 → `--auto-stash`（實際捲走 5 條）
或：`git stash push -u -- server/auth/token.ts` 只 stash 那一條。
```

# Rule 5 - 每次 stash push 都要驗證 stash 真的建立

- Level: `MUST`
- `git stash push -u -m <msg>` 對乾淨的 working tree 會 exit 0 並印 `No local changes to save`：**不丟 exception**，stash list 也不會多一條。
- 任何 `wt-helper`／腳本／手動流程執行 `git stash push`，都 **MUST** 在 push 前後比對 `git rev-parse --verify refs/stash`，確認 stash entry 真的建立；不一致 → 把 stashRef 視為 null 並警告，**禁止**仍宣稱「已 stash」。
- 任何新加的 stash push 路徑（clade-propagate、clade-publish 等）都套同一條契約。詳見 [[pitfall-wt-helper-merge-back-silent-stash-miss]]。

## Good Example

- 這個例子是好的，因為它以 ref 前後比對確認，而不是看 exit code。

```bash
before=$(git rev-parse --verify -q refs/stash)
git stash push -u -m "wt-merge-block/auth-refresh/2026-10-03T15:20"
after=$(git rev-parse --verify -q refs/stash)
[ "$before" != "$after" ] || echo "WARN: stash 未建立，不得宣稱已 stash"
```

## Bad Example

- 這個例子是壞的，因為它憑 exit 0 就宣稱已保存。

```md
`git stash push -u -m ...` exit 0 → 回報「main 的改動已 stash 保存」。
```

# Rule 6 - stash reconcile 永不自動套回，但通過判準的 stash 要主動 drop

- Level: `MUST`
- `stash-reconcile.ts`（`--interactive`／`--json`／`--slug <slug>`／`--stale-days N`／`--include-all`）列出每一條 namespaced stash 與建議命令；merge-back 成功收尾時會自動印帶 `--slug` 的 reconcile 提示。
- **永遠不 auto-pop／auto-stage／auto-commit**：apply 之後使用者的 WIP 回到 working tree，必須走 `/commit` 的 selective stage，**禁止** `git add -A`。
- **`drop` 不在上面那條禁令內**：通過 [[commit.detail]] § Stash 自動處置 gate 全部判準的 stash，agent 要主動 drop，不留給使用者（`--interactive` 只是使用者想逐條自己看時的入口）。
- main 上其他 session 的 WIP **NEVER** stash、覆寫或猜測清理；看似過期的單檔 stash（例如 tasks 檔「退化副本」）先依 `rules/讀進度前先查worktree判準.md` 判 diff 方向，再決定 drop 或帶回。
- 完整命令清單、stash 命名空間表與失敗 fallback 表見 `~/offline/clade/vendor/snippets/worktree-baseline/merge-back-ceremony.md`。

## Good Example

- 這個例子是好的，因為它 apply 後走 selective stage，並主動 drop 通過判準的 stash。

```md
stash-reconcile --slug auth-refresh：
- wt-merge-block/auth-refresh/… → apply → `/commit` selective stage 兩個檔
- wt-baseline/old-task/…（通過 Stash 自動處置 gate 全部判準）→ 主動 drop
```

## Bad Example

- 這個例子是壞的，因為它自動 pop 並全量 stage，或把可 drop 的 stash 留給使用者。

```md
`git stash pop` → `git add -A && git commit`；其餘 stash 請使用者自己看要不要刪。
```

# Rule 7 - 不憑表象判 zombie worktree，也不重建已退役的 spectra DB

- Level: `MUST`
- `.git/spectra-app/spectra.db`（舊 spectra 跨 worktree 共享 SQLite）隨 spectra 退役不再存在，載體改為 `specs/`、`tasks/`、`specs/plans/` 與 `flow` 卡。**NEVER** 重建、讀取或寫入該 DB；看到它是舊殘留，不是現行狀態來源。
- 「main 沒有該 work 的目錄」**不等於** zombie——多半是別 session 在 sibling worktree 物化了它。
- 判定 zombie 前 **MUST** 先查：
  - `git worktree list`
  - `find ~/offline/<consumer>-wt -path '*<slug>*'`（搜尋範圍就是該 consumer 的 `-wt` 目錄）
  - `node vendor/scripts/flow/flow.ts who`（判持有者）
- 看似 zombie 一律 **STOP**，透過該 runtime 的授權提問介面問使用者，不自行清理。
- 接手 plan／tasks 前 **MUST** 先 `git worktree list`，確認沒有別 session 在同一個 work id 上工作。

## Good Example

- 這個例子是好的，因為它先找 sibling worktree，再停下問人。

```md
main 沒有 token-rotation 的目錄 → git worktree list + find ~/offline/clade-wt
→ 找到 ~/offline/clade-wt/token-rotation/ → 不是 zombie，不動。
```

## Bad Example

- 這個例子是壞的，因為它憑表象直接清理別人的工作。

```md
main 沒目錄 → zombie → `git worktree remove --force ~/offline/clade-wt/token-rotation`
```

# Rule 8 - 落地撞上平行 worktree 的 fork residue 時照固定復原路徑直接處理

- Level: `MUST`
- 多條 change 平行、其中一條要 archive／落地收尾時，會撞兩類 fork-time residue。**MUST** 照下列判準直接處理，**NEVER** 回頭問使用者「要怎麼辦」。根因見 [[pitfall-archive-mergeback-parallel-worktree-fork-residue]]；復原指令讀本 skill 的 `wt-helper指令.md`「復原」段。
- **blocker 是別 session 在 main 上的 WIP**：
  - 先檢查 main dirty 與活 claim，和持有者協調可落地的時點（協調方式依 Rule 4 的 Step 0 判對方性質）。
  - `--auto-stash` 會捕捉全部 main dirty，**NEVER** 把它當成最小範圍操作。
  - 依 dry-run 與 Rule 4 的 claim guard 放行後才執行；完成後檢查還原結果；有 conflict 就保留 stash，依明示的 recovery 處理。
- **落地撞上 sibling worktree 的同名副本**（同名目錄或同名歷史）：
  - 先確認各自的來源與持有者。
  - **NEVER** 刪除其他 worktree 的原件來讓自己的落地通過。
  - 未確認的 ownership 或來源衝突保持可見並回報。

## Good Example

- 這個例子是好的，因為它照判準處理，不把例行 residue 丟回使用者，也不動別人的原件。

```md
archive auth-refresh 撞 sibling worktree billing-v2 帶著 fork 時的 specs/plans/W-…-auth/ 副本
→ 確認該副本屬 billing-v2 的 fork 殘留、持有者為 session-7f2e → 依 wt-helper指令.md § 復原處理本來源，billing-v2 原件不動，回報 residue 位置。
```

## Bad Example

- 這個例子是壞的，因為它把例行情況丟回使用者，或為了通過而刪掉 sibling 的原件。

```md
「archive 被 sibling worktree 擋住，要怎麼處理？」
或：`rm -rf ~/offline/clade-wt/billing-v2/specs/plans/W-…-auth/` 後重跑 archive。
```
