---
name: commit
description: 依功能分類變更並逐步完成 commit，遵循 commitlint 規範
effort: high
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/commit/
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


## User Input

```text
$ARGUMENTS
```

政策、禁止事項、commit 類型表見 `.claude/rules/commit.md`。本檔只定義執行流程。

## Step 0-Lock: 單一 session 防呆（**必做第一步**）

```bash
node .claude/scripts/commit-lock.mjs acquire
```

失敗（exit 1）代表另一個 session 正在跑 `/commit` → **停下**，向使用者回報鎖資訊，**不要**自行 `rm` 清鎖或重試。

成功後此 session 取得獨占權，直到最後一步釋放。**中斷處理**：若 `/commit` 流程中途失敗 / 使用者中斷，仍**必須**在終止前呼叫 `node .claude/scripts/commit-lock.mjs release`；漏釋放的鎖會在 30 分鐘後被下次 acquire 自動清除（可用 `COMMIT_LOCK_STALE_MINUTES` 調整）。

## Step 0-Coord: cross-session staged pollution detection（warn-only first pass）

`commit-lock` 只擋同時兩個 `/commit`；**不**擋「commit 跑時別 session 在跑 publish / propagate / wt-helper add / rescue-consumer」造成 staged 區意外污染（已實證 3 條 incident，見 `docs/pitfalls/2026-05-{14,18,22}-*.md`）。Step 0-Coord 跑 3 個 detection signal **warn-only**，命中再用 `AskUserQuestion` 讓 user 決定等候還是強制繼續。

### Signal 1: `.git/index.lock` mtime < 60 秒

別 session 正在 staging（git add / git commit / git checkout 過程中會建這個 lock，正常結束會自動移除）。

```bash
GIT_DIR=$(git rev-parse --git-dir)
LOCK="$GIT_DIR/index.lock"
if [[ -f "$LOCK" ]]; then
  NOW=$(date +%s)
  LOCK_MTIME=$(stat -f %m "$LOCK" 2>/dev/null || stat -c %Y "$LOCK" 2>/dev/null)
  AGE=$((NOW - LOCK_MTIME))
  if (( AGE < 60 )); then
    echo "SIGNAL_1_HIT: index.lock age=${AGE}s path=$LOCK"
  fi
fi
```

**解讀**：`AGE < 60` → 別 session 大機率仍活著正在 staging；`AGE >= 60` → stale lock（崩潰殘留，建議手動 `rm "$LOCK"` 但不在 Step 0-Coord 處理，留給 user 自決）。

### Signal 2: publish.mjs untracked stash sidecar

`scripts/publish.mjs` 的 `--stash-untracked` flow 跑時會在 `.spectra/stash-meta-<tag>.json` 落 sidecar（含 pid / cwd / fileList），publish 完成才 cleanup。看到 sidecar 代表 publish 流程**還在跑或崩潰未收尾**。

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
SIDECARS=("$REPO_ROOT"/.spectra/stash-meta-*.json)
if [[ -f "${SIDECARS[0]}" ]]; then
  for f in "${SIDECARS[@]}"; do
    [[ -f "$f" ]] || continue
    echo "SIGNAL_2_HIT: publish stash sidecar=$f"
  done
fi
```

**解讀**：任一 sidecar 存在 → 別 session 的 publish flow 仍未收尾；commit 時若擴大 staging 範圍可能跟 publish 的 auto-stash pop 撞 conflict。

### Signal 3: wt-helper baseline stash 在 60 秒內建立

`vendor/scripts/wt-helper.mjs cmdAdd --baseline-strategy stash` 會建 `wt-baseline/<slug>/<session-id>/<iso>` stash entry，建完立刻 apply + drop。stash list 裡看到 `wt-baseline/` 命名且 reflog timestamp < 60s → wt-helper add 可能還在跑。

```bash
git stash list --format='%gd %ct %gs' 2>/dev/null \
  | awk -v now=$(date +%s) '
    /wt-baseline\// {
      age = now - $2
      if (age < 60) {
        printf "SIGNAL_3_HIT: wt-baseline stash age=%ds entry=%s\n", age, $1
      }
    }'
```

**解讀**：命中 → wt-helper add 流程未結束；此時 commit 跑下去可能撞 wt-helper 中段的 stash apply / index reset 序列。

### 命中處置

**全部 silent**（三條 signal 都沒命中）→ 直接輸出 `✅ 0-Coord 通過（無 cross-session 污染信號）`，進入 Step 0-Scope。

**任一 signal 命中** → stderr 印 warn block：

```text
⚠️ 0-Coord: 偵測到 cross-session 活動信號

  <列出命中的 SIGNAL_N_HIT 行>

可能後果：
  - 別 session 正在 staging → 你的 git add 可能跟它的 index 寫入互踩
  - publish flow 未收尾 → 你的 commit 可能跟 auto-stash pop 撞 conflict
  - wt-helper add 中途 → baseline staged index 可能污染你的 selective stage

建議處置（mitigation hint）：
  1. 等 60 秒後重跑 /commit（最常見：別 session 馬上結束就乾淨了）
  2. 跑 git status / git stash list / ls .spectra/ 確認別 session 真實狀態
  3. 確認別 session 沒在跑後再繼續
