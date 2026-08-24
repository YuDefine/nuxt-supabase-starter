import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyTargetDir, describeAdoption, describeRejection } from '../src/target-dir'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'target-dir-'))
})

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

function seed(name: string, content = ''): void {
  const path = join(root, name)
  if (name.endsWith('/')) {
    mkdirSync(path, { recursive: true })
    return
  }
  writeFileSync(path, content)
}

describe('classifyTargetDir', () => {
  it('目錄不存在 → absent', () => {
    expect(classifyTargetDir(join(root, 'nope')).kind).toBe('absent')
  })

  it('空目錄 → empty', () => {
    expect(classifyTargetDir(root).kind).toBe('empty')
  })

  it('只有 git repo + 產品 README → adoptable', () => {
    mkdirSync(join(root, '.git'))
    seed('README.md', '# my product')

    const state = classifyTargetDir(root)

    expect(state.kind).toBe('adoptable')
    expect(state.hasGitRepo).toBe(true)
    expect(state.seeds).toEqual(['.git', 'README.md'])
    expect(state.blockers).toEqual([])
  })

  it('clade 的 .clade/ runtime 訊號目錄不擋就地展開', () => {
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, '.clade', 'flow'), { recursive: true })
    writeFileSync(join(root, '.clade', 'flow', 'events.jsonl'), '{}\n')
    seed('README.md', '# my product')

    const state = classifyTargetDir(root)

    expect(state.kind).toBe('adoptable')
    expect(state.blockers).toEqual([])
  })

  it('LICENSE / .gitignore / CHANGELOG 也算起手檔', () => {
    seed('LICENSE')
    seed('.gitignore', 'node_modules\n')
    seed('CHANGELOG.md')

    expect(classifyTargetDir(root).kind).toBe('adoptable')
  })

  it('已經有 code → occupied，並標出擋住的項目', () => {
    seed('README.md')
    seed('package.json', '{}')
    seed('app/')

    const state = classifyTargetDir(root)

    expect(state.kind).toBe('occupied')
    expect(state.seeds).toEqual(['README.md'])
    expect(state.blockers).toEqual(['app/', 'package.json'])
  })

  it('docs/ 不在白名單 —— scaffold 會往那裡寫檔，判 adoptable 會靜默覆蓋', () => {
    seed('README.md')
    seed('docs/')

    expect(classifyTargetDir(root).kind).toBe('occupied')
  })

  it('.github/ 同理不在白名單', () => {
    seed('.github/')

    expect(classifyTargetDir(root).kind).toBe('occupied')
  })
})

describe('describeAdoption', () => {
  it('講明 git 歷史保留、哪些檔原封不動、.gitignore 會被合併', () => {
    mkdirSync(join(root, '.git'))
    seed('README.md')
    seed('LICENSE')
    seed('.gitignore')

    const lines = describeAdoption(classifyTargetDir(root))

    expect(lines.some((l) => l.includes('保留既有 git repo'))).toBe(true)
    expect(lines.some((l) => l.includes('README.md') && l.includes('原封不動'))).toBe(true)
    expect(lines.some((l) => l.startsWith('.gitignore') && l.includes('合併'))).toBe(true)
  })

  it('沒有 .git 就不宣稱保留歷史', () => {
    seed('README.md')

    const lines = describeAdoption(classifyTargetDir(root))

    expect(lines.some((l) => l.includes('git repo'))).toBe(false)
  })
})

describe('describeRejection', () => {
  it('拒絕訊息必須自帶三條可執行的出路', () => {
    seed('package.json', '{}')

    const lines = describeRejection('my-app', classifyTargetDir(root))
    const text = lines.join('\n')

    expect(text).toContain('my-app')
    expect(text).toContain('package.json')
    expect(text).toContain('1.')
    expect(text).toContain('2.')
    expect(text).toContain('3.')
    expect(text).toContain('INTEGRATION_GUIDE.md')
  })

  it('擋住的項目過多時只列前 10 筆並標出還有幾項', () => {
    for (let i = 0; i < 14; i += 1) seed(`file-${i}.ts`)

    const text = describeRejection('my-app', classifyTargetDir(root)).join('\n')

    expect(text).toContain('另有 4 項')
  })

  it('NEVER 提議由 CLI 代為刪檔', () => {
    seed('package.json', '{}')

    const text = describeRejection('my-app', classifyTargetDir(root)).join('\n')

    expect(text).toContain('CLI 不會替你刪檔')
  })
})
