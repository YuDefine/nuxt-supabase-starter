// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/pane-cache-ttl.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/pane-cache-ttl.ts
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { MACHINE_LABEL_PATTERN, peerMachineLabels, sshRun } from './herdr-machine.ts'
import {
  claudeConfigDirName,
  claudePoolAccounts,
  resolveClaudeLauncher,
} from './claude-account-registry.ts'

/** Shared prompt-cache boundary for census, continuation, and coordinator wake. */
export const DEFAULT_TTL_MINUTES = 60
export const CONTINUATION_CACHE_TTL_MS = DEFAULT_TTL_MINUTES * 60_000

/**
 * Claude Code folds every character outside `[A-Za-z0-9-]` to `-` in project directories.
 * The fallback scan below is still required: this encoding is only a fast-path guess.
 */
function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9-]/g, '-')
}

/**
 * `cc`（池入口）啟動的 child transcript 落在池內任一帳號的 config dir，但只收一個 dir
 * 字串的呼叫端（舊 helper 的 model 驗證、successor 首輪等待）無法表達「搜全池」。
 * 池入口的 transcript dir 用這個虛擬 basename 表示：它永不指向真實目錄（NEVER 拿來
 * 當可寫路徑），`transcriptPathIn` 認得它並對每個池帳號的 configDir 展開搜尋。
 */
const CLAUDE_POOL_TRANSCRIPT_DIR = '.claude-pool-transcripts'

function poolTranscriptSentinel(): string {
  return resolve(homedir(), CLAUDE_POOL_TRANSCRIPT_DIR)
}

/** Locate a transcript by live session UUID, even when the cwd encoding differs. */
export function transcriptPathIn(
  configDir: string,
  cwd: string,
  sessionId: string,
): string | undefined {
  if (configDir === poolTranscriptSentinel()) {
    for (const account of claudePoolAccounts()) {
      const path = transcriptPathIn(resolve(homedir(), account.configDir), cwd, sessionId)
      if (path) return path
    }
    return undefined
  }
  const projects = resolve(configDir, 'projects')
  const file = `${sessionId}.jsonl`
  const direct = resolve(projects, encodeProjectDir(cwd), file)
  if (existsSync(direct)) return direct
  let dirs: string[]
  try {
    dirs = readdirSync(projects)
  } catch {
    return undefined
  }
  for (const dir of dirs) {
    const candidate = resolve(projects, dir, file)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Child transcript account, independent of the dispatcher's CLAUDE_CONFIG_DIR.
 * 池入口 `cc` 回傳 sentinel（見 CLAUDE_POOL_TRANSCRIPT_DIR）——transcript 在哪個帳號的
 * dir 取決於 admission 實挑結果，只能搜全池；釘選 launcher 回各自帳號的真實 dir。
 */
export function childTranscriptConfigDir(launcher: string): string {
  if (resolveClaudeLauncher(launcher)?.kind === 'pool') return poolTranscriptSentinel()
  return resolve(homedir(), claudeConfigDirName(launcher))
}

/**
 * `cc`（池入口）啟動的 child 實際落在池內任一帳號的 config dir——record 只有 `cc`，
 * transcript 要按池內每個 dir 找；釘選 launcher 只搜自己那個 dir。
 */
function transcriptSearchDirs(launcher: string): string[] {
  const resolved = resolveClaudeLauncher(launcher)
  return resolved?.kind === 'pin'
    ? [resolved.account.configDir]
    : claudePoolAccounts().map((account) => account.configDir)
}

export function transcriptPathFor(
  launcher: string,
  cwd: string,
  sessionId: string,
): string | undefined {
  const home = homedir()
  for (const dir of transcriptSearchDirs(launcher)) {
    const path = transcriptPathIn(resolve(home, dir), cwd, sessionId)
    if (path) return path
  }
  return undefined
}

export interface CacheTouchRecord {
  launcher?: string
  cwd: string
  claude_session_id?: string
  completion_result_path?: string
}

/**
 * Last cache touch is the transcript mtime, raised to the later completion result mtime locally.
 * The transcript is required: an unreadable or absent transcript is unaged, never cold. For a
 * peer, the completion result is a relayed local copy, so only the peer transcript counts.
 */
export function lastCacheTouchMs(
  record: CacheTouchRecord,
  machine: string | undefined,
): number | undefined {
  const sessionId = record.claude_session_id
  if (!record.launcher || !sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return undefined
  if (machine && (!MACHINE_LABEL_PATTERN.test(machine) || !peerMachineLabels().includes(machine)))
    return undefined
  let transcriptMs: number | undefined
  if (!machine) {
    const path = transcriptPathFor(record.launcher, record.cwd, sessionId)
    try {
      if (path) transcriptMs = statSync(path).mtimeMs
    } catch {
      // Unreadable transcript: no age.
    }
  } else {
    const dirs = transcriptSearchDirs(record.launcher)
      .map((dir) => `"$HOME/${dir}"`)
      .join(' ')
    // Compare peer mtime with its own clock, then re-anchor to ours to avoid cross-node drift.
    const probe = sshRun(
      machine,
      `f=$(ls ${dirs}/projects/*/${sessionId}.jsonl 2>/dev/null | head -1); [ -n "$f" ] && m=$({ stat -c %Y "$f" 2>/dev/null || stat -f %m "$f"; }) && echo "$m $(date +%s)"`,
      { timeout: 15_000 },
    )
    const [mtime, peerNow] = probe.stdout.trim().split(/\s+/).map(Number)
    if (probe.status === 0 && mtime > 0 && peerNow >= mtime)
      transcriptMs = Date.now() - (peerNow - mtime) * 1000
  }
  if (transcriptMs === undefined) return undefined
  if (machine) return transcriptMs
  let completionMs = 0
  try {
    if (record.completion_result_path)
      completionMs = statSync(record.completion_result_path).mtimeMs
  } catch {
    // No result yet (continuing after an unstructured block).
  }
  return Math.max(transcriptMs, completionMs)
}
