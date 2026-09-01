#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: plugins/hub-capabilities-openspec/scripts/spectra-target-guard.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/plugins/hub-capabilities-openspec/scripts/spectra-target-guard.ts

/**
 * Fail-closed integration guard for closed-source kaochenlong/spectra-app v2.3.1.
 *
 * Spectra has no explicit project/worktree selector. This wrapper anchors every
 * targeted invocation to the current git root, requires path-bearing evidence,
 * serializes probes and mutations per git common-dir, and verifies that no
 * sibling worktree was changed before releasing buffered child output.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const SPEC_DIR = 'openspec'
const PATH_FIELDS = new Set([
  'worktreePath',
  'projectPath',
  'rootPath',
  'changeDir',
  'contextFiles',
  'outputPath',
  'path',
])
const ERROR_EXIT = 2

interface GuardError {
  code: string
  message: string
  change?: string
  currentRoot?: string
  candidates?: string[]
  details?: unknown
  rollback?: { status: 'restored' | 'failed'; error?: string }
}

interface ParsedArgs {
  change: string
  spectraArgs: string[]
}

type CommandKind =
  | 'global-read-only'
  | 'existing-read-only'
  | 'local-mutation'
  | 'lifecycle-mutation'
  | 'create-before-target'

interface CommandClass {
  kind: CommandKind
  operation: string
}

interface WorktreeRecord {
  root: string
  commonDir: string
  changeDir: string
  hasChange: boolean
}

interface TargetContext {
  currentRoot: string
  commonDir: string
  currentChangeDir: string
  worktrees: WorktreeRecord[]
  candidates: WorktreeRecord[]
}

interface ChildResult {
  status: number
  stdout: string
  stderr: string
}

interface FileSnapshot {
  exists: boolean
  hash: string | null
  text: string | null
}

interface TreeSnapshot {
  files: Map<string, string>
}

interface RelevantSnapshot {
  active: TreeSnapshot
  tasks: FileSnapshot
  sidecar: FileSnapshot
  specs: TreeSnapshot
  archive: TreeSnapshot
}

interface ParkBinding {
  version: 1
  change: string
  root: string
  commonDir: string
  artifactHash: string
  createdAt: string
}

type MutationRollback = () => void

let activeRollback: MutationRollback | null = null

function rollbackActiveMutation(): { attempted: boolean; error?: string } {
  const rollback = activeRollback
  activeRollback = null
  if (!rollback) return { attempted: false }
  try {
    rollback()
    return { attempted: true }
  } catch (error) {
    return { attempted: true, error: error instanceof Error ? error.message : String(error) }
  }
}

class GuardFailure extends Error {
  readonly detail: GuardError

  constructor(detail: GuardError) {
    super(detail.message)
    this.detail = detail
  }
}

class ChildExit extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Spectra exited with status ${status}`)
    this.status = status
  }
}

function fail(error: GuardError): never {
  const rollback = rollbackActiveMutation()
  if (rollback.attempted) {
    error.rollback = rollback.error
      ? { status: 'failed', error: rollback.error }
      : { status: 'restored' }
  }
  throw new GuardFailure(error)
}

function parseArgs(argv: string[]): ParsedArgs {
  const separator = argv.indexOf('--')
  if (separator === -1) {
    fail({
      code: 'USAGE_ERROR',
      message:
        'usage: node .claude/scripts/spectra-target-guard.ts --change <name> -- <spectra args...>',
    })
  }
  const wrapperArgs = argv.slice(0, separator)
  const spectraArgs = argv.slice(separator + 1)
  const changeIndex = wrapperArgs.indexOf('--change')
  const change = changeIndex === -1 ? '' : (wrapperArgs[changeIndex + 1] ?? '')
  if (
    wrapperArgs.length !== 2 ||
    changeIndex !== 0 ||
    !change ||
    spectraArgs.length === 0 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(change) ||
    change.includes('..')
  ) {
    fail({
      code: 'USAGE_ERROR',
      message: 'expected one safe --change name followed by -- and Spectra arguments',
    })
  }
  return { change, spectraArgs }
}

function classifyCommand(args: string[]): CommandClass {
  const [first, second] = args
  if (first === 'list' || first === 'search') {
    if (args.includes('--change')) {
      fail({
        code: 'USAGE_ERROR',
        message: 'global Spectra commands must not carry a targeted --change flag',
        details: { args },
      })
    }
    return { kind: 'global-read-only', operation: first }
  }
  if (first === 'instructions' && args.includes('--skill')) {
    if (args.includes('--change')) {
      fail({
        code: 'USAGE_ERROR',
        message: 'instructions --skill cannot be combined with targeted --change',
        details: { args },
      })
    }
    return { kind: 'global-read-only', operation: 'instructions-skill' }
  }
  if (first === 'status' || first === 'analyze' || first === 'validate' || first === 'drift') {
    return { kind: 'existing-read-only', operation: first }
  }
  if (first === 'instructions') {
    return { kind: 'existing-read-only', operation: 'instructions' }
  }
  if (first === 'task' && second === 'done') {
    return { kind: 'local-mutation', operation: 'task-done' }
  }
  if (first === 'task' && second === 'verify-done') {
    return { kind: 'local-mutation', operation: 'task-verify-done' }
  }
  if (first === 'task' && second === 'recover-done') {
    return { kind: 'local-mutation', operation: 'task-recover-done' }
  }
  if (first === 'new' && second === 'artifact') {
    return { kind: 'local-mutation', operation: 'new-artifact' }
  }
  if (first === 'in-progress' && second === 'add') {
    return { kind: 'local-mutation', operation: 'in-progress-add' }
  }
  if (first === 'new' && second === 'change') {
    return { kind: 'create-before-target', operation: 'new-change' }
  }
  if (first === 'park' || first === 'unpark' || first === 'archive' || first === 'sync') {
    return { kind: 'lifecycle-mutation', operation: first }
  }
  fail({
    code: 'USAGE_ERROR',
    message: 'unsupported Spectra command class; update the guard contract before delegation',
    details: { args },
  })
}

function validateCommandBinding(change: string, args: string[], command: CommandClass): void {
  if (
    command.kind === 'global-read-only' ||
    command.operation === 'task-verify-done' ||
    command.operation === 'task-recover-done'
  )
    return

  const flagValues: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--change') continue
    const value = args[index + 1]
    if (!value || value.startsWith('-')) {
      fail({
        code: 'USAGE_ERROR',
        message: 'child --change flag requires the guarded change name',
        change,
        details: { args },
      })
    }
    flagValues.push(value)
  }

  const positionalByOperation: Partial<Record<string, string | undefined>> = {
    analyze: args[1],
    validate: args[1],
    drift: args[1],
    park: args[1],
    unpark: args[1],
    archive: args[1],
    sync: args[1],
    'in-progress-add': args[2],
    'new-change': args[2],
  }
  const positional = positionalByOperation[command.operation]
  const requiresFlag = new Set(['status', 'instructions', 'task-done', 'new-artifact']).has(
    command.operation,
  )
  const boundValues = positional ? [...flagValues, positional] : flagValues

  if ((requiresFlag && flagValues.length === 0) || (!requiresFlag && !positional)) {
    fail({
      code: 'USAGE_ERROR',
      message: 'child command does not identify the guarded change',
      change,
      details: { operation: command.operation, args },
    })
  }
  if (boundValues.some((value) => value !== change)) {
    fail({
      code: 'TARGET_UNPROVEN',
      message: 'wrapper and child command name different changes',
      change,
      details: { operation: command.operation, childChanges: boundValues, args },
    })
  }
}

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    fail({
      code: 'TARGET_FOREIGN',
      message: 'current directory is not a readable git worktree',
      details: error instanceof Error ? error.message : String(error),
    })
  }
}

function normalizeWinePath(value: string): string {
  const slashed = value.replaceAll('\\', '/')
  if (/^z:\//i.test(slashed)) return slashed.slice(2) || '/'
  if (/^[A-Za-z]:\//.test(slashed)) {
    fail({
      code: 'TARGET_FOREIGN',
      message: 'non-Z Wine drive path cannot be proven to belong to the current worktree',
      details: { path: value },
    })
  }
  return slashed
}

/** Resolve symlinks in the longest existing ancestor while preserving missing suffixes. */
function canonicalPath(value: string, base: string): string {
  const normalized = normalizeWinePath(value)
  let cursor = resolve(base, normalized)
  const suffix: string[] = []
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) break
    suffix.unshift(basename(cursor))
    cursor = parent
  }
  const canonicalBase = existsSync(cursor) ? realpathSync(cursor) : cursor
  return resolve(canonicalBase, ...suffix)
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isContained(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function worktreeRoots(currentRoot: string): string[] {
  const output = execFileSync('git', ['worktree', 'list', '--porcelain', '-z'], {
    cwd: currentRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return [
    ...new Set(
      output
        .split('\0')
        .filter((field) => field.startsWith('worktree '))
        .map((field) => canonicalPath(field.slice('worktree '.length), currentRoot)),
    ),
  ]
}

function resolveTarget(change: string): TargetContext {
  const reportedRoot = git(process.cwd(), ['rev-parse', '--show-toplevel'])
  const currentRoot = canonicalPath(reportedRoot, process.cwd())
  const commonDir = canonicalPath(git(currentRoot, ['rev-parse', '--git-common-dir']), currentRoot)
  let roots: string[]
  try {
    roots = worktreeRoots(currentRoot)
  } catch (error) {
    fail({
      code: 'TARGET_FOREIGN',
      message: 'registered git worktrees could not be enumerated',
      change,
      currentRoot,
      details: error instanceof Error ? error.message : String(error),
    })
  }

  const worktrees = roots.map((root): WorktreeRecord => {
    const candidateCommon = canonicalPath(git(root, ['rev-parse', '--git-common-dir']), root)
    if (candidateCommon !== commonDir) {
      fail({
        code: 'TARGET_FOREIGN',
        message: 'a registered worktree resolves to a different git common-dir',
        change,
        currentRoot,
        details: {
          worktreeRoot: root,
          currentCommonDir: commonDir,
          candidateCommonDir: candidateCommon,
        },
      })
    }
    const changeDir = canonicalPath(join(root, SPEC_DIR, 'changes', change), root)
    const hasChange = isDirectory(changeDir)
    if (hasChange && !isContained(root, changeDir)) {
      fail({
        code: 'TARGET_FOREIGN',
        message: 'a registered change directory resolves outside its worktree',
        change,
        currentRoot,
        details: { worktreeRoot: root, canonicalChangeDir: changeDir },
      })
    }
    return { root, commonDir: candidateCommon, changeDir, hasChange }
  })

  const currentChangeDir = canonicalPath(
    join(currentRoot, SPEC_DIR, 'changes', change),
    currentRoot,
  )
  if (isDirectory(currentChangeDir) && !isContained(currentRoot, currentChangeDir)) {
    fail({
      code: 'TARGET_FOREIGN',
      message: 'the current change directory resolves outside the current worktree',
      change,
      currentRoot,
      details: { canonicalChangeDir: currentChangeDir },
    })
  }
  return {
    currentRoot,
    commonDir,
    currentChangeDir,
    worktrees,
    candidates: worktrees.filter((entry) => entry.hasChange),
  }
}

function requireExistingTarget(change: string, target: TargetContext): void {
  if (isDirectory(target.currentChangeDir)) return
  const candidates = target.candidates.map((entry) => entry.root)
  fail({
    code: candidates.length > 0 ? 'TARGET_FOREIGN' : 'TARGET_MISSING',
    message:
      candidates.length > 0
        ? 'the requested change exists only in sibling worktrees, not the current root'
        : 'the requested change does not exist in the current worktree set',
    change,
    currentRoot: target.currentRoot,
    candidates,
  })
}

function lockPath(commonDir: string): string {
  return join(commonDir, 'clade-spectra-target-guard.lock')
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function acquireLock(target: TargetContext, change: string): () => void {
  const path = lockPath(target.commonDir)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const temporary = `${path}.${process.pid}.tmp`
    try {
      writeFileSync(
        temporary,
        JSON.stringify({
          pid: process.pid,
          change,
          root: target.currentRoot,
          createdAt: new Date().toISOString(),
        }),
        { flag: 'wx', mode: 0o600 },
      )
      try {
        linkSync(temporary, path)
      } finally {
        unlinkSync(temporary)
      }
      return () => {
        try {
          const body = JSON.parse(readFileSync(path, 'utf8'))
          if (body?.pid === process.pid) unlinkSync(path)
        } catch {}
      }
    } catch (error) {
      try {
        if (existsSync(temporary)) unlinkSync(temporary)
      } catch {}
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let stale = false
      let owner: unknown = null
      try {
        owner = JSON.parse(readFileSync(path, 'utf8'))
        stale = !pidAlive(Number((owner as { pid?: unknown }).pid))
      } catch {
        stale = true
      }
      if (stale && attempt === 0) {
        unlinkSync(path)
        continue
      }
      fail({
        code: 'TARGET_LOCKED',
        message: 'another guarded Spectra invocation owns this git common-dir',
        change,
        currentRoot: target.currentRoot,
        details: { lockPath: path, owner },
      })
    }
  }
  fail({ code: 'TARGET_LOCKED', message: 'failed to acquire Spectra target lock', change })
}

function isolatedSpectraArgs(cwd: string, args: string[]): string[] {
  let roots: string[]
  try {
    roots = worktreeRoots(cwd)
  } catch (error) {
    fail({
      code: 'ISOLATION_FAILED',
      message: 'Spectra child isolation could not enumerate registered worktrees',
      currentRoot: cwd,
      details: error instanceof Error ? error.message : String(error),
    })
  }

  const foreignRoots = roots.filter((root) => root !== cwd)
  for (const foreignRoot of foreignRoots) {
    if (isContained(foreignRoot, cwd) || isContained(cwd, foreignRoot)) {
      fail({
        code: 'ISOLATION_FAILED',
        message: 'nested git worktrees cannot be isolated without hiding the current root',
        currentRoot: cwd,
        details: { foreignRoot },
      })
    }
  }

  const sandbox = [
    '--die-with-parent',
    '--new-session',
    '--ro-bind',
    '/',
    '/',
    '--dev-bind',
    '/dev',
    '/dev',
    '--proc',
    '/proc',
  ]
  if (isDirectory('/tmp')) sandbox.push('--bind', '/tmp', '/tmp')

  const home = process.env.HOME
  const writableRuntimePaths = [
    process.env.WINEPREFIX,
    home ? join(home, '.local', 'share', 'spectra', 'wine') : undefined,
    process.env.XDG_RUNTIME_DIR,
  ]
  for (const path of new Set(
    writableRuntimePaths.filter((value): value is string => Boolean(value)),
  )) {
    if (isDirectory(path)) sandbox.push('--bind', path, path)
  }

  for (const foreignRoot of foreignRoots) {
    sandbox.push('--ro-bind', foreignRoot, foreignRoot)
    const foreignChanges = join(foreignRoot, SPEC_DIR, 'changes')
    if (isDirectory(foreignChanges)) sandbox.push('--tmpfs', foreignChanges)
  }
  if (!isContained('/tmp', cwd)) sandbox.push('--bind', cwd, cwd)
  sandbox.push('--chdir', cwd, '--', 'spectra', ...args)
  return sandbox
}

function runSpectra(cwd: string, args: string[]): ChildResult {
  const input = args.includes('--stdin') ? readFileSync(0) : undefined
  const bwrap = process.env.SPECTRA_TARGET_GUARD_BWRAP || 'bwrap'
  const child = spawnSync(bwrap, isolatedSpectraArgs(cwd, args), {
    cwd,
    encoding: 'utf8',
    env: process.env,
    input,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (child.error) {
    fail({
      code: 'ISOLATION_FAILED',
      message: 'Spectra child isolation could not be started',
      currentRoot: cwd,
      details: child.error.message,
    })
  }
  const stderr = child.stderr ?? ''
  if ((child.status ?? 1) !== 0 && /^bwrap:/m.test(stderr)) {
    fail({
      code: 'ISOLATION_FAILED',
      message: 'bubblewrap could not establish the Spectra child filesystem view',
      currentRoot: cwd,
      details: stderr.trim(),
    })
  }
  return { status: child.status ?? 1, stdout: child.stdout ?? '', stderr }
}

function parseJson(result: ChildResult, change: string, currentRoot: string): unknown {
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    fail({
      code: 'OUTPUT_INVALID',
      message: 'Spectra --json output was not valid JSON; buffered output was withheld',
      change,
      currentRoot,
      details: error instanceof Error ? error.message : String(error),
    })
  }
}

function collectPathValues(value: unknown, activeField: string | null, out: string[]): void {
  if (typeof value === 'string') {
    if (activeField) out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectPathValues(entry, activeField, out)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value)) {
    collectPathValues(entry, PATH_FIELDS.has(key) ? key : activeField, out)
  }
}

function attestBody(body: unknown, target: TargetContext, change: string): string[] {
  const rawPaths: string[] = []
  collectPathValues(body, null, rawPaths)
  if (rawPaths.length === 0) {
    fail({
      code: 'TARGET_UNPROVEN',
      message: 'Spectra returned valid JSON without path-bearing target evidence',
      change,
      currentRoot: target.currentRoot,
    })
  }
  const paths = rawPaths.map((rawPath) => canonicalPath(rawPath, target.currentRoot))
  for (let index = 0; index < paths.length; index += 1) {
    if (!isContained(target.currentRoot, paths[index])) {
      fail({
        code: 'TARGET_FOREIGN',
        message:
          'Spectra returned a path outside the current worktree; buffered output was withheld',
        change,
        currentRoot: target.currentRoot,
        details: { path: rawPaths[index], canonicalPath: paths[index] },
      })
    }
  }
  return paths
}

function tryAttestationProbe(
  target: TargetContext,
  change: string,
  artifact: string,
): unknown | null {
  const result = runSpectra(target.currentRoot, [
    'instructions',
    artifact,
    '--change',
    change,
    '--json',
  ])
  if (result.status !== 0 || !result.stdout.trim()) return null
  let body: unknown
  try {
    body = JSON.parse(result.stdout)
  } catch {
    return null
  }
  const paths: string[] = []
  collectPathValues(body, null, paths)
  return paths.length > 0 ? body : null
}

function attestExistingTarget(target: TargetContext, change: string): string[] {
  for (const artifact of ['apply', 'proposal']) {
    const body = tryAttestationProbe(target, change, artifact)
    if (body) return attestBody(body, target, change)
  }
  fail({
    code: 'TARGET_UNPROVEN',
    message: 'path-bearing Spectra attestation could not be obtained for the current target',
    change,
    currentRoot: target.currentRoot,
  })
}

function snapshotFile(path: string): FileSnapshot {
  if (!existsSync(path)) return { exists: false, hash: null, text: null }
  const text = readFileSync(path, 'utf8')
  return { exists: true, hash: createHash('sha256').update(text).digest('hex'), text }
}

function snapshotTree(root: string): TreeSnapshot {
  const files = new Map<string, string>()
  if (!existsSync(root)) return { files }
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        const canonical = canonicalPath(path, root)
        if (!isContained(root, canonical)) {
          fail({
            code: 'TARGET_FOREIGN',
            message: 'a mutation snapshot path escapes its worktree through a symlink',
            details: { path, canonicalPath: canonical },
          })
        }
      }
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) {
        const rel = relative(root, path)
        files.set(rel, createHash('sha256').update(readFileSync(path)).digest('hex'))
      }
    }
  }
  visit(root)
  return { files }
}

