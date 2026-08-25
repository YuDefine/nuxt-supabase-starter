#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/ownership-journal.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/ownership-journal.ts
/**
 * ownership-journal.ts — 逐檔所有權的**寫入時證據**（TD-664 Phase 1）
 *
 * `.clade/claims/` 是事前宣告模型，實測不被維護（`expected_paths` 全 `[]`），且只涵蓋
 * worktree、不涵蓋 main working tree —— 而 clade home 的單一共享 main 正是爭用發生的地方。
 * 於是「這個 dirty 檔屬於誰」只能靠反推，而每一條反推訊號都不可信（herdr pane 掃描對已
 * commit 完的工作零訊號、terminal title 繼承上一棒、`agent_status` 只反映 tab 有沒有被看過）。
 *
 * 這支讀的是 `plugins/hub-core/hooks/post-tool-ownership-journal.sh` append 的 jsonl：
 * 不問任何人宣告什麼，只讀 harness 實際執行了什麼。
 *
 * **READ-ONLY**：本模組只讀 journal，NEVER 回寫 verdict —— verdict 是 derived 值，
 * 落成 store 就是 drift 的起點（同 `flow/serve.ts` 的鐵律）。唯一的寫入面是那支 hook。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isRecord } from './lib/json-unknown.ts'

export const JOURNAL_PATH = '.clade/ownership/journal.jsonl'

export interface JournalEntry {
  ts: string
  /** Relative to `worktree`, NOT to the consumer root — they differ inside a linked worktree. */
  path: string
  /** Absolute toplevel of the tree the write happened in. Entries predating this field: `null`. */
  worktree: string | null
  session_id: string
  pane_id: string | null
  cwd: string
  tool: string
  pid: number | null
  pid_start: number | null
}

function isEntry(value: unknown): value is JournalEntry {
  return (
    isRecord(value) &&
    typeof value.ts === 'string' &&
    typeof value.path === 'string' &&
    typeof value.session_id === 'string'
  )
}

/**
 * Read the journal, newest-last. Malformed lines are skipped, never thrown on:
 * the journal is append-only from a shell hook under concurrent writers, so a
 * torn tail is an expected state and MUST NOT take down the gate reading it.
 */
export function readJournal(consumerRoot: string): JournalEntry[] {
  const file = join(consumerRoot, JOURNAL_PATH)
  if (!existsSync(file)) return []
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const out: JournalEntry[] = []
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (isEntry(parsed)) {
        out.push({
          ts: parsed.ts,
          path: parsed.path,
          worktree: typeof parsed.worktree === 'string' ? parsed.worktree : null,
          session_id: parsed.session_id,
          pane_id: typeof parsed.pane_id === 'string' ? parsed.pane_id : null,
          cwd: typeof parsed.cwd === 'string' ? parsed.cwd : '',
          tool: typeof parsed.tool === 'string' ? parsed.tool : 'unknown',
          pid: typeof parsed.pid === 'number' ? parsed.pid : null,
          pid_start: typeof parsed.pid_start === 'number' ? parsed.pid_start : null,
        })
      }
    } catch {
      // torn or partial line — skip
    }
  }
  return out
}

/**
 * Last writer per path. Later lines win; the journal is append-only in write order.
 *
 * `tree` scopes the answer to one working tree. One consumer keeps ONE journal shared by main
 * and every linked worktree, and `path` is relative to the tree it was written in — so
 * `vendor/scripts/foo.ts` names a different file in main than in a worktree. Passing the tree
 * the caller is actually asking about is what keeps those apart; omitting it merges them, which
 * is only correct when the caller genuinely has no tree in hand.
 *
 * Entries with `worktree: null` predate the field and cannot be placed, so they are kept under
 * every tree: dropping them would silently turn attributable paths into `unknown`, and `unknown`
 * is the bucket that nothing may be swept out of.
 */
export function lastWriterByPath(
  entries: JournalEntry[],
  { tree = null }: { tree?: string | null } = {},
): Map<string, JournalEntry> {
  const map = new Map<string, JournalEntry>()
  for (const e of entries) {
    if (tree !== null && e.worktree !== null && e.worktree !== tree) continue
    map.set(e.path, e)
  }
  return map
}

/**
 * Kernel-verifiable liveness for a journal entry's writer.
 *
 * `rules/core/session-claims.md` § 存活證據三層 requires this layer be verifiable by the
 * kernel, NOT by heartbeat: a missing heartbeat cannot be told apart from "the hook broke",
 * and the hook is fail-open by design.
 *
 * pid alone is not enough — **pids are reused**, so a fresh unrelated process on the same
 * number would read as "that session is still alive". The hook records `/proc/<pid>/stat`
 * field 22 (starttime) alongside; both MUST match.
 *
 * Returns `null` — deliberately not `false` — when the evidence cannot be evaluated
 * (no pid recorded, no `/proc`, unreadable stat). `null` means unknown, and callers MUST
 * classify unknown as `unknown`, never as dead: 判死 MUST 兩個獨立訊號同時缺席.
 */
export function isWriterAlive(entry: JournalEntry): boolean | null {
  if (entry.pid === null || entry.pid <= 1) return null
  const statPath = `/proc/${entry.pid}/stat`
  if (!existsSync('/proc/self/stat')) return null
  let stat: string
  try {
    stat = readFileSync(statPath, 'utf8')
  } catch {
    // /proc exists but this pid does not → the process is gone. That is real evidence.
    return false
  }
  if (entry.pid_start === null) return null
  const tail = stat.slice(stat.lastIndexOf(') ') + 2)
  const starttime = Number(tail.split(/\s+/)[19])
  if (!Number.isFinite(starttime)) return null
  return starttime === entry.pid_start
}

/** Fraction of `paths` that the journal can attribute at all — clade-health's coverage column. */
export function provenanceCoverage(consumerRoot: string, paths: string[], tree = consumerRoot) {
  const byPath = lastWriterByPath(readJournal(consumerRoot), { tree })
  const covered = paths.filter((p) => byPath.has(p))
  return {
    total: paths.length,
    covered: covered.length,
    ratio: paths.length === 0 ? 1 : covered.length / paths.length,
    uncovered: paths.filter((p) => !byPath.has(p)),
  }
}
