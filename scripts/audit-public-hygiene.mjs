#!/usr/bin/env node
// =============================================================================
// audit-public-hygiene.mjs — L3 starter-owned commands / skills allowlist gate
//
// 這支 script 屬 root meta 維護層（.claude/rules/starter-hygiene.md § L3 Commands
// Hygiene）。它檢查 template/ 內「會被 scaffold 帶走」的 agent surface，確認每個
// starter-owned command / skill 都經過 hygiene 審查（列在 allowlist），並擋下已被
// relocate 到 root 的項目重新出現在 template/。
//
// clade-managed 的檔案（列在 template/.claude/.hub-state.json checksums）不歸本 gate
// 管，交由 clade 側的 clade-starter-sanitization 處理。
//
// Usage:
//   node scripts/audit-public-hygiene.mjs                # violation 時 exit 1
//   node scripts/audit-public-hygiene.mjs --json         # 機器可讀輸出
//   node scripts/audit-public-hygiene.mjs --strict       # warning 也 fail
//   node scripts/audit-public-hygiene.mjs --report-only   # 只報告，一律 exit 0
//   node scripts/audit-public-hygiene.mjs --root <dir>    # 指定 repo root（測試用）
// =============================================================================

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..')

const CHECK_UNAUDITED = 'public-hygiene-unaudited-command'
const CHECK_RELOCATED = 'public-hygiene-relocated-artifact'
const CHECK_DENIED = 'public-hygiene-denied-artifact'

// .agents/ 與 .codex/ 是 sync-to-codex 從 .claude/ 產生的投影，且都在
// template/.gitignore 內（line 81 / 87）——不進版控 = 不會被 scaffold 帶走，
// 因此不在本 gate 的掃描範圍。.cursor/ 是 tracked 的投影，會被帶走，要掃。
const SCAN_TARGETS = [
  { dir: '.claude/commands', kind: 'commands', surface: 'claude' },
  { dir: '.claude/skills', kind: 'skills', surface: 'claude' },
  { dir: '.cursor/commands', kind: 'commands', surface: 'cursor' },
  { dir: '.cursor/skills', kind: 'skills', surface: 'cursor' },
]

