// clade-legacy-test: frozen=2026-09-28 — 舊測試：沒有對應 truth，不是 BDD 的慣例來源；工作碰到就吸收（clade-spec-workflow/rules/legacy-tests.md）
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyStripManifest, loadStripManifest } from '../src/strip-manifest'

const TEST_DIR = mkdtempSync(join(tmpdir(), 'strip-manifest-test-'))
const ROOT_CREATE_CLEAN = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'scripts',
  'create-clean.sh',
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
    `${JSON.stringify(value, null, 2)}\n`,
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
      '{ not json }\n',
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

  it('strips review-rules-baseline.json so scaffolded projects start zero-baseline', () => {
    writeText(join(TEST_DIR, 'template', 'review-rules-baseline.json'), '{}\n')
    writeManifest({
      schema_version: 1,
      entries: [
        {
          path: 'review-rules-baseline.json',
          reason: 'starter-baseline-leak',
          consumers: ['create-clean', 'scaffolder'],
          required: false,
        },
      ],
    })

    const result = runCreateCleanDryRun()

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[strip] would strip: review-rules-baseline.json')
  })
})

// starter 自己的 ratchet baseline（template/review-rules-baseline.json）是維護倉存量
// 資料，不能跟著 scaffold 進新專案 —— 新專案沒有這個檔就等於零容忍起步。
// 這裡直接吃真實的 presets/_base/strip-manifest.json，不走 fixture，證明兩個
// consumer（create-clean 與 scaffolder）都會把它 strip 掉。
describe('real strip manifest: review-rules-baseline.json', () => {
  beforeEach(() => {
    cleanTestDir()
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(cleanTestDir)

  it('declares the entry for create-clean and scaffolder', () => {
    const manifest = loadStripManifest()
    const entry = manifest.entries.find((e) => e.path === 'review-rules-baseline.json')

    expect(entry).toBeDefined()
    expect(entry!.consumers).toEqual(expect.arrayContaining(['create-clean', 'scaffolder']))
  })

  for (const consumer of ['create-clean', 'scaffolder'] as const) {
    it(`removes an existing baseline file for consumer ${consumer}`, () => {
      const targetDir = join(TEST_DIR, `apply-${consumer}`)
      writeText(join(targetDir, 'review-rules-baseline.json'), '{"_meta":{}}\n')
      const manifest = loadStripManifest()

      const result = applyStripManifest(targetDir, manifest, { consumer })

      expect(result.stripped).toContain('review-rules-baseline.json')
      expect(existsSync(join(targetDir, 'review-rules-baseline.json'))).toBe(false)
    })
  }
})
