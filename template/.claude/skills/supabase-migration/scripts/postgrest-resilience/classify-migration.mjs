#!/usr/bin/env node

// Migration 風險分類器：
// - statement 切分尊重字串、dollar-quote、註解；規則比對用 masked 副本（字串內容與 dollar body
//   抹掉），function body 內的文字屬於資料、不誤觸外層語句的規則
// - ALTER TABLE 逐 action 判定（ADD CONSTRAINT 無 NOT VALID、DROP CONSTRAINT、SET NOT NULL、TYPE …）
// - 同檔 CREATE TABLE 新表豁免（IF NOT EXISTS 不豁免；TEMP 表掛 pg_temp 命名空間）；
//   CREATE INDEX 依目標表判
// - DO block：body 出現 DDL／DCL／blocking maintenance／動態 SQL 動詞 → review_required
//   （body 內字串字面量遮罩後比對）；純 plpgsql 控制流＋DML → online_safe
// - 零命中 = review_required，且 review_required 一律 hardStop（fail closed）
// - 檔頭 `-- Migration risk: <level>` 與分類器結果取較嚴格者

import fs from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('Usage: classify-migration.mjs <migration.sql>')
  process.exit(2)
}

const sql = fs.readFileSync(file, 'utf8')
const statements = splitStatements(sql)

// 陳述式切分：認得註解（-- 與巢狀 /* */）、單引號字串、雙引號識別字、dollar-quoted body（$$ 與 $tag$），
// 只在頂層 ; 切。classify 比對用 masked（字串內容與 dollar body 抹掉），避免 function body 內的文字誤觸規則；
// 顯示用 text（保留原文）。
function splitStatements(source) {
  const parts = []
  let text = ''
  let masked = ''
  const flush = () => {
    if (text.trim()) parts.push({ text: text.trim(), masked: masked.trim() })
    text = ''
    masked = ''
  }
  const dollarTag = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (source.startsWith('--', i)) {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end
      continue
    }
    if (source.startsWith('/*', i)) {
      let depth = 1
      let j = i + 2
      while (j < source.length && depth > 0) {
        if (source.startsWith('/*', j)) {
          depth++
          j += 2
        } else if (source.startsWith('*/', j)) {
          depth--
          j += 2
        } else j++
      }
      text += ' '
      masked += ' '
      i = j
      continue
    }
    if (ch === "'" || ch === '"') {
      const backslashEscapes =
        ch === "'" && /[eE]/.test(source[i - 1] ?? '') && !/\w/.test(source[i - 2] ?? '')
      let j = i + 1
      while (j < source.length) {
        if (backslashEscapes && source[j] === '\\') j += 2
        else if (source[j] === ch && source[j + 1] === ch) j += 2
        else if (source[j] === ch) break
        else j++
      }
      const literal = source.slice(i, j + 1)
      text += literal
      masked += ch === "'" ? "''" : literal
      i = j + 1
      continue
    }
    if (ch === '$' && !/[\w$]/.test(source[i - 1] ?? '')) {
      dollarTag.lastIndex = i
      const open = dollarTag.exec(source)
      if (open) {
        const close = source.indexOf(open[0], i + open[0].length)
        const end = close === -1 ? source.length : close + open[0].length
        text += source.slice(i, end)
        masked += `${open[0]} ${open[0]}`
        i = end
        continue
      }
    }
    if (ch === ';') {
      flush()
      i++
      continue
    }
    text += ch
    masked += ch
    i++
  }
  flush()
  return parts
}

const rank = {
  online_safe: 1,
  expand_contract_required: 2,
  maintenance_required: 3,
  review_required: 4,
}

function highest(severities) {
  if (severities.length === 0) return 'review_required'
  return severities.toSorted((a, b) => rank[b] - rank[a])[0]
}

