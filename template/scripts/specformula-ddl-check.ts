#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/specformula-ddl-check.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/specformula-ddl-check.ts
/**
 * specformula-ddl-check.ts — SpecFormula 的 `specs/data` DDL 與 DBML truth，對「migration 回放後的 DB」做語意比對。
 *
 * 規約：rules/core/specformula.md § Truth 佈局（`specs/data` 是 physical schema 的投影、資料模型列的 DBML↔physical）
 * 與 § NEVER 6（有 migration 的 repo NEVER 把 `specs/data` 套進 DB）。
 *
 * | 欄位 | 內容 |
 * | --- | --- |
 * | 觸發條件 | `check` 有任一 error（表／欄不存在、正規化型別不同、PK 不同、FK 目標不在、setup 必填不一致、DBML 宣告的表或欄不在 DB）→ exit 1；DB 有而 DDL／DBML 沒寫的只印 info，不擋 |
 * | 消費端 | consumer 的 BDD CI job：`supabase start`（migration 回放）之後、`test:bdd` 之前跑一次（範本 `vendor/snippets/specformula/templates/ci-job.template.yml`）；`audit-specformula-adoption.ts` 報 BDD job 缺本 check |
 * | 觸發點 | 本檔與上述規約、範本；`emit` 是給 owner 從 DB 產 DDL 的 extractor，寫法不限，產出只是起點 |
 *
 * 比對的是 EntityDdlReader 實際會用到的語意：欄位集合、正規化型別（忽略長度／精度、別名歸一）、
 * PK、FK 目標、setup 必填（NOT NULL ∧ 無 default ∧ 非 identity ∧ 非 generated——
 * 不比 NOT NULL 原字面：有 default 的 NOT NULL 欄，投影可以不標）。CHECK／UNIQUE／index／註解不比。
 * 同名表只在同一 data source 內判重（EntityDdlReader.read 本身就是 per data source）。
 *
 * 落點：clade 源檔 `vendor/scripts/specformula-ddl-check.ts`，宣告 specformula 的 consumer 投影到 `scripts/specformula-ddl-check.ts`。
 * 用法（從 consumer repo root；EntityDdlReader 是 .ts 原始碼，要 tsx）：
 *   node --import tsx scripts/specformula-ddl-check.ts check [--db-url <url>] [--isa isa.yml] [--dbml-dir specs/truth/data] [--json]
 *   node --import tsx scripts/specformula-ddl-check.ts emit  [--db-url <url>] [--schema public] [--tables a,b]
 *   --catalog-json <file>：以 `dump-catalog` 的輸出取代連 DB（測試與離線重現用）
 *   node scripts/specformula-ddl-check.ts dump-catalog [--db-url <url>] [--schema public]
 *
 * DB 連線走 `psql`（CI runner 與 supabase 本機環境都有），預設 `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
 * ——只讀 catalog（`information_schema`／`pg_catalog`），NEVER 寫入。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const DEFAULT_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/* ------------------------------------------------------------------ 型別 */

export interface CatalogColumn {
  schema: string
  table: string
  column: string
  udt: string
  notNull: boolean
  hasDefault: boolean
  default: string | null
  identity: boolean
  generated: boolean
}

export interface CatalogConstraint {
  schema: string
  table: string
  type: 'p' | 'f'
  columns: string[]
  refSchema: string | null
  refTable: string | null
  refColumns: string[] | null
}

export interface Catalog {
  tables: { schema: string; table: string }[]
  columns: CatalogColumn[]
  constraints: CatalogConstraint[]
}

/** EntityDdlReader 的 ColumnDefinition 子集（只取比對用得到的欄）。 */
export interface DdlColumn {
  name: string
  type: string
  notNull: boolean
  primaryKey: boolean
  autoIncrement: boolean
  defaultValue: string | null
  foreignKey: string | null
}

export interface DdlTable {
  tableName: string
  schemaName?: string | undefined
  columns: DdlColumn[]
  pkColumns: string[]
}

export interface DataSourceInput {
  name: string
  schema: string
  tables: DdlTable[]
}

export interface DbmlTable {
  schema: string | null
  name: string
  columns: string[]
  file: string
}

export type Severity = 'error' | 'info'

export interface Finding {
  severity: Severity
  source: string
  table: string
  column?: string
  kind:
    | 'table-missing'
    | 'column-missing'
    | 'type-mismatch'
    | 'pk-mismatch'
    | 'fk-mismatch'
    | 'required-mismatch'
    | 'required-column-omitted'
    | 'db-only-column'
    | 'dbml-table-missing'
    | 'dbml-column-missing'
    | 'db-only-table'
  message: string
}

