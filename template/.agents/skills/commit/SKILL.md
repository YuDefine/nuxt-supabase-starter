---
name: commit
description: Use when 使用者要求 commit，或 working tree 有多組 unrelated 變更需分批提交。
effort: high
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

政策、禁止事項、commit 類型表見 `.claude/rules/commit.md`。本檔只定義執行流程。

## Step 0-Lock: 單一 session 防呆（**必做第一步**）

```bash
node .claude/scripts/commit-lock.mjs acquire
```

失敗（exit 1）代表另一個 session 正在跑 `/commit` → **停下**，向使用者回報鎖資訊，**不要**自行 `rm` 清鎖或重試。

成功後此 session 取得獨占權，直到最後一步釋放。**中斷處理**：若 `/commit` 流程中途失敗 / 使用者中斷，仍**必須**在終止前呼叫 `node .claude/scripts/commit-lock.mjs release`；漏釋放的鎖會在 30 分鐘後被下次 acquire 自動清除（可用 `COMMIT_LOCK_STALE_MINUTES` 調整）。

## Step 0-Coord: Cross-Session Staged Pollution Detection

跑 3 個 detection signal（index.lock mtime、publish stash sidecar、wt-helper baseline stash）warn-only 偵測別 session 的 staging 活動。全部 silent → 直接進 Step 0-Scope。任一命中 → request_user_input 二擇一（等候重試 / 強制繼續）。

觸發 0-Coord 命中時 **MUST** 先完整讀 [gates.md](gates.md) § 0-Coord 的 signal 定義與命中處置流程再繼續。

## Step 0-Codex: 派 codex 跑 commit 工作時的路由規約

主線從 commit SKILL 派 codex 跑 commit 工作時（例如 `/wt` worktree 內派 codex commit phase），**MUST** 走 [`rules/core/agent-routing.codex-watch-protocol.md`](../../../../rules/core/agent-routing.codex-watch-protocol.md) § Codex 派工的標準流程 + Codex Watch Protocol。**禁止** `Agent` tool with `agent_type: screenshot-review` 派視覺 QA — sonnet wrapper 派工已多次驗證 self-rationalize（per [[pitfall-screenshot-review-sonnet-wrapper-self-rationalize]]）。

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

0-A.0 `simplify` **必序跑且永遠第一**（會刪死碼 / 精簡，否則後續 codex 白檢即將刪除 / 改寫的 code）。**simplify 完成後，0-A.1 / 0-B / 0-C 三軸 MUST 並行**（除非 fast-path 跳過 0-A.1），不可串行：

```
0-A.0 simplify（序跑）
  -> [Fast-path?] YES -> skip 0-A.1/0-A.2，0-B/0-C 並行
                  NO  -> 並行 fan-out:
                           軸 A: 0-A.1 Codex xhigh（背景）
                           軸 B: 0-B screenshot-review（條件觸發）
                           軸 C: 0-C pnpm check（主線 foreground）
                         -> 匯合 -> 0-D -> 條件觸發 0-A.2
                         -> [累計修正 >50 行 or >5 檔 -> 重跑 Codex xhigh]
```

**啟動順序（在同一個 assistant 回合內完成）**：

1. simplify 完成後判斷 fast-path：
   - **命中** → 跳過 0-A.1/0-A.2，0-B/0-C 並行（同回合 fan-out）
   - **不命中** → **MUST** 用單一回合的多個 tool call 並行啟動：
     - Bash `codex-review-safe.sh xhigh`（`run_in_background: true`）→ 拿到 background bash id
     - Agent `screenshot-review`（若 0-B 觸發條件成立）
     - Bash `pnpm check`（foreground，主線同步跑）
2. 主線 foreground 0-C 完成後 → poll 軸 A、等軸 B 回收
3. 三軸全部 done 才進入修正合併

**Fast-path 判定**（同時滿足下列三條件才能跳過 codex，任一不滿足都跑）：