function treeHash(tree: TreeSnapshot): string {
  return createHash('sha256')
    .update(
      [...tree.files.entries()]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([p, h]) => `${p}\0${h}\n`)
        .join(''),
    )
    .digest('hex')
}

function snapshotRelevant(root: string, change: string): RelevantSnapshot {
  return {
    active: snapshotTree(join(root, SPEC_DIR, 'changes', change)),
    tasks: snapshotFile(join(root, SPEC_DIR, 'changes', change, 'tasks.md')),
    sidecar: snapshotFile(join(root, '.spectra', 'touched', `${change}.json`)),
    specs: snapshotTree(join(root, SPEC_DIR, 'specs')),
    archive: snapshotTree(join(root, SPEC_DIR, 'changes', 'archive')),
  }
}

function snapshotAll(target: TargetContext, change: string): Map<string, RelevantSnapshot> {
  return new Map(
    target.worktrees.map((worktree) => [worktree.root, snapshotRelevant(worktree.root, change)]),
  )
}

function sameTree(a: TreeSnapshot, b: TreeSnapshot): boolean {
  return treeHash(a) === treeHash(b)
}

function verifyForeignUnchanged(
  target: TargetContext,
  change: string,
  before: Map<string, RelevantSnapshot>,
): void {
  const failures: string[] = []
  for (const worktree of target.worktrees) {
    if (worktree.root === target.currentRoot) continue
    const previous = before.get(worktree.root)
    const after = snapshotRelevant(worktree.root, change)
    if (
      !previous ||
      !sameTree(previous.active, after.active) ||
      previous.sidecar.exists !== after.sidecar.exists ||
      previous.sidecar.hash !== after.sidecar.hash ||
      !sameTree(previous.specs, after.specs) ||
      !sameTree(previous.archive, after.archive)
    ) {
      failures.push(worktree.root)
    }
  }
  if (failures.length > 0) {
    fail({
      code: 'MUTATION_POSTCONDITION',
      message: 'Spectra mutated foreign worktree state; the scene was preserved for investigation',
      change,
      currentRoot: target.currentRoot,
      details: { foreignRoots: failures },
    })
  }
}

