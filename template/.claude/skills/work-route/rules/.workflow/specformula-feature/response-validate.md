<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->

# ResponseValidate 指令

驗證 HTTP API 回應的狀態碼與內容。

## 撰寫 SOP

### Step 1：確認目標 API

確認要驗證的 API，然後查找相關檔案：

- API Spec（`api-spec.yml`）→ 找到對應的 `summary`、HTTP Status Code、Response Schema

不同狀態碼有不同的 Response Schema（如 `201` 的成功回應與 `400` 的錯誤回應欄位不同），需根據預期狀態碼查找對應的 Schema。

檔案路徑由 `isa.yml` 的 `config.api.resource_path` 決定。

### Step 2：撰寫 Step 語句

根據 `isa.yml` 中 `instruction_type: response_validate` 的 `format` 撰寫語句：

```gherkin
# DataTable 格式
Then 新增待辦事項(201)回應, with table:

# JSON 格式
Then 查詢待辦事項(200)回應為, with JSON:
```

### Step 3：撰寫 DataTable

根據 API Spec 中**對應狀態碼**的 Response Schema 填入要驗證的欄位。

```gherkin
# 成功回應：欄位來自 responses."201" 的 Schema
Then 新增待辦事項(201)回應, with table:
  | >todo1.id | userId    | title  | completed |
  | <todoId   | $Alice.id | 買牛奶 | false     |

# 錯誤回應：欄位來自 responses."400" 的 Schema
Then 新增待辦事項(400)回應, with table:
  | error        |
  | 標題不可為空 |
```

撰寫時判斷：

- 需要使用時間？→ TIME `@time()` `@date()` `@localtime()`（讀取 `time.md`）
- 需要使用其他 Step 產生的變數？→ VAR `$` `${}`（讀取 `var.md`）
- 有需要傳遞給其他 Step 的變數？→ VAR `>` `<`（讀取 `var.md`），可用的 `<` key 為 Response Schema 欄位，支援 JSON Path 格式（如 `<data.items[0].id`）
- 需要使用約束驗證？→ CAS `&constraint`（讀取 `cas.md`）

### 巢狀路徑

支援 dot notation 和陣列索引：

```gherkin
Then 查詢訂單(200)回應, with table:
  | data.order.id | data.items[0].name | data.items[1].name |
  | $order1.id    | 商品A              | 商品B              |
```

### JSON 格式注意事項

符號表達式（`$` `&` `@`）**不可放在 JSON 字串引號 `""` 內**：

```gherkin
# ✅ 正確
"""
{ "userId": $userId, "id": &isNum }
"""

# ❌ 錯誤
"""
{ "userId": "$userId", "id": "&isNum" }
"""
```

## 錯誤處理

| 階段 | 錯誤 | 說明 |
|------|------|------|
| Lint | 欄位不存在 | 欄位在 Response Schema 找不到 |
| Lint | 擷取欄位不存在 | `<` 指定的欄位在 Response Schema 找不到 |
| 執行 | 狀態碼不匹配 | 實際狀態碼與預期不符 |
| 執行 | 欄位值不匹配 | 欄位值與預期不一致 |
| 執行 | JSON 結構不匹配 | 陣列長度、物件欄位不符 |
