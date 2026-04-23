---
description: 知識沉澱與決策記錄規則——非直覺問題解法要進 docs/solutions，跨任務技術決策要進 docs/decisions
globs: ['docs/solutions/**', 'docs/decisions/**', 'openspec/**']
---

# Knowledge Accumulation & Decision Records

繁體中文 | [English](./knowledge-and-decisions.en.md)

## 知識萃取（任務結束時）

解決非 trivial 問題後，若符合任一條件，**SHOULD** 萃取到 `docs/solutions/`：

- debug 嘗試 3 種以上方法
- 發現隱性限制或非直覺行為
- 使用 workaround 才能完成
- 同一類問題很可能再出現

建議格式：

- YAML frontmatter（category / tags / date）
- Problem
- What Didn't Work
- Solution
- Prevention

## 架構決策記錄（ADR）

做出影響超出當前任務的技術決策時，**MUST** 評估是否寫入 `docs/decisions/YYYY-MM-DD-<topic>.md`。

典型觸發：

- 選框架 / 套件 / 儲存方案
- 改變分層或資料流
- 決定重要 trade-off
- 替換舊做法

建議格式：

```markdown
## Decision

最終決定。

## Context

背景與限制。

## Alternatives Considered

- 方案 A — 優缺點
- 方案 B — 優缺點

## Reasoning

為什麼這次選它。

## Trade-offs Accepted

接受的代價。

## Supersedes

若取代舊決策，連回舊檔案。
```

## 任務前檢查（輕量）

開始處理既有模組前，優先檢查：

1. `docs/solutions/` 是否已有相似問題
2. `docs/decisions/` 是否已有既定方向

找到既有結論時，預設遵循；若理由已失效，再提出更新。

## 規則生命週期

- `docs/solutions/` 中反覆出現的 pattern（3 次以上）→ 可提議升級為 `.claude/rules/`
- 既有規則被新事證推翻 → 可提議降級或移除
- **不自動晉升 / 降級**，一律先提議，再由使用者決定
