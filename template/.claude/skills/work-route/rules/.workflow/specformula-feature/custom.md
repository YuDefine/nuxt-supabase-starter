<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->

# Custom 自訂指令

透過 Cucumber Step Definition 搭配 `isa.yml` 配置擴充 SpecFormula，讓 Linter 能驗證自訂步驟的語法。

## 適用場景

- **DSL 語意封裝**：將多步驟資料準備封裝為一條指令，如「使用者 "SAM" 是一個管理員」
- **第三方服務整合**：Mock 外部 API、存取 Redis、上傳檔案等內建指令未支援的操作
- **重複樣板簡化**：多個 Feature 反覆使用相同的 EntitySetup 組合時，封裝為一條指令

不適合：僅出現一次的步驟、兩三條 EntitySetup 就能達成的操作——直接使用內建指令即可。

## Gherkin 語法

### 無 DataTable

```gherkin
Given "SAM" 是一個管理員
```

### 有 DataTable

```gherkin
Given "SAM" 是一個管理員, with table:
  | role        | department |
  | SUPER_ADMIN | 營運部     |
```

## isa.yml 配置

### 基本結構

```yaml
- name: Admin setup
  format: ^"(?P<alias>[^"]+)" 是一個管理員, with table:$
  instruction_type: custom

  export_vars:
    "{{alias}}.id":
      type: Number
      description: "管理員 ID"
      nullable: false
    "{{alias}}.account":
      type: String
      description: "管理員登入帳號"
      nullable: false

  datatable_parameters:
    role:
      type: String
      required: true
      description: "管理員角色"
      enums: ["SUPER_ADMIN", "EDITOR", "VIEWER"]
    department:
      type: String
      required: false
      description: "所屬部門"
```

### 三層契約

| 層 | 欄位 | 必填 | 職責 |
|----|------|------|------|
| 語法層 | `format` | **REQUIRED** | 正則表達式，識別 step 歸屬並擷取參數 |
| 輸出層 | `export_vars` | OPTIONAL | 宣告執行後導出的 `$var`，供 Linter 驗證後續引用 |
| 輸入層 | `datatable_parameters` | OPTIONAL | 宣告 DataTable 欄位，供 Linter 驗證拼字與型別 |

## export_vars（輸出層）

宣告指令執行後導出的變數，供後續步驟以 `$var` 引用。

### ExportVar Object

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `type` | `string` | **REQUIRED** | `String`、`Number`、`Boolean` |
| `description` | `string` | **REQUIRED** | 變數語義說明 |
| `example` | `scalar` | OPTIONAL | 示例值 |
| `nullable` | `boolean` | OPTIONAL（預設 `false`） | `true` 時允許 null |

### `{{param}}` 插值

Map key 可使用 `{{param}}` 引用 `format` 正則中的具名擷取群組，讓匯出變數名稱隨步驟參數動態生成：

```yaml
export_vars:
  "{{alias}}.id":       # alias 來自 format 的 (?P<alias>...)
    type: Number
    description: "管理員 ID"
```

```gherkin
Given "SAM" 是一個管理員, with table:
  | role        |
  | SUPER_ADMIN |

# alias 擷取到 "SAM"，Linter 知道此 step 導出：
#   $SAM.id      → Number
#   $SAM.account → String

When (UID="$SAM.id") 執行某操作, call table:
  | account      |
  | $SAM.account |
```

## datatable_parameters（輸入層）

宣告 DataTable 接受的欄位，讓 Linter 驗證 header 拼字、型別與必填性。

### DatatableParam Object

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `type` | `string` | **REQUIRED** | `String`、`Number`、`Boolean`、`Time` |
| `description` | `string` | **REQUIRED** | 欄位語義說明 |
| `required` | `boolean` | OPTIONAL（預設 `false`） | `true` 時缺少此欄位觸發 `error` |
| `enums` | `array<scalar>` | OPTIONAL | 枚舉限制，值不在清單內觸發 `error` |

### Linter 驗證行為

```gherkin
Given "SAM" 是一個管理員, with table:
  | role        | department |
  | SUPER_ADMIN | 營運部     |

# Linter 驗證：
#   ✓ role 為必填欄位且值 "SUPER_ADMIN" 在 enums 內
#   ✓ department 為已宣告的選填欄位
#   ✗ 若寫成 deparment（少一個 t）→ error：未宣告的欄位
#   ✗ 若 role 值為 "ADMIN" → error：不在 enums 內
#   ✗ 若省略 role → error：必填欄位缺失
```

## allow_dynamic_parameters

| 值 | 行為 |
|----|------|
| `false`（預設） | DataTable 出現未宣告的 header 時觸發 `error` |
| `true` | Linter 接受任意 header，不報錯 |

適用場景：Step Definition 接受任意鍵值對時（例如商品擴充欄位）。

```yaml
- name: Product setup
  format: ^"(?P<alias>[^"]+)" 是一個商品 "(?P<productCode>[^"]+)", with table:$
  instruction_type: custom
  allow_dynamic_parameters: true    # ← 接受任意 DataTable 欄位

  datatable_parameters:
    name:
      type: String
      required: true
      description: "商品名稱（必填）"
```

```gherkin
Given "Widget" 是一個商品 "WIDGET_01", with table:
  | name   | color | weight |
  | 小元件 | red   | 150    |

# ✓ name 為已宣告的必填欄位
# ✓ color、weight 未宣告，但 allow_dynamic_parameters: true → 不報錯
```

## 錯誤處理

| 階段 | 錯誤 | 說明 |
|------|------|------|
| Lint | 未宣告的欄位 | DataTable header 不在 `datatable_parameters` 中（且 `allow_dynamic_parameters` 為 false） |
| Lint | 必填欄位缺失 | `required: true` 的欄位未出現在 DataTable |
| Lint | 枚舉值不合法 | 值不在 `enums` 清單內 |
| Lint | 變數不存在 | 引用的 `$var` 未被任何 `export_vars` 導出 |
| Lint | 型別不符 | 值與宣告的 `type` 不符 |
