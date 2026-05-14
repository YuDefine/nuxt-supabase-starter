---
description: 依功能分類變更並逐步完成 commit，遵循 commitlint 規範
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/commands/commit.md
Edit at: /Users/charles/offline/clade
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

## Step 0-Precheck: propagate × /commit 協調（**必做第二步**）

跑 `commit-precheck.mjs` 取得 mode，依結果分流（precheck 把判斷邏輯收斂在一個 script，本步**只 consume 結論**，不重做判斷）：

```bash
PRECHECK_JSON=$(node .codex/scripts/commit-precheck.mjs)
PRECHECK_EXIT=$?
MODE=$(printf '%s' "$PRECHECK_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).mode)}catch{console.log('normal')}})")
echo "[precheck] mode=$MODE exit=$PRECHECK_EXIT"
```

**Script 缺失 fallback**（consumer 舊版投影沒裝 precheck.mjs）：bash 顯示 `command not found` 或 exit 127 → 視同 `mode=normal` + stderr 警示「請跑 `pnpm hub:check` 更新」，繼續流程。

### `mode=normal` → 維持現狀

跳到 Step 0-Scope 走「WIP 預設全部納入」邏輯。

### `mode=propagate-staged` → 自動分離投影層為 chore(clade) group

precheck 已告知 `stagedPaths` + `propagateMode` + `propagateVersion`。**MUST** 在 Step 3 分組執行前：

```bash
STAGED_PATHS=$(printf '%s' "$PRECHECK_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log((j.stagedPaths||[]).join('\\n'))}")
PROPAGATE_MODE=$(printf '%s' "$PRECHECK_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{console.log(JSON.parse(s).propagateMode||'')}")
PROPAGATE_VERSION=$(printf '%s' "$PRECHECK_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{console.log(JSON.parse(s).propagateVersion||'?')}")

# propagateMode=stage：propagate 已 git add 投影層 → 先 reset HEAD 撤掉 staging
# propagateMode=no-stage-fallback：propagate 沒 stage（mix-dirty / stash 失敗）→ 直接 selective add
if [ "$PROPAGATE_MODE" = "stage" ]; then
  git reset HEAD --
fi

# 把 marker 列的 stagedPaths 重新 selective stage（為 Step 3 的 chore group 準備）
printf '%s' "$STAGED_PATHS" | while IFS= read -r p; do
  [ -n "$p" ] && git add -- "$p"
done
```

Step 3 分組規範補：

- marker 的 `stagedPaths` **MUST** 成為一個獨立 group，type `🧹 chore`，message `🧹 chore(clade): 同步 hub 投影層 v$PROPAGATE_VERSION`
- **NEVER** 把 `stagedPaths` 任何路徑混進業務 group
- 其餘 dirty（業務 WIP）走原本的功能分組

Step 4 完成 **chore(clade) group 的 commit** 之後（不是整個 /commit 流程結束），立刻刪 marker：

```bash
rm -f .claude/.propagate-marker.json
```

**NEVER** 在 chore(clade) commit 失敗或 abort 時刪 marker（保留供下次 `/commit` 再用同一 marker 走 propagate-staged）。

接著繼續跑 Step 0-Scope（剩餘業務 dirty 走原邏輯）。

### `mode=cross-session-conflict` → **停下** + HANDOFF.md

precheck 已 exit 2 + stderr 列出最近異動的 LOCKED 檔。**MUST**：

1. **釋放 commit lock**：`node .claude/scripts/commit-lock.mjs release`
2. **寫 HANDOFF.md**：依 `.claude/rules/handoff.md` 格式紀錄當前 archive / WIP 落地狀態 + 提示「對方 session 在動 .claude/ LOCKED 檔，本 session 等對方收尾」
3. **停下 `/commit` 流程**：回報使用者後 exit；**NEVER** 自行 stash / revert / discard 別 session 的 in-progress LOCKED 變更

**理由**：LOCKED 檔正在被別 session 動表示對方還沒收尾。若本 session 全包 commit 等於偷走對方 in-progress WIP；若強制 stash 等於丟對方半成品。唯一安全動作是停下協調（這條 = clade `rules/local/clade-role-and-todo-discipline.md`「自治區邊界」的執行面）。

## Step 0-Scope: WIP 預設全部納入（果斷，不徵詢）

