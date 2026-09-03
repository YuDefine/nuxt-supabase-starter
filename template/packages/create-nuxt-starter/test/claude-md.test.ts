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

describe('generateClaudeMd: 極簡契約（只留 rules 載不到的內容）', () => {
  it('留 SPECTRA marker 與 Language，其餘規約交給 .claude/rules', () => {
    generateClaudeMd(TEST_DIR)
    const text = readFileSync(join(TEST_DIR, 'CLAUDE.md'), 'utf8')

    expect(text).toContain('<!-- SPECTRA:START v1.0.2 -->')
    expect(text).toContain('<!-- SPECTRA:END -->')
    expect(text).toContain('## Language')
    expect(text).toContain('.claude/rules/local/verify-commands.md')

    for (const banned of [
      'Proactive Skill Orchestra',
      '## Stack',
      '## Commands',
      '## CRITICAL RULES',
      '### Auth',
      '### Migration',
      '### RLS Policy',
      '### 截圖調試',
      '### Development',
      '## Project Structure',
      '## Automation Triggers',
      '## AI Skills',
      'supabase db reset',
    ]) {
      expect(text, `CLAUDE.md 不該再含「${banned}」，該段已由 .claude/rules 承載`).not.toContain(
        banned,
      )
    }

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(2560)
  })
})
