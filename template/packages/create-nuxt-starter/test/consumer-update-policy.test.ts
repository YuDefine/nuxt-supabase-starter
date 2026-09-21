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
import { dirname, join, resolve } from 'pathe'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { applyCatalogFlags, buildSelectionsFromArgs } from '../src/cli'
import { findCladeRoot } from '../src/post-scaffold'
import { QUESTION_CATALOG, applicableQuestions, missingYesFlags } from '../src/question-catalog'

/**
 * Consumer 更新政策 — starter intake 測試契約。
 *
 * 契約來源（readonly）：
 * - specs/truth/contracts/consumer-update-policy.md § 共用建立 intake / § Starter CLI 與 AI 的同一可執行入口
 * - specs/truth/data/consumer-update-policy.md § 身分與政策
 * - spec.md FR-005 / FR-006 / FR-007（預設 pinned、CLI 與 AI 同一問題定義、scaffold-only 保留）
 *
 * 本檔只測 starter 側語意，不複製 33 個 BDD scenario：
 *
 * 1. catalog：`update-policy` 是 register 專屬題，options 恰好 pinned|subscribed，
 *    default 由 catalog 宣告為 pinned（未提供政策時不得由測試或呼叫端代填）。
 * 2. normalizer：managed（register）流程未給政策 → pinned；明確 subscribed → subscribed；
 *    非法值在 selections 階段就拒絕。
 * 3. CLI process：spawn 真 `dist/cli.js`。CLADE_HOME 指向測試自建的 fake clade —
 *    scripts/*.ts 全是 argv recorder（記錄 script 名、argv、cwd 後 exit 0），
 *    不在測試裡重寫 registry/manifest writer；starter→clade 的 argv 就是被測的 seam。
 *    - managed 新建與 adopt 未給政策 → 交付呼叫帶 `--update-policy pinned`
 *    - 明確 `--update-policy subscribed` → `subscribed`
 *    - `--answers-file` 與旗標走同一 normalizer → 兩次受管理呼叫 argv 一致、產出檔案樹一致
 *    - `--no-register-consumer` → fake clade 的 recorder 一次都不該被呼叫
 *      （init-consumer / register / bootstrap / consumer-meta / vendor sync / gate mint /
 *      hook wiring 全部為零），registry 檔 bytes 不變
 *    - answers-file 未知 id、非法值、與顯式 flag 衝突 → 都在寫第一個檔之前拒絕
 *      （exit≠0、目錄不存在、零 clade 呼叫）
 *    - CLADE_HOME 指定但來源不可用 → 不得 fallback 真 home
 *
 * Build prerequisite：process 層跑 `dist/cli.js`。dist 由 `pnpm run build`（tsdown）
 * 產生；beforeAll 只在 dist 缺席或 src/ 下任一檔較新時重建（cli.ts 的 bundle
 * 依賴圖全部在 src/ 內：assemble、prompts、post-scaffold、question-catalog 等
 * 改了都要重建，不能只看 cli.ts）。與 cli-evlog-preset.e2e.test.ts 同慣例，
 * 但避免與其他 test file 的 rebuild 撞寫。dist 不存在不是可 skip 的狀態。
 */

const PKG_ROOT = resolve(import.meta.dirname, '..')
const CLI = join(PKG_ROOT, 'dist', 'cli.js')
const SRC_DIR = join(PKG_ROOT, 'src')
const ROOT = mkdtempSync(join(tmpdir(), 'consumer-update-policy-'))

const POLICY_FLAG = '--update-policy'
const ANSWERS_FLAG = '--answers-file'

// 契約 § Starter CLI 與 AI 的同一可執行入口：真隔離測試沿用的既有旗標組。
const ISOLATION_FLAGS = [
  '--yes',
  '--preset',
  'cloudflare-supabase',
  '--db-host',
  'existing-server',
  '--no-install',
  '--no-clone-clade',
  '--no-wire-pre-commit',
] as const

// 「managed 再給 …及本輪 release/store/registry/no-push」的執行控制旗標。
function managedExecArgs(paths: {
  registryPath: string
  releaseStore: string
  release: string
}): string[] {
  return [
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
    '--release',
    paths.release,
    '--release-store',
    paths.releaseStore,
    '--registry-path',
    paths.registryPath,
    '--no-push',
    '--offline',
  ]
}

