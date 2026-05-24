#!/usr/bin/env node

/**
 * dev-singleton.mjs — clade-managed dev server singleton wrapper
 *
 * Generalized from TDMS scripts/singleton.mjs. Propagated into each consumer's
 * vendor/scripts/ by clade sync-vendor. Consumer wires up via package.json:
 *
 *   "dev:agent":  "node vendor/scripts/dev-singleton.mjs --consumer-meta .claude/consumer-meta.json -- pnpm dev"
 *   "dev:status": "node vendor/scripts/dev-singleton.mjs --consumer-meta .claude/consumer-meta.json --status"
 *   "dev:kill":   "node vendor/scripts/dev-singleton.mjs --consumer-meta .claude/consumer-meta.json --kill"
 *
 * Behavior depends on consumer-meta.json:
 *   - auth.portPinned=true + dev.leaseMode=strict → cwd-mismatch refuse (must --takeover)
 *   - dev.leaseMode=advisory                     → cwd-mismatch warn + reuse
 *   - no consumer-meta.json                      → fallback to legacy reuse-or-spawn (no lease)
 *
 * See rules/core/verification-lease.md for lease semantics.
 *
 * Usage:
 *   --consumer-meta <path>   Read dev.ports[0].port + dev.leaseMode + consumerId
 *   --port <N>               Override port (skips consumer-meta lookup)
 *   --label <text>           Lease holder label (default: "<cmd> at <cwd>")
 *   --kind <claude|codex|human|subagent>   Override auto-detected holder kind
 *   --takeover               Force takeover of existing lease (logs prev holder)
 *   --no-lease               Skip lease write (legacy compat; emits warning)
 *   --status                 Print current lease + dev server state
 *   --kill                   Kill dev server + release lease
 *   --release                Release lease without killing (rare)
 *   -- <cmd> [args...]       Command to spawn when port is free
 *
 * Exit codes:
 *   0  success (spawned / reused / killed / status printed)
 *   1  lease conflict (refused), spawn timeout, or other runtime error
 *   2  usage error
 */

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PING_TIMEOUT_MS = 1500
const SPAWN_WAIT_MAX_MS = 20000
const SPAWN_POLL_INTERVAL_MS = 500
const LEASE_DIR = tmpdir()

const cli = parseArgs(process.argv)

if (cli.mode === 'status') await statusMode(cli)
else if (cli.mode === 'kill') await killMode(cli)
else if (cli.mode === 'release') releaseMode(cli)
else await launchMode(cli)

// ── arg parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    consumerMetaPath: '',
    port: 0,
    label: '',
    kind: '',
    takeover: false,
    noLease: false,
    mode: 'launch',
    cmdArgv: [],
  }
  const dashDashIdx = argv.indexOf('--')
  const head = dashDashIdx === -1 ? argv : argv.slice(0, dashDashIdx)
  opts.cmdArgv = dashDashIdx === -1 ? [] : argv.slice(dashDashIdx + 1)
  for (let i = 2; i < head.length; i++) {
    const a = head[i]
    if (a === '--consumer-meta') opts.consumerMetaPath = head[++i]
    else if (a === '--port') opts.port = Number(head[++i])
    else if (a === '--label') opts.label = head[++i]
    else if (a === '--kind') opts.kind = head[++i]
    else if (a === '--takeover') opts.takeover = true
    else if (a === '--no-lease') opts.noLease = true
    else if (a === '--status') opts.mode = 'status'
    else if (a === '--kill') opts.mode = 'kill'
    else if (a === '--release') opts.mode = 'release'
    else if (a === '-h' || a === '--help') {
      process.stdout.write(usage())
      process.exit(0)
    } else {
      process.stderr.write(`[dev-singleton] unknown arg: ${a}\n`)
      process.exit(2)
    }
  }
  const meta = loadConsumerMeta(opts.consumerMetaPath)
  if (meta) {
    if (!opts.port) opts.port = meta.dev?.ports?.[0]?.port ?? 0
    opts.consumerId = meta.consumerId
    opts.leaseMode = meta.dev?.leaseMode ?? 'advisory'
    opts.portPinned = meta.auth?.portPinned ?? false
  }
  if (!opts.port) {
    process.stderr.write(
      '[dev-singleton] missing --port (and no consumer-meta.json with dev.ports)\n',
    )
    process.exit(2)
  }
  if (!opts.consumerId) opts.consumerId = derivePathConsumerId()
  if (!opts.leaseMode) opts.leaseMode = 'advisory'
  if (!opts.kind) opts.kind = detectKind()
  return opts
}

