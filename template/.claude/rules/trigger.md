<!--
🔒 LOCKED — managed by clade
Source: rules/modules/db-schema/supabase/trigger.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Postgres Trigger 撰寫規範
globs: ['supabase/migrations/**/*.sql']
---

# Trigger

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。

新增 trigger 前先問：**真的需要 trigger 嗎？**

- **MUST** 優先考慮在 server API handler 處理業務邏輯
- **MUST** 只在以下情境用 trigger：
  - 跨 table 資料同步（denormalization、cache）
  - `updated_at` 自動更新（標準模式）
  - 必須在 DB 層保證的 invariant
- **NEVER** 在 trigger 裡寫複雜業務邏輯（多表查詢、對外通知、複雜驗證）— 放 API handler

## 命名規約

- **Prefix 按用途**：`trg_<table>_<event>_<purpose>`（如 `trg_posts_before_insert_set_slug`）
- **`updated_at` 統一命名**：`set_<table>_updated_at` + 對應 function `public.set_updated_at()`
- **有順序依賴時**：用 `a_` / `b_` / `c_` 前綴明確表達執行順序（`a_set_context` 在 `b_audit_log` 之前，字母序）

## 核心陷阱

- **同一事件多個 trigger 按名稱字母序執行** — 命名時注意順序依賴
- **`FOR EACH ROW` 在大量操作時效能差** — 批量操作考慮 `FOR EACH STATEMENT` + `transition tables`
- **Trigger function 中的 `RAISE EXCEPTION` 會 rollback 整個呼叫端 transaction** — 謹慎使用，寫清楚 error message
- **受限 schema 中的 trigger 無法直接 DROP** — 要 drop 其依賴的 function 並加 `CASCADE`
- **Trigger function MUST `SET search_path = ''`** — 防止 search_path injection
- **`SECURITY DEFINER` trigger function 需特別小心** — function 內做的操作會以 owner 權限執行，bypass RLS

## 檢查多 trigger 執行順序

```sql
select tgname, tgrelid::regclass, tgtype
from pg_trigger
where tgrelid = 'public.<table>'::regclass
  and not tgisinternal
order by tgname;  -- 實際執行順序
```

## 標準 Template：`updated_at`

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_<table>_updated_at
  before update on public.<table>
  for each row
  execute function public.set_updated_at();
```

## 通用 Template：業務 trigger

```sql
create or replace function public.<function_name>()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 業務邏輯
  return new;  -- BEFORE / INSTEAD OF
  -- or: return null;  -- AFTER（回傳值會被忽略）
end;
$$;

comment on function public.<function_name>() is '<中文描述>';

create trigger trg_<table>_<event>_<purpose>
  after insert or update on public.<table>
  for each row
  execute function public.<function_name>();
```
