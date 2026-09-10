<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->

# VAR-System — 變數擷取與引用

讓你在測試步驟間傳遞動態產生的值（如 auto-increment ID、API Token）。

## 四種語法

| 語法 | 名稱 | 位置 | 用途 |
|------|------|------|------|
| `>contextKey` | Context Key | DataTable 標頭 | 定義變數名稱 |
| `<executionKey` | Execution Key | DataTable 資料 | 指定擷取的欄位 |
| `$variable` | Variable Reference | 任何值的位置 | 引用變數（保留型別） |
| `${variable}` | String Interpolation | 字串中 | 嵌入變數（轉為字串） |

## 擷取變數

`>` 和 `<` 必須在同一欄配對：header 放變數名（`>`），data row 放來源欄位（`<`）。

```gherkin
When 創建使用者, call table:
  | >userId | >userToken | name  | email             |
  | <id     | <token     | Alice | alice@example.com |
```

執行後：
- `userId` = 回應中的 `id` 欄位值
- `userToken` = 回應中的 `token` 欄位值

## 引用變數

### `$variable`（型別保留）

```gherkin
| id      | name  |
| $userId | Alice |
```

`$userId` 保留原始型別（Integer、String 等）。

### `${variable}`（轉為字串）

```gherkin
| ids                     |
| ${user1.id},${user2.id} |
```

適合組合多個變數為字串。

## `$var` vs `${var}` 對比

| 面向 | `$variable` | `${variable}` |
|------|-------------|---------------|
| 使用場景 | 整個值即為變數 | 嵌入字串中 |
| 型別 | 保留原始型別 | 轉為 String |
| 多變數組合 | 不支援 | 支援 |
| 範例 | `$userId` → `12345` | `"ID: ${userId}"` → `"ID: 12345"` |

## 巢狀路徑

支援 dot notation 和陣列索引：

```gherkin
# 物件巢狀
| >orderId           |
| <order.details.id  |

# 陣列索引
| >firstItem     |
| <items[0].name |
```

## 配對規則

```
Header:  | >contextKey | normalField | >anotherKey |
Data:    | <fieldName  | normalData  | <otherField |
         ↑ 配對         ↑ 非配對       ↑ 配對
```

- 重複 Context Key：Lint 發出警告，框架執行時後者覆蓋前者

## 引號規則

- **DataTable**：被引號包裹時不解析 → `"$var"` 視為純字串
- **JSON DocString**：變數不可放在 `""` 內

```gherkin
# ✅ 正確
"""json
{ "userId": $userId }
"""

# ❌ 錯誤：視為純字串
"""json
{ "userId": "$userId" }
"""
```

## 邊界行為

### Null 處理

```gherkin
# 執行結果為 null → 存入為 null
| >agentId |
| <id      |  # id 為 null → agentId = null

# 變數未找到 → 回傳原始字串
| $undefinedVar |  # → 字串 "$undefinedVar"
```

### 字串內插邊界

```gherkin
# 未關閉的括號 → 保留原文
| User ${name without closing |

# 變數不存在 → 保留原文
| User ${notFound} |
```

## 保留字

`now` 是保留字，不可作為 Context Key：

```gherkin
# ❌ 錯誤
| >now |
```

## 各指令支援情況

| 指令 | `>` `<` 擷取 | `$` 引用 | `${}` 內插 |
|------|-------------|---------|-----------|
| EntitySetup | ✅ | ✅ | ✅ |
| ApiCall | ✅ | ✅ | ✅ |
| ResponseValidate | ✅ | ✅ | ✅ |
| EntityValidate | ❌ | ✅ | ✅ |
| EntityNonExistenceValidate | ❌ | ✅ | ❌ |
| TimeControl | ❌ | ❌ | ❌ |