// answers-file 的 catalog answers（{ schemaVersion: 1, answers: { <catalog-id>: <value> } }），
// 與 managedExecArgs 的旗標答案一一對應；執行控制（preset/release/store/registry/no-push）
// 依契約仍是旗標，不混入 answers。
const MANAGED_ANSWERS: Record<string, string> = {
  'db-host': 'existing-server',
  'register-fleet': 'yes',
  'repo-id': 'fixture/project',
  'workflow-model': 'trunk-based',
  'business-activity': 'pre-production',
  'dev-port': 'auto',
  'deploy-track': 'none',
}

const SCAFFOLD_ONLY_ANSWERS: Record<string, string> = {
  'db-host': 'existing-server',
  'register-fleet': 'no',
}

// clade 側被呼叫的 script 都是「外部邊界」：recorder 只記 argv 後 exit 0，
// registry/manifest/release 的真實寫入由 clade 產品與 BDD 層驗，不在此檔造假。
const CLADE_SCRIPT_NAMES = [
  'init-consumer.ts',
  'register-consumer.ts',
  'bootstrap-project.ts',
  'sync-vendor.ts',
  'mint-gate-playbooks.ts',
  'scaffold-consumer-meta.ts',
] as const

interface SpyCall {
  script: string
  argv: string[]
  cwd: string
}

interface RunFixture {
  cwd: string
  env: Record<string, string>
  spyLog: string
  registryPath: string
  releaseStore: string
  cladeRoot: string
}

function recorderSource(name: string): string {
  return [
    "const { appendFileSync, mkdirSync } = require('node:fs')",
    "const { dirname } = require('node:path')",
    'const log = process.env.CLADE_SPY_LOG',
    'if (log) {',
    '  mkdirSync(dirname(log), { recursive: true })',
    `  appendFileSync(log, JSON.stringify({ script: ${JSON.stringify(
      name,
    )}, argv: process.argv.slice(2), cwd: process.cwd() }) + '\\n')`,
    '}',
    'process.exit(0)',
    '',
  ].join('\n')
}

function makeFakeClade(runDir: string): { cladeRoot: string; spyLog: string } {
  const cladeRoot = join(runDir, 'fake-clade')
  const scriptsDir = join(cladeRoot, 'scripts')
  mkdirSync(scriptsDir, { recursive: true })
  for (const name of CLADE_SCRIPT_NAMES) {
    writeFileSync(join(scriptsDir, name), recorderSource(name))
  }
  // pre-commit wire 的素材：存在才能測「有東西可 copy 也不該 copy」。
  mkdirSync(join(cladeRoot, 'vendor'), { recursive: true })
  writeFileSync(
    join(cladeRoot, 'vendor', 'git-pre-commit.sh'),
    '#!/bin/sh\n# fake clade pre-commit hook\npnpm hub:check\n',
  )
  return { cladeRoot, spyLog: join(runDir, 'clade-calls.jsonl') }
}

/** 隔離環境：臨時 HOME + 獨立 gitconfig，無 ambient credentials。 */
function freshRun(name: string): RunFixture {
  const runDir = mkdtempSync(join(ROOT, `${name}-`))
  const cwd = join(runDir, 'cwd')
  const home = join(runDir, 'home')
  const releaseStore = join(runDir, 'release-store')
  mkdirSync(cwd, { recursive: true })
  mkdirSync(home, { recursive: true })
  mkdirSync(releaseStore, { recursive: true })
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = cup-test\n\temail = cup@test.local\n')
  const { cladeRoot, spyLog } = makeFakeClade(runDir)
  const registryPath = join(runDir, 'registry.json')
  writeFileSync(registryPath, `${JSON.stringify({ consumers: [] }, null, 2)}\n`)
  return {
    cwd,
    spyLog,
    cladeRoot,
    registryPath,
    releaseStore,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      TMPDIR: tmpdir(),
      PWD: cwd,
      INIT_CWD: cwd,
      CLADE_HOME: cladeRoot,
      CLADE_SPY_LOG: spyLog,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      NO_COLOR: '1',
      CI: '1',
    },
  }
}

function runCli(args: string[], run: RunFixture) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: run.cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 90_000,
    env: run.env,
  })
}

function readSpyLog(spyLog: string): SpyCall[] {
  if (!existsSync(spyLog)) return []
  return readFileSync(spyLog, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SpyCall)
}

/** 受管理交付呼叫（register-consumer 或 bootstrap-project），不含 --preflight 探查。 */
function managedCallArgv(calls: SpyCall[]): string[] | undefined {
  const managed = calls.filter(
    (call) =>
      /register-consumer|bootstrap-project/.test(call.script) && !call.argv.includes('--preflight'),
  )
  return managed.at(-1)?.argv
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}

