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
 * Worktree drift triggers (any one is enough):
 *   1. Branch HEAD has ≥1 commit past main HEAD AND slug not mentioned in HANDOFF.md
 *      → "session work invisible to next session"
 *   2. Branch HEAD has commits dated newer than HANDOFF.md mtime AND slug is mentioned
 *      → "HANDOFF mention stale: branch progressed since last entry"
 *   3. Worktree branch is fully merged to main but worktree still exists
 *      → "ready to absorb via /spectra-archive or wt-helper merge-back"
 *   4. Branch HEAD is far behind main (≥ threshold commits) AND no other trigger fires
 *      → "wt drift > N commits, merge-back will likely conflict; sync soon"
 *
 * Trigger 4 fires only when other triggers don't (priority: merged >
 * unmentioned-progress > mention-stale > far-behind-main). Threshold default
 * 50; override via env var CLADE_HANDOFF_DRIFT_COMMIT_THRESHOLD=<N>.
 * Rationale: wt branches ≥ 50 commits behind main dramatically increase the
 * mechanical-conflict surface for merge-back pre-sync. Early signal lets users
 * sync proactively instead of discovering 95 conflicts at merge-back time
 * (TDMS 2026-05-24 warehouse-items-tool-aggregation incident).
 *
 * HANDOFF.md health triggers (independent of worktrees):
 *   5. handoff-size-exceeded — HANDOFF.md > max_kb threshold (default 30 KB,
 *      env CLADE_HANDOFF_MAX_KB)
 *   6. handoff-lines-exceeded — HANDOFF.md > max_lines threshold (default 400,
 *      env CLADE_HANDOFF_MAX_LINES)
 *   7. narrative-section-stale — completed-narrative dated section is older
 *      than narrative_age_days (default 3, env CLADE_HANDOFF_NARRATIVE_AGE_DAYS).
 *      "completed-narrative" = dated `## YYYY-MM-DD ...` section with no active
 *      signal (no unchecked checkboxes / no Outstanding / etc).
 *   8. active-section-stale — active dated section older than active_age_days
 *      (default 14, env CLADE_HANDOFF_ACTIVE_AGE_DAYS). Active = section body
 *      contains unchecked checkbox or active-intent keyword. Pure narrative
 *      should rotate at 3 days; active at 14 days warns about stuck WIP.
 *
 * Per-consumer overrides: registry/consumers.json entry can have an optional
 *   "handoff_audit_thresholds": {
 *     "max_kb": 50,
 *     "max_lines": 600,
 *     "narrative_age_days": 5,
 *     "active_age_days": 14
 *   }
 * field. drift-scan matches consumer by cwd basename === consumer_id.
 *
 * The `commitDistanceBehind` field is always emitted in JSON output (regardless
 * of trigger) so external monitors can track distribution without parsing
 * warning strings. Same applies to `handoffHealth.sizeKb` / `lines` / `sectionStats`.
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

const COMMIT_DISTANCE_THRESHOLD_DEFAULT = 50
const HANDOFF_MAX_KB_DEFAULT = 30
const HANDOFF_MAX_LINES_DEFAULT = 400
const HANDOFF_NARRATIVE_AGE_DAYS_DEFAULT = 3
const HANDOFF_ACTIVE_AGE_DAYS_DEFAULT = 14

// Conservative keyword list — any one occurrence in a dated section's title
// or body marks it active. False-positive risk on completed sections is OK
// because the Mode B rotate plan presents results to user via AskUserQuestion.
const ACTIVE_SIGNAL_KEYWORDS = [
  '- [ ]',
  'Outstanding',
  'outstanding',
  'Next session',
  'next session',
  'Next Steps',
  '下次 session',
  '待後續',
  '待接手',
  '待補',
  '待 user',
  '待客戶',
  '等客戶',
  '等 user',
  '等 prod',
  '等 deploy',
  'awaiting',
  '[discuss]',
  '尚未',
  '未完',
  'TODO',
  'TBD',
]

