#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/claim-helper.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/claim-helper.ts
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
import { isRecord } from './lib/json-unknown.ts'
import { isLockedProjectionPathFor } from './locked-projection.ts'
import {
  lastWriterByPath,
  liveSessionIds,
  readJournal,
  writerLiveness,
} from './ownership-journal.ts'

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
  /**
   * The flow work item this session is executing (TD-794 刀 4). Optional on the type because
   * the stream is append-only and every claim written before 2026-08-29 lacks it — NEVER make
   * it required, that would make `isClaim` reject the existing files instead of the new ones.
   */
  work_id?: string | null
  last_heartbeat: string
  expires_at: string
}

function isClaim(value: unknown): value is Claim {
  return (
    isRecord(value) &&
    typeof value.session_id === 'string' &&
    typeof value.agent === 'string' &&
    typeof value.started_at === 'string' &&
    typeof value.last_heartbeat === 'string' &&
    typeof value.expires_at === 'string' &&
    Array.isArray(value.expected_paths)
  )
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
  'work-id'?: string
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

/**
 * Absolute toplevel of the tree `cwd` sits in — the linked worktree when inside one, NOT the
 * consumer root. That distinction is the whole join key for claims: `findConsumerRoot()` maps
 * every worktree back to one root, which is right for locating `.clade/`, and wrong for asking
 * "which tree am I".
 */
export function gitToplevel(cwd = process.cwd()): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
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
    // Ambient fallback lives HERE and not in each caller on purpose: this is the single write
    // point for claims, so filling it here is a one-place guarantee. Wiring it per call site is
    // how `expected_paths` ended up 22/22 empty — the flag existed, nobody passed it.
    work_id: partial.work_id ?? (process.env.CLADE_WORK_ID?.trim() || null),
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
      const parsed: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (!isClaim(parsed)) continue
      if (!includeExpired && isExpired(parsed)) continue
      claims.push(parsed)
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
  let journal: ReturnType<typeof readJournal>
  try {
    journal = readJournal(consumerPath)
  } catch {
    journal = []
  }
  for (const claim of readActiveClaims(consumerPath)) {
    if (claim.session_id === mySessionId) continue
    const declared = claim.expected_paths ?? []
    // Declared first so a hand-written glob keeps its `via` label; the derived set is
    // append-only on top of it and never replaces a declaration.
    const seen = new Set(declared)
    const rows: { path: string; via: 'declared' | 'derived' }[] = declared.map((p) => ({
      path: p,
      via: 'declared',
    }))
    for (const p of derivedClaimPaths(claim, journal).paths) {
      if (seen.has(p)) continue
      seen.add(p)
      rows.push({ path: p, via: 'derived' })
    }
    for (const row of rows) {
      result.push({
        session_id: claim.session_id,
        change_id: claim.change_id,
        path: row.path,
        via: row.via,
        branch: claim.branch,
      })
    }
  }
  return result
}

/**
 * 一個 claim 的 worktree **實際被觀察到寫過**的路徑（TD-664 Phase 4）。
 *
 * ## 為什麼不是把 `expected_paths` 填得更勤
 *
 * 本 TD 的整個前提是「宣告型欄位實測不被維護」：17 個 claim 的 `expected_paths` 全 `[]`，
 * 於是 `classifyDirtyPaths` 的 claim 比對**永遠比不中**，`otherSession` 恆為空——
 * `rules/core/worktree-default.commit-ceremony.md` 已經量到這個後果（<consumer-a> 3 個 active claim
 * 的 `expected_paths` 全空，88 條 unclaimed dirty 被 bulk-stash 捲走而 guard 零告警）。
 *
 * 而 `--task-summary` 那條用「改成必填」解決，這條**不能照抄**：開 worktree 的當下根本還不
 * 知道會改哪些檔。所以方向是**導出**不是宣告——journal 已經記了每次 Edit/Write/Bash 的實際
 * 路徑，只要 join 回 claim 就有了。
 *
 * ## join key 是 worktree，NEVER 是 session_id
 *
 * claim 的 `session_id` 是 `genSessionId()` 生的；journal 的 `session_id` 是 harness 給 hook 的。
 * 兩個不同的命名空間，字串比對永遠不會相等——拿它當 join key 會安靜地回空陣列，而空陣列與
 * 「這棵樹什麼都沒寫」長得一模一樣。能對得上的是 `claim.worktree_path` === `entry.worktree`。
 *
 * ## 路徑是相對「那棵樹」的，這是刻意的
 *
 * 回傳的路徑相對該 worktree toplevel，而呼叫端拿去比對的是 main 的 dirty path。這正是宣告版
 * `expected_paths` 本來的語義：worktree session 宣告「我會碰這些路徑，所以 main 的同名檔是
 * contended」。導出版只是把那句宣告換成寫入時證據。
 *
 * ## live 才導出
 *
 * 持有者已死的 claim **NEVER** 導出路徑——那會讓一個 TTL 還沒到期的死 claim 把一批路徑鎖成
 * `otherSession`（永不可掃），也就是本 TD § Problem 那個「等一個永遠不會來的 land」從新的門
 * 走回來。判死沿用 `writerLiveness` 的雙訊號；`unknown` 不導出，那些路徑會落回 journal 分類
 * 並拿到自己的 `unknown` verdict 與證據，兩邊都是不可掃的，但後者說得出理由。
 */
