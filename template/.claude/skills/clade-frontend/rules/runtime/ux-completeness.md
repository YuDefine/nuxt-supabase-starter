---
description: Runtime adapter fragment for ux-completeness.md
paths: ['tasks/**', 'specs/plans/**', 'app/**/*.vue', 'packages/*/app/**/*.vue', 'shared/types/**/*.ts', 'packages/*/shared/types/**/*.ts', 'supabase/migrations/**']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/ux-completeness.md; edit canonical source -->
<!-- clade-targets: claude -->

# Runtime adapter: Claude

Claude has a verified `.claude/hooks/` integration for the one UX gate that still runs automatically: `plugins/hub-core/hooks/post-edit-ui-qa.sh` fires on every UI edit. The spectra lifecycle gates it used to sit beside (`pre-propose-scan.sh`, `post-propose-check.sh`, `design-inject.sh`, `pre-apply-brief.sh`, `design-gate.sh`, `archive-gate.sh`, `followup-gate.sh`) were retired with the spectra change lifecycle on 2026-09-07; the remaining rows of the base rule are self-checks with no machine behind them. The handoff/model question uses Claude’s `AskUserQuestion` surface.
