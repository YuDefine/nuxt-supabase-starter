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


<!-- never-density-reviewed: 2026-09-04 — 全檔 20 條逐條覆核過（不是只看本次新增的）。**這裡刻意不寫行號**：每次編輯本檔行號就漂一次，寫了只會讓下一個覆核的人拿一組對不上的座標去找。以錨點文字定位——(a) Step 2 「丟棄 WIP 的委婉說法」那個 7-run，每一行點名一種不同的說法，合併就失去反開脫作用；(b) 「不要把 WIP 併進來」那條規則掛在兩個不同的 AskUserQuestion 上，各自在使用點才讀得到，不能只留一處；(c) 其餘 13 條各自是該禁令在全檔的唯一出處。Step 6-A 本次新增的 4 條已先收斂掉 3 條重複的「NEVER 再 bump」與 1 條重複的逃生口禁令，剩下的每一條對應一個實測過的失敗模式。-->

## User Input

```text
$ARGUMENTS
```

政策與禁止事項見 `.cursor/rules/commit.mdc`。本檔定義執行流程，commit 類型 / emoji 對照表在 Step 3。

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

接著**立即**更新 `HANDOFF.md`（依 `.cursor/rules/handoff.mdc` 格式），在 `In Progress` 或 `Next Steps` 寫入：

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

- **0-MR 人工檢查 Gate**：本次 commit 觸及 in-progress spectra change 時觸發。觸發時 **MUST** 先完整讀 [gates.md](gates.md) § 0-MR 的判定流程、auto-triage 路由表與禁止項再繼續。判定粒度是 **pathspec 交集**：BLOCK change 只 withheld 自己的 `openspec/changes/<X>/**`，其餘 group 照常走 Step 3 / Step 4（gates.md § 0-MR step 6）。
- **0-Archive-Coupling Partial Archive Gate**：本次 commit 有 spectra change staged-delete 時觸發。觸發時 **MUST** 先完整讀 [gates.md](gates.md) § 0-Archive-Coupling 的驗證流程、trailing slash hard rule 與禁止項再繼續。

## Step 0: 品質檢查

先判斷 Step 0-Scope 的本次變更是否命中 [`review-tiers.md`](../../../../rules/core/review-tiers.md)
Tier 3；命中才執行官方 Codex Security path scan。觸發時 **MUST** 先完整讀
[gates.md](gates.md) § 0-S 的範圍、成本上限與 exit 分流再繼續。未命中則跳過，進入一般
cross-model code review。完整 repository baseline 保持 operator 明確觸發，不屬於 `/commit`。

### 0-A/B/C/D 並行策略（總時長省 ~45% 的關鍵）

0-A.0 `simplify` **必序跑且永遠第一**（會刪死碼 / 精簡，否則後續 pi 白檢即將刪除 / 改寫的 code）。**simplify 完成後，0-A.1 / 0-B / 0-C 三軸 MUST 並行**（除非 fast-path 跳過 0-A.1），不可串行：

```
0-A.0 simplify（序跑）
  -> [Fast-path?] YES -> skip 0-A.1/0-A.2，0-B/0-C 並行
                  NO  -> 並行 fan-out:
                           軸 A: 0-A.1 GPT-6-astra via Pi（effort: medium），背景
                           軸 B: 0-B screenshot-review（條件觸發）
                           軸 C: 0-C pnpm check（主線 foreground）
                         -> 匯合 -> 0-D -> 0-E -> 0-F -> 條件觸發 0-A.2
                         -> [累計修正 >50 行 or >5 檔 -> 重跑 GPT-6-astra via Pi（effort: medium）]
```

**啟動順序（在同一個 assistant 回合內完成）**：

1. simplify 完成後判斷 fast-path：
   - **命中** → 跳過 0-A.1/0-A.2，0-B/0-C 並行（同回合 fan-out）
   - **不命中** → **MUST** 用單一回合的多個 tool call 並行啟動：
     - Bash `codex-review-safe.sh medium`（`run_in_background: true`）→ 拿到 background bash id
     - `Agent` tool 派 `screenshot-review` Claude subagent（若 0-B 觸發條件成立；model 以 [[agent-routing.routing-table]]〔`screenshot-review-verify`〕列為準（該列的硬禁令在 [[agent-routing]] § Routing 硬禁令））
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
- 0-A / 0-B / 0-C 修正後若**累計超過 50 行或跨 5 檔以上** → **MUST** 在匯合階段重跑一次 `codex-review-safe.sh medium` 確認新引入的程式碼也過 pi 眼睛
- 0-B / 0-A.1 / 0-C 抓到的問題**全部匯合一次修**，避免反覆 review

