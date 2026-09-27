// 🔒 LOCKED — managed by clade · Source: vendor/scripts/checks/consumer-carrier-gate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/checks/consumer-carrier-gate.ts
// CLADE:VENDOR-SCRIPT
//
// consumer-carrier-gate — consumer 舊載體（docs/、新 TD、未結 HANDOFF）的**唯一**判定式
//
// 三個消費端共用這一份，NEVER 各寫一份判準（W-2026-09-20-consumer-lifecycle-migration FR-035）：
//   - consumer pre-commit：`scripts/pre-commit/checks/consumer-carriers.sh` → 本檔 `--staged`
//   - consumer PR／CI：本檔 `--against <ref>`
//   - fleet 驗收：#412 `evidence/verify-fleet-adoption.ts` 直接 import 下列 export
//
// 判準（spec FR-018／FR-025／FR-026／FR-028）：
//   docs      路徑符合 `(^|/)docs/` 且不在 `specs/truth/docs/` 下。根、巢狀、template、app 都算。
//   new TD    本次變更新定義、而基準樹任何 tracked 檔都沒出現過的 `TD-<n>` 條目。
//             把既有 TD 搬進 plan § Open work 放行；新開一條擋下。
//   HANDOFF   未勾 checkbox，或不指向本 repo 現役 W- plan 的頂層項。
//
// 啟用條件（未啟用 = exit 0，不出聲）：
//   docs      基準樹已沒有任何 docs 路徑（這台已退役）——遷移中的 consumer 不被卡住；
//             沒有基準（repo 的第一個 commit）不算退役，不啟用
//   new TD    repo root 有 `specs/truth/work-lifecycle.md`（lifecycle repo 禁開新 TD）
//   HANDOFF   lifecycle repo 且本次改到 `HANDOFF.md`：擋**新出現**的未結項；基準版已有的
//             舊存量可留可刪（手寫或產生都一樣，renderer 不是必要條件——#412 C5 裁決）
//
// 刪除與搬出一律放行：退役存量要走得出去。
//
// 由 ~/clade vendor/scripts/checks/ 散播，請勿直接編輯 consumer 副本。

import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const TRUTH_DOCS_PREFIX = 'specs/truth/docs/'
export const LIFECYCLE_MARKER = 'specs/truth/work-lifecycle.md'

/**
 * 投影判定直接讀 `vendor/oxc-shared/preset.ts` 的 `isStagedExcluded`（`PROJECTION_EXCLUDES` ∪
 * `STAGED_ONLY_EXCLUDES`：`.claude/` `.clade/` `.spectra/` `vendor/` `specs/errors/` `.agents/`
 * `.codex/` `.cursor/`、投影到 root `scripts/` 的 vendor script、LOCKED `AGENTS.md`）。
 * NEVER 在這裡手寫一份平行前綴清單——那份清單就是下次漂掉的那份（TD-310／TD-777 同型）。
 *
 * preset 位置用本檔所在目錄推（同 `pre-commit/staged-targets.ts`）：consumer 端本檔在
 * `scripts/checks/`、clade 源檔在 `vendor/scripts/checks/`，preset 兩邊都在 `vendor/oxc-shared/`。
 * 找不到就 throw：拿不到投影清單時靜默放行會把投影檔誤判成 consumer 新增的 TD／docs。
 */
const here = dirname(fileURLToPath(import.meta.url))
const PRESET_CANDIDATES = [
  join(here, '..', '..', 'vendor', 'oxc-shared', 'preset.ts'),
  join(here, '..', '..', 'oxc-shared', 'preset.ts'),
]
const presetPath = PRESET_CANDIDATES.find((p) => existsSync(p))
if (!presetPath) {
  throw new Error(
    `consumer-carrier-gate: 找不到 vendor/oxc-shared/preset.ts（找過：${PRESET_CANDIDATES.join('、')}）`,
  )
}
const preset = (await import(pathToFileURL(presetPath).href)) as {
  isStagedExcluded?: unknown
}
if (typeof preset.isStagedExcluded !== 'function') {
  throw new Error(`consumer-carrier-gate: ${presetPath} 沒有匯出 isStagedExcluded(file)`)
}
const isStagedExcluded = preset.isStagedExcluded as (file: string) => boolean

