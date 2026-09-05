import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { consola } from 'consola'
import { DEFAULT_DB_STACK, type DbHost, type DbStack } from './types'

export interface CladeModules {
  auth: 'none' | 'better-auth' | 'nuxt-auth-utils' | 'supabase-self-hosted'
  dbSchema: 'cf-d1' | 'supabase' | 'supabase-self-hosted'
  dbRuntime: 'cf-workers' | 'supabase-self-hosted'
  runtime: 'cf-workers' | 'vercel-node' | 'nitro-self-hosted'
  framework: 'nuxt'
  localHooks: string[]
}

export interface PostScaffoldOptions {
  yes: boolean
  registerConsumer: boolean
  wirePreCommit: boolean
  cloneClade: boolean
  /** false 時跳過 `pnpm install`（CI / e2e 測試用；預設安裝）。 */
  installDeps?: boolean
  dbStack?: DbStack
  /** 開發時資料庫跑在哪；決定收尾是本機 Docker 還是連既有伺服器。 */
  dbHost?: DbHost
  repoId?: string
  workflowModel?: 'trunk-based' | 'pr-merge-based'
  businessActivity?: 'pre-production' | 'active' | 'maintenance' | 'paused' | 'auto'
  /** `auto` 交給 Clade 依 fleet 慣例配號（3000 起、每 10 一階）。 */
  devPort?: number | 'auto'
  /** 寫進 registry `deploy-track`；self-hosted 無公網 HTTPS prod DB 時必須是 `none`。 */
  deployTrack?: 'wrangler-action' | 'void-cloud' | 'node-server' | 'none'
  /** 寫進 registry `db-runtime`，與 hub.json modules 對齊。 */
  dbRuntime?: CladeModules['dbRuntime']
  /**
   * 就地展開到既有 git repo 時設 true：不重跑 `git init`，commit message 也
   * 改成「加入 starter」而非「initial scaffold」——那個 repo 的第一個 commit
   * 不是這次跑出來的。
   */
  existingGitRepo?: boolean
  /** 部署目標。void 需要一個 scaffold 完成後才做得到的必要步驟，見收尾警告。 */
  deployTarget?: 'cloudflare' | 'void' | 'node'
  /** 使用者勾選的 AI runtime。決定要不要跑 Cursor 投影。預設只有 claude-code。 */
  agentTargets?: readonly ('claude-code' | 'codex' | 'cursor')[]
}

/**
 * pnpm v11 遇到未表態的 build script 時，會把它寫進 `pnpm-workspace.yaml` 的
 * `allowBuilds`，值是佔位字串 `set this to true or false`，然後以退出碼 1 abort。
 * 回傳這些待表態的套件名（沒有就空陣列）。
 *
 * 這是「安裝其實成功、但退出碼是 1」的唯一已知形狀 —— 拿它來把這一種與真的安裝失敗
 * 分開，NEVER 靠退出碼本身判斷。
 */
export function readPendingBuildApprovals(targetDir: string): string[] {
  const wsPath = join(targetDir, 'pnpm-workspace.yaml')
  if (!existsSync(wsPath)) return []

  let content: string
  try {
    content = readFileSync(wsPath, 'utf8')
  } catch {
    return []
  }

  const pending: string[] = []
  for (const line of content.split('\n')) {
    const match = /^\s+'?([^':]+)'?:\s*set this to true or false\s*$/.exec(line)
    if (match) pending.push(match[1])
  }
  return pending
}

export function resolveSupabaseDevNextSteps(opts: {
  dbHost?: DbHost
  dbRuntime?: CladeModules['dbRuntime']
}): string[] {
  const existingServer =
    opts.dbHost === 'existing-server' ||
    (opts.dbHost === undefined && opts.dbRuntime === 'supabase-self-hosted')
  if (existingServer) {
    return [
      '  docs/playbooks/01-dev-database.md  # 連到已在跑的資料庫；不要在這台電腦再起一份',
      '  pnpm dev                 # 啟動開發伺服器',
      '  pnpm verify:starter      # 檢查 scaffold 狀態',
    ]
  }
  return [
    '  pnpm run setup           # 檢查環境 → 在這台電腦啟動資料庫 → 產生型別',
    '  pnpm dev                 # 啟動開發伺服器',
  ]
}

function writeScaffoldAnswers(targetDir: string, dbHost: DbHost | undefined): void {
  if (!dbHost) return
  const claudeDir = join(targetDir, '.claude')
  try {
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(
      join(claudeDir, 'scaffold-answers.json'),
      `${JSON.stringify({ dbHost }, null, 2)}\n`,
      'utf8',
    )
  } catch (error) {
    consola.warn(`寫 scaffold-answers.json 失敗：${(error as Error).message}`)
  }
}

const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321'
const LOCAL_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres'

/** existing-server：第一眼不要寫本機 Docker。this-machine 維持 CLI 預設埠。 */
export function rewriteEnvFilesForDbHost(
  targetDir: string,
  dbHost: DbHost | undefined,
  devPort?: number,
): void {
  if (dbHost !== 'existing-server') return
  const envTestComment =
    '# existing-server：測試 env 連已在跑的伺服器；不要填本機 Docker 54321 / 54322。CI e2e 另設 workflow env。\n'
  for (const name of ['.env.example', '.env', '.env.test'] as const) {
    const path = join(targetDir, name)
    if (!existsSync(path)) continue
    const before = readFileSync(path, 'utf8')
    let after = before
      .replaceAll(LOCAL_SUPABASE_URL, '')
      .replaceAll(LOCAL_DATABASE_URL, '')
      .replaceAll(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
        '',
      )
      .replaceAll(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
        '',
      )
      .replace(
        '# --- Supabase ---',
        '# --- Supabase ---\n# 連到已在跑的伺服器；不要填本機 Docker 54321 / 54322',
      )
    if (name === '.env.test' && !after.includes('不要填本機 Docker')) {
      after = envTestComment + after
    }
    if (typeof devPort === 'number') {
      after = after.replaceAll('http://localhost:3000', `http://localhost:${devPort}`)
    }
    if (after !== before) writeFileSync(path, after)
  }
  const gitignorePath = join(targetDir, '.gitignore')
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, 'utf8')
    if (!gitignore.includes('!.env.test')) {
      const next = gitignore.includes('!.env.example')
        ? gitignore.replace('!.env.example', '!.env.example\n!.env.test')
        : `${gitignore.trimEnd()}\n!.env.test\n`
      writeFileSync(gitignorePath, next)
    }
  }
}

