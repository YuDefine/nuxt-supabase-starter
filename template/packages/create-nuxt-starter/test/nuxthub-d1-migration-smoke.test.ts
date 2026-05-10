import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { execFile as execFileCb } from 'node:child_process'
import { join } from 'pathe'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleProject } from '../src/assemble'
import { buildSelectionsFromArgs } from '../src/cli'

const execFile = promisify(execFileCb)
const TEST_DIR = join(import.meta.dirname, '.tmp-nuxthub-d1-migration-smoke')
const RUN_SMOKE = process.env.RUN_NUXTHUB_D1_SMOKE === '1'

function cleanTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

function scaffoldProject() {
  const projectName = 'nuxthub-d1-smoke'
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
  copyFileSync(join(targetDir, 'wrangler.jsonc.template'), join(targetDir, 'wrangler.jsonc'))

  return targetDir
}

async function run(command: string, args: string[], cwd: string) {
  try {
    return await execFile(command, args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 180_000,
    })
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string }
    const output = `${err.stdout ?? ''}\n${err.stderr ?? ''}`
    if (/(@evlog\/nuxthub|ERR_PNPM_FETCH_404|404 Not Found|not found)/i.test(output)) {
      throw new Error(
        `NuxtHub D1 smoke deferred: dependency install failed, likely @evlog/nuxthub package unavailable.\n${output}`,
        { cause: error }
      )
    }
    throw error
  }
}

beforeEach(cleanTestDir)
afterEach(cleanTestDir)

describe('NuxtHub D1 local migration smoke', () => {
  it.skipIf(!RUN_SMOKE)(
    'installs, applies local D1 migrations, and can query evlog_events',
    async () => {
      const targetDir = scaffoldProject()

      await run('pnpm', ['install'], targetDir)
      await run('pnpm', ['hub:db:migrations:apply'], targetDir)
      const { stdout } = await run(
        'pnpm',
        [
          'exec',
          'wrangler',
          'd1',
          'execute',
          'DB',
          '--local',
          '--command',
          'SELECT count(*) AS count FROM evlog_events',
        ],
        targetDir
      )

      expect(stdout).toContain('count')
      expect(
        readFileSync(join(targetDir, 'server/database/migrations/0002_evlog_events.sql'), 'utf-8')
      ).toContain('CREATE TABLE IF NOT EXISTS evlog_events')
    },
    240_000
  )
})