/* ------------------------------------------------------------------ 正規化 */

const TYPE_ALIASES: Record<string, string> = {
  int: 'int4',
  integer: 'int4',
  int4: 'int4',
  serial: 'int4',
  serial4: 'int4',
  smallint: 'int2',
  int2: 'int2',
  smallserial: 'int2',
  serial2: 'int2',
  bigint: 'int8',
  int8: 'int8',
  bigserial: 'int8',
  serial8: 'int8',
  boolean: 'bool',
  bool: 'bool',
  real: 'float4',
  float4: 'float4',
  'double precision': 'float8',
  double: 'float8',
  float8: 'float8',
  float: 'float8',
  decimal: 'numeric',
  numeric: 'numeric',
  varchar: 'varchar',
  'character varying': 'varchar',
  char: 'bpchar',
  character: 'bpchar',
  bpchar: 'bpchar',
  text: 'text',
  timestamptz: 'timestamptz',
  'timestamp with time zone': 'timestamptz',
  timestamp: 'timestamp',
  'timestamp without time zone': 'timestamp',
  timetz: 'timetz',
  'time with time zone': 'timetz',
  time: 'time',
  'time without time zone': 'time',
}

/** 型別正規化：去長度／精度、別名歸一、去 schema 前綴與引號、陣列 `x[]` ↔ catalog 的 `_x`。 */
export function normalizeType(raw: string): string {
  let t = raw.trim().toLowerCase().replace(/"/g, '')
  let array = false
  if (t.endsWith('[]')) {
    array = true
    t = t.slice(0, -2).trim()
  } else if (t.startsWith('_')) {
    array = true
    t = t.slice(1)
  }
  t = t.replace(/\s*\([^)]*\)/g, '').trim()
  if (t.includes('.')) t = t.slice(t.lastIndexOf('.') + 1)
  t = t.replace(/\s+/g, ' ')
  const base = TYPE_ALIASES[t] ?? t
  return array ? `${base}[]` : base
}

function stripIdent(s: string): string {
  const t = s.trim()
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t.toLowerCase()
}

export function dbRequired(c: CatalogColumn): boolean {
  return c.notNull && !c.hasDefault && !c.identity && !c.generated
}

/** PRIMARY KEY 隱含 NOT NULL（EntityDdlReader 的 notNull 只看字面 `NOT NULL`）。 */
export function ddlRequired(c: DdlColumn): boolean {
  return (c.notNull || c.primaryKey) && c.defaultValue === null && !c.autoIncrement
}

/* ------------------------------------------------------------------ 比對 */

function indexCatalog(catalog: Catalog) {
  const tableKey = (schema: string, table: string) => `${schema}.${table}`
  const tables = new Set(catalog.tables.map((t) => tableKey(t.schema, t.table)))
  const columns = new Map<string, Map<string, CatalogColumn>>()
  for (const c of catalog.columns) {
    const key = tableKey(c.schema, c.table)
    if (!columns.has(key)) columns.set(key, new Map())
    columns.get(key)!.set(c.column, c)
  }
  const pks = new Map<string, string[]>()
  const fks = new Map<string, CatalogConstraint[]>()
  for (const con of catalog.constraints) {
    const key = tableKey(con.schema, con.table)
    if (con.type === 'p') pks.set(key, con.columns)
    else {
      if (!fks.has(key)) fks.set(key, [])
      fks.get(key)!.push(con)
    }
  }
  return { tableKey, tables, columns, pks, fks }
}