export function rewriteFirstGlanceDocsForDbHost(
  targetDir: string,
  dbHost: DbHost | undefined,
  devPort?: number,
): void {
  if (dbHost !== 'existing-server') return
  const port = typeof devPort === 'number' ? String(devPort) : undefined
  const quick = join(targetDir, 'docs', 'verify', 'QUICK_START.md')
  if (existsSync(quick)) {
    const before = readFileSync(quick, 'utf8')
    let after = before
      .replace(
        '- Docker（Supabase 本地開發）\n- Supabase CLI（`brew install supabase/tap/supabase`）\n',
        '- 已在跑的開發資料庫（見 `docs/playbooks/01-dev-database.md`；不要本機 Docker）\n',
      )
      .replace(
        '- `SUPABASE_URL` / `SUPABASE_KEY` — 本地預設 `http://127.0.0.1:54321`',
        '- `SUPABASE_URL` / `SUPABASE_KEY` — 已在跑的伺服器，不要填本機 54321',
      )
      .replace(
        '### 3. 啟動 Supabase\n\n```bash\nsupabase start\nsupabase db reset  # 套用 migrations + seed\n```\n\n### 4. 產生 Types\n\n```bash\npnpm db:types\n```',
        '### 3. 連到已在跑的資料庫\n\n**NEVER** `supabase start`。跑 `docs/playbooks/01-dev-database.md`。\n\n### 4. 產生 Types\n\n空殼已在 `app/types/database.types.ts`。對既有伺服器不要 `supabase gen types --local`。',
      )
    if (port) after = after.replaceAll('localhost:3000', `localhost:${port}`)
    if (after !== before) writeFileSync(quick, after)
  }
  const checklist = join(targetDir, 'docs', 'NEW_PROJECT_CHECKLIST.md')
  if (existsSync(checklist)) {
    const before = readFileSync(checklist, 'utf8')
    let after = before
      .replace('啟動 Docker Desktop / OrbStack', 'N/A — existing-server 不要本機 Docker')
      .replace(
        '| `supabase start` 成功                | `supabase status --output json` 回傳 API_URL | `supabase start`                                                                       |',
        '| 連到已在跑的開發資料庫            | playbook 01 verified                                                                     | **NEVER** `supabase start`；跑 `docs/playbooks/01-dev-database.md`                    |',
      )
      .replace(
        '`supabase gen types typescript --local \\| tee app/types/database.types.ts > /dev/null`',
        'scaffold 已帶空殼；不要 `--local`',
      )
      .replace(
        '### Supabase 啟動失敗\n\n```bash\ndocker info               # 確認 daemon 在跑\nsupabase stop && supabase start\n```',
        '### 連不到開發資料庫\n\n跑 `docs/playbooks/01-dev-database.md`。**NEVER** 本機 `supabase start`。',
      )
      .replace(
        '4. **完整教學**：先看 [QUICK_START](verify/QUICK_START.md)，再用 `/opsx` 建立第一個需求',
        '4. **完整教學**：先看 [QUICK_START](verify/QUICK_START.md) 與 `docs/playbooks/01-dev-database.md`，再用 `/opsx` 建立第一個需求',
      )
    if (port) {
      after = after.replaceAll('localhost:3000', `localhost:${port}`)
      after = after.replaceAll('lsof -ti:3000', `lsof -ti:${port}`)
      after = after.replaceAll('pnpm dev --port 3001', `pnpm dev --port ${port}`)
    }
    if (after !== before) writeFileSync(checklist, after)
  }
  const envVars = join(targetDir, 'docs', 'verify', 'ENVIRONMENT_VARIABLES.md')
  if (existsSync(envVars)) {
    const before = readFileSync(envVars, 'utf8')
    let after = before.replace(
      '### 7.1 本地開發（Supabase CLI）\n\n```bash\n# Supabase（資料庫）\nSUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxxxxxx\nSUPABASE_SECRET_KEY=sb_secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxx\n',
      '### 7.1 連到已在跑的伺服器\n\n不要填本機 Docker 54321。見 `docs/playbooks/01-dev-database.md`。\n\n```bash\n# Supabase（已在跑的伺服器；不要填 54321）\nSUPABASE_URL=\nSUPABASE_KEY=\nSUPABASE_SECRET_KEY=\n',
    )
    if (port) after = after.replaceAll('localhost:3000', `localhost:${port}`)
    if (after !== before) writeFileSync(envVars, after)
  }
  const troubleshooting = join(targetDir, 'docs', 'TROUBLESHOOTING.md')
  if (existsSync(troubleshooting)) {
    const before = readFileSync(troubleshooting, 'utf8')
    let after = before.replace(
      '# 疑難排解指南\n\n依照「症狀」分類',
      '# 疑難排解指南\n\n> 本專案資料庫在已在跑的伺服器。**NEVER** `supabase start`。連線問題走 `docs/playbooks/01-dev-database.md`。下面「supabase start 失敗」那節不適用。\n\n依照「症狀」分類',
    )
    if (port) after = after.replaceAll('localhost:3000', `localhost:${port}`)
    if (after !== before) writeFileSync(troubleshooting, after)
  }
  const verifyReadme = join(targetDir, 'docs', 'verify', 'README.md')
  if (existsSync(verifyReadme)) {
    const before = readFileSync(verifyReadme, 'utf8')
    let after = before
      .replace(
        '> **迷路了？** 參考 [常見疑問集](../FAQ.md)。',
        '> **迷路了？** 參考 [QUICK_START](./QUICK_START.md)。',
      )
      .replace(
        'Migration 使用 Local-First 開發流程。',
        'Migration 對已在跑的伺服器；不要本機 Docker。',
      )
      .replace(
        ', [SELF_HOST_SUPABASE_RESILIENCE](./SELF_HOST_SUPABASE_RESILIENCE.md), [SELF_HOSTED_SUPABASE](./SELF_HOSTED_SUPABASE.md)',
        ', [SELF_HOSTED_SUPABASE](./SELF_HOSTED_SUPABASE.md)',
      )
      .replace(
        '   - 本機：`supabase db reset` → 重建資料庫 + 套用 migrations',
        '   - 已在跑的伺服器：見 `docs/playbooks/01-dev-database.md`；**NEVER** 本機 `supabase db reset`',
      )
      .replace(
        '| `supabase db reset` | 重建本機 Supabase                             |',
        '| playbook 01          | 連到已在跑的開發資料庫                       |',
      )
      .replace(
        '| 本機資料庫跑壞           | `supabase db reset`                                                               |',
        '| 連不到開發資料庫         | 跑 `docs/playbooks/01-dev-database.md`；**NEVER** 本機 `supabase db reset`           |',
      )
      .replace(
        '- 新進成員：依序閱讀 `README → WORKFLOW → AUTH_INTEGRATION → SUPABASE_*`，再開始開發。',
        '- 新進成員：依序閱讀 `QUICK_START → AUTH_INTEGRATION → SUPABASE_*`，再開始開發。',
      )
      .replace(
        '- 任何變更 Supabase schema 的 PR：務必附上 `supabase db reset` 可成功的證明。',
        '- 任何變更 Supabase schema 的 PR：附上已在跑的伺服器套用成功的證明；**NEVER** 本機 `supabase db reset`。',
      )
    if (after !== before) writeFileSync(verifyReadme, after)
  }
  const migrationGuide = join(targetDir, 'docs', 'verify', 'SUPABASE_MIGRATION_GUIDE.md')
  if (existsSync(migrationGuide)) {
    const before = readFileSync(migrationGuide, 'utf8')
    const after = before
      .replace(
        '1. **Local-First**：所有 migration 必須先在本地建立、測試通過後，才能 push 到 remote。禁止直接在 remote 建立 migration。',
        '1. **Existing-server**：在 repo 用 `supabase migration new` 建檔；套用走已在跑的伺服器。**NEVER** 本機 `supabase db reset` / `supabase gen types --local`。',
      )
      .replace(
        '# 3. 套用到本機\nsupabase db reset\n\n# 4. 安全檢查\nsupabase db lint --level warning\n\n# 5. 重新產生 TypeScript types\nsupabase gen types typescript --local | tee app/types/database.types.ts > /dev/null',
        '# 3. 套用到已在跑的伺服器（見 playbook 01 / `pnpm supabase:sync`）\n# NEVER 本機 supabase db reset\n\n# 4. 安全檢查（對已連上的伺服器）\nsupabase db lint --level warning\n\n# 5. Types：scaffold 已帶空殼；不要 --local',
      )
      .replace(
        '> ⚠️ **重要**：所有 migration 必須遵循 **Local → Test → Push** 流程。',
        '> ⚠️ **重要**：在 repo 建檔，套用走已在跑的伺服器。**NEVER** 本機 `supabase db reset`。',
      )
      .replace(
        '# 3. 本地測試\nsupabase db reset\nsupabase db lint --level warning\npnpm typecheck',
        '# 3. 對已在跑的伺服器驗證（playbook 01 / `pnpm supabase:sync`）\n# NEVER 本機 supabase db reset\nsupabase db lint --level warning\npnpm typecheck',
      )
      .replace(
        '- [ ] `supabase db reset` 能順利重建',
        '- [ ] 已在跑的伺服器套用成功（不要本機 `supabase db reset`）',
      )
    if (after !== before) writeFileSync(migrationGuide, after)
  }
  const checklistWorkflow = join(targetDir, 'docs', 'NEW_PROJECT_CHECKLIST.md')
  if (existsSync(checklistWorkflow)) {
    const before = readFileSync(checklistWorkflow, 'utf8')
    const after = before.replace(
      '- 詳見 [WORKFLOW.md](WORKFLOW.md) 與 root `CLAUDE.md`',
      '- 詳見 [QUICK_START](verify/QUICK_START.md) 與 root `CLAUDE.md`',
    )
    if (after !== before) writeFileSync(checklistWorkflow, after)
  }
  for (const name of ['CLAUDE.md', 'AGENTS.md'] as const) {
    const path = join(targetDir, name)
    if (!existsSync(path)) continue
    const before = readFileSync(path, 'utf8')
    const after = before
      .replace(
        'supabase db reset    # Reset + apply all migrations\n',
        '# NEVER 本機 supabase db reset；套用走 docs/playbooks/01-dev-database.md\n',
      )
      .replace(
        '- After migration: `supabase db reset` → `db lint` → `gen types` → `typecheck`',
        '- After migration: 對已在跑的伺服器套用；**NEVER** 本機 `supabase db reset` / `gen types --local`',
      )
      .replace(
        /\| Migration created\s+\|\s+`db reset` → `db lint` → `gen types` → `typecheck` \|/,
        '| Migration created | 對已在跑的伺服器套用 → lint → types → typecheck（NEVER 本機 db reset） |',
      )
    if (after !== before) writeFileSync(path, after)
  }
  const dbOpt = join(targetDir, 'docs', 'verify', 'DATABASE_OPTIMIZATION.md')
  if (existsSync(dbOpt)) {
    const before = readFileSync(dbOpt, 'utf8')
    const after = before.replace(
      '# 產生型別\nsupabase gen types typescript --local',
      '# 產生型別：existing-server 不要 --local；空殼已在 app/types/database.types.ts',
    )
    if (after !== before) writeFileSync(dbOpt, after)
  }
  const selfHosted = join(targetDir, 'docs', 'verify', 'SELF_HOSTED_SUPABASE.md')
  if (existsSync(selfHosted)) {
    const before = readFileSync(selfHosted, 'utf8')
    const after = before
      .replace(
        '# 3. 本地測試\nsupabase db reset\nsupabase db lint --level warning',
        '# 3. 套用走已在跑的伺服器（playbook 01）。NEVER 本機 supabase db reset\nsupabase db lint --level warning',
      )
      .replaceAll('"url": "http://localhost:54321/mcp"', '"url": "https://<existing-server>/mcp"')
    if (after !== before) writeFileSync(selfHosted, after)
  }
  const e2eYml = join(targetDir, '.github', 'workflows', 'e2e.yml')
  if (existsSync(e2eYml)) {
    const before = readFileSync(e2eYml, 'utf8')
    if (before.includes('supabase start') && !before.includes('本機 NEVER supabase start')) {
      const after = before.replace(
        /^(name: E2E Tests\n)/m,
        '$1# existing-server：GitHub-hosted runner 上的 ephemeral Docker 才 supabase start。本機 NEVER supabase start。見 docs/playbooks/01-dev-database.md。\n',
      )
      if (after !== before) writeFileSync(e2eYml, after)
    }
  }
  const ciYml = join(targetDir, '.github', 'workflows', 'ci.yml')
  if (existsSync(ciYml)) {
    const before = readFileSync(ciYml, 'utf8')
    if (before.includes('supabase start') && !before.includes('本機 NEVER supabase start')) {
      const after = before.replace(
        /^(name: CI\n)/m,
        '$1# existing-server：本 job 不啟動資料庫。本機 NEVER supabase start。見 docs/playbooks/01-dev-database.md。\n',
      )
      if (after !== before) writeFileSync(ciYml, after)
    }
  }
  const configToml = join(targetDir, 'supabase', 'config.toml')
  if (existsSync(configToml)) {
    const before = readFileSync(configToml, 'utf8')
    if (before.includes('54321') && !before.includes('本機 NEVER supabase start')) {
      writeFileSync(
        configToml,
        `# existing-server：CLI 預設埠，不是本機開發 URL。本機 NEVER supabase start。見 docs/playbooks/01-dev-database.md。\n${before}`,
      )
    }
  }
  rewriteMcpJsonForDbHost(targetDir, dbHost)
  rewriteSettingsForDbHost(targetDir, dbHost)
  rewriteAgentProjectionsForDbHost(targetDir, dbHost)
  stripOrphanPostMigrationHook(targetDir, dbHost)
}

