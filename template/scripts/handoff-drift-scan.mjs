#!/usr/bin/env node

/**
 * handoff-drift-scan.mjs — surface stale HANDOFF.md entries
 *
 * Per the worktree atomicity flow (worktree-default.md §5.5), worktree
 * branches accumulate commits until `/spectra-archive` runs `wt-helper
 * merge-back`. Between subagent commit and archive, HANDOFF.md often falls
 * behind: it says "P7 進行中" while the branch HEAD already has the P7
 * commits.
 *
 * This scanner emits stderr warnings (one per worktree) to surface drift
 * at session-start (called by `session-start-roadmap-sync.sh` after follow-up
 * surfacing).
 *
 * Warning triggers (any one is enough):
 *   1. Branch HEAD has ≥1 commit past main HEAD AND slug not mentioned in HANDOFF.md
 *      → "session work invisible to next session"
 *   2. Branch HEAD has commits dated newer than HANDOFF.md mtime AND slug is mentioned
 *      → "HANDOFF mention stale: branch progressed since last entry"
 *   3. Worktree branch is fully merged to main but worktree still exists
 *      → "ready to absorb via /spectra-archive or wt-helper merge-back"
 *
 * Exit code is always 0 (informational only — does NOT block sessions).
 *
 * Output format:
 *   [handoff-drift] <slug>: <warning>
 *
 * Flags:
 *   --json      machine-readable output (suppresses stderr text)
 *   --quiet     suppress all output (still useful as exit-code health check)
 */

import { execFileSync } from 'node:child_process'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

function gitRaw(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  })
}

function gitTrim(args, opts = {}) {
  const out = gitRaw(args, opts)
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
  const commonDir = resolve(dir, gitTrim(['rev-parse', '--git-common-dir'], { cwd: dir }))
  return dirname(commonDir)
}

function parseWorktreeList(porcelain) {
  const records = porcelain.split(/\n\n+/)
  const result = []
  for (const r of records) {
    if (!r.trim()) continue
    const entry = {}
    for (const line of r.split('\n')) {
      const idx = line.indexOf(' ')
      if (idx < 0) entry[line] = ''
      else entry[line.slice(0, idx)] = line.slice(idx + 1)
    }
    if (entry.worktree && entry.branch) result.push(entry)
  }
  return result
}

function sessionWorktrees(consumerRoot) {
  const out = gitTrim(['worktree', 'list', '--porcelain'], { cwd: consumerRoot })
  return parseWorktreeList(out)
    .filter((w) => w.branch && w.branch.startsWith('refs/heads/session/'))
    .map((w) => ({
      path: w.worktree,
      branch: w.branch.replace('refs/heads/', ''),
    }))
}

function mergedBranches(consumerRoot) {
  let raw = ''
  try {
    raw = gitTrim(['branch', '--merged', 'main'], { cwd: consumerRoot })
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

function extractSlugFromBranch(branch) {
  // session/<YYYY-MM-DD-HHMM>-<slug>
  const m = branch.match(/^session\/\d{4}-\d{2}-\d{2}-\d{4}-(.+)$/)
  return m ? m[1] : null
}

function branchCommitsAheadOfMain(consumerRoot, branchName) {
  try {
    const out = gitTrim(['log', '--format=%H', `main..${branchName}`], { cwd: consumerRoot })
    return out ? out.split('\n').filter(Boolean) : []
  } catch {
    return []
  }
}

function lastCommitTimestamp(consumerRoot, branchName) {
  try {
    const sec = parseInt(
      gitTrim(['log', '-1', '--format=%ct', branchName], { cwd: consumerRoot }),
      10
    )
    return Number.isFinite(sec) ? sec * 1000 : 0
  } catch {
    return 0
  }
}

function checkDrift(consumerRoot, worktree) {
  const slug = extractSlugFromBranch(worktree.branch)
  if (!slug) {
    return { worktree, slug: null, drift: null, message: null }
  }

  const handoffPath = join(consumerRoot, 'HANDOFF.md')
  const handoffExists = existsSync(handoffPath)
  const handoffMtime = handoffExists ? statSync(handoffPath).mtimeMs : 0
  const handoffText = handoffExists ? readFileSync(handoffPath, 'utf8') : ''
  const mentioned = handoffText.includes(slug)

  const commits = branchCommitsAheadOfMain(consumerRoot, worktree.branch)
  const lastCommitMs = lastCommitTimestamp(consumerRoot, worktree.branch)
  const merged = mergedBranches(consumerRoot).has(worktree.branch)

  // Trigger 3: branch fully merged, worktree still exists
  if (merged) {
    return {
      worktree,
      slug,
      drift: 'merged-but-not-cleaned',
      message: `worktree branch is fully merged to main; run \`wt-helper cleanup ${slug} --force --force-discard-unland\` or absorb via /spectra-archive`,
    }
  }

  if (commits.length === 0) {
    return { worktree, slug, drift: null, message: null }
  }

  // Trigger 1: branch ahead AND slug not in HANDOFF (work invisible)
  if (!mentioned) {
    return {
      worktree,
      slug,
      drift: 'unmentioned-progress',
      message: `branch has ${commits.length} commit(s) past main but slug not in HANDOFF.md — next session will not see this work`,
    }
  }

  // Trigger 2: branch commits newer than HANDOFF mtime (HANDOFF stale)
  if (handoffMtime > 0 && lastCommitMs > handoffMtime) {
    const ageMin = Math.round((lastCommitMs - handoffMtime) / 60000)
    return {
      worktree,
      slug,
      drift: 'mention-stale',
      message: `branch HEAD commit is ${ageMin} min newer than HANDOFF.md mtime — mention may not reflect current state`,
    }
  }

  return { worktree, slug, drift: null, message: null }
}

async function main() {
  const args = process.argv.slice(2)
  const opts = {
    json: args.includes('--json'),
    quiet: args.includes('--quiet'),
  }

  let consumerRoot
  try {
    consumerRoot = findConsumerRoot()
  } catch {
    // not a git repo — fail open
    if (!opts.quiet && !opts.json) {
      console.error('[handoff-drift] not in a git repo; skipping')
    }
    return
  }

  const worktrees = sessionWorktrees(consumerRoot)
  const results = worktrees.map((w) => checkDrift(consumerRoot, w))
  const warnings = results.filter((r) => r.drift)

  if (opts.json) {
    console.log(JSON.stringify({ consumerRoot, worktrees: results }, null, 2))
    return
  }
  if (opts.quiet) return

  if (warnings.length === 0) {
    if (worktrees.length > 0) {
      console.error(`[handoff-drift] ${worktrees.length} session worktree(s); no drift detected`)
    }
    return
  }

  console.error(
    `[handoff-drift] ${warnings.length} of ${worktrees.length} session worktree(s) show drift:`
  )
  for (const w of warnings) {
    console.error(`  - ${w.slug} (${w.drift}): ${w.message}`)
  }
  console.error(
    `  Tip: run \`node scripts/wt-helper.mjs list\` for full state, or \`/handoff\` to refresh HANDOFF.md.`
  )
}

main().catch((e) => {
  // Fail open — this is informational, must never break session start.
  console.error(`[handoff-drift] error (non-fatal): ${e.message ?? e}`)
})