/** `specs/data` DDL（每個 data source）對 DB catalog。 */
export function compareDdl(sources: DataSourceInput[], catalog: Catalog): Finding[] {
  const idx = indexCatalog(catalog)
  const out: Finding[] = []
  for (const src of sources) {
    for (const t of src.tables) {
      const table = stripIdent(t.tableName)
      const schema = t.schemaName ? stripIdent(t.schemaName) : src.schema
      const key = idx.tableKey(schema, table)
      const label = `${schema}.${table}`
      if (!idx.tables.has(key)) {
        out.push({
          severity: 'error',
          source: src.name,
          table: label,
          kind: 'table-missing',
          message: `DDL 宣告的表 ${label} 不在 migration 回放後的 DB`,
        })
        continue
      }
      const dbCols = idx.columns.get(key) ?? new Map<string, CatalogColumn>()
      const ddlNames = new Set<string>()
      for (const col of t.columns) {
        const name = stripIdent(col.name)
        ddlNames.add(name)
        const db = dbCols.get(name)
        if (!db) {
          out.push({
            severity: 'error',
            source: src.name,
            table: label,
            column: name,
            kind: 'column-missing',
            message: `DDL 欄 ${label}.${name} 不在 DB`,
          })
          continue
        }
        // EntityDdlReader 的 extractType 只取 `\w+(...)`，`TEXT[]` 讀成 `TEXT`——陣列標記兩邊都去掉再比，
        // 否則每個陣列欄都是假紅。
        const want = normalizeType(db.udt).replace(/\[\]$/, '')
        const got = normalizeType(col.type).replace(/\[\]$/, '')
        if (want !== got) {
          out.push({
            severity: 'error',
            source: src.name,
            table: label,
            column: name,
            kind: 'type-mismatch',
            message: `${label}.${name} 型別 DDL=${got} DB=${want}`,
          })
        }
        if (ddlRequired(col) !== dbRequired(db)) {
          // PK 欄在投影裡常省略 DB 的 default／identity（`id BIGINT PRIMARY KEY`）：DDL 比 DB 嚴＝scenario 多給一個值，
          // INSERT 照樣成立，只報不擋。反方向（DB 必填、DDL 不是）會讓 entity_setup 漏欄而被拒，才是 error。
          const lenientPk = col.primaryKey && ddlRequired(col) && !dbRequired(db)
          out.push({
            severity: lenientPk ? 'info' : 'error',
            source: src.name,
            table: label,
            column: name,
            kind: 'required-mismatch',
            message: `${label}.${name} setup 必填 DDL=${ddlRequired(col)} DB=${dbRequired(db)}（必填＝NOT NULL ∧ 無 default ∧ 非 identity／generated）`,
          })
        }
        if (col.foreignKey) {
          const [refTableRaw, refColRaw] = col.foreignKey.split('.')
          const refTable = stripIdent(refTableRaw ?? '')
          const refCol = stripIdent(refColRaw ?? '')
          const hit = (idx.fks.get(key) ?? []).some(
            (fk) =>
              fk.columns.length === 1 &&
              fk.columns[0] === name &&
              fk.refTable === refTable &&
              (fk.refColumns ?? [])[0] === refCol,
          )
          if (!hit) {
            out.push({
              severity: 'error',
              source: src.name,
              table: label,
              column: name,
              kind: 'fk-mismatch',
              message: `${label}.${name} DDL 宣告 FK → ${refTable}.${refCol}，DB 沒有這條 FK`,
            })
          }
        }
      }
      const ddlPk = [...new Set(t.pkColumns.map(stripIdent))].toSorted()
      const dbPk = [...(idx.pks.get(key) ?? [])].toSorted()
      if (ddlPk.join(',') !== dbPk.join(',')) {
        out.push({
          severity: 'error',
          source: src.name,
          table: label,
          kind: 'pk-mismatch',
          message: `${label} PK DDL=(${ddlPk.join(', ')}) DB=(${dbPk.join(', ')})`,
        })
      }
      for (const [name, db] of dbCols) {
        if (ddlNames.has(name)) continue
        const required = dbRequired(db)
        out.push({
          severity: required ? 'error' : 'info',
          source: src.name,
          table: label,
          column: name,
          kind: required ? 'required-column-omitted' : 'db-only-column',
          message: required
            ? `${label}.${name} 是 DB 的 setup 必填欄，DDL 沒寫——entity_setup 的 INSERT 會被 NOT NULL 拒絕`
            : `${label}.${name} 只在 DB（非必填，投影可省略）`,
        })
      }
    }
  }
  return out
}

/** DBML truth 對 DB catalog：宣告的表與欄 MUST 成立（error）；DB 有、DBML 沒寫的表只報（info）。 */
export function compareDbml(dbml: DbmlTable[], catalog: Catalog, schemas: string[]): Finding[] {
  const idx = indexCatalog(catalog)
  const out: Finding[] = []
  const seen = new Set<string>()
  for (const t of dbml) {
    const candidates = t.schema ? [t.schema] : schemas
    const schema = candidates.find((s) => idx.tables.has(idx.tableKey(s, t.name)))
    if (!schema) {
      out.push({
        severity: 'error',
        source: t.file,
        table: t.schema ? `${t.schema}.${t.name}` : t.name,
        kind: 'dbml-table-missing',
        message: `DBML 宣告的表 ${t.schema ? `${t.schema}.` : ''}${t.name} 不在 migration 回放後的 DB（查過 schema：${candidates.join(', ')}）`,
      })
      continue
    }
    const key = idx.tableKey(schema, t.name)
    seen.add(key)
    const dbCols = idx.columns.get(key) ?? new Map()
    for (const col of t.columns) {
      if (!dbCols.has(col)) {
        out.push({
          severity: 'error',
          source: t.file,
          table: `${schema}.${t.name}`,
          column: col,
          kind: 'dbml-column-missing',
          message: `DBML 宣告的欄 ${schema}.${t.name}.${col} 不在 DB`,
        })
      }
    }
  }
  for (const t of catalog.tables) {
    if (!schemas.includes(t.schema)) continue
    const key = idx.tableKey(t.schema, t.table)
    if (seen.has(key)) continue
    out.push({
      severity: 'info',
      source: 'dbml',
      table: key,
      kind: 'db-only-table',
      message: `${key} 在 DB，DBML 沒寫（只報不擋）`,
    })
  }
  return out
}

