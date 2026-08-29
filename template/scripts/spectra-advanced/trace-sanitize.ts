#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/spectra-advanced/trace-sanitize.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/spectra-advanced/trace-sanitize.ts
/**
 * trace-sanitize — 修正 spectra archive 注入的 `@trace` 區塊被污染的 `code:` / `tests:` 清單。
 *
 * ## 問題
 *
 * `spectra archive` 的 delta sync 把 `@trace` 的檔案清單建立在「archive 當下 working tree
 * 的 dirty 檔案」上，而不是該 change 自己的改動範圍。這產生兩層污染（下列佔比與實證取自 <consumer-b> 2026-08-29 全 repo 掃描）：
 *
 * 1. **可執行檔全數誤判為 dirty**（主要污染源，佔 ~90%）。spectra CLI 是 Windows binary
 *    跑在 wine 下，它的 git 實作讀不到 POSIX 的 executable bit，於是 index 裡每個 mode
 *    100755 的檔案都被當成 mode-changed。實證：`machining-session-productresult-pairing`
 *    的 111 條裡有 98 條 = 當時 repo 內全部 104 個可執行 tracked file（扣掉 `.claude/`
 *    底下 5 個被 spectra 排除的），全是 `*.sh` / `.husky/*` / `vendor/snippets/*`。
 * 2. **跨 session WIP 一起入列**。archive 當下 working tree 若有別 session 的未提交改動
 *    （多 session 並行的 repo 是常態），那些檔也會被算成本 change 的依賴。
 *
 * 後果是「改這條規格會影響誰」查出來是一串無關的 shell script，真正的 API handler 與
 * schema 反而被排擠掉，規格追蹤與影響分析同時失真。
 *
 * ## 修法
 *
 * spectra CLI 是 closed-source（`~/.local/lib/spectra/<ver>/spectra.exe`，wine 執行），
 * 改不了它的收集邏輯，因此改在**它寫完之後**把清單重建回正確值：
 *
 * - **重建（優先）**：由 `source:` 的 change name 反查該 change 的實作 commit
 *   （diff 觸及 `openspec/changes/**<change-name>/**` 的 commit），取其非 openspec 檔案聯集，
 *   再分成 code / tests 兩欄。這是有 ground truth 的路徑。
 * - **過濾（fallback）**：重建不到任何檔（change 的 commit 已不可考）時，只把符合污染簽章的
 *   條目刪掉，其餘原樣保留 —— 寧可少刪，不要把真依賴刪掉。
 *
 * ## 用法
 *
 *   node scripts/spectra-advanced/trace-sanitize.ts            # scan，只報告不改檔
 *   node scripts/spectra-advanced/trace-sanitize.ts --fix      # 全 repo 修正
 *   node scripts/spectra-advanced/trace-sanitize.ts --fix --change <name>   # 只修某條 change
 *   node scripts/spectra-advanced/trace-sanitize.ts --json     # 機器可讀輸出
 *
 * exit 0 = 沒有污染 / 已修完；exit 1 = scan 模式下偵測到污染（可掛 gate）。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

interface TraceBlock {
  /** 整段（含 `<!-- @trace` 與 `-->`）在檔案內的起訖 index */
  start: number
  end: number
  raw: string
  source: string | null
  code: string[]
  tests: string[]
}

interface BlockFinding {
  file: string
  source: string | null
  before: { code: number; tests: number }
  after: { code: number; tests: number }
  removed: string[]
  added: string[]
  strategy: 'rebuild' | 'filter' | 'clean'
}

/**
 * 污染簽章。這些路徑在 spec 的 `code:` 追蹤裡從來不是真依賴 —— 它們是 pre-commit /
 * pre-push gate、clade 投影、vendor snippet，與任何一條業務規格的行為無關。
 *
 * 只有在該區塊已被判定為 bulk-polluted（見 `isPolluted`）時才會套用，避免誤刪
 * 「這條 change 真的改了某支 script」的正當條目。
 */
const POLLUTION_PATTERNS = [
  /\.sh$/,
  /^\.husky\//,
  /^\.clade\//,
  /^\.spectra\//,
  /^vendor\/snippets\//,
]

