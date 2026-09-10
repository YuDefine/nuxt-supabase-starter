---
description: 撰寫或修改 rule / SKILL.md / subagent brief / snippet / 落盤文件（pitfall、HANDOFF、TD、digest）的措辭工程——先分類失敗型態再選形式、觸發條件不寫流程、高違規規約配反開脫三件套、長度配讀者要做的決定、發佈前驗證
paths: ['.clade/rules/**/*.md', '.claude/rules/**/*.md', '.claude/skills/**/*.md', 'tasks/lessons.md', 'rules/**/*.md', 'plugins/hub-core/skills/**/*.md', 'claude-md/**/*.md', 'vendor/snippets/**/*.md', 'docs/pitfalls/**/*.md', 'docs/digests/**/*.md', 'docs/tech-debt.md', 'HANDOFF.md']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/rule-authoring.md; edit canonical source -->

<!-- clade-targets: claude -->

# Claude native authoring delivery

Claude's `.claude/rules/` and `.claude/skills/` paths are delivery surfaces for the common authoring contract. Keep canonical edits in `rules/**/*.md` or consumer-local `.clade/rules/**/*.md`; a Claude hook or skill may be cited only when its configured entry and receipt are present.

Historical Claude evidence: the 2026-08-04 sandbox used the `InstructionsLoaded` hook to verify that a `server/**` glob is anchored at the projectRoot containing the `.claude/` instruction root, while `template/server/**` did not match. Preserve that as a Claude historical receipt; it does not establish Codex or Cursor loading.
