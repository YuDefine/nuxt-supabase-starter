#!/usr/bin/env -S node --experimental-strip-types
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/spectra-advanced/impeccable-detector-gate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/spectra-advanced/impeccable-detector-gate.ts
/**
 * Canonical impeccable detector helper (landing 1).
 *
 * Calls the bundled `detect.mjs` only — never `npx impeccable`, never copies rules.
 * CLI `--json` is a findings array (no failureCount). Verifier recomputes:
 *   findings.filter((f) => f.advisory !== true).length
 *
 * Usage:
 *   node vendor/scripts/spectra-advanced/impeccable-detector-gate.ts resolve [--cwd <dir>]
 *   node vendor/scripts/spectra-advanced/impeccable-detector-gate.ts source --file <path> [--cwd <dir>]
 *   node vendor/scripts/spectra-advanced/impeccable-detector-gate.ts route --route <url> --viewport 1280x800 [--cwd <dir>]
 *   node vendor/scripts/spectra-advanced/impeccable-detector-gate.ts produce --mode source|url --out <path> [...]
 *   node vendor/scripts/spectra-advanced/impeccable-detector-gate.ts verify --artifact <path> [--cwd <dir>]
 *
 * Exit:
 *   0 — verify pass (clean / advisory-only), or resolve/source/route/produce succeeded
 *   2 — verify blocked, detect.mjs missing on a scan, or artifact write failed closed
 *   1 — usage error
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

export const SCHEMA_VERSION = '1'

export const DETECT_ENTRY_RELATIVE_PATHS = [
  '.claude/skills/impeccable/scripts/detect.mjs',
  '.agents/skills/impeccable/scripts/detect.mjs',
  '.agents/skills/impeccable/detect.mjs',
  '.cursor/skills/impeccable/scripts/detect.mjs',
  '.cursor/skills/impeccable/detect.mjs',
] as const

const CONFIG_RELATIVE = join('.impeccable', 'config.json')

export type DetectorMode = 'source' | 'url'

export type Finding = {
  antipattern?: string
  name?: string
  description?: string
  severity?: string
  category?: string | null
  file?: string
  line?: number
  snippet?: string
  advisory?: boolean
  [key: string]: unknown
}

export type Viewport = { width: number; height: number }

export type FileFingerprint = { path: string; sourceFingerprint: string }

export type DetectorRun = {
  target: string
  viewport: Viewport | null
  exitCode: number
  findings: Finding[]
}

export type Suppression = {
  kind: 'ignoreValue' | 'ignoreRule' | 'ignoreFile'
  rule?: string
  value?: string
  file?: string
  reason: string
}

export type DetectorArtifact = {
  schemaVersion: string
  changeId: string | null
  producedAt: string
  mode: DetectorMode
  detector: { entry: string; entryDigest: string }
  config: { path: string | null; digest: string | null }
  targets: {
    files: FileFingerprint[]
    routes: string[]
    viewports: Viewport[]
    coveredFiles: string[]
  }
  runs: DetectorRun[]
  suppressions: Suppression[]
}

export type VerifyResult = {
  ok: boolean
  exitCode: number
  codes: string[]
  primaryCount: number
  messages: string[]
}

export function sha256Text(content: string | Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

export function digestFile(absPath: string): string | null {
  if (!existsSync(absPath)) return null
  return sha256Text(readFileSync(absPath))
}

export function parseViewport(raw: string): Viewport | null {
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(String(raw || '').trim())
  if (!match) return null
  return { width: Number(match[1]), height: Number(match[2]) }
}

export function formatViewport(viewport: Viewport): string {
  return `${viewport.width}x${viewport.height}`
}

export function viewportsEqual(a: Viewport | null, b: Viewport | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.width === b.width && a.height === b.height
}

export function primaryCount(findings: unknown): number {
  if (!Array.isArray(findings)) return -1
  return findings.filter((f) => f && typeof f === 'object' && f.advisory !== true).length
}

export function resolveDetectEntry(cwd: string): string | null {
  const root = resolve(cwd)
  for (const rel of DETECT_ENTRY_RELATIVE_PATHS) {
    const candidate = join(root, rel)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function toPosix(p: string): string {
  return p.replaceAll('\\', '/')
}

export function relPath(cwd: string, absOrRel: string): string {
  if (!isAbsolute(absOrRel)) return toPosix(absOrRel)
  const rel = relative(resolve(cwd), absOrRel)
  if (!rel || rel.startsWith('..')) return toPosix(absOrRel)
  return toPosix(rel)
}

export function resolveInCwd(cwd: string, p: string): string {
  return isAbsolute(p) ? p : join(resolve(cwd), p)
}

export function fingerprintFiles(cwd: string, paths: string[]): FileFingerprint[] {
  return paths.map((p) => {
    const abs = resolveInCwd(cwd, p)
    const digest = digestFile(abs)
    return {
      path: relPath(cwd, p),
      sourceFingerprint: digest ?? '',
    }
  })
}

export function readConfigSuppressions(cwd: string): Suppression[] {
  const abs = join(resolve(cwd), CONFIG_RELATIVE)
  if (!existsSync(abs)) return []
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(abs, 'utf8'))
  } catch {
    return []
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const detector = (raw as { detector?: unknown }).detector
  if (!detector || typeof detector !== 'object' || Array.isArray(detector)) return []
  const ignoreValues = (detector as { ignoreValues?: unknown }).ignoreValues
  if (!Array.isArray(ignoreValues)) return []
  const out: Suppression[] = []
  for (const entry of ignoreValues) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const rec = entry as { rule?: unknown; value?: unknown; file?: unknown; reason?: unknown }
    out.push({
      kind: 'ignoreValue',
      ...(typeof rec.rule === 'string' ? { rule: rec.rule } : {}),
      ...(typeof rec.value === 'string' ? { value: rec.value } : {}),
      ...(typeof rec.file === 'string' ? { file: rec.file } : {}),
      reason: typeof rec.reason === 'string' ? rec.reason : '',
    })
  }
  return out
}

function parseFindings(stdout: string): { findings: Finding[] | null; malformed: boolean } {
  const text = stdout.trim()
  if (!text) return { findings: [], malformed: false }
  try {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return { findings: null, malformed: true }
    return { findings: parsed as Finding[], malformed: false }
  } catch {
    return { findings: null, malformed: true }
  }
}

export function runDetect(opts: {
  cwd: string
  entry: string
  targets: string[]
  viewport?: Viewport | null
  extraArgs?: string[]
}): { exitCode: number; stdout: string; stderr: string; findings: Finding[]; malformed: boolean } {
  const args = [opts.entry, '--json', '--no-inline-ignores']
  if (opts.viewport) args.push('--viewport', formatViewport(opts.viewport))
  if (opts.extraArgs) args.push(...opts.extraArgs)
  args.push(...opts.targets)

  let exitCode = 0
  let stdout = ''
  let stderr = ''
  try {
    stdout = execFileSync('node', args, {
      cwd: resolve(opts.cwd),
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string; message?: string }
    if (typeof e.status === 'number') {
      exitCode = e.status
      stdout = typeof e.stdout === 'string' ? e.stdout : ''
      stderr = typeof e.stderr === 'string' ? e.stderr : ''
    } else {
      exitCode = 1
      stderr = e.message ?? String(err)
    }
  }

  const parsed = parseFindings(stdout)
  if (parsed.malformed) {
    return {
      exitCode: exitCode === 0 ? 1 : exitCode,
      stdout,
      stderr,
      findings: [],
      malformed: true,
    }
  }

  // detect.mjs swallows URL engine errors to stderr and may still exit 0.
  if (exitCode === 0 && (parsed.findings?.length ?? 0) === 0 && /(?:^|\n)Error:/.test(stderr)) {
    exitCode = 1
  }

  return {
    exitCode,
    stdout,
    stderr,
    findings: parsed.findings ?? [],
    malformed: false,
  }
}

function configState(cwd: string): { path: string | null; digest: string | null } {
  const abs = join(resolve(cwd), CONFIG_RELATIVE)
  if (!existsSync(abs)) return { path: null, digest: null }
  return { path: CONFIG_RELATIVE, digest: digestFile(abs) }
}

export function buildEnvelope(opts: {
  cwd: string
  mode: DetectorMode
  changeId?: string | null
  files?: string[]
  routes?: string[]
  viewports?: Viewport[]
  coveredFiles?: string[]
  runs: DetectorRun[]
  producedAt?: string
}): DetectorArtifact {
  const cwd = resolve(opts.cwd)
  const entry = resolveDetectEntry(cwd)
  if (!entry) {
    throw new Error('detect-entry-missing')
  }
  const files = fingerprintFiles(cwd, opts.files ?? [])
  const config = configState(cwd)
  return {
    schemaVersion: SCHEMA_VERSION,
    changeId: opts.changeId ?? null,
    producedAt: opts.producedAt ?? new Date().toISOString(),
    mode: opts.mode,
    detector: {
      entry: relPath(cwd, entry),
      entryDigest: digestFile(entry) ?? '',
    },
    config,
    targets: {
      files,
      routes: opts.routes ?? [],
      viewports: opts.viewports ?? [],
      coveredFiles: opts.coveredFiles ?? files.map((f) => f.path),
    },
    runs: opts.runs,
    suppressions: readConfigSuppressions(cwd),
  }
}

export function scanSource(opts: {
  cwd: string
  files: string[]
  changeId?: string | null
}): DetectorArtifact {
  const cwd = resolve(opts.cwd)
  const entry = resolveDetectEntry(cwd)
  if (!entry) throw new Error('detect-entry-missing')
  const targets = opts.files.map((f) => resolveInCwd(cwd, f))
  const result = runDetect({ cwd, entry, targets })
  const runs: DetectorRun[] = opts.files.map((file) => ({
    target: relPath(cwd, file),
    viewport: null,
    exitCode: result.malformed ? 1 : result.exitCode,
    findings: result.findings.filter((f) => {
      if (typeof f.file !== 'string') return opts.files.length === 1
      const found = relPath(cwd, f.file)
      return found === relPath(cwd, file) || f.file === resolveInCwd(cwd, file)
    }),
  }))
  // Keep raw findings on a single shared run when the CLI scanned as one process.
  // Per-file split above is best-effort; also retain an all-files run if split dropped items.
  const splitCount = runs.reduce((n, r) => n + r.findings.length, 0)
  const finalRuns =
    splitCount === result.findings.length
      ? runs
      : [
          {
            target: opts.files.map((f) => relPath(cwd, f)).join(','),
            viewport: null,
            exitCode: result.malformed ? 1 : result.exitCode,
            findings: result.findings,
          },
        ]
  return buildEnvelope({
    cwd,
    mode: 'source',
    changeId: opts.changeId,
    files: opts.files,
    routes: [],
    viewports: [],
    runs: finalRuns,
  })
}

export function scanRoutes(opts: {
  cwd: string
  routes: string[]
  viewports: Viewport[]
  files?: string[]
  changeId?: string | null
}): DetectorArtifact {
  const cwd = resolve(opts.cwd)
  const entry = resolveDetectEntry(cwd)
  if (!entry) throw new Error('detect-entry-missing')
  const runs: DetectorRun[] = []
  for (const viewport of opts.viewports) {
    for (const route of opts.routes) {
      const result = runDetect({ cwd, entry, targets: [route], viewport })
      runs.push({
        target: route,
        viewport,
        exitCode: result.malformed ? 1 : result.exitCode,
        findings: result.findings,
      })
    }
  }
  return buildEnvelope({
    cwd,
    mode: 'url',
    changeId: opts.changeId,
    files: opts.files ?? [],
    routes: opts.routes,
    viewports: opts.viewports,
    runs,
  })
}

function pushCode(result: VerifyResult, code: string, message: string) {
  if (!result.codes.includes(code)) result.codes.push(code)
  result.messages.push(message)
}

export function verifyArtifact(artifactPath: string, opts: { cwd?: string } = {}): VerifyResult {
  const cwd = resolve(opts.cwd ?? dirname(artifactPath))
  const result: VerifyResult = {
    ok: true,
    exitCode: 0,
    codes: [],
    primaryCount: 0,
    messages: [],
  }

  const absArtifact = resolveInCwd(cwd, artifactPath)
  if (!existsSync(absArtifact)) {
    pushCode(result, 'missing-artifact', `artifact not found: ${absArtifact}`)
    result.ok = false
    result.exitCode = 2
    return result
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(absArtifact, 'utf8'))
  } catch {
    pushCode(result, 'malformed', 'artifact is not valid JSON')
    result.ok = false
    result.exitCode = 2
    return result
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    pushCode(result, 'malformed', 'artifact must be a JSON object (not a findings array)')
    result.ok = false
    result.exitCode = 2
    return result
  }

  const art = parsed as Record<string, unknown>
  if (art.schemaVersion !== SCHEMA_VERSION) {
    pushCode(result, 'malformed', `unsupported schemaVersion: ${String(art.schemaVersion)}`)
  }
  if (art.mode !== 'source' && art.mode !== 'url') {
    pushCode(result, 'malformed', `invalid mode: ${String(art.mode)}`)
  }
  if (!art.detector || typeof art.detector !== 'object' || Array.isArray(art.detector)) {
    pushCode(result, 'malformed', 'missing detector block')
  }
  if (!art.targets || typeof art.targets !== 'object' || Array.isArray(art.targets)) {
    pushCode(result, 'malformed', 'missing targets block')
  }
  if (!Array.isArray(art.runs)) {
    pushCode(result, 'malformed', 'runs must be an array')
  }
  if (!Array.isArray(art.suppressions)) {
    pushCode(result, 'malformed', 'suppressions must be an array')
  }
  if (result.codes.includes('malformed')) {
    result.ok = false
    result.exitCode = 2
    return result
  }

  const mode = art.mode as DetectorMode
  const detector = art.detector as { entry?: unknown; entryDigest?: unknown }
  const targets = art.targets as {
    files?: unknown
    routes?: unknown
    viewports?: unknown
    coveredFiles?: unknown
  }
  const runs = art.runs as unknown[]
  const suppressions = art.suppressions as unknown[]

  if (
    !Array.isArray(targets.files) ||
    !Array.isArray(targets.routes) ||
    !Array.isArray(targets.viewports)
  ) {
    pushCode(result, 'malformed', 'targets.files / routes / viewports must be arrays')
    result.ok = false
    result.exitCode = 2
    return result
  }

  const files = targets.files as unknown[]
  const routes = targets.routes as unknown[]
  const viewports = targets.viewports as unknown[]

  if (mode === 'source' && files.length === 0) {
    pushCode(result, 'missing-target', 'source mode requires at least one target file')
  }
  if (mode === 'url' && routes.length === 0) {
    pushCode(result, 'missing-target', 'url mode requires at least one route')
  }
  if (mode === 'url' && viewports.length === 0) {
    pushCode(result, 'missing-viewport', 'url mode requires at least one viewport')
  }

  const parsedViewports: Viewport[] = []
  for (const vp of viewports) {
    if (!vp || typeof vp !== 'object' || Array.isArray(vp)) {
      pushCode(result, 'malformed', 'viewport entries must be {width,height}')
      continue
    }
    const width = (vp as { width?: unknown }).width
    const height = (vp as { height?: unknown }).height
    if (typeof width !== 'number' || typeof height !== 'number') {
      pushCode(result, 'malformed', 'viewport width/height must be numbers')
      continue
    }
    parsedViewports.push({ width, height })
  }

  const parsedRoutes = routes.filter((r): r is string => typeof r === 'string')
  if (parsedRoutes.length !== routes.length) {
    pushCode(result, 'malformed', 'routes must be strings')
  }

  const parsedRuns: DetectorRun[] = []
  for (const run of runs) {
    if (!run || typeof run !== 'object' || Array.isArray(run)) {
      pushCode(result, 'malformed', 'run entries must be objects')
      continue
    }
    const rec = run as {
      target?: unknown
      viewport?: unknown
      exitCode?: unknown
      findings?: unknown
    }
    if (typeof rec.target !== 'string' || rec.target.length === 0) {
      pushCode(result, 'missing-target', 'run is missing target')
      continue
    }
    if (!Array.isArray(rec.findings)) {
      pushCode(result, 'malformed', `run ${rec.target} findings must be an array`)
      continue
    }
    if (typeof rec.exitCode !== 'number') {
      pushCode(result, 'malformed', `run ${rec.target} exitCode must be a number`)
      continue
    }
    let viewport: Viewport | null = null
    if (rec.viewport !== null && rec.viewport !== undefined) {
      if (typeof rec.viewport !== 'object' || Array.isArray(rec.viewport)) {
        pushCode(result, 'malformed', `run ${rec.target} viewport is invalid`)
        continue
      }
      const width = (rec.viewport as { width?: unknown }).width
      const height = (rec.viewport as { height?: unknown }).height
      if (typeof width !== 'number' || typeof height !== 'number') {
        pushCode(result, 'malformed', `run ${rec.target} viewport width/height must be numbers`)
        continue
      }
      viewport = { width, height }
    }
    if (mode === 'url' && !viewport) {
      pushCode(result, 'missing-viewport', `url run ${rec.target} is missing viewport`)
    }
    parsedRuns.push({
      target: rec.target,
      viewport,
      exitCode: rec.exitCode,
      findings: rec.findings as Finding[],
    })
  }

  if (mode === 'url') {
    for (const route of parsedRoutes) {
      if (!parsedRuns.some((r) => r.target === route)) {
        pushCode(result, 'missing-target', `no run recorded for route ${route}`)
      }
    }
    for (const vp of parsedViewports) {
      if (!parsedRuns.some((r) => viewportsEqual(r.viewport, vp))) {
        pushCode(result, 'missing-viewport', `no run recorded for viewport ${formatViewport(vp)}`)
      }
    }
    for (const route of parsedRoutes) {
      for (const vp of parsedViewports) {
        const hit = parsedRuns.some((r) => r.target === route && viewportsEqual(r.viewport, vp))
        if (!hit) {
          pushCode(result, 'missing-target', `no run recorded for ${route} @ ${formatViewport(vp)}`)
        }
      }
    }
  }

  const liveEntry = resolveDetectEntry(cwd)
  const claimedEntry = typeof detector.entry === 'string' ? resolveInCwd(cwd, detector.entry) : null
  const entryPath = liveEntry ?? claimedEntry
  if (!entryPath || !existsSync(entryPath)) {
    pushCode(result, 'digest-drift', 'bundled detect.mjs is missing')
  } else {
    const liveDigest = digestFile(entryPath)
    if (typeof detector.entryDigest !== 'string' || detector.entryDigest !== liveDigest) {
      pushCode(result, 'digest-drift', 'detector entry digest does not match current detect.mjs')
    }
  }

  const liveConfig = configState(cwd)
  const claimedConfig = art.config as { path?: unknown; digest?: unknown } | undefined
  const claimedDigest =
    claimedConfig && typeof claimedConfig.digest === 'string' ? claimedConfig.digest : null
  const claimedPath =
    claimedConfig && typeof claimedConfig.path === 'string' ? claimedConfig.path : null
  if (claimedDigest !== liveConfig.digest || claimedPath !== liveConfig.path) {
    pushCode(result, 'digest-drift', '.impeccable/config.json digest does not match current file')
  }

  for (const file of files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      pushCode(result, 'malformed', 'file fingerprint entries must be objects')
      continue
    }
    const rec = file as { path?: unknown; sourceFingerprint?: unknown }
    if (typeof rec.path !== 'string' || rec.path.length === 0) {
      pushCode(result, 'missing-target', 'file fingerprint is missing path')
      continue
    }
    const abs = resolveInCwd(cwd, rec.path)
    const live = digestFile(abs)
    if (!live) {
      pushCode(result, 'stale-fingerprint', `source file missing: ${rec.path}`)
      continue
    }
    if (typeof rec.sourceFingerprint !== 'string' || rec.sourceFingerprint !== live) {
      pushCode(result, 'stale-fingerprint', `source fingerprint stale: ${rec.path}`)
    }
  }

  if (Array.isArray(targets.coveredFiles)) {
    for (const covered of targets.coveredFiles) {
      if (typeof covered !== 'string') continue
      const listed = files.some(
        (f) =>
          f &&
          typeof f === 'object' &&
          !Array.isArray(f) &&
          (f as { path?: unknown }).path === covered,
      )
      if (!listed) {
        pushCode(result, 'stale-fingerprint', `covered file has no fingerprint: ${covered}`)
      }
    }
  }

  let totalPrimary = 0
  for (const run of parsedRuns) {
    const count = primaryCount(run.findings)
    if (count < 0) {
      pushCode(result, 'malformed', `run ${run.target} findings is not an array`)
      continue
    }
    totalPrimary += count
    if (run.exitCode === 1) {
      pushCode(result, 'detector-exit', `detector exited 1 for ${run.target}`)
    }
  }
  result.primaryCount = totalPrimary
  if (totalPrimary > 0) {
    pushCode(result, 'primary-findings', `primary findings = ${totalPrimary}`)
  }

  const reasonEntries: Suppression[] = []
  for (const entry of suppressions) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      pushCode(result, 'malformed', 'suppression entries must be objects')
      continue
    }
    const rec = entry as { kind?: unknown; reason?: unknown }
    reasonEntries.push({
      kind: rec.kind === 'ignoreRule' || rec.kind === 'ignoreFile' ? rec.kind : 'ignoreValue',
      reason: typeof rec.reason === 'string' ? rec.reason : '',
    })
  }
  for (const entry of readConfigSuppressions(cwd)) reasonEntries.push(entry)
  for (const entry of reasonEntries) {
    if (!entry.reason.trim()) {
      pushCode(result, 'empty-suppression-reason', 'ignoreValues.reason must be a non-empty string')
      break
    }
  }

  if (result.codes.length > 0) {
    result.ok = false
    result.exitCode = 2
  }
  return result
}

export function writeArtifact(absPath: string, artifact: DetectorArtifact): void {
  mkdirSync(dirname(absPath), { recursive: true })
  writeFileSync(absPath, `${JSON.stringify(artifact, null, 2)}\n`)
}

export function defaultArtifactPath(cwd: string, changeId: string): string {
  return join(resolve(cwd), 'openspec', 'changes', changeId, 'impeccable-detector.json')
}

function takeFlag(args: string[], name: string): string | null {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}`) {
      const value = args[i + 1]
      if (!value || value.startsWith('--')) return null
      out.push(value)
      i++
    } else if (args[i].startsWith(`--${name}=`)) {
      out.push(args[i].slice(name.length + 3))
    }
  }
  return out.at(-1) ?? null
}

function takeAll(args: string[], names: string[]): string[] {
  const out: string[] = []
  const set = new Set(names)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const exact = set.has(arg.slice(2)) && arg.startsWith('--')
    if (exact) {
      const value = args[i + 1]
      if (!value || value.startsWith('--')) continue
      out.push(
        ...value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      i++
      continue
    }
    for (const name of names) {
      if (arg.startsWith(`--${name}=`)) {
        out.push(
          ...arg
            .slice(name.length + 3)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        )
      }
    }
  }
  return out
}

function printUsage(): void {
  process.stdout
    .write(`Usage: impeccable-detector-gate.ts <resolve|source|route|produce|verify> [options]

Options:
  --cwd <dir>
  --change <id>
  --file <path>          repeatable or comma-separated
  --route <url>          repeatable or comma-separated
  --viewport <WxH>       repeatable or comma-separated
  --out <path>
  --artifact <path>
  --mode source|url
  --json

Exit: 0 pass, 2 blocked, 1 usage
`)
}

function failUsage(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function emit(value: unknown, asJson: boolean): void {
  if (asJson || typeof value !== 'string') {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
    return
  }
  process.stdout.write(`${value}\n`)
}

function main(): void {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv.includes('--help')) {
    printUsage()
    process.exit(argv.length === 0 ? 1 : 0)
  }
  const command = argv[0]
  const rest = argv.slice(1)
  const cwd = resolve(takeFlag(rest, 'cwd') ?? process.cwd())
  const json = rest.includes('--json')
  const changeId = takeFlag(rest, 'change')
  const files = takeAll(rest, ['file', 'files'])
  const routes = takeAll(rest, ['route', 'routes'])
  const viewportRaw = takeAll(rest, ['viewport', 'viewports'])
  const viewports: Viewport[] = []
  for (const raw of viewportRaw) {
    const parsed = parseViewport(raw)
    if (!parsed) failUsage(`invalid --viewport ${raw} (expected WxH)`)
    viewports.push(parsed)
  }

  if (command === 'resolve') {
    const entry = resolveDetectEntry(cwd)
    if (!entry) {
      process.stderr.write('bundled detect.mjs not found\n')
      process.exit(2)
    }
    emit(
      json
        ? { entry, digest: digestFile(entry), relative: relPath(cwd, entry) }
        : relPath(cwd, entry),
      json,
    )
    process.exit(0)
  }

  if (command === 'source' || command === 'route' || command === 'produce') {
    const modeFlag = takeFlag(rest, 'mode')
    const mode: DetectorMode =
      command === 'source'
        ? 'source'
        : command === 'route'
          ? 'url'
          : modeFlag === 'url' || modeFlag === 'source'
            ? modeFlag
            : files.length > 0 && routes.length === 0
              ? 'source'
              : 'url'
    if (mode === 'source' && files.length === 0) {
      failUsage('source / produce --mode source requires --file')
    }
    if (mode === 'url' && routes.length === 0) {
      failUsage('route / produce --mode url requires --route')
    }

    try {
      const artifact =
        mode === 'source'
          ? scanSource({ cwd, files, changeId })
          : scanRoutes({
              cwd,
              routes,
              viewports: viewports.length > 0 ? viewports : [{ width: 1280, height: 800 }],
              files,
              changeId,
            })

      if (command === 'produce') {
        const out = takeFlag(rest, 'out') ?? (changeId ? defaultArtifactPath(cwd, changeId) : null)
        if (!out) failUsage('produce requires --out or --change')
        writeArtifact(resolveInCwd(cwd, out), artifact)
        emit(json ? { ok: true, out: relPath(cwd, out), artifact } : relPath(cwd, out), json)
        process.exit(0)
      }

      emit(artifact, true)
      process.exit(0)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'detect-entry-missing') {
        process.stderr.write('bundled detect.mjs not found (fail-closed)\n')
        process.exit(2)
      }
      process.stderr.write(`${message}\n`)
      process.exit(2)
    }
  }

  if (command === 'verify') {
    const artifact =
      takeFlag(rest, 'artifact') ??
      takeFlag(rest, 'out') ??
      (changeId ? defaultArtifactPath(cwd, changeId) : null)
    if (!artifact) failUsage('verify requires --artifact or --change')
    const verified = verifyArtifact(artifact, { cwd })
    emit(json ? verified : verified.ok ? 'ok' : verified.codes.join(',') || 'blocked', json)
    if (!verified.ok) {
      for (const message of verified.messages) {
        process.stderr.write(`${message}\n`)
      }
    }
    process.exit(verified.exitCode)
  }

  failUsage(`unknown command: ${command}`)
}

if (process.argv[1] && process.argv[1].endsWith('impeccable-detector-gate.ts')) {
  main()
}
