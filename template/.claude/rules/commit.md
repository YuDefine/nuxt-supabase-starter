<!--
🔒 LOCKED — managed by clade
Source: rules/core/commit.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->

# Commit

所有 commit **MUST** 透過 `/commit` command 執行。**NEVER** 直接 `git commit`（例外見下）。

## 理由

`/commit` 封裝了品質閘門，繞過等於讓壞 code / 壞版本號 / 壞 tag 進 repo：

- **0-A** 兩階段 review：(1) `/code-review`（claude 3 並行 agent：reuse / quality / efficiency），(2) `codex review --uncommitted` xhigh（GPT-5.5，跨模型抓 bug / 邏輯 / 安全；fast-path 命中時跳過）；修正一律由 Claude Code 主線執行
- **0-B** UI Design Review（條件觸發）— 含 `.vue` 模板變動 + 屬於頁面/元件/佈局/互動/樣式變更時派 screenshot-review agent
- **0-C** **format / lint / typecheck / test 全綠**：跑 `pnpm check`（多數專案含 format/lint/typecheck）**並且**確認 test 也有跑。**若 `package.json` 的 `scripts.check` 不含 `test` / `vitest`，必須額外跑 `pnpm test`（或 `vp test run` / `pnpm test:unit`），否則 CI 抓到的測試失敗（hook timeout、flake、新增測試壞掉）會在 commit 後才暴露**

**並行執行**：0-A.0 `/code-review` 序跑完後，**0-A.1（codex xhigh 背景）/ 0-B（screenshot subagent）/ 0-C（主線 foreground check）三軸 MUST 並行**（除非 fast-path 跳過 0-A.1）——序跑會浪費 5–10 分鐘閘門時間。`codex review --uncommitted` 啟動時讀 working tree snapshot，後續變動不影響它正在進行的 review，所以三軸並行安全。詳細啟動順序、fast-path 判定、大改動回扣見 `.claude/skills/commit/SKILL.md` 的「0-A/B/C 並行策略」。
- **Step 1** Schema 同步檢查 — `database.types.ts` 與 migration 對齊
- **Step 5** 版本號升級 + tag push — `feat` → minor、其他 → patch

這些檢查**無法事後補跑**：漏跑的 commit 已經在 history 裡，壞版本號已經 push 出去。

## Single Session Lock

**同時只能有一個 session 跑 `/commit`**。由 `.claude/scripts/commit-lock.mjs` 實作，鎖檔 `.claude/.commit.lock`（已 gitignored）：

- Command 流程 **Step 0-Lock** 必跑 `node .claude/scripts/commit-lock.mjs acquire`；若失敗（另一 session 佔用）→ **停下**回報使用者，不自行 `rm` 清鎖
- **Final Step** 必跑 `release`；即便中間失敗、使用者中止，也要釋放，**NEVER** 讓鎖長期遺留
- Stale 閾值預設 30 分鐘（`COMMIT_LOCK_STALE_MINUTES` 可調），超過即自動清除

**理由**：commit 流程同時跑兩次會撞 staging、品質檢查互踩、版本號升級競態、tag push 衝突；一次抓牢節省整體 token。

## WIP 預設範圍

**預設所有 `git status` 顯示的 uncommitted 變更都納入本次 `/commit`**，照常跑 review（0-A）並在分組階段依功能拆成獨立 commit。**這是無條件預設，不需要徵詢使用者。**

- **看到不認得的變更**：直接納入分組流程。**NEVER** 為了「決定要不要納入」而向使用者徵詢；分組是 Step 3 的工作，不是 Step 0 的判斷題
- **排除條件（唯一）**：使用者在 `$ARGUMENTS` 中**明確**指名排除（例如「排除 .env.local」「只 commit app/」）。其他任何情境一律全包
- **NEVER** 以「這個不在我 scope」「看起來是別的 session 做的」「不確定是否該 commit」自行排除或徵詢使用者意見 — 先假設是使用者並行工作 + 一律保留並走分組流程

**理由**：品質閘門成本高，把 WIP 分次 commit 等於多跑一次閘門，浪費時間與 token。`/commit` 的分組階段就是設計來把「主線工作 + 並行 WIP」自然分類到不同 commit group。

## Commit 預設位置：main worktree

**`/commit` MUST 在 main worktree 跑、NEVER 在 session worktree 內跑**。Worktree 是工作區、main 是 commit ceremony 發起點。

