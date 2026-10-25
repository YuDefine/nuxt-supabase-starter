#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/prod-sql.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/prod-sql.ts
/**
 * prod-sql.ts — agent 讀寫 production DB 的唯一 CLI 入口（規約：rules/core/prod-access.md）。
 *
 * 為什麼存在：
 *   prod Supabase MCP 的 `execute_sql` 只能 deny（prod-mcp-safety），agent 因此沒有合規的方式
 *   取得 prod 證據或修 prod 資料。本工具給兩條受控路徑：
 *   - 讀：專用角色 `agent_ro`。唯讀由 **DB 角色的權限**強制，不靠本 CLI、不靠 client 設定；
 *     每次查詢前向 catalog 重驗該角色確實寫不了、建不了任何物件，驗不過就不執行。
 *   - 寫：專用角色 `agent_rw`，DB 只授白名單表的 SELECT 與 UPDATE（新增、刪除、TRUNCATE 由 DB
 *     拒絕，那些改走 migration 管線）。流程固定為 plan（交易內試跑後 ROLLBACK，筆數要等於
 *     `--expect`）→ apply（重驗受影響列與 plan 完全相同才 COMMIT）。apply 前落檔受影響列的原始
 *     內容與目標表 dump，`rollback` 由它產生逆向 plan。
 *
 * 用法：
 *   node prod-sql.ts read  --sql '<SELECT …>' | --file <path.sql>  [--limit N]
 *   node prod-sql.ts check [--role agent_ro|agent_rw] [--json]
 *   node prod-sql.ts plan  --op update --table <s.t> --where '<條件>' --set '<指派>' \
 *                          --expect <N> --source '<請求來源>' --reason '<為什麼>'
 *   node prod-sql.ts apply <plan-id>
 *   node prod-sql.ts rollback <apply-id> --reason '…'      # 產生逆向 plan，再 apply
 *   node prod-sql.ts bootstrap --role agent_ro|agent_rw    # 以設定檔的 superuser 路徑建角色
 *   node prod-sql.ts ledger [--limit N]
 *   每個子命令加 `--drill` 改對演練目標；不加就是 prod。
 *
 * 人不逐筆核准（逐筆核准只會變成蓋章）。prod 寫入的邊界依序是：
 *   1. DB 權限：`agent_rw` 只拿得到白名單表的 UPDATE，preflight 另拒絕它可執行的非平台 SECURITY
 *      DEFINER 函式與白名單表上的 SECURITY DEFINER trigger（以 owner 權限執行，等於繞過白名單）；
 *      `--where`／`--set` 片段不收函式呼叫。白名單在設定檔，prod 一律讀 registry 登記的 repo 的
 *      預設分支上那份（`git ls-remote` 取 sha，不信本機 ref），擴張白名單要經合入的 PR。
 *   2. 資料比對：apply 在同一交易內鎖列、比對內容與 plan 相同、比對列數，不符整筆回滾。
 *   3. 可回復：apply 前落檔原始列與表 dump（在 agent 機器上），`rollback` 產生逆向 plan；prod 寫入
 *      另要求設定檔的 `backup` 區段宣告一份沒過期、agent 刪改不了的異地備份（同樣讀 origin 那份）。
 *   其餘是護欄，agent 改得掉（同一個 OS 帳號改得到本檔與狀態檔）：plan 的警訊（超過
 *   `ROUTINE_MAX_ROWS` 列、目標表有會寫別的表的 trigger）一律不准 apply、改走 migration；每日上限；
 *   `--source`／`--expect` 的稽核欄位。
 *
 * 目標分兩類（`classifyHost`）：host 解析到 tailnet 位址＝prod；解析到 loopback＝演練。其他拒絕。
 *   兩類的憑證分開放（演練在 `drill/` 子目錄），要哪一類由 `--drill` 明確指定、再以 host 的解析
 *   結果驗證；演練憑證因此蓋不到 prod 的，prod 的指令也不會悄悄打到演練 DB。
 *   已知殘餘：`admin_psql` 指向的 superuser 路徑 agent 本來就能直接跑（規約 NEVER 繞過，機制上由
 *   prod 主機的 SSH 存取控制處理）。loopback 不代表不是 prod（`ssh -L` 轉發的本機埠也是
 *   loopback）：演練的 `admin_psql` 只收本機的 psql／docker exec（`drillAdminProblem`），擋的是寫錯，
 *   不是刻意轉發。
 *
 * consumer 身分：執行位置的 git toplevel 的 `.claude/hub.json`（worktree 亦可）。argv 無法
 *   指名別家（見 `resolveConsumerId`）。
 *
 * 憑證：`${XDG_CONFIG_HOME:-~/.config}/clade/prod-access/<consumer_id>/<role>.url`
 *   一行 postgres 連線字串、檔案權限 0600、user MUST 是該角色（或 pooler 的 `<role>.<tenant>`）、
 *   host MUST 解析到 tailnet。演練目標（loopback）的兩個角色都放 `drill/<role>.url`。
 *   放在 repo 外，所有 worktree 共用。
 *   密碼交給 psql／pg_dump 走已刪除的 passfile 的 fd（`PGPASSFILE=/dev/fd/3`），不經環境變數。
 * 狀態：`${XDG_STATE_HOME:-~/.local/state}/clade/prod-access/<consumer_id>/`
 *   `plans/`、`applies/<apply-id>/`（before.json、after.json、dump.sql）、`ledger.jsonl`。
 * 設定：consumer 根的 `.claude/prod-access.json`（見 `readBootstrapConfig`）；演練目標的
 *   superuser 指令與連線位址在它的 `drill` 區段，頂層只放 prod。
 *
 * 退出碼：0 成功；2 用法錯；3 憑證／連線設定被拒；4 角色權限驗證未過；5 查詢失敗；
 *         6 不准 apply（警訊、上限、plan 不可用）；7 apply 中止（資料與 plan 不符，或結果不明）；
 *         8 沒有有效的異地備份宣告。
 */
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const EXIT = {
  ok: 0,
  usage: 2,
  credential: 3,
  roleUnsafe: 4,
  query: 5,
  refused: 6,
  aborted: 7,
  backup: 8,
} as const

export const READ_ROLE = 'agent_ro'
export const WRITE_ROLE = 'agent_rw'
export type Role = typeof READ_ROLE | typeof WRITE_ROLE
export const DEFAULT_ROW_LIMIT = 200
export const MAX_ROW_LIMIT = 2000
export const MAX_OUTPUT_BYTES = 512 * 1024
export const READ_STATEMENT_TIMEOUT = '15s'
export const WRITE_STATEMENT_TIMEOUT = '30s'
export const WRITE_LOCK_TIMEOUT = '5s'
/** 單次 apply 的列數上限；超過就拆批或改走 migration 管線。 */
export const MAX_WRITE_ROWS = 500
/** 目標表（含索引）超過這個大小不做 apply 前 dump，也就不 apply。 */
export const MAX_DUMP_TABLE_BYTES = 100 * 1024 * 1024
export const PLAN_TTL_MINUTES = 60
export const HASH_QUOTE_LENGTH = 12
/** 例行寫入的列數上限；超過就是警訊，不准 agent 自行 apply（改走 migration）。 */
export const ROUTINE_MAX_ROWS = 50
/** 每個 consumer、每個目標、每個 UTC 日的 apply 上限（不含回滾）：防失控迴圈，不是邊界。 */
export const MAX_DAILY_APPLIES = 10
export const MAX_DAILY_ROWS = 200
/** 異地備份宣告（設定檔 `backup.attested_at`）的有效天數；過期要重新盤點。 */
export const BACKUP_ATTESTATION_TTL_DAYS = 90
/** 宣告裡的「最近一次還原演練」最久可以是多少天前；沒演練過的備份只算「可能有」。 */
export const RESTORE_DRILL_MAX_AGE_DAYS = 365
const CURSOR = 'clade_prod_sql'
const PREFLIGHT_TAG = 'prod-sql preflight'
const ABORT_TAG = 'prod-sql abort'

export class CliError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

type Opts = Record<string, string | boolean>

// ---------------------------------------------------------------------------
// 角色權限驗證
// ---------------------------------------------------------------------------

const NOT_SYSTEM_NS = `nspname !~ '^pg_(toast_)?temp_' AND nspname NOT IN ('pg_catalog', 'information_schema')`

/**
 * 兩個角色都不該成立的事，各回一句說明。`has_*_privilege` 會把繼承來的權限算進去，但算不到
 * NOINHERIT 成員資格（可 `SET ROLE`），所以成員資格另外查。temp schema 不算：temp 物件隨
 * session 消失，且權限來自 PUBLIC。
 */
const COMMON_PROBLEMS = `
  CASE WHEN (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication
             FROM pg_roles WHERE rolname = current_user)
       THEN 'role has SUPERUSER/CREATEROLE/CREATEDB/REPLICATION' END,
  CASE WHEN EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
                    WHERE r.rolname = current_user)
       THEN 'role is a member of another role' END,
  CASE WHEN has_database_privilege(current_user, current_database(), 'CREATE')
       THEN 'role can CREATE in database' END,
  (SELECT 'role can CREATE in schema: ' || string_agg(nspname, ', ' ORDER BY nspname)
     FROM pg_namespace
    WHERE nspname !~ '^pg_(toast_)?temp_' AND has_schema_privilege(current_user, oid, 'CREATE'))`

/**
 * 表權限只在角色碰得到該 schema 時才算數：沒有 schema `USAGE` 就連表名都解析不了。pg_cron 以
 * superuser 把 `cron.job_run_details` 的 DELETE 授給 PUBLIC，但 `cron` schema 的 USAGE 不給 PUBLIC；
 * 不看 USAGE 的話，每個裝了 pg_cron 的 DB 都會把 agent 角色誤判成可寫。
 */
const REACHABLE = `has_schema_privilege(current_user, n.oid, 'USAGE')`

function relationProblem(privileges: string, verb: string) {
  // 系統 schema 不算：`pg_settings` 預設 PUBLIC 可 UPDATE，改的只是自己 session 的設定。
  return `(SELECT 'role can ${verb} ' || count(*) || ' relation(s), e.g. ' || min(c.oid::regclass::text)
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND ${NOT_SYSTEM_NS.replaceAll('nspname', 'n.nspname')}
      AND ${REACHABLE} AND has_table_privilege(current_user, c.oid, '${privileges}')
   HAVING count(*) > 0)`
}

/**
 * 兩個角色都不需要推進 sequence：agent_rw 只做 UPDATE，apply 前的 pg_dump 只要 SELECT。
 * 刻意不套用 REACHABLE：nextval／setval 收 regclass，數字 OID 不走名稱解析、也不驗 schema
 * USAGE（實測無 USAGE 的 schema 內 nextval('16394') 照樣成功），所以 schema USAGE 被收回
 * 不等於推進不了——sequence 授權一律維持計入，只排除系統 schema。
 */
const SEQUENCE_PROBLEM = `(SELECT 'role can advance ' || count(*) || ' sequence(s), e.g. ' || min(c.oid::regclass::text)
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'S' AND ${NOT_SYSTEM_NS.replaceAll('nspname', 'n.nspname')}
      AND has_sequence_privilege(current_user, c.oid, 'USAGE, UPDATE')
   HAVING count(*) > 0)`

/**
 * SECURITY DEFINER 函式以 owner 的權限執行：`agent_rw` 只要能 EXECUTE，片段或 trigger 裡呼叫它就能
 * 寫白名單外的表，而 pg_net／dblink 這類非交易副作用連 plan 的 ROLLBACK 都撤不回。平台與 PostgreSQL
 * 內建 schema 的函式不算（它們不是 consumer 寫的，也收不回執行權）；清單以外的一律 fail-closed。
 */
export const DEFINER_EXEMPT_SCHEMAS = [
  'pg_catalog',
  'information_schema',
  'auth',
  'storage',
  'vault',
  'realtime',
  '_realtime',
  'supabase_functions',
  'supabase_migrations',
  'pgsodium',
  'pgsodium_masks',
  'net',
  'cron',
  'graphql',
  'graphql_public',
  'extensions',
  'pgbouncer',
  '_analytics',
] as const

const DEFINER_FUNCTION_PROBLEM = `(SELECT 'role can execute ' || count(*) || ' SECURITY DEFINER function(s): '
       || string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
       || ' (REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, ${WRITE_ROLE} via migration)'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND n.nspname !~ '^pg_'
      AND n.nspname NOT IN (${DEFINER_EXEMPT_SCHEMAS.map((s) => `'${s}'`).join(', ')})
      AND ${REACHABLE} AND has_function_privilege(current_user, p.oid, 'EXECUTE')
   HAVING count(*) > 0)`

/** 可 UPDATE 的表上掛 SECURITY DEFINER 的 trigger：UPDATE 一觸發就以 owner 權限執行，不必 EXECUTE 權。 */
const DEFINER_TRIGGER_PROBLEM = `(SELECT 'SECURITY DEFINER trigger(s) on writable tables: '
       || string_agg(c.oid::regclass::text || ' ' || t.tgname || ' -> ' || p.oid::regprocedure::text, ', '
                     ORDER BY c.oid::regclass::text, t.tgname)
       || ' (make the trigger function SECURITY INVOKER or remove the table from write_tables)'
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal AND p.prosecdef AND ${REACHABLE}
      AND has_table_privilege(current_user, c.oid, 'UPDATE')
   HAVING count(*) > 0)`

export function roleProblemsSql(role: Role) {
  const specific =
    role === READ_ROLE
      ? [relationProblem('INSERT, UPDATE, DELETE, TRUNCATE', 'write'), SEQUENCE_PROBLEM]
      : [
          relationProblem('INSERT, DELETE, TRUNCATE', 'insert/delete/truncate'),
          SEQUENCE_PROBLEM,
          DEFINER_FUNCTION_PROBLEM,
          DEFINER_TRIGGER_PROBLEM,
        ]
  return `(SELECT array_remove(ARRAY[${[COMMON_PROBLEMS, ...specific].join(',\n  ')}\n]::text[], NULL))`
}

