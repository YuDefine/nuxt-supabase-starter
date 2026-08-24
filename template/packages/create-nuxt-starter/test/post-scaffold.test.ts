import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { consola } from 'consola'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRegisterConsumerArgs,
  maybeRegisterConsumer,
  readPendingBuildApprovals,
  resolveCladeInitScript,
  resolveSyncToCursorScript,
} from '../src/post-scaffold'

const TEST_DIR = mkdtempSync(join(tmpdir(), 'post-scaffold-test-'))

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

describe('pnpm build approval 佔位字串', () => {
  // pnpm v11 遇到未表態的 build script 會把它寫進 pnpm-workspace.yaml 並以退出碼 1 abort，
  // 但依賴其實已經裝好。這一種 MUST 與真的安裝失敗分開，否則 scaffold 會誤報失敗並
  // 跳掉後續的 hub prune / sync-to-codex。
  it('讀得出 pnpm 寫進 allowBuilds 的待表態套件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pending-builds-'))
    writeFileSync(
      join(dir, 'pnpm-workspace.yaml'),
      [
        'allowBuilds:',
        "  '@parcel/watcher': true",
        "  '@sentry/cli': set this to true or false",
        '  better-sqlite3: set this to true or false',
        '  esbuild: true',
        '',
      ].join('\n'),
    )

    expect(readPendingBuildApprovals(dir)).toEqual(['@sentry/cli', 'better-sqlite3'])
  })

  it('全部表態完就是空陣列', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pending-builds-clean-'))
    writeFileSync(
      join(dir, 'pnpm-workspace.yaml'),
      "allowBuilds:\n  '@sentry/cli': true\n  better-sqlite3: true\n",
    )

    expect(readPendingBuildApprovals(dir)).toEqual([])
  })

  it('沒有 pnpm-workspace.yaml 不炸', () => {
    expect(readPendingBuildApprovals(mkdtempSync(join(tmpdir(), 'pending-builds-none-')))).toEqual(
      [],
    )
  })
})

describe('base 模板的 pnpm build approval 設定', () => {
  // 這兩個是 scaffold 出來必然會被拉進去的：better-sqlite3 走 nitropack → db0（每個 Nuxt
  // 專案都有），@sentry/cli 走監控 feature。少一個，install 與 husky pre-commit 一起壞。
  it('allowBuilds 涵蓋 better-sqlite3 與 @sentry/cli', () => {
    const ws = readFileSync(
      join(import.meta.dirname, '..', 'templates', 'base', 'pnpm-workspace.yaml'),
      'utf-8',
    )

    expect(ws).toMatch(/^\s+better-sqlite3: true$/m)
    expect(ws).toMatch(/^\s+'@sentry\/cli': true$/m)
    // 佔位字串只能出現在說明用的註解裡，NEVER 是某個 key 的值
    expect(ws).not.toMatch(/^\s+'?[^'#:]+'?:\s*set this to true or false\s*$/m)
  })

  it('package.json 不再帶 pnpm v11 已不讀的 pnpm.allowBuilds', () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'templates', 'base', 'package.json'), 'utf-8'),
    )

    expect(pkg.pnpm).toBeUndefined()
  })
})

describe('sync-to-cursor 解析', () => {
  // 與 resolveSyncToCodexScript 同型：按序探測，NEVER 寫死單一檔名。
  // 那個形狀存在的理由是 sync-to-agents → sync-to-codex 改名後每次 scaffold 都靜默
  // 不產投影的那次事故。
  // `.ts` MUST 優先：clade 的 `.mjs` → `.ts` 改名後，user shim 只增不減，很多機器上
  // 仍留著一支指向已不存在的 `run-sync-to-*.mjs` 的死 `.mjs`。挑到它就等於投影沒產。
  it('.ts 優先於 .mjs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-cursor-'))
    writeFileSync(join(dir, 'sync-to-cursor.ts'), '')
    writeFileSync(join(dir, 'sync-to-cursor.mjs'), '')

    expect(resolveSyncToCursorScript(dir)).toBe(join(dir, 'sync-to-cursor.ts'))
  })

  it('只有 .mjs 時仍取 .mjs（還沒更新 shim 的機器）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-cursor-mjs-'))
    writeFileSync(join(dir, 'sync-to-cursor.mjs'), '')

    expect(resolveSyncToCursorScript(dir)).toBe(join(dir, 'sync-to-cursor.mjs'))
  })

  it('只有 .ts 時取 .ts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-cursor-ts-'))
    writeFileSync(join(dir, 'sync-to-cursor.ts'), '')

    expect(resolveSyncToCursorScript(dir)).toBe(join(dir, 'sync-to-cursor.ts'))
  })

  it('都沒有時回 undefined（呼叫端才好報出「投影沒產」）', () => {
    expect(
      resolveSyncToCursorScript(mkdtempSync(join(tmpdir(), 'sync-cursor-none-'))),
    ).toBeUndefined()
  })
})

describe('first-run marker', () => {
  // marker 的 instructions 曾以「詳見 docs/AGENTS.md」收尾，但那份文件在 starter 的
  // template/docs/ 底下、scaffold 不複製（只複製 root AGENTS.md）—— 每個 scaffold
  // 出去的專案都拿到一個指向不存在檔案的指標。指標型缺陷只有讀的人會發現，而讀的人
  // 通常就是那個最沒有背景知識的 first-run agent。
  function readMarkerFn(): string {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'post-scaffold.ts'), 'utf-8')
    const start = src.indexOf('function writeFirstRunMarker')
    expect(start).toBeGreaterThan(-1)
    // 只取這一個函式：切到檔尾會把別的函式（例如叫 pnpm hub:prune 的那支）一起吃進來，
    // 讓斷言對著不相干的內容誤報。
    const end = src.indexOf('\n}\n', start)
    expect(end).toBeGreaterThan(start)
    return src.slice(start, end)
  }

  it('instructions 不指向 scaffold 不會產生的檔案', () => {
    expect(readMarkerFn()).not.toContain('docs/AGENTS.md')
  })

  it('instructions 列的每一條 pnpm 指令都在 assemble 產生的 script 裡', () => {
    const marker = readMarkerFn()
    const assemble = readFileSync(join(import.meta.dirname, '..', 'src', 'assemble.ts'), 'utf-8')

    const mentioned = [...marker.matchAll(/pnpm ([\w:-]+)/g)].map((m) => m[1])
    expect(mentioned.length).toBeGreaterThan(0)

    for (const name of mentioned) {
      expect(
        assemble.includes(`'${name}'`),
        `marker 叫人跑 pnpm ${name}，但 assemble 沒產這條`,
      ).toBe(true)
    }
  })
})
