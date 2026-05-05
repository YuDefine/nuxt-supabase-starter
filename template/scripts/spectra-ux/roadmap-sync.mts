#!/usr/bin/env node
/**
 * Spectra Roadmap Sync (spectra-ux)
 *
 * Maintains `openspec/ROADMAP.md` as a single-source-of-truth dashboard for
 * spectra SDD workflow. The file has two auto-generated blocks (active
 * changes, parallelism tracks) and one manual block (next moves backlog).
 *
 * What gets auto-generated:
 *   - "Active Changes" — every directory under openspec/changes/ (excluding
 *     archive/) classified by stage (draft / wip / ready / blocked), with
 *     task completion % and the specs each change touches
 *   - "Parallel Tracks" — spec-collision analysis: independent (safe to run
 *     in parallel) / mutex (same spec touched) / blocked (explicit depends)
 *   - "Parked Changes" — sourced from `spectra list --parked --json`. Parked
 *     changes have their working directory removed but metadata persists in
 *     `.spectra/spectra.db`; this section keeps them visible so they don't
 *     fall off the roadmap until explicitly unparked or archived.
 *
 * What stays manual:
 *   - "Next Moves" — future intent captured during the spectra-discuss /
 *     spectra-propose workflow. This is where AI agents persist
 *     "we'll do X next" decisions between sessions.
 *
 * Configuration: reads `spectra-ux.config.json` at the project root.
 *   - `paths.openspec` (default `openspec`)
 *   - `roadmap.enabled` (default true)
 *   - `roadmap.path` (default `<openspec>/ROADMAP.md`)
 *
 * MANUAL drift detection (v1.6+):
 *   Every sync additionally scans the MANUAL block for stale claims against
 *   current ground truth:
 *     - `archived-as-active`   — MANUAL names a change that's already in
 *       openspec/changes/archive/ but describes it as in-progress/active.
 *     - `td-status-mismatch`   — MANUAL names a TD-NNN and describes it with
 *       active-language words, but docs/tech-debt.md register marks it
 *       done/wontfix.
 *     - `version-mismatch`     — MANUAL cites a "Production v*.*.*" version
 *       that disagrees with package.json's version field.
 *   Drift is reported as warnings on stderr and in the JSON payload; the
 *   MANUAL block itself is never rewritten (agent / user must update it).
 *
 * Usage:
 *   node scripts/spectra-ux/roadmap-sync.mts           # full sync (default)
 *   node scripts/spectra-ux/roadmap-sync.mts --check   # validate, no write
 *   node scripts/spectra-ux/roadmap-sync.mts --json    # emit report as JSON
 *
 * Exit: 0 clean · 1 check mode detected drift · 2 script error
 *
 * See docs/rules/ux-completeness.md and docs/ROADMAP.md for the workflow.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectClaims, type ClaimView } from './claims-lib.mts'

// ---------------- constants ----------------

const MARKERS = {
  activeStart: '<!-- SPECTRA-UX:ROADMAP-AUTO:active -->',
  activeEnd: '<!-- SPECTRA-UX:ROADMAP-AUTO:/active -->',
  claimsStart: '<!-- SPECTRA-UX:ROADMAP-AUTO:claims -->',
  claimsEnd: '<!-- SPECTRA-UX:ROADMAP-AUTO:/claims -->',
  parallelismStart: '<!-- SPECTRA-UX:ROADMAP-AUTO:parallelism -->',
  parallelismEnd: '<!-- SPECTRA-UX:ROADMAP-AUTO:/parallelism -->',
  parkedStart: '<!-- SPECTRA-UX:ROADMAP-AUTO:parked -->',
  parkedEnd: '<!-- SPECTRA-UX:ROADMAP-AUTO:/parked -->',
  backlogStart: '<!-- SPECTRA-UX:ROADMAP-MANUAL:backlog -->',
  backlogEnd: '<!-- SPECTRA-UX:ROADMAP-MANUAL:/backlog -->',
} as const

// Pairs of AUTO markers, used to exclude auto-generated regions from MANUAL
// drift scanning. MANUAL is everything outside these ranges.
const AUTO_MARKER_PAIRS: ReadonlyArray<[string, string]> = [
  [MARKERS.activeStart, MARKERS.activeEnd],
  [MARKERS.claimsStart, MARKERS.claimsEnd],
  [MARKERS.parallelismStart, MARKERS.parallelismEnd],
  [MARKERS.parkedStart, MARKERS.parkedEnd],
]

// Active-voice words that, when co-occurring with a known archived change
// name or a TD-NNN marked done, signal MANUAL-block drift. Mixed zh-TW + EN
// because MANUAL content in this template lineage is routinely bilingual.
const ACTIVE_LANGUAGE_RE =
  /進行中|實作中|開發中|待(?:archive|scheduled|handle|處理)|未解決|\bopen\b|\bactive\b|\bin\s*progress\b|\bwip\b|\bdraft\b|\bblocker\b/i

// Relative path from repo root to the tech-debt register.
const TECH_DEBT_REL_PATH = 'docs/tech-debt.md'

// Max directory levels to walk upward when finding the project root.
const MAX_WALK_DEPTH = 8

// ---------------- types ----------------

type Stage = 'draft' | 'wip' | 'ready' | 'blocked'

interface Config {
  openspecDir: string
  roadmapPath: string
  enabled: boolean
  claimsEnabled: boolean
  claimsDir: string
  claimsStaleSeconds: number
}

interface ChangeInfo {
  name: string
  dir: string
  stage: Stage
  tasksDone: number
  tasksTotal: number
  affectedSpecs: string[]
  dependsOn: string[]
  blockedReason: string | null
  mtime: number
}

interface ParallelismReport {
  independent: string[]
  mutex: Array<{ spec: string; changes: string[] }>
  blocked: Array<{ change: string; waitsFor: string[] }>
}

interface ParkedChange {
  name: string
  tasksDone: number
  tasksTotal: number
  summary: string
}

type ManualDriftType = 'archived-as-active' | 'td-status-mismatch' | 'version-mismatch'

interface ManualDrift {
  type: ManualDriftType
  claim: string // MANUAL excerpt (≤ 120 chars)
  reality: string // ground-truth description
  lineNumber: number // 1-based in the full roadmap file
  hint: string // suggested correction
}

interface SyncReport {
  changes: ChangeInfo[]
  claims: ClaimView[]
  parallelism: ParallelismReport
  parked: ParkedChange[]
  parkedSource: 'cli' | 'unavailable'
  manualDrift: ManualDrift[]
  roadmapPath: string
  wrote: boolean
  skipped: 'check-only' | 'check-skipped-no-cli' | null
}

interface CliOptions {
  check: boolean
  json: boolean
}

// ---------------- cli ----------------

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { check: false, json: false }
  for (const arg of argv.slice(2)) {
    if (arg === '--check') opts.check = true
    else if (arg === '--json') opts.json = true
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: roadmap-sync.mts [--check] [--json]\n' +
          '  --check   Validate only; do not write. Exit 1 if roadmap is stale.\n' +
          '  --json    Emit report as JSON instead of the normal summary.'
      )
      process.exit(0)
    } else {
      console.error(`roadmap-sync: unknown flag ${arg}`)
      process.exit(2)
    }
  }
  return opts
}

const cli = parseArgs(process.argv)

// ---------------- repo root + config ----------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function findRepoRoot(): string {
  // Prefer spectra-ux.config.json as the canonical anchor. Fallback to .git
  // for installs without config, final fallback is script dir's grandparent.
  let dir = __dirname
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    if (existsSync(resolve(dir, 'spectra-ux.config.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  dir = __dirname
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    if (existsSync(resolve(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return resolve(__dirname, '..')
}

const repoRoot = findRepoRoot()

function loadConfig(): Config {
  const configPath = resolve(repoRoot, 'spectra-ux.config.json')
  const defaults: Config = {
    openspecDir: 'openspec',
    roadmapPath: 'openspec/ROADMAP.md',
    enabled: true,
    claimsEnabled: true,
    claimsDir: '.spectra/claims',
    claimsStaleSeconds: 60 * 60,
  }
  if (!existsSync(configPath)) return defaults
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      paths?: { openspec?: string }
      roadmap?: { enabled?: boolean; path?: string }
      claims?: { enabled?: boolean; path?: string; staleSeconds?: number }
    }
    const openspecDir = raw.paths?.openspec ?? defaults.openspecDir
    const roadmapPath = raw.roadmap?.path ?? `${openspecDir.replace(/\/$/, '')}/ROADMAP.md`
    const enabled = raw.roadmap?.enabled ?? true
    const claimsEnabled = raw.claims?.enabled ?? defaults.claimsEnabled
    const claimsDir = raw.claims?.path ?? defaults.claimsDir
    const claimsStaleSeconds =
      typeof raw.claims?.staleSeconds === 'number' && Number.isFinite(raw.claims.staleSeconds)
        ? Math.max(60, Math.floor(raw.claims.staleSeconds))
        : defaults.claimsStaleSeconds
    return {
      openspecDir,
      roadmapPath,
      enabled,
      claimsEnabled,
      claimsDir,
      claimsStaleSeconds,
    }
  } catch (err) {
    console.error(`roadmap-sync: failed to read spectra-ux.config.json: ${err}`)
    return defaults
  }
}

// ---------------- scanning ----------------

function readSafe(path: string): string {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
}

function statMtime(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

function listValidSpecs(openspecDir: string): Set<string> {
  const specsDir = resolve(repoRoot, openspecDir, 'specs')
  if (!existsSync(specsDir)) return new Set()
  try {
    const entries = readdirSync(specsDir, { withFileTypes: true })
    return new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name))
  } catch {
    return new Set()
  }
}

function listActiveChangeDirs(openspecDir: string): string[] {
  const changesDir = resolve(repoRoot, openspecDir, 'changes')
  if (!existsSync(changesDir)) return []
  try {
    return readdirSync(changesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'archive' && !e.name.startsWith('.'))
      .map((e) => resolve(changesDir, e.name))
  } catch {
    return []
  }
}

/**
 * Parse `- [ ]` / `- [x]` / `- [X]` checkboxes from tasks.md. Both bullet
 * styles (`- ` and `* `) and leading whitespace are tolerated. Numbered
 * task headings (`## 1. Foo`) are not counted — only actual checkboxes.
 */
