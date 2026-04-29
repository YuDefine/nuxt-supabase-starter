#!/usr/bin/env node
/**
 * verify-starter.mjs — 機械化驗收新專案環境健康
 *
 * 設計目標：scaffold 完成後，AI / 使用者一鍵跑出環境狀態，
 * 不必逐項對照 NEW_PROJECT_CHECKLIST.md。
 *
 * Output:
 *   default → 表格 + 退出碼
 *   --json  → 機械可解 JSON
 *   --full  → 額外跑 pnpm check（慢）
 *
 * Exit codes:
 *   0 = all OK
 *   1 = ≥1 fail
 *   2 = ≥1 warn 但無 fail
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const argv = new Set(process.argv.slice(2))
const JSON_MODE = argv.has('--json')
const FULL_MODE = argv.has('--full')

/** @type {Array<{id: string, label: string, status: 'OK' | 'WARN' | 'FAIL' | 'SKIP', message?: string, fix?: string}>} */
const results = []

function record(id, label, status, message, fix) {
  results.push({ id, label, status, message, fix })
}

/**
 * 偵測「我是 starter 本體還是 scaffold 出來的 consumer」：
 * - starter 本體（template/）：package.json:name === "nuxt-supabase-starter"
 *   或存在 ../packages/create-nuxt-starter（monorepo sibling）
 * - consumer：scaffold CLI 替換 name 為使用者指定的專案名
 *
 * Starter 本體跑某些檢查（殘留關鍵字、.env、OAuth credentials）必然失敗 —
 * 改標 SKIP 避免假警報。
 */
function detectMode() {
  const pkg = readJsonSafe(join(ROOT, 'package.json'))
  if (pkg?.name === 'nuxt-supabase-starter') return 'starter-self'
  if (existsSync(join(ROOT, '..', 'packages', 'create-nuxt-starter'))) return 'starter-self'
  return 'consumer'
}

const MODE = detectMode()

function tryExec(file, args = []) {
  const r = spawnSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  if (r.status === 0) return (r.stdout || '').trim()
  return null
}

