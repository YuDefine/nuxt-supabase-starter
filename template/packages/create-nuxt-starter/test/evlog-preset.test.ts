import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyEvlogPreset, describeEvlogPreset } from '../src/evlog-preset'

const TEST_DIR = join(import.meta.dirname, '.tmp-evlog-test')
const STARTER_ROOT = resolve(import.meta.dirname, '..', '..', '..')

function cleanTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

describe('applyEvlogPreset', () => {
  beforeEach(() => {
    cleanTestDir()
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(cleanTestDir)

  it('preset=none returns 0/0 and copies nothing', () => {
    const result = applyEvlogPreset(TEST_DIR, 'none', STARTER_ROOT)
    expect(result.applied).toBe(0)
    expect(result.skipped).toBe(0)
    expect(existsSync(join(TEST_DIR, 'server'))).toBe(false)
  })

  it('preset=baseline copies 6 plugin/util/docs files (PRESET.md skipped)', () => {
    const result = applyEvlogPreset(TEST_DIR, 'baseline', STARTER_ROOT)
    expect(result.applied).toBeGreaterThanOrEqual(6)
    expect(result.skipped).toBe(1) // PRESET.md
    expect(existsSync(join(TEST_DIR, 'server/plugins/evlog-drain.ts'))).toBe(true)
    expect(existsSync(join(TEST_DIR, 'server/plugins/evlog-enrich.ts'))).toBe(true)
    expect(existsSync(join(TEST_DIR, 'server/plugins/evlog-sentry-drain.ts'))).toBe(true)
    expect(existsSync(join(TEST_DIR, 'app/utils/evlog-identity.ts'))).toBe(true)
    expect(existsSync(join(TEST_DIR, 'docs/evlog-client-transport.md'))).toBe(true)
    expect(existsSync(join(TEST_DIR, 'PRESET.md'))).toBe(false)
  })

  it('preset=d-pattern-audit copies audit chain files', () => {
    const result = applyEvlogPreset(TEST_DIR, 'd-pattern-audit', STARTER_ROOT)
    expect(result.applied).toBeGreaterThanOrEqual(10)
    expect(existsSync(join(TEST_DIR, 'server/plugins/evlog-audit-signed.ts'))).toBe(true)
    expect(existsSync(join(TEST_DIR, 'server/utils/audit.ts'))).toBe(true)
    expect(existsSync(join(TEST_DIR, 'server/api/_cron/audit-chain-diff.get.ts'))).toBe(true)
    expect(existsSync(join(TEST_DIR, 'docs/audit-secret-rotation.md'))).toBe(true)
  })

  it('preset=nuxthub-ai copies AI-specific files', () => {
    const result = applyEvlogPreset(TEST_DIR, 'nuxthub-ai', STARTER_ROOT)
    expect(result.applied).toBeGreaterThanOrEqual(5)
    expect(existsSync(join(TEST_DIR, 'server/utils/ai-logger.ts'))).toBe(true)
    expect(existsSync(join(TEST_DIR, 'server/utils/sse-child-logger.ts'))).toBe(true)
    expect(existsSync(join(TEST_DIR, 'docs/evlog-nuxthub-drain.md'))).toBe(true)
  })

  it('throws on missing preset directory', () => {
    expect(() => applyEvlogPreset(TEST_DIR, 'baseline', '/nonexistent/path')).toThrow(
      /preset directory not found/
    )
  })
})

describe('describeEvlogPreset', () => {
  it('returns non-empty description for each preset', () => {
    expect(describeEvlogPreset('none')).toContain('不套')
    expect(describeEvlogPreset('baseline')).toContain('T1')
    expect(describeEvlogPreset('d-pattern-audit')).toContain('D-pattern')
    expect(describeEvlogPreset('nuxthub-ai')).toContain('NuxtHub')
  })
})