### Gate 執行細節

每個 gate 的完整執行流程（bash scripts、trigger 條件、fix loop、pi offload）見 [gates.md](gates.md)。執行任一 gate 前 **MUST** 先讀對應 §。

- **0-A 程式碼審查**：simplify（0-A.0，序跑）→ GPT-6-astra via Pi（effort: medium；0-A.1，背景）→ 條件升 GPT-6-astra via Pi（effort: medium）+ Claude Fable 5.1（effort: max；0-A.2 裁決）。詳見 [gates.md](gates.md) § 0-A。
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
- **0-MR withheld scope 內的路徑不進任何 group**（gates.md § 0-MR step 6 印出的 `openspec/changes/<X>/**`）：它們留在 working tree，Step 5-A 登記進 HANDOFF。這與下一條並列為「全部變更都要入庫」的兩個機械例外
- **parked change 的 deletion 一律排除，不進任何 group**：

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

0-MR 有 withheld scope 時，**每個 group 的 `git commit --only` 之前 MUST** 先跑（gates.md § 0-MR step 6）：

```bash
node ~/offline/clade/vendor/scripts/commit-mr-gate.ts intersect --block <X> [--block <Y>] -- <files>
```

exit 1 → stdout 列的路徑落在 withheld scope，該 group **NEVER** commit；移出那些路徑後重跑，剩餘才 commit。

## Step 5: 更新 HANDOFF.md 與 ROADMAP

遵守 `.cursor/rules/handoff.mdc`：Step 4 分組 commit 完成後**必須**更新 `HANDOFF.md`，把**所有可延續且尚未被接手的後續工作**寫入 —— 不限於 spectra change。同時同步 Spectra ROADMAP。

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

> `status=` 那一行同時是 finding 來源：`undeclared`（缺 `deploy.deployTrigger`）、`mismatch`（宣告與 workflow 矛盾）、`unconfirmable`（`derived=ambiguous`：deploy workflow 掛了 ≥2 種觸發，宣告要填 **production** 的那個；或 `derived=none`：根本找不到 deploy workflow——後者不是宣告寫錯，是沒有東西可宣告）。**列進 Step 7 完成報告**，但 **NEVER** 在本次 `/commit` 順手改它——那是獨立的宣告修正，要單獨走。

## Step 6-A: 版本號升級與 Deploy Commit（`push-main` 專用）

判斷升級類型：

- 包含 `feat` → `pnpm version minor --no-git-tag-version`
- 只有 `fix` 或其他 → `pnpm version patch --no-git-tag-version`

建立 deploy commit：

```bash
git commit --only -m "$(cat <<'EOF'
🚀 deploy: 發布新版本 v{新版本號}

- 功能描述一
- 功能描述二

Co-Authored-By: Claude <noreply@anthropic.com>
Via: /commit
EOF
)" -- package.json &&      # pnpm-lock.yaml 若一起 bump 就一併列進 pathspec
  git push origin main &&
  git tag "v{新版本號}" &&
  git push origin "v{新版本號}"
```

`--only` 與 `&&` 兩件都不是風格：

- **`git add` ＋ 裸 `git commit` 會把 index 裡別的東西一起收進 deploy commit**——被 gate 刻意擋下不 commit 的檔、別 session 預 stage 的檔都算。那正是 `rules/core/commit.detail.md` § Ad-hoc commit 要求 `--only` 的原因，deploy commit 不是例外。
- **沒有 `&&` 時 commit 失敗照樣往下跑打 tag 那一步，tag 就建在上一個 commit 上**（<consumer-b> v1.275.1，2026-09-03 實測：deploy commit 被 pre-commit gate 擋下 exit 1，tag 仍建出來，救回要刪 tag、`--only` 重 commit、重建 tag）。後果不對稱——commit 失敗是本機的事，tag 建錯是對外的事。

