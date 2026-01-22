# Supabase 入門指南

> 給有 Nuxt 經驗但第一次接觸 Supabase 的開發者

## Supabase 是什麼？

簡單說，Supabase 是一個「後端即服務」平台，但它不像 Firebase 那樣鎖定你在 NoSQL 的世界裡。它的核心是 **PostgreSQL**——一個業界標準的關聯式資料庫。

這意味著：

- 你學到的 SQL 技能可以帶著走
- 資料結構是有 schema 的，不是自由格式的 JSON
- 可以用 JOIN、transaction、constraint 等關聯式資料庫的強大功能

## 與 Firebase 的比較

| 特性     | Firebase          | Supabase           |
| -------- | ----------------- | ------------------ |
| 資料庫   | NoSQL (Firestore) | PostgreSQL         |
| 查詢語言 | SDK 方法          | SQL + SDK          |
| Schema   | 無，動態          | 有，需定義         |
| 權限控制 | Security Rules    | Row Level Security |
| 本地開發 | 模擬器            | Docker 容器        |
| 開源     | 否                | 是                 |

**什麼時候選 Supabase？**

- 資料有明確結構
- 需要複雜查詢（JOIN、聚合等）
- 想要資料庫級別的權限控制
- 偏好 SQL 的開發者

---

## 核心概念

### 1. Schema

PostgreSQL 的 schema 就像是資料表的「資料夾」。預設有一個 `public` schema，但我們建議建立自己的：

```sql
-- 建立業務 schema
CREATE SCHEMA IF NOT EXISTS app;

-- 建立系統 schema（使用者、權限等）
CREATE SCHEMA IF NOT EXISTS core;
```

**為什麼不用 public？**

- `public` 有一些預設權限可能造成安全隱憂
- 自訂 schema 讓結構更清晰
- 可以用不同 schema 區分不同模組

### 2. 角色（Roles）

Supabase 有幾個預定義的角色：

| 角色            | 說明         | 使用場景              |
| --------------- | ------------ | --------------------- |
| `anon`          | 匿名訪客     | 未登入的使用者        |
| `authenticated` | 已登入使用者 | 一般操作              |
| `service_role`  | 服務角色     | Server 端，可繞過 RLS |

當你在 Client 端查詢，Supabase 會根據登入狀態自動使用 `anon` 或 `authenticated`。當你在 Server 端用 `service_role` key，可以繞過 RLS 做管理操作。

### 3. Row Level Security (RLS)

這是 Supabase 最強大的功能，也是最需要理解的概念。

**傳統做法**：權限檢查寫在 API 裡

```typescript
// 每個 API 都要寫權限檢查
app.get('/posts/:id', async (req, res) => {
  const post = await db.posts.findById(req.params.id)

  // 手動檢查：這個使用者能看這篇文章嗎？
  if (post.userId !== req.user.id && !post.isPublic) {
    return res.status(403).send('Forbidden')
  }

  return res.json(post)
})
```

**RLS 做法**：權限規則定義在資料庫層

```sql
-- 定義一次：使用者只能看自己的文章，或公開的文章
CREATE POLICY "Users can view own or public posts"
  ON app.posts FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR is_public = true
  );
```

之後不管你怎麼查詢——用 API、用 SDK、用 Realtime subscription——這個規則都會自動生效。你不可能「忘記」檢查權限。

---

## RLS 詳解

### 基本語法

```sql
CREATE POLICY "政策名稱"
  ON schema.table
  FOR [SELECT | INSERT | UPDATE | DELETE | ALL]
  [TO role]
  USING (條件)           -- 用於 SELECT/UPDATE/DELETE
  WITH CHECK (條件);     -- 用於 INSERT/UPDATE
```

### 常見模式

#### 1. 使用者只能存取自己的資料

```sql
-- 啟用 RLS
ALTER TABLE app.todos ENABLE ROW LEVEL SECURITY;

-- SELECT：只能看自己的
CREATE POLICY "Users can view own todos"
  ON app.todos FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- INSERT：只能新增自己的
CREATE POLICY "Users can create own todos"
  ON app.todos FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

-- UPDATE：只能更新自己的
CREATE POLICY "Users can update own todos"
  ON app.todos FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- DELETE：只能刪除自己的
CREATE POLICY "Users can delete own todos"
  ON app.todos FOR DELETE
  USING (user_id = (SELECT auth.uid()));
```

