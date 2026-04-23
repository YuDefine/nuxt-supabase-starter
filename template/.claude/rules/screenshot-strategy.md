---
description: Screenshot strategy 規則——根據互動深度、跨裝置、跨瀏覽器與是否要沉澱成回歸測試，選擇 browser-use 或 Playwright CLI
globs: ['screenshots/**', 'tests/e2e/**', 'openspec/changes/**/design-review.md']
---

# Screenshot Strategy

繁體中文 | [English](./screenshot-strategy.en.md)

所有截圖工作都應先判斷：這是一次性探索，還是需要可重現的回歸驗證。

## 工具選擇

| 工具 | 何時優先使用 | 特性 |
| --- | --- | --- |
| `browser-use` 類工具 | 一次性驗收、探索、debug、人工檢查 | 快、互動成本低 |
| Playwright CLI / spec | 響應式、多 viewport、跨瀏覽器、多分頁、CI 回歸 | 可重現、可沉澱 |

## 決策樹

1. 需要多 viewport / responsive？→ Playwright
2. 需要跨瀏覽器？→ Playwright
3. 需要多分頁 / 多 session？→ Playwright
4. 這組截圖之後還要重拍？→ Playwright
5. 其他一次性檢查 → `browser-use`

## 場景對照

| 場景 | 建議工具 |
| --- | --- |
| 人工檢查逐項驗收 | `browser-use` |
| Design Review 視覺 QA | `browser-use` 起步，必要時升級 Playwright |
| Mobile / tablet / desktop 對照 | Playwright |
| Safari / Firefox 驗證 | Playwright |
| 重複第 3 次以上的截圖回歸 | Playwright spec |

## 存放方式

```text
screenshots/<environment>/<topic>/
```

- `<environment>`：`local` / `staging` / `production`
- `<topic>`：`review/` / `debug/` / `<change-name>/`
- 評估報告可放 `review.md`

## 沉澱規則

同一組截圖被重複拍第 3 次，**SHOULD** 轉成 Playwright spec，避免每次重述操作步驟。

## 禁止事項

- **NEVER** 在需要多 viewport / 跨瀏覽器時硬用一次性工具
- **NEVER** 把「有截圖」誤當成「已完成人工檢查」
- **NEVER** 把截圖散落在 repo 各處，不留語義化路徑
