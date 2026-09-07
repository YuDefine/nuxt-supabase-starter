<!--
🔒 LOCKED — managed by clade
Source: rules/core/commit.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- clade-targets: claude,codex,cursor -->

# Commit

<!-- never-density-reviewed: 2026-07-25 — 38 條列舉式 NEVER 逐條覆核過：人工檢查 gate 7 條各封一條具體繞道路徑、檔案系統等效動作 6 條是非顯然洞察、其餘多為逐字反開脫。[[commit.detail]] 是紀律型規約（已有多條對應 pitfall），依 rule-authoring § 紀律型規約三件套，反開脫清單就是正確形式。已刪的 3 條純複述見 git history。 -->

所有 commit **MUST** 完成當前 runtime 的 commit skill 流程。有原生 `/commit` 入口時使用該入口；沒有時先讀已投影技能與必要 supporting 文件，再執行相同 gates。**NEVER** 直接 `git commit` 略過流程（具名例外見 [[commit.detail]]）。

## 強制載入指針（thin pointer；全文在 [[commit.detail]]）

本檔只常駐兩件東西：**commit 的強制入口**與 **WIP 處置禁令 / 話術關鍵詞表**（破壞性動作在任何 session 都可能發生，那張表必須每一輪都在視窗內）。其餘全文在 `rules/core/commit.detail.md`（path-scoped，glob 只涵蓋 `HANDOFF.md` / `tasks/**` / `.clade/claims/**` / `.clade/work-loop/**`——它的觸發是下一行那個具名時機，不是編輯檔案順帶載入）。

**下任何 `git commit` / `git add` / `git stash` / `git tag` / `git push --tags` / `git push origin v<版本>` / `/commit` 之前，MUST 先讀 [[commit.detail]]**——沒讀到就等於沒有 gate 清單、沒有 `--only` 紀律、沒有 recovery 流程。

| 搬走的段 | 去 [[commit.detail]] 的 § |
| --- | --- |
| 理由（0-A ~ Step 5 各 gate 定性） | § 理由 |
| Single Session Lock | § Single Session Lock |
| WIP 處置決策樹 | § WIP 處置決策樹 |
| Commit 預設位置：main worktree（含 stash 合法中介 / 禁止項 / artifact-tick） | § Commit 預設位置：main worktree |
| Ad-hoc commit 必走 `git commit --only -- <paths>`（含 Verify / Recovery / 路徑白名單） | § Ad-hoc commit 必走 `git commit --only -- <paths>` |
| Multi-session shared working-tree 的 git hazard | § Multi-session shared working-tree 的 git hazard |
| main / master 限定的兩條 hard gate | § main / master 限定的兩條 hard gate |
| 禁止事項（`--amend` / `--no-verify` / doctor 等） | § 禁止事項 |
| Stash 自動處置 gate | § Stash 自動處置 gate |
| 例外（極少）、Commit 分組與訊息規範、搭配 | § 例外（極少）起 |

## pre-commit hook 三條紀律（always-load；hook 是 fleet 預設形態）

三條各綁一個**下指令當下看得到**的 predicate，**每一個**有 `.husky/pre-commit` 的 repo 都適用——
不是只有「hook 看起來很慢」的那些，也不是只對最後一次 commit。

1. **repo 存在 `.husky/pre-commit` → `git commit` MUST 使用可持續執行並取回終態的 command handle。**
   在當前 runtime 的工具 catalog 確認啟動、等待與取消介面；取得 handle 後沿用它收回結果。
   Claude 的 `run_in_background` 是該端參數，Codex／Cursor 使用自己實際提供的介面。
   缺少持續執行能力時回報缺口；timeout 或沒有結果時先查原 invocation 的狀態，不另起一次 commit。
   前景呼叫被 tool timeout kill 時，index 已 staged 而 commit 沒落地，外觀與「commit 失敗」
   逐字相同；照那個外觀重跑，是在一個**不同的起始狀態**上再跑一次。**NEVER** 用「這個 repo 的
   hook 平常很快」略過——快慢是上一次的觀測，`.husky/pre-commit` 存在與否才是這一次的事實。

