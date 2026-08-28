// 🔒 LOCKED — managed by clade · Source: vendor/scripts/_git-lock-detect.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/_git-lock-detect.ts
/**
 * _git-lock-detect.ts — stale `.git/index.lock` detection + auto-cleanup.
 *
 * Background (docs/tech-debt.md TD-145):
 *   Parallel sweep mid-flight 撞到 0-byte `.git/index.lock` 沒 active git process。
 *   手動 `rm` 解，但 SWEEP-V2-002 audit 漏掉。共用 helper 給 wt-helper / publish.ts
 *   入口 idempotent 預清，避免 stale lock 沿著流程往下傳。
 *
 * Stale criteria — ALL must hold:
 *   - File exists at `<repoRoot>/.git/index.lock`
 *   - Size = 0 bytes (real active git holds it open with PID line content)
 *   - mtime older than `thresholdMs` (default 60s — in-progress git ops finish
 *     within 60s on any healthy mac)
 *   - No active git process **for this repo** (no other session writing).
 *     判定看的是行程的 binary（`pgrep -x git`）＋ 它的 cwd / `--git-dir` 是否落在本 repo，
 *     NEVER 看 `ps aux` 的整行 command line 文字 —— 見 `detectActiveGitProcesses` 的註解。
 *
 * NEVER touches non-empty lock or fresh lock — those are the safety boundary
 * against accidentally clearing an active git op. Active-process pids reported
 * so caller can log clearly.
 *
 * Zero-dep: only node:fs + node:child_process. No npm packages.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync, statSync, unlinkSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

const DEFAULT_THRESHOLD_MS = 60_000

interface GitLockOptions {
  thresholdMs?: number
}

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
  return detectAndCleanStaleIndexLockAtPath(join(repoRoot, '.git', 'index.lock'), opts, repoRoot)
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
export function ensureNoStaleIndexLockForRepo(cwd, opts: GitLockOptions = {}) {
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
  let repoScope: string | undefined
  try {
    repoScope =
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || undefined
  } catch {
    repoScope = undefined
  }
  return detectAndCleanStaleIndexLockAtPath(lockPath, opts, repoScope)
}

function detectAndCleanStaleIndexLockAtPath(
  lockPath,
  opts: GitLockOptions = {},
  repoScope?: string,
) {
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

  const pids = detectActiveGitProcesses(repoScope)
  if (pids === null) {
    return { cleaned: false, reason: 'io-error', err: 'git process probe failed' }
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
 * Returns pids of processes whose **binary is git** and whose work is scoped to
 * `repoScope` (when that can be determined), or null on probe failure.
 *
 * TD-771 —— 這裡量的必須是「有沒有 git 行程在動這個 repo」本身，NEVER 量它的代理。
 * 舊實作對 `ps aux` 的**整行 command line 文字**比對 `/[ \/]git(\s|$)/`，於是：
 *
 *   1. Claude Code 的每一次 Bash tool 呼叫都是一個 `zsh -c … eval '<指令>'`，指令裡只要
 *      出現 `git`，那個 shell 就命中 —— **包含那次 git 早就跑完的 shell**，只要它還沒退出。
 *      2026-08-28 實測：命中的兩個 pid 都是 zsh，`pgrep -x git` 同時回空。
 *   2. `ps aux` 是整台機器的範圍，別的 repo 有真的 git 在跑一樣擋住這裡。
 *
 * 兩者疊起來讓 `reason: 'active-process'` 在一台常態有 6+ 個 agent session 的機器上幾乎
 * 恆真，於是 propagate 對某個 consumer 可以無限期 `failed`，而輸出看起來像「有人正在動
 * 那棵樹」（v1.11.94 對 nuxt-supabase-starter 連兩趟）。
 *
 * NEVER 改成放寬 `thresholdMs` 或拿掉這條判準：前者只延後同一個假陽性，後者把永久卡住
 * 換成資料損毀風險。要修的是它量錯了對象。
 *
 * 判不出範圍時（拿不到 `/proc`、`repoScope` 未給）保守保留該 pid —— 寧可多等，不誤刪。
 */
export function detectActiveGitProcesses(repoScope?: string): number[] | null {
  let out: string
  try {
    out = execFileSync('pgrep', ['-x', 'git'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (e) {
    // pgrep exits 1 when nothing matches — that is "no git running", not an error.
    if (e && typeof e === 'object' && 'status' in e && (e as { status?: number }).status === 1) {
      return []
    }
    return null
  }

  const pids = out
    .split('\n')
    .map((l) => Number.parseInt(l.trim(), 10))
    .filter((n) => Number.isFinite(n))

  if (!repoScope) return pids
  let scope: string
  try {
    scope = realpathSync(repoScope)
  } catch {
    scope = repoScope
  }
  return pids.filter((pid) => gitProcessTouchesRepo(pid, scope))
}

/** `p` 是不是 `root` 本身或它底下。純字串比對，兩端都已 realpath 過。 */
export function withinRepo(p: string, root: string): boolean {
  return p === root || p.startsWith(root.endsWith('/') ? root : `${root}/`)
}

/**
 * 這個 git 行程動的是不是 `scope` 這個 repo。判不出來一律回 true（保守保留）。
 *
 * Linux 走 `/proc/<pid>/cwd` ＋ `/proc/<pid>/cmdline` 的 `--git-dir` / `-C`；
 * 其他平台拿不到 `/proc`，退化成「保留」—— 此時 binary 已被 `pgrep -x git` 收斂過，
 * 假陽性只剩「別的 repo 真的有 git 在跑」，遠小於舊實作的整行文字比對。
 */
function gitProcessTouchesRepo(pid: number, scope: string): boolean {
  let cwd: string | null = null
  try {
    cwd = realpathSync(`/proc/${pid}/cwd`)
  } catch {
    cwd = null
  }

  let argv: string[] = []
  try {
    argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
  } catch {
    argv = []
  }

  // 行程已消失，或這台沒有 /proc —— 兩者都判不出範圍。
  if (cwd === null && argv.length === 0) return true

  for (const [i, a] of argv.entries()) {
    const explicit = a.startsWith('--git-dir=')
      ? a.slice('--git-dir='.length)
      : a === '--git-dir' || a === '-C'
        ? argv[i + 1]
        : null
    if (!explicit) continue
    let resolved = explicit
    try {
      resolved = realpathSync(isAbsolute(explicit) ? explicit : join(cwd ?? '.', explicit))
    } catch {
      /* 路徑已不存在 —— 用原字串比對 */
    }
    if (withinRepo(resolved, scope)) return true
  }

  return cwd !== null ? withinRepo(cwd, scope) : true
}