Worktree 完成驗證後的標準收尾流程（詳見 [[worktree-default]] §5）：**主線自動執行** stash + 跨 worktree pop + cleanup worktree（用 `git stash push -u -m "<slug>-handoff" -- <Edit/Write 過的檔>` selective stash + `git -C <main> stash pop` + pop 成功後 `node <main>/scripts/wt-helper.mjs cleanup <slug> --force`，**不切** session cwd），完成後 user 只需開 main session 跑 `claude "/commit"`。

預檢：跑 pop 前 `git -C <main> status --porcelain` 若非空 → 中止 closure、stash entry 保留、提示 user 自行處理 main 端 WIP。

Cleanup 安全性依賴 selective stash 列舉的完整性（漏列檔會永久丟）；pop 失敗時 **NEVER** 跑 cleanup（worktree 改動還沒進 main）。

手動 fallback（user 明確要求自己處理時）：

```bash
# 在 worktree（驗證 OK、準備收尾）
git stash push -u -m "<slug>-handoff"

# 切回 main worktree（consumer 主路徑）
cd ~/offline/<consumer>

# Pop changes 進 main 的 working tree
git stash pop

# 跑 /commit（一次完成 0-A/B/C 品質閘門 + selective stage + commit + push）
claude "/commit"
```

理由：

- **單一 ceremony**：worktree 跑驗證、main 跑 commit handoff，分工清楚
- **避免雙 hop**：worktree /commit → 再 cd main → ff merge → push 等於跑兩段 ceremony
- **branch HEAD 乾淨**：worktree 內**不** commit，session branch 不留 dangling commit；`wt-helper cleanup <slug>` 後 branch 自然消失
- **0-C 在 main 跑**：`pnpm check` / `pnpm test` 在 main 環境跑一次，跟 CI 環境一致

### 此路徑的 stash 是合法中介

下面「WIP 阻礙處理」把 stash 列為「**極少數例外**」**僅限**單一 working tree 內的 WIP 處置（多主題 WIP 預設靠 Step 3 分組納入）。**Worktree → main 跨 working tree handoff** 是不同情境——stash 在這裡是規約定義的中介機制、**不**受該禁令限制：

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

走完整 `/commit` 流程的 commit 因有 `Step 0-Lock` 防呆 + selective per-group commit 已有保護。本 § 規範的是 **ad-hoc commit**：不走 `/commit` 的單檔 / 少數檔 commit、`HANDOFF.md` 補一行就 commit、修個 typo 就 commit、`/spectra-commit` 以外的小型 git ceremony 等。

### Hard rule

Ad-hoc commit **MUST** 用 `git commit --only -m "..." -- <paths>`，**NEVER** 用 `git add + git commit` 兩段操作。

```bash
# Edit file (Edit / Write tool 或手動)
# NEVER:
git add scripts/my-file.sh && git commit -m "..."

# ALWAYS:
git commit --only -m "..." -- scripts/my-file.sh
git push
git show --stat HEAD | tail -3   # MUST verify scope == expected paths
```

### Why

working tree 是 **process-wide shared state**。多 session 並行（spectra apply / codex / vibe coding / publish auto-stash / 別 agent 跑工作）很常見，別 session 可能在另一 process **預 stage 但未 commit** 的 WIP 殘留在 git index。

`git add <my-file>` **疊加**到既有 staged 上（不是 replace） → `git commit` 把整個 staged 區一起吞 → commit 含跨 session 混合內容並 push 出去（已實證 incident，見 [[pitfall-consumer-ad-hoc-commit-eats-other-session-staged]]）。

`git commit --only -- <paths>` 機制：

1. 暫存當前 staged 區到 cache
2. 用 `--only` paths 重建 staged 區（**忽略**既有 staged 內容；對 modified file 從 worktree 拿 fresh content）
3. Run pre-commit hook（hook 看到的 staged 只含 `--only` paths）
4. Commit
5. 還原原 staged 區 — 別 session 預 staged 內容**不受影響**，他們繼續做

副作用：**零**。

### Untracked file 例外

`--only` 不接受 untracked pathspec（git design）。新增檔須先 `git add <untracked>` 再 `git commit --only -- <both-paths>`，**scope 仍受 `--only` 過濾**，別人的 staged 不會進 commit。

