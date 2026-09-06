// 🔒 LOCKED — managed by clade · Source: vendor/scripts/wt-batch.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/wt-batch.ts
/** Durable worktree batches. Review is performed by /commit; this module verifies its receipt. */
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { ensureNoStaleIndexLock } from './_git-lock-detect.ts'
import { isRecord, parseJsonRecord, parseJsonWith } from './lib/json-unknown.ts'
import { runWtEnvBootstrap } from './lib/wt-env-bootstrap-runner.ts'
import { findClaimByWorktree, readActiveClaims } from './claim-helper.ts'

export interface BatchLifecycle {
  bootstrap: (main: string, path: string) => void
  destroy: (main: string, path: string) => void
  removed: (main: string, path: string) => void
}
const defaultLifecycle: BatchLifecycle = {
  bootstrap: (_main, path) => {
    runWtEnvBootstrap(path, 'ensure')
  },
  destroy: (_main, path) => {
    const result = runWtEnvBootstrap(path, 'destroy')
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
export interface WorktreeBatch {
  id: string
  base: string
  main: string
  path: string
  branch: string
  workflow: 'trunk-based' | 'pr-merge-based'
  members: ReadySource[]
  cursor: number
  phase: 'integrating' | 'review' | 'sealed' | 'landed' | 'cleaned' | 'cancelled'
  bootstrapped?: boolean
  pending?: { before: string; tree?: string }
  refresh?: { base: string; before: string; tree?: string }
  seal?: {
    head?: string
    tree: string
    evidence: string
    hash: string
    artifacts: { path: string; hash: string }[]
  }
  cancellationReason?: string
  landedHead?: string
  removed: string[]
  preserved?: { path: string; archive: string }[]
}
interface State {
  version: 1
  ready: ReadySource[]
  batches: WorktreeBatch[]
}
interface Context {
  cwd: string
  main: string
  dir: string
}
const triggers = new Set(['auto', 'manual', 'dependency', 'drained', 'stop'])
/** `auto` alone carries a minimum; every other trigger closes the batch on any ready member.
 *  Single definition so `batch status` can never advertise a batch `prepare` then declines. */
const AUTO_TRIGGER_WORK_IDS = 4
function triggerReached(trigger: BatchTrigger, ready: ReadySource[]): boolean {
  const distinct = new Set(ready.map((m) => m.workId)).size
  return distinct > 0 && (trigger !== 'auto' || distinct >= AUTO_TRIGGER_WORK_IDS)
}
const git = (cwd: string, args: string[], input?: string) =>
  execFileSync('git', args, {
    cwd,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
const hashFile = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
function gitFileList(cwd: string, args: string[]): string[] {
  // Dependency trees can exceed execFileSync's pipe buffer; retain the complete list.
  const directory = mkdtempSync(join(tmpdir(), 'clade-batch-paths-'))
  const output = join(directory, 'paths')
  const fd = openSync(output, 'wx', 0o600)
  try {
    execFileSync('git', ['ls-files', ...args, '-z'], {
      cwd,
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
  return { cwd, main, dir: join(common, 'clade-wt-batch') }
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
function save(c: Context, s: State) {
  const file = join(c.dir, `state-${randomUUID()}.json`)
  writeFileSync(file, JSON.stringify(s, null, 2) + '\n', { flag: 'wx' })
  renameSync(file, join(c.dir, 'state.json'))
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
  mkdirSync(c.dir, { recursive: true })
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
  mkdirSync(c.dir, { recursive: true })
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
function ignoredArtifacts(c: Context, path: string) {
  return gitFileList(path, ['--others', '--ignored', '--exclude-standard']).filter((file) => {
    const first = file.split('/')[0]
    if (!['node_modules', 'dist', '.nuxt', '.clade'].includes(first)) return true
    const link = join(path, first)
    if (!lstatSync(link).isSymbolicLink()) return true
    const target = realpathSync(link)
    if (first === '.clade')
      return !existsSync(join(c.main, '.clade')) || target !== realpathSync(join(c.main, '.clade'))
    const rel = relative(path, target)
    return !(rel === '..' || rel.startsWith('../'))
  })
}
function preserveIgnoredArtifacts(c: Context, b: WorktreeBatch, path: string) {
  const ignored = ignoredArtifacts(c, path)
  if (!ignored.length) return
  // A package-manager install marker plus its committed lockfile identifies a
  // reproducible dependency tree. A directory name alone never authorizes disposal.
  const regenerable = [
    ['node_modules/.modules.yaml', 'pnpm-lock.yaml'],
    ['node_modules/.package-lock.json', 'package-lock.json'],
    ['node_modules/.yarn-integrity', 'yarn.lock'],
  ].find(([marker, lockfile]) => {
    if (!existsSync(join(path, marker)) || !lstatSync(join(path, marker)).isFile()) return false
    try {
      git(path, ['cat-file', '-e', `HEAD:${lockfile}`])
      git(path, ['diff', '--quiet', 'HEAD', '--', lockfile, 'package.json'])
      return true
    } catch {
      return false
    }
  })
  const excluded = regenerable
    ? [{ path: 'node_modules/', marker: regenerable[0], lockfile: regenerable[1] }]
    : []
  const files = regenerable ? ignored.filter((file) => !file.startsWith('node_modules/')) : ignored
  for (const file of files) {
    const stat = lstatSync(join(path, file))
    if (!stat.isFile() && !stat.isSymbolicLink())
      throw new Error(`Ignored artifact has unsupported entry type: ${file}`)
  }
  // Preserve ignored evidence, local config and provisioned files together. Never
  // guess whether an ignored file is disposable from its basename. The archive
  // lives in the common Git directory, outside every worktree being removed.
  const root = join(c.dir, 'artifacts')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const backup = mkdtempSync(join(root, `${b.id}-`))
  const archive = join(backup, 'ignored.tar')
  writeFileSync(archive, '', { flag: 'wx', mode: 0o600 })
  execFileSync(
    'tar',
    [
      '--create',
      '--file',
      archive,
      '--directory',
      path,
      '--null',
      '--verbatim-files-from',
      '--no-recursion',
      '--files-from',
      '-',
    ],
    {
      input: files.length ? files.join('\0') + '\0' : '',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  // This checks file contents and link targets without dereferencing symlinks.
  // Any read error or concurrent modification leaves the source intact.
  execFileSync('tar', ['--compare', '--file', archive, '--directory', path], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  writeFileSync(
    join(backup, 'receipt.json'),
    JSON.stringify({ path, archive, files, excluded }) + '\n',
    {
      flag: 'wx',
      mode: 0o600,
    },
  )
  ;(b.preserved ??= []).push({ path, archive })
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
  if (
    findClaimByWorktree(c.main, m.path) ||
    readActiveClaims(c.main).some(
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
  const b = s.batches.find(
    (candidate) =>
      !['cleaned', 'cancelled'].includes(candidate.phase) && candidate.phase !== 'landed',
  )
  if (!b) throw new Error('No active batch')
  return b
}
export function batchStatus(cwd: string, trigger: BatchTrigger = 'auto') {
  if (!triggers.has(trigger)) throw new Error('Unknown batch trigger')
  const c = context(cwd),
    s = readState(c),
    rows = eligible(c, s)
  const ready = rows.filter((r) => !r.reason).map((r) => r.source)
  const readyCount = new Set(ready.map((m) => m.workId)).size
  return {
    readyCount,
    trigger,
    shouldPrepare: triggerReached(trigger, ready),
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
) {
  if (!triggers.has(trigger)) throw new Error('Unknown batch trigger')
  if (!['trunk-based', 'pr-merge-based'].includes(workflow)) throw new Error('Unknown workflow')
  const c = context(cwd)
  return mutate(c, (s) => {
    const existing = s.batches.find((b) => !['landed', 'cleaned', 'cancelled'].includes(b.phase))
    if (existing) return existing
    const members = eligible(c, s)
      .filter((r) => !r.reason)
      .map((r) => r.source)
    if (!triggerReached(trigger, members)) return null
    assertMain(c)
    const id = randomUUID(),
      branch = `codex/batch-${id}`
    const b: WorktreeBatch = {
      id,
      branch,
      base: head(c.main),
      main: c.main,
      path: join(dirname(c.main), `${c.main.split('/').pop()}-wt`, `batch-${id}`),
      workflow,
      members,
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
      const base = head(c.main)
      if (base === b.base) return b
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
    if (head(c.main) !== b.base)
      throw new Error('Main advanced: refresh the batch before restarting review')
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
    if (head(c.main) !== b.base)
      throw new Error('Main advanced: integrate new base and repeat review')
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
export function landBatch(cwd: string, confirmMerged = false) {
  const c = context(cwd)
  return mutate(c, (s) => {
    const b = active(s)
    if (b.phase !== 'sealed') throw new Error('Batch must be sealed after /commit gates')
    const tip = formalHead(c, b)
    verifyMembers(c, b)
    assertMain(c)
    if (confirmMerged) {
      try {
        git(c.main, ['merge-base', '--is-ancestor', tip, 'refs/heads/main'])
      } catch {
        throw new Error(
          'Reviewed commits not merged into main; squash PR requires verified mapping and sources are retained',
        )
      }
    } else {
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
export function cleanupBatches(cwd: string, lifecycle: BatchLifecycle = defaultLifecycle) {
  const c = context(cwd)
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
      git(c.main, ['merge-base', '--is-ancestor', b.landedHead!, 'refs/heads/main'])
      // The batch lock is held for the whole loop and nothing here writes a claim,
      // so one read serves every member instead of one directory scan each.
      const claims = readActiveClaims(c.main)
      for (const [index, m] of b.members.entries()) {
        if (b.removed.includes(m.path)) continue
        let reason = m.retain
        const wt = worktrees(c.main).find((w) => w.path === m.path)
        if (wt) reason ||= sourceProblem(c, m)
        let branchHead: string | undefined
        try {
          branchHead = git(c.main, ['rev-parse', '--verify', m.branch])
        } catch {
          /* already deleted */
        }
        if (branchHead && branchHead !== m.head) reason ||= 'source branch advanced'
        if (
          claims.some(
            (cl) =>
              cl.worktree_path === m.path ||
              cl.branch === m.branch ||
              cl.branch === m.branch.replace('refs/heads/', ''),
          )
        )
          reason ||= 'source has an active claim'
        if (reason) {
          result.retained.push({ path: m.path, reason })
          continue
        }
        // Squash integration changes ancestry: preserve the checkpoint before removing its branch.
        git(c.main, ['update-ref', `refs/clade/batches/${b.id}/${index}`, m.head])
        try {
          if (wt) {
            lifecycle.destroy(c.main, m.path)
            preserveIgnoredArtifacts(c, b, m.path)
            save(c, s)
            git(c.main, ['worktree', 'remove', m.path])
          }
          lifecycle.removed(c.main, m.path)
          if (branchHead) {
            if (worktrees(c.main).some((other) => other.branch === m.branch))
              throw new Error('Source branch checked out elsewhere; retained')
            git(c.main, ['update-ref', '-d', m.branch, m.head])
          }
          b.removed.push(m.path)
          result.removed.push(m.path)
          save(c, s)
        } catch (error) {
          result.retained.push({ path: m.path, reason: String(error) })
        }
      }
      if (b.removed.length === b.members.length) {
        try {
          const wt = worktrees(c.main).find((w) => w.path === b.path)
          if (wt) {
            if (
              wt.locked ||
              !clean(b.path) ||
              head(b.path) !== b.landedHead ||
              findClaimByWorktree(c.main, b.path)
            )
              throw new Error('Integration has new work, lock or active owner')
            lifecycle.destroy(c.main, b.path)
            preserveIgnoredArtifacts(c, b, b.path)
            save(c, s)
            git(c.main, ['worktree', 'remove', b.path])
          }
          lifecycle.removed(c.main, b.path)
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
        } catch (error) {
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
export function runBatchCommand(
  cwd: string,
  args: string[],
  lifecycle: BatchLifecycle = defaultLifecycle,
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
  switch (command) {
    case 'ready':
      return registerReady(cwd, rest[0] ?? cwd, {
        workId: required('--work-id'),
        evidence: required('--evidence'),
        authorizeLanding: rest.includes('--authorize-landing'),
        releaseWriter: rest.includes('--release-writer'),
        retain: value('--retain'),
      })
    case 'status':
      return batchStatus(cwd, trigger())
    case 'prepare':
      return prepareBatch(
        cwd,
        trigger(),
        (value('--workflow') ?? 'pr-merge-based') as WorktreeBatch['workflow'],
        lifecycle,
      )
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
    case 'confirm-merged':
      return landBatch(cwd, true)
    case 'cleanup':
      return cleanupBatches(cwd, lifecycle)
    case 'recover-lock':
      return recoverBatchLock(cwd)
    case 'cancel':
      return cancelBatch(cwd, required('--reason'))
    default:
      throw new Error(
        'batch: ready | status | prepare | resume | scope | refresh | review | seal | land | confirm-merged | cleanup | cancel | recover-lock',
      )
  }
}