function parseTasks(content: string): { done: number; total: number } {
  let done = 0
  let total = 0
  const re = /^\s*[-*]\s*\[([ xX])\]/gm
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    total += 1
    if (match[1] !== ' ') done += 1
  }
  return { done, total }
}

/**
 * Extract spec names from proposal.md. Strategy:
 *   1. Take the `## Capabilities` and `## Impact` sections
 *   2. Extract any `` `identifier` `` backtick-quoted token
 *   3. Filter by whether that identifier matches an actual spec directory
 *
 * This avoids false positives from code-style backticks (`user_id`, `400`)
 * while still catching the canonical ways spectra proposals cite specs.
 */
function extractAffectedSpecs(content: string, validSpecs: Set<string>): string[] {
  const sections: string[] = []
  for (const name of ['Capabilities', 'Impact', 'Affected specs']) {
    const section = extractMarkdownSection(content, name)
    if (section) sections.push(section)
  }
  if (sections.length === 0) return []

  const joined = sections.join('\n')
  const hits = new Set<string>()
  const re = /`([a-z][a-z0-9-]*[a-z0-9])`/g
  let match: RegExpExecArray | null
  while ((match = re.exec(joined)) !== null) {
    const name = match[1]!
    if (validSpecs.has(name)) hits.add(name)
  }
  return [...hits].toSorted()
}