function stripLocalSupabaseMcpFile(path: string): void {
  if (!existsSync(path)) return
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      mcpServers?: Record<string, unknown>
    }
    if (!parsed.mcpServers?.['local-supabase']) return
    delete parsed.mcpServers['local-supabase']
    writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`)
  } catch {
    // JSON 壞掉時其他檢查會報
  }
}

function rewriteMcpJsonForDbHost(targetDir: string, dbHost: DbHost | undefined): void {
  if (dbHost !== 'existing-server') return
  const rootMcp = join(targetDir, '.mcp.json')
  const cursorMcp = join(targetDir, '.cursor', 'mcp.json')
  stripLocalSupabaseMcpFile(rootMcp)
  // assemble 先拷 starter 的 .cursor/mcp.json；sync-to-cursor 又在本函式之前跑，
  // 且 settings 當時只 enable local-supabase → Cursor 投影會只剩 54321。
  // 改完根檔後鏡過去，Cursor 才看得到剩下的 server。
  stripLocalSupabaseMcpFile(cursorMcp)
  if (existsSync(rootMcp)) {
    mkdirSync(join(targetDir, '.cursor'), { recursive: true })
    writeFileSync(cursorMcp, readFileSync(rootMcp, 'utf8'))
  }
}

function rewriteSettingsForDbHost(targetDir: string, dbHost: DbHost | undefined): void {
  if (dbHost !== 'existing-server') return
  const path = join(targetDir, '.claude', 'settings.json')
  if (!existsSync(path)) return
  try {
    const settings = JSON.parse(readFileSync(path, 'utf8')) as {
      enabledMcpjsonServers?: string[]
      permissions?: { allow?: string[] }
      hooks?: { PostToolUse?: Array<{ matcher?: string; hooks?: unknown }> }
    }
    if (Array.isArray(settings.enabledMcpjsonServers)) {
      settings.enabledMcpjsonServers = settings.enabledMcpjsonServers.filter(
        (name) => name !== 'local-supabase',
      )
      if (settings.enabledMcpjsonServers.length === 0) delete settings.enabledMcpjsonServers
    }
    if (Array.isArray(settings.permissions?.allow)) {
      settings.permissions.allow = settings.permissions.allow.filter(
        (item) => !item.startsWith('mcp__local-supabase__'),
      )
    }
    if (Array.isArray(settings.hooks?.PostToolUse)) {
      settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
        (item) => item.matcher !== 'mcp__local-supabase__apply_migration',
      )
    }
    writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`)
  } catch {
    // JSON 壞掉時其他檢查會報
  }
}

/**
 * hub:prune / rewriteSettings 只動 `.claude/`。sync-to-codex / sync-to-cursor
 * 若在那之前跑完，`.codex/config.toml`、`.codex/hooks.json`、`.cursor/cli.json`
 * 會留下 local-supabase（54321 MCP）與 starter 快照的 enabledPlugins。
 * --no-install 不會再投影，這裡直接清 MCP；完整 scaffold 在收尾再重投影一次。
 */
function rewriteAgentProjectionsForDbHost(targetDir: string, dbHost: DbHost | undefined): void {
  if (dbHost !== 'existing-server') return
  const configToml = join(targetDir, '.codex', 'config.toml')
  if (existsSync(configToml)) {
    const before = readFileSync(configToml, 'utf8')
    const after = before.replace(
      /^enabledMcpjsonServers\s*=\s*\[([^\]]*)\]\s*$/m,
      (_all, inner: string) => {
        const kept = inner
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0 && !item.includes('local-supabase'))
        return kept.length === 0 ? '' : `enabledMcpjsonServers = [${kept.join(', ')}]`
      },
    )
    if (after !== before) writeFileSync(configToml, after)
  }
  const codexHooks = join(targetDir, '.codex', 'hooks.json')
  if (existsSync(codexHooks)) {
    try {
      const parsed = JSON.parse(readFileSync(codexHooks, 'utf8')) as {
        hooks?: { PostToolUse?: Array<{ matcher?: string }> }
      }
      if (Array.isArray(parsed.hooks?.PostToolUse)) {
        parsed.hooks.PostToolUse = parsed.hooks.PostToolUse.filter(
          (item) => item.matcher !== 'mcp__local-supabase__apply_migration',
        )
        writeFileSync(codexHooks, `${JSON.stringify(parsed, null, 2)}\n`)
      }
    } catch {
      // JSON 壞掉時其他檢查會報
    }
  }
  const cursorCli = join(targetDir, '.cursor', 'cli.json')
  if (existsSync(cursorCli)) {
    try {
      const parsed = JSON.parse(readFileSync(cursorCli, 'utf8')) as {
        permissions?: { allow?: string[] }
      }
      if (Array.isArray(parsed.permissions?.allow)) {
        parsed.permissions.allow = parsed.permissions.allow.filter(
          (item) => !item.includes('local-supabase'),
        )
        writeFileSync(cursorCli, `${JSON.stringify(parsed, null, 2)}\n`)
      }
    } catch {
      // JSON 壞掉時其他檢查會報
    }
  }
}

const POST_MIGRATION_HOOK = 'post-migration-gen-types.sh'

function unlinkIfExists(path: string): void {
  if (!existsSync(path)) return
  try {
    unlinkSync(path)
  } catch {
    // 刪不掉時其他檢查會報
  }
}

/**
 * existing-server 已剝 apply_migration matcher：磁碟若還留這支 hook，
 * 讀起來像還會在 migration 後跑。從 .claude / .codex 刪掉，並從 hub.json
 * localHooks 拿掉，後續投影才不會再拷回去。
 */
export function stripOrphanPostMigrationHook(targetDir: string, dbHost: DbHost | undefined): void {
  if (dbHost !== 'existing-server') return
  unlinkIfExists(join(targetDir, '.claude', 'hooks', POST_MIGRATION_HOOK))
  unlinkIfExists(join(targetDir, '.codex', 'hooks', POST_MIGRATION_HOOK))
  const hubPath = join(targetDir, '.claude', 'hub.json')
  if (!existsSync(hubPath)) return
  try {
    const hub = JSON.parse(readFileSync(hubPath, 'utf8')) as { localHooks?: string[] }
    if (!Array.isArray(hub.localHooks)) return
    const next = hub.localHooks.filter((name) => name !== POST_MIGRATION_HOOK)
    if (next.length === hub.localHooks.length) return
    hub.localHooks = next
    writeFileSync(hubPath, `${JSON.stringify(hub, null, 2)}\n`)
  } catch {
    // JSON 壞掉時其他檢查會報
  }
}

function packageUsesNuxtAuthUtilsOnly(targetDir: string): boolean {
  const pkgPath = join(targetDir, 'package.json')
  if (!existsSync(pkgPath)) return false
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const deps = pkg.dependencies ?? {}
  return Boolean(deps['nuxt-auth-utils'] && !deps['@nuxtjs/better-auth'])
}