export function derivedClaimPaths(
  claim: Claim,
  journal: ReturnType<typeof readJournal>,
  { sessions }: { sessions?: Set<string> | null } = {},
): { paths: string[]; live: boolean; evidence: Map<string, DerivedPathEvidence> } {
  const empty = { paths: [], live: false, evidence: new Map<string, DerivedPathEvidence>() }
  if (!claim.worktree_path) return empty
  const mine = journal.filter((e) => e.worktree === claim.worktree_path)
  if (mine.length === 0) return empty
  let liveness
  try {
    liveness = writerLiveness(mine[mine.length - 1], { sessions })
  } catch {
    return empty
  }
  if (liveness.verdict !== 'alive') return empty
  // Per-path evidence, carried out alongside the paths (TD-794 刀 4). `attribution` is the
  // journal's own confidence label and every consumer MUST read it — dropping it is what let a
  // 95%-inference signal be used as if it were direct evidence, misleading two sessions in one
  // day (pitfall-coordination-state-broadcast-because-no-consumer-reads-the-claim).
  //
  // A path written by BOTH mechanisms resolves to `hook`: a hook row is the harness naming the
  // file, so it settles the question that the mtime window only guesses at.
  const evidence = new Map<string, DerivedPathEvidence>()
  for (const e of mine) {
    const prior = evidence.get(e.path)
    if (prior && prior.attribution === 'hook' && e.attribution !== 'hook') continue
    if (prior && prior.attribution === e.attribution && prior.ts >= e.ts) continue
    evidence.set(e.path, { attribution: e.attribution, ts: e.ts, pane_id: e.pane_id })
  }
  return { paths: [...evidence.keys()].toSorted(), live: true, evidence }
}

/** Why one derived path is in a claim's effective range, and how much that reason is worth. */
export interface DerivedPathEvidence {
  attribution: 'hook' | 'mtime-diff'
  /** ISO timestamp of the write this evidence comes from. */
  ts: string
  pane_id: string | null
}

/**
 * The one-path read side of the claim registry: "is anyone else's live claim already covering
 * this file?" (TD-794 刀 4). Powers the `pre-edit-claim-conflict` PreToolUse hook.
 *
 * ## Why `mtime-diff` evidence is admitted but NEVER raises a conflict
 *
 * `.clade/ownership/journal.jsonl` labels every row with how the path was attributed, and the
 * two labels are not two grades of the same thing — measured on clade's own journal
 * (1748 rows / 3.6 days / 85 sessions, 2026-08-29):
 *
 * | metric | value |
 * | --- | --- |
 * | rows attributed by `mtime-diff` | 1670 / 1748 = 95.5% |
 * | of the `mtime-diff` rows a same-path `hook` row can adjudicate, share attributed to the WRONG session | 14/16 = 87.5% (±60s window); 26/28 = 92.9% (±300s) |
 * | `mtime-diff` rows where ≥2 distinct sessions claim the same path inside ±60s | 1075 / 1670 = 64.4% |
 * | `mtime-diff` rows arriving in bursts of >5 paths from one Bash call | 851 / 1670 = 51% |
 *
 * A PreToolUse warning built on that would be wrong roughly two times in three, and a warning
 * that is usually wrong does not merely fail to help — it trains everyone to skip reading it,
 * which throws away the 4.6% of rows that are direct evidence too. So the admission rule is:
 * **`declared` and `derived-hook` raise a conflict; `mtime-diff`-only coverage stays silent.**
 *
 * NEVER "fix" the recall by admitting `mtime-diff` here. The recall problem is upstream — Bash
 * writes are attributed by a time window because nothing tells the hook which file was written.
 * Narrow that window (or make Bash writes nameable) and this function admits them for free.
 * Widening the consumer instead converts a known-bad signal into a trusted one.
 */
