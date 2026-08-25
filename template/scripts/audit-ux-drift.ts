#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/audit-ux-drift.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/audit-ux-drift.ts
/**
 * UX Drift Auditor (spectra-ux)
 *
 * Scans typed enum definitions (`as const` arrays, Zod `z.enum(...)`) and
 * reports consumers that appear to handle the enum non-exhaustively.
 *
 * Heuristic: within a slice, comparisons are grouped by the expression they
 * compare (`facet.availability`, `questionConfigSection`). A group with 2+
 * positive branches on one enum's values, missing at least one value, is
 * flagged as a suspected drift. A subject passed to `assertNever` is excluded
 * (TypeScript already enforces it).
 *
 * Comparison scope is the function, not the whole file — matching literals
 * across unrelated functions was the bulk of historical false positives.
 * Slicing is heuristic (brace balancing over a string/comment-masked copy);
 * there is no TS parse. `.vue` files are split by SFC block first, so markup
 * and top-level script code never pool their literals. Code outside any
 * function body is compared as a single `module` slice so `<script setup>`
 * top-level handlers stay covered.
 *
 * Four guards keep literal coincidence from reading as drift (see TD-064):
 *   · per-subject grouping — two dispatchers in one slice stay separate, and
 *     each exemption below binds to one subject rather than the whole slice
 *   · declared domains win — a symbol annotated `computed<'a' | 'b'>` is not
 *     an enum that merely happens to contain `a` and `b`. Only module-level
 *     declarations are consulted from another slice, and a name declared twice
 *     with conflicting domains is dropped rather than guessed at
 *   · 2+ *positive* branches required — `x !== 'a' && x !== 'b'` is a guard.
 *     Negated comparisons never count as coverage: `x !== 'c'` narrows without
 *     giving `c` a branch
 *   · top-level returned literals count as handled — a fallthrough
 *     `return 'ready'` covers `ready` without an explicit `=== 'ready'`, but a
 *     return inside a nested helper does not, and neither does a return in a
 *     slice holding two dispatchers: the literal names no subject, so there is
 *     nothing to say whose gap it closes
 *
 * Known bound: a comparison's subject must be a dotted identifier chain
 * (`facet.availability`, `props?.status`). Computed access (`row[key] === 'draft'`)
 * and call results (`getStatus() === 'draft'`) are not scanned at all — those
 * dispatchers are invisible to this audit, which under-reports rather than
 * false-positives. Widening it needs a real expression parse, not a longer regex.
 *
 * Within a slice, an enum whose matched literals are fully explained by
 * another enum on the same subject is dropped (see dropSubsumed) — enum value
 * sets overlap heavily.
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
import { isRecord } from './lib/json-unknown.ts'

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
  /** Normalized expression the branches compare against (`facet.availability`). */
  subject: string
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
    const raw: unknown = JSON.parse(readFileSync(configPath, 'utf-8'))
    if (!isRecord(raw)) return DEFAULT_CONFIG
    const paths = isRecord(raw.paths) ? raw.paths : {}
    const p = paths
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

function asArray(v: unknown, fallback: string[]): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v) && v.every((item) => typeof item === 'string')) return v
  return fallback
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

/**
 * Blank out everything outside `[start, end)`, preserving offsets and newlines
 * so line numbers computed against the result still match the original file.
 */
function isolateRange(content: string, start: number, end: number): string {
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ')
  return blank(content.slice(0, start)) + content.slice(start, end) + blank(content.slice(end))
}

/**
 * `<script>` block bodies. Scripts never nest, so each opening tag pairs with
 * the next closing tag. Indentation is tolerated — an indented `<script>` is
 * unusual but must not make the file invisible to the audit.
 */
function sfcScriptBlocks(content: string): Array<[number, number]> {
  const openRe = /^[ \t]*<script(?:\s[^>]*)?>/gm
  const ranges: Array<[number, number]> = []
  let m: RegExpExecArray | null
  while ((m = openRe.exec(content)) !== null) {
    const bodyStart = m.index + m[0].length
    const closeIdx = content.indexOf('</script>', bodyStart)
    const end = closeIdx === -1 ? content.length : closeIdx
    ranges.push([bodyStart, end])
    openRe.lastIndex = end
  }
  return ranges
}

