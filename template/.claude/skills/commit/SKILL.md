---
name: commit
description: Use when 使用者要求把工作區的變更寫進版本歷史，不論用詞是 commit、提交、送進 git 還是「整理一下」；需要拆成多筆時同樣適用。NOT for 把 clade 改動散播到 consumer（走 /clade-publish），NOT for 建 / 合併 worktree（走 /wt）。
effort: high
permission_tier: action
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/commit/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


## User Input

```text
$ARGUMENTS
```

政策與禁止事項見 `.claude/rules/commit.md`。本檔定義執行流程，commit 類型 / emoji 對照表在 Step 3。

## Step 0-Lock: 單一 session 防呆（**必做第一步**）

```bash
node .claude/scripts/commit-lock.mjs acquire
```

失敗（exit 1）時**照它印出的「處置」段做**——那段是依鎖上的持有者身分算出來的、由上往下第一個成立的動作，且每一列都是本 session 自己做得到的：herdr pane 對話 → `SendMessage` → 等 stale 自動清 → 才輪到回報 user。

**NEVER 一撞鎖就問 user。** 使用者要的是「鎖上看得到持有者是誰、怎麼聯絡」然後自行協商；把鎖資訊原樣貼給 user 請他裁決，只在腳本自己判定「無從對話」（鎖上沒有 session id）那一格才成立。**NEVER** 自行 `rm` 鎖檔繞過。

腳本已自動處理的兩格，撞到時不必做任何事：**本 session 的遺留鎖**（session id 相符，`/commit` 被中斷留下的）會自動回收；**stale 鎖**（超過閾值）也會自動清。所以「PID 看起來死了」**NEVER** 是清鎖的理由——每個 Bash tool call 都換 pid，pid 從來就判不出存活，判據是 session id。

成功後此 session 取得獨占權，直到最後一步釋放。**中斷處理**：若 `/commit` 流程中途失敗 / 使用者中斷，仍**必須**在終止前呼叫 `node .claude/scripts/commit-lock.mjs release`；漏釋放的鎖會在 30 分鐘後被下次 acquire 自動清除（可用 `COMMIT_LOCK_STALE_MINUTES` 調整）。

## Step 0-Coord: Cross-Session Staged Pollution Detection

跑 3 個 detection signal（index.lock mtime、publish stash sidecar、wt-helper baseline stash）warn-only 偵測別 session 的 staging 活動。全部 silent → 直接進 Step 0-Scope。任一命中 → 先判持有者性質，持有者是**前景 agent session** 時 **MUST 先 `herdr agent prompt` 跟它對話**，對方沒回應才輪到 AskUserQuestion 二擇一。

觸發 0-Coord 命中時 **MUST** 先完整讀 [gates.md](gates.md) § 0-Coord 的 signal 定義與命中處置流程再繼續——**NEVER** 憑本段摘要直接開 `AskUserQuestion`，對話那一步只寫在 gates.md 的分流表裡。

## Step 0-Pi: 派 pi 跑 commit 工作時的路由規約

主線從 commit SKILL 派 pi 跑 commit 工作時（例如 `/wt` worktree 內派 pi commit phase），**MUST** 走 [`rules/core/agent-routing.pi-watch-protocol.md`](../../../../rules/core/agent-routing.pi-watch-protocol.md) § Pi 派工的標準流程 + Pi Watch Protocol。**禁止** `Agent` tool with `subagent_type: screenshot-review` 派視覺 QA — sonnet wrapper 派工已多次驗證 self-rationalize（per [[pitfall-screenshot-review-sonnet-wrapper-self-rationalize]]）。

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

## Step 0-MR / 0-Archive-Coupling: Branch Gates（main / master 限定，硬擋無 override）

僅在 `main` / `master` branch 觸發的兩道 gate，非 main/master → 兩道都 skip 進 Step 0：

- **0-MR 人工檢查 Gate**：本次 commit 觸及 in-progress spectra change 時觸發。觸發時 **MUST** 先完整讀 [gates.md](gates.md) § 0-MR 的判定流程、auto-triage 路由表與禁止項再繼續。
- **0-Archive-Coupling Partial Archive Gate**：本次 commit 有 spectra change staged-delete 時觸發。觸發時 **MUST** 先完整讀 [gates.md](gates.md) § 0-Archive-Coupling 的驗證流程、trailing slash hard rule 與禁止項再繼續。

