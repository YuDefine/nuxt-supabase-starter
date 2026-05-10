#!/usr/bin/env node

/**
 * evlog-adoption-audit.mjs — evlog adoption 靜態檢查 / review gate
 *
 * 對應 docs/evlog-master-plan.md § 10.1 + rules/core/evlog-adoption.md。
 * 跑 ripgrep 為主的 static checks，量度 5 consumer 的 evlog adoption depth +
 * 偵測核心反模式。可掛 review gate（pre-push、CI）。
 *
 * 模式：
 *   --all-consumers     跑寫死的 5 個 consumer
 *   --repo <path>       對單一 repo 跑（CI / consumer 內 npm script 用）
 *   --changed-only      只看本次 git diff 涉及的檔（pre-push hook 用；以 cwd 為 repo root）
 *   --json              JSON 輸出（預設 human-readable）
 *
 * Signal 分類（用 evlog@2.16+ 真實 API 偵測）：
 *   block 類（任一 > 0 → exit 1）：
 *     drain.rawSentry         createSentryDrain 沒被 createDrainPipeline 包覆（subrequest budget 風險）
 *     sampling.errorSampled   sampling.rates.error 被設 < 100（rates 是百分比 0-100）
 *     redaction.missingCore   redact.paths 缺 password / token|authorization 任一（且非 redact: true）
 *     consola.inServerApi     server/api 仍用 consola（必遷至 useLogger）
 *   參考類（純度量，不 block）：
 *     useLogger.calls         useLogger(event) 採用處數量
 *     drain.pipelineWraps     createDrainPipeline 命中數 + @evlog/nuxthub module 命中（T3 自動 wire）
 *     sampling.policies       sampling: { rates: ... } block 命中數
 *     redaction.policies      redact: true | { paths: ... } 命中數
 *     client.transportEnabled nuxt module evlog.transport.enabled = true 命中數
 *     enrichers.installed     5 件套 enricher 命中數（UA / Geo / RequestSize / TraceContext / tenant）
 *
 * Exit code：
 *   0  所有 block 類為 0
 *   1  任一 block 類 > 0
 *   2  使用方式錯誤（usage）
 *
 * 參考：docs/evlog-master-plan.md § 10 + rules/core/evlog-adoption.md
 */

import { execFile as execFileCb } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)
const __dirname = dirname(fileURLToPath(import.meta.url))

const CONSUMERS = [
  ['perno', '/Users/charles/offline/perno'],
  ['starter', '/Users/charles/offline/nuxt-supabase-starter/template'],
  ['TDMS', '/Users/charles/offline/TDMS'],
  ['yuntech', '/Users/charles/offline/yuntech-usr-sroi'],
  ['edge-rag', '/Users/charles/offline/nuxt-edge-agentic-rag'],
]

const args = process.argv.slice(2)
const ALL = args.includes('--all-consumers')
const CHANGED_ONLY = args.includes('--changed-only')
const JSON_OUT = args.includes('--json')
const repoArgIdx = args.indexOf('--repo')
const REPO = repoArgIdx >= 0 ? args[repoArgIdx + 1] : null

async function main() {
  if (!ALL && !REPO && !CHANGED_ONLY) {
    process.stderr.write(usage())
    process.exit(2)
  }

  let targets
  if (ALL) {
    targets = CONSUMERS.map(([name, path]) => ({ name, path }))
  } else if (REPO) {
    const abs = isAbsolute(REPO) ? REPO : resolve(process.cwd(), REPO)
    targets = [{ name: basename(abs), path: abs }]
  } else {
    targets = [{ name: basename(process.cwd()), path: process.cwd(), changedOnly: true }]
  }

  for (const t of targets) {
    if (!existsSync(t.path)) {
      t.error = `path not found: ${t.path}`
      t.signals = null
      continue
    }
    try {
      t.signals = await auditOne(t.path, { changedOnly: t.changedOnly })
    } catch (err) {
      t.error = err.message
      t.signals = null
    }
  }

  let blocked = 0
  for (const t of targets) {
    if (t.signals && totalBlock(t.signals) > 0) blocked++
  }

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({ targets, blocked }, null, 2) + '\n')
  } else {
    printHuman(targets)
  }

  process.exit(blocked > 0 ? 1 : 0)
}

function basename(p) {
  return p.replace(/\/+$/, '').split('/').pop()
}

