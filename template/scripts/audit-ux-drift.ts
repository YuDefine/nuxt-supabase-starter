#!/usr/bin/env node
/**
 * UX Drift Auditor (spectra-ux)
 *
 * Scans typed enum definitions (`as const` arrays, Zod `z.enum(...)`) and
 * reports consumers that appear to handle the enum non-exhaustively.
 *
 * Heuristic: a *function-sized slice* that references 2+ literal values of an
 * enum but is missing at least one value is flagged as a suspected drift.
 * Slices using `switch` + `assertNever` are excluded (TypeScript already
 * enforces them).
 *
 * Comparison scope is the function, not the whole file — matching literals
 * across unrelated functions was the bulk of historical false positives.
 * Slicing is heuristic (brace balancing over a string/comment-masked copy);
 * there is no TS parse. Code outside any function body is compared as a single
 * `module` slice so `<script setup>` top-level handlers stay covered. Within a
 * slice, an enum whose matched literals are fully explained by another enum is
 * dropped (see dropSubsumed) — enum value sets overlap heavily.
 *
 * Configuration: reads `spectra-advanced.config.json` (or legacy `spectra-ux.config.json`)
 * from the project root. Falls back to Nuxt-style defaults when no config is present.
 *
 * Usage:
 *   node scripts/audit-ux-drift.ts             # full repo scan (default)
 *   node scripts/audit-ux-drift.ts --changed   # scan only files in git diff
 *   node scripts/audit-ux-drift.ts --json      # machine-readable output
 *   node scripts/audit-ux-drift.ts --repo ../other  # audit another checkout (read-only)
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
  /** Enclosing function name, or `module` for top-level code. */
  scope: string
  /** 1-based line where the enclosing slice starts. */
  line: number
  present: string[]
  missing: string[]
  handlerKind: 'switch' | 'if-chain'
}

