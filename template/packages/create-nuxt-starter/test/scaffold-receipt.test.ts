import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { consola } from 'consola'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assembleProject } from '../src/assemble'
import { postScaffold } from '../src/post-scaffold'
import {
  buildScaffoldReceipt,
  hashReceiptContent,
  SCAFFOLD_RECEIPT_PATH,
  type ScaffoldReceipt,
} from '../src/scaffold-receipt'

let TEST_DIR: string

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'scaffold-receipt-test-'))
  vi.spyOn(consola, 'start').mockImplementation(() => {})
  vi.spyOn(consola, 'success').mockImplementation(() => {})
  vi.spyOn(consola, 'info').mockImplementation(() => {})
  vi.spyOn(consola, 'warn').mockImplementation(() => {})
  vi.spyOn(consola, 'log').mockImplementation(() => {})
  vi.spyOn(consola, 'box').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(TEST_DIR, { recursive: true, force: true })
})

const modules = {
  auth: 'none' as const,
  dbSchema: 'supabase' as const,
  dbRuntime: 'cf-workers' as const,
  runtime: 'cf-workers' as const,
  framework: 'nuxt' as const,
  localHooks: [],
}

/** 契約：路徑相對 repo 根、`/` 分隔、不含 `..`／`.`／空段／絕對路徑（clade 端任一條不合整份作廢）。 */
function expectSafeRelativePaths(receipt: ScaffoldReceipt): void {
  for (const rel of Object.keys(receipt.files)) {
    expect(rel.startsWith('/')).toBe(false)
    expect(rel.includes('\\')).toBe(false)
    for (const segment of rel.split('/')) {
      expect(['', '.', '..']).not.toContain(segment)
    }
  }
}

