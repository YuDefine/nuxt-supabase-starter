// clade-legacy-test: frozen=2026-09-28 — 舊測試：沒有對應 truth，不是 BDD 的慣例來源；工作碰到就吸收（clade-spec-workflow/rules/legacy-tests.md）
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { consola } from 'consola'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assembleProject } from '../src/assemble'
import {
  buildInitConsumerArgs,
  buildDeferredCodexProjectionCommand,
  buildMintGatePlaybooksArgs,
  buildRegisterConsumerArgs,
  formatGeneratedProject,
  generateManagedCodexProjection,
  maybeRegisterConsumer,
  maybeSyncVendor,
  maybeWriteConsumerMeta,
  postScaffold,
  readPendingBuildApprovals,
  resolveCladeInitScript,
  resolveSyncToCodexScript,
  resolveSupabaseDevNextSteps,
  resolveSyncToCursorScript,
  rewriteEnvFilesForDbHost,
  rewriteFirstGlanceAuthDocs,
  rewriteFirstGlanceDocsForDbHost,
  resolveEffectiveDevPort,
  rewriteGeneratedPort,
  maybeWriteRootReadme,
  stripOrphanPostMigrationHook,
} from '../src/post-scaffold'

const TEST_DIR = mkdtempSync(join(tmpdir(), 'post-scaffold-test-'))

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(join(TEST_DIR, 'scripts'), { recursive: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
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

describe('Clade consumer initialization', () => {
  it('passes the five module axes and omits --local-hooks when there are none', () => {
    expect(
      buildInitConsumerArgs('/clade/scripts/init-consumer.ts', {
        auth: 'better-auth',
        dbSchema: 'supabase',
        dbRuntime: 'cf-workers',
        runtime: 'cf-workers',
        framework: 'nuxt',
        localHooks: [],
      }),
    ).toEqual([
      '/clade/scripts/init-consumer.ts',
      '--force',
      '--no-bootstrap',
      '--auth',
      'better-auth',
      '--db-schema',
      'supabase',
      '--db-runtime',
      'cf-workers',
      '--runtime',
      'cf-workers',
      '--framework',
      'nuxt',
    ])
  })

  it('joins local hooks into one comma-separated argv element', () => {
    const args = buildInitConsumerArgs('/clade/scripts/init-consumer.ts', {
      auth: 'supabase-self-hosted',
      dbSchema: 'supabase-self-hosted',
      dbRuntime: 'supabase-self-hosted',
      runtime: 'nitro-self-hosted',
      framework: 'nuxt',
      localHooks: ['post-migration-gen-types.sh', 'another.sh'],
    })

    expect(args.slice(-2)).toEqual(['--local-hooks', 'post-migration-gen-types.sh,another.sh'])
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

  it('forwards deploy-track and db-runtime when provided', () => {
    expect(
      buildRegisterConsumerArgs(
        '/clade/scripts/register-consumer.ts',
        '/projects/<consumer-e>',
        '<client-b>/<consumer-e>',
        'trunk-based',
        'pre-production',
        3090,
        { deployTrack: 'none', dbRuntime: 'supabase-self-hosted' },
      ),
    ).toEqual([
      '/clade/scripts/register-consumer.ts',
      '--consumer',
      '/projects/<consumer-e>',
      '--repo-id',
      '<client-b>/<consumer-e>',
      '--workflow-model',
      'trunk-based',
      '--business-activity',
      'pre-production',
      '--dev-port',
      '3090',
      '--deploy-track',
      'none',
      '--db-runtime',
      'supabase-self-hosted',
    ])
  })

  it('mint gate playbooks keeps consumer-root as one argv element', () => {
    expect(
      buildMintGatePlaybooksArgs(
        '/clade/scripts/mint-gate-playbooks.ts',
        '/projects/customer portal',
        'customer-portal',
        3120,
      ),
    ).toEqual([
      '/clade/scripts/mint-gate-playbooks.ts',
      '--consumer-root',
      '/projects/customer portal',
      '--consumer',
      'customer-portal',
      '--dev-port',
      '3120',
      '--oauth-origin',
      'http://127.0.0.1:3120',
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

describe('sync-to-codex 解析', () => {
  it('使用 clade 的 canonical wrapper，不依賴已退役的 user shim', () => {
    const cladeRoot = join(TEST_DIR, 'clade')
    const script = join(cladeRoot, 'scripts', 'run-sync-to-codex.ts')
    writeFileSync(join(TEST_DIR, 'scripts', 'sync-to-codex.ts'), '')
    mkdirSync(join(cladeRoot, 'scripts'), { recursive: true })
    writeFileSync(script, '')

    expect(resolveSyncToCodexScript(cladeRoot)).toBe(script)
  })

  it('managed install 使用 canonical wrapper，且必須產出 Codex config 與 skill', () => {
    const cladeRoot = join(TEST_DIR, 'clade')
    const target = join(TEST_DIR, 'generated')
    const script = join(cladeRoot, 'scripts', 'run-sync-to-codex.ts')
    mkdirSync(join(cladeRoot, 'scripts'), { recursive: true })
    mkdirSync(target, { recursive: true })
    writeFileSync(
      script,
      [
        "const fs = require('node:fs')",
        "const path = require('node:path')",
        "if (!process.argv.includes('--no-health-check')) process.exit(2)",
        "fs.mkdirSync(path.join(process.cwd(), '.codex'), { recursive: true })",
        "fs.mkdirSync(path.join(process.cwd(), '.agents', 'skills', 'commit'), { recursive: true })",
        "fs.writeFileSync(path.join(process.cwd(), '.codex', 'config.toml'), 'includeGitInstructions = false\\n')",
        "fs.writeFileSync(path.join(process.cwd(), '.agents', 'skills', 'commit', 'SKILL.md'), '# commit\\n')",
      ].join('\n'),
    )

    expect(() => generateManagedCodexProjection(target, cladeRoot)).not.toThrow()
    expect(existsSync(join(target, '.codex', 'config.toml'))).toBe(true)
    expect(existsSync(join(target, '.agents', 'skills', 'commit', 'SKILL.md'))).toBe(true)
  })

  it('canonical wrapper exit 0 但沒有投影時拒絕宣稱完成', () => {
    const cladeRoot = join(TEST_DIR, 'clade')
    const target = join(TEST_DIR, 'missing-output')
    mkdirSync(join(cladeRoot, 'scripts'), { recursive: true })
    mkdirSync(target, { recursive: true })
    writeFileSync(join(cladeRoot, 'scripts', 'run-sync-to-codex.ts'), '')

    expect(() => generateManagedCodexProjection(target, cladeRoot)).toThrow('Codex 投影失敗')
  })

  it('deferred 指令包含本地 Clade 初始化與投影入口', () => {
    const cladeRoot = join(TEST_DIR, 'clade')
    const target = join(TEST_DIR, "user's project")
    const modules = {
      auth: 'none' as const,
      dbSchema: 'supabase' as const,
      dbRuntime: 'cf-workers' as const,
      runtime: 'cf-workers' as const,
      framework: 'nuxt' as const,
      localHooks: [],
    }
    mkdirSync(target, { recursive: true })
    const command = buildDeferredCodexProjectionCommand(target, cladeRoot, modules)

    expect(command).toContain("cd '" + target.replaceAll("'", "'\"'\"'") + "'")
    expect(command).toContain('init-consumer.ts')
    expect(command).toContain('pnpm install')
    expect(command).toContain('bootstrap-hub.ts')
    expect(command).toContain('run-sync-to-codex.ts')
    expect(command).toContain('--no-health-check')
  })

  it.each([
    { scripts: ['init-consumer.mjs'], expected: 'init-consumer.mjs' },
    { scripts: ['init-consumer.ts', 'init-consumer.mjs'], expected: 'init-consumer.ts' },
  ])('deferred 指令解析本地 Clade initializer：$expected', ({ scripts, expected }) => {
    const cladeRoot = join(TEST_DIR, 'clade')
    const target = join(TEST_DIR, 'deferred-project')
    mkdirSync(join(cladeRoot, 'scripts'), { recursive: true })
    for (const script of scripts) {
      writeFileSync(join(cladeRoot, 'scripts', script), '')
    }

    const command = buildDeferredCodexProjectionCommand(target, cladeRoot, {
      auth: 'none',
      dbSchema: 'supabase',
      dbRuntime: 'cf-workers',
      runtime: 'cf-workers',
      framework: 'nuxt',
      localHooks: [],
    })

    expect(command).toContain(`node '${join(cladeRoot, 'scripts', expected)}'`)
    expect(command).not.toContain('git clone')
  })

  it('managed scaffold 安裝成功後執行 canonical wrapper 並回報 generated', async () => {
    const cladeRoot = join(TEST_DIR, 'clade')
    const binDir = join(TEST_DIR, 'bin')
    const target = join(TEST_DIR, 'managed-project')
    const modules = {
      auth: 'none' as const,
      dbSchema: 'supabase' as const,
      dbRuntime: 'cf-workers' as const,
      runtime: 'cf-workers' as const,
      framework: 'nuxt' as const,
      localHooks: [],
    }
    mkdirSync(join(cladeRoot, 'scripts'), { recursive: true })
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'pnpm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    writeFileSync(join(cladeRoot, 'scripts', 'init-consumer.ts'), '')
    writeFileSync(
      join(cladeRoot, 'scripts', 'bootstrap-project.ts'),
      "process.stdout.write(JSON.stringify({ consumerId: 'managed-project', effectivePolicy: 'pinned', release: '1.0.0' }))",
    )
    writeFileSync(
      join(cladeRoot, 'scripts', 'run-sync-to-codex.ts'),
      [
        "const fs = require('node:fs')",
        "const path = require('node:path')",
        "fs.mkdirSync(path.join(process.cwd(), '.codex'), { recursive: true })",
        "fs.mkdirSync(path.join(process.cwd(), '.agents', 'skills', 'commit'), { recursive: true })",
        "fs.writeFileSync(path.join(process.cwd(), '.codex', 'config.toml'), 'includeGitInstructions = false\\n')",
        "fs.writeFileSync(path.join(process.cwd(), '.agents', 'skills', 'commit', 'SKILL.md'), '# commit\\n')",
      ].join('\n'),
    )
    vi.stubEnv('CLADE_HOME', cladeRoot)
    vi.stubEnv('PATH', `${binDir}:${process.env.PATH}`)
    assembleProject(target, [], 'managed-project', ['codex'])

    const outcome = await postScaffold(target, 'managed-project', TEST_DIR, modules, {
      yes: true,
      registerConsumer: true,
      wirePreCommit: false,
      cloneClade: false,
      installDeps: true,
      repoId: 'fixture/managed-project',
      devPort: 3010,
      agentTargets: ['codex'],
      offline: true,
      noPush: true,
      json: true,
    })

    expect(outcome.managed?.ok).toBe(true)
    expect(outcome.codexProjection).toEqual({ status: 'generated' })
    expect(existsSync(join(target, '.codex', 'config.toml'))).toBe(true)
    expect(existsSync(join(target, '.agents', 'skills', 'commit', 'SKILL.md'))).toBe(true)
  })

  const managedCodexModules = {
    auth: 'none' as const,
    dbSchema: 'supabase' as const,
    dbRuntime: 'cf-workers' as const,
    runtime: 'cf-workers' as const,
    framework: 'nuxt' as const,
    localHooks: [],
  }
  const managedCodexOpts = {
    yes: true,
    registerConsumer: true,
    wirePreCommit: false,
    cloneClade: false,
    installDeps: true,
    repoId: 'fixture/managed-project',
    devPort: 3010,
    agentTargets: ['codex' as const],
    offline: true,
    noPush: true,
    json: true,
  }

  it('--dev-port auto：產出檔用 bootstrap 回報的實際登記號，不留 template 的 3000', async () => {
    const cladeRoot = join(TEST_DIR, 'clade')
    const binDir = join(TEST_DIR, 'bin')
    const target = join(TEST_DIR, 'auto-port-project')
    mkdirSync(join(cladeRoot, 'scripts'), { recursive: true })
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'pnpm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    writeFileSync(join(cladeRoot, 'scripts', 'init-consumer.ts'), '')
    // stub 模擬 clade ready JSON 的 devPort 欄位（契約 SoT：clade
    // specs/truth/contracts/consumer-update-policy.md，YuDefine/clade#825）；真 clade 的配號
    // 由 clade 端 test/managed-dev-port-auto.test.ts 驗。只有 argv 真的帶 `--dev-port auto`
    // 時才回報配到的號，順便釘住 argv 形狀。
    writeFileSync(
      join(cladeRoot, 'scripts', 'bootstrap-project.ts'),
      [
        "const i = process.argv.indexOf('--dev-port')",
        "const devPort = process.argv[i + 1] === 'auto' ? 3070 : null",
        "process.stdout.write(JSON.stringify({ consumerId: 'auto-port-project', effectivePolicy: 'pinned', release: '1.0.0', devPort }))",
      ].join('\n'),
    )
    vi.stubEnv('CLADE_HOME', cladeRoot)
    vi.stubEnv('PATH', `${binDir}:${process.env.PATH}`)
    assembleProject(target, [], 'auto-port-project', ['claude-code'])

    const outcome = await postScaffold(target, 'auto-port-project', TEST_DIR, managedCodexModules, {
      ...managedCodexOpts,
      repoId: 'fixture/auto-port-project',
      devPort: 'auto',
      agentTargets: ['claude-code'],
    })

    expect(outcome.managed?.ok).toBe(true)
    expect(outcome.managed?.report?.devPort).toBe(3070)
    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts.dev).toMatch(/--port 3070\b/)
  })

  it('clade 不可用時 codex 投影回報 deferred，不中止 scaffold', async () => {
    const binDir = join(TEST_DIR, 'bin')
    const target = join(TEST_DIR, 'no-clade-project')
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'pnpm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    vi.stubEnv('CLADE_HOME', join(TEST_DIR, 'missing-clade'))
    vi.stubEnv('PATH', `${binDir}:${process.env.PATH}`)
    assembleProject(target, [], 'no-clade-project', ['codex'])

    const outcome = await postScaffold(
      target,
      'no-clade-project',
      TEST_DIR,
      managedCodexModules,
      managedCodexOpts,
    )

    expect(outcome.managed?.ran).toBe(false)
    expect(outcome.managed?.diagnostics[0]?.code).toBe('ASSET_UNAVAILABLE')
    expect(outcome.codexProjection).toMatchObject({
      status: 'deferred',
      reason: 'clade_unavailable',
    })
  })

  it('managed bootstrap 失敗且投影沒產出時回報 deferred，保留 bootstrap diagnostics', async () => {
    const cladeRoot = join(TEST_DIR, 'clade')
    const binDir = join(TEST_DIR, 'bin')
    const target = join(TEST_DIR, 'bootstrap-failed-project')
    mkdirSync(join(cladeRoot, 'scripts'), { recursive: true })
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'pnpm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    writeFileSync(join(cladeRoot, 'scripts', 'init-consumer.ts'), '')
    writeFileSync(join(cladeRoot, 'scripts', 'bootstrap-project.ts'), 'process.exit(1)')
    writeFileSync(join(cladeRoot, 'scripts', 'run-sync-to-codex.ts'), 'process.exit(1)')
    vi.stubEnv('CLADE_HOME', cladeRoot)
    vi.stubEnv('PATH', `${binDir}:${process.env.PATH}`)
    assembleProject(target, [], 'bootstrap-failed-project', ['codex'])

    const outcome = await postScaffold(
      target,
      'bootstrap-failed-project',
      TEST_DIR,
      managedCodexModules,
      managedCodexOpts,
    )

    expect(outcome.managed?.ok).toBe(false)
    expect(outcome.managed?.ran).toBe(true)
    expect(outcome.codexProjection).toMatchObject({
      status: 'deferred',
      reason: 'managed_bootstrap_incomplete',
    })
  })
})

describe('sync-to-cursor 解析', () => {
  // Cursor 仍沿用 user shim；舊 sync-to-agents → sync-to-codex 改名曾讓 scaffold 靜默
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

describe('consumer-meta 寫入', () => {
  it('clade 還沒有 script 時略過、不炸', () => {
    const cladeRoot = mkdtempSync(join(tmpdir(), 'meta-clade-missing-'))
    const targetDir = mkdtempSync(join(tmpdir(), 'meta-target-missing-'))
    expect(maybeWriteConsumerMeta(cladeRoot, targetDir)).toBe(false)
  })

  it('在目標 repo 的 cwd 以 --write --force 呼叫', () => {
    const cladeRoot = mkdtempSync(join(tmpdir(), 'meta-clade-'))
    const targetDir = mkdtempSync(join(tmpdir(), 'meta-target-'))
    mkdirSync(join(cladeRoot, 'scripts'), { recursive: true })
    writeFileSync(
      join(cladeRoot, 'scripts', 'scaffold-consumer-meta.ts'),
      [
        "const { writeFileSync } = require('node:fs')",
        "const { join } = require('node:path')",
        'writeFileSync(join(process.cwd(), "meta-invocation.json"), JSON.stringify({',
        '  cwd: process.cwd(),',
        '  argv: process.argv.slice(2),',
        '}))',
        '',
      ].join('\n'),
    )
    execFileSync('git', ['init'], { cwd: targetDir, stdio: 'pipe' })

    expect(maybeWriteConsumerMeta(cladeRoot, targetDir)).toBe(true)
    const invocation = JSON.parse(readFileSync(join(targetDir, 'meta-invocation.json'), 'utf-8'))
    expect(invocation.cwd).toBe(targetDir)
    expect(invocation.argv).toEqual([targetDir, '--write', '--force'])
  })
})

describe('vendor 投影', () => {
  it('clade 還沒有 sync-vendor 時略過、不炸', () => {
    const cladeRoot = mkdtempSync(join(tmpdir(), 'vendor-clade-missing-'))
    const targetDir = mkdtempSync(join(tmpdir(), 'vendor-target-missing-'))
    expect(maybeSyncVendor(cladeRoot, targetDir)).toBe(false)
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

  it('instructions 使用 flow 入口，不在空專案呼叫需要 work id 的子命令', () => {
    const marker = readMarkerFn()
    expect(marker).toContain('pnpm flow who')
    expect(marker).toContain('specs/plans/')
    expect(marker).not.toMatch(/opsx|pnpm spectra:|\/spectra-/)
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

  it('initial commit 設 HUSKY=0，避免剛 wire 的 hook 擋 bootstrap commit', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'post-scaffold.ts'), 'utf-8')
    expect(src).toContain("HUSKY: '0'")
  })
})

describe('resolveSupabaseDevNextSteps', () => {
  it('existing-server 連既有伺服器，不要本機 setup', () => {
    const lines = resolveSupabaseDevNextSteps({ dbHost: 'existing-server' })
    expect(lines.join('\n')).toContain('不要在這台電腦再起一份')
    expect(lines.join('\n')).not.toContain('pnpm run setup')
  })

  it('this-machine 走本機 setup', () => {
    const lines = resolveSupabaseDevNextSteps({
      dbHost: 'this-machine',
      dbRuntime: 'supabase-self-hosted',
    })
    expect(lines.join('\n')).toContain('pnpm run setup')
    expect(lines.join('\n')).not.toContain('playbooks/01')
  })
})

describe('rewriteEnvFilesForDbHost', () => {
  it('existing-server 清掉本機 Docker 預設值', () => {
    const dir = join(TEST_DIR, 'env-host')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, '.env.example'),
      '# --- Supabase ---\nSUPABASE_URL=http://127.0.0.1:54321\nDATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres\nNUXT_PUBLIC_SITE_URL=http://localhost:3000\n',
    )
    writeFileSync(
      join(dir, '.env.test'),
      'SUPABASE_URL=http://127.0.0.1:54321\nDATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres\n',
    )
    rewriteEnvFilesForDbHost(dir, 'existing-server', 3090)
    const example = readFileSync(join(dir, '.env.example'), 'utf8')
    expect(example).not.toContain('127.0.0.1:54321')
    expect(example).toContain('不要填本機 Docker')
    expect(example).toContain('http://localhost:3090')
    const envTest = readFileSync(join(dir, '.env.test'), 'utf8')
    expect(envTest).not.toContain('127.0.0.1:54321')
    expect(envTest).not.toContain('127.0.0.1:54322')
    expect(envTest).toContain('不要填本機 Docker')
  })

  it('existing-server 的 .gitignore 放行 .env.test', () => {
    const dir = join(TEST_DIR, 'env-gitignore')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.gitignore'), '.env\n.env.*\n!.env.example\n')
    rewriteEnvFilesForDbHost(dir, 'existing-server')
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('!.env.test')
  })
})

describe('rewriteFirstGlanceDocsForDbHost', () => {
  it('existing-server 的 QUICK_START 不再叫人 supabase start', () => {
    const dir = join(TEST_DIR, 'docs-host')
    mkdirSync(join(dir, 'docs', 'verify'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'verify', 'QUICK_START.md'),
      readFileSync(join(import.meta.dirname, '../../../docs/verify/QUICK_START.md'), 'utf8'),
    )
    writeFileSync(
      join(dir, 'docs', 'NEW_PROJECT_CHECKLIST.md'),
      readFileSync(join(import.meta.dirname, '../../../docs/NEW_PROJECT_CHECKLIST.md'), 'utf8'),
    )
    writeFileSync(
      join(dir, 'docs', 'verify', 'ENVIRONMENT_VARIABLES.md'),
      readFileSync(
        join(import.meta.dirname, '../../../docs/verify/ENVIRONMENT_VARIABLES.md'),
        'utf8',
      ),
    )
    writeFileSync(
      join(dir, 'docs', 'TROUBLESHOOTING.md'),
      readFileSync(join(import.meta.dirname, '../../../docs/TROUBLESHOOTING.md'), 'utf8'),
    )
    writeFileSync(
      join(dir, 'docs', 'verify', 'README.md'),
      readFileSync(join(import.meta.dirname, '../../../docs/verify/README.md'), 'utf8'),
    )
    writeFileSync(
      join(dir, 'docs', 'verify', 'SUPABASE_MIGRATION_GUIDE.md'),
      readFileSync(
        join(import.meta.dirname, '../../../docs/verify/SUPABASE_MIGRATION_GUIDE.md'),
        'utf8',
      ),
    )
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'docs-host', dependencies: { 'nuxt-auth-utils': '0.5.30' } }),
    )
    writeFileSync(
      join(dir, 'CLAUDE.md'),
      '```bash\nsupabase db reset    # Reset + apply all migrations\n```\n- After migration: `supabase db reset` → `db lint` → `gen types` → `typecheck`\n| Migration created  | `db reset` → `db lint` → `gen types` → `typecheck` |\n',
    )
    writeFileSync(
      join(dir, 'docs', 'verify', 'DATABASE_OPTIMIZATION.md'),
      readFileSync(
        join(import.meta.dirname, '../../../docs/verify/DATABASE_OPTIMIZATION.md'),
        'utf8',
      ),
    )
    writeFileSync(
      join(dir, 'docs', 'verify', 'SELF_HOSTED_SUPABASE.md'),
      readFileSync(
        join(import.meta.dirname, '../../../docs/verify/SELF_HOSTED_SUPABASE.md'),
        'utf8',
      ),
    )
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          'codebase-memory-mcp': { command: 'codebase-memory-mcp' },
          'local-supabase': { type: 'http', url: 'http://localhost:54321/mcp' },
        },
      }),
    )
    mkdirSync(join(dir, '.cursor'), { recursive: true })
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(
      join(dir, '.cursor', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          'local-supabase': { type: 'http', url: 'http://localhost:54321/mcp' },
        },
      }),
    )
    writeFileSync(
      join(dir, '.claude', 'settings.json'),
      JSON.stringify({
        enabledMcpjsonServers: ['local-supabase'],
        permissions: { allow: ['mcp__local-supabase__list_tables', 'Bash(ls:*)'] },
        hooks: {
          PostToolUse: [
            { matcher: 'mcp__local-supabase__apply_migration', hooks: [] },
            { matcher: 'Edit|Write', hooks: [] },
          ],
        },
      }),
    )
    rewriteFirstGlanceDocsForDbHost(dir, 'existing-server', 3090)
    rewriteFirstGlanceAuthDocs(dir)
    const quick = readFileSync(join(dir, 'docs', 'verify', 'QUICK_START.md'), 'utf8')
    expect(quick).not.toMatch(/```bash\nsupabase start/)
    expect(quick).toContain('01-dev-database.md')
    expect(quick).toContain('localhost:3090')
    expect(quick).not.toContain('localhost:3000')
    const checklist = readFileSync(join(dir, 'docs', 'NEW_PROJECT_CHECKLIST.md'), 'utf8')
    expect(checklist).not.toContain('supabase stop && supabase start')
    expect(checklist).toContain(
      '完整教學**：先看 [QUICK_START](verify/QUICK_START.md) 與 `docs/playbooks/01-dev-database.md`，再用 `/specify` 建立第一個需求',
    )
    expect(checklist).toContain('localhost:3090')
    expect(checklist).not.toContain('localhost:3000')
    const envVars = readFileSync(join(dir, 'docs', 'verify', 'ENVIRONMENT_VARIABLES.md'), 'utf8')
    expect(envVars).not.toContain('127.0.0.1:54321')
    expect(envVars).toContain('01-dev-database.md')
    expect(envVars).toContain('localhost:3090')
    const troubleshooting = readFileSync(join(dir, 'docs', 'TROUBLESHOOTING.md'), 'utf8')
    expect(troubleshooting).toContain('01-dev-database.md')
    expect(troubleshooting).toContain('NEVER')
    const verifyReadme = readFileSync(join(dir, 'docs', 'verify', 'README.md'), 'utf8')
    expect(verifyReadme).not.toContain('../FAQ.md')
    expect(verifyReadme).not.toContain('@nuxtjs/better-auth')
    expect(verifyReadme).toContain('nuxt-auth-utils')
    expect(verifyReadme).not.toContain('Local-First')
    const migration = readFileSync(
      join(dir, 'docs', 'verify', 'SUPABASE_MIGRATION_GUIDE.md'),
      'utf8',
    )
    expect(migration).not.toContain('supabase gen types typescript --local')
    expect(migration).toContain('NEVER')
    expect(migration).not.toMatch(/^supabase db reset$/m)
    expect(verifyReadme).not.toContain('務必附上 `supabase db reset` 可成功的證明')
    const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf8')
    expect(claude).not.toContain('supabase db reset    # Reset + apply all migrations')
    expect(claude).not.toMatch(/\| Migration created\s+\|\s+`db reset`/)
    expect(claude).toContain('NEVER 本機 db reset')
    const dbOpt = readFileSync(join(dir, 'docs', 'verify', 'DATABASE_OPTIMIZATION.md'), 'utf8')
    expect(dbOpt).not.toContain('supabase gen types typescript --local')
    const selfHosted = readFileSync(join(dir, 'docs', 'verify', 'SELF_HOSTED_SUPABASE.md'), 'utf8')
    expect(selfHosted).not.toContain('# 3. 本地測試\nsupabase db reset')
    expect(selfHosted).not.toContain('http://localhost:54321/mcp')
    const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8')) as {
      mcpServers?: Record<string, unknown>
    }
    expect(mcp.mcpServers?.['local-supabase']).toBeUndefined()
    expect(JSON.stringify(mcp)).not.toContain('localhost:54321')
    const cursorMcp = JSON.parse(readFileSync(join(dir, '.cursor', 'mcp.json'), 'utf8')) as {
      mcpServers?: Record<string, unknown>
    }
    expect(cursorMcp.mcpServers?.['local-supabase']).toBeUndefined()
    expect(cursorMcp.mcpServers?.['codebase-memory-mcp']).toEqual({
      command: 'codebase-memory-mcp',
    })
    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')) as {
      enabledMcpjsonServers?: string[]
      permissions?: { allow?: string[] }
      hooks?: { PostToolUse?: Array<{ matcher?: string }> }
    }
    expect(settings.enabledMcpjsonServers ?? []).not.toContain('local-supabase')
    expect(settings.permissions?.allow).toEqual(['Bash(ls:*)'])
    expect(settings.hooks?.PostToolUse?.map((item) => item.matcher)).toEqual(['Edit|Write'])
    mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true })
    mkdirSync(join(dir, '.codex', 'hooks'), { recursive: true })
    writeFileSync(
      join(dir, '.claude', 'hooks', 'post-migration-gen-types.sh'),
      '#!/bin/bash\n# 觸發條件: mcp__local-supabase__apply_migration 完成後\npnpm db:types\n',
    )
    writeFileSync(
      join(dir, '.codex', 'hooks', 'post-migration-gen-types.sh'),
      '#!/bin/bash\n# 觸發條件: mcp__local-supabase__apply_migration 完成後\npnpm db:types\n',
    )
    writeFileSync(
      join(dir, '.claude', 'hub.json'),
      JSON.stringify({ localHooks: ['post-migration-gen-types.sh'] }),
    )
    writeFileSync(
      join(dir, '.codex', 'config.toml'),
      'includeGitInstructions = false\nenabledMcpjsonServers = ["local-supabase", "chrome-devtools-mcp"]\n\n[enabledPlugins]\n"hub-runtime-cf-workers@clade" = true\n',
    )
    writeFileSync(
      join(dir, '.codex', 'hooks.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [{ matcher: 'mcp__local-supabase__apply_migration', hooks: [] }],
        },
      }),
    )
    writeFileSync(
      join(dir, '.cursor', 'cli.json'),
      JSON.stringify({
        permissions: { allow: ['Mcp(local-supabase:list_tables)', 'Shell(ls)'] },
      }),
    )
    rewriteFirstGlanceDocsForDbHost(dir, 'existing-server', 3090)
    const codexConfig = readFileSync(join(dir, '.codex', 'config.toml'), 'utf8')
    expect(codexConfig).not.toContain('local-supabase')
    expect(codexConfig).toContain('chrome-devtools-mcp')
    const codexHooks = JSON.parse(readFileSync(join(dir, '.codex', 'hooks.json'), 'utf8')) as {
      hooks?: { PostToolUse?: Array<{ matcher?: string }> }
    }
    expect(codexHooks.hooks?.PostToolUse ?? []).toEqual([])
    const cursorCli = JSON.parse(readFileSync(join(dir, '.cursor', 'cli.json'), 'utf8')) as {
      permissions?: { allow?: string[] }
    }
    expect(cursorCli.permissions?.allow).toEqual(['Shell(ls)'])
    expect(existsSync(join(dir, '.claude', 'hooks', 'post-migration-gen-types.sh'))).toBe(false)
    expect(existsSync(join(dir, '.codex', 'hooks', 'post-migration-gen-types.sh'))).toBe(false)
    const hub = JSON.parse(readFileSync(join(dir, '.claude', 'hub.json'), 'utf8')) as {
      localHooks?: string[]
    }
    expect(hub.localHooks ?? []).not.toContain('post-migration-gen-types.sh')
    expect(checklist).not.toContain('WORKFLOW.md')
    expect(checklist).not.toContain('DEV_RECIPES.md')
    expect(checklist).toContain('verify/QUICK_START.md')
  })

  it('this-machine 不刪 post-migration hook', () => {
    const dir = join(TEST_DIR, 'hook-keep')
    mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true })
    mkdirSync(join(dir, '.codex', 'hooks'), { recursive: true })
    const claudeHook = join(dir, '.claude', 'hooks', 'post-migration-gen-types.sh')
    const codexHook = join(dir, '.codex', 'hooks', 'post-migration-gen-types.sh')
    writeFileSync(claudeHook, '#!/bin/bash\n')
    writeFileSync(codexHook, '#!/bin/bash\n')
    stripOrphanPostMigrationHook(dir, 'this-machine')
    expect(existsSync(claudeHook)).toBe(true)
    expect(existsSync(codexHook)).toBe(true)
  })

  it('existing-server 的 e2e.yml / config.toml 標明本機不要 supabase start', () => {
    const dir = join(TEST_DIR, 'workflow-host')
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    mkdirSync(join(dir, 'supabase'), { recursive: true })
    writeFileSync(
      join(dir, '.github', 'workflows', 'e2e.yml'),
      '# Advanced E2E\nname: E2E Tests\n\njobs:\n  e2e:\n    steps:\n      - run: supabase start\n',
    )
    writeFileSync(
      join(dir, '.github', 'workflows', 'ci.yml'),
      '# 並把 runs-on 改成 self-hosted，同時移除 supabase start 步驟\nname: CI\n',
    )
    writeFileSync(join(dir, 'supabase', 'config.toml'), '[api]\nport = 54321\n')
    rewriteFirstGlanceDocsForDbHost(dir, 'existing-server')
    const e2e = readFileSync(join(dir, '.github', 'workflows', 'e2e.yml'), 'utf8')
    expect(e2e).toContain('supabase start')
    expect(e2e).toContain('本機 NEVER supabase start')
    const ci = readFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'utf8')
    expect(ci).toContain('本機 NEVER supabase start')
    const config = readFileSync(join(dir, 'supabase', 'config.toml'), 'utf8')
    expect(config).toContain('port = 54321')
    expect(config).toContain('本機 NEVER supabase start')
  })
})

describe('rewriteFirstGlanceAuthDocs', () => {
  it('nuxt-auth-utils 時 SCREENSHOT_GUIDE 與 ENVIRONMENT_VARIABLES 不再寫 better-auth', () => {
    const dir = join(TEST_DIR, 'auth-docs')
    mkdirSync(join(dir, 'docs', 'verify'), { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'auth-docs', dependencies: { 'nuxt-auth-utils': '0.5.30' } }),
    )
    writeFileSync(
      join(dir, 'docs', 'verify', 'SCREENSHOT_GUIDE.md'),
      readFileSync(join(import.meta.dirname, '../../../docs/verify/SCREENSHOT_GUIDE.md'), 'utf8'),
    )
    writeFileSync(
      join(dir, 'docs', 'verify', 'ENVIRONMENT_VARIABLES.md'),
      readFileSync(
        join(import.meta.dirname, '../../../docs/verify/ENVIRONMENT_VARIABLES.md'),
        'utf8',
      ),
    )
    writeFileSync(
      join(dir, 'docs', 'verify', 'README.md'),
      readFileSync(join(import.meta.dirname, '../../../docs/verify/README.md'), 'utf8'),
    )
    writeFileSync(
      join(dir, 'docs', 'verify', 'AUTH_INTEGRATION.md'),
      readFileSync(join(import.meta.dirname, '../../../docs/verify/AUTH_INTEGRATION.md'), 'utf8'),
    )
    writeFileSync(
      join(dir, 'docs', 'NEW_PROJECT_CHECKLIST.md'),
      readFileSync(join(import.meta.dirname, '../../../docs/NEW_PROJECT_CHECKLIST.md'), 'utf8'),
    )
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(
      join(dir, 'scripts', 'check-skills.sh'),
      readFileSync(join(import.meta.dirname, '../../../scripts/check-skills.sh'), 'utf8'),
    )
    writeFileSync(
      join(dir, 'SECURITY.md'),
      readFileSync(join(import.meta.dirname, '../../../SECURITY.md'), 'utf8'),
    )
    rewriteFirstGlanceAuthDocs(dir)
    const screenshot = readFileSync(join(dir, 'docs', 'verify', 'SCREENSHOT_GUIDE.md'), 'utf8')
    expect(screenshot).toContain('本專案使用 nuxt-auth-utils')
    expect(screenshot).toContain('Google OAuth')
    expect(screenshot).not.toContain('支援 email/password 登入')
    const envVars = readFileSync(join(dir, 'docs', 'verify', 'ENVIRONMENT_VARIABLES.md'), 'utf8')
    expect(envVars).toContain('本系統使用 **nuxt-auth-utils**')
    expect(envVars).not.toContain('本系統使用 **@nuxtjs/better-auth**')
    const verifyReadme = readFileSync(join(dir, 'docs', 'verify', 'README.md'), 'utf8')
    expect(verifyReadme).not.toContain('@nuxtjs/better-auth')
    const authIntegration = readFileSync(join(dir, 'docs', 'verify', 'AUTH_INTEGRATION.md'), 'utf8')
    expect(authIntegration).toContain('本專案已選 **nuxt-auth-utils**')
    expect(authIntegration).not.toContain('建立專案時二擇一')
    expect(authIntegration).not.toContain('**better-auth 額外檔案：**')
    expect(authIntegration).toContain('另一方案（本專案未採用）')
    const checklist = readFileSync(join(dir, 'docs', 'NEW_PROJECT_CHECKLIST.md'), 'utf8')
    expect(checklist).not.toContain('nuxt-better-auth')
    expect(checklist).not.toContain('如選了 better-auth')
    expect(checklist).toContain('nuxt-auth-utils')
    const checkSkills = readFileSync(join(dir, 'scripts', 'check-skills.sh'), 'utf8')
    expect(checkSkills).not.toContain('nuxt-better-auth')
    expect(checkSkills).toContain('nuxt-auth-utils')
    const securityMd = readFileSync(join(dir, 'SECURITY.md'), 'utf8')
    expect(securityMd).not.toContain('Better Auth')
    expect(securityMd).not.toContain('login.post.ts')
    expect(securityMd).not.toContain('BETTER_AUTH_SECRET')
    expect(securityMd).toContain('nuxt-auth-utils')
    expect(securityMd).toContain('_dev-login.get.ts')
  })
})

describe('maybeWriteRootReadme', () => {
  it('缺 README 時寫一份，且 existing-server 不叫 supabase start', () => {
    const dir = join(TEST_DIR, 'readme-host')
    mkdirSync(dir, { recursive: true })
    maybeWriteRootReadme(dir, '<consumer-e>', 'existing-server')
    const readme = readFileSync(join(dir, 'README.md'), 'utf8')
    expect(readme).toContain('# <consumer-e>')
    expect(readme).not.toMatch(/```bash[\s\S]*supabase start/)
    expect(readme).toContain('NEVER')
    expect(readme).toContain('01-dev-database.md')
    maybeWriteRootReadme(dir, 'OTHER', 'existing-server')
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('# <consumer-e>')
  })
})

describe('rewriteGeneratedPort', () => {
  it('OAuth 與 Playwright 對齊 --dev-port', () => {
    const dir = join(TEST_DIR, 'port-host')
    mkdirSync(join(dir, 'docs', 'verify'), { recursive: true })
    writeFileSync(
      join(dir, 'docs', 'verify', 'OAUTH_SETUP.md'),
      '| 本地開發   | `http://localhost:3000/auth/google` |\n- 本地開發使用 `http://localhost:3000`\n',
    )
    writeFileSync(
      join(dir, 'docs', 'verify', 'SCREENSHOT_GUIDE.md'),
      '- Dev server 運行中（預設 port 3000）\n',
    )
    writeFileSync(
      join(dir, 'playwright.config.ts'),
      "baseURL: 'http://localhost:3000',\n    port: 3000,\n",
    )
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'port-host', scripts: { dev: 'nuxt dev --dotenv .env -o' } }),
    )
    rewriteGeneratedPort(dir, 3090)
    const oauth = readFileSync(join(dir, 'docs', 'verify', 'OAUTH_SETUP.md'), 'utf8')
    expect(oauth).toContain('localhost:3090')
    expect(oauth).not.toContain('localhost:3000')
    const screenshot = readFileSync(join(dir, 'docs', 'verify', 'SCREENSHOT_GUIDE.md'), 'utf8')
    expect(screenshot).toContain('預設 port 3090')
    expect(screenshot).not.toContain('預設 port 3000')
    const playwright = readFileSync(join(dir, 'playwright.config.ts'), 'utf8')
    expect(playwright).toContain('http://localhost:3090')
    expect(playwright).toContain('port: 3090')
    expect(playwright).not.toContain('port: 3000')
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      scripts?: { dev?: string }
    }
    expect(pkg.scripts?.dev).toContain('--port 3090')
    expect(pkg.scripts?.dev).toContain('nuxt dev --dotenv .env -o')
  })
})

