// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/mutation-probe/revive.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/mutation-probe/revive.ts
// CLADE:VENDOR-SCRIPT
//
// mutation-probe/revive — skip 復活驗證（`revive` 子指令）與 skip 標記解析
//
// 契約：specs/truth/contracts/mutation-probe-cli.md § 4（復活驗證）、§ 突變的套用機制；
//       skip 標記格式見 specs/plans/W-2026-10-24-test-trust-enforcement/system-analysis.md § 介面 4（FR-015、FR-016）。
//
// 分工：
//   - `parseSkipMarker`、`findSkipSites`：skip 標記與 skip 形狀的辨認（`typescript` AST，不用 regex 認 skip）。
//     skip 閘門（T050）也需要同一份辨認，所以從這裡匯出，不另寫第二份。
//   - `runRevive`：對每個帶 `revive=auto` 的 skip，以 Runner 介面（同 `run`）把該 skip 的條件在載入時換掉
//     （`{ skip: X }` → `{ skip: false }`、`test.skip(` → `test(`、`.skipIf(X)` → `.skipIf(false)`、
//     `if (X) { t.skip(…); return }` → `if (false) …`、其餘 `t.skip(…)` → 空操作），各跑一趟新行程。這是本 CLI 唯一允許替換測試檔的子指令，所以不走 `runProbe`
//     （它的前置判定會把測試檔判成 `target-is-test`）；判定仍走 receipt.ts 的 `decideRanResult`。
//
// 一個 skip 一趟：每趟只復活那一個 skip，其他 skip 維持原樣；測試行程內「任一測試紅」都算該 skip 復活失敗
// （FR-016：復活後任一測試紅即判宣稱不成立）。
//
// 由 ~/clade vendor/scripts/lib/ 散播，請勿直接編輯 consumer 副本。

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

import { findOccurrence, loadTypescript } from './mutation.ts'
import type { MutationInput } from './mutation.ts'
import { ProbeToolError, decideRanResult } from './receipt.ts'
import type { RunnerKind } from './receipt.ts'
import { DEFAULT_BASELINE_TIMEOUT_MS, EXIT, loadRunnerFactory } from './runner.ts'
import type { RunnerFactory } from './runner.ts'
import { beginWorktreeGuard } from './worktree-guard.ts'
import type { GuardResult } from './worktree-guard.ts'

// ───────────────────────── skip 標記 ─────────────────────────

export interface SkipMarker {
  /** `YYYY-MM-DD`；缺或格式錯誤為 null。 */
  until: string | null
  /** 非空文字；缺為 ''。 */
  reason: string
  /** 帶 `revive=auto`。 */
  reviveAuto: boolean
  /** 欄位不合法的說明（缺 until、until 不是日期、reason 空、revive 值不是 auto）；合法為 []。 */
  problems: string[]
}

const MARKER_RE = /clade-skip:\s*(.*)$/

/**
 * 解析 `clade-skip: until=<YYYY-MM-DD> reason=<非空文字>[ revive=auto]`（可含在行註解或區塊註解內）。
 * `text` 是整行或註解文字；沒有 `clade-skip:` 回 null。reason 取到 `revive=auto` 之前（或行尾）。
 */
export function parseSkipMarker(text: string): SkipMarker | null {
  const m = MARKER_RE.exec(text)
  if (!m) return null
  let body = m[1].replace(/\*\/\s*$/, '').trim()
  const problems: string[] = []

  let reviveAuto = false
  const revive = /(?:^|\s)revive=(\S*)\s*$/.exec(body)
  if (revive) {
    body = body.slice(0, revive.index).trim()
    if (revive[1] === 'auto') reviveAuto = true
    else problems.push(`revive 只能是 auto：${revive[1]}`)
  }

  const untilM = /^until=(\S*)(?:\s+|$)/.exec(body)
  let until: string | null = null
  let rest = body
  if (!untilM) problems.push('缺 until=<YYYY-MM-DD>')
  else {
    rest = body.slice(untilM[0].length)
    if (/^\d{4}-\d{2}-\d{2}$/.test(untilM[1]) && !Number.isNaN(Date.parse(untilM[1]))) {
      until = untilM[1]
    } else problems.push(`until 不是 YYYY-MM-DD：${untilM[1]}`)
  }

  const reasonM = /^reason=(.*)$/.exec(rest.trim())
  const reason = reasonM ? reasonM[1].trim() : ''
  if (reason === '') problems.push('缺 reason=<非空文字>')

  return { until, reason, reviveAuto, problems }
}

