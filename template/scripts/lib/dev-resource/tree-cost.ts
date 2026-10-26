// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/dev-resource/tree-cost.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/dev-resource/tree-cost.ts
/**
 * 每棵 worktree 的執行期資源成本量測。
 *
 * 純判定＋唯讀 IO：進程歸屬樹、dev server 辨識、node_modules 實佔（hardlink 分帳）。
 * NEVER 殺進程、NEVER 刪檔。IO 讀 /proc 與 lstat，測試以 `procRoot`（假 /proc 目錄）／暫存樹注入。
 *
 * | REQUIRED 欄位 | 內容 |
 * | --- | --- |
 * | 觸發條件 | informational — 不觸發任何東西 |
 * | 消費端 | `vendor/scripts/dev-resource/tree-cost.ts`；plan Open work 第 2、3 條（重複安裝盤點、dev server 並行上限 spec）以本基線決定門檻 |
 * | 觸發點 | 失敗輸出：該 CLI 的 `--help` 與 plan § Evidence 的重跑指令 |
 */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { basename, join } from 'node:path'

export interface TreeRef {
  path: string
  branch: string | null
  kind: 'main' | 'linked'
}

export interface ProcSample {
  pid: number
  ppid: number
  cwd: string | null
  argv: string[]
  /** Pss（已把共用頁按比例攤）；讀不到 smaps_rollup 時退 VmRSS。單位 KiB。 */
  memKiB: number
  memSource: 'pss' | 'rss'
}

export interface TreeProcCost {
  procCount: number
  memKiB: number
  devServers: number
  devServerMemKiB: number
  devServerPids: number[]
}

/** `git worktree list --porcelain`（含主 checkout，剔除 prunable／不存在的路徑）。 */
export function listAllTrees(checkout: string): TreeRef[] | null {
  let out: string
  try {
    out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: checkout,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    })
  } catch {
    return null
  }
  const trees: TreeRef[] = []
  out
    .split('\n\n')
    .filter(Boolean)
    .forEach((block, index) => {
      const path = /^worktree (.+)$/mu.exec(block)?.[1]
      if (!path || /^prunable\b/mu.test(block) || !existsSync(path)) return
      const branch = /^branch refs\/heads\/(.+)$/mu.exec(block)?.[1] ?? null
      trees.push({ path, branch, kind: index === 0 ? 'main' : 'linked' })
    })
  return trees
}

/** 最長路徑前綴歸屬：cwd 在哪棵樹內就算哪棵（巢狀樹取最深）。 */
export function attributeToTree(cwd: string | null, treePaths: readonly string[]): string | null {
  if (!cwd) return null
  const clean = cwd.replace(/ \(deleted\)$/u, '')
  let best: string | null = null
  for (const tree of treePaths) {
    if (clean !== tree && !clean.startsWith(`${tree}/`)) continue
    if (best === null || tree.length > best.length) best = tree
  }
  return best
}

const DEV_TOOLS = /^(?:vite|nuxt|nuxi|next|astro|webpack-dev-server|storybook)$/u
const NOT_DEV_SUBCOMMANDS = new Set([
  'typecheck',
  'build',
  'generate',
  'preview',
  'test',
  'lint',
  'prepare',
  'analyze',
  'info',
  'cleanup',
])

/**
 * dev server 的**根**進程：argv 中有 vite／nuxt／nuxi／next／astro 等執行檔，且子命令不是
 * build／typecheck／test 這類一次性命令。`nuxt dev` 與 `nuxi dev` 與 `vite`（無子命令）都算；
 * `pnpm dev`／`sh -c` 這類包裝層不算（它們不吃記憶體，算了會重複計數）。
 */
export function isDevServerArgv(argv: readonly string[]): boolean {
  const tokens = argv.slice(0, 8).map((a) => basename(a).replace(/\.(?:cjs|mjs|js|ts)$/u, ''))
  const idx = tokens.findIndex((t) => DEV_TOOLS.test(t))
  if (idx === -1) return false
  // 第一個 token 必須是執行檔（node／直接工具），不是 `sh -c "…vite…"` 內的字串
  const head = tokens[0] ?? ''
  if (/^(?:sh|bash|zsh|fish|dash|pnpm|npm|npx|yarn|vp|vpx|mise)$/u.test(head)) return false
  const sub = tokens.slice(idx + 1).find((t) => !t.startsWith('-'))
  if (sub !== undefined && NOT_DEV_SUBCOMMANDS.has(sub)) return false
  return true
}

