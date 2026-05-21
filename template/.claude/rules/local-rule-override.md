---
description: Consumer rules/local/ override clade core rule 時的宣告慣例。
paths: ['.claude/rules/local/**/*.md']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/local-rule-override.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


# Consumer local rule override declaration

繁體中文

`.claude/rules/local/*.md` 是 consumer 自治區（不被 clade sync-rules 覆蓋）。當 local rule **明知**要覆蓋 / 收緊 / 鬆綁 clade 散播下來的 `rules/core/*.md` 規約時，**MUST** 在檔頭前 10 行內加一行 markdown blockquote 宣告：

```markdown
> Overrides: clade rules/core/<path>.md § <section-name>
```

或多條：

```markdown
> Overrides:
> - clade rules/core/proactive-skills.md § Dev Server Auto-Spawn
> - clade rules/core/handoff.md § Mode B 2B.1
```

## Why

- **可審計**：clade audit / propagate 流程可 grep 出「哪些 consumer override 了哪條 clade core rule」，定期 review 是否該把 override 升級成 clade core 的 opt-out hook
- **人類可讀**：consumer 端 agent / 新進 developer 讀到 local rule 直接知道「這條收緊了 clade 預設」
- **grep 友善**：純 markdown blockquote，不需要 YAML parser；用 frontmatter 反而需要 schema 同步成本
- **不溯及既往**：純 hygiene gate；clade audit 對缺宣告的既有 local rule **MUST** 純 warn 不 block

## When to declare

- **MUST** 宣告：明確改變 clade core rule 規範的行為（鬆綁 / 收緊 / 完全替換）
- **MAY** 省略：consumer 純自家業務規約（不對應任何 clade core rule）

判定範例：

| Local rule 場景 | 該宣告嗎？ |
| --- | --- |
| TDMS `no-auto-dev-server.md` 收緊 clade `proactive-skills.md § Dev Server Auto-Spawn` | ✅ 該宣告 |
| TDMS `nfc-uid-input-simulation.md` 規範 NFC UID 模擬（純 TDMS 業務） | ❌ 不需 |
| TDMS `tailscale-fc-supabase-ops.md` 規範 fc-supabase 連線（純 TDMS infra） | ❌ 不需 |
| consumer 加「override clade `commit.md` 的 step 0-C」 | ✅ 該宣告 |

## Grandfathered local rules

2026-05-18 前已存在的 local rule（如 TDMS `no-auto-dev-server.md`）**MAY** 暫緩補宣告。consumer 自家 session 下次 review local rule 時順手補即可。clade audit 對缺宣告的 grandfathered 檔純 warn，不阻擋 propagate / publish。

## 反向課題

若某條 clade core rule 被 ≥ 2 consumer 各自寫 local rule override，這是訊號：clade core rule 設計可能太一刀切，該考慮 refactor 加 opt-out hook（registry config / frontmatter flag / param）。clade Mode D sweep 會把這類 pattern 列為 candidate（rule-section 行動類型）。

## 相關規約

- [[truth-layers]] — 業務數據 truth layers（intent / persistence / contract / API / UI），跟本 rule 是不同維度（規約層 truth source vs 數據層 truth source）
- `rules/local/clade-role-and-todo-discipline.md`（clade 自治區）— consumer 自治區的 local rule 自管原則
- `plugins/hub-core/skills/oops/SKILL.md § Mode D` — sweep 偵測到「同 clade core rule 被多 consumer override」會列為 candidate
