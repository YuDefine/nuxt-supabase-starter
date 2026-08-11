#!/usr/bin/env node

/**
 * wt-helper.ts — session worktree management
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
 *   orphan-prune [--force]
 *                    Scan <consumer>-wt/ for directories not registered as
 *                    git worktrees (no .git file). These are leftovers from
 *                    incomplete cleanup (typically gitignored screenshots).
 *                    Without --force: list orphans. With --force: remove them.
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

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { stdin, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import {
  classifyDirtyPaths,
  dropClaim,
  findClaimByWorktree,
  genSessionId,
  readActiveClaims,
  writeClaim,
} from './claim-helper.ts'
import { ensureNoStaleIndexLock } from './_git-lock-detect.ts'
import { isLockedProjectionPath, isLockedProjectionPathFor } from './locked-projection.ts'
import { runWtEnvBootstrap } from './lib/wt-env-bootstrap-runner.ts'

interface WtOptions {
  json?: boolean
  force?: boolean
  forceDiscardUnland?: boolean
  forceDiscardUncommitted?: boolean
  dryRun?: boolean
  autoStash?: boolean
  includeWorktreeWip?: boolean
  cleanup?: boolean
  noopIfMissing?: boolean
  skipPreSync?: boolean
  skipPreforkAudit?: boolean
  includeUnrelatedDirty?: boolean
  allowOrphanRecord?: boolean
  precheckBaseline?: string
  baselineStrategy?: string
  baselineScopePaths?: string
  baselineStashName?: string
  show?: string
  taskSummary?: string
  expectedPaths?: string
  agent?: string
  minimalStashPaths?: string[]
}

function git(args, opts = {}) {
  const out = execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  })
  return out ? out.trim() : ''
}

// per-worktree backing service 的 spawner 已抽到 `lib/wt-env-bootstrap-runner.ts` —— 因為
// `dev-session.ts` 的 preflight（per `db-preview-env.md` § 缺席側）也要呼叫它，而不可能為此
// import 整個 wt-helper。本檔仍 re-export，既有 import 端不受影響。
export { runWtEnvBootstrap }

// TD-323: stash-reconcile.ts 與 wt-helper.ts 永遠是同目錄 sibling —— clade home 在
// `vendor/scripts/`、consumer 在 `scripts/`。寫死任一側只是把 MODULE_NOT_FOUND 搬家，
// 所以復原指令的路徑一律由本檔自身位置推出。
const WT_HELPER_DIR = dirname(fileURLToPath(import.meta.url))

// 本檔在自己那棵樹裡的相對位置（clade `vendor/scripts` / consumer `scripts`）。
// **MUST 在 module load 當下算**，不能等到要印訊息時才算：merge-back 的收尾訊息印在
// `cmdCleanup` 之後，而本檔若是 worktree 的副本在跑，那時自己的目錄已經被刪了，
// `git -C <已刪目錄>` 會失敗 → 落回絕對路徑 → 又指向已刪除的目錄。
const WT_HELPER_SUBDIR = (() => {
  try {
    const ownTop = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: WT_HELPER_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const sub = relative(ownTop, WT_HELPER_DIR)
    return sub && !sub.startsWith('..') ? sub : ''
  } catch {
    return ''
  }
})()

/**
 * 回傳供 coordinator 直接執行的 `node <path>/stash-reconcile.ts`（相對 repo root）。
 *
 * 錨點是「**main root 底下的**對應副本」，不是執行中的那一份。`/wt` 執行期間，本檔常常是
 * worktree 的副本在跑；直接拿 `WT_HELPER_DIR` 相對 main root 會得到 `..` 開頭而 fallback 成
 * 絕對路徑，而這行訊息印在 cmdCleanup 刪掉該 worktree **之後**——coordinator 會拿到一條指向
 * 已刪除目錄的路徑。那是 TD-323 的 MODULE_NOT_FOUND 換個形式。
 */
function stashReconcileCmd(baseRoot = undefined) {
  const abs = join(WT_HELPER_DIR, 'stash-reconcile.ts')
  // `baseRoot` MUST 由呼叫端傳它早先解好的 consumerRoot。同一個 cleanup 時序問題的
  // 另一半：訊息印出時 process.cwd() 可能停在已被刪除的 worktree（Node 回快取字串、
  // 不 throw），`findConsumerRoot()` 於是一路往上走到 `/` 才拋 —— 又落回絕對路徑。
  let root = baseRoot
  if (!root) {
    try {
      root = findConsumerRoot()
    } catch {
      return `node ${abs}`
    }
  }
  // WT_HELPER_SUBDIR 套到 main root 上就是使用者該跑的那一份。
  if (WT_HELPER_SUBDIR) {
    const candidate = join(root, WT_HELPER_SUBDIR, 'stash-reconcile.ts')
    if (existsSync(candidate)) return `node ${relative(root, candidate)}`
  }
  const rel = relative(root, abs)
  return rel && !rel.startsWith('..') ? `node ${rel}` : `node ${abs}`
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
    const entry: Record<string, string> = {}
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
    (w) => w.branch && w.branch.startsWith('refs/heads/session/'),
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

// ── Worktree dev-port allocation (TD-434) ─────────────────────────────────
//
// A consumer's dev port is a single registry value (rules/core/dev-port-allocation.md
// § 3), but worktrees are mandatory for any tracked-file work — so N worktrees of
// the same consumer race for one port. The loser either gets EADDRINUSE or is
// silently moved by Nuxt's auto-increment, which decouples it from the tunnel's
// hard-coded `port:`.
//
// Allocation lives here rather than in each consumer's package.json because the
// registry spaces bases +10 apart, leaving base+1..base+9 free per consumer. An
// offset applied uniformly to every declared port keeps the whole set inside the
// consumer's own band, so no consumer's dev script or nuxt.config needs to change.

// Registry allocates bases +10 apart, so base+1..base+9 belongs to this consumer.
const DEV_PORT_BAND = 9

/**
 * Allocation records live outside the repo. Writing them into `.clade/` would
 * leave an untracked file in every worktree of the ~7 consumers whose
 * `.gitignore` does not cover the path, and that shows up as dirty state in
 * exactly the flows (merge-back, publish) that treat dirty state as a hazard.
 */
function devPortStateDir(consumerRoot) {
  return join(
    process.env.XDG_CACHE_HOME || join(process.env.HOME || '', '.cache'),
    'clade',
    'dev-port',
    basename(consumerRoot),
  )
}

/**
 * Ports this consumer declares, sorted ascending — the first entry is the base
 * the band is measured from.
 *
 * `.claude/consumer-meta.json` `dev.ports[]` is the list (it carries aliases and
 * any secondary targets), but the registry is the SoT for the base. Both are
 * available consumer-side; when they disagree the meta file is stale and
 * allocating from it would hand out ports inside a band this consumer no longer
 * owns, so this throws rather than guessing.
 */
function readDeclaredDevPorts(root) {
  let ports = []
  try {
    const meta = JSON.parse(readFileSync(join(root, '.claude', 'consumer-meta.json'), 'utf8'))
    ports = (meta?.dev?.ports ?? [])
      .map((p) => ({ port: Number(p.port), alias: p.alias ?? 'main' }))
      .filter((p) => Number.isInteger(p.port) && p.port > 0)
      .toSorted((a, b) => a.port - b.port)
  } catch {
    return []
  }
  if (ports.length === 0) return []

  let registryBase = null
  try {
    const reg = JSON.parse(readFileSync(join(root, '.clade', 'registry', 'consumers.json'), 'utf8'))
    const list = Array.isArray(reg) ? reg : (reg.consumers ?? [])
    const entry = list.find((c) => c.consumer_id === basename(root))
    registryBase = entry?.dev_ports?.nuxt ?? null
  } catch {
    // No projected registry — consumer-meta stands alone.
  }
  if (registryBase !== null && registryBase !== ports[0].port) {
    throw new Error(
      `dev-port: consumer-meta base ${ports[0].port} != registry dev_ports.nuxt ${registryBase}.\n` +
        `Align .claude/consumer-meta.json with the registry before opening worktrees ` +
        `(rules/core/dev-port-allocation.md § 3).`,
    )
  }
  return ports
}

/**
 * Offsets held by this consumer's other worktrees. Records whose worktree is
 * gone are deleted here — that is what releases a slot, so no explicit
 * deallocation step has to be remembered on cleanup paths.
 */
function siblingDevPortOffsets(consumerRoot, selfWtPath) {
  const dir = devPortStateDir(consumerRoot)
  const used = new Set()
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return used
  }
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const p = join(dir, name)
    let rec
    try {
      rec = JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      continue
    }
    if (!rec?.wtPath || !existsSync(rec.wtPath)) {
      try {
        unlinkSync(p)
      } catch {
        // Someone else pruned it first; the slot is free either way.
      }
      continue
    }
    if (resolve(rec.wtPath) === resolve(selfWtPath)) continue
    if (Number.isInteger(rec.offset)) used.add(rec.offset)
  }
  return used
}

/** Allocation record for the worktree at `wtPath`, or null if it has none. */
function readWorktreeDevPorts(consumerRoot, wtPath) {
  const p = join(devPortStateDir(consumerRoot), `${basename(wtPath)}.json`)
  try {
    const rec = JSON.parse(readFileSync(p, 'utf8'))
    return resolve(rec.wtPath ?? '') === resolve(wtPath) ? rec : null
  } catch {
    return null
  }
}

/**
 * Smallest offset N in 1..DEV_PORT_BAND for which every declared port P maps to
 * P+N satisfying all three:
 *   - inside [base, base+DEV_PORT_BAND] — never reaches the next consumer's base
 *   - not equal to another declared port — <consumer-a> declares 3040 + 3045, so N=5
 *     would map `<client-a>` straight onto `shared`
 *   - not already held by a sibling worktree
 * Returns null when the band is exhausted (consumer has too many live worktrees).
 */
export function pickDevPortOffset(declared, usedOffsets) {
  if (declared.length === 0) return null
  const base = declared[0].port
  const declaredSet = new Set(declared.map((d) => d.port))
  for (let n = 1; n <= DEV_PORT_BAND; n++) {
    if (usedOffsets.has(n)) continue
    const mapped = declared.map((d) => d.port + n)
    if (mapped.some((p) => p > base + DEV_PORT_BAND)) continue
    if (mapped.some((p) => declaredSet.has(p))) continue
    return n
  }
  return null
}

/**
 * Allocate this worktree's dev-port offset and persist it. Returns the record,
 * or null when the consumer declares no dev ports / the band is exhausted.
 */