function usage() {
  return `用法：
  node scripts/evlog-adoption-audit.mjs --all-consumers          # 跑 5 個 consumer
  node scripts/evlog-adoption-audit.mjs --repo <path>            # 跑單一 repo
  node scripts/evlog-adoption-audit.mjs --changed-only           # 只看 git diff 涉及檔（cwd 為 repo root）
  node scripts/evlog-adoption-audit.mjs --all-consumers --json   # JSON 輸出
`
}

async function auditOne(repoPath, { changedOnly } = {}) {
  let scopeFilter = null
  if (changedOnly) {
    scopeFilter = await collectChangedFiles(repoPath)
    if (scopeFilter.length === 0) {
      return emptySignals()
    }
  }

  const serverGlobs = ['server/**', 'packages/**/server/**']
  const pluginGlobs = ['server/plugins/**', 'packages/**/server/plugins/**']
  const configGlobs = [
    'nuxt.config.ts',
    'nuxt.config.*',
    'packages/**/nuxt.config.ts',
    'clients/**/nuxt.config.ts',
  ]

  // Reference signals — 用 evlog@2.16+ 真實 API 偵測
  const useLoggerCalls = await rgCount(
    repoPath,
    String.raw`useLogger\(event\)`,
    scopeFilter,
    serverGlobs,
  )
  // drain pipeline 標誌：
  // - createDrainPipeline (consumer 自家 wire；T1/T2 路徑)
  // - @evlog/nuxthub module（T3 路徑；module 自動 wire drain，consumer 不直接 ref createDrainPipeline）
  const pipelineCodeWraps = await rgCount(
    repoPath,
    String.raw`createDrainPipeline|createPipeline\(|pipeline\.wrap`,
    scopeFilter,
    pluginGlobs,
  )
  // 偵測 @evlog/nuxthub module 是否已加入 nuxt.config modules array
  const nuxthubModuleHits = await rgList(
    repoPath,
    String.raw`'@evlog/nuxthub'|"@evlog/nuxthub"`,
    scopeFilter,
    configGlobs,
  )
  const pipelineWraps = pipelineCodeWraps + (nuxthubModuleHits.length > 0 ? 1 : 0)
  // sampling：nuxt module `evlog: { sampling: { rates: ... } }` 或 LoggerConfig sampling block
  // rg multiline 對 nested object 對齊不穩；改抓 `rates:` 後跟著 level key 的 pattern
  const samplingPolicies = await rgCount(
    repoPath,
    String.raw`rates:\s*\{[^}]*(?:error|warn|info|debug)\s*:`,
    scopeFilter,
    [...configGlobs, ...pluginGlobs],
  )
  // redact：nuxt module `evlog: { redact: ... }` 或 LoggerConfig redact block
  const redactionPolicies = await rgCount(
    repoPath,
    String.raw`redact:\s*(?:true|\{)`,
    scopeFilter,
    [...configGlobs, ...pluginGlobs],
  )

  // client transport：nuxt module `evlog: { transport: { enabled: true } }`
  // (legacy doc 寫 `client: { enabled: true }`，但真實 API 是 transport)
  const transportBlocks = await rgList(
    repoPath,
    String.raw`transport:\s*\{[\s\S]{0,200}?enabled:\s*true`,
    scopeFilter,
    configGlobs,
    ['--multiline'],
  )
  const clientTransportEnabled = transportBlocks.length

  // Enricher 5 件套：evlog 真實 API 是 createXEnricher() factory function
  const enricherPatterns = [
    String.raw`createUserAgentEnricher\(|userAgentEnricher\(`,
    String.raw`createGeoEnricher\(|geoEnricher\(|cfGeoEnricher\(`,
    String.raw`createRequestSizeEnricher\(|requestSizeEnricher\(`,
    String.raw`createTraceContextEnricher\(|traceContextEnricher\(`,
    String.raw`tenantEnricher\(`,
  ]
  let enrichersInstalled = 0
  for (const pat of enricherPatterns) {
    const c = await rgCount(repoPath, pat, scopeFilter, pluginGlobs)
    if (c > 0) enrichersInstalled++
  }

  // audit forceKeep wiring：evlog 2.16 **無**內建 audit forceKeep（master plan § 14
  // 校正）；consumer 必由 'evlog:emit:keep' Nitro hook + kind === 'audit' 判斷
  // wire。沒 wire 表示 audit-class events 走一般 sampling rate（會被 drop）。
  // 偵測：grep `evlog:emit:keep` 命中 + 同檔含 `kind === 'audit'`（broad signal；
  // 任一 plugin 命中即算 wired，非命中數）
  const auditForceKeepFiles = new Set(
    (await rgList(repoPath, String.raw`evlog:emit:keep`, scopeFilter, pluginGlobs)).map(
      (l) => l.split(':', 1)[0],
    ),
  )
  let auditForceKeepWired = 0
  for (const f of auditForceKeepFiles) {
    const kindHits = await rgCount(
      repoPath,
      String.raw`kind\s*===\s*['"\x60]audit['"\x60]`,
      [f],
      [],
    )
    if (kindHits > 0) {
      auditForceKeepWired = 1
      break
    }
  }

  // BLOCK 1: drain.rawSentry — createSentryDrain 沒被 createDrainPipeline 包覆
  // 偵測：rg 找出含 createSentryDrain 的行；同檔內找 createDrainPipeline 或 createPipeline
  const sentryDrainLines = await rgList(
    repoPath,
    String.raw`createSentryDrain\(`,
    scopeFilter,
    pluginGlobs,
  )
  const rawSentryFiles = new Set()
  // sentryDrainLines 包含 comment 內的 reference example；先過濾掉 ts/js comment
  const realSentryLines = sentryDrainLines.filter((line) => {
    const body = line.replace(/^[^:]+:\d+:/, '')
    // 抓開頭是 ` * `（jsdoc）或 `//`（line comment）的行
    if (/^\s*(?:\*|\/\/)/.test(body)) return false
    return true
  })
  const sentryFileSet = new Set(realSentryLines.map((l) => l.split(':', 1)[0]))
  for (const f of sentryFileSet) {
    // 同檔內找 createDrainPipeline / createPipeline / pipeline.wrap 真實使用（排除 comment）
    const wrapLines = await rgList(
      repoPath,
      String.raw`createDrainPipeline|createPipeline\(|pipeline\.wrap`,
      [f],
      [],
    )
    const realWrapLines = wrapLines.filter((line) => {
      const body = line.replace(/^[^:]+:\d+:/, '')
      if (/^\s*(?:\*|\/\/)/.test(body)) return false
      return true
    })
    if (realWrapLines.length === 0) rawSentryFiles.add(f)
  }

  // BLOCK 2: sampling.errorSampled — sampling.rates.error 被設 < 100
  // evlog 真實 API：rates 是百分比 0-100，不是 0-1。error < 100 即被視為 sampled。
  // rg 不支援 lookahead，先抓 `error: <number>`，再 post-filter 數字 < 100
  const samplingErrorRaw = await rgList(repoPath, String.raw`error:\s*[0-9]+`, scopeFilter, [
    ...configGlobs,
    ...pluginGlobs,
  ])
  const samplingErrorHits = samplingErrorRaw.filter((line) => {
    const body = line.replace(/^[^:]+:\d+:/, '')
    // 排除 jsdoc 內 example block（` * ...`）與 line comment（`// ...`）— 避免 reference 例子誤抓
    if (/^\s*(?:\*|\/\/)/.test(body)) return false
    const m = body.match(/error:\s*([0-9]+(?:\.[0-9]+)?)/)
    if (!m) return false
    const n = Number(m[1])
    // 只 flag 落在 sampling rate 合理範圍（0-99）的；其他 number context 略過（避免 false positive）
    return n >= 0 && n < 100
  })

  // BLOCK 3: redaction.missingCore — redact block 缺 password / token / authorization 任一
  // 真實 API：`redact: { paths: [...] }` 或 `redact: true`（後者啟用 builtins，含 jwt / bearer / email 等）
  //
  // rgList 用 --multiline 抓出整段 redact block，但 ripgrep 在 --multiline 模式下仍會
  // 對每個 source line 各印一行（含 line number prefix），split('\n') 後每行變獨立 entry。
  // 因此這裡先把連續 line（同檔且 line number 連號）groupBy 回單一 block，再做 password/token 檢查。
  const redactionLines = await rgList(
    repoPath,
    String.raw`redact:\s*\{[\s\S]*?paths:\s*\[[\s\S]*?\]`,
    scopeFilter,
    [...configGlobs, ...pluginGlobs],
    ['--multiline'],
  )
  const redactionBlocks = groupConsecutiveLines(redactionLines)
  const missingCoreHits = redactionBlocks.filter((block) => {
    // 若 redact: true 開全部 builtins → 自動含 jwt / bearer / email，不算 missing
    if (/redact:\s*true/.test(block)) return false
    const hasPassword = /password/i.test(block)
    const hasToken = /token|authorization/i.test(block)
    return !(hasPassword && hasToken)
  })

  // BLOCK 4: consola.inServerApi — server/api 仍用 consola
  const consolaHits = await rgList(
    repoPath,
    String.raw`from\s+['"\x60]consola['"\x60]|require\(['"\x60]consola['"\x60]\)`,
    scopeFilter,
    ['server/api/**', 'packages/**/server/api/**'],
  )

  return {
    'useLogger.calls': useLoggerCalls,
    'drain.pipelineWraps': pipelineWraps,
    'sampling.policies': samplingPolicies,
    'redaction.policies': redactionPolicies,
    'client.transportEnabled': clientTransportEnabled,
    'nuxthub.moduleInstalled': nuxthubModuleHits.length > 0 ? 1 : 0,
    'enrichers.installed': enrichersInstalled,
    'audit.forceKeepWired': auditForceKeepWired,
    'drain.rawSentry': rawSentryFiles.size,
    'sampling.errorSampled': samplingErrorHits.length,
    'redaction.missingCore': missingCoreHits.length,
    'consola.inServerApi': consolaHits.length,
    _samples: {
      'drain.rawSentry': [...rawSentryFiles].slice(0, 5),
      'sampling.errorSampled': samplingErrorHits.slice(0, 5),
      'redaction.missingCore': missingCoreHits.slice(0, 3).map((b) => truncate(b, 200)),
      'consola.inServerApi': consolaHits.slice(0, 5),
    },
  }
}

