---
name: screenshots-archive
description: 'Use when 使用者要求 sweep 截圖到 _archive/。現行契約已停 rotate；截圖留在 screenshots/<env>/<topic>/。NOT for 產生新截圖（走 review-screenshot）。'
metadata:
  clade:
    permission_tier: read-only
---

# 截圖歸檔（已停 rotate）

`W-2026-09-20-non-lifecycle-archive-retire` US2：停止把 topic 搬進 `screenshots/<env>/_archive/YYYY-MM/`。

## 現行契約

- **NEVER** `git mv`／`mv` 到 `screenshots/<env>/_archive/`
- review-archive **MUST NOT** 自動觸發本 skill 去搬檔
- 完成的截圖留在 `screenshots/<env>/<topic>/`；pending 與否改看 work package 的人工檢查狀態，不靠頂層目錄是否已 sweep
- 既有 `_archive/` 目錄可讀；刪檔要等 live-ref 改點後，MUST NOT `--apply` 當完成

## 觸發時怎麼回

使用者說「歸檔截圖」「sweep screenshots」或 `/review screenshots` 時：回報已停 rotate，並列目前 `screenshots/<env>/` 頂層 topic（排除 `_archive/` 僅供盤點，不搬）。
