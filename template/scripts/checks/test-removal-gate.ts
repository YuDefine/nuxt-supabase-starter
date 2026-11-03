// 🔒 LOCKED — managed by clade · Source: vendor/scripts/checks/test-removal-gate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/checks/test-removal-gate.ts
// CLADE:VENDOR-SCRIPT
//
// test-removal-gate — 刪除／合併測試必須附有效收據才放行
//
// 一份判定式兩個消費端共用：
//   - pre-commit：`pre-commit/checks/test-removal-receipt.sh` → `--staged`（base＝HEAD，head＝index），驗有效性 1–5；
//     merge 進行中（MERGE_HEAD 存在）時，上游帶入的刪除不算（見判定 1 的 merge 例外）
//   - CI：`vendor/actions/test-removal-receipt` → `--against <ref>`（base＝merge-base(HEAD, ref)，head＝HEAD），
//     1–5 之外對每張用到的收據再呼叫 `mutation-probe.ts replay`（有效性 6）
//
// 契約：specs/truth/data/break-receipt.md § 有效性、§ 被刪 test case 的身分；
//       specs/truth/contracts/mutation-probe-cli.md § 2（replay）；
//       輸出格式 specs/truth/features/cli/test-removal-gate/dsl.md。
//
// 判定：
//   1. 列出 diff 中的測試檔（`isTestPath`）；整檔刪除、或 base 與 head 各自列出 test case 名稱（`test-cases.ts`）
//      後 base 有 head 沒有者，就是被刪除的 test case（rename 不算刪除；rename 後檔內減少照一般規則算）。
//      merge 例外（僅 `--staged` 且 MERGE_HEAD 存在）：base（HEAD）有、index 沒有的 case 裡，扣掉「merge-base 有、
//      MERGE_HEAD 沒有」的那幾個（上游刪掉或改名的，以名稱多重集合計）；剩下的——本分支獨有、或兩邊都還在卻在解衝突時
//      被刪——照常要收據。整檔刪除只在 MERGE_HEAD 也沒有該檔、且 HEAD 版每個 case 在 merge-base 都有時才不算。
//      任一版本列不出名稱（indeterminate）就不扣——唯一例外：本分支沒動該檔（HEAD 版＝merge-base 版）且 index 版
//      與 MERGE_HEAD 版逐字相同，差異全是上游帶入，整檔放行（含動態名稱檔）。CI（`--against`）比 merge-base 與 HEAD，本來就不含上游的刪除。
//   2. 讀本次 diff 新增或修改的 `.clade/break-receipts/*.json`，以 `receipt.ts::validateReceipt` 逐一判有效性
//      （判定式唯一住在那裡，**NEVER** 在這裡另寫一份）。
//   3. 名稱判不出的檔（indeterminate）：default-deny。base 中每個判不出名稱的 case 呼叫（含 `.each` 參數表）必須
//      被**證明**仍在才不列：名稱不引用外部變數；`.each` 表是純字面值，或引用檔內唯一的 `const`（初始化式原文相同、
//      遞迴只含字面值、宣告之外每個引用都在 allowlist 內）；位點的每層祖先只能是 describe／test 呼叫與其 callback（`forEach`、迴圈、
//      條件式等任何其他包裝一律不證明）；位點與祖先測試呼叫的呼叫指紋（callee、名稱與非函式引數原文；不含 callback
//      本體）在 head 的出現次數不少於 base 全檔同指紋呼叫數。證明不了就列，要求整檔 `(file,"*")` 的收據或豁免，
//      單 case 收據不夠；**NEVER** 因判不出而放行，也 **NEVER** 為了放行某種形狀再擴充可證明的文法。
//      證明不了的常見形狀：表來自 import／函式呼叫／spread／`let`，reformat。其餘具名 case 照常逐名比對。
//
// stdout 每個被刪 test case 一行（整檔／indeterminate 的 `<name>` 是 `*`）：
//   block <file> > <name> — missing-receipt <解除指令>
//   block <file> > <name> — invalid-receipt:<n> <判定依據>      （n＝有效性第幾條不成立）
//   block <file> > <name> — invalid-exemption <判定依據>        （豁免欄位不合法或 ref 不存在）
//   block <file> > <name> — replay-mismatch recorded=<…> replayed=<…>       （僅 --against）
//   block <file> > <name> — replay-unavailable <原因>            （僅 --against；重跑工具不可用視同擋下）
//   pass <file> > <name> — receipt <receipt_id>
//   exempt <file> > <name> — <feature-removed|bdd-remove> <reason>          （豁免一律列出供 0-A 複核）
// 人讀說明走 stderr。沒有 baseline：判定對象是「本次改動刪除的」，沒有存量。
//
// exit：0 放行；1 擋下；2 讀不到 git／收據版本不支援。逃生口只有兩種豁免，沒有檔首 marker。
//
// 依賴 consumer 自己的 node_modules（`typescript` 列 test case 名稱）；`typescript` 讀不到時，名稱無法列舉的
// 修改檔只印警告（同 orphan-delta-gate 的 soft-skip），整檔刪除照擋（不需要列名稱）。
//
// 由 ~/clade vendor/scripts/checks/ 散播，請勿直接編輯 consumer 副本。

import { execFileSync, spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadTypescript } from '../lib/mutation-probe/mutation.ts'
import { deletedCaseNames, listTestCases } from '../lib/mutation-probe/test-cases.ts'
import type { TestCaseListing } from '../lib/mutation-probe/test-cases.ts'
import { RECEIPT_DIR, parseReceipt, validateReceipt } from '../lib/mutation-probe/receipt.ts'
import type {
  Receipt,
  ReceiptChange,
  ValidityResult,
  Vouch,
} from '../lib/mutation-probe/receipt.ts'
import { isTestPath } from './source-assert-detect.ts'

const here = dirname(fileURLToPath(import.meta.url))

export type Mode = { staged: true } | { against: string }

// ───────────────────────── 型別 ─────────────────────────

