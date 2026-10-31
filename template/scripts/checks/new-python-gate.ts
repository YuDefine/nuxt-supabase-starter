// 🔒 LOCKED — managed by clade · Source: vendor/scripts/checks/new-python-gate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/checks/new-python-gate.ts
// CLADE:VENDOR-SCRIPT
//
// new-python-gate — 「不准新增 .py」的**唯一**判定式（toolchain D1；`rules/core/code-style.md` § 新增腳本選語言）
//
// 消費端共用這一份，NEVER 各寫一份判準：
//   - consumer pre-commit：`scripts/pre-commit/checks/new-python.sh` → 本檔 `--staged`
//   - consumer PR／CI：本檔 `--against <ref>`
//   - clade home：`scripts/check-retired-carriers.ts` import `findNewPython`（mirror 落點讀 clade 的 registry）
//
// 判準：本次變更新落腳的 `.py` 一律擋，只有下列放行——
//   - 從 `.py` 純改名（rename 相似度 100%）；邊改名邊改內容算新增
//   - LOCKED mirror 落點（只有 clade home 有：`registry/upstream-submodules.json` 宣告）
//   - 投影落點上、與基準樹某支 `.py`（或同次放行的 mirror 檔）逐位元組相同的檔：重新投影既有腳本。
//     投影落點由呼叫端給：clade home 是投影計畫內的確切路徑；consumer 沒有（投影走 propagate）。
//     其他位置的複本照擋——「先原樣複製、下一筆再改」會把新腳本偽裝成修改
// 修改、刪除既有 `.py` 不判。存量改寫在 toolchain 刀 7。
// `--staged` 在 merge 收尾時，路徑與 MERGE_HEAD 同 blob 且對側已在落地主幹上的到達檔不算本次寫入。
//
// fail-closed：讀不到 staged／diff／基準樹時 throw → exit 2，pre-commit 照樣擋。
//
// 由 ~/clade vendor/scripts/checks/ 散播，請勿直接編輯 consumer 副本。

import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** git 的空樹 object id：repo 第一個 commit 沒有 HEAD 時的基準 */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** 已落地內容的主幹；merge 豁免只認這條線上的 MERGE_HEAD */
export const LANDED_TRUNK = 'origin/main'

export const PY_DETAIL = 'Python 已退役（toolchain D1），不准新增 .py'

export const isPython = (path: string) => path.endsWith('.py')

/** 一筆讓檔案出現在新位置的變更。`from`／`score` 只在 rename 時有值；`blob` 由 collect 填。 */
export interface PyArrival {
  path: string
  from?: string
  score?: number
  blob?: string
}

export interface PyViolation {
  path: string
  detail: string
}

export function findNewPython(input: {
  arrivals: PyArrival[]
  /** LOCKED mirror 落點（照上游）；consumer 沒有 */
  isMirror: (path: string) => boolean
  /** 投影落點：只有這裡的逐位元組複本放行 */
  isProjection: (path: string) => boolean
  /** 基準樹所有 `.py` 的 blob id */
  baseBlobs: Set<string>
}): PyViolation[] {
  const added = input.arrivals.filter(
    (a) =>
      isPython(a.path) && !(a.from !== undefined && isPython(a.from) && (a.score ?? 0) === 100),
  )
  const mirrored = added.filter((a) => input.isMirror(a.path))
  const known = new Set(input.baseBlobs)
  for (const a of mirrored) if (a.blob) known.add(a.blob)
  return added
    .filter(
      (a) =>
        !mirrored.includes(a) &&
        !(input.isProjection(a.path) && a.blob !== undefined && known.has(a.blob)),
    )
    .map((a) => ({ path: a.path, detail: PY_DETAIL }))
}

