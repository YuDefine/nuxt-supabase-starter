// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/claude-account-registry.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/claude-account-registry.ts
/**
 * Claude 帳號池的單一 SoT。
 *
 * 帳號清單從資料檔 `claude-accounts.json`（同目錄）讀，不從型別讀（plans/40 T28、§ 設計定稿 六）：
 * 加帳號＝在登記檔加一列 `{id, launcher, configDir, enabled}`，下游一律從這裡推導，NEVER 改程式。
 * `CLADE_CLAUDE_ACCOUNTS_FILE` 指向另一份登記檔（測試、模擬加帳號用）。資料列執行期驗證，壞列直接丟錯。
 * 登記檔形狀是通用的 slot table（`schema: clade.slot-table/v1`，`rows[]` 每列一個槽）：執行器路由表
 * （plans/40 § 設計定稿 九）沿用同一形狀，加執行器＝加一列。
 *
 * `cc` 是池入口（依額度挑帳號），`ccN` 釘選第 N 個帳號。舊 dispatch record 的 `account: cc|ccw`、ai-quota 帳號 id
 * 全部由這裡對映到池 id——任何消費端要「哪個帳號」都只能問 registry，NEVER 各自寫死帳號名或帳號清單
 * （`test/claude-account-literal-list.test.ts` 擋）。
 * `ccw`（cc2 舊名）已退役：只剩舊 record 的帳號值還解析得到 claude-2，NEVER 當 launcher 名。
 *
 * 列欄位：`quotaId`（ai-quota collector 的帳號 id）省略＝`id`；`statusline`（`~/.cache/claude-quota/<name>.json`）
 * 省略＝`launcher`；`aliases` 是舊 record／env 會出現的別名；`enabled: false` 的列不進池（仍解析得到，讀舊 record 用）；
 * `maxConcurrent` 是該帳號的併發鼓槽數（省略＝不設上限，見 `lib/claude-account-expiring-score.ts`）。
 *
 * 方案（Pro／Max 5x／Max 20x）NEVER 寫在這裡：訂閱會升降級，現行方案讀 profile `.claude.json` 的
 * `organizationRateLimitTier`，顯示標籤與月費走價目（`claude-cost/prices.json`）。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export interface ClaudePoolAccount {
  /** 池內唯一 id，新 record 的 `account`／`slot` 欄位寫這個。 */
  id: `claude-${number}`
  /** 釘選這個帳號的指令名（zsh function／`--launcher`／`CLADE_CLAUDE_LAUNCHER`）。 */
  command: `cc${number}`
  /** `CLAUDE_CONFIG_DIR` 相對 `$HOME` 的 basename。 */
  configDir: string
  /** ai-quota collector config 裡的帳號 id。 */
  quotaId: string
  /** `~/.cache/claude-quota/<name>.json` 的檔名（claude-home statusline 寫入端與這裡對齊）。 */
  statusline: string
  /** 登記檔 `enabled`：false 的帳號不進池。 */
  enabled: boolean
  /** 舊 record／env／CLI 可能出現的別名（`cc`、`ccw`）。 */
  aliases: readonly string[]
  /** 併發鼓槽數；省略＝不設上限。 */
  maxConcurrent?: number
}

/** 預設登記檔路徑（與本檔同目錄）。 */
export const CLAUDE_ACCOUNTS_FILE = fileURLToPath(
  new URL('./claude-accounts.json', import.meta.url),
)

const ID_RE = /^claude-[1-9][0-9]*$/
const LAUNCHER_RE = /^cc[1-9][0-9]*$/

function fail(path: string, message: string): never {
  throw new Error(`claude account registry ${path}: ${message}`)
}

