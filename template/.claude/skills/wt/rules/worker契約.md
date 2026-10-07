# Rule 1 - 所有讀寫都在指派的 worktree 內，開工前先讀 WORKTREE-BRIEF 並持續更新

- Level: `MUST`
- 你的工作目錄是 brief 指定的 worktree 絕對路徑；所有檔案讀寫與 shell 指令都在那裡執行，**NEVER** `cd` 出這棵樹，**NEVER** 在 main checkout 提交任何東西。
- worktree 根目錄的 `WORKTREE-BRIEF.md` 是這棵樹「該做什麼、做到哪、還剩什麼」的唯一權威來源。cwd 在 session worktree 且 brief 存在時，**MUST** 先讀它再做事。
- 工作中維護 brief：
  - 完成 Progress 項目時把 `- [ ]` 改成 `- [x]`；發現新步驟就新增項目。
  - 完成時把 frontmatter `status` 改為 `done` 並更新 `last_updated`；被卡住改 `blocked` 並在 Progress 寫明原因；失敗改 `failed` 並寫明原因。
  - 調查型任務把結論寫進 brief 的 `# Findings` 段，讓接續的 session 不必重跑。
- brief Context 的「backing service」列是建樹當下的狀態：`ready` 表示這棵樹的 REST／Storage 可用；`created`／`absent` 表示目前打不到，工作要用到它（起 dev server、跑打 DB 的測試）之前先跑該列所附的補建指令；`unknown` 表示該 repo 的 shim 沒回報狀態，用到之前先跑 `node scripts/wt-env-bootstrap.ts status --worktree "<path>" --json` 確認；寫「無」表示這個 repo 沒有 per-worktree backing service。補建後仍不是 `ready` 時照該 repo 的 local rule 處置並在 brief 記錄，**NEVER** 把連不上當成程式錯誤去改實作或測試。
- `WORKTREE-BRIEF.md` 不進 git（wt-helper 已寫進 repo 共用的 `.git/info/exclude`）：**NEVER** `git add` 它，**NEVER** 把它加進 `.gitignore`。
- 接續中斷的工作時（brief 已有已勾項目）：
  1. `git log main..HEAD --oneline` 看已完成的 commit。
  2. `git status` 看未 commit 的工作。
  3. 從 Progress 下一個未勾項目繼續。
  4. **NEVER** 從頭來過或冷讀整個 codebase——brief 已包含預先消化的上下文。

## Good Example

- 這個例子是好的，因為它先讀 brief、從斷點接續，並在結束時更新狀態。

```md
讀 WORKTREE-BRIEF.md → Progress 前 2 項已勾 → `git log main..HEAD` 有 2 個 commit、`git status` 乾淨
→ 從第 3 項繼續 → 完成後勾選、`status: done`、`last_updated: 2026-10-03T15:20+08:00`
```

## Bad Example

- 這個例子是壞的，因為它忽略 brief 從頭重做，還把 brief 提交進 git。

```md
重新 grep 整個 repo 規劃任務 → 做完 `git add WORKTREE-BRIEF.md src/` → commit
```

# Rule 2 - Git baseline 不是你的範圍，只准動 brief 允許的路徑

- Level: `MUST`
- 開工先跑 `git status`。brief 的 Git baseline 段列出的路徑，以及任何沒有在任務描述中提到的既有改動，都是 fork 時從 main 帶來的起始狀態，**不是你的工作範圍**：不要改、不要提交、不要整理它們。它們由 main 自己的落地流程處理；碰了會把別人的範圍混進你的 session branch。
- 你**只准**動 brief Scope 段列出的檔案與目錄。
- 工作中發現必須動 scope 外的檔案才能完成時，**NEVER** 自行擴大範圍：停下，在 brief 與完成回報寫明「需要擴大到哪些路徑、為什麼」，由 coordinator 決定是拆成另一個任務，還是回 `/specify` 做授權的 scope 修訂（依 [[scope-discipline]]）。

## Good Example

- 這個例子是好的，因為它遇到 scope 外需求時停下回報，而不是順手改。

```md
任務 scope：server/auth/**。實作中發現 `shared/types/user.ts` 型別也要改。
→ brief 記錄 blocker、`status: blocked`，完成回報寫「需擴大到 shared/types/user.ts：token 型別需新增 refreshAt 欄位」。
```

## Bad Example

- 這個例子是壞的，因為它把 baseline 帶來的檔與 scope 外的檔一起提交。