/** `git diff --name-status -M -z` 的一筆（只留 A／M／D／R／C／T 的主類別字母）。 */
export interface DiffEntry {
  status: string
  /** 變更後路徑（D 為被刪的路徑）。 */
  path: string
  /** R／C 才有：舊路徑。 */
  oldPath?: string
}

/** 閘門對 git 的全部需求；`collect` 以 git 實作，測試可直接餵資料。 */
export interface Snapshot {
  entries: readonly DiffEntry[]
  /** base 版檔案內容；不存在回 null。 */
  readBase: (path: string) => string | null
  /** head 版檔案內容；不存在回 null。 */
  readHead: (path: string) => string | null
  /** head 版檔案的 git blob sha；不存在回 null。 */
  headBlobSha: (path: string) => string | null
  /** 僅 `--staged` 且 merge 進行中（MERGE_HEAD 存在）才有：merge-base 與 MERGE_HEAD 版的檔案內容（不存在回 null）。 */
  merge?: {
    readMergeBase: (path: string) => string | null
    readMergeHead: (path: string) => string | null
  }
}

export type ReplayResult =
  | { ok: true; recorded: string; replayed: string }
  | { ok: false; reason: string }

/** 對一張收據（repo 相對路徑）呼叫 `mutation-probe.ts replay`。 */
export type Replayer = (receiptPath: string, receiptId: string) => ReplayResult

export interface GateContext {
  mode: Mode
  /** 擋下訊息裡的探針指令前綴，例 `node vendor/scripts/mutation-probe.ts`（NFR-006）。 */
  probeCmd: string
  /** 只有 `--against` 用；沒給＝不做有效性 6。 */
  replay?: Replayer
}

export interface GateResult {
  exitCode: 0 | 1 | 2
  stdout: string[]
  stderr: string[]
}

interface Target {
  file: string
  /** 完整 test case 名稱；整檔刪除與 indeterminate 為 `*`。 */
  name: string
}

interface LoadedReceipt {
  path: string
  receipt: Receipt
}

export function receiptIsInDir(path: string): boolean {
  return new RegExp(`^${RECEIPT_DIR.replace(/[.]/g, '\\.')}/[^/]+\\.json$`).test(path)
}

function wholeFileIndeterminate(l: TestCaseListing): boolean {
  return (
    l.indeterminate && l.sites.some((s) => s.line === 0 && s.reason !== 'typescript-unavailable')
  )
}

function tsUnavailable(l: TestCaseListing): boolean {
  return l.indeterminate && l.sites.some((s) => s.reason === 'typescript-unavailable')
}

// ───────────────────────── 判定（純函式，不碰 git） ─────────────────────────

interface Collected {
  targets: Target[]
  deletedFiles: Set<string>
  indeterminateFiles: Set<string>
  deletedCases: Vouch[]
  warnings: string[]
}

/** 步驟 1：算出被刪除的 test case（與需要整檔收據的 indeterminate 檔）。 */
function collectTargets(snap: Snapshot): Collected {
  const out: Collected = {
    targets: [],
    deletedFiles: new Set(),
    indeterminateFiles: new Set(),
    deletedCases: [],
    warnings: [],
  }

  const wholeFileDeleted = (file: string): void => {
    const text = snap.readBase(file)
    if (text !== null) {
      const l = listTestCases(text, file)
      // 讀得出名稱且一個 case 都沒有 → 沒有東西被刪
      if (!l.indeterminate && l.names.length === 0) return
      // merge 帶入上游整檔刪除：MERGE_HEAD 也沒有該檔，且 HEAD 版每個 case 在 merge-base 都有（本分支沒加過）
      if (!l.indeterminate && snap.merge && snap.merge.readMergeHead(file) === null) {
        const mb = namesOf(snap.merge.readMergeBase(file), file)
        if (mb !== null && deletedCaseNames(l.names, mb).length === 0) return
      }
      if (!l.indeterminate) for (const name of l.names) out.deletedCases.push({ file, test: name })
    }
    out.deletedFiles.add(file)
    out.targets.push({ file, name: '*' })
  }

  for (const e of snap.entries) {
    const s = e.status[0]
    if (s === 'D') {
      if (isTestPath(e.path)) wholeFileDeleted(e.path)
      continue
    }
    if (s === 'R') {
      const oldIsTest = isTestPath(e.oldPath ?? '')
      const newIsTest = isTestPath(e.path)
      if (oldIsTest && !newIsTest) wholeFileDeleted(e.oldPath!)
      if (!(oldIsTest && newIsTest)) continue
      compareFile(snap, out, e.oldPath!, e.path)
      continue
    }
    if ((s === 'M' || s === 'T') && isTestPath(e.path)) compareFile(snap, out, e.path, e.path)
  }
  return out
}

/** 同一個檔（M，或 rename 後新舊都是測試檔）base 與 head 的 test case 差集。 */
function compareFile(snap: Snapshot, out: Collected, basePath: string, headPath: string): void {
  const baseText = snap.readBase(basePath)
  const headText = snap.readHead(headPath)
  if (baseText === null || headText === null) return
  if (isPureUpstreamCarryOver(snap, basePath, headPath, baseText, headText)) return
  const base = listTestCases(baseText, basePath)
  const head = listTestCases(headText, headPath)

  if (tsUnavailable(base) || tsUnavailable(head)) {
    out.warnings.push(
      `test-removal-gate: 找不到 typescript，無法列出 ${headPath} 的 test case 名稱 — 略過該檔（未驗證）`,
    )
    return
  }

  if (wholeFileIndeterminate(base) || wholeFileIndeterminate(head)) {
    out.indeterminateFiles.add(headPath)
    out.targets.push({ file: headPath, name: '*' })
    return
  }

  const deleted = withoutUpstreamRemovals(
    snap,
    basePath,
    headPath,
    deletedCaseNames(base.names, head.names),
  )
  for (const name of deleted) out.deletedCases.push({ file: headPath, test: name })

  // base 中判不出名稱的 case 呼叫若有任何一段在 head 消失或改動（或參數表引用變數），該檔列 indeterminate，
  // 要求整檔 `(file,"*")`；沒有動到時其餘具名 case 照常逐名比對。
  if (base.indeterminate && indeterminateRemovalSuspected(baseText, headText, basePath, base)) {
    out.indeterminateFiles.add(headPath)
    out.targets.push({ file: headPath, name: '*' })
    return
  }
  for (const name of deleted) out.targets.push({ file: headPath, name })
}

