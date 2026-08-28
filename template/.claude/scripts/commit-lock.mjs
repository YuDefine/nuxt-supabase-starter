#!/usr/bin/env node
/* eslint-disable no-console */
/* oxlint-disable no-console */

/**
 * /commit single-session lock
 *
 * 用途：防止兩個 Claude Code session 同時跑 /commit 造成 staging 撞車、
 * 品質閘門（0-A/0-B/0-C）重複消耗、或版本號 / tag push 競態。
 *
 * 用法：
 *   node .claude/scripts/commit-lock.mjs acquire   # 取得鎖（失敗 exit 1）
 *   node .claude/scripts/commit-lock.mjs release   # 釋放鎖
 *   node .claude/scripts/commit-lock.mjs status    # 顯示狀態（不改變）
 *
 * Staleness 判斷：
 *   鎖檔年齡 > COMMIT_LOCK_STALE_MINUTES（預設 30 分鐘）→ 視為 stale 自動清
 *
 * 注意：Claude Code 每個 Bash tool call 都 spawn 新 process，
 *       鎖主 PID 在下一個 call 就消失，因此不能用 PID liveness 判斷。
 *       /commit 正常流程遠短於 30 分鐘；若真的超時 → 幾乎可確定是中斷遺留。
 *
 * 持有者身分（`runtime` / `sessionId` / `herdr`）是鎖的一部分，不是裝飾：
 *       撞鎖的 session MUST 能只憑鎖檔就決定下一步——是自己的遺留鎖（直接回收）、
 *       是活著的 peer（herdr / SendMessage 對話），還是真的無從辨識（才輪到 user）。
 *       缺了這些欄位，撞鎖的唯一出口就是問 user，而那是把機械判定推給人。
 *       NEVER 把身分欄位當 optional telemetry 拿掉。
 */

import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { hostname, userInfo } from 'node:os'

// 身分探針。順序 MUST 與 clade `vendor/scripts/lib/detect-runtime.ts` 一致——
// 本檔是散播到 consumer `.claude/scripts/` 的 .mjs，consumer 端沒有那支 TS lib
// 可以 import，因此只能內聯一份。改動任一邊 MUST 同步另一邊。
const RUNTIME_PROBES = [
  ['claude', ['CLAUDE_PROJECT_DIR', 'CLAUDE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CONVERSATION_ID']],
  ['codex', ['CODEX_SESSION_ID', 'CODEX_AGENT_NAME', 'CODEX_HOME']],
  ['opencode', ['OPENCODE_SESSION_ID', 'OPENCODE_AGENT_ID', 'OPENCODE_HOME']],
  ['copilot', ['COPILOT_AGENT_ID', 'GITHUB_COPILOT_CHAT']],
  ['cursor', ['CURSOR_SESSION_ID', 'CURSOR_TRACE_ID']],
]

const SESSION_ID_KEYS = [
  'CLAUDE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ID',
  'CODEX_SESSION_ID',
  'OPENCODE_SESSION_ID',
  'CURSOR_SESSION_ID',
]

function detectRuntime(env = process.env) {
  const explicit = env.CLADE_RUNTIME?.trim().toLowerCase()
  if (explicit && RUNTIME_PROBES.some(([r]) => r === explicit)) return explicit
  for (const [runtime, keys] of RUNTIME_PROBES) {
    if (keys.some((k) => env[k])) return runtime
  }
  return 'unknown'
}

function detectSessionId(env = process.env) {
  for (const k of SESSION_ID_KEYS) {
    const v = env[k]
    if (v && v.trim()) return v.trim()
  }
  return null
}

function detectHerdr(env = process.env) {
  const paneId = env.HERDR_PANE_ID?.trim() || null
  const tabId = env.HERDR_TAB_ID?.trim() || null
  const socketPath = env.HERDR_SOCKET_PATH?.trim() || null
  if (!paneId && !tabId && !socketPath) return null
  return { paneId, tabId, socketPath }
}

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const LOCK_FILE = resolve(PROJECT_DIR, '.claude', '.commit.lock')
const STALE_MINUTES = Number.parseInt(process.env.COMMIT_LOCK_STALE_MINUTES || '30', 10)

