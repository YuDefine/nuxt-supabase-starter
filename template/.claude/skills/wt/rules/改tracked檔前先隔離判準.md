# Rule 1 - 改 tracked 檔之前必須先隔離，NEVER 直接在 main 改

- Level: `MUST`
- 前提：multi-session 共用 main；staged 區、branch HEAD、partial WIP 與 ignored artifacts 都會跨 session 滲漏。因此凡會改 tracked 檔的工作，都必須先在隔離環境裡做，先保存並驗證成果，再由批次 `/commit` 落地。
- 只要動作會寫入 tracked 檔——實作、修正、重構、新增、編輯、部署準備、migration、設定寫入、建 plan package 或 tasks 檔都算——**MUST** 在獨立 worktree 內執行，**NEVER** 直接在 main 改。
- 只有明示唯讀的工作（grep、log、audit、history 查詢、解釋）可以留在 main。
- 尚未隔離時，把工作交 `wt` 建立隔離環境（或依呼叫端自己的流程，例如 `work-route` §0、`handoff` Mode B、`work-loop`）。**要不要隔離、隔離成什麼形狀，由呼叫端判斷**；本檔只規定「改 tracked 檔前必須已經隔離」與下列禁令。
- 已經在 worktree 內（`git rev-parse --git-dir` 含 `/worktrees/`）→ 這棵樹就是工作區，**NEVER** 疊建第二棵。
- main 上其他 session 的 WIP **NEVER** stash、覆寫或猜測清理。
- worktree、branch、archive、落地的具體載體由 target adapter 提供；缺少已驗證的載體時保留 blocker，**NEVER** 改用另一個 runtime 的命令形狀硬做。
- flow 事件：未顯式覆寫時，寫入端與讀端共用 main checkout 的 `.clade/flow/events.jsonl`；linked worktree 找不到可用的 main checkout 時，寫入端回報失敗，不把事件寫回待刪的樹。

## Good Example

- 這個例子是好的，因為它在 main 察覺要寫入時先交出去隔離，自己不動檔。

```md
cwd = main，要修 server/auth/token.ts 的過期判斷
→ 交 `wt` 建立隔離環境（呼叫端已判定需隔離），在新樹內修改；main 不寫任何 tracked 檔。
```

## Bad Example

- 這個例子是壞的，因為它以「只是一行」為由直接在 main 改。

```md
只改一行，開 worktree 太麻煩 → 直接在 main Edit server/auth/token.ts，之後再 commit。
```

# Rule 2 - 禁止 silent branch，只有 `wt` 約定命名不必另問

- Level: `MUST`
- 除了 `wt` 約定的 `session/<YYYY-MM-DD-HHMM>-<slug>` 命名與 helper 內部必要的 branch 之外，agent 想建立 `feature/*`、`fix/*` 等 branch **MUST** 先取得使用者同意。
- **MUST NOT** 跑 `git checkout -b`；**唯一例外**：`/wt` 規約定義的命名授權（由 `wt-helper add` 建立的 session branch）。**NEVER** 偷建再說。
- helper 的 lifecycle 不得用 raw `git worktree remove`、`git branch -D` 或 force flag 繞過。

## Good Example

- 這個例子是好的，因為需要非約定 branch 時先問。

```md
使用者要一條長期的 release branch → 問：「要建立 `release/2026-10` 嗎？」取得同意後才建。
```

## Bad Example

- 這個例子是壞的，因為它沒問就建了 branch，事後才告知。

```md
`git checkout -b fix/token-expiry` → 改完後回報「我開了一條 branch 處理」。
```

# Rule 3 - parent session 的 cwd 不動

- Level: `MUST`
- 任何隔離流程（含交給 `wt`、交給呼叫端流程）**SHALL NOT** 遷移 parent session 的 cwd。worktree 內的操作由 cwd 設為該 worktree 的 worker 執行；主線（cwd = main）負責派工。
- **無例外**。理由：mid-conversation 切 parent cwd 會破壞 file watcher、Bash cwd 狀態與尚未完成的 Read window；把 worker 隔離在 worktree cwd 已能達到同樣的效果。
- subshell 的 `cd`（一行式 `cd <wt> && <cmd>`）不改變 parent cwd，不受本條禁止（見 Rule 4）。

## Good Example

- 這個例子是好的，因為主線留在 main，只用一行式指令讀取 worktree 狀態。

