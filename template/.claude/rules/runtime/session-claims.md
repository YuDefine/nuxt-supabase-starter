---
description: 多 session 並行下「哪些路徑屬於別 session 還活著的工作」的判定規格——claim 檔 schema、寫 / refresh / drop 時機、誰讀、stale 處理、claim-helper CLI，以及 ownership provenance journal 的寫入時證據與 other-live / orphan / unknown 三分類
paths: ['.clade/claims/**', 'HANDOFF.md', 'plugins/hub-core/hooks/pre-bash-ownership-stamp.sh', 'scripts/claim-helper.ts', 'vendor/scripts/claim-helper.ts', 'vendor/scripts/ownership-journal.ts', 'vendor/scripts/flow/who.ts', '.clade/ownership/**', 'plugins/hub-core/hooks/post-tool-ownership-journal.sh', 'plugins/hub-core/hooks/pre-edit-claim-conflict.sh']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/session-claims.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude claim event adapter

Install the claim heartbeat and ownership journal on Claude `SessionStart`, `PreToolUse`, and `PostToolUse` events. The hook reads the harness-provided session identity and paths; the model cannot self-report them. `herdr agent list` may corroborate session presence, but pane labels and model prose are not ownership evidence.