function mutationPaths(
  root: string,
  change: string,
  _currentRoot?: string,
): { tasks: string; sidecar: string } {
  return {
    tasks: canonicalPath(join(root, SPEC_DIR, 'changes', change, 'tasks.md'), root),
    sidecar: canonicalPath(join(root, '.spectra', 'touched', `${change}.json`), root),
  }
}

function snapshotMutationFiles(
  root: string,
  change: string,
  currentRoot: string,
): { tasks: FileSnapshot; sidecar: FileSnapshot } {
  const { tasks, sidecar } = mutationPaths(root, change)
  for (const [label, path] of [
    ['tasks.md', tasks],
    ['touched sidecar', sidecar],
  ] as const) {
    if (!isContained(root, path)) {
      fail({
        code: 'TARGET_FOREIGN',
        message: `${label} resolves outside its registered worktree`,
        change,
        currentRoot,
        details: { worktreeRoot: root, canonicalPath: path },
      })
    }
  }
  return { tasks: snapshotFile(tasks), sidecar: snapshotFile(sidecar) }
}

function restoreSnapshot(path: string, saved: FileSnapshot): void {
  if (!saved.exists) {
    rmSync(path, { force: true })
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, saved.text ?? '')
}

function restoreMutationFiles(
  root: string,
  change: string,
  currentRoot: string,
  saved: { tasks: FileSnapshot; sidecar: FileSnapshot },
): void {
  restoreSnapshot(join(root, SPEC_DIR, 'changes', change, 'tasks.md'), saved.tasks)
  restoreSnapshot(join(root, '.spectra', 'touched', `${change}.json`), saved.sidecar)
}

