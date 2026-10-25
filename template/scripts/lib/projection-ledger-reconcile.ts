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
import { parseGitStatusZ } from './git-status-z.ts'

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

type CommittedHash = { hash: string | null; reason?: string }

const PATHSPEC_CHUNK = 500

/**
 * 一次驗完整批路徑：status／ls-files／cat-file 各跑一輪，而不是每個檔三次 git。
 * 逐檔版本在 batch cleanup 對數百個投影檔 × 多棵 worktree 時，每秒生 6 次 git status、
 * 一跑二十分鐘（2026-09-29 desk 實測）。判定與 reason 與逐檔版本一致。
 */
function committedDiskHashes(root: string, rels: string[]): Map<string, CommittedHash> {
  const result = committedDiskHashesAtHead(root, rels)
  // merge 進行中（MERGE_HEAD 存在）HEAD 不是 baseline：merge 帶進來的投影已 stage、與 HEAD
  // 不同。HEAD 判不過的路徑另以 MERGE_HEAD 再驗一次；無 MERGE_HEAD 時結果與原本逐項相同。
  const retry = rels.filter((rel) => {
    const value = result.get(rel)
    return (
      value?.hash === null &&
      (value.reason === 'index or worktree is dirty' ||
        value.reason === 'disk bytes differ from HEAD')
    )
  })
  if (retry.length === 0) return result
  for (const [rel, hash] of mergeHeadDiskHashes(root, retry)) result.set(rel, { hash })
  return result
}

/**
 * MERGE_HEAD 版：磁碟逐 byte ＝ `MERGE_HEAD:<path>`，且 index 也是那個 blob（衝突檔取 stage 3
 * 即 MERGE_HEAD 側）才回 hash。不是 merge 自己結果的 staged 改動（index blob ≠ MERGE_HEAD
 * blob）、skip-worktree／assume-unchanged、untracked 一律不回（fail-closed，由呼叫端維持原
 * reason）。非 merge 狀態（rev-parse MERGE_HEAD 失敗）回空 map。
 */