1. 整個 diff 行數（additions + deletions）< 20 行
2. 改動限於 doc / config 類檔案：`*.md`、`*.json`（**除** `package.json` 的 `dependencies` / `devDependencies`）、`*.yml`、`*.yaml`、`.gitignore`、`HANDOFF.md`、`openspec/ROADMAP.md`
3. 無 sensitive 路徑（依 [`review-tiers.md`](./review-tiers.md) Tier 3）：`**/migrations/**`、`**/auth/**`、`**/permission*`、`**/rls*`、`*.sql`、`**/*security*`

任何 `.ts` / `.tsx` / `.vue` / `.mjs` / `.js` / `.sh` 變更（即使單行）都**不適用** fast-path —— 邏輯 bug 在小 diff 很常見，跨模型 review 仍有價值。

**安全性保證**：

- review prompt 讓 codex 在自己 turn 開頭讀 working tree diff——snapshot 語義不變：啟動後 working tree 變動不影響已啟動的 review
- 0-A / 0-B / 0-C 修正後若**累計超過 50 行或跨 5 檔以上** → **MUST** 在匯合階段重跑一次 `codex-review-safe.sh xhigh` 確認新引入的程式碼也過 codex 眼睛
- 0-B / 0-A.1 / 0-C 抓到的問題**全部匯合一次修**，避免反覆 review

### Gate 執行細節

每個 gate 的完整執行流程（bash scripts、trigger 條件、fix loop、codex offload）見 [gates.md](gates.md)。執行任一 gate 前 **MUST** 先讀對應 §。

- **0-A 程式碼審查**：simplify（0-A.0，序跑）→ Codex xhigh（0-A.1，背景）→ 條件升 Codex max + Fable code-review max（0-A.2）。詳見 [gates.md](gates.md) § 0-A。
- **0-B UI Design Review**：條件觸發（`.vue` template 變更 + 視覺影響）。詳見 [gates.md](gates.md) § 0-B。
- **0-C CI 等效檢查**：`pnpm check` + `pnpm test` + `pnpm run doctor`，全綠才過。詳見 [gates.md](gates.md) § 0-C。
- **0-D Doc Alignment**：條件觸發（diff 觸及 docs / rules / snippets / audit / 業務碼 / pitfall）。詳見 [gates.md](gates.md) § 0-D。

### 紀律禁止項

- **NEVER** 在 0-A.1 背景跑的時候，主線只 poll 不做事 —— 必須同步推進 0-C，0-B 觸發時派 subagent
- **NEVER** 因為「擔心 0-C 修改影響 codex」而退回串行 —— codex 看的是 snapshot，不受後續 working tree 變動影響；大改動的 fallback 已寫在「安全性保證」

其餘紀律禁止項見 [gates.md](gates.md) § 0-A/B/C/D 並行匯合 紀律禁止項。

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
類型: feat
檔案:
- path/to/file.ts
```

**分組輸入 = Step 2 的 `git status --porcelain` 完整輸出**（tracked modified + untracked 非 ignored），**NEVER** 只用 `git diff --stat`。

- **Untracked 非 ignored 檔（`??`）一律納入分組**，通常自成獨立 `chore` group（除非語義明確屬於某 feat / fix group）
- 看到 `??` 開頭的檔想加 `.gitignore` 消掉時 **STOP**：先問「這本來就該 ignore（build artifact / runtime state），還是我在逃避 commit？」逃避 commit 而 gitignore = 把該入庫的東西藏掉，方向反了（詳見 [[wip-orphan-recovery]] § 反射性 gitignore 禁令）

## Step 4: 逐一執行 Commit

對每個分組（用 `git commit --only -- <files>` 強制 limit scope，防別 session staged race — 詳見 `rules/core/commit.md` § Ad-hoc commit 必走 `git commit --only -- <paths>`）：

```bash
git commit --only -m "$(cat <<'EOF'
feat: 功能描述

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

