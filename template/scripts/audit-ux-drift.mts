#!/usr/bin/env node
/**
 * UX Drift Auditor (spectra-ux)
 *
 * Scans typed enum definitions (`as const` arrays, Zod `z.enum(...)`) and
 * reports consumers that appear to handle the enum non-exhaustively.
 *
 * Heuristic: a file that references 2+ literal values of an enum but is
 * missing at least one value is flagged as a suspected drift. Files using
 * `switch` + `assertNever` are excluded (TypeScript already enforces them).
 *
 * Configuration: reads `spectra-ux.config.json` from the project root.
 * Falls back to Nuxt-style defaults when no config is present.
 *
 * Usage:
 *   node scripts/audit-ux-drift.mts             # full repo scan (default)
 *   node scripts/audit-ux-drift.mts --changed   # scan only files in git diff
 *   node scripts/audit-ux-drift.mts --json      # machine-readable output
 *
 * Exit: 0 clean · 1 drift found · 2 script error
 *
 * Suppress per-file: `// ux-drift-audit: ignore <EnumName>`
 *
 * See docs/rules/ux-completeness.md for the Exhaustiveness Rule.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface ScanConfig {
  typesDirs: string[]
  uiDirs: string[]
  uiExtensions: string[]
  serverDirs: string[]
}

interface EnumDef {
  name: string
  values: string[]
  source: string
}

interface DriftFinding {
  file: string
  enumName: string
  present: string[]
  missing: string[]
  handlerKind: 'switch' | 'if-chain'
}

interface CliOptions {
  changed: boolean
  json: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { changed: false, json: false }
  for (const arg of argv.slice(2)) {
    if (arg === '--changed') opts.changed = true
    else if (arg === '--json') opts.json = true
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: audit-ux-drift.mts [--changed] [--json]\n' +
          '  --changed   Scan only files touched in git diff HEAD\n' +
          '  --json      Emit machine-readable JSON on stdout'
      )
      process.exit(0)
    } else {
      console.error(`audit-ux-drift: unknown flag ${arg}`)
      process.exit(2)
    }
  }
  return opts
}

const cli = parseArgs(process.argv)

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Maximum directory levels to walk upward when hunting for a project root
// marker (spectra-ux.config.json or .git). 8 is generous enough for deeply
// nested scripts/ layouts while still failing fast on malformed installs.
const MAX_WALK_DEPTH = 8

function findRepoRoot(): string {
  // Prefer spectra-ux.config.json as the root marker — it's the canonical
  // anchor for "where spectra-ux was installed". This handles nested project
  // layouts (e.g. starter templates inside a parent monorepo) where .git
  // would walk past the actual project root.
  let dir = __dirname
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    if (existsSync(resolve(dir, 'spectra-ux.config.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Fallback: walk up looking for .git
  dir = __dirname
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    if (existsSync(resolve(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return resolve(__dirname, '..')
}

const repoRoot = findRepoRoot()

const DEFAULT_CONFIG: ScanConfig = {
  typesDirs: ['shared/types'],
  uiDirs: ['app/pages', 'app/components', 'app'],
  uiExtensions: ['.vue', '.ts', '.tsx', '.jsx'],
  serverDirs: ['server', 'shared'],
}

function loadConfig(): ScanConfig {
  const configPath = resolve(repoRoot, 'spectra-ux.config.json')
  if (!existsSync(configPath)) return DEFAULT_CONFIG
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      paths?: {
        types?: string | string[]
        ui?: string | string[]
        uiExtensions?: string | string[]
        server?: string | string[]
      }
    }
    const p = raw.paths ?? {}
    return {
      typesDirs: asArray(p.types, DEFAULT_CONFIG.typesDirs),
      uiDirs: asArray(p.ui, DEFAULT_CONFIG.uiDirs),
      uiExtensions: asArray(p.uiExtensions, DEFAULT_CONFIG.uiExtensions),
      serverDirs: asArray(p.server, DEFAULT_CONFIG.serverDirs),
    }
  } catch (err) {
    console.error(`audit-ux-drift: failed to read spectra-ux.config.json: ${err}`)
    return DEFAULT_CONFIG
  }
}

function asArray(v: string | string[] | undefined, fallback: string[]): string[] {
  if (v === null || v === undefined) return fallback
  return Array.isArray(v) ? v : [v]
}

const config = loadConfig()

/** List files tracked by git under a directory, filtered by extensions. */
function gitList(dir: string, exts: string[]): string[] {
  const result = spawnSync('git', ['ls-files', '--', dir], {
    cwd: repoRoot,
    encoding: 'utf-8',
  })
  if (result.status !== 0 || !result.stdout) return []
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .filter((p) => exts.some((e) => p.endsWith(e)))
    .map((p) => resolve(repoRoot, p))
}

/** Files touched in the working tree + index (for --changed mode). */
function gitTouchedFiles(): Set<string> {
  const touched = new Set<string>()
  const diffArgs = [
    ['diff', '--name-only', 'HEAD'],
    ['diff', '--cached', '--name-only'],
  ]
  for (const args of diffArgs) {
    const result = spawnSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf-8',
    })
    if (result.status === 0 && result.stdout) {
      for (const line of result.stdout.split('\n').filter(Boolean)) {
        touched.add(resolve(repoRoot, line))
      }
    }
  }
  return touched
}

function readSafe(path: string): string {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
}