```

接著用 **AskUserQuestion** 二擇一：

- **選項 A**：`label: "等候重試"`, `description: "退出 /commit，等 60 秒後重跑（推薦：避開 staged 污染風險）"`
- **選項 B**：`label: "強制繼續"`, `description: "接受 staged 污染風險繼續跑 Step 0-Scope（user 確認別 session 已結束時用）"`

選 A → 釋放 commit-lock 後 STOP；選 B → 輸出 `⚠️ 0-Coord 強制繼續（user 接受風險）`，進入 Step 0-Scope。

### 禁止項

- **NEVER** 把 Step 0-Coord 升級為 hard block；偽陽性 / 別 session 剛好結束的場景太多，warn-and-ask 是當前正解
- **NEVER** 嘗試自動 `rm .git/index.lock` 或清掉 sidecar — 那是別 session 的 SoT，誤刪比繼續跑風險更高
- **NEVER** 跳過 AskUserQuestion 自行決定繼續 — 命中時 user 必須親自選 A/B

> 同類 race 也存在於 **ad-hoc commit**（不走本 skill 的單檔 commit、HANDOFF 補一行就 commit、修 typo 就 commit 等）。預防規約見 `rules/core/commit.md` § Ad-hoc commit 必走 `git commit --only -- <paths>`。

## Step 0-Codex: 派 codex 跑 commit 工作時的路由規約

主線從 commit SKILL 派 codex 跑 commit 工作時（例如 `/wt` worktree 內派 codex commit phase），**MUST** 走 [`rules/core/agent-routing.codex-watch-protocol.md`](../../../../rules/core/agent-routing.codex-watch-protocol.md) § Codex 派工的標準流程 + Codex Watch Protocol。**禁止** `Agent` tool with `subagent_type: screenshot-review` 派視覺 QA — sonnet wrapper 派工已多次驗證 self-rationalize（per [[pitfall-screenshot-review-sonnet-wrapper-self-rationalize]]）。

## Step 0-Scope: WIP 預設全部納入（果斷，不徵詢）

**預設行為**：所有 `git status` 顯示的 uncommitted 變更（含與本次工作無關、其他 session 並行的 WIP、不認得的檔案）**一律無條件**列入本次 `/commit` 流程，照常跑 0-A review、在 Step 3 依功能分組成獨立 commit。

**這是預設動作，不需要徵詢使用者意見。** Step 0-Scope 不是「決定要不要納入」的判斷步驟，而是「確認預設已生效」的紀錄步驟。看到 `git status` 任何輸出 → 直接進 0-A，**NEVER** 在這一步停下來問使用者「XX 看起來不在本次 scope，要不要排除？」。

**理由**：`/commit` 已付出品質閘門的完整成本。把 WIP 排除在外等於下次 `/commit` 要重跑一次閘門，浪費時間與 token。Step 3 分組階段就是設計來把「主線工作 + 並行 WIP」自然分到不同 commit，**根本不需要在 Step 0 預先排除任何東西**。

### 唯一允許的排除路徑

**A. 使用者在 `$ARGUMENTS` 明確指名排除**（白紙黑字、語意無歧義）：

- 「排除 `.env.local`」
- 「不要動 `reports/`」
- 「只 commit `app/` 底下」

**B. WIP 確實構成阻礙時的 stash + handoff 流程**（見下節）

除 A、B 外**一律全包**。

### 阻礙處理：stash + HANDOFF（**極少數例外**，先確認真的需要）

**預設行為是把所有 WIP 都靠 Step 3 分組成獨立 commit group**，stash 是**極少數例外**。在啟動 stash 前**MUST**先排除下列「假阻礙」情境（這些情境**一律走分組納入**，**NEVER** stash）：

- 「這些變更跟本次主題不同」 → 拆成另一個 commit group（feat / fix / chore / refactor / docs 各自獨立）
- 「不認得是哪來的」 → 假設是並行 session 的工作，照常納入分組
- 「想讓 commit 看起來乾淨」 → commit 不需要乾淨，每個 group 內部完整即可
- 「跟我手上的工作無關」 → 不關 scope，照樣納入分組

**stash 觸發條件**（嚴格收斂為下列任一）：

1. **品質閘門卡死且短時間修不好** — 壞掉的實驗碼讓 0-A / 0-B / 0-C 持續紅燈，且修復成本明顯超過本次 commit 範圍
2. **明確不該入庫的殘留** — debug print、暫時 `console.log`、假資料、敏感資訊（且使用者尚未確認要保留）
3. **使用者主動在 `$ARGUMENTS` 指名要 stash** 某些檔案 / 變更

確認觸發後執行（**優先只 stash 阻礙檔**，避免擴大連坐）：

```bash
git stash push -u -- <具體檔案路徑>  # 優先：只 stash 阻礙檔
# 確實必要時才整批：
git stash push -u -m "WIP: <簡述為何 stash> — see HANDOFF.md"
```

接著**立即**更新 `HANDOFF.md`（依 `.claude/rules/handoff.md` 格式），在 `In Progress` 或 `Next Steps` 寫入：

- stash 訊息對應（用 `git stash list` 能找到）
- 為何 stash（哪個檔、為何不能納入本次 commit；對齊上面 1/2/3 哪一條觸發條件）
- 接手指引（`git stash pop` 後該怎麼收尾）

寫完 HANDOFF 才繼續 0-A。

### 嚴格禁令

- **NEVER** 提議 / 暗示 / 委婉建議任何形式的丟棄 WIP 動作：
  - **NEVER** `git restore` / `git restore --staged` / `git checkout --` / `git checkout <path>`
  - **NEVER** `git reset --hard` / `git clean -fd`
  - **NEVER** 在輸出寫「可以 revert XX」「要不要還原 XX」「先 revert 這部分」「discard 這個變更」「回到乾淨狀態」「清掉 XX」 — 這些都會誘導使用者毀掉自己的 WIP
- **NEVER** 把上述動作包裝成「清理 / 重置 / 回到 baseline / 還原成乾淨狀態」等委婉說法
- **NEVER** 以「這變更看起來壞掉 / 不該存在 / 不在 scope，是否要還原？」徵詢使用者意見 — 阻礙的唯一解法是 stash + HANDOFF
- **NEVER** 自行判定「這個不在我 scope」「這看起來像別的 session 的殘留」而要求使用者決定要不要丟 — 一律假設使用者並行工作中

**唯一例外**：使用者在 `$ARGUMENTS` **明確、主動**寫出 `git restore` / `git checkout --` / `revert <commit>` 等指令或具體變更名稱，且語意完全無歧義時，才能執行。從模糊語氣（「不要這個」「這個怪怪的」）解讀為「使用者想丟棄」**一律禁止** — 必須先確認是「排除本次 commit」（→ stash）還是「丟棄變更」（→ 拒絕，請使用者明確下指令）。

## Step 0-MR: 人工檢查 Gate（main / master 限定，**硬擋無 override**）

`.claude/rules/commit.md` 「人工檢查 Gate」hard rule 的執行點。**MUST** 在 Step 0 品質檢查之前 fail-fast，避免人工檢查未完的 change 浪費 5–15 min codex / screenshot review 時間。

### 判定流程

1. 確認當前 branch：

   ```bash
   git rev-parse --abbrev-ref HEAD
   ```

   輸出 ∉ {`main`, `master`} → 輸出 `⏭️ 0-MR 跳過（branch=<name>）`，進入 Step 0。

2. 萃取本次 commit 觸及的 spectra change（含 staged + unstaged + untracked，排除 `archive/` 子目錄）：

   ```bash
   { git diff --name-only HEAD; git ls-files --others --exclude-standard; } \
     | grep -oE '^openspec/changes/[^/]+' \
     | grep -v '^openspec/changes/archive$' \
     | sort -u
   ```

   結果為空 → 輸出 `⏭️ 0-MR 跳過（本次變更未觸及任何 in-progress spectra change）`，進入 Step 0。

3. 對每個 change 讀 `<path>/tasks.md`，同時判定「非 `## 人工檢查` 段有 `- [x]`」與「`## 人工檢查` 段有 **leaf** `- [ ]`」（parent `#N` 有 scoped `#N.M` 子項時，parent 由子項 derive，**MUST** leaf-only 計，見 `.claude/rules/manual-review.md` 「Parent State Derivation」段）：

   ```bash
   awk '
     /^## /{ in_mr = (/^## *人工檢查/) ? 1 : 0; next }
     !in_mr && /^- \[x\]/ { has_impl = 1 }
     in_mr && /^- \[[ x]\] #[0-9]+ / {
       pid = $0; sub(/^- \[[ x]\] #/, "", pid); sub(/ .*/, "", pid)
       parent_pending[pid] = (/^- \[ \]/); next
     }
     in_mr && /^  - \[[ x]\] #[0-9]+\.[0-9]+ / {
       pid = $0; sub(/^  - \[[ x]\] #/, "", pid); sub(/\..*/, "", pid)
       has_scoped_child[pid] = 1
       if (/^  - \[ \]/) has_pending_leaf = 1
       next
     }
     END {
       for (p in parent_pending)
         if (parent_pending[p] && !(p in has_scoped_child)) has_pending_leaf = 1
       print (has_impl && has_pending_leaf) ? "BLOCK" : "OK"
     }
   ' "<path>/tasks.md"
   ```

   - `tasks.md` 不存在 → 視為 `OK`（尚未進入實作階段的 change）
   - 輸出 `BLOCK` → 列入 blocker，順便用同樣 leaf-only 邏輯抓出未勾 leaf 數量（同 awk 改 END 累加 `pending_count` 並 print）

4. **blocker list 非空時**：

   1. **MUST** 立即釋放 lock，避免下次 session 被卡：

      ```bash
      node .claude/scripts/commit-lock.mjs release
      ```

   2. 印出 blocker 報告（每條 change 一行：路徑 + 未勾項數）+ 明確的「本次 /commit 已中止」結語
   3. **NEVER** 自動勾任何 `- [ ]`、**NEVER** 提議跳過 gate 的方法、**NEVER** 提議 stash 走 `tasks.md` 讓 step 2 抓空

5. blocker list 空 → 輸出 `✅ 0-MR 通過`，進入 Step 0。

### 禁止項

- **NEVER** 把 `main` / `master` 以外的 branch 判進 gate 範圍（feature branch 上後續有 /ship + PR review 擋）
- **NEVER** 接受 `$ARGUMENTS` 任何形式的「skip / ignore / override」旗標 — gate 無 override
- **NEVER** 自行 `Edit tasks.md` 勾掉 `- [ ]` 來通過 gate — 違反 `.claude/rules/manual-review.md` 核心規則
- **NEVER** 把 `tasks.md` / change 目錄 stash / mv / rm 走讓 step 2 / 3 抓不到 — 等同繞過 hard rule
- **NEVER** 把「人工檢查未完」包裝成「審查條件已滿足」「等同 OK」「之後再勾」說服 user 繼續

