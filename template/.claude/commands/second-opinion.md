---
description: '獨立 code review — 從全新視角檢查'
---

# /second-opinion — 獨立 Code Review

以全新視角審查最近的變更，專注在**真正會影響 production** 的問題。

## 審查範圍

```bash
git diff HEAD~1..HEAD  # 或指定的 commit range
```

## 審查重點

只報告以下類別的問題：

### 1. 邏輯錯誤

- Off-by-one、條件反轉、null/undefined 未處理
- 非同步競態條件

### 2. 安全漏洞

- SQL injection、XSS、CSRF
- 敏感資料洩漏（API keys、passwords、error internals）
- RLS policy 繞過

### 3. 資料完整性

- 資料庫操作缺少 transaction
- Cache invalidation 遺漏
- 型別不匹配（runtime vs compile time）

### 4. 環境差異

- Dev-only code 洩漏到 production
- 硬編碼的 localhost/開發環境值
- 缺少的環境變數

## 審查原則

- **不報告** style、naming、refactoring 建議
- **不報告** 「可以更好」但不影響正確性的改動
- **只報告** 會在 production 造成 bug、crash、或安全問題的發現
- 每個發現附上：檔案位置、問題描述、建議修復

## 輸出格式

```
## Second Opinion Review

### 🔴 Critical
（無 / 列出）

### 🟡 Warning
（無 / 列出）

### ✅ Verdict
[SHIP IT / HOLD — 需要修復 N 個問題]
```
