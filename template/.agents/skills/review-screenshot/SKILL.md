---
name: review-screenshot
description: '截圖、看畫面、確認 UI、看一下頁面、幫我看 UI、review screenshot、跑檢查清單 — 統一截圖入口，派遣 screenshot-review agent（Sonnet）執行。'
---

# 截圖（統一入口）

所有截圖工作由 `screenshot-review` agent（Sonnet）執行。**MUST** 使用 spawn_agent 工具 派遣，不要在主 session 直接跑截圖命令。

工具選擇規則見 `.claude/rules/screenshot-strategy.md` — agent 會自行判斷，主 session 不需指定。

## 觸發時機

- 「截圖」「看畫面」「幫我看 UI」「看一下頁面」
- 「review screenshot」「跑檢查清單」「截圖檢查」
- UI 實作後確認、除錯截圖
- Spectra workflow 完成後視覺驗收

## 派遣方式

spawn_agent 工具，`agent_type: "screenshot-review"`。

### Ad-hoc 截圖

```
prompt: |
  截圖驗證以下頁面：
  1. /path/to/page — 頁面描述
  2. /path/to/page2 — 頁面描述
  Dev server port: <port>（若已知）
```

### Review 截圖（Spectra 人工檢查）

```
prompt: |
  針對 change `<change-name>` 的人工檢查清單逐項截圖驗證：

  ## 人工檢查
  - [ ] #1 實際操作功能，確認 happy path 正常運作
  - [ ] #2 測試 edge case...

  Dev server port: <port>（若已知）
```

### 除錯截圖

```
prompt: |
  除錯截圖：頁面 /path 出現 [問題描述]，需要截圖確認目前狀態。
  Dev server port: <port>（若已知）
```

## 結果處理

Agent 回傳後，主 session 應：

1. 向使用者展示摘要表格（通過/需確認/有問題）
2. 列出需要人工確認的項目及截圖路徑
3. 報告檔位置：`screenshots/<env>/<語義>/review.md`（路徑規則見 rule）

## 注意事項

- Agent 使用 Sonnet 模型，節省 cost
- 主 session **不需要**自己跑截圖命令
- 主 session **不需要**決定用哪個工具 — agent 依 rule 判斷