/**
 * merge 例外（含 indeterminate 檔）：本分支沒動這個檔（HEAD 版與 merge-base 版逐字相同），而 index 版與 MERGE_HEAD 版
 * 逐字相同——HEAD→index 的差異全是上游帶入，沒有任何一行是本分支自己的決定，不必列名稱、不必證明 indeterminate 仍在。
 * 本分支動過該檔（HEAD≠merge-base）、或解衝突時另寫內容（index≠MERGE_HEAD）都不適用，照常判定。非 merge 情境不適用。
 */
function isPureUpstreamCarryOver(
  snap: Snapshot,
  basePath: string,
  headPath: string,
  baseText: string,
  headText: string,
): boolean {
  if (!snap.merge) return false
  const mb = snap.merge.readMergeBase(basePath)
  if (mb === null || mb !== baseText) return false
  const mh =
    snap.merge.readMergeHead(headPath) ??
    (basePath === headPath ? null : snap.merge.readMergeHead(basePath))
  return mh !== null && mh === headText
}

/** 讀得出名稱才回名稱表；檔案不存在或 indeterminate 回 null。 */
function namesOf(text: string | null, file: string): string[] | null {
  if (text === null) return null
  const l = listTestCases(text, file)
  return l.indeterminate ? null : l.names
}

/**
 * merge 例外：從 HEAD→index 的被刪名稱扣掉上游（merge-base→MERGE_HEAD）刪掉的名稱（多重集合）。
 * merge-base 版查 basePath（HEAD 側路徑），MERGE_HEAD 版先查 headPath（上游改檔名時落在新路徑）、沒有再查 basePath（本分支改名、上游仍留舊路徑）；
 * merge-base 讀不出名稱就一個都不扣，MERGE_HEAD 沒有該檔視為上游刪掉整檔。
 */
function withoutUpstreamRemovals(
  snap: Snapshot,
  basePath: string,
  headPath: string,
  deleted: string[],
): string[] {
  if (!snap.merge || deleted.length === 0) return deleted
  const mb = namesOf(snap.merge.readMergeBase(basePath), basePath)
  if (mb === null) return deleted
  // 本分支在解衝突時改檔名（basePath→headPath）而上游仍留舊路徑：兩個路徑都查，都沒有才視為上游刪掉整檔
  const mhText =
    snap.merge.readMergeHead(headPath) ??
    (basePath === headPath ? null : snap.merge.readMergeHead(basePath))
  const mh = mhText === null ? [] : namesOf(mhText, headPath)
  if (mh === null) return deleted
  return deletedCaseNames(deleted, deletedCaseNames(mb, mh))
}

// ───────────────────────── indeterminate 判準 ─────────────────────────

type Ts = typeof import('typescript')
type TsNode = import('typescript').Node
type TsCall = import('typescript').CallExpression

function isLiteralValue(ts: Ts, e: import('typescript').Expression): boolean {
  if (ts.isParenthesizedExpression(e)) return isLiteralValue(ts, e.expression)
  if (
    ts.isStringLiteral(e) ||
    ts.isNoSubstitutionTemplateLiteral(e) ||
    ts.isNumericLiteral(e) ||
    ts.isBigIntLiteral(e)
  ) {
    return true
  }
  if (
    e.kind === ts.SyntaxKind.TrueKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    e.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true
  }
  // `undefined` 在 AST 是 Identifier，但語意上跟 `null` 一樣是字面值（參數化表格常用來驗「缺值」）。
  if (ts.isIdentifier(e) && e.text === 'undefined') return true
  if (ts.isTemplateExpression(e))
    return e.templateSpans.every((sp) => isLiteralValue(ts, sp.expression))
  if (ts.isPrefixUnaryExpression(e)) return isLiteralValue(ts, e.operand)
  if (ts.isArrayLiteralExpression(e)) return e.elements.every((x) => isLiteralValue(ts, x))
  if (ts.isObjectLiteralExpression(e)) {
    return e.properties.every(
      (p) =>
        ts.isPropertyAssignment(p) &&
        (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name)) &&
        isLiteralValue(ts, p.initializer),
    )
  }
  return false
}

/** `x.each(table)` ／ `x.for(table)` 的 table 引數；node 內找不到回 null。 */
function eachTables(ts: Ts, call: TsCall): import('typescript').Expression[] | null {
  const tables: import('typescript').Expression[] = []
  const walk = (n: TsNode): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      (n.expression.name.text === 'each' || n.expression.name.text === 'for') &&
      n.arguments[0]
    ) {
      tables.push(n.arguments[0])
    }
    // tagged-template 表格：`it.each\`…\``，表格就是整段 template（`${1}` 字面插值算字面值，`${x}` 算變數）
    if (ts.isTaggedTemplateExpression(n)) {
      let tag: import('typescript').Expression = n.tag
      let sawEach = false
      while (ts.isPropertyAccessExpression(tag)) {
        if (tag.name.text === 'each' || tag.name.text === 'for') sawEach = true
        tag = tag.expression
      }
      if (sawEach) tables.push(n.template)
    }
    ts.forEachChild(n, walk)
  }
  walk(call)
  return tables.length > 0 ? tables : null
}

