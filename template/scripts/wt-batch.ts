// 🔒 LOCKED — managed by clade · Source: vendor/scripts/wt-batch.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/wt-batch.ts
/** Durable worktree batches. Review is performed by /commit; this module verifies its receipt. */
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { ensureNoStaleIndexLock } from './_git-lock-detect.ts'
import { isRecord, parseJsonRecord, parseJsonWith } from './lib/json-unknown.ts'
import {
  evaluateUnattendedAdmission,
  parseUnattendedMergeAuthorization,
  parseUnattendedWorld,
  type UnattendedMergeAuthorization,
  type UnattendedWorld,
} from './wt-unattended-merge.ts'
import { runWtEnvBootstrap } from './lib/wt-env-bootstrap-runner.ts'
import {
  assertNoPublishInFlight,
  detectPublishInFlight,
  type ProcessProbe,
} from './lib/publish-in-flight.ts'
import { findClaimByWorktreeObserved, readActiveClaimsObserved } from './claim-helper.ts'
import { errorMessage } from './lib/safety-observation.ts'
import {
  captureAndVerify,
  gitExcludedRootsForArchive,
  gitWorktreeMetadataRoots,
  inventoryTree,
  inventoryArchive,
  inventoryOptionsFromProfile,
  liveEntryMatchesInventory,
  moduleChainFromAdminTail,
  readPreservationReceipt,
  readTeardownJournal,
  recordedModuleChain,
  validateProfile,
  verifyPreservationArchive,
  verifyPreservationArchiveIntegrity,
  withRestoredArchive,
  WT_TEARDOWN_JOURNAL_NAME,
  type ConsumerProfile,
  type InventoryEntry,
  type InventoryOptions,
  type PreservationReceipt,
  type SourceInventory,
} from './preservation-policy.ts'
import { preservationProfileFor } from './preservation-profiles.ts'

export interface BatchLifecycle {
  bootstrap: (main: string, path: string) => void
  /**
   * Tear down runtime state while exclusive ownership is held. Returns the
   * worktree-relative paths of every checkout `.git` the teardown detached
   * (renamed aside), so the caller can journal them: any later failure
   * restores exactly those names — never anything guessed by prefix.
   */
  destroy: (main: string, path: string) => string[] | void
  removed: (main: string, path: string) => void
  /**
   * Undo a completed or partial teardown detach when the worktree is
   * retained: `detached` is the list destroy returned (or the journaled
   * list on resume). Only explicitly recorded renames are undone.
   */
  restore?: (main: string, path: string, detached: string[]) => void
  /**
   * Run cleanup while an external system holds exclusive ownership of the source.
   * The adapter must stop every writer it can observe and hold that observation
   * through capture, quarantine, removal, and restoration. State that is
   * structurally unobservable to the adapter (kernel actors, or processes it
   * may not inspect) bounds the guarantee rather than voiding it; the adapter
   * must fail closed on any observable ambiguity and must not claim coverage
   * beyond its boundary.
   */
  withExclusiveWriterOwnership?: <T>(main: string, path: string, operation: () => T) => T
  /** Test/adapter hook immediately before the final move into quarantine. */
  beforeMove?: (main: string, path: string) => void
  afterHandoff?: (main: string, path: string) => void
  /**
   * Invoked inside the quarantine window, after inventory verification and
   * immediately before the destructive `worktree remove`. The path argument is
   * the quarantine path: occupants holding pre-rename handles still resolve
   * there, while new writers can no longer reach the tree by its source name.
   */
  beforeRemove?: (main: string, quarantine: string) => void
  /**
   * Invoked after a destructive remove completed and before the removal is
   * journaled. Throwing surfaces post-removal evidence — such as a writer's
   * surviving deleted handles — as a retain-for-inspection note while the
   * source stays unmarked as removed, so a later run completes the journal
   * instead of skipping it.
   */
  afterRemove?: (main: string, path: string, extraRoots?: string[]) => void
}
export type PreservationProfileResolver = (
  sourcePath: string,
  archiveRoot: string,
) => ConsumerProfile | undefined
const isolatedGitEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_AUTHOR_NAME: 'clade-batch',
  GIT_AUTHOR_EMAIL: 'clade-batch@localhost',
  GIT_COMMITTER_NAME: 'clade-batch',
  GIT_COMMITTER_EMAIL: 'clade-batch@localhost',
}
function consumerIdForRoot(root: string): string {
  const metaPath = join(root, '.claude', 'consumer-meta.json')
  if (existsSync(metaPath)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(metaPath, 'utf8'))
    } catch (error) {
      throw new Error(
        'Cannot resolve consumer identity from ' +
          metaPath +
          ': ' +
          (error instanceof Error ? error.message : String(error)),
        { cause: error },
      )
    }
    if (!isRecord(parsed) || typeof parsed.consumerId !== 'string' || !parsed.consumerId)
      throw new Error('Consumer identity is incomplete: ' + metaPath)
    return parsed.consumerId
  }
  const resolvedRoot = resolve(root)
  const leaf = basename(resolvedRoot)
  return leaf === 'template' ? basename(dirname(resolvedRoot)) : leaf
}
function profileResolverForRoot(root: string): PreservationProfileResolver {
  const consumerId = consumerIdForRoot(root)
  return (sourcePath, archiveRoot) => preservationProfileFor(consumerId, sourcePath, archiveRoot)
}
const defaultPreservationProfile: PreservationProfileResolver = (sourcePath, archiveRoot) =>
  preservationProfileFor(consumerIdForRoot(sourcePath), sourcePath, archiveRoot)
const defaultLifecycle: BatchLifecycle = {
  bootstrap: (_main, path) => {
    runWtEnvBootstrap(path, 'ensure')
  },
  destroy: (main, path) => {
    const result = runWtEnvBootstrap(path, 'destroy', { scriptRoot: main })
    if (result?.status === 'orphan-recorded')
      throw new Error('Backing resources remain; retain worktree')
  },
  removed: () => {},
}
export type BatchTrigger = 'auto' | 'manual' | 'dependency' | 'drained' | 'stop'
export interface ReadySource {
  path: string
  branch: string
  head: string
  workId: string
  evidence: string
  evidenceHash: string
  authorized: true
  released: true
  retain?: string
}
export interface MergeReceipt {
  repository: string
  pr: number
  base: 'main'
  merge_method: 'squash'
  merged: true
  source_head: string
  reviewed_base: string
  candidate_tree: string
  merge_sha: string
  content_patch_id: string
}
export interface RemotePrState {
  repository: string
  pr: number
  merged: boolean
  mergeSha: string
  base: string
  headSha: string
  headRef: string
}
export type RemotePrProbe = (query: { repository: string; pr: number }) => RemotePrState
export interface CheckpointReceipt {
  workId: string
  source: string
  branch: string
  head: string
  author: string
  scope: string[]
  at: string
}
export type DraftPrReceipt = {
  workId: string
  source: string
  branch: string
  head: string
  pr: number
  at: string
} & ({ kind: 'visibility' } | { kind: 'discussion'; discussant: string; question: string })
export interface MergeAttemptJournal {
  operationId: string
  expectedHead: string
  expectedBase: string
  stage: 'admitting' | 'ready' | 'merging' | 'confirming' | 'completed' | 'failed'
  remote?: { merged: boolean; mergeSha?: string; error?: string }
}
export interface StagingReceipt {
  workflowFile: string
  mergeSha: string
  runId: number
  runAttempt: number
  conclusion: 'success' | 'failure' | 'cancelled' | 'timed_out' | 'pending'
}
export interface BlockedSource {
  workId: string
  path: string
  reason: string
  resumeEvent: string
}
export interface ReleaseWindowRecord {
  owner: string
  repository: string
  releaseSha: string
  productionRunId: number | null
  status: 'active' | 'unknown' | 'closed'
}
export interface BatchDraftBinding {
  workId: string
  pr: number
  headBranch: string
}
export interface WorktreeBatch {
  id: string
  base: string
  main: string
  path: string
  branch: string
  workflow: 'trunk-based' | 'pr-merge-based'
  members: ReadySource[]
  draftBindings: BatchDraftBinding[]
  cursor: number
  phase: 'integrating' | 'review' | 'sealed' | 'landed' | 'cleaned' | 'cancelled'
  bootstrapped?: boolean
  pending?: { before: string; tree?: string }
  refresh?: { base: string; before: string; tree?: string }
  origin_advanced_during_review?: number
  seal?: {
    head?: string
    tree: string
    evidence: string
    hash: string
    artifacts: { path: string; hash: string }[]
  }
  cancellationReason?: string
  landedHead?: string
  mergeReceipt?: MergeReceipt
  unattendedAuthorization?: UnattendedMergeAuthorization
  mergeAttempt?: MergeAttemptJournal
  stagingReceipt?: StagingReceipt
  waiting?: { reason: string; owner: string; carrier: string; resumeEvent: string }
  removed: string[]
  preserved?: { path: string; archive: string }[]
  removing?: {
    path: string
    quarantine: string
    trash?: string
    removalConcern?: string
    // Post-teardown baselines: runtime destroy legitimately mutates the
    // tree (submodule deinit unlinks working files, env teardown drops
    // state), so the quarantine verify compares against the state captured
    // after destroy — journaled so an interrupted removal resumes against
    // the same baseline. Absent on legacy journals: fall back to the
    // pre-teardown archive inventory.
    verifyInventory?: SourceInventory
    verifyGit?: SourceInventory
    // Worktree-relative `.git.clade-detached*` paths this teardown renamed
    // aside — the exact restore list, so rollback never renames a
    // pre-existing file that merely shares the prefix.
    detachedPointers?: string[]
  }
}
interface State {
  version: 1
  ready: ReadySource[]
  batches: WorktreeBatch[]
  blockedSources?: BlockedSource[]
  releaseWindows?: ReleaseWindowRecord[]
}
interface Context {
  cwd: string
  main: string
  dir: string
  common: string
}
const triggers = new Set(['auto', 'manual', 'dependency', 'drained', 'stop'])
/** Trunk auto-batches for shared quality cost. PR workflow lands one independently
 *  acceptable purpose at a time; ready backlog of 3 is a delivery-priority signal. */