/** 選了 nuxt-auth-utils 時，第一眼文件不要還寫 better-auth。 */
export function rewriteFirstGlanceAuthDocs(targetDir: string): void {
  if (!packageUsesNuxtAuthUtilsOnly(targetDir)) return
  const verifyReadme = join(targetDir, 'docs', 'verify', 'README.md')
  if (existsSync(verifyReadme)) {
    const before = readFileSync(verifyReadme, 'utf8')
    const after = before
      .replaceAll('使用 `@nuxtjs/better-auth` 進行認證', '使用 `nuxt-auth-utils` 進行認證')
      .replaceAll('（認證使用 `@nuxtjs/better-auth`）', '（認證使用 `nuxt-auth-utils`）')
      .replace(
        "OAuth 登入：透過 `useSignIn('social').execute({ provider: 'google' })` 等方式",
        "OAuth 登入：`navigateTo('/auth/google', { external: true })`",
      )
    if (after !== before) writeFileSync(verifyReadme, after)
  }
  const screenshot = join(targetDir, 'docs', 'verify', 'SCREENSHOT_GUIDE.md')
  if (existsSync(screenshot)) {
    const before = readFileSync(screenshot, 'utf8')
    const after = before
      .replace(
        '- 測試帳號（`E2E_USER_EMAIL` / `E2E_USER_PASSWORD` 環境變數，或 `.env` 中的值）',
        '- Google OAuth client（見 `docs/verify/OAUTH_SETUP.md`）',
      )
      .replace(
        `本專案使用 better-auth，支援 email/password 登入。browser-use 可直接填表登入：

\`\`\`bash
# 1. 開啟登入頁
browser-use open "http://localhost:3000/auth/login"

# 2. 取得表單元素 index
browser-use state

# 3. 填入帳號密碼
browser-use input <email-index> "test@example.com"
browser-use input <password-index> "password"

# 4. 點擊登入
browser-use click <submit-index>
\`\`\``,
        `本專案使用 nuxt-auth-utils，登入是 Google OAuth（沒有 email/password 表單）。

\`\`\`bash
# 1. 開啟登入頁
browser-use open "http://localhost:3000/auth/login"

# 2. 點「使用 Google 登入」（OAuth 見 docs/verify/OAUTH_SETUP.md）
browser-use state
browser-use click <google-button-index>
\`\`\``,
      )
    if (after !== before) writeFileSync(screenshot, after)
  }
  const envVars = join(targetDir, 'docs', 'verify', 'ENVIRONMENT_VARIABLES.md')
  if (existsSync(envVars)) {
    const before = readFileSync(envVars, 'utf8')
    const after = before
      .replace(
        '本系統使用 **@nuxtjs/better-auth** 進行認證：',
        '本系統使用 **nuxt-auth-utils** 進行認證：',
      )
      .replace(
        "使用者 → useSignIn('social').execute({ provider: 'google' }) → OAuth Provider",
        "使用者 → navigateTo('/auth/google', { external: true }) → OAuth Provider",
      )
    if (after !== before) writeFileSync(envVars, after)
  }
  const authIntegration = join(targetDir, 'docs', 'verify', 'AUTH_INTEGRATION.md')
  if (existsSync(authIntegration)) {
    const before = readFileSync(authIntegration, 'utf8')
    const after = before
      .replace(
        '此專案支援兩種認證方案，建立專案時二擇一。兩者皆透過 `useUserSession()` 提供統一的 client 端體驗。',
        '本專案已選 **nuxt-auth-utils**。下面比較表是另一種方案的對照，不是還要再選一次。標「另一方案（本專案未採用）」的段落不是現況。兩者皆透過 `useUserSession()` 提供統一的 client 端體驗。',
      )
      .replace('**better-auth 額外檔案：**', '**另一方案（本專案未採用）會有的檔案：**')
      .replaceAll('**better-auth', '**另一方案（本專案未採用）— better-auth')
      .replace(
        '### 4.2. nuxt.config.ts（better-auth only）',
        '### 4.2. nuxt.config.ts（另一方案，本專案未採用）',
      )
    if (after !== before) writeFileSync(authIntegration, after)
  }
  const checklist = join(targetDir, 'docs', 'NEW_PROJECT_CHECKLIST.md')
  if (existsSync(checklist)) {
    const before = readFileSync(checklist, 'utf8')
    const after = before
      .replace(
        'nuxt-better-auth, supabase-rls, supabase-migration,',
        'nuxt-auth-utils, supabase-rls, supabase-migration,',
      )
      .replace(
        '3. **OAuth**（如選了 better-auth / nuxt-auth-utils）：去 provider console 申請 credentials → 填 `.env`（**人類執行，AI 不代填**）',
        '3. **OAuth**（本專案是 nuxt-auth-utils / Google）：去 provider console 申請 credentials → 填 `.env`（**人類執行，AI 不代填**）',
      )
    if (after !== before) writeFileSync(checklist, after)
  }
  const checkSkills = join(targetDir, 'scripts', 'check-skills.sh')
  if (existsSync(checkSkills)) {
    const before = readFileSync(checkSkills, 'utf8')
    const after = before.replace('nuxt-better-auth', 'nuxt-auth-utils')
    if (after !== before) writeFileSync(checkSkills, after)
  }
  const securityMd = join(targetDir, 'SECURITY.md')
  if (existsSync(securityMd)) {
    const before = readFileSync(securityMd, 'utf8')
    const after = before
      .replace(
        '- `server/api/v1/profiles/**`：已登入使用者的 profile 讀取（`index`、`me`、`[id]`）',
        '- 本專案組裝後沒有 `server/api/v1/profiles/**`；新 handler 先補本節再實作',
      )
      .replace(
        '- `server/api/auth/**`（Better Auth handler）：登入 / 登出 / OAuth callback（Google / LINE / GitHub）',
        '- `server/routes/auth/google.get.ts`（nuxt-auth-utils Google OAuth）',
      )
      .replace(
        "  - `server/api/_dev/login.post.ts`：dev-only 身分切換，`nuxt dev` 以外回 404；`as: 'admin'` 需 email 在 `ADMIN_EMAIL_ALLOWLIST`",
        '  - `server/routes/auth/_dev-login.get.ts`：dev-only GET `?as=` / `?email=`，`import.meta.dev` 以外不進 production bundle',
      )
      .replace(
        '  - Better Auth OAuth callback：只接受 provider 簽回的 code，不接受 client 自帶身分',
        '  - Google OAuth callback：只接受 provider 簽回的 code，不接受 client 自帶身分',
      )
      .replace(
        '- session：Better Auth cookie session；`requireAuth(event)` 是每個需登入 handler 的第一行',
        '- session：nuxt-auth-utils cookie session（`useUserSession` / `requireUserSession`）',
      )
      .replace(
        '`BETTER_AUTH_SECRET`、`NUXT_SESSION_PASSWORD`、`NUXT_OAUTH_GOOGLE_CLIENT_SECRET`、`NUXT_OAUTH_LINE_CLIENT_SECRET`、`NUXT_OAUTH_GITHUB_CLIENT_SECRET`、`SENTRY_AUTH_TOKEN`、`NUXT_DEV_LOGIN_PASSWORD`',
        '`NUXT_SESSION_PASSWORD`、`NUXT_OAUTH_GOOGLE_CLIENT_SECRET`、`SENTRY_AUTH_TOKEN`',
      )
    if (after !== before) writeFileSync(securityMd, after)
  }
}

/** 新專案沒有產品 README 時補一份；既有 repo 的 README 不動。 */
export function maybeWriteRootReadme(
  targetDir: string,
  projectName: string,
  dbHost: DbHost | undefined,
): void {
  const path = join(targetDir, 'README.md')
  if (existsSync(path)) return
  const dbLine =
    dbHost === 'existing-server'
      ? '開發資料庫在已在跑的伺服器。**NEVER** 本機 `supabase start` / `supabase db reset`。下一步：`docs/playbooks/01-dev-database.md`。'
      : '見 `docs/verify/QUICK_START.md`。'
  writeFileSync(
    path,
    `# ${projectName}\n\n${dbLine}\n\n## Getting Started\n\n\`\`\`bash\npnpm install\ncp .env.example .env\npnpm dev\n\`\`\`\n\n完整步驟：[\`docs/verify/QUICK_START.md\`](docs/verify/QUICK_START.md)\n`,
  )
}

