#!/usr/bin/env node
/* eslint-disable no-console */
/* oxlint-disable no-console */

/**
 * /commit single-work lock.
 *
 * The canonical lock stays at .claude/.commit.lock so projected runtimes share
 * one boundary.  Every mutating operation first creates the persistent
 * .commit.lock.guard directory and records a before/after journal.  While the
 * guard exists, acquire refuses even if a mutation has temporarily moved the
 * canonical file.  A completed journal is atomically moved to history; an
 * interrupted journal keeps the guard in place until explicit, hash-checked
 * recovery.  Age and PID are observations only.
 *
 * Usage:
 *   node commit-lock.mjs acquire --work-id ID --runtime claude|codex|cursor|grok --session-id ID
 *   node commit-lock.mjs renew --work-id ID --runtime R --session-id ID --owner-token TOKEN
 *   node commit-lock.mjs release --work-id ID --runtime R --session-id ID --owner-token TOKEN
 *   node commit-lock.mjs recover --work-id ID --runtime R --session-id ID \
 *     --expected-lock-hash SHA256 --owner-ended --reason TEXT
 *   node commit-lock.mjs status
 *
 * Add --repo PATH to select an explicit checkout. Without it, process.cwd()
 * is authoritative; CLAUDE_PROJECT_DIR is never used as the root.
 */

import {
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import { hostname, userInfo } from 'node:os'

const RUNTIMES = new Set(['claude', 'codex', 'cursor', 'grok'])
const EMPTY_HASH = createHash('sha256').update(Buffer.alloc(0)).digest('hex')
const STALE_MINUTES = Number.parseInt(process.env.COMMIT_LOCK_STALE_MINUTES || '30', 10)
const USAGE = 'Usage: commit-lock.mjs {acquire|renew|release|status|recover} [options]'

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseArgs(argv) {
  const options = { json: false, repo: process.cwd() }
  const valueOptions = new Set([
    '--repo',
    '--work-id',
    '--runtime',
    '--session-id',
    '--owner-token',
    '--expected-lock-hash',
    '--reason',
  ])
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--owner-ended') {
      options.ownerEnded = true
      continue
    }
    if (!valueOptions.has(arg)) throw new Error(`Unknown option: ${arg}`)
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
    options[arg.slice(2).replaceAll('-', '')] = value
    i += 1
  }
  options.repo = resolve(options.repo)
  return options
}

