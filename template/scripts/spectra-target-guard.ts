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
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
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

function fail(error: GuardError): never {
  process.stderr.write(`${JSON.stringify({ kind: 'spectra-target-guard-error', ...error })}\n`)
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

function snapshotMutationFiles(
  root: string,
  change: string,
  currentRoot: string,
): { tasks: FileSnapshot; sidecar: FileSnapshot } {
  const tasksPath = canonicalPath(join(root, SPEC_DIR, 'changes', change, 'tasks.md'), root)
  const sidecarPath = canonicalPath(join(root, '.spectra', 'touched', `${change}.json`), root)
  for (const [label, path] of [
    ['tasks.md', tasksPath],
    ['touched sidecar', sidecarPath],
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
  return { tasks: snapshot(tasksPath), sidecar: snapshot(sidecarPath) }
}

function checkboxStates(text: string | null): Map<string, boolean> {
  const states = new Map<string, boolean>()
  for (const line of (text ?? '').split('\n')) {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(\S+)(?:\s|$)/)
    if (!match) continue
    if (states.has(match[2])) {
      fail({
        code: 'MUTATION_POSTCONDITION',
        message: 'tasks.md contains duplicate task ids, so the requested checkbox cannot be proven',
        details: { taskId: match[2] },
      })
    }
    states.set(match[2], match[1].toLowerCase() === 'x')
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

function sidecarContainsTask(text: string | null, change: string, taskId: string): boolean {
  if (!text) return false
  try {
    const body = JSON.parse(text)
    return (
      body?.change === change &&
      Array.isArray(body?.touched) &&
      body.touched.some((entry) => String(entry?.task_id) === taskId)
    )
  } catch {
    return false
  }
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
  if (spectraArgs[0] === 'task' && spectraArgs[1] === 'done' && !taskId) {
    fail({
      code: 'USAGE_ERROR',
      message: 'task done requires a task id after --change <name>',
      change,
      currentRoot: target.currentRoot,
    })
  }

  const duplicateCandidates = target.candidates.length > 1
  const isJson = spectraArgs.includes('--json')
  const isStatusJson = isJson && spectraArgs[0] === 'status'
  const isInstructionsJson = isJson && spectraArgs[0] === 'instructions'
  const canProbeBeforeMutation =
    Boolean(taskId) || spectraArgs[0] === 'in-progress' || spectraArgs[0] === 'validate'
  if (duplicateCandidates) {
    if (isStatusJson || canProbeBeforeMutation) {
      probeCurrentTarget(change, target.currentRoot, target.candidateRoots)
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
  if (isJson && stdout.trim()) {
    validateJsonOutput(stdout, target.currentRoot, change, duplicateCandidates && !isStatusJson)
  } else if (isJson && duplicateCandidates && child.status === 0) {
    fail({
      code: 'TARGET_AMBIGUOUS',
      message: 'Spectra JSON output was empty, so the duplicate target cannot be proven',
      change,
      currentRoot: target.currentRoot,
      candidates: target.candidateRoots,
    })
  }
  if (child.status !== 0) {
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
    process.exit(child.status ?? 1)
  }
  if (taskId) verifyTaskDone(change, taskId, target.currentRoot, target.worktrees, before)
  if (isUnpark) verifyUnpark(change, target.currentRoot, target.worktrees)

  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
}

main()