/**
 * 把進程樣本按樹彙總。記憶體按各進程自己的 cwd 歸樹；dev server 的記憶體改按**根進程的後代**歸屬
 * （root＝argv 是 dev server 且沒有 dev server 祖先），所以 `esbuild --service`、nuxi fork 的 worker
 * 這類 argv 看不出是 dev server 的子行程也算進該 dev server，且每個進程只計一次。
 */
export function summarizeProcs(
  procs: readonly ProcSample[],
  treePaths: readonly string[],
): Map<string, TreeProcCost> {
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const out = new Map<string, TreeProcCost>()
  const costOf = (tree: string): TreeProcCost => {
    let cost = out.get(tree)
    if (!cost) {
      cost = { procCount: 0, memKiB: 0, devServers: 0, devServerMemKiB: 0, devServerPids: [] }
      out.set(tree, cost)
    }
    return cost
  }
  for (const p of procs) {
    const tree = attributeToTree(p.cwd, treePaths)
    if (!tree) continue
    const cost = costOf(tree)
    cost.procCount += 1
    cost.memKiB += p.memKiB
  }

  const hasDevAncestor = (p: ProcSample): boolean => {
    const seen = new Set([p.pid])
    for (let cur = byPid.get(p.ppid); cur && !seen.has(cur.pid); cur = byPid.get(cur.ppid)) {
      if (isDevServerArgv(cur.argv)) return true
      seen.add(cur.pid)
    }
    return false
  }
  const children = new Map<number, ProcSample[]>()
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p])

  const counted = new Set<number>()
  for (const root of procs) {
    if (!isDevServerArgv(root.argv) || hasDevAncestor(root)) continue
    const tree = attributeToTree(root.cwd, treePaths)
    if (!tree) continue
    const cost = costOf(tree)
    cost.devServers += 1
    cost.devServerPids.push(root.pid)
    const stack = [root]
    while (stack.length > 0) {
      const cur = stack.pop() as ProcSample
      if (counted.has(cur.pid)) continue
      counted.add(cur.pid)
      cost.devServerMemKiB += cur.memKiB
      stack.push(...(children.get(cur.pid) ?? []))
    }
  }
  return out
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** /proc/<pid>/smaps_rollup 的 Pss；沒有就退 status 的 VmRSS。讀不到回 null（進程已消失或無權限）。 */
export function readMem(
  pid: number,
  procRoot = '/proc',
): { memKiB: number; source: 'pss' | 'rss' } | null {
  const rollup = readText(join(procRoot, String(pid), 'smaps_rollup'))
  const pss = rollup ? /^Pss:\s+(\d+) kB/mu.exec(rollup)?.[1] : undefined
  if (pss !== undefined) return { memKiB: Number(pss), source: 'pss' }
  const status = readText(join(procRoot, String(pid), 'status'))
  const rss = status ? /^VmRSS:\s+(\d+) kB/mu.exec(status)?.[1] : undefined
  return rss === undefined ? null : { memKiB: Number(rss), source: 'rss' }
}

/** 掃 /proc，回每個讀得到 cwd 的進程。kernel thread（沒有 cmdline）略過。 */
export function sampleProcs(procRoot = '/proc'): ProcSample[] {
  const out: ProcSample[] = []
  let names: string[]
  try {
    names = readdirSync(procRoot)
  } catch {
    return out
  }
  for (const name of names) {
    if (!/^\d+$/u.test(name)) continue
    const pid = Number(name)
    const cmdline = readText(join(procRoot, name, 'cmdline'))
    if (!cmdline) continue
    const stat = readText(join(procRoot, name, 'stat'))
    // comm 可含空白與括號：ppid 在最後一個 `)` 之後的第二欄
    const ppid = stat ? Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]) : 0
    let cwd: string | null = null
    try {
      cwd = readlinkSync(join(procRoot, name, 'cwd'))
    } catch {
      cwd = null
    }
    const mem = readMem(pid, procRoot)
    if (!mem) continue
    out.push({
      pid,
      ppid: Number.isFinite(ppid) ? ppid : 0,
      cwd,
      argv: cmdline.split('\0').filter(Boolean),
      memKiB: mem.memKiB,
      memSource: mem.source,
    })
  }
  return out
}