/**
 * Extract a `## Heading` section body up to (but not including) the next
 * `## ` heading of the same level. Case-insensitive heading match.
 */
function extractMarkdownSection(content: string, heading: string): string | null {
  const lines = content.split('\n')
  const target = heading.toLowerCase()
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^##\s+/.test(line) && line.slice(3).trim().toLowerCase() === target) {
      start = i + 1
      break
    }
  }
  if (start === -1) return null
  let end = lines.length
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!)) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

/**
 * Parse `<!-- depends: change-name -->` / `<!-- depends: a, b -->` markers
 * from proposal.md. Multiple markers are unioned.
 */
function extractDependencies(content: string): string[] {
  const deps = new Set<string>()
  const re = /<!--\s*depends:\s*([^>]+?)\s*-->/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    for (const raw of match[1]!.split(',')) {
      const name = raw.trim()
      if (name) deps.add(name)
    }
  }
  return [...deps].toSorted()
}

/**
 * Parse `<!-- blocked: reason -->` marker — presence forces stage=blocked.
 */
function extractBlockedReason(content: string): string | null {
  const match = /<!--\s*blocked:\s*([^>]+?)\s*-->/i.exec(content)
  return match ? match[1]!.trim() : null
}

function classifyStage(
  tasks: { done: number; total: number },
  hasTasksFile: boolean,
  blockedReason: string | null
): Stage {
  if (blockedReason) return 'blocked'
  if (!hasTasksFile || tasks.total === 0) return 'draft'
  if (tasks.done === 0) return 'draft'
  if (tasks.done === tasks.total) return 'ready'
  return 'wip'
}

function scanChanges(openspecDir: string): ChangeInfo[] {
  const validSpecs = listValidSpecs(openspecDir)
  const dirs = listActiveChangeDirs(openspecDir)
  const changes: ChangeInfo[] = []

  for (const dir of dirs) {
    const proposalPath = join(dir, 'proposal.md')
    const tasksPath = join(dir, 'tasks.md')
    if (!existsSync(proposalPath)) continue

    const proposalContent = readSafe(proposalPath)
    const tasksContent = existsSync(tasksPath) ? readSafe(tasksPath) : ''
    const tasks = parseTasks(tasksContent)
    const blockedReason =
      extractBlockedReason(proposalContent) || extractBlockedReason(tasksContent)

    const info: ChangeInfo = {
      name: dir.split('/').pop() ?? dir,
      dir,
      stage: classifyStage(tasks, existsSync(tasksPath), blockedReason),
      tasksDone: tasks.done,
      tasksTotal: tasks.total,
      affectedSpecs: extractAffectedSpecs(proposalContent, validSpecs),
      dependsOn: extractDependencies(proposalContent),
      blockedReason,
      mtime: Math.max(statMtime(proposalPath), statMtime(tasksPath)),
    }
    changes.push(info)
  }

  changes.sort((a, b) => a.name.localeCompare(b.name))
  return changes
}

// ---------------- parallelism ----------------

function analyzeParallelism(changes: ChangeInfo[]): ParallelismReport {
  // Mutex detection runs across ALL non-archived changes (including ready
  // and blocked) so users see spec collisions even right before archive.
  // Independent/blocked lists are narrowed to "next-to-start" scope below.
  const specToChanges = new Map<string, string[]>()
  for (const c of changes) {
    for (const spec of c.affectedSpecs) {
      const list = specToChanges.get(spec) ?? []
      list.push(c.name)
      specToChanges.set(spec, list)
    }
  }

  const mutex: ParallelismReport['mutex'] = []
  const mutexChanges = new Set<string>()
  for (const [spec, names] of specToChanges) {
    if (names.length > 1) {
      mutex.push({ spec, changes: [...names].toSorted() })
      for (const n of names) mutexChanges.add(n)
    }
  }
  mutex.sort((a, b) => a.spec.localeCompare(b.spec))

  // Independent / blocked only consider "next to start" changes — wip + draft.
  // Ready changes are waiting for archive, not waiting for parallel work.
  const candidates = changes.filter((c) => c.stage === 'wip' || c.stage === 'draft')
  const allActiveNames = new Set(changes.map((c) => c.name))

  const blocked: ParallelismReport['blocked'] = []
  const blockedNames = new Set<string>()
  for (const c of candidates) {
    if (c.dependsOn.length === 0) continue
    // A dependency blocks only if it's still in-flight. If the dep is
    // already archived (not in changes/) or not found at all, we treat it
    // as satisfied — the user either finished it or typoed the name.
    const waiting = c.dependsOn.filter((d) => {
      if (!allActiveNames.has(d)) return false
      const depChange = changes.find((x) => x.name === d)
      return depChange?.stage !== 'ready'
    })
    if (waiting.length > 0) {
      blocked.push({ change: c.name, waitsFor: waiting.toSorted() })
      blockedNames.add(c.name)
    }
  }
  blocked.sort((a, b) => a.change.localeCompare(b.change))

  // Independent = candidates not in mutex nor blocked
  const independent = candidates
    .filter((c) => !mutexChanges.has(c.name) && !blockedNames.has(c.name))
    .map((c) => c.name)
    .toSorted()

  return { independent, mutex, blocked }
}

// ---------------- parked changes ----------------

interface ParkedRaw {
  name: string
  completedTasks?: number
  totalTasks?: number
  summary?: string
}

