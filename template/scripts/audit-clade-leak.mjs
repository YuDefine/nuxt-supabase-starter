#!/usr/bin/env node
/**
 * audit-clade-leak.mjs — starter consumer 公開倉 0-leak audit
 *
 * 用途：`nuxt-supabase-starter` 是公開 GitHub repo。clade 中央倉的 rule /
 * skill / commands / agents 內含 consumer 名稱（perno / TDMS / edge-rag /
 * yuntech-usr-sroi / nuxt-edge-agentic-rag）、personal path (`/Users/charles/`)、
 * personal email (`charles@yudefine.com.tw`)、客戶名 (bigbyte / fongchen)、
 * 以及未該對外曝光的 maintainer skill (`oops` / `improvement-loop` / `review-rules`)。
 *
 * Sanitization 應在 clade 端 propagate 時自動處理；本 audit script 是 CI gate
 * 兜底，直接 grep `template/.claude/` 內 clade-managed checksums 列出的所有檔，
 * 任何 forbidden token / maintainer-only skill 殘留 → exit 1。
 *
 * Scope:
 *   1. `template/.claude/` checksums 列出的所有檔：grep forbidden tokens
 *      （consumer name 別名 + personal redactions needles）
 *   2. `template/.agents/skills/{oops,improvement-loop,review-rules}/` 殘留：
 *      若任一存在 → exit 1（maintainer-only skill 不該散播到 starter）
 *
 * Output:
 *   - 0 violations → exit 0
 *   - 1+ violations → 列每條 `<path>: <token>` 後 exit 1
 *
 * Usage:
 *   node scripts/audit-clade-leak.mjs                 # 預設 cwd = repo root
 *   node scripts/audit-clade-leak.mjs --root <path>   # 指定 starter repo root
 *   node scripts/audit-clade-leak.mjs --json          # CI-friendly 機器輸出
 *
 * 觸發點：starter CI（GitHub Actions）作 mandatory job + maintainer 本機散播
 * 後手動跑驗證。
 *
 * 對應 governance：clade `scripts/lib/sanitization-governance.mjs`。
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 嘗試 import clade-managed lib（若 starter 端的 .clade/ 投影 / consumer scripts/
// 已有同步副本，路徑會穩定）。failure 時 fallback hardcode 一份 minimal list 避免
// audit 自身因 missing dep 而綠燈過。
// IMPORTANT：在 starter 端跑時，starter 倉本身**不**會內含這份 lib（clade
// `scripts/lib/` 是 clade 中央倉自己的，不散播到 starter）。所以必須 fallback。

const FALLBACK_FORBIDDEN_TOKENS = [
  // consumer name 別名（覆蓋 sanitization-governance 對應 list）
  /\bnuxt-edge-agentic-rag\b/g,
  /\byuntech-usr-sroi\b/g,
  /\bedge-rag\b/g,
  /\bperno\b/g,
  /\bTDMS\b/g,
  /\bbigbyte\b/g,
  /\bfongchen\b/g,
]

const FALLBACK_PERSONAL_NEEDLES = [
  '/Users/charles/.local/bin/',
  '/Users/charles/offline/clade',
  '/Users/charles/offline/',
  '/Users/charles/',
  'charles@yudefine.com.tw',
  'yudefine.com.tw',
]

const MAINTAINER_ONLY_SKILLS = ['oops', 'improvement-loop', 'review-rules']

function parseArgs(argv) {
  const out = { root: null, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--root') {
      out.root = argv[i + 1]
      i += 1
    } else if (a === '--json') {
      out.json = true
    }
  }
  return out
}

async function findRepoRoot(start) {
  let cur = resolve(start)
  while (true) {
    if (existsSync(join(cur, 'template', '.claude', '.hub-state.json'))) return cur
    if (existsSync(join(cur, '.claude', '.hub-state.json'))) return cur
    const parent = dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

function resolveStarterRoot(opts) {
  if (opts.root) {
    return isAbsolute(opts.root) ? opts.root : resolve(process.cwd(), opts.root)
  }
  return process.cwd()
}

async function loadHubStateFiles(repoRoot) {
  const candidates = [
    join(repoRoot, 'template', '.claude', '.hub-state.json'),
    join(repoRoot, '.claude', '.hub-state.json'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) {
      const text = await readFile(c, 'utf8')
      const state = JSON.parse(text)
      const root = c.endsWith('template/.claude/.hub-state.json')
        ? join(repoRoot, 'template', '.claude')
        : join(repoRoot, '.claude')
      return { hubStatePath: c, claudeRoot: root, checksums: state.checksums || {} }
    }
  }
  return null
}

function scanForbiddenTokens(text) {
  const hits = new Set()
  for (const re of FALLBACK_FORBIDDEN_TOKENS) {
    re.lastIndex = 0
    const m = text.match(re)
    if (m) for (const t of m) hits.add(t)
  }
  for (const needle of FALLBACK_PERSONAL_NEEDLES) {
    if (text.includes(needle)) hits.add(needle)
  }
  return Array.from(hits)
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const opts = parseArgs(process.argv.slice(2))
  const startRoot = resolveStarterRoot(opts)
  const repoRoot = (await findRepoRoot(startRoot)) || startRoot

  const violations = []
  const errors = []

  // (1) Maintainer-only skill 殘留偵測
  const agentsSkillsRoot = existsSync(join(repoRoot, 'template'))
    ? join(repoRoot, 'template', '.agents', 'skills')
    : join(repoRoot, '.agents', 'skills')
  for (const name of MAINTAINER_ONLY_SKILLS) {
    const skillDir = join(agentsSkillsRoot, name)
    if (existsSync(skillDir)) {
      violations.push({
        path: skillDir.replace(repoRoot + '/', ''),
        token: `maintainer-only skill: ${name}`,
      })
    }
  }

  // (2) hub-state checksums 列出的所有檔 grep forbidden token
  const state = await loadHubStateFiles(repoRoot)
  if (!state) {
    errors.push(
      `no .hub-state.json found under ${repoRoot}/template/.claude/ or ${repoRoot}/.claude/ — audit cannot proceed`,
    )
  } else {
    for (const rel of Object.keys(state.checksums)) {
      const abs = join(state.claudeRoot, rel)
      if (!existsSync(abs)) continue
      let text
      try {
        text = await readFile(abs, 'utf8')
      } catch (err) {
        errors.push(`${rel}: read failed (${err.message.split('\n')[0]})`)
        continue
      }
      const hits = scanForbiddenTokens(text)
      for (const token of hits) {
        violations.push({ path: rel, token })
      }
    }
  }

  // Output
  if (opts.json) {
    const out = { ok: violations.length === 0 && errors.length === 0, violations, errors }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  } else {
    if (errors.length > 0) {
      process.stderr.write('audit errors:\n')
      for (const e of errors) process.stderr.write(`  ✘ ${e}\n`)
    }
    if (violations.length === 0) {
      process.stdout.write('✓ audit-clade-leak: 0 violations\n')
    } else {
      process.stdout.write(`✘ audit-clade-leak: ${violations.length} violations\n`)
      const grouped = new Map()
      for (const v of violations) {
        if (!grouped.has(v.path)) grouped.set(v.path, [])
        grouped.get(v.path).push(v.token)
      }
      for (const [path, tokens] of grouped) {
        process.stdout.write(`  ${path}\n`)
        for (const t of tokens) process.stdout.write(`    - ${t}\n`)
      }
    }
  }

  process.exit(violations.length > 0 || errors.length > 0 ? 1 : 0)
}

const invokedDirect = fileURLToPath(import.meta.url) === resolve(process.argv[1] || '')
if (invokedDirect) {
  main().catch((err) => {
    process.stderr.write(`audit-clade-leak crashed: ${err.message}\n`)
    process.exit(2)
  })
}