export interface ClaimConflict {
  path: string
  via: 'declared' | 'derived-hook'
  session_id: string
  work_id: string | null
  task_summary: string | null
  change_id: string | null
  branch: string | null
  worktree_path: string | null
  pane_id: string | null
  /** ISO — declared: when the claim opened; derived: the write that put the path in range. */
  since: string
}

export function claimConflictsForPath(
  consumerRoot: string,
  relPath: string,
  {
    myWorktree = null,
    mySessionId = null,
    sessions,
    journal,
    claims,
  }: {
    myWorktree?: string | null
    mySessionId?: string | null
    sessions?: Set<string> | null
    journal?: ReturnType<typeof readJournal>
    claims?: Claim[]
  } = {},
): ClaimConflict[] {
  let entries = journal
  if (entries === undefined) {
    try {
      entries = readJournal(consumerRoot)
    } catch {
      entries = []
    }
  }
  let active = claims
  if (active === undefined) {
    try {
      active = readActiveClaims(consumerRoot)
    } catch {
      active = []
    }
  }
  let live = sessions
  if (live === undefined) {
    try {
      live = liveSessionIds()
    } catch {
      live = null
    }
  }
  const out: ClaimConflict[] = []
  for (const claim of active) {
    // Self-exclusion is by worktree FIRST, because that is the only key that actually joins:
    // a claim's `session_id` comes from `genSessionId()` and the harness's comes from the hook
    // payload — two namespaces that never compare equal (session-claims.md § 3.3).
    if (myWorktree && claim.worktree_path === myWorktree) continue
    if (mySessionId && claim.session_id === mySessionId) continue
    const declared = (claim.expected_paths ?? []).some((pat) => matchClaimGlob(relPath, pat))
    if (declared) {
      const last = entries.findLast((e) => e.worktree === claim.worktree_path)
      out.push({
        path: relPath,
        via: 'declared',
        session_id: claim.session_id,
        work_id: claim.work_id ?? null,
        task_summary: claim.task_summary ?? null,
        change_id: claim.change_id ?? null,
        branch: claim.branch ?? null,
        worktree_path: claim.worktree_path,
        pane_id: last?.pane_id ?? null,
        since: claim.started_at,
      })
      continue
    }
    const derived = derivedClaimPaths(claim, entries, { sessions: live })
    const ev = derived.evidence.get(relPath)
    if (!ev || ev.attribution !== 'hook') continue
    out.push({
      path: relPath,
      via: 'derived-hook',
      session_id: claim.session_id,
      work_id: claim.work_id ?? null,
      task_summary: claim.task_summary ?? null,
      change_id: claim.change_id ?? null,
      branch: claim.branch ?? null,
      worktree_path: claim.worktree_path,
      pane_id: ev.pane_id,
      since: ev.ts,
    })
  }
  return out
}

/**
 * One line per conflict — the whole message budget. NEVER expand this into the broadcast it
 * replaces: handing the conflicting agent a paragraph of provenance is the same pollution the
 * broadcast was, just addressed to one reader instead of N.
 *
 * `[via=...]` is not decoration. Without it `declared` (someone said they would touch this) and
 * `derived-hook` (someone demonstrably did) read identically, and they call for different
 * answers — a declaration can be stale, a write cannot.
 */
