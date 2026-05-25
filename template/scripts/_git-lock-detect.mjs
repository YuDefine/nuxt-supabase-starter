/**
 * _git-lock-detect.mjs — stale `.git/index.lock` detection + auto-cleanup.
 *
 * Background (docs/tech-debt.md TD-145):
 *   Parallel sweep mid-flight 撞到 0-byte `.git/index.lock` 沒 active git process。
 *   手動 `rm` 解，但 SWEEP-V2-002 audit 漏掉。共用 helper 給 wt-helper / publish.mjs
 *   入口 idempotent 預清，避免 stale lock 沿著流程往下傳。
 *
 * Stale criteria — ALL must hold:
 *   - File exists at `<repoRoot>/.git/index.lock`
 *   - Size = 0 bytes (real active git holds it open with PID line content)
 *   - mtime older than `thresholdMs` (default 60s — in-progress git ops finish
 *     within 60s on any healthy mac)
 *   - No active git process visible via `ps aux` (no other session writing)
 *
 * NEVER touches non-empty lock or fresh lock — those are the safety boundary
 * against accidentally clearing an active git op. Active-process pids reported
 * so caller can log clearly.
 *
 * Zero-dep: only node:fs + node:child_process. No npm packages.
 */

import { execFileSync } from 'node:child_process'
import { statSync, unlinkSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

const DEFAULT_THRESHOLD_MS = 60_000

/**
 * Returns { cleaned, reason?, pids? }.
 *
 *   cleaned: true                              — was stale, rm'd, safe to retry
 *   cleaned: false, reason: 'no-lock'          — no lock present
 *   cleaned: false, reason: 'fresh'            — lock < thresholdMs old
 *   cleaned: false, reason: 'non-empty'        — lock has content, treat active
 *   cleaned: false, reason: 'active-process'   — ps found `git` process; pids[] included
 *   cleaned: false, reason: 'io-error'         — fs/ps internal error, included as err
 *
 * NEVER throws on I/O — wraps everything in try/catch so caller can be a one-liner.
 */
export function detectAndCleanStaleIndexLock(repoRoot, opts = {}) {
  return detectAndCleanStaleIndexLockAtPath(join(repoRoot, '.git', 'index.lock'), opts)
}

/**
 * Worktree/submodule-safe variant. Resolves the real index.lock path via
 * `git rev-parse --git-path index.lock` (honors `.git` being a file in a linked
 * worktree / submodule) instead of assuming `<cwd>/.git/index.lock`, then
 * applies the identical stale criteria. `cwd` is any path inside the repo.
 *
 * Added 2026-05-25 (codex review): consumer repos may be worktrees; a dead
 * propagate left stale locks that the repoRoot-relative variant could miss.
 */
export function ensureNoStaleIndexLockForRepo(cwd, opts = {}) {
  let lockPath
  try {
    const out = execFileSync('git', ['rev-parse', '--git-path', 'index.lock'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!out) return { cleaned: false, reason: 'io-error', err: 'empty git-path' }
    lockPath = isAbsolute(out) ? out : join(cwd, out)
  } catch {
    return { cleaned: false, reason: 'io-error', err: 'git rev-parse --git-path failed' }
  }
  return detectAndCleanStaleIndexLockAtPath(lockPath, opts)
}

function detectAndCleanStaleIndexLockAtPath(lockPath, opts = {}) {
  const thresholdMs = typeof opts.thresholdMs === 'number' ? opts.thresholdMs : DEFAULT_THRESHOLD_MS

  let st
  try {
    st = statSync(lockPath)
  } catch (e) {
    if (e && e.code === 'ENOENT') return { cleaned: false, reason: 'no-lock' }
    return { cleaned: false, reason: 'io-error', err: e?.message ?? String(e) }
  }

  if (st.size !== 0) return { cleaned: false, reason: 'non-empty' }

  const ageMs = Date.now() - st.mtimeMs
  if (ageMs < thresholdMs) return { cleaned: false, reason: 'fresh', ageMs }

  const pids = detectActiveGitProcesses()
  if (pids === null) {
    return { cleaned: false, reason: 'io-error', err: 'ps aux failed' }
  }
  if (pids.length > 0) {
    return { cleaned: false, reason: 'active-process', pids }
  }

  try {
    unlinkSync(lockPath)
    return { cleaned: true, ageMs }
  } catch (e) {
    if (e && e.code === 'ENOENT') return { cleaned: false, reason: 'no-lock' }
    return { cleaned: false, reason: 'io-error', err: e?.message ?? String(e) }
  }
}

/**
 * Convenience one-liner for callers that just want a status to log + retry.
 * Same return shape as detectAndCleanStaleIndexLock (alias).
 */
export function ensureNoStaleIndexLock(repoRoot, opts = {}) {
  return detectAndCleanStaleIndexLock(repoRoot, opts)
}

/**
 * Returns array of pids running `git` per `ps aux`, or null on I/O error.
 *
 * Uses `[g]it` bracket trick to keep the grep itself from matching (no need to
 * filter self-pid downstream). Pure exec — no shell, no pipe.
 */
function detectActiveGitProcesses() {
  let psOut
  try {
    psOut = execFileSync('ps', ['aux'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
  const pids = []
  const lines = psOut.split('\n')
  for (const line of lines) {
    // ps aux output: USER PID %CPU %MEM ... COMMAND
    // Match `git` as a command word — either ` git ` (subcommand follows) or
    // ` git\n` (bare). Also matches `/git ` for absolute-pathed invocations
    // (Homebrew, system) but NOT `python-git`, `gitlab-runner`, etc.
    if (!/[ /]git(?:\s|$)/.test(line)) continue
    // Defensive: skip our own grep / self-detection process if any wrapper
    // re-introduces it. The `[ \/]git` regex already filters most spurious
    // matches but a literal " grep ... git" line would still match without
    // this guard.
    if (/\bgrep\b/.test(line)) continue
    const cols = line.trim().split(/\s+/)
    const pid = Number.parseInt(cols[1], 10)
    if (Number.isFinite(pid)) pids.push(pid)
  }
  return pids
}