/**
 * 永遠不是規格依賴的路徑。這些是 agent harness 投影（`.claude/` → `.agents/` / `.codex/`）、
 * clade 中央倉散播物、gate script 與 session bookkeeping —— 它們會跟業務改動搭同一班
 * commit，但沒有任何一條 requirement 的行為依賴它們。
 */
const NON_DEPENDENCY_PATTERNS = [
  /^\.agents\//,
  /^\.claude\//,
  /^\.clade\//,
  /^\.codex\//,
  /^\.husky\//,
  /^\.spectra\//,
  /^\.github\//,
  /^vendor\/snippets\//,
  /^screenshots\//,
  /^AGENTS\.md$/,
  /^HANDOFF\.md$/,
  /\.sh$/,
]

/**
 * 單一 commit 的**依賴候選**（扣掉 openspec 與上面那些投影路徑之後）超過這個數量，
 * 視為錨點抓到不乾淨的 commit，不拿它推論 change 依賴。
 *
 * 門檻套在**過濾後**的數量，不是 commit 的總檔數 —— 一支正當的 feature commit 很容易
 * 連同 harness 投影破百，用總檔數當門檻會把它整個丟掉，連帶丟掉真依賴。2026-08-29 實測：
 * 門檻套在總檔數 60 時 `ai-operations-analyst` 只剩 5 個 code 條目，`sql-guard.ts` /
 * `analyst-audit.ts` / `manifest.ts` 這些真依賴全被丟掉（0-A.1 review 判 Major）。
 */
const BULK_COMMIT_FILE_CAP = 120

/**
 * 「像是實作」的根目錄。重建結果**一個都沒命中**這裡、而原清單有，代表錨點沒抓到實作
 * commit（典型成因：該 change 被 park 過，或實作落在別名的 change 底下），此時重建結果
 * 不可信，退回 filter。2026-08-29 實測：`work-report-voided-summary-fix` 的實作其實落在
 * `work-report-summary-exclude-voided` 名下，錨點只撈到 doc commit，重建結果剩一支
 * `vitest.config.ts`（0-A.1 review 判 Major）。
 */
const SOURCE_ROOTS = [/^server\//, /^app\//, /^shared\//, /^layers\//, /^supabase\/migrations\//]

/** 重建結果超過這個數量代表錨點抓到的 commit 不夠乾淨，退回保守的 filter 路徑。 */
const REBUILD_RESULT_CAP = 120

/** bulk 污染的判定門檻：一次 archive 把數十支 script 掃進來才算，單條不算。 */
const BULK_POLLUTION_MIN = 10

/**
 * HEAD 上 mode 100755 的 tracked 檔。這是**污染的直接簽章** —— wine 底下的 spectra 讀不到
 * executable bit，於是每個可執行檔都被當成 mode-changed 掃進來。用實際的 mode 判定比用
 * 副檔名準：`infra/<consumer-b>-app/<consumer-b>-run-nitro-task`、`scripts/postgrest-ready-gate.mjs`、
 * `.clade/bin/vp` 都沒有 `.sh` 結尾，卻是同一個成因掃進來的。
 */
const executableTracked = new Set(
  git(['ls-files', '-s'])
    .split('\n')
    .filter((l) => l.startsWith('100755'))
    .map((l) => l.split('\t').slice(1).join('\t'))
    .filter(Boolean),
)

/** archive 當下幾乎總是 dirty 的 session bookkeeping 檔，不是任何 requirement 的依賴。 */
const BOOKKEEPING_PATTERNS = [
  /^HANDOFF\.md$/,
  /^docs\/tech-debt\.md$/,
  /^docs\/archives\//,
  /^\.editorconfig$/,
]

function isPollutedEntry(p: string): boolean {
  return (
    POLLUTION_PATTERNS.some((re) => re.test(p)) ||
    BOOKKEEPING_PATTERNS.some((re) => re.test(p)) ||
    executableTracked.has(p)
  )
}

function isBulkPolluted(entries: string[]): boolean {
  return entries.filter(isPollutedEntry).length >= BULK_POLLUTION_MIN
}

const TEST_PATTERNS = [
  /^test\//,
  /^tests\//,
  /^e2e\//,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
]

function isTestPath(p: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(p))
}

