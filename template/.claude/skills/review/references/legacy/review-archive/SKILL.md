---
name: review-archive
description: 'Use when 使用者要求歸檔人工檢查。現行契約已停寫 docs/manual-review-archive.md；完成項留在 work package。NOT for 搬截圖（screenshots-archive 同樣已停 rotate）。'
metadata:
  clade:
    permission_tier: draft
---

# 人工檢查歸檔（已停寫）

`W-2026-09-20-non-lifecycle-archive-retire` US1：生產寫入 `docs/manual-review-archive.md` 已停。

## 現行契約

- **NEVER** append 或新建 `docs/manual-review-archive.md`
- 已完成（`[x]`）的人工檢查 **MUST** 留在該工作的 package（`specs/plans/<work-id>/tasks.md` 或未遷移 consumer 的 `specs/plans/NNN-<slug>/tasks.md`／`tasks/<date>-<slug>.md`）
- **NEVER** 自動叫用 screenshots-archive 去搬 `_archive/`
- 歷史檔若仍存在，可讀；刪檔要等 live-ref 改點後，由同一 work 另開 task，MUST NOT `--apply` 當完成

## 觸發時怎麼回

使用者說「歸檔檢查」「archive review」時：

1. 確認完成項已在 work package 打 `[x]`
2. 回報「不再寫入 `docs/manual-review-archive.md`；結論在 `<carrier>`」
3. 停。不要 sweep 截圖。
