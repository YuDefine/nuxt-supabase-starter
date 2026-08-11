#!/usr/bin/env node
/**
 * claim-helper.ts — session-id claim 機制
 *
 * 多 session AI 並行開發時，clade publish / propagate / wt-helper merge-back /
 * `/commit` 需要知道「哪些路徑屬於別 session 還活著的工作」，避免誤殺別 session WIP
 * 或在 main 端做出錯誤分組。
 *
 * Claim 寫在 consumer-local `.clade/claims/<session-id>.json`，per-machine state，
 * gitignored。Heartbeat 由 SessionStart hook 跑時 refresh。TTL 24h，超時視為失效。
 *
 * 詳細契約見 rules/core/session-claims.md。
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isLockedProjectionPath } from './locked-projection.ts'

const TTL_HOURS = 24
const CLAIMS_DIR = '.clade/claims'

interface Claim {
  session_id: string
  agent: string
  started_at: string
  consumer?: string
  worktree_path: string | null
  branch: string | null
  change_id: string | null
  expected_paths: string[]
  task_summary: string | null
  last_heartbeat: string
  expires_at: string
}

type ClaimInput = Partial<Claim>

interface ParsedFlags {
  agent?: string
  consumer?: string
  'worktree-path'?: string
  branch?: string
  'change-id'?: string
  'expected-paths'?: string
  'task-summary'?: string
  all?: true
  [key: string]: string | true | undefined
}

function nowIso() {
  return new Date().toISOString()
}

function expiresFromNow(hours = TTL_HOURS) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString()
}

function claimsDir(consumerPath) {
  return join(consumerPath, CLAIMS_DIR)
}

/**
 * Resolve the canonical main-worktree path of the consumer, given any cwd
 * inside the consumer's git tree (including session worktrees). Returns null
 * if not inside a git repo.
 */
export function findConsumerRoot(cwd = process.cwd()) {
  try {
    const commonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim()
    // commonDir → "<consumerRoot>/.git" (main worktree) or absolute path
    // ending in ".git". Parent of .git is the main consumer root.
    return dirname(commonDir)
  } catch {
    return null
  }
}

