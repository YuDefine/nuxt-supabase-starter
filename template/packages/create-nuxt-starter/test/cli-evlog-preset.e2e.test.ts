import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'pathe'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * 端到端：跑真正的 `dist/cli.js`，不是直呼 `assembleProject`。
 *
 * 其他 scaffold 測試都從 `buildSelectionsFromArgs()` 起跳，所以 citty 的 argv
 * parsing、`--evlog-preset` 的 enum validation、以及 `--yes` 是否真的繞過
 * confirm prompt 這三段從來沒有被覆蓋——它們只在 build 過的 CLI 上才存在。
 *
 * stdin 一律接 'ignore'（等同 `< /dev/null`）：非 TTY 是 CI 與 agent 執行時的
 * 實際情境，`--yes` 必須在那底下也不觸及任何 prompt API。
 *
 * 一律帶 `--no-install`。scaffold 的 `pnpm install` 每次 60s 起跳，測的又不是
 * 依賴解析——這裡驗的是 argv → selections → 檔案落點這條鏈。
 *
 * TEST_DIR 落在 os.tmpdir() 而非 test/ 底下：測試不寫進 repo，並行跑也不互撞。
 *
 * CLI 自 TD-007 起以 `process.cwd()` 為判準（`process.env.PWD` 是呼叫者 shell 的值，
 * 不隨 spawn 的 cwd 改變），所以下面 runCli 的 PWD / INIT_CWD 對齊只是還原真實呼叫情境，
 * 不再是繞過 CLI bug 的必要條件。「PWD 故意指到別處」那條由本檔末尾的回歸測試守住。
 */

const PKG_ROOT = resolve(import.meta.dirname, '..')
const CLI = join(PKG_ROOT, 'dist', 'cli.js')
const TEST_DIR = mkdtempSync(join(tmpdir(), 'cli-evlog-e2e-'))

function cleanTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: TEST_DIR,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 90_000,
    env: { ...process.env, PWD: TEST_DIR, INIT_CWD: TEST_DIR },
  })
}

const YES_LOCAL = [
  '--yes',
  '--no-install',
  '--db-host',
  'this-machine',
  '--no-register-consumer',
] as const

beforeAll(() => {
  execFileSync('npx', ['tsdown', 'src/cli.ts', '--format', 'esm', '--out-dir', 'dist'], {
    cwd: PKG_ROOT,
    stdio: 'ignore',
    timeout: 300_000,
  })
}, 320_000)

afterAll(cleanTestDir)

describe('dist/cli.js --evlog-preset (end-to-end)', () => {
  it('baseline 產出 evlog plugin 三件套與 identity helper', { timeout: 120_000 }, () => {
    const result = runCli(['e2e-baseline', ...YES_LOCAL, '--evlog-preset', 'baseline'])
    expect(result.status).toBe(0)

    const target = join(TEST_DIR, 'e2e-baseline')
    expect(existsSync(join(target, 'server/plugins/evlog-drain.ts'))).toBe(true)
    expect(existsSync(join(target, 'server/plugins/evlog-enrich.ts'))).toBe(true)
    expect(existsSync(join(target, 'server/plugins/evlog-sentry-drain.ts'))).toBe(true)
    expect(existsSync(join(target, 'app/utils/evlog-identity.ts'))).toBe(true)
    // PRESET.md 是 preset 自己的說明書，不該進使用者專案
    expect(existsSync(join(target, 'PRESET.md'))).toBe(false)
  })

  it('none 產出乾淨專案，沒有任何 evlog plugin', { timeout: 120_000 }, () => {
    const result = runCli(['e2e-none', ...YES_LOCAL, '--evlog-preset', 'none'])
    expect(result.status).toBe(0)

    const target = join(TEST_DIR, 'e2e-none')
    expect(existsSync(join(target, 'package.json'))).toBe(true)
    expect(existsSync(join(target, 'server/plugins/evlog-drain.ts'))).toBe(false)
    expect(existsSync(join(target, 'server/plugins/evlog-enrich.ts'))).toBe(false)
    expect(existsSync(join(target, 'server/plugins/evlog-sentry-drain.ts'))).toBe(false)
  })

  it('未知的 preset 名稱直接 fail，並印出可用值', { timeout: 60_000 }, () => {
    const result = runCli(['e2e-bogus', '--yes', '--no-install', '--evlog-preset', 'not-a-preset'])
    expect(result.status).not.toBe(0)

    const output = `${result.stdout}${result.stderr}`
    expect(output).toContain('--evlog-preset')
    expect(output).toContain('baseline')
    expect(existsSync(join(TEST_DIR, 'e2e-bogus'))).toBe(false)
  })

  it('--yes 在非 TTY stdin 底下不觸發 prompt（TD-003 回歸鎖）', { timeout: 120_000 }, () => {
    const result = runCli(['e2e-non-tty', ...YES_LOCAL, '--evlog-preset', 'baseline'])

    // uv_tty_init EINVAL 是這條回歸的具體症狀：曾經必須靠 `script -q /dev/null`
    // 包一層才跑得動，修好之後 stdin 是不是 TTY 都不該影響 --yes。
    expect(`${result.stdout}${result.stderr}`).not.toContain('TTY initialization failed')
    expect(result.status).toBe(0)
    expect(existsSync(join(TEST_DIR, 'e2e-non-tty', 'package.json'))).toBe(true)
  })

  it('--yes 選了 Supabase 卻沒 --db-host 必須失敗且不建目錄', { timeout: 60_000 }, () => {
    const result = runCli(['e2e-no-db-host', '--yes', '--no-install'])
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('--db-host')
    expect(existsSync(join(TEST_DIR, 'e2e-no-db-host'))).toBe(false)
  })

  it('--yes 有 --db-host 但沒登記 flag 必須失敗且不建目錄', { timeout: 60_000 }, () => {
    const result = runCli([
      'e2e-no-register-flags',
      '--yes',
      '--no-install',
      '--db-host',
      'this-machine',
    ])
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('--repo-id')
    expect(existsSync(join(TEST_DIR, 'e2e-no-register-flags'))).toBe(false)
  })
})

describe('dist/cli.js 的落點只看實際 cwd（TD-007 回歸）', () => {
  it('PWD 指向 starter 套件目錄時，專案仍建在 spawn 指定的 cwd', { timeout: 120_000 }, () => {
    const isolated = mkdtempSync(join(tmpdir(), 'cli-cwd-regression-'))
    // 刻意重現 bug 情境：shell 曾 cd 到 starter 套件目錄，PWD 停在那；
    // spawn 另給 cwd，且不給 INIT_CWD（那是 npm / pnpm 才會設的）。
    const env = { ...process.env, PWD: PKG_ROOT }
    delete env.INIT_CWD

    try {
      const result = spawnSync(
        process.execPath,
        [
          CLI,
          'cwd-probe',
          '--yes',
          '--no-install',
          '--db-host',
          'this-machine',
          '--no-register-consumer',
        ],
        {
          cwd: isolated,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 90_000,
          env,
        },
      )

      expect(result.status).toBe(0)
      expect(existsSync(join(isolated, 'cwd-probe'))).toBe(true)
      // repo root 是舊行為會寫進去的地方——不能有東西落在那
      expect(existsSync(join(PKG_ROOT, '..', '..', '..', 'cwd-probe'))).toBe(false)
    } finally {
      rmSync(isolated, { recursive: true, force: true })
    }
  })
})