## Step 0-Archive-Coupling: Partial Archive Gate（main / master 限定，**硬擋無 override**）

`.claude/rules/commit.md` § Partial Archive Gate 的執行點。**MUST** 在 0-MR 之後、0-A/B/C 之前 fail-fast，避免 partial `/spectra-archive` state 默默 commit 進 main 導致 change artifact 永久遺失（per [[pitfall-spectra-archive-interrupted-leaves-partial-state]]）。

### 判定流程

1. 確認當前 branch：

   ```bash
   git rev-parse --abbrev-ref HEAD
   ```

   輸出 ∉ {`main`, `master`} → 輸出 `⏭️ 0-Archive-Coupling 跳過（branch=<name>）`，進入 Step 0。

2. 萃取本次 commit 有 staged-delete 的 spectra change（**排除** archive 子目錄）：

   ```bash
   git diff --cached --name-only --diff-filter=D \
     | grep -E '^openspec/changes/[^/]+/' \
     | grep -v '^openspec/changes/archive/' \
     | sed -E 's|^openspec/changes/([^/]+)/.*|\1|' \
     | sort -u
   ```

   結果為空 → 輸出 `⏭️ 0-Archive-Coupling 跳過（無 spectra change staged-delete）`，進入 Step 0。

3. 對每個 change `<X>` 驗證**兩條件**：

   **條件 A — Archive directory 存在**：
   ```bash
   ARCH=$(find openspec/changes/archive -maxdepth 1 -type d -name "*${X}" 2>/dev/null | head -1)
   [ -n "$ARCH" ] && [ -f "$ARCH/tasks.md" ] && [ -f "$ARCH/proposal.md" ]
   ```
   失敗 → blocker `MISSING_ARCHIVE_DIR`，記下 `<X>`。

   **條件 B — Spec delta-sync 完整**（僅對 HEAD 內 `changes/<X>/specs/<cap>/` 存在的 cap 套用）：
   ```bash
   # 注意 trailing / — 沒加會回該目錄本身（一個 entry "specs"），加了才列子目錄
   for cap_path in $(git ls-tree -d --name-only HEAD "openspec/changes/<X>/specs/" 2>/dev/null); do
     cap=$(basename "$cap_path")
     # 該 cap 的 spec.md 在 openspec/specs/ 必須有 staged modification
     if ! git diff --cached --name-only -- "openspec/specs/$cap/spec.md" | grep -q . ; then
       # 例外：若 openspec/specs/$cap/ 不存在於 HEAD（純新 cap），untracked staging 也算（git status --porcelain）
       if ! git status --porcelain "openspec/specs/$cap/spec.md" 2>/dev/null | grep -qE '^A |^M |^\?\?'; then
         echo "BLOCKER: $X cap=$cap spec delta-sync missing"
       fi
     fi
   done
   ```
   任一 cap 失敗 → blocker `MISSING_SPEC_DELTA`，記下 `<X>` + cap list。

   **trailing slash hard rule**：`git ls-tree -d --name-only HEAD <dir-path>` 不加 trailing `/` 時返回該 dir 本身（一個 entry，等同 `ls -ld`）；加 `/` 才會列出子目錄（等同 `ls -d <dir>/*`）。沒加 → `cap_path="openspec/changes/<X>/specs"` → `cap="specs"` → 查 `openspec/specs/specs/spec.md` 永遠 missing → 任何 change 永遠 BLOCK（false positive）。詳見 `docs/pitfalls/2026-05-24-spectra-archive-interrupted-leaves-partial-state.md` § Why slipped past tests。

4. **blocker list 非空時**：

   1. **MUST** 立即釋放 lock：
      ```bash
      node .claude/scripts/commit-lock.mjs release
      ```

   2. 印出 blocker 報告（每條 change 列 `MISSING_ARCHIVE_DIR` / `MISSING_SPEC_DELTA <cap list>`）+ recovery hint：

      ```text
      ⛔ 0-Archive-Coupling 失敗 — partial /spectra-archive state detected

        <X>: MISSING_ARCHIVE_DIR (archive/YYYY-MM-DD-<X>/ 不存在)
        <Y>: MISSING_SPEC_DELTA (caps: burr-removal-workflow, focused-measurement-ui)

      可能成因：
        - /spectra-archive 跑到一半中斷（context out / shell bomb / user 切到別 task）
        - wt-helper merge-back stash 把 spec delta 收進 wt-merge-block/* stash 後沒人 reconcile

      Recovery（對每個失敗 change <X>）：
        DATE=$(date +%Y-%m-%d)
        SRC="openspec/changes/<X>"
        DEST="openspec/changes/archive/${DATE}-<X>"
        mkdir -p "$DEST/specs"
        git ls-tree -d --name-only HEAD "$SRC/specs/" 2>/dev/null \
          | xargs -n1 basename \
          | xargs -I{} mkdir -p "$DEST/specs/{}"
        for f in $(git ls-tree -r --name-only HEAD "$SRC" | sed "s|^$SRC/||"); do
          git show "HEAD:$SRC/$f" > "$DEST/$f"
        done

      若 spec delta 在 stash 內：
        git stash list | grep wt-merge-block
        git stash show 'stash@{N}' --name-only | grep '^openspec/specs/'
        git checkout 'stash@{N}' -- openspec/specs/<cap>/spec.md
        # 確認後 git stash drop 'stash@{N}'

      Recovery 完成後重跑 /commit。
      ```

   3. **NEVER** 自動修補（任何 mkdir / git show / stash extract 操作）— recovery 必須由 user 看完訊息決定（避免主線誤判 partial state、做出錯誤恢復）

5. blocker list 空 → 輸出 `✅ 0-Archive-Coupling 通過`，進入 Step 0。

### 禁止項

- **NEVER** 把 `main` / `master` 以外的 branch 判進 gate 範圍
- **NEVER** 接受 `$ARGUMENTS` skip / ignore / override 旗標
- **NEVER** 自行 `git restore --staged` 把 staged-deletes 退掉「敷衍 gate」— 那會掩蓋 in-flight archive state
- **NEVER** 自行 `mkdir + git show > file` 補建 archive dir — recovery 必由 user 決定（archive dir naming 含日期、是否該補 / partial 是否該 abort 都是判斷題）
- **NEVER** 把缺 archive dir 包裝成「user 早就 archive 過了，只是 archive dir 被別 session 清掉」— 沒 evidence 不要編造解釋
- **NEVER** 把整批 `openspec/changes/<X>/**` staged-deletes 用 `git rm` 重來 — 不解決問題，且會多一輪 staging churn

## Step 0: 品質檢查

### 0-A/B/C 並行策略（**重要：總時長省 ~45% 的關鍵**）

0-A.0 `simplify` **必序跑且永遠第一**（會刪死碼 / 精簡，否則後續 codex 白檢即將刪除 / 改寫的 code）。**simplify 完成後，0-A.1 / 0-B / 0-C 三軸 MUST 並行**（除非 fast-path 跳過 0-A.1），不可串行：

```
0-A.0 simplify（序跑、主線）
      │
      ▼
 [Fast-path: diff <20 行 + 限 doc/config + 無敏感路徑?]
      │
      ├─ YES → skip 0-A.1/0-A.2，0-B/0-C 並行收尾
      │
      └─ NO ↓
  ┌─ 並行 fan-out（同一輪 tool call 內啟動） ─┐
  ├─ 軸 A：0-A.1 codex high（背景 bash，~5–15 min）
  ├─ 軸 B：0-B screenshot-review（subagent，條件觸發時派；~3–5 min）
  └─ 軸 C：0-C pnpm check + pnpm test（主線 foreground；~2–5 min）
                            │
                            ▼
              匯合 → 合併所有修正 → 條件觸發 0-A.2 xhigh
                            │
                            ▼
              [大改動回扣：累計修正 >50 行 or >5 檔 → 重跑 codex high]
```