function git(args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return ''
  }
}

function listSpecFiles(): string[] {
  const out = git([
    'ls-files',
    'openspec/specs/*/spec.md',
    'openspec/changes/archive/*/specs/*/spec.md',
  ])
  return out.split('\n').filter(Boolean)
}

function parseList(body: string, key: 'code' | 'tests'): string[] {
  const re = new RegExp(`^${key}:\\s*$`, 'm')
  const m = re.exec(body)
  if (!m) return []
  const rest = body.slice(m.index + m[0].length)
  const items: string[] = []
  for (const line of rest.split('\n')) {
    if (/^\s*-\s+\S/.test(line)) items.push(line.replace(/^\s*-\s+/, '').trim())
    else if (line.trim() === '') continue
    else if (items.length) break
    else if (/^\w+:/.test(line)) break
  }
  return items
}

function parseBlocks(text: string): TraceBlock[] {
  const blocks: TraceBlock[] = []
  const re = /<!--\s*@trace\n([\s\S]*?)-->/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const body = m[1]!
    const src = /^source:\s*(\S+)\s*$/m.exec(body)
    blocks.push({
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0],
      source: src ? src[1]! : null,
      code: parseList(body, 'code'),
      tests: parseList(body, 'tests'),
    })
  }
  return blocks
}

/**
 * 由 change name 反查它的實作 commit，取非 openspec 的檔案聯集。
 *
 * 一條 change 的實作 commit 在本 repo 的形狀是「同一個 commit 既動 code、也動
 * `openspec/changes/<name>/tasks.md` 的 checkbox」（worktree phase commit 與 archive commit
 * 都是）。因此用「diff 觸及該 change 目錄」當錨點就能把實作 commit 全撈出來。
 */
const rebuildCache = new Map<string, string[] | null>()

function rebuildFromGit(changeName: string): string[] | null {
  if (rebuildCache.has(changeName)) return rebuildCache.get(changeName)!

  // change 目錄可能在 openspec/changes/<name> 或 openspec/changes/archive/<date>-<name>
  const shas = git([
    'log',
    '--format=%H%x09%s',
    '--all',
    '--',
    `openspec/changes/${changeName}`,
    `openspec/changes/archive/*${changeName}`,
  ])
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'))
    // `refs/stash` 的 commit（`index on <branch>` / `WIP on <branch>`）帶的是整棵 working tree
    // 的快照，diff 出來是全 repo 規模的雜訊 —— 它不是任何 change 的實作 commit。
    .filter(([, subject]) => !/^(index on|WIP on|On) /.test(subject ?? ''))
    .map(([sha]) => sha!)

  if (shas.length === 0) {
    rebuildCache.set(changeName, null)
    return null
  }

  const files = new Set<string>()
  for (const sha of shas) {
    const eligible = git(['show', '--name-only', '--format=', '--no-renames', sha])
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean)
      .filter((p) => !p.startsWith('openspec/'))
      .filter((p) => !NON_DEPENDENCY_PATTERNS.some((re) => re.test(p)))
    if (eligible.length > BULK_COMMIT_FILE_CAP) continue
    for (const p of eligible) files.add(p)
  }

  // 重建結果裡指向 HEAD 已不存在的路徑（後來被刪或改名）對影響分析沒有用途，只會變成
  // dangling reference。它們是歷史 commit 的產物，不是本次判斷失誤，直接濾掉。
  const result = [...files].filter((p) => existsSync(path.join(repoRoot, p))).toSorted()
  const usable = result.length > 0 && result.length <= REBUILD_RESULT_CAP ? result : null
  rebuildCache.set(changeName, usable)
  return usable
}