function readLock() {
  if (!existsSync(LOCK_FILE)) return null
  try {
    return JSON.parse(readFileSync(LOCK_FILE, 'utf-8'))
  } catch {
    return { _corrupt: true }
  }
}

function isStale(lock) {
  if (!lock || lock._corrupt) return true
  const ageMs = Date.now() - (lock.acquiredAt || 0)
  return ageMs > STALE_MINUTES * 60 * 1000
}

function formatLock(lock) {
  if (!lock) return '(no lock)'
  if (lock._corrupt) return '(lock file corrupt)'
  const ageSec = Math.floor((Date.now() - (lock.acquiredAt || 0)) / 1000)
  const herdr = lock.herdr
    ? [
        herdr_kv('pane', lock.herdr.paneId),
        herdr_kv('tab', lock.herdr.tabId),
        herdr_kv('socket', lock.herdr.socketPath),
      ]
        .filter(Boolean)
        .join(' ')
    : ''
  return [
    `  acquiredAt: ${lock.acquiredAtIso || '(unknown)'} (age ${ageSec}s)`,
    `  runtime:    ${lock.runtime || '(舊格式鎖：無 runtime 欄位)'}`,
    `  session:    ${lock.sessionId || '(無 session id — 持有者不可定址)'}`,
    `  herdr:      ${herdr || '(不在 herdr 內 — 無 pane 可對話)'}`,
    `  pid:        ${lock.pid} (僅供追蹤；每個 Bash call 都換 pid，NEVER 拿它判存活)`,
    `  hostname:   ${lock.hostname}`,
    `  user:       ${lock.user}`,
    `  cwd:        ${lock.cwd}`,
  ].join('\n')
}

function herdr_kv(k, v) {
  return v ? `${k}=${v}` : ''
}

/**
 * 撞鎖時的處置。**唯一**輸出處，acquire 的兩個拒絕分支共用。
 *
 * 排序即優先序，且每一列都是撞鎖 session 自己做得到的動作。
 * 「回報 user」只在最後一列出現——持有者連 session id 都沒有時才成立。
 */
function contentionGuidance(lock) {
  const lines = ['處置（由上往下，第一個成立的就照做，NEVER 跳過去問 user）：']
  const pane = lock?.herdr?.paneId
  if (pane) {
    lines.push(`  1. 持有者在 herdr pane ${pane} — 直接跟它對話，問它還要不要這把鎖：`)
    lines.push(`       herdr agent prompt --pane ${pane} '<你是誰、要做什麼、可否讓鎖>'`)
    lines.push('     對方讓鎖 / 已結束 → 它自己跑 release；你重跑 acquire')
  } else if (lock?.sessionId) {
    lines.push(`  1. 持有者 session=${lock.sessionId}（不在 herdr）— 用 ListAgents 找到該 session`)
    lines.push('     後 SendMessage 問它還要不要這把鎖，NEVER 直接清鎖')
  }
  if (lock?.sessionId) {
    lines.push('  2. 對方無回應且鎖已 stale → 下次 acquire 會自動清除，等它')
    lines.push('  3. 以上都不成立才回報 user，並附上本段完整鎖資訊')
  } else {
    lines.push('  1. 鎖上沒有 session id（舊格式鎖，或非 agent 持有）→ 無從對話。')
    lines.push('     這是可回報 user 的唯一情況，回報時附上本段完整鎖資訊')
  }
  lines.push('')
  lines.push('NEVER 自行 rm 鎖檔來繞過本段——鎖是別的 session 的工作狀態，不是垃圾檔。')
  return lines.join('\n')
}

