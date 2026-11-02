// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/mutation-probe/worktree-guard.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/mutation-probe/worktree-guard.ts
// CLADE:VENDOR-SCRIPT
//
// mutation-probe/worktree-guard — 工作樹保證（FR-003、SC-002）
//
// 契約：specs/truth/contracts/mutation-probe-cli.md § 1 工作樹保證：
//   執行前後各取一次 `git status --porcelain=v1 -z` 加上被突變檔的 blob sha；`--write-receipts` 新增的
//   收據檔從比對中扣除；不一致 → `worktree_unchanged=false`、exit 3。
//   超時、被 SIGINT／SIGTERM 中斷也一樣：先把整個行程群組殺掉，再比對。
//
// 與契約字面的一處差異：status 加 `--untracked-files=all`。預設的 `normal` 會把整個新目錄折成一列，
// 看不到目錄內新增的個別檔案，也就無法只扣除探針自己寫的收據檔。
//
// 行程群組：被追蹤的子行程 MUST 以 `detached: true` spawn（pgid = pid），本檔對 `-pid` 送訊號。
//
// 由 ~/clade vendor/scripts/lib/ 散播，請勿直接編輯 consumer 副本。

import { execFileSync } from 'node:child_process'

import { blobShaOfWorktreeFile } from './receipt.ts'

export interface WorktreeSnapshot {
  /** 正規化後的 status 列（`XY path`，rename／copy 為 `XY path <- origin`），已排序。 */
  entries: string[]
  /** 被突變檔 → blob sha（檔案不存在為 ''）。 */
  blobs: Record<string, string>
}

export interface GuardResult {
  unchanged: boolean
  /** 人讀差異：`+ <列>`（執行後新增）、`- <列>`（執行後消失）、`~ <檔> blob a → b`。 */
  changes: string[]
}

/** 解析 `git status --porcelain=v1 -z` 的輸出；回傳 { line, path }。 */
export function parseStatusZ(raw: string): { line: string; path: string }[] {
  const tokens = raw.split('\0')
  const out: { line: string; path: string }[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.length < 4) continue
    const xy = t.slice(0, 2)
    const path = t.slice(3)
    if (xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C') {
      const origin = tokens[++i] ?? ''
      out.push({ line: `${xy} ${path} <- ${origin}`, path })
    } else {
      out.push({ line: `${xy} ${path}`, path })
    }
  }
  return out
}

export function takeSnapshot(root: string, files: readonly string[]): WorktreeSnapshot {
  const raw = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
  const entries = parseStatusZ(raw)
    .map((e) => e.line)
    .toSorted()
  const blobs: Record<string, string> = {}
  for (const f of files) blobs[f] = blobShaOfWorktreeFile(root, f)
  return { entries, blobs }
}

/** 比對前後快照；`ignorePaths`（repo 相對）上的 status 列不算（探針自己寫的收據檔）。 */
export function diffSnapshots(
  before: WorktreeSnapshot,
  after: WorktreeSnapshot,
  ignorePaths: readonly string[] = [],
): GuardResult {
  const ignore = new Set(ignorePaths)
  const keep = (line: string) => {
    // 列格式 `XY path[ <- origin]`；取 path 部分判斷是否在扣除清單內
    const path = line.slice(3).split(' <- ')[0]
    return !ignore.has(path)
  }
  const b = before.entries.filter(keep)
  const a = after.entries.filter(keep)
  const bSet = new Set(b)
  const aSet = new Set(a)
  const changes: string[] = []
  for (const l of a) if (!bSet.has(l)) changes.push(`+ ${l}`)
  for (const l of b) if (!aSet.has(l)) changes.push(`- ${l}`)
  for (const f of Object.keys(before.blobs)) {
    if (before.blobs[f] !== after.blobs[f]) {
      changes.push(`~ ${f} blob ${before.blobs[f] || '(none)'} → ${after.blobs[f] || '(none)'}`)
    }
  }
  return { unchanged: changes.length === 0, changes }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (e) {
    // EPERM＝群組存在但不屬於我們；仍視為活著。
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export interface TerminateOptions {
  /** SIGTERM 後等多久才 SIGKILL；預設 5000（契約：逾時送 SIGTERM、5 秒後 SIGKILL）。 */
  graceMs?: number
  pollMs?: number
}

/** 整個行程群組先 SIGTERM，`graceMs` 後仍活著就 SIGKILL，等到群組消失才返回。pid 必須是 detached 子行程。 */
export async function terminateGroup(pid: number, opts: TerminateOptions = {}): Promise<void> {
  const graceMs = opts.graceMs ?? 5000
  const pollMs = opts.pollMs ?? 25
  if (!groupAlive(pid)) return
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return
  }
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    if (!groupAlive(pid)) return
    await sleep(pollMs)
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    return
  }
  const killDeadline = Date.now() + 2000
  while (groupAlive(pid) && Date.now() < killDeadline) await sleep(pollMs)
}

