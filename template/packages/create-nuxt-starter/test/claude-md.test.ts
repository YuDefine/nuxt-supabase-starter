import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateClaudeMd } from '../src/assemble'

const TEST_DIR = mkdtempSync(join(tmpdir(), 'claude-md-test-'))

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(TEST_DIR, { recursive: true })
})
afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('generateClaudeMd: 空殼契約', () => {
  it('只有一行標題；規約在 .claude/rules，路由在 skill description', () => {
    generateClaudeMd(TEST_DIR)
    const text = readFileSync(join(TEST_DIR, 'CLAUDE.md'), 'utf8')
    expect(text).toBe('# CLAUDE.md\n')
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(16)
    for (const banned of ['SPECTRA:START', '## Language', 'CLADE:SNIPPET', 'verify-commands.md']) {
      expect(text).not.toContain(banned)
    }
  })
})