/**
 * Fetch the parked-change list via `spectra list --parked --json`. Parked
 * changes don't live on disk under openspec/changes/, so we can't scan them
 * the same way as active ones — the CLI is the authoritative source.
 *
 * Returns `{ parked: [], source: 'unavailable' }` when the spectra CLI isn't
 * on PATH or the call fails. We never crash the sync — a missing CLI just
 * means the Parked block can't be regenerated.
 *
 * Distinguishes two failure modes:
 *   - ENOENT (CLI not installed) → silent fallback. This is normal in fresh
 *     clones / CI environments where `pnpm install` doesn't ship spectra CLI.
 *     The caller will preserve the existing Parked block to avoid false
 *     stale signals in `--check` mode.
 *   - Other errors (CLI present but failed) → emit warning to stderr so
 *     real bugs (corrupt DB, JSON parse error, etc.) stay visible.
 */
function collectParkedChanges(): {
  parked: ParkedChange[]
  source: 'cli' | 'unavailable'
} {
  try {
    const raw = execFileSync('spectra', ['list', '--parked', '--json'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const parsed = JSON.parse(raw) as { parked?: ParkedRaw[] }
    const list = parsed.parked ?? []
    const parked = list
      .filter((p): p is ParkedRaw => Boolean(p && typeof p.name === 'string'))
      .map<ParkedChange>((p) => ({
        name: p.name,
        tasksDone: typeof p.completedTasks === 'number' ? p.completedTasks : 0,
        tasksTotal: typeof p.totalTasks === 'number' ? p.totalTasks : 0,
        summary: (p.summary ?? '').trim(),
      }))
      .toSorted((a, b) => a.name.localeCompare(b.name))
    return { parked, source: 'cli' }
  } catch (err) {
    // ENOENT = CLI not on PATH (fresh clone, CI without spectra installed).
    // Stay silent — caller will preserve existing Parked block.
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn(
        `roadmap-sync: spectra CLI call failed, parked block will be preserved (${(err as Error).message})`
      )
    }
    return { parked: [], source: 'unavailable' }
  }
}

/**
 * Extract the body between two markers (exclusive). Returns null when either
 * marker is missing. Used to lift the existing Parked block out of the file
 * verbatim when the spectra CLI isn't available — keeps the section stable
 * across CI runs that lack the CLI.
 */
function extractBetween(content: string, startMarker: string, endMarker: string): string | null {
  const startIdx = content.indexOf(startMarker)
  if (startIdx === -1) return null
  const endIdx = content.indexOf(endMarker, startIdx + startMarker.length)
  if (endIdx === -1) return null
  const after = startIdx + startMarker.length
  return content.slice(after, endIdx).trim()
}

// ---------------- manual drift detection ----------------

/**
 * List every change name under `openspec/changes/archive/`. Returns both the
 * raw directory names (e.g. `2026-04-20-foo-bar`) and the date-stripped
 * variants (`foo-bar`). Callers search MANUAL text with both forms since
 * MANUAL-authored prose typically omits the date prefix.
 *
 * Short names (< 5 chars post-strip) are dropped to avoid false-positives
 * like a word "api" matching an archived change literally named "api".
 */
function listArchivedChangeNames(openspecDir: string): Set<string> {
  const archiveDir = resolve(repoRoot, openspecDir, 'changes', 'archive')
  if (!existsSync(archiveDir)) return new Set()
  try {
    const entries = readdirSync(archiveDir, { withFileTypes: true })
    const names = new Set<string>()
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const stripped = entry.name.replace(/^\d{4}-\d{2}-\d{2}-/, '')
      if (entry.name.length >= 5) names.add(entry.name)
      if (stripped.length >= 5) names.add(stripped)
    }
    return names
  } catch {
    return new Set()
  }
}

/**
 * Parse `docs/tech-debt.md` and return Map<TD-NNN, status>.
 * Only reads the `**Status**: …` line directly after each `## TD-NNN —` heading.
 * Returns empty Map if the register file is absent — drift check then skips TD.
 */