```bash
git -C ~/offline/clade-wt/auth-refresh log --oneline main..HEAD
```

## Bad Example

- 這個例子是壞的，因為它把 parent session 的 cwd 切進 worktree 繼續工作。

```md
`cd ~/offline/clade-wt/auth-refresh`（之後所有指令都在這個 cwd 下執行）
```

# Rule 4 - 階段之間的 local setup chore 由主線一行式 `cd` 進 worktree 自己跑

- Level: `MUST`
- phase 切換之間需要在 worktree 跑 **local-only** setup chore 時，主線 **MUST** 用 Bash `cd <wt> && <cmd>` 一行式自己跑，**NEVER** 把指令清單推回給使用者。
- 可以自動代勞（無 push／publish／deploy 副作用）：
  - `pnpm install`、`pnpm db:*`、`pnpm supabase:sync`
  - `pnpm build`、`pnpm lint`、`pnpm test`、`vp check`、`tsc --noEmit`
  - 其他 local pnpm script
- 仍需使用者拍板（真正 destructive）：
  - `rm -rf <wt>`
  - push 到 `main`、Prod DB migration、使用 Prod 憑證
  - 對外發送訊息、動 shared infra
- 失敗時主線自己診斷修復，不丟回使用者；使用者明確說「我自己跑」或「先別動」時尊重。

## Good Example

- 這個例子是好的，因為它自己在 worktree 跑完安裝與型別檢查。

```bash
cd ~/offline/clade-wt/auth-refresh && pnpm install && pnpm exec vp check
```

## Bad Example

- 這個例子是壞的，因為它把 local chore 丟給使用者。

```md
請你進 ~/offline/clade-wt/auth-refresh 跑 `pnpm install` 後告訴我結果。
```

# Rule 5 - Stop hook 死鎖時依剩餘工作能否隔離選擇出口，並在開頭就預防

- Level: `MUST`
- 死鎖場景：主線已在 main 累積本 session 的 dirty WIP，Stop hook 攔住，而工作還要繼續。兩個出口：
  - **剩下的事可以隔離** → 把剩下的事交 `wt` 建立隔離環境（或依呼叫端流程）繼續。新 worktree 從 main HEAD 開，看不到主線的 dirty WIP；撞到同檔時走批次落地的衝突處理。若剩下的事要由另一個 skill 接手，交 `wt` 建立隔離環境並在樹內續跑該 skill，不切 parent cwd。
  - **必須在 main 直接處理（罕見）** → escalate 到 `/handoff`（Mode A 自動偵測，依 [[handoff]]）；HANDOFF 條目含 Stop hook 攔點、缺少的 acceptance criterion、改過的檔案清單、下一個 session 的接手指引。
- **NEVER** 為了解除攔截而 stash、丟棄或覆寫 main 上的 WIP。

## Good Example

- 這個例子是好的，因為它把能隔離的剩餘工作交出去，main 的 WIP 由 handoff 記錄。

```md
Stop hook 攔住，main 有本 session 改的 2 個檔；剩下的測試補強可隔離
→ 交 `wt` 建立隔離環境補測試；main 上的 2 個檔經 /handoff 記錄攔點與接手指引。
```

## Bad Example

- 這個例子是壞的，因為它為了解除攔截，把 main 的 WIP 隨手 stash 或丟棄。

```md
Stop hook 攔住 → `git stash` 掉 main 的改動 → 繼續在 main 做。
```

# Rule 6 - session 一開頭判定要動 tracked 檔，就立刻交出去隔離

- Level: `SHOULD`
- 預防勝於 Rule 5 的事後出口：session 開頭一判定這輪會寫入 tracked 檔，就立刻交 `wt` 建立隔離環境（或依呼叫端流程），不要先在 main 改一改才想到該隔離。
- 可以不照做的理由必須具體，例如「本輪確定只做唯讀調查，寫入需求是中途才出現」——那時改走 Rule 1，立刻停手交出去，不在 main 繼續累積。

## Good Example

- 這個例子是好的，因為它在動手前就完成隔離。

```md
使用者：「修 token 過期判斷並補測試」→ 判定會寫 tracked 檔 → 第一個動作就是交 `wt` 建立隔離環境。
```

## Bad Example

- 這個例子是壞的，因為它先在 main 改了幾個檔，才想到要隔離，最後撞上 Stop hook。

```md
先在 main 改 token.ts 試試 → 再改測試 → Stop hook 攔住 → 才想開 worktree。
```