// Section title substring match (case-insensitive) → classified as baseline
// snapshot (legitimate to keep in HANDOFF as overwriting block, not narrative).
const BASELINE_TITLE_KEYWORDS = [
  'worktree audit',
  'worktree & stash audit',
  'stash audit',
  'review-gui readiness',
  'parked',
  'deferred discuss',
  '跨 repo',
  '並行 session',
  'in progress',
  'blocked',
  'next steps',
]

import { execFileSync } from 'node:child_process'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'

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

// How many commits is the wt branch behind main? Uses `git rev-list --count
// <branch>..main` — same semantics as wt-helper.mjs cmdMergeBack's preSyncBehind.
function branchCommitsBehindMain(consumerRoot, branchName) {
  try {
    const out = gitTrim(['rev-list', '--count', `${branchName}..main`], { cwd: consumerRoot })
    return parseInt(out, 10) || 0
  } catch {
    return 0
  }
}

function commitDistanceThreshold() {
  const raw = process.env.CLADE_HANDOFF_DRIFT_COMMIT_THRESHOLD
  if (raw === undefined || raw === '') return COMMIT_DISTANCE_THRESHOLD_DEFAULT
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : COMMIT_DISTANCE_THRESHOLD_DEFAULT
}

function lastCommitTimestamp(consumerRoot, branchName) {
  try {
    const sec = parseInt(
      gitTrim(['log', '-1', '--format=%ct', branchName], { cwd: consumerRoot }),
      10,
    )
    return Number.isFinite(sec) ? sec * 1000 : 0
  } catch {
    return 0
  }
}

// --- HANDOFF.md health audit -------------------------------------------------

