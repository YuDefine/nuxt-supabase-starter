#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/review-rules/scan.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/review-rules/scan.ts
// CLADE:VENDOR-SCRIPT

/**
 * scan.mjs — review-rules 統一掃描引擎
 *
 * 讀 vendor/review-rules/patterns.json 的 `rules` 陣列（`semantic` 陣列是給 reviewer /
 * code-review agent 的語意兜底清單，本引擎不消費），對指定檔案集逐條跑 pattern 比對，
 * 支援四個入口薄殼共用（DRY，見 propagate-maintenance-mode 三問）：
 *
 *   - pre-commit（scripts/pre-commit/checks/review-rules-ban.sh）
 *       node scan.mjs --staged --layer pre-commit
 *   - pre-push（scripts/pre-push/checks/review-rules-ratchet.sh）
 *       node scan.mjs --all --layer all --ratchet
 *   - CI backstop（vendor/actions/review-rules-scan/action.yml）
 *       node scan.mjs --all --layer all --ratchet
 *   - ad-hoc / audit（人工或其他 script 呼叫）
 *       node scan.mjs [--staged|--all] [--layer ...] [--json]
 *
 * CLI:
 *   node scan.mjs [--staged|--all] [--layer pre-commit|ratchet|all] [--ratchet]
 *                 [--write-baseline] [--json] [--help]
 *
 *   --staged          掃 git diff --cached --name-only --diff-filter=ACM
 *   --all             掃 git ls-files（全 tracked 檔；預設，--staged/--all 未給時走這個）
 *   --layer           只跑指定 layer 的規則；entry 缺 layer 欄位視為 pre-commit（向後相容
 *                     既有規則）；'all' 不過濾（預設）
 *   --ratchet         讀 <root>/review-rules-baseline.json（{ruleId: {file: count}}），
 *                     實際命中數 > baseline（缺 entry 視為 0）才算違規；只回報「新增」的部分
 *   --write-baseline  把當前命中數寫成新 baseline；命中數為 0 時寫入空 {}（檔案存在=武裝）
 *   --json            機器可讀 JSON 輸出到 stdout；未給則人讀 markdown 輸出到 stderr
 *
 * fileGlob 支援：
 *   - 舊有精確字串：`*.vue`（後綴匹配）、`app.config.*`（任意深度 basename 匹配，沿用
 *     既有 review-rules-ban.sh 行為，不經泛化引擎，避免既有 9 條規則行為漂移）
 *   - 目錄前綴泛化：`server/**`、`shared/**`、`app/**`、`server/api/**` 等——`**` 展開為
 *     任意路徑深度、`*` 為單一路徑段；另外會自動嘗試剝除 `packages/<name>/` 與 `template/`
 *     前綴後再比對一次，涵蓋 monorepo / starter template 變體（比照 nuxt-review-bans.md
 *     frontmatter `paths` 現有的多變體列舉精神）
 *
 * entry 可選欄位：
 *   - `layer`: "pre-commit" | "ratchet" | "audit"（缺省 = "pre-commit"）
 *   - `scanPaths`: string[]（既有機制，對 fileGlob 篩出的檔再做目錄前綴限縮；支援 `*`
 *     作單一路徑段萬用字元，例如 "packages/*\/app/"）
 *   - `exclude`: string[]（glob 陣列，命中即整檔跳過該規則，不比對 pattern；用於豁免
 *     helper / test 檔）
 *   - `excludePattern`: string（既有機制，regex 對「命中行/tag 文字」做內容層排除，
 *     跟 `exclude` 的路徑層排除不同層次）
 *   - `multiLine`: true（顯式指定跨行 tag 展平；未給則用 needsMultiLine() 對 `<Tag...` 形式
 *     pattern 的既有 heuristic 自動判斷，行為與舊 review-rules-ban.sh 一致）
 *
 * 路徑基準一律是 **consumerRoot**（本檔所在的 `<consumerRoot>/vendor/review-rules/` 往上兩層），
 * 不是 git toplevel——monorepo 子目錄 consumer 兩者不同，見 resolveConsumerRoot() 的註解。
 *
 * Baseline 檔格式（consumerRoot 底下，不在 vendor/ 內——一個 consumer 一份 ratchet 現況）：
 *   { "<ruleId>": { "<file>": <count>, ... }, ... }
 *
 * Exit code:
 *   0 — 乾淨 / ratchet 通過 / write-baseline 成功
 *   1 — 非 ratchet 模式下，篩選後規則有 severity=error 命中（沿用舊 review-rules-ban.sh 契約）
 *   2 — --ratchet 模式下，實際命中數 > baseline（新增違規）
 *   3 — 用法錯誤 / 內部錯誤（bad args、JSON 解析失敗等）
 *
 * patterns.json 不存在（consumer 尚未 propagate）→ exit 0，不視為錯誤。輸出**一律帶找過的
 * 絕對路徑**（`--json` 走 `patternsPath` / `consumerRoot` 欄位，人讀走 stderr 一行），讓
 * 「尚未 propagate」與「路徑解錯」在輸出上可區分。
 *
 * 由 ~/clade vendor/review-rules/ 散播，請勿直接編輯 consumer 副本。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRecord } from '../scripts/lib/json-unknown.ts'

class UsageError extends Error {}

// 本檔會落在 consumer repo 的 `vendor/` 下，被對方的 `noImplicitAny` typecheck 涵蓋。
// 參數與資料結構 **MUST** 各自帶 inline 結構型別，否則散播後直接讓 consumer 的
// typecheck 紅燈（<consumer-a> 2026-07-31 實證，同 commitlint.config.ts 的既有註記）。
// clade 中央倉自己沒有 typecheck script，這類缺陷只會在 consumer 端才炸。
type Rule = {
  id: string
  pattern: string
  severity?: string
  section?: string
  layer?: string
  message?: string
  fix?: string
  fileGlob?: string
  scanPaths?: string[]
  exclude?: string[]
  excludePattern?: string
  multiLine?: boolean
}

type Hit = { file: string; line: number; text: string }

type Violation = {
  ruleId: string
  severity?: string
  section?: string
  layer: string
  file: string
  line: number
  text: string
  message?: string
  fix?: string
}

/** `{ ruleId: { file: 命中數 } }` */
type Baseline = Record<string, Record<string, number>>

