---
description: 撰寫或修改 rule / SKILL.md / subagent brief / snippet / 落盤文件（pitfall、HANDOFF、TD、digest）的措辭工程——先分類失敗型態再選形式、觸發條件不寫流程、高違規規約配反開脫三件套、長度配讀者要做的決定、發佈前驗證
paths: ['.clade/rules/**/*.md', '.claude/rules/**/*.md', '.claude/skills/**/*.md', 'tasks/lessons.md', 'rules/**/*.md', 'plugins/hub-core/skills/**/*.md', 'claude-md/**/*.md', 'vendor/snippets/**/*.md', 'docs/pitfalls/**/*.md', 'docs/digests/**/*.md', 'docs/tech-debt.md', 'HANDOFF.md']
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/rule-authoring.md; edit canonical source -->

<!-- clade-targets: cursor -->

# Cursor native authoring delivery

Cursor receives the common authoring contract through semantic packages under `.cursor/skills/clade-*`. These packages are generated surfaces, not canonical author paths. IDE, CLI, Desktop, and Web skill activation are separate claims and require target-specific evidence.

The Cursor baseline is native rules delivery. An enhanced scoped loader, first-operation guard, or completion receipt may be recorded only when its configured entry is present and the invocation is observed; do not import Codex hook names or Claude `InstructionsLoaded` evidence into Cursor.