function emptySignals() {
  return {
    'useLogger.calls': 0,
    'drain.pipelineWraps': 0,
    'sampling.policies': 0,
    'redaction.policies': 0,
    'client.transportEnabled': 0,
    'nuxthub.moduleInstalled': 0,
    'enrichers.installed': 0,
    'audit.forceKeepWired': 0,
    'drain.rawSentry': 0,
    'sampling.errorSampled': 0,
    'redaction.missingCore': 0,
    'consola.inServerApi': 0,
    _samples: {},
  }
}

function totalBlock(s) {
  return (
    s['drain.rawSentry'] +
    s['sampling.errorSampled'] +
    s['redaction.missingCore'] +
    s['consola.inServerApi']
  )
}

async function collectChangedFiles(cwd) {
  const staged = await safeGit(cwd, ['diff', '--name-only', '--cached'])
  const unstaged = await safeGit(cwd, ['diff', '--name-only'])
  const untracked = await safeGit(cwd, ['ls-files', '--others', '--exclude-standard'])
  const all = new Set([...staged, ...unstaged, ...untracked].map((s) => s.trim()).filter(Boolean))
  return [...all]
}

async function safeGit(cwd, argv) {
  try {
    const { stdout } = await execFile('git', argv, { cwd, maxBuffer: 10 * 1024 * 1024 })
    return stdout.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

async function rgCount(cwd, pattern, scopeFiles, globs = []) {
  const lines = await rgList(cwd, pattern, scopeFiles, globs)
  return lines.length
}

/**
 * Group ripgrep output lines (`file:lineno:content`) by file + 連號 line number。
 * 用於 --multiline 模式：rg 對 multiline match 內每個 source line 印一行，
 * 此 helper 把連續行還原回原 multiline block（join with `\n`）給 filter logic 用。
 */
function groupConsecutiveLines(lines) {
  if (lines.length === 0) return []
  const blocks = []
  let current = null
  for (const line of lines) {
    const m = line.match(/^([^:]+):(\d+):(.*)$/s)
    if (!m) {
      if (current) current.lines.push(line)
      continue
    }
    const [, file, lineNoStr, content] = m
    const lineNo = Number(lineNoStr)
    if (current && current.file === file && lineNo === current.lastLineNo + 1) {
      current.lines.push(content)
      current.lastLineNo = lineNo
    } else {
      if (current) blocks.push(current.lines.join('\n'))
      current = { file, lastLineNo: lineNo, lines: [content] }
    }
  }
  if (current) blocks.push(current.lines.join('\n'))
  return blocks
}

async function rgList(cwd, pattern, scopeFiles, globs = [], extraFlags = []) {
  const argv = ['-n', ...extraFlags, '-e', pattern]
  for (const g of globs) {
    argv.push('-g', g)
  }
  if (scopeFiles && scopeFiles.length > 0) {
    argv.push('--')
    for (const f of scopeFiles) argv.push(f)
  } else {
    // 用 '.' 而非 cwd（絕對路徑）— execFile 已設 {cwd}，相對 '.' 不會被 ripgrep
    // canonicalize（macOS /tmp 是 /private/tmp symlink；canonical 後 -g 'server/...' 對
    // canonicalized 路徑算 relative 邏輯不一致，導致 0 命中。'.' 直接以 cwd 為 search root）
    argv.push('.')
  }
  try {
    const { stdout } = await execFile('rg', argv, {
      cwd,
      maxBuffer: 50 * 1024 * 1024,
      reject: false,
    })
    return stdout.split('\n').filter(Boolean)
  } catch (err) {
    if (err.code === 1) return []
    if (err.code === 'ENOENT') {
      throw new Error('ripgrep (rg) 不存在；請先安裝（brew install ripgrep）')
    }
    throw err
  }
}

function printHuman(targets) {
  const blockKeys = [
    'drain.rawSentry',
    'sampling.errorSampled',
    'redaction.missingCore',
    'consola.inServerApi',
  ]
  const refKeys = [
    'useLogger.calls',
    'drain.pipelineWraps',
    'sampling.policies',
    'redaction.policies',
    'client.transportEnabled',
    'nuxthub.moduleInstalled',
    'enrichers.installed',
    'audit.forceKeepWired',
  ]
  let totalBlocked = 0

  process.stdout.write('# evlog adoption audit\n\n')
  for (const t of targets) {
    process.stdout.write(`## ${t.name}\n`)
    process.stdout.write(`  path: ${t.path}\n`)
    if (t.error) {
      process.stdout.write(`  ⚠ error: ${t.error}\n\n`)
      continue
    }
    const s = t.signals
    const blockSum = totalBlock(s)
    if (blockSum > 0) totalBlocked++
    process.stdout.write(`  block signals (>0 → fail):\n`)
    for (const k of blockKeys) {
      const v = s[k]
      const mark = v > 0 ? '✗' : '·'
      process.stdout.write(`    ${mark} ${k.padEnd(28)} ${v}\n`)
      if (v > 0 && s._samples?.[k]) {
        for (const sample of s._samples[k]) {
          process.stdout.write(`        ${truncate(sample, 140)}\n`)
        }
      }
    }
    process.stdout.write(`  reference signals (adoption metrics):\n`)
    for (const k of refKeys) {
      process.stdout.write(`    · ${k.padEnd(28)} ${s[k]}\n`)
    }
    process.stdout.write(`  depth estimate: ${estimateDepth(s)}\n`)
    process.stdout.write('\n')
  }

  if (totalBlocked > 0) {
    process.stdout.write(`✗ ${totalBlocked} target(s) failed block-signal gate\n`)
  } else {
    process.stdout.write(`✓ all targets clean on block signals\n`)
  }
}

function estimateDepth(s) {
  // 依 rules/core/evlog-adoption.md Adoption depth 自評表近似
  if (s['useLogger.calls'] === 0) return '0 (evlog 未採用)'
  // T3 NuxtHub stack 早判：@evlog/nuxthub module 接管 drain pipeline / sampling / redact
  // / D1 retention，consumer 不需要自家 wire 該等 block；只要 module 已載且 enrichers
  // 完整即視為 depth 6+。對應 HANDOFF §2.2 audit script T3 semantic 修補。
  if (s['nuxthub.moduleInstalled'] > 0 && s['enrichers.installed'] >= 4) {
    return '6+ (T3 NuxtHub stack 完成；drain/sampling/redact 由 @evlog/nuxthub 自帶)'
  }
  if (s['drain.pipelineWraps'] === 0) return '1 (套件 + useLogger 採用)'
  if (s['enrichers.installed'] < 4) return '3 (drain pipeline 已套，enrichers < 4)'
  if (s['sampling.policies'] === 0 || s['redaction.policies'] === 0) {
    return '4 (enrichers 完整，缺 sampling/redaction)'
  }
  if (s['client.transportEnabled'] === 0) return '5 (T1 baseline 完成，缺 client transport)'
  return '6+ (含 client transport，T2 hardening 區間)'
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

main().catch((err) => {
  process.stderr.write(`[evlog-adoption-audit] ${err.stack || err.message}\n`)
  process.exit(2)
})