export function preflightSql(role: Role) {
  return `DO $clade$
DECLARE problems text[] := ${roleProblemsSql(role)};
BEGIN
  IF current_user NOT IN ('${role}') AND current_user NOT LIKE '${role}.%' THEN
    RAISE EXCEPTION '${PREFLIGHT_TAG}: connected as %, expected ${role}', current_user;
  END IF;
  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION '${PREFLIGHT_TAG}: %', array_to_string(problems, '; ');
  END IF;
END
$clade$`
}

/**
 * `definer_functions`：量測可執行的 SECURITY DEFINER 函式（含平台 schema）。`agent_rw` 遇到非平台的
 * 就由 `roleProblemsSql` 判不符；`agent_ro` 靠唯讀交易，這欄是已知限制的量測。
 */
export function checkSql(role: Role) {
  return `SELECT current_user AS role, current_database() AS database,
  current_setting('server_version') AS server_version,
  current_setting('default_transaction_read_only') AS default_transaction_read_only,
  current_setting('statement_timeout') AS statement_timeout,
  (SELECT rolconnlimit FROM pg_roles WHERE rolname = current_user) AS connection_limit,
  array_to_string(${roleProblemsSql(role)}, '; ') AS problems,
  -- 'f'、'v' 也要數：foreign table 可寫；updatable view 的 DML 授權記在 view 自己身上
  -- （底表權限看 view owner），漏掉的話 agent_rw 拿到 view 寫權就能繞過 write_tables 白名單。
  -- 'm' 不能 DML，不算。
  (SELECT coalesce(string_agg(n.nspname || '.' || c.relname, '; ' ORDER BY 1), '')
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'f', 'v') AND ${NOT_SYSTEM_NS.replaceAll('nspname', 'n.nspname')}
      AND ${REACHABLE} AND has_table_privilege(current_user, c.oid, 'INSERT, UPDATE, DELETE')) AS writable_tables,
  (SELECT coalesce(string_agg(p.oid::regprocedure::text, '; ' ORDER BY 1), '')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND ${NOT_SYSTEM_NS.replaceAll('nspname', 'n.nspname')}
      AND has_schema_privilege(current_user, n.oid, 'USAGE')
      AND has_function_privilege(current_user, p.oid, 'EXECUTE')) AS definer_functions`
}

// ---------------------------------------------------------------------------
// 參數、consumer、憑證
// ---------------------------------------------------------------------------

const VALUED = new Set([
  'sql',
  'file',
  'limit',
  'role',
  'op',
  'table',
  'where',
  'set',
  'reason',
  'expect',
  'source',
])
const FLAGS = new Set(['json', 'drill'])

export function parseArgs(argv: string[]) {
  const [command, ...rest] = argv
  const opts: Opts = {}
  const positional: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    const name = arg.startsWith('--') ? arg.slice(2) : undefined
    if (name && VALUED.has(name)) {
      const value = rest[++i]
      if (value === undefined) throw new CliError(EXIT.usage, `${arg} 需要一個值`)
      opts[name] = value
    } else if (name && FLAGS.has(name)) opts[name] = true
    else if (name) throw new CliError(EXIT.usage, `不認得的參數：${arg}`)
    else positional.push(arg)
  }
  return { command, opts, positional }
}

function str(opts: Opts, name: string) {
  return typeof opts[name] === 'string' ? (opts[name] as string) : undefined
}

function need(opts: Opts, name: string) {
  const value = str(opts, name)?.trim()
  if (!value) throw new CliError(EXIT.usage, `缺 --${name}`)
  return value
}

export function parseRowLimit(raw: string | boolean | undefined) {
  if (raw === undefined) return DEFAULT_ROW_LIMIT
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROW_LIMIT)
    throw new CliError(EXIT.usage, `--limit 必須是 1–${MAX_ROW_LIMIT} 的整數`)
  return limit
}

/** 去掉結尾分號與空白；內容交給 server 判，本函式不解析 SQL。 */
export function normalizeQuery(sql: string) {
  if (sql.includes('\0')) throw new CliError(EXIT.usage, 'SQL 含 NUL 字元')
  const trimmed = sql.replace(/[\s;]+$/u, '').trim()
  if (!trimmed) throw new CliError(EXIT.usage, 'SQL 是空的')
  return trimmed
}

export function parseRole(raw: string | undefined, fallback: Role = READ_ROLE): Role {
  if (raw === undefined) return fallback
  if (raw !== READ_ROLE && raw !== WRITE_ROLE)
    throw new CliError(EXIT.usage, `--role 只能是 ${READ_ROLE} 或 ${WRITE_ROLE}`)
  return raw
}

function consumerRoot(cwd: string) {
  const top = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  return top.status === 0 ? top.stdout.trim() : cwd
}

/**
 * consumer 身分只來自執行位置所在 repo 的 `hub.json`。argv 沒有 `--cwd`／`--consumer-id`：
 * `Bash(node scripts/prod-sql.ts read:*)` 是免提示的，參數若能指名別家，它就成了跨專案讀 prod
 * 的入口。`override` 只由程式內呼叫（測試、演練驅動）經 `Deps` 傳入。這不是邊界——同一個 OS
 * 使用者讀得到每一家的憑證檔——只是讓免提示的指令形式綁在它所在的 repo。
 */
export function resolveConsumerId(cwd: string, override?: string) {
  const hubPath = join(consumerRoot(cwd), '.claude', 'hub.json')
  if (override) {
    let own: unknown
    try {
      own = existsSync(hubPath) ? JSON.parse(readFileSync(hubPath, 'utf8')).consumer_id : undefined
    } catch {
      own = undefined
    }
    if (typeof own === 'string' && own !== override)
      throw new CliError(
        EXIT.credential,
        `指定的 consumer ${override} 與本 repo 的 consumer_id ${own} 不同`,
      )
    return assertConsumerId(override)
  }
  if (!existsSync(hubPath))
    throw new CliError(EXIT.credential, `找不到 ${hubPath}；prod-sql 只在 consumer 的 repo 裡執行`)
  let id: unknown
  try {
    id = JSON.parse(readFileSync(hubPath, 'utf8')).consumer_id
  } catch {
    throw new CliError(EXIT.credential, `${hubPath} 不是合法 JSON`)
  }
  if (typeof id !== 'string') throw new CliError(EXIT.credential, `${hubPath} 沒有 consumer_id`)
  return assertConsumerId(id)
}

function assertConsumerId(id: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id))
    throw new CliError(EXIT.credential, `consumer_id 不合法：${JSON.stringify(id)}`)
  return id
}

/** 演練目標的憑證與角色檢查 receipt 放 `drill/` 子目錄：與 prod 的同名檔互不覆蓋。 */
export function prodAccessDir(
  consumerId: string,
  env: NodeJS.ProcessEnv = process.env,
  target: TargetClass = 'prod',
) {
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  const dir = join(base, 'clade', 'prod-access', consumerId)
  return target === 'drill' ? join(dir, 'drill') : dir
}

export function credentialPath(
  consumerId: string,
  env: NodeJS.ProcessEnv = process.env,
  role: Role = READ_ROLE,
  target: TargetClass = 'prod',
) {
  return join(prodAccessDir(consumerId, env, target), `${role}.url`)
}

export function stateDir(consumerId: string, env: NodeJS.ProcessEnv = process.env) {
  const base = env.XDG_STATE_HOME?.trim() || join(homedir(), '.local', 'state')
  return join(base, 'clade', 'prod-access', consumerId)
}

/** 舊版以密碼封存 `agent_rw` 的檔。現行版本不讀也不解它；存在時只提示可刪。 */
export const LEGACY_KEYRING_FILE = 'keyring.sealed.json'

export type Connection = {
  host: string
  port: string
  user: string
  password: string
  database: string
  sslmode?: string
}

/** 讀憑證檔並驗形狀：權限、scheme、角色名。host 是否在 tailnet 由呼叫端另驗。 */
export function loadCredential(path: string, role: Role = READ_ROLE): Connection {
  if (!existsSync(path))
    throw new CliError(
      EXIT.credential,
      `沒有憑證檔 ${path}；本 consumer 尚未接入 ${role}（見 prod-access 規約 § 接入）`,
    )
  const mode = statSync(path).mode & 0o777
  if (mode & 0o077)
    throw new CliError(
      EXIT.credential,
      `${path} 權限是 ${mode.toString(8)}，MUST 是 600（chmod 600）`,
    )
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length !== 1) throw new CliError(EXIT.credential, `${path} MUST 只有一行連線字串`)
  return parseConnectionUrl(lines[0], role)
}

export function parseConnectionUrl(raw: string, role: Role = READ_ROLE): Connection {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new CliError(EXIT.credential, '連線字串不是合法 URL')
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:')
    throw new CliError(EXIT.credential, '連線字串 MUST 是 postgres:// 或 postgresql://')
  const user = decodeURIComponent(url.username)
  if (user !== role && !user.startsWith(`${role}.`))
    throw new CliError(
      EXIT.credential,
      `連線字串的 user 是 ${JSON.stringify(user)}；本檔只能放 ${role}（NEVER 放其他角色的憑證）`,
    )
  const password = decodeURIComponent(url.password)
  if (!password) throw new CliError(EXIT.credential, '連線字串沒有密碼')
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ''))
  if (!url.hostname || !database) throw new CliError(EXIT.credential, '連線字串缺 host 或 database')
  return {
    host: url.hostname.replace(/^\[|\]$/gu, ''),
    port: url.port || '5432',
    user,
    password,
    database,
    sslmode: url.searchParams.get('sslmode') ?? undefined,
  }
}

/** Tailscale 位址範圍：IPv4 100.64.0.0/10、IPv6 fd7a:115c:a1e0::/48。 */
export function isTailnetAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return a === 100 && b >= 64 && b <= 127
  }
  return isIP(address) === 6 && address.toLowerCase().startsWith('fd7a:115c:a1e0:')
}

export function isLoopbackAddress(address: string) {
  if (isIP(address) === 4) return address.split('.')[0] === '127'
  return isIP(address) === 6 && address === '::1'
}

export type Resolver = (host: string) => Promise<string[]>

const systemResolver: Resolver = async (host) =>
  isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address)

/**
 * prod 與演練目標的區分：tailnet 位址是 prod，loopback 是演練（本機容器、臨時還原環境）。
 * 它決定讀哪一份設定、哪一類憑證，以及 prod 才有的備份前提；呼叫端以 `--drill` 指定要哪一類，
 * 解析結果不符就拒絕。
 */
export type TargetClass = 'prod' | 'drill'

export async function classifyHost(
  host: string,
  resolve: Resolver = systemResolver,
): Promise<TargetClass> {
  let addresses: string[]
  try {
    addresses = await resolve(host)
  } catch {
    throw new CliError(EXIT.credential, `解析不到 host ${host}（Tailscale 有連上嗎）`)
  }
  if (addresses.length > 0 && addresses.every(isTailnetAddress)) return 'prod'
  if (addresses.length > 0 && addresses.every(isLoopbackAddress)) return 'drill'
  throw new CliError(
    EXIT.credential,
    `host ${host} 解析到 ${addresses.join(', ') || '(無)'}，不在 tailnet 範圍；prod DB MUST 經 Tailscale 連線（演練目標用 loopback）`,
  )
}

export function psqlEnv(conn: Connection, base: NodeJS.ProcessEnv = process.env) {
  const env: NodeJS.ProcessEnv = {
    PATH: base.PATH,
    HOME: base.HOME,
    LANG: base.LANG,
    PGHOST: conn.host,
    PGPORT: conn.port,
    PGUSER: conn.user,
    PGDATABASE: conn.database,
    PGAPPNAME: 'clade-prod-sql',
    PGCONNECT_TIMEOUT: '10',
    PGCLIENTENCODING: 'UTF8',
  }
  if (conn.sslmode) env.PGSSLMODE = conn.sslmode
  return env
}

/** libpq passfile 的一行（`:` 與 `\` 要跳脫）。內容交給 runner 以 fd 傳遞，不進環境變數。 */
export function passfileLine(conn: Connection) {
  const esc = (value: string) => value.replaceAll('\\', '\\\\').replaceAll(':', '\\:')
  return `${[conn.host, conn.port, conn.database, conn.user, conn.password].map(esc).join(':')}\n`
}

// ---------------------------------------------------------------------------
// 執行
// ---------------------------------------------------------------------------

export type RunResult = { status: number | null; stdout: string; stderr: string; error?: Error }
export type Runner = (
  bin: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; input?: string; passfile?: string },
) => RunResult

/**
 * `passfile`：寫進 0700 暫存目錄裡的 0600 檔、開成 fd 後立刻刪檔，子行程以 fd 3 繼承，
 * `PGPASSFILE=/dev/fd/3`。密碼因此不在任何行程的環境變數與 argv 裡，磁碟上也只存在到開檔為止。
 */