```md
`git status` 有 config/app.ts（baseline）與自己改的 server/auth/token.ts、shared/types/user.ts
→ 全部 commit 進 session branch。
```

# Rule 3 - 非 UI view 列派出的 worker 不准改 view-layer 檔

- Level: `MUST`
- 除非 brief 的 routing 列是 UI view 實作列（`ui-view-implementation`，含 Nuxt UI 元件組裝與 Nuxt Content），**NEVER** 修改下列檔案：
  - 副檔名：`.vue`、`.tsx`、`.jsx`、`.css`、`.scss`
  - 目錄：`pages/`、`components/`、`layouts/`、`views/`，以及 `app/pages/`、`app/components/`、`app/layouts/`
- 任務需要動到 view 層時，照 Rule 2 停下回報，由 coordinator 依 routing table 另派 UI view 列。
- commit 前自我檢查：`git diff main..HEAD --name-only` 不應出現上列路徑。

## Good Example

- 這個例子是好的，因為非 UI 列的 worker 只改 API，view 需求交回 coordinator。

```md
routing 列：non-ui-implementation。任務：新增 token 續期 API。
→ 只改 server/api/auth/refresh.post.ts 與測試；完成回報註明「前端需在 app/components/LoginForm.vue 呼叫新 API，需另派 UI view 列」。
```

## Bad Example

- 這個例子是壞的，因為非 UI 列的 worker 順手改了元件。

```md
routing 列：non-ui-implementation → 改完 API 後順便把 app/components/LoginForm.vue 也接上。
```

# Rule 4 - 動手寫入前先輸出 Plan，寫完立刻繼續

- Level: `MUST`
- 在任何 Edit／Write／會寫入的 Bash 動作之前，先在輸出最開頭寫一段 `## Plan`，包含：
  - 要動的具體檔案（每條一行相對路徑）
  - 每個檔案打算做什麼變動（一句話）
  - 預期影響範圍
- Plan 寫完後**立刻**繼續執行，**不要**停下來等確認。
- Plan 列出的檔案必須落在 Rule 2 的 scope 內；列不進 scope 的就是 Rule 2 的 blocker。

## Good Example

- 這個例子是好的，因為 Plan 具體到檔案與變動，且寫完直接開工。

```md
## Plan
- server/api/auth/refresh.post.ts：新增 token 續期 endpoint
- test/auth/refresh.test.ts：新增續期成功與過期兩個案例
- 影響範圍：auth API；不動 view 與 schema
（接著開始實作）
```

## Bad Example

- 這個例子是壞的，因為 Plan 空泛且停下等待，背景 worker 會因此卡住。

```md
## Plan
- 修好 auth
等待確認後開始。
```

# Rule 5 - commit 只做 selective stage，訊息照 emoji＋type 一對一格式

- Level: `MUST`
- 你被授權在這棵樹內 commit，可以有多個 commit。
- **MUST** selective stage：新檔逐檔 `git add -- <path>`，其餘用 `git add -- <files-you-actually-changed>` 或 `git commit --only -- <paths>`。**NEVER** `git add -A`／`git add .`——它們會把 Rule 2 的 baseline 一起撈進你的 branch。
- commit header 形狀是 `<emoji> <type>(<scope>): <subject>`（scope 可省），由 repo 的 `commit-msg` commitlint hook 強制。emoji 與 type 一對一綁定，挑符合這次變更的那一對：
  - `✨ feat`／`🐛 fix`／`🧹 chore`／`🔨 refactor`／`🧪 test`／`🎨 style`／`📝 docs`／`📦 build`／`👷 ci`（另有 `⏪ revert`／`🚀 deploy`／`🎉 init`）
  - emoji 缺漏或配錯對時整個 header 無法解析，錯誤會顯示成 `subject-empty`，而不是指出 emoji 錯了。
  - 部分 repo（含 clade）要求 subject 含中文，先看該 repo 的 `commitlint.config.ts`。
