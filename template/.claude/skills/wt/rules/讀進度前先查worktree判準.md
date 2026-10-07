# Rule 1 - 讀工作進度前先查有沒有 active worktree

- Level: `MUST`
- 讀工作進度時——plan package 或 `tasks/` 檔、`WORKTREE-BRIEF.md`——**MUST** 先查該工作有沒有 active worktree：

```bash
ls ~/offline/<consumer>-wt/<change-slug>/ 2>/dev/null || git worktree list
```

- 依結果決定讀哪一份：
  - **有 active worktree** → 讀 worktree 內的 tasks 檔（working truth）；main 上那份是 fork 當下的 snapshot，不代表目前進度。
  - **沒有 active worktree** → 讀 main（工作尚未物化成 worktree，或已經落地）。
- 只讀 main 會誤判「還沒開始實作」——實際上 worktree 可能已推進好幾個 phase。`/handoff` 掃描、主線交叉核對都適用本條。

## Good Example

- 這個例子是好的，因為它先找到 worktree，讀的是 working truth。

```md
要回報 W-2026-10-01-auth 進度 → `ls ~/offline/clade-wt/auth-refresh/` 存在
→ 讀 ~/offline/clade-wt/auth-refresh/specs/plans/W-2026-10-01-auth/tasks.md：已勾到 phase 3。
```

## Bad Example

- 這個例子是壞的，因為它只讀 main 的 snapshot 就下結論。

```md
讀 main 的 specs/plans/W-2026-10-01-auth/tasks.md 全未勾 → 回報「尚未開始實作」。
```

# Rule 2 - main 端出現 tasks 檔改動時，新舊方向由 diff 判，NEVER 由 Rule 1 外推

- Level: `MUST`
- Rule 1 管的是**讀**，它**不保證** main 上的改動比較舊——在 main 補勾 checkbox 是常態。**NEVER** 把 Rule 1 外推成「main 端出現的 tasks 檔改動一律是退化副本」而 stash 或捨棄。
- **MUST** 先用 `git diff HEAD -- <path>`（同時包含 staged 與 unstaged）看打勾方向，再**逐項**比對兩邊的打勾集合：
  - **NEVER** 只比數量。
  - **NEVER** 只看 `--stat`：`[ ]`→`[x]` 與反向給出完全相同的 insertions／deletions。
- 比對指令：

```bash
diff <(grep -n '^\s*- \[x\]' <main>/<tasks-path>) \
     <(grep -n '^\s*- \[x\]' <worktree>/<tasks-path>)
```

- 依比對結果處置：

| 可觀察 predicate | 處置 |
| --- | --- |
| 該工作有 active worktree，且 worktree 的打勾集合 **⊇** main 端 | main 這份確實多餘 → 可 stash／捨棄 |
| 該工作有 active worktree，但 main 端有 worktree 沒有的打勾項 | main 這份是唯一紀錄 → **NEVER** stash。用 `git -C <main> diff --binary HEAD -- <path> \| git -C <wt> apply` 帶進 worktree（**NEVER** `git -C <wt> checkout main -- <path>`——它讀的是 commit，不是 main 未 commit 的那份），再在 worktree 做 artifact-tick commit |
| 該工作沒有 active worktree（已落地或已 archive） | main 就是 working truth → **NEVER** 以「working truth 在 worktree」為由處置 |

- 已經被 stash 掉的進度要取回時：先 `git stash show -p "stash@{N}"` 確認方向，用 `git show "stash@{N}:<path>" > /tmp/tasks-stashed.md` 取到暫存位置（**NEVER** 直接 checkout 覆蓋現行檔），逐項比對打勾集合；只有 stash 內沒有獨有打勾項時才 drop，有獨有項就先補進目標檔、commit 落地並驗過再 drop。詳見 [[pitfall-main-side-tasks-md-tick-stashed-as-stale-copy]]。

## Good Example

- 這個例子是好的，因為它逐項比對後發現 main 有獨有打勾，改為帶進 worktree。

```md
main 的 tasks.md 有改動，`--stat` 顯示 21+/21-。
→ 逐項比對：main 有 3.1、3.2 兩項已勾，worktree 沒有 → 第二列
→ `git -C ~/offline/clade diff --binary HEAD -- specs/plans/W-…/tasks.md | git -C ~/offline/clade-wt/auth-refresh apply` → 在 worktree commit。
```

## Bad Example

- 這個例子是壞的，因為它從「working truth 在 worktree」外推，把較新的進度 stash 掉。

```md
有 active worktree → main 上的 tasks.md 改動是退化副本 → `git stash push -m "tasks.md 退化副本"`。
```

# Rule 3 - main 與 worktree 的 tasks 分歧時，先分辨來源與 receipt 再承接

- Level: `MUST`
- 每次看到 tasks 檔分歧，先分辨兩份各自的來源（哪個 session、哪個 commit）與 evidence receipt，**NEVER** 直接合併 checkbox 就宣告完成。
- 任一份的獨有內容都先保存並回讀，再做承接。
- 未確認身分與來源前，**NEVER** 以較舊的時間、相同的勾選數或 stash 標題捨棄任一份內容。
- worktree 是隔離位置，不是「較新證據」的保證。

## Good Example

- 這個例子是好的，因為它先保存雙方獨有內容，並核對 receipt。

```md
main 有 4.1 已勾、worktree 有 4.2 已勾 → 兩份都先另存 → 核對 evidence sidecar：4.1 有 receipt、4.2 有 receipt
→ 兩項都承接進 worktree，再 artifact-tick commit。
```

## Bad Example

- 這個例子是壞的，因為它以時間判新舊，直接丟掉一份。

```md
worktree 的檔案修改時間比較新 → 用 worktree 那份蓋過 main。
```

# Rule 4 - 需求與證據要持久留在實作 checkout，只勾 checkbox 不算完成證據

- Level: `MUST`
- 需求的載體是 plan package 或 `tasks/` 檔；證據的載體是 verify evidence sidecar（`docs/evidence/<work-slug>.jsonl`）。兩者都保留在實作 checkout。
- 讀進度時，checkbox 必須有對應 receipt 才算完成：只勾 checkbox、沒有 sidecar receipt，**不算**完成證據。
- 每個 phase 完成後，應先回讀該 phase 的證據與 gate，再把 checkbox 與 sidecar 限定路徑 commit（artifact-tick，type 用 `📝 docs`，限定路徑白名單見 [[commit.detail]] § `--only` 適用範圍 = 路徑白名單 的 phase-tick 列：tasks 檔與 sidecar 兩條一起）；未 commit 的檔案不會隨落地帶回 main。
- 派工前確認實際 cwd；GC 前確認證據可從正式 checkout 回讀，持久證據 **NEVER** 只留在會被回收的 ephemeral worktree。

## Good Example

- 這個例子是好的，因為它以 receipt 核對 checkbox，而不是只數勾。

```md
tasks.md phase 2 全勾 → 查 docs/evidence/auth-refresh.jsonl：phase 2 有 3 筆 receipt 對上 → 承認 phase 2 完成。
```

## Bad Example

- 這個例子是壞的，因為它只看 checkbox 就判完成，證據也只留在要回收的樹。

```md
phase 2 全勾 → 完成。（sidecar 沒有對應 receipt，且未 commit，worktree 下週回收）
```
