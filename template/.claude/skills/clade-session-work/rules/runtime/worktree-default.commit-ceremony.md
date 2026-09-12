---
description: Worktree v3 commit 階段 — subagent commit → archive 吸收 → merge-back ceremony → 操作工具（worktree-default §5/§5.5/§6 detail）
paths:
  - 'openspec/changes/**'
  - 'HANDOFF.md'
  - 'vendor/scripts/wt-helper.ts'
  - 'vendor/scripts/stash-reconcile.ts'
  - 'scripts/wt-helper.ts'
  - 'scripts/stash-reconcile.ts'
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/worktree-default.commit-ceremony.md; edit canonical source -->


<!-- clade-targets: claude -->

# Claude worktree commit transport

Claude subagents use the configured worktree dispatch entry and may commit only through the authorized catalog path. The current Claude subject policy is `🧹 chore: wt <slug> — <free-form>`; this is a target presentation rule. Claude `Agent` completion and any interactive conflict question require a recoverable receipt.
