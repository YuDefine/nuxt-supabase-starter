<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->

# EntitySetup 指令

以宣告式語法準備測試資料（INSERT 到資料庫）。

## 撰寫 SOP

### Step 1：確認目標 Entity

確認要準備的是哪個 Table 或 Entity Name，然後查找相關檔案：

- `entity_to_table_mapping.yml` → 找到 entity 名稱與對應的資料表
- 對應的 DDL（`*.sql`）→ 確認欄位定義與約束

檔案路徑由 `isa.yml` 的 `config.data.source[].resource_path` 決定。

### Step 2：撰寫 Step 語句

根據 `isa.yml` 中 `instruction_type: entity_setup` 的 `format` 撰寫語句：

```gherkin
Given 準備一個使用者, with table:
```

### Step 3：撰寫 DataTable

根據 DDL 填入所有必填欄位，忽略自動生成欄位（如 auto-increment ID），並根據測試情境帶入值。

```gherkin
Given 準備一個使用者, with table:
  | >Alice.id | name  | email             | status |
  | <userId   | Alice | alice@example.com | ACTIVE |
```

撰寫 DataTable 時判斷：

- 需要使用時間？→ TIME `@time()` `@date()` `@localtime()`（讀取 `time.md`）
- 需要使用其他 Step 產生的變數？→ VAR `$` `${}`（讀取 `var.md`）
- 有需要傳遞給其他 Step 的變數？→ VAR `>` `<`（讀取 `var.md`），可用的 `<` key 為 DDL 中的所有欄位

### 欄位名稱轉換

DataTable 使用 camelCase，自動對應資料庫的 snake_case：

```
Gherkin: userId    → DB: user_id
Gherkin: createdAt → DB: created_at
```

### 型別轉換

框架根據 DDL 欄位型別自動轉換：

| DDL 型別 | DataTable 輸入 | 轉換結果 |
|----------|---------------|----------|
| `INT` / `BIGINT` | `"123"` | Integer / Long |
| `DECIMAL` | `"99.99"` | BigDecimal |
| `DATE` | `"2026-01-27"` | LocalDate |
| `DATETIME` / `TIMESTAMP` | `"2026-01-27T10:00:00"` | LocalDateTime |
| `DATETIME` / `TIMESTAMP` | `@time("now")` | 當前 Mock 時間 |
| `DATE` | `@date("now")` | 當前 Mock 日期 |

## 錯誤處理

| 階段 | 錯誤 | 說明 |
|------|------|------|
| Lint | Entity 未定義 | `entity_to_table_mapping` 找不到 |
| Lint | 欄位不存在 | 欄位在 DDL 找不到 |
| 執行 | INSERT 失敗 | 資料庫約束違反（唯一鍵、NOT NULL 等） |
