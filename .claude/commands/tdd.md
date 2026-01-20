---
description: 執行 TDD 流程：寫測試 → 確認紅燈 → 實作 → 確認綠燈 → 重構
---

## User Input

```text
$ARGUMENTS
```

## Outline

執行完整的 Test-Driven Development 流程。

### Step 1: 理解需求

確認要實作的功能：

- 功能描述是什麼？
- 預期的輸入/輸出？
- 邊界條件和錯誤情況？

### Step 2: 設計測試案例

規劃測試案例，包含：

- ✅ Happy path（正常情況）
- ❌ Error cases（錯誤情況）
- 🔲 Edge cases（邊界條件）

```text
## 測試案例規劃

### [功能名稱]

1. ✅ 正常情況：[描述]
   - 輸入: ...
   - 預期: ...

2. ❌ 錯誤情況：[描述]
   - 輸入: ...
   - 預期: throw Error / return null / ...

3. 🔲 邊界條件：[描述]
   - 輸入: 空值 / 極大值 / ...
   - 預期: ...
```

### Step 3: 撰寫測試（Red）

在 `test/unit/` 目錄建立測試檔案：

```typescript
import { describe, it, expect } from 'vitest'

describe('功能名稱', () => {
  it('should [預期行為]', () => {
    // Arrange
    const input = ...

    // Act
    const result = functionUnderTest(input)

    // Assert
    expect(result).toBe(expected)
  })
})
```

### Step 4: 確認紅燈

執行測試，確認測試失敗：

```bash
pnpm vitest run test/unit/[test-file].test.ts
```

**必須看到測試失敗**，這證明測試是有效的。

### Step 5: 實作功能（Green）

撰寫最小實作讓測試通過：

- 只寫足夠讓測試通過的程式碼
- 不要過度設計
- 不要加入額外功能

### Step 6: 確認綠燈

再次執行測試，確認通過：

```bash
pnpm vitest run test/unit/[test-file].test.ts
```

**必須看到所有測試通過**。

### Step 7: 重構（Refactor）

在測試保護下重構程式碼：

- 改善程式碼品質
- 移除重複
- 改善命名

每次重構後執行測試確認仍然通過。

### Step 8: 完成報告

```text
✅ TDD 流程完成！

## 測試覆蓋

| 測試案例 | 狀態 |
|----------|------|
| 正常情況 | ✓ |
| 錯誤處理 | ✓ |
| 邊界條件 | ✓ |

## 產出檔案

- 測試: test/unit/xxx.test.ts
- 實作: app/xxx.ts

## 執行結果

pnpm vitest run test/unit/xxx.test.ts
✓ All tests passed
```

### Step 9: 執行完整檢查（自動）

TDD 流程完成後，自動執行完整檢查：

1. **調用 check-runner SubAgent** 執行 `pnpm check`（format → lint → typecheck → test）

2. **處理檢查結果**：
   - 如果全部通過 → 顯示成功訊息
   - 如果有錯誤 → 顯示錯誤摘要，協助修復

3. **詢問是否 Commit**：
   - 檢查通過後詢問：「檢查通過，要 commit 這個功能嗎？」
   - 如果使用者同意 → 調用 `/commit` 進行提交
   - 如果使用者拒絕 → 結束流程

**流程示意**：

```
TDD 完成 → check-runner → 全部通過？
                              ↓ Yes
                        詢問是否 commit
                              ↓ Yes
                         調用 /commit
```

---

## TDD 原則提醒

1. **先寫測試**：不要先寫實作
2. **看到紅燈**：確認測試真的會失敗
3. **最小實作**：只寫讓測試通過的程式碼
4. **頻繁執行**：每次修改都執行測試
5. **勇敢重構**：有測試保護就放心改