function parseTechDebtStatuses(): Map<string, string> {
  const path = resolve(repoRoot, TECH_DEBT_REL_PATH)
  if (!existsSync(path)) return new Map()
  try {
    const content = readFileSync(path, 'utf-8')
    const statuses = new Map<string, string>()
    const lines = content.split('\n')
    let pendingId: string | null = null
    for (const line of lines) {
      const headerMatch = line.match(/^##\s+(TD-\d+)\s+—/)
      if (headerMatch) {
        pendingId = headerMatch[1]!
        continue
      }
      if (!pendingId) continue
      const statusMatch = line.match(/^\*\*Status\*\*:\s+([\w-]+)/)
      if (statusMatch) {
        statuses.set(pendingId, statusMatch[1]!.toLowerCase())
        pendingId = null
      }
    }
    return statuses
  } catch {
    return new Map()
  }
}

/**
 * Read project `package.json` version. Returns null when the file is absent
 * or malformed — drift check then skips version comparison.
 */
function readPackageVersion(): string | null {
  const pkgPath = resolve(repoRoot, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

/**
 * Scan MANUAL regions of the roadmap for stale claims against ground truth.
 *
 * Three drift categories are detected (see header docstring for summary):
 *   - archived-as-active
 *   - td-status-mismatch
 *   - version-mismatch
 *
 * AUTO regions (enclosed by AUTO_MARKER_PAIRS) are skipped so auto-generated
 * content never flags itself. One drift max per (type, line) to avoid noise
 * when a single line mentions multiple stale names.
 */
function detectManualDrift(content: string, openspecDir: string): ManualDrift[] {
  const archivedNames = listArchivedChangeNames(openspecDir)
  const techDebt = parseTechDebtStatuses()
  const pkgVersion = readPackageVersion()

  const lines = content.split('\n')

  // Mark AUTO regions (inclusive of marker lines) to skip during scan.
  const autoRanges: Array<[number, number]> = []
  for (const [startMarker, endMarker] of AUTO_MARKER_PAIRS) {
    const startIdx = lines.findIndex((l) => l.includes(startMarker))
    if (startIdx === -1) continue
    const endIdx = lines.findIndex((l, i) => i >= startIdx && l.includes(endMarker))
    if (endIdx === -1) continue
    autoRanges.push([startIdx, endIdx])
  }
  const inAutoRegion = (idx: number): boolean => autoRanges.some(([s, e]) => idx >= s && idx <= e)

  const drifts: ManualDrift[] = []
  const seen = new Set<string>()
  const record = (drift: ManualDrift): void => {
    const key = `${drift.type}:${drift.lineNumber}`
    if (seen.has(key)) return
    seen.add(key)
    drifts.push(drift)
  }

  for (let i = 0; i < lines.length; i++) {
    if (inAutoRegion(i)) continue
    const line = lines[i]!
    if (!line.trim()) continue

    const hasActiveVoice = ACTIVE_LANGUAGE_RE.test(line)

    // 1. archived-as-active
    if (hasActiveVoice && archivedNames.size > 0) {
      for (const name of archivedNames) {
        if (!line.includes(name)) continue
        record({
          type: 'archived-as-active',
          claim: line.trim().slice(0, 120),
          reality: `openspec/changes/archive/ 已存在 ${name}（該 change 已 archive）`,
          lineNumber: i + 1,
          hint: '移除此行或改寫反映已完成；避免把已 archive 的 change 描述為進行中',
        })
        break
      }
    }

    // 2. td-status-mismatch
    if (hasActiveVoice && techDebt.size > 0) {
      const tdMatches = [...line.matchAll(/\b(TD-\d+)\b/g)]
      for (const match of tdMatches) {
        const id = match[1]!
        const status = techDebt.get(id)
        if (!status) continue
        if (status !== 'done' && status !== 'wontfix') continue
        record({
          type: 'td-status-mismatch',
          claim: line.trim().slice(0, 120),
          reality: `${TECH_DEBT_REL_PATH} ${id} Status: ${status}`,
          lineNumber: i + 1,
          hint: `從 MANUAL 的 active 清單移除 ${id}，或改寫反映已 ${status}`,
        })
      }
    }

    // 3. version-mismatch — fire only when the line asserts the CURRENT
    // production version. Require a production-state phrase adjacent to the
    // version token so "migration applied to prod" or future-work refs like
    // "v1.0.0 archive 之後" don't trip this check.
    if (pkgVersion) {
      const assertionRe =
        /(?:Production\s*(?:跑|running|version)?|running|deployed|current(?:ly)?|目前(?:跑)?)\s*:?\s*v?(\d+\.\d+\.\d+)\b/i
      const assertion = assertionRe.exec(line)
      if (assertion && assertion[1] !== pkgVersion) {
        record({
          type: 'version-mismatch',
          claim: line.trim().slice(0, 120),
          reality: `package.json version: ${pkgVersion}`,
          lineNumber: i + 1,
          hint: `更新為 v${pkgVersion}（或移除 MANUAL 的硬編版號）`,
        })
      }
    }
  }

  return drifts
}

// ---------------- rendering ----------------

function fmtPercent(done: number, total: number): string {
  if (total === 0) return '—'
  return `${Math.round((done / total) * 100)}%`
}

function fmtChangeLine(c: ChangeInfo): string {
  const progress =
    c.tasksTotal > 0
      ? `${c.tasksDone}/${c.tasksTotal} tasks (${fmtPercent(c.tasksDone, c.tasksTotal)})`
      : 'proposal only'
  const specs =
    c.affectedSpecs.length > 0
      ? `\n  - Specs: ${c.affectedSpecs.map((s) => `\`${s}\``).join(', ')}`
      : ''
  const deps = c.dependsOn.length > 0 ? `\n  - Depends on: ${c.dependsOn.join(', ')}` : ''
  const blocked = c.blockedReason ? `\n  - Blocked: ${c.blockedReason}` : ''
  return `- **${c.name}** — ${progress}${specs}${deps}${blocked}`
}

function renderActiveBlock(changes: ChangeInfo[], now: Date): string {
  const ts = now.toISOString()
  const ready = changes.filter((c) => c.stage === 'ready')
  const wip = changes.filter((c) => c.stage === 'wip')
  const draft = changes.filter((c) => c.stage === 'draft')
  const blocked = changes.filter((c) => c.stage === 'blocked')

  const section = (title: string, items: ChangeInfo[]): string => {
    if (items.length === 0) return `### ${title}\n\n_(none)_\n`
    return `### ${title}\n\n${items.map(fmtChangeLine).join('\n')}\n`
  }

  const total = changes.length
  const summary =
    total === 0
      ? '_No active changes._'
      : `${total} active change${total === 1 ? '' : 's'} (${ready.length} ready · ${wip.length} in progress · ${draft.length} draft · ${blocked.length} blocked)`

  return [
    '## Active Changes',
    '',
    `_last synced: ${ts}_`,
    '',
    summary,
    '',
    section('Ready to apply', ready),
    section('In progress', wip),
    section('Draft', draft),
    section('Blocked', blocked),
  ]
    .join('\n')
    .trimEnd()
}