- **Pi phase checkpoint 例外**：依 `agent-routing.pi-watch-protocol` 逐 phase 派出的 Pi，每個 phase 結束只留一筆 checkpoint commit，header 固定為 `🧹 chore: wt <change>-phase-<N> — <說明>`（主線靠它在 `git log main..HEAD` 對齊 phase 邊界）；說明在要求中文 subject 的 repo（含 clade）必須含中文，否則 commitlint 擋下。其餘 worker 一律照上一條挑對應的 emoji＋type。
- **NEVER**：`git push origin main`、`git stash`、`git commit --amend`、`--no-verify`、`HUSKY=0`。hook 擋下時修正內容或訊息，不繞過。
- 計畫型工作每完成一個 phase：先回讀該 phase 的證據與 gate，再把 carrier 的 checkbox 與 verify evidence sidecar（`docs/evidence/<work-slug>.jsonl`）一起限定路徑 commit（artifact-tick，type 用 `📝 docs`）。只勾 checkbox、沒有對應 receipt 不算完成證據；未 commit 的檔案不會隨落地帶回 main。

## Good Example

- 這個例子是好的，因為它只 stage 自己改的檔，header 的 emoji 與 type 配對正確且 subject 含中文。

```bash
git add -- server/api/auth/refresh.post.ts test/auth/refresh.test.ts
git commit -m "✨ feat(auth): 新增 token 續期 API"
```

## Bad Example

- 這個例子是壞的，因為它全量 stage 撈進 baseline，還用 `--no-verify` 繞過 commitlint 與 pre-commit hook（header 就算寫對，繞過 hook 也不合格；emoji 與 type 配錯時 hook 會以 `subject-empty` 擋下，正是不能繞的理由）。

```bash
git add -A
git commit --no-verify -m "✨ feat(auth): 新增 token 續期 API"
```

# Rule 6 - 有非空 commit 後就 push 自己的 session branch、開 draft PR、盯 CI

- Level: `MUST`
- 可見性是 session branch 上的 PR，不是合回 main。相對 base 有非空 committed diff 後，**MUST** push **你自己這條** session branch、開 **draft** PR，並盯該 PR 的 CI；紅燈在**同一條** branch、**同一張** PR 上修。舊模板曾寫「worker 不准 push」，該說法已廢止，以本條為準。
- 依工作形狀選 base：
  - **單一切片就完工的工作**：base 是 `main`；開 draft PR 後在自己樹內跑 `batch draft "$PWD" --work-id <work-id> --pr <n> --kind visibility` 登記 receipt。draft 期間 CI 跑什麼看該 repo 的 workflow：clade 的 draft PR 只跑機械檢查、**不跑 test-lane**，要測試訊號就在來源 worktree 跑 `test:affected`；repo 沒有 `test:affected` 時跑它的測試指令。**NEVER** 為了看綠燈提前 `gh pr ready`。
  - **Integration 模式**（同一 work id 有 2 個以上切片時的預設，見 [[github-flow]] § Integration branch）：
    - `gh pr create --base integration/<work-id>`，做到一半先開 draft；該 PR 的 CI 只有機械檢查、不跑 test-lane。
    - 切片 PR **不**登記 `batch draft` receipt（整件工作的 receipt 綁在 `integration/<work-id>` 對 `main` 那一張）。
    - 在來源 worktree 跑完本機門檻：canonical check ＋ repo 在 CI 機械檢查裡跑的 typecheck。clade 是 `pnpm exec vp check` ＋ `node node_modules/typescript-native/bin/tsc -p tsconfig.clade.json --noEmit`，動到 `vendor/scripts` 再加 `node node_modules/typescript-native/bin/tsc -p tsconfig.vendor.json --noEmit`（TS 7，**NEVER** 寫 `npx tsc`，見 `scripts/lib/tsc-native.ts`）。兩條 tsc 以秒計，不必排 heavy gate slot。
    - 本機門檻通過且該 PR 的 CI 全綠後，自己 `gh pr ready` 這張切片 PR，completion 回 coordinator；由 coordinator 以 `integration-merge.ts --pr <n>` 落地。`test:affected` 由 coordinator 在 integration 轉 ready 前跑一次，不是你的責任。
    - **NEVER** 對 `main` 開 PR。
- draft 維持 draft 直到 review；**NEVER** 為了讓成果被看見而 merge-back 或直推 `main`。

## Good Example

- 這個例子是好的，因為它依切片數選對 base，並在本機門檻與 CI 都綠之後才轉 ready。

```md
work id W-2026-10-01-auth 有 3 個切片，本樹是切片 2：
→ `git push -u origin session/2026-10-03-1420-auth-refresh`
→ `gh pr create --draft --base integration/W-2026-10-01-auth`
→ 本機 `pnpm exec vp check` ＋ tsc 綠、PR CI 綠 → `gh pr ready <n>` → completion 回 coordinator
```

## Bad Example