function emit(options, value) {
  if (options.json) process.stdout.write(`${JSON.stringify(value)}\n`)
  else if (typeof value === 'string') process.stdout.write(`${value}\n`)
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function fail(options, message, details = undefined, code = 1) {
  const value = { ok: false, error: message }
  if (details !== undefined) value.details = details
  if (options.json) process.stderr.write(`${JSON.stringify(value)}\n`)
  else process.stderr.write(`[/commit lock] ⛔ ${message}\n`)
  process.exitCode = code
  throw new Error('__commit_lock_exit__')
}

function pathsFor(repo) {
  const lockFile = resolve(repo, '.claude', '.commit.lock')
  return {
    lockFile,
    lockDir: dirname(lockFile),
    guardDir: `${lockFile}.guard`,
    journalFile: resolve(`${lockFile}.guard`, 'journal.json'),
    recoveryClaim: resolve(`${lockFile}.guard`, 'recovery.claim'),
    historyDir: `${lockFile}.history`,
    recoveryDir: resolve(repo, '.claude', '.commit-recovery'),
  }
}

function randomId(bytes = 24) {
  return randomBytes(bytes).toString('hex')
}

function readRaw(path) {
  try {
    return readFileSync(path)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function parseRaw(raw) {
  if (!raw) return null
  try {
    const lock = JSON.parse(raw.toString('utf8'))
    return lock && typeof lock === 'object' && !Array.isArray(lock) ? lock : { _corrupt: true }
  } catch {
    return { _corrupt: true }
  }
}

function readLock(lockFile) {
  const raw = readRaw(lockFile)
  return { raw, lock: parseRaw(raw) }
}

function sha256(raw) {
  return createHash('sha256')
    .update(raw || Buffer.alloc(0))
    .digest('hex')
}

function sameBytes(a, b) {
  if (a === null || b === null) return a === b
  return Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.equals(b)
}

function encodeBytes(raw) {
  return raw === null ? null : raw.toString('base64')
}

function decodeBytes(encoded) {
  if (encoded === null) return null
  if (
    typeof encoded !== 'string' ||
    encoded.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  )
    throw new Error('invalid base64 snapshot encoding')
  const raw = Buffer.from(encoded, 'base64')
  if (raw.toString('base64') !== encoded) throw new Error('noncanonical base64 snapshot encoding')
  return raw
}

function validJournalSnapshot(encoded, expectedHash) {
  if (
    encoded === undefined ||
    typeof expectedHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(expectedHash)
  )
    return false
  try {
    const raw = decodeBytes(encoded)
    return raw === null ? expectedHash === EMPTY_HASH : sha256(raw) === expectedHash
  } catch {
    return false
  }
}

function runtimeTelemetry() {
  const paneId = nonEmpty(process.env.HERDR_PANE_ID)
  const tabId = nonEmpty(process.env.HERDR_TAB_ID)
  const socketPath = nonEmpty(process.env.HERDR_SOCKET_PATH)
  if (!paneId && !tabId && !socketPath) return null
  return { paneId, tabId, socketPath }
}

function isValidIdentity(options, { ownerToken = false } = {}) {
  const workId = nonEmpty(options.workid)
  const runtime = nonEmpty(options.runtime)?.toLowerCase()
  const sessionId = nonEmpty(options.sessionid)
  if (!workId || !runtime || !sessionId || !RUNTIMES.has(runtime)) return false
  if (ownerToken && !nonEmpty(options.ownertoken)) return false
  options.workid = workId
  options.runtime = runtime
  options.sessionid = sessionId
  if (ownerToken) options.ownertoken = nonEmpty(options.ownertoken)
  return true
}

function assertIdentity(options, ownerToken = false) {
  if (!isValidIdentity(options, { ownerToken })) {
    const required = ownerToken
      ? '--work-id, --runtime (claude|codex|cursor|grok), --session-id, and --owner-token'
      : '--work-id, --runtime (claude|codex|cursor|grok), and --session-id'
    fail(options, `explicit identity required: ${required}`, undefined, 2)
  }
}

function ownerMatches(lock, options, { token = true } = {}) {
  if (!lock || lock._corrupt) return false
  if (
    lock.version !== 2 ||
    typeof lock.ownerToken !== 'string' ||
    !/^[0-9a-f]{64}$/.test(lock.ownerToken)
  )
    return false
  if (lock.lockId !== lock.ownerToken) return false
  return (
    lock.workId === options.workid &&
    lock.runtime === options.runtime &&
    lock.sessionId === options.sessionid &&
    (!token || lock.ownerToken === options.ownertoken)
  )
}

function staleObservation(lock) {
  if (!lock || lock._corrupt) return { stale: false, reason: 'missing-or-corrupt-heartbeat' }
  const heartbeat = Number(lock.lastHeartbeatAt || lock.renewedAt || lock.acquiredAt)
  if (!Number.isFinite(heartbeat)) return { stale: false, reason: 'missing-heartbeat' }
  const ageMs = Math.max(0, Date.now() - heartbeat)
  return {
    stale: ageMs > Math.max(1, STALE_MINUTES) * 60 * 1000,
    ageSeconds: Math.floor(ageMs / 1000),
    heartbeatAt: new Date(heartbeat).toISOString(),
    thresholdMinutes: STALE_MINUTES,
    reason: 'age-only-observation; never takeover authorization',
  }
}

function publicLock(lock) {
  if (!lock) return null
  if (lock._corrupt) return { corrupt: true }
  const result = { ...lock }
  if (typeof result.ownerToken === 'string') result.ownerToken = `${result.ownerToken.slice(0, 8)}…`
  else if (result.ownerToken !== undefined) result.ownerToken = '(malformed)'
  if (typeof result.lockId === 'string') result.lockId = `${result.lockId.slice(0, 8)}…`
  else if (result.lockId !== undefined) result.lockId = '(malformed)'
  return result
}

function displayOwnerToken(value) {
  return typeof value === 'string' && value ? `${value.slice(0, 8)}…` : '(legacy: no owner token)'
}

function formatLock(lock) {
  if (!lock) return '(no lock)'
  if (lock._corrupt) return '(lock file corrupt or malformed)'
  const obs = staleObservation(lock)
  return [
    `  work:      ${lock.workId || '(legacy: no work id)'}`,
    `  runtime:   ${lock.runtime || '(legacy: no runtime)'}`,
    `  session:   ${lock.sessionId || '(legacy: no session id)'}`,
    `  owner:     ${displayOwnerToken(lock.ownerToken)}`,
    `  acquired:  ${lock.acquiredAtIso || '(unknown)'}`,
    `  heartbeat: ${lock.lastHeartbeatAtIso || '(unknown)'} (age ${obs.ageSeconds ?? '?'}s; observation only)`,
    `  pid:       ${lock.pid ?? '(unknown)'} (telemetry only)`,
    `  hostname:  ${lock.hostname || '(unknown)'}`,
    `  user:      ${lock.user || '(unknown)'}`,
    `  cwd:       ${lock.cwd || '(unknown)'}`,
  ].join('\n')
}

function ownerReceipt(options) {
  return {
    workId: options.workid || null,
    runtime: options.runtime || null,
    sessionId: options.sessionid || null,
  }
}

function recoveryOwnerMatches(options, lock) {
  return Boolean(
    lock &&
    !lock._corrupt &&
    lock.workId === options.workid &&
    lock.runtime === options.runtime &&
    lock.sessionId === options.sessionid,
  )
}

function assertRecoveryOwnerDistinct(options, lock) {
  if (recoveryOwnerMatches(options, lock))
    fail(options, 'recover refused: recovery identity must differ from original lock owner', {
      originalOwner: { workId: lock.workId, runtime: lock.runtime, sessionId: lock.sessionId },
    })
}

function successReceipt(options, action, result, extra = {}) {
  return {
    ok: true,
    action,
    result,
    at: new Date().toISOString(),
    owner: ownerReceipt(options),
    repo: options.repo,
    ...extra,
  }
}

function snapshotHashes(beforeRaw, afterRaw) {
  return {
    beforeHash: sha256(beforeRaw),
    afterHash: sha256(afterRaw),
  }
}

function readGuard(paths) {
  let guardIsDirectory = false
  try {
    guardIsDirectory = statSync(paths.guardDir).isDirectory()
  } catch (error) {
    if (error.code === 'ENOENT') return { present: false, raw: null, journal: null }
    return { present: true, raw: null, journal: { _corrupt: true } }
  }
  if (!guardIsDirectory) return { present: true, raw: null, journal: { _corrupt: true } }
  const raw = readRaw(paths.journalFile)
  return { present: true, raw, journal: parseRaw(raw) }
}

function guardDetails(guard) {
  if (!guard?.present) return null
  if (!guard.journal || guard.journal._corrupt)
    return { corrupt: true, journalHash: sha256(guard.raw) }
  return {
    guardId: guard.journal.guardId || null,
    action: guard.journal.action || null,
    createdAt: guard.journal.createdAt || null,
    owner: {
      ...guard.journal.owner,
      ownerToken: displayOwnerToken(guard.journal.owner?.ownerToken),
    },
    beforeHash: guard.journal.beforeHash || null,
    afterHash: guard.journal.afterHash || null,
    journalHash: sha256(guard.raw),
  }
}

function publicJournal(journal) {
  if (!journal || journal._corrupt) return null
  return {
    guardId: journal.guardId || null,
    action: journal.action || null,
    createdAt: journal.createdAt || null,
    owner: journal.owner
      ? {
          workId: journal.owner.workId || null,
          runtime: journal.owner.runtime || null,
          sessionId: journal.owner.sessionId || null,
          ownerToken: displayOwnerToken(journal.owner.ownerToken),
        }
      : null,
    beforeHash: journal.beforeHash || null,
    afterHash: journal.afterHash || null,
    terminal: journal.terminal || null,
  }
}

function recoveryClaimDetails(paths) {
  const raw = readRaw(paths.recoveryClaim)
  if (raw === null) return null
  const claim = parseRaw(raw)
  if (!claim || claim._corrupt) return { corrupt: true, claimHash: sha256(raw) }
  return {
    recoveryId: claim.recoveryId || null,
    recoveryOwner: claim.recoveryOwner || null,
    expectedLockHash: claim.expectedLockHash || null,
    reason: claim.reason || null,
    claimHash: sha256(raw),
  }
}

function requireNoGuard(options, paths) {
  const guard = readGuard(paths)
  if (guard.present) {
    fail(
      options,
      'mutation refused: persistent operation guard is present; use explicit hash-checked recover',
      {
        guard: guardDetails(guard),
      },
    )
  }
}

function createGuard(options, action, beforeRaw, afterRaw, ownerToken = null) {
  const paths = pathsFor(options.repo)
  mkdirSync(paths.lockDir, { recursive: true })
  const guardId = randomId(24)
  try {
    mkdirSync(paths.guardDir)
  } catch (error) {
    if (error.code === 'EEXIST') {
      const guard = readGuard(paths)
      fail(options, 'mutation refused: another operation guard is present', {
        guard: guardDetails(guard),
      })
    }
    throw error
  }
  const now = new Date().toISOString()
  const journal = {
    version: 1,
    guardId,
    action,
    createdAt: now,
    owner: { ...ownerReceipt(options), ownerToken },
    beforeHash: sha256(beforeRaw),
    beforeBytesBase64: encodeBytes(beforeRaw),
    afterHash: sha256(afterRaw),
    afterBytesBase64: encodeBytes(afterRaw),
  }
  try {
    writeFileSync(paths.journalFile, `${JSON.stringify(journal, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    })
  } catch (error) {
    fail(options, `operation guard journal could not be written: ${error.message}`)
  }
  return { paths, journal }
}

function guardIdentity(journal) {
  return JSON.stringify({
    guardId: journal.guardId || null,
    action: journal.action || null,
    owner: journal.owner || null,
    beforeHash: journal.beforeHash || null,
    afterHash: journal.afterHash || null,
  })
}

function verifyGuardIdentity(paths, journal) {
  // A malformed guard has no identity to compare; its recovery path is already
  // fail-closed on the caller-supplied exact current hash.
  if (!journal.action || !journal.guardId) return
  const observed = parseRaw(readRaw(paths.journalFile))
  if (!observed || observed._corrupt || guardIdentity(observed) !== guardIdentity(journal))
    throw new Error('operation guard identity changed before finish')
}

function finishGuard(paths, journal, state = 'complete', metadata = {}) {
  verifyGuardIdentity(paths, journal)
  pauseBeforeFinishForTest()
  journal.terminal = {
    state,
    at: new Date().toISOString(),
    ...metadata,
  }
  writeFileSync(paths.journalFile, `${JSON.stringify(journal, null, 2)}\n`, {
    mode: 0o600,
    flag: 'w',
  })
  const historyDir = paths.historyDir
  mkdirSync(historyDir, { recursive: true })
  const done = resolve(
    historyDir,
    `${new Date().toISOString().replaceAll(':', '-')}-${journal.guardId}-${state}`,
  )
  // Keeping the guard is the safe result if this rename is interrupted: it
  // blocks all future mutations and leaves the journal for explicit recovery.
  renameSync(paths.guardDir, done)
  pauseAfterFinishForTest()
  return done
}

function verifyBefore(options, paths, beforeRaw, journal) {
  const current = readRaw(paths.lockFile)
  if (!sameBytes(current, beforeRaw)) {
    try {
      finishGuard(paths, journal, 'aborted-snapshot-drift')
    } catch {
      /* preserve guard */
    }
    fail(options, 'mutation refused: lock snapshot changed before guard became active', {
      expectedLockHash: journal.beforeHash,
      observedLockHash: sha256(current),
    })
  }
}

function pauseAfterClaimForTest() {
  const pauseMs = Number.parseInt(process.env.COMMIT_LOCK_TEST_PAUSE_AFTER_CLAIM_MS || '0', 10)
  if (pauseMs > 0) {
    const bounded = Math.min(pauseMs, 5000)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, bounded)
  }
}

function pauseBeforeFinishForTest() {
  const pauseMs = Number.parseInt(process.env.COMMIT_LOCK_TEST_PAUSE_BEFORE_FINISH_MS || '0', 10)
  if (pauseMs > 0) {
    const bounded = Math.min(pauseMs, 5000)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, bounded)
  }
}

function pauseAfterFinishForTest() {
  const pauseMs = Number.parseInt(process.env.COMMIT_LOCK_TEST_PAUSE_AFTER_FINISH_MS || '0', 10)
  if (pauseMs > 0) {
    const bounded = Math.min(pauseMs, 5000)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, bounded)
  }
}

function pauseBeforeRecoveryTargetForTest(paths) {
  const pauseMs = Number.parseInt(
    process.env.COMMIT_LOCK_TEST_PAUSE_BEFORE_RECOVERY_TARGET_MS || '0',
    10,
  )
  if (pauseMs <= 0) return
  const marker = resolve(paths.guardDir, 'recovery-target.pause')
  writeFileSync(marker, `${process.pid}\n`, { mode: 0o600, flag: 'w' })
  try {
    const bounded = Math.min(pauseMs, 5000)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, bounded)
  } finally {
    cleanup(marker)
  }
}

function pauseBeforeRecoveryClaimRestoreForTest(paths) {
  const pauseMs = Number.parseInt(
    process.env.COMMIT_LOCK_TEST_PAUSE_BEFORE_RECOVERY_CLAIM_RESTORE_MS || '0',
    10,
  )
  if (pauseMs <= 0) return
  const marker = resolve(paths.guardDir, 'recovery-claim-restore.pause')
  writeFileSync(marker, `${process.pid}\n`, { mode: 0o600, flag: 'w' })
  try {
    const bounded = Math.min(pauseMs, 5000)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, bounded)
  } finally {
    cleanup(marker)
  }
}

function cleanup(path) {
  try {
    unlinkSync(path)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function createPayload(options) {
  const now = Date.now()
  const ownerToken = randomId(32)
  return {
    version: 2,
    lockId: ownerToken,
    workId: options.workid,
    runtime: options.runtime,
    sessionId: options.sessionid,
    ownerToken,
    acquiredAt: now,
    acquiredAtIso: new Date(now).toISOString(),
    lastHeartbeatAt: now,
    lastHeartbeatAtIso: new Date(now).toISOString(),
    herdr: runtimeTelemetry(),
    pid: process.pid,
    ppid: process.ppid,
    hostname: hostname(),
    user: userInfo().username,
    cwd: process.cwd(),
  }
}

function acquire(options) {
  assertIdentity(options)
  const paths = pathsFor(options.repo)
  requireNoGuard(options, paths)
  const existing = readLock(paths.lockFile)
  if (existing.raw) {
    const sameTuple = ownerMatches(existing.lock, options, { token: false })
    if (sameTuple && nonEmpty(options.ownertoken) === existing.lock.ownerToken) {
      const receipt = successReceipt(options, 'acquire', 'reentrant', {
        lockFile: paths.lockFile,
        ownerToken: existing.lock.ownerToken,
        lock: existing.lock,
        ...snapshotHashes(existing.raw, existing.raw),
      })
      if (options.json) emit(options, receipt)
      else {
        console.log('[/commit lock] ✓ reentrant (existing lock preserved)')
        console.log(formatLock(existing.lock))
        console.log(`  owner-token: ${existing.lock.ownerToken}`)
      }
      return
    }
    const message = sameTuple
      ? 'lock already belongs to this work/session; reentry requires the matching --owner-token'
      : 'another, legacy, corrupt, or unknown lock is present; acquire refuses takeover'
    fail(options, message, {
      lock: publicLock(existing.lock),
      staleObservation: staleObservation(existing.lock),
    })
  }
  const payload = createPayload(options)
  const afterRaw = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`)
  const guard = createGuard(options, 'acquire', null, afterRaw, payload.ownerToken)
  try {
    verifyBefore(options, paths, null, guard.journal)
    try {
      writeFileSync(paths.lockFile, afterRaw, { mode: 0o644, flag: 'wx' })
    } catch (error) {
      fail(options, `lock acquisition failed while guarded: ${error.message}`)
    }
    if (!sameBytes(readRaw(paths.lockFile), afterRaw))
      fail(options, 'acquire refused: canonical lock bytes drifted under guard')
    finishGuard(paths, guard.journal)
  } catch (error) {
    if (error.message === '__commit_lock_exit__') throw error
    throw error
  }
  const receipt = successReceipt(options, 'acquire', 'acquired', {
    lockFile: paths.lockFile,
    ownerToken: payload.ownerToken,
    lock: payload,
    ...snapshotHashes(null, afterRaw),
  })
  if (options.json) emit(options, receipt)
  else {
    console.log('[/commit lock] ✓ acquired')
    console.log(`  repo:      ${options.repo}`)
    console.log(formatLock(payload))
    console.log(`  owner-token: ${payload.ownerToken}`)
  }
}

function installReplacement(options, paths, beforeRaw, afterRaw, journal) {
  const claim = `${paths.lockFile}.${journal.action}.${process.pid}.${randomId(12)}.claim`
  let updatedPath = null
  try {
    renameSync(paths.lockFile, claim)
    pauseAfterClaimForTest()
    if (!sameBytes(readRaw(claim), beforeRaw))
      fail(options, 'mutation refused: claimed lock snapshot drifted')
    updatedPath = `${claim}.updated`
    writeFileSync(updatedPath, afterRaw, { mode: 0o644, flag: 'wx' })
    try {
      linkSync(updatedPath, paths.lockFile)
    } catch (error) {
      if (error.code === 'EEXIST')
        fail(options, 'mutation refused: replacement lock appeared; original claim preserved')
      throw error
    }
    cleanup(updatedPath)
    cleanup(claim)
  } catch (error) {
    if (error.message === '__commit_lock_exit__') throw error
    throw error
  } finally {
    if (updatedPath) {
      try {
        cleanup(updatedPath)
      } catch {
        /* guard remains for recovery */
      }
    }
  }
}

function renew(options) {
  assertIdentity(options, true)
  const paths = pathsFor(options.repo)
  requireNoGuard(options, paths)
  const { raw: beforeRaw, lock } = readLock(paths.lockFile)
  if (!beforeRaw) fail(options, 'renew refused: lock is absent')
  if (!ownerMatches(lock, options))
    fail(options, 'renew refused: lock owner tuple/token mismatch, legacy, or corrupt', {
      lock: publicLock(lock),
    })
  const now = Date.now()
  const updated = {
    ...lock,
    lastHeartbeatAt: now,
    lastHeartbeatAtIso: new Date(now).toISOString(),
    renewedAt: now,
    renewedAtIso: new Date(now).toISOString(),
    pid: process.pid,
    ppid: process.ppid,
    cwd: process.cwd(),
  }
  const afterRaw = Buffer.from(`${JSON.stringify(updated, null, 2)}\n`)
  const guard = createGuard(options, 'renew', beforeRaw, afterRaw, options.ownertoken)
  verifyBefore(options, paths, beforeRaw, guard.journal)
  installReplacement(options, paths, beforeRaw, afterRaw, guard.journal)
  if (!sameBytes(readRaw(paths.lockFile), afterRaw))
    fail(options, 'renew refused: canonical lock bytes drifted under guard')
  finishGuard(paths, guard.journal)
  emit(
    options,
    successReceipt(options, 'renew', 'renewed', {
      lockFile: paths.lockFile,
      heartbeatAt: updated.lastHeartbeatAtIso,
      ...snapshotHashes(beforeRaw, afterRaw),
    }),
  )
}

function removeClaimedLock(options, paths, beforeRaw, journal) {
  const claim = `${paths.lockFile}.${journal.action}.${process.pid}.${randomId(12)}.claim`
  renameSync(paths.lockFile, claim)
  pauseAfterClaimForTest()
  if (!sameBytes(readRaw(claim), beforeRaw))
    fail(options, 'mutation refused: claimed lock snapshot drifted')
  cleanup(claim)
}

function release(options) {
  assertIdentity(options, true)
  const paths = pathsFor(options.repo)
  requireNoGuard(options, paths)
  const { raw: beforeRaw, lock } = readLock(paths.lockFile)
  if (!beforeRaw) {
    emit(
      options,
      successReceipt(options, 'release', 'absent', {
        lockFile: paths.lockFile,
        ...snapshotHashes(null, null),
      }),
    )
    return
  }
  if (!ownerMatches(lock, options))
    fail(options, 'release refused: lock owner tuple/token mismatch, legacy, or corrupt', {
      lock: publicLock(lock),
    })
  const guard = createGuard(options, 'release', beforeRaw, null, options.ownertoken)
  verifyBefore(options, paths, beforeRaw, guard.journal)
  removeClaimedLock(options, paths, beforeRaw, guard.journal)
  if (readRaw(paths.lockFile) !== null)
    fail(options, 'release refused: replacement lock appeared; guard remains')
  finishGuard(paths, guard.journal)
  emit(
    options,
    successReceipt(options, 'release', 'released', {
      lockFile: paths.lockFile,
      ...snapshotHashes(beforeRaw, null),
    }),
  )
}

function writeRecoveryReceipt(
  paths,
  options,
  expected,
  reason,
  originalRaw,
  original,
  guardRaw = null,
  currentRaw = originalRaw,
  recoveryId = null,
  result = 'in-progress',
) {
  mkdirSync(paths.recoveryDir, { recursive: true })
  const receiptPath = resolve(
    paths.recoveryDir,
    `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}-${randomId(8)}.json`,
  )
  const receipt = {
    version: 1,
    action: 'recover',
    result,
    beforeHash: expected,
    afterHash: EMPTY_HASH,
    recoveredAt: new Date().toISOString(),
    repo: options.repo,
    lockFile: paths.lockFile,
    expectedLockHash: expected,
    observedLockHash: sha256(currentRaw),
    callerAssertion: { ...ownerReceipt(options), ownerEnded: true, reason },
    recoveryOwner: recoveryId ? { recoveryId, ...ownerReceipt(options) } : null,
    originalOwnerSnapshot: {
      lock: publicLock(original),
    },
    guardSnapshot: guardRaw
      ? {
          guardHash: sha256(guardRaw),
          guard: publicJournal(parseRaw(guardRaw)),
        }
      : null,
  }
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  return receiptPath
}

function finalizeRecoveryReceipt(receiptPath) {
  const receipt = parseRaw(readRaw(receiptPath))
  if (!receipt || receipt._corrupt) throw new Error('recovery receipt is missing or corrupt')
  receipt.result = 'recovered'
  receipt.recoveredAt = new Date().toISOString()
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
    flag: 'w',
  })
}

function validJournal(journal) {
  return Boolean(
    journal &&
    !journal._corrupt &&
    journal.version === 1 &&
    typeof journal.guardId === 'string' &&
    journal.guardId.length > 0 &&
    ['acquire', 'renew', 'release', 'recover'].includes(journal.action) &&
    journal.owner &&
    typeof journal.owner === 'object' &&
    typeof journal.owner.workId === 'string' &&
    journal.owner.workId.length > 0 &&
    RUNTIMES.has(journal.owner.runtime) &&
    typeof journal.owner.sessionId === 'string' &&
    journal.owner.sessionId.length > 0 &&
    (journal.owner.ownerToken === null ||
      (typeof journal.owner.ownerToken === 'string' &&
        /^[0-9a-f]{64}$/.test(journal.owner.ownerToken))) &&
    typeof journal.beforeHash === 'string' &&
    typeof journal.afterHash === 'string' &&
    Object.hasOwn(journal, 'beforeBytesBase64') &&
    Object.hasOwn(journal, 'afterBytesBase64') &&
    validJournalSnapshot(journal.beforeBytesBase64, journal.beforeHash) &&
    validJournalSnapshot(journal.afterBytesBase64, journal.afterHash),
  )
}

function acquireRecoveryClaim(paths, options, expected) {
  const recoveryId = randomId(24)
  const initial = {
    at: new Date().toISOString(),
    recoveryId,
    recoveryOwner: ownerReceipt(options),
    expectedLockHash: expected,
    reason: options.reason,
  }
  try {
    writeFileSync(paths.recoveryClaim, `${JSON.stringify(initial)}\n`, { mode: 0o600, flag: 'wx' })
    pauseAfterClaimForTest()
    return { marker: paths.recoveryClaim, recoveryId }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const claim = parseRaw(readRaw(paths.recoveryClaim))
    fail(options, 'recover refused: another recovery claim is active', {
      recoveryId: claim?.recoveryId || null,
      expectedLockHash: claim?.expectedLockHash || null,
      recoveryOwner: claim?.recoveryOwner || null,
    })
  }
}

function releaseRecoveryClaim(claim) {
  const raw = readRaw(claim.marker)
  if (raw === null) return
  const observed = parseRaw(raw)
  if (!observed || observed._corrupt || observed.recoveryId !== claim.recoveryId)
    throw new Error('recovery claim changed before release')
  cleanup(claim.marker)
}

function findOperationClaim(paths, journal, beforeRaw) {
  let names
  try {
    names = readdirSync(paths.lockDir)
  } catch {
    return null
  }
  const prefix = `${basename(paths.lockFile)}.${journal.action}.`
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.claim')) continue
    const claim = resolve(paths.lockDir, name)
    if (sameBytes(readRaw(claim), beforeRaw)) return claim
  }
  return null
}

function removeRecoveryTarget(options, paths, currentRaw, journal, beforeRaw) {
  if (currentRaw === null) {
    const claims = [beforeRaw, decodeBytes(journal.afterBytesBase64)]
    for (const snapshot of claims) {
      if (snapshot === null) continue
      const claim = findOperationClaim(paths, journal, snapshot)
      if (claim) {
        if (!sameBytes(readRaw(claim), snapshot))
          fail(options, 'recover refused: operation claim changed before removal')
        cleanup(claim)
      }
    }
    return readRaw(paths.lockFile) === null
  }
  const claim = `${paths.lockFile}.recover.${process.pid}.${randomId(12)}.claim`
  try {
    renameSync(paths.lockFile, claim)
    const claimedRaw = readRaw(claim)
    if (!sameBytes(claimedRaw, currentRaw)) {
      const details = {
        claimPath: claim,
        expectedLockHash: sha256(currentRaw),
        observedClaimHash: sha256(claimedRaw),
      }
      if (readRaw(paths.lockFile) === null) {
        pauseBeforeRecoveryClaimRestoreForTest(paths)
        try {
          linkSync(claim, paths.lockFile)
          cleanup(claim)
          fail(options, 'recover refused: canonical snapshot changed; unexpected bytes restored', {
            lockFile: paths.lockFile,
            ...details,
          })
        } catch (error) {
          if (error.message === '__commit_lock_exit__') throw error
          if (error.code !== 'EEXIST') throw error
        }
      }
      fail(options, 'recover refused: private recovery claim changed; claim preserved', details)
    }
    const replacementRaw = readRaw(paths.lockFile)
    if (replacementRaw !== null) {
      fail(options, 'recover refused: replacement appeared; private recovery claim preserved', {
        claimPath: claim,
        observedLockHash: sha256(replacementRaw),
      })
    }
    cleanup(claim)
    return true
  } catch (error) {
    if (error.message === '__commit_lock_exit__') throw error
    throw error
  }
}

function findTerminalRecovery(paths, expected) {
  let names
  try {
    names = readdirSync(paths.historyDir)
  } catch {
    return null
  }
  for (const name of names) {
    const historyPath = resolve(paths.historyDir, name)
    const raw = readRaw(resolve(historyPath, 'journal.json'))
    const journal = parseRaw(raw)
    const terminalExpectedLockHash =
      journal?.terminal?.expectedLockHash ||
      (journal?.action === 'recover' ? journal?.beforeHash : null)
    if (
      journal &&
      validJournal(journal) &&
      terminalExpectedLockHash === expected &&
      journal.terminal?.state === 'recovered' &&
      nonEmpty(journal.terminal.receiptPath)
    ) {
      return { historyPath, journal }
    }
  }
  return null
}

function cleanupMatchingRecoveryClaim(paths, recoveryId, expected) {
  if (!recoveryId) return
  const claim = parseRaw(readRaw(paths.recoveryClaim))
  if (claim?.recoveryId === recoveryId && claim.expectedLockHash === expected)
    cleanup(paths.recoveryClaim)
}

function emitTerminalRecovery(options, paths, expected, terminal, historyPath) {
  finalizeRecoveryReceipt(terminal.receiptPath)
  cleanupMatchingRecoveryClaim(paths, terminal.recoveryId, expected)
  emit(
    options,
    successReceipt(options, 'recover', 'recovered', {
      idempotent: true,
      lockFile: paths.lockFile,
      receiptPath: terminal.receiptPath,
      historyPath,
      beforeHash: expected,
      afterHash: EMPTY_HASH,
    }),
  )
}

function assertRecoveryTerminalTarget(options, paths) {
  const currentRaw = readRaw(paths.lockFile)
  if (currentRaw !== null)
    fail(options, 'recover refused: replacement owner appeared after terminal recovery', {
      observedLockHash: sha256(currentRaw),
    })
}

function recoverExistingGuard(options, paths, expected, reason) {
  const guard = readGuard(paths)
  let claim = null
  try {
    let currentRaw = readRaw(paths.lockFile)
    const journal = guard.journal
    if (!guard.raw || !validJournal(journal))
      fail(options, 'recover refused: operation guard journal is missing, corrupt, or invalid')
    const beforeRaw = decodeBytes(journal.beforeBytesBase64)
    const afterRaw = decodeBytes(journal.afterBytesBase64)
    const originalRaw = beforeRaw !== null ? beforeRaw : afterRaw
    assertRecoveryOwnerDistinct(options, parseRaw(originalRaw))
    if (sha256(currentRaw) !== expected)
      fail(options, 'recover refused: expected hash does not match observed canonical bytes', {
        expectedLockHash: expected,
        observedLockHash: sha256(currentRaw),
      })
    const terminalExpectedLockHash =
      journal.terminal?.expectedLockHash ||
      (journal.action === 'recover' ? journal.beforeHash : null)
    if (journal.terminal?.state === 'recovered' && terminalExpectedLockHash === expected) {
      assertRecoveryTerminalTarget(options, paths)
      const history = finishGuard(paths, journal, 'recovered', journal.terminal)
      emitTerminalRecovery(options, paths, expected, journal.terminal, history)
      return
    }
    claim = acquireRecoveryClaim(paths, options, expected)
    currentRaw = readRaw(paths.lockFile)
    const currentHash = sha256(currentRaw)
    if (currentHash !== expected)
      fail(options, 'recover refused: canonical bytes changed after recovery claim', {
        expectedLockHash: expected,
        observedLockHash: currentHash,
      })
    if (
      currentHash !== journal.beforeHash &&
      currentHash !== journal.afterHash &&
      currentRaw !== null
    )
      fail(options, 'recover refused: canonical bytes drifted outside guarded plan', {
        expectedBeforeHash: journal.beforeHash,
        expectedAfterHash: journal.afterHash,
        observedLockHash: currentHash,
      })
    const receiptPath = writeRecoveryReceipt(
      paths,
      options,
      expected,
      reason,
      beforeRaw,
      parseRaw(originalRaw),
      guard.raw,
      currentRaw,
      claim.recoveryId,
    )
    pauseBeforeRecoveryTargetForTest(paths)
    if (!removeRecoveryTarget(options, paths, currentRaw, journal, beforeRaw))
      fail(options, 'recover refused: could not remove guarded snapshot')
    const history = finishGuard(paths, journal, 'recovered', {
      receiptPath,
      recoveryId: claim.recoveryId,
      expectedLockHash: expected,
    })
    finalizeRecoveryReceipt(receiptPath)
    releaseRecoveryClaim(claim)
    emit(
      options,
      successReceipt(options, 'recover', 'recovered', {
        lockFile: paths.lockFile,
        receiptPath,
        historyPath: history,
        originalOwner: publicLock(parseRaw(beforeRaw)),
        beforeHash: expected,
        afterHash: EMPTY_HASH,
      }),
    )
  } catch (error) {
    if (error.message === '__commit_lock_exit__') throw error
    throw error
  }
}

function recover(options) {
  assertIdentity(options)
  const expected = nonEmpty(options.expectedlockhash)?.toLowerCase()
  const reason = nonEmpty(options.reason)
  if (!expected || !/^[0-9a-f]{64}$/.test(expected) || !options.ownerEnded || !reason) {
    fail(
      options,
      'recover requires --expected-lock-hash SHA256, --owner-ended, and nonempty --reason',
      undefined,
      2,
    )
  }
  const paths = pathsFor(options.repo)
  const existingGuard = readGuard(paths)
  if (existingGuard.present) {
    recoverExistingGuard(options, paths, expected, reason)
    return
  }
  const terminal = findTerminalRecovery(paths, expected)
  if (terminal) {
    assertRecoveryTerminalTarget(options, paths)
    emitTerminalRecovery(options, paths, expected, terminal.journal.terminal, terminal.historyPath)
    return
  }
  const { raw: beforeRaw, lock } = readLock(paths.lockFile)
  if (!beforeRaw) fail(options, 'recover refused: lock is absent')
  if (sha256(beforeRaw) !== expected)
    fail(options, 'recover refused: expected lock hash does not match observed bytes', {
      expectedLockHash: expected,
      observedLockHash: sha256(beforeRaw),
    })
  assertRecoveryOwnerDistinct(options, lock)
  const guard = createGuard(options, 'recover', beforeRaw, null, null)
  verifyBefore(options, paths, beforeRaw, guard.journal)
  const claim = acquireRecoveryClaim(paths, options, expected)
  try {
    const receiptPath = writeRecoveryReceipt(
      paths,
      options,
      expected,
      reason,
      beforeRaw,
      lock,
      null,
      beforeRaw,
      claim.recoveryId,
    )
    removeClaimedLock(options, paths, beforeRaw, guard.journal)
    if (readRaw(paths.lockFile) !== null)
      fail(options, 'recover refused: replacement owner appeared; guard remains')
    const history = finishGuard(paths, guard.journal, 'recovered', {
      receiptPath,
      recoveryId: claim.recoveryId,
      expectedLockHash: expected,
    })
    finalizeRecoveryReceipt(receiptPath)
    releaseRecoveryClaim(claim)
    emit(
      options,
      successReceipt(options, 'recover', 'recovered', {
        lockFile: paths.lockFile,
        receiptPath,
        historyPath: history,
        originalOwner: publicLock(lock),
        beforeHash: expected,
        afterHash: EMPTY_HASH,
      }),
    )
  } catch (error) {
    if (error.message === '__commit_lock_exit__') throw error
    throw error
  }
}

function status(options) {
  const paths = pathsFor(options.repo)
  const { raw, lock } = readLock(paths.lockFile)
  const guard = readGuard(paths)
  const result = {
    ok: true,
    action: 'status',
    result: 'observed',
    at: new Date().toISOString(),
    owner: lock
      ? {
          workId: lock.workId || null,
          runtime: lock.runtime || null,
          sessionId: lock.sessionId || null,
        }
      : null,
    repo: options.repo,
    lockFile: paths.lockFile,
    locked: Boolean(raw),
    lockHash: raw ? sha256(raw) : null,
    emptyLockHash: EMPTY_HASH,
    corrupt: Boolean(lock?._corrupt),
    lock: publicLock(lock),
    staleObservation: staleObservation(lock),
    operationGuard: guardDetails(guard),
    recoveryClaim: recoveryClaimDetails(paths),
  }
  if (options.json) emit(options, result)
  else {
    console.log(raw ? '=== /commit lock ===' : 'no lock')
    if (raw) {
      console.log(formatLock(lock))
      console.log(`  lock-hash: ${result.lockHash}`)
      console.log(
        `  stale:     ${result.staleObservation.stale ? 'yes' : 'no'} (observation only; acquire never auto-takes over)`,
      )
      try {
        console.log(`  mtime:     ${statSync(paths.lockFile).mtime.toISOString()}`)
      } catch {
        /* lock may be replaced */
      }
    }
    if (guard.present)
      console.log(
        `  guard:     present (${guardDetails(guard)?.action || 'unknown'}; explicit recovery required)`,
      )
    if (recoveryClaimDetails(paths))
      console.log(`  recovery:  ${JSON.stringify(recoveryClaimDetails(paths))}`)
  }
}

async function main() {
  const action = process.argv[2] || ''
  let options
  try {
    options = parseArgs(process.argv.slice(3))
  } catch (error) {
    const fallback = { json: process.argv.includes('--json') }
    try {
      fail(fallback, error.message, undefined, 2)
    } catch (exitError) {
      if (exitError.message === '__commit_lock_exit__') return
      throw exitError
    }
  }
  try {
    switch (action) {
      case 'acquire':
        acquire(options)
        break
      case 'renew':
        renew(options)
        break
      case 'release':
        release(options)
        break
      case 'status':
        status(options)
        break
      case 'recover':
        recover(options)
        break
      default:
        fail(options, USAGE, undefined, 2)
    }
  } catch (error) {
    if (error.message === '__commit_lock_exit__') return
    try {
      fail(options, error.message, undefined, 1)
    } catch (exitError) {
      if (exitError.message === '__commit_lock_exit__') return
      throw exitError
    }
  }
}

main()