2. **commit 後 `git status` 出現 `MM` → MUST 先跑 `git diff HEAD -- <path>` 再決定。**
   輸出為空 = HEAD 已經是對的，只是 index 留著 hook 改寫前的 blob，`git restore --staged <path>`
   才是這個情境的處置；先確認該 staged 差異來自本次 hook、沒有其他 session 正在寫同一路徑。
   這個命令只更新 index；執行後核對工作檔 bytes 不變與 `git diff HEAD -- <path>` 仍為空。
   歸屬不明或同路徑仍在寫入時保留現況，走 [[commit.detail]] 的並行 staged 歸屬探測。
   **NEVER** 直接補一個 formatting commit——那會把一個不存在的差異寫進 history。

3. **格式化 MUST 用 repo 自己的 formatter script**（`package.json` 的 `format` / `fmt` script，
   或該 repo 文件指名的那一支）。判準是「這個 repo 用哪一支」，**NEVER** 是「我慣用哪一支」：
   對 oxfmt repo 跑別的 formatter 會產生風格互斥（單引號無分號 ↔ 雙引號加分號），每次 commit 後
   hook 都把工作區改回去，看起來像 hook 壞掉。

> 成因與 <consumer-a> 實測（hook > 2 分鐘、被 tool timeout kill）見
> [[pitfall-pre-commit-hook-outlives-tool-timeout-and-rewrites-staged-files]]。

## 禁止事項 — WIP 處置禁令（嚴格；always-load，NEVER 下推）

**完全禁止任何會丟失 WIP 的動作，包括「向使用者建議」這些動作**：

### Git 命令禁令

- **NEVER** 執行會覆寫工作檔的 `git restore`（含 `--worktree`）/ `git checkout --` / `git checkout <path>` — 這會丟棄對應的 unstaged 變更。「清場」與「**還原剛才為了驗證而臨時改的檔**」都可能覆寫本次工作開始前已存在的 WIP；臨時改動以原工具精確反向修改，保留其他差異，不用 Git 整檔還原。
- **Index-only 操作另判 staged 所有權**：`git restore --staged -- <paths>` 不改工作檔，但會改掉使用者選定的 staged 內容。只有上方 hook `MM` 的完整判準成立，或使用者已明確授權該 index 操作時才執行；其他情境保留 index，走 [[commit.detail]] 的歸屬探測。**NEVER** 用 unstage 排除 `/commit` 已授權納入的其他 group，或把同時帶 `--worktree` 的命令當成 index-only。
- **NEVER** 執行 `git reset --hard` / `git reset HEAD --hard` / `git clean -fd` — 同上
- **NEVER** 執行 `git stash clear`（一次炸掉全部，無法逐條判定）；`git stash drop` **僅**在通過下方
  § Stash 自動處置 gate 的全部判準時允許，其餘一律禁止
- **NEVER** 提議 `git revert` 或在輸出中暗示「可以 revert XX」「要不要還原 XX」「這部分先 revert」 — `revert` 在使用者語境通常意指**丟棄變更**，會誤導使用者破壞 WIP；真正需要還原既有 commit 的情境極罕見且應由使用者主動發起

### 檔案系統等效動作禁令（同樣 destructive）

以下動作功能上等同破壞性 git 命令，**MUST** 視同 WIP 處置禁令範圍：

- **NEVER** `mv <git-tracked-path> <elsewhere>` / `mv <elsewhere> <git-tracked-path>` 反向 hook 工作（例：把 `openspec/changes/archive/2026-MM-DD-*/` 搬回 `openspec/changes/*/`、把 `screenshots/<env>/_archive/*` 搬回頂層）
- **NEVER** `rm -rf <openspec/changes/**>` / `rm -rf <screenshots/**>` 等批次刪除含 user-authored / hook-authored 內容的目錄
- **NEVER** `cp --remove-destination` / `cp -f` 覆蓋 git-tracked 檔案
- **NEVER** 用 `sed -i` / `awk -i inplace` / `perl -i` 隱藏 git-tracked 檔案的覆寫；授權編輯使用當前 runtime 可審查 diff 的編輯工具，腳本批次編輯同樣先確認範圍、保留原內容並驗 diff
- **NEVER** `echo > <git-tracked-path>` / `cat > <git-tracked-path>` / `tee` 覆蓋 git-tracked 檔案內容
- **NEVER** 用 shell script / subprocess 包裝上述動作試圖繞過 tool-level 觀察