**tag 打在 main push 之後不是順手排的**：`rules/core/commit.detail.md` § Tag 位置 要求打 tag 當下
`git rev-list --count origin/main..HEAD` 必須是 0。先打再推 main 的話，打 tag 的那一刻這個數字
非 0（Step 4 的分組 commit、Step 5 的 HANDOFF/ROADMAP commit、本步驟的 deploy commit 都還沒推）——順序倒過來就同時滿足了那三步，而且競態時本機根本還沒有 tag 要刪。

**不照上面整條 `&&` 串一次貼、而是分步驟手打時，打 tag 之前 MUST 確認 tip 就是這次的 deploy
commit**（串成一條時由 `&&` 保證，不必另外跑）：

```bash
git log -1 --format=%s     # MUST 是 🚀 deploy: 發布新版本 v{新版本號}
```

`git tag` 在目前 tip（Step 5 的 HANDOFF/ROADMAP commit 與本步驟的 deploy commit 都已在同一條線上）建立 `v{版本號}` **local** tag。

**這裡 NEVER 用 `pnpm tag`**，即使該 repo 有這支 script。它在多數 consumer 上**自己就會 push**——2026-09-04 實測 `package.json` 的 `scripts.tag`：<consumer-a> / <consumer-d> / <consumer-c> 都是 `git tag v… && git push origin --tags`（只有 <consumer-b> 是純本機 `git tag`）。把它放在樣板裡，tag 會在 main 之前送出去，`tag-position` 當場擋下、`&&` 整條中止，**main 與 tag 兩個都沒上去**——正是 TD-906 那個死鎖。逐字反開脫：「這個 repo 的 `pnpm tag` 我記得只打本機」——那正是要量的東西，而 `git tag` 在四個 repo 上行為相同，量都不必量。

### 推送順序：無條件 main 先、tag 後

推的是**具名 tag**（`git push origin "v<版本>"`），**NEVER `git push origin --tags`**——
`--tags` 推的是本機所有 tag，這次要送出去的是哪一個由本機殘留決定，不由這次發版決定。
（這條約束的是**本步驟**這條發版序列。clade 自家的 `/clade-publish` 是另一套 SOP：`scripts/publish.ts`
會**印出**一條 `git push --tags` 當作下一步指令，順序同樣是 main 先，只是用了 `--tags` 寫法，不受本條管。）

順序**無條件**是 main 先、tag 後，依 `rules/core/commit.detail.md` § Tag 位置——那條規約
無條件要求 push tag 前不得有未推 commit，與這個 repo 接了什麼 pre-push check 無關。
`vendor/scripts/pre-push/checks/tag-position.sh` 是它的機械兜底，tags-first 必定被擋
（<consumer-b> v1.275.1、<consumer-a> v0.111.0 實測）。**NEVER 先量這個 repo 有沒有接 `tag-position`
再決定順序**——沒接的 repo 只是少了兜底，規約本身沒有變。

**被 `tag-position` 以「超前」擋下的 push，NEVER 用 `--no-verify` 或 `CLADE_ALLOW_STALE_TAG`
過關**：tag 指向 origin 上還不存在的樹，是推出去就收不回的對外物件。

它是**政策，不是機械保證**——所以「反正 script 會攔」不成立：`CLADE_ALLOW_STALE_TAG` 在
`tag-position.sh` 裡的判斷排在方向計算**之前**，設了就兩個方向一起放行（2026-09-04 實測：tag
超前 origin/main 一個 commit，未設回 exit 1、設了回「已設，放行」exit 0）。擋住超前方向的只有
上面那條規約本身。

（`tag-position` 也擋「落後」方向，那一邊**有**合法用途——刻意在舊 commit 上打 hotfix release
tag——判準見 `rules/core/commit.detail.md` § 機械 gate 與它的邊界，**NEVER** 把本條讀成連那一邊
也一起禁掉。）

**main 先不牴觸 deploy-gate 的「發版窗口內不 push main」**：那條防的是**別的**工作在窗口內 push，取消掉發版 SHA 的 staging run。發版序列自己的那一次 main push 是窗口的**起點**，不是窗口內的干擾。窗口的完整定義見 `~/offline/clade/vendor/snippets/deploy-gate/README.md` § 操作規約，race 與 gate 的 recovery 見同檔的 § 這道 gate 有一個消不掉的 race 與 § Recovery。

