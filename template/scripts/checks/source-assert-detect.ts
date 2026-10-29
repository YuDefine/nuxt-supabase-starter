// 🔒 LOCKED — managed by clade · Source: vendor/scripts/checks/source-assert-detect.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/checks/source-assert-detect.ts
// CLADE:VENDOR-SCRIPT
//
// source-assert-detect — P 類測試（讀原始碼比字串）的單檔判定
//
// P 類 = 測試檔讀 repo 內的原始碼／文件（.vue .ts .tsx .js .mjs .md）當字串，再用 toContain／
// toMatch 之類斷言釘文字。它釘的是「原始碼長這樣」，不是「行為是這樣」，重構一動就紅、行為壞了
// 不紅（rules/core/testing-anti-patterns.md U 判準）。
//
// 三條全中才是 P（以檔為單位）：
//   R  有 readFileSync／readFile／fs.promises.readFile 讀得到字面路徑（可經 resolve／join／new URL
//      或 const、函式參數、for-of 組出來），目標副檔名在範圍內，且不在 fixtures／__fixtures__／
//      __snapshots__／gitignored 產出目錄
//   A  檔內有 toContain／toMatch／assert.match／assert.ok(…includes…) 這類字串斷言；主體走行為通道
//      （mount／spawn／import 進來的被測函式的產出，經 const 傳下來也算）的斷言不計數
//   非 E  被讀的目標沒有同時被 import／動態 import／mount／render／spawn／exec 實際執行，
//         讀進的文字變數也沒傳給 import 進來的非測試函式；讀進的文字也沒寫進某目錄後、
//         在同一個 it／test 裡接著把該目錄交給 import 進來的非測試函式（複製當輸入）
// D 類（yml／sql／toml／json／Dockerfile／wrangler）不在 R 範圍。
// 混合型（同檔有 E 讀取點又有 P 讀取點）→ kind 'mixed'，只 warn，不做 it 層資料流。
//
// 零依賴：NEVER 引入 typescript／oxc parser。逐字元掃描器只處理 string／template／comment／regex
// literal，足以做括號配對與字面值抽取；判不出來的讀取點一律當「不是 R」（寧缺毋濫，不誤擋）。
//
// 被 source-assert-gate.ts 共用。由 ~/clade vendor/scripts/checks/ 散播，請勿直接編輯 consumer 副本。

export const SOURCE_EXTS = ['.vue', '.ts', '.tsx', '.js', '.mjs', '.md'] as const
export const MARKER_CODES = ['no-behavior-channel', 'declarative'] as const
export type MarkerCode = (typeof MARKER_CODES)[number]

const EXCLUDED_SEGMENTS = new Set(['fixtures', '__fixtures__', '__snapshots__'])
const OUTPUT_SEGMENTS = new Set([
  'node_modules',
  '.nuxt',
  '.output',
  '.data',
  '.vercel',
  '.wrangler',
  'dist',
  'coverage',
])
const TEST_LIB_SPEC =
  /^(?:vitest(?:\/.*)?|@vitest\/.*|node:.*|(?:fs|path|url|os|assert|child_process|util)(?:\/.*)?|pathe(?:\/.*)?|upath|fs-extra(?:\/.*)?|graceful-fs|memfs|@vue\/test-utils|@nuxt\/test-utils(?:\/.*)?|@testing-library\/.*|vite-plus(?:\/.*)?|chai|@playwright\/test|playwright(?:-core)?|bun:test)$/
const EXEC_NAMES = [
  'mount',
  'shallowMount',
  'render',
  'renderToString',
  'renderSuspended',
  'mountSuspended',
  'spawn',
  'spawnSync',
  'execFile',
  'execFileSync',
  'exec',
  'execSync',
  'fork',
]
const EXEC_CALL = new RegExp(`\\b(?:${EXEC_NAMES.join('|')})\\s*\\(`, 'g')
const KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'new',
  'await',
  'async',
  'function',
  'return',
  'typeof',
  'true',
  'false',
  'null',
  'undefined',
  'this',
  'as',
  'of',
  'in',
  'if',
  'else',
])

/** 測試檔路徑：`*.test.*`／`*.spec.*`（ts tsx js mjs mts cts jsx） */
export function isTestPath(path: string): boolean {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
}

// ---------------------------------------------------------------------------
// 掃描器：去註解、字串略過、括號配對

/** 註解換成空白（保留換行，行號不漂）。字串、template、regex literal 原樣保留。 */
export function stripComments(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  let prev = '' // 上一個非空白字元，判斷 `/` 是 regex 開頭還是除號
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }
    if (c === '/' && d === '*') {
      out += '  '
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < n) {
        out += '  '
        i += 2
      }
      continue
    }
    if (c === "'" || c === '"') {
      const end = skipString(src, i)
      out += src.slice(i, end)
      i = end
      prev = c
      continue
    }
    if (c === '`') {
      const end = skipTemplate(src, i)
      out += src.slice(i, end)
      i = end
      prev = c
      continue
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};'.includes(prev))) {
      const end = skipRegex(src, i)
      out += src.slice(i, end)
      i = end
      prev = '/'
      continue
    }
    out += c
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out
}

/**
 * 字串／template 文字／regex literal 的內容換成空白（長度、換行、`${…}` 內的程式碼都保留）。
 * 結構比對（readFileSync(、import、expect(…)）只在這份上做，才不會把測試字串裡「拿來當
 * fixture 的程式碼」當成這個測試檔自己的程式碼；字面值抽取仍讀原文，兩份 index 一一對應。
 */