// 以頂層逗號切 ALTER TABLE 的 action（括號內的逗號不切）。
function splitTopLevelCommas(text) {
  const parts = []
  let depth = 0
  let current = ''
  let quote = null
  for (const ch of text) {
    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') quote = ch
    else if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`
const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`

function normalizeIdent(part) {
  const trimmed = part.trim()
  return trimmed.startsWith('"') ? trimmed.slice(1, -1).replace(/""/g, '"') : trimmed.toLowerCase()
}

// 保留 schema（未限定者視為 public），`audit.users` 與 `public.users` 不可混為一張表。
function normalizeName(name) {
  const parts = name.match(new RegExp(IDENT, 'g')).map(normalizeIdent)
  return parts.length === 1 ? `public.${parts[0]}` : `${parts[0]}.${parts[1]}`
}

const finding = (id, severity, reason) => ({ id, severity, reason })

// ADD COLUMN … DEFAULT <expr> 的 volatility 判定（PG 11+：非 volatile default 只改 catalog，
// volatile default 整表重寫）。已知 volatile 直接硬擋；不在已知 non-volatile 名單的函式一律
// fail closed（review_required），寧可多擋也不把重寫標成 online_safe。
const VOLATILE_DEFAULT_FUNCTIONS = new Set([
  'random',
  'random_normal',
  'setseed',
  'gen_random_uuid',
  'uuidv4',
  'uuidv7',
  'uuid_generate_v1',
  'uuid_generate_v1mc',
  'uuid_generate_v4',
  'gen_random_bytes',
  'gen_salt',
  'clock_timestamp',
  'timeofday',
  'nextval',
  'setval',
  'currval',
  'lastval',
  'txid_current',
  'txid_current_if_assigned',
  'pg_current_xact_id',
  'pg_current_xact_id_if_assigned',
  'pg_backend_pid',
  'pg_sleep',
  'pg_notify',
  'pg_advisory_lock',
  'pg_try_advisory_lock',
  'pg_advisory_xact_lock',
  'pg_current_wal_lsn',
  'pg_postmaster_start_time',
])
const NON_VOLATILE_DEFAULT_FUNCTIONS = new Set([
  // SQL 構造／型別建構（`x::numeric(10,2)`、`cast(… as varchar(10))` 也會長得像呼叫）
  'array',
  'cast',
  'coalesce',
  'nullif',
  'greatest',
  'least',
  'row',
  'case',
  'varchar',
  'char',
  'character',
  'numeric',
  'decimal',
  'timestamp',
  'timestamptz',
  'time',
  'timetz',
  'interval',
  'bit',
  'varbit',
  // 時間（now／transaction_timestamp／statement_timestamp 為 stable，非 clock_timestamp）
  'now',
  'transaction_timestamp',
  'statement_timestamp',
  'make_interval',
  'make_date',
  'make_timestamp',
  'make_timestamptz',
  'date_trunc',
  'to_timestamp',
  'timezone',
  'age',
  // 字串／jsonb／陣列（immutable 或 stable）
  'lower',
  'upper',
  'concat',
  'concat_ws',
  'format',
  'to_char',
  'to_jsonb',
  'to_json',
  'jsonb_build_object',
  'json_build_object',
  'jsonb_build_array',
  'json_build_array',
  'array_fill',
  'string_to_array',
  'array_to_string',
  'btrim',
  'trim',
  'md5',
  'length',
  'current_setting',
  'current_user',
  'session_user',
  'current_schema',
  'current_date',
  'current_time',
  'current_timestamp',
  'localtime',
  'localtimestamp',
])
// supabase auth helper（stable），只在 `auth.` 限定時認。
const AUTH_HELPER_FUNCTIONS = new Set(['uid', 'role', 'jwt', 'email'])

// 這些字出現在 `(` 前不是函式呼叫（運算子／關鍵字）。
const DEFAULT_EXPR_KEYWORDS = new Set([
  'and',
  'or',
  'not',
  'in',
  'is',
  'between',
  'like',
  'ilike',
  'then',
  'else',
  'when',
  'end',
  'as',
  'at',
  'any',
  'all',
  'some',
  'distinct',
])
// 欄位約束關鍵字：default 表達式在「括號深度 0」遇到它們即結束。
const DEFAULT_TERMINATOR =
  /^(?:not\s+null|null|check|references|unique|primary\s+key|constraint|collate|generated)\b/
// `::` 後的型別名（含多字型別、schema 限定、長度修飾、陣列）；只吃一個型別，不跨過後面的運算子。
const CAST_TYPE =
  /::\s*(?:double\s+precision|(?:character|char|bit)\s+varying|(?:timestamp|time)\s+with(?:out)?\s+time\s+zone|[a-z_][a-z0-9_$]*(?:\s*\.\s*[a-z_][a-z0-9_$]*)*)(?:\s*\([^)]*\))?(?:\s*\[\s*\d*\s*\])*/g

// 抹掉字串字面量（內容屬資料，`'n/a (pending)'` 不是呼叫）並拿掉 quoted identifier 的引號
// （`"gen_random_uuid"()` 仍是同一個函式）。
function stripDefaultNoise(text) {
  return text
    .replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/(?:e)?'(?:[^']|'')*'/g, "''")
    .replace(/"([^"]*)"/g, '$1')
}

