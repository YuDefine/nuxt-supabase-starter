import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'pathe'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import { findCladeRoot } from '../src/post-scaffold'
import {
  TECHSTACK_RECORD_RELATIVE,
  checkTechstackRecord,
  installTechstackRecord,
  techstackCheckScript,
  techstackRecordConflict,
} from '../src/techstack-gate'

/**
 * S4-b：tech stack 確認閘門。`--yes`／managed 路徑沒帶 `--techstack-record` 或 clade check
 * 不過，就在寫第一個檔之前拒絕；齊全才放行並把紀錄複製進 target。
 *
 * 判準 SSoT 在 clade（`vendor/scripts/techstack-confirmation.ts check`）。這裡分兩層：
 * 1. fake clade：check script 是可控的 stub（紀錄含 REJECT → exit 1），釘 starter 側的
 *    呼叫形狀、拒絕時機（零檔案、零 clade 寫入呼叫）、fail-loud。
 * 2. 真 clade seam：clade checkout 在且有 check CLI 時，用它自己的 `print --skeleton`
 *    產生紀錄，驗缺 confirmed_by 被拒、齊全放行。沒有 checkout（CI）整組 skip 並印理由。
 */

const PKG_ROOT = resolve(import.meta.dirname, '..')
const CLI = join(PKG_ROOT, 'dist', 'cli.mjs')
const SRC_DIR = join(PKG_ROOT, 'src')
const ROOT = mkdtempSync(join(tmpdir(), 'techstack-gate-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

function newestSrcMtime(dir: string): number {
  let newest = 0
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    newest = Math.max(newest, stat.isDirectory() ? newestSrcMtime(full) : stat.mtimeMs)
  }
  return newest
}

beforeAll(() => {
  if (existsSync(CLI) && newestSrcMtime(SRC_DIR) <= statSync(CLI).mtimeMs) return
  execFileSync(
    'npx',
    ['vp', 'pack', 'src/cli.ts', 'src/assemble.ts', '--format', 'esm', '--out-dir', 'dist'],
    { cwd: PKG_ROOT, stdio: 'ignore', timeout: 300_000 },
  )
  if (!existsSync(CLI)) throw new Error('build prerequisite 失敗：vp pack 後仍缺 dist/cli.mjs')
}, 320_000)

interface Run {
  dir: string
  cwd: string
  cladeRoot: string
  spyLog: string
  checkLog: string
  env: Record<string, string>
}

function freshRun(name: string, opts: { withCheckScript?: boolean } = {}): Run {
  const dir = mkdtempSync(join(ROOT, `${name}-`))
  const cwd = join(dir, 'cwd')
  const home = join(dir, 'home')
  const cladeRoot = join(dir, 'fake-clade')
  mkdirSync(cwd, { recursive: true })
  mkdirSync(home, { recursive: true })
  mkdirSync(join(cladeRoot, 'scripts'), { recursive: true })
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = t\n\temail = t@test.local\n')
  const spyLog = join(dir, 'clade-calls.jsonl')
  const checkLog = join(dir, 'check-calls.jsonl')
  // 寫入面 recorder：閘門擋下時它們一次都不該被呼叫。
  for (const script of ['init-consumer.ts', 'register-consumer.ts', 'bootstrap-project.ts']) {
    writeFileSync(
      join(cladeRoot, 'scripts', script),
      `require('node:fs').appendFileSync(process.env.CLADE_SPY_LOG, ${JSON.stringify(script)} + '\\n')\n`,
    )
  }
  if (opts.withCheckScript !== false) {
    mkdirSync(join(cladeRoot, 'vendor', 'scripts'), { recursive: true })
    writeFileSync(
      join(cladeRoot, 'vendor', 'scripts', 'techstack-confirmation.ts'),
      [
        "const fs = require('node:fs')",
        'const i = process.argv.indexOf("--record")',
        'const record = process.argv[i + 1]',
        'fs.appendFileSync(process.env.CLADE_CHECK_LOG, JSON.stringify({ argv: process.argv.slice(2) }) + "\\n")',
        'const text = fs.readFileSync(record, "utf-8")',
        'if (text.includes("REJECT")) { console.log("FAIL techstack-confirmation: 1 個缺項\\n  - framework: 缺 confirmed_by"); process.exit(1) }',
        'process.exit(0)',
        '',
      ].join('\n'),
    )
  }
  return {
    dir,
    cwd,
    cladeRoot,
    spyLog,
    checkLog,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      TMPDIR: tmpdir(),
      PWD: cwd,
      INIT_CWD: cwd,
      CLADE_HOME: cladeRoot,
      CLADE_SPY_LOG: spyLog,
      CLADE_CHECK_LOG: checkLog,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      NO_COLOR: '1',
      CI: '1',
    },
  }
}

