import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { consola } from 'consola'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRegisterConsumerArgs,
  maybeRegisterConsumer,
  resolveCladeInitScript,
} from '../src/post-scaffold'

const TEST_DIR = join(import.meta.dirname, '.tmp-post-scaffold-test')

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(join(TEST_DIR, 'scripts'), { recursive: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('Clade script resolution', () => {
  it('prefers the current TypeScript initializer', () => {
    const tsScript = join(TEST_DIR, 'scripts', 'init-consumer.ts')
    const mjsScript = join(TEST_DIR, 'scripts', 'init-consumer.mjs')
    writeFileSync(tsScript, '')
    writeFileSync(mjsScript, '')

    expect(resolveCladeInitScript(TEST_DIR)).toBe(tsScript)
  })

  it('falls back to the legacy initializer', () => {
    const mjsScript = join(TEST_DIR, 'scripts', 'init-consumer.mjs')
    writeFileSync(mjsScript, '')

    expect(resolveCladeInitScript(TEST_DIR)).toBe(mjsScript)
  })
})

describe('Clade registry handoff', () => {
  it('keeps a consumer path containing spaces in one argv element', () => {
    const args = buildRegisterConsumerArgs(
      '/clade/scripts/register-consumer.ts',
      '/projects/customer portal',
      'YuDefine/customer-portal',
      'pr-merge-based',
      'pre-production',
      3120,
    )

    expect(args).toEqual([
      '/clade/scripts/register-consumer.ts',
      '--consumer',
      '/projects/customer portal',
      '--repo-id',
      'YuDefine/customer-portal',
      '--workflow-model',
      'pr-merge-based',
      '--business-activity',
      'pre-production',
      '--dev-port',
      '3120',
    ])
  })

  it('does not touch central state when repository identity is absent', async () => {
    const warn = vi.spyOn(consola, 'warn').mockImplementation(() => undefined)

    await expect(
      maybeRegisterConsumer(TEST_DIR, '/projects/example', {
        yes: true,
        registerConsumer: true,
        wirePreCommit: true,
        cloneClade: false,
      }),
    ).resolves.toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('--repo-id'))
  })
})
