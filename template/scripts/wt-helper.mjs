#!/usr/bin/env node

/**
 * wt-helper.mjs — session worktree management
 *
 * Subcommands:
 *   add <slug>       Create worktree at ~/offline/<consumer>-wt/<slug>/
 *                    on branch session/<YYYY-MM-DD-HHMM>-<slug>; post-create
 *                    fast-forward merge origin/main so projection layers
 *                    (rules/, scripts/, etc.) are current.
 *   list [--json]    Enumerate session worktrees with path, branch,
 *                    last-commit ISO timestamp, days-since-touch, merged flag.
 *   prune            Interactively remove worktrees whose branches are
 *                    already merged into main. Per-entry [y/N] confirm.
 *   cleanup <slug>   Remove one session worktree by slug. Requires --force
 *                    if branch not merged AND --force-discard-unland if
 *                    branch HEAD has files NOT landed into main's working
 *                    tree. Pre-checks both gates and reports the full flag
 *                    combo needed.
 *   merge-back <slug> [--dry-run] [--auto-stash] [--no-cleanup]
 *                    Atomic ceremony: squash session branch into main +
 *                    cleanup worktree. Pre-flight detects main-worktree
 *                    blockers (modified or untracked files at branch's
 *                    changeset paths). With --auto-stash, stashes blockers
 *                    as `wt-merge-block/<slug>/<ISO>` for later reconcile
 *                    via stash-reconcile.mjs.
 *   land-pending <slug> [opts]
 *                    Alias for merge-back. Semantic marker for migrating
 *                    grandfathered worktrees from the pre-atomic flow
 *                    (worktree-default.md §7).
 *   rescue           List pre-fork baseline rescue candidates: pinned
 *                    `refs/wt-baseline/*` (cmdAdd stash strategy + post-2026-05-17
 *                    pin) and fsck-found dangling unreachable wt-baseline
 *                    stashes (fallback). --show <ref|sha> prints the full
 *                    patch via `git stash show -p`.
 *
 * Consumer-root resolution: walks up from cwd to the first `.git` (file or
 * directory), then uses `git rev-parse --git-common-dir` to canonicalize —
 * this works whether cwd is in the main worktree, a monorepo subdirectory,
 * or already inside a session worktree.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'

function git(args, opts = {}) {
  const out = execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  })
  return out ? out.trim() : ''
}

function findConsumerRoot(start = process.cwd()) {
  let dir = resolve(start)
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.git'))) break
    dir = dirname(dir)
  }
  if (!existsSync(join(dir, '.git'))) {
    throw new Error('Not inside a git repository (no .git found in any parent)')
  }
  const commonDirRaw = git(['rev-parse', '--git-common-dir'], { cwd: dir })
  const commonDir = resolve(dir, commonDirRaw)
  return dirname(commonDir)
}

function makeSlugSafe(s) {
  const cleaned = String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (!cleaned) throw new Error(`Slug normalizes to empty: ${JSON.stringify(s)}`)
  return cleaned
}

const pad2 = (n) => String(n).padStart(2, '0')

function timestampPrefix(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`
}

function parseWorktreeList(porcelain) {
  const records = porcelain.split(/\n\n+/)
  const result = []
  for (const r of records) {
    if (!r.trim()) continue
    const entry = {}
    for (const line of r.split('\n')) {
      const idx = line.indexOf(' ')
      if (idx < 0) {
        entry[line] = ''
      } else {
        entry[line.slice(0, idx)] = line.slice(idx + 1)
      }
    }
    if (entry.worktree) {
      result.push({
        path: entry.worktree,
        head: entry.HEAD,
        branch: entry.branch || null,
        detached: Object.prototype.hasOwnProperty.call(entry, 'detached'),
      })
    }
  }
  return result
}

function mergedBranches(cwd, baseBranch = 'main') {
  let raw = ''
  try {
    raw = git(['branch', '--merged', baseBranch], { cwd })
  } catch {
    return new Set()
  }
  const set = new Set()
  for (const line of raw.split('\n')) {
    const b = line.replace(/^[*+]?\s*/, '').trim()
    if (b) set.add(b)
  }
  return set
}

function sessionWorktrees(cwd) {
  const out = git(['worktree', 'list', '--porcelain'], { cwd })
  return parseWorktreeList(out).filter(
    (w) => w.branch && w.branch.startsWith('refs/heads/session/')
  )
}

