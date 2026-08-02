<!--
🔒 LOCKED — managed by clade
Source: rules/core/commit.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Commit

<!-- never-density-reviewed: 2026-07-25 — 38 條列舉式 NEVER 逐條覆核過：人工檢查 gate 7 條各封一條具體繞道路徑、檔案系統等效動作 6 條是非顯然洞察、其餘多為逐字反開脫。本檔是紀律型規約（已有多條對應 pitfall），依 rule-authoring § 紀律型規約三件套，反開脫清單就是正確形式。已刪的 3 條純複述見 git history。 -->

所有 commit **MUST** 透過 `/commit` command 執行。**NEVER** 直接 `git commit`（例外見下）。

## 理由

`/commit` 封裝了品質閘門，繞過等於讓壞 code / 壞版本號 / 壞 tag 進 repo。各 gate 一行定性如下，**MUST 全綠才能 commit**；執行細節一律見 `/commit` skill（`.claude/skills/commit/SKILL.md`）：

- **0-A** 程式碼審查：simplify（序跑第一）→ `codex exec` review high（GPT-5.5 跨模型，經 codex-review-safe.sh）→ Critical / Major 條件升 xhigh；修正一律由主線執行
- **0-B** UI Design Review（條件觸發）：`.vue` 模板 + 頁面/元件/佈局/互動/樣式變更時派 screenshot-review
- **0-C** format / lint / typecheck / test / doctor 全綠：`scripts.check` 不含 test → 額外跑 `pnpm test`；`scripts.doctor` **必裝**（缺裝 = block commit，要求先安裝 vite-doctor）。oxfmt batched `--check` 報未預期 diff 以單檔重跑為準（[[pitfall-oxfmt-batched-check-false-positive]]）
- **0-D** Doc Alignment（條件觸發）：diff 觸及 docs / rules / snippets / audit script / 業務碼 / bug fix 時，檢查 cross-ref / 路徑引用 / pitfall status / 三方受眾文件忠實度（含 VitePress sidebar）四面向
- **0-E** evlog map 覆蓋率（條件觸發）：diff 觸及 entry point（`server/{api,routes,middleware,tasks}/` / pages / Next route handler）時跑 ratchet gate；`@evlog/cli` **必裝**（缺裝 = block commit，比照 doctor），本次 diff 觸及的**每一個** entry point MUST 滿分，既有 gap 不強制補
- **並行**：simplify 序跑完後 **0-A.1 / 0-B / 0-C 三軸 MUST 並行**（除非 fast-path 跳過 0-A.1）；0-D / 0-E 在匯合後條件觸發
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

- **NEVER** 在 worktree 內跑 `/commit`、`/spectra-commit`，或用 raw `git commit` land 任何 substantive change — 違反「commit 集中在 main」原則。**唯一例外是 artifact-tick**，見下節
- **NEVER** 在 worktree 跑 /commit 後**又**試圖 stash 剩餘改動到 main — 已經分裂成兩段 commit

### worktree 內唯一合法的 commit：artifact-tick（hard rule）

上一條的 `git commit` 禁令有且只有一個例外：**把 change artifact 的進度標記落進 worktree branch**，路徑限定 `openspec/changes/**/tasks.md`：

```bash
git commit --only -m "📝 spectra: phase N done (<change-name>)" -- openspec/changes/<change-name>/tasks.md
```

`merge-back --squash` 只帶 committed changes 回 main，未 commit 的 checkbox 留在 worktree working tree → main 的 tasks.md 永遠是 `[ ]` → impl-gate 誤判。操作細節與時機見 [[worktree-default]] §9.5.1（該節是執行面 SoT，本節是「worktree 內能不能 commit」的契約 SoT）。

**NEVER** 把其他檔搭這條例外的便車：同一個 commit 混進 `openspec/changes/**/tasks.md` 以外的路徑，就不再是 artifact-tick，回到上一條禁令。
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

`git commit --only -- <paths>` 機制：暫存原 staged → 以 `--only` paths 重建 staged（hook 只看到這些 paths）→ commit → 還原原 staged 區。**對 `<paths>` 以外的路徑副作用為零**，別 session 預 staged 在別的檔案的內容不受影響。

### `--only` 限的是路徑，不是內容（hard rule）