const systemRunner: Runner = (bin, args, options) => {
  let fd: number | undefined
  const env = { ...(options.env ?? process.env) }
  if (options.passfile !== undefined) {
    const dir = mkdtempSync(join(tmpdir(), 'clade-prod-sql-'))
    const path = join(dir, 'pgpass')
    try {
      writeFileSync(path, options.passfile, { mode: 0o600 })
      fd = openSync(path, 'r')
    } finally {
      if (existsSync(path)) unlinkSync(path)
      rmdirSync(dir)
    }
    env.PGPASSFILE = '/dev/fd/3'
  }
  try {
    const result = spawnSync(bin, args, {
      env,
      input: options.input,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: fd === undefined ? 'pipe' : ['pipe', 'pipe', 'pipe', fd],
    })
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      error: result.error,
    }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export type Deps = {
  env?: NodeJS.ProcessEnv
  /** 執行位置；預設 process.cwd() */
  cwd?: string
  /** 不在 consumer repo 裡跑時（測試、演練驅動）指定身分；argv 沒有對應參數 */
  consumerId?: string
  resolve?: Resolver
  run?: Runner
  /** prod 的設定檔原文（origin 預設分支那份）；預設以 git 讀，測試注入 */
  committedConfig?: (root: string) => string
  stdout?: (text: string) => void
  stderr?: (text: string) => void
  now?: () => Date
  randomId?: () => string
}

const out = (deps: Deps, text: string) =>
  (deps.stdout ?? ((value) => process.stdout.write(value)))(text)
const err = (deps: Deps, text: string) =>
  (deps.stderr ?? ((value) => process.stderr.write(value)))(text)
const nowOf = (deps: Deps) => deps.now?.() ?? new Date()

/**
 * `argv`（預設）：每段 SQL 各走一個 `-c`。`-c` 的字串原樣送 server，psql 不解讀其中的反斜線
 * 指令，呼叫者給的查詢與片段因此碰不到本機（`\!`、`\copy … program`、`\o`）。同一次呼叫的
 * `-c` 共用一條連線，交易跨 `-c` 延續；任何一段失敗 psql 即結束，未 COMMIT 的交易由 server 回滾。
 *
 * `stdin`：整串敘述從標準輸入送。只給「不含呼叫者片段、但內嵌整份列資料」的敘述用（insert 與
 * rollback 產生的三種操作）：單一 argv 上限 128 KiB，500 列的 JSON 放不進去，而且列資料會出現在
 * `/proc/<pid>/cmdline`。psql 會解讀 stdin 裡的反斜線指令與 `:變數`，所以這條路上的內容只能是
 * 本檔產生的 SQL，加上包在單引號字串或 dollar-quote 裡的資料。
 */
export type PsqlVia = 'argv' | 'stdin'

export function psqlInvocation(statements: string[], format: 'csv' | 'tuples', via: PsqlVia) {
  const head =
    format === 'csv'
      ? ['-X', '-q', '-w', '--csv', '-v', 'ON_ERROR_STOP=1']
      : ['-X', '-q', '-w', '-At', '-v', 'ON_ERROR_STOP=1']
  return via === 'stdin'
    ? { args: head, input: statements.map((statement) => `${statement};\n`).join('') }
    : { args: [...head, ...statements.flatMap((statement) => ['-c', statement])] }
}

function runPsql(
  deps: Deps,
  conn: Connection,
  statements: string[],
  format: 'csv' | 'tuples',
  via: PsqlVia = 'argv',
) {
  const { args, input } = psqlInvocation(statements, format, via)
  const result = (deps.run ?? systemRunner)('psql', args, {
    env: psqlEnv(conn, deps.env),
    input,
    passfile: passfileLine(conn),
  })
  if (result.error)
    throw new CliError(EXIT.query, `psql 無法執行：${result.error.message}（本機要有 psql）`)
  if (result.status !== 0) {
    const stderr = result.stderr.trim()
    if (stderr.includes(PREFLIGHT_TAG))
      throw new CliError(
        EXIT.roleUnsafe,
        `${stderr}\n角色權限不符標準，SQL 未執行。照 prod-access 規約 § 接入重跑 bootstrap，NEVER 換別的憑證繞過。`,
      )
    if (stderr.includes(ABORT_TAG)) throw new CliError(EXIT.aborted, stderr)
    throw new CliError(EXIT.query, stderr || `psql exit ${result.status}`)
  }
  return result.stdout
}

const cwdOf = (deps: Deps) => deps.cwd ?? process.cwd()
const consumerOf = (deps: Deps) => resolveConsumerId(cwdOf(deps), deps.consumerId)

const targetOf = (opts: Opts): TargetClass => (opts.drill ? 'drill' : 'prod')
const TARGET_LABEL: Record<TargetClass, string> = { prod: 'prod', drill: '演練' }

/**
 * 憑證的連線。`target` 由呼叫端明確指定（`--drill`），host 的解析結果必須相符：
 * 指定與實際不一致時拒絕，而不是照憑證檔指到哪就連到哪。
 */
async function connect(deps: Deps, role: Role, target: TargetClass) {
  const consumerId = consumerOf(deps)
  const path = credentialPath(consumerId, deps.env, role, target)
  const conn = loadCredential(path, role)
  const actual = await classifyHost(conn.host, deps.resolve)
  if (actual !== target)
    throw new CliError(
      EXIT.credential,
      `${path} 指向${TARGET_LABEL[actual]}目標，但這個位置只放${TARGET_LABEL[target]}的憑證。NEVER 使用這個檔，回報使用者。`,
    )
  return { consumerId, conn }
}

// ---------------------------------------------------------------------------
// read / check
// ---------------------------------------------------------------------------

/** `quoteLiteral` 只把單引號加倍；反斜線要照字面，靠這個設定（session 層級，後續敘述都適用） */
const STANDARD_STRINGS = 'SET standard_conforming_strings = on'

export function buildReadStatements(query: string, limit: number) {
  const tag = `$clade_${randomBytes(6).toString('hex')}$`
  return [
    STANDARD_STRINGS,
    preflightSql(READ_ROLE),
    'BEGIN TRANSACTION READ ONLY',
    `SET LOCAL statement_timeout = '${READ_STATEMENT_TIMEOUT}'`,
    // 查詢以字串交給 OPEN … FOR EXECUTE：它只收單一、會回傳列的敘述。直接接在 DECLARE 後面的話，
    // `select 1; commit; …` 會被 server 拆成多句，後面幾句就離開了唯讀交易與逾時設定。
    // 上限由 server 在 FETCH 截斷。
    `DO ${tag} DECLARE c refcursor := '${CURSOR}'; BEGIN OPEN c NO SCROLL FOR EXECUTE ${quoteLiteral(query)}; END ${tag}`,
    `FETCH ${limit + 1} FROM ${CURSOR}`,
    'ROLLBACK',
  ]
}

/** 最小 CSV 解析：只處理 psql --csv 的輸出（RFC 4180 引號、欄內可換行）。 */
export function parseCsv(text: string) {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\n') {
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else if (ch !== '\r') field += ch
  }
  if (field || record.length > 0) records.push([...record, field])
  return records
}

/** 回傳第 `count` 筆 CSV record 結束處的 offset（含換行）；不足 `count` 筆回 -1。 */
export function csvRecordEnd(text: string, count: number) {
  let quoted = false
  let seen = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') quoted = !quoted
    else if (ch === '\n' && !quoted && ++seen === count) return i + 1
  }
  return -1
}

/** 輸出含 header 一筆；資料超過 `limit` 筆就截到 `limit` 並標記 truncated。 */
export function capRows(csv: string, limit: number) {
  const end = csvRecordEnd(csv, limit + 1)
  if (end === -1 || end >= csv.length) return { csv, truncated: false }
  return { csv: csv.slice(0, end), truncated: true }
}

async function cmdRead(opts: Opts, deps: Deps) {
  if ((str(opts, 'sql') === undefined) === (str(opts, 'file') === undefined))
    throw new CliError(EXIT.usage, 'read 需要 --sql 或 --file 其中一個')
  const limit = parseRowLimit(opts.limit)
  const query = normalizeQuery(str(opts, 'sql') ?? readFileSync(String(opts.file), 'utf8'))
  const { conn } = await connect(deps, READ_ROLE, targetOf(opts))
  const raw = runPsql(deps, conn, buildReadStatements(query, limit), 'csv')
  const { csv, truncated } = capRows(raw, limit)
  if (Buffer.byteLength(csv) > MAX_OUTPUT_BYTES)
    throw new CliError(
      EXIT.query,
      `結果超過 ${MAX_OUTPUT_BYTES} bytes；縮小欄位或降低 --limit 後重查`,
    )
  out(deps, csv)
  if (truncated)
    err(
      deps,
      `prod-sql: 只回前 ${limit} 筆（還有更多）。要總數就查 count(*)，NEVER 靠調高 --limit 撈全表。\n`,
    )
}

function writePrivate(path: string, content: string) {
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  writeFileSync(path, content, { mode: 0o600 })
}

async function cmdCheck(opts: Opts, deps: Deps) {
  const role = parseRole(str(opts, 'role'))
  const target = targetOf(opts)
  const { consumerId, conn } = await connect(deps, role, target)
  return checkWith(role, consumerId, conn, opts, deps, target)
}