/**
 * The single root `<template>` body. Vue's `<template v-if>` nests inside it,
 * so the range runs from the *first* opening tag to the *last* closing tag
 * rather than pairing them — pairing would cut the block at a nested child.
 */
function sfcTemplateBlock(content: string): [number, number] | null {
  const open = /^[ \t]*<template(?:\s[^>]*)?>/m.exec(content)
  if (!open) return null
  const closeIdx = content.lastIndexOf('</template>')
  const bodyStart = open.index + open[0].length
  if (closeIdx < bodyStart) return null
  return [bodyStart, closeIdx]
}

/**
 * Slice a consumer file. Plain `.ts` files slice by function body. `.vue` files
 * are split by SFC block first: each `<script>` slices by function body, and
 * the root `<template>` becomes one slice of its own. Without the split, markup
 * and module-level script code shared a single `module` slice, so literals from
 * a `v-if` chain and from unrelated top-level code were compared together.
 *
 * A `.vue` file that yields nothing (unrecognized block layout) falls back to
 * whole-file slicing — losing precision beats silently auditing nothing.
 */
function sliceConsumer(file: string, content: string): CodeSlice[] {
  if (!file.endsWith('.vue')) return sliceFunctions(content)

  const slices: CodeSlice[] = []
  for (const [start, end] of sfcScriptBlocks(content)) {
    slices.push(...sliceFunctions(isolateRange(content, start, end)))
  }
  const template = sfcTemplateBlock(content)
  if (template) {
    const text = isolateRange(content, template[0], template[1])
    if (text.trim()) {
      slices.push({ scope: 'template', line: lineOf(content, template[0]), text })
    }
  }
  return slices.length > 0 ? slices : sliceFunctions(content)
}

/** A literal comparison found in a slice, keyed by what it compares against. */
interface Comparison {
  subject: string
  literal: string
  positive: boolean
}

/** `a?.b.value.c` → `a.b.c`; the `.value` unwrap makes refs and their reads agree. */
function normalizeSubject(raw: string): string {
  const flat = raw.replace(/\s+/g, '').replace(/\?\./g, '.')
  const parts = flat.split('.').filter((p) => p && p !== 'value')
  return parts.join('.') || flat
}