function envPositiveInt(key, fallback) {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function findCladeHome() {
  if (process.env.CLADE_HOME) return process.env.CLADE_HOME
  const home = process.env.HOME || ''
  if (!home) return null
  const candidate = join(home, 'offline', 'clade')
  return existsSync(join(candidate, 'registry', 'consumers.json')) ? candidate : null
}

function loadConsumerThresholds(consumerRoot) {
  const defaults = {
    max_kb: envPositiveInt('CLADE_HANDOFF_MAX_KB', HANDOFF_MAX_KB_DEFAULT),
    max_lines: envPositiveInt('CLADE_HANDOFF_MAX_LINES', HANDOFF_MAX_LINES_DEFAULT),
    narrative_age_days: envPositiveInt(
      'CLADE_HANDOFF_NARRATIVE_AGE_DAYS',
      HANDOFF_NARRATIVE_AGE_DAYS_DEFAULT,
    ),
    active_age_days: envPositiveInt(
      'CLADE_HANDOFF_ACTIVE_AGE_DAYS',
      HANDOFF_ACTIVE_AGE_DAYS_DEFAULT,
    ),
  }
  const cladeHome = findCladeHome()
  if (!cladeHome) return defaults
  try {
    const registry = JSON.parse(readFileSync(join(cladeHome, 'registry', 'consumers.json'), 'utf8'))
    const consumers = registry.consumers || []
    const id = basename(consumerRoot)
    const match = consumers.find((c) => c.consumer_id === id)
    if (match && match.handoff_audit_thresholds) {
      return { ...defaults, ...match.handoff_audit_thresholds }
    }
  } catch {
    // ignore — fall back to defaults
  }
  return defaults
}

function parseDatedTitleDate(title) {
  const m = title.match(/^(\d{4})-(\d{2})-(\d{2})\b/)
  if (!m) return null
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseHandoffSections(text) {
  const sections = []
  const lines = text.split('\n')
  let current = null
  let currentBodyStart = 0
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^## (.+?)\s*$/)
    if (!m) continue
    if (current) {
      current.body = lines.slice(currentBodyStart, i).join('\n')
      sections.push(current)
    }
    current = { title: m[1], startLine: i + 1, body: '' }
    currentBodyStart = i + 1
  }
  if (current) {
    current.body = lines.slice(currentBodyStart).join('\n')
    sections.push(current)
  }
  return sections
}

function classifySection(title, body) {
  const titleLower = title.toLowerCase()
  for (const kw of BASELINE_TITLE_KEYWORDS) {
    if (titleLower.includes(kw)) return 'baseline'
  }
  if (!parseDatedTitleDate(title)) return 'baseline'
  const combined = `${title}\n${body}`
  for (const kw of ACTIVE_SIGNAL_KEYWORDS) {
    if (combined.includes(kw)) return 'active'
  }
  return 'narrative'
}

function daysBetween(fromMs, toMs) {
  return Math.floor((toMs - fromMs) / 86400000)
}

function checkHandoffHealth(consumerRoot, thresholds, now = Date.now()) {
  const handoffPath = join(consumerRoot, 'HANDOFF.md')
  if (!existsSync(handoffPath)) {
    return { handoffPath, exists: false, thresholds, warnings: [] }
  }
  const text = readFileSync(handoffPath, 'utf8')
  const sizeBytes = Buffer.byteLength(text, 'utf8')
  const sizeKb = sizeBytes / 1024
  const lineCount = text.split('\n').length
  const sections = parseHandoffSections(text)
  const sectionStats = sections.map((s) => {
    const date = parseDatedTitleDate(s.title)
    const kind = classifySection(s.title, s.body)
    const ageDays = date ? daysBetween(date.getTime(), now) : null
    return {
      title: s.title,
      startLine: s.startLine,
      kind,
      date: date ? date.toISOString().slice(0, 10) : null,
      ageDays,
    }
  })

  const warnings = []
  if (sizeKb > thresholds.max_kb) {
    warnings.push({
      drift: 'handoff-size-exceeded',
      message: `HANDOFF.md is ${sizeKb.toFixed(1)} KB (threshold ${thresholds.max_kb} KB) — run \`/handoff\` Mode B to rotate completed narrative`,
    })
  }
  if (lineCount > thresholds.max_lines) {
    warnings.push({
      drift: 'handoff-lines-exceeded',
      message: `HANDOFF.md is ${lineCount} lines (threshold ${thresholds.max_lines}) — run \`/handoff\` Mode B to rotate`,
    })
  }
  for (const s of sectionStats) {
    if (s.kind === 'narrative' && s.ageDays !== null && s.ageDays > thresholds.narrative_age_days) {
      const month = s.date.slice(0, 7)
      warnings.push({
        drift: 'narrative-section-stale',
        message: `"## ${s.title}" is completed narrative ${s.ageDays}d old (threshold ${thresholds.narrative_age_days}d) — rotate to docs/archives/${month}-handoff-narrative.md`,
      })
    } else if (
      s.kind === 'active' &&
      s.ageDays !== null &&
      s.ageDays > thresholds.active_age_days
    ) {
      warnings.push({
        drift: 'active-section-stale',
        message: `"## ${s.title}" is active ${s.ageDays}d old (threshold ${thresholds.active_age_days}d) — outstanding work may be silently blocked, review or escalate`,
      })
    }
  }

  return {
    handoffPath,
    exists: true,
    sizeKb: Number(sizeKb.toFixed(1)),
    lines: lineCount,
    thresholds,
    sectionStats,
    warnings,
  }
}

// --- worktree drift ----------------------------------------------------------

function checkDrift(consumerRoot, worktree) {
  const slug = extractSlugFromBranch(worktree.branch)
  if (!slug) {
    return { worktree, slug: null, drift: null, message: null, commitDistanceBehind: 0 }
  }

  const handoffPath = join(consumerRoot, 'HANDOFF.md')
  const handoffExists = existsSync(handoffPath)
  const handoffMtime = handoffExists ? statSync(handoffPath).mtimeMs : 0
  const handoffText = handoffExists ? readFileSync(handoffPath, 'utf8') : ''
  const mentioned = handoffText.includes(slug)

  const commits = branchCommitsAheadOfMain(consumerRoot, worktree.branch)
  const lastCommitMs = lastCommitTimestamp(consumerRoot, worktree.branch)
  const merged = mergedBranches(consumerRoot).has(worktree.branch)
  // Always compute commit-distance-behind: external monitors / JSON consumers
  // want the raw number even when no trigger fires (track distribution).
  const commitDistanceBehind = branchCommitsBehindMain(consumerRoot, worktree.branch)
  const threshold = commitDistanceThreshold()

  // Trigger 3: branch fully merged, worktree still exists
  if (merged) {
    return {
      worktree,
      slug,
      drift: 'merged-but-not-cleaned',
      message: `worktree branch is fully merged to main; run \`wt-helper cleanup ${slug} --force --force-discard-unland\` or absorb via /spectra-archive`,
      commitDistanceBehind,
    }
  }

  if (commits.length === 0) {
    // No ahead-of-main commits → triggers 1/2 don't apply. Trigger 4 still can.
    if (commitDistanceBehind >= threshold) {
      return {
        worktree,
        slug,
        drift: 'far-behind-main',
        message: `wt branch is ${commitDistanceBehind} commit(s) behind main (threshold ${threshold}); merge-back pre-sync will likely conflict — sync proactively`,
        commitDistanceBehind,
      }
    }
    return { worktree, slug, drift: null, message: null, commitDistanceBehind }
  }

  // Trigger 1: branch ahead AND slug not in HANDOFF (work invisible)
  if (!mentioned) {
    return {
      worktree,
      slug,
      drift: 'unmentioned-progress',
      message: `branch has ${commits.length} commit(s) past main but slug not in HANDOFF.md — next session will not see this work`,
      commitDistanceBehind,
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
      commitDistanceBehind,
    }
  }

  // Trigger 4 (lowest priority): wt branch far behind main even though HANDOFF
  // is in good shape. Surfaces early before merge-back blows up with N conflicts
  // (TDMS 2026-05-24 warehouse-items-tool-aggregation: 184 commits behind → 95
  // pre-sync conflicts at merge-back).
  if (commitDistanceBehind >= threshold) {
    return {
      worktree,
      slug,
      drift: 'far-behind-main',
      message: `wt branch is ${commitDistanceBehind} commit(s) behind main (threshold ${threshold}); merge-back pre-sync will likely conflict — sync proactively`,
      commitDistanceBehind,
    }
  }

  return { worktree, slug, drift: null, message: null, commitDistanceBehind }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const opts = {
    json: args.has('--json'),
    quiet: args.has('--quiet'),
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
  const wtWarnings = results.filter((r) => r.drift)

  const thresholds = loadConsumerThresholds(consumerRoot)
  const handoffHealth = checkHandoffHealth(consumerRoot, thresholds)
  const healthWarnings = handoffHealth.warnings || []

  if (opts.json) {
    console.log(JSON.stringify({ consumerRoot, worktrees: results, handoffHealth }, null, 2))
    return
  }
  if (opts.quiet) return

  if (wtWarnings.length === 0 && healthWarnings.length === 0) {
    if (worktrees.length > 0) {
      console.error(`[handoff-drift] ${worktrees.length} session worktree(s); no drift detected`)
    }
    return
  }

  if (wtWarnings.length > 0) {
    console.error(
      `[handoff-drift] ${wtWarnings.length} of ${worktrees.length} session worktree(s) show drift:`,
    )
    for (const w of wtWarnings) {
      console.error(`  - ${w.slug} (${w.drift}): ${w.message}`)
    }
  }

  if (healthWarnings.length > 0) {
    console.error(
      `[handoff-drift] HANDOFF.md health: ${healthWarnings.length} issue(s) (${handoffHealth.sizeKb} KB / ${handoffHealth.lines} lines):`,
    )
    for (const w of healthWarnings) {
      console.error(`  - ${w.drift}: ${w.message}`)
    }
  }

  console.error(
    `  Tip: run \`/handoff\` to enter Mode B Health Gate (rotate completed narrative → docs/archives/<YYYY-MM>-handoff-narrative.md).`,
  )
}

main().catch((e) => {
  // Fail open — this is informational, must never break session start.
  console.error(`[handoff-drift] error (non-fatal): ${e.message ?? e}`)
})
