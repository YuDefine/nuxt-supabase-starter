#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/audit-lint-exceptions.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/audit-lint-exceptions.ts
// audit-lint-exceptions.ts — 擋未登記的 lint／fmt 偏離
//
// 比對本 repo 的 vite.config.ts 與 vendor/oxc-shared/preset.ts，每一處偏離都要在
// vendor/oxc-shared/lint-exceptions.ts 有對應登記，且登記要有理由與撤除條件。
//
// 用法：node scripts/audit-lint-exceptions.ts [--root <dir>] [--repo <name>]
//         [--preset <path>] [--registry <path>] [--json]
// exit：0 通過；1 有未登記偏離或登記不合法；2 設定載入失敗或參數錯誤。
//
// clade 自己跑時，登記了卻已不存在的例外（stale）也算失敗；consumer 端只列出不擋，
// 因為登記處在 clade，consumer 修好之後要等下一次 propagate 才清得掉。

import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type Dict = Record<string, unknown>

export interface Deviation {
  kind: string
  target: string
}

export interface RegistryEntry extends Deviation {
  repo: string
  reason: string
  removeWhen: string
}

export interface AuditResult {
  repo: string
  unregistered: Deviation[]
  invalid: string[]
  stale: Deviation[]
}

interface PresetModule {
  lintBase: Dict
  fmtBase: Dict
  lockedScriptProjections?: (root?: string) => string[]
}

// 值依 repo 的 stylesheet 路徑而不同，不是偏離；有沒有開由各 repo 的遷移件收斂。
const REPO_SPECIFIC_FMT_OPTIONS = new Set(['experimentalTailwindcss'])
const MIN_TEXT_LENGTH = 8
// 會放寬檢查卻不經 rules／categories 的 oxlint 頂層欄位：extends 可引入關規則的設定，options 可關 typeAware、改 maxWarnings。
const LINT_OPTION_KEYS = ['extends', 'options', 'settings', 'globals', 'env'] as const

const isDict = (value: unknown): value is Dict =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const asDict = (value: unknown): Dict => (isDict(value) ? value : {})
const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