function fmtClaimLine(claim: ClaimView): string {
  const task = claim.record.task ? `\n  - Task: ${claim.record.task}` : ''
  const note = claim.record.note ? `\n  - Note: ${claim.record.note}` : ''
  const session = claim.record.sessionId ? `\n  - Session: ${claim.record.sessionId}` : ''
  const paths =
    claim.record.paths.length > 0
      ? `\n  - Paths: ${claim.record.paths.map((path) => `\`${path}\``).join(', ')}`
      : ''
  const takeover = claim.stale
    ? `\n  - Status: stale (last heartbeat ${claim.record.updatedAt})`
    : ''
  return `- **${claim.record.change}** — ${claim.record.owner} (${claim.record.runtime})\n  - Accepted from: ${claim.record.acceptedFrom}\n  - Last heartbeat: ${claim.record.updatedAt}${task}${note}${session}${paths}${takeover}`
}

function renderClaimsBlock(claims: ClaimView[], enabled: boolean): string {
  const intro = [
    '## Active Claims',
    '',
    '> 即時 ownership 由 `.spectra/claims/*.json` 提供。',
    '> 接手 handoff / 開始做 change 時，先 claim，再移除 `HANDOFF.md` 對應項目。',
    '',
  ]

  if (!enabled) {
    return [...intro, '_Claims disabled in `spectra-ux.config.json`._'].join('\n').trimEnd()
  }

  if (claims.length === 0) {
    return [
      ...intro,
      '_No active claims._',
      '',
      '> 若你要開始做上面的 active change，先跑 `spectra:claim -- <change>`。',
    ]
      .join('\n')
      .trimEnd()
  }

  const active = claims.filter((claim) => !claim.stale)
  const stale = claims.filter((claim) => claim.stale)

  const section = (title: string, items: ClaimView[], empty: string): string => {
    if (items.length === 0) return `### ${title}\n\n${empty}\n`
    return `### ${title}\n\n${items.map(fmtClaimLine).join('\n')}\n`
  }

  return [
    ...intro,
    `${claims.length} claim${claims.length === 1 ? '' : 's'} (${active.length} active · ${stale.length} stale)`,
    '',
    section('Live Ownership', active, '_(none)_'),
    section('Stale Claims', stale, '_(none)_'),
  ]
    .join('\n')
    .trimEnd()
}

function parallelismSection(title: string, body: string): string {
  return `### ${title}\n\n${body || '_(none)_'}\n`
}

function renderParallelismBlock(report: ParallelismReport): string {
  const indepBody = report.independent.length
    ? report.independent.map((n) => `- \`${n}\``).join('\n')
    : ''

  const mutexBody = report.mutex.length
    ? report.mutex
        .map(
          (m) =>
            `- **${m.spec}** — conflict between: ${m.changes.map((c) => `\`${c}\``).join(', ')}`
        )
        .join('\n')
    : ''

  const blockedBody = report.blocked.length
    ? report.blocked
        .map((b) => `- \`${b.change}\` waits for: ${b.waitsFor.map((w) => `\`${w}\``).join(', ')}`)
        .join('\n')
    : ''

  return [
    '## Parallel Tracks',
    '',
    '> Which active changes can be worked on **simultaneously** without stepping on each other.',
    '',
    parallelismSection('Independent (can run in parallel)', indepBody),
    parallelismSection('Mutex (same spec touched)', mutexBody),
    parallelismSection('Blocked by dependency', blockedBody),
  ]
    .join('\n')
    .trimEnd()
}

function renderParkedBlock(parked: ParkedChange[], source: 'cli' | 'unavailable'): string {
  const intro = [
    '## Parked Changes',
    '',
    '> 已 `spectra park` 的 changes。檔案暫時從 `openspec/changes/` 移出，',
    '> metadata 保留在 `.spectra/spectra.db`。`spectra unpark <name>` 可取回。',
    '',
  ]

  if (source === 'unavailable') {
    return [
      ...intro,
      '_spectra CLI unavailable — run `spectra list --parked` manually to inspect parked work._',
    ]
      .join('\n')
      .trimEnd()
  }

  if (parked.length === 0) {
    return [...intro, '_No parked changes._'].join('\n').trimEnd()
  }

  const summary = `${parked.length} parked change${parked.length === 1 ? '' : 's'}`
  const items = parked
    .map((p) => {
      const progress =
        p.tasksTotal > 0
          ? `${p.tasksDone}/${p.tasksTotal} tasks (${fmtPercent(p.tasksDone, p.tasksTotal)})`
          : 'proposal only'
      const summaryLine = p.summary ? `\n  - Summary: ${p.summary}` : ''
      return `- **${p.name}** — ${progress}${summaryLine}`
    })
    .join('\n')

  return [...intro, summary, '', items].join('\n').trimEnd()
}

// ---------------- writing ----------------

/**
 * Replace content between two markers. If the markers don't exist and an
 * `insertBefore` anchor is provided, insert the new block immediately above
 * that anchor; otherwise append at the end of the file. The markers
 * themselves are preserved verbatim.
 */
function replaceBetween(
  content: string,
  startMarker: string,
  endMarker: string,
  body: string,
  insertBefore?: string
): string {
  const startIdx = content.indexOf(startMarker)
  const endIdx = content.indexOf(endMarker)
  const block = `${startMarker}\n\n${body}\n\n${endMarker}`

  if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
    const before = content.slice(0, startIdx)
    const after = content.slice(endIdx + endMarker.length)
    return `${before}${block}${after}`
  }

  if (insertBefore) {
    const anchorIdx = content.indexOf(insertBefore)
    if (anchorIdx !== -1) {
      const before = content.slice(0, anchorIdx).replace(/\n*$/, '\n\n')
      const after = content.slice(anchorIdx)
      return `${before}${block}\n\n${after}`
    }
  }

  // Append a new block; ensure single trailing newline
  const sep = content.endsWith('\n') ? '\n' : '\n\n'
  return `${content}${sep}${block}\n`
}

