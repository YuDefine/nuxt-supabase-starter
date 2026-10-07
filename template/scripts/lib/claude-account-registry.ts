// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/claude-account-registry.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/claude-account-registry.ts
/**
 * Claude 帳號池的單一 SoT（W-2026-10-04-claude-account-pool）。
 *
 * 帳號清單寫死在這裡，不要讀任何 config：`cc` 是池入口（依額度挑帳號），
 * `ccN` 釘選第 N 個帳號，`ccw` 是 cc2 的舊名別名。舊 dispatch record 的
 * `account: cc|ccw`、舊 launcher 名、ai-quota 帳號 id 全部由這裡對映到池 id——
 * 任何消費端要「哪個帳號」都只能問 registry，NEVER 各自寫死 'cc'|'ccw'。
 *
 * 帳號加入／退出只改 `CLAUDE_POOL_ACCOUNTS`；下游型別全部由這份陣列推導。
 * 方案（Pro／Max 5x／Max 20x）NEVER 寫在這裡：訂閱會升降級，現行方案讀 profile `.claude.json` 的
 * `organizationRateLimitTier`，顯示標籤與月費走價目（`claude-cost/prices.json`）。
 */

export interface ClaudePoolAccount {
  /** 池內唯一 id，新 record 的 `account`／`slot` 欄位寫這個。 */
  id: 'claude-1' | 'claude-2' | 'claude-3'
  /** 釘選這個帳號的指令名（zsh function／`--launcher`／`CLADE_CLAUDE_LAUNCHER`）。 */
  command: 'cc1' | 'cc2' | 'cc3'
  /** `CLAUDE_CONFIG_DIR` 相對 `$HOME` 的 basename。 */
  configDir: string
  /** ai-quota collector config 裡的帳號 id。 */
  quotaId: string
  /** `~/.cache/claude-quota/<name>.json` 的檔名（claude-home statusline 寫入端與這裡對齊）。 */
  statusline: string
}

export const CLAUDE_POOL_ACCOUNTS: readonly ClaudePoolAccount[] = [
  {
    id: 'claude-1',
    command: 'cc1',
    configDir: '.claude',
    quotaId: 'claude-main',
    statusline: 'cc',
  },
  {
    id: 'claude-2',
    command: 'cc2',
    configDir: '.claude-work',
    quotaId: 'claude-work',
    statusline: 'ccw',
  },
  {
    id: 'claude-3',
    command: 'cc3',
    configDir: '.claude-3',
    quotaId: 'claude-3',
    statusline: 'cc3',
  },
]

export type ClaudeAccountId = ClaudePoolAccount['id']
export type ClaudePinCommand = ClaudePoolAccount['command']

/** `cc` 是池入口指令：`--launcher cc`、`zsh function cc`、PATH wrapper 的 `auto` 都解析成它。 */
export const CLAUDE_POOL_ENTRY = 'cc'

/**
 * `cc`（池入口）與 `ccw`（cc2 舊名）也算 launcher 名，但都不是帳號本身——
 * `cc` 沒有固定帳號、`ccw` 永遠是 cc2。
 */
export type ClaudeLauncherName = 'cc' | 'ccw' | ClaudePinCommand

/** 舊 record／env／CLI 可能出現的帳號值 → 池 id。`cc` 在帳號欄位語境下仍是 claude-1。 */
const ACCOUNT_ALIASES: Record<string, ClaudeAccountId> = {
  cc: 'claude-1',
  ccw: 'claude-2',
  cc1: 'claude-1',
  cc2: 'claude-2',
  cc3: 'claude-3',
  'claude-1': 'claude-1',
  'claude-2': 'claude-2',
  'claude-3': 'claude-3',
  'claude-main': 'claude-1',
  'claude-work': 'claude-2',
}

const ACCOUNT_BY_ID = new Map(CLAUDE_POOL_ACCOUNTS.map((account) => [account.id, account]))
const ACCOUNT_BY_COMMAND = new Map(
  CLAUDE_POOL_ACCOUNTS.map((account) => [account.command, account]),
)
const ACCOUNT_BY_QUOTA_ID = new Map(CLAUDE_POOL_ACCOUNTS.map((a) => [a.quotaId, a]))
const ACCOUNT_BY_STATUSLINE = new Map(CLAUDE_POOL_ACCOUNTS.map((a) => [a.statusline, a]))
const ACCOUNT_BY_CONFIG_DIR = new Map(CLAUDE_POOL_ACCOUNTS.map((a) => [a.configDir, a]))

export function claudePoolAccounts(): readonly ClaudePoolAccount[] {
  return CLAUDE_POOL_ACCOUNTS
}

export function claudeAccountOf(id: string | undefined | null): ClaudePoolAccount | undefined {
  return id ? ACCOUNT_BY_ID.get(id as ClaudeAccountId) : undefined
}

