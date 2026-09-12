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
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/worktree-default.commit-ceremony.md; edit canonical source -->


<!-- clade-targets: cursor -->

# Cursor worktree commit transport

Cursor may perform a worktree commit only through an authorized native entry whose catalog and result are observed. Subject format, phase batching, and interactive conflict behavior are target-policy fields; the common selective-stage, no-push, scope, and cleanup contracts remain mandatory.
