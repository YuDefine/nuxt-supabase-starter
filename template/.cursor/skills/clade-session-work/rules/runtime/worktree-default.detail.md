---
description: Worktree 全文規約（§1 pre-fork baseline guard 四條契約與 archive-on-main clobber 窗口、§3 命名與位置、§4 與 propagate 的互動、§5 commit 階段、§5.5 merge-back ceremony 與 claim guard scope、§5.5.1 pre-archive gate 的掃描根目錄、§6–§11 工具與 troubleshooting 索引）；always-load 的薄 pointer 在 [[worktree-default]]，觸發時機是「送出 wt-helper add / merge-back / 任何 worktree 操作之前」，由 [[worktree-default]] 的 MUST-Read 指針叫醒
paths: ['vendor/scripts/wt-helper.ts', 'scripts/wt-helper.ts', 'vendor/scripts/stash-reconcile.ts', 'scripts/stash-reconcile.ts', '**/WORKTREE-BRIEF.md', '**/hooks/pre-archive-*.sh']
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/worktree-default.detail.md; edit canonical source -->


<!-- clade-targets: cursor -->

# Cursor worktree detail transport

Cursor dispatch must use the actual configured native command or agent carrier. Do not substitute Claude `Agent`, Codex collaboration, or an unverified browser surface. Preserve common WIP, stash, and landing gates and retain the target completion receipt.