export function maskStrings(src: string): string {
  let out = ''
  let i = 0
  let prev = ''
  const blank = (t: string) => t.replace(/[^\n]/g, ' ')
  while (i < src.length) {
    const c = src[i]
    if (c === "'" || c === '"') {
      const end = skipString(src, i)
      out +=
        c + blank(src.slice(i + 1, Math.max(i + 1, end - 1))) + (end - i > 1 ? src[end - 1] : '')
      i = end
      prev = c
      continue
    }
    if (c === '`') {
      const end = skipTemplate(src, i)
      let j = i + 1
      let t = '`'
      while (j < end - 1) {
        if (src[j] === '$' && src[j + 1] === '{') {
          const close = skipBraces(src, j + 1)
          t += '${' + maskStrings(src.slice(j + 2, close - 1)) + '}'
          j = close
        } else if (src[j] === '\\') {
          t += src[j + 1] === '\n' ? ' \n' : '  '
          j += 2
        } else {
          t += src[j] === '\n' ? '\n' : ' '
          j++
        }
      }
      out += t + (end - 1 > i ? '`' : '')
      i = end
      prev = '`'
      continue
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};'.includes(prev))) {
      const end = skipRegex(src, i)
      if (end > i + 1) {
        out += c + blank(src.slice(i + 1, end))
        i = end
        prev = '/'
        continue
      }
    }
    out += c
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out
}

function skipString(src: string, i: number): number {
  const q = src[i]
  let j = i + 1
  while (j < src.length && src[j] !== q) {
    if (src[j] === '\\') j++
    if (src[j] === '\n') return j // 不閉合的字串：到行尾止，避免吞掉整檔
    j++
  }
  return Math.min(j + 1, src.length)
}

function skipTemplate(src: string, i: number): number {
  let j = i + 1
  while (j < src.length && src[j] !== '`') {
    if (src[j] === '\\') {
      j += 2
      continue
    }
    if (src[j] === '$' && src[j + 1] === '{') {
      j = skipBraces(src, j + 1)
      continue
    }
    j++
  }
  return Math.min(j + 1, src.length)
}

/** i 指向 `{`；回傳對應 `}` 之後的位置 */
function skipBraces(src: string, i: number): number {
  let depth = 0
  let j = i
  while (j < src.length) {
    const c = src[j]
    if (c === "'" || c === '"') {
      j = skipString(src, j)
      continue
    }
    if (c === '`') {
      j = skipTemplate(src, j)
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return j + 1
    }
    j++
  }
  return src.length
}

function skipRegex(src: string, i: number): number {
  let j = i + 1
  let inClass = false
  while (j < src.length && src[j] !== '\n') {
    const c = src[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (c === '/' && !inClass) {
      j++
      while (j < src.length && /[a-z]/.test(src[j])) j++
      return j
    }
    j++
  }
  return i + 1 // 不是 regex（是除號）：只前進一格
}

/** open 指向 `(`／`[`／`{`；回傳對應右括號的 index（找不到回 -1） */
export function matchBracket(src: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  const stack: string[] = []
  let j = open
  while (j < src.length) {
    const c = src[j]
    if (c === "'" || c === '"') {
      j = skipString(src, j)
      continue
    }
    if (c === '`') {
      j = skipTemplate(src, j)
      continue
    }
    if (pairs[c]) stack.push(pairs[c])
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1
      if (stack.length === 0) return j
    }
    j++
  }
  return -1
}

function lineOf(src: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++
  return line
}

// ---------------------------------------------------------------------------
// 字面值解析

/** 運算式內所有字串／template literal 的內容；template 的 `${…}` 換成 `*` */
export function literalsIn(expr: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < expr.length) {
    const c = expr[i]
    if (c === "'" || c === '"') {
      const end = skipString(expr, i)
      out.push(expr.slice(i + 1, end - 1))
      i = end
    } else if (c === '`') {
      const end = skipTemplate(expr, i)
      let body = ''
      let j = i + 1
      while (j < end - 1) {
        if (expr[j] === '$' && expr[j + 1] === '{') {
          body += '*'
          j = skipBraces(expr, j + 1)
        } else body += expr[j++]
      }
      out.push(body)
      i = end
    } else i++
  }
  return out
}

/** 取出沒被包在字串／括號呼叫裡的識別字（const／參數追蹤用）。`foo(` 與 `.foo` 不算。 */
function identifiersIn(expr: string): string[] {
  return identifierSpans(expr).map((s) => s.id)
}

/** 同 identifiersIn，並附識別字在 expr 內的起點（作用域解析用） */
function identifierSpans(expr: string): { id: string; at: number }[] {
  const ids: { id: string; at: number }[] = []
  let i = 0
  while (i < expr.length) {
    const c = expr[i]
    if (c === "'" || c === '"') {
      i = skipString(expr, i)
      continue
    }
    if (c === '`') {
      const end = skipTemplate(expr, i)
      // `${ID}` 裡的識別字也要追
      const body = expr.slice(i, end)
      for (const m of body.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
        ids.push({ id: m[1], at: i + m.index + m[0].indexOf(m[1]) })
      }
      i = end
      continue
    }
    const m = /^[A-Za-z_$][\w$]*/.exec(expr.slice(i, i + 80))
    if (m) {
      const before = expr[i - 1]
      const after = expr.slice(i + m[0].length).match(/^\s*(.)/)?.[1]
      if (before !== '.' && after !== '(' && after !== ':' && !KEYWORDS.has(m[0])) {
        ids.push({ id: m[0], at: i })
      }
      i += m[0].length
      continue
    }
    i++
  }
  return ids
}

interface ResolveCtx {
  src: string
  viaFns: Set<string>
  /**
   * 單一讀取點內 `(expr, depth)` → 解出的字面值。同一個識別字（`path`、`file` 這類通用名）會從
   * 多條 const／forEach／函式呼叫路徑反覆回到同一段運算式，不記下來就是每條路徑各重掃一遍整份原文。
   * 只能掛在單一讀取點的 ctx 上：`viaFns` 是該讀取點的副產物，跨讀取點共用會漏記。
   */
  memo?: Map<string, string[]>
  /**
   * `(識別字)` → 在原文裡的定義位置查詢（const 初值、for-of 清單、forEach 接收者、each 表格、
   * 含該參數的函式與其呼叫點）。這些只取決於 src 與識別字，與讀取點無關，一次 classify 內共用，
   * 全檔最多對每個不同識別字各掃一次原文。
   */
  lookups?: Map<string, unknown>
}

