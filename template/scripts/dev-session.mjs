#!/usr/bin/env node
/**
 * dev-session.mjs — durable dev-server 單一入口（zellij detached + lease + 反累積）.
 *
 * 為什麼存在（root cause）：
 *   agent（Claude Code / Codex）的 harness 會在 tool-call 生命週期結束時回收
 *   Bash 衍生的整個 process tree —— **連 `spawn(detached:true)+unref()` / setsid /
 *   nohup 都逃不掉**（實測 2026-06-01 perno：run_in_background 與 setsid 起的 nuxt
 *   dev 都被 reap，唯獨掛在 tmux/zellij server daemon 下的存活）。dev-singleton.mjs
 *   的 `spawn(detached:true)` 同樣會被回收。
 *
 *   唯一可靠的持久化 = 把 dev process 交給一個**獨立於 agent session 的常駐
 *   multiplexer daemon**（本倉標準：zellij）。dev process 變成 zellij server 的
 *   子孫、不在 agent 的 spawn tree 裡 → 跨 tool-call / 跨 session 存活。
 *
 * 三層職責（本 script 是單一入口，收斂三者）：
 *   1. durability   → zellij detached session（`attach --create-background` + `run --cwd`）
 *   2. ownership    → verification-lease（相容 dev-singleton.mjs 的 /tmp/<id>-verification-lease.json schema v1）
 *   3. 反累積       → 一 consumer(-app) 一個 durable session（起前先查、有就 reuse）；
 *                     多 worktree 切換走 dev-router 不要 N 個 dev+tunnel；sweep 清死 session
 *
 * 用法：
 *   node scripts/dev-session.mjs [opts] -- <cmd...>   # 起/reuse durable dev session
 *   node scripts/dev-session.mjs status [opts]        # 查 session + port + lease
 *   node scripts/dev-session.mjs stop [opts]          # kill+delete session + 釋放 lease
 *   node scripts/dev-session.mjs list                 # 列所有 dev-* session + health
 *   node scripts/dev-session.mjs sweep [--dry-run]    # 清掉 EXITED / 死掉的 dev-* session（反累積）
 *
 * 常用 opts：
 *   --consumer-meta <path>   讀 consumer_id / dev.ports / auth.portPinned / dev.leaseMode
 *   --app <name>             multi-app consumer 的 app 後綴（session 名 + port 選擇）
 *   --session <name>         覆寫 session 名（預設 dev-<consumer_id>[-<app>]）
 *   --cwd <dir>              dev 命令的 working dir（預設 process.cwd()）
 *   --port <N>               dev port（health / lease 用；缺則從 cmd argv 或 consumer-meta 推）
 *   --label <text>           lease holder label
 *   --kind <claude|codex|human|subagent>   覆寫自動偵測的 holder kind
 *   --takeover               搶佔別人的 lease（strict 模式衝突時；會 log 前 holder）
 *   --no-lease               跳過 lease（純 durability + 反累積）
 *
 * 退出碼：0 成功（起 / reuse / status / stop / sweep）；1 lease 衝突 refuse / 啟動逾時 / 用法錯
 *
 * 與 dev-singleton / dev-router 的關係：
 *   - dev-singleton.mjs 是舊的「lease + spawn(detached)」wrapper —— spawn 層會被 reap，
 *     dev-session 取而代之（durability 靠 zellij，lease schema 相容）。
 *   - dev-router.mjs 管「一個公開 port 後面多 worktree backend 切換」；dev-session 起的
 *     是「一 consumer 一個 durable backend」。多 worktree 驗收走 dev-router，不要對每個
 *     worktree 各起一個 dev-session（那就是反累積要防的）。
 *
 * 詳見 rules/core/proactive-skills.md § Dev Server Auto-Spawn 與 rules/core/verification-lease.md。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'

const LEASE_DIR = tmpdir()
const READY_TIMEOUT_MS = 90_000
const READY_POLL_MS = 1_500

// ─────────────────────────────────────────────────────────────────────────
// 小工具
// ─────────────────────────────────────────────────────────────────────────

function out(s) {
  process.stdout.write(s + '\n')
}
function err(s) {
  process.stderr.write(s + '\n')
}

function sh(cmd, args, { allowFail = true } = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch (e) {
    if (allowFail) return null
    throw e
  }
}

function zellijAvailable() {
  return sh('zellij', ['--version']) !== null
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─────────────────────────────────────────────────────────────────────────
// arg 解析（保留 `--` 之後的整段當 cmd argv）
// ─────────────────────────────────────────────────────────────────────────

function parse(argv) {
  const o = {
    _: [], // positional（subcommand）
    cmd: null, // `--` 之後
    consumerMeta: null,
    app: null,
    session: null,
    cwd: process.cwd(),
    port: null,
    label: null,
    kind: null,
    takeover: false,
    noLease: false,
    dryRun: false,
  }
  const sep = argv.indexOf('--')
  const head = sep === -1 ? argv : argv.slice(0, sep)
  if (sep !== -1) o.cmd = argv.slice(sep + 1)
  for (let i = 0; i < head.length; i++) {
    const a = head[i]
    const next = () => head[++i]
    switch (a) {
      case '--consumer-meta':
        o.consumerMeta = next()
        break
      case '--app':
        o.app = next()
        break
      case '--session':
        o.session = next()
        break
      case '--cwd':
        o.cwd = next()
        break
      case '--port':
        o.port = Number(next())
        break
      case '--label':
        o.label = next()
        break
      case '--kind':
        o.kind = next()
        break
      case '--takeover':
        o.takeover = true
        break
      case '--no-lease':
        o.noLease = true
        break
      case '--dry-run':
        o.dryRun = true
        break
      case '-h':
      case '--help':
        o._.push('help')
        break
      default:
        if (!a.startsWith('-')) o._.push(a)
        break
    }
  }
  return o
}

// ─────────────────────────────────────────────────────────────────────────
// consumer / session / port 解析
// ─────────────────────────────────────────────────────────────────────────

function readConsumerMeta(p) {
  if (!p || !existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function resolveConsumerId(o, meta) {
  if (meta?.consumer_id) return meta.consumer_id
  // git toplevel basename
  const top = sh('git', ['-C', o.cwd, 'rev-parse', '--show-toplevel'])
  if (top) return basename(top)
  return basename(o.cwd)
}

function resolveSessionName(o, consumerId) {
  if (o.session) return o.session
  return o.app ? `dev-${consumerId}-${o.app}` : `dev-${consumerId}`
}

// 從 cmd argv 找 `--port N`；或從 consumer-meta dev.ports 推
function resolvePort(o, meta) {
  if (o.port) return o.port
  if (o.cmd) {
    const i = o.cmd.indexOf('--port')
    if (i !== -1 && o.cmd[i + 1]) {
      const n = Number(o.cmd[i + 1])
      if (n) return n
    }
  }
  const ports = meta?.dev?.ports
  if (Array.isArray(ports) && ports.length) {
    if (o.app) {
      const m = ports.find((p) => p.alias === o.app || p.app === o.app)
      if (m?.port) return m.port
    }
    if (ports[0]?.port) return ports[0].port
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────
// port health
// ─────────────────────────────────────────────────────────────────────────

function portListening(port) {
  if (!port) return false
  const r = sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
  return !!(r && r.length)
}

function portPid(port) {
  if (!port) return null
  const r = sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
  return r ? r.split('\n')[0].trim() : null
}

// ─────────────────────────────────────────────────────────────────────────
// zellij session primitives
// ─────────────────────────────────────────────────────────────────────────

// 回傳 [{ name, exited }]
function listZellijSessions() {
  const raw = sh('zellij', ['list-sessions', '--no-formatting'])
  if (!raw) return []
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const name = l.split(/\s+/)[0]
      const exited = /EXITED/i.test(l)
      return { name, exited }
    })
}

function findSession(name) {
  return listZellijSessions().find((s) => s.name === name) || null
}

function createBackgroundSession(name) {
  // idempotent：已存在會印 "Session already exists" exit 0
  sh('zellij', ['attach', '--create-background', name])
}

function runInSession(name, cwd, cmdArgv) {
  // zellij --session <name> run --cwd <dir> -- <cmd...>
  return sh('zellij', ['--session', name, 'run', '--cwd', cwd, '--', ...cmdArgv])
}

function killSession(name) {
  sh('zellij', ['kill-session', name])
  sh('zellij', ['delete-session', name])
}

// ─────────────────────────────────────────────────────────────────────────
// lease（相容 dev-singleton.mjs schema v1；fail-open per verification-lease.md §7）
// ─────────────────────────────────────────────────────────────────────────

function leasePath(consumerId) {
  return join(LEASE_DIR, `${consumerId}-verification-lease.json`)
}

function holderKind(o) {
  if (o.kind) return o.kind
  if (process.env.CLAUDE_SESSION_ID) return 'claude'
  if (process.env.CODEX_SESSION_ID) return 'codex'
  return 'human'
}

function holderSessionId(o) {
  const id = process.env.CLAUDE_SESSION_ID || process.env.CODEX_SESSION_ID
  if (id) return id
  if (holderKind(o) === 'human') return 'human'
  return createHash('sha1').update(o.cwd).digest('hex').slice(0, 12)
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

function pidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(Number(pid), 0)
    return true
  } catch {
    return false
  }
}

function writeLease(o, consumerId, sessionName, port) {
  try {
    const lease = {
      schemaVersion: '1',
      consumerId,
      claimedAt: new Date().toISOString(),
      holder: {
        kind: holderKind(o),
        sessionId: holderSessionId(o),
        label: o.label || `dev-session ${sessionName}`,
      },
      devServer: {
        pid: port ? Number(portPid(port)) || null : null,
        cwd: o.cwd,
        port: port || null,
        url: port ? `http://127.0.0.1:${port}` : null,
      },
      devSession: { multiplexer: 'zellij', name: sessionName },
    }
    writeFileSync(leasePath(consumerId), JSON.stringify(lease, null, 2) + '\n')
  } catch {
    /* fail-open */
  }
}

