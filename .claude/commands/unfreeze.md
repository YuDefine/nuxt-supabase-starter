---
description: '解凍已凍結的路徑'
---

# /unfreeze <path> — 解凍路徑

## 流程

1. 讀取 `.claude/guard-state.json`
2. 檢查 `<path>` 是否在 `frozen_paths` 中
3. 如果不在，告知使用者該路徑未被凍結
4. 檢查是否為永久保護路徑（migrations、workflows、env files）— 如果是，拒絕解凍
5. 從 `frozen_paths` 移除 `<path>`
6. 更新 `updated_at`
7. 寫回 `.claude/guard-state.json`

## 輸出

```
🔓 已解凍: <path>
```