/**
 * argv parity 正規化：把各 run 實際獨立的路徑（registry、release-store、
 * fake clade root、spy log、cwd 下的 target 等）換成 placeholder，讓
 * 「同一 normalizer」的斷言只比對旗標與值的語意。未列舉的 per-run 路徑
 * 由最後的 runDir 兜底（cwd/registry/store/clade/spy 全在 runDir 下）。
 */
function normalizeRunPaths(token: string, run: RunFixture): string {
  const placeholders: Array<readonly [string, string]> = [
    [run.registryPath, '<REGISTRY_PATH>'],
    [run.releaseStore, '<RELEASE_STORE>'],
    [run.cladeRoot, '<CLADE_HOME>'],
    [run.spyLog, '<SPY_LOG>'],
    [run.cwd, '<RUN_CWD>'],
    [dirname(run.cwd), '<RUN_DIR>'],
  ]
  return placeholders.reduce((acc, [from, to]) => acc.split(from).join(to), token)
}

function writeAnswersFile(
  dir: string,
  answers: Record<string, unknown>,
  schemaVersion: unknown = 1,
): string {
  const path = join(dir, `answers-${readdirSync(dir).length}.json`)
  writeFileSync(path, JSON.stringify({ schemaVersion, answers }, null, 2))
  return path
}

/** 產出的檔案樹（相對路徑排序，排除 .git 內部）。 */
function projectTree(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir)) {
      if (prefix === '' && entry === '.git') continue
      const full = join(dir, entry)
      const rel = prefix === '' ? entry : `${prefix}/${entry}`
      if (statSync(full).isDirectory()) walk(full, rel)
      else out.push(rel)
    }
  }
  walk(root, '')
  return out.toSorted()
}

function outputOf(result: ReturnType<typeof runCli>): string {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

function expectRejectedBeforeWrites(
  result: ReturnType<typeof runCli>,
  targetDir: string,
  spyLog: string,
) {
  expect(result.status, `應拒絕但 exit=0：${outputOf(result)}`).not.toBe(0)
  expect(existsSync(targetDir), '拒絕前不得寫第一個檔：目錄不應存在').toBe(false)
  expect(readSpyLog(spyLog), '拒絕前不得有任何 clade 呼叫').toEqual([])
}

/** src/ 遞迴最新 mtime：dist bundle 的完整 source 依賴圖都在此目錄內。 */
function newestSrcMtime(dir: string): number {
  let newest = 0
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    newest = Math.max(newest, stat.isDirectory() ? newestSrcMtime(full) : stat.mtimeMs)
  }
  return newest
}

function distIsStale(): boolean {
  if (!existsSync(CLI)) return true
  return newestSrcMtime(SRC_DIR) > statSync(CLI).mtimeMs
}

beforeAll(() => {
  // Build prerequisite：dist/cli.js 必須存在且不比 src/ 任何檔舊。失敗直接炸在
  // hook，不讓任何測試因 artifact 缺席或過期而誤過。
  if (!distIsStale()) return
  execFileSync('npx', ['tsdown', 'src/cli.ts', '--format', 'esm', '--out-dir', 'dist'], {
    cwd: PKG_ROOT,
    stdio: 'ignore',
    timeout: 300_000,
  })
  if (!existsSync(CLI)) {
    throw new Error('build prerequisite 失敗：pnpm run build 後仍缺 dist/cli.js')
  }
}, 320_000)

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

describe('update-policy catalog 契約', () => {
  it('catalog 有 update-policy 題：register 條件、--update-policy、恰好 pinned|subscribed', () => {
    const question = QUESTION_CATALOG.find((q) => q.id === 'update-policy')
    expect(question, 'QUESTION_CATALOG 缺 update-policy 題').toBeDefined()
    expect(question!.when).toBe('register')
    expect(question!.flag).toBe(POLICY_FLAG)
    expect(question!.options?.map((o) => o.value).toSorted()).toEqual(['pinned', 'subscribed'])
    // 契約：「policy 未提供時從 catalog 的合法 default 得 pinned」—— default 由
    // catalog 自身宣告（defaultValue 或 options[].default），不是散落在呼叫端。
    const declaredDefault =
      (question as { defaultValue?: string } | undefined)?.defaultValue ??
      question!.options?.find((o) => (o as { default?: boolean }).default === true)?.value
    expect(declaredDefault, 'catalog 須宣告 update-policy 的合法 default = pinned').toBe('pinned')
  })

  it('update-policy 只在 register（managed）流程適用，且有 default 所以不是 --yes 必填', () => {
    const registerIds = applicableQuestions({ hasSupabase: true, register: true }).map((q) => q.id)
    const scaffoldOnlyIds = applicableQuestions({
      hasSupabase: true,
      register: false,
    }).map((q) => q.id)
    expect(registerIds).toContain('update-policy')
    expect(scaffoldOnlyIds).not.toContain('update-policy')

    // 有合法 default 的題不是 --yes 必填：其他 register 旗標都給了之後，
    // missingYesFlags 不得再要求 --update-policy。與上題同 describe 的第一個斷言
    // （題目存在）先守住，避免本斷言在題目缺席時 vacuous pass。
    const missing = missingYesFlags({
      hasSupabase: true,
      register: true,
      present: new Set([
        '--db-host',
        '--repo-id',
        '--workflow-model',
        '--business-activity',
        '--dev-port',
        '--deploy-track',
      ]),
    }).map((q) => q.id)
    expect(missing).not.toContain('update-policy')
  })
})

