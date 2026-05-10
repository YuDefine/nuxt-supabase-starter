import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleProject } from '../src/assemble'
import { buildSelectionsFromArgs } from '../src/cli'

const TEST_DIR = join(import.meta.dirname, '.tmp-e2e-nuxthub-ai-scaffold')

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
    selections.dbStack
  )

  return targetDir
}

beforeEach(cleanTestDir)
afterEach(cleanTestDir)

describe('nuxthub-ai yes-mode fresh scaffold', () => {
  it('generates NuxtHub D1 layout without Supabase DB scripts', () => {
    const targetDir = scaffoldNuxthubAi()
    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    const wranglerTemplate = readFileSync(join(targetDir, 'wrangler.jsonc.template'), 'utf-8')

    expect(existsSync(join(targetDir, 'server/database/migrations/0002_evlog_events.sql'))).toBe(
      true
    )
    expect(existsSync(join(targetDir, 'server/db'))).toBe(false)

    expect(wranglerTemplate).toContain('"binding": "DB"')
    expect(wranglerTemplate).toContain('"database_name": "{{projectName}}-d1"')
    expect(wranglerTemplate).toContain('"migrations_dir": "server/database/migrations"')

    expect(pkg.scripts['hub:db:migrations:apply']).toBeDefined()
    expect(pkg.scripts['hub:db:migrations:create']).toBeDefined()
    expect(pkg.scripts['hub:db:studio']).toBeDefined()
    expect(pkg.scripts['db:drizzle:pull']).toBeUndefined()
  })
})
