# API Response 手動映射遺漏欄位

## Problem

前端表格欄位顯示空白，但沒有任何錯誤訊息。API 回傳 200，資料卻不完整。

## Root Cause

Server API 手動 `.map()` 映射回應欄位時漏掉欄位。TypeScript 不會檢查「少回傳了什麼」— map 回傳型別是隱式 any，不會報錯。欄位值為 `undefined` 不會 crash，只會靜默顯示空白。

## What Didn't Work

- 看 console 找錯誤 — 沒有任何 error，因為欄位是 `undefined` 不是 crash
- 看 TypeScript 編譯 — map 回傳型別是隱式 any，不會報錯

## Solution

API response 映射使用 `satisfies` 或明確標註回傳型別：

```typescript
return rows.map(
  (row) =>
    ({
      id: row.id,
      name: row.name,
      type: row.type, // 確保所有欄位都有映射
      category: row.category, // 確保所有欄位都有映射
      // ...
    }) satisfies YourResponseType
)
```

也可以比對 `shared/types/` 中的 response interface 確認所有欄位都有映射。

## Prevention

- 新增/修改 API 時，比對 TypeScript interface 確認欄位完整性
- 考慮用 spread `...row` 取代手動列舉（注意排除 join 物件）
- Review 時特別注意 `.map()` 是否遺漏欄位