function extractEnums(): EnumDef[] {
  const files: string[] = []
  for (const dir of config.typesDirs) {
    for (const f of gitList(dir, ['.ts'])) files.push(f)
  }

  const enums: EnumDef[] = []
  for (const file of files) {
    const content = readSafe(file)
    const rel = relative(repoRoot, file)

    // Pattern A: export const FOO_BAR = ['a', 'b', 'c'] as const
    const constAsConstRe = /export\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*\[([^\]]+)\]\s*as\s+const/g
    let match: RegExpExecArray | null
    while ((match = constAsConstRe.exec(content)) !== null) {
      const name = match[1]!
      const body = match[2]!
      const values = [...body.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]!)
      if (values.length >= 2) enums.push({ name, values, source: rel })
    }

    // Pattern B: z.enum(['a', 'b', 'c']) assigned to a const
    const zEnumRe = /(?:export\s+)?const\s+(\w+)\s*=\s*z\.enum\s*\(\s*\[([^\]]+)\]/g
    while ((match = zEnumRe.exec(content)) !== null) {
      const name = match[1]!
      const body = match[2]!
      const values = [...body.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]!)
      if (values.length >= 2) enums.push({ name, values, source: rel })
    }
  }

  const byName = new Map<string, EnumDef>()
  for (const e of enums) {
    const existing = byName.get(e.name)
    if (!existing || e.values.length > existing.values.length) {
      byName.set(e.name, e)
    }
  }
  return [...byName.values()]
}

function collectConsumers(): string[] {
  const set = new Set<string>()
  for (const dir of config.uiDirs) {
    for (const f of gitList(dir, config.uiExtensions)) set.add(f)
  }
  for (const dir of config.serverDirs) {
    for (const f of gitList(dir, ['.ts', '.tsx'])) set.add(f)
  }
  return [...set]
}

function auditFile(file: string, content: string, enumDef: EnumDef): DriftFinding | null {
  const ignoreRe = new RegExp(`ux-drift-audit:\\s*ignore\\s+${enumDef.name}\\b`)
  if (ignoreRe.test(content)) return null

  const present = new Set<string>()
  for (const v of enumDef.values) {
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?:===|!==|==|!=|case)\\s*['"]${escaped}['"]`, 'g')
    if (re.test(content)) present.add(v)
  }

  if (present.size < 2) return null

  const missing = enumDef.values.filter((v) => !present.has(v))
  if (missing.length === 0) return null

  // Classify: a file with `case '...':` lines is treated as a switch,
  // otherwise it's an if-chain. Switches that use assertNever are already
  // compiler-enforced, so they're excluded from drift reports.
  const hasCase = /\bcase\s+['"]/m.test(content)
  const handlerKind: DriftFinding['handlerKind'] = hasCase ? 'switch' : 'if-chain'

  if (handlerKind === 'switch' && /assertNever\s*\(/.test(content)) {
    return null
  }

  return {
    file: relative(repoRoot, file),
    enumName: enumDef.name,
    present: [...present].toSorted(),
    missing,
    handlerKind,
  }
}

interface Report {
  enums: Array<{ name: string; values: string[]; source: string }>
  scanned: number
  mode: 'full' | 'changed'
  findings: DriftFinding[]
}

function runScan(): Report {
  const enums = extractEnums()
  const allConsumers = collectConsumers()

  let consumers = allConsumers
  if (cli.changed) {
    const touched = gitTouchedFiles()
    consumers = allConsumers.filter((c) => touched.has(c))
  }

  const findings: DriftFinding[] = []
  for (const consumer of consumers) {
    const content = readSafe(consumer)
    if (!content) continue
    for (const enumDef of enums) {
      const finding = auditFile(consumer, content, enumDef)
      if (finding) findings.push(finding)
    }
  }

  return {
    enums: enums.map((e) => ({
      name: e.name,
      values: e.values,
      source: e.source,
    })),
    scanned: consumers.length,
    mode: cli.changed ? 'changed' : 'full',
    findings,
  }
}

function emitJson(report: Report): void {
  console.log(JSON.stringify(report, null, 2))
}

function emitText(report: Report): void {
  if (report.enums.length === 0) {
    console.log('⊘ No enum-like definitions found in configured types dirs.')
    return
  }

  const label = report.mode === 'changed' ? ' (changed files only)' : ''
  console.log(`→ Scanning ${report.enums.length} enum(s) across codebase${label}...`)
  for (const e of report.enums) {
    console.log(`  · ${e.name} (${e.values.length} values) ← ${e.source}`)
  }
  console.log()

  if (report.findings.length === 0) {
    console.log('✓ No UX drift detected.')
    return
  }

  console.log(`✗ Found ${report.findings.length} suspected drift site(s):`)
  console.log()

  const byFile = new Map<string, DriftFinding[]>()
  for (const f of report.findings) {
    const arr = byFile.get(f.file) ?? []
    arr.push(f)
    byFile.set(f.file, arr)
  }

  for (const [file, fs] of byFile) {
    console.log(`  ${file}`)
    for (const f of fs) {
      console.log(`    · ${f.enumName} [${f.handlerKind}] missing: ${f.missing.join(', ')}`)
    }
  }
  console.log()
  console.log('Fix options:')
  console.log('  1. Convert if-chain to switch + assertNever (preferred)')
  console.log('  2. Add the missing cases to the existing handler')
  console.log('  3. Suppress: add `// ux-drift-audit: ignore <EnumName>` near handler')
  console.log()
  console.log('See docs/rules/ux-completeness.md — Exhaustiveness Rule')
}

function main(): void {
  const report = runScan()

  if (cli.json) {
    emitJson(report)
  } else {
    emitText(report)
  }

  if (report.enums.length === 0) process.exit(0)
  if (report.findings.length === 0) process.exit(0)
  process.exit(1)
}

try {
  main()
} catch (err) {
  console.error('audit-ux-drift script error:', err)
  process.exit(2)
}
