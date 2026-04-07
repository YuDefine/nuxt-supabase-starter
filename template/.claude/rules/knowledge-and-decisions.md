# Knowledge & Decisions

## 任務前檢查

涉及既有模組時，**MUST** 先搜 `docs/solutions/` 和 `docs/decisions/` 的歷史經驗與決策，避免重複踩坑或違反既有決策。

## 知識萃取

解決非 trivial 問題後（debug 嘗試 3+ 方法、隱性限制、非直覺解法、workaround），萃取至 `docs/solutions/{category}/`。

- 格式：YAML frontmatter + Problem + What Didn't Work + Solution + Prevention
- 分類與格式詳見 `docs/solutions/README.md`
- 若目錄不存在則建立
- 已有相似記錄 → 更新既有文檔，不新建

## 架構決策記錄（ADR）

做出跨任務影響的技術決策時，記錄至 `docs/decisions/YYYY-MM-DD-{topic}.md`。

格式：

```markdown
# {Decision Title}

## Decision

一句話描述決定了什麼。

## Context

為什麼需要做這個決策？背景和驅動因素。

## Alternatives Considered

- **方案 A** — 描述 + 優缺點
- **方案 B** — 描述 + 優缺點

## Reasoning

為什麼選了這個方案。

## Trade-offs Accepted

接受了哪些代價或風險。

## Supersedes

取代了哪個先前決策（若無則刪除此段）。
```

規劃新功能前 **MUST** 先搜 `docs/decisions/`，除非理由已失效，否則遵循既有決策。

## 規則生命週期

- `docs/solutions/` 中同一 pattern 出現 3+ 次 → **提議**晉升為 `.claude/rules/` 規則
- 既有規則被新事證推翻 → **提議**降級或修訂
- **NEVER** 自動變更規則，一律提議由使用者確認
