<!--
🔒 LOCKED — managed by clade
Source: rules/core/commit.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->

# Commit

所有 commit **MUST** 透過 `/commit` command 執行。**NEVER** 直接 `git commit`（例外見下）。

## 理由

`/commit` 封裝了品質閘門，繞過等於讓壞 code / 壞版本號 / 壞 tag 進 repo。各 gate 一行定性如下，**MUST 全綠才能 commit**；執行細節一律見 `/commit` skill（`.claude/skills/commit/SKILL.md`）：

- **0-A** 程式碼審查：simplify（序跑第一）→ `codex review --uncommitted` high（GPT-5.5 跨模型）→ Critical / Major 條件升 xhigh；修正一律由主線執行
- **0-B** UI Design Review（條件觸發）：`.vue` 模板 + 頁面/元件/佈局/互動/樣式變更時派 screenshot-review
- **0-C** format / lint / typecheck / test / doctor 全綠：`scripts.check` 不含 test → 額外跑 `pnpm test`；有 `scripts.doctor` → 額外跑。oxfmt batched `--check` 報未預期 diff 以單檔重跑為準（[[pitfall-oxfmt-batched-check-false-positive]]）
- **0-D** Doc Alignment（條件觸發）：diff 觸及 docs / rules / snippets / audit script / 業務碼 / bug fix 時，檢查 cross-ref / 路徑引用 / pitfall status / 三方受眾文件忠實度（含 VitePress sidebar）四面向
- **並行**：simplify 序跑完後 **0-A.1 / 0-B / 0-C 三軸 MUST 並行**（除非 fast-path 跳過 0-A.1）；0-D 在匯合後條件觸發
- **Step 1** Schema 同步檢查 — `database.types.ts` 與 migration 對齊
- **Step 5** 版本號升級 + tag push — `feat` → minor、其他 → patch

這些檢查**無法事後補跑**：漏跑的 commit 已在 history、壞版本號已 push 出去。

## Single Session Lock

**同時只能有一個 session 跑 `/commit`**（同時跑兩次會撞 staging、檢查互踩、版本號競態、tag push 衝突）。由 `.claude/scripts/commit-lock.mjs` 實作，鎖檔 `.claude/.commit.lock`（已 gitignored）：**Step 0-Lock** 必跑 `acquire`，失敗（另一 session 佔用）→ **停下**回報使用者，不自行 `rm` 清鎖；**Final Step** 必跑 `release`，即便中間失敗 / 使用者中止也要釋放，**NEVER** 讓鎖長期遺留；stale 閾值 30 分鐘自動清除。

## WIP 處置決策樹

**預設所有 `git status` 顯示的 uncommitted 變更都納入本次 `/commit`**（無條件，不徵詢），照常跑 0-A 並在 Step 3 依功能分組成獨立 commit：

```text
uncommitted 變更
├─ 預設（無條件）→ 全納入分組；「主題不同 / 不認得來源 / 想讓 commit 乾淨 / 跟我無關」
│    都不是阻礙 → 拆獨立 commit group 解決；一律假設是使用者並行工作
├─ WIP 阻礙處理（stash，極少數例外）— 僅三條件之一（使用者明確要求視為涵蓋）：
│    1. 品質閘門卡死且短時間修不好  2. 明確不該入庫的殘留（debug print / 假資料 / 敏感資訊）
│    3. 使用者主動在 $ARGUMENTS 指名要 stash
│    → 優先 stash 該檔本身（git stash push -u -- <檔>）而非整批 + MUST 在 HANDOFF.md 登記
│      （stash 訊息對應、對齊哪條觸發條件、接手指引），寫完才繼續
└─ worktree → main commit handoff → stash 是合法規約中介（見下節），不受上列三條件限制
```

- **排除條件（唯一）**：使用者在 `$ARGUMENTS` 中**明確**指名排除（例如「排除 .env.local」「只 commit app/」）。其他任何情境一律全包
- **NEVER** 以「這個不在我 scope」「看起來是別的 session 做的」「不確定是否該 commit」自行排除、啟動 stash、或徵詢使用者意見 — 分組是 Step 3 的工作，不是 Step 0 的判斷題

**理由**：品質閘門成本高，WIP 分次 commit = 多跑一次閘門；stash 把工作往後推，但保留可恢復 + HANDOFF paper trail，等同「延後」而非「丟棄」；任何 `git restore` / `git checkout --` / `git reset` / `git revert` 都會**永久毀掉使用者的 WIP**（見「WIP 處置禁令」）。

