// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/wt-patch-landing.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/wt-patch-landing.ts
import { execFileSync, spawnSync } from 'node:child_process'

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** Both rename endpoints matter: overwriting the old name is also a collision. */
function dirtyPaths(cwd: string): string[] {
  const records = git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0')
  const paths: string[] = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    paths.push(record.slice(3))
    if (/[RC]/.test(record.slice(0, 2))) paths.push(records[++i])
  }
  return paths
}

function apply(cwd: string, patch: string, flags: string[]) {
  const result = spawnSync('git', ['apply', ...flags, '-'], {
    cwd,
    input: patch,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.signal) throw new Error(`git apply interrupted: ${result.signal}`)
  return result
}

/** Legacy transport only; caller checks batch admission and publish ownership first. */
export function landWorktreePatch(main: string, source: string, branch: string, dryRun = false) {
  const tip = git(main, ['rev-parse', '--verify', `${branch}^{commit}`]).trim()
  const base = git(main, ['merge-base', 'HEAD', tip]).trim()
  const sourceDirty = dirtyPaths(source)
  if (sourceDirty.length)
    throw new Error(`--patch blocked: worktree has WIP:\n${sourceDirty.join('\n')}`)
  const paths = git(main, ['diff', '--no-renames', '--name-only', '-z', base, tip])
    .split('\0')
    .filter(Boolean)
  const patch = git(main, [
    'diff',
    // Pin the patch format: diff.noprefix / mnemonicPrefix / color.diff=always would otherwise
    // make `git apply` see a false conflict or a false already-present.
    '--no-color',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--binary',
    base,
    tip,
  ])
  if (!patch) return { applied: false, dryRun, paths, reason: 'empty-changeset' }

  // Repeating a patch landing is a no-op, not authority to destroy its recoverable source.
  if (apply(main, patch, ['--check', '--reverse']).status === 0)
    return { applied: false, dryRun, paths, reason: 'already-present' }

  const blockers = dirtyPaths(main).filter((dirty) =>
    paths.some(
      (path) => dirty === path || dirty.startsWith(`${path}/`) || path.startsWith(`${dirty}/`),
    ),
  )
  const check = apply(main, patch, ['--check'])
  const problem = blockers.length
    ? `overlapping main dirty paths:\n${blockers.join('\n')}`
    : check.status !== 0
      ? `patch conflict:\n${check.stderr}`
      : null
  if (problem) {
    if (dryRun) return { applied: false, dryRun, paths, blockers, reason: problem }
    throw new Error(`--patch blocked: ${problem}`)
  }
  if (dryRun) return { applied: false, dryRun, paths, reason: 'clean-apply' }

  // git apply without --index/--cached is atomic and leaves unrelated index entries intact.
  const result = apply(main, patch, [])
  if (result.status !== 0) throw new Error(`--patch failed: ${result.stderr}`)
  return { applied: true, dryRun, paths, reason: 'pending-commit' }
}