> 本步驟在版本號升級（Step 6）**之前**執行——HANDOFF/ROADMAP 的 commit 會跟 Step 6 的 bump/deploy commit 一起，在同一次 `git push origin main` 送出。若該 repo 的 staging workflow 掛了 `push: branches: [main]` 且帶 `cancel-in-progress`，二次 main push 會觸發新的 staging run 把發版 commit 的 run 取消（見 `~/offline/clade/vendor/snippets/deploy-gate/README.md`）；沒有 main-push 觸發的 repo 則單純少一次無謂 push。本步驟收集的內容不依賴版本號或 push 結果，版本號在 Step 6 才產生。

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

### 5-B. 收集下一步資訊

從本次 session 脈絡、`git log`、`docs/tech-debt.md`、`openspec/ROADMAP.md` 的 Next Moves 萃取（涵蓋 spectra change 與自由任務，不限 openspec）：

- **In Progress**：正在進行但未完結的工作（spectra change / 自由任務皆可，含進度描述）
- **Blocked**：被什麼擋住、需要什麼才能繼續（無則省略此區塊）
- **Next Steps**（不分來源，一律收齊，按優先序排列）：
  - commit 後的驗證動作：人工檢查、截圖 review、deploy smoke test
  - follow-up marker：`@followup[TD-NNN]` 指向的 tech debt
  - session 中浮現但刻意未處理的機會：refactor、抽共用元件、補測試
  - 跨 session backlog：使用者提過的待辦、roadmap 的 near-term 項目
  - 注意事項 / 陷阱：下一人接手前需要知道的隱性脈絡

### 5-C. 寫入 `HANDOFF.md`

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
- 為了「填滿」區塊灌水 —— 真沒有就省略該區塊

### 5-D. 同步 Spectra ROADMAP

```bash
pnpm spectra:roadmap
```

重算 `openspec/ROADMAP.md` 的 AUTO 區塊（Active Changes / Active Claims / Parallel Tracks / Parked Changes）。AUTO 區塊由此命令生成，手動編輯會被下次 sync 覆寫。

若 5-B 收集到的 **Next Steps** 中包含跨 session backlog（不只是「commit 後立刻要做」的驗證動作），依 `.claude/rules/proactive-skills.md` 的「Spectra Roadmap Maintenance」**手動**更新 MANUAL 區塊的 `## Next Moves`，格式：

```text
- [priority] 描述 — 依賴：xxx / 獨立 / 互斥：yyy
```

### 5-E. 把 HANDOFF/ROADMAP 變更納入 commit（不 push）

5-C/5-D 修改的是 tracked 檔（`HANDOFF.md`、`openspec/ROADMAP.md`），**MUST** 在此處 commit 進去，否則 working tree 會 dirty、Step 6 的 deploy commit 也不含這次的交接狀態。

```bash
# 只 stage 5-C/5-D 動到的檔，避免誤包其他 WIP（commit 流程預設不該再撿東西）
git add HANDOFF.md openspec/ROADMAP.md 2>/dev/null || true

# 若沒實際變動（HANDOFF 不需更新、ROADMAP 已 current），跳過 commit
if ! git diff --cached --quiet -- HANDOFF.md openspec/ROADMAP.md 2>/dev/null; then
  git commit -m "$(cat <<'EOF'
docs(handoff): 更新 commit 後交接狀態

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
  git log -1 --oneline
fi
```

> 注意：這個 commit **不** push。它**不**重新 bump 版本（不是 deploy），只是把 HANDOFF/ROADMAP 落入 history。它會跟 Step 6 的 bump/deploy commit 一起在同一次 `git push origin main` 送出——刻意延後 push 是為了讓發版 commit（HANDOFF commit + deploy commit）只觸發**一次** main push，不讓第二次 push 取消掉第一次 push 已排入佇列的 staging run（見 `~/offline/clade/vendor/snippets/deploy-gate/README.md`）。