## Step 0: 品質檢查

### 0-A/B/C/D 並行策略（總時長省 ~45% 的關鍵）

0-A.0 `simplify` **必序跑且永遠第一**（會刪死碼 / 精簡，否則後續 pi 白檢即將刪除 / 改寫的 code）。**simplify 完成後，0-A.1 / 0-B / 0-C 三軸 MUST 並行**（除非 fast-path 跳過 0-A.1），不可串行：

```
0-A.0 simplify（序跑）
  -> [Fast-path?] YES -> skip 0-A.1/0-A.2，0-B/0-C 並行
                  NO  -> 並行 fan-out:
                           軸 A: 0-A.1 Codex xhigh（背景）
                           軸 B: 0-B screenshot-review（條件觸發）
                           軸 C: 0-C pnpm check（主線 foreground）
                         -> 匯合 -> 0-D -> 0-E -> 0-F -> 條件觸發 0-A.2
                         -> [累計修正 >50 行 or >5 檔 -> 重跑 Codex xhigh]
```

**啟動順序（在同一個 assistant 回合內完成）**：

1. simplify 完成後判斷 fast-path：
   - **命中** → 跳過 0-A.1/0-A.2，0-B/0-C 並行（同回合 fan-out）
   - **不命中** → **MUST** 用單一回合的多個 tool call 並行啟動：
     - Bash `codex-review-safe.sh xhigh`（`run_in_background: true`）→ 拿到 background bash id
     - `Agent` tool 派 `screenshot-review` Claude subagent（若 0-B 觸發條件成立；model 以 [[agent-routing]] § Routing Table〔`screenshot-review-verify`〕列為準）
     - Bash `pnpm check`（foreground，主線同步跑）
2. 主線 foreground 0-C 完成後 → poll 軸 A、等軸 B 回收
3. 三軸全部 done 才進入修正合併

**Fast-path 判定**（同時滿足下列三條件才能跳過 pi review，任一不滿足都跑）：

1. 整個 diff 行數（additions + deletions）< 20 行
2. 改動限於 doc / config 類檔案：`*.md`、`*.json`（**除** `package.json` 的 `dependencies` / `devDependencies`）、`*.yml`、`*.yaml`、`.gitignore`、`HANDOFF.md`、`openspec/ROADMAP.md`
3. 無 sensitive 路徑（依 [`review-tiers.md`](./review-tiers.md) Tier 3）：`**/migrations/**`、`**/auth/**`、`**/permission*`、`**/rls*`、`*.sql`、`**/*security*`

任何 `.ts` / `.tsx` / `.vue` / `.mjs` / `.js` / `.sh` 變更（即使單行）都**不適用** fast-path —— 邏輯 bug 在小 diff 很常見，跨模型 review 仍有價值。

**安全性保證**：

- review prompt 讓 pi 在自己 turn 開頭讀 working tree diff——snapshot 語義不變：啟動後 working tree 變動不影響已啟動的 review
- 0-A / 0-B / 0-C 修正後若**累計超過 50 行或跨 5 檔以上** → **MUST** 在匯合階段重跑一次 `codex-review-safe.sh xhigh` 確認新引入的程式碼也過 pi 眼睛
- 0-B / 0-A.1 / 0-C 抓到的問題**全部匯合一次修**，避免反覆 review

### Gate 執行細節

每個 gate 的完整執行流程（bash scripts、trigger 條件、fix loop、pi offload）見 [gates.md](gates.md)。執行任一 gate 前 **MUST** 先讀對應 §。

- **0-A 程式碼審查**：simplify（0-A.0，序跑）→ Codex xhigh（0-A.1，背景）→ 條件升 Codex max + Fable code-review max（0-A.2）。詳見 [gates.md](gates.md) § 0-A。
- **0-B UI Design Review**：條件觸發（`.vue` template 變更 + 視覺影響）。詳見 [gates.md](gates.md) § 0-B。
- **0-C CI 等效檢查**：`pnpm check` + `pnpm test` + `pnpm run doctor`，全綠才過。詳見 [gates.md](gates.md) § 0-C。
- **0-D Doc Alignment**：條件觸發（diff 觸及 docs / rules / snippets / audit / 業務碼 / pitfall）。詳見 [gates.md](gates.md) § 0-D。
- **0-E evlog map 覆蓋率**：條件觸發（diff 觸及 entry point：`server/{api,routes,middleware,tasks}/` / pages / Next route handler）。`@evlog/cli` **必裝**（缺裝 = block commit，比照 0-C 的 doctor）；本次 diff 觸及的**每一個** entry point 都 MUST 滿分。詳見 [gates.md](gates.md) § 0-E。
- **0-F 最佳實踐交叉比對**：條件觸發（diff 新增 snippet / audit script / skill / rule）。問「既有資產是不是已經涵蓋這件事」與「這次做的該不該登記進去」。advisory，不擋 commit。詳見 [gates.md](gates.md) § 0-F。

