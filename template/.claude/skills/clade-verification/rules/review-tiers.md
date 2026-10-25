---
description: Review tiers 規則——依變更規模與風險決定規格／實作一致性審查與獨立 code review 的最低要求
paths: ['specs/plans/**', 'specs/truth/**', '.claude/agents/**', 'supabase/migrations/**/*.sql', 'server/database/migrations/**/*.sql', 'packages/*/supabase/migrations/**/*.sql', 'packages/*/server/database/migrations/**/*.sql']
---
<!-- Clade native rule; source: rules/core/review-tiers.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Review Tiers

變更大小與風險面向，決定 review 的最低強度。

## Tier 定義

- **Tier 1**：小型、低風險、非敏感變更
- **Tier 2**：中型以上功能變更、跨多檔案、行為可能回歸
- **Tier 3**：高風險變更，例如 migration / auth / permission / RLS / raw SQL / billing / security
  - `SECURITY.md`（安全憲法）本身是 Tier 3 路徑；動任何 Tier 3 路徑前先對照它的 § 安全不變量（形狀契約見 [[security-policy]]）

## 觸發判斷

| 條件 | Tier |
| --- | --- |
| 只改 docs / comments / README | 1 |
| 小型非敏感重構或功能修補（約 < 50 行） | 1 |
| 功能變更 ≥ 50 行、跨多個模組、可見行為改動 | 2 |
| 動到 migration / schema / auth / permission / raw SQL / billing / security-critical code | 3 |

## 最低要求

| Tier | 最低 review 要求 |
| --- | --- |
| 1 | 作者 inline self-review |
| 2 | 規格／實作一致性審查 + 獨立 code review |
| 3 | 規格／實作一致性審查 + 獨立 code review，必要時補手動驗證與更嚴格測試 |

## 額外規則

- Tier 2 / 3 **不應** 只有作者自行口頭確認
- Tier 3 若同時改 schema 與權限 / policy，應在同一批 review 中一起看，避免半套上線
- 若變更雖然很短，但碰到敏感路徑，仍以高 tier 處理

## Reviewer 紀律（適用**每一次** review dispatch：subagent reviewer、code-review agent）

**Dispatch 端（主線填 reviewer prompt 時）**：

- **NEVER pre-judge**：prompt 內禁「do not flag」「不用管 X」「at most Minor」——認為會是 false positive 就讓 reviewer 照報，在 review loop 裁決。pre-judge 的動機通常是替自己省一輪 loop
- Binding constraints（spec / plan 的 exact values、formats、元件間關係）**逐字**複製進 prompt 當注意力鏡頭；不要用開放式「check all uses」灌水
- Diff 走**檔案**交付（commit list + stat + full diff 打包一檔）；範圍 BASE 用開工前記錄的 commit，**NEVER `HEAD~1`**（多 commit 工作會被靜默截斷）
- 不叫 reviewer 重跑 implementer 已跑且附 evidence 的測試——report 就是 test evidence；缺 evidence 是 finding，不是重跑理由
- **寫明受審 repo 根目錄**：reviewer 的 cwd 是派它那個 session 起手的目錄，不一定是受審的那棵樹（主線在 main checkout 起手、審 linked worktree 是常態）。prompt MUST 給受審 repo 根的絕對路徑，並要求 changeset 以外的讀檔一律用該根底下的絕對路徑；漏了，reviewer 讀到別棵 checkout，報出「引用的檔不存在」這類誤判。快照的 ref 同理：`review-snapshot.ts --stage <ref>` 在受審 repo 解析，NEVER 在快照裡解析（快照的 `HEAD` 是 `--base`）

**Reviewer 端**：