### 5-F. 報告

```text
✅ HANDOFF.md 已更新（已入 commit / 無變更略過）
✅ ROADMAP 已同步（已入 commit / 無變更略過）
（或：無可延續工作，HANDOFF.md 已清空 / 未建立）
```

## Step 6: 版本號升級與 Deploy Commit

判斷升級類型：

- 包含 `feat` → `pnpm version minor --no-git-tag-version`
- 只有 `fix` 或其他 → `pnpm version patch --no-git-tag-version`

建立 deploy commit：

```bash
git add package.json
git commit -m "$(cat <<'EOF'
deploy: 發布新版本 v{新版本號}

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

## Step 6b: Notion 專案層同步（條件觸發）

per [[spectra-notion-coupling]] § 專案層。consumer 的 `.claude/consumer-meta.json` 若有 `notion.projectWorkflow: true`，Step 6 的 tag 已推出後 **MUST** 執行：

```bash
node ~/offline/clade/vendor/scripts/notion-sync.mjs release \
  --consumer-path . --change <change-name> --tag "$(git describe --tags --abbrev=0)" --json
```

本步驟寫 Story 的 `上線日`、並**重算所屬 Milestone 的進度**（Notion 不支援 rollup of rollup，進度由 script 親自算後 PATCH）。

- Milestone 進度達 100% 且有連結報價單 → script 回 Class 3 (a)，**MUST** 用 `request_user_input` 問使用者是否標「已交付」/ 勾「可請款」。**NEVER** 自動推——那是請款後果。
- Story `待驗收 → 已完成` 是驗收側轉移，script 一律回 Class 3 (b) 不自動寫。
- `pending` 非空 → 寫入未確認落地，**MUST** 列進 Step 7 完成報告。
- 未啟用 `projectWorkflow` → script 自行 exit 0，不需另外判斷。

## Step 7: 完成報告

**Completion evidence gate**（輸出「✅ Commit 完成」前 MUST 逐格自查；每格附「實跑命令＋輸出摘尾」，貼不出證據＝該格未完成，不准宣告完成）：

- [ ] 每個 commit scope 驗證：貼各 commit 的 `git show --stat <hash> | tail -3` 輸出（changed files 數 vs 預期不符 → 回 Step 4 處置，不出報告）
- [ ] Step 0 品質檢查結論：貼 0-A / 0-C 的結論行（條件未觸發的軸標明「未觸發＋原因」）
- [ ] push / tag 結果：貼 `git push --tags` 與 `git push origin main` 兩者輸出（本次不 push 則標明原因）

三格證據放進完成報告的 `Evidence` 段。

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
- push: <git push --tags 與 git push origin main 摘尾>
```

## Step 8: 自動銜接 /ship（條件觸發）

```bash
git branch --show-current
```

**觸發條件**：當前**不在 main / master 分支**，且 consumer 提供 `/ship` skill（會 push branch 並開 PR）。

```text
Commit 完成！要繼續執行 /ship 推送並建立 PR 嗎？
```

- 同意 → 執行 `/ship` skill
- 拒絕或已在 main / master → 跳過

**不觸發**：在 main / master 分支，或 consumer 沒有 `/ship` skill。

## Final Step: 釋放 /commit lock（**必做最後一步**）

```bash
node .claude/scripts/commit-lock.mjs release
```

**必須執行**，即使前面任何 step 失敗：

- 正常完成 → 釋放
- 中途失敗（品質閘門修不動、staging 出問題、deploy workflow 紅燈）→ 回報使用者後**仍要**釋放 lock，再等使用者指示
- 使用者明確中止 → 釋放 lock

**NEVER** 讓鎖長期遺留；stale lock 雖然 30 分鐘後會自動清，但中間其他 session 要跑 /commit 會被卡住。
