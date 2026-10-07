# Rule 1 - PR 狀態 MUST 一次取齊再依 predicate 判讀，NEVER 分多次拼湊

- Level: `MUST`
- 用 `references/gh-commands.md` § PR 整體狀態 的單一 `gh pr view` 取 head、draft、mergeStateStatus 與 checks；**NEVER** 分多次 `gh pr checks`／`gh pr view` 拼湊（中間 head 可能已變）。
- 進行中的 check run 回 `conclusion: ""`（空字串，jq 的 `//` 不會落到後備值），所以 state 取第一個非空欄位：完成的是 `SUCCESS`／`FAILURE`／`SKIPPED`，沒完成的是 `QUEUED`／`IN_PROGRESS`。

| 可觀察 predicate | 判讀與處置 |
| --- | --- |
| `head` ≠ 你剛推的 SHA | 這份快照（以及任何 watcher 通知）屬於舊 head，**NEVER** 當成本 head 的結果；舊 head 的完成通知一律丟棄 |
| `checks` 是空陣列，或 `gh pr checks` 回 `no checks reported` | 剛 push、run 還沒 queue，**不是**「沒有檢查要跑」。照切片 PR 命令派 `workflow ci.yml --commit "$SLICE_SHA"`（script 把查無 run 當 pending），**NEVER** 寫「沒有 pending 就結束」的 until-loop——它會在第一輪就空轉結束 |
| `draft: true` 且 test-lane／summary 類 check 是 `SKIPPED` | draft 只跑機械檢查；這時的「全綠」**NEVER** 讀成測試通過或終態（[[github-flow]] § Draft 不是 ready） |
| `merge: CLEAN` | 可合併（必要 check 全過、無衝突） |
| `merge: BLOCKED` | 必要 check 未過或必要 review 未到；看 `checks` 裡哪條不是 `SUCCESS` |
| `merge: UNSTABLE` | 非必要 check 紅；照紅燈先比最後綠燈判是不是這張 PR 造成的 |
| `merge: BEHIND` | 只是 `main` 往前走、沒有衝突；**NEVER** 為了跟上 `main` 推 ready PR（[[github-flow]] § Ready 之後的 push 紀律） |
| `merge: DIRTY` | 與 `main` 衝突。優先在來源 worktree `git fetch origin && git merge origin/main` 解衝突後一般 push（不需 force）；要 rebase 才用 `--force-with-lease=<branch>:<剛驗證的遠端 SHA>`，且須主持者授權。force 的具體條件以 [[github-flow]] 為準 |
| `merge: UNKNOWN` | GitHub 還在算（剛 push 或剛有人合進 `main`），30 秒後再查一次，**NEVER** 據以判定 |

- 要等這張 PR 的 CI 出結果 → 回到監看流程，**NEVER** `gh pr checks --watch` 或 `gh run watch`。

## Good Example

- 這個例子是好的，因為先核對 head，再讀 merge 狀態。

```text
head=9f3e… ＝ 剛推的 SLICE_SHA；draft=true；merge=BLOCKED；test-lane SKIPPED → 機械檢查進行中，派 watcher 等結果
```

## Bad Example

- 這個例子是壞的，因為 checks 空陣列被讀成「沒東西要跑」。

```text
checks: [] → 沒有 pending，CI 已完成，可以回報綠燈
```

# Rule 2 - 撞 GitHub API 限流時先查 reset，NEVER 立刻重試

- Level: `MUST`
- `gh` 回 `HTTP 403: API rate limit exceeded`、`secondary rate limit` 或 `HTTP 429` 時，先跑 `references/gh-commands.md` § 限流 的 `gh api rate_limit`。
- `remaining` 為 0 → 睡到 `reset` 再查，**NEVER** 立刻重試（每次重試都再吃同一份共用額度）。
- `remaining` 不為 0 卻被擋 → secondary rate limit，至少等 60 秒。
- script 已內建這段：撞限流時睡到 reset 續盯、不計入 3 次錯誤，超過 `--timeout` 照 `WATCH_TIMEOUT` 回報。

## Good Example

- 這個例子是好的，因為依 reset 時刻等待。

```text
rate_limit：remaining 0，reset 2026-10-04T12:41:00Z → 等到 12:41 再查
```

## Bad Example

- 這個例子是壞的，因為連續重試，讓共用額度被同一個錯誤吃光。

```text
403 rate limit → 立刻重跑 gh pr view，連試 5 次
```
