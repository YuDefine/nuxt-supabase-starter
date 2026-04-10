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
 *   node scripts/audit-ux-drift.ts
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
  handlerKind: 'switch' | 'if-chain' | 'mixed'
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function findRepoRoot(): string {
  // Prefer spectra-ux.config.json as the root marker — it's the canonical
  // anchor for "where spectra-ux was installed". This handles nested project
  // layouts (e.g. starter templates inside a parent monorepo) where .git
  // would walk past the actual project root.
  let dir = __dirname
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, 'spectra-ux.config.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Fallback: walk up looking for .git
  dir = __dirname
  for (let i = 0; i < 6; i++) {
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
    const asArray = (v: string | string[] | undefined, fallback: string[]) =>
      v == null ? fallback : Array.isArray(v) ? v : [v]
    return {
      typesDirs: asArray(p.types, DEFAULT_CONFIG.typesDirs),
      uiDirs: asArray(p.ui, DEFAULT_CONFIG.uiDirs),
      uiExtensions: asArray(p.uiExtensions, DEFAULT_CONFIG.uiExtensions),
      serverDirs: asArray(p.server, DEFAULT_CONFIG.serverDirs),
    }
  } catch (err) {
    console.error(
      `audit-ux-drift: failed to read spectra-ux.config.json: ${err}`
    )
    return DEFAULT_CONFIG
  }
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
    const constAsConstRe =
      /export\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*\[([^\]]+)\]\s*as\s+const/g
    let match: RegExpExecArray | null
    while ((match = constAsConstRe.exec(content)) !== null) {
      const name = match[1]!
      const body = match[2]!
      const values = [...body.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]!)
      if (values.length >= 2) enums.push({ name, values, source: rel })
    }

    // Pattern B: z.enum(['a', 'b', 'c']) assigned to a const
    const zEnumRe =
      /(?:export\s+)?const\s+(\w+)\s*=\s*z\.enum\s*\(\s*\[([^\]]+)\]/g
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

function auditFile(file: string, enumDef: EnumDef): DriftFinding | null {
  const content = readSafe(file)
  if (!content) return null

  const ignoreRe = new RegExp(
    `ux-drift-audit:\\s*ignore\\s+${enumDef.name}\\b`
  )
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

  const hasCase = /\bcase\s+['"]/m.test(content)
  const hasIf = /\bif\s*\(\s*\w+\s*===/m.test(content)
  let handlerKind: DriftFinding['handlerKind'] = 'if-chain'
  if (hasCase && !hasIf) handlerKind = 'switch'
  else if (hasCase && hasIf) handlerKind = 'mixed'

  if (handlerKind === 'switch' && /assertNever\s*\(/.test(content)) {
    return null
  }

  return {
    file: relative(repoRoot, file),
    enumName: enumDef.name,
    present: [...present].sort(),
    missing,
    handlerKind,
  }
}

function main(): void {
  const enums = extractEnums()
  if (enums.length === 0) {
    console.log('⊘ No enum-like definitions found in configured types dirs.')
    process.exit(0)
  }

  console.log(`→ Scanning ${enums.length} enum(s) across codebase...`)
  for (const e of enums) {
    console.log(`  · ${e.name} (${e.values.length} values) ← ${e.source}`)
  }
  console.log()

  const consumers = collectConsumers()
  const findings: DriftFinding[] = []

  for (const consumer of consumers) {
    for (const enumDef of enums) {
      const finding = auditFile(consumer, enumDef)
      if (finding) findings.push(finding)
    }
  }

  if (findings.length === 0) {
    console.log('✓ No UX drift detected.')
    process.exit(0)
  }

  console.log(`✗ Found ${findings.length} suspected drift site(s):`)
  console.log()

  const byFile = new Map<string, DriftFinding[]>()
  for (const f of findings) {
    const arr = byFile.get(f.file) ?? []
    arr.push(f)
    byFile.set(f.file, arr)
  }

  for (const [file, fs] of byFile) {
    console.log(`  ${file}`)
    for (const f of fs) {
      console.log(
        `    · ${f.enumName} [${f.handlerKind}] missing: ${f.missing.join(', ')}`
      )
    }
  }
  console.log()
  console.log('Fix options:')
  console.log('  1. Convert if-chain to switch + assertNever (preferred)')
  console.log('  2. Add the missing cases to the existing handler')
  console.log(
    '  3. Suppress: add `// ux-drift-audit: ignore <EnumName>` near handler'
  )
  console.log()
  console.log('See docs/rules/ux-completeness.md — Exhaustiveness Rule')
  process.exit(1)
}

try {
  main()
} catch (err) {
  console.error('audit-ux-drift script error:', err)
  process.exit(2)
}