/** 有明確 --dev-port 時，第一眼檔與 Playwright 不要還寫 3000。 */
export function rewriteGeneratedPort(targetDir: string, devPort?: number): void {
  if (typeof devPort !== 'number') return
  const port = String(devPort)
  const files = [
    join(targetDir, 'docs', 'verify', 'QUICK_START.md'),
    join(targetDir, 'docs', 'NEW_PROJECT_CHECKLIST.md'),
    join(targetDir, 'docs', 'verify', 'OAUTH_SETUP.md'),
    join(targetDir, 'docs', 'verify', 'ENVIRONMENT_VARIABLES.md'),
    join(targetDir, 'docs', 'verify', 'SCREENSHOT_GUIDE.md'),
  ]
  for (const path of files) {
    if (!existsSync(path)) continue
    const before = readFileSync(path, 'utf8')
    const after = before
      .replaceAll('localhost:3000', `localhost:${port}`)
      .replaceAll('預設 port 3000', `預設 port ${port}`)
    if (after !== before) writeFileSync(path, after)
  }
  const playwright = join(targetDir, 'playwright.config.ts')
  if (existsSync(playwright)) {
    const before = readFileSync(playwright, 'utf8')
    const after = before
      .replaceAll('http://localhost:3000', `http://localhost:${port}`)
      .replaceAll('port: 3000', `port: ${port}`)
    if (after !== before) writeFileSync(playwright, after)
  }
  const pkgPath = join(targetDir, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        scripts?: Record<string, string>
      }
      const dev = pkg.scripts?.dev
      if (dev) {
        const next = /--port[= ]\d+/.test(dev)
          ? dev.replace(/--port[= ]\d+/, `--port ${port}`)
          : `${dev} --port ${port}`
        if (next !== dev) {
          pkg.scripts = { ...pkg.scripts, dev: next }
          writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
        }
      }
    } catch {
      // package.json 壞掉時其他檢查會報
    }
  }
}

export async function postScaffold(
  targetDir: string,
  projectName: string,
  invocationCwd: string,
  cladeModules: CladeModules,
  opts: PostScaffoldOptions,
): Promise<void> {
  // Use the user's actual cwd for the cd hint, not invocationCwd
  // (which may differ when running inside the monorepo).
  // NEVER 退回 process.env.PWD：那是呼叫者 shell 的值，不隨 spawn 的 cwd 改變，
  // 會讓 cd 提示指到完全無關的目錄（TD-007，與 cli.ts detectMonorepoRoot 同型）。
  const userCwd = process.env.INIT_CWD?.trim() || process.cwd()
  const relativeTargetDir = relative(userCwd, targetDir) || '.'

  // 1. Register as clade consumer — rewrite .claude/hub.json with the
  //    selected modules and inject postinstall + hub:* scripts into
  //    package.json. --no-bootstrap defers the heavy sync to pnpm install.
  //    If clade is missing, may attempt to git clone it (controlled by opts.cloneClade).
  const cladeRoot = await runInitConsumer(targetDir, cladeModules, opts)

  // 2. Install dependencies — postinstall hook runs clade bootstrap-hub
  //    which pulls fresh rules / skills / hooks / scripts into .claude/.
  //
  // pnpm v11 對「未表態的 build script」是 abort（退出碼 1），不是警告。未表態的套件
  // 會被 pnpm 自己寫進 pnpm-workspace.yaml 的 allowBuilds，值是佔位字串
  // `set this to true or false`。原本這裡的 retry 建立在「第一次只是警告、retry 必通過」
  // 的假設上 —— 實測是錯的：兩次都以同一個原因退出 1，而套件其實已經裝好了。
  // 所以 retry 保留（真的有瞬時失敗），但失敗後 MUST 分辨這一種：它不是安裝失敗。
  // 三態：true / undefined 都要裝，只有顯式 false 才跳過。
  const skipInstall = opts.installDeps === false
  let pnpmInstalled = false
  if (skipInstall) {
    consola.info('已跳過依賴安裝（--no-install）。')
    consola.log(`  需要時手動執行：cd ${relativeTargetDir} && pnpm install`)
  } else {
    consola.start('正在安裝依賴套件...')
    for (const attempt of [1, 2]) {
      try {
        execFileSync('pnpm', ['install'], { cwd: targetDir, stdio: 'inherit' })
        consola.success('依賴套件安裝完成！')
        pnpmInstalled = true
        break
      } catch (error) {
        const pending = readPendingBuildApprovals(targetDir)
        if (pending.length > 0) {
          consola.warn('pnpm 因為有未表態的 build script 而退出，依賴其實已經裝好。')
          consola.log(`  待表態：${pending.join(', ')}`)
          consola.log(`  修法：編輯 ${relativeTargetDir}/pnpm-workspace.yaml 的 allowBuilds，`)
          consola.log('        把上面每個 key 的值從佔位字串改成 true（或 false）。')
          consola.log('  這通常代表 starter 的 allowBuilds 預設清單少了東西，值得回報。')
          pnpmInstalled = true
          break
        }
        if (attempt === 1) {
          consola.warn('第一次 pnpm install 失敗，自動 retry 一次...')
          continue
        }
        consola.warn(`依賴套件安裝失敗：${(error as Error).message}`)
        consola.log(`  上方為 pnpm 實際輸出；修正後手動執行：`)
        consola.log(`  cd ${relativeTargetDir} && pnpm install`)
      }
    }
  }

  // 3. Prune orphan rules — bootstrap pulls all variant rules，但本專案
  //    選的 modules 可能不需要某些 rule（例如 auth=nuxt-auth-utils 不需要
  //    通用 auth.md），讓 hub:check 結束時直接全綠。
  if (pnpmInstalled) {
    runHubPrune(targetDir)
  }

  // 4. Agent 投影改到 rewriteFirstGlance 之後（settings / MCP 已依 dbHost 收斂）。
  //    prune 後立刻投影會把還沒剝掉的 local-supabase 寫進 .codex/config.toml
  //    與 .cursor/cli.json。
  if (!pnpmInstalled) {
    if (skipInstall) {
      consola.info('略過 sync-to-agents（依賴未安裝）。裝完依賴後手動：')
    } else {
      consola.warn('略過 sync-to-agents — 請在 pnpm install 成功後手動：')
    }
    consola.log(`  cd ${relativeTargetDir} && node ~/.claude/scripts/sync-to-codex.mjs`)
  }

  // 4.5 Typecheck — scaffold 的自我驗證。在此之前沒有任何一步確認「產出的專案編得過」，
  //     而 scaffold 最容易壞的正是模板與套件版本脫節（feature 組合是動態的，模板是靜態的）。
  //     失敗不中止：檔案都已落地，使用者需要的是知道哪裡壞了，不是回到零。
  if (pnpmInstalled) {
    consola.start('驗證產出的專案編得過（pnpm typecheck）...')
    try {
      execFileSync('pnpm', ['typecheck'], { cwd: targetDir, stdio: 'inherit' })
      consola.success('typecheck 通過。')
    } catch {
      consola.warn('typecheck 沒過 —— scaffold 產出的專案有型別錯誤。')
      consola.log('  上方為 tsc 實際輸出。這代表模板與當前套件版本脫節，值得回報。')
      consola.log(`  重跑：cd ${relativeTargetDir} && pnpm typecheck`)
    }
  }

  // 5. git init（先不 commit：husky / playbooks / vendor 都還會寫檔）
  const adoptingRepo = opts.existingGitRepo === true
  try {
    if (!adoptingRepo) {
      consola.start('正在初始化 Git...')
      execFileSync('git', ['init'], { cwd: targetDir, stdio: 'pipe' })
    }
  } catch {
    consola.warn('Git 初始化失敗，請手動執行。')
  }

  if (cladeRoot) {
    maybeWriteConsumerMeta(cladeRoot, targetDir, opts.devPort)
  }

  // 6. Register as clade consumer (idempotent; opt-out via --no-register-consumer)
  let consumerRegistered = false
  if (cladeRoot && opts.registerConsumer) {
    consumerRegistered = await maybeRegisterConsumer(cladeRoot, targetDir, opts)
  }

  // 6b. Mint gate playbook pack（缺才寫）。template 已帶一份 placeholder pack；
  // clade 有 mint script 時再填 consumer / port。沒有 script（尚未 publish）不算失敗。
  if (cladeRoot) {
    maybeMintGatePlaybooks(cladeRoot, targetDir, opts)
  }

  if (cladeRoot) {
    maybeSyncVendor(cladeRoot, targetDir)
  }

  // 7. Wire pre-commit hook (idempotent; opt-out via --no-wire-pre-commit)
  let preCommitWired = false
  if (cladeRoot && opts.wirePreCommit) {
    preCommitWired = await maybeWirePreCommit(cladeRoot, targetDir, opts.yes)
  }

  if (pnpmInstalled) {
    try {
      execFileSync('pnpm', ['exec', 'vp', 'fmt'], { cwd: targetDir, stdio: 'pipe' })
    } catch {
      consola.warn('scaffold 收尾 vp fmt 失敗 — 第一次 pnpm check 可能會改寫檔案')
    }
  }

  writeScaffoldAnswers(targetDir, opts.dbHost)
  rewriteEnvFilesForDbHost(
    targetDir,
    opts.dbHost,
    typeof opts.devPort === 'number' ? opts.devPort : undefined,
  )
  rewriteFirstGlanceDocsForDbHost(
    targetDir,
    opts.dbHost,
    typeof opts.devPort === 'number' ? opts.devPort : undefined,
  )
  rewriteFirstGlanceAuthDocs(targetDir)
  maybeWriteRootReadme(targetDir, projectName, opts.dbHost)
  rewriteGeneratedPort(targetDir, typeof opts.devPort === 'number' ? opts.devPort : undefined)

  // prune 只清 .claude/；settings/MCP strip 也只清 .claude/ + 根 .mcp.json。
  // 這裡一律重投影，不看 agentTargets（Round 29 leftover：沒選 cursor 仍留下
  // 錯 stack .cursor/rules；Round 30：沒重跑就把 local-supabase 留在 Codex/Cursor）。
  if (pnpmInstalled) {
    runSyncToAgents(targetDir)
    runSyncToCursor(targetDir)
    // 重投影可能從 leftover 再拷 hook 檔；matcher 已剝就再刪一次。
    stripOrphanPostMigrationHook(targetDir, opts.dbHost)
  }

  consola.start(adoptingRepo ? '正在提交 starter 檔案...' : '正在提交 initial scaffold...')
  try {
    execFileSync('git', ['add', '-A'], { cwd: targetDir, stdio: 'pipe' })
    execFileSync(
      'git',
      [
        'commit',
        '-m',
        adoptingRepo
          ? 'chore: scaffold nuxt starter into existing repo'
          : 'chore: initial project scaffold',
      ],
      { cwd: targetDir, stdio: 'pipe', env: { ...process.env, HUSKY: '0' } },
    )
    consola.success(adoptingRepo ? 'starter 檔案已提交（既有歷史保留）！' : 'Git 初始化完成！')
  } catch {
    consola.warn(adoptingRepo ? 'Git 提交失敗，請手動執行。' : 'Git 提交失敗，請手動執行。')
  }

  // 8. Write .claude/.first-run marker — AI session 第一次進此專案時讀此檔，
  //    觸發 verify:starter + OPSX list 暖機，跑完自行刪 marker。
  //    詳見 docs/AGENTS.md「第一次進此 session 該做什麼」。
  writeFirstRunMarker(targetDir, projectName, cladeModules)

  // 9. Display next steps
  const nextSteps = [
    `專案 ${projectName} 建立完成！`,
    `路徑：${targetDir}`,
    '',
    '接下來：',
    `  cd ${relativeTargetDir}`,
  ]

  // 收尾步驟 MUST 依 dbStack 分流到底：`scripts/setup.sh` 會檢查 Supabase CLI，
  // 找不到就直接中止。把它端給沒有 Supabase 的軌（void-d1 / nuxthub-d1），使用者
  // 會照著撞牆，然後以為是 scaffold 壞了。
  const resolvedDbStack = opts.dbStack ?? DEFAULT_DB_STACK
  if (resolvedDbStack === 'nuxthub-d1') {
    nextSteps.push(
      '  npx nuxthub link        # 連結 NuxtHub project',
      '  pnpm hub:db:migrations:apply --local',
      '  pnpm dev                # 啟動本機開發伺服器',
      '  pnpm verify:starter     # 檢查 scaffold 狀態',
    )
  } else if (resolvedDbStack === 'void-d1') {
    // 這條軌沒有 Supabase：D1 由 void 託管，schema 走 `void/db`。
    nextSteps.push(
      '  npx void init --agents   # 必要：產生 void.json / wrangler.jsonc（詳見下方警告）',
      '  pnpm dev                 # 啟動開發伺服器',
      '  pnpm verify:starter      # 檢查 scaffold 狀態',
    )
  } else {
    nextSteps.push(
      ...resolveSupabaseDevNextSteps({
        dbHost: opts.dbHost,
        dbRuntime: cladeModules.dbRuntime,
      }),
    )
  }

  if (cladeRoot && !consumerRegistered) {
    nextSteps.push(
      '',
      '尚未完成 Clade fleet 登記；請從 Clade 執行 project-bootstrap：',
      `  cd ${cladeRoot}`,
      `  /project-bootstrap adopt --consumer "${targetDir}" --repo-id <owner/repo> --dev-port <port>`,
    )
  }

  if (cladeRoot && !preCommitWired) {
    nextSteps.push(
      '',
      '選用 — wire pre-commit hook（擋掉 clade-managed 檔的本地誤改）：',
      `  cp ${cladeRoot}/vendor/git-pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`,
      '  # 或（已用 husky）：echo "pnpm hub:check" >> .husky/pre-commit',
    )
  }

  consola.log('')
  consola.box(nextSteps.join('\n'))

  // void 的 config 與 compatibility 設定跟 `void` npm package 版本鎖步，所以 starter
  // 刻意不產 void.json / wrangler.jsonc —— 抄某個時點的值進模板會變成會過期的地雷。
  // 代價是 scaffold 完還缺一步，而這一步缺了會在**部署當下**才炸。
  // 用 warn 不用 info、也不放進上面的 box：box 讀起來像補充說明，這是缺一步。
  if (opts.deployTarget === 'void') {
    consola.log('')
    consola.warn('void.cloud：還差一步，現在還不能部署')
    consola.log(`  cd ${relativeTargetDir} && npx void init --agents`)
    consola.log('')
    consola.log('  它會產生當前版本正確的 wrangler.jsonc，並裝上官方 void skill + MCP')
    consola.log('  （agent 之後查 void 用法的權威來源）。')
    consola.log('  nuxt.config 的 voidPlugin() 接線由 scaffold 直接寫好了 —— void init 不做這件事')
    consola.log('  （void 0.10.12 實測），也不產 void.json。')
    consola.log('')
    consola.log('  接著把 repo 連到 void project（staging / production 各做一次）：')
    consola.log('    void github connect <staging-slug> --repo <owner/repo> --branch main \\')
    consola.log('      --executor github_actions --workflow .github/workflows/deploy-staging.yml')
    consola.log('    void github connect <prod-slug> --repo <owner/repo> --branch main \\')
    consola.log(
      '      --executor github_actions --workflow .github/workflows/deploy-production.yml',
    )
    consola.log('')
    consola.log('  最後在 GitHub 設 repository variables（不是 secrets）：')
    consola.log('    VOID_PROJECT_STAGING / VOID_PROJECT')
    consola.log('  部署認證走 GitHub OIDC，沒有 token 要保管。')
  }
}