/** bootstrap 完成時直接以新憑證呼叫 */
function checkWith(
  role: Role,
  consumerId: string,
  conn: Connection,
  opts: Opts,
  deps: Deps,
  target: TargetClass,
) {
  const [header, row] = parseCsv(runPsql(deps, conn, [checkSql(role)], 'csv'))
  if (!header || !row) throw new CliError(EXIT.query, 'check 沒有拿到結果')
  const fields = Object.fromEntries(header.map((name, i) => [name, row[i] ?? '']))
  const list = (value: string) => (value ? value.split('; ') : [])
  const problems = list(fields.problems)
  if (fields.role !== role && !fields.role.startsWith(`${role}.`))
    problems.push(`connected as ${fields.role}, expected ${role}`)
  if (role === READ_ROLE && fields.default_transaction_read_only !== 'on')
    problems.push('default_transaction_read_only is not on')
  if (role === WRITE_ROLE) {
    // SQL 端量不到白名單（它在 repo 的設定檔裡），所以多出來的寫入授權在這裡比對
    const root = consumerRoot(cwdOf(deps))
    if (target === 'drill' && !existsSync(join(root, CONFIG_PATH)))
      problems.push(`no ${CONFIG_PATH} to compare writable tables against`)
    else {
      const allowed = new Set(
        readBootstrapConfig(root, target, committedReader(deps, consumerId)).write_tables,
      )
      const extra = list(fields.writable_tables).filter((table) => !allowed.has(table))
      if (extra.length > 0)
        problems.push(`role can write outside write_tables: ${extra.join(', ')}`)
    }
  }
  const receipt = {
    schema: 'clade.prod-access.role-check/v1',
    consumer_id: consumerId,
    checked_at: nowOf(deps).toISOString(),
    role: fields.role,
    database: fields.database,
    server_version: fields.server_version,
    statement_timeout: fields.statement_timeout,
    connection_limit: Number(fields.connection_limit),
    ok: problems.length === 0,
    problems,
    writable_tables: list(fields.writable_tables),
    definer_functions: list(fields.definer_functions),
  }
  const receiptPath = join(prodAccessDir(consumerId, deps.env, target), `role-check.${role}.json`)
  writePrivate(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  const bullets = (title: string, items: string[]) =>
    items.length > 0 ? `${title}\n${items.map((item) => `  - ${item}\n`).join('')}` : ''
  out(
    deps,
    opts.json
      ? `${JSON.stringify(receipt)}\n`
      : `${receipt.ok ? 'OK' : 'UNSAFE'} ${receipt.role}@${receipt.database}（receipt: ${receiptPath}）\n` +
          bullets('不符標準：', problems) +
          bullets('可寫的表：', receipt.writable_tables) +
          bullets(
            '可執行的 SECURITY DEFINER 函式（會寫資料的要收回 PUBLIC 執行權）：',
            receipt.definer_functions,
          ),
  )
  if (!receipt.ok) throw new CliError(EXIT.roleUnsafe, '角色權限不符標準')
}

// ---------------------------------------------------------------------------
// 寫入：plan → apply → rollback
// ---------------------------------------------------------------------------

/**
 * 一組資料列，以 server 回傳的 JSON 原文攜帶。NEVER 經 JSON.parse／JSON.stringify 轉手：
 * bigint 超過 2^53 與高精度 numeric 會被 JS 悄悄四捨五入，回滾就會寫回錯的值或對到錯的主鍵。
 */
export type RowSet = { json: string; count: number }

/**
 * 只有 update：`agent_rw` 在 DB 只拿得到 UPDATE。新增與刪除改走 migration 管線（PR 審查），
 * 因為它們的回滾要 INSERT／DELETE 權限，而那正是不開給 agent 的。
 */
export type Operation =
  | { kind: 'update'; table: string; where: string; set: string }
  // 只由 rollback 產生，資料來自 apply 落檔的 before
  | { kind: 'restore-rows'; table: string; rows: RowSet }

/**
 * `write_triggers`：目標表上對 UPDATE 觸發、而且可能寫到別的列或別的表的 trigger——不是
 * BEFORE ROW，或函式本體出現寫入、動態 SQL、PERFORM。只改 `NEW` 的 updated_at 類 trigger 不算。
 * 這是啟發式的護欄：它們的效果不在快照內、回滾不會還原，所以有就不准例行 apply。
 * 不含外鍵的參照動作（`tgisinternal`）：那類寫入不會被標警訊，見 prod-access 規約 § 已知限制。
 */
export type TableMeta = {
  pk: string[]
  columns: string[]
  triggers: string[]
  write_triggers: string[]
  size: number
}

const IDENT = '[a-z_][a-z0-9_]*'

export function assertTable(table: string) {
  if (!new RegExp(`^${IDENT}\\.${IDENT}$`, 'u').test(table))
    throw new CliError(EXIT.usage, `--table 必須是小寫的 <schema>.<table>：${table}`)
  return table
}

/**
 * 片段裡唯一放行的函式呼叫（不帶 schema，或帶 `pg_catalog.`）。其餘一律拒絕：會寫資料的
 * SECURITY DEFINER 函式從片段呼叫就以 owner 權限執行，plan 的 ROLLBACK 也撤不回它的外部副作用。
 */
export const FRAGMENT_SAFE_FUNCTIONS = new Set([
  'now',
  'lower',
  'upper',
  'trim',
  'length',
  'abs',
  'round',
  'coalesce',
  'nullif',
  'greatest',
  'least',
])
/** 後面接左括號但不是函式呼叫的關鍵字，與帶長度／精度的型別名（`::numeric(10, 2)`） */
const FRAGMENT_PAREN_WORDS = new Set([
  // 只收 PostgreSQL 不能當函式名的保留字（reserved／col_name_keyword）；`like`、`left` 這類
  // type_func_name_keyword 可以是函式名，不在這裡
  'and',
  'or',
  'not',
  'in',
  'any',
  'some',
  'all',
  'exists',
  'row',
  'array',
  'values',
  'cast',
  'case',
  'when',
  'then',
  'else',
  'between',
  'select',
  'from',
  'where',
  'on',
  'numeric',
  'decimal',
  'varchar',
  'char',
  'character',
  'bit',
  'time',
  'timestamp',
  'interval',
  'float',
])

/**
 * 片段裡的函式呼叫（識別字後接左括號，含帶引號的識別字與 schema 前綴），回傳第一個不在放行
 * 清單的名稱。字串常值與帶引號的識別字依 SQL 的跳脫規則跳過；`E'…'` 的反斜線跳脫會讓字串邊界
 * 判斷失準，整段拒絕。屬性寫法（`t.fn` 等於 `fn(t)`）沒有括號，這裡看不出來；SECURITY DEFINER
 * 函式由 preflight 擋，SECURITY INVOKER 函式的非交易副作用是規約記載的殘餘。
 */
export function fragmentFunctionCall(fragment: string): string | undefined {
  const identStart = /[\p{L}_]/u
  const identPart = /[\p{L}\p{N}_$]/u
  const skipSpace = (from: number) => {
    let i = from
    while (i < fragment.length && /\s/u.test(fragment[i])) i++
    return i
  }
  /** 從 `i` 讀一段識別字（裸的或帶引號的）；回傳 [正規化名稱, 結束位置, 是否帶引號] */
  const readIdent = (i: number): [string, number, boolean] | undefined => {
    if (fragment[i] === '"') {
      let j = i + 1
      let name = ''
      while (j < fragment.length) {
        if (fragment[j] === '"' && fragment[j + 1] === '"') {
          name += '"'
          j += 2
        } else if (fragment[j] === '"') return [name, j + 1, true]
        else name += fragment[j++]
      }
      return [name, j, true]
    }
    if (!identStart.test(fragment[i] ?? '')) return undefined
    let j = i + 1
    while (j < fragment.length && identPart.test(fragment[j])) j++
    return [fragment.slice(i, j).toLowerCase(), j, false]
  }
  let i = 0
  while (i < fragment.length) {
    const ch = fragment[i]
    if (ch === "'") {
      if (/[eE]/u.test(fragment[i - 1] ?? '') && !identPart.test(fragment[i - 2] ?? ''))
        return "E'…'"
      let j = i + 1
      while (j < fragment.length && !(fragment[j] === "'" && fragment[j + 1] !== "'")) {
        j += fragment[j] === "'" ? 2 : 1
      }
      i = j + 1
      continue
    }
    const first = readIdent(i)
    if (!first) {
      i++
      continue
    }
    const parts = [first[0]]
    let quoted = first[2]
    let end = first[1]
    for (;;) {
      const dot = skipSpace(end)
      if (fragment[dot] !== '.') break
      const next = readIdent(skipSpace(dot + 1))
      if (!next) break
      parts.push(next[0])
      quoted = next[2]
      end = next[1]
    }
    i = end
    if (fragment[skipSpace(end)] !== '(') continue
    const fn = parts.at(-1) ?? ''
    const qualifier = parts.slice(0, -1)
    if (qualifier.length === 0 && !quoted && FRAGMENT_PAREN_WORDS.has(fn)) continue
    const builtin =
      qualifier.length === 0 || (qualifier.length === 1 && qualifier[0] === 'pg_catalog')
    if (!(builtin && !quoted && FRAGMENT_SAFE_FUNCTIONS.has(fn))) return parts.join('.')
  }
  return undefined
}

/** 片段原樣進 SQL；分號、註解、dollar-quote 與函式呼叫在這裡擋掉，其餘由角色權限把關。 */
export function assertFragment(name: string, fragment: string) {
  if (/[;\0]|\$[\p{L}\p{N}_]*\$|--|\/\*/u.test(fragment))
    throw new CliError(
      EXIT.usage,
      `--${name} 不可含分號、註解或 dollar-quote；一次 plan 只做一件事`,
    )
  const call = fragmentFunctionCall(fragment)
  if (call)
    throw new CliError(
      EXIT.usage,
      `--${name} 含函式呼叫 ${call}(…)：片段只放行 ${[...FRAGMENT_SAFE_FUNCTIONS].join('、')}（E'…' 字串也不收）。其他函式可能是 SECURITY DEFINER、以 owner 權限寫到白名單外；先用 read 算出值再寫成常值，或改走 migration`,
    )
  return fragment.trim()
}

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`
const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`
const jsonLiteral = (rows: RowSet) => `${quoteLiteral(rows.json)}::jsonb`

/** trigger 函式本體出現這些字就當成可能寫到別處。經 `quoteLiteral` 送出，執行它的批次 MUST 先 `STANDARD_STRINGS` */
const TRIGGER_WRITE_PATTERN = String.raw`\m(insert|delete|truncate|merge|perform|execute|copy)\M|\mupdate\M\s+\S+\s+\mset\M`

export function tableMetaSql(table: string) {
  const rel = `${quoteLiteral(table)}::regclass`
  // tgtype 位元：1 = ROW、2 = BEFORE、16 = UPDATE
  return `SELECT jsonb_build_object(
  'pk', (SELECT coalesce(jsonb_agg(a.attname ORDER BY k.ord), '[]'::jsonb)
           FROM pg_index i
           CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
          WHERE i.indrelid = ${rel} AND i.indisprimary),
  'columns', (SELECT jsonb_agg(attname ORDER BY attnum) FROM pg_attribute
               WHERE attrelid = ${rel} AND attnum > 0 AND NOT attisdropped AND attgenerated = ''),
  'triggers', (SELECT coalesce(jsonb_agg(tgname ORDER BY tgname), '[]'::jsonb) FROM pg_trigger
                WHERE tgrelid = ${rel} AND NOT tgisinternal),
  'write_triggers', (SELECT coalesce(jsonb_agg(t.tgname ORDER BY t.tgname), '[]'::jsonb)
                       FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                      WHERE t.tgrelid = ${rel} AND NOT t.tgisinternal AND (t.tgtype & 16) <> 0
                        AND ((t.tgtype & 3) <> 3 OR p.prosrc ~* ${quoteLiteral(TRIGGER_WRITE_PATTERN)})),
  'size', pg_total_relation_size(${rel}))`
}

function recordset(table: string, rows: RowSet) {
  return `jsonb_populate_recordset(NULL::${table}, ${jsonLiteral(rows)})`
}

function pkMatch(meta: TableMeta, left: string, right: string) {
  return meta.pk
    .map((col) => `${left}.${quoteIdent(col)} = ${right}.${quoteIdent(col)}`)
    .join(' AND ')
}

/** 受影響列的條件與實際 DML。`expected` 為 null 時以「條件命中的列數」為準。 */
export function buildDml(op: Operation, meta: TableMeta) {
  const t = op.table
  if (op.kind === 'update')
    return {
      where: op.where,
      dml: `UPDATE ${t} AS t SET ${op.set} WHERE ${op.where}`,
      expected: null,
    }
  const cols = meta.columns.filter((col) => !meta.pk.includes(col))
  const assign = `(${cols.map(quoteIdent).join(', ')}) = ROW(${cols.map((col) => `r.${quoteIdent(col)}`).join(', ')})`
  return {
    where: `EXISTS (SELECT 1 FROM ${recordset(t, op.rows)} AS r WHERE ${pkMatch(meta, 't', 'r')})`,
    dml: `UPDATE ${t} AS t SET ${assign} FROM ${recordset(t, op.rows)} AS r WHERE ${pkMatch(meta, 't', 'r')}`,
    expected: op.rows.count,
  }
}

/**
 * 內嵌列資料的操作（回滾）不含呼叫者片段，敘述改走 stdin：單一 argv 上限 128 KiB，而且列資料
 * 會出現在 `/proc/<pid>/cmdline`（見 `psqlInvocation`）。
 */
const viaOf = (op: Operation): PsqlVia => ('rows' in op ? 'stdin' : 'argv')

function imageSql(table: string, meta: TableMeta, source: string) {
  const order = meta.pk.map((col) => `s.${quoteIdent(col)}`).join(', ')
  // 一列三欄以 tab 分隔：md5、筆數、JSON 原文（jsonb 的文字輸出不含未跳脫的 tab／換行）
  return `SELECT md5(x.rows::text) || E'\\t' || jsonb_array_length(x.rows) || E'\\t' || x.rows::text FROM (
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY ${order}), '[]'::jsonb) AS rows FROM (${source}) AS s) AS x`
}

function affectedRowsSql(op: Operation, meta: TableMeta, where: string) {
  return `SELECT * FROM ${op.table} AS t WHERE ${where} ORDER BY ${meta.pk.map((col) => `t.${quoteIdent(col)}`).join(', ')} LIMIT ${MAX_WRITE_ROWS + 1} FOR UPDATE`
}

/**
 * plan 與 apply 跑同一串敘述，只差結尾 ROLLBACK／COMMIT 與 `verify`。DO 區塊在同一個交易裡
 * 鎖住受影響列、（apply 時）比對內容與 plan 相同、執行 DML、比對列數，再確認這個交易在目標表
 * 產生的新版本列數與 DML 列數一致——trigger 在同表多改了列就會不一致。任何一項不符就 RAISE，
 * 交易整筆回滾。
 */
export function buildWriteStatements(
  op: Operation,
  meta: TableMeta,
  mode: { commit: boolean; verify?: { md5: string; count: number } },
) {
  const { where, dml, expected } = buildDml(op, meta)
  const t = op.table
  const order = meta.pk.map((col) => `s.${quoteIdent(col)}`).join(', ')
  const locked = affectedRowsSql(op, meta, where)
  const mine = `SELECT * FROM ${t} AS t WHERE t.xmin::text = pg_current_xact_id()::xid::text`
  const tag = `$clade_${randomBytes(6).toString('hex')}$`
  const keys = `coalesce(jsonb_agg(jsonb_build_array(${order}) ORDER BY ${order}), '[]'::jsonb)`
  const block = `DO ${tag}
DECLARE before_md5 text; before_count bigint; affected bigint; produced bigint;
  before_keys jsonb; after_keys jsonb;
BEGIN
  SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY ${order}), '[]'::jsonb)::text), count(*), ${keys}
    INTO before_md5, before_count, before_keys FROM (${locked}) AS s;
  IF before_count > ${MAX_WRITE_ROWS} THEN
    RAISE EXCEPTION '${ABORT_TAG}: 條件命中超過 ${MAX_WRITE_ROWS} 列，拆批或改走 migration';
  END IF;
  ${
    mode.verify
      ? `IF before_count <> ${mode.verify.count} OR before_md5 <> ${quoteLiteral(mode.verify.md5)} THEN
    RAISE EXCEPTION '${ABORT_TAG}: 受影響列與 plan 不同（現在 % 筆，plan ${mode.verify.count} 筆）；重新 plan', before_count;
  END IF;`
      : ''
  }
  ${dml};
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> ${expected ?? 'before_count'} THEN
    RAISE EXCEPTION '${ABORT_TAG}: DML 影響 % 列，預期 % 列', affected, ${expected ?? 'before_count'};
  END IF;
  SELECT count(*) INTO produced FROM (${mine}) AS s;
  IF produced <> affected THEN
    RAISE EXCEPTION '${ABORT_TAG}: 本交易在 ${t} 產生 % 列新版本，DML 只影響 % 列（trigger 改了同表其他列？）', produced, affected;
  END IF;
  SELECT ${keys} INTO after_keys FROM (${mine}) AS s;
  IF after_keys <> before_keys THEN
    RAISE EXCEPTION '${ABORT_TAG}: 這個 update 改到主鍵欄，rollback 無法依主鍵對回原列；改走 migration';
  END IF;
END
${tag}`
  return [
    STANDARD_STRINGS,
    preflightSql(WRITE_ROLE),
    'BEGIN',
    `SET LOCAL lock_timeout = '${WRITE_LOCK_TIMEOUT}'`,
    `SET LOCAL statement_timeout = '${WRITE_STATEMENT_TIMEOUT}'`,
    imageSql(t, meta, locked),
    block,
    imageSql(t, meta, mine),
    mode.commit ? 'COMMIT' : 'ROLLBACK',
  ]
}

export type Image = RowSet & { md5: string }

function parseImageLine(line: string): Image {
  const [md5, count, ...rest] = line.split('\t')
  if (!/^[0-9a-f]{32}$/u.test(md5) || !/^\d+$/u.test(count) || rest.length === 0)
    throw new CliError(EXIT.query, '結果格式不符')
  return { md5, count: Number(count), json: rest.join('\t') }
}

export function parseImages(stdout: string): [Image, Image] {
  const lines = stdout.split('\n').filter(Boolean)
  if (lines.length !== 2) throw new CliError(EXIT.query, `預期兩段結果，拿到 ${lines.length} 段`)
  return [parseImageLine(lines[0]), parseImageLine(lines[1])]
}

/** 取 JSON 陣列原文的前 `limit` 個元素（原文切片，不解析數值）。 */
export function firstElements(json: string, limit: number) {
  const items: string[] = []
  let depth = 0
  let quoted = false
  let start = -1
  for (let i = 0; i < json.length && items.length < limit; i++) {
    const ch = json[i]
    if (quoted) {
      if (ch === '\\') i++
      else if (ch === '"') quoted = false
    } else if (ch === '"') quoted = true
    else if (ch === '{' || ch === '[') {
      if (depth === 1 && start === -1) start = i
      depth++
    } else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 1 && start !== -1) {
        items.push(json.slice(start, i + 1))
        start = -1
      }
    }
  }
  return items
}