function checkboxStates(text: string | null): Map<string, boolean> {
  const states = new Map<string, boolean>()
  for (const line of (text ?? '').split('\n')) {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\](?:\s|$)/)
    if (!match) continue
    // Spectra's `task done <id>` uses the checkbox's one-based ordinal, not the
    // source-authored label that follows it (`1.2`, or `[P] 1.2` for parallel tasks).
    states.set(String(states.size + 1), match[1].toLowerCase() === 'x')
  }
  return states
}

function taskDoneId(args: string[]): string | null {
  if (args[0] !== 'task' || args[1] !== 'done') return null
  const positionals: string[] = []
  for (let index = 2; index < args.length; index += 1) {
    if (args[index] === '--change') {
      index += 1
      continue
    }
    if (!args[index].startsWith('-')) positionals.push(args[index])
  }
  return positionals.at(-1) ?? null
}

interface TaskDoneRecovery {
  taskId: string
  mode: 'recorded' | 'checkbox-only'
}

interface VerificationDone {
  taskId: string
  evidencePaths: string[]
  command: string[]
}

function taskDoneRecovery(args: string[]): TaskDoneRecovery | null {
  if (args[0] !== 'task' || args[1] !== 'recover-done') return null
  if (args.length === 3 && /^\d+$/.test(args[2])) {
    return { taskId: args[2], mode: 'recorded' }
  }
  if (args.length === 4 && args[2] === '--checkbox-only' && /^\d+$/.test(args[3])) {
    return { taskId: args[3], mode: 'checkbox-only' }
  }
  return null
}

function verificationDone(args: string[], change: string): VerificationDone | null {
  if (args[0] !== 'task' || args[1] !== 'verify-done') return null
  const commandSeparator = args.indexOf('--', 2)
  if (commandSeparator === -1 || commandSeparator === args.length - 1) {
    fail({
      code: 'USAGE_ERROR',
      message: 'task verify-done requires -- followed by an evidence command',
      change,
    })
  }

  const positionals: string[] = []
  const evidencePaths: string[] = []
  let explicitVerificationOnly = false
  let embeddedChange = ''
  for (let index = 2; index < commandSeparator; index += 1) {
    const arg = args[index]
    if (arg === '--change' || arg === '--evidence-path') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) {
        fail({ code: 'USAGE_ERROR', message: `${arg} requires a value`, change })
      }
      if (arg === '--change') embeddedChange = value
      else evidencePaths.push(value)
      index += 1
      continue
    }
    if (arg === '--verification-only') {
      explicitVerificationOnly = true
      continue
    }
    if (arg.startsWith('-')) {
      fail({ code: 'USAGE_ERROR', message: `unsupported task verify-done option: ${arg}`, change })
    }
    positionals.push(arg)
  }

  if (
    embeddedChange !== change ||
    !explicitVerificationOnly ||
    positionals.length !== 1 ||
    !/^\d+$/.test(positionals[0]) ||
    evidencePaths.length === 0 ||
    new Set(evidencePaths).size !== evidencePaths.length
  ) {
    fail({
      code: 'USAGE_ERROR',
      message:
        'task verify-done requires --change <name> <numeric ordinal> --verification-only, unique --evidence-path values, and -- <command>',
      change,
    })
  }
  return {
    taskId: positionals[0],
    evidencePaths,
    command: args.slice(commandSeparator + 1),
  }
}

function sidecarContainsTask(text: string | null, change: string, taskId: string): boolean {
  if (!text) return false
  try {
    const body = JSON.parse(text)
    return (
      body?.change === change &&
      Array.isArray(body?.touched) &&
      body.touched.some((entry: { task_id?: unknown }) => String(entry?.task_id) === taskId)
    )
  } catch {
    return false
  }
}

function checkedTaskText(text: string, taskId: string): { text: string; description: string } {
  const targetOrdinal = Number(taskId)
  let ordinal = 0
  let description = ''
  const next = text
    .split('\n')
    .map((line) =>
      line.replace(
        /^(\s*[-*]\s+\[)([ xX])(\])(?=\s|$)(.*)$/,
        (all, prefix, state, suffix, remainder) => {
          ordinal += 1
          if (ordinal !== targetOrdinal) return all
          if (String(state).toLowerCase() === 'x') return all
          description = String(remainder).trim()
          return `${prefix}x${suffix}${remainder}`
        },
      ),
    )
    .join('\n')
  if (!description) {
    fail({
      code: 'VERIFICATION_PRECONDITION',
      message: `task ${taskId} is not an unchecked checkbox that can be completed`,
    })
  }
  return { text: next, description }
}

function uncheckedTaskText(text: string, taskId: string): string {
  const targetOrdinal = Number(taskId)
  let ordinal = 0
  let recovered = false
  const next = text
    .split('\n')
    .map((line) =>
      line.replace(/^(\s*[-*]\s+\[)([ xX])(\])(?=\s|$)/, (all, prefix, state, suffix) => {
        ordinal += 1
        if (ordinal !== targetOrdinal) return all
        if (String(state).toLowerCase() !== 'x') return all
        recovered = true
        return `${prefix} ${suffix}`
      }),
    )
    .join('\n')
  if (!recovered) {
    fail({
      code: 'RECOVERY_PRECONDITION',
      message: `task ${taskId} is not a checked checkbox that can be recovered`,
    })
  }
  return next
}