export function buildRegisterConsumerArgs(
  script: string,
  targetDir: string,
  repoId: string,
  workflowModel: 'trunk-based' | 'pr-merge-based',
  businessActivity: 'pre-production' | 'active' | 'maintenance' | 'paused' | 'auto',
  devPort: number | 'auto',
  extras?: {
    deployTrack?: PostScaffoldOptions['deployTrack']
    dbRuntime?: PostScaffoldOptions['dbRuntime']
  },
): string[] {
  const args = [
    script,
    '--consumer',
    targetDir,
    '--repo-id',
    repoId,
    '--workflow-model',
    workflowModel,
    '--business-activity',
    businessActivity,
    '--dev-port',
    String(devPort),
  ]
  if (extras?.deployTrack) {
    args.push('--deploy-track', extras.deployTrack)
  }
  if (extras?.dbRuntime) {
    args.push('--db-runtime', extras.dbRuntime)
  }
  return args
}

export function buildMintGatePlaybooksArgs(
  script: string,
  targetDir: string,
  consumerSlug: string,
  devPort?: number | 'auto',
): string[] {
  const args = [script, '--consumer-root', targetDir, '--consumer', consumerSlug]
  if (typeof devPort === 'number') {
    args.push('--dev-port', String(devPort), '--oauth-origin', `http://127.0.0.1:${devPort}`)
  }
  return args
}

/** Strip 掉 starter 自己的 consumer-meta 之後，用這個 repo 的身分重產一份。 */
export function maybeWriteConsumerMeta(
  cladeRoot: string,
  targetDir: string,
  devPort?: number | 'auto',
): boolean {
  const script = join(cladeRoot, 'scripts', 'scaffold-consumer-meta.ts')
  if (!existsSync(script)) {
    consola.info('Clade checkout 尚無 scaffold-consumer-meta.ts — 略過 consumer-meta')
    return false
  }
  const args = [script, targetDir, '--write', '--force']
  if (typeof devPort === 'number') args.push('--dev-port', String(devPort))
  try {
    execFileSync('node', args, {
      cwd: targetDir,
      stdio: 'pipe',
    })
    consola.success('consumer-meta 已依本 repo 身分寫入')
    return true
  } catch (error) {
    consola.warn(`寫入 consumer-meta 失敗：${(error as Error).message}`)
    return false
  }
}

/** hub:vendor 在 initial commit 之後跑會留下整棵 vendor/ untracked。 */
export function maybeSyncVendor(cladeRoot: string, targetDir: string): boolean {
  const script = join(cladeRoot, 'scripts', 'sync-vendor.ts')
  if (!existsSync(script)) {
    consola.info('Clade checkout 尚無 sync-vendor.ts — 略過 vendor 投影')
    return false
  }
  try {
    execFileSync('node', [script], { cwd: targetDir, stdio: 'pipe' })
    consola.success('vendor 投影已寫入')
    return true
  } catch (error) {
    consola.warn(`vendor 投影失敗：${(error as Error).message}`)
    return false
  }
}

export function maybeMintGatePlaybooks(
  cladeRoot: string,
  targetDir: string,
  opts: Pick<PostScaffoldOptions, 'devPort'>,
): boolean {
  const script = join(cladeRoot, 'scripts', 'mint-gate-playbooks.ts')
  if (!existsSync(script)) {
    consola.info('Clade checkout 尚無 mint-gate-playbooks.ts — 使用 template 內建 pack')
    return false
  }
  const args = buildMintGatePlaybooksArgs(script, targetDir, basename(targetDir), opts.devPort)
  try {
    execFileSync('node', args, { cwd: cladeRoot, stdio: 'pipe' })
    consola.success('gate playbook pack 已 mint（缺才寫）')
    return true
  } catch (error) {
    consola.warn(`mint gate playbook pack 失敗：${(error as Error).message}`)
    return false
  }
}