// ───────────────────────── skip 形狀辨認 ─────────────────────────

export type SkipForm = 'options-skip' | 'skip-modifier' | 'skipIf' | 'context-skip'

export interface SkipSite {
  /** 測試檔（呼叫端給的路徑，原樣）。 */
  file: string
  /** 1 起算，skip 記號所在行。 */
  line: number
  form: SkipForm
  /** skip 影響的 test／suite 完整名稱（巢狀前綴以 ` > ` 串接）；判不出為 null。 */
  name: string | null
  /** skip 所在行、其正上方一行（以及該呼叫起始行與其上一行）的 `clade-skip:` 標記；沒有為 null。 */
  marker: SkipMarker | null
  /**
   * 標記是從同檔 module-level `const <名稱>` 的宣告借來的（skip 條件是單一識別字，且該 const 宣告正上方或同行行尾有
   * `clade-skip:` 標記）；標記直接寫在 skip 處時為 undefined。
   */
  markerFromConst?: string
  /** 讓這個 skip 失效的載入時替換（對應 `MutationInput` 的 from／to／occurrence）。 */
  replace: { from: string; to: string; occurrence: number }
}

export interface FindSkipSitesResult {
  sites: SkipSite[]
  /** 讀不到 `typescript`、副檔名不是 JS／TS、語法解析有錯；有值時 `sites` 為空。 */
  error?: string
}

const ROOT_NAMES = ['test', 'it', 'describe', 'suite'] as const
const SUITE_ROOTS = new Set(['describe', 'suite'])
const PLAIN_MODIFIERS = new Set([
  'skip',
  'only',
  'todo',
  'concurrent',
  'sequential',
  'fails',
  'failing',
])
const TEST_MODULES = new Set([
  'node:test',
  'test',
  'vitest',
  'bun:test',
  'vite-plus/test',
  'vite-plus',
])

