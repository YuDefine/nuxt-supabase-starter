// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/dev-runtime.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/dev-runtime.ts
/**
 * dev-runtime.ts — dev server 的 runtime 帳本（port 紀錄與 lease 合一本）與 `ss`＋`/proc` 對帳。
 *
 * 為什麼存在：port 配置（`~/.cache/clade/dev-port/`）只記「這棵樹分到幾號」，lease（`/tmp/*-verification-lease.json`）
 * 只記「誰持有」，兩份都不知道真正在聽的行程是誰、子行程有哪些、屬於哪個 session／pane。結果
 * `wt-helper cleanup` 只刪登記不停 server、session 結束後沒人回收、孤兒只能人眼發現。
 *
 * 帳本：`$XDG_CACHE_HOME/clade/dev-runtime/<consumer>/<basename>--<sha256(worktree)>.json`，key＝worktree。
 * 入口（`dev-session.ts` 起好 server、`wt-helper dev` 人類前景）寫入；停止／釋放與 reaper 刪除。
 * 配置（dev-port）仍是 port 號碼的 SoT，本帳本記「此刻跑著什麼」，兩者以 worktree 路徑相連（`devPortOffset` 欄）。
 *
 * 純函式（classify／parse）可注入 `ss` 文字與 proc 表，測試不碰真行程。
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

export const RUNTIME_SCHEMA = 1
/** HMR 預設 port；入口 MUST 另指定，不可共用（多個 vite 同聽 24678 會互搶）。 */
export const DEFAULT_HMR_PORT = 24678

export type RuntimePort = { port: number; role: 'main' | 'hmr' | 'child' }
export type RuntimeEntry = {
  schema: number
  consumer: string
  worktree: string
  ports: RuntimePort[]
  pid: number | null
  pgid: number | null
  cgroup: string | null
  startTicks: number | null
  cmd: string | null
  owner: {
    session: string | null
    sessionId: string | null
    paneId: string | null
    tabId: string | null
    kind: 'agent' | 'human' | 'unknown'
  }
  lease: { expiresAt: string | null; heartbeatAt: string | null } | null
  devPortOffset: number | null
  registeredAt: string
  lastSeenAt: string
  restart: string | null
  /** reaper 閒置停掉後留下登記（只停不刪）：audit 不把它當 dead-registered。 */
  stoppedAt?: string | null
  stoppedReason?: string | null
}

export type Listener = { port: number; pid: number | null; comm: string | null; addr: string }
export type ProcInfo = {
  pid: number
  ppid: number
  pgid: number
  startTicks: number
  cwd: string | null
  cgroup: string | null
  cmdline: string
}

export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CACHE_HOME || join(env.HOME || homedir(), '.cache'), 'clade')
}
export const runtimeDir = (env: NodeJS.ProcessEnv = process.env) =>
  join(cacheRoot(env), 'dev-runtime')

/** 帳本檔相對路徑。key＝worktree；同一棵樹可起多個 server（alias），所以再加 main port 區分。 */
export function entryKey(consumer: string, worktree: string, port: number | null = null): string {
  const wt = resolve(worktree)
  const hash = createHash('sha256').update(wt).digest('hex')
  return join(
    consumer.replace(/[^\w.-]/g, '_'),
    `${basename(wt)}--${hash}${port ? `--${port}` : ''}.json`,
  )
}

/** HMR port 由入口指定：main port + 10000（不共用 vite 預設 24678）。 */
export const hmrPortFor = (port: number) => port + 10000

/** consumer 自己宣告綁定的 env 檔（Nuxt／Vite 讀的 dotenv 序列）。 */
const BIND_ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local']
const BIND_DECL = /^\s*(?:export\s+)?(?:NUXT_)?HOST\s*=/m

/**
 * dev-session 是否該替 dev server 補 `HOST／NUXT_HOST=127.0.0.1`。預設補（不聽 *），
 * 但 consumer 已宣告綁定就不蓋：process env 有 HOST／NUXT_HOST、`CLADE_DEV_BIND_ALL=1`、
 * 命令列帶 `--host`／`-H`、cwd 的 dotenv 檔或 `package.json` 的 `scripts.dev` 宣告了 host。
 * 蓋掉會把靠 LAN／tailnet 綁定的 consumer 靜默改成 loopback。
 */