**啟動順序（在同一個 assistant 回合內完成）**：

1. simplify 完成後判斷 fast-path：
   - **命中** → 跳過 0-A.1/0-A.2，0-B/0-C 並行（同回合 fan-out）
   - **不命中** → **MUST** 用單一回合的多個 tool call 並行啟動：
     - Bash `codex-review-safe.sh high`（`run_in_background: true`）→ 拿到 background bash id
     - Agent `screenshot-review`（若 0-B 觸發條件成立）
     - Bash `pnpm check`（foreground，主線同步跑）
2. 主線 foreground 0-C 完成後 → poll 軸 A、等軸 B 回收
3. 三軸全部 done 才進入修正合併

**Fast-path 判定**：

同時滿足下列三條件才能跳過 codex（任一不滿足都跑）：

1. 整個 diff 行數（additions + deletions）< 20 行
2. 改動限於 doc / config 類檔案：`*.md`、`*.json`（**除** `package.json` 的 `dependencies` / `devDependencies`）、`*.yml`、`*.yaml`、`.gitignore`、`HANDOFF.md`、`openspec/ROADMAP.md`
3. 無 sensitive 路徑（依 [`review-tiers.md`](./review-tiers.md) Tier 3）：`**/migrations/**`、`**/auth/**`、`**/permission*`、`**/rls*`、`*.sql`、`**/*security*`

任何 `.ts` / `.tsx` / `.vue` / `.mjs` / `.js` / `.sh` 變更（即使單行）都**不適用** fast-path —— 邏輯 bug 在小 diff 很常見，跨模型 review 仍有價值。

**安全性保證**：

- `codex review --uncommitted` 在啟動時讀 working tree diff snapshot，後續 working tree 變動**不影響** codex 已啟動的 review（codex 看的是啟動時的 v1）
- 0-A / 0-B / 0-C 修正後若**累計超過 50 行或跨 5 檔以上** → **MUST** 在匯合階段重跑一次 `codex-review-safe.sh high` 確認新引入的程式碼也過 codex 眼睛
- 0-B / 0-A.1 / 0-C 抓到的問題**全部匯合一次修**，避免反覆 review

**禁止**：

- **NEVER** 把 0-A.1 / 0-B / 0-C 串行跑（除非 fast-path 跳過 0-A.1/0-A.2、或 0-B 跳過）—— 沒並行 = 浪費 5–10 分鐘閘門時間
- **NEVER** 在 0-A.1 背景跑的時候，主線只 poll 不做事 —— 必須同步推進 0-C，0-B 觸發時派 subagent
- **NEVER** 因為「擔心 0-C 修改影響 codex」而退回串行 —— codex 看的是 snapshot，不受後續 working tree 變動影響；大改動的 fallback 已寫在「安全性保證」

### 0-A. 程式碼審查（simplify → codex high/xhigh 兩輪）

**審查策略**：

1. 主線先跑 `simplify` skill —— 它看 reuse / 精簡 / 過度設計 / altitude 這條軸，codex review 不會抓。先處理掉避免後續 codex 重複指出
2. 接著（若 fast-path 不命中）以背景方式跑 codex review high（GPT-5.5）—— 跨模型抓 bug / 邏輯 / 安全，盲點與 simplify / Claude 主線不同。**啟動後立即進入並行階段（見「0-A/B/C 並行策略」）**，主線同步推進 0-C 並派 0-B subagent
3. 修正一律由 Claude Code 主線執行；所有並行軸的 finding 匯合後一次性修正

**已棄用**：

- `code-review` agent（Opus subagent）—— 職責與 codex review 高度重疊且同為 Anthropic 模型盲點，砍掉省一輪 subagent 成本

#### 0-A.0 — simplify（主線，永遠跑、永遠先跑）

對本次 working tree 變更跑 simplify review + 自動修 —— 聚焦 reuse / 精簡 / efficiency / altitude，codex review 不會抓這條軸。simplify 修完的版本才是下一步 codex review 應該看的對象。

**執行方式：MUST 用 foreground `Agent` tool 開一個**通用 subagent**（`subagent_type: "general-purpose"`、`mode: "auto"`）跑下方 prompt 範本**，**NEVER 用 `Skill(simplify)` 嵌套呼叫**。

> ⚠️ **`subagent_type` MUST 是 `"general-purpose"`，NEVER 設成 `"simplify"`**：`/simplify` 是 Claude Code **內建 skill**，**不是** agent type，也不存在「simplify agent type」這種東西。這裡的意圖是「用通用 subagent 在**隔離 context** 跑下方那段 simplify review *工作*」，不是去叫一個名為 simplify 的 agent。若誤把 `subagent_type` 設成 `"simplify"` 會得到 `Agent type 'simplify' not found` 並可能誤導你 fallback 去 `Skill(simplify)`（本段明文 NEVER 的路徑）。

理由：`Skill(simplify)` inline 載入 simplify SKILL.md + 4-agent 編排 + 修正報告，大量 output 會把外層 commit flow 的 continuation 指令推出 working memory。用通用 subagent（`general-purpose`）跑這段 prompt 把 simplify 隔離在 subagent context，主線只收到 compact 結果，commit flow 的 fast-path 判斷指令仍在 working memory 頂端。

Agent prompt 範本（**照搬，不自由發揮**）：

```
Review the current uncommitted changes (git diff HEAD) for reuse, simplification, efficiency, and altitude issues — not correctness bugs. Launch 4 parallel review agents (Reuse / Simplification / Efficiency / Altitude), dedup findings, fix each one directly. Skip findings that change behavior or require changes outside the diff. Report: what was fixed, what was skipped (or confirm clean). Keep the final summary under 200 words.
```

Agent 回傳後主線處理：

- **有修正** → 一句話摘要（「simplify 修了 N 處：<列舉>」），deferred items 寫 `HANDOFF.md`（`[simplify]` prefix），**立即** fast-path 判斷
- **無修正** → 輸出 `✅ 0-A.0 完成（simplify 無修正）`，**立即** fast-path 判斷
- **NEVER** 把 Agent 回傳的完整報告原文轉貼給 user —— 那正是造成 context 膨脹 + 停頓的根因

**Deferred items → HANDOFF（自動，不停住）**：simplify 指出「現在不做但值得做」的改善項 **MUST** 自動寫入 `HANDOFF.md` 的 `Next Steps` 區塊（一行一項，前綴 `[simplify]`），然後**立即繼續** fast-path 判斷。**NEVER** 停住等使用者確認。

**0-A.0 完成 ≠ 停頓點（hard rule）**：simplify Agent 回傳後，主線 **MUST 在同一個 assistant turn 內** 輸出一行摘要 → 判斷 fast-path → 啟動 0-A.1/0-B/0-C。**NEVER** 在 simplify 完成後等 user 回應 — commit 流程是單一連續執行，中間不停。

跑完輸出 `✅ 0-A.0 完成（simplify 已 review + 修正{，N 項 deferred → HANDOFF}）` 後判斷 fast-path：

- **命中** → 輸出 `⏭️ 0-A.1/0-A.2 跳過（fast-path: diff <20 行、限 doc/config、無敏感路徑）`，進入 0-B/0-C 並行
- **不命中** → 進入 0-A.1

#### 0-A.1 — codex review (high)，背景（**並行軸 A**）

`codex review` 在 `high` 推理下常需 5–15 分鐘。**MUST** 用 Bash `run_in_background: true` 啟動，並**每 3 分鐘**讀一次背景輸出確認進度（process 還活著、有沒有錯訊、跑到哪一檔）。建議用 `ScheduleWakeup({delaySeconds: 180})` 排隔——3 分鐘穩穩落在 prompt cache 5 分鐘 TTL 內（300s 是 cache miss 最差解），又是使用者明定的上限，不可拉長。

**啟動背景 process 後 MUST 立即進入並行階段**（同一個 assistant 回合內），啟動 0-B（條件觸發）與 0-C —— 不要乾等 codex 完成才推進其他軸，那等同放棄並行收益。詳見上方「0-A/B/C 並行策略」。