```bash
git add docs/new-file.md                         # untracked → 進 staged
git commit --only -m "..." -- docs/new-file.md scripts/existing-file.sh
```

### Verify hard rule

Commit 後 **MUST**：

```bash
git show --stat HEAD | tail -3
```

Changed files 數量 / 路徑 vs 預期不符 → **STOP** + 走 § Recovery from mixed commit (multi-session safety)（**NEVER** 反射性 `git reset --soft HEAD~1` — multi-session 環境下 HEAD 可能不是你預期的 HEAD，反射性 reset 會吃掉別 session 的 commit）。

### Recovery from mixed commit (multi-session safety) — hard rule

撞到 mixed commit / commit scope drift（`git show --stat HEAD` 含預期外 file）後，agent **MUST**：

1. **STOP + 列現狀**（**禁止**動 git history 之前先看清楚）：

   ```bash
   git log --oneline -5
   git reflog HEAD | head -10
   ps aux | grep -E "codex|claude" | grep -v grep   # 偵測活躍別 session
   git stash list                                    # 別 session 的 stash 是否仍持有 WIP
   ```

2. **AskUserQuestion 給 user 拍板**，選項至少含：
   - (A) **接受 mixed commit + 登記 cleanup** — commit 留 history，push 前處理（最安全）
   - (B) **立即 reset/rebase 修復** — user **MUST** 對 multi-session race risk 知情同意
   - (C) **等並行 session 收斂再評估** — 短期不動 history

3. **NEVER** 自行跑 `git reset --soft HEAD~N` / `git rebase -i HEAD~N`（**任何 relative reference**）— `HEAD~N` 在 race window 內可能指到別 session 的 commit（多次實證）：
   - 第一次 reset 可能吃 race window 內別 session 已 commit 的東西
   - 第二次 reset 可能再吃下一條別 session commit
   - `git rebase -i HEAD~N` 鎖目標時若別 session 同期 commit，rebase 鎖錯目標
   - 從 1 個 mixed commit 升級成 4+ 個破壞性 git operation 是已實證 incident

4. 若 user 選 (B) → **MUST** 用 **specific SHA reference**（不是 `HEAD~N` / `HEAD^`），且**先**建 backup tag 保險：

   ```bash
   git tag backup-before-recovery-$(date +%s) <current-HEAD-SHA>
   git rebase -i <specific-parent-SHA>  # 不用 HEAD~N
   ```

5. **NEVER** 在 multi-session 並行活躍時跑 `git rebase` split mixed commit — 後續 commit 跟 mixed 內容 overlap 機率高，rebase replay 會撞 conflict（已實證：spectra-archive 把某目錄 mv 到 archive 跟 mixed commit 內同目錄 staged change overlap → `git rebase --continue` 撞 `file not found` conflict）。等並行 session 收斂後再評估 history rewrite。

6. **撞坑後**亦 **MUST** 在 [`docs/pitfalls/`](../../docs/pitfalls/) 對應 entry 加 regression evidence section（per `plugins/hub-maintenance-full/skills/oops/SKILL.md` Mode B Step 1 dedupe 命中既有 pitfall 時的 update 路徑）；reflexive recovery 不只是當下的災害，是 prevention coverage gap 的 signal。

Cross-ref：[[pitfall-consumer-ad-hoc-commit-eats-other-session-staged]] § Regression Evidence — 2026-05-28 <consumer-b> session（完整 incident timeline + recovery 多層坑教訓）。

### Fleet sweep 升級規約

跨多檔工作（fleet sweep / dep migration / 跨檔 refactor）**SHOULD** 走 worktree（per [[worktree-default]]），main working tree 完全不動 — 從機制上避開 staged race，每 worktree 各自獨立 index。

### Cross-link

- 同 session 內 cross-session staged pollution 的偵測層：`plugins/hub-core/skills/commit/SKILL.md § Step 0-Coord`
- WIP 預設範圍 + 分組規約：本檔 § WIP 預設範圍 / § Commit 分組與訊息規範
- Fleet sweep + worktree：[[worktree-default]]

## WIP 阻礙處理（**極少數例外**，預設一律靠分組納入）

**預設一律靠 Step 3 分組納入處理 WIP**，stash 是**極少數例外**。「主題不同 / 看起來不相關 / 不認得來源」**全部**透過拆獨立 commit group 解決，**NEVER** 因此啟動 stash —— Step 3 分組就是設計來把多主題、跨 session 的 WIP 自然拆成多個 commit group 的。

