---
audience: both
applies-to: post-scaffold
---

# Supabase Migration & Schema Playbook

> 目標：任何人都能在不問人的情況下新增/修改 schema、濃縮基線、同步環境，並確保安全性。若無法照以下流程完成，請在 PR 中修正文檔。

---

## 0. 架構

Supabase 使用本機 Docker 執行開發環境（`supabase start`）。

| Host        | Port  | 服務             |
| ----------- | ----- | ---------------- |
| `localhost` | 54321 | Kong API Gateway |
| `localhost` | 54322 | PostgreSQL       |
| `localhost` | 54323 | Studio           |
| `localhost` | 54324 | Inbucket (Email) |

### 前置條件

1. **Docker** 已安裝且正在執行
2. **Supabase CLI** 已安裝（`supabase --version` 確認）
3. 已執行 `supabase start` 啟動本機開發環境

---

## 1. 核心原則

1. **Local-First**：所有 migration 必須先在本地建立、測試通過後，才能 push 到 remote。禁止直接在 remote 建立 migration。
2. **Schema-first**：所有變更必須以 migration SQL 呈現；Supabase Studio 只能用來觀察或做 PoC，結束後必須產生 diff。
3. **基線唯一**：Repo 只維護一個 baseline migration 為當前整體 schema，其餘歷史放在 `supabase/migrations/archive/`。
4. **search_path 為空字串**：任何 `SECURITY DEFINER` 函式皆需 `SET search_path = ''` 並寫完全限定名稱 (`public.table`, `auth.uid()`)，否則 `supabase db lint` 會擋下。
5. **View 為 security_invoker**：所有 view 需設定 `security_invoker = true`，避免以 definer 權限繞過 RLS 與 lint。
6. **IDENTITY 主鍵**：新建表一律使用 `bigint GENERATED ALWAYS AS IDENTITY` 取代 `bigserial`。IDENTITY 是 SQL 標準語法，避免 sequence ownership 問題。既有表維持 `bigserial` 不遷移。

---

## 2. 開發流程（Schema-first）

```bash
# 1. 產生新 migration
supabase migration new add_items_table

# 2. 編輯 SQL（保持單一主題：新增欄位 / 建表 / 改 policy）

# 3. 套用 migration（重建本機資料庫）
supabase db reset

# 4. 安全檢查
supabase db lint

# 5. 重新產生 TypeScript types
supabase gen types typescript --local > types/database.types.ts

# 6. 型別檢查
pnpm typecheck

# 7. 執行測試 / 手動驗證
```

> 若在 Supabase Studio 先操作 → 使用 `supabase db diff --use-migra -f from_gui` 產生 migration 檔，再回到上述流程。

---

## 3. 檔案結構與腳本

| 位置                                           | 說明                                  |
| ---------------------------------------------- | ------------------------------------- |
| `supabase/migrations/<timestamp>_baseline.sql` | 最新基線，任何增修在此檔案之後累積    |
| `supabase/migrations/archive/`                 | 已過時或舊版本的 migrations，僅供參考 |
| `supabase/seed.sql`                            | 開發用種子資料                        |

---

## 4. 基線化策略

1. **時機**：大量修補 / Schema 變動超過 10 個檔，可在本地執行基線化腳本，產出新的 `YYYYMMDDHHMMSS_baseline.sql`。
2. **流程**
   - 確認沒有尚未合併的 migration PR。
   - `supabase db reset` 確保資料庫是最新狀態。
   - 執行腳本，檢查輸出的基線是否含所有 schema/RLS/函式。
   - 用新的基線覆蓋 `supabase/migrations/`，其餘移到 `archive/`。
   - 跑 `supabase db reset` 以最新基線重建。
3. **提交**：更新 Types、Docs，再送 PR。

---

## 5. Production 存取規則

> **Production 資料庫為唯讀。所有變更必須透過 migration。**

| 操作                        | 允許        | 方式                              |
| --------------------------- | ----------- | --------------------------------- |
| SELECT（查詢）              | ✅          | Studio、`psql`                    |
| DDL（CREATE/ALTER/DROP）    | ❌ 手動禁止 | 透過 migration → CI `db push`     |
| DML（INSERT/UPDATE/DELETE） | ❌ 手動禁止 | 透過 migration → CI `db push`     |
| 緊急資料修復                | ⚠️ 僅限緊急 | 建立修復 migration → push to main |

