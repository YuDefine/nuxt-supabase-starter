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
 *   cleanup <slug>   Remove one session worktree by slug. Refuses if branch
 *                    not merged unless --force. Even with --force, refuses
 *                    if branch HEAD has files NOT landed into main's working
 *                    tree (squash-merge failure detection); add
 *                    --force-discard-unland to proceed anyway.
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

async function cmdCleanup(slug, opts) {
  if (!slug) throw new Error('Usage: wt-helper cleanup <slug> [--force]')
  const cleanSlug = makeSlugSafe(slug)
  const consumerRoot = findConsumerRoot()
  const wts = sessionWorktrees(consumerRoot)
  const target = wts.find(
    (w) => w.path.endsWith(`/${cleanSlug}`) && w.branch && w.branch.endsWith(`-${cleanSlug}`)
  )
  if (!target) throw new Error(`No session worktree found for slug: ${cleanSlug}`)

  const branchName = target.branch.replace('refs/heads/', '')
  if (!opts.force) {
    if (!mergedBranches(consumerRoot).has(branchName)) {
      throw new Error(`Branch ${branchName} is not merged into main. Use --force to remove anyway.`)
    }
  }

  if (!opts.forceDiscardUnland) {
    let branchFiles = []
    try {
      const out = git(['diff', '--name-only', `main..${branchName}`], { cwd: consumerRoot })
      branchFiles = out.split('\n').filter(Boolean)
    } catch (err) {
      console.error(
        `warn: could not list files in main..${branchName} (${err?.message ?? err}); skipping squash-merge failure detection`
      )
      branchFiles = []
    }
    const unlanded = []
    for (const f of branchFiles) {
      try {
        git(['diff', '--quiet', branchName, '--', f], { cwd: consumerRoot })
      } catch {
        unlanded.push(f)
      }
    }
    if (unlanded.length > 0) {
      const preview = unlanded
        .slice(0, 10)
        .map((f) => `  - ${f}`)
        .join('\n')
      const more = unlanded.length > 10 ? `\n  ... and ${unlanded.length - 10} more` : ''
      throw new Error(
        `Branch ${branchName} has ${unlanded.length} file(s) whose branch HEAD content is NOT present in main's working tree (squash-merge may have failed or been aborted):\n` +
          preview +
          more +
          `\nIf the squash succeeded and you intentionally want to discard the branch, add --force-discard-unland.`
      )
    }
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
    default:
      console.error('Usage: wt-helper <add|list|prune|cleanup> [args]')
      console.error('')
      console.error('  add <slug>      Create worktree at ~/offline/<consumer>-wt/<slug>/')
      console.error('  list [--json]   Enumerate session worktrees with staleness')
      console.error('  prune           Interactively remove merged session worktrees')
      console.error('  cleanup <slug>  Remove one session worktree (merge-checked)')
      process.exit(1)
  }
}

export {
  cmdAdd,
  cmdCleanup,
  cmdList,
  cmdPrune,
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