export function formatNewPython(violations: PyViolation[], label: string): string {
  return [
    `${label}: ${violations.length} 支新增的 .py`,
    ...violations.map((v) => `  ✗ ${v.path} — ${v.detail}`),
    '',
    '  改法（rules/core/code-style.md § 新增腳本選語言）：',
    '    常態入口會跑的（hook、CLI、audit、gate、ops、skill scripts）→ clade：Rust 子命令 `clade <sub>`，',
    '      Rust workspace（crates/clade）落地前先寫成 TS；consumer：TS（scripts/<name>.ts，node 直接跑）',
    '    一次性（plan evidence、探針，沒有常態入口引用）→ TS',
    '    被 JS runtime import 的 → TS；被 source 的 → zsh／bash',
    '    上游 mirror／clade 投影 → 只經 clade 的 sync／propagate 寫入，不在本地新增',
    '  修改既有 .py 不受影響。改名（相似度 100%、不改內容）MUST 單獨成一個 PR——CI 的 --against 是 merge-base..HEAD 整體比對，同 PR 內改名後再改內容會降到 R<100 被擋；存量改寫在 toolchain 刀 7。',
  ].join('\n')
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

/**
 * merge 進行中且對側已在落地主幹上時回傳 MERGE_HEAD，否則 null。在 main 合一條未落地的 session
 * branch 時，它帶來的內容就是本次寫入；主幹 ref 解析不到同樣 fail closed。
 * 限制：`rev-parse MERGE_HEAD` 只取第一個被合入的 parent，octopus merge 其他 parent 帶來的內容
 * 仍算本次寫入（fail closed，照常擋）。
 */
export function landedMergeHead(root: string): string | null {
  const merging = git(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])?.trim() || null
  return merging !== null &&
    git(root, ['merge-base', '--is-ancestor', merging, LANDED_TRUNK]) !== null
    ? merging
    : null
}

/**
 * 把 main 合進 session branch 時，index 相對 HEAD 的「新增」大多是對側已落地的內容：
 * 路徑在 mergeHead 上是同一個 blob 就不是本次寫入；對側沒有或內容不同照常判。
 */
export function dropLandedArrivals<T extends { path: string }>(
  root: string,
  arrivals: T[],
  mergeHead: string | null,
): T[] {
  if (mergeHead === null) return arrivals
  const blob = (rev: string) => git(root, ['rev-parse', '-q', '--verify', rev])?.trim() || null
  return arrivals.filter(({ path }) => blob(`${mergeHead}:${path}`) !== blob(`:${path}`))
}

/** 解析 `git diff --name-status -z -M`：A 與 R（帶相似度）；C 視同新增。 */
export function parsePyArrivals(nameStatusZ: string): PyArrival[] {
  const fields = nameStatusZ.split('\0')
  const out: PyArrival[] = []
  for (let i = 0; i < fields.length;) {
    const status = fields[i]
    if (!status) break
    if (status.startsWith('R') || status.startsWith('C')) {
      const from = fields[i + 1]
      const to = fields[i + 2]
      if (status.startsWith('R')) out.push({ path: to, from, score: Number(status.slice(1)) })
      else out.push({ path: to })
      i += 3
    } else {
      if (status === 'A') out.push({ path: fields[i + 1] })
      i += 2
    }
  }
  return out
}

/**
 * 填 `.py` arrival 的 blob 並讀基準樹的 `.py` blob。`rev` 是變更後那一側：'' 表示 index。
 * 沒有 `.py` arrival 時不讀基準樹。讀不到就 throw（fail-closed）。
 */
export function pythonBlobs(
  root: string,
  arrivals: PyArrival[],
  base: string,
  rev: string,
): Set<string> {
  const py = arrivals.filter((a) => isPython(a.path))
  if (py.length === 0) return new Set()
  for (const a of py) {
    const id = git(root, ['rev-parse', '-q', '--verify', `${rev}:${a.path}`])?.trim()
    if (!id) throw new Error(`cannot resolve blob of ${a.path}`)
    a.blob = id
  }
  const tree = git(root, ['ls-tree', '-r', '-z', base])
  if (tree === null) throw new Error(`cannot list ${base} tree`)
  const blobs = new Set<string>()
  for (const entry of tree.split('\0')) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(entry)
    if (m && isPython(m[2])) blobs.add(m[1])
  }
  return blobs
}