### 紀律禁止項

- **NEVER** 在 0-A.1 背景跑的時候，主線只 poll 不做事 —— 必須同步推進 0-C，0-B 觸發時派 subagent
- **NEVER** 因為「擔心 0-C 修改影響 pi」而退回串行 —— pi 看的是 snapshot，不受後續 working tree 變動影響；大改動的 fallback 已寫在「安全性保證」

其餘紀律禁止項見 [gates.md](gates.md) § 0-A/B/C/D 並行匯合 紀律禁止項。

## Step 1: Schema 同步檢查（條件觸發）

**每一次** `/commit` 都 MUST 跑這一步的觸發判定 —— 判定本身無條件，判定**結果**才決定要不要做事：

```bash
git status --porcelain | grep -Eq 'supabase/.*\.sql|supabase/migrations/|\.types\.ts' && echo HAS || echo NO
```

- `NO` → 本 repo 這次沒動到 migrations 或 types，**直接進 Step 2**，不需要讀任何東西。
- `HAS` → **MUST** 先完整讀 [schema-sync.md](schema-sync.md) 並照其中 Step 1.1–1.5 **每一步**走完，再進 Step 2。
  Step 1.4（SQL lint）與 1.5（advisors）在 1.3 的 reset 之後跑，**NEVER** 做完 types 比對就當 Step 1 結束。

上面這條判定刻意寬鬆（寧可誤送進 reference 也不漏），精確判定與完整流程都在 reference 檔裡。
**NEVER** 憑印象自行重建重置 / 比對 / lint 流程 —— `pnpm db:reset` 與 `supabase db reset` 的分支、
`cp` 備份先於重置的順序、自訂 `config.dbTypesPath` 的解析，寫錯任一條都會靜默放行不一致的 schema。

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
類型: feat
檔案:
- path/to/file.ts
```

`類型` 取值與 Step 4 訊息開頭的 emoji（`commitlint.config.ts`）：

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

**分組輸入 = Step 2 的 `git status --porcelain` 完整輸出**（tracked modified + untracked 非 ignored），**NEVER** 只用 `git diff --stat`。

- **Untracked 非 ignored 檔（`??`）一律納入分組**，通常自成獨立 `chore` group（除非語義明確屬於某 feat / fix group）
- 看到 `??` 開頭的檔想加 `.gitignore` 消掉時 **STOP**：先問「這本來就該 ignore（build artifact / runtime state），還是我在逃避 commit？」逃避 commit 而 gitignore = 把該入庫的東西藏掉，方向反了（詳見 [[wip-orphan-recovery]] § 反射性 gitignore 禁令）
- **parked change 的 deletion 一律排除，不進任何 group**（這是「全部變更都要入庫」的唯一機械例外）：

  ```bash
  PARKED=$(pnpm exec spectra list --parked --json 2>/dev/null \
    | sed -n 's/.*"name": *"\([^"]*\)".*/\1/p' | sort -u)
  # 分組時對每個 parked <name>，跳過所有 `openspec/changes/<name>/` 底下的 D 條目
  ```

  `spectra park` 把 artifacts 從 disk 移進 `.git/spectra-app/spectra.db` blob，所以整批檔案會顯示成
  deletion。那些檔**已經在 git 裡**（propose 收尾先 commit 才 park），把 deletion commit 出去等於
  把剛落庫的 artifacts 從版本庫移除。`/spectra-apply` 會自行 unpark 還原它們。

  **NEVER** 把 parked change 的 deletion 當成「使用者刪掉了不要的檔」納入 group；**NEVER** 拿
  「全部變更都要入庫」當理由收它們 —— 那條規則的目的是不遺漏 user WIP，而這批不是 WIP，是
  工具的暫存搬移。判別方式是機械的：名字在 `spectra list --parked` 裡就是。

## Step 4: 逐一執行 Commit

對每個分組（用 `git commit --only -- <files>` 強制 limit scope，防別 session staged race — 詳見 `rules/core/commit.md` § Ad-hoc commit 必走 `git commit --only -- <paths>`）：

```bash
git commit --only -m "$(cat <<'EOF'
✨ feat: 功能描述

