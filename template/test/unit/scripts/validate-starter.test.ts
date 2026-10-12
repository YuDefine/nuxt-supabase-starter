import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let repoRoot: string
let fixtureRoot: string
let auditScript: string

const projectNames = [
  'validate-baseline',
  'validate-d-pattern-audit',
  'validate-none',
  'validate-nuxthub-ai',
]

function write(path: string, content: string, mode?: number) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, { mode })
}

function run(args: string[] = [], failure = '') {
  return spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts/validate-starter-scaffold.mjs'), ...args],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        CLADE_HOME: join(repoRoot, 'absent-clade'),
        VALIDATE_TEST_FAILURE: failure,
      },
    },
  )
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'validate-starter-lifecycle-'))
  fixtureRoot = join(repoRoot, 'template/temp/validate-starter')
  auditScript = join(repoRoot, 'scripts/vendor/evlog-adoption-audit.mjs')
  const scriptDir = join(repoRoot, 'scripts')
  mkdirSync(scriptDir, { recursive: true })
  copyFileSync(
    fileURLToPath(new URL('../../../../scripts/validate-starter-scaffold.mjs', import.meta.url)),
    join(scriptDir, 'validate-starter-scaffold.mjs'),
  )

  // Keep the real CLI and filesystem lifecycle; replace only build/scaffold/audit dependencies.
  // 腳本直接叫 create-nuxt-starter 的 .bin/vp pack，shim 就放在同一個位置：
  // VALIDATE_TEST_FAILURE=build 時 exit 1，其餘直接 exit 0。
  write(
    join(repoRoot, 'template/packages/create-nuxt-starter/node_modules/.bin/vp'),
    '#!/bin/sh\n[ "$VALIDATE_TEST_FAILURE" != "build" ]\n',
    0o755,
  )
  write(join(repoRoot, 'package.json'), '{"type":"module"}')
  write(
    join(repoRoot, 'template/packages/create-nuxt-starter/dist/cli.mjs'),
    'export function buildSelectionsFromArgs(args) { return { ...args, features: [] } }',
  )
  write(
    join(repoRoot, 'template/packages/create-nuxt-starter/dist/assemble.mjs'),
    `import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export function assembleProject(targetDir, features, projectName) {
  const nuxthub = projectName === 'validate-nuxthub-ai'
  mkdirSync(targetDir, { recursive: true })
  if (!nuxthub) mkdirSync(join(targetDir, 'server/db'), { recursive: true })
  writeFileSync(join(targetDir, 'package.json'), JSON.stringify({
    scripts: nuxthub ? {} : { 'db:drizzle:pull': 'drizzle-kit pull' },
    dependencies: nuxthub ? { '@nuxthub/core': '*' } : { '@nuxtjs/supabase': '*' },
  }))
}`,
  )
  write(
    auditScript,
    `const target = process.argv[process.argv.indexOf('--repo') + 1]
if (process.env.VALIDATE_TEST_FAILURE === 'audit') process.exit(2)
const none = target.endsWith('validate-none')
console.log(JSON.stringify({
  blocked: process.env.VALIDATE_TEST_FAILURE === 'regression' ? 1 : 0,
  targets: [{ signals: {
    'nuxthub.moduleInstalled': target.endsWith('validate-nuxthub-ai') ? 1 : 0,
    'drain.pipelineWraps': none ? 0 : 1,
    'enrichers.installed': none ? 0 : 5,
    'audit.forceKeepWired': target.endsWith('validate-d-pattern-audit') ? 1 : 0,
  } }],
}))`,
  )
})

afterEach(() => rmSync(repoRoot, { recursive: true, force: true }))

describe('validate-starter CLI fixture lifecycle', () => {
  for (const keep of [false, true]) {
    it(`finishes successfully and ${keep ? 'retains fixtures with --keep' : 'cleans only its fixtures'}`, () => {
      const sibling = join(repoRoot, 'template/temp/unrelated')
      mkdirSync(sibling, { recursive: true })
      mkdirSync(join(fixtureRoot, 'stale-fixture'), { recursive: true })
      const result = run(keep ? ['--keep'] : [])
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('4 fresh scaffold path(s) passed')
      expect(existsSync(sibling)).toBe(true)
      if (keep) expect(readdirSync(fixtureRoot).toSorted()).toEqual(projectNames)
      else expect(existsSync(fixtureRoot)).toBe(false)
    })

    it(`${keep ? 'retains' : 'cleans'} fixtures when a regression sets exit 1`, () => {
      const result = run(keep ? ['--keep'] : [], 'regression')
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('regression(s) failed')
      if (keep) expect(readdirSync(fixtureRoot).toSorted()).toEqual(projectNames)
      else expect(existsSync(fixtureRoot)).toBe(false)
    })

    it(`${keep ? 'retains' : 'cleans'} partial fixtures when an audit throws`, () => {
      const result = run(keep ? ['--keep'] : [], 'audit')
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('failed with status 2')
      if (keep) expect(readdirSync(fixtureRoot)).toEqual(['validate-baseline'])
      else expect(existsSync(fixtureRoot)).toBe(false)
    })
  }

  it('cleans the fixture root when the scaffolder build fails', () => {
    const result = run([], 'build')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('failed with status 1')
    expect(existsSync(fixtureRoot)).toBe(false)
  })

  it('cleans previously retained fixtures even when the audit preflight fails', () => {
    mkdirSync(join(fixtureRoot, 'stale-fixture'), { recursive: true })
    rmSync(auditScript)
    const result = run()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('audit script unavailable')
    expect(existsSync(fixtureRoot)).toBe(false)
  })
})
