---
description: '凍結指定路徑，防止 Claude 修改'
---

# /freeze <path> — 凍結路徑

## 流程

1. 驗證 `<path>` 存在（檔案或目錄）
2. 讀取 `.claude/guard-state.json`
3. 將 `<path>` 加入 `frozen_paths` 陣列（如果尚未存在）
4. 更新 `updated_at` 為當前 ISO 時間
5. 寫回 `.claude/guard-state.json`

## 輸出

```
🔒 已凍結: <path>
guard-check hook 會在 Edit/Write 時自動阻擋對此路徑的修改。
解凍: /unfreeze <path>
```