describe('intake normalizer 政策語意', () => {
  const baseSelections = () =>
    buildSelectionsFromArgs({ projectName: 'policy-app', preset: 'cloudflare-supabase' })

  it('managed 未給政策 → updatePolicy = pinned（catalog default，呼叫端不代填）', () => {
    const selections = applyCatalogFlags(baseSelections(), {
      dbHost: 'existing-server',
      nonInteractive: true,
      register: true,
    } as Parameters<typeof applyCatalogFlags>[1])
    expect((selections as { updatePolicy?: string }).updatePolicy).toBe('pinned')
  })

  it('明確 update-policy=subscribed → updatePolicy = subscribed', () => {
    const selections = applyCatalogFlags(baseSelections(), {
      dbHost: 'existing-server',
      nonInteractive: true,
      register: true,
      updatePolicy: 'subscribed',
    } as Parameters<typeof applyCatalogFlags>[1])
    expect((selections as { updatePolicy?: string }).updatePolicy).toBe('subscribed')
  })

  it('非法政策值在 selections 階段就拒絕，訊息指出合法值', () => {
    expect(() =>
      applyCatalogFlags(baseSelections(), {
        dbHost: 'existing-server',
        nonInteractive: true,
        register: true,
        updatePolicy: 'weekly',
      } as Parameters<typeof applyCatalogFlags>[1]),
    ).toThrow(/update-policy|pinned|subscribed/)
  })
})

describe('CLI process：managed 交付的政策 argv', () => {
  it(
    '新建 managed 未給政策 → 交付呼叫帶 --update-policy pinned 與本輪 release/store/registry/no-push',
    { timeout: 120_000 },
    () => {
      const run = freshRun('managed-default')
      const result = runCli(
        [
          'managed-default',
          ...ISOLATION_FLAGS,
          ...managedExecArgs({
            registryPath: run.registryPath,
            releaseStore: run.releaseStore,
            release: '1.0.0',
          }),
        ],
        run,
      )

      expect(outputOf(result)).not.toContain('TTY initialization failed')
      expect(result.status, outputOf(result)).toBe(0)

      const calls = readSpyLog(run.spyLog)
      expect(
        calls.some((call) => call.script === 'init-consumer.ts'),
        'managed 流程應呼叫 init-consumer',
      ).toBe(true)

      const argv = managedCallArgv(calls)
      expect(argv, '沒有任何受管理交付呼叫（register-consumer/bootstrap-project）').toBeDefined()
      expect(flagValue(argv!, '--repo-id')).toBe('fixture/project')
      expect(flagValue(argv!, POLICY_FLAG)).toBe('pinned')
      expect(flagValue(argv!, '--release')).toBe('1.0.0')
      expect(flagValue(argv!, '--release-store')).toBe(run.releaseStore)
      expect(flagValue(argv!, '--registry-path')).toBe(run.registryPath)
      expect(argv!).toContain('--no-push')
      expect(argv!).toContain('--offline')
    },
  )

  it(
    '新建 managed 明確 --update-policy subscribed → 交付呼叫帶 subscribed',
    { timeout: 120_000 },
    () => {
      const run = freshRun('managed-subscribed')
      const result = runCli(
        [
          'managed-subscribed',
          ...ISOLATION_FLAGS,
          ...managedExecArgs({
            registryPath: run.registryPath,
            releaseStore: run.releaseStore,
            release: '1.0.0',
          }),
          POLICY_FLAG,
          'subscribed',
        ],
        run,
      )

      expect(result.status, outputOf(result)).toBe(0)
      const argv = managedCallArgv(readSpyLog(run.spyLog))
      expect(argv).toBeDefined()
      expect(flagValue(argv!, POLICY_FLAG)).toBe('subscribed')
    },
  )

  it('adopt 既有 repo：預設 pinned、既有工作與 git 歷史原封', { timeout: 120_000 }, () => {
    const run = freshRun('managed-adopt')
    const repoDir = join(run.cwd, 'adopted-app')
    mkdirSync(repoDir, { recursive: true })
    writeFileSync(join(repoDir, 'README.md'), '# existing product\n')
    const gitEnv = { ...run.env }
    execFileSync('git', ['init'], { cwd: repoDir, env: gitEnv, stdio: 'pipe' })
    execFileSync('git', ['add', '-A'], { cwd: repoDir, env: gitEnv, stdio: 'pipe' })
    execFileSync('git', ['commit', '-m', 'seed'], { cwd: repoDir, env: gitEnv, stdio: 'pipe' })
    const seedHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      env: gitEnv,
      encoding: 'utf-8',
    }).trim()

    const result = runCli(
      [
        'adopted-app',
        ...ISOLATION_FLAGS,
        ...managedExecArgs({
          registryPath: run.registryPath,
          releaseStore: run.releaseStore,
          release: '1.0.0',
        }),
      ],
      run,
    )

    expect(result.status, outputOf(result)).toBe(0)
    expect(readFileSync(join(repoDir, 'README.md'), 'utf-8')).toBe('# existing product\n')
    // adopt 不重置歷史：seed commit 仍是 HEAD 的祖先（starter 只疊一個 scaffold commit）。
    const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', seedHead, 'HEAD'], {
      cwd: repoDir,
      env: gitEnv,
    })
    expect(ancestor.status, '既有 commit 必須仍是 HEAD 的祖先').toBe(0)

    const argv = managedCallArgv(readSpyLog(run.spyLog))
    expect(argv).toBeDefined()
    expect(flagValue(argv!, POLICY_FLAG)).toBe('pinned')
  })
})