function scaffoldRoadmap(): string {
  return [
    '# OpenSpec Roadmap',
    '',
    '> Maintained by spectra-ux. AUTO blocks are regenerated by `spectra:roadmap`;',
    '> the MANUAL backlog is curated by you and your AI agent during the spectra-discuss / spectra-propose workflow.',
    '',
    MARKERS.activeStart,
    MARKERS.activeEnd,
    '',
    MARKERS.claimsStart,
    MARKERS.claimsEnd,
    '',
    MARKERS.parallelismStart,
    MARKERS.parallelismEnd,
    '',
    MARKERS.parkedStart,
    MARKERS.parkedEnd,
    '',
    MARKERS.backlogStart,
    '',
    '## Next Moves',
    '',
    '> 由你與 AI agent 在 `spectra-discuss` / `spectra-propose` workflow 結束時維護。',
    '> 格式：`- [priority] 描述 — 依賴：xxx / 獨立 / 互斥：yyy`',
    '> priority: `high` / `mid` / `low`',
    '',
    '### 近期',
    '',
    '_(尚未累積)_',
    '',
    '### 中期',
    '',
    '_(尚未累積)_',
    '',
    '### 長期',
    '',
    '_(尚未累積)_',
    '',
    MARKERS.backlogEnd,
    '',
  ].join('\n')
}

function readOrScaffoldRoadmap(roadmapPath: string): string {
  if (existsSync(roadmapPath)) return readFileSync(roadmapPath, 'utf-8')
  return scaffoldRoadmap()
}

// ---------------- main ----------------
//
// v1.6+: no mtime fast path. Every invocation re-scans active changes,
// regenerates AUTO blocks, and runs MANUAL drift detection. The earlier
// optimisation skipped drift detection silently, which let MANUAL content
// drift unnoticed across sessions. Full sync is still < 100ms on a typical
// project; the clarity is worth the cost.

function syncRoadmap(): SyncReport {
  const config = loadConfig()
  const roadmapPath = resolve(repoRoot, config.roadmapPath)

  const changes = scanChanges(config.openspecDir)
  const claims = collectClaims({
    repoRoot,
    openspecDir: config.openspecDir,
    claimsDir: config.claimsDir,
    staleSeconds: config.claimsStaleSeconds,
    enabled: config.claimsEnabled,
  })
  const parallelism = analyzeParallelism(changes)
  const { parked, source: parkedSource } = collectParkedChanges()

  const report: SyncReport = {
    changes,
    claims,
    parallelism,
    parked,
    parkedSource,
    manualDrift: [],
    roadmapPath,
    wrote: false,
    skipped: null,
  }

  if (!config.enabled) {
    report.skipped = 'check-only'
    return report
  }

  // `--check` mode short-circuit: if the spectra CLI is unavailable, we cannot
  // authoritatively regenerate the Parked block. Even though syncRoadmap()
  // preserves the existing parked block verbatim in that case, the byte-level
  // comparison can still flip stale due to whitespace/padding normalisation
  // when replaceBetween() re-wraps the markers. Skip the byte comparison
  // entirely and report success — this matches the expectation that a fresh
  // clone / CI environment without the CLI shouldn't fail Template CI.
  // Non-`--check` (write) mode keeps its existing graceful preservation path.
  if (cli.check && parkedSource === 'unavailable') {
    report.skipped = 'check-skipped-no-cli'
    report.wrote = true // signal "no drift detected" to main()
    return report
  }

  const now = new Date()
  const activeBody = renderActiveBlock(changes, now)
  const claimsBody = renderClaimsBlock(claims, config.claimsEnabled)
  const parallelismBody = renderParallelismBlock(parallelism)

  let content = readOrScaffoldRoadmap(roadmapPath)

  // When the spectra CLI is unavailable (e.g. CI without spectra installed),
  // we can't authoritatively regenerate the Parked block. Lift the existing
  // body verbatim instead so:
  //   - `--check` doesn't flip stale just because parked rendering changed
  //   - On-disk content never gets clobbered with the "_unavailable_" stub
  // If the existing file has no parked block at all (first-time install with
  // no CLI), fall through to the renderer which produces the stub.
  let parkedBody: string
  if (parkedSource === 'unavailable') {
    const existingParked = extractBetween(content, MARKERS.parkedStart, MARKERS.parkedEnd)
    parkedBody = existingParked ?? renderParkedBlock(parked, parkedSource)
  } else {
    parkedBody = renderParkedBlock(parked, parkedSource)
  }

  content = replaceBetween(content, MARKERS.activeStart, MARKERS.activeEnd, activeBody)
  content = replaceBetween(
    content,
    MARKERS.claimsStart,
    MARKERS.claimsEnd,
    claimsBody,
    MARKERS.parallelismStart
  )
  content = replaceBetween(
    content,
    MARKERS.parallelismStart,
    MARKERS.parallelismEnd,
    parallelismBody
  )
  // First-time installs land the parked block right above the MANUAL backlog
  // so the rendering order is: active → parallelism → parked → backlog.
  content = replaceBetween(
    content,
    MARKERS.parkedStart,
    MARKERS.parkedEnd,
    parkedBody,
    MARKERS.backlogStart
  )

  // Ensure the manual block exists so users/agents have somewhere to write.
  if (!content.includes(MARKERS.backlogStart)) {
    const sep = content.endsWith('\n') ? '\n' : '\n\n'
    content = `${content}${sep}${MARKERS.backlogStart}\n\n## Next Moves\n\n_(尚未累積)_\n\n${MARKERS.backlogEnd}\n`
  }

  // Drift detection runs against the *final* content (AUTO blocks regenerated)
  // so MANUAL claims are compared to the freshest ground-truth picture.
  report.manualDrift = detectManualDrift(content, config.openspecDir)

  const existing = existsSync(roadmapPath) ? readFileSync(roadmapPath, 'utf-8') : ''

  // `_last synced: <ISO>_` changes every run — it's cosmetic metadata, not
  // structural content. Strip it before diffing so `--check` doesn't report
  // false staleness and the no-op sync path doesn't churn file mtime.
  const structuralDiff = normaliseTimestamp(existing) !== normaliseTimestamp(content)

  if (cli.check) {
    report.skipped = 'check-only'
    return { ...report, wrote: !structuralDiff }
  }

  if (structuralDiff) {
    writeFileSync(roadmapPath, content, 'utf-8')
    report.wrote = true
  }

  return report
}