/** 表達式是否引用任何變數（識別字；屬性名與物件字面值的鍵不算）。 */
function referencesVariable(ts: Ts, e: TsNode): boolean {
  let found = false
  const walk = (n: TsNode): void => {
    if (found) return
    if (ts.isIdentifier(n)) {
      const parent = n.parent
      const isPropName =
        (parent && ts.isPropertyAccessExpression(parent) && parent.name === n) ||
        (parent && ts.isPropertyAssignment(parent) && parent.name === n)
      if (!isPropName) found = true
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(e)
  return found
}

/**
 * 一個 SourceFile 內的宣告索引：名稱 → 宣告次數（變數、參數、函式、class、import；任何層級）、
 * `const` 宣告的初始化式。唯一性由 count 把關（有遮蔽就不是唯一）。
 */
interface DeclIndex {
  count: Map<string, number>
  constInit: Map<string, import('typescript').Expression>
}

const declIndexCache = new WeakMap<object, DeclIndex>()

function declIndexOf(ts: Ts, sf: import('typescript').SourceFile): DeclIndex {
  const hit = declIndexCache.get(sf)
  if (hit) return hit
  const count = new Map<string, number>()
  const constInit = new Map<string, import('typescript').Expression>()
  const bump = (name: string) => count.set(name, (count.get(name) ?? 0) + 1)
  const bindingNames = (b: import('typescript').BindingName): void => {
    if (ts.isIdentifier(b)) {
      bump(b.text)
      return
    }
    for (const el of b.elements) if (ts.isBindingElement(el)) bindingNames(el.name)
  }
  const walk = (n: TsNode): void => {
    if (ts.isVariableDeclaration(n)) {
      bindingNames(n.name)
      if (
        ts.isIdentifier(n.name) &&
        n.initializer &&
        n.parent &&
        ts.isVariableDeclarationList(n.parent) &&
        n.parent.flags & ts.NodeFlags.Const
      ) {
        constInit.set(n.name.text, n.initializer)
      }
    } else if (ts.isParameter(n)) bindingNames(n.name)
    else if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name) bump(n.name.text)
    else if (
      (ts.isImportClause(n) || ts.isNamespaceImport(n) || ts.isImportSpecifier(n)) &&
      n.name
    ) {
      bump(n.name.text)
    }
    ts.forEachChild(n, walk)
  }
  walk(sf)
  const idx = { count, constInit }
  declIndexCache.set(sf, idx)
  return idx
}

function unwrapExpr(ts: Ts, e: import('typescript').Expression): import('typescript').Expression {
  let cur = e
  for (;;) {
    if (
      ts.isParenthesizedExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isSatisfiesExpression(cur) ||
      ts.isNonNullExpression(cur) ||
      ts.isTypeAssertionExpression(cur)
    ) {
      cur = cur.expression
      continue
    }
    return cur
  }
}

/**
 * 識別字 `name` 的所有引用（宣告本身、屬性名位置除外）是否都在 allowlist 內：
 *   - 作為 `.each`／`.for` 的表格引數（含括號、`as`、`!` 包裝）；
 *   - 深埋在純陣列／物件字面值裡，且該字面值是另一個 `const` 的完整初始化式——那個 const 自己也得通過同一檢查
 *     （`const all = [rows]` 可以，`const all = rows`（別名）、`all[0].push(x)` 不行）。
 * 其餘用法（方法呼叫、成員賦值、當引數傳出去、展開、別名、`Array.prototype.push.call(name, …)`、shorthand 屬性）
 * 一律 false。不是列舉「已知的寫入手法」——新的寫入手法天然落在 allowlist 之外。
 * 不看 scope：同名的其他綁定也算引用，只會多擋、不會漏放。
 */
function referencesAllowed(
  ts: Ts,
  sf: import('typescript').SourceFile,
  name: string,
  depth = 0,
): boolean {
  if (depth > 6) return false
  let ok = true
  const wrapped = (n: TsNode): boolean =>
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isTypeAssertionExpression(n)
  const check = (id: TsNode): boolean => {
    const parent = id.parent
    if (!parent) return false
    if (ts.isVariableDeclaration(parent) && parent.name === id) return true // 宣告本身
    if (ts.isPropertyAccessExpression(parent) && parent.name === id) return true // `x.name` 不是這個綁定
    if (ts.isPropertyAssignment(parent) && parent.name === id) return true // `{ name: 1 }`
    let cur: TsNode = id
    while (cur.parent && wrapped(cur.parent)) cur = cur.parent
    const p = cur.parent
    if (!p) return false
    // 1) `.each(name)`／`.for(name)` 的表格引數
    if (
      ts.isCallExpression(p) &&
      p.arguments.includes(cur as import('typescript').Expression) &&
      ts.isPropertyAccessExpression(p.expression) &&
      (p.expression.name.text === 'each' || p.expression.name.text === 'for')
    ) {
      return true
    }
    // 2) 純字面值裡的元素／屬性值，字面值整個是另一個 const 的初始化式
    let top: TsNode = cur
    let wrappedInLiteral = false
    for (;;) {
      const tp: TsNode | undefined = top.parent
      if (!tp) return false
      if (wrapped(tp)) {
        top = tp
        continue
      }
      if (ts.isArrayLiteralExpression(tp) || ts.isObjectLiteralExpression(tp)) {
        top = tp
        wrappedInLiteral = true
        continue
      }
      if (ts.isPropertyAssignment(tp) && tp.initializer === top) {
        top = tp
        continue
      }
      break
    }
    const decl = top.parent
    if (
      wrappedInLiteral &&
      decl &&
      ts.isVariableDeclaration(decl) &&
      decl.initializer === top &&
      ts.isIdentifier(decl.name) &&
      ts.isVariableDeclarationList(decl.parent) &&
      decl.parent.flags & ts.NodeFlags.Const
    ) {
      return referencesAllowed(ts, sf, decl.name.text, depth + 1)
    }
    return false
  }
  const visit = (n: TsNode): void => {
    if (!ok) return
    if (ts.isIdentifier(n) && n.text === name && !check(n)) {
      ok = false
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return ok
}

/**
 * `.each` 表「base 與 head 逐字相同、列數不可能變」的快速路徑。只認兩種形狀，其餘一律 false（default-deny）：
 *   - 純字面值（`isLiteralValue`；呼叫指紋已涵蓋原文比對）；
 *   - 識別字：檔內唯一的 `const` 宣告（base、head 各恰一個，含 describe 內的區域 const），初始化式原文相同、
 *     初始化式本身是純字面值或只含上述兩種形狀的識別字（遞迴），且宣告之外的每個引用都在 allowlist 內（`referencesAllowed`，base／head 皆然）。
 * 函式呼叫、import、`let`／`var`、參數、spread、展開運算一律 false：不再為它們擴充文法。
 */
function tableProvablySame(
  ts: Ts,
  baseSf: import('typescript').SourceFile,
  headSf: import('typescript').SourceFile,
  e: import('typescript').Expression,
  depth = 0,
): boolean {
  if (depth > 6) return false
  const x = unwrapExpr(ts, e)
  if (isLiteralValue(ts, x)) return true
  if (ts.isIdentifier(x)) {
    const b = declIndexOf(ts, baseSf)
    const h = declIndexOf(ts, headSf)
    const name = x.text
    if ((b.count.get(name) ?? 0) !== 1 || (h.count.get(name) ?? 0) !== 1) return false
    const bi = b.constInit.get(name)
    const hi = h.constInit.get(name)
    if (!bi || !hi || bi.getText(baseSf) !== hi.getText(headSf)) return false
    if (!referencesAllowed(ts, baseSf, name) || !referencesAllowed(ts, headSf, name)) return false
    return tableProvablySame(ts, baseSf, headSf, bi, depth + 1)
  }
  if (ts.isArrayLiteralExpression(x)) {
    return x.elements.every((el) => tableProvablySame(ts, baseSf, headSf, el, depth + 1))
  }
  if (ts.isObjectLiteralExpression(x)) {
    return x.properties.every(
      (p) =>
        ts.isPropertyAssignment(p) &&
        !ts.isComputedPropertyName(p.name) &&
        tableProvablySame(ts, baseSf, headSf, p.initializer, depth + 1),
    )
  }
  return false
}

const TEST_ROOTS = new Set(['test', 'it', 'describe', 'suite'])
const TEST_MODULES = new Set([
  'node:test',
  'test',
  'vitest',
  'bun:test',
  'vite-plus/test',
  'vite-plus',
])

/** import 別名（`import { it as spec } from 'vitest'`、`import test from 'node:test'`）→ 本地名稱集合。 */
function testRootNames(ts: Ts, sf: import('typescript').SourceFile): Set<string> {
  const names = new Set(TEST_ROOTS)
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    if (!TEST_MODULES.has(stmt.moduleSpecifier.text)) continue
    const clause = stmt.importClause
    if (!clause) continue
    if (clause.name && stmt.moduleSpecifier.text === 'node:test') names.add(clause.name.text)
    const named = clause.namedBindings
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        if (TEST_ROOTS.has((el.propertyName ?? el.name).text)) names.add(el.name.text)
      }
    }
  }
  return names
}