## Commit 預設位置：main worktree

**`/commit` MUST 在 main worktree 跑、NEVER 在 session worktree 內跑**。

Worktree 完成驗證後的標準收尾（詳見 [[worktree-default]] §5）：**主線自動執行** selective stash → 跨 worktree pop → cleanup（**不切** session cwd），完成後 user 只需開 main session 跑 `claude "/commit"`。

- 預檢：pop 前 `git -C <main> status --porcelain` 非空 → 中止 closure、stash entry 保留、提示 user 處理 main 端 WIP
- Cleanup 安全性依賴 selective stash 列舉完整性（漏列檔永久丟）；pop 失敗 **NEVER** 跑 cleanup（改動還沒進 main）
- 手動 fallback（user 明確要求自己處理時）：見 `.claude/skills/commit/SKILL.md`

理由：**單一 ceremony**、**避免雙 hop**、**branch HEAD 乾淨**（worktree 內不 commit）、**0-C 在 main 跑**（跟 CI 一致）。

### 此路徑的 stash 是合法中介

§ WIP 處置決策樹的 stash 例外**僅限**單一 working tree 內的 WIP 處置；**worktree → main 跨 working tree handoff** 是不同情境——stash 在這裡是規約定義的中介機制、**不**受該禁令限制：

| 情境 | Stash 是 | 替代做法 |
| --- | --- | --- |
| 單一 working tree 多主題 WIP（同一 cwd 內混了主題 A + B） | **last resort**（觸發三條件之一才用） | Step 3 分組納入 |
| Worktree → main commit handoff | **合法規約中介**（每次收尾都用） | 無——這就是預設路徑 |

### 禁止項

- **NEVER** 在 worktree 內跑 `/commit`、`/spectra-commit`、或 `git commit` — 違反「commit 集中在 main」原則
- **NEVER** 在 worktree 跑 /commit 後**又**試圖 stash 剩餘改動到 main — 已經分裂成兩段 commit
- **NEVER** 用 `git stash push` 不加 `-u` — 漏掉 untracked 新檔
- **NEVER** stash pop 撞 conflict 時用 `git checkout --` / `git restore` 「清理」 — 會永久毀掉 main 既有 WIP

## Ad-hoc commit 必走 `git commit --only -- <paths>`

本 § 規範 **ad-hoc commit**：不走 `/commit` 的單檔 / 少數檔 commit（`HANDOFF.md` 補一行、修 typo 等小型 git ceremony；完整 `/commit` 已有 Step 0-Lock + selective per-group commit 保護）。

### Hard rule

Ad-hoc commit **MUST** 用 `git commit --only -m "..." -- <paths>`，**NEVER** 用 `git add + git commit` 兩段操作。

```bash
# NEVER:
git add scripts/my-file.sh && git commit -m "..."

# ALWAYS:
git commit --only -m "..." -- scripts/my-file.sh
git push
git show --stat HEAD | tail -3   # MUST verify scope == expected paths
```

### Why

working tree / git index 是 **process-wide shared state**——多 session 並行下，別 session **預 stage 但未 commit** 的 WIP 殘留在 index；`git add` **疊加**到既有 staged 上（不是 replace），`git commit` 把整個 staged 區一起吞並 push 出去（實證：[[pitfall-consumer-ad-hoc-commit-eats-other-session-staged]]）。

`git commit --only -- <paths>` 機制：暫存原 staged → 以 `--only` paths 重建 staged（hook 只看到這些 paths）→ commit → 還原原 staged 區，別 session 預 staged 內容**不受影響**，副作用零。

### Untracked file 例外

`--only` 不接受 untracked pathspec。新增檔須先 `git add <untracked>` 再 `git commit --only -- <both-paths>`，**scope 仍受 `--only` 過濾**，別人的 staged 不會進 commit。

### Verify hard rule

Commit 後 **MUST**：

```bash
git show --stat HEAD | tail -3
```

Changed files 數量 / 路徑 vs 預期不符 → **STOP** + 走 § Recovery from mixed commit (multi-session safety)（**NEVER** 反射性 `git reset --soft HEAD~1` — HEAD 可能不是你預期的 HEAD，會吃掉別 session 的 commit）。

### Recovery from mixed commit (multi-session safety) — hard rule