describe('CLI process：--answers-file 與旗標同一 normalizer', () => {
  it(
    'answers-file（無 --yes、register 答案全在檔裡）與旗標產出一致的受管理 argv 與檔案樹',
    { timeout: 240_000 },
    () => {
      const flagsRun = freshRun('parity-flags')
      const answersRun = freshRun('parity-answers')

      const execFlags = (run: RunFixture) => [
        '--release',
        '1.0.0',
        '--release-store',
        run.releaseStore,
        '--registry-path',
        run.registryPath,
        '--no-push',
        '--offline',
      ]

      const flagResult = runCli(
        [
          'parity-app',
          ...ISOLATION_FLAGS,
          ...managedExecArgs({
            registryPath: flagsRun.registryPath,
            releaseStore: flagsRun.releaseStore,
            release: '1.0.0',
          }),
        ],
        flagsRun,
      )
      expect(flagResult.status, outputOf(flagResult)).toBe(0)

      const answersFile = writeAnswersFile(answersRun.cwd, MANAGED_ANSWERS)
      const answersResult = runCli(
        [
          'parity-app',
          '--preset',
          'cloudflare-supabase',
          '--no-install',
          '--no-clone-clade',
          '--no-wire-pre-commit',
          ANSWERS_FLAG,
          answersFile,
          ...execFlags(answersRun),
        ],
        answersRun,
      )
      // answers-file 自動進非互動模式：不帶 --yes 也不得觸及 prompt。
      expect(outputOf(answersResult)).not.toContain('TTY initialization failed')
      expect(answersResult.status, outputOf(answersResult)).toBe(0)

      const flagsArgv = managedCallArgv(readSpyLog(flagsRun.spyLog))
      const answersArgv = managedCallArgv(readSpyLog(answersRun.spyLog))
      expect(flagsArgv, '旗標流程沒有受管理交付呼叫').toBeDefined()
      expect(answersArgv, 'answers-file 流程沒有受管理交付呼叫').toBeDefined()

      // 兩個 run 的 registry／release-store／target 等路徑各自獨立；
      // 先把實際路徑正規化成 placeholder 再比對，否則正確轉交的隔離旗標
      // 也會因 mkdtemp 路徑不同而誤判 argv 不一致。
      const normalizedFlagsArgv = flagsArgv!.map((token) => normalizeRunPaths(token, flagsRun))
      const normalizedAnswersArgv = answersArgv!.map((token) =>
        normalizeRunPaths(token, answersRun),
      )
      expect(normalizedAnswersArgv).toEqual(normalizedFlagsArgv)
      expect(flagValue(normalizedAnswersArgv, POLICY_FLAG)).toBe('pinned')

      // 同一 normalizer → 產出的檔案樹一致（.git 內部除外）。
      expect(projectTree(join(answersRun.cwd, 'parity-app'))).toEqual(
        projectTree(join(flagsRun.cwd, 'parity-app')),
      )
    },
  )

  it('answers-file 明確 update-policy=subscribed → 與旗標同義', { timeout: 120_000 }, () => {
    const run = freshRun('answers-subscribed')
    const answersFile = writeAnswersFile(run.cwd, {
      ...MANAGED_ANSWERS,
      'update-policy': 'subscribed',
    })
    const result = runCli(
      [
        'answers-subscribed',
        '--preset',
        'cloudflare-supabase',
        '--no-install',
        '--no-clone-clade',
        '--no-wire-pre-commit',
        ANSWERS_FLAG,
        answersFile,
        '--release',
        '1.0.0',
        '--release-store',
        run.releaseStore,
        '--registry-path',
        run.registryPath,
        '--no-push',
        '--offline',
      ],
      run,
    )

    expect(result.status, outputOf(result)).toBe(0)
    const argv = managedCallArgv(readSpyLog(run.spyLog))
    expect(argv).toBeDefined()
    expect(flagValue(argv!, POLICY_FLAG)).toBe('subscribed')
  })
})

