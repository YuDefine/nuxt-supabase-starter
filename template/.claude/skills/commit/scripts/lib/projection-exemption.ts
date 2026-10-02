#!/usr/bin/env node
// 0-A 的「比對 release 資產」豁免：pinned consumer 的投影檔若與 pinned release 自帶 projector 的
// 實際輸出逐位元相等，審它的 diff 沒有資訊量（正確性由 release 保證，release 本身在 clade 審過）。
//
// 豁免的是「可機械證明」，不是「路徑長得像」：
//   - consumer 不是 pinned、release 資產缺失／驗不過、projector 失敗 → enabled=false，一個檔都不豁免，
//     全部照原路徑審（含 OMITTED 規則）。NEVER 默默放行。
//   - 只有「在暫存樹裡被 release projector 重新產出、且內容與受審樹相同」的檔才進 exempt。
//     不相等、projector 不產出（手寫檔、`.clade/manifest.json`、被刪的檔）一律進 residual。
//
// 比對基準＝以 release 自帶 projector（與受管 operation 同一組 PROJECTOR_STEPS）對暫存樹乾跑的輸出，
// 不是 release 源碼、也不是 gitignored 的 ownership ledger（`.clade/projections/*.json`，TD-1151：
// 每個 checkout 各一份、detached 快照樹與 CI 都沒有）。暫存樹＝受審樹拿掉候選檔（讓 projector 當
// 新檔寫出，避開「unowned file differs」中止），其餘檔原樣。受審樹只需要 tracked 內容＋
// release 資產（consumer 已安裝 → 主機 release store；NEVER 從 tag 現建、NEVER 讀 clade HEAD 源檔）。
//
// 用法：
//   node projection-exemption.ts verify (--tree <dir> | --rev <sha> --repo <dir>) --paths-file <z-file>
//        [--installed-from <dir>]... [--out <json>]
//   node projection-exemption.ts hint <json>                 （印 exempt 路徑 NUL 分隔，當候選提示）
//   node projection-exemption.ts render <json> [--paths-out <file>] [--summary-out <file>]
// verify 一律 exit 0 並把結果寫進 --out（沒給就印 stdout）；用法錯才 exit 2。

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ReleaseBasis {
  version: string
  source_commit: string
  source_tree: string
  inventory_digest: string
  origin: string
}

export interface ExemptionResult {
  schema: 1
  /** false＝驗證沒有跑完（沒有任何檔被豁免）；reason 說明為什麼。 */
  enabled: boolean
  reason?: string
  basis?: ReleaseBasis
  steps?: string[]
  /** 候選檔數（diff 裡的路徑）。 */
  checked: number
  exempt: string[]
  /** 候選但沒被豁免的檔：照常進 diff 審查。 */
  residual: string[]
  /** exempt 排序後逐行 sha256，供摘要段對照。 */
  exempt_digest?: string
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

/** 結果檔是外部輸入：先 parse 成 unknown 再驗形狀，不符就回 undefined（呼叫端照「未啟用」處理）。 */
function parseExemptionResult(text: string): ExemptionResult | undefined {
  const raw: unknown = JSON.parse(text)
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (r.schema !== 1 || typeof r.enabled !== 'boolean' || typeof r.checked !== 'number')
    return undefined
  if (!isStringArray(r.exempt) || !isStringArray(r.residual)) return undefined
  if (r.reason !== undefined && typeof r.reason !== 'string') return undefined
  if (r.steps !== undefined && !isStringArray(r.steps)) return undefined
  if (r.exempt_digest !== undefined && typeof r.exempt_digest !== 'string') return undefined
  return raw as ExemptionResult
}

export interface PinnedRelease {
  basis: ReleaseBasis
  /** 內含 `assets/`；暫存樹的投影根建在它旁邊。 */
  dir: string
  /** 投影後要驗資產沒被經 hardlink 改到；回人讀摘要，null＝完好。 */
  verifyIntact: () => string | null
}

export interface ProjectorRun {
  ok: boolean
  detail: string
}

export interface ExemptionDeps {
  /** 受審樹的 pin：沒有 → reason。 */
  readPin: (tree: string) => { pinned: Record<string, string> } | { reason: string }
  /** 取不到或驗不過就 throw（訊息進 reason）。 */
  resolveRelease: (
    pinned: Record<string, string>,
    installedRoots: string[],
  ) => Promise<PinnedRelease>
  runProjector: (scratch: string, release: PinnedRelease) => Promise<ProjectorRun>
  steps: string[]
}

/** 只認樹內的相對路徑：絕對路徑或含 `..` 的候選（hint 檔可能是外來資料）不當候選。 */
function isSafeRel(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.split('/').includes('..')
}

/** 受審樹的 `.clade/` 是 consumer 自己的狀態與 manifest：不是 projector 的輸出，NEVER 豁免。 */
const NEVER_EXEMPT = /^\.clade\//

function disabled(candidates: string[], reason: string): ExemptionResult {
  return {
    schema: 1,
    enabled: false,
    reason,
    checked: candidates.length,
    exempt: [],
    residual: [...candidates],
  }
}

function treeFiles(tree: string): string[] {
  if (existsSync(join(tree, '.git'))) {
    const out = execFileSync(
      'git',
      ['-C', tree, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        maxBuffer: 256 * 1024 * 1024,
      },
    )
    return out.toString('utf8').split('\0').filter(Boolean)
  }
  const files: string[] = []
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(tree, rel), { withFileTypes: true })) {
      const next = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.name === '.git') continue
      if (entry.isDirectory()) walk(next)
      else files.push(next)
    }
  }
  walk('')
  return files
}