**tag-only 那趟 push 會讓 pre-push 全套 8 支照跑**：`vendor/scripts/pre-push/runner.sh`
在只推 tag 時算不出 changed paths，刻意 fail-open 成全跑（該檔 `PATH_FILTER_ACTIVE` 的 `else`
分支印出「算不出 changed paths（新 branch 首推 / 手動執行 / 只推 tag）→ 全部照跑」）。8 支並行，
wall time 由最慢的單一 check 決定（該檔自述 <consumer-b> 實測 `nuxt-typecheck` 57.9s）。這是 main-first
的已知成本，**NEVER** 用 `--no-verify` 省它。

**序列中途失敗的復原**（七格都要會）。**先問一句：這個版本號的 tag 已經推出去了嗎**
（`git ls-remote --tags origin "v<版本>"`，有輸出就是已公開）——沒公開的 tag 怎麼刪重打都是本機
的事，已公開的 tag 是對外物件，**NEVER** 拿下面任何一格當作刪遠端 tag 的授權（唯一的例外是本節
最後那段 2026-06-03 的「tag 推出去了但 workflow 沒觸發」，那裡刪並重推的是**同一個 SHA 上的同名
tag**，內容不變）。

**下面每一格都適用的一條**：`pnpm version` 跑在 `&&` 串**之前**，所以進到任何一格時版本號都已經
bump 過了——**NEVER 因為「重跑一次比較乾淨」而再 bump 一次**。每一格都是**從失敗的那一步接著做**，
只有明寫「改用下一個版本號」的那幾格才重新 bump。

- **`git commit --only` 這一步就失敗**（典型：pre-commit gate 擋下，<consumer-b> v1.275.1 實測）→ 版本號
  **還在 working tree 上**（見上面那條共通規則）。照 gate 的訊息修好之後，只重跑
  `git commit --only … && git push origin main && git tag … && git push origin …` 這一串。**修正若動到 `package.json` 以外的檔**，
  那個 `--only … -- package.json` 的 pathspec 會把它們留在 working tree（下一趟 push 多半再被同一支
  gate 擋下）——**MUST** 決定它們要不要一起進 deploy commit，要就把路徑加進 pathspec，不要就先另外
  commit 掉。**若 `git commit --only` 的失敗訊息是「nothing to commit」或「no changes added to commit」**（後者出現在 `package.json` 已 commit、但別的檔還 dirty 時），代表上一趟其實已經 commit
  成功了（版本號已在 HEAD、不在 working tree）——這一格的前提不成立，**MUST** 跳到下一格從
  `git push origin main` 接著做。
- **`git push origin main` 這一步失敗**（競態／權限／網路／被某支 pre-push check 擋下）→ 此時
  tag 還沒打、什麼都還沒公開，沒有對外的東西要救。但 deploy commit **已經建好了**——從頭重跑本步驟
  會再建一個 `🚀 deploy:` commit 並跳掉一個版本號，正好製造 Step 6-B 警告的「main 上有發布 vX 卻沒有
  tag」。**MUST 從失敗的那一步接著做**：照錯誤訊息修好之後跑 `git push origin main && git tag "v{新版本號}" && git push origin "v{新版本號}"`。
  **這一串沒有 commit 那一節，所以上面那條「tip 必須是這次的 deploy commit」不再由 `&&` 保證——
  接之前 MUST 自己跑一次 `git log -1 --format=%s`**。修 pre-push check 通常會多出新的 commit，
  那時 tip 已經不是 deploy commit 了：要嘛把修正 squash 進 deploy commit，要嘛接受 tag 打在新的
  tip（deploy commit 訊息仍寫著同一個版本號，內容多了那次修正——可以，但 MUST 是你**知道**的選擇）。
  競態（remote 有新 commit）**MUST** `git pull --rebase` 後再接這一串，**NEVER** 用 `--force`
  （會把別人的 commit 從 remote 抹掉）。