/** callee 的根是不是測試 API（含修飾、`.each(...)` 之後的呼叫、tagged-template、`t.test(...)` 子測試）。 */
function isTestCall(ts: Ts, call: TsCall, roots: Set<string>): boolean {
  let cur: import('typescript').Expression = call.expression
  for (;;) {
    cur = unwrapExpr(ts, cur)
    if (ts.isTaggedTemplateExpression(cur)) cur = cur.tag
    else if (ts.isCallExpression(cur)) cur = cur.expression
    else if (ts.isPropertyAccessExpression(cur)) {
      if (ts.isIdentifier(cur.expression) && TEST_ROOTS.has(cur.name.text)) return true
      cur = cur.expression
    } else break
  }
  return ts.isIdentifier(cur) && roots.has(cur.text)
}

function isFnLiteral(ts: Ts, n: TsNode): boolean {
  return ts.isArrowFunction(n) || ts.isFunctionExpression(n)
}

/**
 * 呼叫指紋：callee 原文＋非函式字面量引數的原文；函式字面量（callback 本體）以佔位取代。
 * 只用來證明「這個測試呼叫（含它外圍的 describe）原樣還在」；callback 本體怎麼改都不會讓該呼叫消失，
 * 但包它的 wrapper 一律不靠指紋放行（見 `indeterminateRemovalSuspected` 的祖先檢查）。
 */
function callFingerprint(ts: Ts, sf: import('typescript').SourceFile, c: TsCall): string {
  const parts = [c.expression.getText(sf)]
  for (const a of c.arguments) {
    parts.push(isFnLiteral(ts, a) ? '<fn>' : a.getText(sf))
  }
  return parts.join('\u0000')
}

/**
 * 判不出 base 的動態 case 在 head 是否仍在 → 回 true（該檔列 indeterminate，要求整檔 `(file,"*")`）。
 * default-deny：只有下列全部成立才回 false，其餘一律 true——
 *   1. 每個判不出名稱的位點（`listTestCases` 的 sites，以行號對應；該行**每一個**測試呼叫都驗，不只最外層）：
 *      名稱引數不引用變數；`.each` 表經 `tableProvablySame` 證明沒變；
 *   2. 位點的每一層祖先只能是 Block／ExpressionStatement／測試呼叫（與它的 callback）；
 *      任何其他包裝（`rows.forEach(...)`、迴圈、條件式、非測試函式）一律 true；
 *   3. 位點與其測試祖先的呼叫指紋，head 的出現次數不少於 base 全檔同指紋呼叫數（具名孿生也算）。
 */