### 推理層禁令

- **NEVER** 以「這變更看起來壞掉了 / 不該存在 / 不在 scope，是否要還原？」徵詢使用者 — 唯一允許的選項是 `git stash` + `HANDOFF.md`，照「WIP 阻礙處理」流程走
- **NEVER** 把「revert / restore / discard」包裝成「清理」「重置」「回到乾淨狀態」「對齊規約」「修正狀態」等委婉說法繞過上述禁令
- **NEVER** 拿其他 rule（例 manual-review.md `[discuss]` 應 user walkthrough）當理由還原 hook 自動產出 — 先保留現狀、查歸屬與既有授權，未解衝突再以當前提問介面請使用者決定（詳見 `scope-discipline.md`「Rule 衝突解法」）
- **NEVER** 看到 hook 自動 archive directory / spec 自動 propagate / annotation 自動寫入時，自行判定「應該還原」— 自動產出同樣受到 WIP 所有權保護，依下表判斷而非按產生者名稱推論

### 話術關鍵詞 = 立即停手訊號

準備執行或提議會丟棄 WIP、覆寫工作檔或改掉他人 staged 選擇的動作時，下列關鍵詞提醒先核對對象、所有權與本任務既有授權；對象或授權不明就停手，保留現況並向使用者確認。判準是動作的實際副作用，單純讀取、引用指令或撰寫恢復文件不會取得修改權，也不因出現同一個字就需要使用者拍板。

| 目前準備做的事 | 下一步 |
|---|---|
| 只讀現況、解釋 Git 語義或撰寫本次已授權文件 | 繼續該唯讀或文件工作，不執行文中描述的破壞性命令 |
| 上方 hook `MM` 的完整判準成立 | 依 index-only recipe 執行並核對工作檔不變 |
| 要丟棄或覆寫工作檔，且已有本任務的明確具體授權 | 只執行授權的對象與動作；不擴張到其他 WIP |
| 對象、所有權、授權或副作用仍不明 | 保留現況，唯讀釐清；需要使用者決定時提出具體範圍與結果 |

中：`revert` / `還原` / `回退` / `退回` / `撤回` / `復原` / `恢復` / `清除` / `清掉` / `重置` / `回到乾淨狀態` / `丟掉` / `刪掉` / `修正狀態` / `對齊狀態` / `把 X 還回 Y` / `把 X 搬回 Y` / `先還原再 …` / `先 revert 再 …`

En：`revert` / `undo` / `rollback` / `roll back` / `reset` / `discard` / `drop` / `restore` / `clean up` / `go back` / `undo this` / `fix the state` / `align with` / `move X back to Y` / `restore X to original`

> **本節是關鍵詞表的 SoT**，因為 `commit.md` 是 always-load——破壞性動作在任何 session 都可能發生，這張表必須每一輪都在視窗內。[[scope-discipline]] § 話術關鍵詞 是 conditional-load（`paths:` 只涵蓋 openspec / HANDOFF / tech-debt / decisions），它引用本表而不自帶副本。停手定義四步與「為什麼話術 = 思考表徵」在該檔。

### 工作檔丟棄的授權

使用者在本任務的訊息或 `$ARGUMENTS` 中**明確、主動、白紙黑字**寫出 `git restore` / `git checkout --` / `mv <具體路徑> <具體路徑>` / `rm -rf <具體路徑>` / `revert <具體 commit>` 等指令或具體變更名稱，且語意無歧義時才能執行。同一範圍已取得的授權持續有效，不因換工具呼叫或提到關鍵詞而重新詢問。**NEVER** 從「不在 scope」「看起來壞掉」「違反 X rule」等模糊語氣自行解讀為「使用者想丟棄」。

> 上文提到的 § Stash 自動處置 gate 在 [[commit.detail]] § Stash 自動處置 gate。


> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。
