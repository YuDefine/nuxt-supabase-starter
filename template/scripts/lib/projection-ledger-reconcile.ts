// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/projection-ledger-reconcile.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/projection-ledger-reconcile.ts
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

type ProjectionState = {
  schemaVersion: 1
  files: Record<string, string>
  sourceInputs?: Record<string, Array<{ source: string; sha256: string }>>
  [key: string]: unknown
}

const LEDGER_NAME = /^[a-z]+\.(rules|capabilities)\.json$/
const SHA256 = /^[a-f0-9]{64}$/
const safeRel = (rel: string) =>
  !rel.startsWith('/') &&
  rel
    .split('/')
    .every((part) => part !== '' && part !== '.' && part !== '..' && part !== '__proto__')

function readState(path: string, raw = readFileSync(path, 'utf8')): ProjectionState {
  const value: unknown = JSON.parse(raw)
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('files' in value) ||
    !value.files ||
    typeof value.files !== 'object' ||
    Array.isArray(value.files)
  )
    throw new Error(`invalid projection state: ${path}`)
  for (const [rel, hash] of Object.entries(value.files)) {
    if (typeof rel !== 'string' || !safeRel(rel) || typeof hash !== 'string' || !SHA256.test(hash))
      throw new Error(`invalid projection state entry: ${path}:${rel}`)
  }
  if ('sourceInputs' in value && value.sourceInputs !== undefined) {
    if (
      !value.sourceInputs ||
      typeof value.sourceInputs !== 'object' ||
      Array.isArray(value.sourceInputs) ||
      JSON.stringify(Object.keys(value.sourceInputs).toSorted()) !==
        JSON.stringify(Object.keys(value.files).toSorted())
    )
      throw new Error(`invalid projection provenance: ${path}`)
    for (const [rel, inputs] of Object.entries(value.sourceInputs)) {
      if (
        !Array.isArray(inputs) ||
        inputs.length === 0 ||
        inputs.some(
          (input) =>
            !input ||
            typeof input !== 'object' ||
            typeof input.source !== 'string' ||
            !safeRel(input.source) ||
            typeof input.sha256 !== 'string' ||
            !SHA256.test(input.sha256),
        )
      )
        throw new Error(`invalid projection provenance entry: ${path}:${rel}`)
    }
  }
  return value as ProjectionState
}

