# 資料庫效能優化指南

本文檔說明 Supabase (PostgreSQL) 資料庫效能優化的最佳實踐。

---

## 1. 索引策略

### 1.1 基本原則

- 為經常用於 `WHERE`、`JOIN`、`ORDER BY` 的欄位建立索引
- 避免過度索引（每個索引都會增加寫入成本）
- 定期檢查索引使用率

### 1.2 常見索引類型

```sql
-- 基本索引
CREATE INDEX idx_resources_name ON your_schema.resources(name);

-- 複合索引（注意順序）
CREATE INDEX idx_resources_status_created ON your_schema.resources(status, created_at);

-- 部分索引（只索引符合條件的資料）
CREATE INDEX idx_active_resources ON your_schema.resources(id)
WHERE deleted_at IS NULL;

-- GIN 索引（用於全文搜尋或 JSONB）
CREATE INDEX idx_resources_metadata ON your_schema.resources USING GIN(metadata);
```

### 1.3 檢查索引使用率

```sql
SELECT
  relname as table_name,
  indexrelname as index_name,
  idx_scan as times_used,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

---

## 2. 查詢優化

### 2.1 使用 EXPLAIN ANALYZE

```sql
EXPLAIN ANALYZE SELECT * FROM your_schema.resources WHERE status = 'active';
```

### 2.2 避免 SELECT \*

```typescript
// ❌ 避免
const { data } = await supabase.from('resources').select('*')

// ✅ 只選擇需要的欄位
const { data } = await supabase.from('resources').select('id, name, status')
```

### 2.3 使用 count 時指定模式

```typescript
// ❌ 效能差：會計算精確數量
const { count } = await supabase.from('resources').select('*', { count: 'exact' })

// ✅ 如果只需要知道是否有資料
const { count } = await supabase.from('resources').select('*', { count: 'planned' }).limit(1)
```

### 2.4 分頁查詢

```typescript
// 使用 range 進行分頁（效能較好）
const from = (page - 1) * pageSize
const to = from + pageSize - 1
const { data } = await supabase.from('resources').select('*').range(from, to)
```

---

## 3. RLS 效能優化

### 3.1 使用子查詢快取

```sql
-- ✅ 效能好：使用 (SELECT ...) 包裝
USING ((SELECT auth.role()) = 'service_role')

-- ❌ 效能差：每行都會重新計算
USING (auth.role() = 'service_role')
```

### 3.2 建立 Helper 函式

```sql
-- 建立高效能的 helper 函式
CREATE OR REPLACE FUNCTION your_schema.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role FROM your_schema.user_roles WHERE id = auth.uid();
$$;

-- 在 RLS 中使用
CREATE POLICY "Staff can read" ON your_schema.resources
FOR SELECT USING (
  (SELECT auth.role()) = 'service_role'
  OR your_schema.current_user_role() IN ('admin', 'manager', 'staff')
);
```

---

## 4. 連線池管理

### 4.1 Supabase 連線池設定

Supabase 使用 PgBouncer 作為連線池，預設設定通常足夠。

### 4.2 避免長時間佔用連線

```typescript
// ❌ 避免：長時間持有連線
const { data } = await supabase.from('resources').select('*')
// ... 做很多事情 ...
await supabase.from('logs').insert({ action: 'done' })

// ✅ 快速完成查詢，釋放連線
const { data } = await supabase.from('resources').select('*')
// 處理資料...
await supabase.from('logs').insert({ action: 'done' })
```

---

## 5. 快取策略

### 5.1 使用 Materialized View

```sql
-- 建立 Materialized View
CREATE MATERIALIZED VIEW your_schema.resource_stats AS
SELECT
  status,
  COUNT(*) as count,
  AVG(value) as avg_value
FROM your_schema.resources
GROUP BY status;

-- 定期刷新（可結合 pg_cron）
REFRESH MATERIALIZED VIEW your_schema.resource_stats;
```

### 5.2 使用 pg_cron 定期刷新

```sql
-- 每小時刷新統計 View
SELECT cron.schedule(
  'refresh-stats',
  '0 * * * *',
  'REFRESH MATERIALIZED VIEW your_schema.resource_stats;'
);
```

---

## 6. 批次操作

### 6.1 批次插入

```typescript
// ❌ 避免：逐筆插入
for (const item of items) {
  await supabase.from('resources').insert(item)
}

// ✅ 批次插入
await supabase.from('resources').insert(items)
```

### 6.2 批次更新（使用 RPC）

```sql
-- 建立批次更新函式
CREATE OR REPLACE FUNCTION your_schema.batch_update_status(
  p_ids uuid[],
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE your_schema.resources
  SET status = p_status, updated_at = now()
  WHERE id = ANY(p_ids);
END;
$$;
```

---

## 7. 監控與診斷

### 7.1 慢查詢分析

```sql
-- 查看慢查詢（需要啟用 pg_stat_statements）
SELECT
  query,
  calls,
  mean_time,
  total_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

### 7.2 表格統計

```sql
-- 查看表格大小和行數
SELECT
  schemaname,
  relname as table_name,
  n_live_tup as row_count,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
```

### 7.3 未使用的索引

```sql
-- 找出未使用的索引
SELECT
  schemaname,
  relname as table_name,
  indexrelname as index_name,
  idx_scan as times_used
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
```

---

## 8. 檢查清單

定期執行以下檢查：

- [ ] 檢查慢查詢並優化
- [ ] 檢查未使用的索引
- [ ] 確認 RLS policy 使用子查詢快取
- [ ] 確認批次操作取代逐筆操作
- [ ] 刷新 Materialized View
- [ ] 執行 VACUUM ANALYZE

---

## 9. 常用工具

### Supabase Dashboard

- **Table Editor**: 查看資料和結構
- **SQL Editor**: 執行診斷查詢
- **Logs**: 查看查詢日誌

### pgAdmin / DBeaver

- 可視化 EXPLAIN ANALYZE 結果
- 索引管理
- 效能監控

### Supabase CLI

```bash
# 檢查安全性
supabase db lint --level warning

# 產生型別
supabase gen types typescript --local
```