export function formatClaimConflict(c: ClaimConflict, now = Date.now()): string {
  const hours = Math.max(0, Math.round((now - new Date(c.since).getTime()) / 3600_000))
  const age = hours < 1 ? '不到 1h' : `${hours}h`
  const who = c.pane_id ? `pane ${c.pane_id}` : `session ${c.session_id}（無 pane）`
  const work = c.work_id ? `work ${c.work_id}` : 'work 未歸屬'
  const what = c.task_summary ?? c.change_id ?? '(claim 沒寫 task_summary)'
  const verb = c.via === 'declared' ? '宣告為工作範圍' : '實際寫入過'
  const probe = c.pane_id
    ? `先 herdr agent prompt ${c.pane_id} 協商`
    : `先 node vendor/scripts/flow/flow.ts who 找持有者`
  return `⚠ ${c.path} 在 ${age} 前被 ${who}（${work}：${what}）${verb} [via=${c.via}]——${probe}，或確認該 claim 已停用（node vendor/scripts/claim-helper.ts drop ${c.session_id}）`
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
 *
 * ## TD-664: `other` is additionally split three ways, without changing `other`
 *
 * `other` collapsed two opposite situations into one word — "someone is actively
 * writing this right now" and "whoever wrote this is long dead" — and callers could
 * only pick one behaviour for both. 2026-08-26 that cost three sessions ~2h of mutual
 * waiting: publish's gate waited (up to 90 minutes, by its own wording) on a holder
 * that had already committed and exited.
 *
 * So `otherLive` / `orphan` / `unknown` are now returned **alongside** `other`, which
 * still holds every one of those entries. Existing callers upgrade with zero edits and
 * keep today's conservative behaviour; a caller that wants to stop blind-waiting reads
 * the new fields. The evidence comes from the write-time journal (see ownership-journal.ts),
 * not from any declared field — declared fields are what this whole TD exists to route around.
 *
 * **`unknown` inherits every prohibition `other` carries today — NEVER sweep it.**
 * It is where Bash-written files, Codex-written files (no PostToolUse hook exists there),
 * hand edits, and everything predating the journal land. The one failure mode that actually
 * destroys work is `unknown` being read as `orphan`; nothing in this function may narrow
 * that gap by guessing.
 */
export function classifyDirtyPaths(
  consumerRoot,
  paths,
  {
    excludeClaim = null,
    liveSessions,
  }: { excludeClaim?: Claim | null; liveSessions?: Set<string> | null } = {},
) {
  const locked = []
  const otherSession = []
  const other = []
  const otherLive = []
  const orphan = []
  const unknown = []
  let journalEntries: ReturnType<typeof readJournal>
  try {
    journalEntries = readJournal(consumerRoot)
  } catch {
    journalEntries = []
  }
  let journalByPath
  try {
    journalByPath = lastWriterByPath(journalEntries, { tree: consumerRoot })
  } catch {
    journalByPath = new Map()
  }
  let activeClaims
  try {
    activeClaims = readActiveClaims(consumerRoot).filter(
      (c) => !excludeClaim || c.session_id !== excludeClaim.session_id,
    )
  } catch {
    activeClaims = []
  }
  // One Herdr probe for the whole call: this runs over every dirty path in a publish gate,
  // and the probe is a subprocess. `null` means the signal is unavailable, NEVER "nobody is alive".
  // `liveSessions` is a test seam: production callers omit it and get the probe. It is an
  // argument rather than an env var on purpose — an env seam could be used to *withhold* a
  // session and manufacture an `orphan`, which is the one direction that authorises touching
  // someone else's work.
  let sessions = liveSessions
  if (sessions === undefined) {
    try {
      sessions = liveSessionIds()
    } catch {
      sessions = null
    }
  }
  // TD-664 Phase 4: 每個**還活著**的 worktree claim 實際寫過的路徑。這是 `expected_paths`
  // 恆為 `[]` 的替代輸入，位置刻意排在 journal 查詢**之後**（見迴圈內）——寫入時證據永遠贏。
  const derivedByPath = new Map<string, Claim>()
  for (const claim of activeClaims) {
    for (const p of derivedClaimPaths(claim, journalEntries, { sessions }).paths) {
      if (!derivedByPath.has(p)) derivedByPath.set(p, claim)
    }
  }
  for (const p of paths) {
    if (isLockedProjectionPathFor(consumerRoot, p)) {
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
        via: 'declared',
      })
      continue
    }
    // No claim covers it. Ask the journal who actually wrote it, and whether that
    // writer's process is still alive. `isWriterAlive` returns null — not false — when
    // the evidence cannot be evaluated, and null MUST land in `unknown`: 判死 MUST
    // 兩個獨立訊號同時缺席（journal 沒有這個檔 ∧ 寫入者 process 不在），缺一個只能判 unknown。
    const writer = journalByPath.get(p)
    if (!writer) {
      // main 這一份沒有寫入時證據。此時、也只有此時，才問「有沒有哪個活著的 worktree 正在
      // 寫同名路徑」——那是 `expected_paths` 本來要回答的問題，只是改用觀察值而非宣告值。
      // 這一步 **NEVER** 排在 journal 查詢之前：main 的 dirty 檔如果有自己的寫入者，那個人
      // 就是答案，讓別棵樹的同名路徑蓋過去會把「我自己剛寫的檔」判成別人的。
      const viaClaim = derivedByPath.get(p)
      if (viaClaim) {
        otherSession.push({
          path: p,
          session_id: viaClaim.session_id,
          change_id: viaClaim.change_id,
          branch: viaClaim.branch,
          via: 'derived',
          worktree_path: viaClaim.worktree_path,
        })
        continue
      }
      const entry = { path: p, verdict: 'unknown', why: 'no journal entry for this path' }
      unknown.push(entry)
      other.push(entry)
      continue
    }
    // 判死 MUST 兩個獨立訊號同時缺席（process 不在 ∧ herdr 不再列出該 session）。
    // 缺一個一律 unknown —— hook 是 fail-open 的，單訊號會把「hook 壞了」讀成「全員陣亡」。
    let liveness
    try {
      liveness = writerLiveness(writer, { sessions })
    } catch {
      liveness = {
        verdict: 'unknown',
        signals: { process: null, session: null },
        why: 'liveness probe threw',
      }
    }
    const provenance = {
      session_id: writer.session_id,
      pane_id: writer.pane_id,
      cwd: writer.cwd,
      tool: writer.tool,
      written_at: writer.ts,
    }
    if (liveness.verdict === 'alive') {
      const entry = { path: p, verdict: 'other-live', signals: liveness.signals, ...provenance }
      otherLive.push(entry)
      other.push(entry)
    } else if (liveness.verdict === 'dead') {
      const entry = { path: p, verdict: 'orphan', signals: liveness.signals, ...provenance }
      orphan.push(entry)
      other.push(entry)
    } else {
      const entry = {
        path: p,
        verdict: 'unknown',
        why: liveness.why,
        signals: liveness.signals,
        ...provenance,
      }
      unknown.push(entry)
      other.push(entry)
    }
  }
  return { locked, otherSession, other, otherLive, orphan, unknown }
}