- Implementer report 是**未驗證主張**；自報的設計說詞（「per YAGNI 略過」「刻意簡化」）**不得**降級任何 finding 嚴重度
- Diff 之外只做 **named-risk focused check**——說得出名字的具體風險（lock ordering、API contract、shared state 改動查 call sites）一風險一查，report 寫明查了什麼；**NEVER** 無方向爬 codebase
- **Tier 3 專屬 named-risk：boundary flip**——diff 內**每個**比較運算子（`>=` `>` `<=` `<` `===` `!==`）問一次「翻轉它，現有測試會紅嗎」。答「不會」或答不出來 = 該邊界沒被測試釘住，照報 finding（金流 / 額度 / 期限 / 配額判斷尤其必查）。這條靠**讀 test 檔**判斷，**NEVER** 據此要求 implementer 重跑或補跑測試（與上方 dispatch 端「不叫 reviewer 重跑 implementer 已跑且附 evidence 的測試」同一紀律）
- Plan-mandated defect（plan 明文要求、但 rubric 視為 defect）**照報**（Important + `plan-mandated` 標記），由 human 裁決哪個作準——plan 的作者身分不能替自己的產出打分
- 依**實際**嚴重度分級（不是每條都 Critical）；先列 strengths 再列 issues——準確的肯定讓其餘 feedback 可信
- 從 diff 驗不了的要求（活在未變動 code、跨 task）標 **⚠️ cannot-verify** 回報給 dispatch 端，**NEVER** 自行擴大搜索範圍

模板實作：`~/offline/clade/capabilities/core/references/implement-executor/subagent-dev/task-reviewer-prompt.md`（`/implement` 的 executor reference）；回報契約見 [[agent-routing.dispatch-execution]] § Subagent 回報契約。

## 裁決端（主線處置 0-A 以外的 review finding）

適用範圍：`/code-review`、`code-review` agent、Tier 2／3 規格／實作一致性審查、分歧仲裁的顧問回覆——**每一則** finding 都要落桶，不是只處理有意見的那幾則。commit 0-A 的 finding 不走本節，照 `capabilities/core/skills/commit/gates.md` § 0-A。

本節不常駐：`code-review` agent 報告的 § 結論段指向這裡，`proactive-skills` 的 Review Tiers 行也指向這裡；其餘入口（`/code-review`、規格審查、顧問回覆）由主線收到回覆時自己讀本節。

主線收到 review 回覆後，把每則 finding 放進下列四桶之一，每則附 reviewer 與一行理由：

| 桶 | 放什麼 | 主線接著做 |
| --- | --- | --- |
| **Act on** | 成立且在本次改動範圍內 | 修掉並跑相關驗證 |
| **Consider** | 成立但牽涉取捨或超出本次範圍 | 寫下取捨後決定做或不做；不做就登記 TD／plan |
| **Noted** | 成立但不要求動作（資訊、背景）；安全或正確性 finding 不可放這桶 | 只記錄 |
| **Dismissed** | 不成立 | 附 `<file>:<line>` 或契約／規則條文的具體出處 |

Dismissed 的理由只能是下列五類之一，且同樣 MUST 附 `<file>:<line>` 或契約出處：

1. **nitpick gravity**：只是風格偏好，專案 lint／慣例檔沒有規定
2. **假設與實際不符**：reviewer 假設的呼叫情境不存在——追過呼叫端，附呼叫端位置
3. **過早抽象**：要求為目前只有一個使用處的東西加抽象層
4. **換我會這樣寫**：替代寫法與現行寫法行為相同、沒有更好
5. **缺 context**：reviewer 沒看到的檔或契約已經處理掉該問題，附那個出處。出處是 plan 本身的不算：plan-mandated finding（§ Reviewer 紀律）**NEVER** 放 Dismissed，放 Consider 交 human 裁決

附不出 `<file>:<line>` 或契約出處的 Dismissed 改放 Consider。安全或正確性 finding 只能放 Act on、Consider，或附實跑／呼叫端證據的 Dismissed——只憑五類濾網 dismiss、或當「已知限制」放 Noted，都不成立。

## 禁止事項

- **NEVER** 因為 diff 看起來短就把高風險變更降成 Tier 1
- **NEVER** 省略規格／實作一致性審查或獨立 code review 就宣稱 Tier 2 / 3 已完成
- 規格／實作一致性審查 MUST 對照適用的 current plan/spec 與 frozen changeset，報告規格偏差與覆蓋範圍；若專案提供實際 workflow verification entry，使用該 entry 留下可查證結果；只呼叫專案實際存在且未退役的指令
- **NEVER** 把「測試有過」當成可取代 review 的理由
- **NEVER** 因 unattended coordinator merge 降低 review tier；helper authority 邊界依真實風險判 tier
