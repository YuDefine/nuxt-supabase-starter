// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/mutation-probe/test-cases.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/mutation-probe/test-cases.ts
// CLADE:VENDOR-SCRIPT
//
// mutation-probe/test-cases — 列出一個測試檔的 test case 完整名稱
//
// 契約：specs/truth/data/break-receipt.md § 被刪 test case 的身分。
// 名稱 = `test(`／`it(` 的字串名稱，外層 `describe`（及 node:test 的 `t.test` 子測試）巢狀前綴以 ` > ` 串接。
// 刪除／合併測試閘門與 `revive` 共用。
//
// 判不出名稱（名稱是變數、含表達式的樣板字串、`.each` 表、`describe` 的 callback 不是函式字面量、
// 語法解析有錯、讀不到 `typescript`）→ `indeterminate=true`：閘門對該檔要求整檔 `(file,"*")` 的收據
// 或豁免，**NEVER** 因判不出而放行。名稱判不出的 case 不進 `names`。
//
// 辨認：`test`／`it`／`describe`／`suite` 與其 import 別名（`node:test`、`vitest` 等 named／default import），
// 加 `.skip` `.only` `.todo` `.concurrent` `.sequential` `.fails` `.failing` 修飾；`.skipIf(c)(…)` `.runIf(c)(…)`
// 這類 curried 形式；node:test 子測試 `t.test(…)`（`t` 為外層 test callback 的第一個參數名）。
//
// 由 ~/clade vendor/scripts/lib/ 散播，請勿直接編輯 consumer 副本。

import { extname } from 'node:path'

import { loadTypescript } from './mutation.ts'

export interface IndeterminateSite {
  /** 1 起算；整檔判不出（解析失敗等）為 0。 */
  line: number
  reason: string
}

export interface TestCaseListing {
  /** 名稱判得出的 test case 完整名稱，依原始碼出現順序，重複的名稱重複列（多重集合）。 */
  names: string[]
  indeterminate: boolean
  sites: IndeterminateSite[]
}

const ROOT_NAMES = ['test', 'it', 'describe', 'suite'] as const
const SUITE_ROOTS = new Set(['describe', 'suite'])
/** 直接修飾、之後仍是 `(name, fn)` 呼叫。 */
const PLAIN_MODIFIERS = new Set([
  'skip',
  'only',
  'todo',
  'concurrent',
  'sequential',
  'fails',
  'failing',
])
/** 先呼叫一次、再呼叫 `(name, fn)`；名稱仍是靜態字串。 */
const CURRIED_STATIC = new Set(['skipIf', 'runIf'])
/** 先呼叫一次、再呼叫 `(name, fn)`；名稱是範本、實際名稱由資料表展開 → 判不出。 */
const CURRIED_DYNAMIC = new Set(['each', 'for'])
const TEST_MODULES = new Set([
  'node:test',
  'test',
  'vitest',
  'bun:test',
  'vite-plus/test',
  'vite-plus',
])