function usage() {
  return `dev-singleton.mjs — clade dev server singleton wrapper
  --consumer-meta <path>  Read port + leaseMode from .claude/consumer-meta.json
  --port <N>              Override port
  --label <text>          Lease holder label
  --kind <k>              claude | codex | human | subagent
  --takeover              Force takeover existing lease
  --no-lease              Skip lease write
  --status                Print state
  --kill                  Kill dev server + release lease
  --release               Release lease only
  -- <cmd> [args...]      Command to spawn

See rules/core/verification-lease.md for semantics.
`
}

function loadConsumerMeta(path) {
  if (!path) return null
  const resolved = path.startsWith('/') ? path : join(process.cwd(), path)
  if (!existsSync(resolved)) {
    process.stderr.write(`[dev-singleton] warning: consumer-meta not found at ${resolved}\n`)
    return null
  }
  try {
    return JSON.parse(readFileSync(resolved, 'utf8'))
  } catch (e) {
    process.stderr.write(`[dev-singleton] warning: failed to parse consumer-meta: ${e.message}\n`)
    return null
  }
}

function detectKind() {
  if (process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID) return 'claude'
  if (process.env.CODEX_SESSION_ID) return 'codex'
  return 'human'
}

function derivePathConsumerId() {
  const parts = process.cwd().split('/').filter(Boolean)
  return parts[parts.length - 1] || 'unknown'
}

// ── lease helpers ────────────────────────────────────────────────────────

function leasePath(consumerId) {
  return join(LEASE_DIR, `${consumerId}-verification-lease.json`)
}

function readLease(consumerId) {
  const p = leasePath(consumerId)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function writeLease(consumerId, lease) {
  writeFileSync(leasePath(consumerId), JSON.stringify(lease, null, 2) + '\n')
}

function deleteLease(consumerId) {
  const p = leasePath(consumerId)
  if (existsSync(p)) unlinkSync(p)
}

function isPidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code !== 'ESRCH'
  }
}

function holderId(kind, sid) {
  return `${kind}:${sid || cwdHash()}`
}

function cwdHash() {
  return createHash('sha256').update(process.cwd()).digest('hex').slice(0, 8)
}

function sessionId(kind) {
  if (kind === 'claude')
    return process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID || cwdHash()
  if (kind === 'codex') return process.env.CODEX_SESSION_ID || cwdHash()
  if (kind === 'human') return 'human'
  return cwdHash()
}

function appendAudit(lease, event, extra = {}) {
  if (!lease.auditLog) lease.auditLog = []
  lease.auditLog.push({ at: new Date().toISOString(), event, ...extra })
  if (lease.auditLog.length > 50) lease.auditLog = lease.auditLog.slice(-50)
}

// ── port helpers ─────────────────────────────────────────────────────────

function lsofPid(port) {
  try {
    const out = execFileSync('lsof', ['-iTCP:' + port, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out ? Number(out.split('\n')[0]) : 0
  } catch {
    return 0
  }
}

function pidCwd(pid) {
  if (!pid) return ''
  try {
    const out = execFileSync('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const m = out.match(/^n(.+)$/m)
    return m ? m[1] : ''
  } catch {
    return ''
  }
}

async function ping(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      redirect: 'manual',
    })
    return res.status >= 200 && res.status < 500
  } catch {
    return false
  }
}

// ── output ───────────────────────────────────────────────────────────────

function log(opts, msg) {
  process.stdout.write(`[dev-singleton:${opts.consumerId}] ${msg}\n`)
}

function logErr(opts, msg) {
  process.stderr.write(`[dev-singleton:${opts.consumerId}] ${msg}\n`)
}

// ── status mode ──────────────────────────────────────────────────────────