function releaseLease(o, consumerId) {
  try {
    const lease = readLease(consumerId)
    if (!lease) return
    const mine = lease.holder?.sessionId === holderSessionId(o)
    if (mine || !pidAlive(lease.devServer?.pid)) unlinkSync(leasePath(consumerId))
  } catch {
    /* fail-open */
  }
}

// strict lease 衝突判定：別人持有 + 其 dev pid 還活 + cwd 不同 → refuse（除非 takeover）
function leaseConflict(o, consumerId) {
  const lease = readLease(consumerId)
  if (!lease) return null
  const mine = lease.holder?.sessionId === holderSessionId(o)
  if (mine) return null
  if (!pidAlive(lease.devServer?.pid)) return null // stale → 不算衝突
  if (lease.devServer?.cwd === o.cwd) return null // 同 cwd → 視為同工作
  return lease
}

// ─────────────────────────────────────────────────────────────────────────
// commands
// ─────────────────────────────────────────────────────────────────────────

async function cmdLaunch(o) {
  if (!o.cmd || !o.cmd.length) {
    err('用法：dev-session.mjs [opts] -- <cmd...>（缺少 `-- <cmd>`）')
    process.exit(1)
  }
  if (!zellijAvailable()) {
    err('zellij 未安裝 / 不在 PATH。dev-session 以 zellij 為持久層，請先安裝 zellij。')
    process.exit(1)
  }

  const meta = readConsumerMeta(o.consumerMeta)
  const consumerId = resolveConsumerId(o, meta)
  const sessionName = resolveSessionName(o, consumerId)
  const port = resolvePort(o, meta)
  const urlHint = port ? `http://127.0.0.1:${port}` : '(port 未知)'

  // 1) 反累積：起前先查 existing session
  const existing = findSession(sessionName)
  if (existing && !existing.exited) {
    if (!port || portListening(port)) {
      out(`✓ reuse 既有 durable dev session（反累積，不重起）`)
      out(`  session: ${sessionName}  ｜  ${urlHint}`)
      out(`  看畫面：zellij attach ${sessionName}（離開 Ctrl-q 或 detach Ctrl-o d）`)
      out(`  停止：  node scripts/dev-session.mjs stop --session ${sessionName}`)
      return
    }
    // session 活著但 dev port 沒在聽 → 裡面的 dev 死了，重建
    err(`session ${sessionName} 存在但 port ${port} 沒在聽 → 視為內部 dev 已死，重建`)
    killSession(sessionName)
  } else if (existing && existing.exited) {
    killSession(sessionName) // 清 EXITED 殘骸
  }

  // 2) lease（strict 衝突 refuse）
  if (!o.noLease) {
    const strict = meta?.dev?.leaseMode === 'strict' || meta?.auth?.portPinned === true
    const conflict = leaseConflict(o, consumerId)
    if (conflict && strict && !o.takeover) {
      err(
        `[lease:${consumerId}] 無法 claim — 已被 ${conflict.holder?.kind}:${conflict.holder?.sessionId} 持有`,
      )
      err(`  since:   ${conflict.claimedAt}`)
      err(
        `  dev:     PID ${conflict.devServer?.pid}, cwd=${conflict.devServer?.cwd}, port=${conflict.devServer?.port}`,
      )
      err(`  要強制接管請加 --takeover（會 log 前 holder）。`)
      process.exit(1)
    }
    if (conflict && o.takeover) {
      err(
        `[lease:${consumerId}] --takeover：接管 ${conflict.holder?.kind}:${conflict.holder?.sessionId} 的 lease`,
      )
      if (pidAlive(conflict.devServer?.pid)) sh('kill', [String(conflict.devServer.pid)])
    }
  }

  // 3) 起 detached zellij session + 把 dev 命令丟進去
  out(`▶ 起 durable dev session（zellij）：${sessionName}`)
  out(`  cmd: ${o.cmd.join(' ')}`)
  out(`  cwd: ${o.cwd}`)
  createBackgroundSession(sessionName)
  runInSession(sessionName, o.cwd, o.cmd)

  // 4) 等 port ready（若 port 已知）
  if (!port) {
    out(`✓ 已丟進 zellij session ${sessionName}（port 未知，無法輪詢）`)
    out(`  看畫面：zellij attach ${sessionName}`)
    return
  }
  const start = Date.now()
  while (Date.now() - start < READY_TIMEOUT_MS) {
    await sleep(READY_POLL_MS)
    if (portListening(port)) {
      if (!o.noLease) writeLease(o, consumerId, sessionName, port)
      out(
        `✓ durable dev ready：${urlHint}（session ${sessionName}，掛在 zellij server 不會被 harness reap）`,
      )
      out(`  看畫面：zellij attach ${sessionName}（detach Ctrl-o d）`)
      out(`  停止：  node scripts/dev-session.mjs stop --session ${sessionName}`)
      return
    }
  }
  err(`⚠ 啟動逾時（${READY_TIMEOUT_MS}ms）port ${port} 仍未聽。session ${sessionName} 保留供檢查：`)
  err(`  zellij attach ${sessionName}（看 dev 卡在哪）`)
  process.exit(1)
}