**下列情境不是阻礙，不能啟動 stash 流程**：

- 「這些變更跟本次主題不一樣」→ 拆成另一個 commit group（feat / fix / chore / refactor / docs 各自獨立 group）
- 「不認得這些變更來自哪」→ 假設是並行 session 的工作，照常納入分組
- 「想讓本次 commit 主題乾淨」→ commit 不需要乾淨，每個 group 內部完整即可
- 「這個檔案跟我手上工作無關」→ 不關你的事，納入分組

**stash 觸發條件（嚴格收斂為下列任一，且使用者明確要求視為涵蓋）**：

1. **品質閘門卡死且短時間修不好** — 壞掉的實驗碼讓 0-A / 0-B / 0-C 持續紅燈，且修復成本明顯超過本次 commit 範圍
2. **明確不該入庫的殘留** — debug print、暫時 `console.log`、假資料、敏感資訊（且使用者尚未確認要保留）
3. **使用者主動在 `$ARGUMENTS` 指名要 stash** 某些檔案 / 變更

確認觸發後（且優先 **stash 該檔本身**，而非整批 stash）：

```bash
git stash push -u -- <具體檔案路徑>          # 優先：只 stash 阻礙檔
# 確實必要時才整批：
git stash push -u -m "WIP: <簡述為何 stash> — see HANDOFF.md"
```

接著**MUST**在 `HANDOFF.md` 的 `In Progress` 或 `Next Steps` 區塊寫入：

- stash 訊息（讓人能用 `git stash list` 對應）
- 為何 stash（哪個檔、為何不能納入本次 commit；對齊上面 1/2/3 哪一條）
- 接手指引（要怎麼 `git stash pop` / 該如何收尾）

寫完 HANDOFF 後再繼續 `/commit` 的後續流程。

**理由**：

- 多主題 WIP 用分組就能乾淨入庫，stash 只會把工作往後推，違反「不要把工作往後放」原則。
- stash 仍保留變更可恢復、handoff 留下 paper trail，等同「延後處理」而非「丟棄」；但分組納入比 stash 更直接、更省下次 `/commit` 的閘門成本。
- 任何形式的 `git restore` / `git checkout --` / `git reset` / `git revert` 都會**永久毀掉使用者的 WIP**，這是不可接受的成本（見下節嚴格禁令）。

## Partial Archive Gate（main / master 限定，**hard rule**）

當前 branch 為 `main` / `master` 且本次 `/commit` 含**任一** `openspec/changes/<X>/**` staged-delete（任何 path under 該 change，**排除** `openspec/changes/archive/`）時，**MUST** 對該 change 同時驗證：

1. **archive directory 存在** — `openspec/changes/archive/YYYY-MM-DD-<X>/` 必須存在於 working tree（staged 或 untracked 皆可），且至少含 `tasks.md` + `proposal.md`
2. **spec delta-sync 完整** — 若 HEAD 內 `openspec/changes/<X>/specs/<cap>/spec.md` 存在，則 `openspec/specs/<cap>/spec.md` 必須有對應 staged modification（spectra delta-sync output）

任一條件不成立 → **中止 commit**，release lock，列出殘缺項 + 印出 recovery hint（含具體 `git show HEAD:<src> > <dst>` 命令模板）。

### 為何 gate 在這

- `/spectra-archive` 是多 step 非 atomic flow（staged-delete → spec sync → folder mv）。任一步驟中斷會留下 staged-delete + 缺 archive dir 的 partial state。
- 直接 commit 該 partial state = `openspec/changes/<X>/**` 完全消失於 history（HEAD 內容只在 git history reachable via SHA，使用者要 archeology 才找得回）；spec delta 若卡在 wt-merge-block stash 也會永久遺失。
- 跟人工檢查 Gate 並列：兩條都是 main / master 限定的 hard rule，都在 0-A/B/C 之前 fail-fast。

### 無 override

**NEVER** 接受 `--skip-archive-coupling` / `--ignore-archive` / `$ARGUMENTS` 旗標。Gate 過 = archive flow 真的跑完。

- **NEVER** 用 `git restore --staged` 把 staged-deletes 退掉「敷衍 gate」— 那會掩蓋 in-flight archive state，下次又會撞同樣問題
- **NEVER** `mv archive/YYYY-MM-DD-<X>/ <somewhere-else>` 後重 stage 假裝 archive 存在
- **NEVER** 自行決定「也許那個 change 不該 archive」直接 unstage deletes — partial state 一律由 user 拍板

