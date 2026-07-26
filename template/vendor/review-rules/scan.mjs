#!/usr/bin/env node
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
 * Baseline 檔格式（consumer repo root，不在 vendor/ 內——一個 repo 一份 ratchet 現況）：
 *   { "<ruleId>": { "<file>": <count>, ... }, ... }
 *
 * Exit code:
 *   0 — 乾淨 / ratchet 通過 / write-baseline 成功
 *   1 — 非 ratchet 模式下，篩選後規則有 severity=error 命中（沿用舊 review-rules-ban.sh 契約）
 *   2 — --ratchet 模式下，實際命中數 > baseline（新增違規）
 *   3 — 用法錯誤 / 內部錯誤（bad args、JSON 解析失敗等）
 *
 * patterns.json 不存在（consumer 尚未 propagate）→ 靜默 exit 0（非 --json）或印
 * {"skipped":true,...}（--json），不視為錯誤。
 *
 * 由 ~/clade vendor/review-rules/ 散播，請勿直接編輯 consumer 副本。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

class UsageError extends Error {}

const LEGACY_VUE_GLOB = '*.vue'
const LEGACY_CONFIG_GLOB = 'app.config.*'
const REGEX_SPECIAL = /[.+^${}()|[\]\\]/

// ---------- glob matching ----------

function escapeRegExpChar(ch) {
  return REGEX_SPECIAL.test(ch) ? `\\${ch}` : ch
}