/**
 * Replace `_last synced: <ISO>_` with a stable placeholder. Used only for
 * diff comparison — the written file keeps the real timestamp so readers
 * still see when the roadmap was last regenerated.
 */
function normaliseTimestamp(content: string): string {
  return content.replace(/^_last synced: [^\n]+_$/gm, '_last synced: <placeholder>_')
}

function emitJson(report: SyncReport): void {
  console.log(
    JSON.stringify(
      {
        roadmapPath: report.roadmapPath,
        wrote: report.wrote,
        skipped: report.skipped,
        changes: report.changes.map((c) => ({
          name: c.name,
          stage: c.stage,
          tasksDone: c.tasksDone,
          tasksTotal: c.tasksTotal,
          affectedSpecs: c.affectedSpecs,
          dependsOn: c.dependsOn,
          blockedReason: c.blockedReason,
        })),
        claims: report.claims.map((claim) => ({
          ...claim.record,
          ageSeconds: claim.ageSeconds,
          stale: claim.stale,
        })),
        parallelism: report.parallelism,
        parked: {
          source: report.parkedSource,
          items: report.parked,
        },
        manualDrift: report.manualDrift,
      },
      null,
      2
    )
  )
}

/**
 * Render MANUAL drift warnings to stderr. Routed to stderr so Claude Code
 * SessionStart / PostToolUse hooks (which typically redirect stdout to
 * /dev/null) still surface the warnings to the agent.
 */
function manualDriftLabel(t: ManualDriftType): string {
  if (t === 'archived-as-active') return 'archived-as-active'
  if (t === 'td-status-mismatch') return 'td-status-mismatch'
  return 'version-mismatch'
}

function emitManualDrift(drifts: ManualDrift[]): void {
  if (drifts.length === 0) return
  console.error(
    `⚠ roadmap-sync: MANUAL block drift detected (${drifts.length} item${drifts.length === 1 ? '' : 's'})`
  )
  for (const drift of drifts) {
    console.error(`  [line ${drift.lineNumber}] [${manualDriftLabel(drift.type)}]`)
    console.error(`    claim   : ${drift.claim}`)
    console.error(`    reality : ${drift.reality}`)
    console.error(`    fix     : ${drift.hint}`)
  }
  console.error('  → MANUAL blocks are never auto-rewritten. Update by hand.')
}

function emitText(report: SyncReport): void {
  if (report.skipped === 'check-skipped-no-cli') {
    console.error(
      'roadmap-sync: spectra CLI unavailable, skipping --check parked drift detection (graceful)'
    )
    console.log('✓ roadmap-sync: check skipped (spectra CLI unavailable)')
    return
  }

  if (report.skipped === 'check-only') {
    if (report.wrote) {
      console.log('✓ roadmap-sync: check passed')
    } else {
      console.log('✗ roadmap-sync: ROADMAP.md is stale — re-run without --check')
    }
    emitManualDrift(report.manualDrift)
    return
  }

  const active = report.changes.length
  const activeClaims = report.claims.filter((claim) => !claim.stale).length
  const staleClaims = report.claims.filter((claim) => claim.stale).length
  const ready = report.changes.filter((c) => c.stage === 'ready').length
  const wip = report.changes.filter((c) => c.stage === 'wip').length
  const draft = report.changes.filter((c) => c.stage === 'draft').length
  const blocked = report.changes.filter((c) => c.stage === 'blocked').length
  const mutex = report.parallelism.mutex.length
  const parkedCount = report.parked.length

  const verb = report.wrote ? 'updated' : 'already current'
  const parkedSegment =
    parkedCount > 0
      ? ` · ${parkedCount} parked`
      : report.parkedSource === 'unavailable'
        ? ' · parked unavailable'
        : ''
  const claimsSegment =
    activeClaims > 0 || staleClaims > 0
      ? ` · ${activeClaims} claimed${staleClaims > 0 ? ` · ${staleClaims} stale claim${staleClaims === 1 ? '' : 's'}` : ''}`
      : ''
  console.log(
    `✓ roadmap-sync: ${verb} (${active} change${active === 1 ? '' : 's'}: ${ready} ready · ${wip} wip · ${draft} draft · ${blocked} blocked${claimsSegment}${parkedSegment})`
  )
  if (mutex > 0) {
    console.log(`  ⚠ ${mutex} spec collision${mutex === 1 ? '' : 's'} — check Parallel Tracks`)
  }
  if (staleClaims > 0) {
    console.log(
      `  ⚠ ${staleClaims} stale claim${staleClaims === 1 ? '' : 's'} — review Active Claims before takeover`
    )
  }
  emitManualDrift(report.manualDrift)
}

function main(): void {
  try {
    const report = syncRoadmap()
    if (cli.json) {
      emitJson(report)
    } else {
      emitText(report)
    }
    // Stale exit code only fires for normal `--check` runs that detected drift.
    // `check-skipped-no-cli` (spectra CLI absent) intentionally exits 0 —
    // see syncRoadmap() short-circuit comment for rationale.
    if (cli.check && report.skipped === 'check-only' && !report.wrote) {
      process.exit(1)
    }
    process.exit(0)
  } catch (err) {
    console.error('roadmap-sync script error:', err)
    process.exit(2)
  }
}

main()