interface CliOptions {
  changed: boolean
  json: boolean
  repo: string | null
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { changed: false, json: false, repo: null }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    if (arg === '--changed') opts.changed = true
    else if (arg === '--json') opts.json = true
    else if (arg === '--repo') {
      const value = rest[++i]
      if (!value) {
        console.error('audit-ux-drift: --repo requires a path')
        process.exit(2)
      }
      opts.repo = resolve(value)
    } else if (arg.startsWith('--repo=')) {
      opts.repo = resolve(arg.slice('--repo='.length))
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: audit-ux-drift.ts [--changed] [--json] [--repo <path>]\n' +
          '  --changed   Scan only files touched in git diff HEAD\n' +
          '  --json      Emit machine-readable JSON on stdout\n' +
          "  --repo      Audit another checkout (read-only) instead of this script's repo",
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
// marker (spectra-advanced.config.json or .git). 8 is generous enough for deeply
// nested scripts/ layouts while still failing fast on malformed installs.
const MAX_WALK_DEPTH = 8

// Prefer the current name; keep legacy name as fallback (matches claims-lib.ts
// and roadmap-sync.ts dual-name resolution after the spectra-ux → spectra-advanced rename).
const CONFIG_NAMES = ['spectra-advanced.config.json', 'spectra-ux.config.json']

function resolveConfigPath(dir: string): string | null {
  for (const name of CONFIG_NAMES) {
    const candidate = resolve(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function findRepoRoot(): string {
  // Prefer spectra-advanced.config.json as the root marker — it's the canonical
  // anchor for "where spectra-advanced was installed". This handles nested project
  // layouts (e.g. starter templates inside a parent monorepo) where .git
  // would walk past the actual project root.
  let dir = __dirname
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    if (resolveConfigPath(dir)) return dir
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

const repoRoot = cli.repo ?? findRepoRoot()

const DEFAULT_CONFIG: ScanConfig = {
  typesDirs: ['shared/types', 'packages/*/shared/types'],
  uiDirs: ['app/pages', 'app/components', 'app'],
  uiExtensions: ['.vue', '.ts', '.tsx', '.jsx'],
  serverDirs: ['server', 'shared'],
}

function loadConfig(): ScanConfig {
  const configPath = resolveConfigPath(repoRoot)
  if (!configPath) return DEFAULT_CONFIG
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
    console.error(`audit-ux-drift: failed to read config: ${err}`)
    return DEFAULT_CONFIG
  }
}

function asArray(v: string | string[] | undefined, fallback: string[]): string[] {
  if (v === null || v === undefined) return fallback
  return Array.isArray(v) ? v : [v]
}

const config = loadConfig()

// List files tracked by git under a directory, filtered by extensions.
// Supports glob patterns in dir (e.g. packages/star/shared/types).
function gitList(dir: string, exts: string[]): string[] {
  // If `dir` contains `*`, use git's :(glob) pathspec magic + /** suffix
  // to expand wildcard segments. Plain dirs pass through unchanged.
  const pathspec = dir.includes('*') ? `:(glob)${dir}/**` : dir
  const result = spawnSync('git', ['ls-files', '--', pathspec], {
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

/**
 * Replace every string / template / comment / regex-literal body with spaces,
 * preserving offsets and newlines. Brace matching and function-marker detection
 * run on this copy so a `'}'` inside a string can't unbalance a slice; literal
 * matching still runs on the original text.
 */
function maskNonCode(src: string): string {
  const out = src.split('')
  const n = src.length
  let i = 0
  let prevCode = ''
  const blank = (at: number): void => {
    if (src[at] !== '\n') out[at] = ' '
  }
  while (i < n) {
    const c = src[i]!
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') blank(i++)
      continue
    }
    if (c === '/' && next === '*') {
      blank(i++)
      blank(i++)
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) blank(i++)
      if (i < n) {
        blank(i++)
        blank(i++)
      }
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      blank(i++)
      while (i < n) {
        if (src[i] === '\\') {
          blank(i++)
          if (i < n) blank(i++)
          continue
        }
        const done = src[i] === c
        blank(i++)
        if (done) break
      }
      prevCode = 'x'
      continue
    }
    // Regex literal: only after an operator / opening bracket, never after a
    // value (which would make `/` a division sign).
    if (c === '/' && (prevCode === '' || '([{,;=:!&|?+-*%^~<>'.includes(prevCode))) {
      blank(i++)
      let inClass = false
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') {
          blank(i++)
          if (i < n) blank(i++)
          continue
        }
        if (src[i] === '[') inClass = true
        else if (src[i] === ']') inClass = false
        const done = src[i] === '/' && !inClass
        blank(i++)
        if (done) break
      }
      prevCode = 'x'
      continue
    }
    if (!/\s/.test(c)) prevCode = c
    i++
  }
  return out.join('')
}

interface CodeSlice {
  /** Best-effort function name (or `module` for top-level code). */
  scope: string
  /** 1-based line of the slice start in the original file. */
  line: number
  text: string
}

const FN_MARKER_RE = /\bfunction\b|=>/g

function lineOf(content: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset; i++) if (content[i] === '\n') line++
  return line
}

/** Best-effort label: first meaningful identifier on the marker's own line. */
function scopeNameAt(content: string, offset: number): string {
  const lineStart = content.lastIndexOf('\n', offset) + 1
  let lineEnd = content.indexOf('\n', offset)
  if (lineEnd === -1) lineEnd = content.length
  const head = content.slice(lineStart, lineEnd)
  const idents = [...head.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]!)
  const skip = new Set([
    'export',
    'default',
    'const',
    'let',
    'var',
    'async',
    'await',
    'return',
    'function',
    'new',
    'public',
    'private',
    'protected',
    'static',
    'readonly',
  ])
  for (const id of idents) if (!skip.has(id)) return id
  return 'anonymous'
}

/**
 * Split a file into outermost function bodies plus one `module` slice holding
 * everything else. Nested functions stay inside their enclosing slice — the
 * unit of comparison is the function, not the innermost block.
 */
function sliceFunctions(content: string): CodeSlice[] {
  const masked = maskNonCode(content)
  const slices: CodeSlice[] = []
  const covered: Array<[number, number]> = []
  let cursor = 0

  FN_MARKER_RE.lastIndex = 0
  let marker: RegExpExecArray | null
  while ((marker = FN_MARKER_RE.exec(masked)) !== null) {
    const start = marker.index
    if (start < cursor) continue

    // Locate the body's opening brace. Bail out on statement-ish separators so
    // an expression-bodied arrow (`=> x + 1`) never swallows a later block.
    let i = marker.index + marker[0].length
    let open = -1
    while (i < masked.length) {
      const ch = masked[i]!
      if (ch === '{') {
        open = i
        break
      }
      if (ch === ';' || ch === '}') break
      if (marker[0] === '=>' && !/\s/.test(ch)) break
      i++
    }
    if (open === -1) continue

    // Brace-balance to the body's end.
    let depth = 0
    let end = -1
    for (let j = open; j < masked.length; j++) {
      const ch = masked[j]!
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          end = j + 1
          break
        }
      }
    }
    if (end === -1) continue

    slices.push({
      scope: scopeNameAt(content, start),
      line: lineOf(content, start),
      text: content.slice(start, end),
    })
    covered.push([start, end])
    cursor = end
    FN_MARKER_RE.lastIndex = end
  }

  // Everything outside a function body — `<script setup>` top level, module
  // constants, config objects — is compared as one slice.
  const gaps: string[] = []
  let at = 0
  for (const [start, end] of covered) {
    if (start > at) gaps.push(content.slice(at, start))
    at = end
  }
  if (at < content.length) gaps.push(content.slice(at))
  const moduleText = gaps.join('\n')
  if (moduleText.trim()) slices.unshift({ scope: 'module', line: 1, text: moduleText })