**禁止事項：**

- 禁止透過任何工具對 production 執行寫入操作
- 禁止透過 `psql` 直連 production 執行 DML/DDL

**原因：** 手動變更不經過 code review、不進 git 歷史、不在 CI 測試範圍內，且無法在其他環境重現。

---

## 6. CI/CD 自動部署

> ⚠️ **重要**：所有 migration 必須遵循 **Local → Dev 測試 → Push to main → CI 自動 apply Production** 流程。

### CI/CD 自動部署流程

當程式碼 push 到 `main` 分支時，GitHub Actions 會**自動**執行以下步驟：

```
CI 檢查 (format → lint → typecheck → test)
  ↓ 通過
supabase db push          ← 自動推送 migration 到 production
  ↓
pnpm build                ← 建置 Nuxt
  ↓
deploy                    ← 部署到雲端平台
```

### 開發者流程

```bash
# 1. 產生新 migration
supabase migration new <description>

# 2. 編輯 migration 內容

# 3. 在本地測試
supabase db reset             # 重建本機資料庫
supabase db lint              # lint migration SQL
supabase gen types typescript --local > types/database.types.ts
pnpm typecheck

# 4. 提交並推送到 main（CI 會自動 db push 到 production）
git add .
git commit -m "migration: <description>"
git push origin main
```

> **注意**：不再需要手動執行 `supabase db push`，CI/CD 會自動處理。

### 手動同步（僅供除錯或緊急情況）

一般情況下不需要手動執行，CI/CD 會自動處理。以下指令僅供特殊情況使用：

1. **手動推送 migrations**

   ```bash
   supabase db push                                 # 手動推送（通常不需要）
   ```

   - 如果出現 `object already exists`，代表基線仍有未判斷存在的語句，請改寫為 `IF NOT EXISTS` 或分離成 ALTER。

2. **標記已棄用版本**（僅在需要修復版本不一致時）
   ```bash
   supabase migration list --linked                # 查看遠端 timestamp
   supabase migration repair --status reverted <timestamp>
   ```
3. **重建遠端**（僅在確定可刪資料時）

   ```bash
   supabase db reset --linked
   ```

   - 會 drop & recreate 遠端 Postgres，套用目前 `supabase/migrations/` 內的所有檔案。

4. **恢復資料**
   - 若需要 seed，可手動匯入 `supabase/seed.sql`。

---

## 7. GUI 使用準則

| 功能                  | 可否使用 | 備註                                                             |
| --------------------- | -------- | ---------------------------------------------------------------- |
| 查看資料 / RLS        | ✅       | 無需額外動作                                                     |
| 快速修改欄位或 policy | ⚠️       | 僅限 PoC，用完記得 `supabase db diff --use-migra` 產出 migration |
| 直接在 GUI 建立函式   | ❌       | 無法控制 `search_path`，請改在 repository 編寫                   |
| 匯入 SQL              | ❌       | 可能與 Repo diff，不允許                                         |

---

## 8. Pre-commit Checklist

- [ ] 所有新增函式皆 `SET search_path = ''`、使用完全限定名稱（如 `public.`/`auth.` 前綴）。
- [ ] 所有 view 已設定 `security_invoker = true`，不以 definer 權限繞過 RLS。
- [ ] 新建表的 SELECT policy 確認存取方式：前端直讀 → `TO public`；僅 server API → `TO authenticated`。
- [ ] `supabase db lint --level warning` 無錯誤。
- [ ] `supabase db reset` 能順利重建。
- [ ] TypeScript types 已重新產生並納入 Git。
- [ ] 文件（本頁或其他相關章節）同步更新。

---

## 9. Sequence 同步（資料匯入後必做）

當使用 `INSERT ... (id, ...)` 直接指定 ID 匯入資料時（如 seed.sql 或資料遷移），PostgreSQL 的 sequence 不會自動更新。這會導致後續 INSERT（不指定 ID）時產生主鍵衝突錯誤。

### 問題徵兆