export interface Violation {
  kind: 'docs' | 'new-td' | 'handoff'
  path: string
  detail: string
}

/** `(^|/)docs/` 且不在 `specs/truth/docs/` 下。輸入是 repo 相對、`/` 分隔的檔案路徑。 */
export function isRetiredDocsPath(path: string): boolean {
  const p = path.replace(/^\.\//, '')
  if (p.startsWith(TRUTH_DOCS_PREFIX)) return false
  return p.startsWith('docs/') || p.includes('/docs/')
}

/** clade 投影落點：內容由 clade 源頭負責，consumer gate（docs 與新 TD 兩條）都不判 */
export function isProjectedPath(path: string): boolean {
  return isStagedExcluded(path.replace(/^\.\//, ''))
}

/**
 * TD 條目的定義行（不是提及）。前兩式同 clade `vendor/scripts/td-number.ts` numberOccurrences；
 * 後兩式是 consumer 常見的 HANDOFF／表格寫法。`see TD-12` 這種行內提及不算條目。
 */
const TD_ENTRY_PATTERNS = [
  /^#{2,4} TD-(\d+)\b/gm,
  /^TD-(\d+):/gm,
  /^\s*[-*] (?:\[[ xX]\] )?\**TD-(\d+)\b/gm,
  /^\|\s*\**TD-(\d+)\b/gm,
]

export function tdEntryIds(text: string | null): Set<number> {
  const out = new Set<number>()
  if (text === null) return out
  for (const re of TD_ENTRY_PATTERNS) {
    for (const m of text.matchAll(re)) out.add(Number(m[1]))
  }
  return out
}

/** 基準樹上出現過的所有 TD 編號（任何形式、任何檔）——判「新」的分母 */
export function tdMentionIds(text: string): Set<number> {
  return new Set([...text.matchAll(/\bTD-(\d+)\b/g)].map((m) => Number(m[1])))
}

export interface ChangedFile {
  path: string
  /** 變更後內容；二進位或讀不到為 null */
  after: string | null
}

export function findDocsViolations(changedPaths: string[]): Violation[] {
  return changedPaths
    .filter((p) => isRetiredDocsPath(p) && !isProjectedPath(p))
    .map((path) => ({
      kind: 'docs' as const,
      path,
      detail: 'consumer 不得有 docs 目錄（唯一例外 specs/truth/docs/）',
    }))
}

export function findNewTdViolations(changed: ChangedFile[], knownAtBase: Set<number>): Violation[] {
  const out: Violation[] = []
  for (const { path, after } of changed) {
    if (isProjectedPath(path)) continue
    for (const n of tdEntryIds(after)) {
      if (!knownAtBase.has(n)) {
        out.push({ kind: 'new-td', path, detail: `新增了 TD-${n}（lifecycle repo 不開新 TD）` })
      }
    }
  }
  return out
}

export const WORK_ID_RE = /\bW-\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*/g

export interface HandoffOpenItem {
  line: number
  text: string
  reason: 'unchecked' | 'no-active-plan'
}

/**
 * FR-028 的未結 HANDOFF 項：任何未勾 checkbox，或頂層項（欄 0 的 `-`／`*`／`1.`）沒有指向
 * `activePlanIds` 其中之一。頂層項底下的縮排子項跟著父項判，不各自要求 W- id。
 */
export function handoffOpenItems(text: string, activePlanIds: Set<string>): HandoffOpenItem[] {
  const out: HandoffOpenItem[] = []
  const lines = text.split('\n')
  let inFence = false
  lines.forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) inFence = !inFence
    if (inFence) return
    if (/^\s*[-*] \[ \]/.test(raw) || /^\s*\d+\. \[ \]/.test(raw)) {
      out.push({ line: i + 1, text: raw.trim(), reason: 'unchecked' })
      return
    }
    if (!/^(?:[-*]|\d+\.) /.test(raw)) return
    const ids = [...raw.matchAll(WORK_ID_RE)].map((m) => m[0])
    if (!ids.some((id) => activePlanIds.has(id))) {
      out.push({ line: i + 1, text: raw.trim(), reason: 'no-active-plan' })
    }
  })
  return out
}

