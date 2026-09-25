<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->

# TimeControl 指令

控制測試中的 Mock 時間，確保時間相依測試的穩定性。

## 撰寫 SOP

### Step 1：撰寫 Step 語句

根據 `isa.yml` 中 `instruction_type: time_control` 的 `format` 撰寫語句：

```gherkin
Given 現在時間為 "2026-01-27T10:00:00"
```

### Step 2：選擇要模擬的時間

- 需要固定時間點？→ 直接使用 ISO 格式
- 需要基於前一次時間推進？→ 使用 `@time("now+1d")` 等相對計算

| 格式 | 範例 |
|------|------|
| 純日期 | `2025-12-25`（預設 00:00:00） |
| ISO 無時區 | `2025-11-04T08:00:00`（使用系統時區） |
| ISO 含時區 | `2025-12-25T14:30:00+08:00` |
| ISO UTC | `2025-12-25T06:30:00Z` |
| 時間符號 | `@time("2025-12-25T14:30:00")` |

## 錯誤處理

| 階段 | 錯誤 | 說明 |
|------|------|------|
| 執行 | 缺少時間參數 | 時間表達式為空 |
| 執行 | 無法解析 | 時間格式不符合支援的格式 |