export function collectConsumer(
  root: string,
  mode: { staged: true } | { against: string },
): { arrivals: PyArrival[]; baseBlobs: Set<string> } {
  if ('staged' in mode) {
    const diff = git(root, ['diff', '--cached', '--name-status', '-z', '-M'])
    if (diff === null) throw new Error('cannot read staged changes')
    const arrivals = dropLandedArrivals(root, parsePyArrivals(diff), landedMergeHead(root))
    // 沒有 HEAD（repo 第一個 commit）時基準是空樹
    const base = git(root, ['rev-parse', '-q', '--verify', 'HEAD'])?.trim() || null
    return { arrivals, baseBlobs: pythonBlobs(root, arrivals, base ?? EMPTY_TREE, '') }
  }
  const base = git(root, ['merge-base', 'HEAD', mode.against])?.trim()
  if (!base) throw new Error(`cannot resolve merge-base(HEAD, ${mode.against})`)
  const diff = git(root, ['diff', '--name-status', '-z', '-M', base, 'HEAD'])
  if (diff === null) throw new Error(`cannot diff ${base}..HEAD`)
  const arrivals = parsePyArrivals(diff)
  return { arrivals, baseBlobs: pythonBlobs(root, arrivals, base, 'HEAD') }
}

const USAGE =
  'usage: new-python-gate (--staged | --against <ref>) [--root <dir>] [--projection-roots <a,b>]'

function invokedAsCli(): boolean {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedAsCli()) {
  const args = process.argv.slice(2)
  const rootIdx = args.indexOf('--root')
  const root =
    rootIdx >= 0
      ? args[rootIdx + 1]
      : (git(process.cwd(), ['rev-parse', '--show-toplevel'])?.trim() ?? '')
  // --projection-roots：直接給投影落點（逗號分隔），例如 presales 這類非 clade consumer；不給則任何位置的複本都算新增
  const rootsIdx = args.indexOf('--projection-roots')
  const projectionRoots =
    rootsIdx >= 0 ? (args[rootsIdx + 1] ?? '').split(',').filter(Boolean) : null
  const againstIdx = args.indexOf('--against')
  const staged = args.includes('--staged')
  const against = againstIdx >= 0 ? args[againstIdx + 1] : undefined
  if (
    !root ||
    staged === againstIdx >= 0 ||
    (againstIdx >= 0 && (!against || against.startsWith('--')))
  ) {
    process.stderr.write(`${USAGE}\n`)
    process.exit(2)
  }
  let violations: PyViolation[]
  try {
    const { arrivals, baseBlobs } = collectConsumer(
      root,
      staged ? { staged: true } : { against: against! },
    )
    // consumer 的投影由 propagate 送達（CLADE_PROPAGATE=1 不經本檔），本地沒有合法的投影複本：
    // 不給 --projection-roots 就任何位置的複本都算新增。NEVER 改讀 preset 的 isStagedExcluded——
    // 它含 consumer root `scripts/`，舊 .py 原樣複製進去再改就繞過了。
    const isProjection =
      projectionRoots !== null
        ? (p: string) => projectionRoots.some((r) => p === r || p.startsWith(`${r}/`))
        : () => false
    violations = findNewPython({ arrivals, isMirror: () => false, isProjection, baseBlobs })
  } catch (err) {
    process.stderr.write(`new-python-gate: ${(err as Error).message}（檢查跑不起來，照樣擋）\n`)
    process.exit(2)
  }
  if (violations.length > 0) {
    process.stderr.write(`${formatNewPython(violations, 'new-python-gate')}\n`)
    process.exit(1)
  }
}
