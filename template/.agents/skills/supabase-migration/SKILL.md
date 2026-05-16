---
name: supabase-migration
description: >-
  Supabase Migration 規範。Use when running supabase migration new,
  editing migration SQL files, creating database functions, or
  modifying database schema. Always use this skill when you see
  CREATE FUNCTION, ALTER TABLE, CREATE INDEX, or migration-related work.
---

# Supabase Migration 規範

Migration 核心規則已定義在 AGENTS.md（Local-First、MCP 禁止 DDL、search_path、不可變原則）。
本 skill 補充 AGENTS.md 未涵蓋的實作細節。

## MCP 禁止執行 DDL

**禁止使用以下 MCP 工具執行 DDL（CREATE / ALTER / DROP）：**

- `mcp__remote-supabase__apply_migration`
- `mcp__remote-supabase__execute_sql`

**原因：** MCP 使用 `supabase_admin` role 連線，透過它建立的 table/index/function 的 owner 是 `supabase_admin` 而非 `postgres`。當 CI/CD 用 migration 檔案部署時，`postgres` role 無法修改這些物件，導致部署失敗。

**正確做法：**

- 所有 DDL 透過 `supabase migration new` 建立 migration 檔案
- 透過 CI/CD pipeline 部署（owner = `postgres`）
- Remote MCP **只能用於**：SELECT 查詢、除錯、檢查 table owner

## View 安全設定

所有 view 需設定 security_invoker：

```sql
CREATE OR REPLACE VIEW your_schema.my_view
WITH (security_invoker = true)
AS SELECT ...;
```

**原因：** Postgres 的 view 預設 bypass RLS（以 view owner 的權限執行）。不加 `security_invoker = true` 等於 RLS 對 view 無效。

## SECURITY DEFINER 函式位置

**NEVER** 將 SECURITY DEFINER 函式放在 exposed schema（`public`）：

```sql
-- ❌ public schema — 透過 Data API 可直接呼叫，繞過所有存取控制
CREATE FUNCTION public.dangerous_func() ... SECURITY DEFINER ...;

-- ✅ private schema + 明確 GRANT
CREATE FUNCTION your_schema.safe_func() ... SECURITY DEFINER SET search_path = '' ...;
GRANT EXECUTE ON FUNCTION your_schema.safe_func TO authenticated;
```

若需要透過 PostgREST（Data API）呼叫，在 `public` 建立 thin wrapper（SECURITY INVOKER）呼叫 private schema 的實作。

## 開發流程

```bash
supabase migration new <description>    # 建立 migration
# 編輯 SQL（保持單一主題）
supabase db reset                       # 套用到本機
supabase db lint --level warning        # 安全檢查
supabase db advisors                    # Schema 建議（CLI v2.81.3+，涵蓋 index/security/performance）
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null
pnpm typecheck                          # 類型檢查
```

> `supabase db advisors` 需 CLI v2.81.3+。若版本不足，可用 MCP `get_advisors` 替代。

## Schema 規範

### Schema 邊界

- **core / auth**: 授權相關（user_roles、allowed_emails、user_preferences）
- **app / 專案名稱**: 業務資料表
- **public**: 不存放業務資料，僅作 RPC 入口薄 wrapper

### 命名規則

- 表名：snake_case 複數（tool_inserts）
- 欄位：snake_case（created_at）
- 函式：snake_case（get_user_role）
- Enum：snake_case（user_role）

## Sequence 同步

當使用 INSERT 直接指定 ID 匯入資料時，sequence 不會自動更新：

```sql
SELECT setval(
  'your_schema.table_name_id_seq',
  (SELECT COALESCE(MAX(id), 0) + 1 FROM your_schema.table_name),
  false
);
```

## 參考資料

| 檔案                                                               | 內容                  |
| ------------------------------------------------------------------ | --------------------- |
| [references/function-template.md](references/function-template.md) | DB 函式模板           |
| [references/troubleshooting.md](references/troubleshooting.md)     | 疑難排解 + Owner 修復 |

## 檢查清單

- [ ] 使用 `supabase migration new` 建立（遵循 AGENTS.md）
- [ ] 所有函式有 `SET search_path = ''`（遵循 AGENTS.md）
- [ ] **SECURITY DEFINER 函式不在 `public` schema**（放 private schema + GRANT）
- [ ] 所有 View 有 `security_invoker = true`
- [ ] 表格/函式引用使用 schema 前綴
- [ ] `supabase db reset` + `db lint` + `db advisors` + `pnpm typecheck` 通過
- [ ] RLS 已設定（如適用）