async function statusMode(opts) {
  const lease = readLease(opts.consumerId)
  const pid = lsofPid(opts.port)
  if (!pid && !lease) {
    log(opts, `not running on port ${opts.port}; no lease`)
    return
  }
  if (lease && !isPidAlive(lease.devServer?.pid)) {
    log(opts, `stale lease (PID ${lease.devServer?.pid} dead); will clear on next claim`)
  }
  const alive = pid ? await ping(opts.port) : false
  const uptime = lease ? formatDuration(Date.now() - new Date(lease.claimedAt).getTime()) : '?'
  log(opts, 'dev server status:')
  process.stdout.write(`  port:       ${opts.port}\n`)
  process.stdout.write(`  pid:        ${pid || '(no LISTEN)'}\n`)
  process.stdout.write(
    `  alive:      ${alive ? 'yes' : 'no (PID alive but HTTP not responding)'}\n`,
  )
  if (lease) {
    process.stdout.write(`  holder:     ${holderLabel(lease.holder)}\n`)
    process.stdout.write(`  cwd:        ${lease.devServer?.cwd || '?'}\n`)
    process.stdout.write(`  url:        ${lease.devServer?.url || '?'}\n`)
    process.stdout.write(`  uptime:     ${uptime}\n`)
    process.stdout.write(`  label:      ${lease.holder?.label || ''}\n`)
  } else {
    process.stdout.write('  lease:      (none — running outside dev-singleton wrapper?)\n')
  }
}

