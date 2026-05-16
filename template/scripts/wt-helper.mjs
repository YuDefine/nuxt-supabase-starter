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

async function cmdAdd(slug) {
  if (!slug) throw new Error('Usage: wt-helper add <slug>')
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

  console.log('')
  console.log('Worktree ready.')
  console.log(`  cd ${wtPath}`)
  console.log(`  Branch: ${branch}`)
  console.log('')
  console.log(
    'Open a new Claude Code or Codex session in the worktree path to continue work isolated from main.'
  )
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
  if (!slug) throw new Error('Usage: wt-helper cleanup <slug> [--force] [--force-discard-unland]')
  const cleanSlug = makeSlugSafe(slug)
  const consumerRoot = findConsumerRoot()
  const wts = sessionWorktrees(consumerRoot)
  const target = wts.find(
    (w) => w.path.endsWith(`/${cleanSlug}`) && w.branch && w.branch.endsWith(`-${cleanSlug}`)
  )
  if (!target) throw new Error(`No session worktree found for slug: ${cleanSlug}`)

  const branchName = target.branch.replace('refs/heads/', '')

  // Pre-check BOTH gates upfront so the error message can recommend the
  // full flag combo in one go, rather than ping-ponging the user between
  // --force and --force-discard-unland (TD-from-perno-session-2026-05-17).
  const branchMerged = mergedBranches(consumerRoot).has(branchName)
  const unlanded = detectUnlandedFiles(consumerRoot, branchName)
  const needsForce = !branchMerged && !opts.force
  const needsDiscardUnland = unlanded.length > 0 && !opts.forceDiscardUnland

  if (needsForce || needsDiscardUnland) {
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
    const flagsNeeded = []
    if (needsForce) flagsNeeded.push('--force')
    if (needsDiscardUnland) flagsNeeded.push('--force-discard-unland')
    throw new Error(
      `Cleanup blocked by ${issues.length} gate(s):\n` +
        issues.join('\n') +
        `\n\nResolution — re-run with the full flag combo:\n` +
        `  node scripts/wt-helper.mjs cleanup ${cleanSlug} ${flagsNeeded.join(' ')}\n` +
        `\nWhy both: --force discards the unmerged branch ref; --force-discard-unland\n` +
        `acknowledges that the branch's commits will be lost (their content never made\n` +
        `it into main). Use \`wt-helper merge-back ${cleanSlug}\` first if you want to\n` +
        `keep the work.`
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
      'Usage: wt-helper merge-back <slug> [--dry-run] [--auto-stash] [--no-cleanup] [--noop-if-missing]'
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

  if (opts.dryRun) {
    console.log(`merge-back dry-run for ${cleanSlug}:`)
    console.log(`  Worktree: ${target.path}`)
    console.log(`  Branch:   ${branchName}`)
    console.log(`  Blockers: ${blockers.length}`)
    for (const b of blockers.slice(0, 20)) {
      console.log(`    ${b.type.padEnd(10)} ${b.path}`)
    }
    if (blockers.length > 20) {
      console.log(`    ... and ${blockers.length - 20} more`)
    }
    if (blockers.length > 0) {
      console.log(
        `  Action: blockers detected; without --auto-stash, merge-back would fail at pre-flight.`
      )
    } else {
      console.log(`  Action: would squash + cleanup cleanly.`)
    }
    return { absorbed: false, slug: cleanSlug, dryRun: true, blockers }
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
    if (stashRef) {
      try {
        git(['stash', 'pop'], { cwd: consumerRoot, stdio: 'inherit' })
      } catch (e) {
        console.error(
          `warn: stash pop failed; '${stashRef}' preserved in stash list — recover manually.`
        )
      }
    }
    const detail =
      conflicted.length > 0
        ? `${conflicted.length} file(s) hit merge conflict:\n` +
          conflicted
            .slice(0, 10)
            .map((f) => `  ${f}`)
            .join('\n')
        : `squash failed: ${squashError?.message ?? squashError}`
    throw new Error(
      `merge-back: ${detail}\n\nWorktree '${target.path}' + branch '${branchName}' preserved.\n` +
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
  return { absorbed: true, slug: cleanSlug, stashRef, cleanupDone, blockers }
}

// Semantic alias for migrating grandfathered worktrees from the pre-atomic
// flow (worktree-default.md §7). Mechanically identical to merge-back —
// the distinction is documentation-level so migration commands stay clear.
const cmdLandPending = cmdMergeBack

async function main() {
  const [, , sub, ...rest] = process.argv
  const flags = new Set()
  const positional = []
  for (const a of rest) {
    if (a.startsWith('--')) flags.add(a)
    else positional.push(a)
  }
  const opts = {
    json: flags.has('--json'),
    force: flags.has('--force'),
    forceDiscardUnland: flags.has('--force-discard-unland'),
    dryRun: flags.has('--dry-run'),
    autoStash: flags.has('--auto-stash'),
    cleanup: !flags.has('--no-cleanup'),
    noopIfMissing: flags.has('--noop-if-missing'),
  }

  switch (sub) {
    case 'add':
      await cmdAdd(positional[0])
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
    default:
      console.error('Usage: wt-helper <add|list|prune|cleanup|merge-back|land-pending> [args]')
      console.error('')
      console.error(
        '  add <slug>                Create worktree at ~/offline/<consumer>-wt/<slug>/'
      )
      console.error('  list [--json]             Enumerate session worktrees with staleness')
      console.error('  prune                     Interactively remove merged session worktrees')
      console.error('  cleanup <slug>            Remove worktree (gated by --force +')
      console.error('                            --force-discard-unland; pre-checks both)')
      console.error('  merge-back <slug>         Atomic squash into main + cleanup; flags:')
      console.error('    --dry-run               preview blockers without acting')
      console.error(
        '    --auto-stash            stash main blockers as wt-merge-block/<slug>/<ISO>'
      )
      console.error('    --no-cleanup            skip worktree cleanup after squash')
      console.error(
        '    --noop-if-missing       silently no-op if no matching worktree (for hooks)'
      )
      console.error('  land-pending <slug>       Alias of merge-back for grandfathered worktrees')
      process.exit(1)
  }
}

export {
  cmdAdd,
  cmdCleanup,
  cmdLandPending,
  cmdList,
  cmdMergeBack,
  cmdPrune,
  detectMergeBlockers,
  detectUnlandedFiles,
  enrichWorktree,
  findConsumerRoot,
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