### Recovery hint（gate trigger 後印給 user）

```bash
# 對每個失敗 change <X>:
DATE=$(date +%Y-%m-%d)
SRC="openspec/changes/<X>"
DEST="openspec/changes/archive/${DATE}-<X>"

# 1. 建 archive dir 結構
mkdir -p "$DEST/specs"
git ls-tree -d --name-only HEAD "$SRC/specs/" 2>/dev/null \
  | xargs -n1 basename \
  | xargs -I{} mkdir -p "$DEST/specs/{}"

# 2. 從 HEAD 還原 8 個 change 檔到 archive dir
for f in $(git ls-tree -r --name-only HEAD "$SRC" | sed "s|^$SRC/||"); do
  git show "HEAD:$SRC/$f" > "$DEST/$f"
done

# 3. 若 spec delta 在某 wt-merge-block stash 內，extract（NEVER pop 整個 stash）
git stash list | grep wt-merge-block
git stash show 'stash@{N}' --name-only | grep '^openspec/specs/'
git checkout 'stash@{N}' -- openspec/specs/<cap>/spec.md

# 4. 重跑 /commit
```

詳見 [[pitfall-spectra-archive-interrupted-leaves-partial-state]] § Fix Recipe。

## 人工檢查 Gate（main / master 限定，**hard rule**）

當前 branch 為 `main` / `master` 且本次 `/commit` 觸及的 spectra change（`openspec/changes/<name>/**` 路徑，archive 子目錄除外）滿足下列**兩條件同時成立**時，**MUST** 中止 commit：

1. 該 change 的 `tasks.md` **非** `## 人工檢查` 段落含任一 `- [x]` → 已開始 / 完成實作
2. 該 change 的 `## 人工檢查` 段落含任一 `- [ ]` → 人工檢查未完成

只滿足其一不擋（純 propose 未動工的 change、或實作完且人工檢查全綠的 change，都允許 commit）。判定流程、fail-fast 位置（Step 0-Scope 之後、Step 0 品質檢查之前）見 `.claude/skills/commit/SKILL.md` Step 0-MR。

### 為何 gate 在這

- main / master 是 trunk 終點（clade / <consumer-a> 等直接 push main 觸發 deploy / propagate），**沒有 PR review 擋一層**。下一個有意義的人類關卡就是線上 user。
- `## 人工檢查` 區設計就是要擋下「實作完了但 functional round-trip 未驗收」的工作（見 [[manual-review]] §「Screenshot Review ≠ Functional Verification」案例）；commit 進 main 等同跳過該區的保護。
- 排在最耗時的 0-A/B/C 品質閘門之前，fail-fast 可省 5–15 min 不必要的 codex / screenshot / check 成本。

### 無 override

**NEVER** 接受 `--skip-manual-review-gate` / `--ignore-mr` / `$ARGUMENTS` 旗標等任何形式跳過。Gate 過 = 真的完成人工檢查（依 [[manual-review]] 「核心規則」由使用者親自驗收後勾選 `- [x]`）。

- **NEVER** 主線自行勾掉 `- [ ]` 來通過 gate — 違反 [[manual-review]] 核心規則「**NEVER** 自行標記 `## 人工檢查` 區塊中屬於 `[review:ui]` kind 的 `- [ ]` 為 `- [x]`」
- **NEVER** `git stash` / `mv` / `rm` 把 `tasks.md` 或 change 目錄移走讓 gate scan 抓不到 — 等同繞過 hard rule，亦違反 [[commit]] 「WIP 處置禁令」
- **NEVER** 把「人工檢查還沒完成」包裝成「審查條件已滿足」「等同 OK」「之後再勾」 — gate 看的是 tasks.md 的實際 `- [x]` / `- [ ]` 狀態
- **NEVER** 建議 user「先 checkout 到 feature branch 跑 /commit 再 merge 回 main」繞過 gate — 該 change 本來就該在進 main 前完成人工檢查
- **NEVER** 因為「使用者沒明說 main 算 trunk」而判 branch 不算 — `main` / `master` 兩個 branch name 都算

## 禁止事項