function holderLabel(holder) {
  if (!holder) return '?'
  return `${holder.kind}:${holder.sessionId}`
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

// ── kill / release ───────────────────────────────────────────────────────

async function killMode(opts) {
  const pid = lsofPid(opts.port)
  if (pid) {
    try {
      execFileSync('kill', [String(pid)])
      log(opts, `killed PID ${pid} on port ${opts.port}`)
    } catch (e) {
      logErr(opts, `kill PID ${pid} failed: ${e.message}`)
    }
  } else {
    log(opts, `no listener on port ${opts.port}`)
  }
  deleteLease(opts.consumerId)
}

function releaseMode(opts) {
  if (!existsSync(leasePath(opts.consumerId))) {
    log(opts, 'no lease to release')
    return
  }
  deleteLease(opts.consumerId)
  log(opts, 'lease released (dev server NOT killed)')
}

// ── launch mode ──────────────────────────────────────────────────────────

async function launchMode(opts) {
  if (!opts.cmdArgv.length) {
    process.stderr.write('[dev-singleton] launch mode requires "-- <cmd>" args\n')
    process.exit(2)
  }

  const existing = lsofPid(opts.port)
  const lease = readLease(opts.consumerId)

  if (existing) {
    return await handleExistingPort(opts, existing, lease)
  }
  if (lease && isPidAlive(lease.devServer?.pid)) {
    logErr(
      opts,
      `lease references live PID ${lease.devServer.pid} but no LISTEN on port ${opts.port} — inconsistent state, run --kill`,
    )
    process.exit(1)
  }
  if (lease) deleteLease(opts.consumerId)

  await spawnAndClaim(opts)
}

async function handleExistingPort(opts, existingPid, lease) {
  const alive = await ping(opts.port)
  if (!alive) {
    logErr(
      opts,
      `port ${opts.port} held by PID ${existingPid} but HTTP unhealthy — run --kill to clear`,
    )
    process.exit(1)
  }

  const actualCwd = pidCwd(existingPid)
  const currentCwd = process.cwd()
  const sameCwd = actualCwd === currentCwd

  const meHolder = holderId(opts.kind, sessionId(opts.kind))
  const leaseHolder = lease ? holderId(lease.holder?.kind, lease.holder?.sessionId) : null
  const sameHolder = leaseHolder === meHolder

  if (sameCwd) {
    log(opts, `reuse existing PID ${existingPid} on port ${opts.port}`)
    process.stdout.write(`http://127.0.0.1:${opts.port}\n`)
    if (!lease && !opts.noLease) {
      // wrapper-managed instance lost lease (manual kill of /tmp or fresh start) — re-create
      writeAndClaim(opts, existingPid, actualCwd, /* reclaim */ true)
    }
    return
  }

  // cwd mismatch
  const isStrict = opts.leaseMode === 'strict' || opts.portPinned

  if (isStrict && !opts.takeover) {
    printConflictMessage(opts, existingPid, actualCwd, lease)
    process.exit(1)
  }

  if (opts.takeover) {
    log(opts, `takeover: killing PID ${existingPid} (was serving ${actualCwd})`)
    try {
      execFileSync('kill', [String(existingPid)])
    } catch (e) {
      logErr(opts, `takeover kill failed: ${e.message}`)
      process.exit(1)
    }
    // wait briefly for port to free
    await new Promise((r) => setTimeout(r, 1000))
    if (lease) {
      const oldHolder = lease.holder
      appendAudit(lease, 'takeover', {
        by: meHolder,
        prevHolder: holderLabel(oldHolder),
        reason: opts.label || '(no label)',
      })
    }
    deleteLease(opts.consumerId)
    return await spawnAndClaim(opts)
  }

  // advisory mode + cwd mismatch
  if (!sameHolder) {
    logErr(opts, `WARNING: reusing PID ${existingPid} serving DIFFERENT cwd:`)
    logErr(opts, `  existing: ${actualCwd}`)
    logErr(opts, `  current:  ${currentCwd}`)
    logErr(
      opts,
      '  (leaseMode=advisory; not refusing. Use --takeover to switch, or set leaseMode=strict to block this.)',
    )
  }
  process.stdout.write(`http://127.0.0.1:${opts.port}\n`)
}

function printConflictMessage(opts, existingPid, existingCwd, lease) {
  const holder = lease?.holder ? holderLabel(lease.holder) : '(no lease — direct spawn)'
  const since = lease?.claimedAt
    ? `${formatDuration(Date.now() - new Date(lease.claimedAt).getTime())} ago`
    : '?'
  process.stderr.write(`
[dev-singleton:${opts.consumerId}] cannot claim — port ${opts.port} held by different cwd
  holder:     ${holder}
  since:      ${lease?.claimedAt || '?'} (${since})
  dev server: PID ${existingPid}, cwd=${existingCwd}, port=${opts.port}
  current:    cwd=${process.cwd()}, kind=${opts.kind}

To force takeover, re-run with --takeover (logs previous holder + reason).
To inspect, run: dev:status

See rules/core/verification-lease.md.
`)
}

async function spawnAndClaim(opts) {
  const [prog, ...args] = opts.cmdArgv
  log(opts, `spawning: ${prog} ${args.join(' ')}`)
  const child = spawn(prog, args, {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
  })
  child.unref()

  const start = Date.now()
  while (Date.now() - start < SPAWN_WAIT_MAX_MS) {
    await new Promise((r) => setTimeout(r, SPAWN_POLL_INTERVAL_MS))
    if (await ping(opts.port)) {
      const realPid = lsofPid(opts.port)
      log(opts, `spawned: PID ${realPid || child.pid}, ready`)
      if (!opts.noLease)
        writeAndClaim(opts, realPid || child.pid, process.cwd(), /* reclaim */ false)
      process.stdout.write(`http://127.0.0.1:${opts.port}\n`)
      return
    }
  }

  // race fallback
  const racePid = lsofPid(opts.port)
  if (racePid && (await ping(opts.port))) {
    log(opts, `race-reused PID ${racePid} on port ${opts.port}`)
    process.stdout.write(`http://127.0.0.1:${opts.port}\n`)
    return
  }

  logErr(opts, `spawn timed out after ${SPAWN_WAIT_MAX_MS}ms`)
  process.exit(1)
}

function writeAndClaim(opts, pid, cwd, reclaim) {
  const sid = sessionId(opts.kind)
  const lease = {
    schemaVersion: '1',
    consumerId: opts.consumerId,
    claimedAt: new Date().toISOString(),
    holder: {
      kind: opts.kind,
      sessionId: sid,
      label: opts.label || `dev-singleton at ${cwd}`,
    },
    devServer: {
      pid,
      cwd,
      port: opts.port,
      url: `http://127.0.0.1:${opts.port}`,
    },
    browserProfile: null,
    cookieNamespace: null,
    envFile: null,
    auditLog: [
      {
        at: new Date().toISOString(),
        event: reclaim ? 'reclaimed' : 'claimed',
        by: holderId(opts.kind, sid),
      },
    ],
  }
  writeLease(opts.consumerId, lease)
}