export function shouldForceLoopback(opts: {
  cwd: string
  cmd: string[]
  env?: NodeJS.ProcessEnv
}): boolean {
  const env = opts.env ?? process.env
  if (env.CLADE_DEV_BIND_ALL === '1' || env.HOST || env.NUXT_HOST) return false
  if (opts.cmd.some((a) => a === '--host' || a.startsWith('--host=') || a === '-H')) return false
  for (const f of BIND_ENV_FILES) {
    try {
      if (BIND_DECL.test(readFileSync(join(opts.cwd, f), 'utf8'))) return false
    } catch {}
  }
  try {
    const dev = JSON.parse(readFileSync(join(opts.cwd, 'package.json'), 'utf8'))?.scripts?.dev
    if (typeof dev === 'string' && /(^|\s)(--host\b|-H\b)/.test(dev)) return false
  } catch {}
  return true
}

// ── ss／proc ────────────────────────────────────────────────────────────────

/** 解析 `ss -ltnpH`。回傳每個 LISTEN socket（含沒有 pid 的）。 */
export function parseSs(text: string): Listener[] {
  const out: Listener[] = []
  for (const line of text.split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 4) continue
    const local = cols[3]!
    const m = /:(\d+)$/.exec(local)
    if (!m) continue
    const users = line.match(/\(\("([^"]*)",pid=(\d+)/)
    out.push({
      port: Number(m[1]),
      pid: users ? Number(users[2]) : null,
      comm: users ? users[1]! : null,
      addr: local,
    })
  }
  return out
}

/** `ss` 不存在或失敗時 throw：回 `[]` 會讓每筆帳本都被報成 dead-registered，掩蓋真正原因。 */
export function readListeners(run: typeof spawnSync = spawnSync): Listener[] {
  const r = run('ss', ['-ltnpH'], { encoding: 'utf8', timeout: 5000 })
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.message : `exit ${r.status}: ${String(r.stderr ?? '').trim()}`
    throw new Error(
      `無法讀取 listener（\`ss -ltnpH\` 失敗：${why}）；--runtime 只支援有 iproute2 的 Linux`,
    )
  }
  return parseSs(String(r.stdout))
}

/**
 * 帳本 pid 是否仍是登記當時那個行程：pid 存在且（有記 startTicks 時）startTicks 相同。
 * 單看 pid 會被回收的 pid 騙過去。
 */
export function entryPidAlive(
  e: Pick<RuntimeEntry, 'pid' | 'startTicks'>,
  procs: Map<number, ProcInfo>,
): boolean {
  if (e.pid === null || e.pid === undefined) return false
  const p = procs.get(e.pid)
  if (!p) return false
  return e.startTicks === null || e.startTicks === undefined || p.startTicks === e.startTicks
}