const SCAFFOLD_ONLY = [
  '--yes',
  '--preset',
  'cloudflare-supabase',
  '--db-host',
  'existing-server',
  '--no-install',
  '--no-clone-clade',
  '--no-wire-pre-commit',
  '--no-register-consumer',
] as const

function runCli(args: readonly string[], run: Run, env: Record<string, string> = run.env) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: run.cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 90_000,
    env,
  })
}

const out = (r: ReturnType<typeof runCli>) => `${r.stdout ?? ''}${r.stderr ?? ''}`

function expectNothingHappened(r: ReturnType<typeof runCli>, run: Run, project: string): void {
  expect(r.status, out(r)).not.toBe(0)
  expect(existsSync(join(run.cwd, project)), '拒絕前不得建任何檔案').toBe(false)
  expect(existsSync(run.spyLog), '拒絕前不得有 clade 寫入面呼叫').toBe(false)
}

function writeRecord(run: Run, text = '| item | decision |\n| framework | Nuxt |\n'): string {
  const path = join(run.dir, 'record.md')
  writeFileSync(path, text)
  return path
}

describe('--yes scaffold-only 的閘門（fake clade）', () => {
  it('沒帶 --techstack-record：拒絕，零檔案、零 clade 寫入', { timeout: 60_000 }, () => {
    const run = freshRun('no-record')
    const r = runCli(['no-record', ...SCAFFOLD_ONLY], run)
    expectNothingHappened(r, run, 'no-record')
    expect(out(r)).toContain('--techstack-record')
    expect(existsSync(run.checkLog)).toBe(false)
  })

  it('紀錄檔不存在：拒絕', { timeout: 60_000 }, () => {
    const run = freshRun('missing-file')
    const r = runCli(
      ['missing-file', ...SCAFFOLD_ONLY, '--techstack-record', join(run.dir, 'nope.md')],
      run,
    )
    expectNothingHappened(r, run, 'missing-file')
    expect(out(r)).toContain('不存在')
  })

  it('clade check 不過：拒絕並轉述缺項，零檔案', { timeout: 60_000 }, () => {
    const run = freshRun('check-fails')
    const record = writeRecord(run, 'REJECT\n')
    const r = runCli(['check-fails', ...SCAFFOLD_ONLY, '--techstack-record', record], run)
    expectNothingHappened(r, run, 'check-fails')
    expect(out(r)).toContain('framework: 缺 confirmed_by')
  })

  it('找不到 clade：fail-loud 拒絕（CLADE_HOME 指定但不存在不 fallback 真 home）', () => {
    const run = freshRun('no-clade')
    const record = writeRecord(run)
    const env = { ...run.env, CLADE_HOME: join(run.dir, 'missing-clade') }
    const r = runCli(['no-clade', ...SCAFFOLD_ONLY, '--techstack-record', record], run, env)
    expect(r.status, out(r)).not.toBe(0)
    expect(existsSync(join(run.cwd, 'no-clade'))).toBe(false)
    expect(out(r)).toContain('找不到 clade')
  })

  it('clade 缺 check script（版本過舊）：fail-loud 拒絕', { timeout: 60_000 }, () => {
    const run = freshRun('old-clade', { withCheckScript: false })
    const record = writeRecord(run)
    const r = runCli(['old-clade', ...SCAFFOLD_ONLY, '--techstack-record', record], run)
    expectNothingHappened(r, run, 'old-clade')
    expect(out(r)).toContain('techstack-confirmation.ts')
  })

  it(
    'check 通過：放行，紀錄複製進 target 的 docs/techstack-confirmation.md',
    { timeout: 120_000 },
    () => {
      const run = freshRun('passes')
      const record = writeRecord(run, '| framework | Nuxt |\n')
      const r = runCli(['passes', ...SCAFFOLD_ONLY, '--techstack-record', record], run)
      expect(r.status, out(r)).toBe(0)
      const installed = join(run.cwd, 'passes', 'docs', 'techstack-confirmation.md')
      expect(readFileSync(installed, 'utf-8')).toBe('| framework | Nuxt |\n')
      // 呼叫形狀：clade 的 CLI 用 `check --record <絕對路徑>`
      const calls = readFileSync(run.checkLog, 'utf-8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
      expect(calls).toEqual([{ argv: ['check', '--record', record] }])
    },
  )

  it('--json 完成報告標示 techstack: confirmed', { timeout: 120_000 }, () => {
    const run = freshRun('json-confirmed')
    const record = writeRecord(run)
    const r = runCli(
      ['json-confirmed', ...SCAFFOLD_ONLY, '--json', '--techstack-record', record],
      run,
    )
    expect(r.status, out(r)).toBe(0)
    expect(JSON.parse(r.stdout)).toMatchObject({ status: 'scaffolded', techstack: 'confirmed' })
  })
})

describe('managed（登記 fleet）路徑的閘門', () => {
  const managed = (project: string) => [
    project,
    '--yes',
    '--preset',
    'cloudflare-supabase',
    '--db-host',
    'existing-server',
    '--no-install',
    '--no-clone-clade',
    '--no-wire-pre-commit',
    '--register-consumer',
    '--repo-id',
    'fixture/project',
    '--workflow-model',
    'trunk-based',
    '--business-activity',
    'pre-production',
    '--dev-port',
    'auto',
    '--deploy-track',
    'none',
    '--no-push',
    '--offline',
  ]

  it(
    'managed 沒帶紀錄：在 register 預檢之前就拒絕（零 clade 呼叫、零檔案）',
    { timeout: 60_000 },
    () => {
      const run = freshRun('managed-no-record')
      const r = runCli(managed('managed-no-record'), run)
      expectNothingHappened(r, run, 'managed-no-record')
      expect(out(r)).toContain('--techstack-record')
    },
  )

  it('managed 紀錄不過：拒絕', { timeout: 60_000 }, () => {
    const run = freshRun('managed-reject')
    const record = writeRecord(run, 'REJECT')
    const r = runCli([...managed('managed-reject'), '--techstack-record', record], run)
    expectNothingHappened(r, run, 'managed-reject')
  })

  it('--json 失敗報告帶具名 diagnostic code', { timeout: 60_000 }, () => {
    const run = freshRun('managed-json')
    const r = runCli([...managed('managed-json'), '--json'], run)
    expectNothingHappened(r, run, 'managed-json')
    expect(JSON.parse(r.stdout)).toMatchObject({
      status: 'failed',
      diagnostics: [{ code: 'TECHSTACK_RECORD_MISSING' }],
    })
  })
})

describe('具名豁免 --techstack-playground-exempt', () => {
  it('不登記的 scaffold 可豁免，輸出標示 playground-exempt', { timeout: 120_000 }, () => {
    const run = freshRun('exempt')
    const r = runCli(['exempt', ...SCAFFOLD_ONLY, '--json', '--techstack-playground-exempt'], run)
    expect(r.status, out(r)).toBe(0)
    expect(JSON.parse(r.stdout)).toMatchObject({ techstack: 'playground-exempt' })
    expect(out(r)).toContain('playground-exempt')
    expect(existsSync(join(run.cwd, 'exempt', 'docs', 'techstack-confirmation.md'))).toBe(false)
    expect(existsSync(run.checkLog)).toBe(false)
  })

  it('登記 fleet 時不得豁免：拒絕、零檔案', { timeout: 60_000 }, () => {
    const run = freshRun('exempt-managed')
    const r = runCli(
      [
        'exempt-managed',
        '--yes',
        '--preset',
        'cloudflare-supabase',
        '--db-host',
        'existing-server',
        '--no-install',
        '--register-consumer',
        '--repo-id',
        'fixture/project',
        '--workflow-model',
        'trunk-based',
        '--business-activity',
        'pre-production',
        '--dev-port',
        'auto',
        '--deploy-track',
        'none',
        '--techstack-playground-exempt',
      ],
      run,
    )
    expectNothingHappened(r, run, 'exempt-managed')
    expect(out(r)).toContain('--techstack-playground-exempt 只能用於不登記')
  })

  it('豁免與紀錄互斥', { timeout: 60_000 }, () => {
    const run = freshRun('exempt-and-record')
    const record = writeRecord(run)
    const r = runCli(
      [
        'exempt-and-record',
        ...SCAFFOLD_ONLY,
        '--techstack-playground-exempt',
        '--techstack-record',
        record,
      ],
      run,
    )
    expectNothingHappened(r, run, 'exempt-and-record')
  })
})

describe('target 已有不同紀錄（追加式，不可被另一份蓋掉）', () => {
  it('內容不同 → 衝突理由；相同或不存在 → undefined；install 不覆蓋既有檔', () => {
    const run = freshRun('conflict')
    const target = join(run.dir, 'target')
    mkdirSync(join(target, 'docs'), { recursive: true })
    const dest = join(target, TECHSTACK_RECORD_RELATIVE)
    const record = writeRecord(run, 'new\n')
    expect(techstackRecordConflict(record, target)).toBeUndefined()
    writeFileSync(dest, 'existing\n')
    expect(techstackRecordConflict(record, target)).toContain('追加式')
    installTechstackRecord(record, target)
    expect(readFileSync(dest, 'utf-8')).toBe('existing\n')
    writeFileSync(dest, 'new\n')
    expect(techstackRecordConflict(record, target)).toBeUndefined()
  })
})

describe('checkTechstackRecord（單元）', () => {
  it('沒有 record 與沒有 clade 的拒絕碼分開', () => {
    expect(checkTechstackRecord('/x', undefined)).toMatchObject({
      code: 'TECHSTACK_RECORD_MISSING',
    })
    const run = freshRun('unit')
    const record = writeRecord(run)
    process.env.CLADE_CHECK_LOG = run.checkLog // fake check script 的日誌路徑（execFileSync 繼承）
    expect(checkTechstackRecord(undefined, record)).toMatchObject({
      code: 'TECHSTACK_CLADE_UNAVAILABLE',
    })
    expect(checkTechstackRecord(run.cladeRoot, record)).toMatchObject({ status: 'ok' })
  })
})

// ── 真 clade seam ────────────────────────────────────────────────────────────
const realClade = findCladeRoot()
const realCheck = realClade ? techstackCheckScript(realClade) : undefined
const realAvailable = realCheck !== undefined && existsSync(realCheck)
if (!realAvailable) {
  process.stdout.write(
    `[techstack-gate] 真 clade seam 本次未驗證：${
      realClade
        ? `${realClade} 缺 vendor/scripts/techstack-confirmation.ts`
        : '找不到 Clade checkout'
    }\n`,
  )
}

describe.skipIf(!realAvailable)('真 clade 的 check CLI（跨 repo seam）', () => {
  function skeleton(): string {
    return execFileSync(
      'node',
      [
        realCheck!,
        'print',
        '--recommend',
        '--skeleton',
        '--starter-root',
        resolve(PKG_ROOT, '..', '..'),
      ],
      { cwd: realClade, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
  }

  /** 把骨架每一列補齊成「Charles 已逐項確認」。 */
  function completed(text: string, by = 'Charles'): string {
    return text
      .split('\n')
      .map((line) => {
        if (!line.startsWith('| ') || line.startsWith('| item') || line.startsWith('| ---'))
          return line
        const c = line
          .split('|')
          .slice(1, -1)
          .map((x) => x.trim())
        const [item, decision, version] = c
        return `| ${item} | ${decision || 'x'} | ${version || '1.0.0'} | ${by} | 2026-11-03 | 對照清單確認 |`
      })
      .join('\n')
  }

  it(
    '骨架（沒人確認）被拒；缺 confirmed_by 被拒；齊全放行並複製進 target',
    { timeout: 180_000 },
    () => {
      const run = freshRun('real')
      // 真 clade、隔離的 HOME／PWD／INIT_CWD（INIT_CWD 漏進來會把專案建到別處）
      const env = { ...run.env, CLADE_HOME: realClade! }

      const raw = join(run.dir, 'skeleton.md')
      writeFileSync(raw, skeleton())
      const r1 = runCli(['real-a', ...SCAFFOLD_ONLY, '--techstack-record', raw], run, env)
      expect(r1.status, out(r1)).not.toBe(0)
      expect(out(r1)).toContain('confirmed_by')
      expect(existsSync(join(run.cwd, 'real-a'))).toBe(false)

      const noBy = join(run.dir, 'no-by.md')
      writeFileSync(noBy, completed(skeleton(), ''))
      const r2 = runCli(['real-b', ...SCAFFOLD_ONLY, '--techstack-record', noBy], run, env)
      expect(r2.status, out(r2)).not.toBe(0)
      expect(existsSync(join(run.cwd, 'real-b'))).toBe(false)

      const ok = join(run.dir, 'ok.md')
      writeFileSync(ok, completed(skeleton()))
      const r3 = runCli(['real-c', ...SCAFFOLD_ONLY, '--techstack-record', ok], run, env)
      expect(r3.status, out(r3)).toBe(0)
      expect(
        readFileSync(join(run.cwd, 'real-c', 'docs', 'techstack-confirmation.md'), 'utf-8'),
      ).toBe(readFileSync(ok, 'utf-8'))
    },
  )
})