- 這個例子是壞的，因為它照舊模板不 push，或在 integration 模式對 main 開 PR 並為了看測試提早轉 ready。

```md
- 「依合約不 push」→ coordinator 看不到成果，PR 不存在。
- `gh pr create --base main`（本 work id 有 3 個切片）→ 立刻 `gh pr ready` 想跑 test-lane。
```

# Rule 7 - 權限止於 worktree 邊界，做完最後一項不等於取得收尾授權

- Level: `MUST`
- 你的 commit 與你自己的 PR 是你的；把它們落地到 main 不是。以下一律 **NEVER**：
  - `wt-helper batch ready`、啟動完整 `/commit` 品質鏈、批次落地
  - squash、`git merge --squash`、`gh pr merge`、`batch merge-unattended`、legacy `wt-helper merge-back`
  - `git push origin main`、在 main 上 commit、任何指派來源以外的操作
  - 清理或移除任何 worktree（含你自己的）
- 標 `work.done`（或任何 archive／完成標記）只有在 brief **明確指派** archive 且驗收 gate 已通過時，才在本來源內執行，不進 main。單純做完實作不等於被指派 archive；沒指派就回報完成後停止。
- 正式批次審查與落地由具名 coordinator 負責；你持有的 PR 不給你 merge 權限，你也不持 merge credential。

## Good Example

- 這個例子是好的，因為 brief 沒指派 archive，做完就只回報並停止。

```md
Progress 全勾、測試綠、draft PR CI 綠 → brief 未指派 archive → 回報完成，停止寫入。
```

## Bad Example

- 這個例子是壞的，因為它把「做完」當成收尾授權，自己落地並清掉樹。

```md
Progress 全勾 → `gh pr merge --squash` → `wt-helper cleanup auth-refresh`
```

# Rule 8 - 驗收要真的跑，NEVER 為了綠燈改壞實作或測試

- Level: `MUST`
- 完成前跑 brief 驗收標準列出的 build／test 指令，確認綠燈；brief 沒寫時至少跑該 repo 的 canonical check。
- **NEVER** 為了讓 test 綠而 hard-code 回傳值、跳過邏輯分支，或改測試期望值遷就實作。
- 驗收跑不綠且無法在 scope 內修好時，`status: failed`／`blocked` 並如實回報，不宣稱完成。

## Good Example

- 這個例子是好的，因為測試失敗時修的是實作，並附上驗收輸出。

```md
`pnpm test test/auth` 1 個失敗：過期 token 未拒絕 → 修 server/auth/token.ts 的過期判斷 → 重跑全綠，回報附輸出摘要。
```

## Bad Example

- 這個例子是壞的，因為它改測試期望去配合錯誤的實作。

```md
過期 token 測試失敗 → 把 `expect(res.status).toBe(401)` 改成 `toBe(200)` → 全綠。
```

# Rule 9 - 完成回報要可驗證，回報後停止寫入來源

- Level: `MUST`
- 成功回報 **MUST** 含：
  - `workId`、repository、PR 號、branch
  - checkpoint SHA（以及本樹全部 commit SHA 清單）、異動檔數
  - scope（實際動到的路徑）
  - 證據路徑與 hash（測試輸出、evidence sidecar 等）
  - writer-release（明說你已停止寫入此來源）
  - 一行變更摘要
- 失敗回報 **MUST** 含 `fail — <reason>`、目前卡在哪個 Progress 項目、brief 的 `status`；尚未 commit 就中止也照實說，worktree 與 branch 會被保留供檢查。
- 回報後**停止寫入來源**。worker 完成 ≠ 落地；後續驗收、就緒登記與落地由 coordinator 處理。

## Good Example

- 這個例子是好的，因為每個欄位都能讓 coordinator 直接核對。

```md
done — workId W-2026-10-01-auth / repo YuDefine/clade / PR #742 / branch session/2026-10-03-1420-auth-refresh
checkpoint 3f2a91c（commits: 8b1d0e2, 3f2a91c）/ 4 files
scope: server/api/auth/refresh.post.ts, server/auth/token.ts, test/auth/refresh.test.ts, test/auth/token.test.ts
evidence: docs/evidence/auth-refresh.jsonl sha256 9c41…
writer-release: 已停止寫入此來源
摘要：新增 token 續期 API 與過期拒絕
```

## Bad Example

- 這個例子是壞的，因為它只有一句結論，coordinator 無從驗證，而且回報後還繼續改。

```md
done，都改好了。（接著又順手調整了 README）
```
