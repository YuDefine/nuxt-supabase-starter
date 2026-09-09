<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/specformula-feature/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->

# EntityNonExistenceValidate 指令

驗證資料庫記錄的不存在性（常用於刪除操作後）。

## 撰寫 SOP

### Step 1：確認要驗證的 Entity

確認要驗證不存在的是哪個 Table 或 Entity Name，然後查找相關檔案：

- `entity_to_table_mapping.yml` → 找到 entity 名稱與對應的資料表
- 對應的 DDL（`*.sql`）→ 確認欄位定義與約束

檔案路徑由 `isa.yml` 的 `config.data.source[].resource_path` 決定。

### Step 2：撰寫 Step 語句

根據 `isa.yml` 中 `instruction_type: entity_non_existence_validate` 的 `format` 撰寫語句：

```gherkin
Then 應該不存在一個待辦事項, with table:
```

### Step 3：撰寫 DataTable

提供足夠的欄位作為查詢條件，驗證查詢結果為空。

PK 查詢：

```gherkin
Then 應該不存在一個待辦事項, with table:
  | todoId    |
  | $todo1.id |
```

條件搜尋（無 PK）：

```gherkin
Then 應該不存在一個待辦事項, with table:
  | userId    | title  |
  | $Alice.id | 買牛奶 |
```

撰寫時判斷：

- 需要使用其他 Step 產生的變數？→ VAR `$` `${}`（讀取 `var.md`）

> 此指令不支援 CAS 約束（`&`）、TIME 符號（`@`）、VAR 擷取（`>` `<`）。

### 欄位名稱轉換

DataTable 使用 camelCase，自動對應資料庫的 snake_case：

```
Gherkin: userId    → DB: user_id
Gherkin: createdAt → DB: created_at
```

## 錯誤處理

| 階段 | 錯誤 | 說明 |
|------|------|------|
| Lint | Entity 未定義 | `entity_to_table_mapping` 找不到 |
| Lint | 欄位不存在 | 欄位在 DDL 找不到 |
| Lint | 不支援的符號 | 使用了 CAS 或 VAR 擷取語法 |
| 執行 | 記錄仍然存在 | 預期不存在的記錄實際存在 |
| 執行 | 缺少查詢條件 | 未提供任何欄位作為查詢條件 |