type ReadFile = (file: string) => string

const LEGACY_VUE_GLOB = '*.vue'
const LEGACY_CONFIG_GLOB = 'app.config.*'
const REGEX_SPECIAL = /[.+^${}()|[\]\\]/

// ---------- glob matching ----------

function escapeRegExpChar(ch: string) {
  return REGEX_SPECIAL.test(ch) ? `\\${ch}` : ch
}

/** 把泛化 glob（`**`＝任意路徑深度、`*`＝單一路徑段）轉成錨定 RegExp。 */
function globToRegExp(glob: string) {
  let src = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i] ?? ''
    if (ch === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        src += '(?:.*/)?'
        i += 2
      } else {
        src += '.*'
        i += 1
      }
    } else if (ch === '*') {
      src += '[^/]*'
    } else {
      src += escapeRegExpChar(ch)
    }
  }
  return new RegExp(`^${src}$`)
}

/**
 * fileGlob 是否匹配 file（repo-root-relative path）。
 * `*.vue` / `app.config.*` 保留既有 review-rules-ban.sh 精確語意；其餘走泛化引擎，
 * 並自動嘗試剝除 packages/<name>/、template/ 前綴（monorepo / starter 變體）。
 */
function matchFileGlob(file: string, glob: string) {
  if (glob === LEGACY_VUE_GLOB) return file.endsWith('.vue')
  if (glob === LEGACY_CONFIG_GLOB) return /(?:^|\/)app\.config\.[^/]+$/.test(file)

  const regex = globToRegExp(glob)
  if (regex.test(file)) return true

  const packagesMatch = file.match(/^packages\/[^/]+\/(.*)$/)
  if (packagesMatch?.[1] !== undefined && regex.test(packagesMatch[1])) return true

  const templateMatch = file.match(/^template\/(.*)$/)
  if (templateMatch?.[1] !== undefined && regex.test(templateMatch[1])) return true

  return false
}

