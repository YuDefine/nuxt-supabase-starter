// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/pane-cache-ttl.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/pane-cache-ttl.ts
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
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

/** 讀檔尾上限：最後一筆 user／assistant 紀錄通常在尾端數 KB 內，找不到就退回 mtime。 */
export const CONVERSATION_TAIL_BYTES = 256 * 1024

/**
 * Claude Code 的「Compacted while idle」、summary、system 類紀錄會改寫 transcript 而刷新 mtime，
 * 但沒有任何人說話，prompt cache 也沒被碰：閒置要以最後一筆**對話**紀錄（user／assistant，
 * 不含 compact summary／meta／sidechain）的 timestamp 為準。
 */
export function lastConversationTimestampMs(lines: Iterable<string>): number | undefined {
  const all = Array.isArray(lines) ? lines : [...lines]
  for (let i = all.length - 1; i >= 0; i--) {
    const line = all[i]
    if (!line.includes('"user"') && !line.includes('"assistant"')) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof entry !== 'object' || entry === null) continue
    const rec = entry as Record<string, unknown>
    if (rec.type !== 'user' && rec.type !== 'assistant') continue
    if (rec.isSidechain === true || rec.isMeta === true) continue
    if (rec.isCompactSummary === true || rec.isVisibleInTranscriptOnly === true) continue
    if (typeof rec.timestamp !== 'string') continue
    const ms = Date.parse(rec.timestamp)
    if (Number.isFinite(ms)) return ms
  }
  return undefined
}

/** 讀檔尾 `bytes`（第一行可能被切半，丟掉）；空檔回空陣列。 */
export function readFileTailLines(path: string, bytes = CONVERSATION_TAIL_BYTES): string[] {
  const size = statSync(path).size
  const start = Math.max(0, size - bytes)
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    const lines = buffer.toString('utf8').split('\n')
    if (start > 0) lines.shift()
    return lines.filter((line) => line.trim().length > 0)
  } finally {
    closeSync(fd)
  }
}

export interface TranscriptTouch {
  ms: number
  /** `conversation`：最後 user／assistant 紀錄時戳；`mtime-fallback`：尾端解析不出而退回檔案 mtime。 */
  source: 'conversation' | 'mtime-fallback'
}

/** 本機 transcript 的最後 touch；檔案讀不到回 undefined（未老化，NEVER 當冷）。 */
export function localTranscriptTouch(path: string): TranscriptTouch | undefined {
  let mtimeMs: number
  try {
    mtimeMs = statSync(path).mtimeMs
  } catch {
    return undefined
  }
  try {
    const ms = lastConversationTimestampMs(readFileTailLines(path))
    if (ms !== undefined) return { ms: Math.min(ms, mtimeMs), source: 'conversation' }
  } catch {
    // Unreadable tail: fall back to mtime below.
  }
  return { ms: mtimeMs, source: 'mtime-fallback' }
}

/**
 * Last cache touch is the transcript's last user/assistant record time (mtime fallback, marked),
 * raised to the later completion result mtime locally. The transcript is required: an unreadable
 * or absent transcript is unaged, never cold. For a peer, the completion result is a relayed
 * local copy, so only the peer transcript counts.
 */
export function lastCacheTouch(
  record: CacheTouchRecord,
  machine: string | undefined,
): TranscriptTouch | undefined {
  const sessionId = record.claude_session_id
  if (!record.launcher || !sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return undefined
  if (machine && (!MACHINE_LABEL_PATTERN.test(machine) || !peerMachineLabels().includes(machine)))
    return undefined
  let touch: TranscriptTouch | undefined
  if (!machine) {
    const path = transcriptPathFor(record.launcher, record.cwd, sessionId)
    if (path) touch = localTranscriptTouch(path)
  } else {
    const dirs = transcriptSearchDirs(record.launcher)
      .map((dir) => `"$HOME/${dir}"`)
      .join(' ')
    // Line 1 is "<peer mtime> <peer now>"; the rest is the last few user/assistant lines of the
    // transcript tail (compact summaries filtered out). Ages are measured against the peer's own
    // clock, then re-anchored to ours to avoid cross-node drift.
    const probe = sshRun(
      machine,
      `f=$(ls ${dirs}/projects/*/${sessionId}.jsonl 2>/dev/null | head -1); [ -n "$f" ] && m=$({ stat -c %Y "$f" 2>/dev/null || stat -f %m "$f"; }) && echo "$m $(date +%s)" && { tail -c ${CONVERSATION_TAIL_BYTES} "$f" | grep -aE '"type":"(user|assistant)"' | grep -avF '"isCompactSummary":true' | tail -n 8; true; }`,
      { timeout: 15_000 },
    )
    const [head, ...rest] = probe.stdout.split('\n')
    const [mtime, peerNow] = head.trim().split(/\s+/).map(Number)
    if (probe.status === 0 && mtime > 0 && peerNow >= mtime) {
      const convMs = lastConversationTimestampMs(rest)
      const peerNowMs = peerNow * 1000
      touch =
        convMs !== undefined
          ? {
              ms: Date.now() - Math.max(0, peerNowMs - Math.min(convMs, mtime * 1000)),
              source: 'conversation',
            }
          : { ms: Date.now() - (peerNow - mtime) * 1000, source: 'mtime-fallback' }
    }
  }
  if (touch === undefined) return undefined
  if (machine) return touch
  let completionMs = 0
  try {
    if (record.completion_result_path)
      completionMs = statSync(record.completion_result_path).mtimeMs
  } catch {
    // No result yet (continuing after an unstructured block).
  }
  return completionMs > touch.ms ? { ...touch, ms: completionMs } : touch
}

export function lastCacheTouchMs(
  record: CacheTouchRecord,
  machine: string | undefined,
): number | undefined {
  return lastCacheTouch(record, machine)?.ms
}