- **main 已上、推 tag 失敗（權限／網路）** → 主線沒有分叉，**直接重推 tag** 即可，**NEVER** 為了
  「趕快觸發部署」改回 tags-first。**NEVER 把這一格讀成「部署還沒開始，慢慢來」**：走到 6-A 的
  一般路徑是 `confirmed-push-main`，那個形狀下**剛才那次 main push 就是部署**（見 Step 6-Gate 的
  判定表）——tag 在這裡是紀錄，不是觸發器。重推之前若 remote main 又前進了，會落到下面「被
  `tag-position` 以落後擋下」那一格。
- **`git tag` 這一步就失敗**（exit 128：同名 tag 本機已存在，多半是上一趟沒收乾淨）→ 此時 main
  已上、tag 沒建，**NEVER** 直接「重推 tag」（那會把本機那個指向舊 commit 的同名 tag 推出去）。
  先 `git ls-remote --tags origin "v<版本>"` 問 remote——**`git show-ref` 只看得到本機，答不了這一題**。
  remote 沒有 → 是廢棄的本機殘留，`git tag -d` 後重打；remote 已經有 → 這個版本號已經發過，
  **MUST** 改用下一個版本號（`pnpm version patch --no-git-tag-version` 重跑本步驟——**NEVER 漏掉那個旗標**，裸 `pnpm version` 會順手建 commit 與 tag，正好把你送回這一格），**NEVER** 刪遠端 tag 去讓路。
  main 上那個沒有 tag 的 `🚀 deploy: … v<舊版本>` commit **MUST** 照下面最後一格的做法留一行說明。
- **main 已上、推 tag 被 `tag-position` 以外的 pre-push check 擋下** → tag-only 那趟會把 8 支全跑
  （見上段），所以擋你的可能是 lint / typecheck / ratchet 任何一支。**MUST 照那支自己的訊息修好
  再推 tag**，**NEVER** 用 `--no-verify` 繞過（main 已經公開，這時候放行等於讓 tag 指向一棵沒
  過 gate 的樹）。**修正若產生了新的 commit（修 lint / typecheck 幾乎必然如此），MUST 先
  `git push origin main` 把它們推上去，再推 tag**——tag 要指向的就是修完之後的那棵樹。
  推完 main 之後若 remote main 又被別人前進了，才落到下面「被 `tag-position` 以落後擋下」那一格；
  **NEVER 帶著本機未推的 commit 直接走進那一格**，它的 `git merge --ff-only origin/main` 在那個
  狀態下必定回 `Not possible to fast-forward`。
- **main 已上、`git tag` 也成功，但推 tag 被 remote 以 `! [rejected] … (already exists)` 拒絕**
  → 這個版本號的 tag **已經在 remote 上**（`tag-position` 只看本機與 `origin/<default branch>`
  的關係，不看 remote 有沒有同名 tag，所以它會放行）。成因典型是先前某趟 `--tags` 殘留、或
  另一個 clone／worktree 已經推過。**NEVER** 反覆重推（會一直被同一個理由拒絕），**NEVER**
  刪遠端 tag 讓路——**MUST** 改用下一個版本號（同樣帶 `--no-git-tag-version`）重跑本步驟，並照下面最後一格的做法替 main 上那個
  沒有 tag 的 `🚀 deploy: … v<舊版本>` commit 留一行說明。
- **main 已上、但推 tag 被 `tag-position` 以「落後」擋下** → 代表**別的 session 在你推 main 與推
  tag 之間又 push 了 main**（那本身違反 deploy-gate 的「發版窗口內不 push main」——窗口從**發版序列自己的那一次 main push** 起算，見上面那段與 `vendor/snippets/deploy-gate/README.md` § 操作規約）。
  正解是**在新的 HEAD 上重跑一次發版序列**：`git tag -d "v<舊版本>"`（本機那個沒公開的，刪掉）
  → `git fetch origin main && git merge --ff-only origin/main`（**先併進來，否則下一步 push 必被
  non-fast-forward 拒絕**）→ `pnpm version patch --no-git-tag-version` → 新的 deploy commit →
  push main → 打**新版本號**的 tag → 推 tag；那些插進來的 commit 就一起出這一版。
  main 上會留下一個沒有對應 tag 的 `🚀 deploy: 發布新版本 v<舊版本>` commit——**MUST** 在新的
  deploy commit 訊息或 HANDOFF 裡寫一行「v<舊版本> 未發版，內容併入 v<新版本>」，否則下一個
  接手的人會照 Step 6-B 的理由誤判已發版。
  **NEVER** `git tag -d` 之後把**同一個版本號**重打在別人的 commit 上（版本號與內容從此對不起來），
  **NEVER** 用 `CLADE_ALLOW_STALE_TAG` 過關——那個逃生口只留給「刻意在舊 commit 上打 hotfix
  release tag」，把它用在這裡就是拿它繞過一個你其實看得懂的攔阻。