/** plan 的警訊：任一項成立就不准 apply（回滾除外），改走 migration。 */
export type Flag = 'rows' | 'write-trigger'

export type Plan = {
  schema: 'clade.prod-access.plan/v2'
  plan_id: string
  hash: string
  consumer_id: string
  created_at: string
  expires_at: string
  reason: string
  /** 請求來源（票號、訊息原文）。agent 自述，稽核用，不是閘 */
  source: string
  target: string
  target_class: TargetClass
  op: Operation
  meta: TableMeta
  before: Image
  after_count: number
  flags: Flag[]
  rollback_of?: string
  consumed_at?: string
}

/** hash 涵蓋會被執行的東西、當時的資料與判斷依據；改 plan 檔延長期限或拿掉警訊都會被認出。 */
export function planHash(plan: Omit<Plan, 'hash' | 'consumed_at'>) {
  const material = {
    plan_id: plan.plan_id,
    consumer_id: plan.consumer_id,
    created_at: plan.created_at,
    expires_at: plan.expires_at,
    reason: plan.reason,
    source: plan.source,
    target: plan.target,
    target_class: plan.target_class,
    op: plan.op,
    meta: plan.meta,
    rollback_of: plan.rollback_of,
    before_md5: plan.before.md5,
    after_count: plan.after_count,
    flags: plan.flags,
  }
  return createHash('sha256').update(JSON.stringify(material)).digest('hex')
}

const shortHash = (hash: string) => hash.slice(0, HASH_QUOTE_LENGTH)

function newId(deps: Deps, prefix: string) {
  const stamp = nowOf(deps).toISOString().replace(/[-:]/gu, '').slice(0, 15)
  return `${prefix}-${stamp}-${deps.randomId?.() ?? randomBytes(3).toString('hex')}`
}

function planPath(consumerId: string, planId: string, deps: Deps) {
  if (!/^[a-z]+-[0-9T]+-[0-9a-f]+$/u.test(planId))
    throw new CliError(EXIT.usage, `plan id 不合法：${planId}`)
  return join(stateDir(consumerId, deps.env), 'plans', `${planId}.json`)
}

function savePlan(plan: Plan, deps: Deps) {
  writePrivate(planPath(plan.consumer_id, plan.plan_id, deps), `${JSON.stringify(plan, null, 2)}\n`)
}

function loadPlan(consumerId: string, planId: string, deps: Deps): Plan {
  const path = planPath(consumerId, planId, deps)
  if (!existsSync(path)) throw new CliError(EXIT.usage, `找不到 plan ${planId}`)
  const plan: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isPlan(plan) || plan.plan_id !== planId || plan.consumer_id !== consumerId)
    throw new CliError(
      EXIT.refused,
      `plan 檔 ${path} 的形狀或身分不符（舊版 plan 也算），重新 plan`,
    )
  return plan
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

/** 只驗結構；內容有沒有被改過由 `assertUsable` 以 hash 比對。 */
function isPlan(value: unknown): value is Plan {
  return (
    isRecord(value) &&
    value.schema === 'clade.prod-access.plan/v2' &&
    (value.target_class === 'prod' || value.target_class === 'drill') &&
    isRecord(value.op) &&
    isRecord(value.meta) &&
    isRecord(value.before) &&
    isStrings(value.flags) &&
    typeof value.after_count === 'number' &&
    [
      'plan_id',
      'hash',
      'consumer_id',
      'created_at',
      'expires_at',
      'reason',
      'source',
      'target',
    ].every((key) => typeof value[key] === 'string')
  )
}

function parseTableMeta(text: string): TableMeta {
  const meta: unknown = JSON.parse(text)
  if (
    !isRecord(meta) ||
    !isStrings(meta.pk) ||
    !isStrings(meta.columns) ||
    !isStrings(meta.triggers) ||
    !isStrings(meta.write_triggers) ||
    typeof meta.size !== 'number'
  )
    throw new CliError(EXIT.query, '表結構查詢的結果格式不符')
  return {
    pk: meta.pk,
    columns: meta.columns,
    triggers: meta.triggers,
    write_triggers: meta.write_triggers,
    size: meta.size,
  }
}

function ledgerPath(consumerId: string, deps: Deps) {
  return join(stateDir(consumerId, deps.env), 'ledger.jsonl')
}

function ledger(consumerId: string, deps: Deps, event: Record<string, unknown>) {
  const path = ledgerPath(consumerId, deps)
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  appendFileSync(
    path,
    `${JSON.stringify({ at: nowOf(deps).toISOString(), consumer_id: consumerId, ...event })}\n`,
    { mode: 0o600 },
  )
}

/** 內容沒被改過、沒用過、沒過期。每個 plan 只能進 apply 一次，不論成敗。 */
export function assertUsable(plan: Plan, now: Date) {
  if (plan.hash !== planHash(plan))
    throw new CliError(EXIT.refused, 'plan 檔內容與它的 hash 不符（被改過），重新 plan')
  if (plan.consumed_at)
    throw new CliError(
      EXIT.refused,
      `plan ${plan.plan_id} 已在 ${plan.consumed_at} 用過，重新 plan`,
    )
  if (now.getTime() > Date.parse(plan.expires_at))
    throw new CliError(EXIT.refused, `plan ${plan.plan_id} 已過期，重新 plan`)
}

const FLAG_LABEL: Record<Flag, string> = {
  rows: `超過 ${ROUTINE_MAX_ROWS} 列`,
  'write-trigger': '目標表有會寫到別處的 trigger（效果不在快照內，回滾不會還原）',
}

export function planFlags(before: Image, meta: TableMeta): Flag[] {
  const flags: Flag[] = []
  if (before.count > ROUTINE_MAX_ROWS) flags.push('rows')
  if (meta.write_triggers.length > 0) flags.push('write-trigger')
  return flags
}

function sample(rows: RowSet) {
  return firstElements(rows.json, 3)
    .map((row) => `    ${row}\n`)
    .join('')
}

const drillFlag = (target: TargetClass) => (target === 'drill' ? ' --drill' : '')

async function makeDmlPlan(
  op: Operation,
  plan: { reason: string; source: string; expect?: number },
  target: TargetClass,
  deps: Deps,
  rollbackOf?: string,
) {
  const consumerId = consumerOf(deps)
  const { conn } = await connect(deps, WRITE_ROLE, target)
  const meta = parseTableMeta(
    runPsql(
      deps,
      conn,
      [STANDARD_STRINGS, preflightSql(WRITE_ROLE), tableMetaSql(op.table)],
      'tuples',
    ),
  )
  if (meta.pk.length === 0)
    throw new CliError(
      EXIT.usage,
      `${op.table} 沒有 primary key，無法逐列快照與回滾；改走 migration`,
    )
  if (meta.size > MAX_DUMP_TABLE_BYTES)
    throw new CliError(
      EXIT.usage,
      `${op.table} 有 ${meta.size} bytes，超過 apply 前 dump 的上限 ${MAX_DUMP_TABLE_BYTES}；改走 migration`,
    )
  // 有警訊的 plan 不准 apply（回滾除外），而試跑會讓 trigger 在 prod 真的執行一次、非交易性的
  // 副作用（pg_net、dblink）撤不回；已知有 write trigger 就在試跑前拒絕
  if (target === 'prod' && !rollbackOf && meta.write_triggers.length > 0)
    throw new CliError(
      EXIT.refused,
      `${op.table} 有會寫到別處的 trigger（${meta.write_triggers.join(', ')}）：效果不在快照內、回滾不會還原，不在 prod 試跑。資料修正改走 migration 管線（PR 審查，同一 commit 同步 seed）。沒有產生 plan`,
    )
  // 兩類目標都在交易內實跑後 ROLLBACK：拿到變更前後的列，DB 不變
  const [before, after] = parseImages(
    runPsql(deps, conn, buildWriteStatements(op, meta, { commit: false }), 'tuples', viaOf(op)),
  )
  if (plan.expect !== undefined && before.count !== plan.expect)
    throw new CliError(
      EXIT.usage,
      `條件命中 ${before.count} 列，--expect 是 ${plan.expect}；先確認條件撈到的是要改的那些列。沒有產生 plan`,
    )
  const flags = planFlags(before, meta)
  const createdAt = nowOf(deps)
  const draft = {
    schema: 'clade.prod-access.plan/v2' as const,
    plan_id: newId(deps, 'plan'),
    consumer_id: consumerId,
    created_at: createdAt.toISOString(),
    expires_at: new Date(createdAt.getTime() + PLAN_TTL_MINUTES * 60_000).toISOString(),
    reason: plan.reason,
    source: plan.source,
    target: `${conn.host}:${conn.port}/${conn.database}`,
    target_class: target,
    op,
    meta,
    before,
    after_count: after.count,
    flags,
    rollback_of: rollbackOf,
  }
  const saved: Plan = { ...draft, hash: planHash(draft) }
  savePlan(saved, deps)
  ledger(consumerId, deps, {
    event: 'plan',
    plan_id: saved.plan_id,
    hash: saved.hash,
    target_class: target,
    op: op.kind,
    table: op.table,
    rows: before.count,
    flags,
    source: plan.source,
    reason: plan.reason,
    rollback_of: rollbackOf,
  })
  const blocked = flags.length > 0 && !rollbackOf
  out(
    deps,
    `PLAN ${saved.plan_id}  hash ${shortHash(saved.hash)}\n` +
      `  目標：${saved.target}（${TARGET_LABEL[target]}）  ${op.table}  ${op.kind}${rollbackOf ? `（回滾 ${rollbackOf}）` : ''}\n` +
      `  來源：${plan.source}\n` +
      `  理由：${plan.reason}\n` +
      ('where' in op ? `  條件：${op.where}\n` : '') +
      ('set' in op ? `  指派：${op.set}\n` : '') +
      `  受影響：${before.count} 列（試跑後已 ROLLBACK，DB 未變）\n` +
      (before.count > 0 ? `  變更前（前 3 列）：\n${sample(before)}` : '') +
      (after.count > 0 ? `  變更後（前 3 列）：\n${sample(after)}` : '') +
      (meta.triggers.length > 0 ? `  表上的 trigger：${meta.triggers.join(', ')}\n` : '') +
      (flags.length > 0
        ? `  警訊：${flags.map((flag) => FLAG_LABEL[flag]).join('；')}\n`
        : '  警訊：無（例行）\n') +
      (blocked
        ? `\n這張 plan 不能由 agent 自行 apply：有警訊的資料修正改走 migration 管線（PR 審查，同一 commit 同步 seed），或縮小條件後重新 plan。\n`
        : `\n執行：node scripts/prod-sql.ts apply ${saved.plan_id}${drillFlag(target)}\n` +
          `plan 在 ${saved.expires_at} 過期，只能執行一次。\n`),
  )
  return saved
}

async function cmdPlan(opts: Opts, deps: Deps) {
  const table = assertTable(need(opts, 'table'))
  const reason = need(opts, 'reason')
  const source = need(opts, 'source')
  const kind = need(opts, 'op')
  if (kind !== 'update')
    throw new CliError(
      EXIT.usage,
      `--op 只能是 update：${WRITE_ROLE} 在 DB 沒有 INSERT／DELETE 權限。新增或刪除資料列改走 migration 管線`,
    )
  const expect = Number(need(opts, 'expect'))
  if (!Number.isInteger(expect) || expect < 1 || expect > MAX_WRITE_ROWS)
    throw new CliError(EXIT.usage, `--expect 必須是 1–${MAX_WRITE_ROWS} 的整數（你預期會改到幾列）`)
  const op: Operation = {
    kind,
    table,
    where: assertFragment('where', need(opts, 'where')),
    set: assertFragment('set', need(opts, 'set')),
  }
  await makeDmlPlan(op, { reason, source, expect }, targetOf(opts), deps)
}

/** plan 檔裡會原樣進 SQL 的欄位：與 plan 時同一套檢查（restore-rows 的表名經 stdin 給 psql，更要驗）。 */
function assertPlanOp(op: Operation) {
  if (op.kind !== 'update' && op.kind !== 'restore-rows')
    throw new CliError(
      EXIT.refused,
      `plan 的操作 ${String((op as { kind: unknown }).kind)} 不合法，重新 plan`,
    )
  try {
    assertTable(op.table)
    if (op.kind === 'update') {
      assertFragment('where', op.where)
      assertFragment('set', op.set)
    }
  } catch (error) {
    throw new CliError(
      EXIT.refused,
      `plan 檔的操作通不過 plan 時的檢查（被改過？）：${error instanceof Error ? error.message : String(error)}。重新 plan`,
    )
  }
}

/** 以獨佔建檔搶「用掉這個 plan」的資格：兩個同時進來的 apply 只有一個過得去。 */
const consumedPath = (plan: Plan, deps: Deps) =>
  `${planPath(plan.consumer_id, plan.plan_id, deps)}.consumed`

function consume(plan: Plan, deps: Deps) {
  const marker = consumedPath(plan, deps)
  try {
    writeFileSync(marker, `${nowOf(deps).toISOString()}\n`, { flag: 'wx', mode: 0o600 })
  } catch {
    throw new CliError(EXIT.refused, `plan ${plan.plan_id} 正被另一個 apply 使用或已用過`)
  }
  plan.consumed_at = nowOf(deps).toISOString()
  savePlan(plan, deps)
}