const CMP_RE =
  /([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)\s*(===|!==|==|!=)\s*(['"])([^'"\n]*)\3/g
const CMP_REVERSED_RE =
  /(['"])([^'"\n]*)\1\s*(===|!==|==|!=)\s*([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)/g
const SWITCH_RE = /\bswitch\s*\(\s*([^)]*?)\s*\)/g
const CASE_RE = /\bcase\s+(['"])([^'"\n]*)\1/g

/** Brace depth at each offset of `masked`, counting the opening brace as inside. */
function braceDepths(masked: string): Int32Array {
  const depths = new Int32Array(masked.length)
  let depth = 0
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === '{') depth++
    depths[i] = depth
    if (masked[i] === '}') depth = Math.max(0, depth - 1)
  }
  return depths
}

/** `switch (subject) { … }` bodies, so a `case` is attributed to the switch that encloses it. */
function switchBodies(
  text: string,
  masked: string,
): Array<{ subject: string; span: [number, number] }> {
  const bodies: Array<{ subject: string; span: [number, number] }> = []
  for (const m of text.matchAll(SWITCH_RE)) {
    const open = masked.indexOf('{', m.index! + m[0].length)
    if (open === -1) continue
    let depth = 0
    let end = masked.length
    for (let j = open; j < masked.length; j++) {
      if (masked[j] === '{') depth++
      else if (masked[j] === '}' && --depth === 0) {
        end = j
        break
      }
    }
    bodies.push({ subject: normalizeSubject(m[1]!), span: [open, end] })
  }
  return bodies
}

/**
 * Collect every literal comparison in a slice together with the expression it
 * compares. Grouping by subject is what keeps two unrelated dispatchers in one
 * slice from pooling their literals into a single bogus enum match.
 */
function extractComparisons(text: string, masked: string): Comparison[] {
  const found: Comparison[] = []

  for (const m of text.matchAll(CMP_RE)) {
    found.push({ subject: normalizeSubject(m[1]!), literal: m[4]!, positive: m[2]![0] === '=' })
  }
  for (const m of text.matchAll(CMP_REVERSED_RE)) {
    found.push({ subject: normalizeSubject(m[4]!), literal: m[2]!, positive: m[3]![0] === '=' })
  }

  // `case 'x':` belongs to the innermost `switch` whose body contains it —
  // "nearest preceding switch" misattributes every case that follows a nested
  // switch back to the inner discriminant.
  const bodies = switchBodies(text, masked)
  for (const m of text.matchAll(CASE_RE)) {
    let subject = 'unknown'
    let widest = -1
    for (const body of bodies) {
      if (body.span[0] < m.index! && m.index! < body.span[1] && body.span[0] > widest) {
        widest = body.span[0]
        subject = body.subject
      }
    }
    found.push({ subject, literal: m[2]!, positive: true })
  }

  return found
}

/**
 * Literals returned from the slice's own top level — a fallthrough
 * `return 'ready'` handles `ready`. Returns nested inside a helper defined in
 * the same slice belong to that helper's control flow, not this handler's, so
 * they must not silently complete an enum on the caller's behalf.
 */
function returnedLiterals(text: string, masked: string, depths: Int32Array): Set<string> {
  const literals = new Set<string>()
  for (const m of text.matchAll(/\breturn\s*(['"])([^'"\n]*)\1/g)) {
    if ((depths[m.index!] ?? 0) <= 1) literals.add(m[2]!)
  }
  return literals
}

/**
 * Body spans of functions defined *inside* this slice's own function. A function
 * slice carries its own signature and body, so the outermost span found here is
 * the slice itself — only a span with a parent is genuinely nested.
 */
function nestedFunctionSpans(masked: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  FN_MARKER_RE.lastIndex = 0
  let marker: RegExpExecArray | null
  while ((marker = FN_MARKER_RE.exec(masked)) !== null) {
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
    if (open === -1) {
      // Expression-bodied arrow (`(s) => assertNever(s)`): the body is whatever
      // follows until the expression ends. Without this, such a helper is
      // invisible here and its assert is credited to the enclosing dispatcher.
      if (marker[0] !== '=>') continue
      const bodyStart = marker.index + marker[0].length
      let nesting = 0
      let stop = masked.length
      for (let j = bodyStart; j < masked.length; j++) {
        const ch = masked[j]!
        if (ch === '(' || ch === '[' || ch === '{') nesting++
        else if (ch === ')' || ch === ']' || ch === '}') {
          if (nesting === 0) {
            stop = j
            break
          }
          nesting--
        } else if (nesting === 0 && (ch === ';' || ch === ',' || ch === '\n')) {
          stop = j
          break
        }
      }
      spans.push([bodyStart, stop])
      continue
    }
    let depth = 0
    for (let j = open; j < masked.length; j++) {
      const ch = masked[j]!
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          spans.push([open, j + 1])
          break
        }
      }
    }
  }
  // The slice's own body has no parent; helpers defined inside it do.
  return spans.filter((span) => spans.some((o) => o !== span && o[0] < span[0] && span[1] <= o[1]))
}

/**
 * Subjects a slice hands to `assertNever` — exhaustiveness is a compile error for
 * those only, and only for the handler that made the call. An
 * `assertNever(status)` inside a helper defined in this slice proves the *helper*
 * is exhaustive, not the dispatcher that happens to name its variable `status`
 * too; counting it silences the outer handler on a namesake's credentials.
 *
 * Nesting is measured in *functions*, not braces: the canonical shape is
 * `switch (s) { default: return assertNever(s) }`, whose call sits two braces
 * deep inside the very handler it belongs to.
 */
function assertedSubjects(text: string, masked: string): Set<string> {
  const nested = nestedFunctionSpans(masked)
  const subjects = new Set<string>()
  for (const m of text.matchAll(
    /\bassertNever\s*\(\s*([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)/g,
  )) {
    if (nested.some(([lo, hi]) => lo < m.index! && m.index! < hi)) continue
    subjects.add(normalizeSubject(m[1]!))
  }
  return subjects
}

/** Parse `'a' | 'b' | 'c'` into a value set; null if anything else appears. */
function literalUnion(text: string): Set<string> | null {
  const parts = text
    .replace(/;\s*$/, '')
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 2) return null
  const values: string[] = []
  for (const part of parts) {
    const m = /^(['"])([^'"]*)\1$/.exec(part)
    if (!m) return null
    values.push(m[2]!)
  }
  return new Set(values)
}

/**
 * `type Foo = 'a' | 'b'`, in any of the wrappings prettier produces: all on one
 * line, continuation lines led by `|`, or the whole union on lines after a bare
 * `=`. A trailing `;` terminates the declaration.
 */
function localTypeAliases(content: string): Map<string, Set<string>> {
  const aliases = new Map<string, Set<string>>()
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/.exec(lines[i]!)
    if (!m) continue
    let body = m[2]!.trim()
    for (let j = i + 1; j < lines.length && !body.endsWith(';'); j++) {
      const next = lines[j]!.trim()
      // Continue only while the declaration is visibly unfinished.
      if (!next.startsWith('|') && !body.endsWith('|') && body !== '') break
      body = `${body} ${next}`.trim()
    }
    const values = literalUnion(body)
    if (values) aliases.set(m[1]!, values)
  }
  return aliases
}

/**
 * Map each locally-declared symbol to its literal domain, when that domain is
 * written down in the file (`computed<'a' | 'b'>`, `const x: Foo =`, a function
 * return annotation). A symbol whose declared domain differs from an enum's
 * values is simply not that enum — comparing it against the enum's value list
 * is the literal-collision false positive this exists to stop.
 *
 * There is no scope analysis here, so a name declared twice with conflicting
 * domains is dropped entirely: an exemption is only safe when the file leaves
 * no doubt about which declaration a comparison refers to.
 */
function localDomains(content: string, aliasSource = content): Map<string, Set<string>> {
  const aliases = localTypeAliases(aliasSource)
  const domains = new Map<string, Set<string>>()
  const ambiguous = new Set<string>()
  const record = (name: string, typeText: string): void => {
    const values = literalUnion(typeText) ?? aliases.get(typeText.trim())
    if (!values) return
    const existing = domains.get(name)
    if (existing && !sameValues(existing, [...values])) {
      ambiguous.add(name)
      return
    }
    domains.set(name, values)
  }

  for (const m of content.matchAll(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:computed|ref|shallowRef)\s*<([^>]*)>\s*\(/g,
  )) {
    record(m[1]!, m[2]!)
  }
  for (const m of content.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*:\s*([^=;]+?)\s*=/g)) {
    record(m[1]!, m[2]!)
  }
  for (const m of content.matchAll(
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*:\s*([^{;]+?)\s*\{/g,
  )) {
    record(m[1]!, m[2]!)
  }
  for (const name of ambiguous) domains.delete(name)
  return domains
}

function sameValues(a: Set<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((v) => a.has(v))
}

/**
 * Code outside every function body. A `.vue` template compares symbols declared
 * at `<script setup>` top level, so those declarations must be visible to it —
 * but a `const` buried in one function must not leak its domain onto a
 * same-named symbol handled in another.
 */
function moduleLevelText(file: string, content: string): string {
  const regions = file.endsWith('.vue')
    ? sfcScriptBlocks(content).map(([s, e]) => isolateRange(content, s, e))
    : [content]
  if (regions.length === 0) return content
  return regions
    .flatMap((region) => sliceFunctions(region).filter((s) => s.scope === 'module'))
    .map((s) => s.text)
    .join('\n')
}

interface FileContext {
  /** Literal domains of module-level symbols, keyed by normalized name. */
  domains: Map<string, Set<string>>
  /** Enums exempted by a `// ux-drift-audit: ignore <Enum>` comment. */
  ignored: Set<string>
}

function fileContext(file: string, content: string): FileContext {
  // The ignore comment is a user-authored exemption: it stays file-wide even
  // though comparison is per-slice.
  const ignored = new Set(
    [...content.matchAll(/ux-drift-audit:\s*ignore\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!),
  )
  // Type aliases are resolved against the whole file (they are hoisted and
  // rarely local); only the *declarations* are restricted to module level.
  return { domains: localDomains(moduleLevelText(file, content), content), ignored }
}

/** Everything a slice contributes, scanned once instead of once per enum. */
interface SliceFacts {
  comparisons: Comparison[]
  returned: Set<string>
  asserted: Set<string>
  /** Domains declared inside this slice — they shadow the module-level ones. */
  domains: Map<string, Set<string>>
  hasCase: boolean
}

function sliceFacts(text: string): SliceFacts {
  const masked = maskNonCode(text)
  const depths = braceDepths(masked)
  return {
    comparisons: extractComparisons(text, masked),
    returned: returnedLiterals(text, masked, depths),
    asserted: assertedSubjects(text, masked),
    domains: localDomains(text),
    hasCase: /\bcase\s+['"]/m.test(text),
  }
}

function auditSlice(
  file: string,
  slice: CodeSlice,
  facts: SliceFacts,
  enumDef: EnumDef,
  ctx: FileContext,
): DriftFinding[] {
  const values = new Set(enumDef.values)
  const bySubject = new Map<string, Set<string>>()
  for (const cmp of facts.comparisons) {
    // Only positive branches count. `x !== 'c'` narrows the type without
    // producing a branch that handles `c` — treating it as coverage is how a
    // value that falls through to an error path gets reported as handled.
    if (!cmp.positive || !values.has(cmp.literal)) continue
    const entry = bySubject.get(cmp.subject) ?? new Set<string>()
    entry.add(cmp.literal)
    bySubject.set(cmp.subject, entry)
  }

  const findings: DriftFinding[] = []

  // A fallthrough `return 'ready'` carries no subject of its own, so it can only
  // be credited when the slice holds exactly one dispatcher. With two, crediting
  // it lets one handler's return close the other handler's gap — the same
  // borrowed-credentials shape the per-subject `asserted` / `domains` lookups
  // already refuse.
  const dispatchers = [...bySubject.values()].filter((positive) => positive.size >= 2).length
  const returned = dispatchers === 1 ? facts.returned : new Set<string>()

  for (const [subject, positive] of bySubject) {
    // Two positive branches is the minimum shape of a dispatcher. A run of
    // `x !== 'a' && x !== 'b'` before an early return is a guard — it narrows,
    // it does not claim to handle every value.
    if (positive.size < 2) continue

    // `assertNever` makes exhaustiveness a compile error, but only for the
    // expression actually handed to it — a second handler in the same slice
    // gets no protection from someone else's assert.
    if (facts.asserted.has(subject)) continue

    // The declared domain wins over literal coincidence.
    const domain = facts.domains.get(subject) ?? ctx.domains.get(subject)
    if (domain && !sameValues(domain, enumDef.values)) continue

    const missing = enumDef.values.filter((v) => !positive.has(v) && !returned.has(v))
    if (missing.length === 0) continue

    findings.push({
      file: relative(repoRoot, file),
      enumName: enumDef.name,
      scope: slice.scope,
      line: slice.line,
      subject,
      present: [...positive].toSorted(),
      missing,
      handlerKind: facts.hasCase ? 'switch' : 'if-chain',
    })
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
      // Only a match on the *same* compared expression is competing evidence.
      if (other.subject !== f.subject) return false
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
    const ctx = fileContext(consumer, content)
    for (const slice of sliceConsumer(consumer, content)) {
      const facts = sliceFacts(slice.text)
      const perSlice: DriftFinding[] = []
      for (const enumDef of enums) {
        if (ctx.ignored.has(enumDef.name)) continue
        perSlice.push(...auditSlice(consumer, slice, facts, enumDef, ctx))
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
        `    · ${f.enumName} in ${f.scope}() :${f.line} [${f.handlerKind} on ${f.subject}] missing: ${f.missing.join(', ')}`,
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