撞到 mixed commit / commit scope drift（`git show --stat HEAD` 含預期外 file）後，agent **MUST**：

1. **STOP + 列現狀**（動 git history 前先看清楚：`git log` / `git reflog` / 活躍 session 偵測 / `git stash list`）
2. **AskUserQuestion 給 user 拍板**，選項至少含：(A) **接受 mixed commit + 登記 cleanup**（最安全）、(B) **立即 reset/rebase 修復**（user **MUST** 對 race risk 知情同意）、(C) **等並行 session 收斂再評估**
3. **NEVER** 自行跑 `git reset --soft HEAD~N` / `git rebase -i HEAD~N`（**任何 relative reference**）— `HEAD~N` 在 race window 內可能指到別 session 的 commit（多次實證）
4. user 選 (B) → **MUST** 用 **specific SHA reference** 且**先**建 backup tag 保險；**NEVER** 在並行 session 活躍時跑 `git rebase` split mixed commit
5. 撞坑後亦 **MUST** 在 [`docs/pitfalls/`](../../docs/pitfalls/) 對應 entry 加 regression evidence section

完整 6 步操作流程 + 命令塊 + backup tag 模板：`~/offline/clade/vendor/snippets/git-recovery/README.md`；cross-ref [[pitfall-consumer-ad-hoc-commit-eats-other-session-staged]] § Regression Evidence。

### Fleet sweep 升級規約

跨多檔工作（fleet sweep / dep migration / 跨檔 refactor）**SHOULD** 走 worktree（per [[worktree-default]]），main working tree 完全不動 — 從機制上避開 staged race，每 worktree 各自獨立 index。

## Multi-session shared working-tree 的 git hazard 地圖

多 session 並行是常態，「全 working tree scope」的 git 操作會 silently 吃進別 session 的 staged WIP / untracked 新檔 / stash 內容 → mixed commit、WIP 永久遺失、deploy commit 內容跟 message 不符。

### 系統性根因

任何**不帶 path scope** 的 git index / stash 操作（`git add -A` / `git add .` / `git stash push` 不帶 pathspec / `publish.mjs --stash-untracked` / merge-back auto-stash / `git clean`）都會把別 session 未 commit 的東西捲進來。防法統一：**path-scoped 隔離**（`git commit --only -- <paths>`）或**避開共用 index**（per-session worktree）。

### 交叉索引

| 危害點 | 既有規約 | Pitfall |
| --- | --- | --- |
| Ad-hoc `git add + git commit` 吃別 session staged WIP | 本檔 § Ad-hoc commit 必走 `git commit --only -- <paths>` | [[pitfall-consumer-ad-hoc-commit-eats-other-session-staged]] |
| `git stash push` 不帶 pathspec → scope leak | [[worktree-default]] §1（Stash strategy 隱性風險 / Anti-pattern 手動 selective baseline sync） | [[pitfall-git-stash-pathspec-scope-leak]] |
| `publish.mjs` auto-stash 把 tracked file 捲進 deploy commit | [[worktree-default]] §1 + [[clade-publish]] § Step 3（分組 commit，禁 `--stash-untracked` 對 tracked dirty） | [[pitfall-publish-auto-stash-bundles-tracked-into-deploy-commit]] |
| `publish.mjs` flow 清掉別 session 的 parallel untracked file | [[worktree-default]] §1（Pre-fork baseline guard） | [[pitfall-publish-flow-cleans-parallel-untracked]] |
| Merge-back auto-stash 整批捲走別 session WIP | [[worktree-default]] §5.5（Merge-back ceremony / Stash reconcile） | [[pitfall-merge-back-autostash-bulk-captures-other-session-wip]] |

已撞 mixed commit → 本檔 § Recovery from mixed commit (multi-session safety)；cross-session staged 偵測層 → commit SKILL `Step 0-Coord`。

## Partial Archive Gate（main / master 限定，**hard rule**）

當前 branch 為 `main` / `master` 且本次 `/commit` 含**任一** `openspec/changes/<X>/**` staged-delete（**排除** `openspec/changes/archive/`）時，**MUST** 對該 change 同時驗證：

1. **archive directory 存在** — `openspec/changes/archive/YYYY-MM-DD-<X>/` 必須存在於 working tree（staged 或 untracked 皆可），且至少含 `tasks.md` + `proposal.md`
2. **spec delta-sync 完整** — 若 HEAD 內 `openspec/changes/<X>/specs/<cap>/spec.md` 存在，則 `openspec/specs/<cap>/spec.md` 必須有對應 staged modification