function cmdStatus(o) {
  const meta = readConsumerMeta(o.consumerMeta)
  const consumerId = resolveConsumerId(o, meta)
  const sessionName = resolveSessionName(o, consumerId)
  const port = resolvePort(o, meta)
  const s = findSession(sessionName)
  out(`dev-session status — ${sessionName}`)
  out(`  zellij session: ${s ? (s.exited ? 'EXITED（死）' : '存在（活）') : '不存在'}`)
  if (port) out(`  port ${port}: ${portListening(port) ? `LISTENING（${urlOf(port)}）` : '沒在聽'}`)
  const lease = readLease(consumerId)
  if (lease)
    out(
      `  lease holder: ${lease.holder?.kind}:${lease.holder?.sessionId}  cwd=${lease.devServer?.cwd}`,
    )
  else out(`  lease: 無`)
}

function cmdStop(o) {
  const meta = readConsumerMeta(o.consumerMeta)
  const consumerId = resolveConsumerId(o, meta)
  const sessionName = resolveSessionName(o, consumerId)
  const s = findSession(sessionName)
  if (!s) {
    out(`session ${sessionName} 不存在，無需停止`)
  } else {
    killSession(sessionName)
    out(`✓ 已 kill + delete session ${sessionName}`)
  }
  if (!o.noLease) releaseLease(o, consumerId)
}

