#!/usr/bin/env node
/* eslint-disable no-console */
/* oxlint-disable no-console */

/**
 * /commit precheck — propagate × /commit 協調機制
 *
 * 用途：在 /commit Step 0-Scope 第一步跑，依跨 session 狀態自動分流：
 *   - normal                 → 維持現狀全包
 *   - propagate-staged       → propagate 剛 stage 投影層 → 自動分成 chore(clade) group
 *   - cross-session-conflict → 別 session 在動 LOCKED projection → 停下 + HANDOFF.md
 *
 * 用法：
 *   node .claude/scripts/commit-precheck.mjs
 *     stdout: JSON {mode, stagedPaths, propagateVersion, propagateMode, lockedRecentChanges, guidance}
 *     stderr: human-readable 警示（stale marker / cross-session-conflict）
 *     exit 0 = normal / propagate-staged（commit 可繼續）
 *     exit 2 = cross-session-conflict（commit MUST 停下）
 *     exit 1 = precheck 自己壞掉（fail-open，commit 走 normal 但警示）
 *
 * 環境變數：
 *   COMMIT_PRECHECK_LOCKED_MIN     LOCKED 異動門檻檔數（default 3）
 *   COMMIT_PRECHECK_LOCKED_MTIME_S  最近 mtime 門檻秒數（default 60）
 *   CLAUDE_PROJECT_DIR              consumer root（default process.cwd()）
 */

import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const MARKER_FILE = resolve(PROJECT_DIR, '.claude', '.propagate-marker.json')
const STALE_HOURS = 24
const LOCKED_MIN = Number.parseInt(process.env.COMMIT_PRECHECK_LOCKED_MIN || '3', 10)
const LOCKED_MTIME_S = Number.parseInt(process.env.COMMIT_PRECHECK_LOCKED_MTIME_S || '60', 10)
const BANNER = '🔒 LOCKED — managed by clade'

const LOCKED_PATH_PREFIXES = [
  '.claude/rules/',
  '.claude/skills/spectra-',
  '.claude/agents/',
  '.claude/commands/',
  'scripts/spectra-advanced/',
]

export function readMarker(markerPath = MARKER_FILE, now = Date.now()) {
  if (!existsSync(markerPath)) return null
  try {
    const raw = readFileSync(markerPath, 'utf-8')
    const marker = JSON.parse(raw)
    const writtenAtMs = Date.parse(marker.writtenAt || '')
    if (Number.isNaN(writtenAtMs)) {
      return { marker, isStale: true, reason: 'invalid writtenAt' }
    }
    const ageMs = now - writtenAtMs
    const isStale = ageMs > STALE_HOURS * 3600 * 1000
    return { marker, isStale, ageMs }
  } catch (err) {
    return { marker: null, isStale: true, reason: `parse error: ${err.message}` }
  }
}

export function parseGitStatusZ(out) {
  const entries = []
  let i = 0
  while (i < out.length) {
    if (i + 3 > out.length) break
    const xy = out.slice(i, i + 2)
    const pathStart = i + 3
    const nul = out.indexOf('\0', pathStart)
    if (nul < 0) break
    const path = out.slice(pathStart, nul)
    entries.push({ xy, path })
    i = nul + 1
    if (xy[0] === 'R' || xy[0] === 'C') {
      const nul2 = out.indexOf('\0', i)
      if (nul2 < 0) break
      i = nul2 + 1
    }
  }
  return entries
}

function gitStatusEntries() {
  try {
    const out = execFileSync('git', ['status', '--porcelain=v1', '-z'], {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
    })
    return parseGitStatusZ(out)
  } catch {
    return []
  }
}

export function hasLockedBanner(absPath) {
  try {
    if (!existsSync(absPath)) return false
    const head = readFileSync(absPath, 'utf-8').split('\n').slice(0, 5).join('\n')
    return head.includes(BANNER)
  } catch {
    return false
  }
}

function getMtimeAgoSeconds(absPath, now = Date.now()) {
  try {
    const s = statSync(absPath)
    return Math.floor((now - s.mtimeMs) / 1000)
  } catch {
    return null
  }
}

