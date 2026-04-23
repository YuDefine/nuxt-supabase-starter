---
description: Scope discipline 規則——不擴散、必登記、不擅改他人成果，避免 AI 工作流吞掉 WIP 或把範圍外問題靜默遺失
globs: ['openspec/**', 'docs/tech-debt.md', 'docs/decisions/**', 'HANDOFF.md']
---

# Scope Discipline

繁體中文 | [English](./scope-discipline.en.md)

**核心命題**：scope discipline 不是「範圍外就裝沒看到」，而是三件事一起成立：

1. **不擴散**
2. **必登記**
3. **不擅改他人成果**

少任何一項，都會讓 AI 工作流默默吞掉風險、遺失 WIP，或把範圍外問題埋進歷史。

## 正確的 scope discipline

| 要素               | 意思                                    | 反例                                           |
| ------------------ | --------------------------------------- | ---------------------------------------------- |
| **不擴散**         | 當前 task 範圍外的檔案 / 模組，不順手改 | 改 A 檔順便重構 B 檔                           |
| **必登記**         | 途中發現的問題、技術債、改進點一律登記  | 「這不在 scope，先不管」然後永遠消失           |
| **不擅改他人成果** | 看到未知 / 未提交 / 跨 session 變更先問 | `git reset --hard`、`git checkout --` 直接清場 |

## 意外發現的登記路徑（強制）

發現範圍外問題時，**MUST** 選一條路徑登記：

| 發現類型                         | 登記位置                               | 做法                                                                 |
| -------------------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| 技術債 / bug / 邊界情況          | `docs/tech-debt.md`                    | 建 `TD-NNN` entry，並在當前 change `tasks.md` 加 `@followup[TD-NNN]` |
| session 尚未完成的 WIP / blocker | `HANDOFF.md`                           | 留下目前狀態、阻擋原因、下一步                                       |
| 未來要做但尚未 propose 的工作    | `openspec/ROADMAP.md` `## Next Moves`  | 以 `high/mid/low` + 依賴關係記錄                                     |
| 當前 change 本身的 scope 漏項    | `spectra-ingest`                       | 更新 proposal / tasks / design artifact                              |
| 架構層級決策                     | `docs/decisions/YYYY-MM-DD-<topic>.md` | 用 ADR 格式記錄                                                      |

**登記後才能回到當前 task。**

## 未知變更的處理方式

看到以下任一狀態時，視為**未知成果**，必須先回報、再行動：

- `git status` 有你不認得的 modified / untracked 檔案
- 有不屬於當前 scope 的 active change / worktree / stash
- `openspec/changes/<name>/` 裡出現你不清楚來源的 artifact

正確流程：

1. 列出未知狀態並告知使用者
2. 問清楚是否為其他 session / 使用者 / subagent 的 WIP
3. 在取得明確指示前，**不清理、不覆寫、不 revert**

## 破壞性指令的 guardrails

以下指令 **MUST** 先經使用者明確同意，且不得在 subagent 內自主執行：

- `git reset --hard`
- `git checkout -- <paths>` / `git restore <paths>`
- `git clean -fd` / `git clean -fdx`
- `git revert <commit>`
- 刪除 `openspec/changes/*`、`.claude/worktrees/*`、或任何含 user-authored 內容的目錄

## Subagent brief 最低要求

委派 subagent 時，scope discipline 段落至少要包含：

```markdown
## Scope Discipline

- 範圍外檔案不要順手改
- 意外發現其他問題：不修，但必登記
- 看到不認識的 uncommitted 變更：停下並回報
- 禁止跑 git reset / git checkout -- / git clean 等破壞性指令
```

## 與其他規則的關係

- `follow-up-register.md`：提供技術債登記與 archive gate
- `handoff.md`：提供跨 session 交接出口
- `knowledge-and-decisions.md`：提供長期知識與 ADR 出口
- `ux-completeness.md`：補上「發現未登記 = 未完成」的完成度觀點

## 禁止事項

- **NEVER** 把「超出 scope」當成忽略發現的理由
- **NEVER** 把未知變更當作「上次沒清乾淨」直接清掉
- **NEVER** 在 subagent 內執行 `git reset` / `git checkout --` / `git clean`
- **NEVER** 寫只有「不擴散」沒有「必登記」的 brief