/** 驗證登記檔內容（執行期型別檢查）；壞列丟錯，NEVER 靜默略過。 */
export function parseClaudeAccountRegistry(raw: unknown, path = '<inline>'): ClaudePoolAccount[] {
  if (!raw || typeof raw !== 'object') fail(path, 'not an object')
  const table = raw as { schema?: unknown; rows?: unknown }
  if (table.schema !== 'clade.slot-table/v1') fail(path, 'schema must be clade.slot-table/v1')
  if (!Array.isArray(table.rows) || table.rows.length === 0)
    fail(path, 'rows must be a non-empty array')
  const seen = new Set<string>()
  return table.rows.map((row: unknown, i): ClaudePoolAccount => {
    const r = (row ?? {}) as Record<string, unknown>
    const at = `rows[${i}]`
    if (typeof r.id !== 'string' || !ID_RE.test(r.id)) fail(path, `${at}.id must match claude-N`)
    if (typeof r.launcher !== 'string' || !LAUNCHER_RE.test(r.launcher))
      fail(path, `${at}.launcher must match ccN`)
    if (typeof r.configDir !== 'string' || r.configDir === '' || r.configDir.includes('/'))
      fail(path, `${at}.configDir must be a basename`)
    if (typeof r.enabled !== 'boolean') fail(path, `${at}.enabled must be boolean`)
    for (const key of ['quotaId', 'statusline'] as const)
      if (r[key] !== undefined && (typeof r[key] !== 'string' || r[key] === ''))
        fail(path, `${at}.${key} must be a non-empty string`)
    if (
      r.aliases !== undefined &&
      (!Array.isArray(r.aliases) || r.aliases.some((a) => typeof a !== 'string' || a === ''))
    )
      fail(path, `${at}.aliases must be string[]`)
    if (
      r.maxConcurrent !== undefined &&
      (typeof r.maxConcurrent !== 'number' ||
        !Number.isInteger(r.maxConcurrent) ||
        r.maxConcurrent < 1)
    )
      fail(path, `${at}.maxConcurrent must be a positive integer`)
    const account: ClaudePoolAccount = {
      id: r.id as ClaudePoolAccount['id'],
      command: r.launcher as ClaudePoolAccount['command'],
      configDir: r.configDir,
      quotaId: (r.quotaId as string | undefined) ?? r.id,
      statusline: (r.statusline as string | undefined) ?? r.launcher,
      enabled: r.enabled,
      aliases: (r.aliases as string[] | undefined) ?? [],
      ...(r.maxConcurrent !== undefined ? { maxConcurrent: r.maxConcurrent as number } : {}),
    }
    // 同一列內重複（`quotaId` 省略＝`id`、`statusline` 省略＝`launcher`）不算撞；跨列才算。
    const keys = new Set<string>([
      account.id,
      account.command,
      account.configDir,
      account.quotaId,
      account.statusline,
      ...account.aliases,
    ])
    for (const k of keys) {
      if (seen.has(k)) fail(path, `${at} duplicates ${k}`)
      seen.add(k)
    }
    return account
  })
}

function loadRegistry(): ClaudePoolAccount[] {
  const path = process.env.CLADE_CLAUDE_ACCOUNTS_FILE || CLAUDE_ACCOUNTS_FILE
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(path, `unreadable (${(error as Error).message})`)
  }
  return parseClaudeAccountRegistry(raw, path)
}

/** 登記檔的全部列（含 `enabled: false`）：只給解析舊 record 用。 */
export const CLAUDE_REGISTERED_ACCOUNTS: readonly ClaudePoolAccount[] = loadRegistry()

/** 池內帳號（登記檔 `enabled: true` 的列，依登記序）。 */
export const CLAUDE_POOL_ACCOUNTS: readonly ClaudePoolAccount[] = CLAUDE_REGISTERED_ACCOUNTS.filter(
  (account) => account.enabled,
)

export type ClaudeAccountId = ClaudePoolAccount['id']
export type ClaudePinCommand = ClaudePoolAccount['command']

/** `cc` 是池入口指令：`--launcher cc`、`zsh function cc`、PATH wrapper 的 `auto` 都解析成它。 */
export const CLAUDE_POOL_ENTRY = 'cc'

/** `cc`（池入口）也算 launcher 名，但不是帳號本身：它沒有固定帳號。 */
export type ClaudeLauncherName = 'cc' | ClaudePinCommand

/** 已退役的 launcher 名 → 取代它的指令；用來在拒收時指出該改用什麼。 */
export const RETIRED_CLAUDE_LAUNCHERS: Readonly<Record<string, ClaudePinCommand>> = { ccw: 'cc2' }

/**
 * 已退役的 config dir basename → 現行 basename。改名前就開著的 session 環境仍帶舊路徑
 * （`~/.claude-work` 相容 symlink 已於 2026-11-09 從 desk、zenbook 移除，舊紀錄仍可能帶這個路徑），帳號歸屬照新目錄算。
 */
export const RETIRED_CLAUDE_CONFIG_DIRS: Readonly<Record<string, string>> = {
  '.claude-work': '.claude-2',
}

/** 舊 record／env／CLI 可能出現的帳號值 → 池 id。`cc` 在帳號欄位語境下仍是 claude-1（登記檔 aliases）。 */
const ACCOUNT_ALIASES: Record<string, ClaudeAccountId> = Object.fromEntries(
  CLAUDE_REGISTERED_ACCOUNTS.flatMap((account) =>
    [account.command, account.id, account.quotaId, ...account.aliases].map((key) => [
      key,
      account.id,
    ]),
  ),
)

const ACCOUNT_BY_ID = new Map(CLAUDE_REGISTERED_ACCOUNTS.map((account) => [account.id, account]))
// 新輸入（CLI／env 的 `ccN`）只認池內（enabled）帳號；disabled 的列只給 `resolveRecordLauncher` 讀舊 record。
const ACCOUNT_BY_COMMAND = new Map(
  CLAUDE_POOL_ACCOUNTS.map((account) => [account.command, account]),
)
const ACCOUNT_BY_QUOTA_ID = new Map(CLAUDE_REGISTERED_ACCOUNTS.map((a) => [a.quotaId, a]))
const ACCOUNT_BY_STATUSLINE = new Map(CLAUDE_REGISTERED_ACCOUNTS.map((a) => [a.statusline, a]))
const ACCOUNT_BY_CONFIG_DIR = new Map(CLAUDE_REGISTERED_ACCOUNTS.map((a) => [a.configDir, a]))