> 2026-06-03 v1.185.1 實證：「main 先、tag 後」分兩步推送**同一個 SHA** 時，GitHub 先收到 main
> commit SHA、再收到指向同一 SHA 的 tag，有機率不觸發 `push:tags` workflow。修法是刪掉並重推
> 同名 tag（`git push origin :refs/tags/v<版本>` → `git tag -d "v<版本>"` → `git tag "v<版本>"` →
> `git push origin "v<版本>"`）。
>
> 因此**只要這次推的 tag 會觸發任何 workflow**，就 MUST 在推 tag 之後實際確認它跑起來了。
> 純 `push-main` 形狀（Step 6-Gate 回 `confirmed-push-main`，也就是走到本步驟的一般路徑）沒有
> tag-triggered run，這一格標「不適用」即可；真正會命中的是 **6-B 選 `[1]` 後回頭執行本步驟**
> 的形狀，以及 6-Gate 的 `derived=ambiguous`（deploy workflow 掛了 ≥2 種觸發——同一支同時吃 main push 與 tag push，或兩支各吃一種）。
> **NEVER** 因為「本步驟叫 `push-main` 專用」就把這段當成永遠不必做——判「這次的 tag 觸不觸發」
> 看的是 6-Gate 印出來的 **`derived=`**，不是本步驟的標題，也**不是 `status=`**：
> `status=unconfirmable` 同時涵蓋兩種完全相反的形狀——`derived=ambiguous`（deploy workflow 掛了
> ≥2 種觸發，**tag 會觸發**，這一格要確認）與 `derived=none`（**根本沒有 deploy workflow**，tag
> 什麼都不會觸發，這一格「不適用」）。把兩者當成同一件事，在 `none` 那格會讓你對一個**已公開**的
> tag 執行刪除重推——本節唯一不可逆的動作——去追一條本來就不存在的 run。
> **判定用「哪些要做」而不是「哪些不做」**——`derived=` 只有六個值，其中**只有 `tag-v` 與
> `ambiguous` 代表這次的 tag 真的會觸發**，要走下面的確認：
>
> | `derived=` | tag 會觸發嗎 | 這一段 |
> | --- | --- | --- |
> | `tag-v` / `ambiguous` | 會 | **MUST 確認** |
> | `push-main` / `pr-merge` / `manual` / `none` | 不會 | **NEVER 進入確認與重推**，Step 7 標「不適用（`derived=<值>`）」 |
>
> **NEVER 反過來背成一張「不適用」清單**：那張清單漏一個值，漏掉的那格就會把你送去對一個
> **已公開**的 tag 執行刪除重推，去追一條本來就不存在的 run。`push-main` / `pr-merge` / `manual`
> 都會經由 6-B 的 `[1]` 回頭跑本步驟，不是只有 `confirmed-push-main` 才走得到這裡。確認時 **MUST 用 tag 名過濾**——`-w <production workflow>` 之後，同一個 SHA 上仍可能混進 main push 觸發的**同一支** workflow 的 run：
>
> ```bash
> for i in $(seq 7); do
>   gh run list --workflow <production workflow> --limit 10 \
>     --json headBranch,event,status,createdAt \
>     --jq '[.[] | select(.headBranch == "v<版本>")]' | tee /dev/stderr | grep -q headBranch && break
>   if [ "$i" -lt 7 ]; then sleep 10; fi
> done
> ```
>
> **同一個 workflow 同時由 main push 與 tag push 觸發時（6-Gate 的 `unconfirmable` 形狀），
> NEVER 用 `gh-ci-watch.sh --tag` 代替上面這段**：那個旗標把 tag 解析成 SHA 再用 `-c <SHA>` 過濾
> （`TAG_SHA=$(git rev-parse …)`），而 main-first 之下兩條 run **本來就在同一個 SHA 上**——它分不開
> 兩者，於是「tag 沒觸發」會被 main 那條 run 報成綠。（純 `tag-v` 形狀下 main push 不會產生這個
> workflow 的 run，`--tag` 是對的——那正是 gh-ci-watch skill 逐字要求用 `--tag` 的情境。）
>
> 也 **NEVER 換成 `gh-ci-watch.sh --branch "v<版本>" --timeout 60`** 當「等價寫法」：那支要輪到
> **終態**才回，production run 幾乎不可能在 60 秒內跑完，於是正常情況也回 `WATCH_TIMEOUT` exit 3；
> 它的 `--branch` 模式還自帶 `SINCE = now-120s` 的時間窗與 ≥30s 的輪詢間隔。這裡要問的只是
> 「run 建立了沒」，用上面那圈就好；要看部署**跑完**才用 gh-ci-watch。
>
> **判「未觸發」之前 MUST 先確認 `gh` 本身是好的**（`gh auth status` 或看上面那圈有沒有印出錯誤）：
> auth／網路壞掉時 stdout 一樣是空的，而空與「沒觸發」在這裡長得完全一樣——照著往下走就是對一個
> **已經公開**的 tag 做刪除重推，正好是本節唯一被特別授權、也唯一不可逆的動作。
>
> **`gh` 正常、且輪詢滿 60 秒（t=0 起每 10 秒一次，共 7 次）仍查不到該 tag 的 run，才判未觸發**，再走上面的刪並重推，**NEVER** 改回 tags-first
> 去繞過 `tag-position`。