export function claudeAccountByQuotaId(quotaId: string): ClaudePoolAccount | undefined {
  return ACCOUNT_BY_QUOTA_ID.get(quotaId)
}

export function claudeAccountByStatusline(name: string): ClaudePoolAccount | undefined {
  return ACCOUNT_BY_STATUSLINE.get(name)
}

/**
 * config dir → 帳號。接受 basename（`.claude-3`）或絕對路徑（`~/.claude-3`、
 * `/home/x/.claude-3`）；路徑尾巴是 configDir 即命中，不猜 registry 以外的目錄。
 */
export function claudeAccountByConfigDir(
  configDir: string | undefined | null,
): ClaudePoolAccount | undefined {
  if (!configDir) return undefined
  const base = configDir.replace(/\/+$/, '').split('/').pop() ?? configDir
  return ACCOUNT_BY_CONFIG_DIR.get(base)
}

/**
 * 帳號欄位解析：dispatch/cloud record、環境變數、census、CLI `--account` 一律走這裡。
 * `cc` → claude-1、`ccw` → claude-2（舊 record 值）、`ccN`／`claude-N`／quota id 都收。
 */
export function resolveClaudeAccount(name: string | undefined | null): ClaudeAccountId | null {
  return name ? (ACCOUNT_ALIASES[name] ?? null) : null
}

/** launcher 名解析：`cc` = 池入口；`ccw`／`ccN`／`claude-N` = 釘選某帳號。 */
export function resolveClaudeLauncher(
  name: string | undefined | null,
): { kind: 'pool' } | { kind: 'pin'; account: ClaudePoolAccount } | null {
  if (!name) return null
  if (name === CLAUDE_POOL_ENTRY) return { kind: 'pool' }
  const account =
    ACCOUNT_BY_COMMAND.get(name as ClaudePinCommand) ?? claudeAccountOf(resolveClaudeAccount(name))
  if (!account) return null
  return { kind: 'pin', account }
}

/**
 * Claude 系 launcher 名（池入口＋釘選＋舊名）。workspace-trust gate、STRICT 環境判斷、
 * `agentKindForLauncher === 'claude'` 的帳號族判定都用這個，不要各自列 'cc'|'ccw'。
 */
export function isClaudeLauncherName(name: string | undefined | null): name is ClaudeLauncherName {
  return (
    name === CLAUDE_POOL_ENTRY || name === 'ccw' || ACCOUNT_BY_COMMAND.has(name as ClaudePinCommand)
  )
}

/**
 * 釘選單一帳號的 launcher 名（`ccw`／`ccN`／`claude-N`／舊 quota id）；池入口 `cc` 不算。
 * 回傳 boolean 不是 type guard：像 `claude-main` 這種值會 pin 但不是 `ClaudePinCommand`。
 */
export function isClaudePinLauncherName(name: string | undefined | null): boolean {
  return resolveClaudeLauncher(name)?.kind === 'pin'
}

/** 釘選帳號的 launcher 名正規形：`ccw`→`cc2`、`claude-N`→`ccN`；`cc` 保持 `cc`（池入口）。 */
export function canonicalClaudeLauncher(name: string): 'cc' | ClaudePinCommand | undefined {
  const resolved = resolveClaudeLauncher(name)
  if (!resolved) return undefined
  return resolved.kind === 'pool' ? CLAUDE_POOL_ENTRY : resolved.account.command
}

export function claudeCommandOf(account: string | undefined | null): ClaudePinCommand | undefined {
  const resolved = account ? claudeAccountOf(resolveClaudeAccount(account) ?? undefined) : undefined
  return resolved?.command
}

/** 釘選 launcher → 帳號 id；`cc`（池入口）沒有固定帳號，回 null。 */
export function claudeAccountOfLauncher(name: string | undefined | null): ClaudeAccountId | null {
  const resolved = resolveClaudeLauncher(name)
  return resolved?.kind === 'pin' ? resolved.account.id : null
}

/** launcher／帳號名 → config dir basename；`cc` 池入口回預設 `.claude`（選帳號前的 fallback）。 */
export function claudeConfigDirName(name: string | undefined | null): string {
  const account = claudeAccountByConfigDir(name ?? undefined)
  if (account) return account.configDir
  const resolved = resolveClaudeLauncher(name)
  if (resolved?.kind === 'pin') return resolved.account.configDir
  const alias = resolveClaudeAccount(name)
  if (alias) return claudeAccountOf(alias)!.configDir
  return '.claude'
}

export function claudeConfigDirOf(name: string, home: string): string {
  const dir = claudeConfigDirName(name)
  return dir.startsWith('/') ? dir : `${home.replace(/\/+$/, '')}/${dir}`
}