export function claudePoolAccounts(): readonly ClaudePoolAccount[] {
  return CLAUDE_POOL_ACCOUNTS
}

/** 池內釘選指令名（登記序）：usage／錯誤訊息列帳號時用這個，NEVER 手寫 `cc1|cc2|…`。 */
export function claudePinCommands(): readonly ClaudePinCommand[] {
  return CLAUDE_POOL_ACCOUNTS.map((account) => account.command)
}

/** launcher 選項字串：`cc|cc1|cc2|…`（`sep` 換分隔符）。 */
export function claudeLauncherChoices(sep = '|', withPoolEntry = true): string {
  return [...(withPoolEntry ? [CLAUDE_POOL_ENTRY] : []), ...claudePinCommands()].join(sep)
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
  return ACCOUNT_BY_CONFIG_DIR.get(RETIRED_CLAUDE_CONFIG_DIRS[base] ?? base)
}

/**
 * 帳號欄位解析：dispatch/cloud record、環境變數、census、CLI `--account` 一律走這裡。
 * `cc` → claude-1、`ccw` → claude-2（舊 record 值）、`ccN`／`claude-N`／quota id 都收。
 */
export function resolveClaudeAccount(name: string | undefined | null): ClaudeAccountId | null {
  return name ? (ACCOUNT_ALIASES[name] ?? null) : null
}

/**
 * Claude 件唯一的額度守門判準：帳號某一窗已見底（剩餘 0）就不派——派上去只會立刻撞窗停住。這不是保留線：
 * 沒有任何「留給誰」的數字，只要還有一點額度就派。讀不到（null／undefined）fail closed，NEVER 當成足夠。
 * 自動派（coordinator-auto-dispatch）、manual fanout、helper 的 launch admission 全部讀這一支。
 */
export function claudeFloorUsable(floor: number | null | undefined): boolean {
  return typeof floor === 'number' && floor > 0
}

/** launcher 名解析：`cc` = 池入口；`ccN`／`claude-N` = 釘選某帳號；退役名（`ccw`）回 null。 */
export function resolveClaudeLauncher(
  name: string | undefined | null,
  { allowDisabled = false }: { allowDisabled?: boolean } = {},
): { kind: 'pool' } | { kind: 'pin'; account: ClaudePoolAccount } | null {
  if (!name || Object.hasOwn(RETIRED_CLAUDE_LAUNCHERS, name)) return null
  if (name === CLAUDE_POOL_ENTRY) return { kind: 'pool' }
  const account =
    ACCOUNT_BY_COMMAND.get(name as ClaudePinCommand) ?? claudeAccountOf(resolveClaudeAccount(name))
  if (!account || (!account.enabled && !allowDisabled)) return null
  return { kind: 'pin', account }
}

/**
 * 舊 record 的 launcher 欄位解析：退役名（`ccw`）先換成取代它的指令再解析。只給讀歷史 record 的
 * 消費端用（cost backfill、舊 account_slot）；新輸入（CLI／env）走 `resolveClaudeLauncher` 拒收退役名。
 */
export function resolveRecordLauncher(
  name: string | undefined | null,
): ReturnType<typeof resolveClaudeLauncher> {
  return resolveClaudeLauncher(name ? (RETIRED_CLAUDE_LAUNCHERS[name] ?? name) : name, {
    allowDisabled: true,
  })
}

/**
 * Claude 系 launcher 名（池入口＋釘選）。workspace-trust gate、STRICT 環境判斷、
 * `agentKindForLauncher === 'claude'` 的帳號族判定都用這個，不要各自列帳號名。
 */
export function isClaudeLauncherName(name: string | undefined | null): name is ClaudeLauncherName {
  return name === CLAUDE_POOL_ENTRY || ACCOUNT_BY_COMMAND.has(name as ClaudePinCommand)
}

/** 退役 launcher 名的拒收訊息（`ccw` → 改用 `cc2`）；不是退役名回 undefined。 */
export function retiredClaudeLauncherMessage(name: string | undefined | null): string | undefined {
  const replacement = name ? RETIRED_CLAUDE_LAUNCHERS[name] : undefined
  return replacement
    ? `launcher ${name} is retired; use ${replacement} (~/${claudeAccountOf(resolveClaudeAccount(replacement))!.configDir})`
    : undefined
}

/**
 * 釘選單一帳號的 launcher 名（`ccN`／`claude-N`／舊 quota id）；池入口 `cc` 不算。
 * 回傳 boolean 不是 type guard：像 `claude-main` 這種值會 pin 但不是 `ClaudePinCommand`。
 */
export function isClaudePinLauncherName(name: string | undefined | null): boolean {
  return resolveClaudeLauncher(name)?.kind === 'pin'
}

/** 釘選帳號的 launcher 名正規形：`claude-N`→`ccN`；`cc` 保持 `cc`（池入口）。 */
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