function indeterminateRemovalSuspected(
  baseText: string,
  headText: string,
  file: string,
  base: TestCaseListing,
): boolean {
  const ts = loadTypescript()
  if (!ts) return true
  const sf = ts.createSourceFile(file, baseText, ts.ScriptTarget.Latest, true)
  const headSf = ts.createSourceFile(file, headText, ts.ScriptTarget.Latest, true)
  const roots = testRootNames(ts, sf)
  const lineOf = (n: TsNode) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1

  const calls: TsCall[] = []
  const collectCalls = (n: TsNode): void => {
    if (ts.isCallExpression(n)) calls.push(n)
    ts.forEachChild(n, collectCalls)
  }
  collectCalls(sf)

  const wanted = new Set<string>()
  const want = (c: TsCall) => wanted.add(callFingerprint(ts, sf, c))

  for (const site of base.sites) {
    // 該行的測試呼叫；`test.each(t)('n', fn)` 的內層 `test.each(t)` 是 callee，歸外層呼叫管
    const cands = calls.filter(
      (c) =>
        lineOf(c) === site.line &&
        isTestCall(ts, c, roots) &&
        !(ts.isCallExpression(c.parent) && c.parent.expression === c),
    )
    if (cands.length === 0) return true
    for (const c of cands) {
      const nameArg = c.arguments[0]
      if (nameArg && !isFnLiteral(ts, nameArg) && referencesVariable(ts, nameArg)) return true
      if (site.reason === 'each-table') {
        const tables = eachTables(ts, c)
        if (!tables || tables.some((t) => !tableProvablySame(ts, sf, headSf, t))) return true
      }
      want(c)
      // 祖先：只放行測試呼叫（及其 callback）與純語句容器
      for (let p: TsNode | undefined = c.parent; p && !ts.isSourceFile(p); p = p.parent) {
        if (ts.isBlock(p) || ts.isExpressionStatement(p) || ts.isParenthesizedExpression(p))
          continue
        if (isFnLiteral(ts, p)) {
          const owner = p.parent
          if (!ts.isCallExpression(owner) || !isTestCall(ts, owner, roots)) return true
          continue
        }
        if (ts.isCallExpression(p)) {
          if (!isTestCall(ts, p, roots)) return true
          const pn = p.arguments[0]
          if (pn && !isFnLiteral(ts, pn) && referencesVariable(ts, pn)) return true
          want(p)
          continue
        }
        return true
      }
    }
  }

  // head 的同指紋呼叫數，要對上 base 裡**所有**同指紋呼叫（含具名位點與其他呼叫），不是只對上位點數：
  // 同檔另有一個同指紋的具名 `it('works', fn)` 時，刪掉 `.each` 內那個，head 數仍 ≥ 位點數，會無收據通過。
  const baseTotal = new Map<string, number>()
  for (const c of calls) {
    const fp = callFingerprint(ts, sf, c)
    if (wanted.has(fp)) baseTotal.set(fp, (baseTotal.get(fp) ?? 0) + 1)
  }
  const have = new Map<string, number>()
  const collectHead = (n: TsNode): void => {
    if (ts.isCallExpression(n)) {
      const fp = callFingerprint(ts, headSf, n)
      have.set(fp, (have.get(fp) ?? 0) + 1)
    }
    ts.forEachChild(n, collectHead)
  }
  collectHead(headSf)
  for (const [fp, count] of baseTotal) {
    if ((have.get(fp) ?? 0) < count) return true
  }
  return false
}

function loadReceipts(
  snap: Snapshot,
  stderr: string[],
): { receipts: LoadedReceipt[]; unsupported: string[] } {
  const receipts: LoadedReceipt[] = []
  const unsupported: string[] = []
  for (const e of snap.entries) {
    const s = e.status[0]
    if (s === 'D' || !receiptIsInDir(e.path)) continue
    const text = snap.readHead(e.path)
    if (text === null) continue
    const parsed = parseReceipt(text)
    if (parsed.ok && parsed.receipt) {
      receipts.push({ path: e.path, receipt: parsed.receipt })
    } else if (parsed.unsupported_version) {
      unsupported.push(`${e.path}：${parsed.error}`)
    } else {
      stderr.push(`test-removal-gate: 忽略讀不懂的收據 ${e.path}：${parsed.error}`)
    }
  }
  return { receipts, unsupported }
}

/** 收據在判定中「指到」這個 target 的程度：failed===2（沒作證）不算指到。 */
function rank(v: ValidityResult): number {
  if (v.failed === 'exemption') return 2.5
  return typeof v.failed === 'number' ? v.failed : 0
}

