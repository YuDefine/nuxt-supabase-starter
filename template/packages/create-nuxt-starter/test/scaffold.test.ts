import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleProject } from '../src/assemble'
import { getDefaultSelections } from '../src/prompts'
import { resolveFeatureDependencies } from '../src/features'
import { buildSelectionsFromArgs } from '../src/cli'

const TEST_DIR = mkdtempSync(join(tmpdir(), 'scaffold-test-'))

function cleanTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

function writeText(path: string, value: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, value)
}

beforeEach(() => cleanTestDir())
afterEach(() => cleanTestDir())

describe('scaffold: base-only (no features)', () => {
  it('produces valid project files', () => {
    const targetDir = join(TEST_DIR, 'base-only')
    assembleProject(targetDir, [], 'base-only')

    expect(existsSync(join(targetDir, 'package.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'nuxt.config.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'tsconfig.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'app', 'app.vue'))).toBe(true)
    expect(existsSync(join(targetDir, 'app', 'pages', 'index.vue'))).toBe(true)
    expect(existsSync(join(targetDir, '.gitignore'))).toBe(true)
    expect(existsSync(join(targetDir, '.env.example'))).toBe(true)
    expect(existsSync(join(targetDir, 'CLAUDE.md'))).toBe(true)
    expect(existsSync(join(targetDir, 'AGENTS.md'))).toBe(false)
    expect(existsSync(join(targetDir, '.cursor'))).toBe(false)
    expect(existsSync(join(targetDir, '.codex'))).toBe(false)
    expect(existsSync(join(targetDir, '.agents'))).toBe(false)
    expect(existsSync(join(targetDir, '.claude', 'settings.json'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude', 'versions.json'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude', 'skills'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude', 'commands', 'ship.md'))).toBe(true)
    expect(existsSync(join(targetDir, 'SECURITY.md'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude', 'consumer-meta.json'))).toBe(false)
    // validate-starter 是 starter repo 自身的 self-validation tool，17f080cf 起移回 root
    // .claude/commands/；scaffold 出去的專案不維護 starter，拿到它沒有意義。
    expect(existsSync(join(targetDir, '.claude', 'commands', 'validate-starter.md'))).toBe(false)
    expect(existsSync(join(targetDir, '.scaffold-cleanup'))).toBe(false)
    expect(existsSync(join(targetDir, 'scripts', 'compress-skill-descriptions.sh'))).toBe(true)
    expect(existsSync(join(targetDir, 'scripts', 'templates', 'clean', 'README.md'))).toBe(true)
    expect(existsSync(join(targetDir, 'docs', 'playbooks', 'README.md'))).toBe(true)
    expect(readFileSync(join(targetDir, 'docs', 'playbooks', 'README.md'), 'utf-8')).toContain(
      '## Browser 分流',
    )
    expect(readFileSync(join(targetDir, 'HANDOFF.md'), 'utf-8')).toContain('## User-gate board')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.name).toBe('base-only')
    expect(pkg.packageManager).toBe('pnpm@11.24.0')
    expect(pkg.dependencies.nuxt).toBeDefined()
  })

  it('nuxt.config has no feature modules', () => {
    const targetDir = join(TEST_DIR, 'base-only-config')
    assembleProject(targetDir, [], 'base-only-config')

    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(config).not.toContain('@nuxt/ui')
    expect(config).not.toContain('better-auth')
    expect(config).not.toContain('@nuxtjs/supabase')
  })

  it('defaults production sourcemaps to false without monitoring', () => {
    const targetDir = join(TEST_DIR, 'base-only-sourcemap')
    assembleProject(targetDir, [], 'base-only-sourcemap')

    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(config).toContain('sourcemap: false')
  })

  // 這條原本斷言的是 starter 自己那份靜態 scripts/install-skills.sh —— 因為整棵 scripts/
  // 的複製排在動態產生之後，把依 feature 產生的版本蓋掉了。順序修好之後，scaffold 出去的
  // 專案拿到的必須是動態版（產生日期 header 是它獨有的標記）。
  it('install-skills.sh 是依選擇的 feature 動態產生的，不是 starter 自己那份靜態清單', () => {
    const targetDir = join(TEST_DIR, 'base-only-skills')
    assembleProject(targetDir, [], 'base-only-skills')

    const script = readFileSync(join(targetDir, 'scripts', 'install-skills.sh'), 'utf-8')
    expect(script).toContain('由 scaffold 依選擇的功能自動產生')
    // 沒選 ui 就不該有 Nuxt UI / impeccable 段落
    expect(script).not.toContain('nuxt/ui')
    expect(script).not.toContain('pbakaus/impeccable')
    expect(script).not.toMatch(
      /for skill in .*\b(arrange|extract|frontend-design|normalize|onboard|teach-impeccable)\b/,
    )
  })

  it('選了 ui 才裝 Nuxt UI / impeccable，且不含上游已移除的 skill id', () => {
    const targetDir = join(TEST_DIR, 'ui-skills')
    assembleProject(targetDir, ['ui'], 'ui-skills')

    const script = readFileSync(join(targetDir, 'scripts', 'install-skills.sh'), 'utf-8')
    expect(script).toContain('nuxt/ui')
    expect(script).toContain('pbakaus/impeccable')
    expect(script).not.toMatch(
      /for skill in .*\b(arrange|extract|frontend-design|normalize|onboard|teach-impeccable)\b/,
    )
  })

  it('uses setup script that never auto-deletes starter repos', () => {
    const targetDir = join(TEST_DIR, 'base-only-setup')
    assembleProject(targetDir, [], 'base-only-setup')

    const script = readFileSync(join(targetDir, 'scripts', 'setup.sh'), 'utf-8')
    expect(script).toContain('setup 已停用自動刪除 starter repo 的行為')
    expect(script).not.toContain('rm -rf "$CLEANUP_PATH"')
  })

  it('strips scaffolder meta-only files while keeping runtime files', () => {
    const targetDir = join(TEST_DIR, 'base-only-strip')
    assembleProject(targetDir, [], 'base-only-strip')

    expect(existsSync(join(targetDir, 'packages', 'create-nuxt-starter'))).toBe(false)
    expect(existsSync(join(targetDir, 'presets', '_base', 'strip-manifest.json'))).toBe(false)
    expect(existsSync(join(targetDir, '.spectra', 'claims'))).toBe(false)
    expect(existsSync(join(targetDir, '.spectra', 'spectra.db'))).toBe(false)
    expect(existsSync(join(targetDir, '.clade'))).toBe(false)

    expect(existsSync(join(targetDir, 'app'))).toBe(true)
    expect(existsSync(join(targetDir, 'server'))).toBe(true)
    expect(existsSync(join(targetDir, 'nuxt.config.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'package.json'))).toBe(true)
  })

  it('fails closed when strip cleanup receives a malformed manifest', () => {
    const manifestPath = join(TEST_DIR, 'malformed-strip-manifest.json')
    const targetDir = join(TEST_DIR, 'malformed-strip')
    writeText(manifestPath, '{ not json }\n')

    expect(() =>
      assembleProject(targetDir, [], 'malformed-strip', undefined, undefined, undefined, {
        stripManifestPath: manifestPath,
      }),
    ).toThrow(/strip-manifest.*malformed/i)
  })
})

describe('scaffold: all features', () => {
  it('produces project with all modules', () => {
    const defaults = getDefaultSelections('full-project')
    // Add SSR + SEO (not in defaults since SSR is off by default)
    const features = resolveFeatureDependencies([...defaults.features, 'ssr', 'seo'])
    const targetDir = join(TEST_DIR, 'full-project')
    assembleProject(targetDir, features, 'full-project')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies['@nuxt/ui']).toBeDefined()
    expect(pkg.dependencies['nuxt-auth-utils']).toBeDefined()
    expect(pkg.dependencies['@supabase/supabase-js']).toBeDefined()
    expect(pkg.dependencies['@nuxtjs/sitemap']).toBeDefined()
    expect(pkg.dependencies['@nuxtjs/robots']).toBeDefined()
    expect(pkg.dependencies['nuxt-site-config']).toBeDefined()
    expect(pkg.dependencies['nuxt-security']).toBeDefined()
    expect(pkg.devDependencies['@playwright/test']).toBeDefined()
    expect(pkg.devDependencies['vite-plus']).toBeDefined()
    expect(pkg.devDependencies['husky']).toBeDefined()

    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(config).toContain('@nuxt/ui')
    expect(config).toContain('nuxt-auth-utils')
    expect(config).toContain('@nuxtjs/supabase')
    expect(config).toContain('@nuxtjs/sitemap')
    expect(config).toContain('ssr: true')
    expect(config).toContain('sourcemap: false')

    // Auth pages exist
    expect(existsSync(join(targetDir, 'app', 'pages', 'auth', 'login.vue'))).toBe(true)
    // Supabase config exists
    expect(existsSync(join(targetDir, 'supabase', 'config.toml'))).toBe(true)
    // Testing config exists
    expect(existsSync(join(targetDir, 'vitest.config.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'playwright.config.ts'))).toBe(true)
  })
})

describe('feature dependency enforcement', () => {
  it('auth-better-auth auto-enables database', () => {
    const resolved = resolveFeatureDependencies(['auth-better-auth'])
    expect(resolved).toContain('auth-better-auth')
    expect(resolved).toContain('database')
  })

  it('database alone does not add auth', () => {
    const resolved = resolveFeatureDependencies(['database'])
    expect(resolved).toContain('database')
    expect(resolved).not.toContain('auth')
  })
})

describe('non-interactive mode', () => {
  it('getDefaultSelections returns valid defaults', () => {
    const selections = getDefaultSelections('my-app')
    expect(selections.projectName).toBe('my-app')
    expect(selections.features).toContain('auth-nuxt-utils')
    expect(selections.features).toContain('database')
    expect(selections.features).toContain('ui')
    expect(selections.features).toContain('deploy-cloudflare')
    expect(selections.deploymentTarget).toBe('cloudflare')
    expect(selections.ssr).toBe(false)
    expect(selections.agentTargets).toEqual(['claude-code'])
    // SEO not in defaults because SSR is off by default
    expect(selections.features).not.toContain('seo')
  })
})

describe('agent runtime selection', () => {
  it('supports codex + cursor multi-select while keeping claude source assets', () => {
    const targetDir = join(TEST_DIR, 'multi-agent-project')
    assembleProject(targetDir, [], 'multi-agent-project', ['codex', 'cursor'])

    expect(existsSync(join(targetDir, 'CLAUDE.md'))).toBe(false)
    expect(existsSync(join(targetDir, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(targetDir, '.codex', 'config.toml'))).toBe(true)
    expect(existsSync(join(targetDir, '.agents', 'skills', 'commit', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(targetDir, '.cursor', 'hooks.json'))).toBe(true)
    expect(existsSync(join(targetDir, '.claude', 'settings.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'scripts', 'install-skills.sh'))).toBe(false)

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.scripts['skills:install']).toBeUndefined()
    expect(pkg.scripts['skills:list']).toBeUndefined()
    expect(pkg.scripts['skills:update']).toBeUndefined()
  })
})

describe('SSR and SEO coupling', () => {
  it('ssr: false 時不應包含 SEO modules', () => {
    const targetDir = join(TEST_DIR, 'spa-no-seo')
    assembleProject(targetDir, ['ui'], 'spa-no-seo')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies?.['@nuxtjs/sitemap']).toBeUndefined()
    expect(pkg.dependencies?.['nuxt-site-config']).toBeUndefined()

    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(config).toContain('ssr: false')
    expect(config).not.toContain('@nuxtjs/sitemap')
  })

  it('ssr: true 時 nuxt.config 包含 ssr: true 和 SEO modules', () => {
    const features = resolveFeatureDependencies(['ssr', 'seo'])
    const targetDir = join(TEST_DIR, 'ssr-with-seo')
    assembleProject(targetDir, features, 'ssr-with-seo')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies['@nuxtjs/sitemap']).toBeDefined()
    expect(pkg.dependencies['nuxt-site-config']).toBeDefined()

    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(config).toContain('ssr: true')
    expect(config).toContain('@nuxtjs/sitemap')
    expect(config).toContain('sourcemap: false')
  })

  it('seo 自動拉入 ssr dependency', () => {
    const resolved = resolveFeatureDependencies(['seo'])
    expect(resolved).toContain('seo')
    expect(resolved).toContain('ssr')
  })
})

describe('directory conflict handling', () => {
  it('assembleProject creates directory if not exists', () => {
    const targetDir = join(TEST_DIR, 'new-dir')
    assembleProject(targetDir, [], 'new-dir')
    expect(existsSync(targetDir)).toBe(true)
  })
})

describe('scaffold: nuxthub-ai db stack', () => {
  it('keeps NuxtHub D1 files and omits Supabase DB layout after strip cleanup', () => {
    const projectName = 'nuxthub-ai-strip'
    const selections = buildSelectionsFromArgs({
      projectName,
      evlogPreset: 'nuxthub-ai',
    })
    const targetDir = join(TEST_DIR, projectName)

    assembleProject(
      targetDir,
      selections.features,
      projectName,
      selections.agentTargets,
      selections.evlogPreset,
      selections.dbStack,
    )

    expect(existsSync(join(targetDir, 'server/database/migrations/0002_evlog_events.sql'))).toBe(
      true,
    )
    expect(existsSync(join(targetDir, 'wrangler.jsonc.template'))).toBe(true)
    expect(existsSync(join(targetDir, 'server/db'))).toBe(false)
  })
})

// Nuxt UI 官方安裝文件要求 main.css 同時有 `@import 'tailwindcss'` 與
// `@import '@nuxt/ui'`。少了後者時 Tailwind 不掃描 Nuxt UI 的 theme，
// 只存在於元件內部的 utility（.p-1\.5、.size-5 …）不會被生成 ——
// lint / typecheck / happy-dom 測試都量不到 runtime CSS，這裡是唯一的機械 gate。
describe('scaffold: Nuxt UI CSS entry', () => {
  const CSS_PATH = ['app', 'assets', 'css', 'main.css']

  it('ui feature 產生的 main.css 同時含 tailwindcss 與 @nuxt/ui import', () => {
    const targetDir = join(TEST_DIR, 'ui-css')
    assembleProject(targetDir, resolveFeatureDependencies(['ui']), 'ui-css')

    const css = readFileSync(join(targetDir, ...CSS_PATH), 'utf-8')
    expect(css).toMatch(/^@import\s+['"]tailwindcss['"];/m)
    expect(css).toMatch(/^@import\s+['"]@nuxt\/ui['"];/m)
  })

  it('未選 ui feature 時 main.css 不 import 未安裝的套件', () => {
    const targetDir = join(TEST_DIR, 'no-ui-css')
    assembleProject(targetDir, [], 'no-ui-css')

    const css = readFileSync(join(targetDir, ...CSS_PATH), 'utf-8')
    expect(css).not.toMatch(/^@import\s+['"]@nuxt\/ui['"];/m)
    expect(css).not.toMatch(/^@import\s+['"]tailwindcss['"];/m)
  })

  it('starter 本體 template 的 main.css 與 ui overlay 不漂移', () => {
    const starterCss = readFileSync(
      join(import.meta.dirname, '..', '..', '..', ...CSS_PATH),
      'utf-8',
    )
    expect(starterCss).toMatch(/^@import\s+['"]tailwindcss['"];/m)
    expect(starterCss).toMatch(/^@import\s+['"]@nuxt\/ui['"];/m)
  })
})

describe('scaffold: Better Auth 模組身分', () => {
  // 這個模組 2026-08 搬進官方 nuxt-modules org 並改名：`@onmax/nuxt-better-auth`
  // （停在 0.1.2）→ `@nuxtjs/better-auth`。新模組把 `better-auth >=1.7.1 <2` 訂成硬 peer，
  // 所以套件名與 better-auth 版本必須一起釘住，任一邊漂掉都會 install 失敗或裝到死套件。
  it('scaffold 出來的專案裝的是 @nuxtjs/better-auth，不是已停更的 @onmax 版', () => {
    const targetDir = join(TEST_DIR, 'better-auth-identity')
    assembleProject(targetDir, resolveFeatureDependencies(['auth-better-auth']), 'ba-app')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies['@nuxtjs/better-auth']).toBe('^0.1.4')
    expect(pkg.dependencies['@onmax/nuxt-better-auth']).toBeUndefined()
    expect(pkg.dependencies['better-auth']).toBe('^1.7.1')

    const nuxtConfig = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(nuxtConfig).toContain('@nuxtjs/better-auth')
    expect(nuxtConfig).not.toContain('@onmax/nuxt-better-auth')

    const authConfig = readFileSync(join(targetDir, 'app', 'auth.config.ts'), 'utf-8')
    expect(authConfig).toContain("from '@nuxtjs/better-auth/config'")
  })

  it('install-skills.sh 不再安裝上游已移除的 onmax skill', () => {
    const targetDir = join(TEST_DIR, 'better-auth-skills')
    assembleProject(
      targetDir,
      resolveFeatureDependencies(['auth-better-auth', 'vueuse']),
      'ba-skills',
    )

    const installSkills = readFileSync(join(targetDir, 'scripts', 'install-skills.sh'), 'utf-8')
    // onmax/nuxt-skills 已刪掉 nuxt-better-auth 與 vueuse 兩個 skill（2026-08-24 實測 404）
    expect(installSkills).not.toContain('nuxt-better-auth')
    expect(installSkills).not.toMatch(/onmax\/nuxt-skills@\$skill[\s\S]*?\bvueuse\b/)
    expect(installSkills).toContain('vueuse-functions')
  })
})

describe('scaffold: void.cloud 接線', () => {
  // `npx void init` 實測（void 0.10.12）只產 wrangler.jsonc —— 不產 void.json，
  // 也不會把 voidPlugin() patch 進 nuxt.config。少了那段接線，專案跑得起來卻完全沒接到
  // void 平台，而且要到用 `void/db` 之類才會發現。所以 scaffold MUST 自己寫好。
  it('void 軌的 nuxt.config 帶 voidPlugin()', () => {
    const targetDir = join(TEST_DIR, 'void-plugin')
    assembleProject(targetDir, ['deploy-void'], 'void-app', ['claude-code'], 'baseline', 'void-d1')

    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(config).toContain("import { voidPlugin } from 'void'")
    expect(config).toContain('plugins: [voidPlugin()]')
  })

  it('void 軌帶 wrangler（Nuxt dev 期建 Cloudflare platform proxy 用）', () => {
    const targetDir = join(TEST_DIR, 'void-wrangler')
    assembleProject(
      targetDir,
      ['deploy-void'],
      'void-wrangler',
      ['claude-code'],
      'baseline',
      'void-d1',
    )

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies.wrangler ?? pkg.devDependencies?.wrangler).toBeDefined()
  })

  it('非 void 軌不得混進 voidPlugin', () => {
    const targetDir = join(TEST_DIR, 'no-void-plugin')
    assembleProject(targetDir, ['deploy-cloudflare'], 'cf-app')

    const config = readFileSync(join(targetDir, 'nuxt.config.ts'), 'utf-8')
    expect(config).not.toContain('voidPlugin')
  })
})

describe('scaffold: first-run 暖機流程的可執行性', () => {
  // first-run marker 叫使用者跑的每一條 script MUST 真的存在於產出的 package.json。
  // 這四支的檔案一直都被複製進專案，但 package.json 只寫了 roadmap 一條 ——
  // 有檔沒入口比兩者都缺更難查：檔案明明在，指令卻 Command not found。
  it('package.json 有 first-run 流程用到的 spectra script', () => {
    const targetDir = join(TEST_DIR, 'spectra-scripts')
    assembleProject(targetDir, [], 'spectra-scripts')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    for (const name of [
      'spectra:roadmap',
      'spectra:claim',
      'spectra:claims',
      'spectra:followups',
    ]) {
      expect(pkg.scripts[name]).toBeDefined()
    }
  })

  it('每個 spectra script 指到的檔案都真的被複製進專案', () => {
    const targetDir = join(TEST_DIR, 'spectra-script-files')
    assembleProject(targetDir, [], 'spectra-script-files')

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    const spectraScripts = Object.entries(pkg.scripts as Record<string, string>).filter(([k]) =>
      k.startsWith('spectra:'),
    )
    expect(spectraScripts.length).toBeGreaterThan(0)

    for (const [, cmd] of spectraScripts) {
      const scriptPath = /(scripts\/[\w/.-]+)/.exec(cmd)?.[1]
      expect(scriptPath, `無法從 "${cmd}" 取出 script 路徑`).toBeDefined()
      expect(existsSync(join(targetDir, scriptPath!)), `${scriptPath} 沒被複製`).toBe(true)
    }
  })
})

describe('scaffold: 全新專案的 pnpm check 前置條件', () => {
  // 這三條各對應一次「beginner 照 PROMPT.md 跑 pnpm check 就撞牆」的實測。
  // 撞的都不是使用者寫的 code —— 是投影層、vendored bundle、與 Nuxt boot 時間。
  it('產出 vite.config.ts，且投影層與 vendor 都在 lint/fmt 排除清單內', () => {
    const targetDir = join(TEST_DIR, 'vite-config-excludes')
    assembleProject(targetDir, [], 'vite-config-excludes')

    const configPath = join(targetDir, 'vite.config.ts')
    expect(existsSync(configPath)).toBe(true)

    const config = readFileSync(configPath, 'utf-8')
    // vendor/：cookbook 語料含 `port: <DEV_PORT>` 佔位樣板，oxfmt parse 直接失敗
    // .claude/：LOCKED 投影，含第三方 UMD bundle，oxlint --deny-warnings 會炸
    for (const pattern of ['.claude/**', '.agents/**', '.codex/**', '.cursor/**', 'vendor/**']) {
      expect(config, `${pattern} 不在排除清單`).toContain(pattern)
    }
    expect(config).toContain('lint:')
    expect(config).toContain('fmt:')
  })

  it('vitest 的 hookTimeout 撐得過 Nuxt boot', () => {
    const targetDir = join(TEST_DIR, 'vitest-hook-timeout')
    assembleProject(targetDir, ['testing-full'], 'vitest-hook-timeout')

    const config = readFileSync(join(targetDir, 'vitest.config.ts'), 'utf-8')
    expect(config).toContain('hookTimeout')
    // 預設 10s 不夠：environment 'nuxt' 每個 test 檔都要 boot 一次完整 Nuxt build
    const declared = /hookTimeout:\s*([\d_]+)/.exec(config)?.[1]?.replace(/_/g, '')
    expect(Number(declared)).toBeGreaterThanOrEqual(30000)
  })
})
