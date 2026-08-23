import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleProject } from '../src/assemble'

let target: string

beforeEach(() => {
  target = mkdtempSync(join(tmpdir(), 'adopt-'))
})

afterEach(() => {
  if (existsSync(target)) rmSync(target, { recursive: true, force: true })
})

const EXISTING_GITIGNORE = '# my rules\n.env.local\nnode_modules\n'

function scaffoldInto(mergeExistingGitignore: boolean): void {
  assembleProject(target, ['database'], 'adopt-app', ['claude-code'], 'baseline', 'supabase', {
    mergeExistingGitignore,
  })
}

describe('就地展開到既有 repo', () => {
  it('保留使用者既有的 .gitignore 規則，並補上 starter 的', () => {
    writeFileSync(join(target, '.gitignore'), EXISTING_GITIGNORE)

    scaffoldInto(true)

    const merged = readFileSync(join(target, '.gitignore'), 'utf8')

    // 使用者的行原樣保留在最前面
    expect(merged.startsWith(EXISTING_GITIGNORE)).toBe(true)
    expect(merged).toContain('# my rules')
    expect(merged).toContain('.env.local')
    // starter 的規則被補上，且標明來源
    expect(merged).toContain('# --- nuxt-supabase-starter ---')
    expect(merged.length).toBeGreaterThan(EXISTING_GITIGNORE.length)
  })

  it('已存在的規則不重複寫入', () => {
    writeFileSync(join(target, '.gitignore'), EXISTING_GITIGNORE)

    scaffoldInto(true)

    const merged = readFileSync(join(target, '.gitignore'), 'utf8')
    const occurrences = merged.split('\n').filter((line) => line.trim() === 'node_modules').length

    expect(occurrences).toBe(1)
  })

  it('使用者的 README 不會被 scaffold 蓋掉', () => {
    const readme = '# co-purchase\n\n合購比價 + 拆帳協作工具。\n'
    writeFileSync(join(target, 'README.md'), readme)

    scaffoldInto(true)

    expect(readFileSync(join(target, 'README.md'), 'utf8')).toBe(readme)
  })

  it('未開啟合併時維持原本的覆蓋行為', () => {
    writeFileSync(join(target, '.gitignore'), EXISTING_GITIGNORE)

    scaffoldInto(false)

    const written = readFileSync(join(target, '.gitignore'), 'utf8')

    expect(written).not.toContain('# my rules')
  })
})