function normalizeRuleName(name: string): string {
  // 只合併真正的別名：`eslint/x` 就是 `x`，`@typescript-eslint/x` 就是 `typescript/x`；
  // 其他 plugin 前綴保留，`typescript/require-await` 與 `require-await` 是兩條各自獨立的規則。
  return name.replace(/^eslint\//, '').replace(/^@typescript-eslint\//, 'typescript/')
}

function normalizeSeverity(value: unknown): unknown {
  if (value === 0 || value === 'off' || value === 'allow') return 'off'
  if (value === 1 || value === 'warn') return 'warn'
  if (value === 2 || value === 'error' || value === 'deny') return 'error'
  return value
}

function normalizeRuleValue(value: unknown): string {
  if (!Array.isArray(value)) return JSON.stringify(normalizeSeverity(value))
  const [severity, ...options] = value
  const head = normalizeSeverity(severity)
  return JSON.stringify(options.length > 0 ? [head, ...options] : head)
}

function normalizeRules(value: unknown): Map<string, string> {
  return new Map(
    Object.entries(asDict(value)).map(([name, rule]) => [
      normalizeRuleName(name),
      normalizeRuleValue(rule),
    ]),
  )
}

function normalizePattern(pattern: string): string {
  return pattern
    .replace(/^\.\//, '')
    .replace(/\/\*\*$/, '')
    .replace(/\/$/, '')
}

function isCovered(pattern: string, base: readonly string[]): boolean {
  const target = normalizePattern(pattern)
  return base.some((item) => target === item || target.startsWith(`${item}/`))
}

function diffIgnores(
  actual: string[],
  baseline: string[],
  locked: string[],
  kind: string,
): Deviation[] {
  const present = actual.map(normalizePattern)
  // 只拿 repo 實際保留的 preset 排除當覆蓋基準：repo 移除了 `vendor`（登記為 *-removed）後，
  // 再加回 `vendor/snippets` 這類子目錄是新的偏離，不能因為落在已移除的 preset 項目底下就算已覆蓋。
  const kept = baseline.map(normalizePattern).filter((pattern) => isCovered(pattern, present))
  const base = [...kept, ...locked.map(normalizePattern)]
  const out: Deviation[] = actual
    .filter((pattern) => !isCovered(pattern, base))
    .map((pattern) => ({ kind, target: normalizePattern(pattern) }))
  for (const pattern of baseline) {
    // LOCKED 投影清單隨 repo 變動，不要求逐檔出現在沒展開 preset 的設定裡；那由 adoption 收斂。
    if (pattern.startsWith('scripts/')) continue
    if (!isCovered(pattern, present)) {
      out.push({ kind: `${kind}-removed`, target: normalizePattern(pattern) })
    }
  }
  return out
}

function diffLint(lint: Dict, base: Dict, locked: string[]): Deviation[] {
  const out: Deviation[] = []
  const categories = asDict(lint.categories)
  for (const [name, value] of Object.entries(asDict(base.categories))) {
    if (normalizeSeverity(categories[name]) !== normalizeSeverity(value)) {
      out.push({ kind: 'category', target: name })
    }
  }
  const plugins = asStrings(lint.plugins)
  for (const plugin of asStrings(base.plugins)) {
    if (!plugins.includes(plugin)) out.push({ kind: 'plugin', target: plugin })
  }
  const rules = normalizeRules(lint.rules)
  const baseRules = normalizeRules(base.rules)
  for (const name of new Set([...rules.keys(), ...baseRules.keys()])) {
    if (rules.get(name) !== baseRules.get(name)) out.push({ kind: 'rule', target: name })
  }
  out.push(
    ...diffIgnores(
      asStrings(lint.ignorePatterns),
      asStrings(base.ignorePatterns).filter((pattern) => !locked.includes(pattern)),
      locked,
      'lint-ignore',
    ),
  )
  for (const key of LINT_OPTION_KEYS) {
    const actual = lint[key]
    const expected = base[key]
    if (isDict(actual) || isDict(expected)) {
      const a = asDict(actual)
      const e = asDict(expected)
      for (const sub of new Set([...Object.keys(a), ...Object.keys(e)])) {
        if (JSON.stringify(a[sub]) !== JSON.stringify(e[sub])) {
          out.push({ kind: 'lint-option', target: `${key}.${sub}` })
        }
      }
    } else if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      out.push({ kind: 'lint-option', target: key })
    }
  }
  const baseOverrides = new Set(
    (Array.isArray(base.overrides) ? base.overrides : []).map((item) => JSON.stringify(item)),
  )
  const overrides: unknown[] = Array.isArray(lint.overrides) ? lint.overrides : []
  for (const override of overrides) {
    if (baseOverrides.has(JSON.stringify(override))) continue
    const entry = asDict(override)
    const files = asStrings(entry.files).join(',')
    for (const name of normalizeRules(entry.rules).keys()) {
      out.push({ kind: 'override', target: `${files}::${name}` })
    }
  }
  return out
}

function diffFmt(fmt: Dict, base: Dict, locked: string[]): Deviation[] {
  const out: Deviation[] = []
  for (const key of new Set([...Object.keys(fmt), ...Object.keys(base)])) {
    if (key === 'ignorePatterns' || REPO_SPECIFIC_FMT_OPTIONS.has(key)) continue
    if (JSON.stringify(fmt[key]) !== JSON.stringify(base[key])) {
      out.push({ kind: 'fmt-option', target: key })
    }
  }
  out.push(
    ...diffIgnores(
      asStrings(fmt.ignorePatterns),
      asStrings(base.ignorePatterns).filter((pattern) => !locked.includes(pattern)),
      locked,
      'fmt-ignore',
    ),
  )
  return out
}

/** preset 自己關掉的規則與整類，不論 repo 都要有全 fleet 登記。 */
function presetDecisions(base: Dict): Deviation[] {
  const out: Deviation[] = []
  for (const [name, value] of Object.entries(asDict(base.categories))) {
    if (normalizeSeverity(value) === 'off') out.push({ kind: 'category', target: name })
  }
  for (const [name, value] of normalizeRules(base.rules)) {
    if (value === '"off"') out.push({ kind: 'rule', target: name })
  }
  return out
}

export function collectDeviations(
  config: Dict | null,
  preset: PresetModule,
  locked: string[],
): Deviation[] {
  if (config === null) return [{ kind: 'adoption', target: 'vite-config' }]
  const out: Deviation[] = []
  if (isDict(config.lint)) out.push(...diffLint(config.lint, preset.lintBase, locked))
  else out.push({ kind: 'adoption', target: 'lint' })
  if (isDict(config.fmt)) out.push(...diffFmt(config.fmt, preset.fmtBase, locked))
  else out.push({ kind: 'adoption', target: 'fmt' })
  return out
}

const keyOf = (item: Deviation): string => `${item.kind}\u0000${item.target}`

function validateRegistry(registry: RegistryEntry[]): string[] {
  const invalid: string[] = []
  const seen = new Set<string>()
  for (const entry of registry) {
    const label = `${entry.repo} [${entry.kind}] ${entry.target}`
    if ((entry.reason ?? '').trim().length < MIN_TEXT_LENGTH) invalid.push(`${label}：缺理由`)
    if ((entry.removeWhen ?? '').trim().length < MIN_TEXT_LENGTH) {
      invalid.push(`${label}：缺撤除條件`)
    }
    const key = `${entry.repo}\u0000${keyOf(entry)}`
    if (seen.has(key)) invalid.push(`${label}：重複登記`)
    seen.add(key)
  }
  return invalid
}

export function evaluate(
  repo: string,
  config: Dict | null,
  preset: PresetModule,
  registry: RegistryEntry[],
  locked: string[],
): AuditResult {
  const applicable = registry.filter((entry) => entry.repo === '*' || entry.repo === repo)
  const allowed = new Set(applicable.map(keyOf))
  const found = [...collectDeviations(config, preset, locked), ...presetDecisions(preset.lintBase)]
  const foundKeys = new Set(found.map(keyOf))
  const unregistered = [...new Map(found.map((item) => [keyOf(item), item])).values()].filter(
    (item) => !allowed.has(keyOf(item)),
  )
  const stale = applicable
    .filter((entry) => !foundKeys.has(keyOf(entry)))
    .map(({ kind, target }) => ({ kind, target }))
  return { repo, unregistered, invalid: validateRegistry(registry), stale }
}

function detectRepo(root: string): string {
  try {
    const url = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return basename(url).replace(/\.git$/, '')
  } catch {
    return basename(root)
  }
}

async function importFrom(path: string): Promise<Dict> {
  const loaded: unknown = await import(pathToFileURL(path).href)
  return asDict(loaded)
}

async function loadConfig(root: string): Promise<Dict | null> {
  const path = join(root, 'vite.config.ts')
  if (!existsSync(path)) return null
  const loaded = (await importFrom(path)).default
  const value: unknown =
    typeof loaded === 'function' ? await loaded({ command: 'build', mode: 'production' }) : loaded
  return asDict(value)
}

function parseArgs(argv: string[]): Map<string, string | true> {
  const valued = new Set(['--root', '--repo', '--preset', '--registry'])
  const args = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? ''
    if (flag === '--json') {
      args.set(flag, true)
    } else if (valued.has(flag) && argv[index + 1] !== undefined) {
      args.set(flag, argv[index + 1] ?? '')
      index += 1
    } else {
      throw new Error(`未知或缺值的參數：${flag}`)
    }
  }
  return args
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  const text = (flag: string): string | undefined => {
    const value = args.get(flag)
    return typeof value === 'string' ? value : undefined
  }
  const root = resolve(text('--root') ?? process.cwd())
  const repo = text('--repo') ?? detectRepo(root)
  const presetPath = resolve(text('--preset') ?? join(root, 'vendor/oxc-shared/preset.ts'))
  const registryPath = resolve(
    text('--registry') ?? join(root, 'vendor/oxc-shared/lint-exceptions.ts'),
  )
  const presetModule = await importFrom(presetPath)
  const preset: PresetModule = {
    lintBase: asDict(presetModule.lintBase),
    fmtBase: asDict(presetModule.fmtBase),
    lockedScriptProjections:
      typeof presetModule.lockedScriptProjections === 'function'
        ? (presetModule.lockedScriptProjections as PresetModule['lockedScriptProjections'])
        : undefined,
  }
  const registry = (await importFrom(registryPath)).LINT_EXCEPTIONS as RegistryEntry[]
  const locked = preset.lockedScriptProjections?.(root) ?? []
  const result = evaluate(repo, await loadConfig(root), preset, registry, locked)
  const staleBlocks = repo === 'clade' && result.stale.length > 0
  const failed = result.unregistered.length > 0 || result.invalid.length > 0 || staleBlocks
  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return failed ? 1 : 0
  }
  const lines = [
    ...result.unregistered.map((item) => `未登記 [${item.kind}] ${item.target}`),
    ...result.invalid.map((item) => `登記不合法 ${item}`),
    ...result.stale.map((item) => `已失效的登記 [${item.kind}] ${item.target}`),
  ]
  for (const line of lines) process.stdout.write(`${line}\n`)
  process.stdout.write(
    failed
      ? `audit-lint-exceptions：${repo} 未通過，到 vendor/oxc-shared/lint-exceptions.ts 登記或移除偏離\n`
      : `audit-lint-exceptions：${repo} 通過\n`,
  )
  return failed ? 1 : 0
}

function invokedAsCli(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return entry === fileURLToPath(import.meta.url)
  }
}

if (invokedAsCli()) {
  try {
    process.exitCode = await main()
  } catch (error) {
    process.stderr.write(`audit-lint-exceptions：${String(error)}\n`)
    process.exitCode = 2
  }
}