function recoveredSidecarText(
  text: string,
  change: string,
  recovery: TaskDoneRecovery,
): string | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error) {
    fail({
      code: 'RECOVERY_PRECONDITION',
      message: 'touched sidecar is not valid JSON',
      change,
      details: error instanceof Error ? error.message : String(error),
    })
  }
  if (!body || typeof body !== 'object' || Reflect.get(body, 'change') !== change) {
    fail({
      code: 'RECOVERY_PRECONDITION',
      message: 'touched sidecar does not belong to the requested change',
      change,
    })
  }
  const touched = Reflect.get(body, 'touched')
  if (!Array.isArray(touched)) {
    fail({
      code: 'RECOVERY_PRECONDITION',
      message: 'touched sidecar has no task records',
      change,
    })
  }
  const matches = touched.filter(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      String(Reflect.get(entry, 'task_id')) === recovery.taskId,
  )
  const expectedMatches = recovery.mode === 'checkbox-only' ? 0 : 1
  if (matches.length !== expectedMatches) {
    fail({
      code: 'RECOVERY_PRECONDITION',
      message:
        recovery.mode === 'checkbox-only'
          ? 'checkbox-only recovery requires zero touched records for the interrupted task'
          : 'touched sidecar must contain exactly one record for the interrupted task',
      change,
      details: { taskId: recovery.taskId, matches: matches.length, expectedMatches },
    })
  }
  if (recovery.mode === 'checkbox-only') return null

  Reflect.set(
    body,
    'touched',
    touched.filter(
      (entry) =>
        !(
          entry &&
          typeof entry === 'object' &&
          String(Reflect.get(entry, 'task_id')) === recovery.taskId
        ),
    ),
  )
  return `${JSON.stringify(body, null, 2)}\n`
}

