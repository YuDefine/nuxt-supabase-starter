<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/specformula-config/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->

# Custom 自訂指令配置

在 `isa.yml` 的 `instructions[]` 中，為 `instruction_type: custom` 的指令補充 `export_vars`（輸出契約）與 `datatable_parameters`（輸入契約），使 Linter 能對自訂 step 執行與內建指令同等級的靜態驗證。

自訂指令的 Gherkin 撰寫語法請參考 `specformula-feature` Skill 的 `custom.md`。

## 撰寫 SOP

### Step 1：定義語法層

在 `isa.yml` 的 `instructions[]` 新增一條 `instruction_type: custom` 指令，填寫 `name` 與 `format`：

```yaml
instructions:
  - name: Member setup
    format: ^"(?P<alias>[^"]+)" 是一個讀者帳號, with table:$
    instruction_type: custom
```

`format` 使用 `(?P<name>...)` 具名擷取群組解析步驟參數，擷取出的值可在 `export_vars` key 中以 `{{name}}` 插值引用。

### Step 2：定義輸出層（export_vars）

宣告此 step 執行後導出哪些 `$var`，讓 Linter 能驗證後續步驟的引用合法性與型別。

```yaml
    export_vars:
      "{{alias}}.id":
        type: Number
        description: "讀者 ID (tb_members.member_id)"
        example: 1001
        nullable: false
      "{{alias}}.loginAccount":
        type: String
        description: "讀者登入帳號"
        example: "wang.m"
        nullable: false
```

若此 step 不導出任何變數，可省略 `export_vars`。

### Step 3：定義輸入層（datatable_parameters）

宣告 DataTable 接受哪些欄位，讓 Linter 能驗證 header 拼字、型別、必填性與枚舉值。

```yaml
    datatable_parameters:
      memberType:
        type: String
        required: true
        description: "讀者類型"
        enums: ["REGULAR", "YOUTH_READER", "SENIOR", "STAFF"]
      memberStatus:
        type: String
        required: false
        description: "帳號狀態"
        enums: ["ACTIVE", "SUSPENDED", "EXPIRED"]
      branchCode:
        type: String
        required: false
        description: "所屬分館代碼"
```

若此 step 無 DataTable，可省略 `datatable_parameters`。

## Schema Reference

### Instruction Object（custom 指令完整欄位）

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `name` | `string` | **REQUIRED** | 指令唯一識別名，用於錯誤訊息；同一 `isa.yml` 內不得重複 |
| `format` | `string (regex)` | **REQUIRED** | 匹配 Gherkin Step 的正則表達式，以 `(?P<name>...)` 擷取步驟參數 |
| `instruction_type` | `"custom"` | **REQUIRED** | 固定為 `custom` |
| `export_vars` | `map<string, ExportVar>` | OPTIONAL | 宣告執行後導出的 `$var`。Map key 為變數名樣式，可含 `{{param}}` 插值 |
| `datatable_parameters` | `map<string, DatatableParam>` | OPTIONAL | 宣告 DataTable 欄位 Schema |
| `allow_dynamic_parameters` | `boolean` | OPTIONAL（預設 `false`） | `true` 時 Linter 接受任意未宣告的 header |

### ExportVar Object

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `type` | `string` | **REQUIRED** | 允許值：`String`、`Number`、`Boolean` |
| `description` | `string` | **REQUIRED** | 變數語義說明，顯示於 IDE hover |
| `example` | `scalar` | OPTIONAL | 示例值（number / string / boolean） |
| `nullable` | `boolean` | OPTIONAL（預設 `false`） | `true` 時允許 null/空值 |

### DatatableParam Object

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `type` | `string` | **REQUIRED** | 允許值：`String`、`Number`、`Boolean`、`Time` |
| `description` | `string` | **REQUIRED** | 欄位語義說明，顯示於 IDE hover |
| `required` | `boolean` | OPTIONAL（預設 `false`） | `true` 時 DataTable 缺少此欄位觸發 `error` |
| `enums` | `array<scalar>` | OPTIONAL | 枚舉限制；值不在清單內觸發 `error` |

### 型別說明

| type | 接受值 |
|------|--------|
| `String` | 任意字串 |
| `Number` | 整數與帶小數 |
| `Boolean` | `true` / `false` |
| `Time` | `@time()` `@date()` `@localtime()` |

## 欄位缺失影響

| 缺失欄位 | 影響 |
|----------|------|
| `export_vars` | Linter 不驗證 `$var` 引用合法性，錯誤延遲至執行期；IDE 無法提供 `$var` 補全 |
| `export_vars[].type` | 僅驗證 `$var` 存在性，無法驗證型別合法性 |
| `datatable_parameters` | 任意 header 視為合法，拼字錯誤與型別誤用在 lint-time 無法攔截 |
| `datatable_parameters[].required` | 必填欄位未宣告時，handler 可能以預設值靜默通過導致 false positive |

## 完整範例

```yaml
instructions:
  # --- 內建指令（不受影響）---
  - name: Time control
    format: ^現在的時間是 "(?P<time>.+)"$
    instruction_type: time_control

  - name: Data preparation
    format: ^準備一個(?P<entity>[\u4e00-\u9fffa-zA-Z0-9_]+), with table:$
    instruction_type: entity_setup

  # --- 自訂指令 ---

  # 讀者帳號（固定欄位）
  - name: Member setup
    format: >-
      ^"(?P<alias>[^"]+)" 是一個讀者帳號, with table:$
    instruction_type: custom

    export_vars:
      "{{alias}}.id":
        type: Number
        description: "讀者 ID (tb_members.member_id)"
        example: 1001
        nullable: false
      "{{alias}}.loginAccount":
        type: String
        description: "讀者登入帳號"
        example: "wang.m"
        nullable: false

    datatable_parameters:
      memberType:
        type: String
        required: true
        description: "讀者類型"
        enums: ["REGULAR", "YOUTH_READER", "SENIOR", "STAFF"]
      memberStatus:
        type: String
        required: false
        description: "帳號狀態"
        enums: ["ACTIVE", "SUSPENDED", "EXPIRED"]
      branchCode:
        type: String
        required: false
        description: "所屬分館代碼"

  # 書目（含動態擴展欄位）
  - name: Book setup with table
    format: >-
      ^"(?P<alias>[^"]+)" 是一個書目 "(?P<bookCode>[^"]+)", with table:$
    instruction_type: custom
    allow_dynamic_parameters: true

    export_vars:
      "{{alias}}.id":
        type: Number
        description: "書目 ID (tb_books.book_id)"
        example: 20001
        nullable: false
      "{{alias}}.bookCode":
        type: String
        description: "書目代碼"
        example: "ASTRO_101"
        nullable: false

    datatable_parameters:
      callNumber:
        type: String
        required: true
        description: "杜威十進位索書號，用於書架定位"
      publicationYear:
        type: Number
        required: false
        description: "出版年份"
      summary:
        type: String
        required: false
        description: "內容簡介"
      branchCodes:
        type: String
        required: false
        description: "館藏分館代碼，多值以逗號分隔（寫入 tb_book_branch_relations）"
```
