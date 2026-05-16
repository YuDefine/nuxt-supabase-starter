#!/usr/bin/env node

/**
 * stash-reconcile.mjs — list + suggest actions for namespaced stash entries
 *
 * Surfaces git stash entries created by the worktree atomicity workflow:
 *   - `wt-merge-block/<slug>/<ISO>` — main-worktree blockers stashed by
 *     `wt-helper merge-back --auto-stash` (rules/core/worktree-default.md §5.5)
 *   - `cross-session-block-*` — legacy ad-hoc prefix from the pre-atomic
 *     pain era (perno 2026-05-17 session); included for migration coverage
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
 *   --interactive  prompt per stash with [a]pply / [d]rop / [v]iew / [s]kip menu
 *   --json         machine-readable output to stdout (no file written)
 *   --include-all  include unnamespaced stashes (filter disabled; useful for
 *                  one-time inventory of legacy stash state)
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

const NAMESPACED_PREFIXES = ['wt-merge-block/', 'cross-session-block-']

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
  return stashes.filter((s) => NAMESPACED_PREFIXES.some((p) => s.message.includes(p)))
}

function parseNamespace(message) {
  // wt-merge-block/<slug>/<ISO>
  const wtMatch = message.match(/wt-merge-block\/([^/]+)\/([0-9TZ:-]+)/)
  if (wtMatch) {
    return { kind: 'wt-merge-block', slug: wtMatch[1], iso: wtMatch[2] }
  }
  // cross-session-block-<slug>[-suffix]  (legacy from perno 2026-05-17)
  const csMatch = message.match(/cross-session-block-(.+)$/)
  if (csMatch) {
    return { kind: 'cross-session-block', slug: csMatch[1], iso: null }
  }
  return { kind: 'unknown', slug: null, iso: null }
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

function recommendAction(consumerRoot, ref, files) {
  // If applying the stash would overwrite currently-modified files in main → "view diff first".
  // If stash content is already present on main (zero net diff) → "drop is safe".
  // Otherwise → "apply".
  if (files.length === 0) return { action: 'view-diff', reason: 'no files in stash (corrupted?)' }

  // Quick heuristic: check if any file in stash is currently dirty in main
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

  // Check if stash content is already on main (apply would be no-op)
  // Compare stash's content vs HEAD: if diff is empty, it's already absorbed
  try {
    const diff = gitTrim(['diff', `${ref}^..${ref}`], { cwd: consumerRoot })
    if (!diff) return { action: 'drop', reason: 'stash content matches HEAD (already absorbed)' }
  } catch {}

  return { action: 'apply', reason: 'no conflicts; stash brings new content' }
}

function formatMarkdown(consumerRoot, entries) {
  const lines = []
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 16)
  lines.push(`# Stash Reconcile Report`, '')
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

async function main() {
  const args = process.argv.slice(2)
  const opts = {
    interactive: args.includes('--interactive'),
    json: args.includes('--json'),
    includeAll: args.includes('--include-all'),
  }

  const consumerRoot = findConsumerRoot()
  const all = listStashes(consumerRoot)
  const filtered = opts.includeAll ? all : filterNamespaced(all)

  if (filtered.length === 0) {
    if (opts.json) console.log(JSON.stringify({ entries: [] }, null, 2))
    else console.log('No namespaced stashes found.')
    process.exit(1)
  }

  const entries = filtered.map((s) => {
    const namespace = parseNamespace(s.message)
    const shape = inspectStashShape(consumerRoot, s.ref)
    const recommendation = recommendAction(consumerRoot, s.ref, shape.files)
    return { ...s, namespace, shape, recommendation }
  })

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
  const pad2 = (n) => String(n).padStart(2, '0')
  const now = new Date()
  const fname = `stash-reconcile-${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}.md`
  const fpath = join(reportDir, fname)
  writeFileSync(fpath, md)
  console.log(`Wrote ${fpath} (${entries.length} entries)`)
  console.log(`Open in editor to review; use --interactive to handle inline.`)
}

main().catch((e) => {
  console.error('error:', e.message ?? e)
  process.exit(2)
})