function runnerFor(snap: Snapshot, file: string): string {
  const text = snap.readBase(file) ?? snap.readHead(file) ?? ''
  return /from\s+['"](?:vitest|vite-plus(?:\/test)?)['"]/.test(text) ? 'vitest' : 'node-test'
}

export function evaluate(snap: Snapshot, ctx: GateContext): GateResult {
  const stdout: string[] = []
  const stderr: string[] = []

  const collected = collectTargets(snap)
  stderr.push(...collected.warnings)
  if (collected.targets.length === 0) return { exitCode: 0, stdout, stderr }

  const { receipts, unsupported } = loadReceipts(snap, stderr)
  if (unsupported.length > 0) {
    for (const u of unsupported) stderr.push(`test-removal-gate: 收據版本不支援 — ${u}`)
    return { exitCode: 2, stdout, stderr }
  }

  const listingCache = new Map<string, TestCaseListing | null>()
  const headListing = (file: string): TestCaseListing | null => {
    if (!listingCache.has(file)) {
      const text = snap.readHead(file)
      listingCache.set(file, text === null ? null : listTestCases(text, file))
    }
    return listingCache.get(file)!
  }

  const change: ReceiptChange = {
    changedReceiptIds: new Set(receipts.map((r) => r.receipt.receipt_id)),
    deletedFiles: collected.deletedFiles,
    indeterminateFiles: collected.indeterminateFiles,
    deletedCases: collected.deletedCases,
    headTestNames: (file) => {
      const l = headListing(file)
      return l === null || l.indeterminate ? null : l.names
    },
    headBlobSha: snap.headBlobSha,
    headFileExists: (path) => snap.headBlobSha(path) !== null,
  }

  let blocked = false
  const block = (t: Target, code: string, detail = ''): void => {
    blocked = true
    stdout.push(`block ${t.file} > ${t.name} — ${code}${detail ? ` ${detail}` : ''}`)
  }

  // 有效性 6 的結果依 receipt_id 快取（一張收據可能替多個 target 作證）
  const replayCache = new Map<string, ReplayResult>()
  const replayOf = (r: LoadedReceipt): ReplayResult => {
    let res = replayCache.get(r.receipt.receipt_id)
    if (!res) {
      res = ctx.replay!(r.path, r.receipt.receipt_id)
      replayCache.set(r.receipt.receipt_id, res)
    }
    return res
  }

  for (const t of collected.targets) {
    const vouch: Vouch = { file: t.file, test: t.name }
    const verdicts = receipts.map((r) => ({ r, v: validateReceipt(r.receipt, vouch, change) }))
    const valid = verdicts.filter((x) => x.v.valid)

    if (valid.length === 0) {
      const vouching = verdicts.filter((x) => x.v.failed !== 2)
      if (vouching.length === 0) {
        const runner = runnerFor(snap, t.file)
        block(
          t,
          'missing-receipt',
          `${ctx.probeCmd} run --runner ${runner} --test <接手測試> --mutation '<產品檔>::<原文>::<替換>' --vouch '${t.file}::${t.name}' --write-receipts`,
        )
        continue
      }
      const worst = vouching.reduce((a, b) => (rank(b.v) > rank(a.v) ? b : a))
      if (worst.v.failed === 'exemption') block(t, 'invalid-exemption', worst.v.reason)
      else block(t, `invalid-receipt:${worst.v.failed}`, worst.v.reason)
      continue
    }

    // 豁免一律列出（供 0-A 複核功能是否真的不在）
    const exemptions = valid.filter((x) => x.r.receipt.kind === 'exemption')
    const mutations = valid.filter((x) => x.r.receipt.kind === 'mutation')
    for (const x of exemptions) {
      const e = x.r.receipt
      if (e.kind !== 'exemption') continue
      stdout.push(`exempt ${t.file} > ${t.name} — ${e.exemption} ${e.reason}`)
      if (e.exemption === 'feature-removed' && e.removed_paths?.length) {
        stderr.push(
          `  exempt ${t.file}：宣稱同改動移除 ${e.removed_paths.join('、')}（真偽由 0-A 複核）`,
        )
      }
      if (e.ref) stderr.push(`  exempt ${t.file}：ref ${e.ref}`)
    }
    if (mutations.length === 0) continue

    // 有效性 6：僅 CI（--against）。任一張收據重跑仍 caught 即可。
    if (!ctx.replay) {
      stdout.push(`pass ${t.file} > ${t.name} — receipt ${mutations[0]!.r.receipt.receipt_id}`)
      continue
    }
    const attempts = mutations.map((x) => ({ x, res: replayOf(x.r) }))
    const good = attempts.find((a) => a.res.ok && a.res.replayed === 'caught')
    if (good) {
      stdout.push(`pass ${t.file} > ${t.name} — receipt ${good.x.r.receipt.receipt_id}`)
      continue
    }
    const res = attempts[0]!.res
    if ('reason' in res) {
      block(t, 'replay-unavailable', res.reason)
    } else {
      block(t, 'replay-mismatch', `recorded=${res.recorded} replayed=${res.replayed}`)
    }
  }

  if (blocked) {
    stderr.push(
      '',
      '  被刪或被合併的測試不能憑「我覺得重複」放行：需要一張有效收據證明它保護的行為仍有測試守著。',
      `    1. 在「留下的」測試上，對被刪那支保護的產品碼做一個突變並跑探針（上列指令，--vouch 指名被刪的測試）；`,
      '       收據寫進 .clade/break-receipts/，和這次改動一起 commit（不要手改收據）。',
      '    2. 合併時兩支原測試各要一張，且兩張收據轉紅的都得是合併後那支。',
      '    3. 收據產生後又改了產品碼 → 收據過期，重跑探針。',
      `    4. 只有兩種豁免：功能整個移除 → ${ctx.probeCmd} exempt --kind feature-removed --reason <說明> --removed <產品檔> --vouch '<檔>::*'；`,
      `       走舊測試吸收路徑 → ${ctx.probeCmd} exempt --kind bdd-remove --reason <說明> --ref <specs/plans/<id>/tasks.md#T<nnn>> --vouch '<檔>::*'。`,
    )
  }
  return { exitCode: blocked ? 1 : 0, stdout, stderr }
}

// ───────────────────────── git ─────────────────────────

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

/** `git diff --name-status -M -z` 輸出 → DiffEntry。 */
export function parseNameStatus(raw: string | null): DiffEntry[] {
  const parts = (raw ?? '').split('\0').filter(Boolean)
  const entries: DiffEntry[] = []
  for (let i = 0; i < parts.length;) {
    const status = parts[i++]!
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = parts[i++]!
      entries.push({ status, oldPath, path: parts[i++]! })
    } else {
      entries.push({ status, path: parts[i++]! })
    }
  }
  return entries
}