/**
 * 回滾豁免警訊、每日上限與備份前提（出事時要能撤銷）。豁免只給對得上落檔紀錄的逆向 plan：
 * `rollback_of` 指到的 apply 存在、同一張表、同一個目標，列資料就是那次 apply 落檔的 before。
 */
function isGenuineRollback(plan: Plan, consumerId: string, deps: Deps) {
  if (!plan.rollback_of || !/^apply-[0-9T]+-[0-9a-f]+$/u.test(plan.rollback_of)) return false
  if (plan.op.kind !== 'restore-rows') return false
  const dir = join(stateDir(consumerId, deps.env), 'applies', plan.rollback_of)
  try {
    const record: unknown = JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8'))
    if (!isRecord(record) || record.table !== plan.op.table || record.target !== plan.target)
      return false
    return readFileSync(join(dir, 'before.json'), 'utf8').trim() === plan.op.rows.json
  } catch {
    return false
  }
}

/** 今天（UTC）這個目標已經 apply 過的次數與列數，回滾不算。ledger 在本機，agent 改得到：這是防失控迴圈。 */
export function dailyUsage(ledgerText: string, target: TargetClass, now: Date) {
  const day = now.toISOString().slice(0, 10)
  let applies = 0
  let rows = 0
  for (const line of ledgerText.split('\n')) {
    if (!line.trim()) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (
      !isRecord(event) ||
      event.event !== 'apply' ||
      event.op === 'bootstrap' ||
      event.target_class !== target ||
      event.rollback_of ||
      typeof event.at !== 'string' ||
      !event.at.startsWith(day)
    )
      continue
    applies++
    rows += typeof event.rows === 'number' ? event.rows : 0
  }
  return { applies, rows }
}

async function cmdApply(opts: Opts, positional: string[], deps: Deps) {
  const planId = positional[0]
  if (!planId) throw new CliError(EXIT.usage, 'apply 需要 plan id')
  const consumerId = consumerOf(deps)
  // plan 檔只讀這一次：檢查與執行用同一個物件
  const plan = loadPlan(consumerId, planId, deps)
  const target = targetOf(opts)
  if (plan.target_class !== target)
    throw new CliError(
      EXIT.usage,
      `plan ${planId} 的目標是${TARGET_LABEL[plan.target_class]}；${plan.target_class === 'drill' ? 'apply 要加 --drill' : 'apply 不可加 --drill'}`,
    )
  assertUsable(plan, nowOf(deps))
  // hash 沒有 key，同帳號改得到 plan 檔也算得出新 hash：會進 SQL 的欄位在這裡重驗一次
  assertPlanOp(plan.op)
  const rollback = isGenuineRollback(plan, consumerId, deps)
  if (!rollback) {
    if (plan.flags.length > 0)
      throw new CliError(
        EXIT.refused,
        `plan ${planId} 有警訊（${plan.flags.map((flag) => FLAG_LABEL[flag]).join('；')}），agent 不能自行 apply。改走 migration 管線，或縮小條件後重新 plan。plan 沒有被消耗。`,
      )
    const path = ledgerPath(consumerId, deps)
    const used = dailyUsage(existsSync(path) ? readFileSync(path, 'utf8') : '', target, nowOf(deps))
    if (used.applies >= MAX_DAILY_APPLIES || used.rows + plan.before.count > MAX_DAILY_ROWS)
      throw new CliError(
        EXIT.refused,
        `今天（UTC）對${TARGET_LABEL[target]}已 apply ${used.applies} 次、${used.rows} 列，上限 ${MAX_DAILY_APPLIES} 次／${MAX_DAILY_ROWS} 列。批次修正改走 migration 管線。plan 沒有被消耗。`,
      )
    if (target === 'prod') {
      const cfg = readBootstrapConfig(
        consumerRoot(cwdOf(deps)),
        'prod',
        committedReader(deps, consumerId),
      )
      assertBackupAttested(cfg.backup, nowOf(deps))
    }
  }
  if (existsSync(consumedPath(plan, deps)))
    throw new CliError(EXIT.refused, `plan ${plan.plan_id} 正被另一個 apply 使用或已用過`)
  const { conn } = await connect(deps, WRITE_ROLE, target)
  if (plan.target !== `${conn.host}:${conn.port}/${conn.database}`)
    throw new CliError(EXIT.refused, 'plan 的目標與目前憑證指向的 DB 不同，重新 plan')
  if (!rollback) {
    // plan 檔裡的 meta 是當時的量測、改得掉；write trigger 以 apply 這一刻的 DB 為準
    const meta = parseTableMeta(
      runPsql(
        deps,
        conn,
        [STANDARD_STRINGS, preflightSql(WRITE_ROLE), tableMetaSql(plan.op.table)],
        'tuples',
      ),
    )
    if (meta.write_triggers.length > 0)
      throw new CliError(
        EXIT.refused,
        `${plan.op.table} 現在有會寫到別處的 trigger（${meta.write_triggers.join(', ')}），agent 不能自行 apply；改走 migration 管線。plan 沒有被消耗。`,
      )
  }
  await runApply(plan, conn, consumerId, target, deps)
}

/** 檢查都過了之後的 apply 本體。 */
async function runApply(
  plan: Plan,
  conn: Connection,
  consumerId: string,
  target: TargetClass,
  deps: Deps,
) {
  consume(plan, deps)

  const applyId = newId(deps, 'apply')
  const dir = join(stateDir(consumerId, deps.env), 'applies', applyId)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const base = {
    apply_id: applyId,
    plan_id: plan.plan_id,
    hash: plan.hash,
    op: plan.op.kind,
    table: plan.op.table,
    target: plan.target,
    target_class: target,
    source: plan.source,
    dir,
    rollback_of: plan.rollback_of,
  }
  const fail = (code: number, message: string, outcome: string): never => {
    ledger(consumerId, deps, { event: 'apply-failed', ...base, outcome, error: message })
    throw new CliError(code, message)
  }

  // 回退用的兩份資料先落檔：受影響列的原始內容，以及整張目標表的 dump
  writePrivate(join(dir, 'before.json'), `${plan.before.json}\n`)
  const dumpPath = join(dir, 'dump.sql')
  const dump = (deps.run ?? systemRunner)(
    'pg_dump',
    ['--data-only', '--no-owner', '--no-password', `--table=${plan.op.table}`, '-f', dumpPath],
    { env: psqlEnv(conn, deps.env), passfile: passfileLine(conn) },
  )
  if (dump.error || dump.status !== 0 || !existsSync(dumpPath))
    fail(
      EXIT.aborted,
      `apply 前的 pg_dump 失敗，未執行任何寫入：${(dump.error?.message ?? dump.stderr).trim()}`,
      'not-applied',
    )
  const dumpSha = createHash('sha256').update(readFileSync(dumpPath)).digest('hex')

  let after: Image
  try {
    ;[, after] = parseImages(
      runPsql(
        deps,
        conn,
        buildWriteStatements(plan.op, plan.meta, {
          commit: true,
          verify: { md5: plan.before.md5, count: plan.before.count },
        }),
        'tuples',
        viaOf(plan.op),
      ),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // server 回 ERROR 就是交易沒有 COMMIT（ON_ERROR_STOP 在那一段就停）；連線層的失敗結果不明
    const rejected =
      error instanceof CliError &&
      (error.code !== EXIT.query || /^(psql:.*)?ERROR:/mu.test(message))
    return fail(
      EXIT.aborted,
      rejected
        ? `apply 中止，交易已回滾，${TARGET_LABEL[target]} DB 未變：${message}`
        : `apply 結果不明（可能已 COMMIT 也可能沒有）：${message}\n先用 read 比對 ${plan.op.table} 與 ${join(dir, 'before.json')}，NEVER 直接重跑。`,
      rejected ? 'not-applied' : 'unknown',
    )
  }
  writePrivate(join(dir, 'after.json'), `${after.json}\n`)
  writePrivate(
    join(dir, 'record.json'),
    `${JSON.stringify({ schema: 'clade.prod-access.apply/v1', ...base, meta: plan.meta, applied_at: nowOf(deps).toISOString(), before_count: plan.before.count, after_count: after.count, dump_sha256: dumpSha }, null, 2)}\n`,
  )
  ledger(consumerId, deps, {
    event: 'apply',
    ...base,
    rows: Math.max(plan.before.count, after.count),
    dump: dumpPath,
    dump_sha256: dumpSha,
  })
  out(
    deps,
    `APPLIED ${applyId}（plan ${plan.plan_id}）：${plan.target}（${TARGET_LABEL[target]}） ${plan.op.table} ${plan.op.kind} ` +
      `${Math.max(plan.before.count, after.count)} 列，已 COMMIT\n` +
      `  回退資料：${dir}\n  要撤銷：node scripts/prod-sql.ts rollback ${applyId}${drillFlag(target)} --reason '<為什麼>'\n`,
  )
}

// ---------------------------------------------------------------------------
// 異地備份宣告：prod 的資料異動要先有一份沒過期的
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000

/**
 * 設定檔的 `backup` 區段。prod 讀 origin 預設分支那份：宣告要經 PR 合入，不是 agent 在工作樹
 * 寫一筆就算。流程是 Charles 先對盤點結果拍板、agent 寫這段、0-A 審過即合。CLI 連不到備份主機，驗的是「宣告存在、指得到拍板、沒過期」，
 * 不是備份本身；`decision` 只驗形狀，指的那筆拍板真不真由 PR 審查對照。
 */
export type BackupAttestation = {
  /** 不在 prod 主機上的那份副本放在哪 */
  offsite_location: string
  /** agent 平常的身分（含它握有的 SSH 金鑰與雲端憑證）為什麼刪改不了那份副本 */
  agent_cannot_alter: string
  /** 最近一次實際從那份副本還原成功的日期（YYYY-MM-DD） */
  last_restore_drill: string
  /** 盤點與還原演練的證據（repo 內路徑） */
  evidence: string
  /** Charles 對這份盤點拍板的 flow 決策 span id（16 位小寫 hex） */
  decision: string
  /** 宣告日期（YYYY-MM-DD）；過期要重新盤點 */
  attested_at: string
}

const parseDay = (text: unknown) =>
  typeof text === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/u.test(text) &&
  !Number.isNaN(Date.parse(`${text}T00:00:00Z`))
    ? Date.parse(`${text}T00:00:00Z`)
    : undefined

export function assertBackupAttested(backup: unknown, now: Date): BackupAttestation {
  const hint =
    '在 consumer 的 `.claude/prod-access.json` 補 `backup` 區段（見 vendor/snippets/prod-access/README.md § 庫級備份盤點），經 PR 合入後再 apply；沒有異地備份就先建立並做一次還原演練。這個 plan 沒有被消耗。'
  const b = isRecord(backup) ? backup : {}
  const attestedAt = parseDay(b.attested_at)
  const drill = parseDay(b.last_restore_drill)
  const text = (value: unknown) => typeof value === 'string' && [...value.trim()].length >= 8
  if (
    !text(b.offsite_location) ||
    !text(b.agent_cannot_alter) ||
    typeof b.evidence !== 'string' ||
    !b.evidence.trim() ||
    typeof b.decision !== 'string' ||
    !/^[0-9a-f]{16}$/u.test(b.decision) ||
    attestedAt === undefined ||
    drill === undefined
  )
    throw new CliError(EXIT.backup, `沒有異地備份宣告（或欄位不全），拒絕寫入 prod。${hint}`)
  // 未來日期會讓下面的到期檢查永遠不成立（手誤 `2062-10-01`），所以晚於現在的日期一律拒絕
  if (attestedAt > now.getTime())
    throw new CliError(
      EXIT.backup,
      `異地備份宣告日期 ${b.attested_at} 晚於今天，拒絕寫入 prod。宣告日期是盤點當天。${hint}`,
    )
  if (drill > now.getTime())
    throw new CliError(
      EXIT.backup,
      `最近一次還原演練 ${b.last_restore_drill} 晚於今天，拒絕寫入 prod。填實際還原成功的日期。${hint}`,
    )
  if (now.getTime() > attestedAt + BACKUP_ATTESTATION_TTL_DAYS * DAY_MS)
    throw new CliError(
      EXIT.backup,
      `異地備份宣告日期 ${b.attested_at}，已超過 ${BACKUP_ATTESTATION_TTL_DAYS} 天，拒絕寫入 prod。重新盤點後更新宣告。${hint}`,
    )
  if (now.getTime() > drill + RESTORE_DRILL_MAX_AGE_DAYS * DAY_MS)
    throw new CliError(
      EXIT.backup,
      `最近一次還原演練是 ${b.last_restore_drill}，已超過 ${RESTORE_DRILL_MAX_AGE_DAYS} 天，拒絕寫入 prod。${hint}`,
    )
  return b as BackupAttestation
}

async function cmdRollback(opts: Opts, positional: string[], deps: Deps) {
  const applyId = positional[0]
  if (!applyId || !/^apply-[0-9T]+-[0-9a-f]+$/u.test(applyId))
    throw new CliError(EXIT.usage, 'rollback 需要 apply id')
  const reason = need(opts, 'reason')
  const consumerId = consumerOf(deps)
  const dir = join(stateDir(consumerId, deps.env), 'applies', applyId)
  if (!existsSync(join(dir, 'record.json')))
    throw new CliError(EXIT.usage, `找不到 ${applyId} 的 apply 紀錄（只有成功的 apply 可回滾）`)
  const record = JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8'))
  if (record.op !== 'update' && record.op !== 'restore-rows')
    throw new CliError(
      EXIT.usage,
      `${applyId} 是 ${record.op}（舊版 CLI 的寫入）；現行 ${WRITE_ROLE} 只有 UPDATE 權限，回滾改走 migration，資料在 ${dir}`,
    )
  const before: RowSet = {
    json: readFileSync(join(dir, 'before.json'), 'utf8').trim(),
    count: record.before_count,
  }
  const after: RowSet = {
    json: readFileSync(join(dir, 'after.json'), 'utf8').trim(),
    count: record.after_count,
  }
  const table = assertTable(record.table)
  // 回滾對的是當初 apply 的那個目標，由落檔紀錄決定；旗標只能相符，不能把演練的列搬去 prod
  if (record.target_class !== 'prod' && record.target_class !== 'drill')
    throw new CliError(EXIT.usage, `${applyId} 的紀錄沒有目標類別，無法回滾`)
  const target: TargetClass = record.target_class
  if (targetOf(opts) !== target)
    throw new CliError(
      EXIT.usage,
      `${applyId} 是對${TARGET_LABEL[target]}目標的 apply；${target === 'drill' ? '回滾要加 --drill' : '回滾不可加 --drill'}`,
    )
  const plan = await makeDmlPlan(
    { kind: 'restore-rows', table, rows: before },
    { reason, source: `rollback ${applyId}` },
    target,
    deps,
    applyId,
  )
  // apply 之後又被別人改過的列：照樣會被還原成 apply 前的內容。兩邊都是 server 依主鍵排序輸出的
  // jsonb 原文，逐字相等才算沒被動過
  if (after.json !== plan.before.json)
    err(
      deps,
      `prod-sql: 注意——這些列在 ${applyId} 之後又被改過，回滾會把它們蓋回 apply 前的內容。apply 前先確認這是要的。\n`,
    )
}

// ---------------------------------------------------------------------------
// bootstrap：建角色、設密碼、存憑證
// ---------------------------------------------------------------------------

export type BootstrapConfig = {
  /** 進 prod DB 的 superuser 路徑，例 ["ssh","root@host","docker","exec","-i","supabase-db","psql","-U","supabase_admin","-d","postgres"] */
  admin_psql: string[]
  /** agent 角色連線用的位址（tailnet 上的 host／port／database；pooler 要帶 tenant 後綴時填 user_suffix） */
  connect: { host: string; port: number; database: string; user_suffix?: string }
  /** agent_ro 可讀的業務 schema。NEVER 列 auth、storage、vault 等平台 schema */
  read_schemas: string[]
  /** 之後由 migration 建表的角色；新表的 SELECT 靠它的 default privileges 自動給 agent_ro */
  table_owner: string
  /** agent_rw 可 UPDATE 的表白名單 */
  write_tables: string[]
  /** 異地備份宣告（見 `assertBackupAttested`）；只有 prod 的資料異動會驗 */
  backup?: unknown
}

/** 演練目標不得經遠端 shell：它是本機容器或臨時還原環境，superuser 指令在本機就跑得到 */
const REMOTE_SHELLS = new Set(['ssh', 'mosh', 'rsh', 'tsh', 'autossh', 'sshpass'])
/** 能把後面的參數當另一條指令跑的包裝：出現在演練的 admin_psql 裡就看不出它最後連到哪 */
const COMMAND_WRAPPERS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'env',
  'sudo',
  'su',
  'doas',
  'nsenter',
  'xargs',
  'timeout',
  'nohup',
])