#### 2. 角色權限系統

```sql
-- 假設你有一個取得使用者角色的函式
CREATE OR REPLACE FUNCTION core.current_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role FROM core.user_roles
  WHERE user_id = (SELECT auth.uid())
$$;

-- 管理員可以看所有資料
CREATE POLICY "Admins can view all"
  ON app.orders FOR SELECT
  USING (
    (SELECT core.current_user_role()) = 'admin'
  );

-- 一般使用者只能看自己的
CREATE POLICY "Users can view own orders"
  ON app.orders FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
  );
```

#### 3. Server API 專用（service_role 繞過）

```sql
-- 讓 Server API 可以做任何操作
CREATE POLICY "Service role has full access"
  ON app.todos FOR ALL
  USING ((SELECT auth.role()) = 'service_role');
```

**這很重要！** 如果你的 Server API 用 `service_role` key，但沒有這條 policy，寫入操作會失敗（RLS 會阻擋）。

### 效能優化

RLS 的條件會在每次查詢時執行。如果寫得不好，會影響效能。

```sql
-- ❌ 慢：每行都會呼叫 auth.uid()
USING (auth.uid() = user_id)

-- ✅ 快：只呼叫一次，結果被快取
USING ((SELECT auth.uid()) = user_id)
```

用 `(SELECT ...)` 包裝函式呼叫，PostgreSQL 會把它當作常數，只執行一次。

---

## Migration 工作流程

### 什麼是 Migration？

Migration 是「資料庫結構的版本控制」。每次你要改資料庫結構（新增表格、修改欄位、加索引等），就建立一個 migration 檔案。

這樣做的好處：

- 可以追蹤資料庫結構的變更歷史
- 團隊成員可以同步資料庫結構
- 可以在不同環境（開發、測試、正式）套用相同的結構

### Local-First 原則

**永遠在本地建立和測試 migration，最後才推到線上。**

```bash
# 1. 建立 migration 檔案
supabase migration new create_todos_table

# 2. 編輯產生的 SQL 檔案（在 supabase/migrations/ 下）

# 3. 重置本地資料庫，套用所有 migration
supabase db reset

# 4. 檢查安全問題
supabase db lint --level warning

# 5. 產生 TypeScript 類型
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null

# 6. 確認程式碼能編譯
pnpm typecheck

# 7. 一切 OK 後，才推到線上
supabase db push
```

### Migration 範本

```sql
-- supabase/migrations/20240101000000_create_todos_table.sql

-- 建立 schema（如果還沒有）
CREATE SCHEMA IF NOT EXISTS app;

-- 授權
GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA app TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA app TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON TABLES TO anon, authenticated, service_role;

-- 建立表格
CREATE TABLE app.todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  completed BOOLEAN DEFAULT false,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 建立索引
CREATE INDEX todos_user_id_idx ON app.todos(user_id);

-- 啟用 RLS
ALTER TABLE app.todos ENABLE ROW LEVEL SECURITY;

-- RLS 政策
CREATE POLICY "Users can view own todos"
  ON app.todos FOR SELECT
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can create own todos"
  ON app.todos FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update own todos"
  ON app.todos FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can delete own todos"
  ON app.todos FOR DELETE
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Service role has full access"
  ON app.todos FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

-- 建立 updated_at 自動更新 trigger
CREATE OR REPLACE FUNCTION app.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER todos_updated_at
  BEFORE UPDATE ON app.todos
  FOR EACH ROW EXECUTE FUNCTION app.update_updated_at();
```

### 不可變原則

**已經套用的 migration 絕對不能修改。**

如果你發現 migration 有錯誤：

```bash
# ❌ 錯誤：直接改已套用的 migration
# 這會導致本地和線上資料庫結構不同步

# ✅ 正確：建立新的 migration 來修正
supabase migration new fix_todos_add_priority_column
```

