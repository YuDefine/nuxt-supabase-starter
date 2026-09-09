<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/specformula-feature/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->

# EntityValidate 指令

驗證資料庫記錄的存在性與正確性。

ResponseValidate 只驗證 API 回應，無法確認資料是否真正寫入。EntityValidate 直接查資料庫確保持久化正確。

## 撰寫 SOP

### Step 1：確認要驗證的 Entity

確認要驗證的是哪個 Table 或 Entity Name，然後查找相關檔案：

- `entity_to_table_mapping.yml` → 找到 entity 名稱與對應的資料表
- 對應的 DDL（`*.sql`）→ 確認欄位定義與約束

檔案路徑由 `isa.yml` 的 `config.data.source[].resource_path` 決定。

### Step 2：撰寫 Step 語句

根據 `isa.yml` 中 `instruction_type: entity_validate` 的 `format` 撰寫語句：

```gherkin
Then 應該存在一個待辦事項, with table:
```

### Step 3：撰寫 DataTable

根據 DDL 欄位填入要驗證的值。

```gherkin
Then 應該存在一個待辦事項, with table:
  | todoId    | userId    | title  | completed | createdAt                        |
  | $todo1.id | $Alice.id | 買牛奶 | false     | &sameTime("2026-01-27T10:00:00") |
```

撰寫時判斷：

- 需要使用時間？→ TIME `@time()` `@date()` `@localtime()`（讀取 `time.md`）
- 需要使用其他 Step 產生的變數？→ VAR `$` `${}`（讀取 `var.md`）
- 需要使用約束驗證？→ CAS `&constraint`（讀取 `cas.md`）

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
| 執行 | 記錄不存在 | 查詢結果為空 |
| 執行 | 欄位值不匹配 | 欄位值與預期不符 |
| 執行 | 多筆結果 | Probe 回傳多筆且無法篩選唯一 |
