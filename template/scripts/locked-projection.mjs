/**
 * locked-projection.mjs — canonical regex for clade-managed projection paths.
 *
 * Single source of truth for "is this consumer path a clade-projection file?"
 * Shared between:
 *   - wt-helper.mjs (merge-back blocker classification, baseline audit)
 *   - claim-helper / classifyDirtyPaths in wt-helper (Phase 3)
 *   - _validate-manifests.mjs (Phase 6: cross-check against vendor-targets)
 *
 * Closes TD-018: the previous wt-helper-local hardcoded RE drifted from
 * actual sync targets (7 prefixes vs 12+ kinds of files written by propagate).
 *
 * Categories covered:
 *   - Rule / skill / command / agent / hook / scripts injected via sync-rules
 *     into `.claude/<dir>/`
 *   - Derived agent projections at `.agents/`, `.codex/`
 *   - Plumbing JSON: `.claude/hub.json`, `.claude/.hub-state.json`,
 *     `.claude/sync-to-agents.config.json`
 *   - Improvement-loop infra: `.clade/bin/`, `.clade/signals/`
 *   - Vendored scripts at `scripts/` (wt-helper, claim-helper, stash-reconcile,
 *     review-gui, audit-test-scripts, handoff-drift-scan, git-merge-clade-regenerate)
 *   - Recursive vendored script trees: `scripts/spectra-advanced/`,
 *     `scripts/pre-commit/`, `scripts/pre-push/`
 *   - Snippets / shared presets: `vendor/snippets/`, `vendor/oxc-shared/`
 *   - GitHub Composite Actions vendored at `.github/actions/`
 *   - Top-level injected files: `AGENTS.md`, `CLAUDE.md`
 *   - utility: `utils/assert-never.ts`
 *
 * NEVER widen this without (a) ensuring propagate.mjs actually writes the new
 * category, AND (b) confirming consumer auto-reset / wt-helper merge-back
 * classification both honor it.
 */

export const LOCKED_PROJECTION_RE = new RegExp(
  '^(' +
    [
      // Sync-rules injected directories (.claude/)
      String.raw`\.claude/(rules|skills|commands|agents|scripts|hooks)/`,
      // Derived agent projections
      String.raw`\.agents/`,
      String.raw`\.codex/`,
      // Plumbing JSON files
      String.raw`\.claude/(hub\.json|\.hub-state\.json|sync-to-agents\.config\.json)$`,
      // Improvement-loop infra (.clade/)
      String.raw`\.clade/(bin|signals)/`,
      // Vendored script entry points (scripts/)
      String.raw`scripts/(wt-helper|claim-helper|stash-reconcile|review-gui|audit-test-scripts|audit-ux-drift|handoff-drift-scan|git-merge-clade-regenerate|locked-projection|_git-lock-detect)\.(mjs|mts)$`,
      // Recursive vendored script trees
      String.raw`scripts/(spectra-advanced|pre-commit|pre-push)/`,
      // Snippets / shared presets
      String.raw`vendor/(snippets|oxc-shared)/`,
      // GitHub vendored actions
      String.raw`\.github/actions/`,
      // Utility files
      String.raw`utils/assert-never\.ts$`,
      // Top-level injected files
      String.raw`AGENTS\.md$`,
      String.raw`CLAUDE\.md$`,
    ].join('|') +
    ')',
)

export const isLockedProjectionPath = (p) => LOCKED_PROJECTION_RE.test(p)