export function detectLockedChanges({ projectDir = PROJECT_DIR, entries, now = Date.now() } = {}) {
  const list = entries ?? gitStatusEntries()
  const lockedChanges = []
  for (const { xy, path } of list) {
    const isCandidate = LOCKED_PATH_PREFIXES.some((p) => path.startsWith(p))
    if (!isCandidate) continue
    const isDeleted = xy.includes('D')
    const absPath = resolve(projectDir, path)
    const lockedConfirmed = isDeleted ? true : hasLockedBanner(absPath)
    if (!lockedConfirmed) continue
    const mtimeAgoSeconds = isDeleted ? null : getMtimeAgoSeconds(absPath, now)
    lockedChanges.push({
      path,
      status: xy.trim(),
      isDeleted,
      mtimeAgoSeconds,
    })
  }
  return lockedChanges
}

export function decideMode({
  marker,
  isStale,
  lockedChanges,
  lockedMin = LOCKED_MIN,
  lockedMtimeS = LOCKED_MTIME_S,
}) {
  const recentLocked = lockedChanges.filter(
    (c) => c.mtimeAgoSeconds !== null && c.mtimeAgoSeconds < lockedMtimeS,
  )
  if (lockedChanges.length >= lockedMin && recentLocked.length > 0) {
    return { mode: 'cross-session-conflict', lockedChanges, recentLocked }
  }
  if (marker && !isStale) {
    return { mode: 'propagate-staged', marker }
  }
  return { mode: 'normal' }
}

function buildOutput(decision) {
  const base = {
    mode: decision.mode,
    stagedPaths: [],
    propagateVersion: null,
    propagateMode: null,
    lockedRecentChanges: [],
    guidance: '',
  }
  if (decision.mode === 'propagate-staged') {
    const m = decision.marker
    base.stagedPaths = m.stagedPaths || []
    base.propagateVersion = m.propagateVersion || null
    base.propagateMode = m.mode || null
    const n = base.stagedPaths.length
    const v = base.propagateVersion || '?'
    const modeNote =
      base.propagateMode === 'no-stage-fallback' ? '（未 stage，需 selective add）' : ''
    base.guidance = `ℹ️ propagate 投影層已自動分成 chore group（${n} 檔，v${v}）${modeNote}`
  } else if (decision.mode === 'cross-session-conflict') {
    base.lockedRecentChanges = decision.lockedChanges.map((c) => ({
      path: c.path,
      status: c.status,
      isDeleted: c.isDeleted,
      mtimeAgoSeconds: c.mtimeAgoSeconds,
    }))
    const recentList = decision.recentLocked
      .map((c) => `  ${c.path} (mtime ${c.mtimeAgoSeconds}s)`)
      .join('\n')
    base.guidance = [
      `⚠️ 偵測到 ${decision.lockedChanges.length} 個 LOCKED 檔正在被別 session 動：`,
      recentList,
      '',
      '建議：',
      '  1. tmux ls / ps 查另一 session（可能是 plugin loader 重構、clade refactor 中途、pnpm hub:check）',
      '  2. 寫 HANDOFF.md 紀錄當前 archive / WIP 狀態',
      '  3. 釋放 /commit lock 後收工，等對方 session 收尾',
      '',
      'NEVER 全包進業務 commit — 會偷走別 session 的 in-progress WIP',
    ].join('\n')
  }
  return base
}

function main() {
  let markerInfo = null
  try {
    markerInfo = readMarker()
  } catch (err) {
    process.stderr.write(`[commit-precheck] readMarker 失敗：${err.message}\n`)
  }

  let marker = null
  let isStale = false
  if (markerInfo) {
    marker = markerInfo.marker
    isStale = markerInfo.isStale
    if (isStale && marker) {
      try {
        unlinkSync(MARKER_FILE)
        process.stderr.write(
          `[commit-precheck] stale marker removed (writtenAt ${marker.writtenAt || '?'})\n`,
        )
      } catch {
        // ignore
      }
      marker = null
    }
  }

  let lockedChanges = []
  try {
    lockedChanges = detectLockedChanges()
  } catch (err) {
    process.stderr.write(
      `[commit-precheck] detectLockedChanges 失敗（fail-open）：${err.message}\n`,
    )
  }

  const decision = decideMode({ marker, isStale, lockedChanges })
  const out = buildOutput(decision)
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  if (decision.mode === 'cross-session-conflict') {
    process.stderr.write('\n' + out.guidance + '\n')
    process.exit(2)
  }
  process.exit(0)
}

const invokedDirectly = process.argv[1]?.endsWith('commit-precheck.mjs')
if (invokedDirectly) main()