export function readProc(pid: number, procRoot = '/proc'): ProcInfo | null {
  try {
    const stat = readFileSync(`${procRoot}/${pid}/stat`, 'utf8')
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    // rest[0]=state, [1]=ppid, [2]=pgrp, [19]=starttime
    const cmdline = readFileSync(`${procRoot}/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim()
    let cwd: string | null = null
    try {
      cwd = readlinkSync(`${procRoot}/${pid}/cwd`)
    } catch {}
    let cgroup: string | null = null
    try {
      cgroup = readFileSync(`${procRoot}/${pid}/cgroup`, 'utf8')
        .trim()
        .split('\n')[0]!
        .replace(/^\d*::?/, '')
    } catch {}
    return {
      pid,
      ppid: Number(rest[1]),
      pgid: Number(rest[2]),
      startTicks: Number(rest[19]),
      cwd,
      cgroup,
      cmdline,
    }
  } catch {
    return null
  }
}

export function readProcTable(procRoot = '/proc'): Map<number, ProcInfo> {
  const table = new Map<number, ProcInfo>()
  let names: string[] = []
  try {
    names = readdirSync(procRoot)
  } catch {}
  for (const n of names) {
    if (!/^\d+$/.test(n)) continue
    const p = readProc(Number(n), procRoot)
    if (p) table.set(p.pid, p)
  }
  return table
}

export function descendantsOf(pid: number, table: Map<number, ProcInfo>): number[] {
  const kids = new Map<number, number[]>()
  for (const p of table.values()) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p.pid])
  const out: number[] = []
  const stack = [pid]
  while (stack.length) {
    const cur = stack.pop()!
    for (const k of kids.get(cur) ?? []) {
      if (k === pid || out.includes(k)) continue
      out.push(k)
      stack.push(k)
    }
  }
  return out
}

const DEV_BINS = new Set(['nuxt', 'nuxi', 'vite', 'wrangler', 'workerd', 'miniflare'])
/** 命令列看起來是 dev server（不是 MCP daemon、herdr、ssh 之類的常駐服務）。逐 token 比 basename，路徑裡的 `vite-plus` 不算。 */
export function isDevLike(cmdline: string): boolean {
  const toks = cmdline.split(/\s+/).filter(Boolean)
  return toks.some((t, i) => {
    if (/(^|\/)\.output\/server(\/|$)/.test(t)) return true
    const base = t.slice(t.lastIndexOf('/') + 1).replace(/\.(c|m)?js$/, '')
    if (DEV_BINS.has(base)) return true
    return base === 'next' && toks[i + 1] === 'dev'
  })
}
/** systemd 常駐服務（.service 且不是使用者 session／run scope）：排除在 runtime 對帳外。 */
export function isResidentService(p: ProcInfo): boolean {
  const cg = p.cgroup ?? ''
  const last = cg.slice(cg.lastIndexOf('/') + 1)
  return (
    last.endsWith('.service') && !/^(session-|run-|herdr)/.test(last) && !/app-herdr/.test(last)
  )
}

// ── 帳本 ────────────────────────────────────────────────────────────────────

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  renameSync(tmp, path)
}

export type RuntimeInput = {
  consumer: string
  worktree: string
  ports: RuntimePort[]
  pid?: number | null
  cmd?: string | null
  owner?: Partial<RuntimeEntry['owner']>
  lease?: RuntimeEntry['lease']
  devPortOffset?: number | null
  restart?: string | null
}

/** 登記（或更新）一棵樹的 runtime。pid 給了就補 pgid／cgroup／startTicks。 */
export function recordRuntime(
  input: RuntimeInput,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): RuntimeEntry {
  const mainPort = input.ports.find((p) => p.role === 'main')?.port ?? input.ports[0]?.port ?? null
  const path = join(runtimeDir(env), entryKey(input.consumer, input.worktree, mainPort))
  let prev: RuntimeEntry | null = null
  try {
    prev = JSON.parse(readFileSync(path, 'utf8'))
  } catch {}
  const proc = input.pid ? readProc(input.pid) : null
  const entry: RuntimeEntry = {
    schema: RUNTIME_SCHEMA,
    consumer: input.consumer,
    worktree: resolve(input.worktree),
    ports: input.ports,
    pid: input.pid ?? null,
    pgid: proc?.pgid ?? null,
    cgroup: proc?.cgroup ?? null,
    startTicks: proc?.startTicks ?? null,
    cmd: input.cmd ?? proc?.cmdline ?? prev?.cmd ?? null,
    owner: {
      session: input.owner?.session ?? null,
      sessionId: input.owner?.sessionId ?? null,
      paneId: input.owner?.paneId ?? null,
      tabId: input.owner?.tabId ?? null,
      kind: input.owner?.kind ?? 'unknown',
    },
    lease: input.lease ?? null,
    devPortOffset: input.devPortOffset ?? null,
    registeredAt: prev?.registeredAt ?? now.toISOString(),
    lastSeenAt: now.toISOString(),
    restart: input.restart ?? prev?.restart ?? null,
    stoppedAt: null,
    stoppedReason: null,
  }
  writeAtomic(path, entry)
  return entry
}

export function readEntries(
  env: NodeJS.ProcessEnv = process.env,
): Array<RuntimeEntry & { file: string }> {
  const root = runtimeDir(env)
  const out: Array<RuntimeEntry & { file: string }> = []
  let dirs: string[] = []
  try {
    dirs = readdirSync(root)
  } catch {
    return out
  }
  for (const d of dirs) {
    let files: string[] = []
    try {
      files = readdirSync(join(root, d))
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      try {
        const v = JSON.parse(readFileSync(join(root, d, f), 'utf8'))
        if (v && v.schema === RUNTIME_SCHEMA && Array.isArray(v.ports))
          out.push({ ...v, file: join(root, d, f) })
      } catch {}
    }
  }
  return out
}

export function removeRuntime(
  consumer: string,
  worktree: string,
  port: number | null = null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const path = join(runtimeDir(env), entryKey(consumer, worktree, port))
  if (!existsSync(path)) return false
  rmSync(path, { force: true })
  return true
}

/** 釋放 lease／停 session 時用：port 給了只刪該 server 的帳本，沒給刪該樹該 consumer 的全部。 */
export function removeRuntimeForWorktree(
  worktree: string,
  consumer: string,
  port: number | string | null = null,
  env: NodeJS.ProcessEnv = process.env,
): number {
  try {
    const wt = resolve(worktree)
    let n = 0
    for (const e of readEntries(env)) {
      if (e.worktree !== wt || e.consumer !== consumer) continue
      if (
        port !== null &&
        port !== undefined &&
        !e.ports.some((p) => p.role === 'main' && p.port === Number(port))
      )
        continue
      rmSync(e.file, { force: true })
      n++
    }
    return n
  } catch {
    return 0
  }
}

/** 該 worktree 的所有帳本（不知道 consumer 時用）。 */
export function entriesForWorktree(worktree: string, env: NodeJS.ProcessEnv = process.env) {
  const wt = resolve(worktree)
  return readEntries(env).filter((e) => e.worktree === wt)
}

// ── 對帳 ────────────────────────────────────────────────────────────────────

export type RuntimeFinding =
  | {
      kind: 'unregistered'
      port: number
      pid: number
      cmdline: string
      cwd: string | null
      ageMs: number | null
    }
  | { kind: 'dead-registered'; port: number; worktree: string; consumer: string; file: string }
  | {
      kind: 'orphan'
      port: number
      pid: number | null
      worktree: string
      consumer: string
      reason: string
      file: string
    }
  | { kind: 'foreign-band'; port: number; pid: number; cwd: string | null; ownerConsumer: string }
  | { kind: 'leftover-child'; port: number; pid: number; cmdline: string; worktree: string }

export type AuditInput = {
  listeners: Listener[]
  procs: Map<number, ProcInfo>
  entries: Array<RuntimeEntry & { file: string }>
  /** consumer id → { root, ports:[lo,hi][] }；用來判「佔他人 base／band」 */
  bands?: Array<{ consumer: string; root: string; ranges: Array<[number, number]> }>
  worktreeExists?: (p: string) => boolean
  nowMs?: number
  clockTicksPerSec?: number
  bootTimeMs?: number
}

export function auditRuntime(input: AuditInput): {
  findings: RuntimeFinding[]
  registered: number
  devListeners: number
} {
  const { listeners, procs, entries } = input
  const exists = input.worktreeExists ?? ((p: string) => existsSync(p))
  const findings: RuntimeFinding[] = []
  const covered = new Set<number>() // 帳本涵蓋的 pid（含子孫）
  const coveredPorts = new Set<number>()
  const listenPorts = new Set(listeners.map((l) => l.port))
  for (const e of entries) {
    for (const p of e.ports) coveredPorts.add(p.port)
    if (e.pid && entryPidAlive(e, procs)) {
      covered.add(e.pid)
      for (const d of descendantsOf(e.pid, procs)) covered.add(d)
    }
  }
  const ageOf = (p: ProcInfo): number | null => {
    if (
      input.nowMs === null ||
      input.nowMs === undefined ||
      input.bootTimeMs === null ||
      input.bootTimeMs === undefined
    )
      return null
    const hz = input.clockTicksPerSec ?? 100
    return input.nowMs - (input.bootTimeMs + (p.startTicks / hz) * 1000)
  }
  let devListeners = 0
  for (const l of listeners) {
    if (l.pid === null || l.pid === undefined) continue
    const p = procs.get(l.pid)
    if (!p || !isDevLike(p.cmdline) || isResidentService(p)) continue
    devListeners++
    const registeredHere = covered.has(l.pid) || coveredPorts.has(l.port)
    if (!registeredHere) {
      findings.push({
        kind: 'unregistered',
        port: l.port,
        pid: l.pid,
        cmdline: p.cmdline.slice(0, 160),
        cwd: p.cwd,
        ageMs: ageOf(p),
      })
    }
    for (const b of input.bands ?? []) {
      const inBand = b.ranges.some(([lo, hi]) => l.port >= lo && l.port <= hi)
      const inRoot =
        p.cwd !== null &&
        p.cwd !== undefined &&
        (p.cwd === b.root || p.cwd.startsWith(`${b.root}/`) || p.cwd.startsWith(`${b.root}-wt/`))
      if (inBand && !inRoot) {
        // cwd 屬於另一個 consumer 的樹才算佔別人的號碼
        const other = (input.bands ?? []).find(
          (o) =>
            o.consumer !== b.consumer &&
            p.cwd !== null &&
            p.cwd !== undefined &&
            (p.cwd === o.root ||
              p.cwd.startsWith(`${o.root}/`) ||
              p.cwd.startsWith(`${o.root}-wt/`)),
        )
        if (other)
          findings.push({
            kind: 'foreign-band',
            port: l.port,
            pid: l.pid,
            cwd: p.cwd,
            ownerConsumer: b.consumer,
          })
      }
    }
  }
  for (const e of entries) {
    const mainPorts = e.ports.map((p) => p.port)
    const alive = mainPorts.filter((p) => listenPorts.has(p))
    const file = e.file
    if (!exists(e.worktree)) {
      findings.push({
        kind: 'orphan',
        port: mainPorts[0] ?? 0,
        pid: e.pid,
        worktree: e.worktree,
        consumer: e.consumer,
        reason: 'worktree-gone',
        file,
      })
      continue
    }
    if (alive.length === 0) {
      if (e.stoppedAt) continue // reaper 閒置停的：登記保留供重啟，不算死登記
      findings.push({
        kind: 'dead-registered',
        port: mainPorts[0] ?? 0,
        worktree: e.worktree,
        consumer: e.consumer,
        file,
      })
      continue
    }
    const pidAlive = entryPidAlive(e, procs)
    if (!pidAlive) {
      findings.push({
        kind: 'orphan',
        port: alive[0]!,
        pid: e.pid,
        worktree: e.worktree,
        consumer: e.consumer,
        reason: 'owner-pid-gone',
        file,
      })
      continue
    }
    // 子行程聽著帳本沒記的 port（例如 HMR 或 workerd）
    for (const d of descendantsOf(e.pid!, procs)) {
      for (const l of listeners) {
        if (l.pid === d && !coveredPorts.has(l.port)) {
          findings.push({
            kind: 'leftover-child',
            port: l.port,
            pid: d,
            cmdline: (procs.get(d)?.cmdline ?? '').slice(0, 120),
            worktree: e.worktree,
          })
        }
      }
    }
  }
  return { findings, registered: entries.length, devListeners }
}

// ── registry bands／整合對帳 ─────────────────────────────────────────────────

/** 從 registry/consumers.json 組「各 consumer 的 base 池與 worktree band」。 */
export function readBands(
  registryPath: string,
  offlineRoot = join(homedir(), 'offline'),
): NonNullable<AuditInput['bands']> {
  try {
    const reg = JSON.parse(readFileSync(registryPath, 'utf8'))
    const list: Array<{
      consumer_id?: string
      local_dir?: string
      dev_ports?: Record<string, unknown>
    }> = Array.isArray(reg) ? reg : (reg?.consumers ?? [])
    const out: NonNullable<AuditInput['bands']> = []
    for (const c of list) {
      const id = c.consumer_id
      const dp = c.dev_ports
      if (!id || !dp) continue
      const ranges: Array<[number, number]> = []
      for (const [k, v] of Object.entries(dp)) {
        if (k === 'worktree_band' && Array.isArray(v) && v.length === 2)
          ranges.push([Number(v[0]), Number(v[1])])
        else if (typeof v === 'number') ranges.push([v, v + 9])
      }
      // checkout 目錄不一定叫 consumer_id（registry 的 local_dir 可覆寫，可含子目錄）。
      out.push({ consumer: id, root: join(offlineRoot, c.local_dir ?? id), ranges })
    }
    return out
  } catch {
    return []
  }
}

export function collectRuntimeAudit(opts: { registryPath?: string; env?: NodeJS.ProcessEnv } = {}) {
  const procs = readProcTable()
  let bootTimeMs: number | undefined
  try {
    const m = /^btime (\d+)/m.exec(readFileSync('/proc/stat', 'utf8'))
    if (m) bootTimeMs = Number(m[1]) * 1000
  } catch {}
  return {
    procs,
    audit: auditRuntime({
      listeners: readListeners(),
      procs,
      entries: readEntries(opts.env),
      bands: opts.registryPath ? readBands(opts.registryPath) : [],
      nowMs: Date.now(),
      bootTimeMs,
    }),
  }
}