const TRUNK_AUTO_TRIGGER_WORK_IDS = 4
const PR_AUTO_TRIGGER_WORK_IDS = 1
const MAX_ACTIVE_IMPLEMENTATIONS = 3
function autoThreshold(workflow: WorktreeBatch['workflow']): number {
  return workflow === 'trunk-based' ? TRUNK_AUTO_TRIGGER_WORK_IDS : PR_AUTO_TRIGGER_WORK_IDS
}
function triggerReached(
  trigger: BatchTrigger,
  ready: ReadySource[],
  workflow: WorktreeBatch['workflow'] = 'pr-merge-based',
): boolean {
  const distinct = new Set(ready.map((m) => m.workId)).size
  return distinct > 0 && (trigger !== 'auto' || distinct >= autoThreshold(workflow))
}
/** PR workflow lands one independently acceptable purpose unless grouping is explicit. */
function selectPrMembers(members: ReadySource[], groupWorkIds?: string[]): ReadySource[] {
  if (members.length === 0) return members
  if (groupWorkIds && groupWorkIds.length > 0) {
    const allowed = new Set(groupWorkIds)
    const selected = members.filter((m) => allowed.has(m.workId))
    const missing = [...new Set(groupWorkIds)].filter(
      (id) => !selected.some((m) => m.workId === id),
    )
    if (missing.length) throw new Error(`Grouped work ids are not eligible: ${missing.join(', ')}`)
    return selected
  }
  const first = members[0]!.workId
  return members.filter((m) => m.workId === first)
}
const git = (cwd: string, args: string[], input?: string) =>
  execFileSync('git', args, {
    cwd,
    input,
    encoding: 'utf8',
    env: isolatedGitEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
/**
 * `git` without the trailing `.trim()`. `-z` output MUST keep a leading blank in its first
 * path: a filename that legitimately starts with a space is otherwise handed on in a
 * spelling that names no file, which is the same failure `-z` was adopted to prevent.
 */
const hashBuffer = Buffer.allocUnsafe(8 * 1024 * 1024)
// Streams so multi-GB retire archives hash without loading into memory.
const hashFile = (path: string) => {
  const hash = createHash('sha256'),
    fd = openSync(path, 'r')
  try {
    for (let read = readSync(fd, hashBuffer); read > 0; read = readSync(fd, hashBuffer))
      hash.update(hashBuffer.subarray(0, read))
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}
const fullRef = (branch: string) => (branch.startsWith('refs/') ? branch : `refs/heads/${branch}`)
const objectIdPattern = /^[0-9a-f]{40}$/i
function patchId(cwd: string, from: string, to: string) {
  const directory = mkdtempSync(join(tmpdir(), 'clade-batch-patch-'))
  const diffPath = join(directory, 'diff')
  const fd = openSync(diffPath, 'wx', 0o600)
  try {
    execFileSync('git', ['diff', '--binary', '--no-ext-diff', from, to], {
      cwd,
      env: isolatedGitEnv,
      stdio: ['ignore', fd, 'pipe'],
    })
    const output = execFileSync('git', ['patch-id', '--stable'], {
      cwd,
      input: readFileSync(diffPath),
      encoding: 'utf8',
      env: isolatedGitEnv,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .trim()
      .split(/\s+/)
    if (!output[0]) throw new Error(`Unable to calculate content patch for ${from}..${to}`)
    return output[0]
  } finally {
    closeSync(fd)
    rmSync(directory, { recursive: true, force: true })
  }
}
function gitFileList(cwd: string, args: string[]): string[] {
  // Dependency trees can exceed execFileSync's pipe buffer; retain the complete list.
  const directory = mkdtempSync(join(tmpdir(), 'clade-batch-paths-'))
  const output = join(directory, 'paths')
  const fd = openSync(output, 'wx', 0o600)
  try {
    execFileSync('git', ['ls-files', ...args, '-z'], {
      cwd,
      env: isolatedGitEnv,
      stdio: ['ignore', fd, 'pipe'],
    })
    return readFileSync(output, 'utf8').split('\0').filter(Boolean)
  } finally {
    closeSync(fd)
    rmSync(directory, { recursive: true, force: true })
  }
}
function context(cwd: string): Context {
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const main = worktrees(cwd)[0]?.path
  if (!main) throw new Error('A main working tree is required')
  return { cwd, main, dir: join(common, 'clade-wt-batch'), common }
}
function worktrees(cwd: string) {
  return git(cwd, ['worktree', 'list', '--porcelain'])
    .split('\n\n')
    .map((block) => {
      const lines = block.split('\n')
      return {
        path: lines.find((l) => l.startsWith('worktree '))?.slice(9) ?? '',
        branch: lines.find((l) => l.startsWith('branch '))?.slice(7) ?? '',
        locked: lines.some((l) => l === 'locked' || l.startsWith('locked ')),
      }
    })
}
// A path is this run's worktree only while the worktree registry agrees:
// branch uniquely identifies a checked-out worktree (git enforces a
// single checkout per branch), so the registry itself answers where the
// tree currently sits — including a move-back that nested inside a
// foreign path instead of failing. A foreign recreation squatting on a
// journaled name can never impersonate a different branch's checkout and
// must never receive a restore of detached pointers.
function registeredWorktreePath(c: Context, branch: string): string | undefined {
  if (!branch) return undefined
  try {
    const path = worktrees(c.main).find((wt) => wt.branch === branch)?.path
    if (!path || !existsSync(path)) return undefined
    // The registry answers from admin-dir metadata — a foreign directory
    // (or foreign worktree) can physically occupy the recorded name. The
    // checkout is ours only while its `.git` resolves to an admin dir
    // that claims this path back (gitdir file) *and* still checks out
    // this branch (admin HEAD); anything else is a squatter that must
    // never receive a restore of detached pointers.
    const pointer = readFileSync(join(path, '.git'), 'utf8').trim()
    const target = /^gitdir: (.+)$/.exec(pointer)?.[1]
    if (!target) return undefined
    const admin = resolve(path, target)
    // Reciprocal pointers and a matching branch are still forgeable: a
    // foreign repository's linked worktree squatting on a stale registered
    // name satisfies all three while its admin dir lives under another
    // repo's common dir. The checkout is ours only when its admin dir is a
    // direct child of THIS repo's worktrees/ root — that membership is what
    // the registry row actually certifies.
    if (dirname(realpathSync(admin)) !== realpathSync(join(c.common, 'worktrees'))) return undefined
    if (
      realpathSync(readFileSync(join(admin, 'gitdir'), 'utf8').trim()) !==
      realpathSync(join(path, '.git'))
    )
      return undefined
    const ref = fullRef(branch)
    if (readFileSync(join(admin, 'HEAD'), 'utf8').trim() !== `ref: ${ref}`) return undefined
    return path
  } catch {
    // An unreadable registry or `.git` chain leaves ownership unproven —
    // skip the restore rather than rename into a path we cannot show is
    // ours.
    return undefined
  }
}
// True while something still owns this tree — a lock, an active claim on
// the path or branch, or a claim store that cannot be read. Journal
// replays only ever redo our own recorded renames, but inside another
// owner's tree they are still writes that must not land — every restore
// site gates on this before touching a retained worktree.
function worktreeOwned(c: Context, path: string, branch: string): boolean {
  const short = branch.replace('refs/heads/', '')
  try {
    if (worktrees(c.main).some((w) => w.path === path && w.locked)) return true
    const claimObs = findClaimByWorktreeObserved(c.main, path)
    const claimsObs = readActiveClaimsObserved(c.main)
    if (claimObs.status !== 'known' || claimsObs.status !== 'known') return true
    if (claimObs.value !== null) return true
    return claimsObs.value.some(
      (cl) => cl.worktree_path === path || cl.branch === branch || cl.branch === short,
    )
  } catch {
    return true
  }
}
// A restore replays only journal-recorded renames, but it still writes —
// it lands only inside an exclusive-writer probe on the target tree (so an
// unclaimed live writer is observed before and after) and only while
// `worktreeOwned` shows nothing owning it. Best-effort everywhere it is
// used: a failed or skipped restore leaves the retained tree's journal for
// the next pass.
function restoreOwned(
  c: Context,
  lifecycle: BatchLifecycle,
  tree: string | undefined,
  branch: string,
  detached: string[],
) {
  if (!tree || worktreeOwned(c, tree, branch)) return
  try {
    withExclusiveWriterOwnership(lifecycle, c.main, tree, () => {
      // The pre-check races a claim acquired while the adapter set up —
      // recheck inside the ownership scope so a fresh owner never
      // receives replay writes.
      if (worktreeOwned(c, tree, branch)) return
      lifecycle.restore?.(c.main, tree, detached)
    })
  } catch {
    // A probe that finds a live writer or a missing ownership adapter
    // skips the replay — the retained tree stays half-detached and is
    // retried on a later pass.
  }
}
function isState(value: unknown): value is State {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Partial<State>
  return state.version === 1 && Array.isArray(state.ready) && Array.isArray(state.batches)
}
function readState(c: Context): State {
  const file = join(c.dir, 'state.json')
  if (!existsSync(file)) return { version: 1, ready: [], batches: [] }
  return parseJsonWith(
    readFileSync(file, 'utf8'),
    isState,
    'Invalid batch state; preserve it for recovery',
  )
}
function syncFile(path: string): void {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
function lstatPresent(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}
function syncDirectory(path: string): void {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
function syncDirectoryAndParents(path: string): void {
  let current = resolve(path)
  while (true) {
    syncDirectory(current)
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}
function ensureStateDirectory(c: Context): void {
  mkdirSync(c.dir, { recursive: true })
  syncDirectoryAndParents(c.dir)
}
function asDetachedList(result: string[] | void): string[] {
  return Array.isArray(result) ? result : []
}
/** Exclusive temp write, fsync, rename, then fsync the directory chain. */
function writeJsonDurable(dir: string, name: string, value: unknown) {
  const file = join(dir, `${name}-${randomUUID()}.tmp`)
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
  syncFile(file)
  renameSync(file, join(dir, name))
  syncDirectoryAndParents(dir)
}
function save(c: Context, s: State) {
  writeJsonDurable(c.dir, 'state.json', s)
}
function isLiveBatch(b: WorktreeBatch): boolean {
  return !['landed', 'cleaned', 'cancelled'].includes(b.phase)
}
function processStart(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
function serialized<T>(c: Context, fn: () => T): T {
  ensureStateDirectory(c)
  const fd = openSync(join(c.dir, 'operation.guard'), 'a')
  try {
    // The inherited descriptor shares its open-file description with this process.
    // flock survives the short child, and the kernel releases it when this fd closes.
    try {
      execFileSync('flock', ['--exclusive', '--nonblock', '3'], {
        stdio: ['ignore', 'ignore', 'pipe', fd],
      })
    } catch {
      throw new Error('Batch operation locked or flock unavailable; preserve state and retry')
    }
    return fn()
  } finally {
    closeSync(fd)
  }
}
function mutate<T>(c: Context, fn: (s: State) => T): T {
  ensureStateDirectory(c)
  const lock = join(c.dir, 'operation.lock'),
    recovery = join(c.dir, 'recovery.lock')
  if (existsSync(recovery))
    throw new Error('Batch lock recovery in progress; retry after recovery completes')
  try {
    writeFileSync(
      lock,
      JSON.stringify({
        pid: process.pid,
        host: hostname(),
        start: processStart(process.pid),
        cwd: c.cwd,
      }),
      { flag: 'wx' },
    )
  } catch {
    throw new Error(
      `Batch operation locked: ${lock}; run batch recover-lock after its process exits`,
    )
  }
  try {
    // A recovery which started between the first check and acquisition owns this handshake.
    if (existsSync(recovery))
      throw new Error('Batch lock recovery in progress; retry after recovery completes')
    return fn(readState(c))
  } finally {
    rmSync(lock)
  }
}
export function recoverBatchLock(cwd: string) {
  const c = context(cwd)
  // Recovery uses flock only on hosts with /proc birth identities. Ordinary commands are portable.
  if (!processStart(process.pid))
    throw new Error('Reliable lock recovery unavailable on this host; preserve lock for inspection')
  return serialized(c, () => {
    const lock = join(c.dir, 'operation.lock'),
      recovery = join(c.dir, 'recovery.lock')
    writeFileSync(
      recovery,
      JSON.stringify({ pid: process.pid, host: hostname(), start: processStart(process.pid) }),
    )
    try {
      if (!existsSync(lock)) return { recovered: false }
      const owner = parseJsonRecord(readFileSync(lock, 'utf8'), lock)
      if (
        owner.host !== hostname() ||
        typeof owner.pid !== 'number' ||
        !Number.isSafeInteger(owner.pid) ||
        owner.pid <= 0 ||
        typeof owner.start !== 'string'
      )
        throw new Error('Unknown operation holder; preserve lock for inspection')
      if (processStart(owner.pid) === owner.start)
        throw new Error('Operation holder is still alive')
      rmSync(lock)
      return { recovered: true, owner, next: 'batch status, then resume the interrupted operation' }
    } finally {
      rmSync(recovery)
    }
  })
}
function clearStaleIndexLock(root: string) {
  const status = ensureNoStaleIndexLock(root)
  if (status.cleaned) console.error(`batch: removed stale .git/index.lock in ${root}`)
}
function head(cwd: string) {
  return git(cwd, ['rev-parse', 'HEAD'])
}
function fetchOriginMain(c: Context): string {
  try {
    git(c.main, ['fetch', 'origin', 'main'])
    return git(c.main, ['rev-parse', 'refs/remotes/origin/main'])
  } catch (error) {
    throw new Error(
      `Unable to fetch origin/main; refusing to use local main as PR base: ${errorMessage(error)}`,
      { cause: error },
    )
  }
}
function batchBase(c: Context, b: Pick<WorktreeBatch, 'workflow'>): string {
  return b.workflow === 'pr-merge-based' ? fetchOriginMain(c) : head(c.main)
}
function recordOriginAdvance(b: WorktreeBatch): void {
  b.origin_advanced_during_review = (b.origin_advanced_during_review ?? 0) + 1
}
function assertBatchBase(c: Context, b: WorktreeBatch): string {
  const current = batchBase(c, b)
  if (current !== b.base) {
    if (b.workflow === 'pr-merge-based') recordOriginAdvance(b)
    throw new Error('Main advanced: refresh the batch before restarting review')
  }
  return current
}
function localMainOnlyCommits(c: Context): string[] {
  const origin = fetchOriginMain(c)
  return git(c.main, ['rev-list', 'refs/heads/main', `^${origin}`])
    .split('\n')
    .filter(Boolean)
}
function rejectMembersCarryingLocalMainCommits(c: Context, members: ReadySource[]): void {
  const localOnly = new Set(localMainOnlyCommits(c))
  if (localOnly.size === 0) return
  const carried = new Map<string, string[]>()
  for (const member of members) {
    const commits = git(member.path, ['rev-list', member.head]).split('\n').filter(Boolean)
    const unexpected = commits.filter((commit) => localOnly.has(commit))
    if (unexpected.length > 0) carried.set(member.path, unexpected)
  }
  if (carried.size > 0) {
    const details = [...carried.entries()]
      .map(([path, commits]) => `${path}: ${commits.join(', ')}`)
      .join('; ')
    throw new Error(`Member carries commits that exist only on local main: ${details}`)
  }
}
function preserveWorktree(
  c: Context,
  b: WorktreeBatch,
  path: string,
  profile: ConsumerProfile,
  record = true,
) {
  const receipt = captureAndVerify({
    sourceRoot: path,
    archiveRoot: join(c.dir, 'preservation'),
    profile,
    generation: `${b.id}-${createHash('sha256').update(path).digest('hex').slice(0, 16)}`,
    consistencyBoundary: 'source-stable-after-landing-before-teardown',
  })
  if (record) {
    b.preserved = [...(b.preserved ?? []), { path, archive: receipt.archives.worktree.path }]
  }
  return receipt
}
// An unreadable or non-file archive entry fails verification instead of aborting cleanup.
const hashMatches = (path: string, digest: string) => {
  try {
    return hashFile(path) === digest
  } catch {
    return false
  }
}
// handoff-retire archives and removes a released landed-batch source on its own
// path, and its manifest row is the only trace that survives. Accept that row as
// preservation only when it names this exact source and every archived file
// still hashes to what retire recorded.
function retiredByHandoff(c: Context, path: string, branch: string, sourceHead: string) {
  const manifest = join(c.main, 'docs', 'archives', 'retired-work.jsonl')
  if (!existsSync(manifest)) return undefined
  const ref = fullRef(branch)
  for (const line of readFileSync(manifest, 'utf8').split('\n').toReversed()) {
    let row: Record<string, unknown>
    try {
      row = parseJsonRecord(line)
    } catch {
      continue
    }
    const original = row.original,
      archive = row.archive,
      files = row.files
    if (
      row.schema !== 'retired-work/v1' ||
      row.status !== 'retired' ||
      !isRecord(original) ||
      original.kind !== 'worktree' ||
      original.path !== path ||
      original.branch !== ref ||
      original.head !== sourceHead ||
      typeof archive !== 'string' ||
      !isRecord(files) ||
      typeof files['history.bundle'] !== 'string'
    )
      continue
    const verified = Object.entries(files).every(
      ([name, digest]) =>
        typeof digest === 'string' &&
        basename(name) === name &&
        existsSync(join(archive, name)) &&
        hashMatches(join(archive, name), digest),
    )
    if (verified) return archive
  }
  return undefined
}
function hasVerifiedPreservation(
  b: WorktreeBatch,
  path: string,
  profile: ConsumerProfile,
): boolean {
  try {
    validateProfile(profile)
  } catch {
    return false
  }
  const archive = b.preserved?.findLast((entry) => entry.path === path)?.archive
  if (!archive) return false
  return verifyPreservationArchive(archive, path, inventoryOptionsFromProfile(profile))
}
function comparableInventory(inventory: Pick<SourceInventory, 'entries'>): string {
  return JSON.stringify(
    inventory.entries
      .filter((entry) => entry.path !== '.git')
      .map((entry) => {
        const normalized = { ...entry }
        // `git worktree move` rewrites the linked-worktree .git pointer and
        // directory mtimes. Those are topology changes, not user bytes.
        delete (normalized as Partial<typeof normalized>).allocatedBytes
        delete (normalized as Partial<typeof normalized>).uid
        delete (normalized as Partial<typeof normalized>).gid
        if (normalized.type === 'directory') delete normalized.mtimeMs
        return normalized
      }),
  )
}

// A journaled resume may see a third legitimate state beyond baseline and
// byte-restored: a rollback reconcile rewrote submodule `.git` pointers
// for the current depth and each module repo's `core.worktree` for the
// current location. The comparison below accepts that state only when
// every divergence from the archive is one of those rewrites — identity
// fields (path, type, mode, acl/xattr digests, symlink target) still
// compare, so a divergence that is not a relocation rewrite retains.
// Only content fields (digest, size, mtime — a rewritten pointer lands
// as a new file) are what `allow` adjudicates.
function entriesMatchModulo(
  live: SourceInventory,
  expected: SourceInventory,
  allow: (path: string, live: InventoryEntry, expected: InventoryEntry) => boolean,
): boolean {
  const liveBy = new Map(
    live.entries.filter((entry) => entry.path !== '.git').map((entry) => [entry.path, entry]),
  )
  const wantBy = new Map(
    expected.entries.filter((entry) => entry.path !== '.git').map((entry) => [entry.path, entry]),
  )
  if (liveBy.size !== wantBy.size) return false
  const normalized = (entry: InventoryEntry) => {
    const copy = { ...entry }
    delete (copy as Partial<typeof copy>).allocatedBytes
    delete (copy as Partial<typeof copy>).uid
    delete (copy as Partial<typeof copy>).gid
    if (copy.type === 'directory') delete copy.mtimeMs
    return JSON.stringify(copy)
  }
  // A relocation rewrite is allowed to change only content-derived fields
  // (a rewritten pointer/config lands as a new file: size, mtime, digest).
  // Every other field — identity, mode, acl/xattr digests, symlink target
  // — must still compare equal; `allow` adjudicates the content, it is not
  // a license to discard unrelated metadata drift.
  const normalizedMeta = (entry: InventoryEntry) => {
    const copy = { ...entry }
    delete (copy as Partial<typeof copy>).allocatedBytes
    delete (copy as Partial<typeof copy>).uid
    delete (copy as Partial<typeof copy>).gid
    delete (copy as Partial<typeof copy>).size
    delete (copy as Partial<typeof copy>).mtimeMs
    delete (copy as Partial<typeof copy>).digest
    return JSON.stringify(copy)
  }
  for (const [path, want] of wantBy) {
    const got = liveBy.get(path)
    if (!got) return false
    if (normalized(got) === normalized(want)) continue
    if (normalizedMeta(got) !== normalizedMeta(want) || !allow(path, got, want)) return false
  }
  return true
}

// A journaled resume partitions each side into detached-baseline vs
// restored — and "restored" is either archive-identical or
// reconcile-rewritten, since a same-depth restore can legitimately mix
// them (identical pointer text, rewritten configs). Each side's flags are
// a SET, not a single label: a side teardown never touched satisfies
// baseline and archive at once. The sides must share a phase — baseline
// with baseline, or restored with restored; any cross is a partial
// restore and retains.
export function resumeStatesCompatible(
  tree: { baseline: boolean; restored: boolean },
  metadata: { baseline: boolean; restored: boolean },
): boolean {
  return (tree.baseline && metadata.baseline) || (tree.restored && metadata.restored)
}

const gitdirPointer = (file: string): string | undefined => {
  try {
    const st = lstatSync(file)
    if (!st.isFile() || st.isSymbolicLink()) return undefined
    return (
      readFileSync(file, 'utf8')
        .match(/^gitdir:\s*(.+)$/m)?.[1]
        ?.trim() || undefined
    )
  } catch {
    return undefined
  }
}

// Tree side: the only tolerable divergence is a `.git` pointer file whose
// live `gitdir:` still resolves to the module chain the archive recorded
// for that checkout — a rebase to the current depth, nothing else.
export function treeInventoryMatchesRelocated(
  archive: string,
  live: SourceInventory,
  liveRoot: string,
  adminId: string,
  modulesName: string,
  options: InventoryOptions,
): boolean {
  try {
    return withRestoredArchive(archive, (restored) => {
      const expected = inventoryTree(restored, options)
      return entriesMatchModulo(live, expected, (path, liveEntry, wantEntry) => {
        if (basename(path) !== '.git' || liveEntry.type !== 'file' || wantEntry.type !== 'file')
          return false
        const liveGitdir = gitdirPointer(join(liveRoot, path))
        const wantGitdir = gitdirPointer(join(restored, path))
        if (!liveGitdir || !wantGitdir) return false
        const liveChain = recordedModuleChain(
          liveGitdir,
          dirname(join(liveRoot, path)),
          adminId,
          modulesName,
        )
        if (!liveChain || liveChain !== moduleChainFromAdminTail(wantGitdir, adminId)) return false
        // The chains are text — the live pointer must also RESOLVE to this
        // worktree's module repository, or a foreign repo sharing the same
        // admin-tail suffix would pass on text alone.
        try {
          return (
            realpathSync(resolve(dirname(join(liveRoot, path)), liveGitdir)) ===
            realpathSync(join(modulesName, liveChain))
          )
        } catch {
          return false
        }
      })
    })
  } catch {
    return false
  }
}

// Git side: the only tolerable divergence is a module repo `config` whose
// content differs solely in `core.worktree`, rewritten to name the same
// in-tree checkout the archived config named — `sourcePath`/`sourceCommon`
// (the receipt's recorded tree root and common dir) turn the archived
// value into a location-independent in-tree path, so a config redirected
// at a different submodule cannot pass as a relocation.
export function gitInventoryMatchesRelocated(
  archive: string,
  live: SourceInventory,
  liveRoot: string,
  treeRoot: string,
  sourcePath: string,
  sourceCommon: string,
  options: InventoryOptions,
  excludedPaths: string[],
): boolean {
  const configLines = (file: string, drop: string): string[] => {
    try {
      // Order is significant: a duplicated key's last value wins, so the
      // comparison must see the entries in file order, never sorted.
      return execFileSync('git', ['config', '--file', file, '--list'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .split('\n')
        .filter((line) => line && !line.startsWith(`${drop}=`))
    } catch {
      return []
    }
  }
  try {
    const root = realpathSync(treeRoot)
    return withRestoredArchive(archive, (restored) => {
      const expected = inventoryTree(
        restored,
        options,
        excludedPaths.map((path) => join(restored, path)),
      )
      return entriesMatchModulo(live, expected, (path) => {
        if (
          basename(path) !== 'config' ||
          !/(?:^|\/)modules\//.test(path) ||
          !existsSync(join(liveRoot, path)) ||
          !existsSync(join(restored, path))
        )
          return false
        const liveFile = join(liveRoot, path)
        const wantFile = join(restored, path)
        const liveLines = configLines(liveFile, 'core.worktree')
        const wantLines = configLines(wantFile, 'core.worktree')
        if (!liveLines.length || liveLines.join('\n') !== wantLines.join('\n')) return false
        const worktree = execFileSync(
          'git',
          ['config', '--file', liveFile, '--get', 'core.worktree'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim()
        const wantWorktree = execFileSync(
          'git',
          ['config', '--file', wantFile, '--get', 'core.worktree'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim()
        if (!worktree || !wantWorktree) return false
        // The archived value resolves from its ORIGINAL module-dir
        // position under the recorded common dir — that minus the recorded
        // source root is the location-independent in-tree checkout path.
        // The live value must resolve to exactly that checkout under the
        // current tree root, not merely anywhere inside it.
        const inTree = relative(
          sourcePath,
          resolve(join(sourceCommon, dirname(path)), wantWorktree),
        )
        if (!inTree || inTree.startsWith('..') || isAbsolute(inTree)) return false
        return (
          realpathSync(resolve(dirname(liveFile), worktree)) === realpathSync(join(root, inTree))
        )
      })
    })
  } catch {
    return false
  }
}

function verifyQuarantineInventory(
  quarantine: string,
  expected: SourceInventory,
  profile: ConsumerProfile,
): void {
  const options = inventoryOptionsFromProfile(profile)
  const current = inventoryTree(quarantine, options, [join(quarantine, '.git')])
  if (current.specialFiles.length)
    throw new Error('quarantine contains unsupported or external data; retain worktree')
  if (current.externalSymlinks.length && !options.allowExternalSymlinks)
    throw new Error('quarantine contains unsupported or external data; retain worktree')
  if (comparableInventory(current) !== comparableInventory(expected))
    throw new Error(
      'source changed during teardown; quarantine changed after final preservation verification; retain worktree',
    )
}

// The live common-dir inventory with the same exclusions the quarantine
// verify applies: other worktrees' metadata, cleanup trash, the archive
// root, and each of this worktree's own `gitdir` relocation pointers
// (`worktree move` must rewrite them). Captured post-teardown it becomes
// the baseline a quarantine verify compares against — deinit's config
// rewrite is part of that baseline, not drift.
function liveGitInventory(
  sourcePath: string,
  common: string,
  archiveRoot: string,
  profile: ConsumerProfile,
): SourceInventory {
  return inventoryTree(common, inventoryOptionsFromProfile(profile), [
    ...gitExcludedRootsForArchive(sourcePath, common, archiveRoot),
    ...gitWorktreeMetadataRoots(sourcePath, common)
      .flatMap((root) => [join(root, 'gitdir'), join(root, WT_TEARDOWN_JOURNAL_NAME)])
      // Exclusions are realpathed — a teardown journal only exists after a
      // detach ran, so absent names must not reach the walk.
      .filter((excluded) => existsSync(excluded)),
  ])
}

// Archive-side comparisons must exclude the same operational names the
// live walk does — `gitdir` is rewritten by moves, and the teardown
// journal appears and disappears with detach/restore cycles, so an
// archive captured while a journal exists must still match the restored
// live state.
function gitArchiveExclusions(roots: string[], common: string): string[] {
  return roots.flatMap((root) => [
    relative(common, join(root, 'gitdir')),
    relative(common, join(root, WT_TEARDOWN_JOURNAL_NAME)),
  ])
}

// Post-teardown verification baselines, captured while exclusive ownership
// is still held: runtime destroy legitimately deletes inventory-listed
// bytes (deinit empties submodule dirs, env teardown drops state), so the
// baseline is the tree as destroy left it. A write landing during teardown
// is adopted into the baseline — preserved in trash rather than flagged —
// while anything after capture still fails the quarantine verify.
function captureVerifyBaseline(
  sourcePath: string,
  receipt: PreservationReceipt,
  profile: ConsumerProfile,
): { worktree: SourceInventory; git?: SourceInventory } {
  const baseline: { worktree: SourceInventory; git?: SourceInventory } = {
    worktree: inventoryTree(sourcePath, inventoryOptionsFromProfile(profile)),
  }
  if (receipt.source.gitCommonDir) {
    const common = git(sourcePath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    baseline.git = liveGitInventory(
      sourcePath,
      common,
      dirname(dirname(receipt.archives.worktree.path)),
      profile,
    )
  }
  return baseline
}

// The trashed metadata root gets the same post-rename verification the tree
// does: a late write missed by the watches and the handle scan (queue
// overflow, an external hard-link alias created on an unwatched inode)
// still surfaces as a journaled concern instead of a clean removal. The
// baseline's `worktrees/<id>/` subtree is compared against the trash
// contents with the same `gitdir` exclusion the live walk applies.
function verifyTrashedMetadataInventory(
  trashPath: string,
  metadataRoot: string,
  common: string,
  expectedGit: SourceInventory,
  profile: ConsumerProfile,
): void {
  const rel = relative(common, metadataRoot)
  const prefix = `${rel}/`
  const canonicalByPath = new Map(
    expectedGit.entries.filter((entry) => entry.digest).map((entry) => [entry.path, entry]),
  )
  // Hardlink targets are inventory-relative canonical paths and rebase
  // alongside `path`. A canonical inside the subtree keeps its link. When
  // the canonical entry lives outside the moved subtree, the trashed walk
  // promotes the first in-subtree alias to a plain file and records every
  // later alias as a hardlink pointing at that first name — the walk is
  // deterministic (sorted DFS) and the expected list preserves the same
  // order, so group by the original target and mirror that promotion.
  const firstAliasByTarget = new Map<string, string>()
  const expected = expectedGit.entries
    .filter((entry) => entry.path === rel || entry.path.startsWith(prefix))
    .map((entry) => {
      const rebased = { ...entry, path: entry.path === rel ? '' : entry.path.slice(prefix.length) }
      if (entry.type !== 'hardlink' || !entry.target) return rebased
      if (entry.target.startsWith(prefix))
        return { ...rebased, target: entry.target.slice(prefix.length) }
      const firstAlias = firstAliasByTarget.get(entry.target)
      if (firstAlias !== undefined) return { ...rebased, target: firstAlias }
      const canonical = canonicalByPath.get(entry.target)
      delete rebased.target
      rebased.type = 'file'
      rebased.digest = canonical?.digest
      firstAliasByTarget.set(entry.target, rebased.path)
      return rebased
    })
  const actual = inventoryTree(
    trashPath,
    inventoryOptionsFromProfile(profile),
    [
      join(trashPath, 'gitdir'),
      join(trashPath, WT_TEARDOWN_JOURNAL_NAME),
      // Exclusion paths are realpathed — the journal only exists when a
      // detach ran inside this metadata root.
    ].filter((excluded) => existsSync(excluded)),
  )
  if (actual.specialFiles.length || actual.externalSymlinks.length)
    throw new Error('trashed Git metadata contains unsupported or external data')
  if (comparableInventory(actual) !== comparableInventory({ entries: expected }))
    throw new Error('trashed Git metadata changed during removal')
}

function verifyQuarantineGitInventory(
  quarantine: string,
  receipt: PreservationReceipt,
  profile: ConsumerProfile,
  baseline?: SourceInventory,
): void {
  if (!receipt.source.gitCommonDir || !receipt.inventory.git || !receipt.archives.git)
    throw new Error('preservation receipt has no complete Git inventory; retain worktree')
  const metadataOptions = inventoryOptionsFromProfile(profile)
  const currentCommon = git(quarantine, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (currentCommon !== receipt.source.gitCommonDir)
    throw new Error('quarantine Git common directory changed; retain worktree')
  if (git(quarantine, ['rev-parse', 'HEAD']) !== receipt.source.head)
    throw new Error('quarantine Git HEAD changed; retain worktree')
  const archiveRoot = dirname(dirname(receipt.archives.worktree.path))
  const currentMetadataRoots = gitWorktreeMetadataRoots(quarantine, currentCommon)
  if (currentMetadataRoots.length !== 1)
    throw new Error('quarantine linked-worktree metadata is incomplete; retain worktree')
  const currentGit = liveGitInventory(quarantine, currentCommon, archiveRoot, profile)
  // The baseline is the post-teardown live inventory when the caller
  // journaled one; legacy journals fall back to the preservation archive.
  const archivedGit =
    baseline ??
    inventoryArchive(
      receipt.archives.git.path,
      metadataOptions,
      gitArchiveExclusions(currentMetadataRoots, currentCommon),
    )
  if (
    comparableInventory(currentGit) !== comparableInventory(archivedGit) ||
    currentGit.entryCount !== archivedGit.entryCount
  ) {
    const currentPaths = new Map(
      currentGit.entries.map((entry) => [entry.path, JSON.stringify(entry)]),
    )
    const archivedPaths = new Map(
      archivedGit.entries.map((entry) => [entry.path, JSON.stringify(entry)]),
    )
    const mismatch = [...new Set([...currentPaths.keys(), ...archivedPaths.keys()])]
      .filter((path) => currentPaths.get(path) !== archivedPaths.get(path))
      .slice(0, 3)
      .join(', ')
    throw new Error(
      `Git metadata changed during teardown; retain worktree (${currentGit.entryCount} vs ${archivedGit.entryCount}; ${mismatch})`,
    )
  }
  // Only the operational names are excluded: `gitdir`, which
  // `git worktree move` must rewrite, and the teardown journal, which
  // detach/restore cycles append to. HEAD, index, logs and the remaining
  // current-worktree metadata still have to match the preservation archive.
}

function withExclusiveWriterOwnership<T>(
  lifecycle: BatchLifecycle,
  main: string,
  path: string,
  operation: () => T,
): T {
  if (!lifecycle.withExclusiveWriterOwnership)
    throw new Error('exclusive writer ownership control unavailable; source retained')
  return lifecycle.withExclusiveWriterOwnership(main, path, operation)
}

// A process that opens, writes, and closes a tree file between verification
// and removal leaves no /proc trace, so probes alone cannot observe it. A
// detached watcher records inotify events into a log the synchronous caller
// can read: any write during the verify→seal→remove window stays visible.
const QUARANTINE_WATCHER = String.raw`
const { watch, readdirSync, statSync, lstatSync, appendFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const [root, out, ...extra] = process.argv.slice(1)
const emit = (line) => {
  try {
    appendFileSync(out, line + '\n')
  } catch {
    // A lost append invalidates the log silently; the caller must retain,
    // so the watcher dies rather than authorize deletion on partial data.
    process.exit(3)
  }
}
try {
  // Keyed by inode, not pathname: a watched directory that is deleted and
  // recreated at the same path is a different object and must be re-attached.
  const watched = new Set()
  // File-inode watch: inotify marks the inode, so a write through an
  // external hard link still reaches this watch even though the alias's
  // parent directory is unobserved and the /proc probe's path check cannot
  // see the descriptor. Only multi-linked files can have such an alias.
  const attachFile = (p, st) => {
    const key = String(st.dev) + ':' + String(st.ino)
    if (watched.has(key)) return
    let lastNlink = st.nlink
    watch(p, (eventType) => {
      if (eventType !== 'change') return emit('D ' + p)
      // Unlinking one alias fires IN_ATTRIB (nlink drop) on the inode.
      // Re-baseline after each drop: a write via a surviving alias or held
      // descriptor afterwards arrives with nlink unchanged and reports M.
      // Once the tree is renamed to trash every path stat fails — a change
      // that still arrives then is a write through a held descriptor or
      // external alias, never removal's own teardown (removal renames; it
      // does not unlink), so it is M, not an absorbable echo.
      try {
        const nst = statSync(p)
        const n = nst.nlink
        const kind = n < lastNlink ? 'D' : 'M'
        lastNlink = n
        // M events carry the event-time mtime so the caller can tell a real
        // write apart from an atime-only read by its own verifier; '?' marks
        // a stat that failed because the path vanished first.
        emit(kind === 'M' ? 'M ' + String(nst.mtimeMs) + ' ' + p : 'D ' + p)
      } catch {
        emit('M ? ' + p)
      }
    })
    watched.add(key)
  }
  const attach = (dir) => {
    let st
    try {
      st = lstatSync(dir)
    } catch {
      return // vanished between the event and attach — nothing to watch
    }
    // lstat, not stat: a symlinked directory's target lives outside the
    // observation boundary — following it would watch unrelated trees and
    // could exhaust inotify watches on an enormous external hierarchy.
    if (!st.isDirectory()) return
    const key = String(st.dev) + ':' + String(st.ino)
    if (watched.has(key)) return
    // A refused watch (e.g. inotify watch exhaustion) must surface: READY
    // is never emitted and the caller retains instead of removing blind.
    watch(dir, (eventType, name) => {
      const p = join(dir, String(name ?? ''))
      // fs.watch collapses create/delete/move into 'rename'; classify by
      // post-state so the caller can tell foreign creates (C) from the
      // removal's own deletions and watcher self-events (D). A created file
      // that is written still emits M either way, and a 'change' on a
      // vanished path is a write+delete — still a write.
      let kind = eventType === 'change' ? 'M' : 'D'
      let mtime = '?'
      try {
        const cst = lstatSync(p)
        mtime = String(cst.mtimeMs)
        // A link() gaining an external alias arrives as 'change' — this
        // re-check is what attaches a file watch to it mid-window.
        try {
          if (cst.isDirectory()) attach(p)
          else if (cst.isFile() && cst.nlink > 1) attachFile(p, cst)
        } catch {
          process.exit(2)
        }
        if (eventType === 'rename') kind = 'C'
      } catch {
        // Vanished between event and stat — a delete or move-out.
      }
      emit(kind === 'M' ? 'M ' + mtime + ' ' + p : kind + ' ' + p)
    })
    watched.add(key)
    // Enumerate only after the watch is live: a child created mid-walk
    // still fires a rename event on the attached watch.
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        attach(p)
        continue
      }
      let fst
      try {
        fst = lstatSync(p)
      } catch {
        continue // vanished mid-walk — its delete event already fired
      }
      // A symlink is never file-watched: fs.watch follows it to a target
      // outside the boundary, and its retargets surface as parent renames.
      if (fst.isFile() && fst.nlink > 1) attachFile(p, fst)
    }
  }
  attach(root)
  // Extra roots (e.g. the linked-worktree git metadata dir outside the
  // quarantine) get the same recursive coverage.
  for (const r of extra) attach(r)
  // No watch attached at all (e.g. a symlinked root skipped above) means
  // the observation boundary never formed — refuse rather than emit READY
  // and let the caller remove blind.
  if (watched.size === 0) process.exit(2)
  writeFileSync(out, 'READY\n')
  const parent = process.ppid
  const born = Date.now()
  // Heartbeat doubles as a flush acknowledgement: the child's single-threaded
  // event loop appends a TICK strictly after every event already delivered,
  // so two ticks newer than a caller timestamp prove the log is current.
  // Parent death or a lifetime cap reaps the watcher: an interrupted caller
  // must not leave an orphan appending heartbeats and holding watches.
  setInterval(() => {
    emit('TICK ' + Date.now())
    let parentAlive = false
    try {
      process.kill(parent, 0)
      parentAlive = true
    } catch (e) {
      parentAlive = e && e.code === 'EPERM'
    }
    if (!parentAlive || Date.now() - born > 1800000) process.exit(0)
  }, 5)
} catch {
  process.exit(2)
}
`

function observeQuarantineWrites(
  quarantine: string,
  extraRoots: string[] = [],
): {
  events: () => string[]
  flush: (since: number) => void
  stop: () => void
} {
  const out = join(tmpdir(), `clade-wt-watch-${randomUUID()}.log`)
  const child = spawn(
    process.execPath,
    ['-e', QUARANTINE_WATCHER, quarantine, out, ...extraRoots],
    {
      stdio: 'ignore',
    },
  )
  const pause = new Int32Array(new SharedArrayBuffer(4))
  const lines = (): string[] => {
    try {
      return readFileSync(out, 'utf8').split('\n')
    } catch {
      return []
    }
  }
  // The caller blocks the event loop with synchronous work, so child exit
  // notifications are unreliable; /proc state is a synchronous ground truth.
  const alive = (): boolean => {
    if (child.pid === undefined) return false
    try {
      const stat = readFileSync(`/proc/${child.pid}/stat`, 'utf8')
      const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]
      return state !== 'Z' && state !== 'X'
    } catch {
      return false
    }
  }
  const dead = () => new Error('quarantine write observer exited during handoff; retain worktree')
  const ready = () => lines()[0] === 'READY'
  const deadline = Date.now() + 10_000
  while (!ready()) {
    if (!alive() || Date.now() > deadline) break
    Atomics.wait(pause, 0, 0, 10)
  }
  if (!ready()) {
    try {
      child.kill()
    } catch {
      // Best-effort teardown of the watcher.
    }
    throw new Error('ownership handoff cannot observe quarantine writes; retain worktree')
  }
  return {
    events: () => {
      if (!alive()) throw dead()
      return lines().filter((line) => line && line !== 'READY' && !line.startsWith('TICK '))
    },
    // Resolve once the watcher has appended two heartbeats newer than
    // `since`. A single tick can fire before the poll that drains events
    // delivered to the kernel at `since`; the second tick proves at least
    // one full poll cycle ran after it, so every queued event is in the log.
    flush: (since: number) => {
      const flushDeadline = Date.now() + 2_000
      while (Date.now() < flushDeadline) {
        if (!alive()) throw dead()
        const fresh = lines().filter(
          (line) => line.startsWith('TICK ') && Number(line.slice(5)) >= since,
        ).length
        if (fresh >= 2) return
        Atomics.wait(pause, 0, 0, 5)
      }
      throw new Error('quarantine write observer unresponsive; retain worktree')
    },
    stop: () => {
      try {
        child.kill()
      } catch {
        // Best-effort teardown of the watcher.
      }
      try {
        rmSync(out, { force: true })
      } catch {
        // Best-effort teardown of the event log.
      }
    },
  }
}

type WriteObserver = ReturnType<typeof observeQuarantineWrites>

function removeWorktreeAfterVerification(
  cwd: string,
  path: string,
  expectedInventory: SourceInventory,
  profile: ConsumerProfile,
  receipt: PreservationReceipt,
  quarantine: string,
  beforeMove?: () => void,
  afterHandoff?: () => void,
  beforeRemove?: (quarantine: string) => void,
  onRemoved?: (extraRoots: string[]) => void,
  trash?: string,
  observer?: WriteObserver,
  verifyBaseline?: {
    worktree?: SourceInventory
    git?: SourceInventory
  },
  // Replays the teardown journal after a failed removal restored the tree:
  // reattaches the recorded torn-down modules dir and detached checkout
  // `.git` files under `restoredTree` (the source path when the move-back
  // succeeded, else the quarantine).
  onRestore?: (restoredTree: string) => void,
): void {
  const alreadyQuarantined = !existsSync(path) && existsSync(quarantine)
  // Resolved inside the handoff but declared at function scope so the
  // catch-restore below can move trashed metadata back.
  let metadataRoots: string[] = []
  // Each metadata root is trashed inside the common dir — never under
  // `worktrees/`, where git would still see a registered admin entry —
  // under a name derived from the journaled trash id, so restore and
  // resume locate it without another journal field, and the rename stays
  // on the metadata root's own filesystem.
  const trashId = basename(trash ?? 'x').replace(/^\.clade-trashed-/, '')
  const trashMeta = (root: string) =>
    join(dirname(dirname(root)), `.clade-trashed-meta-${basename(root)}-${trashId}`)
  // Event paths are always prefixed by the root the observer attached to —
  // the source path for a caller-attached observer (rename does not rebase
  // them), the quarantine for a resume.
  const observedRoot = alreadyQuarantined ? quarantine : path
  // The linked-worktree git metadata dir lives outside the observed root
  // (index/HEAD live there), so it joins the observed roots — removal
  // renames it away too. Resolving before the move works because the
  // source's gitdir still points at it.
  // A prior interrupted run may have left the observed root sealed; it is our
  // own inode, so restore owner access before the metadata lookup and the
  // observer's enumeration try to read it.
  try {
    const priorMode = statSync(observedRoot).mode
    if ((priorMode & 0o700) === 0) chmodSync(observedRoot, priorMode | 0o700)
  } catch (error) {
    throw new Error(`ownership handoff cannot observe quarantine; retain worktree (${error})`, {
      cause: error,
    })
  }
  let commonDir: string | undefined
  try {
    commonDir = git(observedRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    metadataRoots = gitWorktreeMetadataRoots(observedRoot, commonDir)
  } catch {
    // verifyQuarantineGitInventory below is the guard — an unresolvable
    // metadata root fails verification and retains.
  }
  // Attach the write observer before verification — or reuse the one the
  // caller attached before preservation/teardown: a change that lands after
  // watch attach is recorded, and one that lands before the verify walk read
  // the file is caught by the inventory comparison — together they leave no
  // unobserved write interval inside the handoff.
  const obs = observer ?? observeQuarantineWrites(observedRoot, metadataRoots)
  const inventoryNames = new Set(expectedInventory.entries.map((entry) => entry.path))
  inventoryNames.add('.git')
  // Teardown legitimately removes this worktree's own metadata root
  // wholesale (`deinit`, `worktree remove`) — including `gitdir`, which the
  // archive excludes — so deletes under it are exempt; real drift still
  // fails the post-move Git inventory verify.
  // Foreign activity in the pre-move segment (preservation, teardown,
  // beforeMove hooks): only a non-self-shaped delete of a name the
  // inventory does not list is flagged. A create/move-in is NOT safe to
  // ignore: verification compares against a post-teardown baseline, so
  // bytes created during teardown enter that baseline without entering
  // the archive — the journaled-detach exemption below is the only create
  // that is legitimately ours. M and deletes of inventory names surface
  // through the bracketed verify.
  const inventoryByPath = new Map(expectedInventory.entries.map((entry) => [entry.path, entry]))
  const foreignPreMove = (
    event: string,
    journalByRoot: Map<string, ReturnType<typeof readTeardownJournal>>,
  ): boolean => {
    const kind = event[0]
    const rest = event.slice(2).trimEnd()
    // M events carry the event-time mtime (`M <mtimeMs|?> <path>`); C/D are
    // bare paths.
    let p = rest
    let mtime = ''
    if (kind === 'M') {
      const sp = rest.indexOf(' ')
      mtime = rest.slice(0, sp)
      p = rest.slice(sp + 1)
    }
    if (p === observedRoot || metadataRoots.includes(p)) {
      // The observed root itself is an inventory entry ('') whose preserved
      // metadata a foreign chmod or xattr write could change mid-teardown —
      // an M on it is adjudicated on fields like any other directory.
      // C/D on the root keep their existing classification (recreates and
      // removals are caught by the post-move checks), and metadata roots
      // are covered by the trashed-metadata verify.
      if (kind === 'M' && p === observedRoot) {
        const rootEntry = inventoryByPath.get('')
        return (
          !rootEntry ||
          !liveEntryMatchesInventory(
            observedRoot,
            rootEntry,
            inventoryByPath,
            inventoryOptionsFromProfile(profile),
          )
        )
      }
      return false
    }
    const metadataRoot = metadataRoots.find((root) => !relative(root, p).startsWith('..'))
    if (metadataRoot) {
      // Teardown legitimately deletes the metadata root wholesale
      // (deinit, `worktree remove`), so its D events stay exempt. Its
      // only legitimate writes are the journal itself and the one
      // torn-down generation its `modules <name>` record names — an
      // exact match at the root's top level, so a prefix-sibling name
      // or any write inside the generation still flags. Anything else
      // inside private Git metadata is foreign — folding it into the
      // post-teardown baseline would accept a change the archive never
      // captured, reporting a clean removal over an outdated archive.
      if (kind === 'D') return false
      const inside = relative(metadataRoot, p)
      if (inside === WT_TEARDOWN_JOURNAL_NAME) return false
      return !(kind === 'C' && inside === journalByRoot.get(metadataRoot)?.tornDown)
    }
    const rel = relative(observedRoot, p)
    if (rel.startsWith('..')) return false
    if (kind === 'M') {
      const entry = inventoryByPath.get(rel)
      // Directory mtime bumps only echo a child create/delete, which its own
      // C/D event classifies — the timestamp is noise for dirs, so their
      // events are adjudicated on the preserved identity fields (mode,
      // uid, gid, acl/xattr) that a chmod or xattr write would change.
      // For real entries the mtime separates a same-content atime
      // read by our verifier (unchanged) from a foreign write (changed) or
      // an unverifiable one ('?'), including a write to a file teardown
      // later deletes — invisible to the post-teardown baseline. An
      // unchanged mtime is not proof of an atime-only read, though: chmod,
      // chown, xattr writes and mtime-restored writes report the same
      // timestamp, so those events are adjudicated on every preserved
      // field rather than the timestamp alone.
      if (entry?.type === 'directory')
        return !liveEntryMatchesInventory(
          observedRoot,
          entry,
          inventoryByPath,
          inventoryOptionsFromProfile(profile),
        )
      if (!entry || mtime !== String(entry.mtimeMs)) return true
      return !liveEntryMatchesInventory(
        observedRoot,
        entry,
        inventoryByPath,
        inventoryOptionsFromProfile(profile),
      )
    }
    // A create is the dangerous event: verification compares against a
    // post-teardown baseline, so bytes created during teardown enter that
    // baseline without ever entering the preservation archive — a
    // populated directory moved in mid-teardown would ride into trash
    // unarchived and report a clean removal. The only legitimate creates
    // are teardown's own detached-pointer renames, so exempt exactly the
    // names its journal records — nothing else, not even a create on an
    // inventoried path (a foreign delete+recreate at the same path is
    // equally invisible to the baseline). `retired` joins the exempt set
    // because a detach+restore cycle inside the window still created the
    // detached name legitimately.
    if (kind === 'C') {
      for (const fold of journalByRoot.values())
        if (fold.detached.has(rel) || fold.retired.has(rel)) return false
      return true
    }
    if (kind !== 'D') return true
    // A watched dir reports its own move out as `<dir>/<basename>` — that
    // self shape exempts only deletes; on a create or modify it is a
    // foreign path that merely happens to share its parent's name.
    if (basename(dirname(p)) === basename(p)) return false
    return !inventoryNames.has(rel)
  }
  let preMoveBoundary = 0
  try {
    if (!alreadyQuarantined) beforeMove?.()
    obs.flush(Date.now())
    // Teardown's own creates are exactly what its journal recorded — the
    // detached-pointer names in-tree, and the one torn-down modules
    // generation inside the metadata root. Read each root's journal after
    // the boundary flush so a journaled rename never flags as foreign.
    const journalByRoot = new Map(
      metadataRoots.map((root) => [root, readTeardownJournal(root)] as const),
    )
    // The foreign check and the post-move boundary must share one
    // snapshot: events landing between two reads would sit below a later
    // boundary yet above the checked snapshot — reported by neither.
    const preMoveLog = obs.events()
    const foreign = preMoveLog.filter((event) => foreignPreMove(event, journalByRoot))
    if (foreign.length)
      throw new Error(
        `writer activity observed during teardown; retain worktree (${foreign
          .slice(0, 3)
          .join('; ')})`,
      )
    // Everything logged after this snapshot belongs to the post-move
    // window — the pre-remove gate reclassifies all of it, not only the
    // tail after the last quiet round, so a foreign create+delete that
    // landed inside the move/converge gap can never pass unreported. A
    // resumed quarantine has no move left to fence; the boundary instead
    // ends the caller's re-verify/re-teardown window, whose own
    // detach/create shapes the pre-move rules already exempt.
    preMoveBoundary = preMoveLog.length
    // `worktree move` onto an existing directory nests the source inside
    // it instead of failing — refuse a physically occupied destination so
    // the tree never lands inside a foreign dir. The check is inherently
    // racy, so the rollback below still probes the forward-nested
    // location.
    if (!alreadyQuarantined && lstatPresent(quarantine))
      throw new Error('quarantine destination already occupied; retain worktree')
    if (!alreadyQuarantined) git(cwd, ['worktree', 'move', path, quarantine])
    if (!alreadyQuarantined) afterHandoff?.()
    if (!alreadyQuarantined && existsSync(path))
      throw new Error('source path reappeared during quarantine; retain worktree')
    // Verify against the post-teardown baseline when the caller journaled
    // one: destroy's own deletes (deinit, env teardown) are baseline, and
    // only foreign drift fails. Legacy journals fall back to the
    // pre-teardown archive inventory.
    const expectedWorktree = verifyBaseline?.worktree ?? expectedInventory
    verifyQuarantineInventory(quarantine, expectedWorktree, profile)
    verifyQuarantineGitInventory(quarantine, receipt, profile, verifyBaseline?.git)
    // The final probe runs unsealed so its foreign-writability verdict is
    // computed from the live tree: a verdict of non-foreign-writable also
    // proves no foreign process can establish a writable handle after the
    // probe, because nothing between probe and removal can grant one.
    // Permission bits never revoke already-held descriptors or shared
    // mappings; those writers stay observable through the event log and
    // the /proc scans.
    // The probe must cover every root a writer could hold into: the
    // quarantine and the external git metadata dir (index/HEAD) alike.
    const probeAll = () => {
      beforeRemove?.(quarantine)
      for (const root of metadataRoots) beforeRemove?.(root)
    }
    let handoffError: unknown
    try {
      probeAll()
    } catch (error) {
      handoffError = error
    }
    // The loop's guarantee is "the last verify saw a byte-identical tree
    // with no events arriving during the walk": verification runs
    // unconditionally each round because inotify queue overflow drops
    // events `fs.watch` never reports, and an exiting round must have
    // observed zero events between its own flush brackets — a write to an
    // already-walked file can never be absorbed into a stale boundary.
    // Atime events from the verifier's own reads fire at most once per
    // file, so a genuinely idle tree converges on the second round.
    let verifiedAt = -1
    if (handoffError === undefined)
      try {
        for (let activeRounds = 0; ; ) {
          obs.flush(Date.now())
          const pre = obs.events().length
          verifyQuarantineInventory(quarantine, expectedWorktree, profile)
          verifyQuarantineGitInventory(quarantine, receipt, profile, verifyBaseline?.git)
          obs.flush(Date.now())
          verifiedAt = obs.events().length
          if (verifiedAt === pre) break
          if (++activeRounds > 4)
            throw new Error('continued writer activity during ownership handoff; retain worktree')
        }
      } catch (error) {
        handoffError = error
      }
    if (handoffError !== undefined) throw handoffError
    // Removal renames the quarantine and each metadata root; neither
    // unlinks files, so removal's own events are only self-shaped D — a
    // watched dir reporting its own move as <dir>/<basename>. Every other
    // event is writer activity: M is a write, C is a foreign create or
    // move-in, and a non-self D is a foreign unlink or move-out —
    // inventory names included, since cleanup itself deletes nothing.
    const suspicious = (event: string): boolean => {
      const kind = event[0]
      if (kind === 'M' || kind === 'C') return true
      if (kind !== 'D') return false
      const p = event.slice(2).trimEnd()
      if (p === observedRoot || metadataRoots.includes(p)) return false
      return basename(dirname(p)) !== basename(p)
    }
    // Last-instant gates: a write since the final verify or a writer that
    // spawned during the converge loop retains the tree instead of being
    // moved under it. The remaining window is the rename itself;
    // writes inside it still surface in the post-removal event check.
    // The gate covers the whole post-move log, not only the post-verify
    // tail: in the settled region M is excluded (the verifier's own atime
    // events live there and every real write was re-verified), but a C or
    // a non-self D recorded during the move/converge gap is a foreign
    // create+delete that byte-identical verification can never show.
    obs.flush(Date.now())
    const eventLog = obs.events()
    const settledForeign = eventLog
      .slice(preMoveBoundary, Math.max(verifiedAt, 0))
      .filter((event) => event[0] !== 'M' && suspicious(event))
    const preRemove = [
      ...settledForeign,
      ...eventLog.slice(Math.max(verifiedAt, 0)).filter(suspicious),
    ]
    if (preRemove.length)
      throw new Error(
        `writer activity observed during ownership handoff; retain worktree (${preRemove
          .slice(0, 3)
          .join('; ')})`,
      )
    probeAll()
    if (metadataRoots.length === 0)
      throw new Error('linked-worktree Git metadata root unresolved; retain worktree')
    // Removal is a rename into sibling trash paths — the quarantine tree
    // and each linked-worktree Git metadata dir alike — so nothing is
    // unlinked during the handoff: a same-UID write that lands in the
    // final window, and a racing `git add` writing index/HEAD, are both
    // preserved in trash rather than destroyed. The metadata destination
    // derives deterministically from the journaled trash path, so a
    // resume can locate it without another journal field. Reconciling a
    // flagged removal inspects trash.
    if (!trash) throw new Error('no trash path journaled; retain worktree')
    // The journaled trash names must be free — `renameSync` onto an
    // existing empty directory silently replaces it, which would destroy
    // a foreign occupant planted on the name. Probe with lstat so even a
    // dangling symlink counts as occupied.
    if (lstatPresent(trash)) throw new Error('trash destination already occupied; retain worktree')
    for (const root of metadataRoots) {
      const tm = trashMeta(root)
      if (lstatPresent(tm))
        throw new Error('trashed-metadata destination already occupied; retain worktree')
    }
    renameSync(quarantine, trash)
    for (const root of metadataRoots) renameSync(root, trashMeta(root))
    // The journal-clearing save that follows a successful return is
    // durable; a crash must not persist it without the relocations it
    // records, so every directory whose entries the renames changed is
    // fsynced before the post-removal checks begin — the worktree's parent
    // plus, for each metadata move, both the `worktrees/` source dir and
    // the common-dir destination.
    const renameParents = new Set<string>([dirname(trash)])
    for (const root of metadataRoots) {
      renameParents.add(dirname(root))
      renameParents.add(dirname(trashMeta(root)))
    }
    for (const dir of renameParents) syncDirectory(dir)
    // Events queued during removal are acknowledged by two heartbeats
    // newer than the removal's completion before the log is read — the
    // first tick can fire before the poll that drains events delivered at
    // `removeDone`; the second proves that drain finished.
    const removeDone = Date.now()
    let removalError: unknown
    // Set when a trashed-verify round completed with zero new events —
    // the tail check below slices from it.
    let convergedAt = -1
    try {
      // Events in the move/rename window: only the self-shaped D lines
      // belong to our own renames; anything else is a foreign write.
      obs.flush(removeDone)
      const postRenameLog = obs.events()
      const renameWindow = postRenameLog.slice(Math.max(verifiedAt, 0)).filter(suspicious)
      if (renameWindow.length)
        removalError = new Error(
          `writer activity observed during ownership handoff; archive may predate final writes (${renameWindow
            .slice(0, 3)
            .join('; ')})`,
        )
      // The classification boundary only ever advances past examined
      // events: it starts at the rename-window snapshot, so events that
      // arrive while the expected archive computes — or inside a verify
      // round — belong to the round they precede and can never slip
      // between two snapshots.
      let pre = postRenameLog.length
      // The observer can miss a write entirely: an external hard-link alias
      // created on an unwatched nlink=1 inode never fires an event, and queue
      // overflow drops events fs.watch never reports — so the renamed tree
      // and each trashed metadata root re-verify against the baseline. The
      // event check can never *precede* the verify it guards: a writer may
      // modify an already-read file and close while the walk continues, so
      // a round only counts when no events arrived inside it — the same
      // zero-arrival convergence as the pre-move loop, with the verifier's
      // own atime reads settling after at most one extra round.
      const common = dirname(dirname(metadataRoots[0]))
      const expectedGit =
        verifyBaseline?.git ??
        inventoryArchive(
          receipt.archives.git!.path,
          inventoryOptionsFromProfile(profile),
          gitArchiveExclusions(metadataRoots, common),
        )
      for (let rounds = 0; ; ) {
        verifyQuarantineInventory(trash, expectedWorktree, profile)
        for (const root of metadataRoots)
          verifyTrashedMetadataInventory(trashMeta(root), root, common, expectedGit, profile)
        obs.flush(Date.now())
        const events = obs.events()
        convergedAt = events.length
        const arrived = events.slice(pre)
        if (!arrived.length) break
        // Events inside the round are classified before a quiet round can
        // bury them: the verifier's own atime M is the only ambiguous
        // shape — a C or non-self D is a foreign create/delete a clean
        // re-verify can never show.
        const foreignMidRound = arrived.filter((event) => event[0] !== 'M' && suspicious(event))
        if (foreignMidRound.length)
          throw new Error(
            `writer activity observed during post-removal verification; retain worktree (${foreignMidRound
              .slice(0, 3)
              .join('; ')})`,
          )
        if (++rounds > 4)
          throw new Error(
            'continued writer activity during post-removal verification; retain worktree',
          )
        pre = convergedAt
      }
    } catch (error) {
      if (removalError === undefined) removalError = error
    }
    // The tree is moved; run the post-removal scan even when late writes
    // or a flush failure were detected — precisely then the handle report
    // is the only coverage left. Handles resolve through the rename, so
    // the scan must cover the trash destinations, the metadata roots'
    // original paths, and the quarantine.
    try {
      onRemoved?.([trash!, ...metadataRoots.flatMap((root) => [root, trashMeta(root)])])
    } catch (error) {
      if (removalError === undefined) removalError = error
    }
    // Anything logged after the converged verify — during the handle scan
    // or the tail before the journal clears — was never examined. With no
    // verifier reads left, every event here is foreign.
    try {
      obs.flush(Date.now())
      const late = convergedAt >= 0 ? obs.events().slice(convergedAt).filter(suspicious) : []
      if (late.length && removalError === undefined)
        removalError = new Error(
          `writer activity observed after post-removal verification; retain worktree (${late
            .slice(0, 3)
            .join('; ')})`,
        )
    } catch (error) {
      if (removalError === undefined) removalError = error
    }
    if (removalError !== undefined) throw removalError
    if (!alreadyQuarantined && existsSync(path))
      throw new Error('worktree path was recreated during ownership handoff; retain worktree')
  } catch (error) {
    // A post-rename failure still has every byte: put trash back under
    // the quarantine name before the normal restore path. This runs on a
    // resumed removal too — this run's own quarantine→trash renames still
    // need undoing, or the retained worktree would sit unregistered in
    // trash with later retries forced into manual reconciliation.
    // `worktree move` onto an existing directory nests the tree inside it
    // instead of failing, so neither exit status nor path existence proves
    // ownership — a path is ours only while its `.git` still resolves to
    // this worktree's journaled admin root. A foreign recreation at `path`
    // (or a squatter on the journaled `quarantine` name, which is recorded
    // before the forward move ever runs) never passes and is never moved.
    const ours = (candidate: string | undefined) => {
      if (!candidate || !existsSync(candidate)) return undefined
      try {
        const gitdir = realpathSync(
          git(candidate, ['rev-parse', '--path-format=absolute', '--git-dir']),
        )
        return metadataRoots.some((root) => existsSync(root) && realpathSync(root) === gitdir)
          ? candidate
          : undefined
      } catch {
        return undefined
      }
    }
    try {
      // Metadata goes home first so the restored quarantine is a
      // registered worktree again and `worktree move` below can succeed.
      // The private module repository keeps its torn-down name until the
      // move completes — Git refuses to move a worktree while `modules`
      // exists under that name. Destinations are probed with lstat: a
      // dangling symlink still occupies its name and must not be
      // clobbered by the rename. Name occupancy alone is not ownership:
      // each trashed metadata dir must prove it is this teardown's
      // relocation — its `gitdir` record names this worktree's `.git` —
      // or a foreign dir planted on the journaled name before a
      // `beforeMove` failure would be relocated into the admin slot.
      if (trash)
        for (const root of metadataRoots) {
          const tm = trashMeta(root)
          // The admin dir's `gitdir` record names the worktree's location
          // as git last knew it — `worktree move` updates it, so at
          // rollback time it may say `quarantine` (moved there, then raw-
          // renamed to trash) or `path` (already moved home once).
          let owned = false
          try {
            const recorded = dirname(resolve(tm, readFileSync(join(tm, 'gitdir'), 'utf8').trim()))
            owned = recorded === resolve(path) || recorded === resolve(quarantine)
          } catch {
            // Not admin-shaped — foreign content at the trash name.
          }
          if (owned && !lstatPresent(root)) renameSync(tm, root)
        }
      // Same ownership rule for the tree trash: a dir squatting on the
      // journaled name is never relocated into quarantine.
      if (trash && !lstatPresent(quarantine) && ours(trash)) renameSync(trash, quarantine)
    } catch {
      // Trash stays as the recovery source when un-renaming fails.
    }
    try {
      // The forward move can have nested the tree inside an occupied
      // quarantine that appeared after the lstat probe — move back from
      // wherever the `.git` proof finds it.
      const moveSource = ours(quarantine) ?? ours(join(quarantine, basename(path)))
      if (moveSource) git(cwd, ['worktree', 'move', moveSource, path])
    } catch {
      // Keep the quarantine path as the recovery source when moving it back fails.
    }
    try {
      // Whether the tree moved back or stayed at quarantine, the teardown
      // journal inside its restored metadata root names the exact
      // torn-down modules dir and every detached checkout `.git` — the
      // lifecycle's restore hook replays them so the retained worktree's
      // submodules are populated again, never guessing among retained
      // generations or over a foreign `.git.clade-detached`.
      const restoredTree =
        ours(path) ??
        ours(quarantine) ??
        ours(join(path, basename(quarantine))) ??
        ours(join(quarantine, basename(path)))
      if (restoredTree) onRestore?.(restoredTree)
    } catch {
      // A detached `.git` or torn-down modules dir that cannot be renamed
      // back stays as the recovery source under its detached name.
    }
    throw error
  } finally {
    // The observer watches from before preservation through removal —
    // stopping belongs to the outermost exit so an early failure (move,
    // handoff hook, seal restore) cannot leave it running until its
    // lifetime cap.
    obs.stop()
  }
}
// Post-removal handle scans must cover the destinations a rename-based
// removal moved bytes to: the journaled trash tree, plus the common-dir
// trash prefix so a trashed metadata root (`<common>/.clade-trashed-meta-*`)
// is covered even when the journal predates it.
function removalScanRoots(c: Context, trash?: string): string[] {
  const roots = trash ? [trash] : []
  try {
    const common = git(c.main, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    roots.push(join(common, '.clade-trashed-meta-'))
  } catch {
    // A repo without a resolvable common dir scans the tree prefixes only.
  }
  return roots
}
function clean(cwd: string) {
  return !git(cwd, ['status', '--porcelain', '--untracked-files=all'])
}
function assertMain(c: Context) {
  if (git(c.main, ['symbolic-ref', 'HEAD']) !== 'refs/heads/main')
    throw new Error('Main working tree must have main checked out')
}
function sourceProblem(c: Context, m: ReadySource): string | undefined {
  const wt = worktrees(c.main).find((w) => w.path === m.path)
  if (!wt) return 'source worktree missing'
  if (wt.locked) return 'source locked'
  if (wt.branch !== m.branch || head(m.path) !== m.head)
    return 'source HEAD changed; register again after verification'
  if (!clean(m.path)) return 'source has uncommitted work'
  const claimObs = findClaimByWorktreeObserved(c.main, m.path)
  if (claimObs.status === 'unknown') return `source claim unknown: ${claimObs.reason}`
  const claimsObs = readActiveClaimsObserved(c.main)
  if (claimsObs.status === 'unknown') return `claims unknown: ${claimsObs.reason}`
  if (
    claimObs.value ||
    claimsObs.value.some(
      (cl) => cl.branch === m.branch || cl.branch === m.branch.replace('refs/heads/', ''),
    )
  )
    return 'source has an active claim; owner must release it'
  try {
    if (hashFile(m.evidence) !== m.evidenceHash) return 'source evidence changed'
  } catch {
    return 'source evidence missing'
  }
}
function requireKnownNoClaim(root: string, path: string, message: string): void {
  const obs = findClaimByWorktreeObserved(root, path)
  if (obs.status === 'unknown') throw new Error(`${message} (claims unknown: ${obs.reason})`)
  if (obs.value) throw new Error(message)
}
function eligible(c: Context, s: State) {
  const reserved = new Set(
    s.batches
      .filter((b) => !['cleaned', 'cancelled'].includes(b.phase))
      .flatMap((b) => b.members.map((m) => m.path)),
  )
  return s.ready.map((source) => ({
    source,
    reason: reserved.has(source.path) ? 'already in a batch' : sourceProblem(c, source),
  }))
}
function active(s: State): WorktreeBatch {
  const b = s.batches.find(isLiveBatch)
  if (!b) throw new Error('No active batch')
  return b
}
/** Batch registry without ready-pool evaluation; independent of workflow model. */
export function listBatches(cwd: string): WorktreeBatch[] {
  return readState(context(cwd)).batches
}
export function batchStatus(
  cwd: string,
  trigger: BatchTrigger = 'auto',
  workflow: WorktreeBatch['workflow'] = 'pr-merge-based',
) {
  if (!triggers.has(trigger)) throw new Error('Unknown batch trigger')
  if (!['trunk-based', 'pr-merge-based'].includes(workflow)) throw new Error('Unknown workflow')
  const c = context(cwd),
    s = readState(c),
    rows = eligible(c, s)
  const ready = rows.filter((r) => !r.reason).map((r) => r.source)
  const readyCount = new Set(ready.map((m) => m.workId)).size
  const activeImplementationCount = new Set(
    [
      ...ready.map((m) => m.workId),
      ...s.batches
        .filter((b) => !['cleaned', 'cancelled'].includes(b.phase))
        .flatMap((b) => b.members.map((m) => m.workId)),
    ].filter(Boolean),
  ).size
  return {
    readyCount,
    trigger,
    workflow,
    autoThreshold: autoThreshold(workflow),
    shouldPrepare: triggerReached(trigger, ready, workflow),
    shouldPrioritizeLanding: readyCount >= MAX_ACTIVE_IMPLEMENTATIONS,
    activeImplementationCount,
    maxActiveImplementations: MAX_ACTIVE_IMPLEMENTATIONS,
    overActiveCap: activeImplementationCount > MAX_ACTIVE_IMPLEMENTATIONS,
    drafts: listDrafts(c),
    ready,
    invalid: rows.filter((r) => r.reason),
    batches: s.batches,
  }
}
export function registerReady(
  cwd: string,
  source: string,
  options: {
    workId: string
    evidence: string
    authorizeLanding: boolean
    releaseWriter: boolean
    retain?: string
  },
) {
  const c = context(cwd)
  return mutate(c, (s) => {
    if (!options.workId || !options.authorizeLanding || !options.releaseWriter)
      throw new Error('Ready requires work-id, landing authorization and writer release')
    const path = realpathSync(resolve(cwd, source))
    const wt = worktrees(c.main).find((w) => w.path === path)
    if (!wt?.branch || path === c.main || s.batches.some((b) => b.path === path))
      throw new Error('Ready requires a source linked worktree')
    if (
      s.batches.some(
        (b) =>
          !['cleaned', 'cancelled'].includes(b.phase) && b.members.some((m) => m.path === path),
      )
    )
      throw new Error('Source already belongs to a batch')
    if ((s.blockedSources ?? []).some((blocked) => blocked.workId === options.workId))
      throw new Error(
        `Work id ${options.workId} is waiting on a named resume event and cannot re-enter ready`,
      )
    const evidence = realpathSync(resolve(cwd, options.evidence))
    if (!readFileSync(evidence).length) throw new Error('Evidence must be nonempty')
    const m: ReadySource = {
      path,
      branch: wt.branch,
      head: head(path),
      workId: options.workId,
      evidence,
      evidenceHash: hashFile(evidence),
      authorized: true,
      released: true,
      retain: options.retain,
    }
    const problem = sourceProblem(c, m)
    if (problem) throw new Error(problem)
    s.ready = [...s.ready.filter((row) => row.path !== path), m]
    save(c, s)
    return m
  })
}
export function checkpointSource(
  cwd: string,
  source: string,
  options: { workId: string; author: string; scope?: string[] },
): CheckpointReceipt {
  if (!options.workId || !options.author) throw new Error('Checkpoint requires work-id and author')
  const c = context(cwd)
  const path = realpathSync(resolve(cwd, source))
  const wt = worktrees(c.main).find((w) => w.path === path)
  if (!wt?.branch || path === c.main)
    throw new Error('Checkpoint requires a source linked worktree')
  if (git(path, ['status', '--porcelain']))
    throw new Error('Commit scoped changes before checkpoint; checkpoint does not harvest WIP')
  const scope =
    options.scope && options.scope.length
      ? options.scope
      : git(path, ['diff', '--name-only', `${head(c.main)}...HEAD`])
          .split('\n')
          .filter(Boolean)
  const receipt: CheckpointReceipt = {
    workId: options.workId,
    source: path,
    branch: wt.branch,
    head: head(path),
    author: options.author,
    scope,
    at: new Date().toISOString(),
  }
  mkdirSync(join(c.dir, 'checkpoints'), { recursive: true })
  const file = join(c.dir, 'checkpoints', workIdFile(options.workId))
  writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n')
  return receipt
}
function workIdFile(workId: string): string {
  return `${workId.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`
}
function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
export function parseDraftPrReceipt(value: unknown): DraftPrReceipt {
  if (!isRecord(value)) throw new Error('Invalid draft receipt; preserve it for recovery')
  if (
    typeof value.workId !== 'string' ||
    typeof value.source !== 'string' ||
    typeof value.branch !== 'string' ||
    typeof value.head !== 'string' ||
    typeof value.pr !== 'number' ||
    !Number.isInteger(value.pr) ||
    value.pr <= 0 ||
    typeof value.at !== 'string'
  )
    throw new Error('Invalid draft receipt; preserve it for recovery')
  const base = {
    workId: value.workId,
    source: value.source,
    branch: value.branch,
    head: value.head,
    pr: value.pr,
    at: value.at,
  }
  const kind = value.kind
  if (kind === 'visibility') {
    if (value.discussant !== undefined || value.question !== undefined)
      throw new Error('Invalid draft receipt; preserve it for recovery')
    return { ...base, kind: 'visibility' }
  }
  if (kind === 'discussion' || kind === undefined) {
    if (!isNonemptyString(value.discussant) || !isNonemptyString(value.question))
      throw new Error('Invalid draft receipt; preserve it for recovery')
    return {
      ...base,
      kind: 'discussion',
      discussant: value.discussant.trim(),
      question: value.question.trim(),
    }
  }
  throw new Error('Invalid draft receipt; preserve it for recovery')
}
function isDraftPrReceipt(value: unknown): value is DraftPrReceipt {
  try {
    parseDraftPrReceipt(value)
    return true
  } catch {
    return false
  }
}
function readDraft(file: string): DraftPrReceipt {
  return parseJsonWith(
    readFileSync(file, 'utf8'),
    isDraftPrReceipt,
    'Invalid draft receipt; preserve it for recovery',
  )
}
function listDrafts(c: Context): DraftPrReceipt[] {
  const dir = join(c.dir, 'drafts')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readDraft(join(dir, name)))
}
function draftReceiptFor(c: Context, workId: string): DraftPrReceipt | undefined {
  const file = join(c.dir, 'drafts', workIdFile(workId))
  if (!existsSync(file)) return undefined
  const receipt = readDraft(file)
  if (receipt.workId !== workId)
    throw new Error(
      `Draft receipt work id ${receipt.workId} does not match requested work id ${workId}; preserve the colliding receipt for recovery`,
    )
  return receipt
}
function draftBindingFor(c: Context, workId: string): BatchDraftBinding | undefined {
  const receipt = draftReceiptFor(c, workId)
  if (!receipt) return undefined
  return {
    workId,
    pr: receipt.pr,
    headBranch: receipt.branch.replace(/^refs\/heads\//, ''),
  }
}
function assertReceiptReusesDraft(
  c: Context,
  b: WorktreeBatch,
  receipt: MergeReceipt,
  headRef: string,
): void {
  // A batch prepared before the snapshot existed may already be merged; cancelling it would
  // move its reviewed base and strand the receipt. Its only binding evidence is the side receipt.
  const bindings = Array.isArray(b.draftBindings)
    ? b.draftBindings
    : b.members.flatMap((member) => {
        const binding = draftBindingFor(c, member.workId)
        return binding ? [binding] : []
      })
  for (const draft of bindings) {
    if (draft.pr !== receipt.pr)
      throw new Error(
        `Draft PR #${draft.pr} already exists for ${draft.workId}; ready and merge must reuse it, receipt names #${receipt.pr}. Source and integration retained`,
      )
    if (draft.headBranch !== headRef)
      throw new Error(
        `Draft PR #${draft.pr} head is ${draft.headBranch}; merge receipt head ${headRef} is a second PR. Source and integration retained`,
      )
  }
}
export function recordDraftPr(
  cwd: string,
  source: string,
  options: {
    workId: string
    pr: number
    kind?: 'visibility' | 'discussion'
    discussant?: string
    question?: string
  },
): DraftPrReceipt {
  const workId = options.workId.trim()
  if (!workId) throw new Error('Draft requires work-id, named discussant and a concrete question')
  if (!Number.isInteger(options.pr) || options.pr <= 0)
    throw new Error('Draft requires a positive integer PR number')
  if (options.kind !== undefined && options.kind !== 'visibility' && options.kind !== 'discussion')
    throw new Error('Unknown draft kind; expected visibility or discussion')
  const kind = options.kind ?? 'discussion'
  if (kind === 'visibility' && (options.discussant !== undefined || options.question !== undefined))
    throw new Error('Visibility draft forbids discussant and question')
  const discussant = options.discussant?.trim() ?? ''
  const question = options.question?.trim() ?? ''
  if (kind === 'discussion') {
    if (!discussant) throw new Error('Draft requires a named discussant')
    if (!question) throw new Error('Draft requires a concrete question')
  }
  const c = context(cwd)
  const path = realpathSync(resolve(cwd, source))
  const wt = worktrees(c.main).find((w) => w.path === path)
  if (!wt?.branch || path === c.main) throw new Error('Draft requires a source linked worktree')
  if (git(path, ['status', '--porcelain']))
    throw new Error('Commit scoped changes before draft; draft does not harvest WIP')
  const changed = git(path, ['diff', '--name-only', `${fetchOriginMain(c)}...HEAD`])
    .split('\n')
    .filter(Boolean)
  if (changed.length === 0) throw new Error('Draft requires a discussable independent diff')
  const receipt: DraftPrReceipt =
    kind === 'visibility'
      ? {
          workId,
          source: path,
          branch: wt.branch,
          head: head(path),
          pr: options.pr,
          at: new Date().toISOString(),
          kind: 'visibility',
        }
      : {
          workId,
          source: path,
          branch: wt.branch,
          head: head(path),
          pr: options.pr,
          at: new Date().toISOString(),
          kind: 'discussion',
          discussant,
          question,
        }
  return mutate(c, (s) => {
    const activeBatch = s.batches.find(
      (batch) => isLiveBatch(batch) && batch.members.some((member) => member.workId === workId),
    )
    if (activeBatch)
      throw new Error(`Draft work id ${workId} already belongs to active batch ${activeBatch.id}`)
    const existing = draftReceiptFor(c, workId)
    if (existing && (existing.pr !== receipt.pr || existing.branch !== receipt.branch))
      throw new Error(
        `Draft PR #${existing.pr} on ${existing.branch} is already recorded for ${workId}; reuse it instead of rebinding to #${receipt.pr} on ${receipt.branch}`,
      )
    const dir = join(c.dir, 'drafts')
    mkdirSync(dir, { recursive: true })
    writeJsonDurable(dir, workIdFile(workId), receipt)
    return receipt
  })
}
function verifyMembers(c: Context, b: WorktreeBatch) {
  for (const m of b.members) {
    const problem = sourceProblem(c, m)
    if (problem) throw new Error(`${m.path}: ${problem}`)
  }
}
function integration(c: Context, b: WorktreeBatch) {
  const wt = worktrees(c.main).find((w) => w.path === b.path)
  if (!wt || wt.branch !== `refs/heads/${b.branch}` || wt.locked)
    throw new Error('Integration worktree missing, changed or locked')
}
function integrate(
  c: Context,
  s: State,
  b: WorktreeBatch,
  resume: boolean,
  lifecycle: BatchLifecycle,
) {
  verifyMembers(c, b)
  // The index-mutating ops below (worktree add, squash merge, write-tree, reset) used to run
  // behind `wt-helper`'s guard; `wt-helper batch` now delegates here, so the guard comes too.
  clearStaleIndexLock(c.main)
  if (!existsSync(b.path)) {
    const ref = `refs/heads/${b.branch}`
    const existing = git(c.main, ['for-each-ref', '--format=%(objectname)', ref])
    if (existing) {
      if (existing !== b.base)
        throw new Error('Integration branch already changed; preserve it for recovery')
      git(c.main, ['worktree', 'add', b.path, b.branch])
    } else git(c.main, ['worktree', 'add', '-b', b.branch, b.path, b.base])
  }
  integration(c, b)
  clearStaleIndexLock(b.path)
  while (b.cursor < b.members.length) {
    if (!b.pending) {
      if (!clean(b.path)) throw new Error('Integration changed before next member')
      b.pending = { before: head(b.path) }
      save(c, s)
      try {
        git(b.path, ['merge', '--squash', '--no-commit', b.members[b.cursor].head])
      } catch {
        throw new Error(
          `Resolve the integration conflict, stage resolution, then batch resume: ${b.path}`,
        )
      }
    } else if (!resume)
      throw new Error('Interrupted integration: inspect staged changes, then batch resume')
    else if (head(b.path) === b.pending.before && clean(b.path) && !b.pending.tree) {
      // Interruption before Git wrote its index: retry the merge instead of skipping this member.
      try {
        git(b.path, ['merge', '--squash', '--no-commit', b.members[b.cursor].head])
      } catch {
        throw new Error(
          `Resolve the integration conflict, stage resolution, then batch resume: ${b.path}`,
        )
      }
    }
    if (git(b.path, ['ls-files', '-u'])) throw new Error('Unresolved integration conflicts')
    if (
      git(b.path, ['diff', '--name-only']) ||
      git(b.path, ['ls-files', '--others', '--exclude-standard'])
    )
      throw new Error('Stage the complete conflict resolution before resuming')
    const tree = git(b.path, ['write-tree'])
    if (head(b.path) !== b.pending.before) {
      const tip = head(b.path)
      if (
        !b.pending.tree ||
        git(b.path, ['rev-parse', `${tip}^{tree}`]) !== b.pending.tree ||
        git(b.path, ['rev-parse', `${tip}^`]) !== b.pending.before ||
        git(b.path, ['log', '-1', '--format=%B']) !== `worktree batch ${b.id} member ${b.cursor}`
      )
        throw new Error('Integration HEAD changed during checkpoint; inspect before recovery')
      b.cursor++
      delete b.pending
      save(c, s)
      continue
    }
    // Persist the produced tree before moving the internal branch. A replay can reuse it.
    b.pending.tree = tree
    save(c, s)
    const checkpoint = git(
      b.path,
      ['commit-tree', tree, '-p', b.pending.before],
      `worktree batch ${b.id} member ${b.cursor}\n`,
    )
    git(b.path, ['reset', '--soft', checkpoint])
    b.cursor++
    delete b.pending
    save(c, s)
  }
  // Only the batch-owned branch is moved; all source checkpoint refs remain untouched.
  git(b.path, ['reset', '--soft', b.base])
  if (!b.bootstrapped) {
    lifecycle.bootstrap(c.main, b.path)
    b.bootstrapped = true
  }
  b.phase = 'review'
  save(c, s)
  return b
}
export function prepareBatch(
  cwd: string,
  trigger: BatchTrigger,
  workflow: 'trunk-based' | 'pr-merge-based' = 'pr-merge-based',
  lifecycle: BatchLifecycle = defaultLifecycle,
  options: { groupWorkIds?: string[] } = {},
) {
  if (!triggers.has(trigger)) throw new Error('Unknown batch trigger')
  if (!['trunk-based', 'pr-merge-based'].includes(workflow)) throw new Error('Unknown workflow')
  const c = context(cwd)
  return mutate(c, (s) => {
    const existing = s.batches.find(isLiveBatch)
    if (existing) return existing
    const eligibleMembers = eligible(c, s)
      .filter((r) => !r.reason)
      .map((r) => r.source)
    if (workflow === 'pr-merge-based') fetchOriginMain(c)
    const members =
      workflow === 'pr-merge-based'
        ? selectPrMembers(eligibleMembers, options.groupWorkIds)
        : eligibleMembers
    if (workflow === 'pr-merge-based') rejectMembersCarryingLocalMainCommits(c, members)
    const draftBindings =
      workflow === 'pr-merge-based'
        ? members.flatMap((member) => {
            const binding = draftBindingFor(c, member.workId)
            return binding ? [binding] : []
          })
        : []
    // Trunk batches carry no bindings, so these checks are vacuous there.
    const draftPrs = new Set(draftBindings.map((binding) => binding.pr))
    if (draftPrs.size > 1)
      throw new Error(
        `Grouped work ids are bound to different draft PRs (${[...draftPrs].map((pr) => `#${pr}`).join(', ')}); one batch lands through one PR`,
      )
    const draftHeads = new Set(draftBindings.map((binding) => binding.headBranch))
    if (draftHeads.size > 1)
      throw new Error(
        `Grouped work ids are bound to different draft PR heads (${[...draftHeads].join(', ')}); one batch lands through one PR`,
      )
    if (!triggerReached(trigger, members, workflow)) return null
    assertMain(c)
    const id = randomUUID(),
      branch = `codex/batch-${id}`
    const b: WorktreeBatch = {
      id,
      branch,
      base: workflow === 'pr-merge-based' ? fetchOriginMain(c) : head(c.main),
      main: c.main,
      path: join(dirname(c.main), `${c.main.split('/').pop()}-wt`, `batch-${id}`),
      workflow,
      members,
      draftBindings,
      cursor: 0,
      phase: 'integrating',
      removed: [],
    }
    s.batches.push(b)
    save(c, s)
    return integrate(c, s, b, false, lifecycle)
  })
}
export function resumeBatch(cwd: string, lifecycle: BatchLifecycle = defaultLifecycle) {
  const c = context(cwd)
  return mutate(c, (s) => {
    const b = active(s)
    if (b.phase !== 'integrating') return b
    return integrate(c, s, b, true, lifecycle)
  })
}
/** Reconcile a newer main in the owned integration tree, invalidate the receipt, and review again. */
export function refreshBatch(cwd: string, resume = false) {
  const c = context(cwd)
  return mutate(c, (s) => {
    const b = active(s)
    if (!['review', 'sealed'].includes(b.phase))
      throw new Error('Finish integration before refreshing main')
    integration(c, b)
    verifyMembers(c, b)
    assertMain(c)
    if (b.refresh?.tree) {
      if (!resume) throw new Error('Finish interrupted refresh with batch refresh --resume')
      if (
        ![b.refresh.before, b.refresh.base].includes(head(b.path)) ||
        git(b.path, ['write-tree']) !== b.refresh.tree ||
        git(b.path, ['diff', '--name-only']) ||
        git(b.path, ['ls-files', '--others', '--exclude-standard'])
      )
        throw new Error('Refresh candidate changed; preserve it for inspection')
      git(b.path, ['reset', '--soft', b.refresh.base])
      b.base = b.refresh.base
      delete b.refresh
      save(c, s)
      return b
    }
    if (!b.refresh) {
      const base = batchBase(c, b)
      if (base === b.base) return b
      if (b.workflow === 'pr-merge-based') recordOriginAdvance(b)
      git(c.main, ['merge-base', '--is-ancestor', b.base, base])
      if (
        git(b.path, ['diff', '--name-only']) ||
        git(b.path, ['ls-files', '--others', '--exclude-standard'])
      )
        throw new Error('Stage integration changes before refreshing')
      const tree = git(b.path, ['write-tree'])
      const before = git(
        b.path,
        ['commit-tree', tree, '-p', head(b.path)],
        `worktree batch ${b.id} before refresh\n`,
      )
      b.refresh = { base, before }
      delete b.seal
      b.phase = 'review'
      save(c, s)
      git(b.path, ['reset', '--soft', before])
      try {
        git(b.path, ['merge', '--squash', '--no-commit', base])
      } catch {
        throw new Error('Resolve refresh conflict, stage resolution, then batch refresh --resume')
      }
    } else {
      if (!resume) throw new Error('Inspect refresh state, then batch refresh --resume')
      if (head(b.path) !== b.refresh.before) {
        if (
          head(b.path) !== git(b.path, ['rev-parse', `${b.refresh.before}^`]) ||
          git(b.path, ['write-tree']) !== git(b.path, ['rev-parse', `${b.refresh.before}^{tree}`])
        )
          throw new Error('Refresh HEAD changed; preserve integration for recovery')
        git(b.path, ['reset', '--soft', b.refresh.before])
      }
      if (clean(b.path)) {
        try {
          git(b.path, ['merge', '--squash', '--no-commit', b.refresh.base])
        } catch {
          throw new Error('Resolve refresh conflict, stage resolution, then batch refresh --resume')
        }
      }
    }
    if (
      git(b.path, ['ls-files', '-u']) ||
      git(b.path, ['diff', '--name-only']) ||
      git(b.path, ['ls-files', '--others', '--exclude-standard'])
    )
      throw new Error('Stage resolved refresh before continuing')
    b.refresh.tree = git(b.path, ['write-tree'])
    save(c, s)
    git(b.path, ['reset', '--soft', b.refresh.base])
    b.base = b.refresh.base
    delete b.refresh
    save(c, s)
    return b
  })
}
/** Re-expose the whole candidate to native staged-diff gates after an interrupted /commit. */
export function reviewBatch(cwd: string) {
  const c = context(cwd)
  return mutate(c, (s) => {
    const b = active(s)
    if (!['review', 'sealed'].includes(b.phase) || b.refresh)
      throw new Error('Complete integration or refresh before restarting review')
    integration(c, b)
    verifyMembers(c, b)
    assertMain(c)
    try {
      assertBatchBase(c, b)
    } catch (error) {
      save(c, s)
      throw error
    }
    if (
      git(b.path, ['ls-files', '-u']) ||
      git(b.path, ['diff', '--name-only']) ||
      git(b.path, ['ls-files', '--others', '--exclude-standard'])
    )
      throw new Error('Stage the complete candidate and resolve conflicts before restarting review')
    const tip = head(b.path)
    git(b.path, ['merge-base', '--is-ancestor', b.base, tip])
    if (tip !== b.base) git(c.main, ['update-ref', `refs/clade/batches/${b.id}/review-${tip}`, tip])
    // Invalidate first: a failed/interrupted reset must never leave the old seal usable.
    delete b.seal
    b.phase = 'review'
    save(c, s)
    if (tip !== b.base) git(b.path, ['reset', '--soft', b.base])
    return b
  })
}
/** Receipt values describe results produced by the complete /commit workflow. */
export function sealBatch(cwd: string, evidencePath: string) {
  const c = context(cwd)
  return mutate(c, (s) => {
    const b = active(s)
    if (!['review', 'sealed'].includes(b.phase)) throw new Error('Batch is not ready for review')
    integration(c, b)
    verifyMembers(c, b)
    if (b.refresh) throw new Error('Complete batch refresh before review')
    try {
      assertBatchBase(c, b)
    } catch (error) {
      save(c, s)
      throw error
    }
    if (
      git(b.path, ['diff', '--name-only']) ||
      git(b.path, ['ls-files', '--others', '--exclude-standard'])
    )
      throw new Error('Review requires all changes staged')
    const evidence = realpathSync(resolve(cwd, evidencePath)),
      receipt = parseJsonRecord(readFileSync(evidence, 'utf8'), evidence)
    const tree = git(b.path, ['write-tree'])
    const members = b.members.map((m) => ({ path: m.path, workId: m.workId, head: m.head }))
    if (
      receipt.base !== b.base ||
      receipt.tree !== tree ||
      JSON.stringify(receipt.members) !== JSON.stringify(members)
    )
      throw new Error('Review receipt does not match base, tree and batch members')
    const artifacts: { path: string; hash: string }[] = []
    if (!isRecord(receipt.gates)) throw new Error('Review receipt requires gate records')
    for (const name of ['simplify', 'review', 'checks', 'human']) {
      const gate = receipt.gates[name]
      if (!isRecord(gate)) throw new Error(`Gate ${name} requires a record`)
      if (
        gate?.status === 'not-applicable' &&
        typeof gate.reason === 'string' &&
        gate.reason.trim()
      )
        continue
      if (
        gate?.status !== 'passed' ||
        typeof gate.evidence !== 'string' ||
        typeof gate.hash !== 'string'
      )
        throw new Error(`Gate ${name} requires passed evidence and hash or not-applicable reason`)
      const path = realpathSync(resolve(dirname(evidence), gate.evidence))
      if (!readFileSync(path).length || hashFile(path) !== gate.hash)
        throw new Error(`Gate ${name} evidence missing, empty or changed`)
      artifacts.push({ path, hash: gate.hash })
    }
    b.seal = {
      head: clean(b.path) && head(b.path) !== b.base ? head(b.path) : undefined,
      tree,
      evidence,
      hash: hashFile(evidence),
      artifacts,
    }
    b.phase = 'sealed'
    save(c, s)
    return b
  })
}
function formalHead(c: Context, b: WorktreeBatch) {
  integration(c, b)
  if (!b.seal || hashFile(b.seal.evidence) !== b.seal.hash)
    throw new Error('Review evidence missing or changed')
  for (const artifact of b.seal.artifacts)
    if (hashFile(artifact.path) !== artifact.hash) throw new Error('Gate evidence changed')
  if (!clean(b.path))
    throw new Error('Integration must contain formal commits and no uncommitted work')
  const tip = head(b.path)
  if (b.seal.head && b.seal.head !== tip) throw new Error('Formal HEAD changed after review seal')
  if (tip === b.base || git(b.path, ['rev-parse', 'HEAD^{tree}']) !== b.seal.tree)
    throw new Error('Formal commits do not match reviewed tree')
  git(b.path, ['merge-base', '--is-ancestor', b.base, tip])
  return tip
}
function assertLandingPreservesMain(c: Context, base: string, tip: string) {
  const changed = git(c.main, ['diff', '--no-renames', '--name-only', '-z', base, tip])
    .split('\0')
    .filter(Boolean)
  const untracked = gitFileList(c.main, ['--others', '--exclude-standard'])
  const ignored = gitFileList(c.main, ['--others', '--ignored', '--exclude-standard'])
  let ignoreCase = false
  try {
    ignoreCase = git(c.main, ['config', '--bool', 'core.ignorecase']) === 'true'
  } catch {
    /* Git defaults to case-sensitive paths. */
  }
  const normalize = (path: string) => (ignoreCase ? path.toLowerCase() : path)
  const changedPaths = changed.map(normalize)
  const overlaps = (file: string) => {
    const path = normalize(file)
    return changedPaths.some(
      (candidate) =>
        path === candidate || path.startsWith(candidate + '/') || candidate.startsWith(path + '/'),
    )
  }
  // Both sides of the index matter: a staged rename also protects its old path.
  const dirty = [
    ...git(c.main, ['diff', '--no-renames', '--name-only', '-z']).split('\0'),
    ...git(c.main, ['diff', '--cached', '--no-renames', '--name-only', '-z']).split('\0'),
  ].filter(Boolean)
  for (const file of dirty)
    if (overlaps(file))
      throw new Error(
        `Main has existing WIP overlapping the batch: ${file}; preserve it before landing`,
      )
  for (const file of [...untracked, ...ignored]) {
    if (overlaps(file))
      throw new Error(
        `Main untracked or ignored path overlaps the batch: ${file}; preserve it before landing`,
      )
  }
}
function readMergeReceipt(cwd: string, path: string): MergeReceipt {
  const receiptPath = realpathSync(resolve(cwd, path)),
    receipt = parseJsonRecord(readFileSync(receiptPath, 'utf8'), receiptPath)
  if (receipt.merged !== true) throw new Error('PR closed without merge; sources are retained')
  if (
    typeof receipt.repository !== 'string' ||
    !receipt.repository.includes('/') ||
    typeof receipt.pr !== 'number' ||
    !Number.isSafeInteger(receipt.pr) ||
    receipt.pr <= 0 ||
    receipt.base !== 'main' ||
    receipt.merge_method !== 'squash' ||
    typeof receipt.source_head !== 'string' ||
    typeof receipt.reviewed_base !== 'string' ||
    typeof receipt.candidate_tree !== 'string' ||
    typeof receipt.merge_sha !== 'string' ||
    typeof receipt.content_patch_id !== 'string' ||
    !objectIdPattern.test(receipt.source_head) ||
    !objectIdPattern.test(receipt.reviewed_base) ||
    !objectIdPattern.test(receipt.candidate_tree) ||
    !objectIdPattern.test(receipt.merge_sha) ||
    !objectIdPattern.test(receipt.content_patch_id)
  )
    throw new Error(
      'Invalid merge receipt; require repository, positive pr, merged squash onto main, reviewed head/base, candidate tree, merge SHA and content patch',
    )
  return {
    repository: receipt.repository,
    pr: receipt.pr,
    base: 'main',
    merge_method: 'squash',
    merged: true,
    source_head: receipt.source_head.toLowerCase(),
    reviewed_base: receipt.reviewed_base.toLowerCase(),
    candidate_tree: receipt.candidate_tree.toLowerCase(),
    merge_sha: receipt.merge_sha.toLowerCase(),
    content_patch_id: receipt.content_patch_id.toLowerCase(),
  }
}
function defaultRemotePrProbe(query: { repository: string; pr: number }): RemotePrState {
  let raw: string
  try {
    raw = execFileSync(
      'gh',
      [
        'api',
        `repos/${query.repository}/pulls/${query.pr}`,
        '--jq',
        '{merged:.merged,mergeSha:.merge_commit_sha,base:.base.ref,repository:.base.repo.full_name,pr:.number,headSha:.head.sha,headRef:.head.ref}',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch {
    throw new Error(
      `Unable to verify GitHub PR ${query.repository}#${query.pr}; sources are retained`,
    )
  }
  const parsed = parseJsonRecord(raw, `github:${query.repository}#${query.pr}`)
  if (
    typeof parsed.repository !== 'string' ||
    typeof parsed.pr !== 'number' ||
    typeof parsed.merged !== 'boolean' ||
    typeof parsed.mergeSha !== 'string' ||
    typeof parsed.base !== 'string' ||
    typeof parsed.headSha !== 'string' ||
    typeof parsed.headRef !== 'string'
  )
    throw new Error(
      `GitHub PR ${query.repository}#${query.pr} did not return a complete merge state`,
    )
  return {
    repository: parsed.repository,
    pr: parsed.pr,
    merged: parsed.merged,
    mergeSha: parsed.mergeSha.toLowerCase(),
    base: parsed.base,
    headSha: parsed.headSha.toLowerCase(),
    headRef: parsed.headRef,
  }
}
function githubRepositoryFromRemote(main: string): string | undefined {
  let url: string
  try {
    url = git(main, ['config', '--get', 'remote.origin.url'])
  } catch {
    return undefined
  }
  const match = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/i)
  return match?.[1]
}
function verifyRemotePr(c: Context, receipt: MergeReceipt, remotePr: RemotePrProbe): RemotePrState {
  const remote = remotePr({ repository: receipt.repository, pr: receipt.pr })
  if (!remote.merged) throw new Error('GitHub PR is not merged; sources are retained')
  if (remote.repository !== receipt.repository || remote.pr !== receipt.pr)
    throw new Error('GitHub PR identity does not match the merge receipt')
  if (remote.base !== 'main') throw new Error('GitHub PR base is not main; sources are retained')
  if (remote.mergeSha !== receipt.merge_sha)
    throw new Error('GitHub merge SHA does not match the merge receipt')
  if (remote.headSha !== receipt.source_head)
    throw new Error('GitHub PR head does not match the reviewed formal HEAD')
  const localRepo = githubRepositoryFromRemote(c.main)
  if (localRepo && localRepo !== receipt.repository)
    throw new Error('Merge receipt repository does not match this checkout')
  if (localRepo && remote.repository !== localRepo)
    throw new Error('GitHub PR is not in this repository')
  return remote
}
function verifyMergeReceipt(
  c: Context,
  b: WorktreeBatch,
  tip: string,
  receiptPath: string,
  remotePr: RemotePrProbe = defaultRemotePrProbe,
): MergeReceipt {
  const receipt = readMergeReceipt(c.cwd, receiptPath)
  if (receipt.source_head !== tip)
    throw new Error('Merge receipt source_head does not match the reviewed formal HEAD')
  if (receipt.reviewed_base !== b.base)
    throw new Error('Merge receipt reviewed_base does not match the sealed batch base')
  if (receipt.merge_sha === receipt.source_head)
    throw new Error('Merge receipt merge SHA must differ from source_head for squash merge')
  assertMain(c)
  try {
    git(c.main, ['rev-parse', '--verify', `${receipt.merge_sha}^{commit}`])
  } catch {
    throw new Error('Merge receipt merge SHA is not a commit in the main repository')
  }
  try {
    fetchOriginMain(c)
    git(c.main, ['merge-base', '--is-ancestor', receipt.merge_sha, 'refs/remotes/origin/main'])
  } catch {
    throw new Error('Merge receipt merge SHA is not reachable from main; sources are retained')
  }
  const parents = git(c.main, ['rev-list', '--parents', '-n', '1', receipt.merge_sha]).split(/\s+/)
  if (parents.length !== 2)
    throw new Error('Merge receipt merge SHA must be a single-parent squash commit')
  if (parents[1] !== b.base)
    throw new Error('Merge parent is not the reviewed base; refresh and re-review the candidate')
  const candidateTree = git(c.main, ['rev-parse', `${tip}^{tree}`])
  if (receipt.candidate_tree !== candidateTree)
    throw new Error('Merge receipt candidate tree does not match the reviewed formal HEAD')
  const mergeTree = git(c.main, ['rev-parse', `${receipt.merge_sha}^{tree}`])
  if (mergeTree !== candidateTree)
    throw new Error(
      'Merged tree does not match the reviewed candidate; binary, rename or file mode drift is retained',
    )
  const reviewedPatchId = patchId(c.main, b.base, tip)
  if (receipt.content_patch_id !== reviewedPatchId)
    throw new Error('Merge receipt content patch does not match the reviewed candidate')
  if (patchId(c.main, `${receipt.merge_sha}^`, receipt.merge_sha) !== reviewedPatchId)
    throw new Error('Merged commit content patch does not match the reviewed candidate')
  const remote = verifyRemotePr(c, receipt, remotePr)
  assertReceiptReusesDraft(c, b, receipt, remote.headRef)
  return receipt
}
function landSealedBatch(
  cwd: string,
  landing: { kind: 'trunk' } | { kind: 'pr'; receipt: string; remotePr?: RemotePrProbe },
) {
  const c = context(cwd)
  return mutate(c, (s) => {
    const b = active(s)
    if (b.phase !== 'sealed') throw new Error('Batch must be sealed after /commit gates')
    const tip = formalHead(c, b)
    verifyMembers(c, b)
    if (landing.kind === 'pr') {
      if (b.workflow !== 'pr-merge-based')
        throw new Error('Trunk workflow does not accept a PR merge receipt')
      b.mergeReceipt = verifyMergeReceipt(
        c,
        b,
        tip,
        landing.receipt,
        landing.remotePr ?? defaultRemotePrProbe,
      )
    } else {
      assertMain(c)
      if (b.workflow !== 'trunk-based')
        throw new Error('PR workflow: merge the PR, then batch confirm-merged')
      // An exact tip proves an interrupted fast-forward already finished; only the journal needs repair.
      if (head(c.main) !== tip) {
        if (head(c.main) !== b.base) throw new Error('Main advanced: repeat integration and review')
        assertLandingPreservesMain(c, b.base, tip)
        clearStaleIndexLock(c.main)
        git(c.main, ['merge', '--ff-only', tip])
      }
    }
    b.landedHead = tip
    b.phase = 'landed'
    save(c, s)
    return b
  })
}
export function landBatch(cwd: string) {
  return landSealedBatch(cwd, { kind: 'trunk' })
}
export function confirmMergedBatch(
  cwd: string,
  receipt: string,
  remotePr: RemotePrProbe = defaultRemotePrProbe,
) {
  return landSealedBatch(cwd, { kind: 'pr', receipt, remotePr })
}
export function cleanupBatches(
  cwd: string,
  lifecycle: BatchLifecycle = defaultLifecycle,
  detect: ProcessProbe = detectPublishInFlight,
  resolveProfile: PreservationProfileResolver = defaultPreservationProfile,
) {
  const c = context(cwd)
  const cleanupLifecycle: BatchLifecycle = { ...defaultLifecycle, ...lifecycle }
  const profileResolver =
    resolveProfile === defaultPreservationProfile ? profileResolverForRoot(c.main) : resolveProfile
  // Batch cleanup mutates the shared worktree/ref topology. Keep the same
  // fail-closed publish/propagate guard as the other main-tree lifecycle
  // operations; an in-flight projection must not observe the transition.
  assertNoPublishInFlight('batch cleanup', c.main, false, detect)
  return mutate(c, (s) => {
    const results: {
      batch: string
      removed: string[]
      retained: { path: string; reason: string }[]
      preserved: { path: string; archive: string }[]
    }[] = []
    for (const b of s.batches.filter((candidate) => candidate.phase === 'landed')) {
      const result = {
        batch: b.id,
        removed: [] as string[],
        retained: [] as { path: string; reason: string }[],
        preserved: [...(b.preserved ?? [])],
      }
      const landedCommit = b.mergeReceipt?.merge_sha ?? b.landedHead!
      git(c.main, ['merge-base', '--is-ancestor', landedCommit, 'refs/heads/main'])
      // The batch lock is held for the whole loop and nothing here writes a claim,
      // so one read serves every member instead of one directory scan each.
      const claimsObs = readActiveClaimsObserved(c.main)
      for (const [index, m] of b.members.entries()) {
        if (b.removed.includes(m.path)) continue
        if (b.removing && b.removing.path !== m.path) {
          result.retained.push({
            path: m.path,
            reason: `another removal is still journaled for ${b.removing.path}`,
          })
          continue
        }
        let reason = m.retain
        let removal = b.removing?.path === m.path ? b.removing : undefined
        const currentWorktrees = worktrees(c.main)
        const wt = currentWorktrees.find((w) => w.path === m.path)
        const quarantineWorktree = removal
          ? currentWorktrees.find((w) => w.path === removal.quarantine)
          : undefined
        if (wt && !removal) {
          // A crash mid-teardown can leave the tree half-detached — the
          // fsynced `modules` rename persisted while a checkout `.git`
          // rename was lost — and the `git status` inside sourceProblem
          // throws on the dangling pointer before recovery could run.
          // The teardown journal names exactly what our detach recorded,
          // so normalize first — but only while nothing owns the tree:
          // a lock, an active claim, or an unreadable claim store means
          // the half-detached state belongs to another writer and our
          // renames must not land inside it.
          // The registry path alone does not prove the tree at m.path is
          // ours — a foreign directory or worktree can squat on a stale
          // registered name — so restore only targets the physically
          // proven checkout of this branch, and only under the
          // writer-ownership probe plus claim/lock gate.
          const provenTree = registeredWorktreePath(c, m.branch)
          restoreOwned(c, cleanupLifecycle, provenTree, m.branch, [])
          try {
            reason ||= sourceProblem(c, m)
          } catch (error) {
            // A half-detached tree whose normalize was skipped or failed
            // makes `git status` throw — retain rather than abort the batch.
            reason ||= errorMessage(error)
          }
        }
        let branchHead: string | undefined
        try {
          branchHead = git(c.main, ['rev-parse', '--verify', m.branch])
        } catch {
          /* already deleted */
        }
        if (branchHead && branchHead !== m.head) reason ||= 'source branch advanced'
        if (claimsObs.status === 'unknown') reason ||= `claims unknown: ${claimsObs.reason}`
        else if (
          claimsObs.value.some(
            (cl) =>
              cl.worktree_path === m.path ||
              cl.worktree_path === removal?.quarantine ||
              cl.branch === m.branch ||
              cl.branch === m.branch.replace('refs/heads/', ''),
          )
        )
          reason ||= 'source has an active claim'
        if (reason) {
          result.retained.push({ path: m.path, reason })
          continue
        }
        const retiredArchive =
          !wt && !removal && !existsSync(m.path) && retiredByHandoff(c, m.path, m.branch, m.head)
        if (retiredArchive) {
          if (branchHead && currentWorktrees.some((other) => other.branch === m.branch)) {
            result.retained.push({
              path: m.path,
              reason: 'Source branch checked out elsewhere; retained',
            })
            continue
          }
          git(c.main, ['update-ref', `refs/clade/batches/${b.id}/${index}`, m.head])
          cleanupLifecycle.removed(c.main, m.path)
          if (branchHead) git(c.main, ['update-ref', '-d', m.branch, m.head])
          b.preserved = [...(b.preserved ?? []), { path: m.path, archive: retiredArchive }]
          b.removed.push(m.path)
          result.removed.push(m.path)
          save(c, s)
          continue
        }
        const profile = profileResolver(m.path, join(c.dir, 'preservation'))
        if (!profile) {
          result.retained.push({
            path: m.path,
            reason: 'preservation profile missing; source retained',
          })
          continue
        }
        try {
          validateProfile(profile)
        } catch (error) {
          result.retained.push({
            path: m.path,
            reason: String(error),
          })
          continue
        }
        if (!wt && !removal && !hasVerifiedPreservation(b, m.path, profile)) {
          result.retained.push({
            path: m.path,
            reason: 'source worktree missing and no verified preservation receipt',
          })
          continue
        }
        if (removal && !wt && !quarantineWorktree && existsSync(removal.quarantine)) {
          result.retained.push({
            path: m.path,
            reason: 'removal quarantine is not a registered worktree; retain for inspection',
          })
          continue
        }
        if (
          removal &&
          !wt &&
          !quarantineWorktree &&
          !existsSync(removal.quarantine) &&
          !hasVerifiedPreservation(b, m.path, profile)
        ) {
          result.retained.push({
            path: m.path,
            reason: 'removal journal has no verified preservation receipt',
          })
          continue
        }
        try {
          const quarantinePresent = Boolean(
            removal && (quarantineWorktree || existsSync(removal.quarantine)),
          )
          const ownershipPath = wt ? m.path : quarantinePresent ? removal!.quarantine : m.path
          withExclusiveWriterOwnership(cleanupLifecycle, c.main, ownershipPath, () => {
            if (wt || quarantinePresent) {
              const cleanupPath = wt ? m.path : removal!.quarantine
              const quarantine =
                removal?.quarantine ??
                join(dirname(m.path), '.clade-removing-' + basename(m.path) + '-' + randomUUID())
              // Attach the write observer before preservation and teardown:
              // a foreign create+delete anywhere in this window leaves no
              // post-move trace, so the helper scans this pre-move segment
              // for foreign activity before removing.
              let handoffObserver: WriteObserver | undefined
              if (!removal) {
                // The tree was already normalized before sourceProblem —
                // the teardown journal names every rename our detach
                // recorded, so a clean tree is a stat's worth of no-op.
                try {
                  const common = git(m.path, [
                    'rev-parse',
                    '--path-format=absolute',
                    '--git-common-dir',
                  ])
                  handoffObserver = observeQuarantineWrites(
                    m.path,
                    gitWorktreeMetadataRoots(m.path, common),
                  )
                } catch (error) {
                  throw new Error(
                    `ownership handoff cannot observe source writes; retain worktree (${error})`,
                    { cause: error },
                  )
                }
              }
              try {
                let receipt: PreservationReceipt
                let expectedInventory: SourceInventory
                if (removal) {
                  const archive = b.preserved?.findLast((entry) => entry.path === m.path)?.archive
                  if (!archive)
                    throw new Error('removal journal has no preservation archive; retain worktree')
                  receipt = readPreservationReceipt(archive)
                  expectedInventory = inventoryArchive(
                    receipt.archives.worktree.path,
                    inventoryOptionsFromProfile(profile),
                  )
                } else {
                  receipt = preserveWorktree(c, b, m.path, profile)
                  expectedInventory = inventoryTree(m.path, inventoryOptionsFromProfile(profile))
                }
                if (!removal) save(c, s)
                // A source on a journaled removal is post-teardown: either
                // still in the detached state the baseline describes, or
                // fully restored to the pre-teardown archive state. A
                // partially-restored mixture matches neither and retains. A
                // fully restored source needs teardown and a fresh baseline
                // re-run below before the move can be retried.
                let sourceRestoredToArchive = false
                // undefined until destroy runs this pass; the restore path
                // then uses this run's list, else the journaled one.
                let detachedNow: string[] | undefined
                if (removal?.verifyInventory && existsSync(m.path)) {
                  const options = inventoryOptionsFromProfile(profile)
                  // The journaled baseline governs the live-state
                  // comparison, but it says nothing about the archive
                  // itself — a resume must still prove the recorded
                  // artifacts intact before removal may complete, under
                  // the profile this run resolves.
                  if (!verifyPreservationArchiveIntegrity(receipt.archives.worktree.path, options))
                    throw new Error('preservation archive missing or corrupted; retain worktree')
                  const current = inventoryTree(m.path, options, [join(m.path, '.git')])
                  const treeBaseline =
                    comparableInventory(current) === comparableInventory(removal.verifyInventory)
                  const treeArchive =
                    comparableInventory(current) === comparableInventory(expectedInventory)
                  // A rollback reconcile at a relocated tree rewrites `.git`
                  // pointers and module `core.worktree` — archive-equal can
                  // never match that, so the relocated state is the third
                  // accepted shape, verified per differing entry.
                  const treeRelocated =
                    !treeBaseline &&
                    !treeArchive &&
                    (() => {
                      const adminDir = git(m.path, [
                        'rev-parse',
                        '--path-format=absolute',
                        '--git-dir',
                      ])
                      return treeInventoryMatchesRelocated(
                        receipt.archives.worktree.path,
                        current,
                        m.path,
                        basename(adminDir),
                        join(adminDir, 'modules'),
                        options,
                      )
                    })()
                  if (!treeBaseline && !treeArchive && !treeRelocated)
                    throw new Error(
                      'restored source changed after interrupted removal; retain worktree',
                    )
                  // Tree and private Git metadata must agree on ONE state —
                  // baseline (still torn down), archive (byte-restored), or
                  // relocated (restored with reconcile rewrites). A side
                  // teardown never touched matches both labels, so a
                  // git-only teardown restores to `tree-baseline-and-archive
                  // + git-archive`: consistent, and still needs re-teardown.
                  // Only a genuine cross — sides in different states — is a
                  // partially-restored mixture.
                  let gitBaseline = true
                  let gitArchive = true
                  let gitRelocated = true
                  if (removal.verifyGit) {
                    const currentCommon = git(m.path, [
                      'rev-parse',
                      '--path-format=absolute',
                      '--git-common-dir',
                    ])
                    const archiveRoot = dirname(dirname(receipt.archives.worktree.path))
                    const currentGit = liveGitInventory(m.path, currentCommon, archiveRoot, profile)
                    gitBaseline =
                      comparableInventory(currentGit) === comparableInventory(removal.verifyGit)
                    const gitdirRecords = gitArchiveExclusions(
                      gitWorktreeMetadataRoots(m.path, currentCommon),
                      currentCommon,
                    )
                    gitArchive =
                      Boolean(receipt.archives.git) &&
                      comparableInventory(currentGit) ===
                        comparableInventory(
                          inventoryArchive(receipt.archives.git!.path, options, gitdirRecords),
                        )
                    gitRelocated =
                      !gitBaseline &&
                      !gitArchive &&
                      Boolean(receipt.archives.git) &&
                      Boolean(receipt.source.gitCommonDir) &&
                      gitInventoryMatchesRelocated(
                        receipt.archives.git!.path,
                        currentGit,
                        currentCommon,
                        m.path,
                        receipt.source.path,
                        receipt.source.gitCommonDir!,
                        options,
                        gitdirRecords,
                      )
                    if (!gitBaseline && !gitArchive && !gitRelocated)
                      throw new Error(
                        'restored source Git metadata changed after interrupted removal; retain worktree',
                      )
                  }
                  if (
                    !resumeStatesCompatible(
                      { baseline: treeBaseline, restored: treeArchive || treeRelocated },
                      { baseline: gitBaseline, restored: gitArchive || gitRelocated },
                    )
                  )
                    throw new Error(
                      'restored source mixes detached and restored state; retain worktree',
                    )
                  sourceRestoredToArchive = !(treeBaseline && gitBaseline)
                } else if (
                  !verifyPreservationArchive(
                    receipt.archives.worktree.path,
                    m.path,
                    inventoryOptionsFromProfile(profile),
                  )
                )
                  throw new Error('source changed after preservation capture; retain worktree')
                // A post-move failure can also leave the tree restored
                // inside the quarantine — its journaled detached baseline
                // then mismatches forever. Accept the detached baseline or
                // a full restore to the archive; a restored quarantine is
                // re-torn-down under fresh observation before the move is
                // retried, never compared against the stale baseline.
                if (removal?.verifyInventory && !wt && quarantinePresent) {
                  const options = inventoryOptionsFromProfile(profile)
                  const current = inventoryTree(removal.quarantine, options, [
                    join(removal.quarantine, '.git'),
                  ])
                  const treeBaseline =
                    comparableInventory(current) === comparableInventory(removal.verifyInventory)
                  const treeArchive =
                    comparableInventory(current) === comparableInventory(expectedInventory)
                  // Same relocated third state as the source path: a
                  // rollback restore inside the quarantine rewrote `.git`
                  // pointers and `core.worktree` for this location, so it
                  // matches the archive only modulo those rewrites.
                  const treeRelocated =
                    !treeBaseline &&
                    !treeArchive &&
                    (() => {
                      const adminDir = git(removal.quarantine, [
                        'rev-parse',
                        '--path-format=absolute',
                        '--git-dir',
                      ])
                      return treeInventoryMatchesRelocated(
                        receipt.archives.worktree.path,
                        current,
                        removal.quarantine,
                        basename(adminDir),
                        join(adminDir, 'modules'),
                        options,
                      )
                    })()
                  if (!treeBaseline && !treeArchive && !treeRelocated)
                    throw new Error(
                      'quarantined source changed after interrupted removal; retain worktree',
                    )
                  // Same single-state rule as the source path: baseline,
                  // archive, or relocated on both inventories; a side
                  // teardown never touched satisfies either, and only a
                  // genuine cross is a partially-restored mixture.
                  let gitBaseline = true
                  let gitArchive = true
                  let gitRelocated = true
                  if (removal.verifyGit) {
                    const currentCommon = git(removal.quarantine, [
                      'rev-parse',
                      '--path-format=absolute',
                      '--git-common-dir',
                    ])
                    const archiveRoot = dirname(dirname(receipt.archives.worktree.path))
                    const currentGit = liveGitInventory(
                      removal.quarantine,
                      currentCommon,
                      archiveRoot,
                      profile,
                    )
                    gitBaseline =
                      comparableInventory(currentGit) === comparableInventory(removal.verifyGit)
                    const gitdirRecords = gitArchiveExclusions(
                      gitWorktreeMetadataRoots(removal.quarantine, currentCommon),
                      currentCommon,
                    )
                    gitArchive =
                      Boolean(receipt.archives.git) &&
                      comparableInventory(currentGit) ===
                        comparableInventory(
                          inventoryArchive(receipt.archives.git!.path, options, gitdirRecords),
                        )
                    gitRelocated =
                      !gitBaseline &&
                      !gitArchive &&
                      Boolean(receipt.archives.git) &&
                      Boolean(receipt.source.gitCommonDir) &&
                      gitInventoryMatchesRelocated(
                        receipt.archives.git!.path,
                        currentGit,
                        currentCommon,
                        removal.quarantine,
                        receipt.source.path,
                        receipt.source.gitCommonDir!,
                        options,
                        gitdirRecords,
                      )
                    if (!gitBaseline && !gitArchive && !gitRelocated)
                      throw new Error(
                        'quarantined source Git metadata changed after interrupted removal; retain worktree',
                      )
                  }
                  if (
                    !resumeStatesCompatible(
                      { baseline: treeBaseline, restored: treeArchive || treeRelocated },
                      { baseline: gitBaseline, restored: gitArchive || gitRelocated },
                    )
                  )
                    throw new Error(
                      'quarantined source mixes detached and restored state; retain worktree',
                    )
                  const restoredState = !(treeBaseline && gitBaseline)
                  if (restoredState) {
                    // Re-observe before re-detach so a foreign
                    // create+delete inside the window cannot pass
                    // unreported, then re-run teardown and journal the
                    // fresh baseline the move verifies against.
                    try {
                      const common = git(removal.quarantine, [
                        'rev-parse',
                        '--path-format=absolute',
                        '--git-common-dir',
                      ])
                      handoffObserver = observeQuarantineWrites(
                        removal.quarantine,
                        gitWorktreeMetadataRoots(removal.quarantine, common),
                      )
                    } catch (error) {
                      throw new Error(
                        `ownership handoff cannot observe source writes; retain worktree (${error})`,
                        { cause: error },
                      )
                    }
                    detachedNow = asDetachedList(
                      cleanupLifecycle.destroy(c.main, removal.quarantine),
                    )
                    const baseline = captureVerifyBaseline(removal.quarantine, receipt, profile)
                    b.removing!.verifyInventory = baseline.worktree
                    b.removing!.verifyGit = baseline.git
                    b.removing!.detachedPointers = detachedNow
                    save(c, s)
                  }
                }
                if (!removal || sourceRestoredToArchive) {
                  if (sourceRestoredToArchive && !handoffObserver) {
                    // The restored source is pre-teardown again: re-observe
                    // so a foreign create+delete inside the re-run's window
                    // cannot pass unreported.
                    try {
                      const common = git(m.path, [
                        'rev-parse',
                        '--path-format=absolute',
                        '--git-common-dir',
                      ])
                      handoffObserver = observeQuarantineWrites(
                        m.path,
                        gitWorktreeMetadataRoots(m.path, common),
                      )
                    } catch (error) {
                      throw new Error(
                        `ownership handoff cannot observe source writes; retain worktree (${error})`,
                        { cause: error },
                      )
                    }
                  }
                  const sourceProblemAfterCapture = sourceProblem(c, m)
                  if (sourceProblemAfterCapture) throw new Error(sourceProblemAfterCapture)
                  detachedNow = asDetachedList(cleanupLifecycle.destroy(c.main, m.path))
                }
                // Any failure between destroy and the journal save leaves
                // the detach unrecorded — restore the explicitly listed
                // names so the retained worktree stays functional.
                try {
                  if (!removal || sourceRestoredToArchive) {
                    const postDestroyProblem = sourceProblem(c, m)
                    if (postDestroyProblem) throw new Error(postDestroyProblem)
                  }
                  requireKnownNoClaim(
                    c.main,
                    cleanupPath,
                    'Source changed during writer handoff or has active owner',
                  )
                  if (!removal || sourceRestoredToArchive) {
                    const baseline = captureVerifyBaseline(m.path, receipt, profile)
                    if (!removal) {
                      b.removing = {
                        path: m.path,
                        quarantine,
                        verifyInventory: baseline.worktree,
                        verifyGit: baseline.git,
                        detachedPointers: detachedNow,
                      }
                    } else {
                      b.removing!.verifyInventory = baseline.worktree
                      b.removing!.verifyGit = baseline.git
                      b.removing!.detachedPointers = detachedNow
                    }
                    save(c, s)
                  }
                } catch (error) {
                  // Restore where the registry says the tree actually
                  // lies: the source path, the journaled quarantine, or a
                  // nested move-back location — and never a foreign path
                  // squatting on any of those names.
                  const tree = registeredWorktreePath(c, m.branch)
                  restoreOwned(
                    c,
                    cleanupLifecycle,
                    tree,
                    m.branch,
                    detachedNow ?? removal?.detachedPointers ?? [],
                  )
                  throw error
                }
                // Persist the pending concern and trash destination BEFORE the
                // move: a crash between rename and the post-removal save must
                // resume into reconcile-required, never a silent clear.
                b.removing!.trash = join(
                  dirname(m.path),
                  '.clade-trashed-' + basename(m.path) + '-' + randomUUID(),
                )
                b.removing!.removalConcern =
                  'removal interrupted before post-removal checks completed'
                save(c, s)
                removeWorktreeAfterVerification(
                  c.main,
                  m.path,
                  expectedInventory,
                  profile,
                  receipt,
                  quarantine,
                  () => cleanupLifecycle.beforeMove?.(c.main, m.path),
                  () => cleanupLifecycle.afterHandoff?.(c.main, m.path),
                  (q) => cleanupLifecycle.beforeRemove?.(c.main, q),
                  (roots) => cleanupLifecycle.afterRemove?.(c.main, m.path, roots),
                  b.removing!.trash,
                  handoffObserver,
                  {
                    worktree: b.removing!.verifyInventory,
                    git: b.removing!.verifyGit,
                  },
                  (tree) =>
                    restoreOwned(
                      c,
                      cleanupLifecycle,
                      tree,
                      m.branch,
                      b.removing?.detachedPointers ?? [],
                    ),
                )
                delete b.removing
              } finally {
                // Stopping an already-stopped observer is a no-op.
                handoffObserver?.stop()
              }
            } else if (removal) {
              // Both paths are gone — removal physically completed, possibly
              // after a late-write report. Re-run the deleted-handle scan,
              // then a recorded removal concern still retains the entry:
              // clearing the journal requires explicit reconciliation, not
              // an automatic pass. The bytes still live under the journaled
              // trash path when one was recorded.
              cleanupLifecycle.afterRemove?.(c.main, m.path, removalScanRoots(c, removal.trash))
              if (removal.removalConcern)
                throw new Error(
                  `${removal.removalConcern}; requires reconciliation` +
                    (removal.trash && existsSync(removal.trash)
                      ? `; preserved bytes at ${removal.trash}`
                      : ''),
                )
              delete b.removing
            }
            git(c.main, ['update-ref', `refs/clade/batches/${b.id}/${index}`, m.head])
            cleanupLifecycle.removed(c.main, m.path)
            if (branchHead) {
              if (worktrees(c.main).some((other) => other.branch === m.branch))
                throw new Error('Source branch checked out elsewhere; retained')
              git(c.main, ['update-ref', '-d', m.branch, m.head])
            }
            b.removed.push(m.path)
            result.removed.push(m.path)
            save(c, s)
          })
        } catch (error) {
          // A post-removal failure must not silently resolve on the next run:
          // when the physical delete already happened, record the concern in
          // the journal so the resume path retains it for reconciliation.
          if (
            b.removing?.path === m.path &&
            !existsSync(m.path) &&
            !existsSync(b.removing.quarantine)
          ) {
            b.removing.removalConcern = String(error)
            try {
              save(c, s)
            } catch {
              // Journal write best-effort; the retained entry still reports it.
            }
          }
          // A retained worktree that still carries teardown-detached
          // submodule pointers gets them back so the owner keeps a
          // functional tree; only names the teardown journal recorded are
          // touched, and the journal — not the batch journal — is the
          // authority, so a destroy that throws before `removing` is
          // journaled is covered the same way. The helper's own restore
          // may already have run — re-running on an intact tree is a
          // no-op.
          const retainedTree = registeredWorktreePath(c, m.branch)
          restoreOwned(
            c,
            cleanupLifecycle,
            retainedTree,
            m.branch,
            b.removing?.path === m.path ? (b.removing.detachedPointers ?? []) : [],
          )
          result.retained.push({ path: m.path, reason: String(error) })
        }
      }
      if (b.removed.length === b.members.length) {
        try {
          let removal = b.removing?.path === b.path ? b.removing : undefined
          const currentWorktrees = worktrees(c.main)
          const wt = currentWorktrees.find((w) => w.path === b.path)
          const quarantineWorktree = removal
            ? currentWorktrees.find((w) => w.path === removal.quarantine)
            : undefined
          const retiredArchive =
            !wt &&
            !removal &&
            !existsSync(b.path) &&
            retiredByHandoff(c, b.path, b.branch, b.landedHead!)
          if (retiredArchive) {
            requireKnownNoClaim(c.main, b.path, 'Integration has new work, lock or active owner')
            const ref = `refs/heads/${b.branch}`
            if (currentWorktrees.some((other) => other.branch === ref))
              throw new Error('Integration branch checked out elsewhere; retained')
            cleanupLifecycle.removed(c.main, b.path)
            if (git(c.main, ['for-each-ref', '--format=%(refname)', ref]))
              git(c.main, ['update-ref', '-d', ref, b.landedHead!])
            b.preserved = [...(b.preserved ?? []), { path: b.path, archive: retiredArchive }]
            b.phase = 'cleaned'
            s.ready = s.ready.filter((m) => !b.members.some((source) => source.path === m.path))
            save(c, s)
            result.preserved = [...(b.preserved ?? [])]
            results.push(result)
            continue
          }
          const profile = profileResolver(b.path, join(c.dir, 'preservation'))
          if (!profile) throw new Error('preservation profile missing; source retained')
          validateProfile(profile)
          if (!wt && !removal && !hasVerifiedPreservation(b, b.path, profile))
            throw new Error('integration worktree missing and no verified preservation receipt')
          if (removal && !wt && !quarantineWorktree && existsSync(removal.quarantine))
            throw new Error(
              'removal quarantine is not a registered worktree; retain for inspection',
            )
          if (
            removal &&
            !wt &&
            !quarantineWorktree &&
            !existsSync(removal.quarantine) &&
            !hasVerifiedPreservation(b, b.path, profile)
          )
            throw new Error('removal journal has no verified preservation receipt')
          const quarantinePresent = Boolean(
            removal && (quarantineWorktree || existsSync(removal.quarantine)),
          )
          const ownershipPath = wt ? b.path : quarantinePresent ? removal!.quarantine : b.path
          withExclusiveWriterOwnership(cleanupLifecycle, c.main, ownershipPath, () => {
            requireKnownNoClaim(c.main, b.path, 'Integration has new work, lock or active owner')
            requireKnownNoClaim(
              c.main,
              ownershipPath,
              'Integration has new work, lock or active owner',
            )
            if (removal)
              requireKnownNoClaim(
                c.main,
                removal.quarantine,
                'Integration has new work, lock or active owner',
              )
            if (wt || quarantinePresent) {
              const cleanupPath = wt ? b.path : removal!.quarantine
              if (wt && !removal) {
                // Same crash window as the member path: the fsynced
                // `modules` rename can persist while a checkout `.git`
                // rename is lost, and `clean()` below throws on the
                // dangling pointer before recovery could run. The
                // teardown journal names exactly what our detach did —
                // normalize first; a clean tree is a single read. The
                // restore targets only the physically proven checkout of
                // this branch, under the writer-ownership probe plus the
                // claim/lock gate.
                const provenTree = registeredWorktreePath(c, `refs/heads/${b.branch}`)
                restoreOwned(c, cleanupLifecycle, provenTree, `refs/heads/${b.branch}`, [])
              }
              if (
                (!removal && wt?.locked) ||
                (!removal && !clean(b.path)) ||
                (!removal && head(b.path) !== b.landedHead)
              )
                throw new Error('Integration has new work, lock or active owner')
              if (!removal)
                requireKnownNoClaim(
                  c.main,
                  b.path,
                  'Integration has new work, lock or active owner',
                )
              if (removal)
                requireKnownNoClaim(
                  c.main,
                  removal.quarantine,
                  'Integration has new work, lock or active owner',
                )
              const quarantine =
                removal?.quarantine ??
                join(dirname(b.path), '.clade-removing-' + basename(b.path) + '-' + randomUUID())
              // Same observer-early-attach as the member path: the
              // preservation + teardown window is observed for foreign
              // create+delete activity before removal runs.
              let handoffObserver: WriteObserver | undefined
              if (!removal) {
                // The tree was already normalized above, before the clean
                // check that would throw on a half-torn-down submodule.
                try {
                  const common = git(b.path, [
                    'rev-parse',
                    '--path-format=absolute',
                    '--git-common-dir',
                  ])
                  handoffObserver = observeQuarantineWrites(
                    b.path,
                    gitWorktreeMetadataRoots(b.path, common),
                  )
                } catch (error) {
                  throw new Error(
                    `ownership handoff cannot observe integration writes; retain worktree (${error})`,
                    { cause: error },
                  )
                }
              }
              try {
                let receipt: PreservationReceipt
                let expectedInventory: SourceInventory
                if (removal) {
                  const archive = b.preserved?.findLast((entry) => entry.path === b.path)?.archive
                  if (!archive)
                    throw new Error('removal journal has no preservation archive; retain worktree')
                  receipt = readPreservationReceipt(archive)
                  expectedInventory = inventoryArchive(
                    receipt.archives.worktree.path,
                    inventoryOptionsFromProfile(profile),
                  )
                } else {
                  receipt = preserveWorktree(c, b, b.path, profile)
                  expectedInventory = inventoryTree(b.path, inventoryOptionsFromProfile(profile))
                  save(c, s)
                }
                // Same post-teardown baseline rule as the member path: a
                // journaled source is either still detached (baseline) or
                // fully restored to the pre-teardown archive state, and a
                // restored source re-runs teardown with a fresh baseline.
                let sourceRestoredToArchive = false
                // undefined until destroy runs this pass; the restore path
                // then uses this run's list, else the journaled one.
                let detachedNow: string[] | undefined
                if (removal?.verifyInventory && existsSync(b.path)) {
                  const options = inventoryOptionsFromProfile(profile)
                  // Same archive-integrity rule as the member path: the
                  // baseline comparison cannot substitute for proving the
                  // recorded artifacts survive undamaged — under the
                  // profile this run resolves.
                  if (!verifyPreservationArchiveIntegrity(receipt.archives.worktree.path, options))
                    throw new Error('preservation archive missing or corrupted; retain worktree')
                  const current = inventoryTree(b.path, options, [join(b.path, '.git')])
                  const treeBaseline =
                    comparableInventory(current) === comparableInventory(removal.verifyInventory)
                  const treeArchive =
                    comparableInventory(current) === comparableInventory(expectedInventory)
                  // Same relocated third state as the member path: a
                  // rollback reconcile rewrites `.git` pointers and module
                  // `core.worktree`, so a restored tree matches the archive
                  // only modulo those rewrites.
                  const treeRelocated =
                    !treeBaseline &&
                    !treeArchive &&
                    (() => {
                      const adminDir = git(b.path, [
                        'rev-parse',
                        '--path-format=absolute',
                        '--git-dir',
                      ])
                      return treeInventoryMatchesRelocated(
                        receipt.archives.worktree.path,
                        current,
                        b.path,
                        basename(adminDir),
                        join(adminDir, 'modules'),
                        options,
                      )
                    })()
                  if (!treeBaseline && !treeArchive && !treeRelocated)
                    throw new Error(
                      'restored integration changed after interrupted removal; retain worktree',
                    )
                  // Same single-state rule as the member path: baseline,
                  // archive, or relocated on both inventories, with an
                  // untouched side satisfying either.
                  let gitBaseline = true
                  let gitArchive = true
                  let gitRelocated = true
                  if (removal.verifyGit) {
                    const currentCommon = git(b.path, [
                      'rev-parse',
                      '--path-format=absolute',
                      '--git-common-dir',
                    ])
                    const archiveRoot = dirname(dirname(receipt.archives.worktree.path))
                    const currentGit = liveGitInventory(b.path, currentCommon, archiveRoot, profile)
                    gitBaseline =
                      comparableInventory(currentGit) === comparableInventory(removal.verifyGit)
                    const gitdirRecords = gitArchiveExclusions(
                      gitWorktreeMetadataRoots(b.path, currentCommon),
                      currentCommon,
                    )
                    gitArchive =
                      Boolean(receipt.archives.git) &&
                      comparableInventory(currentGit) ===
                        comparableInventory(
                          inventoryArchive(receipt.archives.git!.path, options, gitdirRecords),
                        )
                    gitRelocated =
                      !gitBaseline &&
                      !gitArchive &&
                      Boolean(receipt.archives.git) &&
                      Boolean(receipt.source.gitCommonDir) &&
                      gitInventoryMatchesRelocated(
                        receipt.archives.git!.path,
                        currentGit,
                        currentCommon,
                        b.path,
                        receipt.source.path,
                        receipt.source.gitCommonDir!,
                        options,
                        gitdirRecords,
                      )
                    if (!gitBaseline && !gitArchive && !gitRelocated)
                      throw new Error(
                        'restored integration Git metadata changed after interrupted removal; retain worktree',
                      )
                  }
                  if (
                    !resumeStatesCompatible(
                      { baseline: treeBaseline, restored: treeArchive || treeRelocated },
                      { baseline: gitBaseline, restored: gitArchive || gitRelocated },
                    )
                  )
                    throw new Error(
                      'restored integration mixes detached and restored state; retain worktree',
                    )
                  sourceRestoredToArchive = !(treeBaseline && gitBaseline)
                } else if (
                  !verifyPreservationArchive(
                    receipt.archives.worktree.path,
                    b.path,
                    inventoryOptionsFromProfile(profile),
                  )
                )
                  throw new Error('integration changed after preservation capture; retain worktree')
                // Same quarantine-restore rule as the member path: a
                // post-move failure can leave the integration tree restored
                // inside the quarantine, so it is accepted in either the
                // detached baseline or fully-restored state and re-torn-down
                // under fresh observation before the move retries.
                if (removal?.verifyInventory && !wt && quarantinePresent) {
                  const options = inventoryOptionsFromProfile(profile)
                  const current = inventoryTree(removal.quarantine, options, [
                    join(removal.quarantine, '.git'),
                  ])
                  const treeBaseline =
                    comparableInventory(current) === comparableInventory(removal.verifyInventory)
                  const treeArchive =
                    comparableInventory(current) === comparableInventory(expectedInventory)
                  // Same relocated third state: a rollback restore inside
                  // the quarantine rewrote `.git` pointers and
                  // `core.worktree` for this location.
                  const treeRelocated =
                    !treeBaseline &&
                    !treeArchive &&
                    (() => {
                      const adminDir = git(removal.quarantine, [
                        'rev-parse',
                        '--path-format=absolute',
                        '--git-dir',
                      ])
                      return treeInventoryMatchesRelocated(
                        receipt.archives.worktree.path,
                        current,
                        removal.quarantine,
                        basename(adminDir),
                        join(adminDir, 'modules'),
                        options,
                      )
                    })()
                  if (!treeBaseline && !treeArchive && !treeRelocated)
                    throw new Error(
                      'quarantined integration changed after interrupted removal; retain worktree',
                    )
                  let gitBaseline = true
                  let gitArchive = true
                  let gitRelocated = true
                  if (removal.verifyGit) {
                    const currentCommon = git(removal.quarantine, [
                      'rev-parse',
                      '--path-format=absolute',
                      '--git-common-dir',
                    ])
                    const archiveRoot = dirname(dirname(receipt.archives.worktree.path))
                    const currentGit = liveGitInventory(
                      removal.quarantine,
                      currentCommon,
                      archiveRoot,
                      profile,
                    )
                    gitBaseline =
                      comparableInventory(currentGit) === comparableInventory(removal.verifyGit)
                    const gitdirRecords = gitArchiveExclusions(
                      gitWorktreeMetadataRoots(removal.quarantine, currentCommon),
                      currentCommon,
                    )
                    gitArchive =
                      Boolean(receipt.archives.git) &&
                      comparableInventory(currentGit) ===
                        comparableInventory(
                          inventoryArchive(receipt.archives.git!.path, options, gitdirRecords),
                        )
                    gitRelocated =
                      !gitBaseline &&
                      !gitArchive &&
                      Boolean(receipt.archives.git) &&
                      Boolean(receipt.source.gitCommonDir) &&
                      gitInventoryMatchesRelocated(
                        receipt.archives.git!.path,
                        currentGit,
                        currentCommon,
                        removal.quarantine,
                        receipt.source.path,
                        receipt.source.gitCommonDir!,
                        options,
                        gitdirRecords,
                      )
                    if (!gitBaseline && !gitArchive && !gitRelocated)
                      throw new Error(
                        'quarantined integration Git metadata changed after interrupted removal; retain worktree',
                      )
                  }
                  if (
                    !resumeStatesCompatible(
                      { baseline: treeBaseline, restored: treeArchive || treeRelocated },
                      { baseline: gitBaseline, restored: gitArchive || gitRelocated },
                    )
                  )
                    throw new Error(
                      'quarantined integration mixes detached and restored state; retain worktree',
                    )
                  const restoredState = !(treeBaseline && gitBaseline)
                  if (restoredState) {
                    try {
                      const common = git(removal.quarantine, [
                        'rev-parse',
                        '--path-format=absolute',
                        '--git-common-dir',
                      ])
                      handoffObserver = observeQuarantineWrites(
                        removal.quarantine,
                        gitWorktreeMetadataRoots(removal.quarantine, common),
                      )
                    } catch (error) {
                      throw new Error(
                        `ownership handoff cannot observe integration writes; retain worktree (${error})`,
                        { cause: error },
                      )
                    }
                    detachedNow = asDetachedList(
                      cleanupLifecycle.destroy(c.main, removal.quarantine),
                    )
                    const baseline = captureVerifyBaseline(removal.quarantine, receipt, profile)
                    b.removing!.verifyInventory = baseline.worktree
                    b.removing!.verifyGit = baseline.git
                    b.removing!.detachedPointers = detachedNow
                    save(c, s)
                  }
                }
                if (!removal || sourceRestoredToArchive) {
                  if (sourceRestoredToArchive && !handoffObserver) {
                    try {
                      const common = git(b.path, [
                        'rev-parse',
                        '--path-format=absolute',
                        '--git-common-dir',
                      ])
                      handoffObserver = observeQuarantineWrites(
                        b.path,
                        gitWorktreeMetadataRoots(b.path, common),
                      )
                    } catch (error) {
                      throw new Error(
                        `ownership handoff cannot observe integration writes; retain worktree (${error})`,
                        { cause: error },
                      )
                    }
                  }
                  detachedNow = asDetachedList(cleanupLifecycle.destroy(c.main, b.path))
                }
                // Same rule as the member path: a failure between destroy
                // and the journal save restores the explicitly listed
                // detaches so the retained worktree stays functional.
                try {
                  if (!removal || sourceRestoredToArchive) {
                    if (!existsSync(b.path) || !clean(b.path) || head(b.path) !== b.landedHead)
                      throw new Error(
                        'Integration changed during writer handoff or has active owner',
                      )
                    requireKnownNoClaim(
                      c.main,
                      b.path,
                      'Integration changed during writer handoff or has active owner',
                    )
                  }
                  requireKnownNoClaim(
                    c.main,
                    cleanupPath,
                    'Integration changed during writer handoff or has active owner',
                  )
                  if (!removal || sourceRestoredToArchive) {
                    const baseline = captureVerifyBaseline(b.path, receipt, profile)
                    if (!removal) {
                      b.removing = {
                        path: b.path,
                        quarantine,
                        verifyInventory: baseline.worktree,
                        verifyGit: baseline.git,
                        detachedPointers: detachedNow,
                      }
                    } else {
                      b.removing!.verifyInventory = baseline.worktree
                      b.removing!.verifyGit = baseline.git
                      b.removing!.detachedPointers = detachedNow
                    }
                    save(c, s)
                  }
                } catch (error) {
                  // Same restore-target rule as the member path: wherever
                  // the registry still names the integration worktree,
                  // and never a foreign path squatting on a journaled name.
                  const tree = registeredWorktreePath(c, `refs/heads/${b.branch}`)
                  restoreOwned(
                    c,
                    cleanupLifecycle,
                    tree,
                    `refs/heads/${b.branch}`,
                    detachedNow ?? removal?.detachedPointers ?? [],
                  )
                  throw error
                }
                // Same pre-move pending concern + trash destination as the
                // member path: the journal must reach reconcile-required if
                // we crash mid-remove.
                b.removing!.trash = join(
                  dirname(b.path),
                  '.clade-trashed-' + basename(b.path) + '-' + randomUUID(),
                )
                b.removing!.removalConcern =
                  'removal interrupted before post-removal checks completed'
                save(c, s)
                removeWorktreeAfterVerification(
                  c.main,
                  b.path,
                  expectedInventory,
                  profile,
                  receipt,
                  quarantine,
                  () => cleanupLifecycle.beforeMove?.(c.main, b.path),
                  () => cleanupLifecycle.afterHandoff?.(c.main, b.path),
                  (q) => cleanupLifecycle.beforeRemove?.(c.main, q),
                  (roots) => cleanupLifecycle.afterRemove?.(c.main, b.path, roots),
                  b.removing!.trash,
                  handoffObserver,
                  {
                    worktree: b.removing!.verifyInventory,
                    git: b.removing!.verifyGit,
                  },
                  (tree) =>
                    restoreOwned(
                      c,
                      cleanupLifecycle,
                      tree,
                      `refs/heads/${b.branch}`,
                      b.removing?.detachedPointers ?? [],
                    ),
                )
                delete b.removing
              } finally {
                handoffObserver?.stop()
              }
            } else if (removal) {
              // Same both-paths-gone resume: re-scan held handles, then a
              // recorded removal concern still requires reconciliation, with
              // the journaled trash path surfaced for inspection.
              cleanupLifecycle.afterRemove?.(c.main, b.path, removalScanRoots(c, removal.trash))
              if (removal.removalConcern)
                throw new Error(
                  `${removal.removalConcern}; requires reconciliation` +
                    (removal.trash && existsSync(removal.trash)
                      ? `; preserved bytes at ${removal.trash}`
                      : ''),
                )
              delete b.removing
            }
            cleanupLifecycle.removed(c.main, b.path)
            const ref = `refs/heads/${b.branch}`
            try {
              git(c.main, ['rev-parse', '--verify', ref])
              if (worktrees(c.main).some((other) => other.branch === ref))
                throw new Error('Integration branch checked out elsewhere; retained')
              git(c.main, ['update-ref', '-d', ref, b.landedHead!])
            } catch (error) {
              if (git(c.main, ['for-each-ref', '--format=%(refname)', ref])) throw error
            }
            b.phase = 'cleaned'
            s.ready = s.ready.filter((m) => !b.members.some((source) => source.path === m.path))
            save(c, s)
          })
        } catch (error) {
          // Same durability rule for the integration worktree's journal.
          if (
            b.removing?.path === b.path &&
            !existsSync(b.path) &&
            !existsSync(b.removing.quarantine)
          ) {
            b.removing.removalConcern = String(error)
            try {
              save(c, s)
            } catch {
              // Journal write best-effort; the retained entry still reports it.
            }
          }
          // Same best-effort submodule reattach as the member path: a
          // retained integration worktree keeps its submodules functional,
          // and the teardown journal — not `detachedPointers` — is the
          // authority for what was renamed, so a destroy that throws
          // before `removing` is journaled is covered the same way.
          const retainedTree = registeredWorktreePath(c, `refs/heads/${b.branch}`)
          restoreOwned(
            c,
            cleanupLifecycle,
            retainedTree,
            `refs/heads/${b.branch}`,
            b.removing?.path === b.path ? (b.removing.detachedPointers ?? []) : [],
          )
          result.retained.push({ path: b.path, reason: String(error) })
        }
      }
      result.preserved = [...(b.preserved ?? [])]
      results.push(result)
    }
    return results
  })
}
export function assertLegacyAllowed(cwd: string, sourcePath: string) {
  const c = context(cwd),
    s = readState(c),
    path = resolve(cwd, sourcePath)
  if (
    s.batches.some((b) => !['cleaned', 'cancelled'].includes(b.phase) && b.path === path) ||
    s.ready.some((m) => m.path === path) ||
    s.batches.some(
      (b) => !['cleaned', 'cancelled'].includes(b.phase) && b.members.some((m) => m.path === path),
    )
  ) {
    throw new Error('Worktree batch owns this landing: use batch status / prepare / land / cleanup')
  }
}
/** Cancellation releases the queue, retaining every source and the integration for inspection. */
export function cancelBatch(cwd: string, reason: string) {
  if (!reason.trim()) throw new Error('Cancellation requires a reason')
  const c = context(cwd)
  return mutate(c, (s) => {
    const b = active(s)
    b.phase = 'cancelled'
    b.cancellationReason = reason
    delete b.seal
    // Members must explicitly re-register after correction; cancellation cannot silently resubmit them.
    s.ready = s.ready.filter((m) => !b.members.some((source) => source.path === m.path))
    save(c, s)
    return { batch: b.id, reason, retained: [b.path, ...b.members.map((m) => m.path)] }
  })
}
export function yieldBlockedBatch(
  cwd: string,
  waiting: { reason: string; owner: string; carrier: string; resumeEvent: string; workId: string },
) {
  if (!waiting.resumeEvent.trim()) throw new Error('Blocked yield requires a named resume event')
  const c = context(cwd)
  return mutate(c, (s) => {
    const b = active(s)
    if (!b.members.some((member) => member.workId === waiting.workId))
      throw new Error(`Blocked work id ${waiting.workId} is not in the active batch`)
    b.waiting = {
      reason: waiting.reason,
      owner: waiting.owner,
      carrier: waiting.carrier,
      resumeEvent: waiting.resumeEvent,
    }
    b.phase = 'cancelled'
    b.cancellationReason = waiting.reason
    delete b.seal
    s.ready = s.ready.filter((m) => !b.members.some((source) => source.path === m.path))
    const blocked = s.blockedSources ?? []
    s.blockedSources = [
      ...blocked.filter((row) => row.workId !== waiting.workId),
      {
        workId: waiting.workId,
        path: b.members.find((member) => member.workId === waiting.workId)!.path,
        reason: waiting.reason,
        resumeEvent: waiting.resumeEvent,
      },
    ]
    save(c, s)
    return { batch: b.id, waiting: b.waiting, retained: [b.path, ...b.members.map((m) => m.path)] }
  })
}
export function unlockBlockedSource(cwd: string, workId: string, event: string) {
  const c = context(cwd)
  return mutate(c, (s) => {
    const blocked = s.blockedSources ?? []
    const row = blocked.find((item) => item.workId === workId)
    if (!row) throw new Error(`Work id ${workId} is not blocked`)
    if (row.resumeEvent !== event)
      throw new Error(
        `Resume event ${event} does not unlock ${workId}; expected ${row.resumeEvent}`,
      )
    s.blockedSources = blocked.filter((item) => item.workId !== workId)
    save(c, s)
    return row
  })
}
export function batchScope(cwd: string) {
  const c = context(cwd),
    b = active(readState(c))
  if (b.refresh) throw new Error('Complete batch refresh before review')
  if (b.phase === 'integrating') throw new Error('Complete batch integration before review')
  integration(c, b)
  return {
    id: b.id,
    path: b.path,
    base: b.base,
    tree: git(b.path, ['write-tree']),
    members: b.members.map((m) => ({ path: m.path, workId: m.workId, head: m.head })),
  }
}
export type UnattendedMergeProbes = {
  world: UnattendedWorld
  markReady?: (query: { repository: string; pr: number }) => void
  mergePr?: (query: { repository: string; pr: number; head: string }) => { mergeSha: string }
}

function assertEvidenceHash(path: string, expected: string, label: string) {
  const resolved = realpathSync(path)
  if (!readFileSync(resolved).length || hashFile(resolved) !== expected)
    throw new Error(`${label} evidence missing, empty or changed`)
}

export function mergeUnattendedBatch(
  cwd: string,
  authorizationPath: string,
  options: { dryRun?: boolean; probes?: UnattendedMergeProbes } = {},
) {
  const c = context(cwd)
  const raw = parseJsonRecord(
    readFileSync(realpathSync(resolve(cwd, authorizationPath)), 'utf8'),
    authorizationPath,
  )
  const auth = parseUnattendedMergeAuthorization(raw)
  if (!options.probes?.world)
    throw new Error('Unattended merge requires an injected world snapshot')
  assertEvidenceHash(auth.authority.evidence, auth.authority.hash, 'authority')
  assertEvidenceHash(auth.human.evidence, auth.human.hash, 'human')
  assertEvidenceHash(auth.deployment_evidence.evidence, auth.deployment_evidence.hash, 'deployment')
  const decision = evaluateUnattendedAdmission(auth, options.probes.world)
  return mutate(c, (state) => {
    const batch = state.batches.find((item) => item.id === auth.batchId)
    if (!batch) throw new Error(`Batch ${auth.batchId} is not in the journal`)
    batch.unattendedAuthorization = auth
    if (decision.action === 'yield-blocked') {
      const waiting = {
        reason: 'blocked-charles leftover',
        owner: auth.coordinator.owner,
        carrier: auth.human.leftovers[0]?.carrier ?? auth.human.evidence,
        resumeEvent: `charles-leftover:${auth.human.leftovers[0]?.id ?? auth.batchId}`,
        workId: auth.workIds[0]!,
      }
      batch.waiting = {
        reason: waiting.reason,
        owner: waiting.owner,
        carrier: waiting.carrier,
        resumeEvent: waiting.resumeEvent,
      }
      batch.phase = 'cancelled'
      batch.cancellationReason = waiting.reason
      delete batch.seal
      state.ready = state.ready.filter(
        (row) => !batch.members.some((member) => member.path === row.path),
      )
      state.blockedSources = [
        ...(state.blockedSources ?? []).filter((row) => row.workId !== waiting.workId),
        {
          workId: waiting.workId,
          path:
            batch.members.find((member) => member.workId === waiting.workId)?.path ?? batch.path,
          reason: waiting.reason,
          resumeEvent: waiting.resumeEvent,
        },
      ]
      save(c, state)
      return { action: 'yield-blocked', batch: batch.id, waiting: batch.waiting }
    }
    const prior = batch.mergeAttempt
    if (prior?.stage === 'merging' && options.probes!.world.alreadyMerged) {
      batch.mergeAttempt = { ...prior, stage: 'confirming' }
      save(c, state)
      if (options.dryRun) return { action: 'confirm-only', dryRun: true, batch: batch.id }
      return { action: 'confirm-only', batch: batch.id, reentry: true }
    }
    batch.mergeAttempt = {
      operationId: prior?.operationId ?? randomUUID(),
      expectedHead: auth.source_head,
      expectedBase: auth.reviewed_base,
      stage: options.dryRun ? 'admitting' : decision.action === 'merge' ? 'merging' : 'confirming',
    }
    save(c, state)
    if (options.dryRun) return { action: decision.action, dryRun: true, batch: batch.id }
    if (decision.action === 'merge') {
      options.probes!.markReady?.({ repository: auth.repository, pr: auth.pr })
      const merged = options.probes!.mergePr?.({
        repository: auth.repository,
        pr: auth.pr,
        head: auth.source_head,
      })
      if (!merged?.mergeSha) throw new Error('Unattended squash merge did not return merge SHA')
      batch.mergeAttempt = {
        ...batch.mergeAttempt,
        stage: 'confirming',
        remote: { merged: true, mergeSha: merged.mergeSha },
      }
      save(c, state)
      return { action: 'merge', batch: batch.id, mergeSha: merged.mergeSha }
    }
    return { action: 'confirm-only', batch: batch.id }
  })
}

function rejectUnknownFlags(rest: string[], allowed: Set<string>) {
  for (const token of rest.filter((item) => item.startsWith('--'))) {
    if (!allowed.has(token)) throw new Error(`Unknown flag ${token}`)
  }
}

export function runBatchCommand(
  cwd: string,
  args: string[],
  lifecycle: BatchLifecycle = defaultLifecycle,
  probes?: UnattendedMergeProbes,
): unknown {
  const [command, ...rest] = args
  const value = (flag: string) => {
    const i = rest.indexOf(flag)
    return i < 0 ? undefined : rest[i + 1]
  }
  const required = (flag: string) => {
    const v = value(flag)
    if (!v || v.startsWith('--')) throw new Error(`Required ${flag}`)
    return v
  }
  const trigger = () => (value('--trigger') ?? 'auto') as BatchTrigger
  const workflow = () => {
    const v = value('--workflow')
    if (!v || v.startsWith('--'))
      throw new Error(
        'Required --workflow (trunk-based or pr-merge-based); CLI must not default to PR',
      )
    if (!['trunk-based', 'pr-merge-based'].includes(v)) throw new Error('Unknown workflow')
    return v as WorktreeBatch['workflow']
  }
  switch (command) {
    case 'checkpoint':
      return checkpointSource(cwd, rest[0] ?? cwd, {
        workId: required('--work-id'),
        author: required('--author'),
        scope: (value('--scope') ?? '')
          .split(',')
          .map((path) => path.trim())
          .filter(Boolean),
      })
    case 'draft': {
      rejectUnknownFlags(
        rest.filter((token) => token.startsWith('--')),
        new Set(['--work-id', '--pr', '--kind', '--discussant', '--question']),
      )
      const kind = value('--kind')
      if (kind !== undefined && kind !== 'visibility' && kind !== 'discussion')
        throw new Error('Unknown --kind; expected visibility or discussion')
      if (kind === 'visibility') {
        if (value('--discussant') !== undefined || value('--question') !== undefined)
          throw new Error('Visibility draft forbids --discussant and --question')
        return recordDraftPr(cwd, rest[0] ?? cwd, {
          workId: required('--work-id'),
          pr: Number(required('--pr')),
          kind: 'visibility',
        })
      }
      return recordDraftPr(cwd, rest[0] ?? cwd, {
        workId: required('--work-id'),
        pr: Number(required('--pr')),
        kind: 'discussion',
        discussant: required('--discussant'),
        question: required('--question'),
      })
    }
    case 'ready':
      return registerReady(cwd, rest[0] ?? cwd, {
        workId: required('--work-id'),
        evidence: required('--evidence'),
        authorizeLanding: rest.includes('--authorize-landing'),
        releaseWriter: rest.includes('--release-writer'),
        retain: value('--retain'),
      })
    case 'status':
      return batchStatus(cwd, trigger(), workflow())
    case 'prepare':
      return prepareBatch(cwd, trigger(), workflow(), lifecycle, {
        groupWorkIds: (value('--group-work-ids') ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      })
    case 'resume':
      return resumeBatch(cwd, lifecycle)
    case 'scope':
      return batchScope(cwd)
    case 'refresh':
      return refreshBatch(cwd, rest.includes('--resume'))
    case 'review':
      return reviewBatch(cwd)
    case 'seal':
      return sealBatch(cwd, required('--evidence'))
    case 'land':
      return landBatch(cwd)
    case 'yield-blocked': {
      rejectUnknownFlags(
        rest.filter((token) => token.startsWith('--')),
        new Set(['--work-id', '--reason', '--owner', '--carrier', '--resume-event']),
      )
      return yieldBlockedBatch(cwd, {
        workId: required('--work-id'),
        reason: required('--reason'),
        owner: required('--owner'),
        carrier: required('--carrier'),
        resumeEvent: required('--resume-event'),
      })
    }
    case 'unlock-blocked': {
      rejectUnknownFlags(
        rest.filter((token) => token.startsWith('--')),
        new Set(['--work-id', '--event']),
      )
      return unlockBlockedSource(cwd, required('--work-id'), required('--event'))
    }
    case 'merge-unattended': {
      rejectUnknownFlags(
        rest.filter((token) => token.startsWith('--')),
        new Set(['--authorization', '--dry-run', '--world']),
      )
      const worldPath = required('--world')
      const worldRaw = parseJsonRecord(
        readFileSync(realpathSync(resolve(cwd, worldPath)), 'utf8'),
        worldPath,
      )
      return mergeUnattendedBatch(cwd, required('--authorization'), {
        dryRun: rest.includes('--dry-run'),
        probes: {
          world: parseUnattendedWorld(worldRaw),
          ...probes,
        },
      })
    }
    case 'confirm-merged':
      return confirmMergedBatch(cwd, required('--receipt'))
    case 'cleanup':
      return cleanupBatches(cwd, lifecycle)
    case 'recover-lock':
      return recoverBatchLock(cwd)
    case 'cancel':
      return cancelBatch(cwd, required('--reason'))
    default:
      throw new Error(
        'batch: checkpoint | draft | ready | status | prepare | resume | scope | refresh | review | seal | land | yield-blocked | unlock-blocked | merge-unattended | confirm-merged | cleanup | cancel | recover-lock',
      )
  }
}