任一條件不成立 → **中止 commit**，release lock，列出殘缺項 + 印出 recovery hint（含 `git show HEAD:<src> > <dst>` 命令模板，見 commit SKILL `Step 0-Archive-Coupling`；詳見 [[pitfall-spectra-archive-interrupted-leaves-partial-state]] § Fix Recipe）。

### 為何 gate 在這

- `/spectra-archive` 是多 step 非 atomic flow，任一步驟中斷會留下 staged-delete + 缺 archive dir 的 partial state；直接 commit = `openspec/changes/<X>/**` 完全消失於 history，spec delta 卡在 wt-merge-block stash 也會永久遺失
- 跟人工檢查 Gate 並列：兩條都是 main / master 限定的 hard rule，都在 0-A/B/C 之前 fail-fast

### 無 override

**NEVER** 接受 `--skip-archive-coupling` / `--ignore-archive` / `$ARGUMENTS` 旗標。Gate 過 = archive flow 真的跑完。

- **NEVER** 用 `git restore --staged` 把 staged-deletes 退掉「敷衍 gate」— 掩蓋 in-flight archive state
- **NEVER** `mv archive/YYYY-MM-DD-<X>/ <somewhere-else>` 後重 stage 假裝 archive 存在
- **NEVER** 自行決定「也許那個 change 不該 archive」直接 unstage deletes — partial state 一律由 user 拍板

## 人工檢查 Gate（main / master 限定，**hard rule**）

當前 branch 為 `main` / `master` 且本次 `/commit` 觸及的 spectra change（`openspec/changes/<name>/**` 路徑，archive 子目錄除外）滿足下列**兩條件同時成立**時，**MUST** 中止 commit：

1. 該 change 的 `tasks.md` **非** `## 人工檢查` 段落含任一 `- [x]` → 已開始 / 完成實作
2. 該 change 的 `## 人工檢查` 段落含任一 `- [ ]` → 人工檢查未完成

只滿足其一不擋（純 propose 未動工、或實作完且人工檢查全綠，都允許 commit）。判定流程、fail-fast 位置見 `.claude/skills/commit/SKILL.md` Step 0-MR。

### 為何 gate 在這

- main / master 是 trunk 終點（直接 push 觸發 deploy / propagate），**沒有 PR review 擋一層** — 下一個人類關卡就是線上 user
- `## 人工檢查` 區就是要擋「實作完但 functional round-trip 未驗收」的工作（見 [[manual-review]] §「Screenshot Review ≠ Functional Verification」案例）；commit 進 main 等同跳過該保護
- 排在 0-A/B/C 之前 fail-fast，省 5–15 min 不必要的 codex / screenshot / check 成本

### 無 override

**NEVER** 接受 `--skip-manual-review-gate` / `--ignore-mr` / `$ARGUMENTS` 旗標等任何形式跳過。Gate 過 = 真的完成人工檢查（依 [[manual-review]] 「核心規則」由使用者親自驗收後勾選 `- [x]`）。

- **NEVER** 主線自行勾掉 `- [ ]` 來通過 gate — 違反 [[manual-review]] 核心規則「**NEVER** 自行標記 `## 人工檢查` 區塊中屬於 `[review:ui]` kind 的 `- [ ]` 為 `- [x]`」
- **NEVER** `git stash` / `mv` / `rm` 把 `tasks.md` 或 change 目錄移走讓 gate scan 抓不到 — 等同繞過 hard rule，亦違反 [[commit]] 「WIP 處置禁令」
- **NEVER** 把「人工檢查還沒完成」包裝成「審查條件已滿足」「等同 OK」「之後再勾」 — gate 看的是 tasks.md 的實際勾選狀態
- **NEVER** 建議 user「先 checkout 到 feature branch 跑 /commit 再 merge 回 main」繞過 gate
- **NEVER** 因為「使用者沒明說 main 算 trunk」而判 branch 不算 — `main` / `master` 都算

## 禁止事項

