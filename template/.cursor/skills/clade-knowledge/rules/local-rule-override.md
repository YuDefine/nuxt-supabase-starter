---
description: Consumer 自有規約 override clade core rule 時的宣告慣例。
paths: ['.clade/rules/**/*.md', '.claude/rules/local/**/*.md']
---
<!-- Clade native rule; source: rules/core/local-rule-override.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Consumer local rule override declaration

Consumer 自有規約的中立來源是 `.clade/rules/`；既有 `.claude/rules/local/` 是 consumer 自治區，
在顯式遷移前繼續保留。中立來源依聲明的 targets 產生各端規約，直接修改生成檔會形成
ownership conflict。遷移走 local rule migration 的預覽、來源 hash 驗證與顯式 adoption，
不以同名檔存在取得接管權。

當上述任一 local source **明知**要覆蓋 / 收緊 / 鬆綁 clade 散播下來的 `rules/core/*.md` 規約時，**MUST** 在檔頭前 10 行內加一行 markdown blockquote 宣告：

```markdown
> Overrides: clade rules/core/<path>.md § <section-name>
```

或多條：

```markdown
> Overrides:
> - clade rules/core/proactive-skills.md § Dev Server Auto-Spawn
> - clade rules/core/handoff.md § Mode B 2B.1
```

## When to declare

- **MUST** 宣告：明確改變 clade core rule 規範的行為（鬆綁 / 收緊 / 完全替換）
- **MAY** 省略：consumer 純自家業務規約（不對應任何 clade core rule）

## Grandfathered local rules

2026-05-18 前已存在、缺宣告的 local rule **MAY** 暫緩補宣告（之後新寫的照上節 **MUST** 宣告）；clade audit 對缺宣告的 grandfathered 檔**MUST** 純 warn，不阻擋 propagate / publish。

## 反向課題

某條 clade core rule 被 ≥ 2 consumer 各自 override，是該 rule 太一刀切、該加 opt-out hook 的訊號；`oops` skill 的 Mode D sweep 會把它列為 candidate。