/** `specs/plans/<W-id>/plan.md` frontmatter `status:` 非終態者為現役 */
export const TERMINAL_PLAN_STATUS = new Set(['closed', 'dropped', 'cancelled', 'superseded'])

export function planIsActive(planMd: string): boolean {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(planMd)
  if (!fm || !/^work_id:/m.test(fm[1])) return false
  // 值可能帶引號（`status: "closed"`）；CRLF 由上面的 \r? 與這裡的 [^\s"'] 一起吃掉
  const status = /^status:\s*["']?([^\s"']+)/m.exec(fm[1])?.[1] ?? 'active'
  return !TERMINAL_PLAN_STATUS.has(status)
}

export const HANDOFF = 'HANDOFF.md'

/**
 * 變更後 HANDOFF 的未結項中，基準版沒有的那些（以去頭尾空白的行文字比對）。
 * 舊存量是遷移要處置的 legacy，不在這裡擋；新寫進來的自由項／未勾項才是重建。
 */
export function findHandoffViolations(
  base: string | null,
  after: string,
  activePlanIds: Set<string>,
): Violation[] {
  const legacy = new Set(
    base === null ? [] : handoffOpenItems(base, activePlanIds).map((i) => i.text),
  )
  return handoffOpenItems(after, activePlanIds)
    .filter((i) => !legacy.has(i.text))
    .map((i) => ({
      kind: 'handoff' as const,
      path: `${HANDOFF}:${i.line}`,
      detail:
        i.reason === 'unchecked'
          ? `新的未勾項「${i.text}」——待辦寫進 plan § Open work`
          : `頂層項「${i.text}」沒有指向現役 W- plan`,
    }))
}

// ── git 取證（CLI 用；fleet verifier 可直接呼叫 collect） ───────────────────────────

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

function zList(out: string | null): string[] {
  return (out ?? '').split('\0').filter(Boolean)
}

export interface GateInput {
  /** 本次新增、修改、改名落腳的路徑（不含刪除） */
  changedPaths: string[]
  changed: ChangedFile[]
  /** 基準樹 tracked 路徑中的 docs 路徑數；>0 表示這台尚未退役；null＝沒有基準（第一個 commit），不啟用 */
  baseDocsCount: number | null
  knownTdAtBase: Set<number>
  lifecycleRepo: boolean
  /** 本次改到 HANDOFF.md 時的基準版／變更後內容與現役 plan；沒改到為 null */
  handoff: { base: string | null; after: string; activePlanIds: Set<string> } | null
}

export function collect(root: string, mode: { staged: true } | { against: string }): GateInput {
  let base: string
  let changedPaths: string[]
  let read: (path: string) => string | null
  let listPlans: () => string[]
  if ('staged' in mode) {
    base = git(root, ['rev-parse', '-q', '--verify', 'HEAD'])?.trim() ?? ''
    changedPaths = zList(git(root, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']))
    read = (p) => git(root, ['show', `:${p}`])
    listPlans = () => zList(git(root, ['ls-files', '-z', '--', 'specs/plans/*/plan.md']))
  } else {
    base = git(root, ['merge-base', 'HEAD', mode.against])?.trim() ?? ''
    if (!base) throw new Error(`cannot resolve merge-base(HEAD, ${mode.against})`)
    changedPaths = zList(
      git(root, ['diff', '--name-only', '-z', '--diff-filter=ACMR', base, 'HEAD']),
    )
    read = (p) => git(root, ['show', `HEAD:${p}`])
    listPlans = () =>
      zList(git(root, ['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', 'specs/plans']))
  }
  const baseFiles = base ? zList(git(root, ['ls-tree', '-r', '--name-only', '-z', base])) : []
  const baseDocsCount = base ? baseFiles.filter((p) => isRetiredDocsPath(p)).length : null
  const lifecycleRepo = existsSync(join(root, LIFECYCLE_MARKER))
  const knownTdAtBase = new Set<number>()
  if (lifecycleRepo && base) {
    // git grep -h -o：只取命中字串，不把整份檔案讀進來。pattern 不用 `\b`（GNU 擴充，非 GNU
    // regex 的 git build 會零命中且不出聲）；邊界由 tdMentionIds 再過濾一次
    const hits = git(root, ['grep', '-h', '-o', '-E', '-I', 'TD-[0-9]+', base, '--']) ?? ''
    for (const n of tdMentionIds(hits)) knownTdAtBase.add(n)
  }
  const changed = lifecycleRepo
    ? changedPaths.filter((p) => !isProjectedPath(p)).map((path) => ({ path, after: read(path) }))
    : []
  let handoff: GateInput['handoff'] = null
  const handoffAfter = lifecycleRepo && changedPaths.includes(HANDOFF) ? read(HANDOFF) : null
  if (handoffAfter !== null) {
    const activePlanIds = new Set<string>()
    for (const p of listPlans()) {
      const m = /^specs\/plans\/(W-[^/]+)\/plan\.md$/.exec(p)
      const body = m ? read(p) : null
      if (m && body !== null && planIsActive(body)) activePlanIds.add(m[1])
    }
    const baseHandoff = base ? git(root, ['show', `${base}:${HANDOFF}`]) : null
    handoff = { base: baseHandoff, after: handoffAfter, activePlanIds }
  }
  return { changedPaths, changed, baseDocsCount, knownTdAtBase, lifecycleRepo, handoff }
}

export function evaluate(input: GateInput): Violation[] {
  return [
    ...(input.baseDocsCount === 0 ? findDocsViolations(input.changedPaths) : []),
    ...(input.lifecycleRepo ? findNewTdViolations(input.changed, input.knownTdAtBase) : []),
    ...(input.handoff
      ? findHandoffViolations(input.handoff.base, input.handoff.after, input.handoff.activePlanIds)
      : []),
  ]
}

export function formatViolations(violations: Violation[]): string {
  return [
    `consumer-carrier-gate: ${violations.length} 筆寫入已退役的載體`,
    ...violations.map((v) => `  ✗ ${v.path} — ${v.detail}`),
    '',
    '  改寫到現行載體（specs/truth/work-lifecycle.md）：',
    '    現行、持續維護的說明 → specs/truth/docs/** 或其他有 owner 的 truth 路徑',
    '    延續中的工作／待辦   → specs/plans/<work-id>/plan.md § Open work',
    '    接受不修的限制       → specs/truth/accepted-limits.md',
    '    舊 TD 的去向         → specs/truth/legacy-ids.json',
    '    HANDOFF.md           → 每個頂層項指向現役 W- plan、沒有未勾項（FR-028）',
    '  cookbook：~/offline/clade/vendor/snippets/consumer-lifecycle/README.md',
  ].join('\n')
}

const USAGE = 'usage: consumer-carrier-gate (--staged | --against <ref>) [--root <dir>]'

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
  const againstIdx = args.indexOf('--against')
  const mode = args.includes('--staged')
    ? ({ staged: true } as const)
    : againstIdx >= 0 && args[againstIdx + 1]
      ? { against: args[againstIdx + 1] }
      : null
  if (!mode || !root) {
    process.stderr.write(`${USAGE}\n`)
    process.exit(2)
  }
  const violations = evaluate(collect(root, mode))
  if (violations.length > 0) {
    process.stderr.write(`${formatViolations(violations)}\n`)
    process.exit(1)
  }
}