新 migration 的內容：

```sql
-- 修正：補上遺漏的 priority 欄位
ALTER TABLE app.todos ADD COLUMN priority INTEGER DEFAULT 0;
```

---

## Database Functions

### 為什麼要用 Database Function？

- 封裝複雜的業務邏輯
- 減少網路往返
- 確保原子性操作

### 安全規範：search_path

**所有 function 必須設定 `SET search_path = ''`！**

```sql
-- ✅ 正確
CREATE OR REPLACE FUNCTION core.get_user_role(target_user_id UUID)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''  -- 必須是空字串
AS $$
BEGIN
  RETURN (
    SELECT role FROM core.user_roles
    WHERE user_id = target_user_id
  );
END;
$$;

-- ❌ 危險：可能被 search_path 攻擊
CREATE OR REPLACE FUNCTION core.get_user_role(target_user_id UUID)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp  -- 絕對禁止
AS $$
...
$$;
```

**為什麼？** 如果 `search_path` 包含 `public` 或 `pg_temp`，攻擊者可以建立同名的惡意函式或表格，當你的 function 執行時就會呼叫到惡意程式碼。

### 驗證指令

```bash
# 檢查所有 migration 是否有安全問題
supabase db lint --level warning

# 搜尋危險的 search_path 設定
grep -r "SET search_path = public" supabase/migrations/
```

---

## 在 Nuxt 中使用 Supabase

### Client 端

```typescript
// app/pages/todos.vue
<script setup lang="ts">
import type { Database } from '~/types/database.types'

const client = useSupabaseClient<Database>()

// 查詢（RLS 會自動過濾）
const { data: todos, refresh } = await useAsyncData('todos', async () => {
  const { data, error } = await client
    .schema('app')
    .from('todos')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
})

// 即時訂閱
const channel = client
  .channel('todos-changes')
  .on('postgres_changes',
    { event: '*', schema: 'app', table: 'todos' },
    (payload) => {
      console.log('Change received!', payload)
      refresh()
    }
  )
  .subscribe()

onUnmounted(() => {
  channel.unsubscribe()
})
</script>
```

### Server 端

```typescript
// server/api/v1/todos/index.post.ts
import { z } from 'zod'
import { getSupabaseWithContext, requireAuth } from '~~/server/utils/supabase'

const createTodoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  // 確認使用者已登入
  const user = await requireAuth(event)

  // 驗證請求資料
  const body = await readValidatedBody(event, createTodoSchema.parse)

  // 取得有 service_role 權限的 client
  const supabase = await getSupabaseWithContext(event)

  // 新增資料
  const { data, error } = await supabase
    .schema('app')
    .from('todos')
    .insert({
      ...body,
      user_id: user.id,
    })
    .select()
    .single()

  if (error) {
    throw createError({
      statusCode: 500,
      message: '新增失敗',
    })
  }

  setResponseStatus(event, 201)
  return { data }
})
```

---

## 常見問題

### Q: 資料新增成功但查不到？

很可能是 RLS 問題。檢查：

1. 是否有啟用 RLS？（`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`）
2. 是否有 SELECT policy？
3. Policy 的條件是否正確？

可以用 Supabase Dashboard 的 SQL Editor 測試：

```sql
-- 暫時以 service_role 查詢，繞過 RLS
SELECT * FROM app.todos;
```

### Q: Server API 寫入失敗？

確認你的 RLS policy 有包含 service_role 繞過：

```sql
CREATE POLICY "Service role has full access"
  ON app.todos FOR ALL
  USING ((SELECT auth.role()) = 'service_role');
```

### Q: TypeScript 類型不對？

重新產生類型：

```bash
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null
```

### Q: 本地和線上資料庫結構不同步？

```bash
# 查看 migration 狀態
supabase migration list

# 如果需要，重新同步（會清除資料）
supabase db reset
```

---

## 延伸閱讀

- [Supabase 官方文件](https://supabase.com/docs)
- [PostgreSQL RLS 文件](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Supabase CLI 文件](https://supabase.com/docs/guides/cli)