- **NEVER** 把 codex review 用 foreground 同步阻塞主線 — 等下去什麼事都做不了
- **NEVER** 連續多次 sleep <60s 短輪詢 — 會把 cache 燒光也吵
- **NEVER** 就乾等到 codex 自己結束才看一眼 — 中途卡住（codex auth 過期、context 超量、模型拒答）會白等
- **NEVER** wake 起來只回報「還在跑」— 每次 poll **MUST** 讀實際輸出有具體狀態（哪一步、哪個檔、有沒有 issue 浮現）才算數
- 結束條件：背景 process 結束、輸出含完成標記、或使用者叫停 — 才進入後續判斷

```bash
.claude/scripts/codex-review-safe.sh high
```

> ℹ️ wrapper 暫時把 `~/.codex/config.toml` 移開避開 MCP server hang（codex CLI 對 nested TOML override 是 merge 不是 replace；MCP 載入 + 卡死是已知問題）。`trap EXIT` 確保不論 codex 怎麼結束 config 都會還原。**不要**改回 `codex review --uncommitted` 直接跑 — 在配 codebase-memory-mcp 的環境會卡 70 秒 fetch failed 死掉。

讀完 codex 輸出後依 **codex 自己輸出的 severity 標記**分情境處理（**此時 0-B / 0-C 應已並行完成或在收尾**）：

- **無 issue** → 輸出 `✅ 0-A.1 通過（codex high 無 issue）`，**跳過 0-A.2**，進入「並行匯合」
- **僅 Minor / Info 級 issue** → 主線逐一修完，輸出 `✅ 0-A.1 通過（codex high 僅 Minor/Info 已修）`，**跳過 0-A.2**，進入「並行匯合」
- **出現 Critical / Major 級 issue** → 主線逐一修完，**MUST** 進入 0-A.2 用 xhigh 驗證

**Severity 來源**：以 codex 自己輸出的 severity 標記為準（Critical / Major / Minor / Info）。**NEVER** 由主線自行判定降級「這個其實沒那麼嚴重」—— codex 標 Major 就照 Major 處理，否則 0-A.2 條件觸發機制等於形同虛設。

#### 0-A.2 — codex review (xhigh)，條件觸發

**僅在 0-A.1 出現 Critical / Major 級 issue 時執行**，其他情況一律跳過。

```bash
.claude/scripts/codex-review-safe.sh xhigh
```

讀完輸出後判斷：

- **無問題** → 輸出 `✅ 0-A.2 通過（codex xhigh 無 issue）`，進入「並行匯合」
- **仍有問題** → 主線再次修正所有問題，修完**直接進入「並行匯合」**（最多到 0-A.2，不做第 3 輪）

#### 0-A/B/C 並行匯合（**收口檢查**）

三軸完成後合併狀態檢查 + 條件觸發 0-D：

1. 0-A（codex high，or 條件升 xhigh，or fast-path skipped）：通過
2. 0-B（screenshot review）：通過或跳過
3. 0-C（pnpm check + pnpm test + pnpm run doctor）：全綠
4. 0-D（doc alignment）：通過或跳過

**0-D 執行時機**：三軸匯合後、大改動回扣之前。0-D 條件觸發（見下方 § 0-D. Doc Alignment 檢查），觸發時在主線 foreground 跑，修完再評估大改動回扣。

**大改動回扣**：若 0-A / 0-B / 0-C / 0-D 累計的修正**超過 50 行或跨 5 檔以上**，**MUST** 在此處重跑一次 `codex-review-safe.sh high` 確認新引入的程式碼也過 codex 眼睛（codex 看的是啟動時 snapshot，後續大改動不在它覆蓋範圍）。小改動（< 50 行 / < 5 檔）視同安全跳過。

完成匯合後輸出：

```text
✅ 0-A/B/C/D 並行匯合通過（codex {1|2} 輪、screenshot {pass|skip}、check 全綠、doc {aligned|skip}）
```

**禁止**：

- **NEVER** 跳過 0-A.0（simplify 是常駐第一步，不視變更大小例外）
- **NEVER** 把 simplify 跟 codex 並行 —— simplify 必須在 codex 之前序跑完
- **NEVER** 把 0-A.1 / 0-B / 0-C 退回串行 —— simplify 完成後三軸必並行（除非 fast-path 跳過 0-A.1/0-A.2）
- **NEVER** 改用其他模型（codex 必須 `gpt-5.5`）
- **NEVER** 顛倒 codex 兩輪的 reasoning effort（0-A.1 必為 `high`、0-A.2 必為 `xhigh`）
- **NEVER** 把 codex 列出的問題判定為「建議性質」「不在本次範圍」而跳過 —— 一律修
- **NEVER** 在 fast-path 條件未完全滿足時提早跳過 codex —— 三條件 AND，任一不滿足都跑
- **NEVER** 做第 3 輪 codex review（會無限拖長 commit 流程；2 輪內處理不完代表變更太大，應先 split）
- **NEVER** 因 0-A.1 抓到 Critical/Major 後跳過 0-A.2 —— 一律用 xhigh 驗證
- **NEVER** 用主線自判把 codex 標的 Major / Critical 降級成 Minor 來跳過 0-A.2 —— severity 以 codex 輸出為準
- **NEVER** 重新啟用 `code-review` agent（職責已被 codex 兩輪取代）

### 0-B. UI Design Review（條件觸發、**並行軸 B**）

```bash
git diff --name-only
```

**同時滿足才觸發**：

1. 變更含 `.vue` 檔的 `<template>` 區塊
2. 屬於下列之一：新增頁面/元件、佈局結構變動、互動流程變動、大範圍樣式調整

**不觸發**：純 `<script>` / `<style>` 微調、composable / store / API 純邏輯、測試、文件、設定檔、單純重構不影響視覺輸出。

**並行啟動**：觸發時 MUST 在 0-A.1 codex 背景 process 啟動的**同一個 assistant 回合**內派 `screenshot-review` agent —— **NEVER** 等 codex 跑完才派（會浪費 3–5 min 的並行收益）。subagent 跑完回收 finding，與 0-A.1 / 0-C 的 finding 一起匯合修正。

觸發時派 `screenshot-review` agent 截圖並評估。問題修正後輸出 `✅ 0-B 通過`；不觸發則直接輸出 `⏭️ 0-B 跳過（無 UI 變更）`。

### 0-C. CI 等效檢查（Fix-Verify Loop、**並行軸 C**）

**並行啟動**：MUST 在 0-A.1 codex 背景 process 啟動的**同一個 assistant 回合**內，主線 foreground 開跑 `pnpm check` —— 跟 codex 並行不阻塞。0-C 完成（含 fix loop 通過）後再 poll 0-A.1 與回收 0-B subagent。

跑下列指令確保 **format / lint / typecheck / test / doctor 全部 0 errors + 0 warnings + 0 test failures**：

```bash
pnpm check
```

**檢查 `pnpm check` 是否真的包含 test**（多數 consumer 的 `check` 只有 format/lint/typecheck，**CI 才跑完整 test**，本地不補跑就會在 push 後才看到測試失敗）：

```bash
node -e "const s=require('./package.json').scripts.check||''; console.log(/test|vitest/.test(s)?'check-includes-test':'check-missing-test')"
```

若輸出 `check-missing-test`，**必須**額外跑：

```bash
pnpm test          # 或 vp test run / pnpm test:unit，依 consumer 設定
```

**檢查是否有 `scripts.doctor`**（vite-doctor import graph 健康度檢查：cycles、broken imports/exports、phantom deps）：

```bash
node -e "const s=require('./package.json').scripts; console.log(s.doctor?'has-doctor':'no-doctor')"
```

若輸出 `has-doctor`，**必須**額外跑（**MUST** `pnpm run doctor`，**NEVER** 裸打 `pnpm doctor` — `doctor` 撞 pnpm 內建子命令，裸打跑的是 pnpm 自家 doctor 並 silent exit 0，`scripts.doctor` 的 vite-doctor scan 永遠不執行）：