function ensureClaimsDir(consumerPath) {
  const dir = claimsDir(consumerPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const gi = join(dir, '.gitignore')
  if (!existsSync(gi)) {
    writeFileSync(gi, '*\n!.gitignore\n', 'utf8')
  }
}

export function genSessionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${hostname().slice(0, 8)}`
}

export function isExpired(claim: Partial<Claim> | null | undefined, atIso = nowIso()) {
  if (!claim?.expires_at) return true
  return new Date(claim.expires_at).getTime() < new Date(atIso).getTime()
}

export function writeClaim(consumerPath, partial: ClaimInput) {
  ensureClaimsDir(consumerPath)
  const now = nowIso()
  const claim = {
    session_id: partial.session_id ?? genSessionId(),
    agent: partial.agent ?? 'claude-code',
    started_at: partial.started_at ?? now,
    consumer: partial.consumer,
    worktree_path: partial.worktree_path ?? null,
    branch: partial.branch ?? null,
    change_id: partial.change_id ?? null,
    expected_paths: partial.expected_paths ?? [],
    task_summary: partial.task_summary ?? null,
    last_heartbeat: now,
    expires_at: expiresFromNow(),
  }
  const file = join(claimsDir(consumerPath), `${claim.session_id}.json`)
  writeFileSync(file, `${JSON.stringify(claim, null, 2)}\n`, 'utf8')
  return claim
}

export function refreshClaim(consumerPath, sessionId) {
  const file = join(claimsDir(consumerPath), `${sessionId}.json`)
  if (!existsSync(file)) return null
  try {
    const claim = JSON.parse(readFileSync(file, 'utf8'))
    claim.last_heartbeat = nowIso()
    claim.expires_at = expiresFromNow()
    writeFileSync(file, `${JSON.stringify(claim, null, 2)}\n`, 'utf8')
    return claim
  } catch {
    return null
  }
}

export function dropClaim(consumerPath, sessionId) {
  const file = join(claimsDir(consumerPath), `${sessionId}.json`)
  if (existsSync(file)) {
    rmSync(file, { force: true })
    return true
  }
  return false
}

export function readActiveClaims(
  consumerPath,
  { includeExpired = false }: { includeExpired?: boolean } = {},
): Claim[] {
  const dir = claimsDir(consumerPath)
  if (!existsSync(dir)) return []
  const claims = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue
    try {
      const claim = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Claim
      if (!includeExpired && isExpired(claim)) continue
      claims.push(claim)
    } catch {
      // skip malformed claim files
    }
  }
  return claims
}

export function pruneExpired(consumerPath) {
  const dir = claimsDir(consumerPath)
  if (!existsSync(dir)) return 0
  let dropped = 0
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue
    try {
      const claim = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (isExpired(claim)) {
        rmSync(join(dir, name), { force: true })
        dropped++
      }
    } catch {
      rmSync(join(dir, name), { force: true })
      dropped++
    }
  }
  return dropped
}

export function findClaimByWorktree(consumerPath, worktreePath) {
  for (const claim of readActiveClaims(consumerPath)) {
    if (claim.worktree_path === worktreePath) return claim
  }
  return null
}

export function pathsClaimedByOthers(consumerPath, mySessionId) {
  const result = []
  for (const claim of readActiveClaims(consumerPath)) {
    if (claim.session_id === mySessionId) continue
    for (const p of claim.expected_paths ?? []) {
      result.push({
        session_id: claim.session_id,
        change_id: claim.change_id,
        path: p,
        branch: claim.branch,
      })
    }
  }
  return result
}

/**
 * Simple glob matcher for claim expected_paths. Supports:
 *   - exact path match
 *   - "<prefix>/**" → recursive prefix match (any depth)
 *   - "<prefix>/*"  → single-level match (one segment after prefix)
 */
export function matchClaimGlob(path, pattern) {
  if (pattern === path) return true
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3)
    return path === prefix || path.startsWith(`${prefix}/`)
  }
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2)
    if (!path.startsWith(`${prefix}/`)) return false
    return !path.slice(prefix.length + 1).includes('/')
  }
  return false
}

/**
 * Classify dirty paths by owner: (1) LOCKED projection layer, (2) another
 * session's active claim, (3) everything else — user code or orphan, caller
 * decides downstream.
 *
 * This is the single ownership predicate for every tool that is about to move
 * someone's working tree (TD-435). It used to live privately inside wt-helper,
 * so each new write path — publish's auto-stash, merge-back's bulk stash,
 * pre-fork baseline, propagate's projection write — re-learned the same lesson
 * separately, one high-severity pitfall at a time. Keeping one implementation
 * is the point: a caller that skips it does not get a weaker check, it gets none.
 *
 * Known limit, deliberate: only worktree sessions write claims. Main-tree WIP
 * has no claim and therefore lands in `other`, so `other` means "unknown owner",
 * NEVER "safe to sweep" — auto-claiming main was rejected by design (it would
 * make every overlapping fork STOP; see rules/core/session-claims.md).
 *
 * `excludeClaim` is the caller's own session; its paths are not "other session".
 */
export function classifyDirtyPaths(consumerRoot, paths, { excludeClaim = null } = {}) {
  const locked = []
  const otherSession = []
  const other = []
  let activeClaims
  try {
    activeClaims = readActiveClaims(consumerRoot).filter(
      (c) => !excludeClaim || c.session_id !== excludeClaim.session_id,
    )
  } catch {
    activeClaims = []
  }
  for (const p of paths) {
    if (isLockedProjectionPath(p)) {
      locked.push({ path: p })
      continue
    }
    const matchedClaim = activeClaims.find((c) =>
      (c.expected_paths ?? []).some((pat) => matchClaimGlob(p, pat)),
    )
    if (matchedClaim) {
      otherSession.push({
        path: p,
        session_id: matchedClaim.session_id,
        change_id: matchedClaim.change_id,
        branch: matchedClaim.branch,
      })
      continue
    }
    other.push({ path: p })
  }
  return { locked, otherSession, other }
}

export function formatClaimsSummary(claims) {
  if (claims.length === 0) return '  (none)'
  return claims
    .map((c) => {
      const age = Math.round((Date.now() - new Date(c.started_at).getTime()) / 60000)
      const paths = (c.expected_paths ?? []).slice(0, 3).join(', ')
      const more = (c.expected_paths?.length ?? 0) > 3 ? ` +${c.expected_paths.length - 3}` : ''
      const task = c.task_summary ? ` — ${c.task_summary}` : ''
      return `  - ${c.session_id} [${c.agent}] ${c.change_id ?? '(no change_id)'} — ${age}min — paths: ${paths}${more}${task}`
    })
    .join('\n')
}

// ──────────────────────────────────────────────────────────────────────────
// CLI

// CLI 進入判定：兩邊都 realpath。node 預設把 import.meta.url realpath 化、
// process.argv[1] 則原樣保留，經 symlink 叫進去兩者不相等 → 整個 CLI 區塊被靜默
// 跳過且 exit 0，長相與「一切正常」無法區分（TD-460）。
function invokedAsCli() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return entry === fileURLToPath(import.meta.url)
  }
}

if (invokedAsCli()) {
  const [cmd, ...rest] = process.argv.slice(2)
  const consumerPath = findConsumerRoot() ?? process.cwd()

  try {
    if (cmd === 'add') {
      const flags = parseFlags(rest)
      const claim = writeClaim(consumerPath, {
        agent: flags.agent ?? 'claude-code',
        consumer: flags.consumer ?? dirname(consumerPath).split('/').pop(),
        worktree_path: flags['worktree-path'] ?? null,
        branch: flags.branch ?? null,
        change_id: flags['change-id'] ?? null,
        expected_paths: flags['expected-paths']?.split(',').filter(Boolean) ?? [],
        task_summary: flags['task-summary'] ?? null,
      })
      console.log(`claim written: ${claim.session_id}`)
      console.log(JSON.stringify(claim, null, 2))
    } else if (cmd === 'refresh') {
      const [sessionId] = rest
      if (!sessionId) {
        console.error('usage: claim-helper refresh <session-id>')
        process.exit(1)
      }
      const claim = refreshClaim(consumerPath, sessionId)
      if (!claim) {
        console.error(`claim not found: ${sessionId}`)
        process.exit(1)
      }
      console.log(`refreshed: ${claim.session_id} (expires ${claim.expires_at})`)
    } else if (cmd === 'drop') {
      const [sessionId] = rest
      if (!sessionId) {
        console.error('usage: claim-helper drop <session-id>')
        process.exit(1)
      }
      const ok = dropClaim(consumerPath, sessionId)
      console.log(ok ? `dropped: ${sessionId}` : `not found: ${sessionId}`)
    } else if (cmd === 'list' || cmd === undefined) {
      const flags = parseFlags(rest)
      const claims = readActiveClaims(consumerPath, { includeExpired: flags.all === true })
      console.log(`active claims in ${consumerPath}: ${claims.length}`)
      console.log(formatClaimsSummary(claims))
    } else if (cmd === 'prune') {
      const n = pruneExpired(consumerPath)
      console.log(`pruned ${n} expired claim(s)`)
    } else if (cmd === 'refresh-by-cwd') {
      // Used by SessionStart hook: walks up to find consumer root, then
      // matches claim by worktree_path === current cwd (the actual session
      // worktree path, not the resolved consumer root).
      const claim = findClaimByWorktree(consumerPath, process.cwd())
      if (!claim) {
        console.log(`no claim for cwd ${process.cwd()}`)
        process.exit(0)
      }
      const refreshed = refreshClaim(consumerPath, claim.session_id)
      console.log(`refreshed: ${refreshed.session_id} (expires ${refreshed.expires_at})`)
    } else {
      console.error('usage: claim-helper [list|add|refresh|refresh-by-cwd|drop|prune] ...')
      process.exit(1)
    }
  } catch (e) {
    console.error(`error: ${e.message ?? e}`)
    process.exit(1)
  }
}

function parseFlags(argv): ParsedFlags {
  const flags: ParsedFlags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    }
  }
  return flags
}