- **NEVER** `git commit` / `git commit -m` — 繞過 0-A / 0-B / 0-C 品質閘門
- **NEVER** `git commit --amend` 修改已 push 的 commit — 會破壞遠端 history
- **NEVER** `git commit --no-verify` — 繞過 pre-commit hook
- **NEVER** 以「變更很小」「只是 typo」「趕時間」為由跳過 `/commit`
- **NEVER** 讓 subagent 自主執行 `git commit` — commit **必須在主線執行**；使用者觸發 `/commit` 即代表授權整批分組，主線**不需**在分組後另行徵詢確認（commit 流程預設無互動）
- **NEVER** 在 lock 被佔用時自行 `rm .claude/.commit.lock`、**NEVER** 漏跑 Final Step `release`（見 § Single Session Lock）
- **NEVER** 把 `pnpm check` 當作完整 0-C；**MUST** 先 grep 確認 `scripts.check` 含 `test` / `vitest`，不含就額外跑 `pnpm test`
- **NEVER** 跳過 `pnpm run doctor`（若 `scripts.doctor` 存在）— import graph 問題 lint / typecheck 抓不到；**MUST** 帶 `run`，裸 `pnpm doctor` 撞 pnpm 內建子命令會 silent exit 0、根本沒跑 vite-doctor
- **NEVER** 在 doctor health score < 100 或 exit ≠ 0 時視為通過 — 即使 warning 是既有非本次 diff 引入，每次 `/commit` **MUST** 修到 100/100 + 0 warnings 才繼續（保持零警告 baseline，避免 debt 累積）
- **NEVER** 跳過 0-D doc alignment（觸發條件成立時）；**NEVER** 在 docs/ 補新頁面但漏更新 VitePress sidebar config

### WIP 處置禁令（嚴格）

**完全禁止任何會丟失 WIP 的動作，包括「向使用者建議」這些動作**：

#### Git 命令禁令

- **NEVER** 執行 `git restore` / `git restore --staged` / `git checkout --` / `git checkout <path>` 清場 — 這會永久毀掉 unstaged 變更
- **NEVER** 執行 `git reset --hard` / `git reset HEAD --hard` / `git clean -fd` — 同上
- **NEVER** 執行 `git stash drop` / `git stash clear`
- **NEVER** 提議 `git revert` 或在輸出中暗示「可以 revert XX」「要不要還原 XX」「這部分先 revert」 — `revert` 在使用者語境通常意指**丟棄變更**，會誤導使用者破壞 WIP；真正需要還原既有 commit 的情境極罕見且應由使用者主動發起

#### 檔案系統等效動作禁令（同樣 destructive）

以下動作功能上等同破壞性 git 命令，**MUST** 視同 WIP 處置禁令範圍：

- **NEVER** `mv <git-tracked-path> <elsewhere>` / `mv <elsewhere> <git-tracked-path>` 反向 hook 工作（例：把 `openspec/changes/archive/2026-MM-DD-*/` 搬回 `openspec/changes/*/`、把 `screenshots/<env>/_archive/*` 搬回頂層）
- **NEVER** `rm -rf <openspec/changes/**>` / `rm -rf <screenshots/**>` 等批次刪除含 user-authored / hook-authored 內容的目錄
- **NEVER** `cp --remove-destination` / `cp -f` 覆蓋 git-tracked 檔案
- **NEVER** `sed -i` / `awk -i inplace` / `perl -i` 在 git-tracked 檔案上 in-place 寫入而**沒走 Edit/Write tool**（無 user 看得到的 diff）
- **NEVER** `echo > <git-tracked-path>` / `cat > <git-tracked-path>` / `tee` 覆蓋 git-tracked 檔案內容
- **NEVER** 用 shell script / subprocess 包裝上述動作試圖繞過 tool-level 觀察

#### 推理層禁令

- **NEVER** 以「這變更看起來壞掉了 / 不該存在 / 不在 scope，是否要還原？」徵詢使用者 — 唯一允許的選項是 `git stash` + `HANDOFF.md`，照「WIP 阻礙處理」流程走
- **NEVER** 把「revert / restore / discard」包裝成「清理」「重置」「回到乾淨狀態」「對齊規約」「修正狀態」等委婉說法繞過上述禁令
- **NEVER** 拿其他 rule（例 manual-review.md `[discuss]` 應 user walkthrough）當理由還原 hook 自動產出 — rule 衝突一律保留現狀 + AskUserQuestion（詳見 `scope-discipline.md`「Rule 衝突解法」）
- **NEVER** 看到 hook 自動 archive directory / spec 自動 propagate / annotation 自動寫入時，自行判定「應該還原」— 自動產出 = 跨 session 成果，必先 AskUserQuestion