export interface InterruptInfo extends GuardResult {
  signal: NodeJS.Signals
}

export interface WorktreeGuardOptions {
  /** git repo 根（`git status` 的 cwd，status 路徑相對於它）。 */
  root: string
  /** 被突變的檔（repo 相對），取 blob sha 用。 */
  files: readonly string[]
  /** 比對時扣除的 repo 相對路徑（探針自己寫的收據檔）；每次比對時才呼叫。 */
  ignorePaths?: () => readonly string[]
  signals?: NodeJS.Signals[]
  graceMs?: number
  /** 收到訊號、群組已殺、已比對後呼叫。預設：還原性結束 `128+signo`，工作樹不一致時 exit 3。 */
  onInterrupt?: (info: InterruptInfo) => void
}

export interface WorktreeGuard {
  readonly before: WorktreeSnapshot
  /** 登記一個 detached 子行程（pgid=pid）；回傳取消登記函式。 */
  trackGroup(pid: number): () => void
  /** 取執行後快照並比對，移除訊號 handler。 */
  finish(): GuardResult
  /** 不比對、只移除訊號 handler（起不來時用）。 */
  dispose(): void
}

const SIGNO: Record<string, number> = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 }

/** 取執行前快照並安裝 SIGINT／SIGTERM handler。 */
export function beginWorktreeGuard(opts: WorktreeGuardOptions): WorktreeGuard {
  const before = takeSnapshot(opts.root, opts.files)
  const groups = new Set<number>()
  const signals = opts.signals ?? ['SIGINT', 'SIGTERM']
  let interrupting = false

  const compare = (): GuardResult =>
    diffSnapshots(before, takeSnapshot(opts.root, opts.files), opts.ignorePaths?.() ?? [])

  const onSignal = (signal: NodeJS.Signals) => {
    if (interrupting) return
    interrupting = true
    void (async () => {
      await Promise.all([...groups].map((pid) => terminateGroup(pid, { graceMs: opts.graceMs })))
      let result: GuardResult
      try {
        result = compare()
      } catch (e) {
        result = { unchanged: false, changes: [`無法比對工作樹：${(e as Error).message}`] }
      }
      remove()
      const info: InterruptInfo = { ...result, signal }
      if (opts.onInterrupt) opts.onInterrupt(info)
      else process.exit(result.unchanged ? 128 + (SIGNO[signal] ?? 0) : 3)
    })()
  }

  const handlers = new Map<NodeJS.Signals, () => void>()
  for (const s of signals) {
    const h = () => onSignal(s)
    handlers.set(s, h)
    process.on(s, h)
  }
  const remove = () => {
    for (const [s, h] of handlers) process.off(s, h)
    handlers.clear()
  }

  return {
    before,
    trackGroup(pid) {
      groups.add(pid)
      return () => groups.delete(pid)
    },
    finish() {
      remove()
      return compare()
    },
    dispose: remove,
  }
}
