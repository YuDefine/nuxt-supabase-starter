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
 * **NEVER 回寫 verdict**：verdict 是 derived 值，落成 store 就是 drift 的起點
 * （同 `flow/serve.ts` 的鐵律）。
 *
 * 寫入面只有兩個，兩個都記錄**已經發生的寫入**、都不記錄任何人的宣告：
 *
 *   1. 上面那支 hook（`attribution: hook | mtime-diff`）
 *   2. `appendScriptWrite`（`attribution: script`）—— clade 自己 spawn 出去的 node script
 *      寫 tracked 檔時自報一筆。**這不是宣告型欄位**：它記的是「這個 process 剛才寫了這個檔」，
 *      而不是「我打算持有這個檔」，且 `session_id` NEVER 冒充 harness session（見該函式）。
 *
 * 沒有第三個。**NEVER** 讓 model 直接 append —— hook 那條的全部價值就在於 model 動不了它。
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { isRecord } from './lib/json-unknown.ts'

export const JOURNAL_PATH = '.clade/ownership/journal.jsonl'

/**
 * How a journal line came to name the path it names.
 *
 * `hook` — the harness told us the file (Edit/Write/NotebookEdit). Strongest.
 * `mtime-diff` — a Bash write, attributed by the pre/post mtime window; a concurrent write
 *   inside that window can land on the wrong session.
 * `script` — a clade script that writes tracked files from its own process, outside any Claude
 *   tool, and records the write itself (see `appendScriptWrite`). Its writer is gone by the time
 *   anyone reads the line, and that is not a stall: there was never a holder to wait for.
 */
export type Attribution = 'hook' | 'mtime-diff' | 'script'

const ATTRIBUTIONS: ReadonlySet<string> = new Set<Attribution>(['hook', 'mtime-diff', 'script'])

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
  /**
   * How the path was attributed. `hook` = the harness named the file (Edit/Write/NotebookEdit).
   * `mtime-diff` = a Bash write, attributed by the pre/post mtime window, which can misattribute
   * a concurrent write inside that window. Entries predating the field read as `hook`.
   */
  attribution: Attribution
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
          // Unknown values normalise to `hook` for back-compat with lines written before the
          // field existed. NEVER widen this to "anything truthy": a value this reader does not
          // understand must degrade to the label consumers already handle, not invent a new one.
          attribution:
            typeof parsed.attribution === 'string' && ATTRIBUTIONS.has(parsed.attribution)
              ? (parsed.attribution as Attribution)
              : 'hook',
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

/**
 * The second, independent liveness signal: which Claude sessions Herdr still lists.
 *
 * `isWriterAlive` above reads the kernel. That is one signal, and one signal is not enough to
 * declare a writer dead — `rules/core/session-claims.md` § 3.1 requires two independent ones,
 * because the direction of a wrong "dead" verdict is the direction that sweeps live WIP.
 *
 * The identity compared here is exact: Herdr reports `agent_session.value`, which is the same
 * `session_id` the hook copies out of the harness's hook input. NEVER substitute pane geometry
 * or terminal title for it — a pane is inherited by whoever takes the tab next, which is one of
 * the four unreliable signals TD-664 exists to stop relying on.
 *
 * Returns `null` — not an empty set — whenever the signal cannot be taken at all (outside Herdr,
 * `herdr` missing, transport error). `null` means "unknown", and an unknown signal can never be
 * half of a death sentence.
 */
let liveSessionCache: Set<string> | null | undefined