describe('final scaffold formatting', () => {
  it('does not invoke a formatter when quality was not selected', () => {
    writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({ scripts: {} }))
    expect(() => formatGeneratedProject(TEST_DIR)).not.toThrow()
  })

  it('propagates formatting failure rather than committing an unverified scaffold', () => {
    writeFileSync(
      join(TEST_DIR, 'package.json'),
      JSON.stringify({
        scripts: {
          format: 'node -e "process.exit(23)"',
          'format:check': 'node -e "process.exit(0)"',
        },
      }),
    )
    expect(() => formatGeneratedProject(TEST_DIR)).toThrow()
  })
})

describe('resolveEffectiveDevPort', () => {
  const ok = (report?: Record<string, unknown>) => ({
    ran: true,
    ok: true,
    report,
    diagnostics: [],
  })
  it('明確給號直接用，不看 bootstrap 回報', () => {
    expect(resolveEffectiveDevPort(3090, ok({ devPort: 3070 }))).toBe(3090)
  })
  it('auto 用 bootstrap 回報的整數號', () => {
    expect(resolveEffectiveDevPort('auto', ok({ devPort: 3070 }))).toBe(3070)
  })
  it('auto 但舊版 clade 沒回報、回報非 1–65535 整數、或 bootstrap 失敗時不改寫', () => {
    expect(resolveEffectiveDevPort('auto', ok({}))).toBeUndefined()
    expect(resolveEffectiveDevPort('auto', ok({ devPort: null }))).toBeUndefined()
    expect(resolveEffectiveDevPort('auto', ok({ devPort: '3070' }))).toBeUndefined()
    expect(resolveEffectiveDevPort('auto', ok({ devPort: 0 }))).toBeUndefined()
    expect(resolveEffectiveDevPort('auto', ok({ devPort: -1 }))).toBeUndefined()
    expect(resolveEffectiveDevPort('auto', ok({ devPort: 65536 }))).toBeUndefined()
    expect(
      resolveEffectiveDevPort('auto', {
        ran: true,
        ok: false,
        report: { devPort: 3070 },
        diagnostics: [],
      }),
    ).toBeUndefined()
    expect(resolveEffectiveDevPort('auto', undefined)).toBeUndefined()
    expect(resolveEffectiveDevPort(undefined, ok({ devPort: 3070 }))).toBeUndefined()
  })
})
