#!/usr/bin/env node
/**
 * Test Scripts Auditor
 *
 * 偵測 vitest multi-project consumer 的 package.json 是否把路徑寫死在
 * `test:<project>` script，導致跨 project 單檔測試靜默不跑。
 *
 * 適用：vitest.config.ts 含 `projects: [...]`、`test.workspace`、或多個
 *       `defineVitestProject({...})` 呼叫。單 project 配置不適用，直接 exit 0。
 *
 * 偵測規則（drift）：
 *   - `test:<name>` 內出現 `vp test [run] <path>` 形式（path 不是 flag）
 *   - 缺少 `test:file` 或等價無 filter 的 escape hatch
 *
 * Usage:
 *   node scripts/audit-test-scripts.mjs            # 友善輸出
 *   node scripts/audit-test-scripts.mjs --json     # 機器可讀
 *
 * Exit: 0 clean / not-applicable · 1 drift found · 2 script error
 *
 * See .claude/rules/test-scripts.md for the rule.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = new Set(process.argv.slice(2))
const asJson = args.has('--json')

if (args.has('--help') || args.has('-h')) {
  console.log(
    'Usage: audit-test-scripts.mjs [--json]\n' +
      '  --json   Emit machine-readable JSON on stdout\n' +
      '\n' +
      'Exit codes: 0 clean / not-applicable, 1 drift, 2 error'
  )
  process.exit(0)
}

const repoRoot = process.cwd()
const pkgPath = resolve(repoRoot, 'package.json')
const vitestConfigCandidates = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vite.config.ts',
  'vite.config.mts',
]

if (!existsSync(pkgPath)) {
  if (asJson) console.log(JSON.stringify({ status: 'not-applicable', reason: 'no package.json' }))
  else console.log('⊘ no package.json — skip')
  process.exit(0)
}

const vitestConfigPath = vitestConfigCandidates
  .map((name) => resolve(repoRoot, name))
  .find((p) => existsSync(p))

if (!vitestConfigPath) {
  if (asJson)
    console.log(JSON.stringify({ status: 'not-applicable', reason: 'no vitest config found' }))
  else console.log('⊘ no vitest config — skip')
  process.exit(0)
}

const configSrc = readFileSync(vitestConfigPath, 'utf-8')

// Heuristic: multi-project 偵測
//   - test.projects: [...] 陣列字面量 / 變數參照
//   - const projects = [...] 變數定義（後續 push 進 test config）
//   - test.workspace: ...
//   - 任何 defineVitestProject(...) 呼叫（single-project 通常用 defineVitestConfig）
const projectsKeyMatch = /\bprojects\s*:\s*[[\w]/.test(configSrc)
const projectsVarMatch = /\b(?:const|let|var)\s+projects\s*=\s*\[/.test(configSrc)
const workspaceMatch = /\bworkspace\s*:/.test(configSrc)
const defineProjectMatches = (configSrc.match(/defineVitestProject\s*\(/g) || []).length

// defineVitestProject(...) 在單 project 設定也常見（如 Nuxt 官方 Vitest 範本），
// 所以單獨一個呼叫不能算 multi-project；要兩個以上才視為 multi-project 訊號。
const isMultiProject =
  projectsKeyMatch || projectsVarMatch || workspaceMatch || defineProjectMatches >= 2

if (!isMultiProject) {
  if (asJson)
    console.log(
      JSON.stringify({
        status: 'not-applicable',
        reason: 'single-project vitest config',
        configPath: vitestConfigPath,
      })
    )
  else console.log('⊘ single-project vitest — rule not applicable, skip')
  process.exit(0)
}

let pkg
try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
} catch (err) {
  console.error(`audit-test-scripts: failed to parse package.json: ${err}`)
  process.exit(2)
}

const scripts = pkg.scripts || {}
const findings = []

// 抓所有 test:<name> script（不含 test:e2e、test:e2e:ui，那是 playwright）
const testScriptEntries = Object.entries(scripts).filter(([name]) => {
  if (!name.startsWith('test:')) return false
  if (name.startsWith('test:e2e')) return false
  return true
})

for (const [name, cmd] of testScriptEntries) {
  if (typeof cmd !== 'string') continue

  // 拆 cmd 成 token，過濾掉 flags
  // 認得 vitest CLI 主要 flags（接 value 的 flag 也要吃掉下一個 token）
  const flagsTakingValue = new Set([
    '--config',
    '-c',
    '--project',
    '--reporter',
    '--outputFile',
    '--testNamePattern',
    '-t',
    '--dir',
    '--mode',
    '--pool',
    '--browser',
    '--root',
    '-r',
  ])

  const tokens = cmd.split(/\s+/).filter(Boolean)
  const positional = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === 'vp' || t === 'vitest' || t === 'pnpm' || t === 'npx') continue
    if (t === 'test' || t === 'run' || t === 'watch') continue
    if (t.startsWith('--') || t.startsWith('-')) {
      // 帶 = 或不帶 value 都 skip 自身
      if (!t.includes('=') && flagsTakingValue.has(t)) i++ // 吃掉 value token
      continue
    }
    positional.push(t)
  }

  // positional 有東西就是 path filter
  if (positional.length > 0) {
    findings.push({
      script: name,
      command: cmd,
      pathFilter: positional,
      reason: 'hardcoded path filter in multi-project vitest setup',
    })
  }
}

// 缺 test:file escape hatch
const hasEscapeHatch =
  typeof scripts['test:file'] === 'string' &&
  /vp\s+test\s+run\s*$/.test(scripts['test:file'].trim())

const result = {
  status: findings.length === 0 && hasEscapeHatch ? 'clean' : 'drift',
  configPath: vitestConfigPath,
  isMultiProject,
  hasEscapeHatch,
  findings,
}

if (asJson) {
  console.log(JSON.stringify(result, null, 2))
} else {
  if (result.status === 'clean') {
    console.log('✓ test scripts clean (multi-project + no path-filter trap + has test:file)')
    process.exit(0)
  }
  console.log('✗ test scripts drift detected\n')
  console.log(`vitest config: ${vitestConfigPath} (multi-project)\n`)
  if (findings.length > 0) {
    console.log('Hardcoded path filters in test:* scripts:')
    for (const f of findings) {
      console.log(`  - "${f.script}": ${f.command}`)
      console.log(`    path filter: ${f.pathFilter.join(' ')}`)
    }
    console.log('')
  }
  if (!hasEscapeHatch) {
    console.log('Missing test:file escape hatch — add:')
    console.log('  "test:file": "vp test run"')
    console.log('')
  }
  console.log('Fix: see .claude/rules/test-scripts.md')
}

process.exit(findings.length > 0 || !hasEscapeHatch ? 1 : 0)