function renderBlock(
  source: string | null,
  updated: string | null,
  code: string[],
  tests: string[],
): string {
  const lines = ['<!-- @trace']
  if (source) lines.push(`source: ${source}`)
  if (updated) lines.push(`updated: ${updated}`)
  lines.push('code:')
  for (const c of code) lines.push(`  - ${c}`)
  if (tests.length) {
    lines.push('tests:')
    for (const t of tests) lines.push(`  - ${t}`)
  }
  lines.push('-->')
  return lines.join('\n')
}

function sanitizeFile(file: string, onlyChange: string | null, apply: boolean): BlockFinding[] {
  const abs = path.join(repoRoot, file)
  const text = readFileSync(abs, 'utf8')
  const blocks = parseBlocks(text)
  const findings: BlockFinding[] = []
  let out = text
  let delta = 0

  for (const b of blocks) {
    if (onlyChange && b.source !== onlyChange) continue
    const all = [...b.code, ...b.tests]
    if (!isBulkPolluted(all)) continue

    const updated = /^updated:\s*(\S+)\s*$/m.exec(b.raw)
    let code: string[]
    let tests: string[]
    let strategy: BlockFinding['strategy']

    const rebuilt = b.source ? rebuildFromGit(b.source) : null
    const originalHadSource = all.some((p) => SOURCE_ROOTS.some((re) => re.test(p)))
    const rebuiltHasSource = (rebuilt ?? []).some((p) => SOURCE_ROOTS.some((re) => re.test(p)))
    if (rebuilt && rebuilt.length && (rebuiltHasSource || !originalHadSource)) {
      code = rebuilt.filter((p) => !isTestPath(p))
      tests = rebuilt.filter(isTestPath)
      strategy = 'rebuild'
    } else {
      code = b.code.filter((p) => !isPollutedEntry(p))
      tests = b.tests.filter((p) => !isPollutedEntry(p))
      strategy = 'filter'
    }

    const beforeSet = new Set(all)
    const afterSet = new Set([...code, ...tests])
    findings.push({
      file,
      source: b.source,
      before: { code: b.code.length, tests: b.tests.length },
      after: { code: code.length, tests: tests.length },
      removed: [...beforeSet].filter((p) => !afterSet.has(p)),
      added: [...afterSet].filter((p) => !beforeSet.has(p)),
      strategy,
    })

    if (apply) {
      const replacement = renderBlock(b.source, updated ? updated[1]! : null, code, tests)
      out = out.slice(0, b.start + delta) + replacement + out.slice(b.end + delta)
      delta += replacement.length - b.raw.length
    }
  }

  if (apply && findings.length) writeFileSync(abs, out)
  return findings
}

function main(): void {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--fix')
  const asJson = argv.includes('--json')
  const ci = argv.indexOf('--change')
  const onlyChange = ci >= 0 ? (argv[ci + 1] ?? null) : null

  const findings: BlockFinding[] = []
  for (const f of listSpecFiles()) findings.push(...sanitizeFile(f, onlyChange, apply))

  if (asJson) {
    console.log(
      JSON.stringify({ mode: apply ? 'fix' : 'scan', blocks: findings.length, findings }, null, 2),
    )
  } else if (findings.length === 0) {
    console.log('trace-sanitize: no polluted @trace blocks found.')
  } else {
    const byFile = new Map<string, BlockFinding[]>()
    for (const f of findings) {
      const arr = byFile.get(f.file) ?? []
      arr.push(f)
      byFile.set(f.file, arr)
    }
    for (const [file, fs] of byFile) {
      console.log(`\n${file}`)
      for (const f of fs) {
        console.log(
          `  [${f.strategy}] source=${f.source ?? '?'} ` +
            `code ${f.before.code}→${f.after.code}, tests ${f.before.tests}→${f.after.tests} ` +
            `(-${f.removed.length} +${f.added.length})`,
        )
      }
    }
    console.log(
      `\n${apply ? 'Fixed' : 'Found'} ${findings.length} polluted @trace block(s) ` +
        `across ${byFile.size} file(s).`,
    )
    if (!apply) console.log('Run with --fix to rewrite.')
  }

  process.exit(apply || findings.length === 0 ? 0 : 1)
}

main()
