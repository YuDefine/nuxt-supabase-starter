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
