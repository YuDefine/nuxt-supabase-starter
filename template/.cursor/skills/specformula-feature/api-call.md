<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/specformula-feature/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->

# ApiCall 指令

以宣告式語法執行 HTTP API 請求。

## 撰寫 SOP

### Step 1：確認目標 API

確認要呼叫的 API，然後查找相關檔案：

- API Spec（`api-spec.yml`）→ 找到對應的 `summary`、HTTP Method、URL Path、Request/Response Schema

檔案路徑由 `isa.yml` 的 `config.api.resource_path` 決定。

| Gherkin 元素 | API Spec 來源 |
|-------------|---------------|
| `新增待辦事項`（summary） | `paths.*.*.summary`（必須唯一） |
| HTTP Method | 從 path 定義推斷 |
| URL Path | `paths` 的 key |
| Body 欄位 | `requestBody.content.*.schema.properties` |
| Path 參數 | `parameters[].in: path` |
| Query 參數 | `parameters[].in: query` |
| Response 欄位 | `responses.*.content.*.schema.properties` |

### Step 2：撰寫 Step 語句

根據 `isa.yml` 中 `instruction_type: api_call` 的 `format` 撰寫語句：

```gherkin
# 使用變數作為 Bearer Token
When (UID="$Alice.id") 新增待辦事項, call table:

# 無需身份驗證
When (No Actor) 健康檢查, call table:
```

### Step 3：撰寫 DataTable

根據 API Spec 的 Request Schema 填入必填欄位，並根據測試情境帶入值。

```gherkin
When (UID="$Alice.id") 新增待辦事項, call table:
  | >todo1.id | title  | description |
  | <todoId   | 買牛奶 | 去全聯買    |
```

撰寫 DataTable 時判斷：

- 需要使用時間？→ TIME `@time()` `@date()` `@localtime()`（讀取 `time.md`）
- 需要使用其他 Step 產生的變數？→ VAR `$` `${}`（讀取 `var.md`）
- 有需要傳遞給其他 Step 的變數？→ VAR `>` `<`（讀取 `var.md`），可用的 `<` key 為 Response Schema 欄位，支援 JSON Path 格式（如 `<data.items[0].id`）

### 欄位前綴

| 前綴 | 用途 | 範例 |
|------|------|------|
| （無） | Request Body；若同名參數存在會自動帶入 Path/Query/Header | `title` |
| `P:` | Path 參數 | `P:todoId` → `{todoId}` |
| `Q:` | Query 參數 | `Q:page` → `?page=value` |
| `H:` | HTTP Header | `H:X-Trace-Id` |
| `>` | 存入變數（header）| `>todo1.id` |
| `<` | 取自回應（data） | `<todoId` |

### 巢狀 JSON 建構

支援 dot notation 和陣列索引：

```gherkin
| name   | config.theme | tags[0] | tags[1] |
| 我的專案 | dark        | work    | urgent  |
```

產生：`{ "name": "我的專案", "config": { "theme": "dark" }, "tags": ["work", "urgent"] }`

### 時間格式

ApiCall 中的時間值根據 `isa.yml` 的 `time_format` 自動轉換：

| 格式 | 輸出範例 |
|------|----------|
| `iso`（預設） | `"2025-12-25T14:30:00+08:00"` |
| `timestamp` | `1766735400000`（毫秒） |
| `epoch` | `1766735400`（秒） |
| `date_only` | `"2025-12-25"` |
| `time_only` | `"14:30:00"` |

## 錯誤處理

| 階段 | 錯誤 | 說明 |
|------|------|------|
| Lint | 欄位不存在 | DataTable 欄位在 API Spec 找不到 |
| Lint | 缺少必填欄位 | `required` 參數未提供 |
| Lint | 擷取欄位不存在 | `<` 指定的回應欄位在 Response Schema 找不到 |
| 執行 | API not found | summary 在 API Spec 找不到 |
| 執行 | 重複的 summary | 多個操作使用相同 summary |
