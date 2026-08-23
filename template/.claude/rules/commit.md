<!--
🔒 LOCKED — managed by clade
Source: rules/core/commit.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Commit

<!-- never-density-reviewed: 2026-07-25 — 38 條列舉式 NEVER 逐條覆核過：人工檢查 gate 7 條各封一條具體繞道路徑、檔案系統等效動作 6 條是非顯然洞察、其餘多為逐字反開脫。[[commit.detail]] 是紀律型規約（已有多條對應 pitfall），依 rule-authoring § 紀律型規約三件套，反開脫清單就是正確形式。已刪的 3 條純複述見 git history。 -->

所有 commit **MUST** 透過 `/commit` command 執行。**NEVER** 直接 `git commit`（例外見下）。

## 強制載入指針（thin pointer；全文在 [[commit.detail]]）

本檔只常駐兩件東西：**commit 的強制入口**與 **WIP 處置禁令 / 話術關鍵詞表**（破壞性動作在任何 session 都可能發生，那張表必須每一輪都在視窗內）。其餘全文在 `rules/core/commit.detail.md`（path-scoped，glob 只涵蓋 `HANDOFF.md` / `tasks/**` / `.clade/claims/**` / `.clade/work-loop/**`——它的觸發是下一行那個具名時機，不是編輯檔案順帶載入）。

**下任何 `git commit` / `git add` / `git stash` / `/commit` 之前，MUST 先讀 [[commit.detail]]**——沒讀到就等於沒有 gate 清單、沒有 `--only` 紀律、沒有 recovery 流程。

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

## 禁止事項 — WIP 處置禁令（嚴格；always-load，NEVER 下推）

**完全禁止任何會丟失 WIP 的動作，包括「向使用者建議」這些動作**：

### Git 命令禁令

- **NEVER** 執行 `git restore` / `git restore --staged` / `git checkout --` / `git checkout <path>` — 這會永久毀掉 unstaged 變更。**禁的是動作，不是某一種用途**：「清場」只是最常見的那個，「**還原剛才為了驗證而臨時改的檔**」是同樣會毀掉整輪未 commit 改動的第二個入口 —— 它主觀上像 undo，實際是還原到 index，而 index 裡是**上一次 commit** 的版本。臨時改動要還原就反向改回去（同一支 script、同一個編輯器），**NEVER 讓 git 來做這件事**
- **NEVER** 執行 `git reset --hard` / `git reset HEAD --hard` / `git clean -fd` — 同上
- **NEVER** 執行 `git stash clear`（一次炸掉全部，無法逐條判定）；`git stash drop` **僅**在通過下方
  § Stash 自動處置 gate 的全部判準時允許，其餘一律禁止
- **NEVER** 提議 `git revert` 或在輸出中暗示「可以 revert XX」「要不要還原 XX」「這部分先 revert」 — `revert` 在使用者語境通常意指**丟棄變更**，會誤導使用者破壞 WIP；真正需要還原既有 commit 的情境極罕見且應由使用者主動發起

### 檔案系統等效動作禁令（同樣 destructive）

以下動作功能上等同破壞性 git 命令，**MUST** 視同 WIP 處置禁令範圍：

- **NEVER** `mv <git-tracked-path> <elsewhere>` / `mv <elsewhere> <git-tracked-path>` 反向 hook 工作（例：把 `openspec/changes/archive/2026-MM-DD-*/` 搬回 `openspec/changes/*/`、把 `screenshots/<env>/_archive/*` 搬回頂層）
- **NEVER** `rm -rf <openspec/changes/**>` / `rm -rf <screenshots/**>` 等批次刪除含 user-authored / hook-authored 內容的目錄
- **NEVER** `cp --remove-destination` / `cp -f` 覆蓋 git-tracked 檔案
- **NEVER** `sed -i` / `awk -i inplace` / `perl -i` 在 git-tracked 檔案上 in-place 寫入而**沒走 Edit/Write tool**（無 user 看得到的 diff）
- **NEVER** `echo > <git-tracked-path>` / `cat > <git-tracked-path>` / `tee` 覆蓋 git-tracked 檔案內容
- **NEVER** 用 shell script / subprocess 包裝上述動作試圖繞過 tool-level 觀察

### 推理層禁令

- **NEVER** 以「這變更看起來壞掉了 / 不該存在 / 不在 scope，是否要還原？」徵詢使用者 — 唯一允許的選項是 `git stash` + `HANDOFF.md`，照「WIP 阻礙處理」流程走
- **NEVER** 把「revert / restore / discard」包裝成「清理」「重置」「回到乾淨狀態」「對齊規約」「修正狀態」等委婉說法繞過上述禁令
- **NEVER** 拿其他 rule（例 manual-review.md `[discuss]` 應 user walkthrough）當理由還原 hook 自動產出 — rule 衝突一律保留現狀 + AskUserQuestion（詳見 `scope-discipline.md`「Rule 衝突解法」）
- **NEVER** 看到 hook 自動 archive directory / spec 自動 propagate / annotation 自動寫入時，自行判定「應該還原」— 自動產出 = 跨 session 成果，必先 AskUserQuestion

### 話術關鍵詞 = 立即停手訊號

chat / thinking / tool call description 中出現以下任一關鍵詞，**MUST** 立即停手（不下任何命令，`AskUserQuestion` 給使用者拍板）：

中：`revert` / `還原` / `回退` / `退回` / `撤回` / `復原` / `恢復` / `清除` / `清掉` / `重置` / `回到乾淨狀態` / `丟掉` / `刪掉` / `修正狀態` / `對齊狀態` / `把 X 還回 Y` / `把 X 搬回 Y` / `先還原再 …` / `先 revert 再 …`

En：`revert` / `undo` / `rollback` / `roll back` / `reset` / `discard` / `drop` / `restore` / `clean up` / `go back` / `undo this` / `fix the state` / `align with` / `move X back to Y` / `restore X to original`

> **本節是關鍵詞表的 SoT**，因為 `commit.md` 是 always-load——破壞性動作在任何 session 都可能發生，這張表必須每一輪都在視窗內。[[scope-discipline]] § 話術關鍵詞 是 conditional-load（`paths:` 只涵蓋 openspec / HANDOFF / tech-debt / decisions），它引用本表而不自帶副本。停手定義四步與「為什麼話術 = 思考表徵」在該檔。

### 唯一例外

使用者在 `$ARGUMENTS` 中**明確、主動、白紙黑字**寫出 `git restore` / `git checkout --` / `mv <具體路徑> <具體路徑>` / `rm -rf <具體路徑>` / `revert <具體 commit>` 等指令或具體變更名稱，且語意無歧義時才能執行。**NEVER** 從「不在 scope」「看起來壞掉」「違反 X rule」等模糊語氣自行解讀為「使用者想丟棄」。

> 上文提到的 § Stash 自動處置 gate 在 [[commit.detail]] § Stash 自動處置 gate。


> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。
