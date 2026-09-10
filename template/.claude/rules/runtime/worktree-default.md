<!-- Clade native rule; source: adapters/claude/instructions/rules/core/worktree-default.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude native worktree transport

Claude's native catalog may expose `Skill`, `Agent`, and `AskUserQuestion`; a worktree operation is authorized only when the configured `/wt` skill or agent entry and its completion receipt are present. Session and pane assumptions belong to the Claude transport evidence, not the common worktree contract.
