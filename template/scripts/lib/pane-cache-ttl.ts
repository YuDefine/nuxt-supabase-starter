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

/** 搜池內每個帳號的 config dir 找 session 的 transcript，連同它所在帳號的釘選指令；找不到回 undefined。 */
export function poolTranscriptOf(
  cwd: string,
  sessionId: string,
): { path: string; account: string } | undefined {
  for (const account of claudePoolAccounts()) {
    const path = transcriptPathIn(resolve(homedir(), account.configDir), cwd, sessionId)
    if (path) return { path, account: account.command }
  }
  return undefined
}

/** Locate a transcript by live session UUID, even when the cwd encoding differs. */
export function transcriptPathIn(
  configDir: string,
  cwd: string,
  sessionId: string,
): string | undefined {
  if (configDir === poolTranscriptSentinel()) return poolTranscriptOf(cwd, sessionId)?.path
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

/** harness 旁觀者（side agent）塞進 session 的提醒：不是 Charles、也不是 session 自己的工作。 */
const SIDE_AGENT_NOTE_RE = /^\s*Here is a note offered by a side agent:/

function userPromptText(rec: Record<string, unknown>): string | null {
  const message = rec.message
  if (typeof message !== 'object' || message === null) return null
  const content = (message as Record<string, unknown>).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  // tool_result 是工作中途，不是新的一則提示
  if (content.some((b) => typeof b === 'object' && b !== null && b.type === 'tool_result'))
    return null
  const text = content.find((b) => typeof b === 'object' && b !== null && b.type === 'text')
  return text && typeof text.text === 'string' ? text.text : ''
}

/**
 * side agent 提醒回合的行號（提醒本身＋session 對它的回應，直到下一則真的提示）。這一輪會刷新
 * prompt cache，但不是對話進度：算成活動的話，冷 pane 在 TTL 過後被一則提醒拉回暖，回應還會蓋掉
 * 原本「Q2–Q7 等你回」的最後一句。census 的閒置與最後一句 MUST 跳過這些行；prompt cache 的
 * touch（lastCacheTouch 系列）不跳，因為這一輪真的碰過 cache。
 */
export function sideAgentExchangeLines(lines: readonly string[]): Set<number> {
  const skip = new Set<number>()
  let inside = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.includes('"user"') && !line.includes('"assistant"')) continue
    let rec: unknown
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof rec !== 'object' || rec === null) continue
    const entry = rec as Record<string, unknown>
    if (entry.type !== 'user' && entry.type !== 'assistant') continue
    if (entry.isSidechain === true) continue
    if (entry.type === 'user' && entry.isMeta !== true && entry.isCompactSummary !== true) {
      const prompt = userPromptText(entry)
      if (prompt !== null) inside = SIDE_AGENT_NOTE_RE.test(prompt)
    }
    if (inside) skip.add(i)
  }
  return skip
}

/**
 * 視窗內有沒有看到任何一則真的提示（user 文字，非 tool_result／meta／compact summary）。沒有的話
 * 視窗被一整輪工具呼叫填滿，提醒本身已捲出去，sideAgentExchangeLines 無從判斷。
 */
export function windowHasPromptBoundary(lines: readonly string[]): boolean {
  for (const line of lines) {
    if (!line.includes('"user"')) continue
    let rec: unknown
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof rec !== 'object' || rec === null) continue
    const entry = rec as Record<string, unknown>
    if (entry.type !== 'user' || entry.isSidechain === true) continue
    if (entry.isMeta === true || entry.isCompactSummary === true) continue
    if (userPromptText(entry) !== null) return true
  }
  return false
}

/**
 * Claude Code 的「Compacted while idle」、summary、system 類紀錄會改寫 transcript 而刷新 mtime，
 * 但沒有任何人說話，prompt cache 也沒被碰：閒置要以最後一筆**對話**紀錄（user／assistant，
 * 不含 compact summary／meta／sidechain）的 timestamp 為準。`skipSideAgent` 另跳過 side agent
 * 提醒回合（census 的對話活動用；prompt cache 的 touch 不傳，因為那一輪真的碰過 cache）。
 */
export function lastConversationTimestampMs(
  lines: Iterable<string>,
  options: { skipSideAgent?: boolean } = {},
): number | undefined {
  const all = Array.isArray(lines) ? lines : [...lines]
  const sideAgent = options.skipSideAgent ? sideAgentExchangeLines(all) : new Set<number>()
  for (let i = all.length - 1; i >= 0; i--) {
    if (sideAgent.has(i)) continue
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