function parseArgs(argv) {
  const opts = { json: false, strict: false, reportOnly: false, root: DEFAULT_ROOT }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') opts.json = true
    else if (arg === '--strict') opts.strict = true
    else if (arg === '--report-only') opts.reportOnly = true
    else if (arg === '--root') opts.root = resolve(argv[++i] ?? '.')
    else if (arg === '--help' || arg === '-h') opts.help = true
    else {
      console.error(`unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  return opts
}

function usage() {
  console.log(
    [
      'Usage: node scripts/audit-public-hygiene.mjs [options]',
      '',
      '  --json          輸出 JSON 報告',
      '  --strict        warning 也視為 failure',
      '  --report-only   只報告，一律 exit 0',
      '  --root <dir>    指定 repo root（預設為 script 的上層目錄）',
    ].join('\n'),
  )
}

// hub-state.json 的 checksums key 形如 rules/x.md、commands/db-migration.md、
// skills/spectra-apply/SKILL.md。取出 commands / skills 兩類的識別名。
function loadCladeManaged(root) {
  const statePath = join(root, 'template', '.claude', '.hub-state.json')
  const managed = { commands: new Set(), skills: new Set() }
  if (!existsSync(statePath)) return { managed, statePath, found: false }

  let state
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'))
  } catch (error) {
    throw new Error(`.hub-state.json is malformed JSON: ${error.message}`)
  }
  const checksums = state?.checksums
  if (!checksums || typeof checksums !== 'object') {
    throw new Error('.hub-state.json is missing a checksums object')
  }

  for (const key of Object.keys(checksums)) {
    const [head, second] = key.split('/')
    if (head === 'commands' && second) managed.commands.add(second.replace(/\.md$/, ''))
    else if (head === 'skills' && second) managed.skills.add(second)
  }
  return { managed, statePath, found: true }
}

function listEntries(dir, kind) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((entry) => !entry.startsWith('.'))
    .map((entry) => {
      const full = join(dir, entry)
      const isDir = statSync(full).isDirectory()
      return { entry, full, isDir }
    })
    .filter(({ isDir }) => (kind === 'skills' ? isDir : !isDir))
    .filter(({ entry, isDir }) => (isDir ? true : entry.endsWith('.md')))
}

// .cursor/ 投影會把 clade-managed 的 spectra skill 改名成 cursor-spectra-*.md，
// 名稱正規化後才對得上 hub-state 的識別名。
function normalizeName(entry, kind) {
  const raw = kind === 'skills' ? entry : basename(entry, '.md')
  return raw.replace(/^cursor-/, '')
}

function audit(opts) {
  const root = opts.root
  const templateRoot = join(root, 'template')
  if (!existsSync(templateRoot)) {
    throw new Error(`template/ not found under root: ${root}`)
  }

  const allowlistPath = join(SCRIPT_DIR, 'lib', 'public-hygiene-allowlist.json')
  const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'))
  const { managed, found: hubStateFound } = loadCladeManaged(root)

  const counts = {
    clade_managed_count: 0,
    starter_owned_keep_count: 0,
    starter_owned_unaudited_count: 0,
  }
  const violations = []
  const warnings = []

  for (const target of SCAN_TARGETS) {
    const dir = join(templateRoot, target.dir)
    const section = allowlist[target.kind] ?? {}
    const keep = new Set(section['starter-owned-keep'] ?? [])
    const relocate = new Set(section['starter-owned-relocate'] ?? [])
    const deny = new Set(section['starter-owned-deny'] ?? [])

    for (const { entry } of listEntries(dir, target.kind)) {
      const name = normalizeName(entry, target.kind)
      const relPath = `template/${target.dir}/${entry}`

      // .cursor/ 把 clade-managed 的 skill（spectra-* / commit）投影成 command 檔，
      // 所以 cursor surface 要同時比對 commands 與 skills 兩份 clade-managed 名單。
      const managedSets =
        target.surface === 'cursor'
          ? [managed.commands, managed.skills]
          : [managed[target.kind]]
      if (managedSets.some((set) => set.has(name))) {
        counts.clade_managed_count++
        continue
      }
      if (relocate.has(name)) {
        violations.push({
          check: CHECK_RELOCATED,
          path: relPath,
          name,
          message: `${name} 已 relocate 到 root meta 層，不該再出現在 template/`,
          fix: `刪除 ${relPath}；root 端維護者版本在 .claude/commands/${name}.md`,
        })
        continue
      }
      if (deny.has(name)) {
        violations.push({
          check: CHECK_DENIED,
          path: relPath,
          name,
          message: `${name} 在 deny-list 上，不得進入會被 scaffold 帶走的 template/`,
          fix: `移出 template/，或改到 root meta 層`,
        })
        continue
      }
      if (keep.has(name)) {
        counts.starter_owned_keep_count++
        continue
      }
      counts.starter_owned_unaudited_count++
      warnings.push({
        check: CHECK_UNAUDITED,
        path: relPath,
        name,
        message: `${name} 是 starter-owned ${target.kind}，但未經 public hygiene 審查`,
        fix: `走 change ceremony 審查其 disposition，並補進 scripts/lib/public-hygiene-allowlist.json 的 ${target.kind} 段`,
      })
    }
  }

  return { counts, violations, warnings, hubStateFound }
}

function report(result, opts) {
  const { counts, violations, warnings, hubStateFound } = result

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ...counts,
          hub_state_found: hubStateFound,
          violations,
          warnings,
        },
        null,
        2,
      ),
    )
  } else {
    console.log('== Public Hygiene Audit (L3 starter-owned commands / skills) ==')
    if (!hubStateFound) {
      console.log('注意: 找不到 template/.claude/.hub-state.json，所有檔案都當成 starter-owned')
    }
    console.log(`clade-managed:            ${counts.clade_managed_count}`)
    console.log(`starter-owned (allowed):  ${counts.starter_owned_keep_count}`)
    console.log(`starter-owned (unaudited): ${counts.starter_owned_unaudited_count}`)
    console.log('')

    for (const item of violations) {
      console.log(`[Starter Hygiene] ${item.check} 不通過`)
      console.log(`問題: ${item.message}`)
      console.log(`證據: ${item.path}`)
      console.log(`修正方式: ${item.fix}`)
      console.log(
        '繞過方式: 只有在 Spectra artifact / PR / commit context 記錄明確 rationale 後，才允許使用維護者明示的 bypass。',
      )
      console.log('')
    }
    for (const item of warnings) {
      console.log(`[Starter Hygiene] ${item.check} 警告`)
      console.log(`問題: ${item.message}`)
      console.log(`證據: ${item.path}`)
      console.log(`修正方式: ${item.fix}`)
      console.log('')
    }

    const verdict = violations.length === 0 ? 'PASS' : 'FAIL'
    console.log(
      `Public hygiene audit result: ${verdict} (${violations.length} violations, ${warnings.length} warnings)`,
    )
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    usage()
    return 0
  }

  let result
  try {
    result = audit(opts)
  } catch (error) {
    console.error(`audit-public-hygiene: ${error.message}`)
    return 2
  }

  report(result, opts)

  if (opts.reportOnly) return 0
  if (result.violations.length > 0) return 1
  if (opts.strict && result.warnings.length > 0) return 1
  return 0
}

process.exit(main())