#### 話術關鍵詞 = 立即停手訊號

chat / thinking / tool call description 中出現以下任一關鍵詞，**MUST** 立即停手（不下任何命令，AskUserQuestion 給使用者拍板）：

中：`revert` / `還原` / `回退` / `退回` / `撤回` / `復原` / `恢復` / `清除` / `清掉` / `重置` / `回到乾淨狀態` / `丟掉` / `刪掉` / `修正狀態` / `對齊狀態` / `把 X 還回 Y` / `把 X 搬回 Y` / `先還原再 …`

En：`revert` / `undo` / `rollback` / `roll back` / `reset` / `discard` / `drop` / `restore` / `clean up` / `go back` / `undo this` / `fix the state` / `align with` / `move X back to Y` / `restore X to original`

詳細停手定義 + 為什麼話術即訊號，見 `scope-discipline.md`「話術關鍵詞 = 立即停手訊號」。

#### 唯一例外

使用者在 `$ARGUMENTS` 中**明確、主動、白紙黑字**寫出 `git restore` / `git checkout --` / `mv <具體路徑> <具體路徑>` / `rm -rf <具體路徑>` / `revert <具體 commit>` 等指令或具體變更名稱，且語意無歧義時才能執行。**NEVER** 從「不在 scope」「看起來壞掉」「違反 X rule」等模糊語氣自行解讀為「使用者想丟棄」。

## 例外（極少）

以下情境允許直接 `git commit`，**MUST** 在 commit message 註明理由：

1. **`/commit` 本身壞掉** — command 檔被改壞、依賴的 agent 不可用時的救火
2. **Merge commit / rebase resolution** — `git merge` / `git rebase --continue` 的自動 commit
3. **`git revert` 既有 commit** — 還原已 push 的 commit，無需重跑品質檢查。**僅**適用於使用者**主動**指明要 revert 哪個 commit（例如 `git revert abc1234`）；**NEVER** 主線自行提議 revert，也**NEVER** 用 `git revert` 處理 uncommitted WIP（一律走「WIP 阻礙處理」的 stash + handoff）

例外情境外，一律走 `/commit`。

## Commit 分組與訊息規範

- **每個 commit 獨立且完整** — 不相關的變更**MUST**分到不同 commit
- **Commit message 使用繁體中文**描述
- **所有 uncommitted 變更都必須入庫**，**NEVER** 以「不在本次範圍」「影響不大」為由跳過任何檔案
- **`.gitignore` 變更**：只允許保留 Clade 管理的 installation artifact / runtime state ignore 條目（例如 `.claude/.commit.lock`、`codex/`）；其他變更**MUST** `git stash push -- .gitignore` 並寫入 `HANDOFF.md`（**NEVER** `git checkout .gitignore` 直接還原）
- **`.env` / 敏感檔案**：警告使用者但仍由使用者決定是否 commit，**NEVER** 自行跳過
- **修正所有發現的問題**：review / lint / typecheck / test 發現的問題都**MUST**修正，**NEVER** 以「建議性質」「不在本次範圍」為由跳過。**例外**：修法會動到別 session in-flight WIP（典型：`HANDOFF.md`、別 session 的 `tasks/<...>.md`）時，**MUST** 走 `scope-discipline.md`「Rule 衝突解法」具體分支模板（A. 馬上修續 flow / B. 登 TD 中止 flow）由 user 拍板，**NEVER** 自行二選一

## Commit 類型（commitlint.config.js）

| Emoji | Type     | 用途     |
| ----- | -------- | -------- |
| ✨    | feat     | 新功能   |
| 🐛    | fix      | Bug 修復 |
| 🧹    | chore    | 維護     |
| 🔨    | refactor | 重構     |
| 🧪    | test     | 測試     |
| 🎨    | style    | 樣式     |
| 📝    | docs     | 文件     |
| 📦    | build    | 建置     |
| 👷    | ci       | CI/CD    |
| ⏪    | revert   | 還原     |
| 🚀    | deploy   | 部署     |
| 🎉    | init     | 初始化   |

## 搭配

Skill 本體 `.claude/skills/commit/SKILL.md` 定義「怎麼做」（procedure）；本規則定義「要不要做」（政策、閘門、強制入口）。

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。