/**
 * 演練 `admin_psql` 的形狀：`psql …` 或 `docker exec … psql …`，不經 shell 或遠端包裝、不指定連線
 * 位址（`-h`／`--host`、連線字串裡的 `host=`、`postgres://` URI、`PGHOST` 類環境變數）。psql 因此
 * 只連本機預設的 socket，docker 只進本機 daemon 的容器。這擋的是設定寫錯；loopback 不代表不是
 * prod（`ssh -L` 轉到 prod 的本機埠、掛到本機的 socket 都是 loopback），見規約 § 已知限制。
 */
export function drillAdminProblem(argv: string[]): string | undefined {
  const base = (arg: string) => arg.split('/').at(-1) ?? ''
  const head = base(argv[0] ?? '')
  if (head !== 'psql' && head !== 'docker')
    return `第一個元素必須是 psql 或 docker（現在是 ${argv[0]}）`
  if (head === 'docker' && argv[1] !== 'exec')
    return '用 docker 時必須是 docker exec …（不收全域選項，例如 -H、--context）'
  for (const arg of argv) {
    const name = base(arg)
    if (REMOTE_SHELLS.has(name) || COMMAND_WRAPPERS.has(name)) return `含 ${arg}`
    if (/^-h|^--host(=|$)/u.test(arg)) return `含連線位址參數 ${arg}`
    if (/\b(host|hostaddr|service)\s*=|^postgres(ql)?:/iu.test(arg)) return `含連線字串 ${arg}`
    if (/\bPG(HOST|HOSTADDR|SERVICE|SERVICEFILE)\b/u.test(arg)) return `含連線環境變數 ${arg}`
  }
  return undefined
}

const PLATFORM_SCHEMAS = new Set([
  'auth',
  'storage',
  'vault',
  'realtime',
  'supabase_functions',
  'supabase_migrations',
  'pgsodium',
  'net',
  'cron',
  'graphql',
  'graphql_public',
  'extensions',
  'pgbouncer',
  '_realtime',
  '_analytics',
  'pg_catalog',
  'information_schema',
])

export const CONFIG_PATH = '.claude/prod-access.json'

/**
 * consumer 在 registry 登記的 GitHub repo（`owner/name`）：prod 設定只認這個 repo 的預設分支。
 * 取自 clade 中央倉的 `registry/consumers.json`（`CLADE_HOME`，預設 `~/offline/clade`），不取本機
 * repo 的 git config——`git remote set-url origin` 改得到後者。
 */
export function registryRepoId(consumerId: string, env: NodeJS.ProcessEnv = process.env) {
  const home = env.CLADE_HOME?.trim() || join(env.HOME || homedir(), 'offline', 'clade')
  const path = join(home, 'registry', 'consumers.json')
  let entry: unknown
  try {
    const registry: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const consumers =
      isRecord(registry) && Array.isArray(registry.consumers) ? registry.consumers : []
    entry = consumers.find((item) => isRecord(item) && item.consumer_id === consumerId)
  } catch (error) {
    throw new CliError(
      EXIT.usage,
      `讀不到 ${path}（${error instanceof Error ? error.message : String(error)}）：prod 設定要對照 registry 登記的 repo`,
    )
  }
  const repo = isRecord(entry) ? entry.repo_id : undefined
  if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/u.test(repo))
    throw new CliError(EXIT.usage, `${path} 沒有 ${consumerId} 的 repo_id，prod 設定無從對照`)
  return repo
}

/** GitHub 遠端 URL 的 `owner/name`；不是 github.com 的 https／ssh URL 就回 undefined（本機路徑、file:// 都不算）。 */
export function githubRepoOf(url: string) {
  const match =
    /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com(?::22)?\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/u.exec(
      url.trim(),
    )
  return match?.[1]
}

const isExpectedOrigin = (url: string, repo: string) =>
  githubRepoOf(url)?.toLowerCase() === repo.toLowerCase()

/**
 * prod 的設定檔一律取 origin 預設分支上那份：白名單、superuser 路徑與備份宣告都要經合入的 PR，
 * agent 在工作樹改設定檔不會擴大自己的權限。本機的 remote-tracking ref 與 `origin/HEAD` agent
 * 改得到（`git update-ref`、`git symbolic-ref`），所以不讀它們：origin URL 先對 registry 登記的
 * repo（`expectedRepo`），再以 `git ls-remote` 問遠端的預設分支與 sha、fetch 後只讀那個 sha。
 * `url.*.insteadOf` 會把 URL 改寫到別處，有就拒絕；`GIT_*` 環境變數不帶進 git。`refs/replace/*`
 * 同樣是本機可改的 ref（`git replace <sha> <偽造 commit>` 會讓同一個 sha 讀到別的內容），git 一律
 * 帶 `--no-replace-objects`。
 */
export function gitCommittedConfig(
  root: string,
  expectedRepo: string,
  matches: (url: string, repo: string) => boolean = isExpectedOrigin,
) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  )
  const git = (...args: string[]) =>
    spawnSync('git', ['--no-replace-objects', '-C', root, ...args], { encoding: 'utf8', env })
  const fail = (what: string) => new CliError(EXIT.usage, `讀不到 prod 設定：${what}`)
  // 設定裡的原值：`remote get-url` 會先套 insteadOf 改寫，那樣下面的改寫檢查就看不到了
  const remote = git('config', '--get', 'remote.origin.url')
  const url = remote.stdout.trim()
  if (remote.status !== 0 || !url) throw fail(`沒有 origin（${remote.stderr.trim()}）`)
  if (!matches(url, expectedRepo))
    throw fail(
      `origin 是 ${url}，不是 registry 登記的 ${expectedRepo}；NEVER 改 origin 繞過，回報使用者`,
    )
  // 只拒絕會套到 origin 的改寫：git 以 insteadOf 的值當 URL 前綴比對，套不到 origin 的規則
  // （例如全域的 `git@github.com:` → https，而 origin 本來就是 https）不改變 fetch 的對象
  const rewrites = git('config', '--get-regexp', String.raw`^url\..*\.insteadof$`)
  const applies = rewrites.stdout.split('\n').filter((line) => {
    const prefix = /^url\..*\.insteadof (.*)$/iu.exec(line)?.[1]
    return prefix !== undefined && url.startsWith(prefix)
  })
  if (applies.length > 0)
    throw fail(`git config 有 url.*.insteadOf，會把 origin 改寫到別處：${applies.join('；')}`)
  const listed = git('ls-remote', '--symref', url, 'HEAD')
  const branch = /^ref: refs\/heads\/(\S+)\tHEAD$/mu.exec(listed.stdout)?.[1]
  const sha = /^([0-9a-f]{40,64})\tHEAD$/mu.exec(listed.stdout)?.[1]
  if (listed.status !== 0 || !branch || !sha)
    throw fail(
      `git ls-remote ${url} 拿不到預設分支（${listed.stderr.trim() || listed.stdout.trim()}）`,
    )
  const fetched = git(
    'fetch',
    '--quiet',
    '--no-tags',
    '--no-write-fetch-head',
    url,
    `refs/heads/${branch}`,
  )
  if (fetched.status !== 0) throw fail(`git fetch ${url} ${branch} 失敗：${fetched.stderr.trim()}`)
  const shown = git('show', `${sha}:${CONFIG_PATH}`)
  if (shown.status !== 0)
    throw new CliError(
      EXIT.usage,
      `origin 預設分支 ${branch}（${sha.slice(0, 12)}）上沒有 ${CONFIG_PATH}：prod 的設定要先經 PR 合入（${shown.stderr.trim()}）`,
    )
  return shown.stdout
}

/** prod 設定的讀法：測試注入 `committedConfig`，否則照 registry 驗 origin 後以 git 讀。 */
const committedReader = (deps: Deps, consumerId: string) =>
  deps.committedConfig ??
  ((root: string) => gitCommittedConfig(root, registryRepoId(consumerId, deps.env)))

/**
 * `target` 是 `drill` 時讀工作樹的設定檔，superuser 指令與連線位址取自 `drill` 區段，其餘欄位
 * 共用；`prod` 讀 origin 預設分支那份（`committed`，預設 `gitCommittedConfig`）。演練因此不必
 * 暫時改 `connect.host`：只改它而 `admin_psql` 仍指向 prod 的話，一次標成演練的 bootstrap 會以
 * superuser 重設 prod 的角色密碼。
 */
export function readBootstrapConfig(
  root: string,
  target: TargetClass = 'prod',
  committed: (root: string) => string = (dir) =>
    gitCommittedConfig(dir, registryRepoId(resolveConsumerId(dir))),
): BootstrapConfig {
  const path = target === 'prod' ? `origin:${CONFIG_PATH}` : join(root, CONFIG_PATH)
  const ident = new RegExp(`^${IDENT}$`, 'u')
  const fail = (what: string) =>
    new CliError(EXIT.usage, `${path}${target === 'drill' ? ' 的 drill 區段' : ''}：${what}`)
  let text: string
  if (target === 'prod') text = committed(root)
  else if (!existsSync(path))
    throw new CliError(EXIT.usage, `找不到 ${path}（見 prod-access 規約 § 接入）`)
  else text = readFileSync(path, 'utf8')
  let whole: unknown
  try {
    whole = JSON.parse(text)
  } catch {
    throw fail('不是合法 JSON')
  }
  if (!isRecord(whole)) throw fail('必須是 JSON 物件')
  let raw = whole
  if (target === 'drill') {
    if (!isRecord(whole.drill))
      throw fail('沒有這個區段；演練目標要在 drill 填自己的 admin_psql 與 connect')
    raw = { ...whole, admin_psql: whole.drill.admin_psql, connect: whole.drill.connect }
    if (isStrings(raw.admin_psql)) {
      const problem = drillAdminProblem(raw.admin_psql)
      if (problem) throw fail(`admin_psql ${problem}；演練目標的 superuser 指令 MUST 在本機執行`)
    }
  }
  const { admin_psql, connect: address, read_schemas, table_owner, write_tables = [] } = raw
  if (!isStrings(admin_psql) || admin_psql.length === 0 || !admin_psql.includes('psql'))
    throw fail('admin_psql 必須是含 psql 的指令陣列')
  if (
    !isRecord(address) ||
    typeof address.host !== 'string' ||
    !address.host ||
    typeof address.port !== 'number' ||
    !Number.isInteger(address.port) ||
    typeof address.database !== 'string' ||
    !address.database
  )
    throw fail('connect 需要 host、port、database')
  const { user_suffix } = address
  if (typeof user_suffix !== 'string' && typeof user_suffix !== 'undefined')
    throw fail('connect.user_suffix 必須是字串')
  if (!isStrings(read_schemas) || read_schemas.length === 0) throw fail('read_schemas 不可為空')
  for (const schema of read_schemas) {
    if (!ident.test(schema)) throw fail(`schema 名不合法：${schema}`)
    if (PLATFORM_SCHEMAS.has(schema)) throw fail(`${schema} 是平台 schema，NEVER 開給 agent`)
  }
  if (typeof table_owner !== 'string' || !ident.test(table_owner)) throw fail('table_owner 不合法')
  if (!isStrings(write_tables)) throw fail('write_tables 必須是字串陣列')
  for (const table of write_tables) {
    assertTable(table)
    if (PLATFORM_SCHEMAS.has(table.split('.')[0]))
      throw fail(`${table} 在平台 schema，NEVER 開給 agent`)
  }
  return {
    admin_psql,
    connect: {
      host: address.host,
      port: address.port,
      database: address.database,
      user_suffix,
    },
    read_schemas,
    table_owner,
    write_tables,
    backup: raw.backup,
  }
}

