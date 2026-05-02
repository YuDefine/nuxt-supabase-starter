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
 */

import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { hostname, userInfo } from 'node:os'

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
  return [
    `  acquiredAt: ${lock.acquiredAtIso || '(unknown)'} (age ${ageSec}s)`,
    `  pid:        ${lock.pid}`,
    `  hostname:   ${lock.hostname}`,
    `  user:       ${lock.user}`,
    `  cwd:        ${lock.cwd}`,
  ].join('\n')
}

function acquire() {
  // 1) 若已有非 stale lock → 直接拒絕
  const existing = readLock()
  if (existing && !isStale(existing)) {
    console.error('[/commit lock] ⛔ 另一個 session 正在跑 /commit')
    console.error(formatLock(existing))
    console.error('')
    console.error('處置：')
    console.error('  1. 等對方完成（建議）')
    console.error('  2. 若確認對方已卡死或結束，手動清鎖：')
    console.error(`       rm "${LOCK_FILE}"`)
    console.error(`     然後重跑 /commit`)
    console.error('')
    console.error(`Staleness 閾值：${STALE_MINUTES} 分鐘（COMMIT_LOCK_STALE_MINUTES 可調整）`)
    process.exit(1)
  }

  // 2) Stale → 先 unlink，避免兩個 process 同時跑到 wx 都失敗
  if (existing && isStale(existing)) {
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
      console.error('處置：等對方完成或重跑 /commit')
      process.exit(1)
    }
    console.error(`[/commit lock] ⚠️ 寫入 lock 失敗：${err.message}`)
    process.exit(1)
  }

  console.log('[/commit lock] ✓ acquired')
  console.log(formatLock(payload))
}

function release() {
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
