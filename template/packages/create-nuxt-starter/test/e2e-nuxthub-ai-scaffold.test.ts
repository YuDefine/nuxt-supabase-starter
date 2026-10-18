// clade-legacy-test: frozen=2026-09-28 — 舊測試：沒有對應 truth，不是 BDD 的慣例來源；工作碰到就吸收（clade-spec-workflow/rules/legacy-tests.md）
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { assembleProject } from '../src/assemble'
import { buildSelectionsFromArgs } from '../src/cli'

const TEST_DIR = mkdtempSync(join(tmpdir(), 'e2e-nuxthub-ai-scaffold-'))

function cleanTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

function scaffoldNuxthubAi(projectName = 'nuxthub-ai-app') {
  const selections = buildSelectionsFromArgs({
    projectName,
    evlogPreset: 'nuxthub-ai',
  })
  const targetDir = join(TEST_DIR, projectName)

  assembleProject(
    targetDir,
    selections.features,
    projectName,
    selections.agentTargets,
    selections.evlogPreset,
    selections.dbStack,
  )

  return targetDir
}

beforeEach(cleanTestDir)
afterEach(cleanTestDir)

describe('nuxthub-ai yes-mode fresh scaffold', () => {
  it('generates NuxtHub D1 layout without Supabase DB scripts', () => {
    const targetDir = scaffoldNuxthubAi()
    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    // 解析後對節點斷言（parser 會吃掉註解），不用 toContain 比對含註解的原文
    const wrangler = ts.parseConfigFileTextToJson(
      'wrangler.jsonc',
      readFileSync(join(targetDir, 'wrangler.jsonc.template'), 'utf-8'),
    ).config

    expect(existsSync(join(targetDir, 'server/database/migrations/0002_evlog_events.sql'))).toBe(
      true,
    )
    expect(existsSync(join(targetDir, 'server/db'))).toBe(false)

    expect(wrangler.d1_databases).toHaveLength(1)
    expect(wrangler.d1_databases[0]).toMatchObject({
      binding: 'DB',
      database_name: '{{projectName}}-d1',
      migrations_dir: 'server/database/migrations',
    })

    expect(pkg.scripts['hub:db:migrations:apply']).toBeDefined()
    expect(pkg.scripts['hub:db:migrations:create']).toBeDefined()
    expect(pkg.scripts['hub:db:studio']).toBeDefined()
    expect(pkg.scripts['db:drizzle:pull']).toBeUndefined()
  })
})
