import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const TEST_DIR = join(import.meta.dirname, '.tmp-strip-manifest-test')
const ROOT_CREATE_CLEAN = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'scripts',
  'create-clean.sh'
)

function cleanTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

function writeText(path: string, value: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, value)
}

function writeManifest(value: unknown) {
  writeText(
    join(TEST_DIR, 'template', 'presets', '_base', 'strip-manifest.json'),
    `${JSON.stringify(value, null, 2)}\n`
  )
}

function makeFixture() {
  mkdirSync(join(TEST_DIR, 'scripts'), { recursive: true })
  mkdirSync(join(TEST_DIR, 'template'), { recursive: true })
  copyFileSync(ROOT_CREATE_CLEAN, join(TEST_DIR, 'scripts', 'create-clean.sh'))
}

function runCreateCleanDryRun() {
  return spawnSync('bash', [join(TEST_DIR, 'scripts', 'create-clean.sh'), '--dry-run'], {
    cwd: TEST_DIR,
    encoding: 'utf-8',
  })
}

describe('strip manifest create-clean gate', () => {
  beforeEach(() => {
    cleanTestDir()
    makeFixture()
  })

  afterEach(cleanTestDir)

  it('parses valid create-clean entries and reports existing paths', () => {
    writeText(join(TEST_DIR, 'template', 'packages', 'create-nuxt-starter', 'package.json'), '{}\n')
    writeManifest({
      schema_version: 1,
      entries: [
        {
          path: 'packages/create-nuxt-starter',
          reason: 'scaffolder-package',
          consumers: ['create-clean'],
          required: false,
        },
      ],
    })

    const result = runCreateCleanDryRun()

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[strip] would strip: packages/create-nuxt-starter')
  })

  it('rejects unknown consumers', () => {
    writeManifest({
      schema_version: 1,
      entries: [
        {
          path: 'packages/create-nuxt-starter',
          reason: 'scaffolder-package',
          consumers: ['unknown-consumer'],
          required: false,
        },
      ],
    })

    const result = runCreateCleanDryRun()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('unknown-consumer')
  })

  it('rejects path traversal selectors', () => {
    writeManifest({
      schema_version: 1,
      entries: [
        {
          path: '../scripts/create-clean.sh',
          reason: 'maintenance-script-misplacement',
          consumers: ['create-clean'],
          required: false,
        },
      ],
    })

    const result = runCreateCleanDryRun()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('path traversal')
  })

  it('fails closed when the manifest is missing', () => {
    const result = runCreateCleanDryRun()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('strip-manifest.json')
  })

  it('fails closed when the manifest is malformed', () => {
    writeText(
      join(TEST_DIR, 'template', 'presets', '_base', 'strip-manifest.json'),
      '{ not json }\n'
    )

    const result = runCreateCleanDryRun()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('malformed')
  })

  it('allows absent optional paths and reports them as skipped', () => {
    writeManifest({
      schema_version: 1,
      entries: [
        {
          path: '.spectra/claims',
          reason: 'projection-metadata',
          consumers: ['create-clean'],
          required: false,
        },
      ],
    })

    const result = runCreateCleanDryRun()

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[strip] would skip: .spectra/claims')
  })
})
