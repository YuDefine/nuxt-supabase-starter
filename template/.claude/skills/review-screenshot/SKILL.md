---
name: review-screenshot
description: "截圖、看畫面、確認 UI、看一下頁面、幫我看 UI、review screenshot、跑檢查清單 — 統一截圖入口，派遣 screenshot-review agent（Sonnet）執行。"
---

# 截圖（統一入口）

所有截圖工作由 `screenshot-review` agent（Sonnet）執行。**MUST** 使用 Agent tool 派遣，不要在主 session 直接跑 browser-use 命令。

## 觸發時機

- 「截圖」「看畫面」「幫我看 UI」「看一下頁面」（一般截圖）
- 「review screenshot」「跑檢查清單」「截圖檢查」（review 驗收）
- UI 實作後確認、除錯截圖
- Spectra workflow 完成後視覺驗收

## 工具選擇規則

| 場景 | 工具 | 原因 |
|---|---|---|
| 一般截圖、UI 確認、review 驗收 | `browser-use` CLI | 快速、低延遲（50ms） |
| 響應式截圖（需調整視窗大小） | Playwright MCP | browser-use 固定 1920x1080 無法調整 |
| 多分頁/跨頁操作 | Playwright MCP | browser-use 單一 session 限制 |

Agent 會根據任務自動選擇工具，主 session 不需指定。

## 截圖存放統一規則

```
screenshots/<environment>/<語義>/
```

- `<environment>`：`local`、`staging`、`production` 等，依專案狀況
- `<語義>`：自由命名，如 `review/`、`debug/`、`feature-xxx/`、`<change-name>/`
- Review 報告：`screenshots/<env>/<語義>/review.md`
- **MUST** `mkdir -p` 確保目錄存在
- `.gitignore` 已加入 `screenshots/`

## 派遣方式

使用 Agent tool：

- `subagent_type`: `"screenshot-review"`
- `prompt`: 描述截圖任務

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
  ...

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
3. 報告檔位置：`screenshots/<env>/<語義>/review.md`

## 注意事項

- Agent 使用 Sonnet 模型，節省 cost
- 截圖存放在 `screenshots/<env>/<語義>/`（gitignored）
- Agent 會產出 `review.md` 報告，主 session 應向使用者展示摘要
- 主 session **不需要**自己跑 `browser-use` 命令
