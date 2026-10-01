// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/worktree-backlog.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/worktree-backlog.ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Keep the backlog boundary in the flow delivery closure: unrelated flow entrypoints must
// remain loadable when only the flow projection and its existing runtime dependencies exist.
export const WORKTREE_BACKLOG_LIMIT = 3
export const WORKTREE_STALE_DAYS = 7

/**
 * wt-helper sits next to `vendor/scripts/` only in clade; consumers get it at `scripts/wt-helper.ts`
 * while flow / handoff-scan are projected under `.clade/vendor/scripts/` (vendor-targets.ts).
 * `scriptsDir` is the caller's own `vendor/scripts` directory.
 */
export function resolveWtHelper(root: string, scriptsDir: string): string | null {
  return (
    [join(scriptsDir, 'wt-helper.ts'), join(root, 'scripts', 'wt-helper.ts')].find((path) =>
      existsSync(path),
    ) ?? null
  )
}

export interface WorktreeBacklogEntry {
  path: string
  branch: string
  slug: string
  landedState: string
  daysOld: number | null
  ahead: number | null
  dirty: number | null
  supersededBy: string[]
  action: string
}

export interface WorktreeBacklog {
  exceeded: boolean
  entries: WorktreeBacklogEntry[]
  diagnostics: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isCount(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0)
}

function isEntry(value: unknown): value is WorktreeBacklogEntry {
  if (!isRecord(value)) return false
  return (
    ['path', 'branch', 'slug', 'action'].every(
      (key) => typeof value[key] === 'string' && value[key].length > 0,
    ) &&
    typeof value.landedState === 'string' &&
    // `unchecked`: --no-landed-state budget mode skipped the patch-equivalence probe.
    [
      'in-history',
      'in-base',
      'in-worktree',
      'superseded',
      'clean-apply',
      'conflict',
      'unchecked',
    ].includes(value.landedState) &&
    (value.daysOld === null ||
      (typeof value.daysOld === 'number' && Number.isInteger(value.daysOld))) &&
    isCount(value.ahead) &&
    isCount(value.dirty) &&
    isStringList(value.supersededBy)
  )
}

/** Validate the CLI boundary before a reader presents a disposition or a clean verdict. */
export function parseWorktreeBacklog(value: unknown): WorktreeBacklog {
  if (
    !isRecord(value) ||
    typeof value.exceeded !== 'boolean' ||
    !Array.isArray(value.entries) ||
    !value.entries.every(isEntry) ||
    !isStringList(value.diagnostics) ||
    value.exceeded !== value.entries.length > WORKTREE_BACKLOG_LIMIT
  )
    throw new Error('invalid worktree backlog report')
  return { exceeded: value.exceeded, entries: value.entries, diagnostics: value.diagnostics }
}