Co-Authored-By: Claude <noreply@anthropic.com>
Via: /commit
EOF
)" -- <files>
git log -1 --oneline
git show --stat HEAD | tail -3   # MUST verify scope == expected files
```

Untracked file 例外：須先 `git add <untracked>` 再 `git commit --only -- <both-paths>` — scope 仍受 `--only` 過濾。

## Step 5: 更新 HANDOFF.md 與 ROADMAP

遵守 `.claude/rules/handoff.md`：Step 4 分組 commit 完成後**必須**更新 `HANDOFF.md`，把**所有可延續且尚未被接手的後續工作**寫入 —— 不限於 spectra change。同時同步 Spectra ROADMAP。

> 本步驟在 Step 6 **之前**執行——HANDOFF/ROADMAP 的 commit 會跟 Step 6-A 的 bump/deploy commit 一起，在同一次 `git push origin main` 送出。若該 repo 的 staging workflow 掛了 `push: branches: [main]` 且帶 `cancel-in-progress`，二次 main push 會觸發新的 staging run 把發版 commit 的 run 取消（見 `~/offline/clade/vendor/snippets/deploy-gate/README.md`）；沒有 main-push 觸發的 repo 則單純少一次無謂 push。本步驟收集的內容不依賴版本號或 push 結果，版本號在 Step 6-A 才產生（走 6-B 時不產生版本號）。

### 5-A. 判斷是否需要 handoff

檢查以下任一條件成立 → 需要 handoff：

- `openspec/changes/` 仍有非 archive 目錄（in-progress spectra change）
- `git status` 仍有 uncommitted 變更（刻意未入本次 commit 的 WIP）
- 本次 session 中提及但未做的後續工作（例：refactor 機會、文件更新、測試補強、效能優化）
- 本次 commit 揭露的新 follow-up（`@followup[TD-NNN]` marker、TODO 註解、scope 外發現）
- commit 後必要的驗證 / 部署步驟（人工檢查、deploy smoke test、DB migration 套用）
- 使用者曾提過但還沒做的事（在本 session 或前 session 出現過的 backlog）
- 使用者明確表達接下來要交接 / 暫停

全部不成立（真正什麼都沒得做了）→ 跳到 5-D：若 `HANDOFF.md` 存在且內容已過時，清空或刪除。

### 5-B ~ 5-F：收集 → 寫 HANDOFF → 同步 ROADMAP → 納入 commit → 報告

5-A 判定**需要 handoff** → **MUST 讀 [`handoff-steps.md`](handoff-steps.md) § 5-B~5-F 並逐步執行**，五個子步驟一個都不能跳（5-E 的「HANDOFF/ROADMAP 變更 MUST 在此 commit、但不 push」是 Step 6 單次 push 設計的前提，漏掉會讓 working tree dirty 進 deploy commit）。

5-A 判定**不需要** → 跳到 5-D 的清理路徑（同檔）。

## Step 6-Gate: 發版授權判定（**Step 6 的必做第一步**）

Step 6 會建立並推送 release tag。**對 production 由 tag 觸發的 repo，那一步等於 agent 自行決定部署 production**（含跑 production migration）。因此 **MUST** 先判定本 repo 的發版觸發形狀，**NEVER** 直接進 Step 6 的 bump / tag。

```bash
node scripts/deploy-trigger-check.ts
```

它讀 `.claude/consumer-meta.json` 的宣告，**同時**從 `.github/workflows/` 推導實際觸發條件，兩邊一致才給放行。判定看 `verdict=` 那一行：

| `verdict=` | 意義 | Step 6 走哪條 |
| --- | --- | --- |
| `confirmed-push-main` | 宣告 `push-main`，且 production deploy workflow 確實由 main push 觸發 —— 不建 tag 也照樣部署，攔 tag 沒有保護作用 | **走 6-A（現行完整流程）** |
| `needs-approval` | 其餘全部：`tag-v` / `manual`、宣告缺漏、宣告與 workflow 不符、workflow 推不出單一結論、腳本不存在 | **走 6-B（不建 tag；push main 本身另判授權）** |

**放行條件是「宣告與 workflow 一致」，不是「宣告寫了 push-main」。** 這個 gate 曾經只讀宣告，而宣告是手寫的：<consumer-b> 宣告 `push-main`、實際 `push: tags: ['*']`，於是拿到 6-A —— 沒有任何一步會講出這件事，2026-08-22 靠人工 grep workflow 才發現。現在推導失敗、宣告與現實矛盾一律 fail-closed 到 6-B，**宣告錯誤換不到寬鬆分支**。

`scripts/deploy-trigger-check.ts` 不存在（consumer 尚未收到該次散播）時 **MUST 走 6-B**，**NEVER** 退回舊的「只讀宣告」查法——那正是這條 gate 要取代的東西。

**NEVER 因為「這個 repo 我記得是 push-main」就跳過這條查詢。**推錯的方向是不可逆的（tag 一推出去 production 就開始跑）。

> `status=` 那一行同時是 finding 來源：`undeclared`（缺 `deploy.deployTrigger`）、`mismatch`（宣告與 workflow 矛盾）、`unconfirmable`（同一個 workflow 內 main push 與 tag push 各部一個環境，宣告要填 **production** 的那個）。**列進 Step 7 完成報告**，但 **NEVER** 在本次 `/commit` 順手改它——那是獨立的宣告修正，要單獨走。

## Step 6-A: 版本號升級與 Deploy Commit（`push-main` 專用）

判斷升級類型：

- 包含 `feat` → `pnpm version minor --no-git-tag-version`
- 只有 `fix` 或其他 → `pnpm version patch --no-git-tag-version`

建立 deploy commit：

```bash
git add package.json
git commit -m "$(cat <<'EOF'
🚀 deploy: 發布新版本 v{新版本號}