function mergeHeadDiskHashes(root: string, rels: string[]): Map<string, string> {
  const out = new Map<string, string>()
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  )
  const git = (args: string[], input?: Buffer) =>
    execFileSync('git', args, {
      cwd: root,
      env,
      input,
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  try {
    git(['rev-parse', '-q', '--verify', 'MERGE_HEAD^{commit}'])
    const prefix = git(['rev-parse', '--show-prefix']).toString('utf8').trim()
    for (let i = 0; i < rels.length; i += PATHSPEC_CHUNK) {
      const chunk = rels.slice(i, i + PATHSPEC_CHUNK)
      const specs = chunk.map((rel) => `:(literal)${rel}`)
      // ls-files 路徑相對 cwd（＝ root），與 rel 同基準
      const staged = new Map<string, Array<{ oid: string; stage: string }>>()
      for (const record of git(['ls-files', '-s', '-z', '--', ...specs])
        .toString('utf8')
        .split('\0')) {
        if (!record) continue
        const [meta = '', path = ''] = record.split('\t')
        const [, oid = '', stage = ''] = meta.split(' ')
        staged.set(path, [...(staged.get(path) ?? []), { oid, stage }])
      }
      const tags = new Map<string, string>()
      for (const record of git(['ls-files', '-v', '-z', '--', ...specs])
        .toString('utf8')
        .split('\0')) {
        if (record.length > 2 && !tags.has(record.slice(2)))
          tags.set(record.slice(2), record.slice(0, 2))
      }
      const batch = git(
        ['cat-file', '--batch'],
        Buffer.from(chunk.map((rel) => `MERGE_HEAD:${prefix}${rel}\n`).join('')),
      )
      let offset = 0
      for (const rel of chunk) {
        const newline = batch.indexOf(0x0a, offset)
        if (newline < 0) break
        const header = batch.subarray(offset, newline).toString('utf8').split(' ')
        if (header[1] !== 'blob') {
          offset = newline + 1
          continue
        }
        const size = Number(header[2])
        const committed = batch.subarray(newline + 1, newline + 1 + size)
        offset = newline + 1 + size + 1
        const entries = staged.get(rel) ?? []
        const unmerged = entries.some((entry) => entry.stage !== '0')
        const indexOid = unmerged
          ? entries.find((entry) => entry.stage === '3')?.oid
          : entries.length === 1
            ? entries[0].oid
            : undefined
        if (indexOid !== header[0] || tags.get(rel) !== (unmerged ? 'M ' : 'H ')) continue
        const disk = readFileSync(join(root, rel))
        if (disk.equals(committed)) out.set(rel, createHash('sha256').update(disk).digest('hex'))
      }
    }
  } catch {
    // 查證失敗不是證據：保留 HEAD 路徑的 reason
  }
  return out
}

function committedDiskHashesAtHead(root: string, rels: string[]): Map<string, CommittedHash> {
  const result = new Map<string, CommittedHash>()
  if (rels.length === 0) return result
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  )
  const git = (args: string[], input?: Buffer) =>
    execFileSync('git', args, {
      cwd: root,
      env,
      input,
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  const fail = (error: unknown): CommittedHash => ({
    hash: null,
    reason: `could not verify HEAD and disk: ${error instanceof Error ? error.message : String(error)}`,
  })
  const pending: string[] = []
  for (const rel of rels) {
    try {
      if (!lstatSync(join(root, rel)).isFile())
        result.set(rel, { hash: null, reason: 'disk path is not a regular file' })
      else pending.push(rel)
    } catch (error) {
      result.set(rel, fail(error))
    }
  }
  const dirty = new Set<string>()
  const tags = new Map<string, string>()
  // status 的路徑相對 repo 頂層、ls-files 相對 cwd；root 不是頂層時用 prefix 對齊
  let prefix: string
  try {
    prefix = git(['rev-parse', '--show-prefix']).toString('utf8').trim()
    for (let i = 0; i < pending.length; i += PATHSPEC_CHUNK) {
      const specs = pending.slice(i, i + PATHSPEC_CHUNK).map((rel) => `:(literal)${rel}`)
      const status = parseGitStatusZ(
        git(['status', '--porcelain=v1', '-z', '-uall', '--', ...specs]).toString('utf8'),
      )
      for (const { path, origPath } of status) {
        dirty.add(path.slice(prefix.length))
        // rename／copy 的來源端也算 dirty
        if (origPath !== undefined) dirty.add(origPath.slice(prefix.length))
      }
      for (const record of git(['ls-files', '-v', '-z', '--', ...specs])
        .toString('utf8')
        .split('\0')) {
        if (record.length > 2 && !tags.has(record.slice(2)))
          tags.set(record.slice(2), record.slice(0, 2))
      }
    }
  } catch (error) {
    for (const rel of pending) result.set(rel, fail(error))
    return result
  }
  const clean: string[] = []
  for (const rel of pending) {
    if (dirty.has(rel)) result.set(rel, { hash: null, reason: 'index or worktree is dirty' })
    else if (tags.get(rel) !== 'H ')
      result.set(rel, { hash: null, reason: 'path is not a normal tracked file' })
    else clean.push(rel)
  }
  if (clean.length === 0) return result
  let batch: Buffer
  try {
    batch = git(
      ['cat-file', '--batch'],
      Buffer.from(clean.map((rel) => `HEAD:${prefix}${rel}\n`).join('')),
    )
  } catch (error) {
    for (const rel of clean) result.set(rel, fail(error))
    return result
  }
  let offset = 0
  let truncated = false
  for (const rel of clean) {
    const newline = truncated ? -1 : batch.indexOf(0x0a, offset)
    // Truncated output makes every remaining path unverifiable: wrapping offset
    // to 0 would re-parse earlier headers and compare the wrong blob's bytes.
    if (newline < 0) {
      truncated = true
      result.set(rel, fail(new Error('cat-file --batch output is truncated')))
      continue
    }
    const header = batch.subarray(offset, newline).toString('utf8').split(' ')
    if (header[1] !== 'blob') {
      result.set(rel, fail(new Error(`HEAD:${rel} is ${header.at(-1) ?? 'unreadable'}`)))
      offset = newline + 1
      continue
    }
    const size = Number(header[2])
    const committed = batch.subarray(newline + 1, newline + 1 + size)
    offset = newline + 1 + size + 1
    try {
      const disk = readFileSync(join(root, rel))
      result.set(
        rel,
        disk.equals(committed)
          ? { hash: createHash('sha256').update(disk).digest('hex') }
          : { hash: null, reason: 'disk bytes differ from HEAD' },
      )
    } catch (error) {
      result.set(rel, fail(error))
    }
  }
  return result
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
  return reconcileProjectionState({
    targetRoot: mainRoot,
    sourceRoot: landedWorktree,
    targetLabel: 'main',
    sourceLabel: 'landed',
  })
}

function reconcileProjectionState({
  targetRoot,
  sourceRoot,
  targetLabel,
  sourceLabel,
}: {
  targetRoot: string
  sourceRoot: string
  targetLabel: 'main' | 'worktree'
  sourceLabel: 'landed' | 'main'
}) {
  const sourceDir = join(sourceRoot, '.clade', 'projections')
  const targetDir = join(targetRoot, '.clade', 'projections')
  if (!existsSync(sourceDir) || !existsSync(targetDir))
    return { updated: 0, skipped: [] as string[], blocked: 0 }
  if (!lstatSync(sourceDir).isDirectory() || !lstatSync(targetDir).isDirectory())
    throw new Error('projection state directory must be a real directory')
  let updated = 0
  let blocked = 0
  const skipped: string[] = []
  for (const name of readdirSync(sourceDir)
    .filter((entry) => LEDGER_NAME.test(entry))
    .toSorted()) {
    const namespace = name.split('.')[1]
    withProjectionLock(targetRoot, namespace, () => {
      const sourcePath = join(sourceDir, name)
      const targetPath = join(targetDir, name)
      if (!existsSync(targetPath)) {
        // No target ownership exists in this namespace, so there is nothing to repair.
        skipped.push(`${name}: ${targetLabel} receipt is missing`)
        return
      }
      if (!lstatSync(sourcePath).isFile() || !lstatSync(targetPath).isFile())
        throw new Error(`projection state must be a regular file: ${name}`)
      const sourceRaw = readFileSync(sourcePath, 'utf8')
      const source = readState(sourcePath, sourceRaw)
      const before = readFileSync(targetPath, 'utf8')
      const target = readState(targetPath, before)
      let changed = 0
      const needsRebase = (rel: string, oldHash: string) => {
        const landedHash = source.files[rel]
        return !!landedHash && landedHash !== oldHash
      }
      const hashes = committedDiskHashes(
        targetRoot,
        Object.entries(target.files)
          .filter(([rel, oldHash]) => needsRebase(rel, oldHash))
          .filter(([rel]) => !target.sourceInputs || source.sourceInputs?.[rel])
          .map(([rel]) => rel),
      )
      for (const [rel, oldHash] of Object.entries(target.files)) {
        const landedHash = source.files[rel]
        if (!needsRebase(rel, oldHash)) continue
        if (target.sourceInputs && !source.sourceInputs?.[rel]) {
          skipped.push(`${name}:${rel}: ${sourceLabel} receipt lacks required provenance`)
          blocked++
          continue
        }
        const committed = hashes.get(rel)!
        if (committed.hash !== landedHash) {
          skipped.push(
            `${name}:${rel}: ${committed.reason ?? `${sourceLabel} hash differs from HEAD bytes`}`,
          )
          blocked++
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
  return { updated, skipped, blocked }
}

/**
 * Rebase carries main's tracked projections into a worktree, leaving its ignored
 * receipt behind. The same receipt + clean HEAD proof applies in this direction;
 * never rehash arbitrary committed files as if they were generated projections.
 */
export function reconcileRebasedProjectionState(worktreeRoot: string, mainRoot: string) {
  return reconcileProjectionState({
    targetRoot: worktreeRoot,
    sourceRoot: mainRoot,
    targetLabel: 'worktree',
    sourceLabel: 'main',
  })
}