function completeVerificationTask(
  change: string,
  completion: VerificationDone,
  currentRoot: string,
  worktrees: WorktreeRecord[],
): void {
  const before = new Map<string, { tasks: FileSnapshot; sidecar: FileSnapshot }>()
  for (const worktree of worktrees) {
    before.set(worktree.root, snapshotMutationFiles(worktree.root, change, currentRoot))
  }
  const beforeCurrent = before.get(currentRoot)
  if (!beforeCurrent?.tasks.text || !beforeCurrent.sidecar.text) {
    fail({
      code: 'VERIFICATION_PRECONDITION',
      message: 'verification-only completion requires existing tasks.md and touched sidecar',
      change,
      currentRoot,
    })
  }
  if (git(currentRoot, ['status', '--porcelain=v1', '--untracked-files=all'])) {
    fail({
      code: 'VERIFICATION_PRECONDITION',
      message: 'verification-only completion requires a clean tracked and untracked worktree',
      change,
      currentRoot,
    })
  }

  const checked = checkedTaskText(beforeCurrent.tasks.text, completion.taskId)
  const evidenceCommand = [basename(completion.command[0]), ...completion.command.slice(1)].join(
    ' ',
  )
  if (!checked.description.includes(`\`${evidenceCommand}\``)) {
    fail({
      code: 'VERIFICATION_PRECONDITION',
      message: 'evidence command must exactly match a backticked command in the task description',
      change,
      currentRoot,
      details: { taskId: completion.taskId, evidenceCommand },
    })
  }
  let sidecar: unknown
  try {
    sidecar = JSON.parse(beforeCurrent.sidecar.text)
  } catch (error) {
    fail({
      code: 'VERIFICATION_PRECONDITION',
      message: 'touched sidecar is not valid JSON',
      change,
      details: error instanceof Error ? error.message : String(error),
    })
  }
  if (!sidecar || typeof sidecar !== 'object' || Reflect.get(sidecar, 'change') !== change) {
    fail({
      code: 'VERIFICATION_PRECONDITION',
      message: 'touched sidecar does not belong to the requested change',
      change,
    })
  }
  const touched = Reflect.get(sidecar, 'touched')
  if (
    !Array.isArray(touched) ||
    sidecarContainsTask(beforeCurrent.sidecar.text, change, completion.taskId)
  ) {
    fail({
      code: 'VERIFICATION_PRECONDITION',
      message: 'verification-only completion requires prior records and zero records for this task',
      change,
      details: { taskId: completion.taskId },
    })
  }

  const canonicalEvidence = new Map<string, FileSnapshot>()
  for (const evidencePath of completion.evidencePaths) {
    if (isAbsolute(evidencePath) || evidencePath.split(/[\\/]/).includes('..')) {
      fail({
        code: 'VERIFICATION_PRECONDITION',
        message: 'evidence paths must be safe worktree-relative paths',
        change,
        details: { evidencePath },
      })
    }
    const absolute = canonicalPath(evidencePath, currentRoot)
    if (!isContained(currentRoot, absolute) || !existsSync(absolute) || isDirectory(absolute)) {
      fail({
        code: 'VERIFICATION_PRECONDITION',
        message: 'each evidence path must resolve to an existing file in the current worktree',
        change,
        details: { evidencePath },
      })
    }
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', '--', evidencePath], {
        cwd: currentRoot,
        stdio: ['ignore', 'ignore', 'ignore'],
      })
    } catch {
      fail({
        code: 'VERIFICATION_PRECONDITION',
        message: 'each evidence path must be tracked by git',
        change,
        details: { evidencePath },
      })
    }
    const attributed = touched.some(
      (entry: unknown) =>
        entry &&
        typeof entry === 'object' &&
        String(Reflect.get(entry, 'task_id')) !== completion.taskId &&
        Array.isArray(Reflect.get(entry, 'files')) &&
        Reflect.get(entry, 'files').includes(evidencePath),
    )
    if (!attributed) {
      fail({
        code: 'VERIFICATION_PRECONDITION',
        message: 'each evidence path must already be attributed to another task',
        change,
        details: { evidencePath },
      })
    }
    canonicalEvidence.set(absolute, snapshotFile(absolute))
  }

  const evidence = spawnSync(completion.command[0], completion.command.slice(1), {
    cwd: currentRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (evidence.error || evidence.status !== 0) {
    if (evidence.stdout) process.stderr.write(evidence.stdout)
    if (evidence.stderr) process.stderr.write(evidence.stderr)
    fail({
      code: 'VERIFICATION_FAILED',
      message: 'verification evidence command did not exit successfully',
      change,
      currentRoot,
      details: { status: evidence.status, error: evidence.error?.message },
    })
  }
  if (git(currentRoot, ['status', '--porcelain=v1', '--untracked-files=all'])) {
    fail({
      code: 'VERIFICATION_POSTCONDITION',
      message: 'verification evidence command changed the worktree',
      change,
      currentRoot,
    })
  }
  for (const [absolute, saved] of canonicalEvidence) {
    const after = snapshotFile(absolute)
    if (after.exists !== saved.exists || after.hash !== saved.hash) {
      fail({
        code: 'VERIFICATION_POSTCONDITION',
        message: 'verification evidence command changed an evidence file',
        change,
        currentRoot,
        details: { evidencePath: relative(currentRoot, absolute) },
      })
    }
  }
  for (const worktree of worktrees) {
    const saved = before.get(worktree.root)
    const after = snapshotMutationFiles(worktree.root, change, currentRoot)
    if (
      after.tasks.exists !== saved?.tasks.exists ||
      after.tasks.hash !== saved?.tasks.hash ||
      after.sidecar.exists !== saved?.sidecar.exists ||
      after.sidecar.hash !== saved?.sidecar.hash
    ) {
      fail({
        code: 'VERIFICATION_POSTCONDITION',
        message: 'verification evidence command changed task bookkeeping',
        change,
        currentRoot,
        details: { worktreeRoot: worktree.root },
      })
    }
  }

  touched.push({
    task_id: completion.taskId,
    task_desc: checked.description,
    files: completion.evidencePaths,
  })
  const currentPaths = mutationPaths(currentRoot, change, currentRoot)
  activeRollback = () => {
    const saved = before.get(currentRoot)
    if (saved) restoreMutationFiles(currentRoot, change, currentRoot, saved)
  }
  try {
    writeFileSync(currentPaths.tasks, checked.text)
    writeFileSync(currentPaths.sidecar, `${JSON.stringify(sidecar, null, 2)}\n`)
  } catch (error) {
    fail({
      code: 'VERIFICATION_FAILED',
      message: 'verification-only completion could not write task bookkeeping',
      change,
      currentRoot,
      details: error instanceof Error ? error.message : String(error),
    })
  }

  const afterCurrent = snapshotMutationFiles(currentRoot, change, currentRoot)
  const failures: string[] = []
  const beforeStates = checkboxStates(beforeCurrent.tasks.text)
  const afterStates = checkboxStates(afterCurrent.tasks.text)
  for (const id of new Set([...beforeStates.keys(), ...afterStates.keys()])) {
    const expected = id === completion.taskId ? true : beforeStates.get(id)
    if (afterStates.get(id) !== expected) failures.push(`unexpected checkbox state for task ${id}`)
  }
  if (!sidecarContainsTask(afterCurrent.sidecar.text, change, completion.taskId)) {
    failures.push('current touched sidecar did not record the verification-only task')
  }
  for (const worktree of worktrees) {
    if (worktree.root === currentRoot) continue
    const saved = before.get(worktree.root)
    const after = snapshotMutationFiles(worktree.root, change, currentRoot)
    if (
      after.tasks.exists !== saved?.tasks.exists ||
      after.tasks.hash !== saved?.tasks.hash ||
      after.sidecar.exists !== saved?.sidecar.exists ||
      after.sidecar.hash !== saved?.sidecar.hash
    ) {
      failures.push(`foreign worktree mutation detected at ${worktree.root}`)
    }
  }
  if (failures.length > 0) {
    fail({
      code: 'VERIFICATION_POSTCONDITION',
      message: 'verification-only completion postconditions failed',
      change,
      currentRoot,
      details: { taskId: completion.taskId, failures },
    })
  }

  activeRollback = null
  if (evidence.stdout) process.stderr.write(evidence.stdout)
  if (evidence.stderr) process.stderr.write(evidence.stderr)
  process.stdout.write(
    `${JSON.stringify({
      change,
      task_id: completion.taskId,
      status: 'done',
      completion: 'verification-only',
      evidence_paths: completion.evidencePaths,
    })}\n`,
  )
}

function verifyTaskDone(
  target: TargetContext,
  change: string,
  taskId: string,
  before: Map<string, RelevantSnapshot>,
): void {
  const previous = before.get(target.currentRoot)
  const tasksPath = join(target.currentChangeDir, 'tasks.md')
  const afterTasks = snapshotFile(tasksPath)
  const afterSidecar = snapshotFile(
    join(target.currentRoot, '.spectra', 'touched', `${change}.json`),
  )
  const beforeStates = checkboxStates(previous?.tasks.text ?? null)
  const afterStates = checkboxStates(afterTasks.text)
  const failures: string[] = []
  if (beforeStates.get(taskId) !== false || afterStates.get(taskId) !== true) {
    failures.push(`task ${taskId} did not change from unchecked to checked`)
  }
  for (const id of new Set([...beforeStates.keys(), ...afterStates.keys()])) {
    if (id !== taskId && beforeStates.get(id) !== afterStates.get(id)) {
      failures.push(`unexpected checkbox change for task ${id}`)
    }
  }
  if (
    !afterSidecar.exists ||
    afterSidecar.hash === previous?.sidecar.hash ||
    !sidecarContainsTask(afterSidecar.text, change, taskId)
  ) {
    failures.push('current touched sidecar did not record the requested task')
  }
  if (failures.length > 0) {
    fail({
      code: 'MUTATION_POSTCONDITION',
      message: 'Spectra task done mutation could not be proven local and complete',
      change,
      currentRoot: target.currentRoot,
      details: { taskId, failures },
    })
  }
}

function recoverInterruptedTaskDone(
  change: string,
  recovery: TaskDoneRecovery,
  currentRoot: string,
  worktrees: WorktreeRecord[],
): void {
  const { taskId } = recovery
  const before = new Map<string, { tasks: FileSnapshot; sidecar: FileSnapshot }>()
  for (const worktree of worktrees) {
    before.set(worktree.root, snapshotMutationFiles(worktree.root, change, currentRoot))
  }
  const beforeCurrent = before.get(currentRoot)
  if (!beforeCurrent?.tasks.text || !beforeCurrent.sidecar.text) {
    fail({
      code: 'RECOVERY_PRECONDITION',
      message: 'recovery requires existing tasks.md and touched sidecar snapshots',
      change,
      currentRoot,
      details: { taskId },
    })
  }
  if (checkboxStates(beforeCurrent.tasks.text).get(taskId) !== true) {
    fail({
      code: 'RECOVERY_PRECONDITION',
      message: `task ${taskId} is not checked in the current worktree`,
      change,
      currentRoot,
    })
  }
  const nextTasks = uncheckedTaskText(beforeCurrent.tasks.text, taskId)
  const nextSidecar = recoveredSidecarText(beforeCurrent.sidecar.text, change, recovery)
  const currentPaths = mutationPaths(currentRoot, change, currentRoot)

  activeRollback = () => {
    const saved = before.get(currentRoot)
    if (saved) restoreMutationFiles(currentRoot, change, currentRoot, saved)
  }
  try {
    writeFileSync(currentPaths.tasks, nextTasks)
    if (nextSidecar !== null) writeFileSync(currentPaths.sidecar, nextSidecar)
  } catch (error) {
    fail({
      code: 'RECOVERY_FAILED',
      message: 'interrupted task recovery could not write the restored snapshots',
      change,
      currentRoot,
      details: error instanceof Error ? error.message : String(error),
    })
  }

  const afterCurrent = snapshotMutationFiles(currentRoot, change, currentRoot)
  const beforeStates = checkboxStates(beforeCurrent.tasks.text)
  const afterStates = checkboxStates(afterCurrent.tasks.text)
  const failures: string[] = []
  for (const id of new Set([...beforeStates.keys(), ...afterStates.keys()])) {
    const expected = id === taskId ? false : beforeStates.get(id)
    if (afterStates.get(id) !== expected)
      failures.push(`unexpected recovered checkbox state for task ${id}`)
  }
  if (recovery.mode === 'checkbox-only') {
    if (
      afterCurrent.sidecar.exists !== beforeCurrent.sidecar.exists ||
      afterCurrent.sidecar.hash !== beforeCurrent.sidecar.hash
    ) {
      failures.push('checkbox-only recovery changed the current touched sidecar')
    }
  } else if (sidecarContainsTask(afterCurrent.sidecar.text, change, taskId)) {
    failures.push('recovered touched sidecar still records the interrupted task')
  }
  for (const worktree of worktrees) {
    if (worktree.root === currentRoot) continue
    const saved = before.get(worktree.root)
    const after = snapshotMutationFiles(worktree.root, change, currentRoot)
    if (
      after.tasks.exists !== saved?.tasks.exists ||
      after.tasks.hash !== saved?.tasks.hash ||
      after.sidecar.exists !== saved?.sidecar.exists ||
      after.sidecar.hash !== saved?.sidecar.hash
    ) {
      failures.push(`foreign worktree mutation detected at ${worktree.root}`)
    }
  }
  if (failures.length > 0) {
    fail({
      code: 'RECOVERY_FAILED',
      message: 'interrupted task recovery postconditions failed',
      change,
      currentRoot,
      details: { taskId, failures },
    })
  }
  activeRollback = null
  process.stdout.write(
    `${JSON.stringify({
      change,
      task_id: taskId,
      status: 'recovered',
      ...(recovery.mode === 'checkbox-only' ? { recovery: 'checkbox-only' } : {}),
    })}\n`,
  )
}

function changedTreePaths(before: TreeSnapshot, after: TreeSnapshot): string[] {
  const paths = new Set([...before.files.keys(), ...after.files.keys()])
  return [...paths].filter((path) => before.files.get(path) !== after.files.get(path)).toSorted()
}

function expectedArtifactPath(args: string[], target: TargetContext): string | null {
  if (args[0] !== 'new' || args[1] !== 'artifact') return null
  const artifact = args[2]
  if (artifact === 'proposal') return join(target.currentChangeDir, 'proposal.md')
  if (artifact === 'design') return join(target.currentChangeDir, 'design.md')
  if (artifact === 'tasks') return join(target.currentChangeDir, 'tasks.md')
  if (artifact === 'spec' && args[3])
    return join(target.currentChangeDir, 'specs', args[3], 'spec.md')
  return null
}

function ensureNewArtifactPrecondition(
  target: TargetContext,
  change: string,
  args: string[],
): void {
  const expected = expectedArtifactPath(args, target)
  if (
    !expected ||
    !isContained(target.currentChangeDir, canonicalPath(expected, target.currentRoot))
  ) {
    fail({
      code: 'TARGET_UNPROVEN',
      message: 'the expected artifact path could not be derived from the guarded command',
      change,
      currentRoot: target.currentRoot,
      details: { args },
    })
  }
  if (existsSync(expected)) {
    fail({
      code: 'MUTATION_POSTCONDITION',
      message: 'new artifact refuses to overwrite an existing current artifact',
      change,
      currentRoot: target.currentRoot,
      details: { expected: relative(target.currentChangeDir, expected) },
    })
  }
}

function verifyNewArtifact(
  target: TargetContext,
  change: string,
  args: string[],
  before: Map<string, RelevantSnapshot>,
): void {
  const expected = expectedArtifactPath(args, target)
  if (
    !expected ||
    !isContained(target.currentChangeDir, canonicalPath(expected, target.currentRoot))
  ) {
    fail({
      code: 'TARGET_UNPROVEN',
      message: 'the expected artifact path could not be derived from the guarded command',
      change,
      currentRoot: target.currentRoot,
      details: { args },
    })
  }
  const previous = before.get(target.currentRoot)?.active ?? { files: new Map() }
  const after = snapshotTree(target.currentChangeDir)
  const changed = changedTreePaths(previous, after)
  const expectedRel = relative(target.currentChangeDir, expected)
  if (changed.length !== 1 || changed[0] !== expectedRel || !existsSync(expected)) {
    fail({
      code: 'MUTATION_POSTCONDITION',
      message: 'new artifact changed paths outside the expected current artifact',
      change,
      currentRoot: target.currentRoot,
      details: { expected: expectedRel, changed },
    })
  }
}

function containsChange(value: unknown, change: string): boolean {
  if (value === change) return true
  if (Array.isArray(value)) return value.some((entry) => containsChange(entry, change))
  if (!value || typeof value !== 'object') return false
  return Object.values(value).some((entry) => containsChange(entry, change))
}

function changeStatus(value: unknown, change: string): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const status = changeStatus(entry, change)
      if (status) return status
    }
    return null
  }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.name === change && typeof record.status === 'string') return record.status
  for (const entry of Object.values(record)) {
    const status = changeStatus(entry, change)
    if (status) return status
  }
  return null
}