`--only` 重建 staged 時，對每個列出的路徑是從 **worktree** 拿該檔**完整**的當前內容——包含別 session 寫在同一個檔案裡、還沒 commit 的部分。共用檔（`docs/tech-debt.md` / `HANDOFF.md` / `openspec/ROADMAP.md` / `CLAUDE.md` / i18n locale）正是最常被多 session 同時寫的那幾個。

- **MUST** commit 前跑 `git diff -- <paths>` 看實際會帶走什麼；出現不是自己寫的段落 → 依 § Recovery from mixed commit 處置，**NEVER** 直接 commit 下去
- **NEVER** 用裸 `git commit --amend` 改 message——`--amend` 重新 commit **當前 staged index**，等於把 `--only` 的保護整個放掉（實測：同一情境下 commit 從 1 檔變 26 檔）。要改 message **MUST** 帶 `--only`：

  ```bash
  git commit --amend --only -m "<new message>" -- <same paths as the original commit>
  ```

實證與最小可重現：[[pitfall-consumer-ad-hoc-commit-eats-other-session-staged]] § Occurrence 4。

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

### 隔離 worktree ≠ 繞過 /commit（hard rule）

main 髒 / 有別 session WIP 不能直接跑 `/commit`（會吃別人 staged）→ 正解是**在乾淨隔離 worktree 內跑 `/commit`**，**NEVER** 用「隔離 worktree + raw `git commit` + `git push origin main`」把 substantive change 繞過 0-A review 推上 origin/main。隔離 worktree 是多 session 安全手段、不是 review 豁免。判別走下節的路徑白名單，**NEVER** 靠「這批算不算小」自評；`\do-all` / 時間壓力 **NEVER** 是跳 gate 的理由。實證：[[pitfall-isolated-worktree-raw-commit-push-bypasses-commit-gate]]

### `--only` 適用範圍 = 路徑白名單（hard rule）

「小型 ceremony」不是可觀察的 predicate —— 任何一批改動都能自稱小。判準改成**看路徑**：

**白名單（ad-hoc `git commit --only` 一律可用）**：

| 路徑 | 說明 |
| --- | --- |
| `HANDOFF.md`、`openspec/ROADMAP.md`、`docs/tech-debt.md` | 跨 session 狀態檔 |
| `tasks/**`、`docs/discussions/**`、`docs/digests/**` | session-scoped 與討論紀錄 |
| `docs/pitfalls/**`、`docs/archives/**` | 事後紀錄與 rotate 產物 |
| `vendor/snippets/**/*.md` | cookbook / pressure scenario 散文 |
| `openspec/changes/**/tasks.md` | worktree phase-tick 專用（見 § worktree 內唯一合法的 commit：artifact-tick） |

**白名單外的一切改動 MUST 走 `/commit`**，包含但不限於：`rules/**`、`scripts/**`、`vendor/scripts/**`、`plugins/**`、`claude-md/**`、`registry/**`、任何 source code。改動落在白名單內外**混合**時，整批走 `/commit`——**NEVER** 拆成「白名單那半用 `--only` 先送」。

**「純 typo」不是跨路徑的例外**。它只在白名單路徑內成立，且僅限散文本身的錯字。**NEVER** 拿它包裝：規約措辭修正（改的是 MUST / NEVER 的語意）、程式識別字重命名、註解以外的任何程式碼改動——這三類即使一個字元也走 `/commit`。

## Multi-session shared working-tree 的 git hazard

多 session 並行是常態。任何**不帶 path scope** 的 git index / stash 操作（`git add -A` / `git add .` / `git stash push` 不帶 pathspec / `publish.ts --stash-untracked` / merge-back auto-stash / `git clean`）都會把別 session 未 commit 的東西捲進來 → mixed commit、WIP 永久遺失、deploy commit 內容跟 message 不符。防法統一：**path-scoped 隔離**（`git commit --only -- <paths>`）或**避開共用 index**（per-session worktree）。

> 完整危害點 × 規約 × pitfall 交叉索引，見 [[commit.trunk-gates]]。

## main / master 限定的兩條 hard gate

**Partial Archive Gate**（含 `openspec/changes/<X>/**` staged-delete 時驗 archive dir + spec delta-sync）與**人工檢查 Gate**（實作已開始且 `## 人工檢查` 有未勾項時擋 commit）都是 main / master 限定 hard rule，**無 override**。判定條件、fail-fast 位置、完整反開脫 NEVER 清單見 [[commit.trunk-gates]]；執行層在 `.claude/skills/commit/SKILL.md` Step 0-Archive-Coupling / Step 0-MR 與 `check-review-readiness.ts`。