- 功能描述一
- 功能描述二

Co-Authored-By: Claude <noreply@anthropic.com>
Via: /commit
EOF
)"
pnpm tag
git push origin --tags
git push origin main
```

`pnpm tag` 在目前 tip（Step 5 的 HANDOFF/ROADMAP commit 與本步驟的 deploy commit 都已在同一條線上）建立 `v{版本號}` local tag。**推送順序 MUST 是先 `git push origin --tags`、再 `git push origin main`**——tag 先送達讓 production 部署優先觸發，main 隨後送達讓 staging 對同一個 SHA 做事後驗證。**NEVER** 把順序倒過來變成 main 先、tags 後。

順序之所以有差，只在該 repo 的 staging workflow 掛了 `push: branches: [main]` 觸發時才成立——那種拓樸下 main 先送達會讓 staging 先跑、production 落後。**若該 repo 的 workflow 只掛 `push: tags:`（main push 不觸發任何 workflow），兩者順序沒有行為差異**，照上面寫法即可，不需要為此改動 workflow。判定法：`grep -A3 '^on:' .github/workflows/*.yml` 看有沒有 `branches:` 觸發。這套 production-first 節奏的完整設計、race 與 recovery 見 `~/offline/clade/vendor/snippets/deploy-gate/README.md`。

**兩段 push 之間失敗的復原**：`git push origin --tags` 成功但 `git push origin main` 失敗（權限／競態／網路）時，production 已被 tag 觸發、但 remote main 還沒有該版本 → 部署與主線分叉。**MUST** 立刻重試 `git push origin main`；若因競態被拒（remote 有新 commit），**MUST** `git pull --rebase` 後重推，**NEVER** 用 `--force`（會把別人的 commit 從 remote 抹掉）。重推前不要動已推出的 tag——tag 指向的 SHA 必須保持與最終 main 一致，rebase 後若 SHA 變了，**MUST** 刪除並重建 tag（`git push origin :refs/tags/v<版本>` 後重跑 `pnpm tag` 與 push）。

> 這跟 2026-06-03 v1.185.1 那次的問題方向不同：當時是「main 先、tags 後」分兩步推送，GitHub 先收到 main commit SHA、再收到指向同 SHA 的 tag，有機率不觸發 `push:tags` workflow。本步驟採用的 tags-first 順序不落入那個情境，是刻意設計。

## Step 6-B: 停在 push main，發版另問（`tag-v` / `manual` / `unknown`）

這些形狀下 **建 tag 就是部署 production**（`tag-v`），或部署本來就不由 `/commit` 負責（`manual`）。因此本步驟不建 tag、不發版。

**本步驟 NEVER 做以下四件事**，即使本次 commit 含 `feat`、即使使用者說「commit 完就好」：

- ❌ `pnpm version <patch|minor>` —— 未發版就不該有版本號 bump
- ❌ `🚀 deploy:` commit —— main 上出現「發布新版本 vX」卻沒有對應 tag，會讓下一個接手的人誤判已發版
- ❌ `pnpm tag` / `git tag`
- ❌ `git push origin --tags`

### 6-B.0: 先判 `git push origin main` 本身是不是部署（**先於 push**）

`needs-approval` 是個混合袋。`tag-v` / `manual` 這兩種**已確認**的形狀下，push main 什麼都不會觸發；但「宣告缺漏 / 宣告與 workflow 不符 / 推不出單一結論 / 腳本不存在」這幾格，**沒有人知道 main push 會不會部署 production**。同一句 `git push origin main` 在後者就是一次未經授權的部署 —— 而 6-Gate 攔下 tag 的保護在這裡完全沒有覆蓋到。

判定只看 Step 6-Gate 已經印出來的那兩行，不必再跑任何東西：

| Step 6-Gate 輸出 | 本步驟動作 |
| --- | --- |
| `status=confirmed` **且** `derived=` 不是 `push-main` | 直接 `git push origin main` |
| 其餘全部：`status=mismatch` / `undeclared` / `unconfirmable`，或 `derived=push-main`，或 `deploy-trigger-check.ts` 不存在 | **NEVER 先 push**，先照下面取得授權 |

第二個條件（`derived` 不是 `push-main`）不能省：`declared=pr-merge` + `derived=push-main` 會拿到 `status=confirmed` 卻仍被送進 6-B，而那種拓樸下 main push 就是部署。

未確認時 **MUST** 先用 `AskUserQuestion` 二選一，**NEVER** 先推了再問：

- **`[1] 授權 push main`** → 明確告知「本 repo 推不出 main push 會不會觸發部署」後才 `git push origin main`，接著往下走發版提問
- **`[2] 先不 push`** → 停在 local commit。**MUST** 在 Step 5 的 HANDOFF 登記「已 commit 未 push」：哪幾個 commit、卡在哪一格（`status=` / `detail=` 原文照抄）、下一步要補的是宣告還是 workflow

**NEVER 把「使用者沒有回應」讀成 `[1]`。** 這條沒有安全預設值 —— 未確認形狀的預設值是「可能對 production 跑 migration」。

### 6-B.1: push 與發版提問

```bash
git push origin main
```

`git push origin main` 完成後（6-B.0 判定可直接推，或使用者選了 `[1]`），**MUST** 用 `AskUserQuestion` 問使用者是否現在發版，二選一：

- **`[1] 現在發版`** → **MUST 先讀該 repo 的 `HANDOFF.md` 發版段與 `.github/workflows/`**，確認有沒有固定發版路徑（例：先跑 precheck workflow 拿到 `SAFE` 才授權 deploy、staging-gate 要求同 SHA 的 staging 已綠）。**有固定路徑就照它走，NEVER 直接 `git push origin --tags` 蓋過去**；沒有固定路徑才回頭執行 6-A 的 bump / tag / push tags
- **`[2] 先不發版`** → 本次到此為止。**MUST** 在 Step 5 的 HANDOFF 裡登記「已 land 未發版」：寫明哪幾個 commit、下次發版該升 major/minor/patch、以及不發版的理由（若使用者有給）

**NEVER 把「使用者沒有回應」讀成 `[1]`。** 這條問題沒有安全的預設值——`tag-v` 的預設值是「對 production 跑 migration」。

> **Step 6b 的前提**：Step 6b 的 Notion 同步依賴 tag 已推出。走 6-B 且使用者選 `[2]` 時 **MUST 跳過 Step 6b**（沒有 tag 可同步）；選 `[1]` 並實際完成發版後才執行。

## Step 6b: Notion 專案層同步（條件觸發）

per [[spectra-notion-coupling]] § 專案層。consumer 的 `.claude/consumer-meta.json` 若有 `notion.projectWorkflow: true`，Step 6-A（或 6-B 選 `[1]` 後）的 tag 已推出後 **MUST** 執行：

```bash
node ~/offline/clade/vendor/scripts/notion-sync.ts release \
  --consumer-path . --change <change-name> --tag "$(git describe --tags --abbrev=0)" --json
```

本步驟寫 Story 的 `上線日`、並**重算所屬 Milestone 的進度**（Notion 不支援 rollup of rollup，進度由 script 親自算後 PATCH）。

- Milestone 進度達 100% 且有連結報價單 → script 回 Class 3 (a)，**MUST** 用 `AskUserQuestion` 問使用者是否標「已交付」/ 勾「可請款」。**NEVER** 自動推——那是請款後果。
- Story `待驗收 → 已完成` 是驗收側轉移，script 一律回 Class 3 (b) 不自動寫。
- `pending` 非空 → 寫入未確認落地，**MUST** 列進 Step 7 完成報告。
- 未啟用 `projectWorkflow` → script 自行 exit 0，不需另外判斷。

## Step 7: 完成報告

**Completion evidence gate**（輸出「✅ Commit 完成」前 MUST 逐格自查；每格附「實跑命令＋輸出摘尾」，貼不出證據＝該格未完成，不准宣告完成）：

- [ ] 每個 commit scope 驗證：貼各 commit 的 `git show --stat <hash> | tail -3` 輸出（changed files 數 vs 預期不符 → 回 Step 4 處置，不出報告）
- [ ] Step 0 品質檢查結論：貼 0-A / 0-C 的結論行（條件未觸發的軸標明「未觸發＋原因」）
- [ ] Step 6-Gate 判定：貼 `deploy-trigger-check.ts` 的實際輸出（含 `verdict=` / `status=` / `detail=`），並標明走 6-A 還是 6-B（`status=` 不是 `confirmed` 時 MUST 一併把 `detail=` 列成 finding）
- [ ] push / tag 結果：走 6-A 貼 `git push --tags` 與 `git push origin main` 兩者輸出；走 6-B 貼 `git push origin main` 輸出 ＋ 使用者對發版問題的選擇（本次不 push 則標明原因）

三格證據放進完成報告的 `Evidence` 段。

走 6-B 且使用者選「先不發版」時，完成報告 **MUST** 把「版本 / Tag」兩行改成 `未發版（verdict=needs-approval / status=<值>，已 push main，發版待人拍板）`，**NEVER** 沿用下面樣板的「已建立並推送」字樣。

```text
✅ Commit 完成！

共建立 N 個 commit：
1. abc1234 feat: ...
2. def5678 fix: ...
3. jkl3456 docs(handoff): 更新 commit 後交接狀態
4. ghi9012 deploy: 發布新版本 v1.8.0

版本：1.7.1 → 1.8.0 (minor)
Tag：v1.8.0 已建立並推送

Evidence:
- scope: <各 git show --stat 摘尾>
- checks: <0-A/0-C 結論行或未觸發原因>
- release-gate: verdict=<實際輸出> status=<實際輸出> → 走 Step 6-<A|B>
- push: <git push --tags 與 git push origin main 摘尾>
```

## Step 8: 自動銜接 /ship（條件觸發）

```bash
git branch --show-current
```

**不在 main / master 分支** 且 consumer 提供 `/ship` skill → **MUST 讀 [`handoff-steps.md`](handoff-steps.md) § Step 8** 走詢問與銜接流程。在 main / master、或 consumer 沒有 `/ship` → 不觸發，直接進 Final Step。

## Final Step: 釋放 /commit lock（**必做最後一步**）

```bash
node .claude/scripts/commit-lock.mjs release
```

**必須執行**，即使前面任何 step 失敗：

- 正常完成 → 釋放
- 中途失敗（品質閘門修不動、staging 出問題、deploy workflow 紅燈）→ 回報使用者後**仍要**釋放 lock，再等使用者指示
- 使用者明確中止 → 釋放 lock

**NEVER** 讓鎖長期遺留；stale lock 雖然 30 分鐘後會自動清，但中間其他 session 要跑 /commit 會被卡住。