describe('CLI process：scaffold-only 零受管理副作用', () => {
  it(
    '--no-register-consumer：不呼叫 init-consumer/vendor/gate/hook，registry bytes 不變',
    { timeout: 120_000 },
    () => {
      const run = freshRun('scaffold-only')
      const registryBefore = readFileSync(run.registryPath, 'utf-8')
      const result = runCli(['scaffold-only', ...ISOLATION_FLAGS, '--no-register-consumer'], run)

      expect(result.status, outputOf(result)).toBe(0)
      const target = join(run.cwd, 'scaffold-only')
      expect(existsSync(join(target, 'package.json')), 'scaffold 本身應完成').toBe(true)

      // 契約：scaffold-only 不得執行 init-consumer、vendor sync、gate mint 或
      // hook wiring —— fake clade 的 recorder 一次都不該被呼叫。
      expect(
        readSpyLog(run.spyLog),
        'scaffold-only 呼叫了 clade script（init/register/vendor/gate/meta）',
      ).toEqual([])

      expect(existsSync(join(target, '.claude', 'hub.json')), '不應有 managed manifest').toBe(false)
      expect(existsSync(join(target, '.clade')), '不應有 .clade 目錄').toBe(false)
      expect(existsSync(join(target, 'vendor')), '不應有 vendor 投影').toBe(false)

      const huskyHook = join(target, '.husky', 'pre-commit')
      if (existsSync(huskyHook)) {
        expect(readFileSync(huskyHook, 'utf-8')).not.toContain('hub:check')
      }
      expect(existsSync(join(target, '.git', 'hooks', 'pre-commit'))).toBe(false)

      // registry side effect：連讀寫嘗試都不該發生，檔案 bytes 原封。
      expect(readFileSync(run.registryPath, 'utf-8')).toBe(registryBefore)
    },
  )

  it(
    'scaffold-only 即使未加 --no-wire-pre-commit，也不得 wire hub:check hook',
    { timeout: 120_000 },
    () => {
      const run = freshRun('scaffold-only-wire')
      const result = runCli(
        [
          'scaffold-only-wire',
          '--yes',
          '--preset',
          'cloudflare-supabase',
          '--db-host',
          'existing-server',
          '--no-install',
          '--no-clone-clade',
          '--no-register-consumer',
        ],
        run,
      )

      expect(result.status, outputOf(result)).toBe(0)
      const target = join(run.cwd, 'scaffold-only-wire')
      expect(readSpyLog(run.spyLog)).toEqual([])
      const huskyHook = join(target, '.husky', 'pre-commit')
      if (existsSync(huskyHook)) {
        expect(readFileSync(huskyHook, 'utf-8')).not.toContain('hub:check')
      }
      expect(existsSync(join(target, '.git', 'hooks', 'pre-commit'))).toBe(false)
    },
  )

  it(
    'answers-file 的 register-fleet=no 同樣是 scaffold-only：自動非互動完成、零 clade 呼叫',
    { timeout: 120_000 },
    () => {
      const run = freshRun('answers-scaffold-only')
      const answersFile = writeAnswersFile(run.cwd, SCAFFOLD_ONLY_ANSWERS)
      const result = runCli(
        [
          'answers-scaffold-only',
          '--preset',
          'cloudflare-supabase',
          '--no-install',
          '--no-clone-clade',
          '--no-wire-pre-commit',
          ANSWERS_FLAG,
          answersFile,
        ],
        run,
      )

      expect(result.status, outputOf(result)).toBe(0)
      const target = join(run.cwd, 'answers-scaffold-only')
      expect(existsSync(join(target, 'package.json'))).toBe(true)
      expect(readSpyLog(run.spyLog)).toEqual([])
      expect(existsSync(join(target, '.claude', 'hub.json'))).toBe(false)
    },
  )
})