export interface PreflightOutcome {
  status: 'ok' | 'skipped' | 'rejected'
  reason?: string
}

/**
 * Scaffold **之前**問 Clade：「這個位置 / 身分 / port 登記得進去嗎？」
 *
 * 沒有這一步時，fleet base 這類約束要等整個 scaffold + pnpm install 跑完
 * （實測數分鐘）才在最後一步 warn，而那時專案已經建在錯的位置上了。
 *
 * 判準交給 Clade 的 register-consumer.ts --preflight，**NEVER** 在這裡重寫
 * fleet base 的計算 —— 兩份會漂，而漂掉的那份不會有任何訊號。
 */
export function preflightCladeRegistration(
  cladeRoot: string,
  targetDir: string,
  opts: Pick<
    PostScaffoldOptions,
    'repoId' | 'workflowModel' | 'businessActivity' | 'devPort' | 'deployTrack' | 'dbRuntime'
  >,
): PreflightOutcome {
  if (!opts.repoId) return { status: 'skipped', reason: '未給 --repo-id' }

  const script = join(cladeRoot, 'scripts', 'register-consumer.ts')
  if (!existsSync(script)) return { status: 'skipped', reason: `找不到 ${script}` }

  const args = [
    ...buildRegisterConsumerArgs(
      script,
      targetDir,
      opts.repoId,
      opts.workflowModel ?? 'trunk-based',
      opts.businessActivity ?? 'pre-production',
      opts.devPort ?? 'auto',
      { deployTrack: opts.deployTrack, dbRuntime: opts.dbRuntime },
    ),
    '--preflight',
    '--json',
  ]

  try {
    execFileSync('node', args, { cwd: cladeRoot, stdio: 'pipe' })
    return { status: 'ok' }
  } catch (error) {
    const message = String(
      (error as { stderr?: Buffer | string }).stderr ?? (error as Error).message,
    ).trim()
    // 舊版 Clade 還沒有 --preflight，會回 unknown flag。那是版本落差不是
    // 這次 scaffold 有問題 —— 略過 preflight，讓 scaffold 照舊往下走。
    if (/unknown flag: --preflight/.test(message)) {
      return { status: 'skipped', reason: 'Clade checkout 尚未支援 --preflight' }
    }
    return { status: 'rejected', reason: message }
  }
}

export async function maybeRegisterConsumer(
  cladeRoot: string,
  targetDir: string,
  opts: PostScaffoldOptions,
): Promise<boolean> {
  if (!opts.repoId) {
    consola.warn('缺少 --repo-id，已完成 project-local 初始化但尚未登記 Clade fleet')
    return false
  }
  if (opts.devPort === undefined) {
    consola.warn('缺少 --dev-port，已完成 project-local 初始化但尚未登記 Clade fleet')
    return false
  }

  const script = join(cladeRoot, 'scripts', 'register-consumer.ts')
  if (!existsSync(script)) {
    consola.warn(`Clade checkout 缺少 register-consumer.ts：${script}`)
    return false
  }

  if (!opts.yes) {
    const confirmed = await consola.prompt(`把 ${opts.repoId} 登記到 Clade registry？`, {
      type: 'confirm',
      initial: true,
    })
    if (!confirmed) {
      consola.info('已跳過 Clade fleet 登記')
      return false
    }
  }

  const workflowModel = opts.workflowModel ?? 'trunk-based'
  const businessActivity = opts.businessActivity ?? 'pre-production'
  const args = buildRegisterConsumerArgs(
    script,
    targetDir,
    opts.repoId,
    workflowModel,
    businessActivity,
    opts.devPort,
    { deployTrack: opts.deployTrack, dbRuntime: opts.dbRuntime },
  )
  try {
    execFileSync('node', args, { cwd: cladeRoot, stdio: 'pipe' })
    consola.success(`已登記到 Clade registry：${opts.repoId}`)
    return true
  } catch (error) {
    consola.warn(`Clade registry 登記失敗：${(error as Error).message}`)
    return false
  }
}

async function maybeWirePreCommit(
  cladeRoot: string,
  targetDir: string,
  nonInteractive: boolean,
): Promise<boolean> {
  const huskyHook = join(targetDir, '.husky', 'pre-commit')
  const gitHook = join(targetDir, '.git', 'hooks', 'pre-commit')
  const huskyDir = join(targetDir, '.husky')

  // Read existing hook content once，後面 append 階段會再用到，避免重讀。
  const huskyContent = tryReadFile(huskyHook)
  const gitHookContent = huskyContent === undefined ? tryReadFile(gitHook) : undefined

  // Already wired? Detect existing hub:check call.
  const existing = huskyContent ?? gitHookContent ?? ''
  if (existing.includes('hub:check') || existing.includes('git-pre-commit.sh')) {
    consola.info('pre-commit hook 已 wired — 跳過')
    return true
  }

  if (!nonInteractive) {
    const confirmed = await consola.prompt(
      'wire pre-commit hook？（commit 前自動跑 hub:check 擋掉 clade-managed 檔的本地誤改）',
      { type: 'confirm', initial: true },
    )
    if (!confirmed) {
      consola.info('已跳過 pre-commit wire（之後可手動）')
      return false
    }
  }

  // Pick strategy: husky directory exists → append; else cp clade vendor hook to .git/hooks/.
  try {
    if (existsSync(huskyDir)) {
      const huskyExisting = huskyContent ?? ''
      const prefix = huskyExisting.length === 0 || huskyExisting.endsWith('\n') ? '' : '\n'
      const line = 'pnpm hub:check\n'
      if (huskyExisting.length === 0) {
        // husky v9+ no longer requires the shebang/source line, but keep it portable.
        appendFileSync(huskyHook, `#!/usr/bin/env sh\n${line}`)
        chmodSync(huskyHook, 0o755)
      } else {
        appendFileSync(huskyHook, `${prefix}${line}`)
      }
      consola.success(`已 wire pre-commit (husky) — ${huskyHook}`)
      return true
    }

    const vendorHook = join(cladeRoot, 'vendor', 'git-pre-commit.sh')
    if (!existsSync(vendorHook)) {
      consola.warn(`找不到 ${vendorHook} — 略過 pre-commit wire`)
      return false
    }
    const gitDir = join(targetDir, '.git')
    if (!existsSync(gitDir)) {
      consola.warn('專案不是 git repo — 略過 pre-commit wire')
      return false
    }
    mkdirSync(dirname(gitHook), { recursive: true })
    copyFileSync(vendorHook, gitHook)
    chmodSync(gitHook, 0o755)
    consola.success(`已 wire pre-commit (git native) — ${gitHook}`)
    return true
  } catch (error) {
    consola.warn(`pre-commit wire 失敗：${(error as Error).message}`)
    return false
  }
}