/* ------------------------------------------------------------------ DBML 解析 */

function stripDbmlComments(text: string): string {
  // 先移掉字串外的 /* */ 與 //；字串（'…'、'''…'''、`…`、"…"）內的 // 不動。
  let out = ''
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    if (rest.startsWith("'''")) {
      const end = text.indexOf("'''", i + 3)
      const stop = end < 0 ? text.length : end + 3
      out += text.slice(i, stop)
      i = stop
    } else if (text[i] === "'" || text[i] === '`' || text[i] === '"') {
      const q = text[i]
      let j = i + 1
      while (j < text.length && text[j] !== q && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (rest.startsWith('/*')) {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
    } else if (rest.startsWith('//')) {
      const end = text.indexOf('\n', i)
      i = end < 0 ? text.length : end
    } else {
      out += text[i]
      i++
    }
  }
  return out
}

function dbmlIdent(raw: string): string {
  const t = raw.trim()
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t
}

/** 解析 DBML 的 `Table` 區塊：只取表名（含選用 schema）與欄名；Note、indexes、Ref、Enum 一律略過。 */
export function parseDbml(text: string, file = '<dbml>'): DbmlTable[] {
  const src = stripDbmlComments(text)
  const tables: DbmlTable[] = []
  const header = /^\s*Table\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)[^{\n]*\{/gim
  let m: RegExpExecArray | null
  while ((m = header.exec(src)) !== null) {
    const parts = m[1].match(/"[^"]+"|[\w$]+/g) ?? []
    const name = dbmlIdent(parts[parts.length - 1] ?? '')
    const schema = parts.length > 1 ? dbmlIdent(parts[0]) : null
    // 找對應的右大括號（略過字串）
    let depth = 1
    let i = m.index + m[0].length
    const bodyStart = i
    while (i < src.length && depth > 0) {
      const c = src[i]
      if (src.startsWith("'''", i)) {
        const end = src.indexOf("'''", i + 3)
        i = end < 0 ? src.length : end + 3
        continue
      }
      if (c === "'" || c === '`' || c === '"') {
        let j = i + 1
        while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1
        i = j + 1
        continue
      }
      if (c === '{') depth++
      else if (c === '}') depth--
      i++
    }
    const body = src.slice(bodyStart, i - 1)
    const columns: string[] = []
    let nested = 0
    // `'''` 多行字串（`Note: '''` 冒號形與 `Note { ''' … ''' }` 皆然）：開頭那行起到含收尾 `'''` 的那行止，
    // 中間每一行都是註解文字，NEVER 讀成欄位。
    let inTriple = false
    for (const line of body.split('\n')) {
      const s = line.trim()
      if (!s) continue
      const oddTriple = (s.match(/'''/g) ?? []).length % 2 === 1
      if (inTriple) {
        if (oddTriple) inTriple = false
        continue
      }
      if (oddTriple) inTriple = true
      if (nested > 0) {
        nested += (s.match(/\{/g) ?? []).length - (s.match(/\}/g) ?? []).length
        continue
      }
      if (/^(indexes|Note|note|checks)\s*[:{]/.test(s) || /^(indexes|checks)\s*$/.test(s)) {
        if (s.includes('{')) nested += (s.match(/\{/g) ?? []).length - (s.match(/\}/g) ?? []).length
        continue
      }
      const col = /^("[^"]+"|[\w$]+)\s+\S/.exec(s)
      if (col) columns.push(dbmlIdent(col[1]))
    }
    tables.push({ schema, name, columns, file })
    header.lastIndex = i
  }
  return tables
}

/* ------------------------------------------------------------------ isa.yml */

export interface IsaSourceConfig {
  name: string
  resourcePath: string
  dbType: string
  schema: string
}

/** 最小 YAML 讀法：只取 `config.data.source[]` 的 name／resource_path／db_type／schema。 */
export async function readIsaSources(isaPath: string): Promise<IsaSourceConfig[]> {
  // js-yaml 從 @specformula/core 的位置解析（它的依賴），consumer 不必另外宣告。
  const resolved = createRequire(join(specformulaCoreDir(), 'package.json')).resolve('js-yaml')
  const { default: yaml } = (await import(pathToFileURL(resolved).href)) as {
    default: { load(s: string): unknown }
  }
  const raw = yaml.load(readFileSync(isaPath, 'utf8')) as any
  const list = Array.isArray(raw?.config?.data?.source) ? raw.config.data.source : []
  return list.map((s: any, i: number) => ({
    name: typeof s?.name === 'string' ? s.name : `source-${i}`,
    resourcePath: String(s?.resource_path ?? ''),
    dbType: String(s?.db_type ?? 'embedded').toLowerCase(),
    schema: typeof s?.schema === 'string' && s.schema.trim() ? s.schema.trim() : 'public',
  }))
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * `@specformula/core` 原始碼位置。consumer 端本檔投影在 `scripts/`、mirror 在 `vendor/specformula-ts/`，
 * clade home 本檔在 `vendor/scripts/`——兩邊相對位置不同，所以先找 cwd（本 check 從 repo root 跑），
 * 找不到再退回本檔旁邊的 clade 落點。
 */
function specformulaCoreDir(): string {
  const rel = ['specformula-ts', 'packages', 'core']
  const fromCwd = resolve(process.cwd(), 'vendor', ...rel)
  if (existsSync(join(fromCwd, 'package.json'))) return fromCwd
  return resolve(SCRIPT_DIR, '..', ...rel)
}

/** 用上游 EntityDdlReader 解析（mapping 對 DDL 的驗證、同 data source 內判重都照上游）。 */
export async function readDdl(source: IsaSourceConfig): Promise<DdlTable[]> {
  const modPath = join(specformulaCoreDir(), 'src', 'spec', 'EntityDdlReader.ts')
  let mod: {
    EntityDdlReader: new (cfg: Record<string, unknown>) => { read(): { tables: DdlTable[] } }
  }
  try {
    mod = (await import(pathToFileURL(modPath).href)) as typeof mod
  } catch (error) {
    throw new Error(
      `載入 EntityDdlReader 失敗（${modPath}）：${(error as Error).message}\n` +
        '它是 .ts 原始碼且以 .js 指定子模組，MUST 用 `node --import tsx` 跑本 script',
      { cause: error },
    )
  }
  const reader = new mod.EntityDdlReader({
    name: source.name,
    resource_path: source.resourcePath,
    db_type: source.dbType,
  })
  const tables = reader.read().tables
  widenDdlTypes(tables, readSqlTexts(source.resourcePath))
  return tables
}

function readSqlTexts(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .toSorted()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
}

/**
 * 上游 `extractType`（`/^(\w+(?:\s*\([^)]*\))?)/`）只留型別的第一個字：`TIMESTAMP WITH TIME ZONE`
 * 讀成 `TIMESTAMP`、`CHARACTER VARYING(255)` 讀成 `CHARACTER`，比對 DB 就是假的 type-mismatch。
 * 上游是 mirror（不改），所以這裡從原 SQL 把多字型別撿回來。
 */
const MULTI_WORD_TYPE =
  /^(?:(?:timestamp|time)\s*(?:\(\s*\d+\s*\))?\s+(?:with|without)\s+time\s+zone|character\s+varying\s*(?:\([^)]*\))?|bit\s+varying\s*(?:\([^)]*\))?|double\s+precision)(?![\w$])/i

/** `table.column`（小寫）→ 完整型別；只含上游會截斷的多字型別。 */
export function recoverMultiWordTypes(sql: string): Map<string, string> {
  const out = new Map<string, string>()
  const header =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"[^"]+"|\[[^\]]+\]|`[^`]+`|\w+)\.)?(?:"([^"]+)"|\[([^\]]+)\]|`([^`]+)`|(\w+))\s*\(/gi
  let m: RegExpExecArray | null
  while ((m = header.exec(sql)) !== null) {
    const table = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').toLowerCase()
    let depth = 1
    let inQuote = false
    let segStart = m.index + m[0].length
    const segments: string[] = []
    let i = segStart
    for (; i < sql.length && depth > 0; i++) {
      const c = sql[i]
      if (c === "'") inQuote = !inQuote
      if (inQuote) continue
      if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (depth === 0) segments.push(sql.slice(segStart, i))
      } else if (c === ',' && depth === 1) {
        segments.push(sql.slice(segStart, i))
        segStart = i + 1
      }
    }
    header.lastIndex = i
    for (const seg of segments) {
      const cleaned = seg.replace(/--.*$/gm, '').trim()
      const nm = /^(?:"([^"]+)"|\[([^\]]+)\]|`([^`]+)`|([^\s"[`]+))\s+([\s\S]*)$/.exec(cleaned)
      if (!nm) continue
      const type = MULTI_WORD_TYPE.exec(nm[5])
      if (type)
        out.set(
          `${table}.${(nm[1] ?? nm[2] ?? nm[3] ?? nm[4]).toLowerCase()}`,
          type[0].replace(/\s+/g, ' '),
        )
    }
  }
  return out
}

/** 把 reader 回來的截斷型別換成完整型別（原地改）。 */
export function widenDdlTypes(tables: DdlTable[], sqlTexts: string[]): void {
  const full = new Map<string, string>()
  for (const sql of sqlTexts) for (const [k, v] of recoverMultiWordTypes(sql)) full.set(k, v)
  for (const t of tables)
    for (const c of t.columns) {
      const hit = full.get(`${t.tableName.toLowerCase()}.${c.name.toLowerCase()}`)
      if (hit) c.type = hit
    }
}

/* ------------------------------------------------------------------ catalog */

const IDENT = /^[A-Za-z_][\w$]*$/

export function catalogSql(schemas: string[]): string {
  for (const s of schemas) if (!IDENT.test(s)) throw new Error(`schema 名稱不合法：${s}`)
  const list = schemas.map((s) => `'${s}'`).join(',')
  return `select json_build_object(
  'tables', (select coalesce(json_agg(json_build_object('schema', table_schema, 'table', table_name) order by table_schema, table_name), '[]'::json)
             from information_schema.tables where table_type = 'BASE TABLE' and table_schema in (${list})),
  'columns', (select coalesce(json_agg(json_build_object(
                'schema', c.table_schema, 'table', c.table_name, 'column', c.column_name, 'udt', c.udt_name,
                'notNull', c.is_nullable = 'NO', 'hasDefault', c.column_default is not null, 'default', c.column_default,
                'identity', c.is_identity = 'YES', 'generated', c.is_generated = 'ALWAYS')
              order by c.table_schema, c.table_name, c.ordinal_position), '[]'::json)
              from information_schema.columns c join information_schema.tables t
                on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
              where c.table_schema in (${list})),
  'constraints', (select coalesce(json_agg(json_build_object(
                'schema', n.nspname, 'table', cl.relname, 'type', con.contype,
                'columns', array(select a.attname from unnest(con.conkey) with ordinality k(num, ord)
                                 join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.num order by k.ord),
                'refSchema', rn.nspname, 'refTable', rcl.relname,
                'refColumns', case when con.contype = 'f' then array(select a.attname from unnest(con.confkey) with ordinality k(num, ord)
                                 join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.num order by k.ord) end)), '[]'::json)
              from pg_constraint con
              join pg_class cl on cl.oid = con.conrelid
              join pg_namespace n on n.oid = cl.relnamespace
              left join pg_class rcl on rcl.oid = con.confrelid
              left join pg_namespace rn on rn.oid = rcl.relnamespace
              where con.contype in ('p', 'f') and n.nspname in (${list}))
)`
}

function fail(msg: string): never {
  throw new Error(`catalog 形狀不符：${msg}`)
}
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, at: string): string => (typeof v === 'string' ? v : fail(`${at} 不是字串`))
const bool = (v: unknown, at: string): boolean =>
  typeof v === 'boolean' ? v : fail(`${at} 不是布林`)
const strOrNull = (v: unknown, at: string): string | null =>
  v === null || v === undefined ? null : str(v, at)
const strArr = (v: unknown, at: string): string[] =>
  Array.isArray(v) ? v.map((x, i) => str(x, `${at}[${i}]`)) : fail(`${at} 不是陣列`)
const arr = (v: unknown, at: string): unknown[] => (Array.isArray(v) ? v : fail(`${at} 不是陣列`))
const obj = (v: unknown, at: string): Record<string, unknown> =>
  isObj(v) ? v : fail(`${at} 不是物件`)

/** 驗證 `dump-catalog`／psql 回來的 JSON，形狀不符直接丟錯（不讓錯形狀的資料靜默比成「一致」）。 */
export function parseCatalog(raw: unknown): Catalog {
  const root = obj(raw, 'catalog')
  return {
    tables: arr(root.tables, 'tables').map((v, i) => {
      const t = obj(v, `tables[${i}]`)
      return {
        schema: str(t.schema, `tables[${i}].schema`),
        table: str(t.table, `tables[${i}].table`),
      }
    }),
    columns: arr(root.columns, 'columns').map((v, i) => {
      const c = obj(v, `columns[${i}]`)
      const at = `columns[${i}]`
      return {
        schema: str(c.schema, `${at}.schema`),
        table: str(c.table, `${at}.table`),
        column: str(c.column, `${at}.column`),
        udt: str(c.udt, `${at}.udt`),
        notNull: bool(c.notNull, `${at}.notNull`),
        hasDefault: bool(c.hasDefault, `${at}.hasDefault`),
        default: strOrNull(c.default, `${at}.default`),
        identity: bool(c.identity, `${at}.identity`),
        generated: bool(c.generated, `${at}.generated`),
      }
    }),
    constraints: arr(root.constraints, 'constraints').map((v, i) => {
      const c = obj(v, `constraints[${i}]`)
      const at = `constraints[${i}]`
      const type = c.type === 'p' || c.type === 'f' ? c.type : fail(`${at}.type 不是 p／f`)
      return {
        schema: str(c.schema, `${at}.schema`),
        table: str(c.table, `${at}.table`),
        type,
        columns: strArr(c.columns, `${at}.columns`),
        refSchema: strOrNull(c.refSchema, `${at}.refSchema`),
        refTable: strOrNull(c.refTable, `${at}.refTable`),
        refColumns:
          c.refColumns === null || c.refColumns === undefined
            ? null
            : strArr(c.refColumns, `${at}.refColumns`),
      }
    }),
  }
}

export function readCatalogFromDb(dbUrl: string, schemas: string[]): Catalog {
  const out = execFileSync(
    'psql',
    [dbUrl, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', catalogSql(schemas)],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' },
    },
  )
  return parseCatalog(JSON.parse(out.trim()) as unknown)
}

/* ------------------------------------------------------------------ emit */

/**
 * 單行化 default 運算式：換行／連續空白收成一格，**單引號字面值內部原樣保留**
 * （`'a b'::text` 的 `a b` 是值，不是排版）。
 */
export function collapseOutsideQuotes(expr: string): string {
  let out = ''
  let inQuote = false
  let pendingSpace = false
  for (const ch of expr.trim()) {
    if (ch === "'") inQuote = !inQuote
    if (!inQuote && /\s/.test(ch)) {
      pendingSpace = true
      continue
    }
    if (pendingSpace) out += ' '
    pendingSpace = false
    out += ch
  }
  return out
}

/** 從 catalog 產 EntityDdlReader 讀得懂的 DDL（NOT NULL 照 DB 原樣；extractor 是起點，寫法不限）。 */
export function emitDdl(catalog: Catalog, schema: string, only?: string[]): string {
  const idx = indexCatalog(catalog)
  const names = catalog.tables
    .filter((t) => t.schema === schema && (!only || only.includes(t.table)))
    .map((t) => t.table)
  const blocks: string[] = []
  for (const table of names) {
    const key = idx.tableKey(schema, table)
    const cols = [...(idx.columns.get(key)?.values() ?? [])]
    const pk = idx.pks.get(key) ?? []
    const lines = cols.map((c) => {
      const type = normalizeType(c.udt).toUpperCase()
      const parts = [c.column, type]
      if (pk.length === 1 && pk[0] === c.column) parts.push('PRIMARY KEY')
      else if (c.notNull) parts.push('NOT NULL')
      if (c.identity) parts.push('GENERATED BY DEFAULT AS IDENTITY')
      else if (c.hasDefault && c.default) parts.push(`DEFAULT ${collapseOutsideQuotes(c.default)}`)
      return `  ${parts.join(' ')}`
    })
    if (pk.length > 1) lines.push(`  PRIMARY KEY (${pk.join(', ')})`)
    for (const fk of idx.fks.get(key) ?? []) {
      if (fk.columns.length !== 1 || !fk.refTable || !fk.refColumns?.length) continue
      lines.push(`  FOREIGN KEY (${fk.columns[0]}) REFERENCES ${fk.refTable}(${fk.refColumns[0]})`)
    }
    blocks.push(`CREATE TABLE ${table} (\n${lines.join(',\n')}\n);`)
  }
  return `${blocks.join('\n\n')}\n`
}

/* ------------------------------------------------------------------ CLI */

interface Args {
  cmd: string
  dbUrl: string
  isa: string
  dbmlDir: string
  json: boolean
  catalogJson: string | null
  schema: string
  tables: string[] | undefined
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    cmd: argv[0] ?? '',
    dbUrl: process.env.SPECFORMULA_DDL_CHECK_DB_URL ?? DEFAULT_DB_URL,
    isa: 'isa.yml',
    dbmlDir: 'specs/truth/data',
    json: false,
    catalogJson: null,
    schema: 'public',
    tables: undefined,
  }
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i]
    const v = () => argv[++i] ?? ''
    if (k === '--db-url') a.dbUrl = v()
    else if (k === '--isa') a.isa = v()
    else if (k === '--dbml-dir') a.dbmlDir = v()
    else if (k === '--json') a.json = true
    else if (k === '--catalog-json') a.catalogJson = v()
    else if (k === '--schema') a.schema = v()
    else if (k === '--tables') a.tables = v().split(',').filter(Boolean)
    else throw new Error(`未知參數：${k}`)
  }
  return a
}

function loadCatalog(a: Args, schemas: string[]): Catalog {
  if (a.catalogJson) return parseCatalog(JSON.parse(readFileSync(a.catalogJson, 'utf8')) as unknown)
  return readCatalogFromDb(a.dbUrl, schemas)
}

function readDbmlDir(dir: string): DbmlTable[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.dbml'))
    .toSorted()
    .flatMap((f) => parseDbml(readFileSync(join(dir, f), 'utf8'), join(dir, f)))
}

async function runCheck(a: Args): Promise<number> {
  if (!existsSync(a.isa)) {
    process.stderr.write(`找不到 ${a.isa}——本 check 從 repo root 跑\n`)
    return 2
  }
  const sources = (await readIsaSources(a.isa)).filter((s) => s.dbType === 'postgresql')
  if (sources.length === 0) {
    process.stdout.write('isa.yml 沒有 db_type: postgresql 的 data source——無 DB 可比，略過\n')
    return 0
  }
  const schemas = [...new Set(sources.map((s) => s.schema))]
  const inputs: DataSourceInput[] = []
  for (const s of sources) inputs.push({ name: s.name, schema: s.schema, tables: await readDdl(s) })
  const catalog = loadCatalog(a, schemas)
  const dbml = readDbmlDir(a.dbmlDir)
  const findings = [...compareDdl(inputs, catalog), ...compareDbml(dbml, catalog, schemas)]
  const errors = findings.filter((f) => f.severity === 'error')
  if (a.json) {
    process.stdout.write(
      `${JSON.stringify({ schemas, ddlTables: inputs.reduce((n, s) => n + s.tables.length, 0), dbmlTables: dbml.length, errors: errors.length, findings }, null, 2)}\n`,
    )
  } else {
    process.stdout.write(
      `specformula-ddl-check：schema ${schemas.join(', ')}；DDL ${inputs.reduce((n, s) => n + s.tables.length, 0)} 表、DBML ${dbml.length} 表、DB ${catalog.tables.length} 表\n`,
    )
    for (const f of findings)
      process.stdout.write(
        `${f.severity === 'error' ? 'ERROR' : 'info '} [${f.kind}] ${f.message}\n`,
      )
    process.stdout.write(
      errors.length === 0
        ? '✅ specs/data 與 DBML 對 migration 回放後的 DB 一致\n'
        : `❌ ${errors.length} 個 error——修 specs/data 或 DBML 讓它對上 migration（規約：rules/core/specformula.md § Truth 佈局）\n`,
    )
  }
  return errors.length === 0 ? 0 : 1
}

export async function main(argv: string[]): Promise<number> {
  let a: Args
  try {
    a = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`)
    return 2
  }
  if (a.cmd === 'check') return runCheck(a)
  if (a.cmd === 'emit') {
    process.stdout.write(emitDdl(loadCatalog(a, [a.schema]), a.schema, a.tables))
    return 0
  }
  if (a.cmd === 'dump-catalog') {
    process.stdout.write(`${JSON.stringify(readCatalogFromDb(a.dbUrl, [a.schema]), null, 2)}\n`)
    return 0
  }
  process.stderr.write(
    '用法：node --import tsx scripts/specformula-ddl-check.ts check|emit|dump-catalog [--db-url url] [--isa isa.yml] [--dbml-dir dir] [--schema s] [--tables a,b] [--catalog-json f] [--json]\n',
  )
  return 2
}

function invokedAsCli(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return entry === fileURLToPath(import.meta.url)
  }
}

if (invokedAsCli()) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${(error as Error).message}\n`)
      process.exit(2)
    },
  )
}