describe('CLI process：answers-file / 政策值拒絕在寫第一個檔之前', () => {
  const baseRejectArgs = (answersFile: string) => [
    '--yes',
    '--preset',
    'cloudflare-supabase',
    '--db-host',
    'existing-server',
    '--no-install',
    '--no-clone-clade',
    '--no-wire-pre-commit',
    '--no-register-consumer',
    ANSWERS_FLAG,
    answersFile,
  ]

  it('未知 answer id：拒絕、訊息指出該 id', { timeout: 60_000 }, () => {
    const run = freshRun('reject-unknown-id')
    const answersFile = writeAnswersFile(run.cwd, {
      ...SCAFFOLD_ONLY_ANSWERS,
      'not-a-question': 'x',
    })
    const result = runCli(['reject-unknown-id', ...baseRejectArgs(answersFile)], run)

    expectRejectedBeforeWrites(result, join(run.cwd, 'reject-unknown-id'), run.spyLog)
    expect(outputOf(result)).toContain('not-a-question')
  })

  it('非法政策值（answers）：拒絕、訊息指出合法選項', { timeout: 60_000 }, () => {
    const run = freshRun('reject-bad-policy')
    const answersFile = writeAnswersFile(run.cwd, {
      ...SCAFFOLD_ONLY_ANSWERS,
      'update-policy': 'weekly',
    })
    const result = runCli(['reject-bad-policy', ...baseRejectArgs(answersFile)], run)

    expectRejectedBeforeWrites(result, join(run.cwd, 'reject-bad-policy'), run.spyLog)
    expect(outputOf(result)).toMatch(/update-policy|pinned|subscribed/)
  })

  it('非法政策值（旗標）：--update-policy weekly 同樣拒絕', { timeout: 60_000 }, () => {
    const run = freshRun('reject-bad-policy-flag')
    const result = runCli(
      [
        'reject-bad-policy-flag',
        '--yes',
        '--preset',
        'cloudflare-supabase',
        '--db-host',
        'existing-server',
        '--no-install',
        '--no-clone-clade',
        '--no-wire-pre-commit',
        '--no-register-consumer',
        POLICY_FLAG,
        'weekly',
      ],
      run,
    )

    expectRejectedBeforeWrites(result, join(run.cwd, 'reject-bad-policy-flag'), run.spyLog)
    expect(outputOf(result)).toMatch(/update-policy|pinned|subscribed/)
  })

  it(
    'answers 與旗標衝突：register-fleet=yes 撞上 --no-register-consumer',
    { timeout: 60_000 },
    () => {
      const run = freshRun('reject-conflict-register')
      const answersFile = writeAnswersFile(run.cwd, {
        ...MANAGED_ANSWERS,
        'register-fleet': 'yes',
      })
      const result = runCli(['reject-conflict-register', ...baseRejectArgs(answersFile)], run)

      expectRejectedBeforeWrites(result, join(run.cwd, 'reject-conflict-register'), run.spyLog)
      expect(outputOf(result)).toMatch(/register-fleet|register-consumer|衝突|conflict/i)
    },
  )

  it(
    'answers 與旗標衝突：update-policy=subscribed 撞上 --update-policy pinned',
    { timeout: 60_000 },
    () => {
      const run = freshRun('reject-conflict-policy')
      const answersFile = writeAnswersFile(run.cwd, {
        ...SCAFFOLD_ONLY_ANSWERS,
        'update-policy': 'subscribed',
      })
      const result = runCli(
        ['reject-conflict-policy', ...baseRejectArgs(answersFile), POLICY_FLAG, 'pinned'],
        run,
      )

      expectRejectedBeforeWrites(result, join(run.cwd, 'reject-conflict-policy'), run.spyLog)
      expect(outputOf(result)).toMatch(/update-policy|衝突|conflict/i)
    },
  )

  it('answers-file 不是合法 JSON：拒絕', { timeout: 60_000 }, () => {
    const run = freshRun('reject-malformed')
    const answersFile = join(run.cwd, 'answers-bad.json')
    writeFileSync(answersFile, '{ "schemaVersion": 1, "answers": {')
    const result = runCli(['reject-malformed', ...baseRejectArgs(answersFile)], run)

    expectRejectedBeforeWrites(result, join(run.cwd, 'reject-malformed'), run.spyLog)
    expect(outputOf(result)).toMatch(/answers-file|JSON|json/i)
  })

  it('answers-file schemaVersion 不是 1：拒絕', { timeout: 60_000 }, () => {
    const run = freshRun('reject-schema')
    const answersFile = writeAnswersFile(run.cwd, SCAFFOLD_ONLY_ANSWERS, 2)
    const result = runCli(['reject-schema', ...baseRejectArgs(answersFile)], run)

    expectRejectedBeforeWrites(result, join(run.cwd, 'reject-schema'), run.spyLog)
    expect(outputOf(result)).toMatch(/schemaVersion|schema version|schema_version/i)
  })
})