```bash
pnpm run doctor
```

Doctor health score < 100 或 exit code ≠ 0 → **MUST block commit**，修復後重跑直到 health score 100/100 + 0 warnings + exit 0。**即使 warning 是既有、非本次 diff 引入**也必須修——每次 /commit 順手把既有 doctor warning 修掉，保持零警告 baseline。典型修法：移除 dead imports、修正 re-export 路徑、打斷 import cycles、套用 `readValidatedBody` 取代 raw body read。**NEVER** 以「非我引入」「既有 debt」為由跳過 doctor warning — 0-C gate 不區分新舊，一律全綠。

失敗時進入 loop：修復 → `pnpm format`（裸打 `vp fmt` 必須加 `--ignore-path .oxfmtignore`） → 重跑上述步驟 → 直到全綠。loop 的執行者依下方「fix loop 的 codex offload」規則決定（**預設背景 codex**；例外才主線直修）。

> ⚠️ **oxfmt batched false-positive**（vite-plus 0.1.21 已知 bug）：第一次 `pnpm format:check` 紅但 single-file `vp fmt --check <path>` 通過，是 batched bug 不是 format issue — **先**跑一次 `pnpm format`（vp fmt --write）再重跑 check 通常就過。**NEVER** 動 `.oxfmtignore` 或 LOCKED projection（`.claude/rules/` / `AGENTS.md` / `CLAUDE.md` / spectra change markdown）試圖讓 oxfmt 滿意 — 那是 governance violation。clade 中央倉 release flow 已在 `scripts/publish.mjs` 主流程加 stable fmt pre-stage（兩輪 `vp fmt --write` + `vp fmt --check`），consumer 端 commit 流程不需再背 workaround SOP。詳見 `docs/pitfalls/2026-05-18-oxfmt-batched-check-false-positive.md`。

**Fix loop 的 codex offload（預設派背景 codex，主線不留在 foreground 修）**：

0-C 檢查發現失敗需要修補時，**預設**派背景 codex 跑 fix-verify loop，主線同回合繼續既有並行收尾（poll 軸 A、回收軸 B）— 三軸並行結構不變，軸 C 只是從「主線 foreground 修」換成「codex 背景修」：

```bash
node ~/offline/clade/vendor/scripts/codex-dispatch.mjs \
  --template ~/offline/clade/vendor/snippets/codex-offload/templates/fix-verify-loop.template.md \
  --var <key>=<value> ...（依 template 變數表填：check 命令、失敗摘要 / log 等） \
  --label commit-0c-<slug> --effort high
```

（背景跑、stdout 單一 JSON；exit 0=全綠 / 2=修不到全綠（業務 fail）/ 3=機械故障 / 4=quota。exit 3/4 → 主線 fallback foreground 自跑 fix loop；exit 2 → 失敗摘要回主線判斷，**不**重派同一 brief。）

**4.8-aware 範圍明寫**：**每一輪** 0-C 失敗都先做 dispatch 評估（含匯合修正 / 大改動回扣後重跑 0-C 又紅的輪次），不是只有第一輪。

**例外（主線直修，不派）**：

1. trivial 單點修 — 單檔 ≤5 行、typo / import 級
2. 失敗根因明顯涉及本次 commit 的設計判斷（修法本身要決策）— codex 只能猜，主線自修

**codex 完工後主線 MUST**：

1. 重跑 `pnpm check`（+ 條件觸發的 `pnpm test` / `pnpm run doctor`）確認全綠 — **不信 codex 自報**
2. `git diff` 確認 codex 改動 scope 只在修錯相關檔；scope 外 substantive change → revert 該段改動 + 主線自修（注意 working tree 含本次 commit 的 uncommitted 變更，**NEVER** `git checkout HEAD -- <file>` 整檔回退 — 會把本次 commit 的原始變更一起砍掉；用 Edit 撤掉 codex 引入的段落即可）

**禁止**用 `npx vitest run` / `npx eslint` 等個別工具替代 `pnpm check` / `pnpm test` / `pnpm run doctor`。若 `.claude/worktrees/` 干擾結果，先清理再跑。

通過後輸出 `✅ 0-C 通過（format/lint/typecheck/test/doctor 全綠）`。

### 0-D. Doc Alignment 檢查（條件觸發、主線 foreground）

本次 diff 觸及的變更若涉及 docs/ 相關面向，**MUST** 在 0-C 完成後跑 doc alignment 檢查。0-D 不阻塞 0-A/0-B/0-C 並行（在三軸匯合後跑）。

#### 觸發條件

以下**任一**成立即觸發（全不成立 → 輸出 `⏭️ 0-D 跳過（diff 無 doc-relevant 變更）`，進入匯合）：

1. diff 觸及 `docs/**` 本身
2. diff 觸及 `rules/core/**` / `rules/modules/**` / `vendor/snippets/**`（標準層有變 → docs 可能需同步）
3. diff 觸及 `scripts/*-audit.mjs`（audit signal 變更 → `docs/rule-enforcement-matrix.md` 或 `docs/dev-guide.md` 可能需更新）
4. diff 觸及 `server/api/**` / `app/components/**` / `app/pages/**` / `composables/**`（業務碼有變 → consumer docs/ 可能需對齊）
5. diff 含 bug fix（commit message 含 `fix` type）→ pitfall 覆蓋檢查

```bash
DIFF_FILES=$(git diff --name-only HEAD)
HAS_DOC=$(echo "$DIFF_FILES" | grep -E '^docs/' | head -1)
HAS_RULES=$(echo "$DIFF_FILES" | grep -E '^rules/(core|modules)/' | head -1)
HAS_SNIPPETS=$(echo "$DIFF_FILES" | grep -E '^vendor/snippets/' | head -1)
HAS_AUDIT=$(echo "$DIFF_FILES" | grep -E '^scripts/.*-audit\.mjs$' | head -1)
HAS_BIZ=$(echo "$DIFF_FILES" | grep -E '^(server/api|app/components|app/pages|composables)/' | head -1)
# fix type 在 Step 3 分組後才能判，0-D 先用 diff 中有無 pitfall-related file 近似
HAS_PITFALL_REF=$(echo "$DIFF_FILES" | grep -E '^docs/pitfalls/' | head -1)

if [[ -z "$HAS_DOC$HAS_RULES$HAS_SNIPPETS$HAS_AUDIT$HAS_BIZ$HAS_PITFALL_REF" ]]; then
  echo "⏭️ 0-D 跳過（diff 無 doc-relevant 變更）"
else
  echo "0-D 觸發：需要 doc alignment 檢查"
fi
```

#### 檢查 A — Cross-reference 驗證（機械化）

掃 `docs/` 中所有 `[[...]]` cross-ref，驗證 target 存在（rules/core/ 檔名、pitfall id、memory name）：

```bash
grep -rn '\[\[' docs/ --include="*.md" 2>/dev/null \
  | sed -E 's/.*\[\[([^]]+)\]\].*/\1/' \
  | sort -u \
  | while read ref; do
    # 嘗試 match rules/core/<ref>.md、docs/pitfalls/*<ref>*.md、或 memory
    found=0
    [[ -f "rules/core/${ref}.md" ]] && found=1
    [[ -f "rules/modules/${ref}.md" ]] && found=1
    ls docs/pitfalls/*"${ref}"*.md 2>/dev/null | head -1 | grep -q . && found=1
    [[ $found -eq 0 ]] && echo "BROKEN_REF: [[${ref}]]"
  done
```

任何 `BROKEN_REF` → **MUST** 修復（更新引用或移除過時 cross-ref）。

#### 檢查 B — docs/ 內路徑引用驗證（機械化）

掃 `docs/` 中引用的檔案路徑（backtick 包裹的相對路徑），驗證 target 仍存在：