async function prompt(question) {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

async function cmdAdd(slug, opts = {}) {
  if (!slug) {
    throw new Error(
      'Usage: wt-helper add <slug> [--precheck-baseline [<change>]] [--baseline-strategy commit|stash|warn] [--baseline-scope-paths <comma>] [--baseline-stash-name <name>]'
    )
  }
  const cleanSlug = makeSlugSafe(slug)
  const consumerRoot = findConsumerRoot()
  const name = basename(consumerRoot)
  const branch = `session/${timestampPrefix()}-${cleanSlug}`
  const wtPath = join(dirname(consumerRoot), `${name}-wt`, cleanSlug)

  if (existsSync(wtPath)) {
    throw new Error(`Worktree path already exists: ${wtPath}`)
  }

  let baseRef = 'main'
  try {
    git(['rev-parse', '--verify', baseRef], { cwd: consumerRoot })
  } catch {
    throw new Error(`Base branch "${baseRef}" not found in ${consumerRoot}`)
  }

  // Pre-fork baseline guard (only when --precheck-baseline given).
  // Strategies: commit (selective stage + commit baseline on main),
  // stash  (push -u stash on main → apply inside new worktree),
  // warn   (stop with report — caller decides).
  // Unmerged paths always stop, regardless of strategy.
  let pendingStashName = null
  let pendingBaselineRef = null
  if (opts.precheckBaseline !== undefined) {
    const dirty = detectMainDirty(consumerRoot)
    if (dirty.conflicted.length > 0) {
      const preview = dirty.conflicted
        .slice(0, 10)
        .map((c) => `  ${c.status}  ${c.path}`)
        .join('\n')
      const more =
        dirty.conflicted.length > 10 ? `\n  ... and ${dirty.conflicted.length - 10} more` : ''
      throw new Error(
        `Pre-fork baseline guard: main has ${dirty.conflicted.length} unmerged path(s):\n` +
          preview +
          more +
          `\n\nResolve conflicts manually before fork. wt-helper refuses to auto-handle unmerged paths.`
      )
    }
    const dirtyCount = dirty.modified.length + dirty.untracked.length
    if (dirtyCount > 0) {
      const strategy = opts.baselineStrategy || 'warn'
      if (strategy === 'commit') {
        const scopePaths = String(opts.baselineScopePaths || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (scopePaths.length === 0) {
          const dirtyPreview = [
            ...dirty.modified.map((m) => `  ${m.status}  ${m.path}`),
            ...dirty.untracked.map((u) => `  ??  ${u.path}`),
          ]
            .slice(0, 10)
            .join('\n')
          throw new Error(
            `Pre-fork baseline guard: --baseline-strategy=commit requires --baseline-scope-paths <comma-list>.\n` +
              `Dirty files (${dirtyCount}):\n${dirtyPreview}`
          )
        }
        const changeLabel = opts.precheckBaseline || cleanSlug
        const message = `baseline: ${changeLabel} pre-fork sync`
        console.log(
          `Pre-fork baseline: selective commit ${scopePaths.length} path(s) → "${message}"`
        )
        gitSelectiveCommit(consumerRoot, scopePaths, message)
      } else if (strategy === 'stash') {
        const iso = new Date().toISOString().replace(/[:.]/g, '-')
        const stashName = opts.baselineStashName || `wt-baseline/${cleanSlug}/${iso}`
        const baselineRef = `refs/wt-baseline/${cleanSlug}/${iso}`
        console.log(`Pre-fork baseline: stash ${dirtyCount} file(s) as '${stashName}'`)
        git(['stash', 'push', '-u', '-m', stashName], {
          cwd: consumerRoot,
          stdio: 'inherit',
        })
        pendingStashName = stashName
        pendingBaselineRef = baselineRef
      } else if (strategy === 'warn') {
        const preview = [
          ...dirty.modified.map((m) => `  ${m.status}  ${m.path}`),
          ...dirty.untracked.map((u) => `  ??  ${u.path}`),
        ]
          .slice(0, 20)
          .join('\n')
        const more = dirtyCount > 20 ? `\n  ... and ${dirtyCount - 20} more` : ''
        throw new Error(
          `Pre-fork baseline guard: main has ${dirtyCount} dirty file(s) and --baseline-strategy=warn:\n` +
            preview +
            more +
            `\n\nPick a strategy and re-run with --baseline-strategy commit|stash, or commit/stash manually before fork.`
        )
      } else {
        throw new Error(
          `Pre-fork baseline guard: unknown --baseline-strategy "${strategy}" (expected commit|stash|warn)`
        )
      }
    }
  }

  console.log(`Creating worktree: ${wtPath}`)
  console.log(`Branch: ${branch}`)
  git(['worktree', 'add', '-b', branch, wtPath, baseRef], {
    cwd: consumerRoot,
    stdio: 'inherit',
  })

  let hasOriginMain = false
  try {
    git(['rev-parse', '--verify', 'origin/main'], { cwd: wtPath })
    hasOriginMain = true
  } catch {}
  if (hasOriginMain) {
    try {
      git(['merge', '--ff-only', 'origin/main'], { cwd: wtPath, stdio: 'inherit' })
    } catch {
      console.error('warn: could not fast-forward merge origin/main; worktree may need manual sync')
    }
  }

  // Apply pre-fork baseline stash inside the freshly-created worktree (stash
  // strategy). Before dropping from `git stash list`, pin the stash commit
  // under `refs/wt-baseline/<slug>/<iso>` so the object stays reachable even
  // after worktree cleanup. Without this pin, the stash becomes unreachable
  // and the 47+ baseline files live only in the worktree's working tree —
  // `wt-helper cleanup` then permanently destroys them (incident: TDMS
  // 2026-05-17, kpi-prod-design-review-refresh). `wt-helper rescue` lists
  // these refs for recovery.
  if (pendingStashName) {
    try {
      git(['stash', 'apply', 'stash@{0}'], { cwd: wtPath, stdio: 'inherit' })
      const stashSha = git(['rev-parse', 'stash@{0}'], { cwd: consumerRoot })
      git(['update-ref', pendingBaselineRef, stashSha], { cwd: consumerRoot })
      git(['stash', 'drop', 'stash@{0}'], { cwd: consumerRoot, stdio: 'inherit' })
      console.log(
        `Pre-fork baseline: stash '${pendingStashName}' applied to worktree; pinned as '${pendingBaselineRef}' (permanently reachable — use 'wt-helper rescue' to inspect/restore).`
      )
    } catch (e) {
      console.error(
        `warn: stash apply to worktree failed; stash '${pendingStashName}' preserved in 'git stash list' for manual recovery.`
      )
      console.error(`error detail: ${e?.message ?? e}`)
    }
  }

  console.log('')
  console.log('Worktree ready.')
  console.log(`  cd ${wtPath}`)
  console.log(`  Branch: ${branch}`)
  console.log('')
  console.log(
    'Open a new Claude Code or Codex session in the worktree path to continue work isolated from main.'
  )
}

async function cmdDetectMainDirty(opts) {
  const consumerRoot = findConsumerRoot()
  const dirty = detectMainDirty(consumerRoot)
  if (opts.json) {
    console.log(JSON.stringify(dirty, null, 2))
    return
  }
  const total = dirty.modified.length + dirty.untracked.length + dirty.conflicted.length
  if (total === 0) {
    console.log('main worktree clean')
    return
  }
  console.log(`main worktree has ${total} dirty path(s):`)
  for (const c of dirty.conflicted) {
    console.log(`  conflicted ${c.status}  ${c.path}`)
  }
  for (const m of dirty.modified) {
    console.log(`  modified   ${m.status}  ${m.path}`)
  }
  for (const u of dirty.untracked) {
    console.log(`  untracked       ${u.path}`)
  }
}

function enrichWorktree(consumerRoot, w, now = Date.now()) {
  const branchName = w.branch.replace('refs/heads/', '')
  let lastCommitSec = 0
  try {
    lastCommitSec = parseInt(
      git(['log', '-1', '--format=%ct', branchName], { cwd: consumerRoot }),
      10
    )
  } catch {}
  const lastCommitMs = Number.isFinite(lastCommitSec) ? lastCommitSec * 1000 : 0
  const daysOld = lastCommitMs ? Math.floor((now - lastCommitMs) / 86_400_000) : null
  const merged = mergedBranches(consumerRoot).has(branchName)
  return {
    path: w.path,
    branch: branchName,
    lastCommit: lastCommitMs ? new Date(lastCommitMs).toISOString() : null,
    daysOld,
    mergedToMain: merged,
  }
}

async function cmdList(opts) {
  const consumerRoot = findConsumerRoot()
  const wts = sessionWorktrees(consumerRoot)
  const enriched = wts.map((w) => enrichWorktree(consumerRoot, w))

  if (opts.json) {
    console.log(JSON.stringify(enriched, null, 2))
    return
  }

  if (enriched.length === 0) {
    console.log('No session worktrees.')
    return
  }
  for (const w of enriched) {
    const ageLabel = w.daysOld === null ? '?' : `${w.daysOld}d`
    const mergedTag = w.mergedToMain ? ', merged' : ''
    console.log(`${w.branch}  (${ageLabel} ago${mergedTag})`)
    console.log(`  ${w.path}`)
  }
}

async function cmdPrune() {
  const consumerRoot = findConsumerRoot()
  const wts = sessionWorktrees(consumerRoot)
  const merged = mergedBranches(consumerRoot)
  const candidates = wts.filter((w) => merged.has(w.branch.replace('refs/heads/', '')))

  if (candidates.length === 0) {
    console.log('No merged session worktrees to prune.')
    return
  }

  for (const c of candidates) {
    const branchName = c.branch.replace('refs/heads/', '')
    const ans = (await prompt(`Remove worktree ${c.path} (branch ${branchName})? [y/N] `))
      .trim()
      .toLowerCase()
    if (ans === 'y' || ans === 'yes') {
      git(['worktree', 'remove', c.path], { cwd: consumerRoot })
      try {
        git(['branch', '-d', branchName], { cwd: consumerRoot })
      } catch {
        console.error(`warn: branch ${branchName} could not be deleted; keep manually`)
      }
      console.log(`Removed ${c.path}`)
    } else {
      console.log(`Skipped ${c.path}`)
    }
  }
}

// Unmerged XY status codes from `git status --porcelain` (per git-status(1)
// "Short Format" → "Unmerged entries"). Used by both pre-fork baseline guard
// and merge-back to refuse auto-handling of in-conflict paths.
const UNMERGED_XY = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

// Detect dirty paths in main's working tree (modified / untracked / unmerged).
// Used by pre-fork baseline guard in cmdAdd + by `detect-main-dirty` subcommand
// for callers (spectra-apply Step 0) that need to decide commit-vs-stash-vs-stop
// before fork creates a worktree blind to main's working state.
//
// IMPORTANT: same parsing constraint as detectMergeBlockers — cannot use the
// `git()` helper because it trims output, eating the leading space in porcelain
// XY format (e.g., ` M README.md` → `M README.md`) and breaking column parsing.
function detectMainDirty(consumerRoot) {
  let statusRaw = ''
  try {
    statusRaw = execFileSync('git', ['status', '--porcelain'], {
      cwd: consumerRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return { modified: [], untracked: [], conflicted: [] }
  }

  const modified = []
  const untracked = []
  const conflicted = []
  for (const line of statusRaw.split('\n')) {
    if (line.length < 4) continue
    const status = line.slice(0, 2)
    const path = line.slice(3)
    if (UNMERGED_XY.has(status)) {
      conflicted.push({ path, status })
    } else if (status === '??') {
      untracked.push({ path })
    } else {
      modified.push({ path, status })
    }
  }
  return { modified, untracked, conflicted }
}

// Stage a specific path list + commit — never `git add -A`, which would catch
// cross-session WIP. Used by pre-fork baseline guard's `commit` strategy.
function gitSelectiveCommit(consumerRoot, scopePaths, message) {
  if (!Array.isArray(scopePaths) || scopePaths.length === 0) {
    throw new Error('gitSelectiveCommit: scopePaths must be a non-empty array')
  }
  git(['add', '--', ...scopePaths], { cwd: consumerRoot, stdio: 'inherit' })
  git(['commit', '-m', message], { cwd: consumerRoot, stdio: 'inherit' })
}

// Detect files in main's working tree that would block `git merge --squash <branch>`:
// any branch-modified path that is either staged/unstaged-modified or untracked in main.
//
// IMPORTANT: cannot use the `git()` helper here — it trims output which would eat
// the leading space in porcelain format (e.g., ` M README.md` → `M README.md`),
// breaking the column-precise XY/space/path parsing.
function detectMergeBlockers(consumerRoot, branchName) {
  let branchFiles = []
  try {
    const out = git(['diff', '--name-only', `main..${branchName}`], { cwd: consumerRoot })
    branchFiles = out.split('\n').filter(Boolean)
  } catch {
    return []
  }
  if (branchFiles.length === 0) return []

  let statusRaw = ''
  try {
    statusRaw = execFileSync('git', ['status', '--porcelain'], {
      cwd: consumerRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return []
  }

  const modifiedSet = new Set()
  const untrackedSet = new Set()
  for (const line of statusRaw.split('\n')) {
    if (line.length < 4) continue
    const status = line.slice(0, 2)
    const path = line.slice(3)
    if (status === '??') untrackedSet.add(path)
    else modifiedSet.add(path)
  }

  const blockers = []
  for (const f of branchFiles) {
    if (modifiedSet.has(f)) blockers.push({ path: f, type: 'modified' })
    else if (untrackedSet.has(f)) blockers.push({ path: f, type: 'untracked' })
  }
  return blockers
}

// Detect uncommitted files in a session worktree's working tree. These would
// be permanently destroyed by `git worktree remove --force` — distinct from
// detectUnlandedFiles which only checks committed branch HEAD vs main. Gate
// added after TDMS 2026-05-17 incident where 47 baseline files lived only in
// the worktree's working tree (applied from stash, never committed) and
// vanished on cleanup.
function detectUncommittedWorktreeFiles(wtPath) {
  let statusRaw = ''
  try {
    statusRaw = execFileSync('git', ['status', '--porcelain'], {
      cwd: wtPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return { modified: [], untracked: [] }
  }
  const modified = []
  const untracked = []
  for (const line of statusRaw.split('\n')) {
    if (line.length < 4) continue
    const status = line.slice(0, 2)
    const path = line.slice(3)
    if (status === '??') untracked.push({ path })
    else modified.push({ path, status })
  }
  return { modified, untracked }
}

function detectUnlandedFiles(consumerRoot, branchName) {
  let branchFiles = []
  try {
    const out = git(['diff', '--name-only', `main..${branchName}`], { cwd: consumerRoot })
    branchFiles = out.split('\n').filter(Boolean)
  } catch {
    return []
  }
  const unlanded = []
  for (const f of branchFiles) {
    try {
      git(['diff', '--quiet', branchName, '--', f], { cwd: consumerRoot })
    } catch {
      unlanded.push(f)
    }
  }
  return unlanded
}

async function cmdCleanup(slug, opts) {
  if (!slug)
    throw new Error(
      'Usage: wt-helper cleanup <slug> [--force] [--force-discard-unland] [--force-discard-uncommitted]'
    )
  const cleanSlug = makeSlugSafe(slug)
  const consumerRoot = findConsumerRoot()
  const wts = sessionWorktrees(consumerRoot)
  const target = wts.find(
    (w) => w.path.endsWith(`/${cleanSlug}`) && w.branch && w.branch.endsWith(`-${cleanSlug}`)
  )
  if (!target) throw new Error(`No session worktree found for slug: ${cleanSlug}`)

  const branchName = target.branch.replace('refs/heads/', '')

  // Pre-check ALL gates upfront so the error message can recommend the
  // full flag combo in one go, rather than ping-ponging the user between
  // --force / --force-discard-unland / --force-discard-uncommitted.
  // The third gate (uncommitted) was added after TDMS 2026-05-17 incident
  // where 47 baseline files lived only in the worktree's working tree
  // (applied from stash, never committed) and vanished on cleanup.
  const branchMerged = mergedBranches(consumerRoot).has(branchName)
  const unlanded = detectUnlandedFiles(consumerRoot, branchName)
  const uncommitted = detectUncommittedWorktreeFiles(target.path)
  const uncommittedCount = uncommitted.modified.length + uncommitted.untracked.length
  const needsForce = !branchMerged && !opts.force
  const needsDiscardUnland = unlanded.length > 0 && !opts.forceDiscardUnland
  const needsDiscardUncommitted = uncommittedCount > 0 && !opts.forceDiscardUncommitted

  if (needsForce || needsDiscardUnland || needsDiscardUncommitted) {
    const issues = []
    if (needsForce) {
      issues.push(`- Branch ${branchName} is not merged into main (gated by --force)`)
    }
    if (needsDiscardUnland) {
      const preview = unlanded
        .slice(0, 10)
        .map((f) => `    - ${f}`)
        .join('\n')
      const more = unlanded.length > 10 ? `\n    ... and ${unlanded.length - 10} more` : ''
      issues.push(
        `- Branch ${branchName} has ${unlanded.length} file(s) whose content is NOT present in main's working tree (gated by --force-discard-unland):\n${preview}${more}`
      )
    }
    if (needsDiscardUncommitted) {
      const preview = [
        ...uncommitted.modified.slice(0, 10).map((m) => `    - ${m.status}  ${m.path}`),
        ...uncommitted.untracked.slice(0, 10).map((u) => `    - ??  ${u.path}`),
      ]
        .slice(0, 10)
        .join('\n')
      const more = uncommittedCount > 10 ? `\n    ... and ${uncommittedCount - 10} more` : ''
      issues.push(
        `- Worktree '${target.path}' has ${uncommittedCount} uncommitted file(s) that will be permanently destroyed by 'git worktree remove --force' (gated by --force-discard-uncommitted):\n${preview}${more}`
      )
    }
    const flagsNeeded = []
    if (needsForce) flagsNeeded.push('--force')
    if (needsDiscardUnland) flagsNeeded.push('--force-discard-unland')
    if (needsDiscardUncommitted) flagsNeeded.push('--force-discard-uncommitted')
    throw new Error(
      `Cleanup blocked by ${issues.length} gate(s):\n` +
        issues.join('\n') +
        `\n\nResolution — re-run with the full flag combo:\n` +
        `  node scripts/wt-helper.mjs cleanup ${cleanSlug} ${flagsNeeded.join(' ')}\n` +
        `\nWhy each gate:\n` +
        `  --force                       discards the unmerged branch ref\n` +
        `  --force-discard-unland        acknowledges branch's commits will be lost\n` +
        `                                (their content never made it into main)\n` +
        `  --force-discard-uncommitted   acknowledges worktree's uncommitted files\n` +
        `                                (modified/untracked, including pre-fork baseline\n` +
        `                                 applied from stash) will be permanently destroyed\n` +
        `\nUse \`wt-helper merge-back ${cleanSlug}\` first if you want to commit the work,\n` +
        `or \`wt-helper rescue\` to see pinned pre-fork baselines available for restore.`
    )
  }

  const removeArgs = ['worktree', 'remove']
  if (opts.force) removeArgs.push('--force')
  removeArgs.push(target.path)
  git(removeArgs, { cwd: consumerRoot })
  try {
    git(['branch', opts.force ? '-D' : '-d', branchName], { cwd: consumerRoot })
  } catch {
    console.error(`warn: branch ${branchName} could not be deleted; keep manually`)
  }
  console.log(`Removed ${target.path}`)
}

// Atomic ceremony: stash main blockers (optional) → squash session branch
// into main → cleanup worktree. Designed to be called from spectra-archive
// Step 0 (auto, slug = change name) or manually (ad-hoc Form-1 worktrees).
async function cmdMergeBack(slug, opts = {}) {
  if (!slug) {
    throw new Error(
      'Usage: wt-helper merge-back <slug> [--dry-run] [--auto-stash] [--include-worktree-wip] [--no-cleanup] [--noop-if-missing]'
    )
  }
  const cleanSlug = makeSlugSafe(slug)
  const consumerRoot = findConsumerRoot()
  const wts = sessionWorktrees(consumerRoot)
  const target = wts.find(
    (w) => w.path.endsWith(`/${cleanSlug}`) && w.branch && w.branch.endsWith(`-${cleanSlug}`)
  )
  if (!target) {
    if (opts.noopIfMissing) {
      console.log(`merge-back: no session worktree for ${cleanSlug} (no-op)`)
      return { absorbed: false, slug: cleanSlug, reason: 'no-worktree' }
    }
    throw new Error(`No session worktree found for slug: ${cleanSlug}`)
  }

  const branchName = target.branch.replace('refs/heads/', '')
  const blockers = detectMergeBlockers(consumerRoot, branchName)

  // Pre-flight: worktree dirty tracked-file check (TDMS-1J 2026-05-18 incident).
  // detectMergeBlockers only catches files in main that would be overwritten;
  // it doesn't see edits inside the worktree that were never committed. Without
  // this check, `git merge --squash` silently drops worktree WIP, then cleanup
  // permanently destroys the worktree → WIP gone with no recovery path.
  //
  // Filter clade-managed projection paths (.agents/, .codex/, hub.json,
  // wt-helper.mjs itself): those are propagate residue, not user WIP, and they
  // re-materialize on next propagate. User code (server/, src/, app/, ...)
  // and untracked files are real WIP and must be committed before squash.
  const CLADE_MANAGED_PREFIXES = ['.agents/', '.codex/']
  const CLADE_MANAGED_EXACT = new Set([
    '.claude/hub.json',
    '.claude/.hub-state.json',
    'scripts/wt-helper.mjs',
  ])
  const isCladeManagedPath = (p) =>
    CLADE_MANAGED_PREFIXES.some((pre) => p.startsWith(pre)) || CLADE_MANAGED_EXACT.has(p)
  const wtDirty = detectUncommittedWorktreeFiles(target.path)
  const wtUserDirty = [
    ...wtDirty.modified
      .filter((m) => !isCladeManagedPath(m.path))
      .map((m) => ({ ...m, kind: 'modified' })),
    ...wtDirty.untracked
      .filter((u) => !isCladeManagedPath(u.path))
      .map((u) => ({ ...u, status: '??', kind: 'untracked' })),
  ]

  // Surface pinned pre-fork baselines for this slug so the user knows what's
  // available for rescue if cleanup later detects uncommitted-baseline loss
  // (cmdCleanup --force-discard-uncommitted gate, post-TDMS 2026-05-17 fix).
  let baselineRefs = []
  try {
    const raw = git(['for-each-ref', '--format=%(refname)', `refs/wt-baseline/${cleanSlug}/`], {
      cwd: consumerRoot,
    })
    baselineRefs = raw.split('\n').filter(Boolean)
  } catch {}

  if (opts.dryRun) {
    console.log(`merge-back dry-run for ${cleanSlug}:`)
    console.log(`  Worktree:        ${target.path}`)
    console.log(`  Branch:          ${branchName}`)
    console.log(`  Blockers:        ${blockers.length}`)
    for (const b of blockers.slice(0, 20)) {
      console.log(`    ${b.type.padEnd(10)} ${b.path}`)
    }
    if (blockers.length > 20) {
      console.log(`    ... and ${blockers.length - 20} more`)
    }
    console.log(`  Worktree WIP:    ${wtUserDirty.length}`)
    for (const d of wtUserDirty.slice(0, 20)) {
      console.log(`    ${(d.status ?? '??').padEnd(3)} ${d.path}`)
    }
    if (wtUserDirty.length > 20) {
      console.log(`    ... and ${wtUserDirty.length - 20} more`)
    }
    console.log(`  Pinned baselines: ${baselineRefs.length}`)
    for (const r of baselineRefs) console.log(`    ${r}`)
    if (wtUserDirty.length > 0) {
      console.log(
        `  Action: worktree has uncommitted WIP; without --include-worktree-wip, merge-back would refuse.`
      )
    } else if (blockers.length > 0) {
      console.log(
        `  Action: blockers detected; without --auto-stash, merge-back would fail at pre-flight.`
      )
    } else {
      console.log(`  Action: would squash + cleanup cleanly.`)
    }
    return { absorbed: false, slug: cleanSlug, dryRun: true, blockers, wtUserDirty, baselineRefs }
  }

  if (baselineRefs.length > 0) {
    console.log(`merge-back: ${baselineRefs.length} pinned pre-fork baseline(s) for ${cleanSlug}:`)
    for (const r of baselineRefs) console.log(`  ${r}`)
    console.log(
      `  → if cleanup later detects uncommitted files, inspect via 'wt-helper rescue --show <ref>'.`
    )
    console.log('')
  }

  // Act on worktree WIP detection from pre-flight: either auto-amend (opt-in)
  // or refuse with clear remediation steps. See computation above for rationale.
  if (wtUserDirty.length > 0) {
    if (opts.includeWorktreeWip) {
      const paths = wtUserDirty.map((d) => d.path)
      try {
        git(['add', '--', ...paths], { cwd: target.path })
        git(['commit', '--amend', '--no-edit'], { cwd: target.path, stdio: 'inherit' })
        console.log(
          `merge-back: --include-worktree-wip auto-amended ${paths.length} dirty file(s) into ${branchName} HEAD`
        )
      } catch (e) {
        throw new Error(`merge-back: --include-worktree-wip auto-amend failed: ${e.message ?? e}`)
      }
    } else {
      const preview = wtUserDirty
        .slice(0, 10)
        .map((d) => `  ${(d.status ?? '??').padEnd(3)} ${d.path}`)
        .join('\n')
      const more = wtUserDirty.length > 10 ? `\n  ... and ${wtUserDirty.length - 10} more` : ''
      throw new Error(
        `merge-back blocked: worktree '${target.path}' has ${wtUserDirty.length} uncommitted edit(s) to tracked/untracked file(s):\n` +
          preview +
          more +
          `\n\nAtomic-landing requires all worktree edits be committed before squash.\n` +
          `'git merge --squash' only carries commits — uncommitted worktree WIP is dropped,\n` +
          `then permanently destroyed by post-squash cleanup.\n\n` +
          `Resolution — commit on the worktree branch first:\n` +
          `  cd ${target.path}\n` +
          `  git add <files>\n` +
          `  git commit --amend --no-edit       # or new commit\n` +
          `Then re-run: wt-helper merge-back ${cleanSlug}\n\n` +
          `Override with --include-worktree-wip to auto-amend (not recommended — an explicit\n` +
          `commit with a meaningful message is safer).`
      )
    }
  }

  let stashRef = null
  if (blockers.length > 0) {
    if (!opts.autoStash) {
      const preview = blockers
        .slice(0, 10)
        .map((b) => `  ${b.type.padEnd(10)} ${b.path}`)
        .join('\n')
      const more = blockers.length > 10 ? `\n  ... and ${blockers.length - 10} more` : ''
      throw new Error(
        `merge-back blocked: ${blockers.length} file(s) in main's working tree would be overwritten by squash:\n` +
          preview +
          more +
          `\n\nRe-run with --auto-stash to stash these as 'wt-merge-block/${cleanSlug}/<ISO>'\n` +
          `for later reconciliation via \`node scripts/stash-reconcile.mjs\`.`
      )
    }
    const isoTs = new Date().toISOString().replace(/[:.]/g, '-')
    const stashMsg = `wt-merge-block/${cleanSlug}/${isoTs}`
    const blockerPaths = blockers.map((b) => b.path)
    try {
      git(['stash', 'push', '-u', '-m', stashMsg, '--', ...blockerPaths], { cwd: consumerRoot })
      stashRef = stashMsg
      console.log(`merge-back: stashed ${blockers.length} blocker(s) as '${stashMsg}'`)
    } catch (e) {
      throw new Error(`merge-back: failed to stash blockers: ${e.message ?? e}`)
    }
  }

  let squashError = null
  try {
    git(['merge', '--squash', branchName], { cwd: consumerRoot, stdio: 'inherit' })
  } catch (e) {
    squashError = e
  }

  // Check for conflict markers in working tree.
  const statusAfter = git(['status', '--porcelain'], { cwd: consumerRoot })
  const conflicted = statusAfter
    .split('\n')
    .filter((line) => /^(UU|AA|DD|AU|UA|UD|DU) /.test(line))
    .map((line) => line.slice(3).trim())

  if (conflicted.length > 0 || squashError) {
    try {
      git(['merge', '--abort'], { cwd: consumerRoot, stdio: 'ignore' })
    } catch {}

    // Pop stash and re-check — git stash pop can leave UU in index when stash
    // content conflicts with the post-abort working tree. Previously this was
    // swallowed with only `console.error('warn:')`, letting half-resolved UU
    // accumulate silently across sessions until later flows (archive, propagate)
    // failed in puzzling ways. Now we surface pop conflicts as part of the throw.
    let popUnmerged = []
    let popExitError = null
    if (stashRef) {
      try {
        git(['stash', 'pop'], { cwd: consumerRoot, stdio: 'inherit' })
      } catch (e) {
        popExitError = e
      }
      // Status re-check is authoritative — git stash pop with conflicts exits 1
      // AND leaves UU entries, but exit code alone isn't reliable across git
      // versions. The UU paths are the actual breakage signal.
      const statusAfterPop = git(['status', '--porcelain'], { cwd: consumerRoot })
      popUnmerged = statusAfterPop
        .split('\n')
        .filter((line) => /^(UU|AA|DD|AU|UA|UD|DU) /.test(line))
        .map((line) => line.slice(3).trim())
    }

    const squashDetail =
      conflicted.length > 0
        ? `${conflicted.length} file(s) hit merge conflict during squash:\n` +
          conflicted
            .slice(0, 10)
            .map((f) => `  ${f}`)
            .join('\n')
        : `squash failed: ${squashError?.message ?? squashError}`

    const popDetail =
      popUnmerged.length > 0
        ? `\n\nstash pop also conflicted; ${popUnmerged.length} file(s) left UU in index:\n` +
          popUnmerged
            .slice(0, 10)
            .map((f) => `  ${f}`)
            .join('\n') +
          `\nstash '${stashRef}' preserved — \`git stash list\` to inspect; ` +
          `resolve UU (\`git checkout --ours/--theirs <path> && git add <path>\`) before re-running.`
        : popExitError
          ? `\n\nstash pop exited with error but no UU detected; stash '${stashRef}' preserved — inspect with \`git stash list\`.`
          : ''

    throw new Error(
      `merge-back: ${squashDetail}${popDetail}\n\n` +
        `Worktree '${target.path}' + branch '${branchName}' preserved.\n` +
        `Resolve conflicts manually then re-run \`wt-helper merge-back ${cleanSlug}\`.`
    )
  }

  let cleanupDone = false
  if (opts.cleanup !== false) {
    try {
      await cmdCleanup(cleanSlug, { force: true, forceDiscardUnland: true })
      cleanupDone = true
    } catch (e) {
      console.error(`warn: cleanup failed after squash: ${e.message ?? e}`)
    }
  }

  const summary =
    `merge-back: ${cleanSlug} absorbed into main` +
    (stashRef ? ` (blockers stashed as ${stashRef})` : '') +
    (cleanupDone ? ' + worktree cleaned' : ' (cleanup skipped/failed)')
  console.log(summary)
  return { absorbed: true, slug: cleanSlug, stashRef, cleanupDone, blockers, baselineRefs }
}

// Semantic alias for migrating grandfathered worktrees from the pre-atomic
// flow (worktree-default.md §7). Mechanically identical to merge-back —
// the distinction is documentation-level so migration commands stay clear.
const cmdLandPending = cmdMergeBack

// List pre-fork baseline rescue candidates: `refs/wt-baseline/*` (pinned by
// cmdAdd stash strategy) plus dangling stash commits found via `git fsck
// --unreachable` whose subject identifies them as wt-baseline stashes
// (fallback for incidents pre-dating the pin mechanism). Optional --show
// <ref-or-sha> prints the full patch via `git stash show -p`.
async function cmdRescue(opts) {
  const consumerRoot = findConsumerRoot()

  if (opts.show) {
    try {
      execFileSync('git', ['stash', 'show', '-p', opts.show], {
        cwd: consumerRoot,
        stdio: 'inherit',
      })
    } catch (e) {
      throw new Error(`rescue --show ${opts.show}: ${e?.message ?? e}`)
    }
    return
  }

  const pinned = []
  try {
    const raw = git(
      ['for-each-ref', '--format=%(refname) %(objectname) %(subject)', 'refs/wt-baseline/'],
      { cwd: consumerRoot }
    )
    for (const line of raw.split('\n').filter(Boolean)) {
      const m = line.match(/^(\S+) (\S+) (.*)$/)
      if (m) pinned.push({ ref: m[1], sha: m[2], subject: m[3] })
    }
  } catch {}

  const dangling = []
  try {
    const raw = execFileSync('git', ['fsck', '--no-reflogs', '--unreachable'], {
      cwd: consumerRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    for (const line of raw.split('\n')) {
      const m = line.match(/^unreachable commit ([0-9a-f]+)$/)
      if (!m) continue
      const sha = m[1]
      let subject = ''
      try {
        subject = git(['log', '-1', '--format=%s', sha], { cwd: consumerRoot })
      } catch {
        continue
      }
      if (/^On [^:]+: wt-baseline\//.test(subject)) {
        dangling.push({ sha, subject })
      }
    }
  } catch {}

  // Deduplicate dangling by pinned sha — a pinned ref already covers its sha.
  const pinnedShas = new Set(pinned.map((p) => p.sha))
  const danglingFiltered = dangling.filter((d) => !pinnedShas.has(d.sha))

  if (opts.json) {
    console.log(JSON.stringify({ pinned, dangling: danglingFiltered }, null, 2))
    return
  }

  if (pinned.length === 0 && danglingFiltered.length === 0) {
    console.log('No wt-baseline rescue candidates found.')
    return
  }

  if (pinned.length > 0) {
    console.log(`Pinned pre-fork baselines (refs/wt-baseline/*) — ${pinned.length}:`)
    for (const p of pinned) {
      console.log(`  ${p.ref}`)
      console.log(`    sha:     ${p.sha}`)
      console.log(`    subject: ${p.subject}`)
    }
    console.log('')
  }
  if (danglingFiltered.length > 0) {
    console.log(
      `Dangling unreachable wt-baseline stashes (gc candidate within ~30 days) — ${danglingFiltered.length}:`
    )
    for (const d of danglingFiltered) {
      console.log(`  sha:     ${d.sha}`)
      console.log(`  subject: ${d.subject}`)
    }
    console.log('')
  }
  console.log('To inspect a candidate (read-only patch view):')
  console.log('  node scripts/wt-helper.mjs rescue --show <ref-or-sha>')
  console.log('To restore to current branch:')
  console.log('  git stash apply <ref-or-sha>          # may conflict; resolve before committing')
  console.log('  git checkout <ref-or-sha> -- <paths>  # selective restore by path')
}

async function main() {
  const [, , sub, ...rest] = process.argv

  // Value-taking flags consume the next positional token unless it starts with `--`.
  // Bare `--precheck-baseline` (no value) is allowed — it means "any-change
  // baseline guard, no change context" (ad-hoc /wt path).
  const VALUE_FLAGS = new Set([
    '--precheck-baseline',
    '--baseline-strategy',
    '--baseline-scope-paths',
    '--baseline-stash-name',
    '--show',
  ])
  const flags = new Set()
  const values = {}
  const positional = []
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.has(a)) {
        const next = rest[i + 1]
        if (next === undefined || next.startsWith('--')) {
          values[a] = ''
        } else {
          values[a] = next
          i++
        }
      } else {
        flags.add(a)
      }
    } else {
      positional.push(a)
    }
  }
  const opts = {
    json: flags.has('--json'),
    force: flags.has('--force'),
    forceDiscardUnland: flags.has('--force-discard-unland'),
    forceDiscardUncommitted: flags.has('--force-discard-uncommitted'),
    dryRun: flags.has('--dry-run'),
    autoStash: flags.has('--auto-stash'),
    includeWorktreeWip: flags.has('--include-worktree-wip'),
    cleanup: !flags.has('--no-cleanup'),
    noopIfMissing: flags.has('--noop-if-missing'),
    precheckBaseline: Object.prototype.hasOwnProperty.call(values, '--precheck-baseline')
      ? values['--precheck-baseline']
      : undefined,
    baselineStrategy: values['--baseline-strategy'],
    baselineScopePaths: values['--baseline-scope-paths'],
    baselineStashName: values['--baseline-stash-name'],
    show: values['--show'],
  }

  switch (sub) {
    case 'add':
      await cmdAdd(positional[0], opts)
      return
    case 'detect-main-dirty':
      await cmdDetectMainDirty(opts)
      return
    case 'list':
      await cmdList(opts)
      return
    case 'prune':
      await cmdPrune()
      return
    case 'cleanup':
      await cmdCleanup(positional[0], opts)
      return
    case 'merge-back':
      await cmdMergeBack(positional[0], opts)
      return
    case 'land-pending':
      await cmdLandPending(positional[0], opts)
      return
    case 'rescue':
      await cmdRescue(opts)
      return
    default:
      console.error(
        'Usage: wt-helper <add|detect-main-dirty|list|prune|cleanup|merge-back|land-pending|rescue> [args]'
      )
      console.error('')
      console.error(
        '  add <slug>                Create worktree at ~/offline/<consumer>-wt/<slug>/'
      )
      console.error('    --precheck-baseline [<change>]')
      console.error('                            Pre-fork dirty check on main; pairs with')
      console.error(
        '                            --baseline-strategy. Bare form = no change context.'
      )
      console.error('    --baseline-strategy commit|stash|warn')
      console.error(
        '                            commit: selective stage + commit baseline on main;'
      )
      console.error('                            stash: stash main → apply inside new worktree;')
      console.error('                            warn: stop with report (default).')
      console.error(
        '    --baseline-scope-paths <comma>   Required for commit strategy; selective stage scope.'
      )
      console.error(
        '    --baseline-stash-name <name>     Override default `wt-baseline/<slug>/<ISO>` stash name.'
      )
      console.error("  detect-main-dirty         Report main's dirty paths; pairs with --json.")
      console.error('  list [--json]             Enumerate session worktrees with staleness')
      console.error('  prune                     Interactively remove merged session worktrees')
      console.error('  cleanup <slug>            Remove worktree (gated by --force +')
      console.error('                            --force-discard-unland; pre-checks both)')
      console.error('  merge-back <slug>         Atomic squash into main + cleanup; flags:')
      console.error('    --dry-run               preview blockers + worktree WIP without acting')
      console.error(
        '    --auto-stash            stash main blockers as wt-merge-block/<slug>/<ISO>'
      )
      console.error(
        '    --include-worktree-wip  auto-amend uncommitted worktree edits into branch HEAD'
      )
      console.error(
        '                            (default: refuse with remediation; explicit commit safer)'
      )
      console.error('    --no-cleanup            skip worktree cleanup after squash')
      console.error(
        '    --noop-if-missing       silently no-op if no matching worktree (for hooks)'
      )
      console.error('  land-pending <slug>       Alias of merge-back for grandfathered worktrees')
      console.error('  rescue [--show <ref|sha>] [--json]')
      console.error('                            List pre-fork baseline rescue candidates')
      console.error('                            (refs/wt-baseline/* pinned + fsck dangling).')
      console.error('                            --show prints full patch via stash show -p.')
      process.exit(1)
  }
}

export {
  cmdAdd,
  cmdCleanup,
  cmdDetectMainDirty,
  cmdLandPending,
  cmdList,
  cmdMergeBack,
  cmdPrune,
  cmdRescue,
  detectMainDirty,
  detectMergeBlockers,
  detectUncommittedWorktreeFiles,
  detectUnlandedFiles,
  enrichWorktree,
  findConsumerRoot,
  gitSelectiveCommit,
  makeSlugSafe,
  mergedBranches,
  parseWorktreeList,
  sessionWorktrees,
  timestampPrefix,
}

function resolveRealPath(p) {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

const isCli =
  process.argv[1] &&
  resolveRealPath(process.argv[1]) === resolveRealPath(new URL(import.meta.url).pathname)
if (isCli) {
  main().catch((e) => {
    console.error('error:', e.message)
    process.exit(1)
  })
}