function committedDiskHash(root: string, rel: string): { hash: string | null; reason?: string } {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  )
  const git = (args: string[], maxBuffer = 1024 * 1024) =>
    execFileSync('git', args, {
      cwd: root,
      env,
      maxBuffer,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  try {
    const abs = join(root, rel)
    if (!lstatSync(abs).isFile()) return { hash: null, reason: 'disk path is not a regular file' }
    if (git(['status', '--porcelain=v1', '-z', '-uall', '--', `:(literal)${rel}`]).length > 0)
      return { hash: null, reason: 'index or worktree is dirty' }
    if (
      !git(['ls-files', '-v', '-z', '--', `:(literal)${rel}`])
        .subarray(0, 2)
        .equals(Buffer.from('H '))
    )
      return { hash: null, reason: 'path is not a normal tracked file' }
    const disk = readFileSync(abs)
    const committed = git(['show', `HEAD:./${rel}`], disk.length + 1024 * 1024)
    if (!disk.equals(committed)) return { hash: null, reason: 'disk bytes differ from HEAD' }
    return { hash: createHash('sha256').update(disk).digest('hex') }
  } catch (error) {
    return {
      hash: null,
      reason: `could not verify HEAD and disk: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function existingInfo(path: string) {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function assertNoPendingTransaction(root: string) {
  const sharedLock = join(root, '.clade', 'manifest-transaction.lock')
  const transactionDir = join(root, '.clade', 'transactions')
  const lockInfo = existingInfo(sharedLock)
  if (lockInfo && !lockInfo.isDirectory())
    throw new Error(`invalid manifest transaction lock: ${sharedLock}`)
  const transactionInfo = existingInfo(transactionDir)
  if (transactionInfo && !transactionInfo.isDirectory())
    throw new Error(`invalid manifest transaction directory: ${transactionDir}`)
  if (lockInfo || (transactionInfo && readdirSync(transactionDir).length > 0))
    throw new Error('pending manifest transaction; recover it before projection receipt reconcile')
}

// Writers claim the shared transaction lock before this namespace lock. The
// second pending check closes the gap between our first check and mkdir.
function withProjectionLock<T>(root: string, namespace: string, run: () => T): T {
  const lock = join(root, '.clade', 'projections', `${namespace}.lock`)
  const token = randomUUID()
  assertNoPendingTransaction(root)
  try {
    mkdirSync(lock, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error(
        `projection namespace lock busy: ${lock}; retry cleanup after the writer finishes`,
        { cause: error },
      )
    throw error
  }
  const owner = join(lock, 'reconcile-owner')
  let ownerWritten = false
  let result!: T
  let runError: unknown
  let failed = false
  try {
    writeFileSync(owner, token, { flag: 'wx' })
    ownerWritten = true
    assertNoPendingTransaction(root)
    result = run()
  } catch (error) {
    failed = true
    runError = error
  }
  let releaseError: unknown
  try {
    if (!ownerWritten && !existingInfo(owner)) {
      rmdirSync(lock)
    } else if (existingInfo(owner)?.isFile() && readFileSync(owner, 'utf8') === token) {
      unlinkSync(owner)
      rmdirSync(lock)
    } else if (existingInfo(lock)) {
      throw new Error(`projection namespace lock ownership changed: ${lock}`)
    }
  } catch (error) {
    releaseError = error
  }
  if (releaseError && failed)
    throw new AggregateError(
      [runError, releaseError],
      `projection reconcile and lock release failed: ${lock}`,
    )
  if (releaseError) throw releaseError
  if (failed) throw runError
  return result
}

/**
 * A landed branch carries tracked projections but not its gitignored receipt.
 * Its receipt proves the new owned bytes; HEAD plus a clean index/worktree
 * proves main has those exact bytes without a later local edit. Only paths
 * already owned by main are rebased, leaving unknown files and conflicts alone.
 */
export function reconcileLandedProjectionState(mainRoot: string, landedWorktree: string) {
  const sourceDir = join(landedWorktree, '.clade', 'projections')
  const targetDir = join(mainRoot, '.clade', 'projections')
  if (!existsSync(sourceDir) || !existsSync(targetDir))
    return { updated: 0, skipped: [] as string[] }
  if (!lstatSync(sourceDir).isDirectory() || !lstatSync(targetDir).isDirectory())
    throw new Error('projection state directory must be a real directory')
  let updated = 0
  const skipped: string[] = []
  for (const name of readdirSync(sourceDir)
    .filter((entry) => LEDGER_NAME.test(entry))
    .toSorted()) {
    const namespace = name.split('.')[1]
    withProjectionLock(mainRoot, namespace, () => {
      const sourcePath = join(sourceDir, name)
      const targetPath = join(targetDir, name)
      if (!existsSync(targetPath)) {
        skipped.push(`${name}: main receipt is missing`)
        return
      }
      if (!lstatSync(sourcePath).isFile() || !lstatSync(targetPath).isFile())
        throw new Error(`projection state must be a regular file: ${name}`)
      const sourceRaw = readFileSync(sourcePath, 'utf8')
      const source = readState(sourcePath, sourceRaw)
      const before = readFileSync(targetPath, 'utf8')
      const target = readState(targetPath, before)
      let changed = 0
      for (const [rel, oldHash] of Object.entries(target.files)) {
        const landedHash = source.files[rel]
        if (!landedHash || landedHash === oldHash) continue
        if (target.sourceInputs && !source.sourceInputs?.[rel]) {
          skipped.push(`${name}:${rel}: landed receipt lacks required provenance`)
          continue
        }
        const committed = committedDiskHash(mainRoot, rel)
        if (committed.hash !== landedHash) {
          skipped.push(
            `${name}:${rel}: ${committed.reason ?? 'landed hash differs from HEAD bytes'}`,
          )
          continue
        }
        target.files[rel] = landedHash
        if (target.sourceInputs) target.sourceInputs[rel] = source.sourceInputs![rel]
        changed++
      }
      if (changed === 0) return
      if (
        readFileSync(targetPath, 'utf8') !== before ||
        readFileSync(sourcePath, 'utf8') !== sourceRaw
      )
        throw new Error(`projection state changed during reconcile: ${targetPath}`)
      const temp = `${targetPath}.${randomUUID()}.tmp`
      try {
        writeFileSync(temp, `${JSON.stringify(target, null, 2)}\n`, { flag: 'wx' })
        renameSync(temp, targetPath)
        updated += changed
      } finally {
        if (existsSync(temp)) unlinkSync(temp)
      }
    })
  }
  return { updated, skipped }
}