```
ERROR: duplicate key value violates unique constraint "xxx_pkey"
```

### 檢查 Sequence 狀態

```sql
-- 檢查單一表的 sequence 是否正確
SELECT
  (SELECT COALESCE(MAX(id), 0) FROM app.your_table) as max_id,
  (SELECT last_value FROM app.your_table_id_seq) as seq_value;

-- 若 max_id >= seq_value，表示 sequence 需要重設
```

### 修正方式

```sql
-- 重設單一表的 sequence
SELECT setval(
  'app.your_table_id_seq',
  (SELECT COALESCE(MAX(id), 0) + 1 FROM app.your_table),
  false
);
```

### seed.sql 中的 Sequence 設定

seed.sql 使用 `pg_catalog.setval()` 設定 sequence 值。匯入指定 ID 的資料後，必須確保對應的 `setval` 值大於最大 ID：

```sql
-- ❌ 錯誤：max(id) = 72，但 sequence 設為 1
SELECT pg_catalog.setval('"app"."items_id_seq"', 1, false);

-- ✅ 正確：sequence 設為 max(id) + 1 = 73
SELECT pg_catalog.setval('"app"."items_id_seq"', 73, false);
```

### 匯入資料後的檢查清單

- [ ] 確認所有有 serial/bigserial ID 的表，其 sequence 值 > max(id)
- [ ] 更新 seed.sql 中對應的 `setval` 語句
- [ ] 執行 `supabase db reset` 驗證無主鍵衝突

---

## 10. 表格 Owner 權限問題

### 問題背景

Self-hosted Supabase 環境中：

- `supabase_admin` 是真正的 superuser
- `postgres` 用戶**不是** superuser，無法修改 `supabase_admin` 擁有的物件
- CI/CD 使用 `postgres` 連線執行 `db push`

若透過 Dashboard SQL Editor 或其他管理工具執行 DDL（如建立表格），該物件的 owner 可能不是 `postgres`，導致 CI/CD 無法對其建立索引或修改。

### 預防措施

1. **所有 DDL 必須透過 migration 檔案**：不要用 Dashboard 建立表格

2. **Migration 中明確指定 owner**（建議做法）：

   ```sql
   CREATE TABLE app.new_table (...);
   ALTER TABLE app.new_table OWNER TO postgres;
   ```

3. **定期檢查 owner 一致性**：

   ```sql
   -- 檢查是否有非 postgres owner 的表格
   SELECT schemaname, tablename, tableowner
   FROM pg_tables
   WHERE schemaname = 'app'
     AND tableowner != 'postgres';
   ```

### 修復方式

若發現 owner 不正確，以 superuser 身份修正：

```sql
ALTER TABLE app.your_table OWNER TO postgres;
```

---

## 11. 疑難排解

| 問題                                                  | 可能原因                        | 解法                                                                                                  |
| ----------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `must be owner of table xxx`                          | 表格 owner 不是 `postgres`      | 參考第 10 節，修正 owner 為 `postgres`                                                                |
| `duplicate key violates unique constraint "xxx_pkey"` | 資料匯入後 sequence 未同步      | 參考第 9 節，重設 sequence 為 `max(id) + 1`                                                           |
| `type "xxx" already exists`                           | 遠端尚有舊 schema               | 在 migration 中改為 `DO $$ BEGIN IF NOT EXISTS ... END; $$;` 或先 `repair` 清掉遠端版本               |
| `schema_migrations` 不一致                            | 有人手動改遠端                  | 執行 `supabase migration list --linked` 了解差異 → `repair` → `reset --linked`                        |
| `function_search_path_mutable`                        | 函式缺少 `SET search_path = ''` | 重寫函式並在 migration 中 `DROP ... CASCADE` 後重新建立                                               |
| `auth.uid()` 為 `NULL`                                | 函式在非授權 context 執行       | 以 `current_setting('request.jwt.claim.sub', true)` 取得或改為 `auth.uid()` 包裝在 `SECURITY DEFINER` |

---

使用本指南可以確保所有環境（本機、測試、遠端）保持一致，並讓未來的基線濃縮、reset、或 rollback 可預測。若流程有遺漏，請直接更新此文件。
