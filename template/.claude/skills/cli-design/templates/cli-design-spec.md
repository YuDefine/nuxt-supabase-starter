# {{CLI_NAME}} 命令介面規格

## 範圍

- 用途：{{CLI_PURPOSE}}
- 使用者：{{AUDIENCE}}
- 規模：{{SCALE}}（{{SCALE_EVIDENCE}}）
- 實作：{{IMPLEMENTATION_LANGUAGE}}，解析器 {{ARG_PARSER}}
- 本次範圍：{{CHANGE_SCOPE}}

## 命令樹

<!-- 依判準 A1 固定一種層級順序；動詞只用 A2 的標準動詞或具體動作動詞。 -->

```text
{{COMMAND_TREE}}
```

## 共通旗標

| 旗標 | 意義 | 適用命令 | 對應判準 |
| --- | --- | --- | --- |
| `{{FLAG_NAME}}` | {{FLAG_MEANING}} | {{FLAG_SCOPE}} | {{FLAG_CRITERIA}} |

## 輸出契約

- 分流：{{STREAM_POLICY}}
- JSON 形狀：

```json
{{JSON_OUTPUT_EXAMPLE}}
```

- 空結果：{{EMPTY_RESULT_SHAPE}}
- 分頁與截斷：{{PAGINATION_POLICY}}
- 排版：{{JSON_LAYOUT_POLICY}}
- 色碼：{{COLOR_POLICY}}

## 錯誤與退出碼

| 退出碼 | 意義 | 範例情境 |
| --- | --- | --- |
| `{{EXIT_CODE}}` | {{EXIT_MEANING}} | {{EXIT_EXAMPLE}} |

- 人類可讀錯誤：

```text
{{HUMAN_ERROR_EXAMPLE}}
```

- `--json` 錯誤：

```json
{{JSON_ERROR_EXAMPLE}}
```

## 非互動行為

- 判定條件：{{NON_INTERACTIVE_DETECTION}}

| prompt | 預設值 | 非互動時 | 事先給值的方式 |
| --- | --- | --- | --- |
| {{PROMPT_NAME}} | {{PROMPT_DEFAULT}} | {{PROMPT_NON_INTERACTIVE}} | {{PROMPT_FLAG_OR_ENV}} |

## 破壞性操作

| 命令 | 確認方式 | 預演 | 冪等語意 | 完成輸出 |
| --- | --- | --- | --- | --- |
| `{{DESTRUCTIVE_COMMAND}}` | {{CONFIRMATION_POLICY}} | {{PREVIEW_POLICY}} | {{IDEMPOTENCY_POLICY}} | {{COMPLETION_OUTPUT}} |

## 可發現性

- help 結構：{{HELP_STRUCTURE}}
- 根 help 第一屏：{{ROOT_HELP_FIRST_SCREEN}}
- 命令搜尋：{{COMMAND_SEARCH}}
- 版本：{{VERSION_OUTPUT}}
- AGENTS.md 建議句：{{AGENTS_MD_LINE}}

## 認證與設定

- 認證：{{AUTH_POLICY}}
- 設定優先序：{{CONFIG_PRECEDENCE}}
- 多帳號或多環境：{{MULTI_ACCOUNT_POLICY}}
- secret 處理：{{SECRET_POLICY}}

## 一致性治理

- 機械檢查：{{CONSISTENCY_CHECK}}
- 棄用政策：{{DEPRECATION_POLICY}}

## 判準對照

<!-- 判準檔每個 ID 一列；適用的寫怎麼滿足，不適用的寫 N/A 與對應 Rule 1 的理由。 -->

| ID | 如何滿足／N/A 理由 |
| --- | --- |
| {{CRITERION_ID}} | {{CRITERION_RESOLUTION}} |

## 未決事項

- {{OPEN_QUESTION}}
