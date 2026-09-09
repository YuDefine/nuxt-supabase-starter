<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/specformula-feature/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->

# TIME-System — 時間表達式

提供三個函式，將宣告式時間表達式轉換為型別安全的時間物件。

## 三個函式

| 函式 | 用途 | Java 型別 | C# 型別 |
|------|------|-----------|---------|
| `@time(expr)` | 完整日期時間 | `ZonedDateTime` | `DateTimeOffset` |
| `@date(expr)` | 僅日期 | `LocalDate` | `DateOnly` |
| `@localtime(expr)` | 僅時間 | `LocalTime` | `TimeOnly` |

## 絕對時間

```gherkin
# ISO 8601 格式
@time("2025-11-04T08:00:00")
@time("2025-11-04T08:00:00+08:00")
@time("2025-11-04T08:00:00Z")

# 僅日期（預設 00:00:00）
@time("2025-11-04")

# 日期函式
@date("2025-11-04")
@date("2025/12/16")

# 時間函式
@localtime("21:00")
@localtime("21:00:30")
```

## 相對時間

基於當前（或 Mock）時間計算：

```gherkin
@time("now")         # 當前時間
@time("now-1d")      # 昨天
@time("now+1h")      # 一小時後
@time("now-1M-1d")   # 一個月又一天前
```

### 時間單位

| 單位 | 符號 | 範例 |
|------|------|------|
| 秒 | `s`（小寫） | `now-30s` |
| 分 | `m`（小寫） | `now+5m` |
| 時 | `h`（小寫） | `now-2h` |
| 日 | `d`（小寫） | `now+7d` |
| 月 | `M`（大寫） | `now-1M` |

## 搭配 Mock 時間

當 TimeControl 設定 Mock 時間時，`now` 使用 Mock 時間：

```gherkin
Given 現在時間為 "2026-02-01T10:00:00"
When 創建日誌, call table:
  | logTime         |
  | @time("now-1d") |    # → 2026-01-31T10:00:00
```

## 時區處理

| 輸入格式 | 時區行為 |
|----------|----------|
| `2025-11-04T08:00:00+08:00` | 使用指定時區 |
| `2025-11-04T08:00:00Z` | 使用 UTC |
| `2025-11-04T08:00:00` | 使用系統預設時區 |

## 型別安全

TIME-System 回傳正確的時間型別，而非字串：

```gherkin
# ❌ 純字串，無型別保證
| eventTime           |
| 2025-11-04T08:00:00 |

# ✅ 回傳 ZonedDateTime，型別正確
| eventTime                    |
| @time("2025-11-04T08:00:00") |
```

## 使用限制

TIME-System 不可直接搭配 VAR 擷取鍵：

```gherkin
# ❌ 不支援
| >eventTime                   |
| @time("2026-01-15T09:00:00") |

# ✅ 正確：從執行結果擷取
| >eventTime |
| <createdAt |
```

## 各指令支援情況

| 指令 | TIME 支援 |
|------|----------|
| EntitySetup | ✅（寫入時間欄位） |
| ApiCall | ✅（傳送時間參數） |
| ResponseValidate | ✅（驗證時間值） |
| EntityValidate | ✅（驗證時間欄位） |
| TimeControl | ✅（設定 Mock 時間） |
| EntityNonExistenceValidate | ❌ |

## 錯誤處理

解析失敗時拋出明確例外：

```
無法解析時間表達式: @time("invalid")。
支援格式：ISO 8601 (2025-11-04T08:00:00)、日期 (2025-11-04)、相對時間 (now, now-1d)
```
