<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/commit/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Schema 同步檢查 — Reference

> 本檔是 commit skill Step 1（schema 同步檢查）的完整執行細節。主檔（SKILL.md）只留觸發判定；
> 判定為 HAS 時 MUST 先完整讀本檔再繼續。**只有使用 Supabase migrations 的 repo 會走到這裡** ——
> 沒有 `supabase/migrations/` 的 repo 在主檔就已經分流掉，不需要讀本檔。

## 為什麼要檢查

database types 檔是從 migrations 推導出來的產物。若 working tree 的 types 與「把 migrations
重跑一次所得到的 types」不一致，代表**有人手改了 types 卻沒補對應 migration** —— 這種 commit
進去之後，任何人重建 DB 都會拿到跟 repo 裡不同的 schema。

## Step 1.1 — 解析 types 檔路徑

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
```

## Step 1.2 — 精確判定是否需要比對

```bash
# 檢查 types 或 migrations 是否變更（HEAD diff 含 staged）
git diff --name-only HEAD -- "$TYPES" supabase/migrations/ | grep -q . && echo HAS || echo NO
```

`NO` → 回主檔進 Step 2。`HAS` → 往下走。

> 主檔的觸發判定刻意寬鬆（寧可誤送進本檔），這一步才是權威判定 —— 它認得
> `package.json` 的 `config.dbTypesPath` 自訂路徑，主檔的粗篩不認得。

## Step 1.3 — 重建 types 並比對

```bash
# 1. 先把 working tree 的版本（含 staged + unstaged）拷一份備查
#    MUST mktemp 唯一路徑——固定路徑是全機器所有 consumer 共用，會拿到別 repo 的 types
TYPES_BEFORE="$(mktemp -t types-before-reset.XXXXXXXXXX)"
cp "$TYPES" "$TYPES_BEFORE"

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
diff "$TYPES_BEFORE" "$TYPES"
```

有差異 → **停止 commit**，提示使用者依差異建立對應 migration 或還原 `$TYPES`。

> **遠端 LXC 模式注意**：`pnpm db:types` 通常**直接寫入** `$TYPES` 不輸出 stdout，所以**不能**用 `> "$TYPES_BEFORE"` 重導向取值（一定要先 `cp` 備份再 `pnpm db:reset`）。

## Step 1.4 — SQL lint（hard block）

**無條件跑**。Step 1.3 的 reset 剛把 DB 刷到「migrations 全部重放一次」的狀態，這是 lint 唯一
量得準的時刻——觸發判定、SSH 連線、reset 三樣成本都已經付掉，這一步的邊際成本接近零。

```bash
if node -e "process.exit(require('./package.json').scripts?.['db:lint'] ? 0 : 1)" 2>/dev/null; then
  pnpm db:lint
else
  supabase db lint --level warning --local
fi
```

**輸出非空 → 停止 commit。** `--level warning` 是零容忍門檻，**不分級**：分級需要維護一份
「已知可忽略」baseline 清單，那是會跟現實漂開的第二份平行文件。

**NEVER** 以「這條 warning 不是本次 diff 引入」「是既有 debt」為由放行——比照 0-C 的 doctor
紀律，gate 不區分新舊。既有 warning 的一次性清理屬 consumer 落地工作，清完之後這條 gate 對
日常 commit 就是靜默通過。

### 缺 `db:lint` script → block（比照 0-E 的 `@evlog/cli` 必裝）

`package.json` 沒有 `db:lint` 且 `supabase db lint` 不可用（self-hosted 專案本機不能直連）時，
印下列訊息、釋放 commit-lock（`node .claude/scripts/commit-lock.mjs release`）並 STOP：

```text
⛔ Step 1.4 失敗 — db:lint 未接線

這個 repo 有 supabase/migrations/ 但沒有 db:lint script，SQL 層完全沒有檢測。

安裝步驟：
  1. 複製 ~/offline/clade/vendor/snippets/supabase-ci/db-lint.sh.template 到 scripts/
  2. 在 package.json scripts 加入：
       "db:lint": "bash ./scripts/db-lint.sh"
  3. 重跑 /commit

詳見 vendor/snippets/supabase-ci/README.md
```

**NEVER** 因為「這個 repo 一直沒有 lint 也沒出事」就跳過本 gate 繼續跑 Step 2。

## Step 1.5 — advisors（advisory，但輸出 MUST 讀）

```bash
supabase db advisors --local 2>/dev/null || echo "SKIP: CLI < v2.81.3，改用 MCP get_advisors"
```

**這一步 exit code 不擋 commit**——`supabase db advisors` 沒有文件化的輸出契約與 exit code 語義，
做成 hard gate 會 flaky，而 flaky gate 的下場是被繞過，比 advisory 更糟。CLI 版本不足時退到 MCP
`get_advisors`；兩者都不可用就印一行說明繼續，**不擋**。

**但輸出 MUST 讀，且義務是逐條的**：

- **每一條** security 類 finding（RLS disabled、policy exists but RLS disabled、security definer
  view、auth.users 暴露、function search_path 未設等）**MUST** 在本次 commit 當場修掉，或在
  `docs/tech-debt.md` 登一條 entry 並在完成報告寫明編號。**兩者都沒有就不准進 Step 2。**
- **performance 類 finding**（unindexed FK、unused index、auth_rls_initplan、multiple permissive
  policies）純參考，不強制處置。

**「每一條」是字面意思，不是「處理最嚴重的那條」也不是「處理本次 diff 相關的那條」。**
advisors 回 5 條 security finding 就要 5 條都有著落（修掉或登 TD），**NEVER** 修一條就往下走。

> 為什麼不把 advisors 交給 Dashboard：官方文件把 advisors 定位成 Dashboard 巡檢面板，那個擺法的
> 前提是 hosted 專案——self-hosted Studio 沒有這兩個面板，照抄官方等於這個訊號沒有任何消費端。
> 本步驟的消費端就是**正在跑 `/commit` 的 agent**。