function scriptKindOf(ts: typeof import('typescript'), file: string) {
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

/** `source` 內 `from` 恰好從 `pos` 開始的那一處是第幾次出現（1 起算，與載入時替換同一口徑）；對不上回 -1。 */
function occurrenceAt(source: string, from: string, pos: number): number {
  for (let n = 1; ; n++) {
    const idx = findOccurrence(source, from, n)
    if (idx < 0 || idx > pos) return -1
    if (idx === pos) return n
  }
}

/**
 * 列出一個測試檔內所有被辨認的 skip（node:test `{ skip: X }`／`t.skip(`／`test.skip(`／`describe.skip(`／
 * `it.skip(`；vitest `.skipIf(X)`；`.todo(` 不算 skip）與各自的標記、讓它失效的替換。
 */
export function findSkipSites(source: string, file: string): FindSkipSitesResult {
  const ts = loadTypescript()
  if (!ts) return { sites: [], error: 'typescript 不可用' }
  const kind = scriptKindOf(ts, file)
  if (kind === null) return { sites: [], error: `不支援的副檔名：${file}` }
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const diagnostics = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []
  if (diagnostics.length > 0) return { sites: [], error: `語法解析失敗：${file}` }

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

  const lines = source.split('\n')
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1

  /**
   * 標記搜尋：skip 記號所在行（行尾註解亦可）、該呼叫起始行，以及它們正上方「整行只有註解」的一行
   * （取第一個找到的）。上一行若是別的敘述的行尾註解，不算這個 skip 的標記。
   */
  const markerAt = (
    candidates: readonly { ln: number; standalone: boolean }[],
  ): SkipMarker | null => {
    for (const { ln, standalone } of candidates) {
      if (ln < 1 || ln > lines.length) continue
      const text = lines[ln - 1]
      if (standalone && !/^\s*(\/\/|\/\*)/.test(text)) continue
      const commentAt = Math.max(text.indexOf('//'), text.indexOf('/*'))
      if (commentAt < 0) continue
      const parsed = parseSkipMarker(text.slice(commentAt))
      if (parsed) return parsed
    }
    return null
  }
  const markerFor = (tokenLine: number, callLine: number): SkipMarker | null =>
    markerAt([
      { ln: tokenLine, standalone: false },
      { ln: tokenLine - 1, standalone: true },
      { ln: callLine, standalone: false },
      { ln: callLine - 1, standalone: true },
    ])

  /**
   * 常數承載標記：同檔 module-level `const X = …`，宣告起始行行尾或正上方整行註解有 `clade-skip:` 標記。
   * 只認同檔 const：不追 import、不追 let／var、不追運算式。
   */
  const constMarkers = new Map<string, SkipMarker>()
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt) || !(stmt.declarationList.flags & ts.NodeFlags.Const))
      continue
    const startLine = lineOf(stmt.getStart(sf))
    const marker = markerAt([
      { ln: startLine, standalone: false },
      { ln: startLine - 1, standalone: true },
    ])
    if (!marker) continue
    for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name)) constMarkers.set(d.name.text, marker)
    }
  }

  const sites: SkipSite[] = []
  const addSite = (
    form: SkipForm,
    tokenPos: number,
    callNode: import('typescript').Node,
    name: string | null,
    from: string,
    to: string,
    /** skip 條件若是單一識別字，傳它的名稱：直接標記找不到時，退到同檔 const 宣告上的標記。 */
    condIdent?: string,
    /** 替換位置與 skip 記號不同處時（`t.skip` 換掉的是外層 if 條件）傳替換起點；行號與標記仍取 skip 記號。 */
    replacePos: number = tokenPos,
  ) => {
    const occurrence = occurrenceAt(source, from, replacePos)
    if (occurrence < 0) return
    const line = lineOf(tokenPos)
    const direct = markerFor(line, lineOf(callNode.getStart(sf)))
    const viaConst =
      direct === null && condIdent !== undefined ? constMarkers.get(condIdent) : undefined
    sites.push({
      file,
      line,
      form,
      name,
      marker: direct ?? viaConst ?? null,
      ...(viaConst ? { markerFromConst: condIdent } : {}),
      replace: { from, to, occurrence },
    })
  }

  /**
   * `t.skip()` 不會停下測試本體，所以實際寫法幾乎都帶 early return；只把 `t.skip` 換成空操作，return 照跑，
   * 測試沒驗任何斷言就算通過。依所在位置決定替換：
   * - 在 if 的 then 分支（`if (X) t.skip()`、`if (X) { …; t.skip(…); return }`、`if (X) return t.skip()`）
   *   → 把 if 條件換成 `false`，整個 skip 分支不走、測試本體照跑
   * - `return t.skip(…)`，或同一個 block 內之後還有 `return`（無條件 skip）→ 復活不可能跑到斷言：
   *   換成丟錯的函式，讓這一趟轉紅、記成 fail，NEVER 讓它空跑成 pass
   * - 其他（之後沒有 return）→ 換成空操作，本體接著執行
   */
  const addContextSkip = (
    call: import('typescript').CallExpression,
    callee: import('typescript').PropertyAccessExpression,
    self: string | null,
  ) => {
    const tokenPos = callee.getStart(sf)
    const parent = call.parent
    const stmt =
      parent &&
      (ts.isExpressionStatement(parent) || ts.isReturnStatement(parent)) &&
      parent.expression === call
        ? parent
        : null
    const holder = stmt && stmt.parent && ts.isBlock(stmt.parent) ? stmt.parent : null
    const ifStmt = stmt
      ? [stmt.parent, holder?.parent].find(
          (n): n is import('typescript').IfStatement =>
            n !== undefined &&
            ts.isIfStatement(n) &&
            n.thenStatement === (n === stmt.parent ? stmt : holder),
        )
      : undefined
    if (ifStmt) {
      const cond = ifStmt.expression
      const from = source.slice(cond.getStart(sf), cond.getEnd())
      addSite('context-skip', tokenPos, call, self, from, 'false', undefined, cond.getStart(sf))
      return
    }
    const from = source.slice(tokenPos, callee.getEnd())
    const returnsAfter =
      stmt !== null &&
      (ts.isReturnStatement(stmt) ||
        (holder !== null &&
          holder.statements
            .slice(holder.statements.indexOf(stmt as never) + 1)
            .some((x) => ts.isReturnStatement(x))))
    const to = returnsAfter
      ? "(() => { throw new Error('mutation-probe revive：t.skip() 之後無條件 return，復活後跑不到斷言') })"
      : '(() => {})'
    addSite('context-skip', tokenPos, call, self, from, to)
  }

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
  const staticNameOf = (args: readonly import('typescript').Expression[]): string | null => {
    const a = args[0]
    if (!a) return null
    const f = fold(a)
    if (f !== null) return f
    if (ts.isObjectLiteralExpression(a)) {
      for (const p of a.properties) {
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'name') {
          return fold(p.initializer)
        }
      }
    }
    return null
  }

  interface Frame {
    /** 外層完整名稱前綴；null＝前綴判不出。 */
    prefix: string[] | null
    /** 這一層 test callback 的第一個參數名（node:test 的 `t`）。 */
    ctxName: string | null
    /** 這一層 test 自己的完整名稱（`t.skip(` 影響的對象）。 */
    self: string | null
  }

  interface Classified {
    suite: boolean
    /** `.skip` 修飾的 PropertyAccessExpression（若有）。 */
    skipAccess: import('typescript').PropertyAccessExpression | null
    /** `.skipIf(cond)` 的 cond（若有）。 */
    skipIfCond: import('typescript').Expression | null
  }

  const classify = (
    callee: import('typescript').Expression,
    ctxNames: string[],
  ): Classified | null => {
    let expr = callee
    let skipIfCond: import('typescript').Expression | null = null
    if (ts.isCallExpression(expr)) {
      const inner = expr.expression
      if (!ts.isPropertyAccessExpression(inner)) return null
      if (inner.name.text === 'skipIf') skipIfCond = expr.arguments[0] ?? null
      else if (inner.name.text !== 'runIf') return null
      expr = inner.expression
    }
    let skipAccess: import('typescript').PropertyAccessExpression | null = null
    while (
      ts.isPropertyAccessExpression(expr) &&
      PLAIN_MODIFIERS.has(expr.name.text) &&
      (ts.isIdentifier(expr.expression) || ts.isPropertyAccessExpression(expr.expression))
    ) {
      if (expr.name.text === 'skip') skipAccess = expr
      expr = expr.expression
    }
    if (ts.isIdentifier(expr)) {
      const root = aliases.get(expr.text)
      if (!root) return null
      return { suite: SUITE_ROOTS.has(root), skipAccess, skipIfCond }
    }
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
      const member = expr.name.text
      if (
        skipIfCond === null &&
        ctxNames.includes(expr.expression.text) &&
        (ROOT_NAMES as readonly string[]).includes(member)
      ) {
        return { suite: SUITE_ROOTS.has(member), skipAccess, skipIfCond }
      }
    }
    return null
  }

  const callbackOf = (args: readonly import('typescript').Expression[]) => {
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

      // `t.skip(…)`：node:test／vitest 的 context 方法，條件式 skip 常見寫法。
      const callee = node.expression
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'skip' &&
        ts.isIdentifier(callee.expression) &&
        ctxNames.includes(callee.expression.text)
      ) {
        addContextSkip(node, callee, top.self)
      }

      const c = classify(callee, ctxNames)
      if (c) {
        const args = node.arguments
        const name = staticNameOf(args)
        const full = name !== null && top.prefix !== null ? [...top.prefix, name] : null
        const fullName = full ? full.join(' > ') : null

        if (c.skipAccess) {
          // `test.skip(` → `test(`：去掉 `.skip`（含其前的空白）。
          const start = c.skipAccess.expression.getEnd()
          const from = source.slice(start, c.skipAccess.getEnd())
          addSite('skip-modifier', start, node, fullName, from, '')
        }
        if (c.skipIfCond) {
          const from = source.slice(c.skipIfCond.getStart(sf), c.skipIfCond.getEnd())
          addSite(
            'skipIf',
            c.skipIfCond.getStart(sf),
            node,
            fullName,
            from,
            'false',
            ts.isIdentifier(c.skipIfCond) ? c.skipIfCond.text : undefined,
          )
        }
        for (const a of args) {
          if (!ts.isObjectLiteralExpression(a)) continue
          for (const p of a.properties) {
            if (
              ts.isPropertyAssignment(p) &&
              (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
              p.name.text === 'skip'
            ) {
              const from = source.slice(p.initializer.getStart(sf), p.initializer.getEnd())
              addSite(
                'options-skip',
                p.initializer.getStart(sf),
                node,
                fullName,
                from,
                'false',
                ts.isIdentifier(p.initializer) ? p.initializer.text : undefined,
              )
            } else if (ts.isShorthandPropertyAssignment(p) && p.name.text === 'skip') {
              addSite('options-skip', p.getStart(sf), node, fullName, 'skip', 'skip: false', 'skip')
            }
          }
        }

        const cb = callbackOf(args)
        for (const a of args) {
          if (cb && a === cb) {
            const first = cb.parameters[0]
            const ctx = first && ts.isIdentifier(first.name) && !c.suite ? first.name.text : null
            visit(cb.body, [...frames, { prefix: full, ctxName: ctx, self: fullName }])
          } else visit(a, frames)
        }
        ts.forEachChild(node.expression, (n) => visit(n, frames))
        return
      }
    }
    ts.forEachChild(node, (n) => visit(n, frames))
  }

  visit(sf, [{ prefix: [], ctxName: null, self: null }])
  sites.sort((a, b) => a.line - b.line)
  return { sites }
}