function urlOf(port) {
  return `http://127.0.0.1:${port}`
}

function cmdList() {
  const sessions = listZellijSessions().filter((s) => s.name.startsWith('dev-'))
  if (!sessions.length) {
    out('沒有 dev-* zellij session')
    return
  }
  out('dev-* durable sessions：')
  for (const s of sessions) {
    out(`  ${s.name}${s.exited ? '  [EXITED]' : ''}`)
  }
}

function cmdSweep(o) {
  const sessions = listZellijSessions().filter((s) => s.name.startsWith('dev-'))
  const dead = sessions.filter((s) => s.exited)
  if (!dead.length) {
    out('sweep：沒有 EXITED 的 dev-* session 需要清')
  } else {
    out(`sweep：${dead.length} 個 EXITED dev-* session${o.dryRun ? '（--dry-run，不動）' : ''}`)
    for (const s of dead) {
      out(`  ${o.dryRun ? '[would kill]' : '[killed]'} ${s.name}`)
      if (!o.dryRun) killSession(s.name)
    }
  }
  // 提醒跨 consumer 累積（純報告，不自動殺活的）
  const alive = sessions.filter((s) => !s.exited)
  if (alive.length > 1) {
    out(
      `提醒：目前有 ${alive.length} 個活著的 dev-* session：${alive.map((s) => s.name).join(', ')}`,
    )
    out(`  多 worktree 驗收請改走 dev-router（一個公開 port 切 backend），避免每個各起一台。`)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────

function usage() {
  out(
    readFileSync(new URL(import.meta.url))
      .toString()
      .split('\n')
      .slice(1, 38)
      .map((l) => l.replace(/^ \*?/, ''))
      .join('\n'),
  )
}

async function main() {
  const o = parse(process.argv.slice(2))
  const sub = o._[0]
  if (sub === 'help') return usage()
  switch (sub) {
    case 'status':
      return cmdStatus(o)
    case 'stop':
      return cmdStop(o)
    case 'list':
      return cmdList()
    case 'sweep':
      return cmdSweep(o)
    default:
      return cmdLaunch(o) // 無 subcommand = launch
  }
}

main().catch((e) => {
  err(`dev-session error: ${e?.message || e}`)
  process.exit(1)
})
