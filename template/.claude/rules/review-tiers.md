---
description: Review tiers 規則——依變更規模與風險決定 self-review、spectra-audit、code-review 的最低要求
paths: ['**/*']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/review-tiers.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Review Tiers

變更大小與風險面向，決定 review 的最低強度。

## Tier 定義

- **Tier 1**：小型、低風險、非敏感變更
- **Tier 2**：中型以上功能變更、跨多檔案、行為可能回歸
- **Tier 3**：高風險變更，例如 migration / auth / permission / RLS / raw SQL / billing / security

## 觸發判斷

| 條件 | Tier |
| --- | --- |
| 只改 docs / comments / README | 1 |
| 小型非敏感重構或功能修補（約 < 50 行） | 1 |
| 功能變更 ≥ 50 行、跨多個模組、可見行為改動 | 2 |
| 動到 migration / schema / auth / permission / raw SQL / security-critical code | 3 |

## 最低要求

| Tier | 最低 review 要求 |
| --- | --- |
| 1 | 作者 inline self-review |
| 2 | `spectra-audit` + code review |
| 3 | `spectra-audit` + code review，必要時補手動驗證與更嚴格測試 |

## 額外規則

- Tier 2 / 3 **不應** 只有作者自行口頭確認
- Tier 3 若同時改 schema 與權限 / policy，應在同一批 review 中一起看，避免半套上線
- 若變更雖然很短，但碰到敏感路徑，仍以高 tier 處理

## Reviewer 紀律（適用**每一次** review dispatch：subagent reviewer、codex review、code-review agent）

**Dispatch 端（主線填 reviewer prompt 時）**：

- **NEVER pre-judge**：prompt 內禁「do not flag」「不用管 X」「at most Minor」——認為會是 false positive 就讓 reviewer 照報，在 review loop 裁決。pre-judge 的動機通常是替自己省一輪 loop
- Binding constraints（spec / plan 的 exact values、formats、元件間關係）**逐字**複製進 prompt 當注意力鏡頭；不要用開放式「check all uses」灌水
- Diff 走**檔案**交付（commit list + stat + full diff 打包一檔）；範圍 BASE 用開工前記錄的 commit，**NEVER `HEAD~1`**（多 commit 工作會被靜默截斷）
- 不叫 reviewer 重跑 implementer 已跑且附 evidence 的測試——report 就是 test evidence；缺 evidence 是 finding，不是重跑理由

**Reviewer 端**：

- Implementer report 是**未驗證主張**；自報的設計說詞（「per YAGNI 略過」「刻意簡化」）**不得**降級任何 finding 嚴重度
- Diff 之外只做 **named-risk focused check**——說得出名字的具體風險（lock ordering、API contract、shared state 改動查 call sites）一風險一查，report 寫明查了什麼；**NEVER** 無方向爬 codebase
- Plan-mandated defect（plan 明文要求、但 rubric 視為 defect）**照報**（Important + `plan-mandated` 標記），由 human 裁決哪個作準——plan 的作者身分不能替自己的產出打分
- 依**實際**嚴重度分級（不是每條都 Critical）；先列 strengths 再列 issues——準確的肯定讓其餘 feedback 可信
- 從 diff 驗不了的要求（活在未變動 code、跨 task）標 **⚠️ cannot-verify** 回報給 dispatch 端，**NEVER** 自行擴大搜索範圍

模板實作：`subagent-dev` skill 的 `task-reviewer-prompt.md`；回報契約見 [[agent-routing]] § Subagent 回報契約。

## 禁止事項

- **NEVER** 因為 diff 看起來短就把高風險變更降成 Tier 1
- **NEVER** 跳過 `spectra-audit` 就宣稱 Tier 2 / 3 已完成
- **NEVER** 把「測試有過」當成可取代 review 的理由