// ───────────────────────── 復活驗證 ─────────────────────────

export type ReviveStatus = 'pass' | 'fail' | 'timeout'

export interface ReviveEntry {
  file: string
  name: string
  status: ReviveStatus
  /** 復活後轉紅的第一筆（人讀輸出用；不進 JSON）。 */
  firstFailing?: string
}

export interface ReviveRunInput {
  /** git repo 根。 */
  root: string
  runnerKind: RunnerKind
  /** 測試檔（repo 相對、POSIX）。 */
  tests: string[]
  config?: string
  /** 每趟時限（毫秒）；省略用 DEFAULT_BASELINE_TIMEOUT_MS（revive 沒有基線可推算）。 */
  timeoutMs?: number
  runnerFactory?: RunnerFactory
  log?: (line: string) => void
}

export interface ReviveRunOutput {
  revived: ReviveEntry[]
  counts: { pass: number; fail: number; timeout: number }
  worktree: GuardResult
  exit: number
  toolError?: string
}

export function countRevived(revived: ReviveEntry[]): ReviveRunOutput['counts'] {
  const counts = { pass: 0, fail: 0, timeout: 0 }
  for (const r of revived) counts[r.status] += 1
  return counts
}

function exitForRevive(revived: ReviveEntry[], worktree: GuardResult): number {
  if (!worktree.unchanged) return EXIT.worktreeChanged
  return revived.every((r) => r.status === 'pass') ? EXIT.ok : EXIT.survived
}