## 禁止事項

- **NEVER** `git commit --amend` 修改已 push 的 commit — 會破壞遠端 history
- **NEVER** `git commit --no-verify` — 繞過 pre-commit hook
- **NEVER** 以「變更很小」「只是 typo」「趕時間」為由跳過 `/commit`
- **NEVER** 以「dev server 需要這個 fix」「E2E 測試要通過」「unblock 驗證」為由直接 `git commit` 跳過 `/commit` — 修 main code 讓 dev server 生效是 OK 的（hot reload），但 **commit 必須等到 `/commit` 時統一走閘門**。正確做法：Edit 修好 → dev server hot reload 自動生效 → 改動留在 working tree 不 commit → 驗證完後統一 `/commit`
- **NEVER** 讓 subagent 自主執行 `git commit` — commit **必須在主線執行**；使用者觸發 `/commit` 即代表授權整批分組，主線**不需**在分組後另行徵詢確認（commit 流程預設無互動）
- **NEVER** 跳過 `pnpm run doctor` — import graph 問題 lint / typecheck 抓不到；**MUST** 帶 `run`，裸 `pnpm doctor` 撞 pnpm 內建子命令會 silent exit 0、根本沒跑 vite-doctor
- **NEVER** 在 doctor health score < 100 或 exit ≠ 0 時視為通過 — 即使 warning 是既有非本次 diff 引入，每次 `/commit` **MUST** 修到 100/100 + 0 warnings 才繼續（保持零警告 baseline，避免 debt 累積）
- **NEVER** 在 `docs/` 補新頁面但漏更新 VitePress sidebar config（0-D 觸發條件本身見 § 理由）

### WIP 處置禁令（嚴格）

**完全禁止任何會丟失 WIP 的動作，包括「向使用者建議」這些動作**：

#### Git 命令禁令

- **NEVER** 執行 `git restore` / `git restore --staged` / `git checkout --` / `git checkout <path>` 清場 — 這會永久毀掉 unstaged 變更
- **NEVER** 執行 `git reset --hard` / `git reset HEAD --hard` / `git clean -fd` — 同上
- **NEVER** 執行 `git stash clear`（一次炸掉全部，無法逐條判定）；`git stash drop` **僅**在通過下方
  § Stash 自動處置 gate 的全部判準時允許，其餘一律禁止
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

chat / thinking / tool call description 中出現以下任一關鍵詞，**MUST** 立即停手（不下任何命令，`AskUserQuestion` 給使用者拍板）：

中：`revert` / `還原` / `回退` / `退回` / `撤回` / `復原` / `恢復` / `清除` / `清掉` / `重置` / `回到乾淨狀態` / `丟掉` / `刪掉` / `修正狀態` / `對齊狀態` / `把 X 還回 Y` / `把 X 搬回 Y` / `先還原再 …` / `先 revert 再 …`

En：`revert` / `undo` / `rollback` / `roll back` / `reset` / `discard` / `drop` / `restore` / `clean up` / `go back` / `undo this` / `fix the state` / `align with` / `move X back to Y` / `restore X to original`

> **本節是關鍵詞表的 SoT**，因為 `commit.md` 是 always-load——破壞性動作在任何 session 都可能發生，這張表必須每一輪都在視窗內。[[scope-discipline]] § 話術關鍵詞 是 conditional-load（`paths:` 只涵蓋 openspec / HANDOFF / tech-debt / decisions），它引用本表而不自帶副本。停手定義四步與「為什麼話術 = 思考表徵」在該檔。

#### 唯一例外

使用者在 `$ARGUMENTS` 中**明確、主動、白紙黑字**寫出 `git restore` / `git checkout --` / `mv <具體路徑> <具體路徑>` / `rm -rf <具體路徑>` / `revert <具體 commit>` 等指令或具體變更名稱，且語意無歧義時才能執行。**NEVER** 從「不在 scope」「看起來壞掉」「違反 X rule」等模糊語氣自行解讀為「使用者想丟棄」。

## Stash 自動處置 gate