describe('CLI process：--json 機讀完成報告', () => {
  it(
    'scaffold-only --json：stdout 恰是一個 JSON object，進度走 stderr',
    { timeout: 120_000 },
    () => {
      const run = freshRun('json-scaffold-only')
      const result = runCli(
        ['json-scaffold-only', ...ISOLATION_FLAGS, '--no-register-consumer', '--json'],
        run,
      )

      expect(result.status, outputOf(result)).toBe(0)
      // stdout 全程只有最終那一個 JSON object —— 直接對整段 stdout 解析，
      // 多一行進度／診斷都會讓 parse 失敗。
      const report = JSON.parse(result.stdout) as Record<string, unknown>
      expect(report.status).toBe('scaffolded')
      expect(report.registration).toBe('unregistered')
      // scaffold-only 不得捏造 managed policy／release
      expect(report.effectivePolicy).toBeUndefined()
      expect(report.release).toBeUndefined()
      expect(result.stderr?.length ?? 0).toBeGreaterThan(0)
    },
  )

  it(
    'managed --json：bootstrap 未回可驗證身分時降 scaffolded + BOOTSTRAP_RESULT_UNVERIFIED',
    { timeout: 120_000 },
    () => {
      const run = freshRun('json-managed')
      const result = runCli(
        [
          'json-managed',
          ...ISOLATION_FLAGS,
          ...managedExecArgs({
            registryPath: run.registryPath,
            releaseStore: run.releaseStore,
            release: '1.0.0',
          }),
          '--json',
        ],
        run,
      )

      expect(result.status, outputOf(result)).toBe(0)
      const report = JSON.parse(result.stdout) as {
        status: string
        registration: string
        diagnostics: Array<{ code: string }>
      }
      // fake clade recorder exit 0 但沒有 JSON report —— 不得宣稱 ready。
      expect(report.status).toBe('scaffolded')
      expect(report.registration).toBe('completed')
      expect(report.diagnostics.map((d) => d.code)).toContain('BOOTSTRAP_RESULT_UNVERIFIED')
    },
  )

  it(
    '拒絕情境 --json：stdout 仍是單一 JSON object，含具名 diagnostics',
    { timeout: 60_000 },
    () => {
      const run = freshRun('json-reject')
      const result = runCli(
        [
          'json-reject',
          ...ISOLATION_FLAGS,
          '--no-register-consumer',
          '--json',
          POLICY_FLAG,
          'weekly',
        ],
        run,
      )

      expect(result.status).not.toBe(0)
      const report = JSON.parse(result.stdout) as {
        status: string
        diagnostics: Array<{ code: string; message: string }>
      }
      expect(report.status).toBe('failed')
      expect(report.diagnostics[0]?.code).toBe('POLICY_INVALID')
      expect(existsSync(join(run.cwd, 'json-reject'))).toBe(false)
    },
  )
})

describe('CLI --help 與 CLADE_HOME 來源語意', () => {
  it('--help 列出 --update-policy 與 --answers-file', { timeout: 60_000 }, () => {
    const run = freshRun('help')
    const result = runCli(['--help'], run)
    expect(result.status, outputOf(result)).toBe(0)
    expect(outputOf(result)).toContain(POLICY_FLAG)
    expect(outputOf(result)).toContain(ANSWERS_FLAG)
  })

  it('CLADE_HOME 指定但來源不可用時，不得 fallback 真 home', () => {
    // 契約 § Starter CLI 與 AI 的同一可執行入口：「指定 CLADE_HOME 但該來源
    // 不可用時，不得 fallback 真 home」。fixture home 放一個「假的 fallback 位置」，
    // 若實作回落到 home candidates，會找到它 —— 依契約必須回 undefined。
    const home = mkdtempSync(join(ROOT, 'clade-fallback-home-'))
    mkdirSync(join(home, 'offline', 'clade'), { recursive: true })
    vi.stubEnv('CLADE_HOME', join(home, 'missing-clade'))
    vi.stubEnv('HOME', home)

    expect(findCladeRoot()).toBeUndefined()
  })
})