export async function runRevive(input: ReviveRunInput): Promise<ReviveRunOutput> {
  const { root } = input
  const log = input.log ?? (() => {})
  if (input.tests.length === 0) throw new ProbeToolError('沒有指定任何測試檔')

  // 先找標記：沒有任何 revive=auto 就不必起任何行程（exit 2）。
  const targets: { file: string; sites: SkipSite[] }[] = []
  for (const file of new Set(input.tests)) {
    if (!existsSync(join(root, file))) throw new ProbeToolError(`測試檔不存在：${file}`)
    const found = findSkipSites(readFileSync(join(root, file), 'utf8'), file)
    if (found.error) throw new ProbeToolError(found.error)
    const sites = found.sites.filter((s) => s.marker?.reviveAuto)
    if (sites.length > 0) targets.push({ file, sites })
  }
  if (targets.length === 0) {
    throw new ProbeToolError(
      `找不到任何帶 revive=auto 標記的 skip（標記格式：// clade-skip: until=<YYYY-MM-DD> reason=<文字> revive=auto）：${input.tests.join(' ')}`,
    )
  }

  const factory = input.runnerFactory ?? (await loadRunnerFactory(input.runnerKind))
  const timeoutMs = input.timeoutMs ?? DEFAULT_BASELINE_TIMEOUT_MS
  const guard = beginWorktreeGuard({ root, files: targets.map((t) => t.file) })
  const workDir = mkdtempSync(join(tmpdir(), 'mutation-probe-'))
  const revived: ReviveEntry[] = []

  try {
    for (const target of targets) {
      // 每個測試檔一個 Runner：每趟只跑那一個檔，其他檔的紅燈不會被算到這個 skip 頭上。
      const runner = await factory({
        root,
        tests: [target.file],
        config: input.config,
        trackGroup: guard.trackGroup,
        workDir,
      })
      for (const site of target.sites) {
        const label = site.name ?? `(L${site.line})`
        log(`mutation-probe: 復活 ${target.file} > ${label}`)
        const mutation: MutationInput = {
          id: `revive:${target.file}:${site.line}`,
          file: target.file,
          from: site.replace.from,
          to: site.replace.to,
          occurrence: site.replace.occurrence,
        }
        const run = await runner.runMutation(mutation, timeoutMs)
        // 測試檔本身沒被載入＝替換不可能套上，不是 pass。
        if (!run.timedOut && !run.loaded) {
          throw new ProbeToolError(`${target.file} 在測試行程中沒有被載入：復活替換沒有套上`)
        }
        // decideRanResult：hits=0 而已載入、或沒套上卻有測試失敗 → ProbeToolError。
        const decided = decideRanResult(run)
        const first = run.failing[0]
        if (decided.result === 'timeout' || decided.result === 'caught') {
          revived.push({
            file: target.file,
            name: label,
            status: decided.result === 'timeout' ? 'timeout' : 'fail',
            firstFailing: first ? `${first.file} > ${first.name}` : undefined,
          })
          continue
        }
        // 沒有失敗不等於復活的測試有跑：外層 describe 仍 skip、被過濾、名稱判不出，都會零失敗收場。
        // 只有它（suite 則是它底下至少一支）出現在「真的執行且通過」清單裡才算 pass。
        const ran =
          site.name !== null &&
          (run.passedNames ?? []).some((n) => n === site.name || n.startsWith(`${site.name} > `))
        revived.push({
          file: target.file,
          name: label,
          status: ran ? 'pass' : 'fail',
          firstFailing: ran
            ? undefined
            : `${target.file} > ${label}：復活後沒有執行（仍被 skip、被過濾，或名稱判不出）`,
        })
      }
    }
    const worktree = guard.finish()
    return {
      revived,
      counts: countRevived(revived),
      worktree,
      exit: exitForRevive(revived, worktree),
    }
  } catch (e) {
    guard.dispose()
    if (e instanceof ProbeToolError) {
      const worktree = guard.finish()
      return {
        revived: [],
        counts: { pass: 0, fail: 0, timeout: 0 },
        worktree,
        exit: worktree.unchanged ? EXIT.toolError : EXIT.worktreeChanged,
        toolError: e.message,
      }
    }
    throw e
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