function copyEntry(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true })
  const stat = lstatSync(from)
  if (stat.isSymbolicLink()) symlinkSync(readlinkSync(from), to)
  else copyFileSync(from, to)
}

/** 兩邊都是同形（一般檔＋同位元組＋同執行位，或 symlink＋同目標）才算相等。 */
function sameEntry(a: string, b: string): boolean {
  let sa
  let sb
  try {
    sa = lstatSync(a)
    sb = lstatSync(b)
  } catch {
    return false
  }
  if (sa.isSymbolicLink() || sb.isSymbolicLink()) {
    return sa.isSymbolicLink() && sb.isSymbolicLink() && readlinkSync(a) === readlinkSync(b)
  }
  if (!sa.isFile() || !sb.isFile()) return false
  if ((sa.mode & 0o111) !== (sb.mode & 0o111)) return false
  return readFileSync(a).equals(readFileSync(b))
}

export async function verifyProjectionExemption(input: {
  tree: string
  candidates: string[]
  installedRoots?: string[]
  remoteUrl?: string | null
  deps: ExemptionDeps
}): Promise<ExemptionResult> {
  const { tree, deps } = input
  const candidates = [...new Set(input.candidates)].filter(isSafeRel).toSorted()
  const pin = deps.readPin(tree)
  if ('reason' in pin) return disabled(candidates, pin.reason)
  let release: PinnedRelease
  try {
    release = await deps.resolveRelease(pin.pinned, input.installedRoots ?? [])
  } catch (error) {
    return disabled(
      candidates,
      `release 資產不可用：${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // 暫存樹：受審樹拿掉「候選且可被投影」的檔，其餘原樣。候選檔不在樹上（刪除）本來就不可能被豁免。
  const removable = candidates.filter((p) => !NEVER_EXEMPT.test(p) && existsOnTree(tree, p))
  const removed = new Set(removable)
  const scratch = mkdtempSync(join(tmpdir(), 'projection-exempt-'))
  try {
    for (const rel of treeFiles(tree)) {
      // index 裡有、工作樹已刪（plain rm）的檔：沒有東西可複製，不是整個豁免的失敗。
      if (removed.has(rel) || !existsOnTree(tree, rel)) continue
      copyEntry(join(tree, rel), join(scratch, rel))
    }
    // projector 認 consumer 身分靠 git remote（registry 比對）；暫存樹自成一個空 repo。
    execFileSync('git', ['-C', scratch, 'init', '-q'], { stdio: 'ignore' })
    if (input.remoteUrl) {
      execFileSync('git', ['-C', scratch, 'remote', 'add', 'origin', input.remoteUrl], {
        stdio: 'ignore',
      })
    }
    const run = await deps.runProjector(scratch, release)
    if (!run.ok) return disabled(candidates, `release projector 在暫存樹失敗：${run.detail}`)
    const corrupt = release.verifyIntact()
    if (corrupt !== null) return disabled(candidates, `release 資產在投影後不完整：${corrupt}`)
    const exempt: string[] = []
    const residual: string[] = []
    for (const rel of candidates) {
      if (removed.has(rel) && sameEntry(join(tree, rel), join(scratch, rel))) exempt.push(rel)
      else residual.push(rel)
    }
    return {
      schema: 1,
      enabled: true,
      basis: release.basis,
      steps: deps.steps,
      checked: candidates.length,
      exempt,
      residual,
      exempt_digest: createHash('sha256').update(exempt.join('\n')).digest('hex'),
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function existsOnTree(tree: string, rel: string): boolean {
  try {
    lstatSync(join(tree, rel))
    return true
  } catch {
    return false
  }
}

// ── 摘要文字（進 0-A brief 與 oa-batches 輸出）─────────────────────────────────

function prefixOf(path: string): string {
  const parts = path.split('/')
  return parts.length <= 2 ? parts[0]! : `${parts[0]}/${parts[1]}`
}

export function renderExemptionSummary(result: ExemptionResult): string {
  if (!result.enabled || result.exempt.length === 0 || !result.basis) return ''
  const b = result.basis
  const groups = new Map<string, number>()
  for (const p of result.exempt) groups.set(prefixOf(p), (groups.get(prefixOf(p)) ?? 0) + 1)
  const rows = [...groups.entries()].toSorted((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
  const shown = rows.slice(0, 20).map(([prefix, n]) => `    ${prefix}/ × ${n}`)
  if (rows.length > 20) shown.push(`    … ${rows.length - 20} more directories`)
  return [
    `${result.exempt.length} files are byte-identical (content and executable bit) to the output of the pinned release's own projector. Their diff is NOT embedded and they are NOT unreviewed.`,
    `  basis: release ${b.version} (source_commit ${b.source_commit.slice(0, 12)}, source_tree ${b.source_tree.slice(0, 12)}, inventory_digest ${b.inventory_digest.slice(0, 12)}, origin ${b.origin})`,
    `  method: copied the reviewed tree minus the candidate files to a scratch dir, ran the release's own projector there (${(result.steps ?? []).join('; ')}), then compared every candidate with the reviewed tree.`,
    `  result: ${result.exempt.length} of ${result.checked} changed paths reproduced exactly; ${result.residual.length} did not (hand-written, not in the release, or deleted) and are reviewed normally.`,
    '  exempted files by directory:',
    ...shown,
    `  sorted-path-list sha256: ${result.exempt_digest ?? ''}`,
    'Their correctness comes from the release itself, not from this diff. The pin that names that release (`.clade/manifest.json`) is NOT exempted — it is part of the changeset when it changed.',
  ].join('\n')
}

// ── 真實依賴（clade 的 release／projector 函式庫）─────────────────────────────

// 只在 clade home（或帶 CLADE_HOME）才載得到這兩支；consumer 端沒有時整個豁免降級成 enabled=false。
// 型別刻意手寫窄介面，不 import 型別：本檔會隨 capability 投影到 consumer，相對路徑在那邊不存在。
interface CladeLibs {
  policy: {
    readPolicyField: (
      raw: Record<string, unknown>,
      label: string,
    ) => { state: string; policy: { kind: string; release?: Record<string, string> } }
    resolvePinnedReleaseSource: (options: {
      consumerRoot: string
      pinned: Record<string, string>
    }) => Promise<{
      identity: Record<string, string>
      dir: string
      origin: string
    }>
    verifyPinnedReleaseSource: (consumerRoot: string, source: never) => string | null
  }
  projection: {
    PROJECTOR_STEPS: readonly { script: string; args: string[] }[]
    sweepPinnedOverlays: (parentDir: string) => string[]
    buildProjectionHome: (input: {
      assetsRoot: string
      overlayRoot: string
      registryText: string
      visibility: null
      visibilityCacheText: string | null
    }) => void
    runReleaseProjector: (
      consumerRoot: string,
      projectionHome: string,
      env: NodeJS.ProcessEnv,
    ) => Promise<{ script: string; exitCode: number; detail: string } | null>
  }
}

async function loadCladeLibs(): Promise<CladeLibs> {
  const here = dirname(fileURLToPath(import.meta.url))
  const homes = [process.env['CLADE_HOME'], join(here, '..', '..', '..', '..')].filter(
    (h): h is string => Boolean(h),
  )
  for (const home of homes) {
    const policy = join(home, 'scripts', 'lib', 'consumer-update-policy.ts')
    const projection = join(home, 'scripts', 'lib', 'runtime-tracked-projection.ts')
    if (existsSync(policy) && existsSync(projection)) {
      return { policy: await import(policy), projection: await import(projection) }
    }
  }
  throw new Error('找不到 clade 的 release／projector 函式庫（CLADE_HOME/scripts/lib）')
}

function cladeHomeOf(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const home of [process.env['CLADE_HOME'], join(here, '..', '..', '..', '..')]) {
    if (home && existsSync(join(home, 'registry', 'consumers.json'))) return home
  }
  throw new Error('找不到 clade 的 registry/consumers.json（CLADE_HOME）')
}