**核心命題**：把 stash 的處置權完全綁在 user 身上，前提是 user 會去看。**那個前提對不會人工看 stash 的
user 不成立**，結果是 stash 單調遞增、owner 資訊隨時間流失，最後沒有任何人有能力判斷能不能刪
（<consumer-a> 2026-08-02 實證：一個 session 內 6 → 10 條，全由自動化流程建立，10 條裡 9 條無 sidecar metadata）。

因此 `git stash drop` **不是**絕對禁令，而是**綁機械判準的條件動作**。

### 放行判準（三條全中才可 drop）

1. **內容可重生**：`git stash show --stat <ref>` 列出的**每一個**檔都落在可重生投影層 ——
   `.claude/**`、`.codex/**`、`.clade/**`、`AGENTS.md`、`CLAUDE.md`、`.npmrc`、`skills-lock.json`
   （這些由 `pnpm hub:bootstrap` 重生）。**有任何一個檔不在此清單就不算命中**
2. **來源已消失**：stash message 內的 slug 對應的 worktree **已不存在**（`git worktree list` 查不到）。
   slug 解析不出來時，退回時間門檻：**建立逾 24 小時**
3. **先留痕再 drop**：把 `<ref>`、`createdAt`、`--stat` 全文、命中的判準 append 進
   `docs/archives/stash-dropped.md`（append-only），**寫完才 drop**

   ⚠️ **副檔名 MUST 是 `.md` 不是 `.log`** —— 多數 consumer 的 `.gitignore` 有 `*.log`，寫成 `.log`
   的留痕永遠進不了 git，換機器或重新 clone 就消失，等於沒留（2026-08-02 <consumer-a> 實證）。

### 否決判準（任一命中即 NEVER drop）

- `--stat` 含業務碼路徑：`packages/**`、`server/**`、`app/**`、`src/**`、`supabase/migrations/**`、
  `test/**`、`e2e/**`
- 含 `openspec/changes/**` 且該 change **仍 active**（`openspec/changes/<name>/` 還在，未進 `archive/`）
- 對應 worktree **仍存在**（可能正在用，pre-sync 的 stash 還要 pop 回去）
- 判準跑不出明確結論（stat 讀不到、slug 歧義）→ **不 drop**，列進 audit 段給 user

### 與話術停手信號的關係

本 gate 的 drop **不觸發** § 話術關鍵詞 = 立即停手訊號。理由：那條攔的是「從模糊語氣自行解讀成該丟棄」
的推理鏈，而本 gate 的每一條判準都是**可機械檢查的事實**，不經過那條推理鏈。

**但 `git stash clear` 仍然全面禁止** —— 它一次炸掉全部，無法逐條套判準。

### NEVER

- **NEVER** 因為「看起來都是投影漂移」就跳過逐條 `--stat` 檢查 —— 命中率不是憑印象估的
- **NEVER** 先 drop 再補留痕 —— drop 之後 `--stat` 就取不到了，留痕會變成憑記憶編造
- **NEVER** 拿本 gate 當理由放寬其他 WIP 處置禁令 —— `git restore` / `reset --hard` / `clean -fd` /
  `stash clear` 一條都沒鬆綁

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
- **修正所有發現的問題（含既有 codebase 問題）**：review / lint / typecheck / test / codex review 發現的問題都**MUST**修正，**包含不在本次 diff scope 內的既有 codebase 問題**。codex review 掃到的 finding 不論是本次改動引入還是既有存在，處置路徑一律：
  - **可立即修**（< 30 分鐘、不涉及架構決策）→ 當場修、納入本次 commit 分組
  - **不可立即修**（架構級、跨多檔、需要更多 context）→ **MUST** 登記到 `docs/tech-debt.md` 開 TD-NNN，**NEVER** 靜默跳過
  - **NEVER** 以「既有問題」「不在本次 scope」「建議性質」「影響不大」為由跳過任何 finding — 跳過等於讓已知問題長期留存
  - **例外**：修法會動到別 session in-flight WIP（典型：`HANDOFF.md`、別 session 的 `tasks/<...>.md`）時，**MUST** 走 `scope-discipline.md`「Rule 衝突解法」具體分支模板（A. 馬上修續 flow / B. 登 TD 中止 flow）由 user 拍板，**NEVER** 自行二選一

## 搭配

Skill 本體 `.claude/skills/commit/SKILL.md` 定義「怎麼做」（procedure）；本規則定義「要不要做」（政策、閘門、強制入口）。

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。
