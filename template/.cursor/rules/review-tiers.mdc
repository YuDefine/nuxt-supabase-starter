---
description: Review Tier 定義——依變更大小與風險決定 review 嚴格程度，對齊 spectra-audit 與 code-review 觸發門檻
---

# Review Tier 定義

變更大小 / 風險面向決定 review 的嚴格程度。

- **Tier 1**（< 50 行, 非敏感）：inline self-review
- **Tier 2**（50+ 行）：`spectra-audit` + `code-review` agent
- **Tier 3**（migration / RLS / auth / SQL）：`spectra-audit` + `code-review` agent

## 觸發判斷

| 條件                                                          | Tier |
| ------------------------------------------------------------- | ---- |
| 只改 `docs/` / `openspec/` / `.claude/rules/` / README / 註解 | 1    |
| 改 `.claude/skills/` 的 vendor copy（會被 install 覆蓋）      | 1    |
| 重構 / 功能變更 < 50 行 non-敏感                              | 1    |
| 功能變更 ≥ 50 行                                              | 2    |
| 動到 `supabase/migrations/`                                   | 3    |
| 動到 RLS policy（`CREATE POLICY` / `ALTER POLICY`）           | 3    |
| 動到 auth middleware / `server/api/auth/`                     | 3    |
| 動到 raw SQL（RPC / view / trigger / function）               | 3    |
| 動到 `.github/workflows/` 或 hooks（`.claude/hooks/`）        | 2    |
| 動到 `scripts/spectra-ux/` gate scripts                       | 2    |

## 規則

- Tier 1 可以由作者自行 review 後直接 commit
- Tier 2 / 3 **必須**先跑 `spectra-audit` skill，再派 `code-review` agent
- Tier 3 若同時涉及 migration + RLS，兩者必須在同一個 PR 一起 review（避免 policy 先上、欄位後到）
- Tier 2 / 3 的 commit 走 `/commit` skill（已內建 simplify + code-review 閘門），**不得**使用 raw `git commit`

## 與既有規則的關係

- `commit.md`：`/commit` skill 是所有 commit 的強制入口，這裡定義的 tier 決定 `/commit` 執行哪個嚴格度
- `proactive-skills.md` Spectra 觸發表：自動觸發 `spectra-audit` 的時機參考本 tier
- `manual-review.md`：Tier 3 的人工檢查項目不得由 agent 自行標記完成