export async function realDeps(): Promise<ExemptionDeps> {
  const { policy, projection } = await loadCladeLibs()
  const home = cladeHomeOf()
  const registryText = readFileSync(join(home, 'registry', 'consumers.json'), 'utf8')
  // repo 可見度快取是 gitignored：linked worktree 沒有，沿 git-common-dir 回主 checkout 找。
  const visibilityPath = [home, mainCheckoutOf(home)]
    .filter((h): h is string => h !== null)
    .map((h) => join(h, '.spectra', 'repo-visibility-cache.json'))
    .find((p) => existsSync(p))
  const visibilityCacheText = visibilityPath ? readFileSync(visibilityPath, 'utf8') : null
  return {
    steps: projection.PROJECTOR_STEPS.map((s) => `${s.script} ${s.args.join(' ')}`),
    readPin: (tree) => {
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(join(tree, '.clade', 'manifest.json'), 'utf8'))
      } catch {
        return { reason: 'consumer 沒有可讀的 .clade/manifest.json（不是 pinned）' }
      }
      const field = policy.readPolicyField(raw as Record<string, unknown>, 'consumer manifest')
      if (field.state !== 'valid' || field.policy.kind !== 'pinned' || !field.policy.release) {
        return { reason: 'consumer 不是 pinned（沒有 pinned release 可比對）' }
      }
      return { pinned: field.policy.release }
    },
    resolveRelease: async (pinned, installedRoots) => {
      let lastError: unknown = new Error('沒有可查的 consumer root')
      for (const root of installedRoots) {
        try {
          // 不給 buildFrom：唯讀，NEVER 在 review 途中從 tag 現建 release。
          const source = await policy.resolvePinnedReleaseSource({ consumerRoot: root, pinned })
          return {
            basis: {
              version: source.identity.version,
              source_commit: source.identity.source_commit,
              source_tree: source.identity.source_tree,
              inventory_digest: source.identity.inventory_digest,
              origin: source.origin,
            },
            dir: source.dir,
            verifyIntact: () => policy.verifyPinnedReleaseSource(root, source as never),
          }
        } catch (error) {
          lastError = error
        }
      }
      throw lastError
    },
    runProjector: async (scratch, release) => {
      const parent = join(release.dir, '..')
      projection.sweepPinnedOverlays(parent)
      const overlay = join(parent, `.pinned-projection-${process.pid}-${randomUUID()}`)
      try {
        projection.buildProjectionHome({
          assetsRoot: join(release.dir, 'assets'),
          overlayRoot: overlay,
          registryText,
          visibility: null,
          visibilityCacheText,
        })
        const failure = await projection.runReleaseProjector(scratch, overlay, {
          PATH: process.env['PATH'] ?? '',
          HOME: process.env['HOME'] ?? tmpdir(),
          TMPDIR: process.env['TMPDIR'] ?? tmpdir(),
          LANG: process.env['LANG'] ?? 'C.UTF-8',
          npm_config_offline: 'true',
        })
        return failure === null
          ? { ok: true, detail: '' }
          : {
              ok: false,
              detail: `${failure.script} exit ${failure.exitCode}：${failure.detail.slice(-400)}`,
            }
      } finally {
        rmSync(overlay, { recursive: true, force: true })
      }
    },
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function flagAll(args: string[], name: string): string[] {
  const out: string[] = []
  args.forEach((a, i) => {
    if (a === name && args[i + 1]) out.push(args[i + 1]!)
  })
  return out
}