function allocateWorktreeDevPorts(consumerRoot, wtPath) {
  const declared = readDeclaredDevPorts(consumerRoot)
  if (declared.length === 0) return null
  const offset = pickDevPortOffset(declared, siblingDevPortOffsets(consumerRoot, wtPath))
  if (offset === null) return null
  const record = {
    offset,
    base: declared[0].port,
    wtPath: resolve(wtPath),
    ports: declared.map((d) => ({ alias: d.alias, port: d.port + offset, mainPort: d.port })),
  }
  const dir = devPortStateDir(consumerRoot)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${basename(wtPath)}.json`), `${JSON.stringify(record, null, 2)}\n`)
  return record
}

// Tunnel identity is a per-consumer singleton unless the consumer opts into
// `dev.perWorktreeTunnel`, which rewrites the hostname per slug (wt-env-sync.ts).
// Without that opt-in, a worktree that inherits these keys does not get its own
// tunnel — it races the main checkout for the same hostname and silently
// hijacks its traffic.
//
// This only reports; it never edits the copied env files. wt-env-sync.ts holds
// the line that non-opt-in consumers get a byte-identical copy (see
// test/wt-env-sync-per-worktree-tunnel.test.ts), and a second rewriter here
// would break exactly the consumers that decided not to opt in.
const TUNNEL_ENV_KEYS = new Set(['TUNNEL_HOSTNAME', 'TUNNEL_NAME', 'CLOUDFLARE_API_KEY'])

/**
 * True when this worktree carries tunnel credentials but has no per-worktree
 * tunnel identity to use them with — i.e. starting a dev server here would
 * claim the main checkout's hostname.
 */
function detectSharedTunnelRisk(root) {
  let meta
  try {
    meta = JSON.parse(readFileSync(join(root, '.claude', 'consumer-meta.json'), 'utf8'))
  } catch {
    return null
  }
  if (meta?.dev?.perWorktreeTunnel) return null
  const files = meta?.dev?.envSyncPolicy?.filesToCopy ?? []
  for (const f of files) {
    let text
    try {
      text = readFileSync(join(root, f), 'utf8')
    } catch {
      continue
    }
    const hit = text
      .split('\n')
      .some((line) => TUNNEL_ENV_KEYS.has(line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=/)?.[1] ?? ''))
    if (hit) return { file: f }
  }
  return null
}

// Paths under clade-managed projection control are matched by
// LOCKED_PROJECTION_RE / isLockedProjectionPath imported from
// `./locked-projection.mjs` (single source of truth shared with the clade
// _validate-manifests.ts cross-check — see Phase 6 / closes TD-018).

// matchClaimGlob / classifyDirtyPaths moved to ./claim-helper.ts (TD-435) so
// every tool that moves a working tree shares one ownership predicate.

function formatActiveSessionsForError(claims) {
  if (claims.length === 0) return '  (none)'
  return claims
    .map(
      (c) =>
        `  - ${c.session_id} [${c.agent}] change=${c.change_id ?? '(none)'} branch=${c.branch ?? '(none)'} paths=${(c.expected_paths ?? []).length}`,
    )
    .join('\n')
}

// Whitelist of consumer-local paths where merge-back may auto-commit oxfmt
// drift without user confirmation. These files are NOT in LOCKED_PROJECTION_RE
// (they are consumer-managed, not clade-projection), but they receive
// auto-format passes from hooks and routinely produce zero-semantic drift
// inside worktrees. Adding a path here is a deliberate trust decision: any
// diff against HEAD that can be reproduced by `oxfmt(HEAD-version)` is
// guaranteed to be format-only and safe to land via auto-commit.
const OXFMT_AUTO_PATHS = new Set(['.claude/settings.json'])

// Returns oxfmt's stdout when piping `text` through `oxfmt --stdin-filepath`,
// or null if oxfmt is unavailable / errored. Tries direct `oxfmt` first, then
// `pnpm exec oxfmt` as fallback. `cwd` matters because oxfmt resolves its
// config (vite.config.ts / .oxfmtrc) from there — pass wtPath so config
// matches what the worktree's hook would have applied.
function runOxfmtStdin(text, filePath, cwd) {
  const attempts = [
    { cmd: 'oxfmt', args: [`--stdin-filepath=${filePath}`] },
    { cmd: 'pnpm', args: ['exec', 'oxfmt', `--stdin-filepath=${filePath}`] },
  ]
  for (const { cmd, args } of attempts) {
    try {
      const r = spawnSync(cmd, args, {
        input: text,
        encoding: 'utf8',
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      if (r.status === 0 && typeof r.stdout === 'string') return r.stdout
    } catch {}
  }
  return null
}

// Tool-managed drift gate: drift that **wt-helper itself created** and that
// **must never land on main**. Excluded from the WIP gate entirely — neither
// blocked nor auto-committed.
//
// Today this is exactly one case: cmdAdd flips the worktree's `.npmrc`
// `verify-deps-before-run` from `warn` to `install` (see the "Flip
// verify-deps-before-run" block in cmdAdd — main deliberately keeps `warn` to
// avoid postinstall on ctrl+c, worktrees take `install` so dep desync
// auto-repairs). That leaves every worktree permanently showing ` M .npmrc`,
// which the pre-flight then reports as user WIP and refuses to merge-back on
// — i.e. wt-helper's own bootstrap blocks wt-helper's own landing path
// (<consumer-a> TD-252, hit by all 4 lanes on 2026-07-26).
//
// It must NOT go through the auto-commit branch either: committing it would
// carry `install` into main, silently flipping main's pnpm behaviour. Since
// merge-back squashes **commits** only, leaving it uncommitted is correct —
// it simply must stop being counted as a blocker.
//
// Narrow by construction: returns true only when normalising that single line
// makes HEAD and the working tree byte-identical. Any other edit to `.npmrc`
// (a real user change) still falls through to the WIP gate.
function isToolManagedDrift(wtPath, filePath) {
  if (filePath !== '.npmrc') return false
  let headText
  try {
    headText = execFileSync('git', ['show', `HEAD:${filePath}`], {
      cwd: wtPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return false
  }
  let currentText
  try {
    currentText = readFileSync(join(wtPath, filePath), 'utf8')
  } catch {
    return false
  }
  if (headText === currentText) return false

  // **方向敏感**：只認 cmdAdd bootstrap 造成的 `warn` → `install`。
  // 反方向（HEAD 是 `install`、working tree 是 `warn`）是 user 手動把它改回來——那是**真的
  // user WIP**。若把兩個方向都當 tool-managed 放行，等於繞過 WIP 保護，cleanup 會靜默刪掉它。
  const LINE = /^verify-deps-before-run=(warn|install)$/m
  const headMatch = headText.match(LINE)
  const currentMatch = currentText.match(LINE)
  if (!headMatch || !currentMatch) return false
  if (headMatch[1] !== 'warn' || currentMatch[1] !== 'install') return false

  // 該行以外的內容必須逐位元組相同——同一次編輯若還動了別的行，整份就當 user WIP。
  const blank = (s) => s.replace(LINE, 'verify-deps-before-run=<tool-managed>')
  return blank(headText) === blank(currentText)
}

// Whitelist gate for the auto-commit branch in cmdMergeBack. Returns true iff:
//   1. filePath is in OXFMT_AUTO_PATHS, AND
//   2. `oxfmt(HEAD:filePath)` byte-equals the current working-tree content
//      (modulo trailing-newline normalization).
// Condition 2 mathematically excludes semantic drift: if running oxfmt on
// HEAD reproduces the current file, the only difference between HEAD and
// working tree is format normalization. False on any failure path (file
// missing in HEAD, oxfmt unavailable, content differs) → caller falls back
// to the existing STOP + 4-option guidance.
function isFormatOnlyDrift(wtPath, filePath) {
  if (!OXFMT_AUTO_PATHS.has(filePath)) return false
  let headText
  try {
    headText = execFileSync('git', ['show', `HEAD:${filePath}`], {
      cwd: wtPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return false
  }
  let currentText
  try {
    currentText = readFileSync(join(wtPath, filePath), 'utf8')
  } catch {
    return false
  }
  const formatted = runOxfmtStdin(headText, filePath, wtPath)
  if (formatted === null) return false
  return stripTrailingNewlines(formatted) === stripTrailingNewlines(currentText)
}

const stripTrailingNewlines = (s) => s.replace(/\n+$/, '')

// Fire-and-forget trigger for codebase-memory-mcp `index_repository` (fast mode)
// against a freshly-created worktree. Per pitfall-consumer-mcp-codebase-memory-missing
// (2026-05-18, severity high): without auto-index, every new worktree starts
// as "project not indexed" → search_graph / trace_path / get_code_snippet all
// fail, downstream spectra-apply / debug flows degrade to grep fallback.
//
// Design constraints:
//   - **Silent skip on any error**: mcp binary may be missing (consumer hasn't
//     run `codebase-memory-mcp install`), CLI may be incompatible, indexing may
//     fail mid-run. None of these should block worktree creation success.
//   - **Non-blocking**: spawn detached + unref so the index job runs in the
//     background and `cmdAdd` returns immediately. A 160 MB binary loading
//     8 GB mem budget for a fresh repo can take 30 s+; awaiting would defeat
//     the purpose of a fast worktree fork.
//   - **Test hook**: WT_HELPER_SKIP_INDEX=1 (set in fixtures.test) disables the
//     spawn entirely. WT_HELPER_INDEX_BIN overrides the binary path for stub
//     injection if/when end-to-end test coverage is needed.
//
// Set up git exclude for WORKTREE-BRIEF.md so it never shows as untracked.
//
// TD-347: MUST write to the **common** dir (`.git/info/exclude`), not the
// per-worktree `$GIT_DIR/info/exclude` (`.git/worktrees/<slug>/info/exclude`).
// git reads only the common dir's copy — the per-worktree one it never opens,
// so the previous `--git-dir` form was a silent no-op and every worktree that
// actually produced a brief kept it as `??` forever, tripping the
// uncommitted-files gate on merge-back / cleanup.
//
// The cost of the common dir is that the entry is visible to main and to every
// other worktree. That is acceptable **for this path only**: `WORKTREE-BRIEF.md`
// is a tool artifact this script itself writes, never a user file. NEVER widen
// this helper to arbitrary user-supplied paths — an entry written here cannot be
// scoped back to one worktree.
//
// Idempotent — safe to call multiple times. Warn-only on failure (never blocks
// worktree creation).
function setupBriefExclude(wtPath) {
  try {
    const wtGitDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: wtPath,
    }).trim()
    const infoDir = join(wtGitDir, 'info')
    mkdirSync(infoDir, { recursive: true })
    const excludePath = join(infoDir, 'exclude')
    const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
    if (!existing.split('\n').some((l) => l.trim() === 'WORKTREE-BRIEF.md')) {
      appendFileSync(
        excludePath,
        `${existing.endsWith('\n') || existing === '' ? '' : '\n'}WORKTREE-BRIEF.md\n`,
        'utf8',
      )
    }
  } catch (e) {
    console.error(`note: brief exclude setup skipped: ${e?.message ?? e}`)
  }
}

// Returns a Promise that resolves with `{ skipped, reason? }` once the child
// is launched (or skip decision is made) — never rejects. Caller can `.catch`
// defensively but no error path is actually reachable.
export function maybeIndexRepository(worktreePath) {
  return new Promise((resolveOuter) => {
    try {
      if (process.env.WT_HELPER_SKIP_INDEX === '1') {
        resolveOuter({ skipped: true, reason: 'WT_HELPER_SKIP_INDEX=1' })
        return
      }
      const binPath =
        process.env.WT_HELPER_INDEX_BIN ||
        join(process.env.HOME || '', '.local/bin/codebase-memory-mcp')
      if (!existsSync(binPath)) {
        resolveOuter({ skipped: true, reason: `binary missing: ${binPath}` })
        return
      }
      const payload = JSON.stringify({ repo_path: worktreePath, mode: 'fast' })
      const child = spawn(binPath, ['cli', 'index_repository', payload], {
        detached: true,
        stdio: 'ignore',
      })
      child.on('error', () => {
        /* silent — pitfall says graceful degrade */
      })
      child.unref()
      resolveOuter({ skipped: false })
    } catch {
      // Defensive: spawn throw on EACCES / ENOENT race — silent skip.
      resolveOuter({ skipped: true, reason: 'spawn threw' })
    }
  })
}

function cleanupCodebaseMemoryIndex(worktreePath) {
  try {
    const dbName = worktreePath.replace(/^\//, '').replace(/\//g, '-')
    const cacheDir = join(process.env.HOME || '', '.cache/codebase-memory-mcp')
    let cleaned = false
    for (const ext of ['.db', '.db-wal', '.db-shm']) {
      const f = join(cacheDir, dbName + ext)
      if (existsSync(f)) {
        rmSync(f)
        cleaned = true
      }
    }
    if (cleaned) console.log(`Cleaned codebase-memory-mcp index for ${dbName}`)
  } catch {
    // best-effort; never block worktree removal
  }
}

// Pin a pre-fork baseline snapshot under `refs/wt-baseline/<slug>/<iso>`.
//
// TD-144 fix: cmdAdd has three fork paths (main-clean, main-dirty + commit
// strategy, main-dirty + stash strategy) but historically only the stash
// strategy pinned a baseline ref. PTB-unsafe (Path X reset, abandon, etc.)
// worktrees on the other two paths permanently lost user WIP because there
// was nothing reachable to rescue from.
//
// This helper unifies the three paths. Behavior:
//   • main clean → pin HEAD sha directly as marker (single-parent ref).
//     `wt-helper rescue --show <ref>` returns "Empty stash" (no diff vs HEAD),
//     but the ref still exists for `git show <ref>` / `git log <ref>` rescue.
//   • main dirty → snapshot staged + unstaged + untracked via a temporary
//     index (GIT_INDEX_FILE) so the real working tree / real index are NEVER
//     touched. Build a stash-format 2-parent commit (HEAD + index-commit) so
//     `git stash show -p <ref>` produces a clean diff against HEAD.
//
// Returns { baselineRef, type, sha }. type ∈ 'clean-main' | 'snapshot'.
// Caller decides whether to use the returned ref (e.g. stash strategy skips
// this because its existing post-stash pin already covers all three layers).
function pinPreForkBaseline(consumerRoot, cleanSlug, iso, opts: { label?: string } = {}) {
  const baselineRef = `refs/wt-baseline/${cleanSlug}/${iso}`
  const headSha = git(['rev-parse', 'HEAD'], { cwd: consumerRoot })
  const headTree = git(['rev-parse', 'HEAD^{tree}'], { cwd: consumerRoot })
  const dirty = detectMainDirty(consumerRoot)
  const dirtyCount = dirty.modified.length + dirty.untracked.length

  if (dirtyCount === 0) {
    // Clean main: pin a 2-parent stash-format marker (tree == HEAD's tree,
    // parent[0] == HEAD, parent[1] == fresh index commit with same tree).
    // This guarantees `rescue --show <ref>` exits 0 (empty diff vs HEAD)
    // instead of erroring out with "not a stash-like commit". Without the
    // 2nd parent, `git stash show -p` rejects the ref entirely.
    const indexCommit = git(
      ['commit-tree', headTree, '-p', headSha, '-m', `index on main: ${headSha.slice(0, 7)}`],
      { cwd: consumerRoot },
    )
    const markerMessage = `On main: wt-baseline/${cleanSlug}/${iso} (clean-main marker; no diff vs HEAD)`
    const markerSha = git(
      ['commit-tree', headTree, '-p', headSha, '-p', indexCommit, '-m', markerMessage],
      { cwd: consumerRoot },
    )
    git(['update-ref', baselineRef, markerSha], { cwd: consumerRoot })
    return { baselineRef, type: 'clean-main', sha: markerSha }
  }

  // Dirty main: snapshot staged + unstaged + untracked into a stash-format
  // commit using a temporary index. `git stash create -u` is unreliable
  // across git versions (some omit untracked entirely; others add a ^3
  // parent), so we build the commit manually for deterministic behavior.
  const tmpIndex = join(consumerRoot, '.git', `wt-baseline-index-${cleanSlug}-${process.pid}`)
  const label = opts.label || cleanSlug
  const message = `On main: wt-baseline/${cleanSlug}/${iso} (pre-fork snapshot for ${label})`
  try {
    // Use a fresh temp index so we don't touch the real index.
    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex }
    // Seed the temp index with HEAD's tree, then stage everything (tracked
    // modifications + untracked) on top. This collapses all three layers
    // (HEAD vs staged vs unstaged vs untracked) into one tree.
    git(['read-tree', 'HEAD'], { cwd: consumerRoot, env })
    git(['add', '-A'], { cwd: consumerRoot, env, stdio: 'pipe' })
    const fullTree = git(['write-tree'], { cwd: consumerRoot, env })
    // Build an "index commit" parent so the resulting commit is a valid
    // 2-parent stash entry (parent[0]=HEAD, parent[1]=index). This is what
    // `git stash show -p` requires — a single-parent commit looks like
    // "Empty stash" to that command.
    const indexCommit = git(
      ['commit-tree', fullTree, '-p', headSha, '-m', `index on main: ${headSha.slice(0, 7)}`],
      { cwd: consumerRoot },
    )
    const snapshotSha = git(
      ['commit-tree', fullTree, '-p', headSha, '-p', indexCommit, '-m', message],
      { cwd: consumerRoot },
    )
    git(['update-ref', baselineRef, snapshotSha], { cwd: consumerRoot })
    return { baselineRef, type: 'snapshot', sha: snapshotSha }
  } finally {
    // Always delete the temp index to avoid leaving artifacts under .git/.
    try {
      if (existsSync(tmpIndex)) unlinkSync(tmpIndex)
    } catch {
      // Non-fatal: leftover temp index file in .git/ is harmless and
      // overwritten by next pin run (same pid + slug + ISO combo unlikely).
    }
  }
}

async function cmdAdd(slug, opts: WtOptions = {}) {
  if (!slug) {
    throw new Error(
      'Usage: wt-helper add <slug> [--precheck-baseline [<change>]] [--baseline-strategy commit|stash|warn] [--baseline-scope-paths <comma>] [--baseline-stash-name <name>] [--skip-prefork-audit] [--include-unrelated-dirty] [--task-summary <text>]',
    )
  }
  const cleanSlug = makeSlugSafe(slug)
  const consumerRoot = findConsumerRoot()
  // Pre-clean stale .git/index.lock if any — see docs/tech-debt.md TD-145.
  const lockStatus = ensureNoStaleIndexLock(consumerRoot)
  if (lockStatus.cleaned) {
    console.error(`⚠ rm'd stale .git/index.lock — proceeding`)
  }
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
  // Unmerged paths are triaged by classifyUnmergedSafety: stale UU (no
  // markers + no in-progress op state) auto-resolves via `git add`; real
  // conflicts or mid-operation state still stop with diagnostics.
  // Pre-gen session_id so the pre-fork baseline stash carries it in the name;
  // the same id is later passed to writeClaim() so stash + claim share identity.
  // Phase 7 (Q8): stash-reconcile namespace tags map back to a specific session.
  const preGenSessionId = genSessionId()
  let pendingStashName = null
  let pendingBaselineRef = null
  // TD-144: single ISO timestamp shared across all baseline ref pins for this
  // cmdAdd invocation. Computed once so commit-strategy pre-fork snapshot,
  // stash-strategy post-stash pin, and clean-main marker all land at the same
  // ref name when relevant.
  const baselineIso = new Date().toISOString().replace(/[:.]/g, '-')
  // Tracks whether any code path already pinned `refs/wt-baseline/<slug>/<iso>`
  // so the trailing "always pin" safety net doesn't double-pin (and overwrite
  // a richer snapshot with a HEAD marker).
  let baselineRefPinned = false
  if (opts.precheckBaseline !== undefined) {
    let dirty = detectMainDirty(consumerRoot)
    if (dirty.conflicted.length > 0) {
      const { safe, unsafe } = classifyUnmergedSafety(consumerRoot, dirty.conflicted)
      if (unsafe.length > 0) {
        const preview = unsafe
          .slice(0, 10)
          .map((u) => `  ${u.status}  ${u.path}  (${u.reason})`)
          .join('\n')
        const more = unsafe.length > 10 ? `\n  ... and ${unsafe.length - 10} more` : ''
        throw new Error(
          `Pre-fork baseline guard: main has ${unsafe.length} unsafe unmerged path(s):\n` +
            preview +
            more +
            `\n\nReasons: 'markers' = file contains <<<<<<< conflict markers (real conflict);` +
            ` 'merge-head' / 'rebase-head' / 'cherry-pick-head' = repo is mid-operation` +
            ` (.git/MERGE_HEAD or equivalent exists). Resolve manually before fork;` +
            ` wt-helper refuses to auto-handle these — any action risks data loss.`,
        )
      }
      if (safe.length > 0) {
        console.log(
          `Pre-fork baseline: auto-resolving ${safe.length} stale unmerged path(s)` +
            ` (no markers, no in-progress op): ${safe.map((s) => s.path).join(', ')}`,
        )
        git(['add', '--', ...safe.map((s) => s.path)], { cwd: consumerRoot, stdio: 'inherit' })
        // Re-run detectMainDirty so downstream sees the resolved paths as
        // modified (now staged adds) instead of conflicted.
        dirty = detectMainDirty(consumerRoot)
      }
    }
    // Pre-fork in-flight feature audit (warn-only, first pass).
    // See pitfall-pre-fork-baseline-hides-in-flight-feature: when main has a
    // large number of tracked modifications before fork, baseline strategy
    // (especially `stash`) can sweep an in-flight feature stack into the
    // pinned `refs/wt-baseline/*` ref. If merge-back later fails and the
    // agent goes "Path X" (reset worktree branch + squash + cleanup), the
    // baseline files vanish from main silently.
    //
    // Threshold default 50 staged+unstaged tracked changes; override via
    // WT_PREFORK_AUDIT_THRESHOLD env var. Opt-out via --skip-prefork-audit
    // flag (for tests). Never blocks — only emits a warning + mitigation hint.
    if (!opts.skipPreforkAudit) {
      const thresholdRaw = process.env.WT_PREFORK_AUDIT_THRESHOLD
      const threshold = thresholdRaw !== undefined ? Number(thresholdRaw) : 50
      const safeThreshold = Number.isFinite(threshold) && threshold >= 0 ? threshold : 50
      // P2 (pitfall 2026-06-01): count untracked too. An in-flight batch is
      // often mostly untracked (new migration / archive dir / new files), which
      // a tracked-only count misses. Block policy stays warn-only by design
      // (see pitfall-pre-fork-baseline-hides-in-flight-feature 'audit must not
      // block'); the unambiguous archive/migration markers handle the hard STOP.
      const trackedCount = dirty.modified.length
      const untrackedCount = dirty.untracked.length
      const totalDirtyCount = trackedCount + untrackedCount
      if (totalDirtyCount >= safeThreshold) {
        const sample = dirty.modified
          .slice(0, 20)
          .map((m) => `  ${m.status}  ${m.path}`)
          .join('\n')
        const more = totalDirtyCount > 20 ? `\n  ... and ${totalDirtyCount - 20} more` : ''
        console.warn('')
        console.warn(
          `⚠️  Pre-fork audit: main has ${totalDirtyCount} staged+unstaged+untracked change(s) ` +
            `(${trackedCount} tracked, ${untrackedCount} untracked; threshold ${safeThreshold}).`,
        )
        console.warn(
          `    These may be in-flight feature code; baseline strategy (especially 'stash') could`,
        )
        console.warn(
          `    sweep them into refs/wt-baseline/*, where they vanish from main permanently if`,
        )
        console.warn(`    merge-back later fails and you 'reset --hard' the worktree branch.`)
        console.warn(`    Risky paths (sample, up to 20):`)
        console.warn(sample + more)
        console.warn(`    Mitigation:`)
        console.warn(`      • Commit in-flight feature work to main BEFORE forking, OR`)
        console.warn(
          `      • Note the pinned ref printed below (refs/wt-baseline/<slug>/<ISO>) and use`,
        )
        console.warn(`        'wt-helper rescue --show <ref>' to inspect/recover if needed.`)
        console.warn(
          `    See pitfall-pre-fork-baseline-hides-in-flight-feature for full root cause.`,
        )
        console.warn(
          `    Override threshold via WT_PREFORK_AUDIT_THRESHOLD; silence via --skip-prefork-audit.`,
        )
        console.warn('')
      }
    }

    const dirtyCount = dirty.modified.length + dirty.untracked.length
    if (dirtyCount > 0) {
      // Phase 3 (Q5) audit: classify dirty paths so user sees ownership
      // before strategy selection. Other-session paths force STOP — we don't
      // know how to safely fork on top of someone else's WIP.
      const allDirtyPaths = [
        ...dirty.modified.map((m) => m.path),
        ...dirty.untracked.map((u) => u.path),
      ]
      const preForkCls = classifyDirtyPaths(consumerRoot, allDirtyPaths)
      if (preForkCls.otherSession.length > 0) {
        const preview = preForkCls.otherSession
          .slice(0, 10)
          .map(
            (o) =>
              `  ${o.path}  ← session ${o.session_id} / change ${o.change_id ?? '(none)'} / branch ${o.branch ?? '(none)'}`,
          )
          .join('\n')
        const more =
          preForkCls.otherSession.length > 10
            ? `\n  ... and ${preForkCls.otherSession.length - 10} more`
            : ''
        throw new Error(
          `Pre-fork baseline STOP: ${preForkCls.otherSession.length} dirty path(s) belong to another active session:\n` +
            preview +
            more +
            `\n\nForking on top of another session's WIP would mix unrelated work into the new branch's baseline. ` +
            `Wait for the other session to merge-back or coordinate before re-running.\n\n` +
            `Override only if the other claim is stale:\n` +
            `  node scripts/claim-helper.ts drop <session-id>\n` +
            `  node scripts/wt-helper.ts add ${cleanSlug} ...`,
        )
      }
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
              `Dirty files (${dirtyCount}):\n${dirtyPreview}`,
          )
        }
        const changeLabel = opts.precheckBaseline || cleanSlug
        const message = preForkBaselineCommitMessage(changeLabel)
        // TD-144: snapshot full dirty state (including non-scoped paths and
        // untracked) BEFORE the selective commit consumes the scoped paths.
        // Without this, any non-scoped path that gets `worktree add`'d into
        // the new wt is unrecoverable if user later runs PTB-unsafe ops.
        try {
          const pin = pinPreForkBaseline(consumerRoot, cleanSlug, baselineIso, {
            label: changeLabel,
          })
          baselineRefPinned = true
          console.log(
            `Pre-fork baseline: pinned ${pin.type} snapshot as '${pin.baselineRef}' (rescue via 'wt-helper rescue --show').`,
          )
        } catch (e) {
          console.error(`warn: pre-fork baseline pin failed (proceeding): ${e?.message ?? e}`)
        }
        console.log(
          `Pre-fork baseline: selective commit ${scopePaths.length} path(s) → "${message}"`,
        )
        gitSelectiveCommit(consumerRoot, scopePaths, message)
      } else if (strategy === 'stash') {
        // P1 (pitfall 2026-06-01-prefork-baseline-stash-sweeps-unclaimed-main-work, TD-181):
        // `git stash push -u` bulk-captures ALL main dirty into the worktree +
        // refs/wt-baseline/*, silently sweeping another session's live work (or a
        // verified-but-uncommitted archive batch) out of main. Unclaimed dirty is
        // invisible to the otherSession STOP above (main sessions never write a
        // claim; claims expire after 24h), so the only safe default is to NOT
        // capture anything — the fork starts clean from HEAD and does not need
        // main's WIP. Capture is opt-in (--include-unrelated-dirty for all), never
        // the silent default.
        const scopePaths = String(opts.baselineScopePaths || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (scopePaths.length > 0) {
          // No safe scoped stash: `git stash push -u -- <pathspec>` leaks the full
          // tracked working tree (the -u snapshot ignores pathspec — see
          // pitfall-git-stash-pathspec-scope-leak). Route scoped capture through
          // the commit strategy, which does a proven selective commit.
          throw new Error(
            `Pre-fork baseline guard: --baseline-strategy=stash does not support --baseline-scope-paths ` +
              `(git stash -u ignores pathspec and would leak the full tracked tree — see ` +
              `pitfall-git-stash-pathspec-scope-leak; there is no safe scoped stash).\n` +
              `For scoped capture, re-run with the commit strategy (selectively commits only the scoped paths):\n` +
              `  node scripts/wt-helper.ts add ${cleanSlug} --precheck-baseline${opts.precheckBaseline ? ` ${opts.precheckBaseline}` : ''} --baseline-strategy commit --baseline-scope-paths ${scopePaths.join(',')}\n` +
              `To carry ALL main dirty into the worktree instead, re-run stash with --include-unrelated-dirty.`,
          )
        }
        if (!opts.includeUnrelatedDirty) {
          // DEFAULT: capture nothing. Leave every main dirty path untouched; the
          // worktree forks clean from HEAD. This is the fail-safe that closes the
          // incident — unclaimed dirty is never silently swept.
          const preview = [
            ...dirty.modified.map((m) => `  ${m.status}  ${m.path}`),
            ...dirty.untracked.map((u) => `  ??  ${u.path}`),
          ]
            .slice(0, 10)
            .join('\n')
          const more = dirtyCount > 10 ? `\n  ... and ${dirtyCount - 10} more` : ''
          console.log(
            `Pre-fork baseline: stash strategy leaves main's ${dirtyCount} dirty file(s) in place; ` +
              `the worktree forks clean from HEAD (no bulk-capture).`,
          )
          console.log(preview + more)
          console.log(
            `  To carry specific WIP into the worktree: --baseline-strategy commit --baseline-scope-paths <comma>.\n` +
              `  To carry ALL main dirty (only when it genuinely belongs to this fork): re-run with --include-unrelated-dirty.`,
          )
          // No pendingStashName → nothing applied to the worktree; main untouched.
        } else {
          // Explicit opt-in: bulk-capture ALL main dirty. The caller affirms the
          // dirty belongs to this fork.
          const iso = baselineIso
          const stashName =
            opts.baselineStashName || `wt-baseline/${cleanSlug}/${preGenSessionId}/${iso}`
          const baselineRef = `refs/wt-baseline/${cleanSlug}/${iso}`
          console.log(
            `Pre-fork baseline: --include-unrelated-dirty → stash ${dirtyCount} file(s) as '${stashName}'`,
          )
          git(['stash', 'push', '-u', '-m', stashName], {
            cwd: consumerRoot,
            stdio: 'inherit',
          })
          pendingStashName = stashName
          pendingBaselineRef = baselineRef
        }
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
            `\n\nPick a strategy and re-run with --baseline-strategy commit|stash, or commit/stash manually before fork.`,
        )
      } else {
        throw new Error(
          `Pre-fork baseline guard: unknown --baseline-strategy "${strategy}" (expected commit|stash|warn)`,
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
  // `wt-helper cleanup` then permanently destroys them (incident: <consumer-b>
  // 2026-05-17, kpi-prod-design-review-refresh). `wt-helper rescue` lists
  // these refs for recovery.
  if (pendingStashName) {
    try {
      git(['stash', 'apply', 'stash@{0}'], { cwd: wtPath, stdio: 'inherit' })
      // Reset worktree index so the baseline files land as unstaged modifications
      // (or untracked, for -u stash entries). git-stash-apply restores the stash's
      // staged state, including untracked files brought in via `-u`. Without this
      // reset, a subsequent `git add -- <single-file>` won't unstage the baseline
      // files, leading to scope leak in the next commit (<consumer-b> 2026-05-18 incident:
      // fix-devlogin-loopback commit picked up 46 files / 7472 insertions).
      // See pitfall-wt-helper-baseline-staged-index.
      git(['reset', 'HEAD', '--'], { cwd: wtPath, stdio: 'inherit' })
      const stashSha = git(['rev-parse', 'stash@{0}'], { cwd: consumerRoot })
      git(['update-ref', pendingBaselineRef, stashSha], { cwd: consumerRoot })
      // TD-144: mark baseline ref as pinned so the trailing safety net (below)
      // doesn't overwrite this richer stash-format commit with a HEAD marker.
      baselineRefPinned = true
      git(['stash', 'drop', 'stash@{0}'], { cwd: consumerRoot, stdio: 'inherit' })
      console.log(
        `Pre-fork baseline: stash '${pendingStashName}' applied to worktree; pinned as '${pendingBaselineRef}' (permanently reachable — use 'wt-helper rescue' to inspect/restore).`,
      )

      // Audit baseline content (BOTH untracked tree AND tracked modifications) for
      // non-LOCKED-projection paths. These are likely in-flight feature code (e.g. a
      // spectra change in deferred-to-user phase). If merge-back later fails with
      // conflicts and the agent goes "Path X" (reset worktree branch to subagent commit
      // + squash + cleanup), these files vanish from main's working tree silently —
      // main HEAD never had them, so typecheck/runtime don't catch it.
      //
      // Two scan targets:
      //   • Untracked tree from `<ref>^3` parent (git-stash -u packs untracked into ^3).
      //   • Tracked mods from `<ref>^1..<ref>` diff (^1 = HEAD-at-stash-time; the diff
      //     surfaces files modified in working tree at stash time, which the stash
      //     commit carries forward).
      //
      // See pitfall-pre-fork-baseline-hides-in-flight-feature (2026-05-18 <consumer-b>
      // fix-vending-dispatch-dialog incident, 53-file vending feature stack lost from
      // main). Original audit only inspected `^3` — tracked-file feature drift slipped
      // through silently.
      try {
        const baselinePaths = new Set()

        try {
          const untrackedTree = git(['ls-tree', '-r', `${pendingBaselineRef}^3`, '--name-only'], {
            cwd: consumerRoot,
          })
          untrackedTree
            .split('\n')
            .filter(Boolean)
            .forEach((p) => baselinePaths.add(p))
        } catch (untrackedErr) {
          // ^3 parent may not exist if stash had no untracked content (`-u` saw no
          // untracked files). Silently swallow benign "Not a valid object name" /
          // "unknown revision"; surface other errors.
          const msg = untrackedErr?.message ?? String(untrackedErr)
          if (!/Not a valid object name|unknown revision/.test(msg)) {
            console.error(`note: baseline untracked-tree scan skipped: ${msg}`)
          }
        }

        try {
          const trackedDiff = git(
            ['diff', '--name-only', `${pendingBaselineRef}^1`, pendingBaselineRef],
            { cwd: consumerRoot },
          )
          trackedDiff
            .split('\n')
            .filter(Boolean)
            .forEach((p) => baselinePaths.add(p))
        } catch (trackedErr) {
          // ^1 parent should always exist (the HEAD at stash-creation time), but tolerate
          // edge cases (e.g. shallow clone, dangling ref) and surface non-benign errors.
          const msg = trackedErr?.message ?? String(trackedErr)
          if (!/Not a valid object name|unknown revision/.test(msg)) {
            console.error(`note: baseline tracked-diff scan skipped: ${msg}`)
          }
        }

        const nonProjection = [...baselinePaths].filter((p) => !isLockedProjectionPath(p))
        if (nonProjection.length > 0) {
          const sample = nonProjection.slice(0, 5).join(', ')
          const more = nonProjection.length > 5 ? `, ... +${nonProjection.length - 5} more` : ''
          console.warn('')
          console.warn(
            `⚠️  Pre-fork baseline contains ${nonProjection.length} non-LOCKED-projection file(s) (untracked + tracked-modified).`,
          )
          console.warn(`    These may be in-flight feature code (not just clade projection drift).`)
          console.warn(`    Sample: ${sample}${more}`)
          console.warn(`    If merge-back later fails with overwrite / conflict errors:`)
          console.warn(
            `      • NEVER run 'git reset --hard <subagent-commit>' (Path X) before auditing baseline.`,
          )
          console.warn(
            `      • Audit untracked: git ls-tree -r ${pendingBaselineRef}^3 --name-only`,
          )
          console.warn(
            `      • Audit tracked mods: git diff --name-only ${pendingBaselineRef}^1 ${pendingBaselineRef}`,
          )
          console.warn(
            `      • Recovery (untracked): git checkout ${pendingBaselineRef}^3 -- <paths>`,
          )
          console.warn(
            `      • Recovery (tracked mods): git checkout ${pendingBaselineRef} -- <paths>`,
          )
          console.warn(
            `    See pitfall-pre-fork-baseline-hides-in-flight-feature for full root cause.`,
          )
          console.warn('')
        }
      } catch (auditErr) {
        // Outer guard: if both scans throw unexpectedly, surface but never block.
        const msg = auditErr?.message ?? String(auditErr)
        console.error(`note: baseline content audit skipped: ${msg}`)
      }
    } catch (e) {
      console.error(
        `warn: stash apply to worktree failed; stash '${pendingStashName}' preserved in 'git stash list' for manual recovery.`,
      )
      console.error(`error detail: ${e?.message ?? e}`)
    }
  }

  // TD-144 safety net: guarantee EVERY fork path leaves at least one pinned
  // `refs/wt-baseline/<slug>/<iso>` ref. The commit-strategy and stash-strategy
  // branches pin earlier (and set baselineRefPinned). For the remaining paths
  // (main-clean fork, no --precheck-baseline at all, or a strategy that didn't
  // pin), call the helper now — it detects clean vs dirty and pins HEAD or a
  // snapshot accordingly. Without this, PTB-unsafe ops on the new wt have no
  // rescue anchor.
  if (!baselineRefPinned) {
    try {
      const pin = pinPreForkBaseline(consumerRoot, cleanSlug, baselineIso, { label: cleanSlug })
      baselineRefPinned = true
      console.log(
        `Pre-fork baseline: pinned ${pin.type} marker as '${pin.baselineRef}' (rescue via 'wt-helper rescue --show').`,
      )
    } catch (e) {
      console.error(`warn: pre-fork baseline pin (safety net) failed: ${e?.message ?? e}`)
    }
  }

  // Write session claim so publish / propagate / /commit / other wt-helper
  // invocations can see this worktree is active. expected_paths starts empty;
  // SessionStart heartbeat hook refreshes; cleanup / successful merge-back
  // drops the claim. See rules/core/session-claims.md.
  try {
    const expectedPaths = String(opts.expectedPaths ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const claim = writeClaim(consumerRoot, {
      session_id: preGenSessionId,
      agent: opts.agent ?? 'claude-code',
      consumer: basename(consumerRoot),
      worktree_path: wtPath,
      branch,
      change_id: cleanSlug,
      expected_paths: expectedPaths,
      task_summary: opts.taskSummary ?? null,
    })
    console.log(`  Claim: ${claim.session_id} (.clade/claims/${claim.session_id}.json)`)
  } catch (e) {
    console.error(`note: claim write skipped: ${e.message ?? e}`)
  }

  setupBriefExclude(wtPath)

  // TD-321: `.clade/bin/` 整個在 consumer .gitignore 內，而 `git worktree` fork 只帶
  // tracked 檔案 —— 新 worktree 因此沒有 clade-gate，`pnpm test`（直接呼叫
  // `.clade/bin/clade-gate`，無 fallback）立刻以 "not found" 失敗，訊息指不到根因。
  // 寫入者是 propagate.ts，而它只寫 consumer main root，永遠不會碰 worktree，所以在
  // fork 當下從 main 複製一份（含 exec bit）。Warn-only：consumer 沒有 .clade/bin 就跳過。
  try {
    const binSrcDir = join(consumerRoot, '.clade', 'bin')
    if (existsSync(binSrcDir)) {
      const binDstDir = join(wtPath, '.clade', 'bin')
      let copied = 0
      for (const entry of readdirSync(binSrcDir)) {
        const src = join(binSrcDir, entry)
        const dst = join(binDstDir, entry)
        // 逐檔判 gitignore，不是判整個 `.clade/`：多數 consumer 把 `.clade/bin/*`
        // **tracked** 進 git（worktree fork 自帶，本來就不缺），只 ignore
        // `.clade/runtime/` 之類。對非 ignored 的檔照複製會留下使用者從沒寫過的
        // untracked 檔，接著 merge-back / cleanup 的 uncommitted-files gate 就擋在
        // 那上面。per-entry try 讓 dangling symlink 只跳過自己，不吃掉其餘檔。
        try {
          if (!statSync(src).isFile() || existsSync(dst)) continue
          const rel = relative(consumerRoot, src)
          if (spawnSync('git', ['check-ignore', '-q', rel], { cwd: consumerRoot }).status !== 0) {
            continue
          }
          mkdirSync(binDstDir, { recursive: true })
          copyFileSync(src, dst)
          chmodSync(dst, statSync(src).mode & 0o777)
          copied++
        } catch (entryErr) {
          console.error(`note: .clade/bin/${entry} copy skipped: ${entryErr?.message ?? entryErr}`)
        }
      }
      if (copied > 0) console.log(`  clade-bin: copied ${copied} executable(s) from main`)
    }
  } catch (e) {
    console.error(`note: .clade/bin copy skipped: ${e?.message ?? e}`)
  }

  // TD-187: auto-invoke wt-env-bootstrap.ts if consumer-meta declares filesToCopy.
  // Copies gitignored env files (e.g. .env.local) from main into the new worktree
  // so dev server starts with DB credentials, tunnel keys, etc. Warn-only on failure.
  const consumerMetaPath = join(wtPath, '.claude', 'consumer-meta.json')
  if (existsSync(consumerMetaPath)) {
    try {
      const meta = JSON.parse(readFileSync(consumerMetaPath, 'utf8'))
      const filesToCopy = meta?.dev?.envSyncPolicy?.filesToCopy ?? []
      if (filesToCopy.length > 0) {
        let copied = 0
        for (const f of filesToCopy) {
          const src = join(consumerRoot, f)
          const dst = join(wtPath, f)
          if (existsSync(src) && !existsSync(dst)) {
            mkdirSync(dirname(dst), { recursive: true })
            copyFileSync(src, dst)
            copied++
          }
        }
        if (copied > 0) {
          console.log(
            `  env-bootstrap: copied ${copied} file(s) from main (${filesToCopy.join(', ')})`,
          )
        }
        // The copy above deliberately carries dev credentials, but tunnel keys
        // are the one class that cannot be shared — see TUNNEL_ENV_KEYS.
        const risk = detectSharedTunnelRisk(wtPath)
        if (risk) {
          console.error(
            `note: ${risk.file} carries tunnel keys and this consumer has no dev.perWorktreeTunnel.\n` +
              `      Starting a tunnel here claims main's hostname. Either opt into\n` +
              `      dev.perWorktreeTunnel (consumer-meta.json) or keep the tunnel on main only.`,
          )
        }
      }
    } catch (e) {
      console.error(`note: env-bootstrap skipped: ${e.message ?? e}`)
    }
  }

  // Dev-port slot for this worktree (TD-434). Must run before the "ready"
  // announce so the port shows up alongside the cd hint.
  const devPortRecord = allocateWorktreeDevPorts(consumerRoot, wtPath)
  if (devPortRecord) {
    const shown = devPortRecord.ports.map((p) => `${p.alias}=${p.port}`).join(' ')
    console.log(`  dev-port: offset +${devPortRecord.offset} → ${shown} (run 'wt-helper dev')`)
  } else if (readDeclaredDevPorts(consumerRoot).length > 0) {
    console.error(
      `note: dev-port band base+1..base+${DEV_PORT_BAND} exhausted — 'wt-helper dev' will refuse to start.\n` +
        `      Prune finished worktrees (wt-helper list / prune) to free a slot.`,
    )
  }

  // Per-worktree resource provisioning (isolated dev DB clone + sidecar).
  // Runs after the env-file copy above so the bootstrap script can read the
  // credentials it needs. No-op for consumers without wt-env-bootstrap.ts.
  const envBootstrap = runWtEnvBootstrap(wtPath, 'ensure')
  if (envBootstrap?.dbName) {
    console.log(`  env-bootstrap: ${envBootstrap.dbName} → ${envBootstrap.supabaseUrl}`)
  }

  // announce only after env files + per-worktree resources are in place —
  // "ready" must not print while the worktree still lacks its database.
  console.log('')
  console.log('Worktree ready.')
  console.log(`  Path: ${wtPath}`)
  console.log(`  Branch: ${branch}`)
  console.log(`  Handoff: ${JSON.stringify({ cwd: wtPath, branch })}`)
  console.log('')
  console.log(
    'The orchestrator continues directly or dispatches this cwd through the session handoff transport.',
  )

  // Auto-install deps + set verify-deps-before-run=install in worktree .npmrc.
  //
  // git worktree doesn't share node_modules. Without install here, the first
  // `pnpm dev` sees "node_modules out of sync" (warn) or crashes on missing
  // modules. Additionally, worktree package.json diverges from main over time
  // (version bumps, script additions) — pnpm 10 verify-deps-before-run treats
  // ANY package.json change as "structure changed" and warns on every script.
  //
  // Two-pronged fix:
  //   1. Install deps now (initial sync)
  //   2. Set verify-deps-before-run=install in worktree .npmrc so future
  //      desync auto-repairs instead of warning. Main keeps =warn (avoids
  //      postinstall on ctrl+c). Worktree accepts the occasional ~14s
  //      auto-install as better UX than persistent WARN on every command.
  if (existsSync(join(wtPath, 'package.json'))) {
    try {
      console.log('  deps: pnpm install --prefer-offline …')
      const inst = spawnSync('pnpm', ['install', '--prefer-offline', '--frozen-lockfile'], {
        cwd: wtPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000,
      })
      if (inst.status === 0) {
        console.log('  deps: done')
      } else {
        const stderr = inst.stderr?.toString().trim().split('\n')[0] ?? ''
        console.error(`  deps: pnpm install exited ${inst.status} — ${stderr}`)
        console.error('  deps: worktree may need manual `pnpm install` before dev server works')
      }
    } catch (e) {
      console.error(`  deps: skipped (${e.message ?? e})`)
    }

    // Flip verify-deps-before-run to install in worktree .npmrc
    try {
      const npmrcPath = join(wtPath, '.npmrc')
      if (existsSync(npmrcPath)) {
        const content = readFileSync(npmrcPath, 'utf8')
        if (content.includes('verify-deps-before-run=warn')) {
          writeFileSync(
            npmrcPath,
            content.replace('verify-deps-before-run=warn', 'verify-deps-before-run=install'),
          )
          console.log('  deps: .npmrc verify-deps-before-run → install (worktree-only)')
        }
      }
    } catch {}
  }

  // Auto-trigger codebase-memory index_repository (fast mode, detached) so
  // search_graph / trace_path / get_code_snippet work immediately in the new
  // worktree. Failures (missing binary, mcp unreachable) are silently swallowed
  // per pitfall-consumer-mcp-codebase-memory-missing.
  await maybeIndexRepository(wtPath).catch(() => {
    // Unreachable — helper never rejects — but defend against future contract drift.
  })
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
      10,
    )
  } catch {}
  const lastCommitMs = Number.isFinite(lastCommitSec) ? lastCommitSec * 1000 : 0
  const daysOld = lastCommitMs ? Math.floor((now - lastCommitMs) / 86_400_000) : null
  const merged = mergedBranches(consumerRoot).has(branchName)
  let briefStatus = null
  let taskSummary = null
  try {
    const briefPath = join(w.path, 'WORKTREE-BRIEF.md')
    if (existsSync(briefPath)) {
      const content = readFileSync(briefPath, 'utf8')
      const statusMatch = content.match(/^status:\s*(.+)$/m)
      if (statusMatch) briefStatus = statusMatch[1].trim()
      const taskMatch = content.match(/^# Task\s*\n+(.+)/m)
      if (taskMatch) taskSummary = taskMatch[1].trim()
    }
  } catch {}
  return {
    path: w.path,
    branch: branchName,
    lastCommit: lastCommitMs ? new Date(lastCommitMs).toISOString() : null,
    daysOld,
    mergedToMain: merged,
    briefStatus,
    taskSummary,
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
    if (w.taskSummary) {
      const statusTag = w.briefStatus ? ` [${w.briefStatus}]` : ''
      console.log(`  ${w.taskSummary}${statusTag}`)
    }
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
      cleanupCodebaseMemoryIndex(c.path)
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

// Classify each unmerged path as safe-resolvable or unsafe. Stale UU (index
// residue from a prior merge/rebase that was never finalized) has no conflict
// markers in the file and no in-progress operation state — `git add` to mark
// resolved is data-safe. Real conflicts (markers in file) or mid-operation
// state (.git/MERGE_HEAD / REBASE_HEAD / CHERRY_PICK_HEAD, plus the
// rebase-merge/ and rebase-apply/ directories git uses for interactive and
// am-based rebases) require user intervention; auto-resolving them risks
// data loss.
//
// Returns: { safe: [{ path, status }], unsafe: [{ path, status, reason }] }
// where reason ∈ 'markers' | 'merge-head' | 'rebase-head' | 'cherry-pick-head'
export function classifyUnmergedSafety(consumerRoot, conflicted) {
  if (!Array.isArray(conflicted) || conflicted.length === 0) {
    return { safe: [], unsafe: [] }
  }

  // Resolve the actual .git dir (handles main worktree, submodule, linked
  // worktree). For the consumerRoot we expect a main repo, but be defensive.
  let gitDir = join(consumerRoot, '.git')
  try {
    const raw = git(['rev-parse', '--git-dir'], { cwd: consumerRoot })
    gitDir = resolve(consumerRoot, raw)
  } catch {}

  let inProgressReason = null
  if (existsSync(join(gitDir, 'MERGE_HEAD'))) {
    inProgressReason = 'merge-head'
  } else if (
    existsSync(join(gitDir, 'REBASE_HEAD')) ||
    existsSync(join(gitDir, 'rebase-merge')) ||
    existsSync(join(gitDir, 'rebase-apply'))
  ) {
    inProgressReason = 'rebase-head'
  } else if (existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))) {
    inProgressReason = 'cherry-pick-head'
  }

  if (inProgressReason) {
    return {
      safe: [],
      unsafe: conflicted.map((c) => ({ path: c.path, status: c.status, reason: inProgressReason })),
    }
  }

  // Match a conflict marker line. Git always writes markers as a row of seven
  // identical chars; the start/end variants have a trailing space + label,
  // and the middle separator is the bare seven `=` row. Use multiline-anchored
  // regex so we match whole lines only and avoid catching `<<<<<<<` embedded in
  // prose.
  const MARKER_RE = /^(?:<{7}(?: .*)?|={7}|>{7}(?: .*)?)$/m
  const safe = []
  const unsafe = []
  for (const c of conflicted) {
    const abs = join(consumerRoot, c.path)
    let hasMarkers = false
    try {
      const content = readFileSync(abs, 'utf8')
      hasMarkers = MARKER_RE.test(content)
    } catch {
      // File missing (DD/DU/UD state) → conservative: treat as having
      // markers so cmdAdd refuses auto-resolve.
      hasMarkers = true
    }
    if (hasMarkers) {
      unsafe.push({ path: c.path, status: c.status, reason: 'markers' })
    } else {
      safe.push({ path: c.path, status: c.status })
    }
  }
  return { safe, unsafe }
}

// Stage a specific path list + commit ONLY those paths. `git add -- <paths>`
// first so untracked scope-in files get included (commit --only rejects bare
// untracked pathspecs); then `git commit --only -- <paths>` commits exactly
// those paths and restores the prior index afterward. Crucially the bare
// `git commit -m` previously used here committed the WHOLE index, so any
// OTHER-session WIP already pre-staged in main's index got folded into the
// pre-fork baseline commit (<consumer-a> per-client-module-isolation hit this: main's
// index had badge-wt salary/overtime staged). `--only` isolates exactly
// scopePaths, aligning with rules/core/commit.md «Ad-hoc commit 必走
// git commit --only». Used by pre-fork baseline guard's `commit` strategy.
//
// Caller responsibility: pass a commitlint-compliant message (the baseline
// caller in this file emits `🧹 chore(baseline): pre-fork sync for <change>`,
// which clears emoji-conventional gates). pre-commit / commit-msg hooks run
// normally — baseline content is user-edited working tree, lint/test/fmt over
// it are legitimate gates.
function gitSelectiveCommit(consumerRoot, scopePaths, message) {
  if (!Array.isArray(scopePaths) || scopePaths.length === 0) {
    throw new Error('gitSelectiveCommit: scopePaths must be a non-empty array')
  }
  git(['add', '--', ...scopePaths], { cwd: consumerRoot, stdio: 'inherit' })
  // `-m message` MUST precede the `--` separator. Anything after `--` is a
  // pathspec, so `commit --only -- <paths> -m <msg>` makes git treat `-m` and
  // the message as filenames ("pathspec '-m' did not match"). Order: flags →
  // `--` → paths.
  git(['commit', '--only', '-m', message, '--', ...scopePaths], {
    cwd: consumerRoot,
    stdio: 'inherit',
  })
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
// added after <consumer-b> 2026-05-17 incident where 47 baseline files lived only in
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

/**
 * `main..<branch>` 的 commit 數。查不到（branch 不存在 / git 失敗）回 `null` —— 呼叫端
 * 只在**嚴格等於 0** 時才放行 gate，錯誤絕不 fail-open。
 */
function branchAheadCount(consumerRoot, branchName) {
  try {
    const out = git(['rev-list', '--count', `main..${branchName}`], { cwd: consumerRoot }).trim()
    const n = Number.parseInt(out, 10)
    return Number.isNaN(n) ? null : n
  } catch {
    return null
  }
}

/** 未進 main 的 commit（`<sha> <subject>` 一行一條）。 */
function unlandedCommits(consumerRoot, branchName) {
  try {
    return git(['log', '--oneline', '--no-decorate', `main..${branchName}`], { cwd: consumerRoot })
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

function detectUnlandedFiles(consumerRoot, branchName) {
  // 0 ahead ⇒ branch 的每一個 commit 都已在 main 的 history 裡，cleanup 不可能讓任何
  // commit 遺失。這是**可證的**，不是啟發式，所以整個 gate 直接跳過。
  //
  // 底下的判準是「branch 版本的檔案內容 vs main **工作區**」，它回答不了「會不會遺失
  // commit」這題：main 之後只要往前走，那些被 main 改新的檔一律被報成「內容不在 main」，
  // branch 是無辜的——它只是舊。實測 `mts-to-ts` / `round3` / `ts-migration` 三個 `0 ahead
  // / userWip=0` 的 branch 全被擋，點名的 11 個檔正是同一 session 幾分鐘前在 main 改新的。
  //
  // 危害不是擋錯本身，是**訓練使用者對 `--force-discard-unland` 脫敏**：這個 flag 的語義
  // 是「我接受 branch 的 commit 會永久遺失」，若每次收乾淨的 wt 都要打它，真正該被它擋下
  // 的那次就不會有人停下來看。TD-302，同家族 TD-291 / TD-297。
  if (branchAheadCount(consumerRoot, branchName) === 0) return []

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

function sweepSiblingChangeResidues(consumerRoot, slug) {
  const out = git(['worktree', 'list', '--porcelain'], { cwd: consumerRoot })
  const wts = parseWorktreeList(out)
  const mainPath = consumerRoot
  const swept = []
  const skipped = []
  for (const wt of wts) {
    if (wt.path === mainPath) continue
    if (wt.path.endsWith(`/${slug}`)) continue
    const changeDir = join(wt.path, 'openspec', 'changes', slug)
    if (!existsSync(changeDir)) continue
    let dirty = 0
    try {
      const status = execFileSync('git', ['status', '--porcelain', `openspec/changes/${slug}/`], {
        cwd: wt.path,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      dirty = status.split('\n').filter(Boolean).length
    } catch {
      dirty = 0
    }
    if (dirty === 0) {
      rmSync(changeDir, { recursive: true, force: true })
      swept.push(wt.path)
    } else {
      skipped.push({ path: wt.path, dirty })
    }
  }
  return { swept, skipped }
}

async function cmdSweepSiblings(slug) {
  if (!slug) throw new Error('Usage: wt-helper sweep-siblings <slug>')
  const cleanSlug = makeSlugSafe(slug)
  const consumerRoot = findConsumerRoot()
  const { swept, skipped } = sweepSiblingChangeResidues(consumerRoot, cleanSlug)
  if (swept.length > 0) {
    console.log(`sweep-siblings: removed ${swept.length} stale copy(ies) of '${cleanSlug}':`)
    for (const p of swept) console.log(`  ${p}`)
  }
  for (const s of skipped) {
    console.warn(
      `sweep-siblings: SKIP ${s.path} — ${s.dirty} uncommitted file(s) in openspec/changes/${cleanSlug}/`,
    )
  }
  if (swept.length === 0 && skipped.length === 0) {
    console.log(`sweep-siblings: no sibling worktree carries '${cleanSlug}' (clean)`)
  }
}

/** Nearest ancestor holding a `.git` entry — the worktree's own top, not main's. */
function findRepoTop(start = process.cwd()) {
  let dir = resolve(start)
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir
    dir = dirname(dir)
  }
  throw new Error('Not inside a git repository (no .git found in any parent)')
}

/**
 * Start the dev server on this worktree's allocated port.
 *
 * The port arrives as a CLI flag on a command this function spawns itself,
 * which is the only layer that works: `.env.local` is read by Nuxt/Vite, not by
 * the shell, so an env var there can never reach the `--port` argument baked
 * into a consumer's `package.json` dev script. Bypassing that script is what
 * keeps all 11 consumers' `package.json` untouched.
 *
 * Consumers whose dev entry does extra setup (env pinning, multiple targets)
 * override the command via consumer-meta `dev.commands.worktreeSpawn`; it
 * receives the port appended as `--port <N>`.
 */
async function cmdDev(alias, opts: WtOptions = {}) {
  const repoTop = findRepoTop()
  const consumerRoot = findConsumerRoot()
  if (resolve(repoTop) === resolve(consumerRoot)) {
    throw new Error(
      `'wt-helper dev' is for worktrees; this is the main checkout (${consumerRoot}).\n` +
        `Main holds the registry port and the dev tunnel — run 'pnpm dev' here.`,
    )
  }

  // Worktrees created before TD-434 have no record; allocate on first use so
  // they are not stranded on the shared port.
  const record =
    readWorktreeDevPorts(consumerRoot, repoTop) ?? allocateWorktreeDevPorts(consumerRoot, repoTop)
  if (!record) {
    throw new Error(
      readDeclaredDevPorts(consumerRoot).length === 0
        ? `This consumer declares no dev ports in .claude/consumer-meta.json — nothing to allocate.`
        : `dev-port band base+1..base+${DEV_PORT_BAND} is exhausted.\n` +
            `Remove a finished worktree ('wt-helper list' / 'cleanup') to free a slot.`,
    )
  }

  const entries = record.ports ?? []
  const chosen = alias ? entries.find((p) => p.alias === alias) : entries[0]
  if (!chosen) {
    throw new Error(
      `No dev port for alias '${alias}'. Declared: ${entries.map((p) => p.alias).join(', ') || '(none)'}`,
    )
  }

  let spawnCmd = 'pnpm exec nuxt dev'
  try {
    const meta = JSON.parse(readFileSync(join(repoTop, '.claude', 'consumer-meta.json'), 'utf8'))
    spawnCmd = meta?.dev?.commands?.worktreeSpawn ?? spawnCmd
  } catch {
    // Fall through to the Nuxt default — consumer-meta is optional here.
  }

  const full = `${spawnCmd} --port ${chosen.port}`
  console.log(`wt-helper dev: ${chosen.alias} on ${chosen.port} (main uses ${chosen.mainPort})`)
  const risk = detectSharedTunnelRisk(repoTop)
  if (risk) {
    console.error(
      `⚠ ${risk.file} carries tunnel keys without dev.perWorktreeTunnel — the tunnel will\n` +
        `  claim main's hostname and hijack its traffic. Comment those keys out for this\n` +
        `  worktree, or opt into dev.perWorktreeTunnel in consumer-meta.json.`,
    )
  }
  console.log(`  ${full}`)
  if (opts.dryRun) return

  const child = spawn(full, { cwd: repoTop, shell: true, stdio: 'inherit' })
  await new Promise((resolvePromise) => {
    child.on('exit', (code) => {
      process.exitCode = code ?? 0
      resolvePromise(undefined)
    })
  })
}

// Auto-generated commit messages MUST clear the fleet commitlint config
// (`vendor/commitlint/commitlint.config.ts`) **and** clade's superset, which adds
// `subject-has-chinese`. A subject that fails either one aborts the commit mid-flow
// and leaves merge-back half-done (unfinished merge in the worktree, or fmt drift
// still uncommitted) — the user then has to finish it by hand.
//
// Two constraints beyond the emoji-conventional header shape:
//   1. subject MUST contain a Han character (clade-only rule, harmless elsewhere)
//   2. header MUST stay within config-conventional's 100-char `header-max-length`,
//      so anything unbounded (branch names, path lists) belongs in the body
// Clamping the *assembled* subject is wrong: a long enough variable segment pushes
// the Han characters past the cut and the result fails `subject-has-chinese`. Clamp
// each unbounded segment instead, and keep the header's fixed part short enough that
// the total can't reach 100 regardless.
const COMMIT_SEGMENT_MAX = 40
// config-conventional caps body lines at 100 too, so moving an unbounded value out
// of the header is not enough on its own — every body line needs clamping as well.
const COMMIT_BODY_LINE_MAX = 100

function clampTo(value, max) {
  const text = String(value ?? '')
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

const clampCommitSegment = (value) => clampTo(value, COMMIT_SEGMENT_MAX)
const clampCommitBodyLine = (value) => clampTo(value, COMMIT_BODY_LINE_MAX)

export function preSyncCommitMessage(branchName) {
  // Branch name is unbounded — body only.
  return `🧹 chore: 合併 main 進 worktree 分支以在此解衝突\n\n${clampCommitBodyLine(branchName)}\n`
}

export function preForkBaselineCommitMessage(changeLabel) {
  return `🧹 chore: fork worktree 前把 ${clampCommitSegment(changeLabel)} 的 baseline 落地`
}

export function fmtDriftCommitMessage(slug, paths) {
  // Path list is unbounded — body only.
  const body = paths.map(clampCommitBodyLine).join('\n')
  return `🧹 chore: wt ${clampCommitSegment(slug)} 自動落地 ${paths.length} 個純格式漂移檔\n\n${body}\n`
}

// Merge main into the session worktree branch before merge-back squash, so
// conflicts (if any) surface in the worktree's working tree rather than main's.
// Legacy merge-back ran `git merge --squash <branch>` at main, contaminating
// main on conflict (recovery required `merge --abort` + stash pop dance and
// repeatedly destabilized publish/propagate flows). Pre-sync inverts direction:
// `git merge origin/main` inside <wtPath> isolates conflict resolution there.
//
// Strategy: merge (not rebase). Final merge-back is squash so wt commit-chain
// shape is irrelevant; rebase would force per-commit replay on multi-phase wt
// (e.g. 9-commit feature branches), strictly more painful than one merge pass.
//
// Returns { synced: false, behind: 0 } if wt is up-to-date with target.
// Returns { synced: true, behind: N } on clean merge (creates a discrete
// discrete pre-sync commit on the wt branch — see preSyncCommitMessage()).
// Throws with structured guidance on conflict — does NOT auto-abort; leaves wt
// in unmerged state so user can inspect markers, resolve, commit, re-run.
export function syncWorktreeWithMain(wtPath, branchName, slug) {
  let targetRef = 'main'
  let hasOriginMain = false
  try {
    git(['rev-parse', '--verify', 'origin/main'], { cwd: wtPath })
    hasOriginMain = true
  } catch {}

  if (hasOriginMain) {
    try {
      git(['fetch', 'origin', 'main'], { cwd: wtPath, stdio: 'inherit' })
      targetRef = 'origin/main'
    } catch (e) {
      console.error(
        `warn: pre-sync fetch origin main failed (${e.message ?? e}); falling back to local main`,
      )
    }
  }

  let behind = 0
  try {
    const out = git(['rev-list', '--count', `${branchName}..${targetRef}`], { cwd: wtPath })
    behind = parseInt(out, 10) || 0
  } catch {
    return { synced: false, behind: 0 }
  }

  if (behind === 0) {
    return { synced: false, behind: 0 }
  }

  const commitMsg = preSyncCommitMessage(branchName)
  let mergeError = null
  try {
    git(['merge', '--no-ff', '-m', commitMsg, targetRef], { cwd: wtPath, stdio: 'inherit' })
  } catch (e) {
    mergeError = e
  }

  const readConflicted = () => {
    const raw = git(['status', '--porcelain'], { cwd: wtPath })
    return raw
      .split('\n')
      .filter((line) => /^(UU|AA|DD|AU|UA|UD|DU) /.test(line))
      .map((line) => line.slice(3).trim())
  }

  let conflicted = readConflicted()

  // ── Auto-resolve passes ────────────────────────────────────────────────
  // Stale-fork conflicts on long-lived wt branches (e.g. wt behind main by
  // 180+ commits) are dominated by two mechanical patterns that wt-helper
  // can resolve safely without user judgement:
  //
  //   1. LOCKED projection paths (`.claude/`, `.agents/`, `.codex/`,
  //      `.claude/hub.json`, etc. — see locked-projection.ts):
  //      main is SoT. Wt-side edits are propagate residue, never user
  //      intent. Take main version.
  //
  //   2. `openspec/changes/archive/**` paths: spectra-archive flow moves
  //      change folders INTO archive (one-way). Wt has no legitimate
  //      reason to disagree with main about archive contents. Take main.
  //
  // Both cases use the same mechanic: `git checkout --theirs <path>` (wt
  // runs `git merge main`, so theirs == main) + `git add <path>`. The
  // resolve pass logs counts and returns autoResolved metadata so callers
  // (and tests) can verify behavior.
  //
  // Conservative: any conflict outside these two predicates falls through
  // to the original throw — real content conflicts (docs/tech-debt.md,
  // active spec.md edits) still get user attention.
  const autoResolved = { locked: 0, archive: 0 }

  const runResolvePass = (predicate, label, counterKey) => {
    if (conflicted.length === 0) return
    const matched = conflicted.filter(predicate)
    if (matched.length === 0) return
    for (const path of matched) {
      try {
        git(['checkout', '--theirs', '--', path], { cwd: wtPath })
        git(['add', '--', path], { cwd: wtPath })
      } catch (e) {
        // Swallow per-path failure — fall through and let the residual
        // conflict surface in the final throw with full context. Log so
        // the user sees what auto-resolve attempted.
        console.error(
          `warn: auto-resolve ${label} failed for '${path}': ${e?.message ?? e} — left for manual resolution`,
        )
      }
    }
    autoResolved[counterKey] += matched.length
    console.log(
      `merge-back: auto-resolved ${matched.length} ${label} pre-sync conflict(s) (took theirs from main)`,
    )
    conflicted = readConflicted()
  }

  runResolvePass(isLockedProjectionPath, 'LOCKED projection', 'locked')
  runResolvePass(isArchivePathConflict, 'openspec archive', 'archive')

  // If auto-resolve cleared every conflict, finalize the merge commit.
  // mergeError may still be set even though `git status` is clean (e.g.
  // `git merge` exited non-zero due to conflicts that we then resolved).
  if (conflicted.length === 0) {
    if (autoResolved.locked + autoResolved.archive > 0) {
      try {
        git(['commit', '--no-edit'], { cwd: wtPath, stdio: 'inherit' })
      } catch (e) {
        // commit can fail if e.g. pre-commit hook rejects — surface as throw
        throw new Error(
          `merge-back pre-sync auto-resolve succeeded but commit failed: ${e?.message ?? e}\n` +
            `Worktree '${wtPath}' is in mid-merge state with all conflicts staged.\n` +
            `Resolution — inspect, then finalize manually:\n` +
            `  cd ${wtPath}\n` +
            `  git status\n` +
            `  git commit --no-edit\n` +
            `  cd -\n` +
            `  node scripts/wt-helper.ts merge-back ${slug}\n`,
          { cause: e },
        )
      }
      return { synced: true, behind, autoResolved }
    }
    if (mergeError) {
      // No conflicts and no auto-resolve happened, but merge errored — odd
      // state. Surface as throw rather than silently claim success.
      throw new Error(`pre-sync merge failed: ${mergeError?.message ?? mergeError}`, {
        cause: mergeError,
      })
    }
    return { synced: true, behind, autoResolved }
  }

  // ── Residual conflict path: surface with auto-resolve summary ─────────
  const preview = conflicted
    .slice(0, 10)
    .map((f) => `  ${f}`)
    .join('\n')
  const more = conflicted.length > 10 ? `\n  ... and ${conflicted.length - 10} more` : ''
  const autoResolvedTotal = autoResolved.locked + autoResolved.archive
  const autoResolvedSummary =
    autoResolvedTotal > 0
      ? `\n(auto-resolved ${autoResolvedTotal}: LOCKED=${autoResolved.locked}, archive=${autoResolved.archive}; ${conflicted.length} remain)`
      : ''
  const detail =
    conflicted.length > 0
      ? `${conflicted.length} file(s) hit conflict during pre-sync${autoResolvedSummary}:\n${preview}${more}`
      : `pre-sync merge failed: ${mergeError?.message ?? mergeError}`
  throw new Error(
    `merge-back pre-sync blocked: ${detail}\n\n` +
      `Worktree '${wtPath}' is left in unmerged state — main's working tree was NOT touched.\n` +
      `Resolution — resolve in worktree, then re-run merge-back:\n` +
      `  cd ${wtPath}\n` +
      `  # resolve conflict markers, git add <files>\n` +
      `  git commit --no-edit       # finalize the pre-sync merge\n` +
      `  cd -\n` +
      `  node scripts/wt-helper.ts merge-back ${slug}\n\n` +
      `Override (NOT recommended): re-run with --skip-pre-sync to attempt squash directly\n` +
      `(legacy path — conflicts would surface in main's working tree).`,
  )
}

// Predicate for F2 auto-resolve: paths under `openspec/changes/archive/**`
// are spectra-archive flow output. Main is SoT for archive contents — wt
// branches should never claim authority over an archived change folder.
// Match is path-prefix based (no date-format gating) so future archive
// naming changes don't silently regress this predicate.
//
// Kept separate from locked-projection.ts because:
//   - LOCKED is a fixed projection set written by sync-rules / sync-vendor
//   - Archive is a content domain written by spectra-archive flow
//   - The reasons "main is SoT" differ; conflating obscures intent
export function isArchivePathConflict(p) {
  return p.startsWith('openspec/changes/archive/')
}

// Preserve gitignored review artifacts from worktree before cleanup destroys
// them. `screenshots/<env>/<topic>/` is the review-gui / verify:ui screenshot
// convention; gitignored by spectra cookbook so they don't bloat git history.
// `git merge --squash` carries no gitignored content, so without this sync,
// `git worktree remove --force` permanently deletes screenshots and downstream
// `spectra-archive` Step 7 sweep finds no files in main. See TD-160.
//
// Behavior: for every entry under `screenshots/` in the worktree (including
// `_archive`, which is just as gitignored as the rest), merge **per file** into
// main's same relative path:
//   - destination file missing            → copy
//   - destination file byte-identical     → skip (silent, already preserved)
//   - destination file exists, differs    → copy as `<stem>.wt-<slug><ext>`
//                                           (`-2`, `-3`, … if taken), created
//                                           exclusively; NEVER overwrite
// Directory-level skip is forbidden: gitignored screenshots exist only in the
// worktree's working tree, so anything not copied here is destroyed by the
// subsequent `git worktree remove --force` with no git object to recover from.
//
// Invariant: cleanup must not run until every gitignored artifact has been
// individually accounted for — so this is **fail-closed**. Any scan error, copy
// error, or entry type we cannot faithfully preserve (symlink, FIFO, socket,
// device) is recorded as a failure, and `cmdMergeBack` MUST skip cleanup and
// retain the worktree when any failure is present. Reporting a warning and
// deleting the worktree anyway is the exact failure mode this function exists
// to prevent.
const DIGEST_CHUNK = 1 << 20

// Chunked so a single large screenshot cannot blow the heap. Reads through one
// descriptor and re-stats it afterwards, so a file mutated mid-read is reported
// as a failure rather than silently digesting a torn snapshot.
function fileDigest(p) {
  const fd = openSync(p, 'r')
  try {
    const { size, mtimeMs } = statSync(p)
    const hash = createHash('sha256')
    const buf = Buffer.allocUnsafe(DIGEST_CHUNK)
    let read
    while ((read = readSync(fd, buf, 0, DIGEST_CHUNK, null)) > 0) hash.update(buf.subarray(0, read))
    const after = statSync(p)
    if (after.size !== size || after.mtimeMs !== mtimeMs) {
      throw new Error(`file changed while hashing: ${p}`)
    }
    return hash.digest('hex')
  } finally {
    closeSync(fd)
  }
}

// Refuse to write through a symlink (or any non-directory masquerading as a
// parent): following one would let a dangling/hostile link redirect the copy
// outside main's screenshots tree.
function assertPlainDestination(dstPath, rootReal) {
  let cur = dirname(dstPath)
  const seen = []
  while (!existsSync(cur)) {
    seen.push(cur)
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  const st = lstatSync(cur, { throwIfNoEntry: false })
  if (!st) throw new Error(`destination root missing: ${cur}`)
  if (st.isSymbolicLink()) throw new Error(`destination parent is a symlink: ${cur}`)
  if (!st.isDirectory()) throw new Error(`destination parent is not a directory: ${cur}`)
  const real = realpathSync(cur)
  if (real !== rootReal && !real.startsWith(`${rootReal}/`)) {
    throw new Error(`destination escapes screenshots root: ${real}`)
  }
  for (const p of seen) void p
  const existing = lstatSync(dstPath, { throwIfNoEntry: false })
  if (existing && existing.isSymbolicLink()) {
    throw new Error(`destination file is a symlink: ${dstPath}`)
  }
  return existing
}

// Exclusive create; returns the name actually used. Never truncates an existing
// candidate — a byte-identical one counts as already preserved, a differing one
// pushes to the next suffix.
function copyToFreeConflictName(srcPath, dstDir, name, slug, rootReal) {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 1; n <= 100; n++) {
    const candidate = `${stem}.wt-${slug}${n === 1 ? '' : `-${n}`}${ext}`
    const candidatePath = join(dstDir, candidate)
    const existing = assertPlainDestination(candidatePath, rootReal)
    if (existing) {
      if (
        existing.size === statSync(srcPath).size &&
        fileDigest(srcPath) === fileDigest(candidatePath)
      ) {
        return { name: candidate, identical: true }
      }
      continue
    }
    mkdirSync(dstDir, { recursive: true })
    copyFileSync(srcPath, candidatePath, fsConstants.COPYFILE_EXCL)
    return { name: candidate, identical: false }
  }
  throw new Error(`no free conflict name for ${name} after 100 attempts`)
}

function mergeScreenshotDir(srcDir, dstDir, ctx, out) {
  let entries
  try {
    entries = readdirSync(srcDir, { withFileTypes: true })
  } catch (e) {
    out.push({
      ...ctx,
      rel: ctx.rel || '.',
      failed: true,
      scanFailure: true,
      error: e.message ?? String(e),
    })
    return
  }
  for (const entry of entries) {
    const rel = ctx.rel ? `${ctx.rel}/${entry.name}` : entry.name
    const srcPath = join(srcDir, entry.name)
    const dstPath = join(dstDir, entry.name)
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      // Cannot faithfully preserve; must not be silently dropped by cleanup.
      out.push({
        ...ctx,
        rel,
        failed: true,
        unsupported: true,
        error: `unsupported entry type (symlink/special file): ${srcPath}`,
      })
      continue
    }
    if (entry.isDirectory()) {
      mergeScreenshotDir(srcPath, dstPath, { ...ctx, rel }, out)
      continue
    }
    try {
      const existing = assertPlainDestination(dstPath, ctx.rootReal)
      if (!existing) {
        mkdirSync(dstDir, { recursive: true })
        copyFileSync(srcPath, dstPath, fsConstants.COPYFILE_EXCL)
        out.push({ ...ctx, rel, copied: true })
        continue
      }
      if (existing.size === statSync(srcPath).size && fileDigest(srcPath) === fileDigest(dstPath)) {
        out.push({ ...ctx, rel, identical: true })
        continue
      }
      const { name: conflictName, identical } = copyToFreeConflictName(
        srcPath,
        dstDir,
        entry.name,
        ctx.slug,
        ctx.rootReal,
      )
      out.push({
        ...ctx,
        rel,
        renamed: true,
        alreadyPreserved: identical,
        as: ctx.rel ? `${ctx.rel}/${conflictName}` : conflictName,
      })
    } catch (e) {
      out.push({ ...ctx, rel, failed: true, error: e.message ?? String(e) })
    }
  }
}

function preserveWorktreeScreenshots(wtPath, mainPath, slug = 'worktree') {
  const src = join(wtPath, 'screenshots')
  if (!existsSync(src)) return { files: [], ok: true }
  const dstRoot = join(mainPath, 'screenshots')
  mkdirSync(dstRoot, { recursive: true })
  const files = []
  // Walk the whole tree — including `_archive` and any loose files at the
  // `screenshots/` or `<env>/` level. Everything here is gitignored, so an
  // entry we decline to walk is an entry cleanup deletes forever.
  mergeScreenshotDir(
    src,
    dstRoot,
    { env: '.', topic: '.', rel: '', slug: makeSlugSafe(slug), rootReal: realpathSync(dstRoot) },
    files,
  )
  const failed = files.filter((f) => f.failed)
  return { files, ok: failed.length === 0 }
}

async function cmdCleanup(slug, opts) {
  if (!slug)
    throw new Error(
      'Usage: wt-helper cleanup <slug> [--force] [--force-discard-unland] [--force-discard-uncommitted] [--allow-orphan-record]',
    )
  const cleanSlug = makeSlugSafe(slug)
  const consumerRoot = findConsumerRoot()
  const wts = sessionWorktrees(consumerRoot)
  const target = wts.find(
    (w) => w.path.endsWith(`/${cleanSlug}`) && w.branch && w.branch.endsWith(`-${cleanSlug}`),
  )
  if (!target) throw new Error(`No session worktree found for slug: ${cleanSlug}`)

  const branchName = target.branch.replace('refs/heads/', '')

  // Pre-check ALL gates upfront so the error message can recommend the
  // full flag combo in one go, rather than ping-ponging the user between
  // --force / --force-discard-unland / --force-discard-uncommitted.
  // The third gate (uncommitted) was added after <consumer-b> 2026-05-17 incident
  // where 47 baseline files lived only in the worktree's working tree
  // (applied from stash, never committed) and vanished on cleanup.
  const branchMerged = mergedBranches(consumerRoot).has(branchName)
  const unlanded = detectUnlandedFiles(consumerRoot, branchName)
  // Tool-managed drift MUST be excluded here for the same reason merge-back's WIP gate
  // excludes it (see isToolManagedDrift) — and the two gates MUST agree, or atomic
  // merge-back breaks in half: cmdMergeBack squashes successfully, then calls cmdCleanup,
  // which still counts `.npmrc` as uncommitted and refuses. Result is
  // "absorbed into main (cleanup skipped/failed)" on **every** lane, each needing a manual
  // --force-discard-uncommitted to finish (<consumer-a>'s 4 lanes, 2026-07-26).
  //
  // Only `modified` is filtered: isToolManagedDrift compares against HEAD, which an
  // untracked file has no version of.
  const uncommittedRaw = detectUncommittedWorktreeFiles(target.path)
  const uncommitted = {
    modified: uncommittedRaw.modified.filter((m) => !isToolManagedDrift(target.path, m.path)),
    untracked: uncommittedRaw.untracked,
  }
  const uncommittedCount = uncommitted.modified.length + uncommitted.untracked.length
  // git 不知道我們決定忽略這些檔，`git worktree remove` 照樣會因 dirty 而拒絕。
  // 只放行 gate 而不讓 remove 帶 --force，等於把同一個失敗從 gate 挪到 remove。
  const toolManagedCount = uncommittedRaw.modified.length - uncommitted.modified.length
  const needsForce = !branchMerged && !opts.force
  const needsDiscardUnland = unlanded.length > 0 && !opts.forceDiscardUnland
  const needsDiscardUncommitted = uncommittedCount > 0 && !opts.forceDiscardUncommitted

  if (needsForce || needsDiscardUnland || needsDiscardUncommitted) {
    const issues = []
    if (needsForce) {
      issues.push(`- Branch ${branchName} is not merged into main (gated by --force)`)
    }
    if (needsDiscardUnland) {
      // 列**未進 main 的 commit**，不是檔名清單 —— 使用者要判的是「這些 commit 我還要
      // 不要」，檔名答不了那題（TD-302）。取不到 commit 時才退回檔名。
      const commits = unlandedCommits(consumerRoot, branchName)
      const items = commits.length > 0 ? commits : unlanded
      const label =
        commits.length > 0
          ? `${commits.length} commit(s) not in main`
          : `${unlanded.length} file(s) whose content is NOT present in main's working tree`
      const preview = items
        .slice(0, 10)
        .map((f) => `    - ${f}`)
        .join('\n')
      const more = items.length > 10 ? `\n    ... and ${items.length - 10} more` : ''
      issues.push(
        `- Branch ${branchName} has ${label} (gated by --force-discard-unland):\n${preview}${more}`,
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
        `- Worktree '${target.path}' has ${uncommittedCount} uncommitted file(s) that will be permanently destroyed by 'git worktree remove --force' (gated by --force-discard-uncommitted):\n${preview}${more}`,
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
        `  node scripts/wt-helper.ts cleanup ${cleanSlug} ${flagsNeeded.join(' ')}\n` +
        `\nWhy each gate:\n` +
        `  --force                       discards the unmerged branch ref\n` +
        `  --force-discard-unland        acknowledges branch's commits will be lost\n` +
        `                                (their content never made it into main)\n` +
        `  --force-discard-uncommitted   acknowledges worktree's uncommitted files\n` +
        `                                (modified/untracked, including pre-fork baseline\n` +
        `                                 applied from stash) will be permanently destroyed\n` +
        `\nUse \`wt-helper merge-back ${cleanSlug}\` first if you want to commit the work,\n` +
        `or \`wt-helper rescue\` to see pinned pre-fork baselines available for restore.`,
    )
  }

  // Release per-worktree resources before the directory disappears — the
  // bootstrap script lives inside the worktree. No-op for consumers without it.
  const envCleanup = runWtEnvBootstrap(target.path, 'destroy', {
    allowOrphanRecord: opts.allowOrphanRecord,
  })
  if (envCleanup?.status === 'orphan-recorded' && !opts.allowOrphanRecord) {
    throw new Error(
      `Worktree env cleanup did not complete for ${cleanSlug}; ` +
        `re-run with --allow-orphan-record to record it as an orphan and continue.`,
    )
  }

  const removeArgs = ['worktree', 'remove']
  // toolManagedCount > 0：gate 已判定這些 drift 可忽略（見上方），但 git 仍視之為 dirty
  // 而拒絕移除，所以這裡必須補 --force。它只涵蓋 isToolManagedDrift 認可的檔——真的
  // user WIP 早在 gate 就攔下了，不會走到這裡。
  if (opts.force || toolManagedCount > 0) removeArgs.push('--force')
  removeArgs.push(target.path)
  git(removeArgs, { cwd: consumerRoot })
  // Post-remove verification: git worktree remove may leave gitignored dirs
  // (e.g. screenshots/) on macOS. Fallback rm ensures no orphaned directories.
  if (existsSync(target.path)) {
    try {
      rmSync(target.path, { recursive: true, force: true })
      console.log(`warn: worktree dir survived git remove — cleaned residual gitignored files`)
    } catch (e) {
      console.error(`warn: could not remove residual dir ${target.path}: ${e.message ?? e}`)
    }
  }
  cleanupCodebaseMemoryIndex(target.path)
  try {
    git(['branch', opts.force ? '-D' : '-d', branchName], { cwd: consumerRoot })
  } catch {
    console.error(`warn: branch ${branchName} could not be deleted; keep manually`)
  }
  try {
    const claim = findClaimByWorktree(consumerRoot, target.path)
    if (claim) {
      dropClaim(consumerRoot, claim.session_id)
      console.log(`Dropped claim ${claim.session_id}`)
    }
  } catch {
    // best-effort claim cleanup; never block worktree removal
  }
  console.log(`Removed ${target.path}`)
}

// Atomic ceremony: stash main blockers (optional) → squash session branch
// into main → cleanup worktree. Designed to be called from spectra-archive
// Step 0 (auto, slug = change name) or manually (ad-hoc Form-1 worktrees).
async function cmdMergeBack(slug, opts: WtOptions = {}) {
  if (!slug) {
    throw new Error(
      'Usage: wt-helper merge-back <slug> [--dry-run] [--auto-stash] [--include-worktree-wip] [--no-cleanup] [--noop-if-missing] [--skip-pre-sync]',
    )
  }
  const cleanSlug = makeSlugSafe(slug)
  const consumerRoot = findConsumerRoot()
  // Pre-clean stale .git/index.lock if any — see docs/tech-debt.md TD-145.
  const lockStatus = ensureNoStaleIndexLock(consumerRoot)
  if (lockStatus.cleaned) {
    console.error(`⚠ rm'd stale .git/index.lock — proceeding`)
  }
  const wts = sessionWorktrees(consumerRoot)
  const target = wts.find(
    (w) => w.path.endsWith(`/${cleanSlug}`) && w.branch && w.branch.endsWith(`-${cleanSlug}`),
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

  // Pre-flight: worktree dirty tracked-file check (<consumer-b>-1J 2026-05-18 incident).
  // detectMergeBlockers only catches files in main that would be overwritten;
  // it doesn't see edits inside the worktree that were never committed. Without
  // this check, `git merge --squash` silently drops worktree WIP, then cleanup
  // permanently destroys the worktree → WIP gone with no recovery path.
  //
  // Filter clade-managed projection paths via the shared LOCKED_PROJECTION
  // regex (kept in sync with hub:bootstrap auto-sync range — see top-of-file
  // constant). Those are propagate residue, not user WIP, and re-materialize
  // on next bootstrap. User code (server/, src/, app/, ...) and untracked
  // non-projection files are real WIP and must be committed before squash.
  const wtDirty = detectUncommittedWorktreeFiles(target.path)
  const wtUserDirtyAll = [
    // repo-aware：clade home 的 `vendor/snippets/**` 等是源檔不是投影，過濾掉它們等於讓
    // 只改 snippet 的 worktree 靜默通過未 commit gate（TD-344）。
    ...wtDirty.modified
      .filter((m) => !isLockedProjectionPathFor(target.path, m.path))
      .map((m) => ({ ...m, kind: 'modified' })),
    ...wtDirty.untracked
      .filter((u) => !isLockedProjectionPathFor(target.path, u.path))
      .map((u) => ({ ...u, status: '??', kind: 'untracked' })),
  ]
  // Partition: OXFMT_AUTO_PATHS entries whose drift is purely oxfmt
  // normalization of the HEAD version are auto-commit candidates (no user
  // prompt). Everything else stays as semantic user WIP and falls through to
  // the existing STOP gate.
  const wtFmtDrift = []
  const wtToolManaged = []
  const wtUserDirty = []
  for (const d of wtUserDirtyAll) {
    if (d.kind === 'modified' && isToolManagedDrift(target.path, d.path)) {
      // wt-helper 自己 bootstrap 造成、且刻意不該 land 的差異 → 兩邊都不進
      // （不擋 merge-back，也不 auto-commit）。見 isToolManagedDrift 註解。
      wtToolManaged.push(d)
    } else if (d.kind === 'modified' && isFormatOnlyDrift(target.path, d.path)) {
      wtFmtDrift.push(d)
    } else {
      wtUserDirty.push(d)
    }
  }
  if (wtToolManaged.length > 0) {
    console.log(
      `merge-back: ignoring ${wtToolManaged.length} tool-managed drift file(s) ` +
        `(${wtToolManaged.map((d) => d.path).join(', ')}) — created by wt-helper bootstrap, ` +
        `intentionally not landed on main`,
    )
  }

  // Surface pinned pre-fork baselines for this slug so the user knows what's
  // available for rescue if cleanup later detects uncommitted-baseline loss
  // (cmdCleanup --force-discard-uncommitted gate, post-<consumer-b> 2026-05-17 fix).
  let baselineRefs = []
  try {
    const raw = git(['for-each-ref', '--format=%(refname)', `refs/wt-baseline/${cleanSlug}/`], {
      cwd: consumerRoot,
    })
    baselineRefs = raw.split('\n').filter(Boolean)
  } catch {}

  let preSyncBehind = 0
  if (!opts.skipPreSync) {
    try {
      const out = git(['rev-list', '--count', `${branchName}..main`], { cwd: target.path })
      preSyncBehind = parseInt(out, 10) || 0
    } catch {}
  }

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
    console.log(`  Fmt-only drift:  ${wtFmtDrift.length} (would auto-commit on real run)`)
    for (const d of wtFmtDrift.slice(0, 20)) {
      console.log(`    ${(d.status ?? '??').padEnd(3)} ${d.path}`)
    }
    if (wtFmtDrift.length > 20) {
      console.log(`    ... and ${wtFmtDrift.length - 20} more`)
    }
    console.log(`  Pinned baselines: ${baselineRefs.length}`)
    for (const r of baselineRefs) console.log(`    ${r}`)
    if (opts.skipPreSync) {
      console.log(`  Pre-sync:        SKIPPED (--skip-pre-sync)`)
    } else {
      console.log(`  Pre-sync behind: ${preSyncBehind} commit(s) on main`)
    }
    if (wtUserDirty.length > 0) {
      console.log(
        `  Action: worktree has uncommitted WIP; without --include-worktree-wip, merge-back would refuse.`,
      )
    } else if (blockers.length > 0) {
      console.log(
        `  Action: blockers detected; without --auto-stash, merge-back would fail at pre-flight.`,
      )
    } else if (preSyncBehind > 0 && !opts.skipPreSync) {
      console.log(
        `  Action: would merge origin/main into wt (${preSyncBehind} commit(s)), then squash + cleanup. Conflicts (if any) stay in wt.`,
      )
    } else {
      console.log(`  Action: would squash + cleanup cleanly.`)
    }
    return {
      absorbed: false,
      slug: cleanSlug,
      dryRun: true,
      blockers,
      wtUserDirty,
      wtFmtDrift,
      baselineRefs,
      preSyncBehind,
    }
  }

  if (baselineRefs.length > 0) {
    console.log(`merge-back: ${baselineRefs.length} pinned pre-fork baseline(s) for ${cleanSlug}:`)
    for (const r of baselineRefs) console.log(`  ${r}`)
    console.log(
      `  → if cleanup later detects uncommitted files, inspect via 'wt-helper rescue --show <ref>'.`,
    )
    console.log(
      `  → redundant 'wt-baseline/${cleanSlug}/<ISO>' stash entries are safe to drop via '${stashReconcileCmd(consumerRoot)} --slug ${cleanSlug} --interactive'.`,
    )
    console.log('')
  }

  // Auto-commit format-only drift on OXFMT_AUTO_PATHS files (no user prompt).
  // Branch runs BEFORE the wtUserDirty STOP gate, so mixed cases (format-only
  // drift on settings.json + real WIP on server/foo.ts) auto-land the trivial
  // bit first, then STOP cleanly on the remaining semantic edits.
  //
  // pre-commit / commit-msg hooks run normally. oxfmt is idempotent — re-running
  // fmt on already-formatted content produces zero further drift. OXFMT_AUTO_PATHS
  // are config files (settings.json, .editorconfig, etc.) which oxlint doesn't
  // touch, so lint won't false-positive either. Message shape comes from
  // fmtDriftCommitMessage() so it clears commitlint on clade and consumers alike.
  if (wtFmtDrift.length > 0) {
    const paths = wtFmtDrift.map((d) => d.path)
    try {
      git(['add', '--', ...paths], { cwd: target.path })
      const msg = fmtDriftCommitMessage(cleanSlug, paths)
      git(['commit', '-m', msg], { cwd: target.path, stdio: 'inherit' })
      console.log(
        `merge-back: auto-committed ${paths.length} format-only drift file(s) on ${branchName} (oxfmt(HEAD) === current)`,
      )
    } catch (e) {
      throw new Error(
        `merge-back: format-only auto-commit failed: ${e.message ?? e}\n` +
          `Affected paths: ${paths.join(', ')}\n` +
          `Resolution — commit manually in worktree (resolve any hook violation first), then re-run merge-back.`,
        { cause: e },
      )
    }
  }

  // Act on worktree WIP detection from pre-flight: either auto-amend (opt-in)
  // or refuse with clear remediation steps. See computation above for rationale.
  //
  // pre-commit + commit-msg hooks run on amend. The HEAD commit message was
  // produced by Claude/codex following worktree-default.md §5 (emoji + scope:
  // `🧹 chore(wt): ...` or similar), so commit-msg passes. pre-commit may fail
  // if amended user WIP has lint/test issues — that's a legitimate gate, the
  // catch below surfaces remediation.
  if (wtUserDirty.length > 0) {
    if (opts.includeWorktreeWip) {
      const paths = wtUserDirty.map((d) => d.path)
      try {
        git(['add', '--', ...paths], { cwd: target.path })
        git(['commit', '--amend', '--no-edit'], {
          cwd: target.path,
          stdio: 'inherit',
        })
        console.log(
          `merge-back: --include-worktree-wip auto-amended ${paths.length} dirty file(s) into ${branchName} HEAD`,
        )
      } catch (e) {
        throw new Error(
          `merge-back: --include-worktree-wip auto-amend failed: ${e.message ?? e}\n` +
            `Likely cause: pre-commit hook (lint/test/typecheck) rejected the amended WIP.\n` +
            `Resolution — cd ${target.path}, fix the hook violation, then:\n` +
            `  git add ${paths.slice(0, 3).join(' ')}${paths.length > 3 ? ' ...' : ''}\n` +
            `  git commit --amend --no-edit\n` +
            `Then re-run wt-helper merge-back.`,
          { cause: e },
        )
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
          `commit with a meaningful message is safer).`,
      )
    }
  }

  if (!opts.skipPreSync) {
    const syncResult = syncWorktreeWithMain(target.path, branchName, cleanSlug)
    if (syncResult.synced) {
      console.log(
        `merge-back: pre-synced wt with main (${syncResult.behind} commit(s) behind, merge commit: '${preSyncCommitMessage(branchName).split('\n')[0]}')`,
      )
    }
  }

  let stashRef = null
  if (blockers.length > 0) {
    // Classify blockers — if any belong to ANOTHER active session's claim,
    // stop with explicit ownership diagnosis rather than silently stashing
    // their WIP. This is Phase 3 (Q5) audit: claim-aware pre-merge-back gate.
    // LOCKED projection blockers fall through to existing auto-stash path
    // (they are clade-managed, safe to stash). Everything else is left for
    // user decision via the existing --auto-stash flow.
    const myClaim = findClaimByWorktree(consumerRoot, target.path)
    const cls = classifyDirtyPaths(
      consumerRoot,
      blockers.map((b) => b.path),
      { excludeClaim: myClaim },
    )
    if (cls.otherSession.length > 0) {
      const preview = cls.otherSession
        .slice(0, 10)
        .map(
          (o) =>
            `  ${o.path}  ← session ${o.session_id} / change ${o.change_id ?? '(none)'} / branch ${o.branch ?? '(none)'}`,
        )
        .join('\n')
      const more =
        cls.otherSession.length > 10 ? `\n  ... and ${cls.otherSession.length - 10} more` : ''
      const claims = readActiveClaims(consumerRoot).filter(
        (c) => !myClaim || c.session_id !== myClaim.session_id,
      )
      throw new Error(
        `merge-back STOP: ${cls.otherSession.length} blocker(s) overlap with another active session's claim:\n` +
          preview +
          more +
          `\n\n` +
          `These paths belong to a DIFFERENT session's worktree. Stashing them ` +
          `would silently swallow that session's WIP — wt-helper refuses.\n\n` +
          `Active sessions on this consumer (excluding self):\n` +
          formatActiveSessionsForError(claims) +
          `\n\nResolution paths:\n` +
          `  1. Let the other session finish (merge-back its own work) first, then re-run.\n` +
          `  2. If the other claim is stale (session no longer running):\n` +
          `       node scripts/claim-helper.ts drop <session-id>\n` +
          `     then re-run merge-back.\n` +
          `  3. If the path overlap is intentional cross-session collaboration:\n` +
          `     coordinate manually (commit / stash by the other session) before re-running.`,
      )
    }

    // claim guard scope MUST ⊇ bulk-stash scope. The bulk-stash below (line
    // ~1903 `git stash push -u`, no pathspec) snapshots ALL of main's dirty
    // state — not just `blockers` (= branch changeset ∩ main dirty). The above
    // `cls` check only classifies blockers, so the difference set
    // (allDirty \ blockers) — unrelated dirty that ISN'T part of this branch's
    // changeset — was never checked against claims and got silently swept into
    // the wt-merge-block stash. When that difference contains another active
    // session's claimed WIP, the bulk-stash swallows it. Match the guard scope
    // to the stash scope: classify the difference set and refuse if it overlaps
    // another session. Only runs under --auto-stash (the only path that reaches
    // bulk-stash; without it the blocker-only gate below already refuses).
    // See pitfall-merge-back-autostash-bulk-captures-other-session-wip.
    if (opts.autoStash) {
      const blockerPathSet = new Set(blockers.map((b) => b.path))
      const mainDirty = detectMainDirty(consumerRoot)
      const allDirtyPaths = [
        ...mainDirty.modified.map((m) => m.path),
        ...mainDirty.untracked.map((u) => u.path),
      ]
      const nonBlockerDirty = allDirtyPaths.filter((p) => !blockerPathSet.has(p))
      const diffCls = classifyDirtyPaths(consumerRoot, nonBlockerDirty, { excludeClaim: myClaim })
      if (diffCls.otherSession.length > 0) {
        const preview = diffCls.otherSession
          .slice(0, 10)
          .map(
            (o) =>
              `  ${o.path}  ← session ${o.session_id} / change ${o.change_id ?? '(none)'} / branch ${o.branch ?? '(none)'}`,
          )
          .join('\n')
        const more =
          diffCls.otherSession.length > 10
            ? `\n  ... and ${diffCls.otherSession.length - 10} more`
            : ''
        const claims = readActiveClaims(consumerRoot).filter(
          (c) => !myClaim || c.session_id !== myClaim.session_id,
        )
        throw new Error(
          `merge-back STOP: --auto-stash would bulk-stash ${diffCls.otherSession.length} dirty path(s) belonging to another active session's claim:\n` +
            preview +
            more +
            `\n\n` +
            `These paths are NOT part of this branch's changeset (not blockers), but ` +
            `--auto-stash bulk-stashes ALL of main's dirty state — including unrelated ` +
            `WIP — so it would silently swallow that session's work into the ` +
            `wt-merge-block stash. wt-helper refuses.\n\n` +
            `Active sessions on this consumer (excluding self):\n` +
            formatActiveSessionsForError(claims) +
            `\n\nResolution paths:\n` +
            `  1. Let the other session finish (merge-back / commit its own work) first, then re-run.\n` +
            `  2. If the other claim is stale (session no longer running):\n` +
            `       node scripts/claim-helper.ts drop <session-id>\n` +
            `     then re-run merge-back --auto-stash.\n` +
            `  3. Have the other session commit or stash its WIP so main is clean of it before re-running.`,
        )
      }
    }

    if (!opts.autoStash && blockers.length <= 3 && blockers.every((b) => b.type === 'modified')) {
      const isoTs = new Date().toISOString().replace(/[:.]/g, '-')
      const paths = blockers.map((b) => b.path)
      const minStashMsg = `wt-merge-block/${cleanSlug}/protect/${isoTs}`
      git(['stash', 'push', '-m', minStashMsg, '--', ...paths], { cwd: consumerRoot })
      stashRef = minStashMsg
      opts.minimalStashPaths = paths
      console.log(`merge-back: minimal-stashed ${paths.length} blocker(s): ${paths.join(', ')}`)
    } else if (!opts.autoStash) {
      const preview = blockers
        .slice(0, 10)
        .map((b) => `  ${b.type.padEnd(10)} ${b.path}`)
        .join('\n')
      const more = blockers.length > 10 ? `\n  ... and ${blockers.length - 10} more` : ''
      throw new Error(
        `merge-back blocked: ${blockers.length} file(s) in main's working tree would be overwritten by squash:\n` +
          preview +
          more +
          `\n\nRe-run with --auto-stash to bulk-stash main's dirty state as 'wt-merge-block/${cleanSlug}/<ISO>'\n` +
          `(blockers + any unrelated dirty paths); reconcile later via \`${stashReconcileCmd(consumerRoot)}\`.`,
      )
    }
    const isoTs = new Date().toISOString().replace(/[:.]/g, '-')
    // Phase 7 (Q8): stash namespace carries the merge-back's session_id (from
    // its worktree claim) so stash-reconcile can attribute a stash back to a
    // specific session. Fallback to slug-only when no claim found (warn so
    // path-detection-only attribution is visible).
    let mergeBackClaim = null
    try {
      mergeBackClaim = findClaimByWorktree(consumerRoot, target.path)
    } catch {}
    const sessionPart = mergeBackClaim?.session_id ? `/${mergeBackClaim.session_id}` : ''
    if (!mergeBackClaim) {
      console.error(
        `note: no .clade/claims/ entry for worktree ${target.path} — stash falls back to slug-only namespace`,
      )
    }
    const stashMsg = `wt-merge-block/${cleanSlug}${sessionPart}/${isoTs}`
    // Snapshot refs/stash before push so we can verify a new entry was actually created.
    // See pitfall-wt-helper-merge-back-silent-stash-miss: `git stash push -u` on a
    // clean working tree exits 0 with "No local changes to save" and creates no
    // entry, which made the success log misleading when a concurrent session
    // cleared main between blocker detection and stash push.
    let stashHeadBefore = null
    try {
      stashHeadBefore = git(['rev-parse', '--verify', 'refs/stash'], { cwd: consumerRoot })
    } catch {
      stashHeadBefore = null
    }
    try {
      // Bulk stash (no pathspec) — matches cmdAdd's baseline-stash strategy.
      // Previously this used `git stash push -u -m <msg> -- <blocker-paths>`,
      // but `git stash push -u` with pathspec hits a scope-leak bug on
      // git 2.50.1 (<consumer-b> 2026-05-18: 22 blockers requested → 74 files stashed
      // including unrelated main tracked-tree mods). Bulk stash makes the
      // semantics explicit: "snapshot main's dirty state so squash can land,
      // user reconciles via stash-reconcile.ts". See pitfall-git-stash-
      // pathspec-scope-leak (merge-back surface).
      git(['stash', 'push', '-u', '-m', stashMsg], { cwd: consumerRoot })
    } catch (e) {
      throw new Error(`merge-back: failed to stash blockers: ${e.message ?? e}`, { cause: e })
    }
    let stashHeadAfter = null
    try {
      stashHeadAfter = git(['rev-parse', '--verify', 'refs/stash'], { cwd: consumerRoot })
    } catch {
      stashHeadAfter = null
    }
    if (stashHeadAfter && stashHeadAfter !== stashHeadBefore) {
      stashRef = stashMsg
      console.log(
        `merge-back: bulk-stashed main's dirty state as '${stashMsg}' (covers ${blockers.length} blocker(s) + any unrelated dirty paths)`,
      )
    } else {
      stashRef = null
      console.warn(
        `merge-back: warning — bulk stash command exited clean but no new stash entry created.`,
      )
      console.warn(
        `             main working tree was already clean when stash ran (likely a concurrent`,
      )
      console.warn(
        `             session cleared it between blocker detection and stash push). Skipping`,
      )
      console.warn(
        `             stashRef assignment; squash will proceed against current main state.`,
      )
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
        `Resolve conflicts manually then re-run \`wt-helper merge-back ${cleanSlug}\`.`,
    )
  }

  // Auto-restore covers BOTH stash paths (minimal-scope and --auto-stash bulk).
  // Leaving the bulk stash parked for a later stash-reconcile.ts run means the
  // squash lands on a main that is missing the user's other in-flight work, and
  // every downstream step (archive gate, /commit grouping) sees a main that does
  // not reflect reality. Restoring here puts squash result + prior dirty back in
  // one working tree, which is what "commit everything together" needs.
  // The bulk stash itself stays bulk on purpose — pathspec stash hits a
  // scope-leak bug on git 2.50.1 (see the comment above the stash push).
  if (stashRef) {
    let stashedFileCount = null
    try {
      stashedFileCount = git(['stash', 'show', '--name-only', 'stash@{0}'], { cwd: consumerRoot })
        .split('\n')
        .filter(Boolean).length
    } catch {
      stashedFileCount = null
    }
    const scopeLabel = opts.minimalStashPaths ? 'minimal-stashed' : 'stashed'
    const countLabel = opts.minimalStashPaths
      ? `${opts.minimalStashPaths.length}`
      : (stashedFileCount ?? '?')
    try {
      git(['stash', 'pop'], { cwd: consumerRoot })
      console.log(`merge-back: auto-restored ${countLabel} ${scopeLabel} path(s) onto main`)
      stashRef = null
    } catch {
      console.warn(
        `merge-back: stash pop conflicted — stash '${stashRef}' preserved.\n` +
          `             Squash HAS landed on main; the stashed changes have NOT been\n` +
          `             merged back. Resolve with \`git checkout --ours/--theirs <path>\`\n` +
          `             then \`git stash drop\`, or inspect via \`node scripts/stash-reconcile.ts\`.`,
      )
    }
  }

  // Preserve gitignored review artifacts (screenshots) before cleanup destroys
  // the worktree dir. `git merge --squash` carries nothing under `screenshots/`
  // because it's gitignored; without this sync downstream `spectra-archive`
  // Step 7 sweep finds no files in main. See TD-160.
  let screenshotSync = { files: [], ok: true }
  if (opts.cleanup !== false) {
    try {
      screenshotSync = preserveWorktreeScreenshots(target.path, consumerRoot, cleanSlug)
    } catch (e) {
      screenshotSync = {
        files: [{ env: '.', topic: '.', rel: '.', failed: true, error: e.message ?? String(e) }],
        ok: false,
      }
    }
    const copied = screenshotSync.files.filter((f) => f.copied)
    const identical = screenshotSync.files.filter((f) => f.identical)
    const renamed = screenshotSync.files.filter((f) => f.renamed)
    const failed = screenshotSync.files.filter((f) => f.failed)
    const scanFailed = failed.filter((f) => f.scanFailure)
    if (copied.length + identical.length + renamed.length + failed.length > 0) {
      console.log(
        `merge-back: screenshot preserve — copied ${copied.length}, skipped-identical ${identical.length}, renamed-conflict ${renamed.length}, failed ${failed.length}` +
          (scanFailed.length > 0
            ? ` (incl. ${scanFailed.length} directory scan failure(s) — unknown number of files left unexamined)`
            : ''),
      )
    }
    if (copied.length > 0) {
      const list = copied.map((f) => f.rel).join(', ')
      console.log(`merge-back: screenshot copied: ${list}`)
    }
    if (renamed.length > 0) {
      const list = renamed.map((f) => `${f.rel} → ${f.as}`).join('; ')
      console.warn(
        `merge-back: ${renamed.length} screenshot file(s) differed from main and were kept side-by-side (review and delete the redundant copy): ${list}`,
      )
    }
    if (failed.length > 0) {
      const list = failed.map((f) => `${f.rel} (${f.error})`).join('; ')
      console.error(
        `merge-back: ${failed.length} screenshot artifact(s) could not be preserved: ${list}`,
      )
    }
  }

  // Fail-closed: gitignored artifacts have no git object to recover from, so a
  // worktree may only be destroyed once every one of them is accounted for.
  if (opts.cleanup !== false && !screenshotSync.ok) {
    console.error(
      `merge-back: cleanup skipped; worktree retained at ${target.path}\n` +
        `  Reason: screenshot preserve did not account for every gitignored artifact (see errors above).\n` +
        `  Resolve the listed paths (copy them out manually if needed), then re-run:\n` +
        `    node scripts/wt-helper.ts cleanup ${cleanSlug} --force --force-discard-unland`,
    )
  }

  let cleanupDone = false
  if (opts.cleanup !== false && screenshotSync.ok) {
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

  // `git merge --squash` stages the changeset but deliberately does NOT commit:
  // landing is finished by the caller in main (worktree-default.md § v3 atomic
  // landing — "user 再在 main 跑 /commit"). That contract is correct, but the
  // summary above reads as "done" while the worktree and branch are already
  // gone, so the staged index is the only remaining copy. Say the remaining
  // step out loud. (2026-08-04: two clade-home sessions in one afternoon each
  // read "absorbed into main + worktree cleaned" as committed; the second only
  // caught it because a rule told it to grep HEAD for its own content.)
  let stagedPaths = []
  try {
    stagedPaths = git(['diff', '--cached', '--name-only'], { cwd: consumerRoot })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {}
  if (stagedPaths.length > 0) {
    const shown = stagedPaths
      .slice(0, 4)
      .map((p) => `'${p}'`)
      .join(' ')
    console.log('')
    console.log(
      `⚠ Staged into main, NOT committed (${stagedPaths.length} file(s)) — the worktree and branch are already removed, so this index is the only copy.`,
    )
    console.log(`  Finish landing now:`)
    console.log(`  git commit --only -m "<msg>" -- ${shown}${stagedPaths.length > 4 ? ' ...' : ''}`)
    console.log(
      `  Then verify: git show HEAD:<file> | grep -c '<a plain-text string you just wrote>'`,
    )
  }

  if (stashRef) {
    console.log('')
    console.log(`Reconcile blocker stash for '${cleanSlug}':`)
    console.log(`  ${stashReconcileCmd(consumerRoot)} --slug ${cleanSlug} --interactive`)
    console.log(`(Stash preserved in 'git stash list' — apply/drop is user's call.)`)
  }
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
      throw new Error(`rescue --show ${opts.show}: ${e?.message ?? e}`, { cause: e })
    }
    return
  }

  const pinned = []
  try {
    const raw = git(
      ['for-each-ref', '--format=%(refname) %(objectname) %(subject)', 'refs/wt-baseline/'],
      { cwd: consumerRoot },
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
      `Dangling unreachable wt-baseline stashes (gc candidate within ~30 days) — ${danglingFiltered.length}:`,
    )
    for (const d of danglingFiltered) {
      console.log(`  sha:     ${d.sha}`)
      console.log(`  subject: ${d.subject}`)
    }
    console.log('')
  }
  console.log('To inspect a candidate (read-only patch view):')
  console.log('  node scripts/wt-helper.ts rescue --show <ref-or-sha>')
  console.log('To restore to current branch:')
  console.log('  git stash apply <ref-or-sha>          # may conflict; resolve before committing')
  console.log('  git checkout <ref-or-sha> -- <paths>  # selective restore by path')
}

// Scan <consumer>-wt/ for directories that are not registered git worktrees
// (no .git file). These are leftovers from incomplete cleanup — typically
// gitignored content (screenshots) that survived `git worktree remove`.
async function cmdOrphanPrune(opts) {
  const consumerRoot = findConsumerRoot()
  const consumerName = basename(consumerRoot)
  const wtParent = join(dirname(consumerRoot), `${consumerName}-wt`)
  if (!existsSync(wtParent)) {
    console.log(`No worktree parent dir: ${wtParent}`)
    return
  }
  const entries = readdirSync(wtParent, { withFileTypes: true })
  const orphans = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dirPath = join(wtParent, entry.name)
    if (!existsSync(join(dirPath, '.git'))) {
      orphans.push({ slug: entry.name, path: dirPath })
    }
  }
  if (orphans.length === 0) {
    console.log(`No orphaned directories in ${wtParent}`)
    return
  }
  console.log(`Found ${orphans.length} orphaned director${orphans.length === 1 ? 'y' : 'ies'}:\n`)
  for (const o of orphans) {
    const files = []
    const walk = (p) => {
      for (const e of readdirSync(p, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(p, e.name))
        else files.push(join(p, e.name).replace(o.path + '/', ''))
      }
    }
    try {
      walk(o.path)
    } catch {
      /* best-effort */
    }
    console.log(`  ${o.slug}/  (${files.length} file${files.length === 1 ? '' : 's'})`)
    for (const f of files.slice(0, 5)) console.log(`    ${f}`)
    if (files.length > 5) console.log(`    ... and ${files.length - 5} more`)
  }
  if (opts.force) {
    for (const o of orphans) {
      rmSync(o.path, { recursive: true, force: true })
      console.log(`Removed orphan: ${o.path}`)
    }
  } else {
    console.log(`\nRe-run with --force to remove all orphaned directories:`)
    console.log(`  node scripts/wt-helper.ts orphan-prune --force`)
  }
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
    '--task-summary',
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
    skipPreSync: flags.has('--skip-pre-sync'),
    skipPreforkAudit: flags.has('--skip-prefork-audit'),
    includeUnrelatedDirty: flags.has('--include-unrelated-dirty'),
    allowOrphanRecord: flags.has('--allow-orphan-record'),
    precheckBaseline: Object.prototype.hasOwnProperty.call(values, '--precheck-baseline')
      ? values['--precheck-baseline']
      : undefined,
    baselineStrategy: values['--baseline-strategy'],
    baselineScopePaths: values['--baseline-scope-paths'],
    baselineStashName: values['--baseline-stash-name'],
    show: values['--show'],
    taskSummary: values['--task-summary'],
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
    case 'orphan-prune':
      await cmdOrphanPrune(opts)
      return
    case 'sweep-siblings':
      await cmdSweepSiblings(positional[0])
      return
    case 'dev':
      await cmdDev(positional[0], opts)
      return
    default:
      console.error(
        'Usage: wt-helper <add|detect-main-dirty|list|prune|cleanup|merge-back|land-pending|rescue|orphan-prune|sweep-siblings|dev> [args]',
      )
      console.error('')
      console.error(
        "  dev [<alias>]             Start dev server on this worktree's allocated port",
      )
      console.error('')
      console.error(
        '  add <slug>                Create worktree at ~/offline/<consumer>-wt/<slug>/',
      )
      console.error('    --precheck-baseline [<change>]')
      console.error('                            Pre-fork dirty check on main; pairs with')
      console.error(
        '                            --baseline-strategy. Bare form = no change context.',
      )
      console.error('    --baseline-strategy commit|stash|warn')
      console.error(
        '                            commit: selective stage + commit baseline on main;',
      )
      console.error(
        '                            stash: leave main dirty + fork clean (default); carry',
      )
      console.error(
        '                            ALL main dirty into worktree only with --include-unrelated-dirty;',
      )
      console.error('                            warn: stop with report (default).')
      console.error(
        '    --baseline-scope-paths <comma>   Required for commit strategy; selective stage scope.',
      )
      console.error(
        '                            (Not supported by stash — use commit for scoped capture.)',
      )
      console.error(
        '    --include-unrelated-dirty        stash strategy only: bulk-capture ALL main dirty',
      )
      console.error(
        '                            into the worktree (off by default — fork forks clean).',
      )
      console.error(
        '    --baseline-stash-name <name>     Override default `wt-baseline/<slug>/<ISO>` stash name.',
      )
      console.error(
        '    --skip-prefork-audit             Silence the in-flight feature audit warning',
      )
      console.error('                            (default threshold: 50 tracked changes;')
      console.error('                            override via WT_PREFORK_AUDIT_THRESHOLD env var).')
      console.error("  detect-main-dirty         Report main's dirty paths; pairs with --json.")
      console.error('  list [--json]             Enumerate session worktrees with staleness')
      console.error('  prune                     Interactively remove merged session worktrees')
      console.error('  cleanup <slug>            Remove worktree (gated by --force +')
      console.error('                            --force-discard-unland; pre-checks both)')
      console.error('  merge-back <slug>         Atomic squash into main + cleanup; flags:')
      console.error('    --dry-run               preview blockers + worktree WIP without acting')
      console.error(
        '    --auto-stash            stash main blockers as wt-merge-block/<slug>/<ISO>',
      )
      console.error(
        '    --include-worktree-wip  auto-amend uncommitted worktree edits into branch HEAD',
      )
      console.error(
        '                            (default: refuse with remediation; explicit commit safer)',
      )
      console.error(
        '                            NB: dirty files matching OXFMT_AUTO_PATHS whose drift',
      )
      console.error(
        '                            reproduces from oxfmt(HEAD) are auto-committed as a',
      )
      console.error(
        '                            separate "🧹 chore: wt <slug> 自動落地 N 個純格式漂移檔" commit',
      )
      console.error(
        '                            with no prompt (no flag needed; semantic drift still STOPs).',
      )
      console.error('    --no-cleanup            skip worktree cleanup after squash')
      console.error(
        '    --noop-if-missing       silently no-op if no matching worktree (for hooks)',
      )
      console.error('    --skip-pre-sync         skip wt-side merge of origin/main before squash')
      console.error(
        '                            (default: pre-sync isolates conflicts in wt, not main)',
      )
      console.error('  land-pending <slug>       Alias of merge-back for grandfathered worktrees')
      console.error('  rescue [--show <ref|sha>] [--json]')
      console.error('                            List pre-fork baseline rescue candidates')
      console.error('                            (refs/wt-baseline/* pinned + fsck dangling).')
      console.error('                            --show prints full patch via stash show -p.')
      console.error('  orphan-prune [--force]    Find and remove orphaned dirs in <consumer>-wt/')
      console.error(
        '                            (leftover gitignored content after worktree removal)',
      )
      console.error(
        '  sweep-siblings <slug>     Remove stale fork-time change copies from sibling worktrees',
      )
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
  cmdOrphanPrune,
  cmdPrune,
  cmdRescue,
  cmdSweepSiblings,
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
  preserveWorktreeScreenshots,
  sessionWorktrees,
  setupBriefExclude,
  sweepSiblingChangeResidues,
  timestampPrefix,
}
// classifyUnmergedSafety is exported via `export function` at definition site.

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