function writeFirstRunMarker(targetDir: string, projectName: string, mods: CladeModules): void {
  const claudeDir = join(targetDir, '.claude')
  if (!existsSync(claudeDir)) return // clade 未 init 時略過
  const markerPath = join(claudeDir, '.first-run')
  const payload = {
    scaffoldedAt: new Date().toISOString(),
    projectName,
    cladeModules: mods,
    // instructions MUST 自給自足：原本結尾把讀者導到 starter 的 template/docs/ 底下
    // 那份 agent 指南，但 scaffold **不會複製**它（只複製 root AGENTS.md），所以每個
    // scaffold 出去的專案都拿到一個指向不存在檔案的指標。
    // 步驟本身也 MUST 只列產生出來的 script，且使用 bootstrap 後的 OPSX CLI。
    instructions: [
      'AI agent: 看到此檔代表 scaffold 剛完成，請先跑首輪暖機再開始任何開發。',
      '(1) pnpm verify:starter —— 機械化驗收。exit 0=全過 / 2=有 WARN（環境仍可用）/ 1=有 FAIL。',
      '(2) pnpm opsx:list —— 列出現有需求與可接續項目（需先完成 clade bootstrap）。',
      '(3) 若已有 change ID，再跑 `pnpm opsx:status -- --change-id <chg_...>` 讀取指定需求狀態。',
      '(4) 依 verify:starter 與 OPSX list/status 的 WARN/FAIL 列出 next-step 給使用者（缺的 env var、OAuth console URL 都會印在輸出裡）。',
      '(5) 暖機完成後 rm .claude/.first-run。',
    ].join('\n'),
  }
  try {
    writeFileSync(markerPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
    consola.info(`已寫 first-run marker — ${markerPath}（session 開始時 AI 會自動處理）`)
  } catch (error) {
    consola.warn(`寫 first-run marker 失敗：${(error as Error).message}`)
  }
}

async function tryCloneClade(nonInteractive: boolean): Promise<string | undefined> {
  // Default target: ~/offline/clade（與 findCladeRoot 的搜尋順序一致）
  const target = join(homedir(), 'offline', 'clade')
  const parentDir = dirname(target)

  // Parent dir must exist or be creatable
  if (!existsSync(parentDir)) {
    try {
      mkdirSync(parentDir, { recursive: true })
    } catch {
      consola.warn(`找不到 clade 且無法建立 ${parentDir} — 略過 auto-clone`)
      return undefined
    }
  }

  // Already cloned? (race condition safety)
  if (existsSync(target)) {
    return target
  }

  if (!nonInteractive) {
    const ok = await consola.prompt(
      `找不到 clade，要 git clone 到 ${target}？（需要對 YuDefine/clade 的 read access）`,
      { type: 'confirm', initial: true },
    )
    if (!ok) {
      consola.info('已跳過 clade auto-clone')
      return undefined
    }
  }

  // Try ssh first, then https
  const candidates = ['git@github.com:YuDefine/clade.git', 'https://github.com/YuDefine/clade.git']

  for (const url of candidates) {
    // Probe access without cloning (cheap, no large download)
    consola.start(`偵測 ${url} 可達性...`)
    const probe = execFileSyncSafe('git', ['ls-remote', '--exit-code', url, 'HEAD'])
    if (!probe.ok) {
      consola.log(`  × ${url} 不可達`)
      continue
    }

    consola.start(`git clone ${url} → ${target}`)
    const clone = execFileSyncSafe('git', ['clone', url, target])
    if (clone.ok) {
      consola.success(`clade 已 clone 到 ${target}`)
      return target
    }
    consola.warn(`clone 失敗：${clone.error}`)
  }

  consola.warn('所有 git URL 都無法 clone clade — 你可能需要設定 SSH key 或 PAT')
  return undefined
}

function execFileSyncSafe(file: string, args: string[]): { ok: boolean; error?: string } {
  try {
    execFileSync(file, args, { stdio: 'pipe' })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

/** Read file utf8，不存在或 IO 失敗回 undefined（避免 existsSync + readFileSync 兩次系統呼叫）. */
function tryReadFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

export function findCladeRoot(): string | undefined {
  const env = process.env.CLADE_HOME?.trim()
  if (env && existsSync(env)) return env
  const home = homedir()
  for (const candidate of [join(home, 'clade'), join(home, 'offline', 'clade')]) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function runHubPrune(targetDir: string): void {
  consola.start('清理本 modules 不需要的 orphan rules（pnpm hub:prune）')
  try {
    execFileSync('pnpm', ['hub:prune'], { cwd: targetDir, stdio: 'pipe' })
    consola.success('Orphan rules 清理完成')
  } catch (error) {
    consola.warn(`hub:prune 執行失敗：${(error as Error).message}`)
    consola.log(`  之後可手動：cd ${targetDir} && pnpm hub:prune`)
  }
}

/**
 * 這支 script 被改過名（`sync-to-agents` → `sync-to-codex`），且同時存在 `.mjs`
 * 與 `.ts` 兩種投影。寫死單一檔名的後果是「找不到就靜默跳過」——改名之後
 * 每一次 scaffold 都不再產 `.codex/` 與 `AGENTS.md`，而使用者只會看到一行
 * 略過警告，不會知道專案少了東西。所以這裡按序探測，全部落空才報。
 */
// 順序 MUST 是 `.ts` 在前：clade 自 `.mjs` → `.ts` 改名後，user shim 的安裝只增不減，
// 於是很多機器上仍留著一支**指向已不存在的 `run-sync-to-codex.mjs`** 的死 `.mjs`。
// 2026-08-24 全新 scaffold 實測，`.mjs` 排前面就固定挑到那支死的：
//   Error: Cannot find module '<clade>/scripts/run-sync-to-codex.mjs'
// clade v1.11.63 起 bootstrap-hub 會主動剪除它，但已存在的機器要下一次 bootstrap 才清掉。
const SYNC_TO_CODEX_CANDIDATES = [
  'sync-to-codex.ts',
  'sync-to-codex.mjs',
  // 舊名，保留給還沒更新 ~/.claude/scripts 的機器
  'sync-to-agents.mjs',
]

export function resolveSyncToCodexScript(scriptsDir: string): string | undefined {
  for (const name of SYNC_TO_CODEX_CANDIDATES) {
    const candidate = join(scriptsDir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * 同 SYNC_TO_CODEX_CANDIDATES 的理由：按序探測，NEVER 寫死單一檔名。
 * 這支比 codex 那支年輕（2026-08-24 才進 clade），所以還沒有舊名要相容 ——
 * 但形狀先立好，改名時才不會重演「靜默不產投影」。
 */
// 同上：`.ts` 在前。cursor 這支比 codex 年輕，目前沒有死 `.mjs` 的實例，但形狀先立好。
const SYNC_TO_CURSOR_CANDIDATES = ['sync-to-cursor.ts', 'sync-to-cursor.mjs']

export function resolveSyncToCursorScript(scriptsDir: string): string | undefined {
  for (const name of SYNC_TO_CURSOR_CANDIDATES) {
    const candidate = join(scriptsDir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function runSyncToCursor(targetDir: string): void {
  const scriptsDir = join(homedir(), '.claude', 'scripts')
  const script = resolveSyncToCursorScript(scriptsDir)
  if (!script) {
    consola.warn(
      `在 ~/.claude/scripts/ 找不到 ${SYNC_TO_CURSOR_CANDIDATES.join(' / ')}，略過 .cursor/ 重投影`,
    )
    consola.log('  專案裡的 .cursor/ 會停在 starter 附帶的版本，不會反映本專案選的 modules。')
    consola.log('  clade 需要 v1.11.62+；升級後手動：')
    consola.log(`  cd ${targetDir} && node ~/.claude/scripts/sync-to-cursor.ts`)
    return
  }
  consola.start('重投影 .cursor/（Claude Code First → Cursor projection）')
  try {
    execFileSync('node', [script], { cwd: targetDir, stdio: 'pipe' })
    consola.success('Cursor projection 重生完成')
  } catch (error) {
    consola.warn(`${basename(script)} 執行失敗：${(error as Error).message}`)
    consola.log(`  之後可手動：node ${script}`)
  }
}

function runSyncToAgents(targetDir: string): void {
  const scriptsDir = join(homedir(), '.claude', 'scripts')
  const script = resolveSyncToCodexScript(scriptsDir)
  if (!script) {
    consola.warn(
      `在 ~/.claude/scripts/ 找不到 ${SYNC_TO_CODEX_CANDIDATES.join(' / ')}，` +
        '略過 .codex/.agents/AGENTS.md 重投影',
    )
    consola.log('  這代表專案不會有 Codex / Cursor 的投影檔。只用 Claude Code 的話可以忽略。')
    return
  }
  consola.start('重投影 .codex/.agents/AGENTS.md（Claude Code First → projections）')
  try {
    execFileSync('node', [script], { cwd: targetDir, stdio: 'pipe' })
    consola.success('Projection 重生完成')
  } catch (error) {
    consola.warn(`${basename(script)} 執行失敗：${(error as Error).message}`)
    consola.log(`  之後可手動：node ${script}`)
  }
}

async function runInitConsumer(
  targetDir: string,
  mods: CladeModules,
  opts: PostScaffoldOptions,
): Promise<string | undefined> {
  let cladeRoot = findCladeRoot()
  if (!cladeRoot && opts.cloneClade) {
    cladeRoot = await tryCloneClade(opts.yes)
  }
  if (!cladeRoot) {
    consola.warn('找不到 clade（CLADE_HOME / ~/clade / ~/offline/clade），略過 clade consumer 註冊')
    consola.log('  之後可手動：')
    consola.log('    git clone git@github.com:YuDefine/clade.git ~/offline/clade')
    consola.log('    cd <projectDir> && pnpm hub:bootstrap')
    return undefined
  }

  const script = resolveCladeInitScript(cladeRoot)
  if (!script) {
    consola.warn(`找到 clade 但缺 init-consumer.ts / init-consumer.mjs：${cladeRoot}`)
    return cladeRoot
  }

  consola.start('註冊 clade consumer（hub.json + postinstall + hub:* scripts）')
  const args = [
    script,
    '--force',
    '--no-bootstrap',
    '--auth',
    mods.auth,
    '--db-schema',
    mods.dbSchema,
    '--db-runtime',
    mods.dbRuntime,
    '--runtime',
    mods.runtime,
    '--framework',
    mods.framework,
  ]
  if (mods.localHooks.length > 0) {
    args.push('--local-hooks', mods.localHooks.join(','))
  }

  try {
    execFileSync('node', args, { cwd: targetDir, stdio: 'pipe' })
    consola.success('clade consumer 註冊完成')
  } catch (error) {
    consola.warn(`clade init-consumer 失敗：${(error as Error).message}`)
    consola.log(`  之後可手動：cd ${targetDir} && node ${script} ${args.slice(1).join(' ')}`)
  }

  return cladeRoot
}

export function resolveCladeInitScript(cladeRoot: string): string | undefined {
  for (const filename of ['init-consumer.ts', 'init-consumer.mjs']) {
    const candidate = join(cladeRoot, 'scripts', filename)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}