function queryJson(target: TargetContext, args: string[], change: string): unknown {
  const result = runSpectra(target.currentRoot, args)
  if (result.status !== 0 || !result.stdout.trim()) {
    fail({
      code: 'TARGET_UNPROVEN',
      message: 'Spectra postcondition query failed',
      change,
      currentRoot: target.currentRoot,
      details: { args, status: result.status },
    })
  }
  return parseJson(result, change, target.currentRoot)
}

function verifyInProgress(target: TargetContext, change: string): void {
  const body = queryJson(target, ['list', '--json'], change)
  const status = changeStatus(body, change)
  if (status !== 'in-progress') {
    fail({
      code: 'MUTATION_POSTCONDITION',
      message: 'in-progress add did not leave the requested change in in-progress state',
      change,
      currentRoot: target.currentRoot,
      details: { observedStatus: status },
    })
  }
  attestExistingTarget(target, change)
}

function bindingDir(commonDir: string): string {
  return join(commonDir, 'clade-spectra-target-bindings')
}

function bindingPath(commonDir: string, change: string): string {
  return join(bindingDir(commonDir), `${change}.json`)
}

function writeBinding(target: TargetContext, change: string, artifactHash: string): void {
  const dir = bindingDir(target.commonDir)
  mkdirSync(dir, { recursive: true })
  const path = bindingPath(target.commonDir, change)
  const temporary = `${path}.${process.pid}.tmp`
  const binding: ParkBinding = {
    version: 1,
    change,
    root: target.currentRoot,
    commonDir: target.commonDir,
    artifactHash,
    createdAt: new Date().toISOString(),
  }
  writeFileSync(temporary, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

function readBinding(target: TargetContext, change: string): ParkBinding {
  const path = bindingPath(target.commonDir, change)
  let binding: ParkBinding
  try {
    binding = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail({
      code: 'TARGET_UNPROVEN',
      message: 'unpark requires a clade-owned park binding for the current root',
      change,
      currentRoot: target.currentRoot,
      details: error instanceof Error ? error.message : String(error),
    })
  }
  if (
    binding.version !== 1 ||
    binding.change !== change ||
    canonicalPath(binding.root, target.currentRoot) !== target.currentRoot ||
    canonicalPath(binding.commonDir, target.currentRoot) !== target.commonDir
  ) {
    fail({
      code: 'TARGET_FOREIGN',
      message: 'the park binding belongs to another worktree or git common-dir',
      change,
      currentRoot: target.currentRoot,
      details: binding,
    })
  }
  return binding
}

function parkedContains(target: TargetContext, change: string): boolean {
  const body = queryJson(target, ['list', '--parked', '--json'], change)
  return containsChange(body, change)
}

function findArchiveDirs(root: string, change: string): string[] {
  const archiveRoot = join(root, SPEC_DIR, 'changes', 'archive')
  if (!isDirectory(archiveRoot)) return []
  return readdirSync(archiveRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && (entry.name === change || entry.name.endsWith(`-${change}`)),
    )
    .map((entry) => join(archiveRoot, entry.name))
}

function verifyPark(
  target: TargetContext,
  change: string,
  before: Map<string, RelevantSnapshot>,
): void {
  if (isDirectory(target.currentChangeDir) || !parkedContains(target, change)) {
    fail({
      code: 'MUTATION_POSTCONDITION',
      message: 'park did not remove the current active target and register it as parked',
      change,
      currentRoot: target.currentRoot,
    })
  }
  const artifactHash = treeHash(before.get(target.currentRoot)?.active ?? { files: new Map() })
  writeBinding(target, change, artifactHash)
}

function verifyUnpark(target: TargetContext, change: string, binding: ParkBinding): void {
  if (!isDirectory(target.currentChangeDir) || parkedContains(target, change)) {
    fail({
      code: 'MUTATION_POSTCONDITION',
      message: 'unpark did not restore the current active target and clear its parked entry',
      change,
      currentRoot: target.currentRoot,
    })
  }
  const restoredHash = treeHash(snapshotTree(target.currentChangeDir))
  if (restoredHash !== binding.artifactHash) {
    fail({
      code: 'MUTATION_POSTCONDITION',
      message: 'unpark restored artifacts whose hash does not match the park binding',
      change,
      currentRoot: target.currentRoot,
      details: { expected: binding.artifactHash, actual: restoredHash },
    })
  }
  attestExistingTarget(target, change)
  unlinkSync(bindingPath(target.commonDir, change))
}

function verifyArchive(target: TargetContext, change: string): void {
  if (
    isDirectory(target.currentChangeDir) ||
    findArchiveDirs(target.currentRoot, change).length === 0
  ) {
    fail({
      code: 'MUTATION_POSTCONDITION',
      message: 'archive did not move the requested change into the current root archive',
      change,
      currentRoot: target.currentRoot,
    })
  }
}

function ensureCreatePrecondition(target: TargetContext, change: string): void {
  if (target.candidates.length > 0 || parkedContains(target, change)) {
    fail({
      code: 'TARGET_UNPROVEN',
      message: 'new change requires the name to be absent from every active and parked target',
      change,
      currentRoot: target.currentRoot,
      candidates: target.candidates.map((entry) => entry.root),
    })
  }
}

function verifyNewChange(target: TargetContext, change: string): void {
  const currentExists = isDirectory(target.currentChangeDir)
  const foreign = target.worktrees.filter(
    (worktree) =>
      worktree.root !== target.currentRoot &&
      isDirectory(join(worktree.root, SPEC_DIR, 'changes', change)),
  )
  if (!currentExists || foreign.length > 0) {
    fail({
      code: 'MUTATION_POSTCONDITION',
      message: 'new change was not created exclusively in the current root',
      change,
      currentRoot: target.currentRoot,
      details: { currentExists, foreignRoots: foreign.map((entry) => entry.root) },
    })
  }
  attestExistingTarget(target, change)
}

function emitChild(result: ChildResult): never | void {
  if (result.status !== 0) {
    const rollback = rollbackActiveMutation()
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (rollback.error) {
      fail({
        code: 'ROLLBACK_FAILED',
        message: 'Spectra failed and current task bookkeeping could not be restored',
        details: rollback.error,
      })
    }
    throw new ChildExit(result.status)
  }
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

function main(): void {
  const { change, spectraArgs } = parseArgs(process.argv.slice(2))
  const command = classifyCommand(spectraArgs)
  validateCommandBinding(change, spectraArgs, command)
  const target = resolveTarget(change)
  const release = acquireLock(target, change)
  try {
    if (command.kind === 'global-read-only') {
      emitChild(runSpectra(target.currentRoot, spectraArgs))
      return
    }

    if (command.operation === 'unpark') {
      const binding = readBinding(target, change)
      if (!parkedContains(target, change)) {
        fail({
          code: 'TARGET_UNPROVEN',
          message: 'the bound change is not present in the parked registry',
          change,
          currentRoot: target.currentRoot,
        })
      }
      const before = snapshotAll(target, change)
      const result = runSpectra(target.currentRoot, spectraArgs)
      verifyForeignUnchanged(target, change, before)
      if (result.status !== 0) emitChild(result)
      verifyUnpark(target, change, binding)
      emitChild(result)
      return
    }

    if (command.kind === 'create-before-target') {
      ensureCreatePrecondition(target, change)
      const before = snapshotAll(target, change)
      const result = runSpectra(target.currentRoot, spectraArgs)
      verifyForeignUnchanged(target, change, before)
      if (result.status !== 0) emitChild(result)
      verifyNewChange(target, change)
      emitChild(result)
      return
    }

    requireExistingTarget(change, target)

    if (command.kind === 'existing-read-only' && spectraArgs.includes('--json')) {
      const result = runSpectra(target.currentRoot, spectraArgs)
      if (result.status !== 0) emitChild(result)
      const body = parseJson(result, change, target.currentRoot)
      const paths: string[] = []
      collectPathValues(body, null, paths)
      if (paths.length > 0) attestBody(body, target, change)
      else attestExistingTarget(target, change)
      emitChild(result)
      return
    }

    if (command.operation === 'task-recover-done') {
      const recovery = taskDoneRecovery(spectraArgs)
      if (!recovery) {
        fail({
          code: 'USAGE_ERROR',
          message:
            'task recover-done requires either <numeric ordinal> or --checkbox-only <numeric ordinal>',
          change,
          currentRoot: target.currentRoot,
        })
      }
      recoverInterruptedTaskDone(change, recovery, target.currentRoot, target.worktrees)
      return
    }
    if (command.operation === 'task-verify-done') {
      const verification = verificationDone(spectraArgs, change)
      if (!verification) {
        fail({
          code: 'USAGE_ERROR',
          message: 'task verify-done requires explicit verification-only evidence',
          change,
          currentRoot: target.currentRoot,
        })
      }
      completeVerificationTask(change, verification, target.currentRoot, target.worktrees)
      return
    }

    attestExistingTarget(target, change)
    if (command.kind === 'existing-read-only') {
      emitChild(runSpectra(target.currentRoot, spectraArgs))
      return
    }

    const taskId = command.operation === 'task-done' ? taskDoneId(spectraArgs) : null
    if (command.operation === 'task-done' && !taskId) {
      fail({
        code: 'USAGE_ERROR',
        message: 'task done requires a task id after --change <name>',
        change,
        currentRoot: target.currentRoot,
      })
    }
    if (command.operation === 'new-artifact') {
      ensureNewArtifactPrecondition(target, change, spectraArgs)
    }
    const before = snapshotAll(target, change)
    if (command.operation === 'task-done') {
      activeRollback = () => {
        const saved = before.get(target.currentRoot)
        if (saved) restoreMutationFiles(target.currentRoot, change, target.currentRoot, saved)
      }
    }
    const result = runSpectra(target.currentRoot, spectraArgs)
    verifyForeignUnchanged(target, change, before)
    if (result.status !== 0) emitChild(result)

    if (command.operation === 'task-done') {
      verifyTaskDone(target, change, taskId!, before)
      if (spectraArgs.includes('--json')) parseJson(result, change, target.currentRoot)
      activeRollback = null
    } else if (command.operation === 'new-artifact')
      verifyNewArtifact(target, change, spectraArgs, before)
    else if (command.operation === 'in-progress-add') verifyInProgress(target, change)
    else if (command.operation === 'park') verifyPark(target, change, before)
    else if (command.operation === 'archive') verifyArchive(target, change)
    else if (command.operation === 'sync') attestExistingTarget(target, change)

    emitChild(result)
  } finally {
    release()
  }
}

try {
  main()
} catch (error) {
  if (error instanceof GuardFailure) {
    process.stderr.write(
      `${JSON.stringify({ kind: 'spectra-target-guard-error', ...error.detail })}\n`,
    )
    process.exitCode = ERROR_EXIT
  } else if (error instanceof ChildExit) {
    process.exitCode = error.status
  } else {
    throw error
  }
}
