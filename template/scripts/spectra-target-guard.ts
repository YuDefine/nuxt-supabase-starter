#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/spectra-target-guard.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/spectra-target-guard.ts

/**
 * Fail-closed integration guard for closed-source kaochenlong/spectra-app v2.3.1.
 *
 * The upstream Wine CLI has no explicit project/worktree selector. This wrapper
 * proves read-only targets from returned artifact paths, probes the target before
 * ambiguous mutations, and verifies filesystem mutation postconditions before
 * any child output is released to the caller.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const SPEC_DIR = 'openspec'
const PATH_FIELDS = new Set(['worktreePath', 'changeDir', 'contextFiles'])
const ERROR_EXIT = 2

interface GuardError {
  code: string
  message: string
  change?: string
  currentRoot?: string
  candidates?: string[]
  details?: unknown
}

type MutationRollback = () => void

let activeRollback: MutationRollback | null = null

interface ParsedArgs {
  change: string
  spectraArgs: string[]
}

interface WorktreeRecord {
  root: string
  commonDir: string
  changeDir: string
  hasChange: boolean
}

interface FileSnapshot {
  exists: boolean
  hash: string | null
  text: string | null
}

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

function fail(error: GuardError): never {
  const rollback = rollbackActiveMutation()
  process.stderr.write(
    `${JSON.stringify({
      kind: 'spectra-target-guard-error',
      ...error,
      ...(rollback.attempted
        ? {
            rollback: rollback.error
              ? { status: 'failed', error: rollback.error }
              : { status: 'restored' },
          }
        : {}),
    })}\n`,
  )
  process.exit(ERROR_EXIT)
}

function parseArgs(argv: string[]): ParsedArgs {
  const separator = argv.indexOf('--')
  if (separator === -1) {
    fail({
      code: 'USAGE_ERROR',
      message: 'usage: node scripts/spectra-target-guard.ts --change <name> -- <spectra args...>',
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
  const roots = output
    .split('\0')
    .filter((field) => field.startsWith('worktree '))
    .map((field) => canonicalPath(field.slice('worktree '.length), currentRoot))
  return [...new Set(roots)]
}

function resolveTarget(
  change: string,
  allowMissingCurrent = false,
): {
  currentRoot: string
  commonDir: string
  worktrees: WorktreeRecord[]
  candidates: WorktreeRecord[]
  candidateRoots: string[]
} {
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
    return {
      root,
      commonDir: candidateCommon,
      changeDir,
      hasChange,
    }
  })
  const candidates = worktrees.filter((entry) => entry.hasChange)
  const candidateRoots = candidates.map((entry) => entry.root)
  const currentChange = canonicalPath(join(currentRoot, SPEC_DIR, 'changes', change), currentRoot)

  if (!isDirectory(currentChange)) {
    if (allowMissingCurrent && candidates.length === 0) {
      return { currentRoot, commonDir, worktrees, candidates, candidateRoots }
    }
    fail({
      code: candidates.length === 1 ? 'TARGET_FOREIGN' : 'TARGET_MISSING',
      message:
        candidates.length === 1
          ? 'the requested change exists only in a foreign registered worktree'
          : 'the requested change does not exist in the current registered worktree set',
      change,
      currentRoot,
      candidates: candidateRoots,
    })
  }
  if (candidates.length === 0) {
    fail({
      code: 'TARGET_MISSING',
      message: 'the current change directory was not found among registered worktrees',
      change,
      currentRoot,
      candidates: [],
    })
  }
  const currentCandidate = candidates.find((entry) => entry.root === currentRoot)
  if (!currentCandidate || currentCandidate.commonDir !== commonDir) {
    fail({
      code: 'TARGET_FOREIGN',
      message:
        'the requested change is not present in the current worktree and current git common-dir',
      change,
      currentRoot,
      candidates: candidateRoots,
      details: {
        currentCommonDir: commonDir,
        candidateCommonDir: currentCandidate?.commonDir ?? null,
      },
    })
  }
  return { currentRoot, commonDir, worktrees, candidates, candidateRoots }
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

function validateJsonOutput(
  stdout: string,
  currentRoot: string,
  change: string,
  requireChangeEvidence = false,
): void {
  let body: unknown
  try {
    body = JSON.parse(stdout)
  } catch (error) {
    fail({
      code: 'OUTPUT_INVALID',
      message: 'Spectra --json output was not valid JSON; buffered output was withheld',
      change,
      currentRoot,
      details: error instanceof Error ? error.message : String(error),
    })
  }
  const paths: string[] = []
  collectPathValues(body, null, paths)
  const currentChange = canonicalPath(join(currentRoot, SPEC_DIR, 'changes', change), currentRoot)
  let hasChangeEvidence = false
  for (const rawPath of paths) {
    const path = canonicalPath(rawPath, currentRoot)
    if (!isContained(currentRoot, path)) {
      fail({
        code: 'TARGET_FOREIGN',
        message:
          'Spectra returned an artifact path outside the current worktree; output was withheld',
        change,
        currentRoot,
        details: { path: rawPath, canonicalPath: path },
      })
    }
    if (isContained(currentChange, path)) hasChangeEvidence = true
  }
  if (requireChangeEvidence && !hasChangeEvidence) {
    fail({
      code: 'TARGET_AMBIGUOUS',
      message: 'Spectra JSON did not include a current change artifact path that proves its target',
      change,
      currentRoot,
    })
  }
}

function probeCurrentTarget(change: string, currentRoot: string, candidateRoots: string[]): void {
  const probe = spawnSync('spectra', ['instructions', 'apply', '--change', change, '--json'], {
    cwd: currentRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (probe.error) {
    fail({
      code: 'SPECTRA_EXEC_FAILED',
      message: 'Spectra target probe could not be started',
      change,
      currentRoot,
      candidates: candidateRoots,
      details: probe.error.message,
    })
  }
  if (probe.status !== 0 || !(probe.stdout ?? '').trim()) {
    fail({
      code: 'TARGET_AMBIGUOUS',
      message: 'read-only Spectra target probe did not return usable JSON',
      change,
      currentRoot,
      candidates: candidateRoots,
      details: { status: probe.status, stderr: probe.stderr ?? '' },
    })
  }
  validateJsonOutput(probe.stdout ?? '', currentRoot, change, true)
}

function verifyUnpark(change: string, currentRoot: string, worktrees: WorktreeRecord[]): void {
  const restoredRoots = worktrees
    .filter((entry) =>
      isDirectory(canonicalPath(join(entry.root, SPEC_DIR, 'changes', change), entry.root)),
    )
    .map((entry) => entry.root)
  if (restoredRoots.length !== 1 || restoredRoots[0] !== currentRoot) {
    fail({
      code: 'MUTATION_POSTCONDITION',
      message: 'Spectra unpark did not restore the change exclusively into the current worktree',
      change,
      currentRoot,
      candidates: restoredRoots,
    })
  }
}

function snapshot(path: string): FileSnapshot {
  if (!existsSync(path)) return { exists: false, hash: null, text: null }
  const text = readFileSync(path, 'utf8')
  return {
    exists: true,
    hash: createHash('sha256').update(text).digest('hex'),
    text,
  }
}

function mutationPaths(
  root: string,
  change: string,
  currentRoot: string,
): { tasks: string; sidecar: string } {
  const paths = {
    tasks: canonicalPath(join(root, SPEC_DIR, 'changes', change, 'tasks.md'), root),
    sidecar: canonicalPath(join(root, '.spectra', 'touched', `${change}.json`), root),
  }
  for (const [label, path] of [
    ['tasks.md', paths.tasks],
    ['touched sidecar', paths.sidecar],
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
  return paths
}

function snapshotMutationFiles(
  root: string,
  change: string,
  currentRoot: string,
): { tasks: FileSnapshot; sidecar: FileSnapshot } {
  const paths = mutationPaths(root, change, currentRoot)
  return { tasks: snapshot(paths.tasks), sidecar: snapshot(paths.sidecar) }
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
  const paths = mutationPaths(root, change, currentRoot)
  restoreSnapshot(paths.tasks, saved.tasks)
  restoreSnapshot(paths.sidecar, saved.sidecar)
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
      body.touched.some((entry: unknown) =>
        Boolean(
          entry && typeof entry === 'object' && String(Reflect.get(entry, 'task_id')) === taskId,
        ),
      )
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
    canonicalEvidence.set(absolute, snapshot(absolute))
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
    const after = snapshot(absolute)
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
    for (const worktree of worktrees) {
      const saved = before.get(worktree.root)
      if (saved) restoreMutationFiles(worktree.root, change, currentRoot, saved)
    }
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
  change: string,
  taskId: string,
  currentRoot: string,
  worktrees: WorktreeRecord[],
  before: Map<string, { tasks: FileSnapshot; sidecar: FileSnapshot }>,
): void {
  const afterCurrent = snapshotMutationFiles(currentRoot, change, currentRoot)
  const afterTasks = afterCurrent.tasks
  const afterSidecar = afterCurrent.sidecar
  const beforeCurrent = before.get(currentRoot)
  const beforeStates = checkboxStates(beforeCurrent?.tasks.text ?? null)
  const afterStates = checkboxStates(afterTasks.text)
  const failures: string[] = []

  if (beforeStates.get(taskId) !== false || afterStates.get(taskId) !== true) {
    failures.push(`task ${taskId} did not change from unchecked to checked in current tasks.md`)
  }
  const allTaskIds = new Set([...beforeStates.keys(), ...afterStates.keys()])
  for (const id of allTaskIds) {
    if (id !== taskId && beforeStates.get(id) !== afterStates.get(id)) {
      failures.push(`unexpected checkbox change for task ${id}`)
    }
  }
  if (
    !afterSidecar.exists ||
    afterSidecar.hash === beforeCurrent?.sidecar.hash ||
    !sidecarContainsTask(afterSidecar.text, change, taskId)
  ) {
    failures.push('current touched sidecar did not record the requested task')
  }

  for (const worktree of worktrees) {
    if (worktree.root === currentRoot) continue
    const previous = before.get(worktree.root)
    const foreignAfter = snapshotMutationFiles(worktree.root, change, currentRoot)
    const foreignTasks = foreignAfter.tasks
    const foreignSidecar = foreignAfter.sidecar
    if (
      foreignTasks.exists !== previous?.tasks.exists ||
      foreignTasks.hash !== previous?.tasks.hash ||
      foreignSidecar.exists !== previous?.sidecar.exists ||
      foreignSidecar.hash !== previous?.sidecar.hash
    ) {
      failures.push(`foreign worktree mutation detected at ${worktree.root}`)
    }
  }

  if (failures.length > 0) {
    fail({
      code: 'MUTATION_POSTCONDITION',
      message: 'Spectra task done mutation could not be proven local and complete',
      change,
      currentRoot,
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
    for (const worktree of worktrees) {
      const saved = before.get(worktree.root)
      if (saved) restoreMutationFiles(worktree.root, change, currentRoot, saved)
    }
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

function main(): void {
  const { change, spectraArgs } = parseArgs(process.argv.slice(2))
  const isUnpark = spectraArgs[0] === 'unpark'
  const target = resolveTarget(change, isUnpark)
  if (isUnpark && target.candidates.length > 0) {
    fail({
      code: 'TARGET_AMBIGUOUS',
      message: 'unpark requires the named change to have no on-disk artifact candidate',
      change,
      currentRoot: target.currentRoot,
      candidates: target.candidateRoots,
    })
  }
  const taskId = taskDoneId(spectraArgs)
  const recovery = taskDoneRecovery(spectraArgs)
  const verification = verificationDone(spectraArgs, change)
  if (spectraArgs[0] === 'task' && spectraArgs[1] === 'done' && !taskId) {
    fail({
      code: 'USAGE_ERROR',
      message: 'task done requires a task id after --change <name>',
      change,
      currentRoot: target.currentRoot,
    })
  }
  if (spectraArgs[0] === 'task' && spectraArgs[1] === 'recover-done') {
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
  if (verification) {
    completeVerificationTask(change, verification, target.currentRoot, target.worktrees)
    return
  }

  const duplicateCandidates = target.candidates.length > 1
  const isJson = spectraArgs.includes('--json')
  const isStatusJson = isJson && spectraArgs[0] === 'status'
  const isInstructionsJson = isJson && spectraArgs[0] === 'instructions'
  const canProbeBeforeMutation =
    Boolean(taskId) || spectraArgs[0] === 'in-progress' || spectraArgs[0] === 'validate'
  let targetProvenBeforeMutation = false
  if (duplicateCandidates) {
    if (isStatusJson || canProbeBeforeMutation) {
      probeCurrentTarget(change, target.currentRoot, target.candidateRoots)
      targetProvenBeforeMutation = true
    } else if (!isInstructionsJson) {
      fail({
        code: 'TARGET_AMBIGUOUS',
        message: 'destructive Spectra command requires a unique on-disk change candidate',
        change,
        currentRoot: target.currentRoot,
        candidates: target.candidateRoots,
      })
    }
  }

  const before = new Map<string, { tasks: FileSnapshot; sidecar: FileSnapshot }>()
  if (taskId) {
    for (const worktree of target.worktrees) {
      before.set(worktree.root, snapshotMutationFiles(worktree.root, change, target.currentRoot))
    }
    activeRollback = () => {
      for (const worktree of target.worktrees) {
        const saved = before.get(worktree.root)
        if (saved) restoreMutationFiles(worktree.root, change, target.currentRoot, saved)
      }
    }
  }

  const child = spawnSync('spectra', spectraArgs, {
    cwd: target.currentRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (child.error) {
    fail({
      code: 'SPECTRA_EXEC_FAILED',
      message: 'Spectra executable could not be started',
      change,
      currentRoot: target.currentRoot,
      details: child.error.message,
    })
  }

  const stdout = child.stdout ?? ''
  const stderr = child.stderr ?? ''
  if (child.status !== 0) {
    const rollback = rollbackActiveMutation()
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
    if (rollback.error) {
      process.stderr.write(
        `${JSON.stringify({
          kind: 'spectra-target-guard-error',
          code: 'ROLLBACK_FAILED',
          message: 'Spectra failed and its task mutation snapshots could not be restored',
          change,
          currentRoot: target.currentRoot,
          details: rollback.error,
        })}\n`,
      )
      process.exit(ERROR_EXIT)
    }
    process.exit(child.status ?? 1)
  }

  // Mutation postconditions run before output validation. Any later guard failure
  // still owns the snapshots and therefore restores the task + sidecar atomically.
  if (taskId) verifyTaskDone(change, taskId, target.currentRoot, target.worktrees, before)
  if (isUnpark) verifyUnpark(change, target.currentRoot, target.worktrees)
  if (isJson && stdout.trim()) {
    validateJsonOutput(
      stdout,
      target.currentRoot,
      change,
      duplicateCandidates && !isStatusJson && !targetProvenBeforeMutation,
    )
  } else if (isJson) {
    const targetStillUnproven = duplicateCandidates && !targetProvenBeforeMutation
    fail({
      code: targetStillUnproven ? 'TARGET_AMBIGUOUS' : 'OUTPUT_INVALID',
      message: targetStillUnproven
        ? 'Spectra JSON output was empty, so the duplicate target cannot be proven'
        : 'Spectra --json output was empty; buffered output was withheld',
      change,
      currentRoot: target.currentRoot,
      ...(targetStillUnproven ? { candidates: target.candidateRoots } : {}),
    })
  }

  activeRollback = null
  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
}

main()