> **適用 mode**：`normal` 走整段；`propagate-staged` 已在 Step 0-Precheck 把投影層分離出去，本步只處理剩餘業務 dirty；`cross-session-conflict` 不會走到這（Step 0-Precheck 已 exit）。

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

## Step 0: 品質檢查

### 0-A/B/C 並行策略（**重要：總時長省 ~45% 的關鍵**）

0-A.0 simplify **必序跑且永遠第一**（會刪死碼，否則後續 review 白檢即將刪除的 code）。**simplify 完成後，0-A.1 / 0-B / 0-C 三軸 MUST 並行**，不可串行：

```
0-A.0 simplify（序跑、主線）
      │
      ▼
  ┌─ 並行 fan-out（同一輪 tool call 內啟動） ─┐
  ├─ 軸 A：0-A.1 codex high（背景 bash，~5–15 min）
  ├─ 軸 B：0-B screenshot-review（subagent，條件觸發時派；~3–5 min）
  └─ 軸 C：0-C pnpm check + pnpm test（主線 foreground；~2–5 min）
                            │
                            ▼
              匯合 → 合併所有修正 → 條件觸發 0-A.2 xhigh
```

**啟動順序（在同一個 assistant 回合內完成）**：

1. simplify 完成後，**MUST** 用單一回合的多個 tool call 並行啟動：
   - Bash `codex-review-safe.sh high`（`run_in_background: true`）→ 拿到 background bash id
   - Agent `screenshot-review`（若 0-B 觸發條件成立）
   - Bash `pnpm check`（foreground，主線同步跑）
2. 主線 foreground 0-C 完成後 → poll 軸 A、等軸 B 回收
3. 三軸全部 done 才進入修正合併

**安全性保證**：

- `codex review --uncommitted` 在啟動時讀 working tree diff snapshot，後續 working tree 變動**不影響** codex 已啟動的 review（codex 看的是啟動時的 v1）
- 0-C 修正若**超過 50 行或跨 5 檔以上** → 完成 0-A.1 後 **MUST** 重跑 codex high（避免大範圍邏輯改動沒過 codex 眼睛）
- 0-B / 0-A.1 / 0-C 抓到的問題**全部匯合一次修**，避免反覆 review

**禁止**：

- **NEVER** 把 0-A.1 / 0-B / 0-C 串行跑（除非 0-B 跳過）—— 沒並行 = 浪費 5–10 分鐘閘門時間
- **NEVER** 在 0-A.1 背景跑的時候，主線只 poll 不做事 —— 必須同步推進 0-C，0-B 觸發時派 subagent
- **NEVER** 因為「擔心 0-C 修改影響 codex」而退回串行 —— codex 看的是 snapshot，不受後續 working tree 變動影響；大改動的 fallback 已寫在「安全性保證」

### 0-A. 程式碼審查（simplify → codex two-round）

**審查策略**：

1. 主線先跑 `simplify` skill —— 它看 reuse / 精簡 / 過度設計這條軸，codex review 不會抓。先處理掉避免後續 codex 重複指出
2. 接著以背景方式跑 codex review（GPT-5.5），跨模型抓 bug / 邏輯 / 安全，盲點與 simplify / Claude 主線不同。**啟動後立即進入並行階段（見「0-A/B/C 並行策略」）**，主線同步推進 0-C 並派 0-B subagent
3. 修正一律由 AI Agent 主線執行；所有並行軸的 finding 匯合後一次性修正

**已棄用**：`code-review` agent（Opus subagent）—— 職責與 codex review 高度重疊且同為 Anthropic 模型盲點，砍掉省一輪 subagent 成本。

#### 0-A.0 — simplify（主線，永遠跑、永遠先跑）

對本次 working tree 變更跑 simplify skill（review + 自動修）。

simplify 修完的版本才是下一步 codex review 應該看的對象 —— 若兩者並行，codex 會挑到 simplify 即將要刪掉的死碼，浪費一輪修正成本。

跑完輸出 `✅ 0-A.0 完成（simplify 已 review + 修正）` 後進入 0-A.1。

#### 0-A.1 — codex review (high)，背景（**並行軸 A**）

`codex review` 在 `high` / `xhigh` 推理下常需數分鐘。**MUST** 用 Bash `run_in_background: true` 啟動，並**每 3 分鐘**讀一次背景輸出確認進度（process 還活著、有沒有錯訊、跑到哪一檔）。建議用 `ScheduleWakeup({delaySeconds: 180})` 排隔——3 分鐘穩穩落在 prompt cache 5 分鐘 TTL 內（300s 是 cache miss 最差解），又是使用者明定的上限，不可拉長。