function matchAnyGlob(file: string, globs: string[]) {
  return globs.some((g) => matchFileGlob(file, g))
}

/** scanPaths 用的前綴 RegExp（`*` = 單一路徑段萬用字元，不錨定結尾，只錨定開頭）。 */
function scanPathToRegExp(prefix: string) {
  let src = '^'
  for (const ch of prefix) {
    src += ch === '*' ? '[^/]*' : escapeRegExpChar(ch)
  }
  return new RegExp(src)
}

function matchesAnyScanPath(file: string, scanPaths: string[]) {
  return scanPaths.some((p) => scanPathToRegExp(p).test(file))
}

// ---------- multiLine tag 展平（既有 review-rules-ban.sh heuristic，逐字沿用） ----------

/** pattern 是否為 `<Tag[^>]*...` 形式（跨屬性匹配），需要先把 tag 展平成單行。 */
function needsMultiLine(pattern: string) {
  return /^<[[(]?[A-Z].*\[\^>\]/.test(pattern)
}

/** 從內容抽出每個 HTML/Vue tag 區塊（含起始行號），並把跨行屬性展平成單行。
 *  抓兩類：(1) PascalCase 元件 `<UBadge ...>` (2) 含 `:is=` 的動態元件 `<component :is="UBadge" ...>` */
function extractTags(content: string) {
  const tags: { line: number; flat: string }[] = []
  const re = /<(?:[A-Z][A-Za-z]*|[a-z][a-z-]*(?=[\s\n](?:[^>]|\n)*:is=))(?:\s|\n)(?:[^>]|\n)*?\/?>/g
  let m
  while ((m = re.exec(content)) !== null) {
    const before = content.slice(0, m.index)
    const line = before.split('\n').length
    const flat = m[0].replace(/\n\s*/g, ' ')
    tags.push({ line, flat })
  }
  return tags
}

// ---------- 核心掃描 ----------

/** 單一 rule 對候選檔案清單跑比對，回傳 hit 陣列（不含 rule 中繼資料）。 */
function scanRuleOnFiles(rule: Rule, files: string[], readFile: ReadFile): Hit[] {
  const re = new RegExp(rule.pattern)
  const excludeContentRe = rule.excludePattern ? new RegExp(rule.excludePattern) : null
  const multiLine = rule.multiLine === true || needsMultiLine(rule.pattern)

  let candidates = files.filter((f) => matchFileGlob(f, rule.fileGlob || LEGACY_VUE_GLOB))
  const scanPaths = rule.scanPaths
  if (scanPaths && scanPaths.length > 0) {
    candidates = candidates.filter((f) => matchesAnyScanPath(f, scanPaths))
  }
  const exclude = rule.exclude
  if (exclude && exclude.length > 0) {
    candidates = candidates.filter((f) => !matchAnyGlob(f, exclude))
  }
  if (candidates.length === 0) return []

  const hits: Hit[] = []
  for (const file of candidates) {
    let content: string
    try {
      content = readFile(file)
    } catch {
      continue // 檔案讀不到（例如已刪除但仍留在檔案清單）→ 略過
    }

    if (multiLine) {
      for (const tag of extractTags(content)) {
        if (!re.test(tag.flat)) continue
        if (excludeContentRe && excludeContentRe.test(tag.flat)) continue
        hits.push({ file, line: tag.line, text: tag.flat.slice(0, 120) })
      }
    } else {
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? ''
        if (!re.test(line)) continue
        if (excludeContentRe && excludeContentRe.test(line)) continue
        hits.push({ file, line: i + 1, text: line.trim().slice(0, 200) })
      }
    }
  }
  return hits
}

/** 對整批 rules 跑掃描，回傳攤平後的 violation 陣列。 */
function scan(rules: Rule[], files: string[], readFile: ReadFile): Violation[] {
  const violations: Violation[] = []
  for (const rule of rules) {
    const hits = scanRuleOnFiles(rule, files, readFile)
    for (const h of hits) {
      violations.push({
        ruleId: rule.id,
        severity: rule.severity,
        section: rule.section,
        layer: rule.layer || 'pre-commit',
        file: h.file,
        line: h.line,
        text: h.text,
        message: rule.message,
        fix: rule.fix,
      })
    }
  }
  return violations
}

// ---------- ratchet baseline ----------

function loadBaseline(baselinePath: string): Baseline {
  if (!existsSync(baselinePath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(baselinePath, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Baseline) : {}
  } catch (err) {
    process.stderr.write(
      `⚠️  review-rules-baseline.json 解析失敗，視為空 baseline（等同零容忍）：${(err as Error).message}\n`,
    )
    return {}
  }
}

function buildBaselineFromViolations(violations: Violation[]): Baseline {
  const baseline: Baseline = {}
  for (const v of violations) {
    const byFile = (baseline[v.ruleId] ??= {})
    byFile[v.file] = (byFile[v.file] || 0) + 1
  }
  return baseline
}

function writeBaselineFile(
  baselinePath: string,
  baseline: Baseline,
  scope: { fileset: string; layer: string },
) {
  // 空 baseline 也寫入 {}——「檔案存在」= ratchet 武裝訊號（零容忍）；
  // 檔案不存在 = bootstrap warn-only（見 main 的 ratchet 分支）。
  //
  // `_meta` 記錄寫入時的掃描範圍，讓 baseline 自我描述。ruleId 不會是 `_meta`，
  // 所以 compareRatchet 的查表不受影響；ruleCount 另外扣掉。
  const payload = { _meta: { ...scope }, ...baseline }
  writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return { written: true, empty: Object.keys(baseline).length === 0 }
}

/** 只回報「實際命中數 > baseline」的 (ruleId, file) — 既有存量違規（≤ baseline）不報。 */
function compareRatchet(baseline: Baseline | null, violations: Violation[]) {
  const actual = buildBaselineFromViolations(violations)
  const overages: { ruleId: string; file: string; baseline: number; actual: number }[] = []
  for (const [ruleId, fileCounts] of Object.entries(actual)) {
    for (const [file, count] of Object.entries(fileCounts)) {
      const baselineCount = baseline?.[ruleId]?.[file] ?? 0
      if (count > baselineCount) {
        overages.push({ ruleId, file, baseline: baselineCount, actual: count })
      }
    }
  }
  return overages
}

// ---------- git helpers ----------

// consumerRoot = 這份 scan.ts 被 propagate 到哪個 consumer 根目錄下。
//
// **NEVER 改回 `git rev-parse --show-toplevel`**：那個假設只在「consumer 根目錄 == git
// 工作區根目錄」時成立，而 monorepo 子目錄 consumer（registry target 是
// `<repo>/template` 這類）恆不成立 —— toplevel 會解到上一層，於是
//   ① patternsPath 永遠找不到（走 § patterns.json 不存在的靜默出口，與「尚未 propagate」同形）
//   ② 掃描範圍變成整個 monorepo（含 consumer 目錄外的檔）
//   ③ `DEFAULT_EXCLUDE_RE` 的 `^vendor/` 對 `template/vendor/…` 失效 → cookbook 註解誤觸規則
// 三者一起壞，而輸出上看起來只是「這個 consumer 還沒收到 patterns.json」（TD-428）。
//
// script 位置是唯一與 consumer 根目錄綁定的事實：本檔恆在 `<consumerRoot>/vendor/review-rules/`。
function resolveConsumerRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

// vendor/ 是 clade 投影/cookbook（含帶說明註解的 .vue template），永遠不是 consumer
// 業務碼——全域排除，防 cookbook 註解文字誤觸規則（如 dark-mode 規則咬到範例說明）。
const DEFAULT_EXCLUDE_RE = /^(vendor|node_modules)\//

/**
 * `--include <glob>`（可重複）把預設排除掉的路徑重新納入。
 *
 * 存在的理由是 **clade home 自己**：上面那條排除說「vendor/ 是 clade 投影/cookbook，永遠不是
 * consumer 業務碼」，這句話在每個 consumer 上都對，在 clade 自己身上卻剛好相反 —— clade 唯一
 * 的 `.vue` 全部住在 `vendor/review-gui-web/`，它是源檔不是投影。結果是這支掃描器散播給 11 個
 * consumer 保護他們的 `.vue`，而**寫規則的那個 repo 自己的 `.vue` 沒有任何東西在掃**。
 *
 * 做成 opt-in flag 而不是改 `DEFAULT_EXCLUDE_RE` 的語意：後者是 fleet-wide 行為改動，會讓每個
 * consumer 的 cookbook 範例註解開始誤觸規則（TD-428 那條註解記的正是這個失敗）。沒傳 flag 的
 * 呼叫端 —— 也就是所有 consumer —— 行為逐位元不變。
 */
function excluded(file: string, include: string[]): boolean {
  if (!DEFAULT_EXCLUDE_RE.test(file)) return false
  return include.length === 0 || !matchAnyGlob(file, include)
}

// 兩支都回 **consumerRoot 相對**路徑（readFile 直接 join consumerRoot 就能讀）。
// `git ls-files` 天生就是 cwd 相對 + 限縮到 cwd 以下；`git diff` 不是（預設吐 repo root
// 相對、且不限縮），所以 staged 那支 **MUST 帶 `--relative`** 才對齊。consumerRoot ==
// git toplevel 的一般 consumer 上，`--relative` 與不帶完全同義（cwd 就是 root）。
function gitStagedFiles(consumerRoot: string, include: string[]) {
  const out = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACM', '--relative'],
    {
      cwd: consumerRoot,
      encoding: 'utf8',
    },
  )
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => !excluded(f, include))
}