export interface DepCost {
  /** 找到的 node_modules 目錄數（根＋workspace 一～二層）。 */
  dirs: number
  /** 需新下載／真實佔用的位元組：nlink==1 的檔（沒有與 store 或別棵樹共用）。 */
  exclusiveBytes: number
  /** nlink>1 的檔位元組，樹內以 (dev,ino) 去重；磁碟上由多個連結共用，不是這棵樹獨佔。 */
  sharedBytes: number
  files: number
  /** 走完前被 maxEntries 截斷。 */
  truncated: boolean
  /** 有 node_modules 但幾乎沒有 hardlink 共用（exclusive 占 ≥90% 且總量 ≥ minBytes）→ 重複安裝嫌疑。 */
  duplicateSuspect: boolean
  /** 用哪種安裝器的痕跡：node_modules/.pnpm → pnpm；否則 flat。 */
  layout: 'pnpm' | 'flat' | 'none'
}

export const DUPLICATE_SUSPECT_MIN_BYTES = 100 * 1024 * 1024

/** workspace 常見的 node_modules 位置：根、`<a>/node_modules`、`<a>/<b>/node_modules`（apps／packages／layers）。 */
export function findNodeModulesDirs(treePath: string): string[] {
  const found: string[] = []
  const root = join(treePath, 'node_modules')
  if (existsSync(root)) found.push(root)
  const SKIP = new Set(['node_modules', '.git', '.nuxt', '.output', '.data', 'dist'])
  const children = (dir: string): string[] => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.isSymbolicLink() && !SKIP.has(e.name))
        .map((e) => join(dir, e.name))
    } catch {
      return []
    }
  }
  for (const a of children(treePath)) {
    const nm = join(a, 'node_modules')
    if (existsSync(nm)) found.push(nm)
    for (const b of children(a)) {
      const nm2 = join(b, 'node_modules')
      if (existsSync(nm2)) found.push(nm2)
    }
  }
  return found
}

/**
 * node_modules 實佔：不跟 symlink，檔案以 lstat 的已配置區塊（blocks×512，等同 du）計。
 * nlink==1 → exclusive；nlink>1 → shared（樹內 (dev,ino) 去重，hardlink 到 store 的檔只算一次）。
 */
export function measureDeps(treePath: string, maxEntries = 3_000_000): DepCost {
  const dirs = findNodeModulesDirs(treePath)
  const seen = new Set<string>()
  let exclusiveBytes = 0
  let sharedBytes = 0
  let files = 0
  let entries = 0
  let truncated = false
  const stack = [...dirs]
  while (stack.length > 0 && !truncated) {
    const dir = stack.pop() as string
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (++entries > maxEntries) {
        truncated = true
        break
      }
      const full = join(dir, name)
      let st: ReturnType<typeof lstatSync>
      try {
        st = lstatSync(full)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!st.isFile()) continue
      files += 1
      const bytes = st.blocks * 512
      if (st.nlink > 1) {
        const key = `${st.dev}:${st.ino}`
        if (seen.has(key)) continue
        seen.add(key)
        sharedBytes += bytes
      } else {
        exclusiveBytes += bytes
      }
    }
  }
  const total = exclusiveBytes + sharedBytes
  const layout: DepCost['layout'] =
    dirs.length === 0
      ? 'none'
      : existsSync(join(treePath, 'node_modules', '.pnpm'))
        ? 'pnpm'
        : 'flat'
  return {
    dirs: dirs.length,
    exclusiveBytes,
    sharedBytes,
    files,
    truncated,
    layout,
    duplicateSuspect: total >= DUPLICATE_SUSPECT_MIN_BYTES && exclusiveBytes >= total * 0.9,
  }
}

export interface HostMem {
  totalKiB: number
  availableKiB: number
  swapUsedKiB: number
}

export function parseMeminfo(text: string): HostMem {
  const get = (key: string): number =>
    Number(new RegExp(`^${key}:\\s+(\\d+) kB`, 'mu').exec(text)?.[1] ?? 0)
  return {
    totalKiB: get('MemTotal'),
    availableKiB: get('MemAvailable'),
    swapUsedKiB: get('SwapTotal') - get('SwapFree'),
  }
}

export function readHostMem(): HostMem | null {
  const text = readText('/proc/meminfo')
  return text ? parseMeminfo(text) : null
}