/**
 * 建角色的 SQL。整段在一個交易裡，結尾以該角色身分實際嘗試越權（建表、改白名單外的表、對白名單
 * 表新增或刪除），任何一個成功就 RAISE，連同建角色一起回滾。可重跑：角色已存在時重設屬性、授權與密碼。
 * BYPASSRLS：業務表開了 RLS，沒有它角色一列都看不到；它不給寫入權。
 */
export function renderRoleSql(role: Role, cfg: BootstrapConfig, password: string) {
  const schemas = cfg.read_schemas
  const writeTables = cfg.write_tables
  const grants =
    role === READ_ROLE
      ? schemas
          .map(
            (s) => `GRANT USAGE ON SCHEMA ${s} TO ${role};
GRANT SELECT ON ALL TABLES IN SCHEMA ${s} TO ${role};
ALTER DEFAULT PRIVILEGES FOR ROLE ${cfg.table_owner} IN SCHEMA ${s} GRANT SELECT ON TABLES TO ${role};`,
          )
          .join('\n')
      : [
          ...[...new Set(writeTables.map((t) => t.split('.')[0]))].map(
            (s) => `GRANT USAGE ON SCHEMA ${s} TO ${role};`,
          ),
          // 只有 UPDATE：新增與刪除的修正走 migration，DB 直接拒絕
          ...writeTables.map((t) => `GRANT SELECT, UPDATE ON ${t} TO ${role};`),
          // 白名單表自己的 sequence：apply 前的 pg_dump 要 SELECT（含 setval），不給 USAGE
          `DO $seq$ DECLARE q regclass; BEGIN
  FOR q IN SELECT d.objid FROM pg_depend d JOIN pg_class c ON c.oid = d.objid AND c.relkind = 'S'
            WHERE d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
              AND d.refobjid = ANY (ARRAY[${writeTables.map((t) => `${quoteLiteral(t)}::regclass`).join(', ')}]::oid[])
  LOOP EXECUTE format('GRANT SELECT ON SEQUENCE %s TO ${role}', q); END LOOP;
END $seq$;`,
        ].join('\n')
  const settings =
    role === READ_ROLE
      ? `ALTER ROLE ${role} SET default_transaction_read_only = on;
ALTER ROLE ${role} SET statement_timeout = '${READ_STATEMENT_TIMEOUT}';`
      : `ALTER ROLE ${role} SET statement_timeout = '${WRITE_STATEMENT_TIMEOUT}';
ALTER ROLE ${role} SET lock_timeout = '${WRITE_LOCK_TIMEOUT}';`
  // 以 oid 比對：regclass 轉文字會省略 search_path 上的 schema（public.x 會變成 x）
  const allowed =
    role === READ_ROLE || writeTables.length === 0
      ? `'{}'::oid[]`
      : `ARRAY[${writeTables.map((t) => `${quoteLiteral(t)}::regclass::oid`).join(', ')}]`
  return `BEGIN;
SET LOCAL log_statement = 'none';
SET LOCAL log_min_duration_statement = -1;
DO $role$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role}; END IF;
END $role$;
ALTER ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS
  CONNECTION LIMIT ${role === READ_ROLE ? 3 : 2} PASSWORD ${quoteLiteral(password)};
${settings}
ALTER ROLE ${role} SET idle_in_transaction_session_timeout = '60s';
-- 重跑時先收回舊授權，白名單縮小才會生效
DO $revoke$ DECLARE s text; BEGIN
  FOR s IN SELECT nspname FROM pg_namespace WHERE ${NOT_SYSTEM_NS} LOOP
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM ${role}', s);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM ${role}', s);
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM ${role}', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE ${cfg.table_owner} IN SCHEMA %I REVOKE ALL ON TABLES FROM ${role}', s);
  END LOOP;
END $revoke$;
DO $connect$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${role}', current_database());
END $connect$;
${grants}
DO $probe$
DECLARE s text; t regclass; col name; allowed oid[] := ${allowed};
BEGIN
  SET LOCAL ROLE ${role};
  FOR s IN SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_(toast_)?temp_' LOOP
    BEGIN
      EXECUTE format('CREATE TABLE %I.clade_agent_probe ()', s);
      RAISE EXCEPTION '${role} 能在 schema % 建表', s USING ERRCODE = 'P0001';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  FOR t, col IN
    SELECT c.oid, (SELECT attname FROM pg_attribute
                    WHERE attrelid = c.oid AND attnum > 0 AND NOT attisdropped
                      AND attgenerated = '' AND attidentity = '' LIMIT 1)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p') AND ${NOT_SYSTEM_NS.replaceAll('nspname', 'n.nspname')}
       AND NOT (c.oid = ANY (allowed))
  LOOP
    CONTINUE WHEN col IS NULL;
    BEGIN
      EXECUTE format('UPDATE %s SET %2$I = %2$I WHERE false', t, col);
      RAISE EXCEPTION '${role} 能 UPDATE 白名單外的 %', t USING ERRCODE = 'P0001';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  -- 白名單表也只能 UPDATE：新增、刪除都要被 DB 拒絕。INSERT 只寫一個一般欄位：identity
  -- （GENERATED ALWAYS）與 generated 欄會在權限檢查之前就報別的錯
  FOR t, col IN
    SELECT c.oid, (SELECT attname FROM pg_attribute
                    WHERE attrelid = c.oid AND attnum > 0 AND NOT attisdropped
                      AND attgenerated = '' AND attidentity = '' LIMIT 1)
      FROM pg_class c WHERE c.oid = ANY (allowed)
  LOOP
    BEGIN
      EXECUTE format('DELETE FROM %s WHERE false', t);
      RAISE EXCEPTION '${role} 能 DELETE %', t USING ERRCODE = 'P0001';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    CONTINUE WHEN col IS NULL;
    BEGIN
      EXECUTE format('INSERT INTO %1$s (%2$I) SELECT %2$I FROM %1$s WHERE false', t, col);
      RAISE EXCEPTION '${role} 能 INSERT %', t USING ERRCODE = 'P0001';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  RESET ROLE;
END $probe$;
COMMIT;
`
}

const bootstrapTarget = (cfg: BootstrapConfig) =>
  `${cfg.connect.host}:${cfg.connect.port}/${cfg.connect.database}`
const bootstrapUser = (role: Role, cfg: BootstrapConfig) =>
  `${role}${cfg.connect.user_suffix ?? ''}`

/**
 * 建角色由 agent 直接執行設定檔的 superuser 路徑（沒有人逐次核准）。prod 的設定檔取 registry
 * 登記的 repo 的預設分支那份（`gitCommittedConfig`）：建哪個角色、開哪些表、連哪一台，都以合入的版本為準。可重跑：重設屬性、
 * 授權與密碼，再以新憑證跑一次 check。
 */
async function cmdBootstrap(opts: Opts, positional: string[], deps: Deps) {
  if (positional.length > 0)
    throw new CliError(EXIT.usage, 'bootstrap 只收 --role <角色> [--drill]（不再分 plan／apply）')
  const consumerId = consumerOf(deps)
  const target = targetOf(opts)
  const root = consumerRoot(cwdOf(deps))
  const cfg = readBootstrapConfig(root, target, committedReader(deps, consumerId))
  const role = parseRole(need(opts, 'role'))
  if (role === WRITE_ROLE && cfg.write_tables.length === 0)
    throw new CliError(EXIT.usage, 'write_tables 是空的，沒有東西可以開給 agent_rw')
  const actual = await classifyHost(cfg.connect.host, deps.resolve)
  if (actual !== target)
    throw new CliError(
      EXIT.usage,
      actual === 'drill'
        ? '.claude/prod-access.json 的 connect.host 解析到 loopback：頂層只放 prod（tailnet）的位址，演練目標填在 drill 區段並加 --drill'
        : '.claude/prod-access.json 的 drill.connect.host 解析到 tailnet：drill 區段只放 loopback 的演練目標',
    )
  const path = credentialPath(consumerId, deps.env, role, target)
  out(
    deps,
    `BOOTSTRAP ${role}（${TARGET_LABEL[target]}）：${bootstrapTarget(cfg)}\n` +
      `  執行路徑：${cfg.admin_psql.join(' ')}\n` +
      (role === READ_ROLE
        ? `  可讀 schema：${cfg.read_schemas.join(', ')}\n`
        : `  可 UPDATE 的表：${cfg.write_tables.join(', ')}\n`),
  )
  const url = runBootstrap(role, cfg, consumerId, target, deps)
  writePrivate(path, `${url}\n`)
  out(deps, `BOOTSTRAPPED ${role}（${TARGET_LABEL[target]}）：憑證已存到 ${path}\n`)
  const legacy = join(prodAccessDir(consumerId, deps.env), LEGACY_KEYRING_FILE)
  if (target === 'prod' && existsSync(legacy))
    out(deps, `  ${legacy} 是舊版的密碼封存檔，現行版本不再使用，可以刪掉\n`)
  return checkWith(role, consumerId, parseConnectionUrl(url, role), { role }, deps, target)
}

/** superuser 路徑的環境：拿掉 libpq 的 `PG*` 與 docker 的遠端 daemon 設定，連到哪只由設定檔決定。 */
export function bootstrapEnv(base: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(base).filter(
      ([name]) => !name.startsWith('PG') && name !== 'DOCKER_HOST' && name !== 'DOCKER_CONTEXT',
    ),
  )
}

/** 執行 superuser 路徑，回傳新角色的連線字串。 */
function runBootstrap(
  role: Role,
  cfg: BootstrapConfig,
  consumerId: string,
  target: TargetClass,
  deps: Deps,
) {
  const password = randomBytes(24).toString('base64url')
  const [bin, ...args] = cfg.admin_psql
  // SQL 走 stdin：密碼不進 argv，也不進 ssh 的遠端指令列
  const result = (deps.run ?? systemRunner)(
    bin,
    [...args, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    { env: bootstrapEnv(deps.env ?? process.env), input: renderRoleSql(role, cfg, password) },
  )
  const base = {
    op: 'bootstrap',
    role,
    target_class: target,
    target: bootstrapTarget(cfg),
    transport: cfg.admin_psql,
  }
  if (result.error || result.status !== 0) {
    const message = (result.error?.message ?? result.stderr).trim()
    // server 回 ERROR 才確定整筆回滾；連線層的失敗可能發生在 COMMIT 之後
    const rejected = !result.error && /^(psql:.*)?ERROR:/mu.test(message)
    ledger(consumerId, deps, {
      event: 'apply-failed',
      ...base,
      outcome: rejected ? 'not-applied' : 'unknown',
      error: message,
    })
    throw new CliError(
      EXIT.aborted,
      rejected
        ? `bootstrap 失敗，交易已回滾：${message}`
        : `bootstrap 結果不明（角色密碼可能已重設、憑證檔未寫入）：${message}\n重跑 bootstrap 即可收斂：它會重設密碼並寫入憑證。`,
    )
  }
  ledger(consumerId, deps, { event: 'apply', ...base })
  const user = bootstrapUser(role, cfg)
  return `postgres://${encodeURIComponent(user)}:${password}@${cfg.connect.host}:${cfg.connect.port}/${encodeURIComponent(cfg.connect.database)}`
}

function cmdLedger(opts: Opts, deps: Deps) {
  const consumerId = consumerOf(deps)
  const path = join(stateDir(consumerId, deps.env), 'ledger.jsonl')
  if (!existsSync(path)) return out(deps, '(ledger 是空的)\n')
  const lines = readFileSync(path, 'utf8').trim().split('\n')
  out(deps, `${lines.slice(-parseRowLimit(opts.limit ?? '20')).join('\n')}\n`)
}

export async function main(argv: string[], deps: Deps = {}) {
  const { command, opts, positional } = parseArgs(argv)
  if (command === 'read') return cmdRead(opts, deps)
  if (command === 'check') return cmdCheck(opts, deps)
  if (command === 'plan') return cmdPlan(opts, deps)
  if (command === 'apply') return cmdApply(opts, positional, deps)
  if (command === 'approve' || command === 'attest-backup')
    throw new CliError(
      EXIT.usage,
      `${command} 已移除（不再逐筆密碼核准）：agent 以 apply 執行例行 plan，備份改在設定檔的 backup 區段宣告。見 prod-access 規約`,
    )
  if (command === 'rollback') return cmdRollback(opts, positional, deps)
  if (command === 'bootstrap') return cmdBootstrap(opts, positional, deps)
  if (command === 'ledger') return cmdLedger(opts, deps)
  throw new CliError(
    EXIT.usage,
    '用法：prod-sql.ts <read|check|plan|apply|rollback|bootstrap|ledger> [opts]（見檔頭）',
  )
}

// 兩邊都 realpath：經 symlink 呼叫時 argv[1] 是連結路徑，直接比對會整段靜默跳過
if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`prod-sql: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = error instanceof CliError ? error.code : 1
  })
}