- **NEVER** `git commit` / `git commit -m` — 繞過 0-A / 0-B / 0-C 品質閘門
- **NEVER** `git commit --amend` 修改已 push 的 commit — 會破壞遠端 history
- **NEVER** `git commit --no-verify` — 繞過 pre-commit hook
- **NEVER** 以「變更很小」「只是 typo」「趕時間」為由跳過 `/commit`
- **NEVER** 讓 subagent 自主執行 `git commit` — commit **必須在主線執行**；使用者觸發 `/commit` 即代表授權整批分組，主線**不需**在分組後另行徵詢確認（policy 與 `/commit` Step 0-Scope 一致：commit 流程預設無互動）
- **NEVER** 在 lock 被佔用時自行 `rm .claude/.commit.lock` — 必須回報使用者由其判斷對方是否真的卡住
- **NEVER** 漏跑 Final Step `release` — 即使前面失敗也要釋放，避免下次 session 卡在 stale lock
- **NEVER** 把 `pnpm check` 當作完整 0-C；**MUST** 先 grep 確認 `scripts.check` 含 `test` / `vitest`，不含就額外跑 `pnpm test`。許多 consumer 的 `pnpm check` 只跑 format/lint/typecheck（CI 才跑完整 test），漏跑會讓 hook timeout / flake / 新增測試破壞在 commit 後才暴露

### WIP 處置禁令（嚴格）

**完全禁止任何會丟失 WIP 的動作，包括「向使用者建議」這些動作**：

#### Git 命令禁令

- **NEVER** 執行 `git restore` / `git restore --staged` / `git checkout --` / `git checkout <path>` 清場 — 這會永久毀掉 unstaged 變更
- **NEVER** 執行 `git reset --hard` / `git reset HEAD --hard` / `git clean -fd` — 同上
- **NEVER** 執行 `git stash drop` / `git stash clear`
- **NEVER** 提議 `git revert` 或在輸出中暗示「可以 revert XX」「要不要還原 XX」「這部分先 revert」 — `revert` 在使用者語境通常意指**丟棄變更**，會誤導使用者破壞 WIP；真正需要還原既有 commit 的情境極罕見且應由使用者主動發起

#### 檔案系統等效動作禁令（同樣 destructive）

以下動作功能上等同破壞性 git 命令，**MUST** 視同 WIP 處置禁令範圍（容易誤以為「不是 git 所以 OK」）：

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
3. **`git revert` 既有 commit** — 還原已 push 的 commit，無需重跑品質檢查。**注意**：此例外**僅**適用於使用者**主動**指明要 revert 哪個 commit（例如 `git revert abc1234`）的情境；**NEVER** 主線自行提議 revert，也**NEVER** 用 `git revert` 處理 uncommitted WIP（uncommitted 變更的處置一律走「WIP 阻礙處理」的 stash + handoff）

例外情境外，一律走 `/commit`。

## Commit 分組與訊息規範

- **每個 commit 獨立且完整** — 不相關的變更**MUST**分到不同 commit
- **Commit message 使用繁體中文**描述
- **所有 uncommitted 變更都必須入庫**，**NEVER** 以「不在本次範圍」「影響不大」為由跳過任何檔案
- **`.gitignore` 變更**：只允許保留 Clade 管理的 installation artifact / runtime state ignore 條目（例如 `.claude/.commit.lock`、`codex/`）；其他變更**MUST** `git stash push -- .gitignore` 並寫入 `HANDOFF.md`（**NEVER** `git checkout .gitignore` 直接還原），由使用者後續確認是否要保留
- **`.env` / 敏感檔案**：警告使用者但仍由使用者決定是否 commit，**NEVER** 自行跳過
- **修正所有發現的問題**：review / lint / typecheck / test 發現的問題都**MUST**修正，**NEVER** 以「建議性質」「不在本次範圍」為由跳過。**例外**：修法會動到別 session in-flight WIP（典型：`HANDOFF.md`、別 session 的 `tasks/<...>.md`）時，**MUST** 走 `scope-discipline.md`「Rule 衝突解法 → 具體分支模板：當前 flow 規約要求『必修』撞別 session WIP」決策（A. 馬上修續 flow / B. 登 TD 中止 flow），由 user 拍板，**NEVER** 自行二選一

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

- Skill 本體：`.claude/skills/commit/SKILL.md` — 定義「怎麼做」（procedure）
- 本規則：定義「要不要做」— 政策、閘門、強制入口

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。