## Step 6-B: 停在 push main，發版另問（`tag-v` / `manual` / `unknown`）

這些形狀下 **建 tag 就是部署 production**（`tag-v`），或部署本來就不由 `/commit` 負責（`manual`）。因此本步驟不建 tag、不發版。

**本步驟 NEVER 做以下四件事**，即使本次 commit 含 `feat`、即使使用者說「commit 完就好」：

- ❌ `pnpm version <patch|minor>` —— 未發版就不該有版本號 bump
- ❌ `🚀 deploy:` commit —— main 上出現「發布新版本 vX」卻沒有對應 tag，會讓下一個接手的人誤判已發版
- ❌ `pnpm tag` / `git tag`
- ❌ `git push origin --tags` / `git push origin v<版本>`（推 tag 就是發版，不論用哪種寫法）

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

- **`[1] 現在發版`** → **MUST 先讀該 repo 的 `HANDOFF.md` 發版段與 `.github/workflows/`**，確認有沒有固定發版路徑（例：先跑 precheck workflow 拿到 `SAFE` 才授權 deploy、staging-gate 要求同 SHA 的 staging 已綠）。**有固定路徑就照它走，NEVER 直接 `git push origin --tags` 蓋過去**；沒有固定路徑才回頭執行 6-A 的 bump / tag / push main 與 tag
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
- [ ] push / tag 結果：走 6-A 貼 `git push origin main` 與 `git push origin v<版本>` 兩者輸出（順序即實際執行順序），`derived=` 是 `tag-v` / `ambiguous` 時另貼 `gh run list` 顯示該 tag 的 run 已排入（其餘四個 `derived=` 值都沒有 tag-triggered run，標明「不適用（`derived=<值>`）」即可）；走 6-B 貼 `git push origin main` 輸出 ＋ 使用者對發版問題的選擇（本次不 push 則標明原因）

以上證據放進完成報告的 `Evidence` 段——**照下面樣板的行逐行對應，不是固定三格**（checklist 的最後一格在樣板裡拆成 `push:` 與 `deploy-trigger:` 兩行）。

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
- push: <git push origin main 與 git push origin v<版本> 摘尾>
- deploy-trigger: <`derived=` 是 tag-v / ambiguous 才貼 gh run list 過濾該 tag 的 run 摘尾；其餘 derived= 值與走 6-B 未發版時寫「不適用（derived=<值>）」>
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