function gitAllFiles(consumerRoot: string, include: string[]) {
  const out = execFileSync('git', ['ls-files'], { cwd: consumerRoot, encoding: 'utf8' })
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => !excluded(f, include))
}

// ---------- output ----------

function printHuman(violations: Violation[]) {
  if (violations.length === 0) {
    process.stderr.write('✅ 未發現違規\n')
    return
  }
  const byRule = new Map<string, Violation[]>()
  for (const v of violations) {
    const bucket = byRule.get(v.ruleId)
    if (bucket) bucket.push(v)
    else byRule.set(v.ruleId, [v])
  }
  for (const [ruleId, vs] of byRule) {
    const head = vs[0]
    if (!head) continue
    const icon = head.severity === 'error' ? '❌' : '⚠️'
    process.stderr.write(`${icon} [${ruleId}] ${head.message}\n`)
    for (const v of vs) {
      process.stderr.write(`  ${v.file}:${v.line}: ${v.text}\n`)
    }
    if (head.fix) process.stderr.write(`  Fix: ${head.fix}\n`)
    process.stderr.write('\n')
  }
}

function printRatchetReport(
  overages: { ruleId: string; file: string; baseline: number; actual: number }[],
) {
  if (overages.length === 0) {
    process.stderr.write('✅ ratchet baseline 通過（無新增違規）\n')
    return
  }
  process.stderr.write(`❌ ratchet baseline 超標（${overages.length} 項新增違規）：\n`)
  for (const o of overages) {
    process.stderr.write(`  [${o.ruleId}] ${o.file} — baseline ${o.baseline} → 實際 ${o.actual}\n`)
  }
  process.stderr.write(
    '\n修法：修掉新增違規；若本次調整合理需重新收斂 baseline，跑 --write-baseline（需審視是否真的該放行，不要無腦提高容忍度）。\n',
  )
}