// default 表達式（到括號深度 0 的下一個欄位約束關鍵字為止；括號內的 null／check 屬表達式本身，
// `x is not null` 的 not null 也不是約束）。
function defaultExpression(text) {
  const match = /\bdefault\b/.exec(text)
  if (!match) return null
  const rest = text.slice(match.index + match[0].length)
  let depth = 0
  let prevWord = ''
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (depth === 0 && /[a-z]/.test(ch) && !/[\w$]/.test(rest[i - 1] ?? ' ')) {
      if (prevWord !== 'is' && DEFAULT_TERMINATOR.test(rest.slice(i))) return rest.slice(0, i)
      prevWord = /^[a-z_][\w$]*/.exec(rest.slice(i))[0]
    }
  }
  return rest
}

// 回傳 default 表達式內的函式呼叫（保留 schema 限定名，去空白）。
function defaultFunctionCalls(body) {
  const expr = defaultExpression(stripDefaultNoise(body))
  if (expr === null) return []
  const bare = expr.replace(CAST_TYPE, ' ')
  const fns = []
  for (const call of bare.matchAll(/([a-z_][a-z0-9_$]*(?:\s*\.\s*[a-z_][a-z0-9_$]*)*)\s*\(/g)) {
    const name = call[1].replace(/\s+/g, '')
    if (!DEFAULT_EXPR_KEYWORDS.has(name)) fns.push(name)
  }
  return fns
}

// volatile 名單看「最後一段」：任何 schema 下同名函式都按 volatile 處理（fail closed）。
const lastSegment = (fn) => fn.split('.').at(-1)

// non-volatile 名單只認未限定或 pg_catalog 限定的內建；auth helper 只認 `auth.` 限定。
// 其他 schema 的同名函式（`app.role()`）可能是使用者自訂 volatile → 判不出，走 review_required。
function isKnownNonVolatile(fn) {
  const parts = fn.split('.')
  if (parts.length === 1) return NON_VOLATILE_DEFAULT_FUNCTIONS.has(fn)
  if (parts.length === 2 && parts[0] === 'pg_catalog')
    return NON_VOLATILE_DEFAULT_FUNCTIONS.has(parts[1])
  if (parts.length === 2 && parts[0] === 'auth') return AUTH_HELPER_FUNCTIONS.has(parts[1])
  return false
}

function classifyAlterTableAction(action, isNewTable) {
  const a = action.replace(/\s+/g, ' ').trim()
  const lower = a.toLowerCase()

  if (
    new RegExp(
      String.raw`^add\s+(constraint\s+${IDENT}\s+)?(check|foreign\s+key|unique|primary\s+key|exclude)\b`,
      'i',
    ).test(a)
  ) {
    if (/\busing\s+index\b/.test(lower)) {
      return finding(
        'online-add-constraint-using-index',
        'online_safe',
        'Attaching an existing index as a constraint is metadata-only.',
      )
    }
    if (/\bnot\s+valid\b/.test(lower)) {
      return finding(
        'online-add-not-valid-constraint',
        'online_safe',
        'NOT VALID constraints avoid validating existing rows in the migration step.',
      )
    }
    if (isNewTable) {
      return finding(
        'online-alter-new-table',
        'online_safe',
        'Target table is created in this migration; no existing readers or rows.',
      )
    }
    return finding(
      'maintenance-add-validated-constraint',
      'maintenance_required',
      'ADD CONSTRAINT without NOT VALID scans the table (or builds an index) under a blocking lock; use NOT VALID + VALIDATE CONSTRAINT.',
    )
  }

  if (/^add\s+(column\s+)?/.test(lower)) {
    const body = lower.replace(/^add\s+(column\s+)?(if\s+not\s+exists\s+)?/, '')
    if (isNewTable) {
      return finding(
        'online-alter-new-table',
        'online_safe',
        'Target table is created in this migration; no existing readers or rows.',
      )
    }
    if (/\b(primary\s+key|unique)\b/.test(body) || /\bgenerated\s+always\s+as\s*\(/.test(body)) {
      return finding(
        'maintenance-add-column-rewrite',
        'maintenance_required',
        'Column with UNIQUE/PRIMARY KEY or stored generated value builds an index or rewrites the table.',
      )
    }
    if (
      new RegExp(String.raw`^${IDENT}\s+(?:smallserial|bigserial|serial[248]?)\b`, 'i').test(
        body,
      ) ||
      /\bgenerated\s+(?:always|by\s+default)\s+as\s+identity\b/.test(body)
    ) {
      return finding(
        'maintenance-add-column-volatile-default',
        'maintenance_required',
        'serial／IDENTITY column carries an implicit nextval() default; the volatile default forces a full table rewrite.',
      )
    }
    const defaultFns = defaultFunctionCalls(body)
    const volatileFn = defaultFns.find((fn) => VOLATILE_DEFAULT_FUNCTIONS.has(lastSegment(fn)))
    if (volatileFn) {
      return finding(
        'maintenance-add-column-volatile-default',
        'maintenance_required',
        `Volatile DEFAULT ${lastSegment(volatileFn)}() forces a full table rewrite.`,
      )
    }
    const unknownFn = defaultFns.find((fn) => !isKnownNonVolatile(fn))
    if (unknownFn) {
      // 判不出 volatility → fail closed：volatile 會整表重寫，沒把握就不放行。
      return finding(
        'review-add-column-unknown-default-volatility',
        'review_required',
        `DEFAULT calls ${unknownFn}() whose volatility cannot be determined; a volatile function rewrites the whole table under ACCESS EXCLUSIVE.`,
      )
    }
    if (/\bnot\s+null\b/.test(body.replace(/\bcheck\s*\([^)]*\)/g, ''))) {
      return finding(
        'maintenance-add-not-null-column',
        'maintenance_required',
        'NOT NULL columns on existing tables need the nullable → backfill → NOT VALID CHECK sequence.',
      )
    }
    return finding(
      'online-add-nullable-column',
      'online_safe',
      'Adding a nullable column is generally backward-compatible.',
    )
  }

  if (/^drop\s+constraint\b/.test(lower)) {
    if (isNewTable)
      return finding(
        'online-alter-new-table',
        'online_safe',
        'Target table is created in this migration; no existing readers or rows.',
      )
    return finding(
      'maintenance-drop-constraint',
      'maintenance_required',
      'DROP CONSTRAINT takes an ACCESS EXCLUSIVE lock and queues behind every open transaction on the table.',
    )
  }

  if (
    /^drop\s+(column\s+)?/.test(lower) &&
    !/^drop\s+(not\s+null|default|identity|expression)\b/.test(lower)
  ) {
    return finding(
      'expand-contract-drop-column',
      'expand_contract_required',
      'Dropping columns requires readers and writers to be migrated first.',
    )
  }

  if (/^alter\s+(column\s+)?\S+\s+(set\s+data\s+)?type\b/.test(lower)) {
    if (isNewTable)
      return finding(
        'online-alter-new-table',
        'online_safe',
        'Target table is created in this migration; no existing readers or rows.',
      )
    return finding(
      'maintenance-alter-column-type',
      'maintenance_required',
      'Column type changes may rewrite the table or require blocking locks.',
    )
  }

  if (/^alter\s+(column\s+)?\S+\s+set\s+not\s+null\b/.test(lower)) {
    if (isNewTable)
      return finding(
        'online-alter-new-table',
        'online_safe',
        'Target table is created in this migration; no existing readers or rows.',
      )
    return finding(
      'maintenance-set-not-null',
      'maintenance_required',
      'SET NOT NULL scans the whole table under ACCESS EXCLUSIVE unless a validated CHECK already proves it.',
    )
  }

  if (
    /^alter\s+(column\s+)?\S+\s+(drop\s+not\s+null|set\s+default|drop\s+default|set\s+statistics|set\s+storage|set\s*\(|reset\s*\()/.test(
      lower,
    )
  ) {
    return finding(
      'online-alter-column-metadata',
      'online_safe',
      'Column metadata change; no rewrite or scan.',
    )
  }

  if (/^rename\s+constraint\b/.test(lower)) {
    return finding(
      'online-rename-constraint',
      'online_safe',
      'Renaming a constraint does not affect application queries.',
    )
  }

  if (/^rename\b/.test(lower)) {
    return finding(
      'expand-contract-rename',
      'expand_contract_required',
      'Renames break old application code unless deployed through expand/contract.',
    )
  }

  if (/^set\s+schema\b/.test(lower)) {
    return finding(
      'expand-contract-set-schema',
      'expand_contract_required',
      'Moving a table to another schema breaks existing references.',
    )
  }

  if (
    /^validate\s+constraint\b/.test(lower) ||
    /^(enable|disable|force|no\s+force)\s+row\s+level\s+security\b/.test(lower) ||
    /^(enable|disable)\s+(always\s+|replica\s+)?trigger\b/.test(lower) ||
    /^(owner\s+to|replica\s+identity|set\s*\(|reset\s*\()/.test(lower)
  ) {
    return finding(
      'online-alter-table-metadata',
      'online_safe',
      'Metadata-only ALTER TABLE action (VALIDATE uses SHARE UPDATE EXCLUSIVE).',
    )
  }

  return null
}

// DO body 內容檢查的動詞集：body 只該是 plpgsql 控制流與 DML——出現任何 DDL（create／
// alter／drop／truncate／comment on／security label／reassign／import foreign）、DCL
// （grant／revoke）、blocking maintenance（lock／cluster／reindex／refresh／vacuum）、
// 檔案與 session 副作用（copy／load／checkpoint／discard）或動態 SQL（execute／call／
// prepare／deallocate）→ review_required。比對前先把 body 內 '…' 字串字面量遮罩：
// 字串裡的關鍵字是資料不該觸發，而 EXECUTE 'DDL' 的 EXECUTE 在字串外仍命中。
const DANGEROUS_IN_BODY =
  /\b(alter|create|drop|truncate|comment\s+on|security\s+label|reassign|import\s+foreign|grant|revoke|lock|cluster|reindex|refresh|vacuum|copy|load|checkpoint|discard|execute|call|prepare|deallocate)\b/i

// DO $$／$tag$ body 的內容遮罩：摘下 outer dollar body 交回 splitStatements 取各段
// masked（'…'→''、註解去除、巢狀 $tag$…$tag$ 遮成開閉標籤）——與頂層切分同一套
// lexer 規則，body 內註解或巢狀 dollar 裡的 ' 不會誤開假字串把後面的 DDL 吞掉。
// body 是 '…' 字面量形（DO '…'）時切不出 outer body，回傳原句整掃——誤報方向 fail closed。
function maskDoBody(text) {
  const open = /^do\s+(?:language\s+\w+\s+)?(\$[A-Za-z_0-9]*\$)/i.exec(text)
  if (!open) return text
  const close = text.indexOf(open[1], open[0].length)
  const inner = close === -1 ? text.slice(open[0].length) : text.slice(open[0].length, close)
  return splitStatements(inner)
    .map((part) => part.masked)
    .join(';')
}

const VERSIONED_CREATE_FUNCTION =
  /^\s*create\s+(function|procedure)\s+(?:(?:"[^"]+"|\w+)\s*\.\s*)?(?:"[^"]*_v\d+"|\w*_v\d+)\s*\(/i

// statement.masked 決定走哪條規則（字串與 dollar body 已抹掉，不誤觸）；
// statement.text 只給 DO block 的內容檢查用——body 內的 DDL／EXECUTE 本來就是要看的東西。
function classifyStatement({ text, masked }, createdTables) {
  const maskedFlat = masked.replace(/\s+/g, ' ').trim()
  const lower = maskedFlat.toLowerCase()

  const created = new RegExp(
    String.raw`^create\s+(?:(?:global|local)\s+)?(?:temp|temporary|unlogged\s+)?\s*table\s+(if\s+not\s+exists\s+)?(${QUALIFIED})`,
    'i',
  ).exec(maskedFlat)
  if (created) {
    // `IF NOT EXISTS` 時表可能早已存在且有資料 → 不給新表豁免（fail closed）。
    // TEMP 表活在 pg_temp schema：豁免鍵掛 pg_temp，否則同名 temp 表會把對 public
    // 熱表的後續 ALTER／CREATE INDEX 誤豁免。
    if (!created[1]) {
      const normalized = normalizeName(created[2])
      const isTemp = /^create\s+(?:(?:global|local)\s+)?(?:temp|temporary)\s+table/i.test(
        maskedFlat,
      )
      createdTables.add(
        isTemp ? `pg_temp.${normalized.slice(normalized.indexOf('.') + 1)}` : normalized,
      )
    }
    return [
      finding(
        'online-create-table',
        'online_safe',
        'Creating a new table is isolated from existing readers.',
      ),
    ]
  }

  const alterTable = new RegExp(
    String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QUALIFIED})\s+([\s\S]*)$`,
    'i',
  ).exec(maskedFlat)
  if (alterTable) {
    const isNewTable = createdTables.has(normalizeName(alterTable[1]))
    const results = splitTopLevelCommas(alterTable[2]).map((action) =>
      classifyAlterTableAction(action, isNewTable),
    )
    // 任一 action 判不出 → 整句不給規則命中，落到 review_required。
    if (results.some((result) => result === null)) return []
    return results
  }

  const index = new RegExp(
    String.raw`^create\s+(?:unique\s+)?index\s+(concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:${IDENT}\s+)?on\s+(?:only\s+)?(${QUALIFIED})`,
    'i',
  ).exec(maskedFlat)
  if (index) {
    if (index[1])
      return [
        finding(
          'online-create-index-concurrently',
          'online_safe',
          'Concurrent indexes avoid blocking normal writes.',
        ),
      ]
    if (createdTables.has(normalizeName(index[2]))) {
      return [
        finding(
          'online-index-new-table',
          'online_safe',
          'Index on a table created in this migration.',
        ),
      ]
    }
    return [
      finding(
        'maintenance-nonconcurrent-index',
        'maintenance_required',
        'Non-concurrent indexes on hot tables can block writes.',
      ),
    ]
  }

  if (/^lock\s+(table\s+)?/.test(lower)) {
    if (/\baccess\s+exclusive\b/.test(lower) || !/\bin\s+\w/.test(lower)) {
      return [
        finding(
          'maintenance-access-exclusive-lock',
          'maintenance_required',
          'ACCESS EXCLUSIVE lock blocks readers and writers on the target relation.',
        ),
      ]
    }
    return [
      finding(
        'maintenance-explicit-lock',
        'maintenance_required',
        'Explicit table lock blocks concurrent writers.',
      ),
    ]
  }

  if (/^drop\s+index\s+concurrently\b/.test(lower)) {
    return [
      finding(
        'online-drop-index-concurrently',
        'online_safe',
        'Concurrent index drop avoids blocking.',
      ),
    ]
  }
  if (/^drop\s+index\b/.test(lower)) {
    return [
      finding(
        'maintenance-drop-index',
        'maintenance_required',
        'Non-concurrent DROP INDEX takes ACCESS EXCLUSIVE on the parent table.',
      ),
    ]
  }

  if (
    /^(truncate\b|vacuum\b\s*(\([^)]*\bfull\b[^)]*\)|full\b)|cluster\b|reindex\b(?![\s\S]*\bconcurrently\b)|refresh\s+materialized\s+view\b(?!\s+concurrently))/.test(
      lower,
    )
  ) {
    return [
      finding(
        'maintenance-blocking-maintenance-command',
        'maintenance_required',
        'Blocking maintenance command (TRUNCATE / VACUUM FULL / CLUSTER / REINDEX / REFRESH).',
      ),
    ]
  }

  if (/^drop\s+function\b|^drop\s+procedure\b/.test(lower)) {
    return [
      finding(
        'expand-contract-drop-function',
        'expand_contract_required',
        'Dropping exposed RPC signatures can break PostgREST clients during rollout.',
      ),
    ]
  }
  if (/^drop\s+(table|view|materialized\s+view|type|sequence)\b/.test(lower)) {
    return [
      finding(
        'expand-contract-drop-object',
        'expand_contract_required',
        'Dropping a relation or type breaks readers that still reference it.',
      ),
    ]
  }
  // ALTER TABLE 已在上面走 classifyAlterTableAction（rename constraint 是 online）；
  // ALTER INDEX RENAME 不改查詢可見行為，留給 metadata catch-all。其餘物件的 rename
  // （含函式簽名 `f(a, b)`、`IF EXISTS`、COLUMN／ATTRIBUTE／VALUE 形）一律 expand。
  if (/^alter\s+(?!table\b|index\b)[\s\S]*\brename\b/.test(lower)) {
    return [
      finding(
        'expand-contract-rename',
        'expand_contract_required',
        'Renames break old application code unless deployed through expand/contract.',
      ),
    ]
  }
  // 與 ALTER TABLE … SET SCHEMA 同形：跨 schema 搬移會斷既有 qualified 參照。
  if (/^alter\s+(?!table\b)[\s\S]*\bset\s+schema\b/.test(lower)) {
    return [
      finding(
        'expand-contract-set-schema',
        'expand_contract_required',
        'Moving an object to another schema breaks existing references.',
      ),
    ]
  }

  // DROP POLICY 直接改變 RLS 存取面，等價於 REVOKE——呼叫端要先遷移。
  if (/^drop\s+policy\b/.test(lower)) {
    return [
      finding(
        'expand-contract-drop-policy',
        'expand_contract_required',
        'Dropping an RLS policy changes access like REVOKE; migrate callers first.',
      ),
    ]
  }
  // DROP SCHEMA … CASCADE 連同 schema 內所有物件一起刪——整個命名空間的資料遺失，
  // 規模超過 expand/contract 能消化的範圍 → review_required 硬擋。
  if (/^drop\s+schema\b[\s\S]*\bcascade\b/.test(lower)) {
    return [
      finding(
        'review-drop-schema-cascade',
        'review_required',
        'DROP SCHEMA CASCADE removes every object in the schema; data loss at namespace granularity cannot be covered by expand/contract.',
      ),
    ]
  }
  // CASCADE 把依附物件一起拖下水：DROP DOMAIN／EXTENSION CASCADE 連用到型別的欄位都掉
  // ＝資料遺失；其餘 DROP（table／view 等）已由上方 expand-contract-drop-object 涵蓋。
  if (/^drop\s+(trigger|rule|domain|extension)\b[\s\S]*\bcascade\b/.test(lower)) {
    return [
      finding(
        'expand-contract-drop-cascade',
        'expand_contract_required',
        'CASCADE drops dependent objects (columns using the domain / extension types); data loss requires expand/contract.',
      ),
    ]
  }

  // ALTER DOMAIN 的 ADD CONSTRAINT（無 NOT VALID）／SET NOT NULL 會把用該 domain 的
  // 每個欄位全部重驗；ALTER INDEX … SET TABLESPACE 重建整個 index。
  if (
    /^alter\s+domain\b/.test(lower) &&
    (/\bset\s+not\s+null\b/.test(lower) ||
      (/\badd\s+constraint\b/.test(lower) && !/\bnot\s+valid\b/.test(lower)))
  ) {
    return [
      finding(
        'maintenance-alter-domain-validate',
        'maintenance_required',
        'ALTER DOMAIN validation re-checks every column that uses the domain.',
      ),
    ]
  }
  if (/^alter\s+index\b[\s\S]*\bset\s+tablespace\b/.test(lower)) {
    return [
      finding(
        'maintenance-alter-index-tablespace',
        'maintenance_required',
        'Moving an index to another tablespace rewrites it.',
      ),
    ]
  }

  if (/^do\b/.test(lower)) {
    // $$／$tag$ body：maskDoBody 遮掉字串／註解／巢狀 dollar 再掃（用保留換行的 text——
    // flat 把 \n 壓成空白會讓 -- 註解一路吃掉整個 body）；'…' 字串形式切不出 body，
    // 退回整句掃——誤報方向是 fail closed。
    if (DANGEROUS_IN_BODY.test(maskDoBody(text))) return []
    return [
      finding(
        'online-do-block-dml',
        'online_safe',
        'Procedural block without DDL / dynamic SQL; row-level locks only.',
      ),
    ]
  }

  if (/^(insert|update|delete|merge|with|select|values)\b/.test(lower)) {
    return [
      finding(
        'online-dml',
        'online_safe',
        'Data statement; row-level locks only (batch large backfills).',
      ),
    ]
  }

  // PostgREST 刻意的升級：in-place replace 會改暴露 RPC 的行為或簽名、同名新 overload 會讓
  // RPC 呼叫變 ambiguous（PGRST203）。插在 metadata catch-all 之前，否則 create function 先被當 online。
  if (/^create\s+or\s+replace\s+(function|procedure)\b/.test(lower)) {
    return [
      finding(
        'expand-contract-replace-function',
        'expand_contract_required',
        'Replacing an exposed RPC in place changes behavior or signature under live clients; ship a new versioned function first, then contract.',
      ),
    ]
  }
  if (VERSIONED_CREATE_FUNCTION.test(lower)) {
    return [
      finding(
        'online-create-function-versioned',
        'online_safe',
        'Creating a new versioned function (name ends in _vN) cannot overload an exposed RPC; existing signatures are untouched.',
      ),
    ]
  }
  if (/^create\s+(function|procedure)\b/.test(lower)) {
    return [
      finding(
        'expand-contract-create-function',
        'expand_contract_required',
        'A new overload of an exposed function name makes PostgREST RPC calls ambiguous (PGRST203); use a versioned name (_v2) or confirm the name is unused, and annotate the migration risk.',
      ),
    ]
  }
  if (/^grant\b/.test(lower)) {
    if (/\bto\b[\s\S]*\b(anon|public)\b/.test(lower)) {
      return [
        finding(
          'expand-contract-grant-public',
          'expand_contract_required',
          'Granting to anon/public widens access for unauthenticated roles; needs reviewer attention.',
        ),
      ]
    }
    return [
      finding(
        'online-grant',
        'online_safe',
        'Granting to authenticated roles is additive; it only widens what the target role can reach.',
      ),
    ]
  }
  if (/^revoke\b/.test(lower)) {
    return [
      finding(
        'expand-contract-revoke',
        'expand_contract_required',
        'Revoking privileges removes access PostgREST roles may still rely on; migrate callers first (expand/contract).',
      ),
    ]
  }
  if (/^comment\s+on\b/.test(lower)) {
    return [
      finding(
        'online-comment-on',
        'online_safe',
        'COMMENT ON only changes catalog descriptions (PostgREST OpenAPI text), not behavior.',
      ),
    ]
  }

  if (
    /^(set|reset|begin|commit|end|start\s+transaction|notify|analyze|vacuum|comment\s+on|grant|revoke|security\s+label)\b/.test(
      lower,
    ) ||
    /^create\s+(or\s+replace\s+)?(function|procedure|view|trigger|constraint\s+trigger|type|domain|schema|extension|sequence|policy|aggregate|cast|operator|publication|materialized\s+view|rule)\b/.test(
      lower,
    ) ||
    /^create\s+or\s+replace\s+(temp\s+|temporary\s+|recursive\s+)?view\b/.test(lower) ||
    /^drop\s+(trigger|rule|domain|extension|schema\s+if\s+exists\s+\S+\s*$)\b/.test(lower) ||
    /^alter\s+(function|procedure|view|type|domain|policy|sequence|schema|default\s+privileges|publication|index|materialized\s+view|extension|trigger|aggregate)\b/.test(
      lower,
    )
  ) {
    return [
      finding(
        'online-metadata',
        'online_safe',
        'Catalog / privilege / function definition change; no table rewrite or scan.',
      ),
    ]
  }

  return []
}

const DECLARED_RE = /^\s*--\s*Migration risk:\s*([A-Za-z_]+)/im
const declaredMatch = DECLARED_RE.exec(sql)
const declaredRaw = declaredMatch ? declaredMatch[1].toLowerCase() : null
// 檔頭寫了但不是合法等級 → 視為 review_required（fail closed）。
const declaredRisk =
  declaredRaw === null ? null : Object.hasOwn(rank, declaredRaw) ? declaredRaw : 'review_required'

const createdTables = new Set()

const findings = statements.map((statement, index) => {
  const matched = classifyStatement(statement, createdTables)
  return {
    index: index + 1,
    statement: statement.text.replace(/\s+/g, ' ').slice(0, 220),
    classification: highest(matched.map((rule) => rule.severity)),
    rules: matched,
  }
})

const classifiedOverall = highest(findings.map((entry) => entry.classification))
const overall = declaredRisk ? highest([classifiedOverall, declaredRisk]) : classifiedOverall

console.log(
  JSON.stringify(
    {
      file,
      generatedAt: new Date().toISOString(),
      overall,
      classifiedOverall,
      declaredRisk,
      declaredRiskRaw: declaredRaw,
      // fail closed：無法分類（review_required）與需維護窗口（maintenance_required）都擋。
      hardStop: overall === 'maintenance_required' || overall === 'review_required',
      summary: {
        onlineSafe: findings.filter((entry) => entry.classification === 'online_safe').length,
        expandContractRequired: findings.filter(
          (entry) => entry.classification === 'expand_contract_required',
        ).length,
        maintenanceRequired: findings.filter(
          (entry) => entry.classification === 'maintenance_required',
        ).length,
        reviewRequired: findings.filter((entry) => entry.classification === 'review_required')
          .length,
      },
      findings,
    },
    null,
    2,
  ),
)