export function listTestCases(source: string, fileName: string): TestCaseListing {
  const ts = loadTypescript()
  const fail = (reason: string): TestCaseListing => ({
    names: [],
    indeterminate: true,
    sites: [{ line: 0, reason }],
  })
  if (!ts) return fail('typescript-unavailable')
  const kind = scriptKind(ts, fileName)
  if (kind === null) return fail('unsupported-extension')

  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)
  const diagnostics = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []
  if (diagnostics.length > 0) return fail('parse-error')

  // import 別名：`import { it as spec } from 'vitest'`、`import test from 'node:test'`
  const aliases = new Map<string, string>()
  for (const r of ROOT_NAMES) aliases.set(r, r)
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    if (!TEST_MODULES.has(stmt.moduleSpecifier.text)) continue
    const clause = stmt.importClause
    if (!clause) continue
    if (clause.name && stmt.moduleSpecifier.text === 'node:test')
      aliases.set(clause.name.text, 'test')
    const named = clause.namedBindings
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        const imported = (el.propertyName ?? el.name).text
        if ((ROOT_NAMES as readonly string[]).includes(imported))
          aliases.set(el.name.text, imported)
      }
    }
  }

  const names: string[] = []
  const sites: IndeterminateSite[] = []
  const lineOf = (n: import('typescript').Node) =>
    sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1

  interface Frame {
    /** 外層名稱前綴；`null` 表示前綴已判不出（後代 case 一律 indeterminate）。 */
    prefix: string[] | null
    /** 這一層 test callback 的第一個參數名（node:test 的 `t`）。 */
    ctxName: string | null
  }

  /** 把 call 的 callee 解析成 { root, curried-dynamic?, 是否 describe }；不是測試呼叫回 null。 */
  const classify = (
    callee: import('typescript').Expression,
    ctxNames: string[],
  ): { suite: boolean; dynamic: boolean } | null => {
    let expr = callee
    let curried = false
    let dynamic = false
    // tagged-template 表格：`it.each\`…\`('name', fn)`、`test.skip.each\`…\``、`describe.each.only\`…\``
    // callee 是 TaggedTemplateExpression，tag 是 `<root>(.<修飾>)*.each|for(.<修飾>)*`；名稱是範本、case 數由表格決定 → 判不出
    if (ts.isTaggedTemplateExpression(expr)) {
      let tag: import('typescript').Expression = expr.tag
      let sawEach = false
      while (
        ts.isPropertyAccessExpression(tag) &&
        (PLAIN_MODIFIERS.has(tag.name.text) || CURRIED_DYNAMIC.has(tag.name.text))
      ) {
        if (CURRIED_DYNAMIC.has(tag.name.text)) sawEach = true
        tag = tag.expression
      }
      if (!sawEach || !ts.isIdentifier(tag)) return null
      const root = aliases.get(tag.text)
      if (!root) return null
      return { suite: SUITE_ROOTS.has(root), dynamic: true }
    }
    // `.skipIf(c)(…)`：callee 是 CallExpression，其 callee 是 `<root>.skipIf`
    if (ts.isCallExpression(expr)) {
      const inner = expr.expression
      if (!ts.isPropertyAccessExpression(inner)) return null
      const mod = inner.name.text
      if (CURRIED_STATIC.has(mod)) curried = true
      else if (CURRIED_DYNAMIC.has(mod)) {
        curried = true
        dynamic = true
      } else return null
      expr = inner.expression
    }
    // 剝修飾：`test.skip` `it.only.skip`
    while (
      ts.isPropertyAccessExpression(expr) &&
      PLAIN_MODIFIERS.has(expr.name.text) &&
      (ts.isIdentifier(expr.expression) || ts.isPropertyAccessExpression(expr.expression))
    ) {
      expr = expr.expression
    }
    if (ts.isIdentifier(expr)) {
      const root = aliases.get(expr.text)
      if (!root) return null
      return { suite: SUITE_ROOTS.has(root), dynamic }
    }
    // `.each(table)` 以 `test.each` 形式直接當 callee 之前已被上面處理；這裡處理 `t.test(…)` 子測試
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
      const base = expr.expression.text
      const member = expr.name.text
      if (
        !curried &&
        ctxNames.includes(base) &&
        (ROOT_NAMES as readonly string[]).includes(member)
      ) {
        return { suite: SUITE_ROOTS.has(member), dynamic: false }
      }
      // `test.each(table)` 直接被呼叫（node:test 沒有、vitest 的 `test.each(table)(name, fn)` 由上面 curried 處理）
    }
    return null
  }

  /** 第一個引數 → 靜態名稱或 null（含原因）。 */
  const staticName = (
    arg: import('typescript').Expression | undefined,
  ): { name: string | null; why: string } => {
    if (!arg) return { name: null, why: 'no-name-argument' }
    const fold = (e: import('typescript').Expression): string | null => {
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
      if (ts.isParenthesizedExpression(e)) return fold(e.expression)
      if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const l = fold(e.left)
        const r = fold(e.right)
        return l !== null && r !== null ? l + r : null
      }
      return null
    }
    const folded = fold(arg)
    if (folded !== null) return { name: folded, why: '' }
    if (ts.isObjectLiteralExpression(arg)) {
      for (const p of arg.properties) {
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'name') {
          const f = fold(p.initializer)
          return f !== null ? { name: f, why: '' } : { name: null, why: 'name-not-static' }
        }
      }
      return { name: null, why: 'anonymous-options-only' }
    }
    if (ts.isTemplateExpression(arg)) return { name: null, why: 'template-with-expression' }
    return { name: null, why: 'name-not-static' }
  }

  const callbackOf = (
    args: readonly import('typescript').Expression[],
  ): import('typescript').FunctionLikeDeclaration | null => {
    for (let i = args.length - 1; i >= 0; i--) {
      const a = args[i]
      if (ts.isFunctionExpression(a) || ts.isArrowFunction(a)) return a
    }
    return null
  }

  const visit = (node: import('typescript').Node, frames: Frame[]): void => {
    if (ts.isCallExpression(node)) {
      const top = frames[frames.length - 1]
      const ctxNames = frames.map((f) => f.ctxName).filter((n): n is string => n !== null)
      const c = classify(node.expression, ctxNames)
      if (c) {
        const args = node.arguments
        const nameArg = args[0] && !isFunctionNode(ts, args[0]) ? args[0] : undefined
        const named = staticName(nameArg)
        const cb = callbackOf(args)
        let childPrefix: string[] | null = null

        if (c.dynamic) {
          sites.push({ line: lineOf(node), reason: 'each-table' })
        } else if (named.name === null) {
          sites.push({ line: lineOf(node), reason: named.why })
        } else if (top.prefix === null) {
          sites.push({ line: lineOf(node), reason: 'parent-name-unknown' })
        }

        if (!c.dynamic && named.name !== null && top.prefix !== null) {
          childPrefix = [...top.prefix, named.name]
          if (!c.suite) names.push(childPrefix.join(' > '))
        }
        if (c.suite && !cb && args.length > 0) {
          sites.push({ line: lineOf(node), reason: 'describe-callback-not-literal' })
        }

        // 往 callback 內走：describe 一定走；test 也走（node:test 子測試）。
        for (const a of args) {
          if (cb && a === cb) {
            const first = cb.parameters[0]
            const ctx = first && ts.isIdentifier(first.name) && !c.suite ? first.name.text : null
            visit(cb.body, [...frames, { prefix: childPrefix, ctxName: ctx }])
          } else {
            visit(a, frames)
          }
        }
        // callee 內（`test.skipIf(cond)` 的 cond）也要走一遍，但不會是測試呼叫
        ts.forEachChild(node.expression, (n) => visit(n, frames))
        return
      }
    }
    ts.forEachChild(node, (n) => visit(n, frames))
  }

  visit(sf, [{ prefix: [], ctxName: null }])
  return { names, indeterminate: sites.length > 0, sites }
}

function isFunctionNode(ts: typeof import('typescript'), n: import('typescript').Node): boolean {
  return ts.isFunctionExpression(n) || ts.isArrowFunction(n)
}

function scriptKind(ts: typeof import('typescript'), file: string) {
  switch (extname(file)) {
    case '.ts':
    case '.mts':
    case '.cts':
      return ts.ScriptKind.TS
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS
    case '.jsx':
      return ts.ScriptKind.JSX
    default:
      return null
  }
}

/**
 * base 有、head 沒有的名稱（多重集合差：base 兩個 `x`、head 一個 `x` → 少一個 `x`）。
 * 改名視同刪一支、加一支，所以舊名稱會出現在回傳裡。
 */
export function deletedCaseNames(base: readonly string[], head: readonly string[]): string[] {
  const remaining = new Map<string, number>()
  for (const n of head) remaining.set(n, (remaining.get(n) ?? 0) + 1)
  const deleted: string[] = []
  for (const n of base) {
    const left = remaining.get(n) ?? 0
    if (left > 0) remaining.set(n, left - 1)
    else deleted.push(n)
  }
  return deleted
}