function readJsonSafe(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────
// Checks
// ─────────────────────────────────────────────────────────

function checkNode() {
  const v = process.versions.node
  const major = Number.parseInt(v.split('.')[0], 10)
  if (major >= 18) record('node', 'Node.js ≥ 18', 'OK', `v${v}`)
  else record('node', 'Node.js ≥ 18', 'FAIL', `v${v}`, '安裝 Node 18+（建議 24 LTS）')
}

function checkPnpm() {
  const v = tryExec('pnpm', ['--version'])
  if (!v) {
    record(
      'pnpm',
      'pnpm ≥ 9',
      'FAIL',
      '找不到 pnpm',
      'corepack enable && corepack prepare pnpm@latest --activate'
    )
    return
  }
  const major = Number.parseInt(v.split('.')[0], 10)
  if (major >= 9) record('pnpm', 'pnpm ≥ 9', 'OK', `v${v}`)
  else record('pnpm', 'pnpm ≥ 9', 'FAIL', `v${v}`, 'corepack prepare pnpm@latest --activate')
}

function checkDocker() {
  const info = tryExec('docker', ['info', '--format', '{{.ServerVersion}}'])
  if (info) record('docker', 'Docker daemon 運作中', 'OK', `v${info}`)
  else
    record(
      'docker',
      'Docker daemon 運作中',
      'WARN',
      '找不到 docker 或 daemon 未啟動',
      '啟動 Docker Desktop / OrbStack（Supabase 需要）'
    )
}

function checkSupabaseCli() {
  const v = tryExec('supabase', ['--version'])
  if (v) record('supabase-cli', 'Supabase CLI 已安裝', 'OK', v)
  else
    record(
      'supabase-cli',
      'Supabase CLI 已安裝',
      'WARN',
      '找不到 supabase CLI',
      'brew install supabase/tap/supabase（macOS）/ scoop install supabase（Windows）'
    )
}

function checkClaudeCli() {
  const v = tryExec('claude', ['--version']) || tryExec('which', ['claude'])
  if (v) record('claude-cli', 'Claude Code CLI 已安裝', 'OK', v.split('\n')[0])
  else
    record(
      'claude-cli',
      'Claude Code CLI 已安裝',
      'WARN',
      '找不到 claude CLI',
      'curl -fsSL https://claude.ai/install.sh | sh'
    )
}

function checkNodeModules() {
  if (existsSync(join(ROOT, 'node_modules'))) record('node-modules', 'node_modules 已安裝', 'OK')
  else record('node-modules', 'node_modules 已安裝', 'FAIL', '未安裝', 'pnpm install')
}

function checkHubJson() {
  const p = join(ROOT, '.claude', 'hub.json')
  const data = readJsonSafe(p)
  if (!data) {
    record(
      'hub-json',
      '.claude/hub.json 存在 + 合法',
      'FAIL',
      '缺檔或解析失敗',
      'cd <projectDir> && pnpm hub:bootstrap'
    )
    return
  }
  const required = ['version', 'modules']
  const missing = required.filter((k) => !data[k])
  if (missing.length) {
    record(
      'hub-json',
      '.claude/hub.json 存在 + 合法',
      'FAIL',
      `缺欄位: ${missing.join(', ')}`,
      '重跑 init-consumer'
    )
    return
  }
  record(
    'hub-json',
    '.claude/hub.json 存在 + 合法',
    'OK',
    `v${data.version}, modules=${Object.keys(data.modules).join('/')}`
  )
}

function checkPackageJson() {
  const p = join(ROOT, 'package.json')
  const pkg = readJsonSafe(p)
  if (!pkg) {
    record('package-json', 'package.json 存在', 'FAIL')
    return
  }
  const scripts = pkg.scripts || {}

  if (scripts.postinstall && scripts.postinstall.includes('bootstrap-hub')) {
    record('postinstall', 'postinstall 含 bootstrap-hub', 'OK')
  } else {
    record(
      'postinstall',
      'postinstall 含 bootstrap-hub',
      'FAIL',
      'postinstall 缺 clade bootstrap',
      '重跑 init-consumer'
    )
  }

  const requiredScripts = ['hub:check', 'hub:sync', 'hub:bootstrap']
  const missingScripts = requiredScripts.filter((s) => !scripts[s])
  if (missingScripts.length === 0) {
    record('hub-scripts', 'hub:* scripts 完整', 'OK')
  } else {
    record(
      'hub-scripts',
      'hub:* scripts 完整',
      'FAIL',
      `缺: ${missingScripts.join(', ')}`,
      '重跑 init-consumer'
    )
  }
}

// Provider console URL + 取值提示。Key 為 .env var 前綴 / 完整名稱。
const ENV_VAR_HINTS = {
  // Supabase
  SUPABASE_URL: {
    provider: 'Supabase',
    url: 'http://127.0.0.1:54321（本機）/ Supabase Dashboard → Settings → API → Project URL',
    note: '本機跑 supabase status 取得',
  },
  SUPABASE_KEY: {
    provider: 'Supabase',
    url: 'supabase status 輸出的 anon key',
    note: '本機 supabase status / Dashboard → Settings → API → anon public',
  },
  SUPABASE_SECRET_KEY: {
    provider: 'Supabase',
    url: 'supabase status 輸出的 service_role key',
    note: '本機 supabase status / Dashboard → Settings → API → service_role（保密）',
  },
  NUXT_PUBLIC_SUPABASE_URL: {
    provider: 'Supabase',
    url: '同 SUPABASE_URL',
    note: '前端用，會打包進 client bundle',
  },
  NUXT_PUBLIC_SUPABASE_KEY: {
    provider: 'Supabase',
    url: '同 SUPABASE_KEY',
    note: '前端用 anon key',
  },

  // Auth secrets
  BETTER_AUTH_SECRET: {
    provider: 'self-generated',
    url: '本機產生',
    note: 'openssl rand -base64 32',
  },
  NUXT_SESSION_PASSWORD: {
    provider: 'self-generated',
    url: '本機產生',
    note: 'openssl rand -base64 32（≥32 字元）',
  },

  // OAuth providers
  NUXT_OAUTH_GOOGLE_CLIENT_ID: {
    provider: 'Google Cloud',
    url: 'https://console.cloud.google.com/apis/credentials',
    note: 'Create OAuth 2.0 Client ID → Web application → Authorized redirect URIs 加 {NUXT_PUBLIC_SITE_URL}/api/auth/callback/google',
  },
  NUXT_OAUTH_GOOGLE_CLIENT_SECRET: {
    provider: 'Google Cloud',
    url: '同上 Client ID 詳情頁',
    note: '建立 Client ID 時一併取得',
  },
  NUXT_OAUTH_GITHUB_CLIENT_ID: {
    provider: 'GitHub',
    url: 'https://github.com/settings/developers',
    note: 'New OAuth App → Authorization callback URL: {NUXT_PUBLIC_SITE_URL}/api/auth/callback/github',
  },
  NUXT_OAUTH_GITHUB_CLIENT_SECRET: {
    provider: 'GitHub',
    url: '同上 OAuth App 詳情頁',
    note: '建立後點 Generate a new client secret',
  },
  NUXT_OAUTH_LINE_CLIENT_ID: {
    provider: 'LINE Developers',
    url: 'https://developers.line.biz/console/',
    note: 'Create channel → Channel ID',
  },
  NUXT_OAUTH_LINE_CLIENT_SECRET: {
    provider: 'LINE Developers',
    url: '同上 Channel 詳情頁',
    note: 'Channel secret',
  },

  // Site config
  NUXT_PUBLIC_SITE_URL: {
    provider: 'self-config',
    url: '依部署環境決定',
    note: 'dev: http://localhost:3000；prod: 正式網域；OAuth callback 必須對齊',
  },

  // Sentry / monitoring
  SENTRY_AUTH_TOKEN: {
    provider: 'Sentry',
    url: 'https://sentry.io/settings/account/api/auth-tokens/',
    note: 'Create Token，scope 至少 project:releases',
  },
  NUXT_PUBLIC_SENTRY_DSN: {
    provider: 'Sentry',
    url: 'Sentry → Settings → Projects → <project> → Client Keys (DSN)',
    note: '前端用，可公開',
  },

  // Cloudflare
  CLOUDFLARE_API_TOKEN: {
    provider: 'Cloudflare',
    url: 'https://dash.cloudflare.com/profile/api-tokens',
    note: 'Create Token → Edit Cloudflare Workers template',
  },
  CLOUDFLARE_ACCOUNT_ID: {
    provider: 'Cloudflare',
    url: 'https://dash.cloudflare.com/',
    note: '右側欄位顯示 Account ID',
  },
}

function describeMissingEnv(varName) {
  // Exact match first
  if (ENV_VAR_HINTS[varName]) return ENV_VAR_HINTS[varName]
  // Prefix match for OAuth providers etc.
  for (const [prefix, hint] of Object.entries(ENV_VAR_HINTS)) {
    if (varName.startsWith(prefix)) return hint
  }
  return null
}

function checkEnvFile() {
  if (MODE === 'starter-self') {
    record('env-file', '.env 已建立', 'SKIP', 'starter 本體不需 .env，僅 .env.example 為範本')
    record('env-vars', '.env 全部 vars 已填', 'SKIP', 'starter 本體不需 .env')
    return
  }

  const envPath = join(ROOT, '.env')
  const examplePath = join(ROOT, '.env.example')

  if (!existsSync(envPath)) {
    record(
      'env-file',
      '.env 已建立',
      'WARN',
      '找不到 .env',
      existsSync(examplePath)
        ? 'cp .env.example .env 再填入實際值'
        : '尚無 .env.example，待專案決定 env 範本'
    )
    return
  }
  record('env-file', '.env 已建立', 'OK')

  if (!existsSync(examplePath)) {
    record('env-vars', '.env vs .env.example 對齊', 'SKIP', '無 .env.example')
    return
  }

  const exampleVars = readFileSync(examplePath, 'utf8')
    .split('\n')
    .map((l) => l.split('=')[0].trim())
    .filter((k) => k && !k.startsWith('#'))

  const envContent = readFileSync(envPath, 'utf8')
  const missing = exampleVars.filter((k) => !new RegExp(`^${k}=(.+)`, 'm').test(envContent))

  if (missing.length === 0) {
    record('env-vars', '.env 全部 vars 已填', 'OK')
    return
  }

  // Build detailed fix hints
  const hints = missing
    .map((v) => {
      const h = describeMissingEnv(v)
      return h
        ? `${v} → ${h.provider}: ${h.url}\n        ${h.note}`
        : `${v} → 對照 .env.example 取值`
    })
    .slice(0, 8)
  const more =
    missing.length > hints.length ? `\n      ...還有 ${missing.length - hints.length} 個` : ''

  record(
    'env-vars',
    '.env 全部 vars 已填',
    'WARN',
    `缺 ${missing.length} 個`,
    hints.join('\n      ') + more
  )
}

function checkSupabaseRunning() {
  const status = tryExec('supabase', ['status', '--output', 'json'])
  if (!status) {
    record('supabase-running', 'Supabase 本地服務運作中', 'SKIP', '未跑或無 supabase CLI')
    return
  }
  try {
    const json = JSON.parse(status)
    const apiUp = json.API_URL || json.api_url
    if (apiUp) record('supabase-running', 'Supabase 本地服務運作中', 'OK', apiUp)
    else
      record(
        'supabase-running',
        'Supabase 本地服務運作中',
        'WARN',
        '已配置但未啟動',
        'supabase start'
      )
  } catch {
    record(
      'supabase-running',
      'Supabase 本地服務運作中',
      'WARN',
      '無法解析 status',
      'supabase start'
    )
  }
}

function checkDatabaseTypes() {
  const p = join(ROOT, 'app', 'types', 'database.types.ts')
  if (!existsSync(p)) {
    record(
      'db-types',
      'app/types/database.types.ts 存在',
      'WARN',
      '尚未產生',
      'supabase gen types typescript --local | tee app/types/database.types.ts'
    )
    return
  }
  const size = statSync(p).size
  if (size < 200)
    record(
      'db-types',
      'app/types/database.types.ts 存在',
      'WARN',
      `檔案僅 ${size} bytes，可能未填入內容`,
      'supabase gen types typescript --local | tee app/types/database.types.ts'
    )
  else record('db-types', 'app/types/database.types.ts 存在', 'OK', `${size} bytes`)
}

function checkPreCommitWired() {
  if (MODE === 'starter-self') {
    record(
      'pre-commit',
      'pre-commit hook wired',
      'SKIP',
      'starter 本體靠 /commit + SessionStart hook，不依賴 pre-commit'
    )
    return
  }
  const husky = join(ROOT, '.husky', 'pre-commit')
  const gitHook = join(ROOT, '.git', 'hooks', 'pre-commit')
  for (const p of [husky, gitHook]) {
    if (existsSync(p)) {
      const c = readFileSync(p, 'utf8')
      if (c.includes('hub:check') || c.includes('git-pre-commit.sh')) {
        record('pre-commit', 'pre-commit hook wired', 'OK', p.replace(ROOT + '/', ''))
        return
      }
    }
  }
  record(
    'pre-commit',
    'pre-commit hook wired',
    'WARN',
    '未 wire',
    '重跑 scaffold 或手動 cp ~/offline/clade/vendor/git-pre-commit.sh .git/hooks/pre-commit'
  )
}

function checkHubDrift() {
  const r = spawnSync('pnpm', ['hub:check'], { cwd: ROOT, encoding: 'utf8' })
  if (r.status === 0) {
    record('hub-drift', 'clade drift = 0', 'OK')
  } else {
    const out = (r.stdout || '') + (r.stderr || '')
    record(
      'hub-drift',
      'clade drift = 0',
      'WARN',
      '偵測到 drift',
      `跑 pnpm hub:check 看詳情；通常 pnpm hub:sync 即可：\n${out.split('\n').slice(0, 3).join('\n')}`
    )
  }
}

function checkResidualKeywords() {
  if (MODE === 'starter-self') {
    record(
      'residual-keywords',
      '無 starter 關鍵字殘留',
      'SKIP',
      'starter 本體必然有 name="nuxt-supabase-starter" 等關鍵字，此檢查只對 scaffold 出來的新專案有意義'
    )
    return
  }
  const r = spawnSync(
    'rg',
    [
      '-ni',
      'nuxt[- ]supabase starter|nuxt-supabase-starter|^demo$',
      '--glob',
      '!verify-starter.mjs',
      '--glob',
      '!docs/**',
      '--glob',
      '!.git/**',
      '--glob',
      '!node_modules/**',
      '.',
    ],
    { cwd: ROOT, encoding: 'utf8' }
  )
  if (r.status === 1) {
    // ripgrep exit 1 = no matches
    record('residual-keywords', '無 starter 關鍵字殘留', 'OK')
  } else if (r.status === 0) {
    const lines = (r.stdout || '').trim().split('\n').filter(Boolean)
    record(
      'residual-keywords',
      '無 starter 關鍵字殘留',
      'WARN',
      `${lines.length} 處殘留`,
      '檢視首幾條：\n  ' + lines.slice(0, 3).join('\n  ')
    )
  } else {
    record('residual-keywords', '無 starter 關鍵字殘留', 'SKIP', '找不到 ripgrep')
  }
}

function checkPnpmCheck() {
  if (!FULL_MODE) {
    record(
      'pnpm-check',
      'pnpm check 通過（format/lint/typecheck/test）',
      'SKIP',
      '加 --full 啟用此檢查'
    )
    return
  }
  const r = spawnSync('pnpm', ['check'], { cwd: ROOT, encoding: 'utf8' })
  if (r.status === 0) record('pnpm-check', 'pnpm check 通過', 'OK')
  else record('pnpm-check', 'pnpm check 通過', 'FAIL', '有錯', '跑 pnpm check 看詳情並修復')
}

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────

checkNode()
checkPnpm()
checkDocker()
checkSupabaseCli()
checkClaudeCli()
checkNodeModules()
checkHubJson()
checkPackageJson()
checkEnvFile()
checkSupabaseRunning()
checkDatabaseTypes()
checkPreCommitWired()
checkHubDrift()
checkResidualKeywords()
checkPnpmCheck()

const failCount = results.filter((r) => r.status === 'FAIL').length
const warnCount = results.filter((r) => r.status === 'WARN').length
const okCount = results.filter((r) => r.status === 'OK').length
const skipCount = results.filter((r) => r.status === 'SKIP').length

if (JSON_MODE) {
  console.log(
    JSON.stringify(
      {
        mode: MODE,
        summary: {
          ok: okCount,
          warn: warnCount,
          fail: failCount,
          skip: skipCount,
          total: results.length,
        },
        checks: results,
      },
      null,
      2
    )
  )
} else {
  const ICON = { OK: '✓', WARN: '⚠', FAIL: '✗', SKIP: '·' }
  const COLOR = { OK: '\x1b[32m', WARN: '\x1b[33m', FAIL: '\x1b[31m', SKIP: '\x1b[90m' }
  const RESET = '\x1b[0m'
  const isTty = process.stdout.isTTY
  const c = (status) => (isTty ? COLOR[status] : '')
  const r = isTty ? RESET : ''

  console.log('')
  console.log(`  Starter 環境驗收  [mode: ${MODE}]`)
  console.log('  ' + '─'.repeat(70))
  for (const item of results) {
    const icon = `${c(item.status)}${ICON[item.status]}${r}`
    const label = item.label.padEnd(46)
    const msg = item.message ? ` — ${item.message}` : ''
    console.log(`  ${icon} ${label}${msg}`)
    if (item.fix && (item.status === 'FAIL' || item.status === 'WARN')) {
      console.log(`      └ fix: ${item.fix}`)
    }
  }
  console.log('  ' + '─'.repeat(70))
  console.log(
    `  總計：${c('OK')}${okCount} OK${r} / ${c('WARN')}${warnCount} WARN${r} / ${c('FAIL')}${failCount} FAIL${r} / ${skipCount} SKIP`
  )
  console.log('')

  if (failCount === 0 && warnCount === 0) {
    console.log('  全部通過。可以開始開發了：pnpm dev')
  } else if (failCount === 0) {
    console.log('  有 WARN 但無 FAIL — 環境可用，建議補完上述項目')
  } else {
    console.log('  有 FAIL — 必須修復以上問題才能正常開發')
  }
  console.log('')
}

if (failCount > 0) process.exit(1)
if (warnCount > 0) process.exit(2)
process.exit(0)