```bash
grep -rnoE '`[a-zA-Z][a-zA-Z0-9._/-]+\.(md|mjs|ts|mts|sh|json|yml|yaml)`' docs/ --include="*.md" 2>/dev/null \
  | sed -E 's/.*`([^`]+)`.*/\1/' \
  | sort -u \
  | while read fpath; do
    # 嘗試以 repo root 解析
    [[ -f "$fpath" ]] || echo "STALE_PATH: $fpath"
  done
```

`STALE_PATH` → 修正路徑（檔案已搬/改名）或移除引用。

#### 檢查 C — Pitfall 覆蓋對齊（diff 含 bug fix 時）

若 diff 觸及了某 pitfall 的 `prevention.ref` 指向的檔案：

```bash
for pit in docs/pitfalls/*.md; do
  refs=$(grep -A1 'ref:' "$pit" 2>/dev/null | grep -v '^--$' | sed -E 's/.*ref: *"?([^"]+)"?.*/\1/' | head -5)
  for r in $refs; do
    base=$(echo "$r" | sed 's/#.*//')
    if echo "$DIFF_FILES" | grep -qF "$base"; then
      echo "PITFALL_TOUCH: $(basename $pit) ref=$base — 檢查 prevention.status 是否需更新"
    fi
  done
done
```

命中 `PITFALL_TOUCH` → **MUST** 讀該 pitfall 的 `prevention:` 段，確認 status 是否因本次修改需更新（`open` → `implemented`、或 `implemented` 但行為已改需補 regression-evidence）。

#### 檢查 D — 受眾文件忠實度（review-level，非機械化）

**適用場景**：diff 觸及業務碼（`server/api/`、`app/components/`、`app/pages/`、`composables/`）、或新增 rules/snippets、或 docs/ 本身有大範圍改動。

**三方受眾檢查清單**（主線自行 review，不開 subagent）：

| 受眾 | docs 位置（典型） | 檢查項 |
| --- | --- | --- |
| **非技術人員**（客戶 / PM） | `docs/user-guide/`、`docs/business/`、VitePress 首頁 hero | 新功能是否有使用說明？既有說明是否因 UI/流程變更過時？截圖是否對齊當前版本？ |
| **開發者** | `docs/solutions/`、`docs/decisions/`、`docs/guides/`、`docs/modules/`、`docs/dev-guide.md` | API 改動 → 對應 solution/guide 是否更新？新模組 → 有沒有 module doc？架構決策 → decision record 是否需更新？ |
| **維運者** | `docs/operations/`、`docs/ops/`、`docs/runbooks/` | config/env 變更 → runbook 是否更新？deploy 流程變更 → ops doc 是否對齊？新 migration → rollback SOP 是否存在？ |

**VitePress 場景額外檢查**：若專案有 `docs/.vitepress/config.{ts,mts}`：
- 新增的 docs/*.md 是否已加入 sidebar config？
- 被刪/搬移的 page 是否還殘留在 sidebar/nav？

**執行方式**：主線列出 diff 涉及的受眾面向 → 逐條對 docs/ 檢查 → 有缺失就當場補、修路徑、更新內容。

#### 修復 loop

檢查 A/B 的 `BROKEN_REF` / `STALE_PATH` → 修 → 重跑驗證 → 直到 0 issues。
檢查 C 的 `PITFALL_TOUCH` → 更新 status/evidence → 不需重跑（人工判斷）。
檢查 D 的受眾缺口 → 補 doc → format（`pnpm format`）→ 確認。

通過後輸出 `✅ 0-D 通過（doc alignment: N ref OK, M path OK, pitfall K/K 對齊{, 受眾文件已補齊}）`。

#### 禁止

- **NEVER** 跳過檢查 A/B 的機械化驗證（「只改了一行 docs 不用掃」不成立 — 一行改動可能 break 交叉引用）
- **NEVER** 把檢查 D 當「可選建議」而不修 — diff 觸及業務碼卻不更新對應 docs = 下一個接手者看到的文件不忠實
- **NEVER** 在 docs/ 補新頁面但漏更新 VitePress sidebar config（新頁面沒出現在 nav = 等於沒寫）

## Step 1: Schema 同步檢查（條件觸發）

**觸發條件**：types 檔或任一 migration 有變更（含 staged + unstaged）。

```bash
# 從 package.json 讀 types 路徑（若有自訂路徑）；fallback 到 conventional locations
# 避開頂層 return（Node script 不允許）— 用 if/else 與 .find()
TYPES=$(node -e "
  const fs = require('fs');
  const pkg = require('./package.json');
  const custom = pkg.config && pkg.config.dbTypesPath;
  const candidates = [
    'packages/core/app/types/database.types.ts',
    'app/types/database.types.ts',
    'shared/types/database.types.ts',
    'src/types/database.types.ts',
  ];
  const path = custom || candidates.find(function(p) { return fs.existsSync(p); }) || 'app/types/database.types.ts';
  console.log(path);
")

# 檢查 types 或 migrations 是否變更（HEAD diff 含 staged）
git diff --name-only HEAD -- "$TYPES" supabase/migrations/ | grep -q . && echo HAS || echo NO
```

若 HAS（types 檔或 migrations 有變更）：

```bash
# 1. 先把 working tree 的版本（含 staged + unstaged）拷一份備查
cp "$TYPES" /tmp/types-before-reset.ts

# 2. 重置 DB + 從 migrations 重新生成 types（自動偵測 LXC/Docker 模式）
if node -e "process.exit(require('./package.json').scripts?.['db:reset'] ? 0 : 1)" 2>/dev/null; then
  # LXC / 遠端 Supabase 模式：consumer 提供 pnpm db:reset wrapper（會 reset DB + 跑 db:types 寫到 $TYPES）
  pnpm db:reset
else
  # 本機 Docker Supabase 模式
  supabase db reset
  supabase gen types typescript --local > "$TYPES"
fi

# 3. 比對：working tree 版本 vs migrations 推導版本
diff /tmp/types-before-reset.ts "$TYPES"
```

有差異 → **停止 commit**，提示使用者依差異建立對應 migration 或還原 `$TYPES`。

> **遠端 LXC 模式注意**：`pnpm db:types` 通常**直接寫入** `$TYPES` 不輸出 stdout，所以**不能**用 `> /tmp/...` 重導向取值（一定要先 `cp` 備份再 `pnpm db:reset`）。

## Step 2: 檢查變更狀態

```bash
git status --porcelain          # 分組輸入的權威來源（含 tracked modified + untracked）
git diff --stat                 # 僅輔助看 tracked 改動規模；NEVER 當分組輸入唯一來源
```

> **分組輸入 MUST 用 `git status --porcelain`，不是 `git diff --stat`**：`git diff --stat` **只列 tracked modified**，會漏掉 untracked 非 ignored 檔（`??` 開頭，如新建的 `tasks/todo.md` / `docs/<new>.md`）。只憑 `git diff --stat` 分組 → untracked 檔被 silently 丟掉、never commit。每次分組前自問：「`git status` 有沒有 `??` 開頭的行？沒被 `.gitignore` 覆蓋 = 必須納入分組。」

若 `.gitignore` 有變更：

- **允許保留**：僅新增 Clade 管理的 installation artifact / runtime state ignore 條目（例如 `.claude/.commit.lock`、`codex/`）
- **其他任何變更** → `git stash push -- .gitignore` 並寫入 `HANDOFF.md`，**NEVER** `git checkout .gitignore` 直接還原（會毀掉使用者的 WIP）

## Step 3: 分析變更並分組

依功能/目的分組並輸出：

```text
### Group 1: [功能描述]
類型: ✨ feat
檔案:
- path/to/file.ts
```

**分組輸入 = Step 2 的 `git status --porcelain` 完整輸出**（tracked modified + untracked 非 ignored），**NEVER** 只用 `git diff --stat`。

- **Untracked 非 ignored 檔（`??`）一律納入分組**，通常自成獨立 `🧹 chore` group（除非語義明確屬於某 feat / fix group）
- 看到 `??` 開頭的檔想加 `.gitignore` 消掉時 **STOP**：先問「這本來就該 ignore（build artifact / runtime state），還是我在逃避 commit？」逃避 commit 而 gitignore = 把該入庫的東西藏掉，方向反了（詳見 [[wip-orphan-recovery]] § 反射性 gitignore 禁令）

## Step 4: 逐一執行 Commit

對每個分組（用 `git commit --only -- <files>` 強制 limit scope，防別 session staged race — 詳見 `rules/core/commit.md` § Ad-hoc commit 必走 `git commit --only -- <paths>`）：

```bash
git commit --only -m "$(cat <<'EOF'
✨ feat: 功能描述

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)" -- <files>
git log -1 --oneline
git show --stat HEAD | tail -3   # MUST verify scope == expected files
```

Untracked file 例外：須先 `git add <untracked>` 再 `git commit --only -- <both-paths>` — scope 仍受 `--only` 過濾。

## Step 5: 版本號升級與 Deploy Commit

判斷升級類型：

- 包含 `✨ feat` → `pnpm version minor --no-git-tag-version`
- 只有 `🐛 fix` 或其他 → `pnpm version patch --no-git-tag-version`

建立 deploy commit：

```bash
git add package.json
git commit -m "$(cat <<'EOF'
🚀 deploy: 發布新版本 v{新版本號}

- 功能描述一
- 功能描述二

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
pnpm tag
git push origin main --tags
```

`pnpm tag` 建立 `v{版本號}` local tag。接著 **`git push origin main --tags` 一步推 commits + tag**。**NEVER** 分兩步 `git push && git push --tags` — 分步推時 GitHub 先收到 main commit SHA，再收到指向同 SHA 的 tag，有機率不觸發 `push:tags` workflow（2026-06-03 v1.185.1 實證）。

## Step 6: 完成報告

```text
✅ Commit 完成！

共建立 N 個 commit：
1. abc1234 ✨ feat: ...
2. def5678 🐛 fix: ...
3. ghi9012 🚀 deploy: 發布新版本 v1.8.0

版本：1.7.1 → 1.8.0 (minor)
Tag：v1.8.0 已建立並推送
```

## Step 7: 更新 HANDOFF.md 與 ROADMAP

遵守 `.claude/rules/handoff.md`：commit 完成後**必須**更新 `HANDOFF.md`，把**所有可延續且尚未被接手的後續工作**寫入 —— 不限於 spectra change。同時同步 Spectra ROADMAP。

### 7-A. 判斷是否需要 handoff

檢查以下任一條件成立 → 需要 handoff：

- `openspec/changes/` 仍有非 archive 目錄（in-progress spectra change）
- `git status` 仍有 uncommitted 變更（刻意未入本次 commit 的 WIP）
- 本次 session 中提及但未做的後續工作（例：refactor 機會、文件更新、測試補強、效能優化）
- 本次 commit 揭露的新 follow-up（`@followup[TD-NNN]` marker、TODO 註解、scope 外發現）
- commit 後必要的驗證 / 部署步驟（人工檢查、deploy smoke test、DB migration 套用）
- 使用者曾提過但還沒做的事（在本 session 或前 session 出現過的 backlog）
- 使用者明確表達接下來要交接 / 暫停

全部不成立（真正什麼都沒得做了）→ 跳到 7-D：若 `HANDOFF.md` 存在且內容已過時，清空或刪除。

### 7-B. 收集下一步資訊

從本次 session 脈絡、`git log`、`docs/tech-debt.md`、`openspec/ROADMAP.md` 的 Next Moves 萃取：

- **In Progress**：正在進行但未完結的工作（spectra change / 自由任務皆可，含進度描述）
- **Blocked**：被什麼擋住、需要什麼才能繼續（無則省略此區塊）
- **Next Steps**（不分來源，一律收齊，按優先序排列）：
  - commit 後的驗證動作：人工檢查、截圖 review、deploy smoke test
  - follow-up marker：`@followup[TD-NNN]` 指向的 tech debt
  - session 中浮現但刻意未處理的機會：refactor、抽共用元件、補測試
  - 跨 session backlog：使用者提過的待辦、roadmap 的 near-term 項目
  - 注意事項 / 陷阱：下一人接手前需要知道的隱性脈絡

### 7-C. 寫入 `HANDOFF.md`

依 `.claude/rules/handoff.md` 格式覆寫：

```markdown
# Handoff

## In Progress

- [ ] <任務描述（spectra change 名稱 / 自由任務 / WIP）>
- <做到哪、關鍵檔案或決策點>

## Blocked

- <blocker 描述；無則省略整個區塊>

## Next Steps

1. <下一步，按優先序>
2. <...>
```

**禁止**：

- 編造不存在的 in-progress / blocker
- 只寫 openspec 相關內容而漏掉其他可延續工作
- 為了「填滿」區塊灌水 —— 真沒有就省略該區塊

### 7-D. 同步 Spectra ROADMAP

```bash
pnpm spectra:roadmap
```

重算 `openspec/ROADMAP.md` 的 AUTO 區塊（Active Changes / Active Claims / Parallel Tracks / Parked Changes）。

若 7-B 收集到的 **Next Steps** 中包含跨 session backlog（不只是「commit 後立刻要做」的驗證動作），依 `.claude/rules/proactive-skills.md` 的「Spectra Roadmap Maintenance」**手動**更新 MANUAL 區塊的 `## Next Moves`，格式：

```text
- [priority] 描述 — 依賴：xxx / 獨立 / 互斥：yyy
```

**禁止**：手編 `<!-- SPECTRA-UX:ROADMAP-AUTO:* -->` 區塊（會被下次 sync 覆寫）。

### 7-E. 把 HANDOFF/ROADMAP 變更納入 commit

7-C/7-D 修改的是 tracked 檔（`HANDOFF.md`、`openspec/ROADMAP.md`），**MUST** 在 Step 8 `/ship` 之前 commit 進去，否則 working tree 會 dirty、`/ship` 開出的 PR 也不含這次的交接狀態。

```bash
# 只 stage 7-C/7-D 動到的檔，避免誤包其他 WIP（commit 流程預設不該再撿東西）
git add HANDOFF.md openspec/ROADMAP.md 2>/dev/null || true

# 若沒實際變動（HANDOFF 不需更新、ROADMAP 已 current），跳過 commit
if ! git diff --cached --quiet -- HANDOFF.md openspec/ROADMAP.md 2>/dev/null; then
  git commit -m "$(cat <<'EOF'
📝 docs(handoff): 更新 commit 後交接狀態

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
  git log -1 --oneline
  git push origin main
fi
```

> 注意：這個 commit **不**重新 bump 版本（不是 deploy），只是把 HANDOFF/ROADMAP 落入 history。Tag 仍指向 Step 5 的 deploy commit。因為 Step 5 已經 push 過 main，此處需要再 push 一次把 docs commit 送上去。

### 7-F. 報告

```text
✅ HANDOFF.md 已更新（已入 commit / 無變更略過）
✅ ROADMAP 已同步（已入 commit / 無變更略過）
（或：無可延續工作，HANDOFF.md 已清空 / 未建立）
```

## Step 8: 自動銜接 /ship（條件觸發）

```bash
git branch --show-current
```

**觸發條件**：當前**不在 main / master 分支**，且 consumer 提供 `/ship` skill（會 push branch 並開 PR）。

```text
🚀 Commit 完成！要繼續執行 /ship 推送並建立 PR 嗎？
```

- 同意 → 執行 `/ship` skill
- 拒絕或已在 main / master → 跳過

**不觸發**：在 main / master 分支，或 consumer 沒有 `/ship` skill。

## Final Step: 釋放 /commit lock（**必做最後一步**）

```bash
node .claude/scripts/commit-lock.mjs release
```

**必須執行**，即使前面任何 step 失敗：

- ✅ 正常完成 → 釋放
- ⚠️ 中途失敗（品質閘門修不動、staging 出問題、deploy workflow 紅燈）→ 回報使用者後**仍要**釋放 lock，再等使用者指示
- ⛔ 使用者明確中止 → 釋放 lock

**NEVER** 讓鎖長期遺留；stale lock 雖然 30 分鐘後會自動清，但中間其他 session 要跑 /commit 會被卡住。
