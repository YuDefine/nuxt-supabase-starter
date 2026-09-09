---
name: specformula-config
description: 當要配置 SpecFormula 框架到專案內、修改 API Spec 存放路徑、或修改 Data Source 設定時載入此規格
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/specformula-config/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->

# SpecFormula isa.yml 設定檔指南

`isa.yml` 是 SpecFormula 測試框架的配置檔，定義 API Spec、Entity Spec 路徑和指令映射。

## 安裝

依專案語言選擇對應的安裝指南：

- Java → 讀取 `java.md`

## 專案結構

```
src/test/resources/
├── isa.yml                              # ISA 設定檔
├── specs/
│   ├── api/
│   │   └── api-spec.yml                 # API Spec（OpenAPI 3.0）
│   └── data/
│       ├── schema.sql                   # DDL 定義
│       └── entity_to_table_mapping.yml  # Entity 對應表
└── features/
    └── *.feature                        # Gherkin 測試檔
```

## 完整範例

```yaml
config:
  api:
    resource_path: specs/api
    project_path: my-project/src/test/resources/specs/api
    time_format: iso
  data:
    permission: isolated
    reuse: false
    source:
      - name: default
        resource_path: specs/data
        project_path: my-project/src/test/resources/specs/data
        db_type: postgresql

instructions:
  - name: Time control
    format: ^現在的時間是 "(?P<time>.+)"$
    instruction_type: time_control

  - name: Data preparation
    format: ^準備一個(?P<entity>[\u4e00-\u9fffa-zA-Z0-9_]+), with table:$
    instruction_type: entity_setup

  - name: API call
    format: ^\((?:No Actor|UID="(?P<userId>\$[\w.]+)")\) (?P<summary>.+?), call table:$
    instruction_type: api_call

  - name: Response validation
    format: ^(?P<summary>.+?)\((?P<status_code>\d{3})\)回應,?\s*with table:$
    instruction_type: response_validate
    data_format: data_table

  - name: Response validation (JSON)
    format: ^(?P<summary>.+?)\((?P<status_code>\d{3})\)回應為,?\s*with JSON:$
    instruction_type: response_validate
    data_format: json

  - name: Database validation
    format: ^應該存在一個(?P<entity>[\u4e00-\u9fffa-zA-Z0-9_]+), with table:$
    instruction_type: entity_validate

  - name: Database non-existence validation
    format: ^應該不存在一個(?P<entity>[\u4e00-\u9fffa-zA-Z0-9_]+), with table:$
    instruction_type: entity_non_existence_validate
```

## API 配置 (`config.api`)

| 欄位 | 說明 | 預設值 |
|------|------|--------|
| `resource_path` | API Spec 的 classpath 路徑（框架讀取用，必填） | — |
| `project_path` | API Spec 的原始碼路徑（Lint 報錯用，必填） | — |
| `time_format` | 時間表達式的輸出格式 | `iso` |

### 時間格式選項

| 值 | 輸出範例 |
|----|----------|
| `iso`（預設） | `"2025-12-25T14:30:00+08:00"` |
| `timestamp` | `1766735400000`（Unix 毫秒） |
| `epoch` | `1766735400`（Unix 秒） |
| `date_only` | `"2025-12-25"` |
| `time_only` | `"14:30:00"` |

## 資料庫配置 (`config.data`)

| 欄位 | 說明 | 預設值 |
|------|------|--------|
| `permission` | 資料源權限隔離模式 | `isolated` |
| `reuse` | 是否重用 Testcontainer | `false` |
| `source` | 資料源列表 | — |

- `isolated`：各 DataSource 權限隔離，無法互相存取
- `shared`：各 DataSource 權限共通，可互相存取

### Data Source 欄位

| 欄位 | 說明 | 預設值 |
|------|------|--------|
| `name` | 資料源名稱（必填） | — |
| `resource_path` | DDL/mapping 的 classpath 路徑（必填） | — |
| `project_path` | DDL/mapping 的原始碼路徑（必填） | — |
| `db_type` | 資料庫類型 | `embedded` |

支援的 `db_type`：`embedded`、`postgresql`、`mysql`、`mssql`。`embedded` 為「框架選實作」抽象代名，各語言實作自行決定 runtime backend。

### 多資料源範例

```yaml
config:
  data:
    permission: isolated
    source:
      - name: primary
        resource_path: specs/data/primary
        project_path: src/test/resources/specs/data/primary
        db_type: postgresql
      - name: analytics
        resource_path: specs/data/analytics
        project_path: src/test/resources/specs/data/analytics
        db_type: mysql
```

## 指令映射 (`instructions[]`)

每條指令透過正則表達式匹配 Gherkin Step，將其對應到 ISA 指令類型。使用 `(?P<name>...)` 語法擷取參數。

| 欄位 | 說明 |
|------|------|
| `name` | 指令名稱（用於識別與錯誤訊息） |
| `format` | 正則表達式，匹配 Gherkin Step |
| `instruction_type` | ISA 指令類型 |
| `data_format` | 資料格式：`data_table`（預設）、`json` |

### 指令類型

| instruction_type | 說明 |
|------------------|------|
| `time_control` | 控制 Mock 時間 |
| `entity_setup` | 準備測試資料 |
| `api_call` | 執行 API 請求 |
| `response_validate` | 驗證 API 回應 |
| `entity_validate` | 驗證記錄存在 |
| `entity_non_existence_validate` | 驗證記錄不存在 |
| `custom` | 自訂 Step Definition |

各指令的詳細用法請參考 `specformula-feature` Skill。

## 自訂指令

當需要整合第三方 API、或封裝其他自訂流程為 Gherkin Step 時，可使用 `instruction_type: custom` 定義自訂指令。配置方式讀取 `custom-instruction.md`。
