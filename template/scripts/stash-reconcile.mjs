#!/usr/bin/env node

const pad2 = (n) => String(n).padStart(2, '0')

/**
 * stash-reconcile.mjs — list + suggest actions for namespaced stash entries
 *
 * Surfaces git stash entries created by clade workflows:
 *   - `wt-merge-block/<slug>/<ISO>` — main-worktree blockers stashed by
 *     `wt-helper merge-back --auto-stash` (rules/core/worktree-default.md §5.5)
 *   - `wt-baseline/<slug>/<ISO>` / `wt-final-baseline/<slug>/<ISO>` — pre-fork
 *     baseline snapshots from `wt-helper add --baseline-strategy stash` (the
 *     applied content is also pinned as `refs/wt-baseline/<slug>/<ISO>`, so
 *     stash entries with a matching ref are safe to drop)
 *   - `cross-session-block-*` — legacy ad-hoc prefix from the pre-atomic
 *     pain era (perno 2026-05-17 session); included for migration coverage
 *   - `clade-propagate-v<ver>-<ts>` — auto-stash from `propagate.mjs` dirty
 *     consumer flow when stash pop fails post-write (scripts/propagate.mjs)
 *   - `clade-publish: <free-form>` — manual stash from clade-publish skill
 *     when stashing parallel-session WIP before publish
 *   - spectra-apply phase suffixes (`-baseline-drift`, `-p7-wip`,
 *     `-conflict-snapshot-with-markers`, `-shared-files`,
 *     `-perf-eval-tasks-bleed`) — stale once the change is archived
 *
 * Safety contract: this script NEVER pops or auto-commits. `apply` uses
 * `git stash apply` (entry preserved). After apply, user WIP sits in the
 * working tree — commit via `/spectra-commit` or `/commit` with selective
 * stage; do NOT `git add -A`.
 *
 * Default: write a markdown report at `.spectra/stash-reconcile-<YYYY-MM-DD-HHMM>.md`
 * with one section per matched stash entry, including:
 *   - stash ref (`stash@{N}`)
 *   - parsed slug + ISO timestamp (where available)
 *   - file count + size (`--stat` summary)
 *   - recommended action: `apply` (if main currently clean of conflicting files),
 *     `view diff first` (otherwise), or `drop` (if applied content is already on
 *     main — detected by zero diff between stash content and current main HEAD)
 *   - copy-paste commands the user can run
 *
 * Flags:
 *   --interactive       prompt per stash with [a]pply / [d]rop / [v]iew / [s]kip menu
 *   --json              machine-readable output to stdout (no file written)
 *   --include-all       include unnamespaced stashes (filter disabled; useful for
 *                       one-time inventory of legacy stash state)
 *   --stale-days <N>    keep only stashes older than N days (entries are tagged
 *                       with `[STALE >Nd]` in their reason field)
 *   --slug <substring>  keep only stashes whose parsed slug includes <substring>
 *                       (used by wt-helper merge-back's reconcile hint)
 *
 * Exit codes:
 *   0  success (report written / interactive complete)
 *   1  no stashes match the filter (informational, not error)
 *   2  fatal error (git unavailable, write failure)
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'

// Substring patterns used to filter "namespaced" (clade-managed) stashes. Order
// matters only for parseNamespace classification; filterNamespaced is a flat OR.
// Suffix patterns ('-baseline-drift', etc.) require end-of-message match in
// parseNamespace to avoid false-matching e.g. 'feat-shared-files-refactor'.
const NAMESPACED_PREFIXES = [
  'wt-final-baseline/',
  'wt-merge-block/',
  'wt-baseline/',
  'cross-session-block-',
  'clade-propagate-v',
  'clade-publish:',
]

const NAMESPACED_SUFFIXES = [
  '-baseline-drift',
  '-p7-wip',
  '-conflict-snapshot-with-markers',
  '-shared-files',
  '-perf-eval-tasks-bleed',
]

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

function listStashes(consumerRoot) {
  let raw = ''
  try {
    raw = gitTrim(['stash', 'list', '--pretty=%gd|%ci|%s'], { cwd: consumerRoot })
  } catch {
    return []
  }
  if (!raw) return []
  return raw.split('\n').map((line) => {
    const [ref, ci, ...msgParts] = line.split('|')
    return { ref, createdAt: ci, message: msgParts.join('|') }
  })
}

function filterNamespaced(stashes) {
  return stashes.filter((s) => {
    if (NAMESPACED_PREFIXES.some((p) => s.message.includes(p))) return true
    return NAMESPACED_SUFFIXES.some((suf) => s.message.endsWith(suf))
  })
}

function filterByStaleDays(stashes, days) {
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000
  return stashes.filter((s) => {
    const t = Date.parse(s.createdAt)
    if (Number.isNaN(t)) return false
    return t < cutoffMs
  })
}

function filterBySlug(entries, slugFilter) {
  const needle = slugFilter.toLowerCase()
  return entries.filter((e) => (e.namespace?.slug ?? '').toLowerCase().includes(needle))
}

function parseNamespace(message) {
  // Order matters: wt-final-baseline before wt-baseline (more specific first).
  const finalBaseline = message.match(/wt-final-baseline\/([^/]+)\/([0-9TZ:-]+)/)
  if (finalBaseline) {
    return { kind: 'wt-final-baseline', slug: finalBaseline[1], iso: finalBaseline[2] }
  }
  // Phase 7 (Q8) namespace: wt-merge-block/<slug>/<session_id>/<iso>
  // (session_id has form <base36>-<base36>-<host-suffix>). Backward-compat:
  // legacy wt-merge-block/<slug>/<iso> still parses (session_id field is null).
  const wtNew = message.match(/wt-merge-block\/([^/]+)\/([^/]+)\/(\d{4}-\d{2}-\d{2}T[0-9-]+Z)/)
  if (wtNew) {
    return { kind: 'wt-merge-block', slug: wtNew[1], session_id: wtNew[2], iso: wtNew[3] }
  }
  const wtMatch = message.match(/wt-merge-block\/([^/]+)\/([0-9TZ:-]+)/)
  if (wtMatch) {
    return { kind: 'wt-merge-block', slug: wtMatch[1], session_id: null, iso: wtMatch[2] }
  }
  const baselineNew = message.match(/wt-baseline\/([^/]+)\/([^/]+)\/(\d{4}-\d{2}-\d{2}T[0-9-]+Z)/)
  if (baselineNew) {
    return {
      kind: 'wt-baseline',
      slug: baselineNew[1],
      session_id: baselineNew[2],
      iso: baselineNew[3],
    }
  }
  const baseline = message.match(/wt-baseline\/([^/]+)\/([0-9TZ:-]+)/)
  if (baseline) {
    return { kind: 'wt-baseline', slug: baseline[1], session_id: null, iso: baseline[2] }
  }
  // cross-session-block-<slug>[-suffix]  (legacy from perno 2026-05-17)
  const csMatch = message.match(/cross-session-block-(.+)$/)
  if (csMatch) {
    return { kind: 'cross-session-block', slug: csMatch[1], iso: null }
  }
  // clade-propagate-v<semver>-<ms-timestamp>
  const propagate = message.match(/clade-propagate-v([\d.]+)-(\d+)/)
  if (propagate) {
    return { kind: 'clade-propagate', slug: `v${propagate[1]}`, iso: propagate[2] }
  }
  // clade-publish: <free-form description>
  const publish = message.match(/clade-publish:\s*(.+)$/)
  if (publish) {
    return { kind: 'clade-publish', slug: publish[1].slice(0, 40), iso: null }
  }
  // spectra-apply phase suffixes: <slug>-<phase-suffix>
  for (const suf of NAMESPACED_SUFFIXES) {
    if (message.endsWith(suf)) {
      const slug = message.slice(0, -suf.length)
      return { kind: `spectra-apply${suf}`, slug, iso: null }
    }
  }
  return { kind: 'unknown', slug: null, iso: null }
}

function hasPinnedBaselineRef(consumerRoot, slug, iso) {
  if (!slug || !iso) return false
  try {
    const refs = gitTrim(['for-each-ref', '--format=%(refname)', 'refs/wt-baseline/'], {
      cwd: consumerRoot,
    })
    const target = `refs/wt-baseline/${slug}/${iso}`
    return refs.split('\n').includes(target)
  } catch {
    return false
  }
}

function isArchivedChange(consumerRoot, slug) {
  if (!slug) return false
  try {
    const archivePath = join(consumerRoot, 'openspec', 'changes', 'archive', slug)
    return existsSync(archivePath)
  } catch {
    return false
  }
}

function inspectStashShape(consumerRoot, ref) {
  let stat = ''
  try {
    stat = gitTrim(['stash', 'show', '--stat', ref], { cwd: consumerRoot })
  } catch (e) {
    return { stat: `(error: ${e.message ?? e})`, files: [], totalLines: 0 }
  }
  const lines = stat.split('\n').filter(Boolean)
  // Last line is summary like "N files changed, X insertions(+), Y deletions(-)"
  const files = []
  for (const line of lines) {
    const m = line.match(/^\s*(.+?)\s+\|\s+(\d+)/)
    if (m) files.push({ path: m[1].trim(), changes: parseInt(m[2], 10) })
  }
  return { stat, files, totalLines: files.length }
}

function recommendAction(consumerRoot, ref, files, namespace) {
  // Kind-specific shortcut: wt-baseline / wt-final-baseline that's already
  // pinned as refs/wt-baseline/<slug>/<iso> is safe to drop (the applied
  // content survives in the pinned ref; the stash entry is a redundant copy).
  if (namespace && (namespace.kind === 'wt-baseline' || namespace.kind === 'wt-final-baseline')) {
    if (hasPinnedBaselineRef(consumerRoot, namespace.slug, namespace.iso)) {
      return {
        action: 'drop',
        reason: `pinned as refs/wt-baseline/${namespace.slug}/${namespace.iso}`,
      }
    }
  }

  // Kind-specific shortcut: spectra-apply phase stash whose change is archived
  // is presumed stale (defaults to view-diff rather than drop, since user may
  // still want to inspect content before discarding).
  if (namespace && namespace.kind?.startsWith('spectra-apply')) {
    if (isArchivedChange(consumerRoot, namespace.slug)) {
      return {
        action: 'view-diff',
        reason: `change '${namespace.slug}' is archived — inspect before drop`,
      }
    }
  }

  if (files.length === 0) return { action: 'view-diff', reason: 'no files in stash (corrupted?)' }

  let statusRaw = ''
  try {
    statusRaw = gitRaw(['status', '--porcelain'], { cwd: consumerRoot })
  } catch {}
  const dirtyPaths = new Set()
  for (const line of statusRaw.split('\n')) {
    if (line.length < 4) continue
    dirtyPaths.add(line.slice(3))
  }
  const conflicts = files.filter((f) => dirtyPaths.has(f.path))
  if (conflicts.length > 0) {
    return {
      action: 'view-diff',
      reason: `${conflicts.length} file(s) currently modified in main — apply would conflict`,
      conflictingFiles: conflicts.map((f) => f.path),
    }
  }

  try {
    const diff = gitTrim(['diff', `${ref}^..${ref}`], { cwd: consumerRoot })
    if (!diff) return { action: 'drop', reason: 'stash content matches HEAD (already absorbed)' }
  } catch {}

  return { action: 'apply', reason: 'no conflicts; stash brings new content' }
}

const SAFETY_BANNER = [
  'Safety: stash apply does NOT pop or stage. After apply, your WIP sits in',
  'the working tree. To commit, run /spectra-commit or /commit with selective',
  'stage (do NOT git add -A).',
].join(' ')

function formatMarkdown(consumerRoot, entries) {
  const lines = []
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 16)
  lines.push(`# Stash Reconcile Report`, '')
  lines.push(`> ${SAFETY_BANNER}`, '')
  lines.push(`Generated: ${ts}`)
  lines.push(`Consumer: ${consumerRoot}`)
  lines.push(`Entries: ${entries.length}`, '')

  if (entries.length === 0) {
    lines.push('No namespaced stashes found.', '')
    lines.push(`Use \`--include-all\` to inventory un-prefixed stashes.`)
    return lines.join('\n') + '\n'
  }

  lines.push(`## Action Summary`, '')
  const byAction = entries.reduce((acc, e) => {
    acc[e.recommendation.action] = (acc[e.recommendation.action] ?? 0) + 1
    return acc
  }, {})
  for (const [action, count] of Object.entries(byAction)) {
    lines.push(`- **${action}**: ${count}`)
  }
  lines.push('')

  for (const e of entries) {
    lines.push(`## ${e.ref} — ${e.namespace.slug ?? '(unknown slug)'}`, '')
    lines.push(`- **Created**: ${e.createdAt}`)
    lines.push(`- **Kind**: ${e.namespace.kind}`)
    if (e.namespace.iso) lines.push(`- **ISO**: ${e.namespace.iso}`)
    lines.push(`- **Message**: \`${e.message}\``)
    lines.push(`- **Files**: ${e.shape.totalLines}`)
    lines.push(`- **Recommendation**: \`${e.recommendation.action}\` — ${e.recommendation.reason}`)
    if (e.recommendation.conflictingFiles) {
      lines.push(`- **Conflicts in main working tree**:`)
      for (const p of e.recommendation.conflictingFiles.slice(0, 10)) {
        lines.push(`  - \`${p}\``)
      }
      if (e.recommendation.conflictingFiles.length > 10) {
        lines.push(`  - ... and ${e.recommendation.conflictingFiles.length - 10} more`)
      }
    }
    lines.push('', '### Files', '')
    lines.push('```')
    lines.push(e.shape.stat)
    lines.push('```', '', '### Suggested commands', '')
    lines.push('```bash')
    if (e.recommendation.action === 'apply') {
      lines.push(`# Apply (non-destructive — stash entry stays after)`)
      lines.push(`git stash apply ${e.ref}`)
    } else if (e.recommendation.action === 'drop') {
      lines.push(`# Stash content already on main — safe to drop`)
      lines.push(`git stash drop ${e.ref}`)
    } else {
      lines.push(`# View diff before deciding`)
      lines.push(`git stash show -p ${e.ref} | less`)
      lines.push(`# If safe to apply:`)
      lines.push(`git stash apply ${e.ref}`)
      lines.push(`# If already absorbed / unwanted:`)
      lines.push(`git stash drop ${e.ref}`)
    }
    lines.push('```', '')
  }
  return lines.join('\n') + '\n'
}

async function prompt(question) {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

async function interactiveLoop(consumerRoot, entries) {
  console.log('')
  console.log(`Safety: ${SAFETY_BANNER}`)
  console.log('')
  for (const e of entries) {
    console.log('')
    console.log(`── ${e.ref} ──`)
    console.log(`  Slug:    ${e.namespace.slug ?? '(unknown)'}`)
    console.log(`  Kind:    ${e.namespace.kind}`)
    console.log(`  Created: ${e.createdAt}`)
    console.log(`  Files:   ${e.shape.totalLines}`)
    console.log(`  Recommendation: ${e.recommendation.action} — ${e.recommendation.reason}`)
    const ans = (await prompt(`[a]pply / [d]rop / [v]iew diff / [s]kip / [q]uit: `))
      .trim()
      .toLowerCase()
    if (ans === 'a' || ans === 'apply') {
      try {
        gitRaw(['stash', 'apply', e.ref], { cwd: consumerRoot, stdio: 'inherit' })
        console.log('  applied')
      } catch (err) {
        console.error(`  apply failed: ${err.message ?? err}`)
      }
    } else if (ans === 'd' || ans === 'drop') {
      try {
        gitRaw(['stash', 'drop', e.ref], { cwd: consumerRoot, stdio: 'inherit' })
        console.log('  dropped')
      } catch (err) {
        console.error(`  drop failed: ${err.message ?? err}`)
      }
    } else if (ans === 'v' || ans === 'view') {
      try {
        const diff = gitTrim(['stash', 'show', '-p', e.ref], { cwd: consumerRoot })
        console.log(diff.split('\n').slice(0, 80).join('\n'))
        if (diff.split('\n').length > 80)
          console.log('... (truncated; use `git stash show -p` for full)')
      } catch (err) {
        console.error(`  view failed: ${err.message ?? err}`)
      }
    } else if (ans === 'q' || ans === 'quit') {
      console.log('Aborted.')
      return
    } else {
      console.log('  skipped')
    }
  }
}

function parseArgs(argv) {
  const opts = {
    interactive: false,
    json: false,
    includeAll: false,
    staleDays: null,
    slug: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--interactive') opts.interactive = true
    else if (a === '--json') opts.json = true
    else if (a === '--include-all') opts.includeAll = true
    else if (a === '--stale-days') {
      const n = Number(argv[++i])
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`--stale-days requires a non-negative number (got: ${argv[i]})`)
      }
      opts.staleDays = n
    } else if (a === '--slug') {
      const s = argv[++i]
      if (!s) throw new Error('--slug requires a substring argument')
      opts.slug = s
    } else {
      throw new Error(`unknown argument: ${a}`)
    }
  }
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  const consumerRoot = findConsumerRoot()
  const all = listStashes(consumerRoot)
  let filtered = opts.includeAll ? all : filterNamespaced(all)
  if (opts.staleDays !== null) {
    filtered = filterByStaleDays(filtered, opts.staleDays)
  }

  if (filtered.length === 0) {
    if (opts.json) console.log(JSON.stringify({ entries: [] }, null, 2))
    else console.log('No namespaced stashes found.')
    process.exit(1)
  }

  let entries = filtered.map((s) => {
    const namespace = parseNamespace(s.message)
    const shape = inspectStashShape(consumerRoot, s.ref)
    const recommendation = recommendAction(consumerRoot, s.ref, shape.files, namespace)
    if (opts.staleDays !== null) {
      recommendation.reason = `[STALE >${opts.staleDays}d] ${recommendation.reason}`
    }
    return { ...s, namespace, shape, recommendation }
  })
  if (opts.slug !== null) {
    entries = filterBySlug(entries, opts.slug)
    if (entries.length === 0) {
      if (opts.json) console.log(JSON.stringify({ entries: [] }, null, 2))
      else console.log(`No stashes match slug '${opts.slug}'.`)
      process.exit(1)
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ entries }, null, 2))
    return
  }

  if (opts.interactive) {
    await interactiveLoop(consumerRoot, entries)
    return
  }

  const md = formatMarkdown(consumerRoot, entries)
  const reportDir = join(consumerRoot, '.spectra')
  mkdirSync(reportDir, { recursive: true })
  const now = new Date()
  const fname = `stash-reconcile-${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}.md`
  const fpath = join(reportDir, fname)
  writeFileSync(fpath, md)
  console.log(`Wrote ${fpath} (${entries.length} entries)`)
  console.log(`Open in editor to review; use --interactive to handle inline.`)
}

main().catch((e) => {
  console.error('error:', e.message ?? e)
  const usage = [
    '',
    'Usage:',
    '  node scripts/stash-reconcile.mjs [--interactive|--json] [--include-all]',
    '                                   [--stale-days <N>] [--slug <substring>]',
    '',
    'See file header for full flag reference.',
  ].join('\n')
  console.error(usage)
  process.exit(2)
})