function usage() {
  return `scan.mjs — review-rules 統一掃描引擎

用法：
  node scan.mjs [--staged|--all] [--layer pre-commit|ratchet|all] [--ratchet]
                [--include <glob>]... [--write-baseline] [--json] [--help]

範例：
  node scan.mjs --staged --layer pre-commit                 # pre-commit hook
  node scan.mjs --all --layer all --ratchet                  # pre-push / CI ratchet gate
  node scan.mjs --all --layer all --write-baseline           # 收斂 baseline
  node scan.mjs --all --layer pre-commit --json              # 機器可讀全站掃描
  node scan.mjs --all --layer all --ratchet \\
    --include 'vendor/review-gui-web/**'                     # clade home 自己的 .vue（見 excluded()）
`
}

// ---------- main ----------

function main() {
  const argv = process.argv.slice(2)

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(usage())
    return
  }

  const wantStaged = argv.includes('--staged')
  const wantAll = argv.includes('--all')
  if (wantStaged && wantAll) {
    throw new UsageError('--staged 與 --all 不可同時指定')
  }
  const fileset = wantStaged ? 'staged' : 'all'

  const layerIdx = argv.indexOf('--layer')
  const layer = (layerIdx >= 0 ? argv[layerIdx + 1] : 'all') ?? ''
  if (!['pre-commit', 'ratchet', 'all'].includes(layer)) {
    throw new UsageError(`--layer 值不合法：${layer}（合法值：pre-commit | ratchet | all）`)
  }

  // 可重複：`--include a/** --include b/**`。只有明確傳了才會重新納入被預設排除的路徑。
  const include = argv.flatMap((a, i) => (a === '--include' && argv[i + 1] ? [argv[i + 1]] : []))

  const wantRatchet = argv.includes('--ratchet')
  const wantWriteBaseline = argv.includes('--write-baseline')
  const wantJson = argv.includes('--json')

  const consumerRoot = resolveConsumerRoot()
  const patternsPath = join(consumerRoot, 'vendor', 'review-rules', 'patterns.json')

  if (!existsSync(patternsPath)) {
    // 訊息 **MUST 帶找過的絕對路徑**：這條出口原本是為「consumer 尚未 propagate」設計的，
    // 但任何路徑解析失誤都走同一條，兩種狀態的輸出逐字相同 → 稽核端只能猜，而它猜的那句
    // （「尚未 propagate」）在路徑失誤時是錯的（TD-428）。印出路徑讓兩者可區分。
    if (wantJson) {
      process.stdout.write(
        `${JSON.stringify({ skipped: true, reason: 'vendor/review-rules/patterns.json not found', patternsPath, consumerRoot })}\n`,
      )
    } else {
      process.stderr.write(`ℹ️  patterns.json 不存在，跳過掃描：${patternsPath}\n`)
    }
    process.exitCode = 0
    return
  }

  const dataRaw: unknown = JSON.parse(readFileSync(patternsPath, 'utf8'))
  const data = isRecord(dataRaw) ? dataRaw : {}
  const allRules: Rule[] = Array.isArray(data.rules) ? (data.rules as Rule[]) : []
  const rules = allRules.filter((r) => layer === 'all' || (r.layer || 'pre-commit') === layer)

  const files =
    fileset === 'staged'
      ? gitStagedFiles(consumerRoot, include)
      : gitAllFiles(consumerRoot, include)
  const readFile: ReadFile = (f) => readFileSync(join(consumerRoot, f), 'utf8')
  const violations = files.length > 0 ? scan(rules, files, readFile) : []

  const baselinePath = join(consumerRoot, 'review-rules-baseline.json')
  const baselineExists = existsSync(baselinePath)
  const oldBaseline = wantRatchet || wantWriteBaseline ? loadBaseline(baselinePath) : null

  let ratchetResult = null
  if (wantRatchet) {
    if (!baselineExists) {
      // Bootstrap：baseline 未初始化（propagate 剛落地、sweep 還沒寫檔）——warn-only，
      // 不擋 push；寫入 baseline（含空 {}）後 ratchet 即武裝。
      ratchetResult = { overages: [], pass: true, bootstrap: true }
      process.stderr.write(
        `⚠️  review-rules-baseline.json 不存在——bootstrap warn-only 模式（${violations.length} 筆存量違規暫不擋）。跑 --write-baseline 收斂存量後即武裝 ratchet。\n`,
      )
    } else {
      const overages = compareRatchet(oldBaseline, violations)
      ratchetResult = { overages, pass: overages.length === 0 }
    }
  }

  let writeBaselineResult = null
  if (wantWriteBaseline) {
    // Baseline 的掃描範圍 MUST 與 ratchet gate 一致（pre-push runner 固定跑
    // `--all --layer all --ratchet`）。用較窄的範圍寫 baseline，會讓範圍外的存量
    // 違規在 baseline 缺席、被 gate 當成新增違規 → 直接擋死 push，且錯誤訊息指向
    // 一堆早就存在的舊 code。這是 fail-closed 而非 warn：窄範圍 baseline 沒有正當用途。
    if (fileset !== 'all' || layer !== 'all') {
      process.stderr.write(
        `✘ --write-baseline 的掃描範圍 (fileset=${fileset}, layer=${layer}) 與 ratchet gate ` +
          `(--all --layer all) 不一致，拒絕寫入。\n` +
          `  正確指令：node vendor/review-rules/scan.mjs --all --layer all --write-baseline\n`,
      )
      process.exit(2)
    }
    const newBaseline = buildBaselineFromViolations(violations)
    const result = writeBaselineFile(baselinePath, newBaseline, { fileset, layer })
    writeBaselineResult = {
      path: baselinePath,
      ruleCount: Object.keys(newBaseline).length,
      ...result,
    }
  }

  if (wantJson) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: { fileset, layer, ratchet: wantRatchet, writeBaseline: wantWriteBaseline },
          violationCount: violations.length,
          violations,
          ratchet: ratchetResult,
          writeBaseline: writeBaselineResult,
        },
        null,
        2,
      )}\n`,
    )
  } else {
    if (writeBaselineResult) {
      if (writeBaselineResult.written) {
        process.stderr.write(
          `✅ baseline 已寫入：${writeBaselineResult.path}（${writeBaselineResult.ruleCount} 條規則）\n`,
        )
      }
      if (writeBaselineResult.empty) {
        process.stderr.write('（違規為零——寫入空 {} 代表 ratchet 武裝為零容忍）\n')
      }
    }
    if (ratchetResult) {
      printRatchetReport(ratchetResult.overages)
    } else if (!writeBaselineResult) {
      printHuman(violations)
    }
  }

  // **NEVER 用 `process.exit()` 收尾**：它不等 stdout drain，而 stdout 是 pipe 時（任何呼叫端
  // 用 execFile / `| jq` 讀 `--json`）Node 的寫入是非同步的 —— 大輸出會在中途被砍斷，留下一段
  // 語法不完整的 JSON。設 `exitCode` 讓 event loop 自然收尾，行為等價但輸出完整。
  //
  // 實證（2026-08-06 work-loop round 30）：<consumer-b> 573 筆違規 / <consumer-a> 同級的 `--json` 經 execFile
  // 讀回來恆為 108KB 出頭並 `Unterminated string`，而違規數小的 consumer 全部正常 —— 失敗與否
  // 只取決於輸出大小，所以它在小 repo 上永遠測不出來。
  if (ratchetResult) {
    process.exitCode = ratchetResult.pass ? 0 : 2
    return
  }
  if (writeBaselineResult) {
    process.exitCode = 0
    return
  }
  const hasError = violations.some((v) => v.severity === 'error')
  process.exitCode = hasError ? 1 : 0
}

try {
  main()
} catch (err) {
  if (err instanceof UsageError) {
    process.stderr.write(`[scan.mjs] 用法錯誤：${err.message}\n\n${usage()}`)
    process.exit(3)
  }
  const e = err as Error
  process.stderr.write(`[scan.mjs] ${e.stack || e.message}\n`)
  process.exit(3)
}