function gitOut(cwd: string, ...args: string[]): string | null {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

/** worktree 的 gitignored `.clade/releases` 在主 checkout：沿 git-common-dir 找回去。 */
function mainCheckoutOf(dir: string): string | null {
  const common = gitOut(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  return common ? dirname(common) : null
}

async function cliVerify(args: string[]): Promise<number> {
  const pathsFile = flag(args, '--paths-file')
  if (!pathsFile) return usage()
  const candidates = readFileSync(pathsFile, 'utf8').split('\0').filter(Boolean)
  const out = flag(args, '--out')
  const rev = flag(args, '--rev')
  const repo = flag(args, '--repo')
  let tree = flag(args, '--tree')
  let temp: string | null = null
  const installed = flagAll(args, '--installed-from')
  try {
    let remoteUrl: string | null = null
    if (rev) {
      if (!repo) return usage()
      temp = mkdtempSync(join(tmpdir(), 'projection-exempt-tree-'))
      execFileSync(
        'sh',
        ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh', repo, rev, temp],
        {
          stdio: 'ignore',
          maxBuffer: 1024 * 1024,
        },
      )
      tree = temp
      installed.push(repo)
      remoteUrl = gitOut(repo, 'remote', 'get-url', 'origin')
    } else if (tree) {
      installed.unshift(tree)
      remoteUrl = gitOut(tree, 'remote', 'get-url', 'origin')
    } else {
      return usage()
    }
    for (const dir of [tree, repo]) {
      const main = dir ? mainCheckoutOf(dir) : null
      if (main) {
        installed.push(main)
        remoteUrl ??= gitOut(main, 'remote', 'get-url', 'origin')
      }
    }
    let result: ExemptionResult
    try {
      result = await verifyProjectionExemption({
        tree: tree!,
        candidates,
        installedRoots: [...new Set(installed)],
        remoteUrl,
        deps: await realDeps(),
      })
    } catch (error) {
      result = disabled(
        candidates,
        `驗證失敗：${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const text = `${JSON.stringify(result, null, 2)}\n`
    if (out) writeFileSync(out, text)
    else process.stdout.write(text)
    return 0
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true })
  }
}

function cliRender(args: string[]): number {
  const file = args[0]
  if (!file) return usage()
  let parsed: ExemptionResult | undefined
  try {
    parsed = parseExemptionResult(readFileSync(file, 'utf8'))
  } catch {
    parsed = undefined
  }
  let result: ExemptionResult = parsed ?? {
    schema: 1,
    enabled: false,
    reason: '結果檔讀不懂',
    checked: 0,
    exempt: [],
    residual: [],
  }
  const usable = result.schema === 1 && result.enabled === true && Array.isArray(result.exempt)
  // 防禦：`.clade/` 永遠不豁免（verify 本來就不會給，這裡擋手寫／過期的結果檔）。
  if (usable)
    result = {
      ...result,
      exempt: result.exempt.filter((p) => isSafeRel(p) && !NEVER_EXEMPT.test(p)),
    }
  const pathsOut = flag(args, '--paths-out')
  const summaryOut = flag(args, '--summary-out')
  if (pathsOut) writeFileSync(pathsOut, usable ? result.exempt.map((p) => `${p}\n`).join('') : '')
  if (summaryOut) writeFileSync(summaryOut, usable ? `${renderExemptionSummary(result)}\n` : '')
  if (!usable && result.reason)
    process.stderr.write(`projection-exemption: 未啟用（全部照原路徑審）：${result.reason}\n`)
  return 0
}

/** 結果檔裡的 exempt 路徑（NUL 分隔）印到 stdout：只當 wrapper 的候選提示，豁免與否由 wrapper 重新驗證。 */
function cliHint(args: string[]): number {
  try {
    const result = parseExemptionResult(readFileSync(args[0] ?? '', 'utf8'))
    for (const p of result?.exempt ?? []) {
      if (isSafeRel(p)) process.stdout.write(`${p}\0`)
    }
  } catch {
    // 讀不懂就沒有提示；不影響驗證。
  }
  return 0
}

function usage(): number {
  process.stderr.write(
    'usage: projection-exemption.ts verify (--tree <dir> | --rev <sha> --repo <dir>) --paths-file <z> [--installed-from <dir>]... [--out <json>]\n' +
      '       projection-exemption.ts render <json> [--paths-out <file>] [--summary-out <file>]\n',
  )
  return 2
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...rest] = process.argv.slice(2)
  const code =
    cmd === 'verify'
      ? await cliVerify(rest)
      : cmd === 'render'
        ? cliRender(rest)
        : cmd === 'hint'
          ? cliHint(rest)
          : usage()
  process.exit(code)
}