/** `ctx.lookups` 的記憶化包裝；key 必須含查詢種類與識別字 */
function lookup<T>(ctx: ResolveCtx, key: string, compute: () => T): T {
  const cache = (ctx.lookups ??= new Map<string, unknown>())
  if (cache.has(key)) return cache.get(key) as T
  const value = compute()
  cache.set(key, value)
  return value
}

/** `const ID = <expr>` 的 expr 文字；找不到回 null */
function constInit(src: string, id: string): string | null {
  const re = new RegExp(`(?:const|let|var)\\s+${escapeRe(id)}\\s*(?::[^=;\\n]+)?=\\s*`)
  const m = re.exec(src)
  if (!m) return null
  return scanExpr(src, m.index + m[0].length)
}

function escapeRe(s: string): string {
  return s.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')
}

/** 從 start 掃到運算式結尾（depth 0 的 `;` 或不續行的換行） */
function scanExpr(src: string, start: number): string {
  let j = start
  let depth = 0
  while (j < src.length) {
    const c = src[j]
    if (c === "'" || c === '"') {
      j = skipString(src, j)
      continue
    }
    if (c === '`') {
      j = skipTemplate(src, j)
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break
      depth--
    } else if (depth === 0 && c === ';') break
    else if (depth === 0 && c === '\n') {
      const before = src.slice(start, j).trimEnd().slice(-1)
      const after = src.slice(j).match(/^\s*(\S)/)?.[1] ?? ''
      if (!',+-*/=(&|?:.[{<>'.includes(before) && !'.+?:|&)'.includes(after)) break
    }
    j++
  }
  return src.slice(start, j)
}

function splitParams(params: string): string[] {
  return params
    .split(',')
    .map((p) =>
      p
        .trim()
        .replace(/^\.\.\./, '')
        .split(/[:=]/)[0]
        .trim(),
    )
    .filter(Boolean)
}

/** 含 ID 當參數的函式名 */
function fnsWithParam(src: string, id: string): string[] {
  const names: string[] = []
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
    if (splitParams(m[2]).includes(id)) names.push(m[1])
  }
  for (const m of src.matchAll(
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::[^=]+)?=>/g,
  )) {
    if (splitParams(m[2]).includes(id)) names.push(m[1])
  }
  return names
}

/** 運算式能解出的路徑字面值（追 const、函式參數的呼叫點、for-of／forEach 的清單） */
export function resolveLiterals(expr: string, ctx: ResolveCtx, depth = 4): string[] {
  const memo = (ctx.memo ??= new Map<string, string[]>())
  const key = `${depth}\0${expr}`
  const hit = memo.get(key)
  if (hit) return [...hit]
  // 去重（保留首見順序）：下游只把字面值當集合用（filter 後進 Set／some），不去重的話
  // 同一字面值隨呼叫路徑數成倍堆疊，連 push(...spread) 都會成為熱點
  const out = [...new Set(resolveLiteralsUncached(expr, ctx, depth))]
  memo.set(key, out)
  return [...out]
}

function resolveLiteralsUncached(expr: string, ctx: ResolveCtx, depth: number): string[] {
  const out = literalsIn(expr)
  if (depth <= 0) return out
  for (const id of new Set(identifiersIn(expr))) {
    const init = lookup(ctx, `const\0${id}`, () => constInit(ctx.src, id))
    if (init !== null && init !== expr) {
      out.push(...resolveLiterals(init, ctx, depth - 1))
      continue
    }
    const forOf = lookup(ctx, `forOf\0${id}`, () =>
      new RegExp(
        `for\\s*\\(\\s*(?:const|let)\\s+\\[?\\s*${escapeRe(id)}\\b[^)]*?\\bof\\s+([^)]+)\\)`,
      ).exec(ctx.src),
    )
    if (forOf) {
      out.push(...resolveLiterals(forOf[1], ctx, depth - 1))
      continue
    }
    const each = lookup(ctx, `each\0${id}`, () =>
      new RegExp(
        `([A-Za-z_$][\\w$]*|\\[[^\\]]*\\])\\s*\\.(?:forEach|map|flatMap)\\(\\s*(?:async\\s*)?\\(?\\s*${escapeRe(id)}\\b`,
      ).exec(ctx.src),
    )
    if (each) {
      out.push(...resolveLiterals(each[1], ctx, depth - 1))
      continue
    }
    const itEach = lookup(ctx, `itEach\0${id}`, () =>
      new RegExp(
        `\\.each\\(((?:[^()]|\\([^()]*\\))*)\\)\\s*\\(\\s*(?:'[^']*'|"[^"]*"|\`[^\`]*\`)\\s*,\\s*(?:async\\s*)?\\(?\\s*${escapeRe(id)}\\b`,
      ).exec(ctx.src),
    )
    if (itEach) {
      out.push(...resolveLiterals(itEach[1], ctx, depth - 1))
      continue
    }
    for (const fn of lookup(ctx, `fns\0${id}`, () => fnsWithParam(ctx.src, id))) {
      ctx.viaFns.add(fn)
      for (const args of callArgsOf(ctx, fn)) out.push(...resolveLiterals(args, ctx, depth - 1))
    }
  }
  return out
}

/** 函式 fn 每個呼叫點的引數文字（`fn(` 後到配對括號前） */
function callArgsOf(ctx: ResolveCtx, fn: string): string[] {
  return lookup(ctx, `calls\0${fn}`, () => {
    const all: string[] = []
    for (const call of ctx.src.matchAll(new RegExp(`(?<![\\w$.])${escapeRe(fn)}\\s*\\(`, 'g'))) {
      const open = call.index + call[0].length - 1
      const close = matchBracket(ctx.src, open)
      if (close > open) all.push(ctx.src.slice(open + 1, close))
    }
    return all
  })
}

// ---------------------------------------------------------------------------
// 讀取點與 E 判定

interface ReadSite {
  index: number
  literals: string[]
  vars: string[]
}

