---
description: Consumer 零 docs 目錄與 truth 准入——lifecycle repo 不得有任何名為 docs 的目錄（specs/truth/docs 例外）、truth 每檔有 owner；未遷移 consumer 過渡期不得在 docs/ 開新檔
paths: ['docs/**', '**/docs/**', 'specs/truth/**']
---
<!-- Clade native rule; source: rules/core/consumer-docs-retirement.md; edit canonical source -->
<!-- clade-targets: claude,codex -->

# Consumer docs 退役與 truth 准入

分支只看一個可觀察 predicate：**repo root 有沒有 `specs/truth/work-lifecycle.md`**。有 = lifecycle repo；沒有 = 未遷移 consumer。

## Lifecycle repo（有 `specs/truth/work-lifecycle.md`）

- **NEVER** 新增或修改任何位在名為 `docs` 的目錄下的檔——根目錄、巢狀 app、template、preset **每一個** `docs/` 都算。唯一例外是 `specs/truth/docs/**`
- **每一個** `specs/truth/**` 檔 **MUST** 在 `specs/truth/owners.md` 有一列 owner；`specs/truth/docs/**` 那列 **MUST** 寫明准入條件與更新責任
- truth 只收現行契約、不變量、有後果的決策與已驗證會重現的教訓。計畫、待決、實驗、實作日誌留在 `specs/plans/<work-id>/`，**NEVER** 寫進 truth
- 已有機器權威（schema、OpenAPI、migration、registry）時，truth 連過去，**NEVER** 複製易變值

要寫的東西去哪：

| 內容 | 落點 |
| --- | --- |
| 持續維護、沒有機器權威的說明文字 | `specs/truth/docs/**` |
| 測試身分／樣本 UID 速查 | `specs/truth/fixtures.md`（[[fixtures-reference]]） |
| 有後果的技術決策、會重現的教訓 | 它約束的那個 truth 單位（[[knowledge-and-decisions]]） |
| 延續中的工作、待辦 | `specs/plans/<work-id>/plan.md` § Open work（[[follow-up-register]]） |
| 刻意不修的限制 | `specs/truth/accepted-limits.md` |

搬出舊 `docs/` 的檔、刪掉舊 `docs/` 的檔一律允許；退役存量要走得出去。

機械兜底：`scripts/pre-commit/checks/consumer-carriers.sh`（pre-commit）與 `node scripts/checks/consumer-carrier-gate.ts --against <base>`（CI），在 HEAD 已沒有任何 docs 路徑之後擋重建。gate 沒擋不代表可以寫——遷移中（HEAD 還有 docs 存量）gate 不啟用，本規約照樣適用。

範本與遷移順序：`vendor/snippets/consumer-lifecycle/README.md`。

## 未遷移 consumer（沒有 `specs/truth/work-lifecycle.md`）

- **NEVER** 在 `docs/decisions/`、`docs/solutions/` 新增檔案；新決策與新教訓寫進當下那份工作的 plan／spec，遷移時一併處置
- 既有 `docs/` 檔（含 `docs/FIXTURES.md`）可以原地更新；**NEVER** 為了「先放著之後再搬」在 `docs/` 開新檔
- **NEVER** 在沒有 `specs/truth/owners.md` 的 repo 直接寫 `specs/truth/docs/**`——沒有 owner 的 truth 就是第二份 docs

遷移由 clade relay 逐台送達（`W-2026-09-20-consumer-lifecycle-migration`）；本節在 fleet 驗收顯示 11/11 採用後刪除。
