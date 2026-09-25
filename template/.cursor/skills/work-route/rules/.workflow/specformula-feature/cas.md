<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->

# CAS-System — 約束斷言系統

宣告式約束驗證，取代傳統的命令式斷言程式碼。

## 基本語法

```
&constraintName                    # 無參數
&constraintName(parameter)         # 單參數
&constraintName(param1, param2)    # 多參數
&constraint1 &constraint2          # 多約束（AND）
```

## 使用位置

### DataTable 格式

```gherkin
Then 回應, with table:
  | id     | name            | age             |
  | &isNum | &contains("王") | &between(18,65) |
```

### DocString JSON 格式

```gherkin
Then 回應為, with JSON:
  """json
  {
    "id": &isNum &gt(0),
    "name": &isStr &contains(王)
  }
  """
```

> **注意**：CAS 表達式不可放在 JSON 字串引號 `""` 內。

## 完整約束清單

### 型別檢查

| 約束 | 意義 |
|------|------|
| `&isNum` | 是數值 |
| `&isStr` | 是字串 |
| `&isBool` | 是布林值 |
| `&isNull` | 是 null |
| `&isNotNull` | 不是 null |

### 數值比較

| 約束 | 意義 | 範例 |
|------|------|------|
| `&eq(value)` | 等於 | `&eq(100)` |
| `&ne(value)` | 不等於 | `&ne(0)` |
| `&gt(value)` | 大於 | `&gt(0)` |
| `&lt(value)` | 小於 | `&lt(100)` |
| `&ge(value)` | 大於等於 | `&ge(18)` |
| `&le(value)` | 小於等於 | `&le(65)` |

### 字串操作

| 約束 | 範例 |
|------|------|
| `&contains(substring)` | `&contains("王")` |
| `&startsWith(prefix)` | `&startsWith("Mr.")` |
| `&endsWith(suffix)` | `&endsWith(".com")` |
| `&matches(regex)` | `&matches("\\d{4}-\\d{2}-\\d{2}")` |
| `&length(min,max)` | `&length(2,10)` |

### 陣列操作

| 約束 | 範例 |
|------|------|
| `&hasItem(item)` | `&hasItem("admin")` |
| `&hasNoItem(item)` | `&hasNoItem("guest")` |
| `&size(count)` | `&size(5)` |
| `&isEmpty` | `&isEmpty` |
| `&isNotEmpty` | `&isNotEmpty` |

### 存在性檢查

| 約束 | 範例 |
|------|------|
| `&hasField(fieldName)` | `&hasField("createdAt")` |
| `&noField(fieldName)` | `&noField("password")` |

### 範圍檢查

| 約束 | 範例 |
|------|------|
| `&between(min,max)` | `&between(18,65)` |
| `&notBetween(min,max)` | `&notBetween(0,17)` |
| `&oneOf(val1,val2,...)` | `&oneOf("admin","user")` |
| `&noneOf(val1,val2,...)` | `&noneOf("banned")` |

### 時間相關

| 約束 | 範例 |
|------|------|
| `&sameTime(datetime)` | `&sameTime("2025-11-04T08:00:00")` |
| `&before(datetime)` | `&before("2025-12-31")` |
| `&after(datetime)` | `&after("2025-01-01")` |
| `&sameDay(date)` | `&sameDay("2025-11-04")` |
| `&timeRange(start,end)` | `&timeRange("09:00","17:00")` |
| `&withinDays(days)` | `&withinDays(7)` |

時間參數支援 `now` 關鍵字與相對時間，以 TimeControl 的 MockTime 為基準。

相對時間單位：`s`(秒) `m`(分) `h`(時) `d`(日) `M`(月)

```gherkin
| createdAt        | expiresAt        | updatedAt          |
| &sameTime("now") | &after("now+7d") | &before("now-30m") |
```

## 多約束組合

空格分隔的多個約束為 AND 關係：

```gherkin
| field                          |
| &isNum &gt(0) &lt(100) &ne(50) |
# 必須同時：是數值、大於 0、小於 100、不等於 50
```

## 搭配變數

CAS 參數可引用變數：

```gherkin
| &eq($expectedValue)    |  # 使用變數作為比對值
| &gt($minThreshold)     |  # 動態下限
| &between($min, $max)   |  # 動態範圍
```

## 使用限制

CAS 不可與 `>contextKey` 在同一欄位混用：

```gherkin
# ❌ 錯誤：同欄位同時擷取（>）與驗證（&）
| >recordId |
| &isNum    |

# ✅ 正確：分開使用
When 打卡, call table:
  | >recordId |
  | <id       |
Then 回應, with table:
  | recordId              |
  | &eq($recordId) &isNum |
```

## 各指令支援情況

| 指令 | CAS 支援 |
|------|---------|
| ResponseValidate | ✅ 全部約束 |
| EntityValidate | ✅ 全部約束 |
| EntitySetup | ❌ |
| ApiCall | ❌ |
| EntityNonExistenceValidate | ❌ |
| TimeControl | ❌ |