**啟動背景 process 後 MUST 立即進入並行階段**（同一個 assistant 回合內），啟動 0-B（條件觸發）與 0-C —— 不要乾等 codex 完成才推進其他軸，那等同放棄並行收益。詳見上方「0-A/B/C 並行策略」。

- **NEVER** 把 codex review 用 foreground 同步阻塞主線 — 等下去什麼事都做不了
- **NEVER** 連續多次 sleep <60s 短輪詢 — 會把 cache 燒光也吵
- **NEVER** 就乾等到 codex 自己結束才看一眼 — 中途卡住（codex auth 過期、context 超量、模型拒答）會白等
- **NEVER** wake 起來只回報「還在跑」— 每次 poll **MUST** 讀實際輸出有具體狀態（哪一步、哪個檔、有沒有 issue 浮現）才算數
- 結束條件：背景 process 結束、輸出含完成標記、或使用者叫停 — 才進入後續判斷

```bash
.codex/scripts/codex-review-safe.sh high
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
.codex/scripts/codex-review-safe.sh xhigh
```

讀完輸出後判斷：

- **無問題** → 輸出 `✅ 0-A.2 通過（codex xhigh 無 issue）`，進入「並行匯合」
- **仍有問題** → 主線再次修正所有問題，修完**直接進入「並行匯合」**（最多到 0-A.2，不做第 3 輪）

#### 0-A/B/C 並行匯合（**收口檢查**）

三軸完成後合併狀態檢查：

1. 0-A（codex review）：通過
2. 0-B（screenshot review）：通過或跳過
3. 0-C（pnpm check + pnpm test）：全綠

**0-C 大改動回頭驗證**：若 0-C 的修正**超過 50 行或跨 5 檔以上**，**MUST** 在此處重跑一次 `codex-review-safe.sh high` 確認新引入的程式碼也過 codex 眼睛（codex 看的是啟動時 snapshot，後續大改動不在它覆蓋範圍）。小改動（< 50 行 / < 5 檔）視同安全跳過。

完成匯合後輸出：

```text
✅ 0-A/B/C 並行匯合通過（codex {1|2} 輪、screenshot {pass|skip}、check 全綠）
```

**禁止**：

- **NEVER** 跳過 0-A.0（simplify 是常駐第一步，不視變更大小例外）
- **NEVER** 把 simplify 跟 codex 並行 —— simplify 必須在 codex 之前序跑完
- **NEVER** 把 0-A.1 / 0-B / 0-C 退回串行 —— simplify 完成後三軸必並行（見上方「0-A/B/C 並行策略」）
- **NEVER** 改用其他模型（codex 必須 `gpt-5.5`）
- **NEVER** 顛倒 codex 兩輪的 reasoning effort（0-A.1 必為 `high`、0-A.2 必為 `xhigh`）
- **NEVER** 把 codex 列出的問題判定為「建議性質」「不在本次範圍」而跳過 —— 一律修
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

跑下列指令確保 **format / lint / typecheck / test 全部 0 errors + 0 warnings + 0 test failures**：

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

失敗時進入 loop：修復 → `pnpm format`（裸打 `vp fmt` 必須加 `--ignore-path .oxfmtignore`） → 重跑上述兩步 → 直到全綠。

**禁止**用 `npx vitest run` / `npx eslint` 等個別工具替代 `pnpm check` / `pnpm test`。若 `.claude/worktrees/` 干擾結果，先清理再跑。

通過後輸出 `✅ 0-C 通過（format/lint/typecheck/test 全綠）`。

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
git status
git diff --stat
```

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

## Step 4: 逐一執行 Commit

對每個分組：

```bash
git add <files>
git commit -m "$(cat <<'EOF'
✨ feat: 功能描述

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
git log -1 --oneline
```

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
```

`pnpm tag` 會建立 `v{版本號}` tag 並推送到 origin。

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
fi
```

> 注意：這個 commit **不**重新 bump 版本（不是 deploy），只是把 HANDOFF/ROADMAP 落入 history。Tag 仍指向 Step 5 的 deploy commit；後續 fresh clone 想拉最新交接資訊時，看 main 即可。

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