/** 把泛化 glob（`**`＝任意路徑深度、`*`＝單一路徑段）轉成錨定 RegExp。 */
function globToRegExp(glob) {
  let src = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
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
function matchFileGlob(file, glob) {
  if (glob === LEGACY_VUE_GLOB) return file.endsWith('.vue')
  if (glob === LEGACY_CONFIG_GLOB) return /(?:^|\/)app\.config\.[^/]+$/.test(file)

  const regex = globToRegExp(glob)
  if (regex.test(file)) return true

  const packagesMatch = file.match(/^packages\/[^/]+\/(.*)$/)
  if (packagesMatch && regex.test(packagesMatch[1])) return true

  const templateMatch = file.match(/^template\/(.*)$/)
  if (templateMatch && regex.test(templateMatch[1])) return true

  return false
}

function matchAnyGlob(file, globs) {
  return globs.some((g) => matchFileGlob(file, g))
}

/** scanPaths 用的前綴 RegExp（`*` = 單一路徑段萬用字元，不錨定結尾，只錨定開頭）。 */
function scanPathToRegExp(prefix) {
  let src = '^'
  for (const ch of prefix) {
    src += ch === '*' ? '[^/]*' : escapeRegExpChar(ch)
  }
  return new RegExp(src)
}

function matchesAnyScanPath(file, scanPaths) {
  return scanPaths.some((p) => scanPathToRegExp(p).test(file))
}

// ---------- multiLine tag 展平（既有 review-rules-ban.sh heuristic，逐字沿用） ----------

/** pattern 是否為 `<Tag[^>]*...` 形式（跨屬性匹配），需要先把 tag 展平成單行。 */
function needsMultiLine(pattern) {
  return /^<[[(]?[A-Z].*\[\^>\]/.test(pattern)
}

/** 從內容抽出每個 HTML/Vue tag 區塊（含起始行號），並把跨行屬性展平成單行。
 *  抓兩類：(1) PascalCase 元件 `<UBadge ...>` (2) 含 `:is=` 的動態元件 `<component :is="UBadge" ...>` */
function extractTags(content) {
  const tags = []
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
function scanRuleOnFiles(rule, files, readFile) {
  const re = new RegExp(rule.pattern)
  const excludeContentRe = rule.excludePattern ? new RegExp(rule.excludePattern) : null
  const multiLine = rule.multiLine === true || needsMultiLine(rule.pattern)

  let candidates = files.filter((f) => matchFileGlob(f, rule.fileGlob || LEGACY_VUE_GLOB))
  if (rule.scanPaths && rule.scanPaths.length > 0) {
    candidates = candidates.filter((f) => matchesAnyScanPath(f, rule.scanPaths))
  }
  if (rule.exclude && rule.exclude.length > 0) {
    candidates = candidates.filter((f) => !matchAnyGlob(f, rule.exclude))
  }
  if (candidates.length === 0) return []

  const hits = []
  for (const file of candidates) {
    let content
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
        if (!re.test(lines[i])) continue
        if (excludeContentRe && excludeContentRe.test(lines[i])) continue
        hits.push({ file, line: i + 1, text: lines[i].trim().slice(0, 200) })
      }
    }
  }
  return hits
}

/** 對整批 rules 跑掃描，回傳攤平後的 violation 陣列。 */
function scan(rules, files, readFile) {
  const violations = []
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

function loadBaseline(baselinePath) {
  if (!existsSync(baselinePath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(baselinePath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    process.stderr.write(
      `⚠️  review-rules-baseline.json 解析失敗，視為空 baseline（等同零容忍）：${err.message}\n`,
    )
    return {}
  }
}

function buildBaselineFromViolations(violations) {
  const baseline = {}
  for (const v of violations) {
    baseline[v.ruleId] ??= {}
    baseline[v.ruleId][v.file] = (baseline[v.ruleId][v.file] || 0) + 1
  }
  return baseline
}

function writeBaselineFile(baselinePath, baseline, scope) {
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
function compareRatchet(baseline, violations) {
  const actual = buildBaselineFromViolations(violations)
  const overages = []
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

function gitRevParseShowToplevel() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
}

// vendor/ 是 clade 投影/cookbook（含帶說明註解的 .vue template），永遠不是 consumer
// 業務碼——全域排除，防 cookbook 註解文字誤觸規則（如 dark-mode 規則咬到範例說明）。
const DEFAULT_EXCLUDE_RE = /^(vendor|node_modules)\//

function gitStagedFiles(repoRoot) {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => !DEFAULT_EXCLUDE_RE.test(f))
}

function gitAllFiles(repoRoot) {
  const out = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => !DEFAULT_EXCLUDE_RE.test(f))
}

// ---------- output ----------

function printHuman(violations) {
  if (violations.length === 0) {
    process.stderr.write('✅ 未發現違規\n')
    return
  }
  const byRule = new Map()
  for (const v of violations) {
    if (!byRule.has(v.ruleId)) byRule.set(v.ruleId, [])
    byRule.get(v.ruleId).push(v)
  }
  for (const [ruleId, vs] of byRule) {
    const icon = vs[0].severity === 'error' ? '❌' : '⚠️'
    process.stderr.write(`${icon} [${ruleId}] ${vs[0].message}\n`)
    for (const v of vs) {
      process.stderr.write(`  ${v.file}:${v.line}: ${v.text}\n`)
    }
    if (vs[0].fix) process.stderr.write(`  Fix: ${vs[0].fix}\n`)
    process.stderr.write('\n')
  }
}

function printRatchetReport(overages) {
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
                [--write-baseline] [--json] [--help]

範例：
  node scan.mjs --staged --layer pre-commit                 # pre-commit hook
  node scan.mjs --all --layer all --ratchet                  # pre-push / CI ratchet gate
  node scan.mjs --all --layer all --write-baseline           # 收斂 baseline
  node scan.mjs --all --layer pre-commit --json              # 機器可讀全站掃描
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
  const layer = layerIdx >= 0 ? argv[layerIdx + 1] : 'all'
  if (!['pre-commit', 'ratchet', 'all'].includes(layer)) {
    throw new UsageError(`--layer 值不合法：${layer}（合法值：pre-commit | ratchet | all）`)
  }

  const wantRatchet = argv.includes('--ratchet')
  const wantWriteBaseline = argv.includes('--write-baseline')
  const wantJson = argv.includes('--json')

  const repoRoot = gitRevParseShowToplevel()
  const patternsPath = join(repoRoot, 'vendor', 'review-rules', 'patterns.json')

  if (!existsSync(patternsPath)) {
    if (wantJson) {
      process.stdout.write(
        `${JSON.stringify({ skipped: true, reason: 'vendor/review-rules/patterns.json not found' })}\n`,
      )
    }
    process.exit(0)
  }

  const data = JSON.parse(readFileSync(patternsPath, 'utf8'))
  const allRules = Array.isArray(data.rules) ? data.rules : []
  const rules = allRules.filter((r) => layer === 'all' || (r.layer || 'pre-commit') === layer)

  const files = fileset === 'staged' ? gitStagedFiles(repoRoot) : gitAllFiles(repoRoot)
  const readFile = (f) => readFileSync(join(repoRoot, f), 'utf8')
  const violations = files.length > 0 ? scan(rules, files, readFile) : []

  const baselinePath = join(repoRoot, 'review-rules-baseline.json')
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

  if (ratchetResult) {
    process.exit(ratchetResult.pass ? 0 : 2)
  }
  if (writeBaselineResult) {
    process.exit(0)
  }
  const hasError = violations.some((v) => v.severity === 'error')
  process.exit(hasError ? 1 : 0)
}

try {
  main()
} catch (err) {
  if (err instanceof UsageError) {
    process.stderr.write(`[scan.mjs] 用法錯誤：${err.message}\n\n${usage()}`)
    process.exit(3)
  }
  process.stderr.write(`[scan.mjs] ${err.stack || err.message}\n`)
  process.exit(3)
}