/**
 * `consumerRoot` 帶了就一併算出每個 claim 的**觀察到的**路徑數（TD-664 Phase 4）。
 * 不帶就只印宣告值——那在實測上恆為 0，讀者會以為那棵樹什麼都沒做。
 */
export function formatClaimsSummary(claims, { consumerRoot }: { consumerRoot?: string } = {}) {
  if (claims.length === 0) return '  (none)'
  let journal: ReturnType<typeof readJournal> = []
  if (consumerRoot) {
    try {
      journal = readJournal(consumerRoot)
    } catch {
      journal = []
    }
  }
  return claims
    .map((c) => {
      const age = Math.round((Date.now() - new Date(c.started_at).getTime()) / 60000)
      const paths = (c.expected_paths ?? []).slice(0, 3).join(', ')
      const more = (c.expected_paths?.length ?? 0) > 3 ? ` +${c.expected_paths.length - 3}` : ''
      const task = c.task_summary ? ` — ${c.task_summary}` : ''
      const observed = consumerRoot ? derivedClaimPaths(c, journal).paths.length : 0
      const obs = observed > 0 ? ` (+${observed} observed)` : ''
      return `  - ${c.session_id} [${c.agent}] ${c.change_id ?? '(no change_id)'} — ${age}min — paths: ${paths || '(none declared)'}${more}${obs}${task}`
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
        work_id: flags['work-id'] ?? null,
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
      console.log(formatClaimsSummary(claims, { consumerRoot: consumerPath }))
    } else if (cmd === 'conflicts') {
      // Read side for the PreToolUse hook. `--json` so the hook never parses prose;
      // exit 3 (not 1) on a hit so "someone else holds this" is distinguishable from
      // "the query itself failed" — a hook that cannot tell those apart fails the wrong way.
      const flags = parseFlags(rest.filter((a) => a.startsWith('--')))
      const target = rest.find((a) => !a.startsWith('--'))
      if (!target) {
        console.error(
          'usage: claim-helper conflicts <repo-relative-path> [--worktree <abs>] [--json]',
        )
        process.exit(1)
      }
      const rows = claimConflictsForPath(consumerPath, target, {
        myWorktree:
          typeof flags.worktree === 'string' ? flags.worktree : gitToplevel(process.cwd()),
      })
      if (flags.json === true) {
        console.log(JSON.stringify(rows))
      } else {
        for (const row of rows) console.log(formatClaimConflict(row))
      }
      process.exit(rows.length > 0 ? 3 : 0)
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
      console.error(
        'usage: claim-helper [list|add|refresh|refresh-by-cwd|drop|prune|conflicts] ...',
      )
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
