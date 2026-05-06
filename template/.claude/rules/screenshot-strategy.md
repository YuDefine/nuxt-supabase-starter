<!--
🔒 LOCKED — managed by clade
Source: rules/core/screenshot-strategy.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Screenshot strategy 規則——根據互動深度、跨裝置、跨瀏覽器與是否要沉澱成回歸測試，選擇 browser-harness 或 Playwright CLI
globs: ['screenshots/**', 'tests/e2e/**', 'openspec/changes/**/design-review.md']
---

# Screenshot Strategy

繁體中文 | [English](./screenshot-strategy.en.md)

所有截圖工作都應先判斷：這是一次性探索，還是需要可重現的回歸驗證。

## 工具選擇

| 工具 | 何時優先使用 | 特性 |
| --- | --- | --- |
| `browser-harness`（CDP 連使用者 Chrome） | 一次性驗收、探索、debug、人工檢查 | 快、互動成本低、繼承使用者登入 cookie |
| Playwright CLI / spec | 響應式、多 viewport、跨瀏覽器、多分頁、CI 回歸 | 可重現、可沉澱 |

## 決策樹

1. 需要多 viewport / responsive？→ Playwright
2. 需要跨瀏覽器？→ Playwright
3. 需要多分頁 / 多 session？→ Playwright（browser-harness 多 session 走 `BU_NAME` 可行但偏 ad-hoc）
4. 這組截圖之後還要重拍？→ Playwright
5. 其他一次性檢查 → `browser-harness`

## 場景對照

| 場景 | 建議工具 |
| --- | --- |
| 人工檢查逐項驗收 | `browser-harness` |
| Design Review 視覺 QA | `browser-harness` 起步，必要時升級 Playwright |
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

## 路徑強制規範（hard rule）

凡是給人工檢查、design review、debug 給 user 看的截圖：

- **MUST** 用 explicit path 落在 `screenshots/<env>/<topic>/` 下
- **NEVER** 讓 `browser-harness` 的 `capture_screenshot()` 不帶 path 參數 — 預設會落 `/tmp/shot.png`，user 找不到
- `/tmp` 只允許 agent 內部 sanity check（拍完當場 `Read` 自己看，不交付給 user）

換句話說：任何要交付給 user 的截圖路徑必須是 `screenshots/<env>/<topic>/...`，不能漂走。

## 歸檔機制

`screenshots/<env>/` 預設只放「目前 pending 人工檢查」的 topic；已收錄到 `docs/manual-review-archive.md` 的 change，對應截圖資料夾搬到 `screenshots/<env>/_archive/YYYY-MM/<topic>/`。

```text
screenshots/local/
├── change-pending-A/        # ← 仍在 review
├── change-pending-B/
└── _archive/
    ├── 2026-04/
    │   └── change-old-1/
    └── 2026-05/
        └── change-old-2/
```

- 歸檔由 `/screenshots-archive` skill 觸發；`/review-archive` 完成後會順手提示
- 對齊條件：只 sweep `docs/manual-review-archive.md` 已收錄的 change，避免誤搬 pending
- 目的：`ls screenshots/<env>/`（排除 `_archive/`）= 目前 pending review 清單

## 沉澱規則

同一組截圖被重複拍第 3 次，**SHOULD** 轉成 Playwright spec，避免每次重述操作步驟。

## 禁止事項

- **NEVER** 在需要多 viewport / 跨瀏覽器時硬用一次性工具
- **NEVER** 把「有截圖」誤當成「已完成人工檢查」
- **NEVER** 把截圖散落在 repo 各處，不留語義化路徑
- **NEVER** `capture_screenshot()` 不帶 path 用於人工檢查交付（路徑強制規範）
- **NEVER** 把已歸檔 change 的截圖資料夾留在 `screenshots/<env>/` 頂層 — sweep 到 `_archive/YYYY-MM/` 才算完整收尾