const READ_RE =
  /(?<![\w$])(?:(?:fs|fsp|promises|fs\.promises|fsPromises)\s*\.\s*)?(?:readFileSync|readFile)\s*\(/g

function findReadSites(src: string, code: string): ReadSite[] {
  const sites: ReadSite[] = []
  const lookups = new Map<string, unknown>() // 全檔共用：只取決於 src 與識別字
  for (const m of code.matchAll(READ_RE)) {
    const open = m.index + m[0].length - 1
    const close = matchBracket(src, open)
    if (close < 0) continue
    const args = src.slice(open + 1, close)
    // 第一個頂層引數 = 路徑
    const first = firstArg(args)
    const ctx: ResolveCtx = { src, viaFns: new Set(), lookups }
    // 路徑根在 tmpdir／mkdtemp 底下＝讀的是這次測試自己產出的檔，不是 repo 內的原始碼（D 類／執行輸出）
    const literals = derivesFromTmp(first, src, 4) ? [] : resolveLiterals(first, ctx)
    const vars = new Set<string>()
    const lead = src.slice(Math.max(0, m.index - 160), m.index)
    const asg =
      /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:await\s+)?(?:\(\s*)?$/.exec(lead)
    if (asg) vars.add(asg[1])
    for (const fn of ctx.viaFns) {
      for (const a of src.matchAll(
        new RegExp(
          `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:await\\s+)?${escapeRe(fn)}\\s*\\(`,
          'g',
        ),
      )) {
        vars.add(a[1])
      }
    }
    sites.push({ index: m.index, literals, vars: [...vars] })
  }
  return sites
}

function derivesFromTmp(expr: string, src: string, depth: number): boolean {
  if (/\b(?:mkdtemp(?:Sync)?|tmpdir)\b/.test(expr)) return true
  if (depth <= 0) return false
  for (const id of new Set(identifiersIn(expr))) {
    const init = constInit(src, id)
    if (init !== null && init !== expr && derivesFromTmp(init, src, depth - 1)) return true
  }
  return false
}

function firstArg(args: string): string {
  let depth = 0
  let j = 0
  while (j < args.length) {
    const c = args[j]
    if (c === "'" || c === '"') {
      j = skipString(args, j)
      continue
    }
    if (c === '`') {
      j = skipTemplate(args, j)
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) break
    j++
  }
  return args.slice(0, j)
}

function baseOf(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

function segmentsOf(p: string): string[] {
  return p.split(/[\\/]/).filter(Boolean)
}

function stripExt(p: string): string {
  return p.replace(/\?.*$/, '').replace(/\.(?:vue|[cm]?[jt]sx?|md)$/, '')
}

/** 字面路徑是否為 R 範圍的原始碼／文件目標 */
function sourceTarget(literal: string, isIgnored?: (p: string) => boolean): boolean {
  const ext = SOURCE_EXTS.find((e) => literal.endsWith(e))
  if (!ext) return false
  const segs = segmentsOf(literal)
  if ((segs[segs.length - 1] ?? '').length <= ext.length) return false // 純副檔名（`'.ts'`）不是路徑
  if (segs.some((s) => EXCLUDED_SEGMENTS.has(s) || OUTPUT_SEGMENTS.has(s))) return false
  if (isIgnored) {
    const norm = literal.replace(/^(?:\.{1,2}\/)+/, '')
    if (norm && !norm.includes('*') && isIgnored(norm)) return false
  }
  return true
}

interface Imports {
  /** import／require 的 specifier（去 query、去型別 import） */
  specs: string[]
  /** 從非測試庫 import 進來的識別字 */
  fnNames: string[]
}

/** 被 import 的名字真的被「用」：被呼叫、取成員、或當 mount／render／spawn 的引數。`expect(Name)` 不算 */
function usedAsValue(code: string, name: string, execArgs: string[]): boolean {
  const n = escapeRe(name)
  if (new RegExp(`(?<![\\w$.])${n}\\s*(?:\\(|\\.|<)`).test(code)) return true
  const bare = new RegExp(`(?<![\\w$.])${n}(?![\\w$])`)
  return execArgs.some((a) => bare.test(a))
}

function collectImports(src: string, code: string, execArgs: string[]): Imports {
  const specs: string[] = []
  const fnNames = new Set<string>()
  // 結構在 code 上比對；specifier 的字串內容在 code 裡是空白，從原文同位置取回
  const specOf = (m: RegExpMatchArray, len: number) =>
    src.slice(m.index + m[0].length - 1 - len, m.index + m[0].length - 1)
  for (const m of code.matchAll(/import\s+(type\s+)?([^'";]*?)\s*from\s*(['"])( *)\3/g)) {
    if (m[1]) continue
    const spec = specOf(m, m[4].length)
    const names: string[] = []
    for (const part of m[2].replace(/[{}]/g, ',').split(',')) {
      const name = part
        .trim()
        .replace(/^type\s+/, '')
        .replace(/^\*\s+as\s+/, '')
        .split(/\s+as\s+/)
        .pop()
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.push(name)
    }
    // 只 import 不用（`import Shell from …` 後只剩 `expect(Shell).toBeTruthy()`）不算被執行
    if (names.some((n) => usedAsValue(code, n, execArgs))) specs.push(spec.replace(/\?.*$/, ''))
    if (TEST_LIB_SPEC.test(spec)) continue
    for (const name of names) fnNames.add(name)
  }
  for (const m of code.matchAll(/(?:import|require)\s*\(\s*(['"])( *)\1\s*\)/g)) {
    const at = m.index + m[0].indexOf(m[1]) + 1
    specs.push(src.slice(at, at + m[2].length).replace(/\?.*$/, ''))
  }
  for (const m of code.matchAll(/import\s+(['"])( *)\1/g)) {
    const at = m.index + m[0].indexOf(m[1]) + 1
    specs.push(src.slice(at, at + m[2].length).replace(/\?.*$/, ''))
  }
  return { specs, fnNames: [...fnNames] }
}

function execCallArgs(src: string, code: string): string[] {
  const out: string[] = []
  for (const m of code.matchAll(EXEC_CALL)) {
    if (src[m.index - 1] === '.' && /^(?:exec)$/.test(m[0].replace(/\s*\($/, ''))) {
      // `regex.exec(` 不是子行程；`child_process.exec(` 難區分，保守當 regex.exec 排除
      continue
    }
    const open = m.index + m[0].length - 1
    const close = matchBracket(src, open)
    if (close > open) out.push(src.slice(open + 1, close))
  }
  return out
}

/** fs／path 的 API 名：不論從哪個套件 import（fs-extra、pathe…），都不是被測函式 */
const FS_PATH_API = new Set([
  'readFile',
  'readFileSync',
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'copy',
  'copySync',
  'mkdir',
  'mkdirSync',
  'mkdtemp',
  'mkdtempSync',
  'readdir',
  'readdirSync',
  'rm',
  'rmSync',
  'existsSync',
  'stat',
  'statSync',
  'outputFile',
  'outputFileSync',
  'ensureDir',
  'ensureDirSync',
  'readJson',
  'readJsonSync',
  'join',
  'resolve',
  'dirname',
  'basename',
  'relative',
  'normalize',
])

/** index 所在的 it／test 呼叫的結尾；不在任何 it／test 內就到檔尾 */
function enclosingTestEnd(src: string, code: string, index: number): number {
  let end = code.length
  for (const m of code.matchAll(/(?<![\w$.])(?:it|test)\s*(?:\.\s*\w+\s*)?\(/g)) {
    if (m.index >= index) break
    const close = matchBracket(src, m.index + m[0].length - 1)
    if (close > index) end = close
  }
  return end
}

function siteIsExecuted(
  site: ReadSite,
  src: string,
  code: string,
  imports: Imports,
  execArgs: string[],
): boolean {
  const targets = site.literals.filter((l) => SOURCE_EXTS.some((e) => l.endsWith(e)))
  for (const t of targets) {
    const segs = segmentsOf(stripExt(t))
    const base = segs[segs.length - 1] ?? ''
    const key = base === 'index' && segs.length > 1 ? `${segs[segs.length - 2]}/index` : base
    if (!key) continue
    for (const spec of imports.specs) {
      const s = stripExt(spec)
      if (s === key || s.endsWith(`/${key}`)) return true
    }
    for (const args of execArgs) if (args.includes(baseOf(t)) || args.includes(key)) return true
  }
  const passedToImportedFn = (id: string, from = 0, to = code.length, skip = new Set<string>()) => {
    const idRe = new RegExp(`(?<![\\w$.])${escapeRe(id)}(?![\\w$])`)
    for (const fn of imports.fnNames) {
      if (fn === id || skip.has(fn)) continue
      for (const call of code.matchAll(new RegExp(`(?<![\\w$.])${escapeRe(fn)}\\s*\\(`, 'g'))) {
        if (call.index < from || call.index >= to) continue
        const open = call.index + call[0].length - 1
        const close = matchBracket(src, open)
        if (close > open && idRe.test(code.slice(open + 1, close))) return true
      }
    }
    return false
  }
  // 讀進的文字變數傳給 import 進來的非測試函式
  if (site.vars.some((v) => passedToImportedFn(v))) return true
  // 讀進的文字寫進某目錄、同一個 it／test 裡接著把該目錄交給 import 進來的非測試函式
  // （複製當輸入，斷言的是處理後的產出）。寫入目標裡被呼叫的名字是路徑 helper（join 等），不算被測函式
  for (const w of code.matchAll(
    /(?<![\w$])(?:(?:fs|fsp|promises|fs\.promises|fsPromises)\s*\.\s*)?(?:writeFileSync|writeFile)\s*\(/g,
  )) {
    const open = w.index + w[0].length - 1
    const close = matchBracket(src, open)
    if (close < open) continue
    const target = firstArg(src.slice(open + 1, close))
    const content = code.slice(open + 1 + target.length, close)
    const carries =
      (site.index > open + target.length && site.index < close) ||
      site.vars.some((v) => new RegExp(`(?<![\\w$.])${escapeRe(v)}(?![\\w$])`).test(content))
    if (!carries) continue
    const helpers = new Set([
      ...FS_PATH_API,
      ...[...target.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]),
    ])
    const roots = identifiersIn(target).filter((id) => !helpers.has(id))
    const blockEnd = enclosingTestEnd(src, code, w.index)
    if (roots.some((id) => passedToImportedFn(id, close, blockEnd, helpers))) return true
  }
  // 路徑常數本身被傳進 exec／mount（`spawnSync('node', [SCRIPT])` 形狀）
  const ctxIds = new Set<string>()
  for (const m of code.matchAll(READ_RE)) {
    if (m.index !== site.index) continue
    const open = m.index + m[0].length - 1
    const close = matchBracket(src, open)
    if (close > open)
      for (const id of identifiersIn(firstArg(src.slice(open + 1, close)))) ctxIds.add(id)
  }
  for (const id of ctxIds) {
    const idRe = new RegExp(`(?<![\\w$.])${escapeRe(id)}(?![\\w$])`)
    if (execArgs.some((a) => idRe.test(a))) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// 斷言計數

/** 斷言主體（被比對的那個值）在 src 的範圍 [from, to) 是否走行為通道 */
type SubjectOf = (from: number, to: number) => boolean

export function countAssertions(
  src: string,
  code = maskStrings(src),
  isBehavior: SubjectOf = () => false,
): { count: number; lines: number[] } {
  const lines: number[] = []
  // expect(…) 的引數範圍，供 `.toContain(` 往回找它掛在哪個 expect 上
  const expects: [number, number][] = []
  for (const m of code.matchAll(/(?<![\w$.])expect\s*(?:\.\s*(?:soft|poll)\s*)?\(/g)) {
    const open = m.index + m[0].length - 1
    const close = matchBracket(src, open)
    if (close > open) expects.push([open, close])
  }
  for (const m of code.matchAll(/\.\s*(?:toContain|toMatch)\s*\(/g)) {
    let subject: [number, number] | null = null
    for (const [open, close] of expects) {
      if (close >= m.index) break
      if (/^\s*(?:\.\s*(?:not|resolves|rejects)\s*)*$/.test(code.slice(close + 1, m.index))) {
        subject = [open + 1, close]
      }
    }
    if (subject && isBehavior(subject[0], subject[1])) continue
    lines.push(lineOf(src, m.index))
  }
  for (const m of code.matchAll(/\bassert\s*\.\s*(?:match|doesNotMatch)\s*\(/g)) {
    const open = m.index + m[0].length - 1
    const close = matchBracket(src, open)
    if (close > open) {
      const first = firstArg(src.slice(open + 1, close))
      if (isBehavior(open + 1, open + 1 + first.length)) continue
    }
    lines.push(lineOf(src, m.index))
  }
  // assert.ok(…includes…)／expect(…includes／match／test…)：同一種字串斷言換個寫法
  for (const m of code.matchAll(/(?<![\w$.])(?:assert\s*\.\s*ok|assert|expect)\s*\(/g)) {
    const open = m.index + m[0].length - 1
    const close = matchBracket(src, open)
    if (
      close > open &&
      /\.\s*(?:includes|match|matchAll|test|indexOf)\s*\(/.test(code.slice(open + 1, close)) &&
      !isBehavior(open + 1, close)
    ) {
      lines.push(lineOf(src, m.index))
    }
  }
  lines.sort((a, b) => a - b)
  return { count: lines.length, lines }
}

const IDENT_G = /[A-Za-z_$][\w$]*/g
// 後面接 `(…) {` 時括號內不是參數的關鍵字（catch 不在此列：`catch (e) {` 的 e 是綁定）
const NON_PARAM_PAREN = new Set(['if', 'for', 'while', 'switch', 'with', 'else', 'return'])

/** 一個名字的綁定及其作用範圍 [from, to)；decl 非 null＝認得的 `const x = <init>` 宣告 */
interface Binding {
  name: string
  from: number
  to: number
  decl: Decl | null
}

/** 認得的宣告（`const x = <init>`）；ok＝init 走行為通道且名字沒被重新賦值 */
interface Decl {
  names: string[]
  from: number
  to: number
  tainted: boolean
  ok: boolean
}

interface Rebinding {
  /** 認不得來歷的綁定（參數、for-of、catch、沒有初始值的宣告、function／class／import 名…） */
  binds: Binding[]
  /** 賦值（含複合、解構、for-of 不帶宣告字）：既污染它落在的宣告，也保守地當同區塊的遮蔽 */
  assigns: { name: string; at: number }[]
}

/** 所有 `{…}` 區塊範圍 [open, close]；配不上的 `{` 到檔尾 */
function blockRanges(code: string): [number, number][] {
  const out: [number, number][] = []
  const stack: number[] = []
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') stack.push(i)
    else if (code[i] === '}') {
      const open = stack.pop()
      if (open !== undefined) out.push([open, i])
    }
  }
  for (const open of stack) out.push([open, code.length])
  return out
}

/**
 * 檔內「認不得來歷」的綁定，各帶作用範圍：函式／箭頭函式參數（範圍＝參數列到函式本體結尾）、
 * catch 參數、for 標頭裡的宣告（範圍＝整個 for 敘述）、沒有（被認得的）初始值的宣告與巢狀解構
 * （範圍＝所在區塊）、function／class 名（所在區塊）、import 名（整檔）。賦值（`x = …`、`x += …`、
 * `x ??= …`、解構賦值、不帶宣告字的 for-of）另列：它污染落在其範圍內的宣告，並保守地當所在區塊的遮蔽
 * （多宣告子的後段 `const a = 1, b = 2` 的 `b = ` 長得就像賦值）。
 * 保守偏誤：寧可多收（誤把使用當綁定只會讓該名字在那個範圍回到「照算 P」），不可漏收。
 */
function reboundNames(code: string, known: [number, number][]): Rebinding {
  const binds: Binding[] = []
  const assigns: { name: string; at: number }[] = []
  const blocks = blockRanges(code)
  const inKnown = (i: number) => known.some(([s, e]) => i >= s && i < e)
  /** i 所在的最內層區塊；沒有就是整檔 */
  const blockAt = (i: number): [number, number] => {
    let best: [number, number] = [0, code.length]
    for (const b of blocks) if (b[0] < i && i < b[1] && b[1] - b[0] < best[1] - best[0]) best = b
    return best
  }
  const bind = (names: Iterable<string>, from: number, to: number) => {
    for (const name of names) binds.push({ name, from, to, decl: null })
  }
  const idsOf = (text: string) => [...text.matchAll(IDENT_G)].map((m) => m[0])
  // 沒有（被認得的）初始值的宣告：`for (const x of …)`、`let x;`、巢狀解構
  for (const m of code.matchAll(/\b(?:const|let|var)\s+(?=[\w${[])/g)) {
    const at = m.index + m[0].length
    if (inKnown(at)) continue
    let names: string[]
    if (code[at] === '{' || code[at] === '[') {
      const close = matchBracket(code, at)
      names = idsOf(close > at ? code.slice(at, close + 1) : code.slice(at, at + 80))
    } else names = idsOf(/^[\w$]+/.exec(code.slice(at))?.[0] ?? '')
    // for 標頭裡的宣告只活在那條 for 敘述內
    const head = /\bfor\s*(?:await\s*)?\(\s*$/.exec(code.slice(Math.max(0, m.index - 40), m.index))
    if (head) {
      const paren = m.index - (head[0].length - head[0].indexOf('('))
      const close = matchBracket(code, paren)
      const body = close > 0 ? /^\s*\{/.exec(code.slice(close + 1)) : null
      const end = body ? matchBracket(code, close + 1 + body[0].length - 1) : -1
      bind(names, paren, end > 0 ? end + 1 : blockAt(paren)[1])
    } else {
      const [start, end] = blockAt(at)
      bind(names, start, end)
    }
  }
  // 賦值：`x = …`、`x += …`、`x ??= …`（宣告子的 `=` 由 known 排除；比較運算 `>=`／`<=` 多收無妨）
  for (const m of code.matchAll(
    /(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:\*\*|\?\?|\|\||&&|<<|>>>?|[-+*/%&|^<>])?=(?![=>])/g,
  )) {
    if (!inKnown(m.index)) assigns.push({ name: m[1], at: m.index })
  }
  // 解構賦值：`[a, html] = …`、`({ html } = …)`
  for (const m of code.matchAll(/[[{]/g)) {
    if (inKnown(m.index)) continue
    const close = matchBracket(code, m.index)
    if (close > m.index && /^\s*=(?![=>])/.test(code.slice(close + 1, close + 8))) {
      for (const id of code.slice(m.index, close + 1).matchAll(IDENT_G)) {
        assigns.push({ name: id[0], at: m.index + id.index })
      }
    }
  }
  // 參數：`(…) =>`、`(…): T =>`、`function (…) {`、方法 `name(…) {`、`catch (…) {`；以及 `x =>`
  for (const m of code.matchAll(/\(/g)) {
    const close = matchBracket(code, m.index)
    if (close < 0) continue
    const tail = code.slice(close + 1)
    const arrow = /^\s*(?::[^;{}=()]*)?=>/.exec(tail)
    const block = /^\s*(?::[^;{}=()]*)?\{/.exec(tail)
    if (!arrow && !block) continue
    if (!arrow) {
      const prev = /([\w$]+)\s*$/.exec(code.slice(Math.max(0, m.index - 40), m.index))?.[1]
      if (prev === undefined || NON_PARAM_PAREN.has(prev)) continue
    }
    bind(idsOf(code.slice(m.index, close + 1)), m.index, bodyEnd(code, close + 1, arrow, block))
  }
  for (const m of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) {
    bind([m[1]], m.index, bodyEnd(code, m.index, /^[^=]*=>/.exec(code.slice(m.index)), null))
  }
  // `for (x of …)`（沒有 const/let/var 的 for-of／for-in）：賦值給既有綁定
  for (const m of code.matchAll(/\bfor\s*(?:await\s*)?\(\s*([A-Za-z_$][\w$]*)\s+(?:of|in)\b/g)) {
    assigns.push({ name: m[1], at: m.index })
  }
  for (const m of code.matchAll(/\b(?:function\s*\*?|class)\s*([A-Za-z_$][\w$]*)/g)) {
    const [start, end] = blockAt(m.index)
    bind([m[1]], start, end)
  }
  for (const m of code.matchAll(/\bimport\b([^;]*?)\bfrom\b/g)) bind(idsOf(m[1]), 0, code.length)
  return { binds, assigns }
}

/** 函式本體結尾：arrow／block 是 `tail` 起點（`)` 之後）的比對結果 */
function bodyEnd(
  code: string,
  tailFrom: number,
  arrow: RegExpExecArray | null,
  block: RegExpExecArray | null,
): number {
  const hit = arrow ?? block
  if (!hit) return code.length
  const at = tailFrom + hit[0].length
  if (code[at - 1] === '{') {
    const close = matchBracket(code, at - 1)
    return close > 0 ? close + 1 : code.length
  }
  // arrow 後面接 `{`（可能隔空白）＝區塊本體；否則是單一運算式
  const rest = /^\s*/.exec(code.slice(at))![0].length
  if (code[at + rest] === '{') {
    const close = matchBracket(code, at + rest)
    return close > 0 ? close + 1 : code.length
  }
  return at + rest + scanExpr(code, at + rest).length
}

/**
 * 斷言主體走行為通道：主體裡有 mount／render／spawn／exec 或 import 進來的非測試函式的呼叫，
 * 或引用了由這類呼叫（經 const 一路傳下來）得到的變數。`expect(wrapper.text()).toContain(…)`、
 * `assert.match(r.stdout, …)` 釘的是執行結果，不是原文，不算 P 類斷言。
 * 判不出（主體是讀進的原文、或來源不明的變數）一律照算，不放水；含讀取點的運算式永遠不算行為通道。
 */
function behaviorSubject(src: string, code: string, imports: Imports): SubjectOf {
  const fns = imports.fnNames.filter((f) => !FS_PATH_API.has(f))
  const callRe = new RegExp(
    `(?<![\\w$.])(?:${[...EXEC_NAMES, ...fns.map(escapeRe)].join('|')})\\s*(?:<[^>()]*>\\s*)?\\(`,
  )
  const decls: Decl[] = []
  // 認得的宣告其「綁定樣式」所在範圍（供 closed-world 掃描略過自己）
  const known: [number, number][] = []
  for (const m of code.matchAll(
    /(?:const|let|var)\s+(\{[^}=]*\}|\[[^\]=]*\]|[A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=(?![=>])\s*/dg,
  )) {
    const from = m.index + m[0].length
    const to = from + scanExpr(src, from).length
    const names = [...m[1].matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0])
    decls.push({ names, from, to, tainted: false, ok: false })
    const [ps, pe] = m.indices![1]
    known.push([ps, pe])
  }
  const { binds: unknown, assigns } = reboundNames(code, known)
  // 作用域：名字在斷言位置解到「最內層、涵蓋該位置」的綁定；解到的全是 ok 的認得宣告才算行為通道。
  // 名字依位置解到最內層 binding，避免別處 callback 參數讓同名宣告失格
  const blocks = blockRanges(code)
  const blockAt = (i: number): [number, number] => {
    let best: [number, number] = [0, code.length]
    for (const b of blocks) if (b[0] < i && i < b[1] && b[1] - b[0] < best[1] - best[0]) best = b
    return best
  }
  const bindings: Binding[] = []
  const declared: Binding[] = []
  decls.forEach((d, k) => {
    const hoisted = /\bvar\s+$/.test(code.slice(Math.max(0, known[k][0] - 12), known[k][0]))
    const [start, end] = blockAt(known[k][0])
    for (const name of d.names) {
      declared.push({ name, from: start, to: end, decl: d })
      // var 提升到函式範圍，區塊近似不可信：區塊外的使用保守照算 P
      if (hoisted) bindings.push({ name, from: 0, to: code.length, decl: null })
    }
  })
  // 認得的宣告：範圍 = 宣告所在區塊（含宣告之前，TDZ 不細分）
  bindings.push(...declared, ...unknown)
  for (const a of assigns)
    bindings.push({ name: a.name, ...scopeOfAssign(blockAt, a.at), decl: null })
  const resolve = (name: string, at: number): Binding[] => {
    let best: Binding[] = []
    let size = Infinity
    for (const b of bindings) {
      if (b.name !== name || at < b.from || at >= b.to) continue
      const s = b.to - b.from
      if (s < size) {
        best = [b]
        size = s
      } else if (s === size) best.push(b)
    }
    return best
  }
  // 賦值污染它落在的宣告：只看「認得的宣告與認不得的綁定」，不看賦值自己造的遮蔽
  for (const a of assigns) {
    let best: Binding[] = []
    let size = Infinity
    for (const b of [...declared, ...unknown]) {
      if (b.name !== a.name || a.at < b.from || a.at >= b.to) continue
      const s = b.to - b.from
      if (s < size) {
        best = [b]
        size = s
      } else if (s === size) best.push(b)
    }
    for (const b of best) if (b.decl) b.decl.tainted = true
  }
  const readRe = new RegExp(READ_RE.source)
  const isVar = (id: string, at: number) => {
    const hit = resolve(id, at)
    return hit.length > 0 && hit.every((b) => b.decl !== null && b.decl.ok)
  }
  const hits = (from: number, to: number) => {
    const body = code.slice(from, to)
    // 讀取點本身（`readFileSync(repoPath('x.vue'))` 的路徑 helper 也是 import 進來的）＝原文，不是行為產出
    if (readRe.test(body)) return false
    if (callRe.test(body)) return true
    return identifierSpans(src.slice(from, to)).some((s) => isVar(s.id, from + s.at))
  }
  // closed-world：宣告要「init 走行為通道且名字沒被重新賦值」才 ok；認不得的綁定形式（參數、for-of、
  // catch、重新賦值…，見 reboundNames）解到的名字不是 ok 宣告，帶它的斷言照算 P。
  // NEVER 在這裡逐一補綁定形式：新形式進 reboundNames 的偵測面，不進這個迴圈
  for (let round = 0, grew = true; grew && round < 6; round++) {
    grew = false
    for (const d of decls) {
      if (d.ok || d.tainted || !hits(d.from, d.to)) continue
      d.ok = true
      grew = true
    }
  }
  return hits
}

/** 賦值保守當所在區塊的遮蔽 */
function scopeOfAssign(
  blockAt: (i: number) => [number, number],
  at: number,
): { from: number; to: number } {
  const [from, to] = blockAt(at)
  return { from, to }
}

// ---------------------------------------------------------------------------
// 檔層判定

export interface Classification {
  /** p＝P 類；mixed＝同檔有 E 讀取點又有 P 讀取點；none＝不是 */
  kind: 'p' | 'mixed' | 'none'
  assertions: number
  assertionLines: number[]
  /** P 讀取點的字面目標（診斷用） */
  targets: string[]
  /** 有讀取點的路徑解得出原始碼目標（不論被讀的檔是否同時被執行） */
  hasSourceRead: boolean
}

export function classify(
  rawSrc: string,
  path: string,
  opts: { isIgnored?: (p: string) => boolean } = {},
): Classification {
  const none: Classification = {
    kind: 'none',
    assertions: 0,
    assertionLines: [],
    targets: [],
    hasSourceRead: false,
  }
  if (!isTestPath(path)) return none
  if (segmentsOf(path).some((s) => EXCLUDED_SEGMENTS.has(s))) return none
  const src = stripComments(rawSrc)
  const code = maskStrings(src)
  const sites = findReadSites(src, code)
  if (sites.length === 0) return none
  const execArgs = execCallArgs(src, code)
  const imports = collectImports(src, code, execArgs)
  // 只算釘原文的字串斷言：主體是 mount／spawn／被測函式產出的斷言是行為斷言，不進 delta
  const a = countAssertions(src, code, behaviorSubject(src, code, imports))
  if (a.count === 0) return none
  const pTargets: string[] = []
  let eSites = 0
  // 測試自己建 tmp 目錄＝多半在驗產出物；只剩單一檔名的目標（`join(dir, 'README.md')`）判不出根在哪，不算 P
  const usesTmp = /\b(?:mkdtemp(?:Sync)?|tmpdir)\b/.test(code)
  for (const site of sites) {
    const hits = site.literals.filter(
      (l) => sourceTarget(l, opts.isIgnored) && !(usesTmp && segmentsOf(l).length <= 1),
    )
    if (hits.length === 0) continue
    if (siteIsExecuted(site, src, code, imports, execArgs)) eSites++
    else pTargets.push(...hits)
  }
  if (pTargets.length === 0 && eSites === 0) {
    return { ...none, assertions: a.count, assertionLines: a.lines }
  }
  if (pTargets.length === 0) {
    return {
      ...none,
      assertions: a.count,
      assertionLines: a.lines,
      hasSourceRead: true,
    }
  }
  return {
    kind: eSites > 0 ? 'mixed' : 'p',
    assertions: a.count,
    assertionLines: a.lines,
    targets: [...new Set(pTargets)],
    hasSourceRead: true,
  }
}

// ---------------------------------------------------------------------------
// 逃生口 marker：檔首 10 行 `clade-source-assert: <code> — <reason>`

export type Marker =
  | { status: 'none' }
  | { status: 'valid'; code: MarkerCode; reason: string }
  | { status: 'invalid'; detail: string }

export function parseMarker(rawSrc: string): Marker {
  const head = rawSrc.split('\n').slice(0, 10)
  for (const line of head) {
    const m = /clade-source-assert:\s*(.*)$/.exec(line)
    if (!m) continue
    const rest = m[1].replace(/\*\/\s*$/, '').trim()
    const parts = /^([^\s—–]+)\s*(?:[—–]|--|-)?\s*(.*)$/.exec(rest)
    const code = parts?.[1] ?? ''
    const reason = (parts?.[2] ?? '').trim()
    if (!(MARKER_CODES as readonly string[]).includes(code)) {
      return {
        status: 'invalid',
        detail: `marker code「${code}」不在列舉（${MARKER_CODES.join('｜')}）`,
      }
    }
    if (!reason) return { status: 'invalid', detail: 'marker reason 是空的' }
    return { status: 'valid', code: code as MarkerCode, reason }
  }
  return { status: 'none' }
}
