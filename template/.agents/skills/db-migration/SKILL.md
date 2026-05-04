---
description: 建立 Supabase migration，確保符合安全規範
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/commands/db-migration.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


## User Input

```text
$ARGUMENTS
```

## Outline

建立新的 Supabase migration，確保符合 AGENTS.md 中的所有規範。

### Step 1: 確認需求

詢問使用者要建立什麼樣的 migration：

- 新增表格？
- 修改欄位？
- 建立函式？
- 新增 RLS 政策？

### Step 2: 建立 Migration 檔案

使用 Supabase CLI 建立 migration（**禁止手動建立 .sql 檔案**）：

```bash
supabase migration new <description_in_snake_case>
```

### Step 3: 撰寫 Migration 內容

根據需求撰寫 SQL，**必須遵守以下規範**：

#### 函式規範（CRITICAL）

```sql
-- ✅ 正確：search_path 必須是空字串
CREATE OR REPLACE FUNCTION schema_name.function_name()
RETURNS return_type
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''  -- 必須是空字串！
AS $$
BEGIN
  -- 使用完整路徑：schema_name.table_name
  SELECT * FROM core.users WHERE id = auth.uid();
END;
$$;
```

```sql
-- ❌ 禁止：任何其他 search_path 值
SET search_path = public, pg_temp  -- 絕對禁止！
SET search_path = public           -- 禁止！
```

#### Schema 規範

- 使用正確的 schema 前綴（如 `public.`、`core.`，或專案自訂業務 schema）
- 所有表格/函式引用使用完整路徑（避免裸表名觸發 `search_path` resolution）

### Step 4: 本地測試與類型產生（自動）

依序執行以下步驟，任何步驟失敗則停止並顯示錯誤。**MUST** 透過 package.json 偵測 consumer 是用本機 Docker Supabase 還是遠端 LXC（via `pnpm db:*` wrapper）。

```bash
# 從 package.json 讀 types 路徑（若有自訂）；fallback 到 conventional locations
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

USE_LXC=$(node -e "process.exit(require('./package.json').scripts?.['db:reset'] ? 0 : 1)" 2>/dev/null && echo yes || echo no)

if [ "$USE_LXC" = yes ]; then
  # 遠端 LXC Supabase 模式（consumer 提供 pnpm db:* wrapper；db:reset 內部會跑 db:types 寫到 $TYPES）
  pnpm db:reset
  pnpm db:lint        # 安全檢查（必須零警告）
  pnpm typecheck
else
  # 本機 Docker Supabase 模式
  supabase db reset
  supabase db lint --level warning
  # 直接重導向到 $TYPES — 不用 tee（pipeline 會吞 supabase gen types 失敗狀態）
  supabase gen types typescript --local > "$TYPES"
  pnpm typecheck
fi
```

**自動產生類型**：LXC 模式由 `pnpm db:reset` 內部呼叫 `db:types`；Docker 模式由 `supabase gen types` 寫入 `$TYPES`（自動偵測自 `package.json.config.dbTypesPath` 或 conventional locations）。Consumer 自訂 types 路徑時應設於 `package.json` `config.dbTypesPath`，**MUST** 同步在 `db:types` script 內引用同一路徑（避免 LXC/Docker 模式寫到不同檔）。

**錯誤處理**：

- `db reset` 失敗 → 檢查 SQL 語法
- `db lint` 有警告 → 檢查 search_path 和 RLS
- `typecheck` 失敗 → 更新使用到舊型別的程式碼

### Step 5: 驗證結果

1. 確認 `db:lint` / `supabase db lint` 沒有警告
2. 確認 `pnpm typecheck` 通過
3. 顯示 migration 檔案內容供使用者確認

### Step 6: 完成報告

```text
✅ Migration 建立完成！

檔案: supabase/migrations/YYYYMMDDHHMMSS_description.sql
狀態:
- db reset: ✓
- db lint: ✓
- typecheck: ✓

下一步：
- 測試功能是否正常
- 準備好後依 consumer 部署模式推送（LXC: `pnpm supabase:sync`；Docker: `supabase db push`）
```

## 安全檢查清單

- [ ] 所有 `CREATE FUNCTION` 都有 `SET search_path = ''`
- [ ] 沒有使用 `SET search_path = public` 或 `pg_temp`
- [ ] 所有表格/函式引用使用 schema 前綴
- [ ] `db:lint` / `supabase db lint` 零警告
- [ ] RLS 政策已設定（如適用）