function acquire() {
  const existing = readLock()
  const mySessionId = detectSessionId()

  // 1) 同一個 session 的遺留鎖 → 自行回收。
  //    /commit 被中斷（user Ctrl-C、skill 中途換題）時鎖會留下，而下一個 Bash call
  //    的 pid 必然不同，pid 完全判不出「這是我自己剛剛留下的」。session id 判得出來，
  //    而且判得出來就 NEVER 該去問 user——那把鎖從頭到尾都是本 session 的。
  if (existing && !existing._corrupt && mySessionId && existing.sessionId === mySessionId) {
    console.error('[/commit lock] 本 session 的遺留鎖（session id 相符），自動回收：')
    console.error(formatLock(existing))
    try {
      unlinkSync(LOCK_FILE)
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`[/commit lock] ⚠️ 回收自己的鎖失敗：${err.message}`)
        process.exit(1)
      }
    }
  } else if (existing && !isStale(existing)) {
    // 2) 別人的鎖且未 stale → 拒絕，並給出可自行執行的協商路徑
    console.error('[/commit lock] ⛔ 另一個 session 正在跑 /commit')
    console.error(formatLock(existing))
    console.error('')
    console.error(contentionGuidance(existing))
    console.error('')
    console.error(`Staleness 閾值：${STALE_MINUTES} 分鐘（COMMIT_LOCK_STALE_MINUTES 可調整）`)
    process.exit(1)
  }

  // 3) Stale → 先 unlink，避免兩個 process 同時跑到 wx 都失敗
  if (existsSync(LOCK_FILE) && existing && isStale(existing)) {
    console.error('[/commit lock] 發現 stale lock，自動清除：')
    console.error(formatLock(existing))
    try {
      unlinkSync(LOCK_FILE)
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`[/commit lock] ⚠️ 清除 stale lock 失敗：${err.message}`)
        process.exit(1)
      }
    }
  }

  mkdirSync(dirname(LOCK_FILE), { recursive: true })
  const now = Date.now()
  const payload = {
    acquiredAt: now,
    acquiredAtIso: new Date(now).toISOString(),
    runtime: detectRuntime(),
    sessionId: mySessionId,
    herdr: detectHerdr(),
    pid: process.pid,
    ppid: process.ppid,
    hostname: hostname(),
    user: userInfo().username,
    cwd: process.cwd(),
  }

  // 3) 用 wx flag 做 atomic exclusive create — 兩個 process 同時跑只有一個會成功
  try {
    writeFileSync(LOCK_FILE, JSON.stringify(payload, null, 2), { mode: 0o644, flag: 'wx' })
  } catch (err) {
    if (err.code === 'EEXIST') {
      // 另一個 process 在我們 readLock → writeFile 中間搶先了
      const winner = readLock()
      console.error('[/commit lock] ⛔ 另一個 session 同時 acquire，本 session 退讓')
      console.error(formatLock(winner))
      console.error('')
      console.error(contentionGuidance(winner))
      process.exit(1)
    }
    console.error(`[/commit lock] ⚠️ 寫入 lock 失敗：${err.message}`)
    process.exit(1)
  }

  console.log('[/commit lock] ✓ acquired')
  console.log(formatLock(payload))
}

function release() {
  // 只釋放自己的鎖：別的 session 的鎖被誤 release 等於靜默解除互斥，
  // 而症狀（兩個 session 同時跑 0-A/0-C）要到很後面才看得出來。
  const existing = readLock()
  const mySessionId = detectSessionId()
  if (existing && !existing._corrupt && existing.sessionId && mySessionId && existing.sessionId !== mySessionId) {
    console.error('[/commit lock] ⛔ 這把鎖不是本 session 的，拒絕釋放')
    console.error(formatLock(existing))
    console.error('')
    console.error(contentionGuidance(existing))
    process.exit(1)
  }
  try {
    unlinkSync(LOCK_FILE)
    console.log('[/commit lock] ✓ released')
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('[/commit lock] (no lock to release)')
      return
    }
    console.error(`[/commit lock] ⚠️ 釋放失敗：${err.message}`)
    process.exit(1)
  }
}

function status() {
  const lock = readLock()
  if (!lock) {
    console.log('no lock')
    return
  }
  console.log('=== /commit lock ===')
  console.log(formatLock(lock))
  if (isStale(lock)) {
    console.log('')
    console.log('(stale — 下次 acquire 會自動清除)')
  }
  try {
    const s = statSync(LOCK_FILE)
    console.log('')
    console.log(`lockfile:     ${LOCK_FILE}`)
    console.log(`mtime:        ${s.mtime.toISOString()}`)
  } catch {
    // ignore
  }
}

const action = process.argv[2] || ''
switch (action) {
  case 'acquire':
    acquire()
    break
  case 'release':
    release()
    break
  case 'status':
    status()
    break
  default:
    console.error('Usage: commit-lock.mjs {acquire|release|status}')
    process.exit(2)
}
