---
description: 知識沉澱與決策記錄規則——lifecycle repo 把現行決策與會重現的教訓併進它約束的 truth 單位；未遷移 consumer 不在 docs/ 開新檔，寫進當下工作的 plan／spec
paths: ['docs/solutions/**', 'docs/decisions/**', 'specs/**', 'tasks/**']
---
<!-- Clade native rule; source: rules/core/knowledge-and-decisions.md; edit canonical source -->
<!-- clade-targets: claude,codex -->
# Knowledge Accumulation & Decision Records

分支看 repo root 有沒有 `specs/truth/work-lifecycle.md`：有 = lifecycle repo；沒有 = 未遷移 consumer（見 [[consumer-docs-retirement]]）。

## 知識萃取（任務結束時）

解決非 trivial 問題後，若符合任一條件，**SHOULD** 萃取：

- debug 嘗試 3 種以上方法
- 發現隱性限制或非直覺行為
- 使用 workaround 才能完成
- 同一類問題很可能再出現

| repo | 已驗證、會重現的教訓 | 一次性的除錯經過 |
| --- | --- | --- |
| lifecycle repo | 併進它所屬的 truth 單位（或擋得住它的 rule／test），寫機制與防範，不寫經過 | 留在 commit message 或該 work 的 `evidence/`，**NEVER** 進 truth |
| 未遷移 consumer | 寫進當下工作的 plan／spec；**NEVER** 在 `docs/solutions/` 開新檔 | 同左 |

## 架構決策記錄（ADR）

做出影響超出當前任務的技術決策時，**MUST** 評估是否記錄。典型觸發：

- 選框架 / 套件 / 儲存方案
- 改變分層或資料流
- 決定重要 trade-off
- 替換舊做法

落點：

- **lifecycle repo**：寫進它約束的那個 truth 單位的 Decision 段——最終決定、理由、接受的代價、什麼事件發生要重新評估。取代舊決策時**原地改寫**，**NEVER** 另開一份追加。跨多個單位、找不到宿主的決策才開 `specs/truth/decisions/<topic>.md`（主題命名、不帶日期、`owners.md` 有一列）
- **未遷移 consumer**：寫進當下工作的 plan／spec；**NEVER** 在 `docs/decisions/` 開新檔。既有 `docs/decisions/*.md` 可原地更新，遷移時逐條判：仍有效 → 併進 truth 單位；已失效 → 在處置表記 drop 與證據

決策內容格式：

```markdown
## Decision

最終決定。

## Reasoning

背景、限制、考慮過的方案與為什麼這次選它。

## Trade-offs Accepted

接受的代價。

## Re-evaluate when

什麼可觀察事件發生時要重新評估。
```

## 任務前檢查（輕量）

開始處理既有模組前，優先檢查既有結論：

- lifecycle repo：`specs/truth/**` 中該模組所屬的單位（`specs/truth/owners.md` 查誰管哪裡）
- 未遷移 consumer：`docs/decisions/`、`docs/solutions/`

找到既有結論時，預設遵循；若理由已失效，再提出更新。

## 規則生命週期

- 同一類教訓反覆出現（3 次以上）→ 可提議升級為 clade 共用源檔（`rules/core/` 等）或 consumer 自有共同源檔（`.clade/rules/`），再按選用 targets 產生原生規約
- 既有規則被新事證推翻 → 可提議降級或移除
- **不自動晉升 / 降級**，一律先提議，再由使用者決定