export function liveSessionIds({ herdrBin = 'herdr' } = {}): Set<string> | null {
  // Memoized for the whole process: one publish gate asks about hundreds of paths, and each
  // probe is a subprocess. A session that dies mid-gate reading as alive is the safe direction.
  if (liveSessionCache !== undefined) return liveSessionCache
  if (process.env.HERDR_ENV !== '1') {
    liveSessionCache = null
    return liveSessionCache
  }
  try {
    const res = spawnSync(herdrBin, ['agent', 'list'], {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    if ((res.status ?? 1) !== 0) {
      liveSessionCache = null
      return liveSessionCache
    }
    const parsed: unknown = JSON.parse((res.stdout ?? '').trim())
    const agents = isRecord(parsed) && isRecord(parsed.result) ? parsed.result.agents : null
    if (!Array.isArray(agents)) {
      liveSessionCache = null
      return liveSessionCache
    }
    const out = new Set<string>()
    for (const agent of agents) {
      if (!isRecord(agent)) continue
      const session = agent.agent_session
      if (isRecord(session) && typeof session.value === 'string') out.add(session.value)
    }
    liveSessionCache = out
    return liveSessionCache
  } catch {
    liveSessionCache = null
    return liveSessionCache
  }
}

/** Test seam only — the cache is per-process by design; production code MUST NOT call this. */
export function resetLiveSessionCache(): void {
  liveSessionCache = undefined
}

export type LivenessVerdict = 'alive' | 'dead' | 'unknown'

export interface WriterLiveness {
  verdict: LivenessVerdict
  /** `true` alive, `false` gone, `null` the signal could not be taken. */
  signals: { process: boolean | null; session: boolean | null }
  why: string
}

/**
 * Two-signal liveness for a journal entry's writer.
 *
 * `dead` requires BOTH signals to say gone. Either one saying alive wins, and anything else is
 * `unknown`. The asymmetry is deliberate and is the whole point: the provenance hook is
 * fail-open, so evidence going missing is indistinguishable from "the hook broke", and reading
 * that as "everyone died" is what lets a gate sweep another session's WIP.
 *
 * `sessions` is the Herdr signal: pass a Set to inject it, `null` to declare it unavailable, or
 * omit it to probe. Callers that ask about many paths SHOULD hoist one probe and inject it.
 */
export function writerLiveness(
  entry: JournalEntry,
  { sessions }: { sessions?: Set<string> | null } = {},
): WriterLiveness {
  let proc: boolean | null
  try {
    proc = isWriterAlive(entry)
  } catch {
    proc = null
  }
  const live = sessions === undefined ? liveSessionIds() : sessions
  const session = live === null ? null : live.has(entry.session_id)
  const signals = { process: proc, session }
  if (proc === true || session === true) {
    return {
      verdict: 'alive',
      signals,
      why: proc === true ? 'writer pid still matches' : 'session still listed by herdr',
    }
  }
  if (proc === false && session === false) {
    return {
      verdict: 'dead',
      signals,
      why: 'writer process is gone and herdr no longer lists the session',
    }
  }
  return {
    verdict: 'unknown',
    signals,
    why:
      proc === false
        ? 'writer process is gone but the session signal is unavailable (not in Herdr / herdr unreachable) — one signal is never enough to declare a writer dead'
        : 'writer liveness not verifiable (no pid / no /proc)',
  }
}

/**
 * 一筆 journal 條目與檔案現況的落差容忍。
 *
 * 合法路徑上 `ts` **必定不早於** mtime：hook 在 tool 跑完之後才 append，`appendScriptWrite`
 * 在 `writeFileSync` 之後才呼叫。所以 mtime 跑到 `ts` 前面只有一個成因——那之後有一次
 * **沒有被登記的寫入**。留 60 秒是給秒級截斷與時鐘抖動，NEVER 拿它當「小改動不算」的門檻。
 */
export const UNRECORDED_WRITE_SLACK_MS = 60_000

export interface UnrecordedWrite {
  /** 檔案在磁碟上的 mtime（ISO）。 */
  mtime: string
  /** mtime 比 journal 的 `ts` 晚多少毫秒。 */
  ahead_ms: number
}

/**
 * 「這筆 journal 條目描述的還是這個檔現在的內容嗎？」
 *
 * ## 這條在防什麼（TD-955）
 *
 * `dead-holder` 的定義是「寫入者已經不在」，而它的量測是**年齡**。年齡是持有者狀態的**代理**，
 * 不是持有者狀態本身：journal 只看得到經 Claude tool 的寫入，所以 spawn 出去的 node script
 * （`rescaffold-playground.ts`、`inspect-new-project-round.ts`…）改了檔之後，`lastWriterByPath`
 * 退回的是**兩天前**那筆還存在的條目。代理失準時判定器給的不是「不知道」，是一個看起來完全
 * 正常的錯誤裁決——2026-09-06 實測：判定說 52.4h、`stat` 說 40 分鐘，而 action 是一條可以
 * 直接貼上的 `git commit --only --`。
 *
 * 回 `null` 代表「比不出來」（檔不存在、stat 失敗、`ts` 解析不出來），**NEVER** 代表「沒問題」——
 * 呼叫端拿到 `null` 要維持原本的判定，不是升級成更有信心的那一個。
 */
export function unrecordedWriteSince(
  entry: JournalEntry,
  absPath: string,
  { slackMs = UNRECORDED_WRITE_SLACK_MS }: { slackMs?: number } = {},
): UnrecordedWrite | null {
  const recordedAt = Date.parse(entry.ts)
  if (!Number.isFinite(recordedAt)) return null
  let mtimeMs: number
  try {
    mtimeMs = statSync(absPath).mtimeMs
  } catch {
    return null
  }
  if (!Number.isFinite(mtimeMs)) return null
  const ahead = mtimeMs - recordedAt
  if (ahead <= slackMs) return null
  return { mtime: new Date(mtimeMs).toISOString(), ahead_ms: Math.round(ahead) }
}

function selfPidStart(): number | null {
  try {
    const stat = readFileSync('/proc/self/stat', 'utf8')
    const tail = stat.slice(stat.lastIndexOf(') ') + 2)
    const starttime = Number(tail.split(/\s+/)[19])
    return Number.isFinite(starttime) ? starttime : null
  } catch {
    return null
  }
}

/**
 * 讓一支 clade script 為自己剛寫的 tracked 檔留下 provenance（TD-955 方向 (a)）。
 *
 * ## 為什麼 script 要自己記
 *
 * PostToolUse hook 只看得到 Claude tool 的寫入。一支被 spawn 出去的 node script 直接
 * `writeFileSync` 到 main 的治理檔（`registry/consumers.json`）時，hook 完全沒有這一筆，
 * 於是 `flow who` 退回同路徑最後一筆**別人的**舊條目，並把它判成 orphan。
 *
 * ## 這一筆刻意判不出存活，那不是缺陷
 *
 * `pid` 一律寫 `null`：script 在任何人讀到這一行之前就已經結束了，而**沒有持有者可以等**。
 * 記真實 pid 會讓 `isWriterAlive` 回 `false`、`session_id` 又不在 herdr 名單上，兩個訊號
 * 同時缺席 ⇒ `dead` ⇒ `orphan` —— 正好是本條要消滅的那個裁決。寫 `null` 讓任何**還不認識**
 * `attribution: script` 的消費端也只能得到 `unknown`，那是安全的方向。
 *
 * `session_id` 是 `script:<tool>`，**NEVER** 冒充 harness 的 session id：這一欄的價值在於它
 * 對不上任何真實 session，讀的人因此知道要找的是「誰跑了這支 script」，不是「哪個 pane 還開著」。
 *
 * 失敗一律靜默（同 hook 的 fail-open）：provenance 記不成不該讓正在跑的工作失敗。
 */
export function appendScriptWrite({
  tree,
  paths,
  tool,
  now = new Date(),
}: {
  tree: string
  paths: string[]
  tool: string
  now?: Date
}): void {
  if (paths.length === 0) return
  const ts = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const pidStart = selfPidStart()
  // 一次呼叫可以橫跨多棵樹，所以先按「這個檔屬於哪個 journal」分組再各寫一次。
  const byJournal = new Map<string, { treeRoot: string; rels: string[] }>()
  for (const p of paths) {
    // 歸屬跟著**被寫的檔**走，NEVER 跟著呼叫端的 cwd 走。同 hook 的 target-repo 分支：
    // 從 worktree 跑的 script 寫 main 的檔時，`tree` 是 worktree、檔在 main，用 `tree` 去算
    // 相對路徑會得到 `../…` 而**整筆被丟掉** —— 靜默漏記，而漏記的正是最需要記的那一種
    // （跨樹寫入）。2026-09-06 實測：這個版本的第一版就這樣漏了 acceptance 用的探針。
    const abs = resolve(tree, p)
    // 從檔案往上找第一個**存在**的目錄再問 git：呼叫端通常剛寫完檔（目錄一定在），
    // 但目錄不存在時 `git -C` 會直接失敗，那會把「這個檔屬於哪棵樹」誤讀成「不在任何樹裡」。
    let probe = dirname(abs)
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
    const home = repoOf(probe)
    if (!home) continue
    const rel = relative(home.treeRoot, abs)
    if (rel.length === 0 || rel.startsWith('..')) continue
    const journalDir = join(home.consumerRoot, '.clade', 'ownership')
    const bucket = byJournal.get(journalDir)
    if (bucket) bucket.rels.push(rel)
    else byJournal.set(journalDir, { treeRoot: home.treeRoot, rels: [rel] })
  }
  for (const [journalDir, { treeRoot, rels }] of byJournal) {
    let out = ''
    for (const rel of rels) {
      out += `${JSON.stringify({
        ts,
        path: rel,
        worktree: treeRoot,
        session_id: `script:${tool}`,
        pane_id: process.env.HERDR_PANE_ID ?? null,
        cwd: process.cwd(),
        tool,
        // 刻意 null —— 見函式 doc「這一筆刻意判不出存活」。NEVER 改成 process.pid。
        pid: null,
        pid_start: pidStart,
        attribution: 'script',
      })}\n`
    }
    try {
      mkdirSync(journalDir, { recursive: true })
      // 單行 append，O_APPEND 對 PIPE_BUF 以內的寫入是原子的 —— 與 hook 併發 append 不會互相截斷。
      appendFileSync(join(journalDir, 'journal.jsonl'), out)
    } catch {
      // fail-open：provenance 是旁路，NEVER 讓它把呼叫端弄失敗。
    }
  }
}

/**
 * 一個目錄屬於哪棵樹、以及那棵樹的 journal 住在哪。
 *
 * 兩個 root 用途不同，NEVER 混用：`consumerRoot` 是 git-common-dir 的 parent（main worktree），
 * journal 檔本身住這裡——一個 consumer 一份，所有 worktree 共寫；`treeRoot` 是寫入實際發生的
 * 那棵樹，`path` 欄相對它。同 hook 的同段註解。
 */
function repoOf(dir: string): { treeRoot: string; consumerRoot: string } | null {
  try {
    const treeRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const commonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    if (!treeRoot || !commonDir) return null
    return { treeRoot, consumerRoot: dirname(commonDir) }
  } catch {
    return null
  }
}