// 這組測試真的跑 assembleProject＋postScaffold（含 git init／initial commit），不是卡住，是真的要這麼久：
// desk 負載 ~80（10 核）時 install 那條實測 139s，branch 與 origin/main 同條件整檔 199s／204s，
// 預設 60s 會在高負載下假紅。比照 preset-scaffold-smoke／cli-evlog-preset 的明示 timeout。
describe('scaffold receipt', { timeout: 300_000 }, () => {
  it('scaffold-only 在 pnpm install 當下，receipt 每筆 hash 都等於磁碟最終位元組，且隨 initial commit 進版控', async () => {
    const binDir = join(TEST_DIR, 'bin')
    const target = join(TEST_DIR, 'receipt-project')
    const checkOut = join(TEST_DIR, 'install-check.json')
    mkdirSync(binDir, { recursive: true })
    // pnpm stub：install 當下（= postinstall hub-sync 首投影的時點）逐筆比對 receipt 與磁碟。
    const checker = join(TEST_DIR, 'check-receipt.mjs')
    writeFileSync(
      checker,
      [
        "import { createHash } from 'node:crypto'",
        "import { readFileSync, writeFileSync } from 'node:fs'",
        "import { join } from 'node:path'",
        `const receipt = JSON.parse(readFileSync(${JSON.stringify(SCAFFOLD_RECEIPT_PATH)}, 'utf8'))`,
        'const mismatched = Object.entries(receipt.files).filter(([rel, hash]) =>',
        "  createHash('sha256').update(readFileSync(join(process.cwd(), rel), 'utf8')).digest('hex') !== hash)",
        `writeFileSync(${JSON.stringify(checkOut)}, JSON.stringify({ count: Object.keys(receipt.files).length, mismatched, localSettingsIncluded: Object.hasOwn(receipt.files, '.claude/settings.local.json') }))`,
        "writeFileSync('.claude/settings.local.json', JSON.stringify({ installed: true }))",
        "writeFileSync('.cursor/install-generated.md', 'generated during install\\n')",
      ].join('\n'),
    )
    writeFileSync(
      join(binDir, 'pnpm'),
      `#!/bin/sh\nif [ "$1" = install ]; then exec node ${JSON.stringify(checker)}; fi\nexit 0\n`,
      { mode: 0o755 },
    )
    vi.stubEnv('PATH', `${binDir}:${process.env.PATH}`)
    vi.stubEnv('CLADE_HOME', join(TEST_DIR, 'missing-clade'))
    vi.stubEnv('GIT_AUTHOR_NAME', 'fixture')
    vi.stubEnv('GIT_AUTHOR_EMAIL', 'fixture@example.com')
    vi.stubEnv('GIT_COMMITTER_NAME', 'fixture')
    vi.stubEnv('GIT_COMMITTER_EMAIL', 'fixture@example.com')
    assembleProject(target, [], 'receipt-project', ['claude-code', 'cursor', 'codex'])
    writeFileSync(join(target, '.claude', 'settings.local.json'), '{}\n')
    appendFileSync(join(target, '.gitignore'), '\n.claude/settings.local.json\n')

    await postScaffold(target, 'receipt-project', TEST_DIR, modules, {
      yes: true,
      registerConsumer: false,
      wirePreCommit: false,
      cloneClade: false,
      installDeps: true,
      agentTargets: ['claude-code', 'cursor', 'codex'],
      json: true,
    })

    const check = JSON.parse(readFileSync(checkOut, 'utf8')) as {
      count: number
      mismatched: unknown[]
      localSettingsIncluded: boolean
    }
    expect(check.count).toBeGreaterThan(0)
    expect(check.mismatched).toEqual([])
    expect(check.localSettingsIncluded).toBe(true)

    const receipt = JSON.parse(
      readFileSync(join(target, SCAFFOLD_RECEIPT_PATH), 'utf8'),
    ) as ScaffoldReceipt
    expect(receipt.schemaVersion).toBe(1)
    expect(receipt.producer).toBe('create-nuxt-starter')
    expect(Object.keys(receipt.files).some((rel) => rel.startsWith('.claude/'))).toBe(true)
    expect(Object.keys(receipt.files).some((rel) => rel.startsWith('.cursor/'))).toBe(true)
    // starter 自己的 consumer manifest 在寫 receipt 前就剝掉了，不得被認領。
    expect(receipt.files['.claude/hub.json']).toBeUndefined()
    expectSafeRelativePaths(receipt)
    expect(existsSync(join(target, '.clade', SCAFFOLD_RECEIPT_PATH))).toBe(false)
    expect(
      execFileSync('git', ['ls-files', '--', SCAFFOLD_RECEIPT_PATH], { cwd: target })
        .toString()
        .trim(),
    ).toBe(SCAFFOLD_RECEIPT_PATH)
    // 進版控的那份（commit 前刷新）要對得上 initial commit 的位元組：fresh clone 的首投影看的是它。
    const committed = JSON.parse(
      execFileSync('git', ['show', `HEAD:${SCAFFOLD_RECEIPT_PATH}`], { cwd: target }).toString(),
    ) as ScaffoldReceipt
    expect(committed.files['.claude/settings.local.json']).toBeUndefined()
    expect(committed.files['.cursor/install-generated.md']).toBe(
      hashReceiptContent('generated during install\n'),
    )
    for (const [rel, hash] of Object.entries(committed.files)) {
      const blob = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: target }).toString('utf8')
      expect(hashReceiptContent(blob), rel).toBe(hash)
    }
  })

  // 沒在 scaffold 內 install（--no-install 或 install 失敗）時，首投影發生在之後補跑的
  // `pnpm install`；那時磁碟上是 initial commit 的位元組，已含 dbHost 等後段改寫。
  it('--no-install 的 scaffold-only 也寫出 receipt，hash 等於 initial commit 的最終位元組', async () => {
    const target = join(TEST_DIR, 'no-install-project')
    vi.stubEnv('CLADE_HOME', join(TEST_DIR, 'missing-clade'))
    assembleProject(target, [], 'no-install-project', ['claude-code'])
    mkdirSync(join(target, '.claude', 'runtime'), { recursive: true })
    writeFileSync(join(target, '.claude', 'settings.local.json'), '{}\n')
    writeFileSync(join(target, '.claude', 'runtime', 'ignored.txt'), 'local runtime\n')
    writeFileSync(join(target, '.claude', 'runtime', '保留 空白.md'), 'tracked exception\n')
    appendFileSync(
      join(target, '.gitignore'),
      '\n.claude/settings.local.json\n.claude/runtime/*\n!.claude/runtime/保留 空白.md\n',
    )

    await postScaffold(target, 'no-install-project', TEST_DIR, modules, {
      yes: true,
      registerConsumer: false,
      wirePreCommit: false,
      cloneClade: false,
      installDeps: false,
      dbHost: 'existing-server',
      json: true,
    })

    const receipt = JSON.parse(
      readFileSync(join(target, SCAFFOLD_RECEIPT_PATH), 'utf8'),
    ) as ScaffoldReceipt
    expect(Object.keys(receipt.files).length).toBeGreaterThan(0)
    expect(receipt.files['.claude/settings.local.json']).toBeUndefined()
    expect(receipt.files['.claude/runtime/ignored.txt']).toBeUndefined()
    expect(receipt.files['.claude/runtime/保留 空白.md']).toBe(
      hashReceiptContent('tracked exception\n'),
    )
    for (const [rel, hash] of Object.entries(receipt.files)) {
      expect(hashReceiptContent(readFileSync(join(target, rel), 'utf8')), rel).toBe(hash)
      const blob = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: target }).toString('utf8')
      expect(hashReceiptContent(blob), rel).toBe(hash)
    }
    expect(existsSync(join(target, '.clade'))).toBe(false)
  })

  it('只收 agent 目錄內的一般檔，路徑排序穩定', () => {
    const target = join(TEST_DIR, 'fixture')
    mkdirSync(join(target, '.claude', 'rules'), { recursive: true })
    mkdirSync(join(target, '.codex'), { recursive: true })
    mkdirSync(join(target, 'app'), { recursive: true })
    writeFileSync(join(target, '.claude', 'rules', 'b.md'), 'b\n')
    writeFileSync(join(target, '.claude', 'a.md'), 'a\n')
    writeFileSync(join(target, '.codex', 'config.toml'), 'x = 1\n')
    writeFileSync(join(target, 'app', 'app.vue'), '<template />\n')

    const receipt = buildScaffoldReceipt(target)

    expect(Object.keys(receipt.files)).toEqual([
      '.claude/a.md',
      '.claude/rules/b.md',
      '.codex/config.toml',
    ])
    expect(receipt.files['.claude/a.md']).toBe(hashReceiptContent('a\n'))
  })

  it('既有 repo 已追蹤的檔案即使符合 gitignore，仍收錄於 committed receipt', async () => {
    const target = join(TEST_DIR, 'existing-project')
    vi.stubEnv('CLADE_HOME', join(TEST_DIR, 'missing-clade'))
    assembleProject(target, [], 'existing-project', ['claude-code'])
    writeFileSync(join(target, '.claude', 'settings.local.json'), '{}\n')
    appendFileSync(join(target, '.gitignore'), '\n.claude/settings.local.json\n')
    execFileSync('git', ['init'], { cwd: target, stdio: 'pipe' })
    execFileSync('git', ['add', '-f', '--', '.claude/settings.local.json'], { cwd: target })

    await postScaffold(target, 'existing-project', TEST_DIR, modules, {
      yes: true,
      registerConsumer: false,
      wirePreCommit: false,
      cloneClade: false,
      installDeps: false,
      existingGitRepo: true,
      json: true,
    })

    const committed = JSON.parse(
      execFileSync('git', ['show', `HEAD:${SCAFFOLD_RECEIPT_PATH}`], { cwd: target }).toString(),
    ) as ScaffoldReceipt
    const blob = execFileSync('git', ['show', 'HEAD:.claude/settings.local.json'], {
      cwd: target,
      encoding: 'utf8',
    })
    expect(committed.files['.claude/settings.local.json']).toBe(hashReceiptContent(blob))
  })
})