/** 從 git 組出 Snapshot；回 `{ error }` 代表讀不到 git（exit 2）。 */
export function collect(root: string, mode: Mode): Snapshot | { error: string } {
  if ('staged' in mode) {
    const hasHead = git(root, ['rev-parse', '-q', '--verify', 'HEAD']) !== null
    const raw = git(root, ['diff', '--cached', '--name-status', '-M', '-z'])
    if (raw === null) return { error: 'git diff --cached 失敗' }
    const snap: Snapshot = {
      // 首次 commit（沒有 HEAD）沒有 base，不可能有東西被刪
      entries: hasHead ? parseNameStatus(raw) : [],
      readBase: (p) => git(root, ['show', `HEAD:${p}`]),
      readHead: (p) => git(root, ['show', `:${p}`]),
      headBlobSha: (p) => git(root, ['rev-parse', '-q', '--verify', `:${p}`])?.trim() || null,
    }
    // merge 進行中：staged diff（vs HEAD）含上游帶入的刪除，交給判定 1 的 merge 例外扣掉。
    // octopus merge 只看第一個 head；其餘 head 帶入的刪除照常要收據（偏擋不偏放）。
    const mergeHead = hasHead
      ? git(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])?.trim()
      : ''
    const mergeBase = mergeHead ? git(root, ['merge-base', 'HEAD', mergeHead])?.trim() : ''
    if (mergeHead && mergeBase) {
      snap.merge = {
        readMergeBase: (p) => git(root, ['show', `${mergeBase}:${p}`]),
        readMergeHead: (p) => git(root, ['show', `${mergeHead}:${p}`]),
      }
    }
    return snap
  }
  const base = git(root, ['merge-base', 'HEAD', mode.against])?.trim() ?? ''
  if (!base) return { error: `cannot resolve merge-base(HEAD, ${mode.against})` }
  const raw = git(root, ['diff', '--name-status', '-M', '-z', base, 'HEAD'])
  if (raw === null) return { error: `git diff ${base} HEAD 失敗` }
  return {
    entries: parseNameStatus(raw),
    readBase: (p) => git(root, ['show', `${base}:${p}`]),
    readHead: (p) => git(root, ['show', `HEAD:${p}`]),
    headBlobSha: (p) => git(root, ['rev-parse', '-q', '--verify', `HEAD:${p}`])?.trim() || null,
  }
}

// ───────────────────────── replay（有效性 6） ─────────────────────────

/** 探針指令前綴：優先 repo 相對路徑（clade 佈局 `vendor/scripts/…`、consumer 佈局 `scripts/…`），repo 外用絕對路徑。 */
export function probeCommandFor(root: string, probeScript: string): string {
  const rel = relative(root, probeScript)
  const shown = rel === '' || rel.startsWith('..') || isAbsolute(rel) ? probeScript : rel
  return `node ${shown.split('\\').join('/')}`
}

/**
 * `mutation-probe.ts replay --json` 的 stdout → 該收據那一筆。
 * 契約（mutation-probe-cli.md § 2）只有一種形狀：
 * `{ "format_version": 1, "replays": [ { receipt_id, recorded, replayed, match } ] }`；其他形狀一律讀不懂（null）。
 */
export function pickReplayEntry(
  stdout: string,
  receiptId: string,
): { recorded: string; replayed: string } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  if (o.format_version !== 1 || !Array.isArray(o.replays)) return null
  for (const e of o.replays as unknown[]) {
    if (!e || typeof e !== 'object') continue
    const r = e as Record<string, unknown>
    if (
      r.receipt_id === receiptId &&
      typeof r.recorded === 'string' &&
      typeof r.replayed === 'string'
    ) {
      return { recorded: r.recorded, replayed: r.replayed }
    }
  }
  return null
}

export function makeReplayer(root: string, probeScript: string): Replayer {
  return (receiptPath, receiptId) => {
    const r = spawnSync(process.execPath, [probeScript, 'replay', receiptPath, '--json'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    })
    if (r.error) return { ok: false, reason: `無法執行 mutation-probe replay：${r.error.message}` }
    // exit 0／1 是「重跑完成」（全部 caught／有不是 caught 的）；2 起一律是工具不可用，不判放行
    if (r.status !== 0 && r.status !== 1) {
      const firstLine = (r.stderr ?? '').split('\n').find((l) => l.trim()) ?? ''
      return {
        ok: false,
        reason: `mutation-probe replay exit ${r.status}${firstLine ? `：${firstLine.trim()}` : ''}`,
      }
    }
    const entry = pickReplayEntry(r.stdout ?? '', receiptId)
    if (!entry)
      return {
        ok: false,
        reason:
          'mutation-probe replay 的 --json 輸出讀不懂（預期 { format_version: 1, replays: [...] }）',
      }
    return { ok: true, recorded: entry.recorded, replayed: entry.replayed }
  }
}

// ───────────────────────── CLI ─────────────────────────

const USAGE = 'usage: test-removal-gate (--staged | --against <ref>) [--root <dir>]'

export interface CliIo {
  stdout: (s: string) => void
  stderr: (s: string) => void
  cwd: string
}

/** 回傳 exit code，不碰 process.exit：測試 in-process 呼叫，CLI 入口（invokedAsCli）才轉成 exit。 */
export function main(args: string[], io: CliIo): number {
  const rootIdx = args.indexOf('--root')
  const root =
    rootIdx >= 0 ? args[rootIdx + 1] : (git(io.cwd, ['rev-parse', '--show-toplevel'])?.trim() ?? '')
  const againstIdx = args.indexOf('--against')
  const mode: Mode | null = args.includes('--staged')
    ? { staged: true }
    : againstIdx >= 0 && args[againstIdx + 1]
      ? { against: args[againstIdx + 1]! }
      : null
  if (!root || !mode) {
    io.stderr(`${USAGE}\n`)
    return 2
  }

  const snap = collect(root, mode)
  if ('error' in snap) {
    io.stderr(`test-removal-gate: ${snap.error}\n`)
    return 2
  }

  const probeScript = join(here, '..', 'mutation-probe.ts')
  const result = evaluate(snap, {
    mode,
    probeCmd: probeCommandFor(root, probeScript),
    replay: 'against' in mode ? makeReplayer(root, probeScript) : undefined,
  })
  for (const line of result.stdout) io.stdout(`${line}\n`)
  for (const line of result.stderr) io.stderr(`${line}\n`)
  return result.exitCode
}

function invokedAsCli(): boolean {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

// 不用 process.exit：stdout 接 pipe 時 exit 會截斷尚未寫完的輸出。
if (invokedAsCli()) {
  process.exitCode = main(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    cwd: process.cwd(),
  })
}