  return slices
}

function auditSlice(file: string, slice: CodeSlice, enumDef: EnumDef): DriftFinding | null {
  const present = new Set<string>()
  for (const v of enumDef.values) {
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?:===|!==|==|!=|case)\\s*['"]${escaped}['"]`, 'g')
    if (re.test(slice.text)) present.add(v)
  }

  if (present.size < 2) return null

  const missing = enumDef.values.filter((v) => !present.has(v))
  if (missing.length === 0) return null

  // Classify: a slice with `case '...':` lines is treated as a switch,
  // otherwise it's an if-chain. Switches that use assertNever are already
  // compiler-enforced, so they're excluded from drift reports.
  const hasCase = /\bcase\s+['"]/m.test(slice.text)
  const handlerKind: DriftFinding['handlerKind'] = hasCase ? 'switch' : 'if-chain'

  if (handlerKind === 'switch' && /assertNever\s*\(/.test(slice.text)) {
    return null
  }

  return {
    file: relative(repoRoot, file),
    enumName: enumDef.name,
    scope: slice.scope,
    line: slice.line,
    present: [...present].toSorted(),
    missing,
    handlerKind,
  }
}

function auditFile(
  file: string,
  slices: CodeSlice[],
  content: string,
  enumDef: EnumDef,
): DriftFinding[] {
  // The ignore comment is a user-authored exemption: it stays file-wide even
  // though comparison is now per-slice.
  const ignoreRe = new RegExp(`ux-drift-audit:\\s*ignore\\s+${enumDef.name}\\b`)
  if (ignoreRe.test(content)) return []

  const findings: DriftFinding[] = []
  for (const slice of slices) {
    const finding = auditSlice(file, slice, enumDef)
    if (finding) findings.push(finding)
  }
  return findings
}

/**
 * Enum value sets overlap heavily (`pending` / `approved` / `rejected` appear
 * in dozens of them), so one handler comparing two literals matches every enum
 * that happens to contain both. Keep a finding only when its evidence isn't
 * fully explained by another enum matched in the same slice: A is dropped when
 * some B matched a strict superset of A's literals, or the same literal set
 * with tighter coverage. Genuinely distinct enums in one function match
 * different literals, so neither subsumes the other and both survive.
 */
function dropSubsumed(findings: DriftFinding[], enumByName: Map<string, EnumDef>): DriftFinding[] {
  if (findings.length < 2) return findings

  const coverage = (f: DriftFinding): number => {
    const total = enumByName.get(f.enumName)?.values.length ?? f.present.length + f.missing.length
    return f.present.length / total
  }
  const betterThan = (a: DriftFinding, b: DriftFinding): boolean => {
    const ca = coverage(a)
    const cb = coverage(b)
    if (ca !== cb) return ca > cb
    if (a.missing.length !== b.missing.length) return a.missing.length < b.missing.length
    return a.enumName < b.enumName
  }

  return findings.filter((f) => {
    const own = new Set(f.present)
    return !findings.some((other) => {
      if (other === f) return false
      const theirs = new Set(other.present)
      const coversOwn = [...own].every((v) => theirs.has(v))
      if (!coversOwn) return false
      // Strict superset wins outright; identical evidence is decided by fit.
      if (theirs.size > own.size) return true
      return betterThan(other, f)
    })
  })
}

interface Report {
  enums: Array<{ name: string; values: string[]; source: string }>
  scanned: number
  mode: 'full' | 'changed'
  findings: DriftFinding[]
}

function runScan(): Report {
  const enums = extractEnums()
  const enumByName = new Map(enums.map((e) => [e.name, e]))
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
    const slices = sliceFunctions(content)
    for (const slice of slices) {
      const perSlice: DriftFinding[] = []
      for (const enumDef of enums) {
        perSlice.push(...auditFile(consumer, [slice], content, enumDef))
      }
      findings.push(...dropSubsumed(perSlice, enumByName))
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
    console.error(
      '✗ No enum-like definitions found in configured types dirs.\n' +
        `  Searched: ${config.typesDirs.join(', ')}\n` +
        '  This likely means the config is missing or typesDirs points to a wrong path.\n' +
        '  Fix: create spectra-advanced.config.json with correct paths.types, or verify the default typesDirs match your project layout.',
    )
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
      console.log(
        `    · ${f.enumName} in ${f.scope}() :${f.line} [${f.handlerKind}] missing: ${f.missing.join(', ')}`,
      )
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

  if (report.enums.length === 0) {
    // "Found nothing" ≠ "no drift" — config is broken or typesDirs is wrong.
    // Exit 2 (script error) to fail loud, not silently pass.
    process.exit(2)
  }
  if (report.findings.length === 0) process.exit(0)
  process.exit(1)
}

try {
  main()
} catch (err) {
  console.error('audit-ux-drift script error:', err)
  process.exit(2)
}
