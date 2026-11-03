#!/usr/bin/env node
/**
 * skill-entry-match.ts —— 入口指標的比對邏輯單一來源（skill-entry-pointer.sh 與稽核共用，W-2026-10-19 Scope 3）。
 *
 *   node skill-entry-match.ts --file <path> [--cwd <dir>] [--registry <skill-sources.json>] --json
 *     → {"repo":"<toplevel>","rel":"<repo 相對路徑>","families":["clade-frontend",…]}；不在 git tree → repo 為 null
 *   <內容> | node skill-entry-match.ts --content --json
 *     → {"markers":["skill-engineering"]}
 *
 * 觸發資料不在這裡（hook-authoring 提醒注入型 Rule 5）：
 * - rule-skill family：讀 repo 投影的 `<skills 根>/clade-*\/rules/_index.md`（adapters/rule-skills.ts 產生的 paths）。
 * - 第三方 skill：`registry/skill-sources.json` 各 source 的 `triggerPaths`（{skill: glob[]}）。
 * 本檔只回「命中哪個名字」；SKILL.md 存不存在由呼叫端的 skill_rule_path 判，沒裝的 skill 不會印讀不到的 READ。
 *
 * 判不出來一律當沒命中（提醒型 fail-open）；只有旗標用錯才 exit 2。
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, matchesGlob, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const SKILL_ROOTS = ['.claude/skills', '.agents/skills']
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/
// 行首才算標記：引用這句話的 plan、grep 輸出（行首是路徑）都不是產出物本身。
const PRODUCT_MARKERS: Array<[string, RegExp]> = [
  ['skill-engineering', /^(?:>\s*)?依 `\/skill-engineering` [^\n]*產出/mu],
]

const USAGE = `usage:
  skill-entry-match.ts --file <path> [--cwd <dir>] [--registry <skill-sources.json>] --json
  <內容> | skill-entry-match.ts --content --json`

export function markersIn(text: string): string[] {
  return PRODUCT_MARKERS.filter(([, re]) => re.test(text)).map(([skill]) => skill)
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function matchesAny(rel: string, globs: unknown): boolean {
  if (!Array.isArray(globs)) return false
  return globs.some((glob) => {
    if (typeof glob !== 'string') return false
    try {
      return matchesGlob(rel, glob)
    } catch {
      return false
    }
  })
}

function indexPaths(indexFile: string): unknown[] {
  let raw: string
  try {
    raw = readFileSync(indexFile, 'utf8')
  } catch {
    return []
  }
  return raw.split('\n').flatMap((line) => {
    if (!line.trim()) return []
    try {
      const paths: unknown = JSON.parse(line)?.paths
      return Array.isArray(paths) ? paths : []
    } catch {
      return []
    }
  })
}

function ruleSkillFamilies(repo: string, rel: string): string[] {
  const hits = new Set<string>()
  for (const root of SKILL_ROOTS) {
    let names: string[]
    try {
      names = readdirSync(join(repo, root))
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.startsWith('clade-') || !SAFE_NAME.test(name)) continue
      if (matchesAny(rel, indexPaths(join(repo, root, name, 'rules/_index.md')))) hits.add(name)
    }
  }
  return [...hits]
}

function registryFamilies(registry: string | undefined, rel: string): string[] {
  if (!registry) return []
  const sources = (readJson(registry) as { sources?: unknown } | null)?.sources
  if (!Array.isArray(sources)) return []
  return sources.flatMap((source) =>
    Object.entries((source?.triggerPaths ?? {}) as Record<string, unknown>)
      .filter(([name, globs]) => SAFE_NAME.test(name) && matchesAny(rel, globs))
      .map(([name]) => name),
  )
}

function findRepo(start: string): string | null {
  let dir = start
  // 目標可能是尚不存在的新檔：往上找第一個存在的祖先，再往上找 .git（檔案＝linked worktree）。
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir)
  if (existsSync(dir) && !statSync(dir).isDirectory()) dir = dirname(dir)
  while (!existsSync(join(dir, '.git'))) {
    if (dirname(dir) === dir) return null
    dir = dirname(dir)
  }
  return dir
}

export function matchFile(file: string, cwd: string, registry?: string) {
  const absolute = isAbsolute(file) ? file : resolve(cwd, file)
  const repo = findRepo(dirname(absolute))
  if (!repo) return { repo: null, rel: null, families: [] }
  // symlink（/tmp → /private/tmp）會讓字串前綴對不上：existing 祖先取實體路徑後才算相對路徑。
  let existing = dirname(absolute)
  while (!existsSync(existing)) existing = dirname(existing)
  const real = join(realpathSync(existing), relative(existing, absolute))
  const rel = relative(realpathSync(repo), real)
  if (rel.startsWith('..')) return { repo, rel: null, families: [] }
  return {
    repo,
    rel,
    families: [...new Set([...ruleSkillFamilies(repo, rel), ...registryFamilies(registry, rel)])],
  }
}

function main() {
  let values
  try {
    ;({ values } = parseArgs({
      options: {
        file: { type: 'string' },
        cwd: { type: 'string' },
        registry: { type: 'string' },
        content: { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    }))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`)
    process.exit(2)
  }
  if (values.help) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  if (!values.json || Boolean(values.file) === Boolean(values.content)) {
    process.stderr.write(`${USAGE}\n`)
    process.exit(2)
  }
  const result = values.content
    ? { markers: markersIn(readFileSync(0, 'utf8')) }
    : matchFile(values.file!, values.cwd || process.cwd(), values.registry)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

main()
