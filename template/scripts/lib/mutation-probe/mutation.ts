// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/mutation-probe/mutation.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/mutation-probe/mutation.ts
// CLADE:VENDOR-SCRIPT
//
// mutation-probe/mutation — 突變規格解析、`not-applicable` 前置判定、`site_scope`
//
// 契約：specs/truth/contracts/mutation-probe-cli.md § 1（輸入、前置判定）、
//       specs/truth/data/break-receipt.md（`na_reason`、`site_scope`）。
//
// `site_scope` 用 `typescript` AST 判突變點是否在函式本體內；`typescript` 從 consumer 自己的
// node_modules 解析，讀不到時一律 `unknown`（不誤報成 module-level）。
//
// 由 ~/clade vendor/scripts/lib/ 散播，請勿直接編輯 consumer 副本。

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join } from 'node:path'

import { isTestPath } from '../../checks/source-assert-detect.ts'
import { findOccurrence } from './mutation-core.mjs'
import type { MutationSpec, NaReason, SiteScope } from './receipt.ts'

/** 呼叫者給的突變（尚未判 `site_scope`）。 */
export interface MutationInput {
  id: string | null
  file: string
  from: string
  to: string
  /** 1 起算。 */
  occurrence: number
  description?: string
}

export interface ParseMutationResult {
  ok: boolean
  mutation?: MutationInput
  error?: string
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * `--mutation <file>::<from>::<to>[::<occurrence>][::<id>]`。
 * 第四欄是正整數 → occurrence；否則 → id（occurrence=1）。五欄＝occurrence 與 id。
 * `to` 可為空字串（刪除）；`from` 或 `to` 含 `::` 的突變改用 `--mutations` JSON。
 */
export function parseMutationFlag(raw: string): ParseMutationResult {
  const parts = raw.split('::')
  if (parts.length < 3)
    return { ok: false, error: `--mutation 至少要 <file>::<from>::<to>：${raw}` }
  if (parts.length > 5) {
    return {
      ok: false,
      error: `--mutation 欄位過多（from／to 含 "::" 請改用 --mutations JSON）：${raw}`,
    }
  }
  const [file, from, to, f4, f5] = parts
  if (file === '') return { ok: false, error: `--mutation 缺 file：${raw}` }
  if (from === '') return { ok: false, error: `--mutation 的 from 不可空：${raw}` }

  let occurrence = 1
  let id: string | null = null
  const isPosInt = (s: string) => /^[1-9]\d*$/.test(s)
  if (parts.length === 4) {
    if (isPosInt(f4)) occurrence = Number(f4)
    else id = f4 === '' ? null : f4
  } else if (parts.length === 5) {
    if (!isPosInt(f4)) return { ok: false, error: `--mutation 的 occurrence 必須是正整數：${f4}` }
    occurrence = Number(f4)
    id = f5 === '' ? null : f5
  }
  return { ok: true, mutation: { id, file: toPosix(file), from, to, occurrence } }
}

export interface ParseMutationsResult {
  ok: boolean
  mutations?: MutationInput[]
  error?: string
}

/** `--mutations <json>`：陣列，元素 `file`、`from`、`to` 必填（`to` 可空字串），`occurrence` 預設 1。 */
export function parseMutationsJson(text: string): ParseMutationsResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `--mutations 不是合法 JSON：${(e as Error).message}` }
  }
  if (!Array.isArray(raw)) return { ok: false, error: '--mutations 必須是 JSON 陣列' }
  const out: MutationInput[] = []
  for (const [i, el] of raw.entries()) {
    const at = `--mutations[${i}]`
    if (typeof el !== 'object' || el === null || Array.isArray(el)) {
      return { ok: false, error: `${at} 不是物件` }
    }
    const e = el as Record<string, unknown>
    if (typeof e.file !== 'string' || e.file === '') return { ok: false, error: `${at} 缺 file` }
    if (typeof e.from !== 'string' || e.from === '') return { ok: false, error: `${at} 缺 from` }
    if (typeof e.to !== 'string') return { ok: false, error: `${at} 缺 to（刪除請給空字串）` }
    let occurrence = 1
    if (e.occurrence !== undefined) {
      if (!Number.isInteger(e.occurrence) || (e.occurrence as number) < 1) {
        return { ok: false, error: `${at}.occurrence 必須是正整數` }
      }
      occurrence = e.occurrence as number
    }
    if (e.id !== undefined && typeof e.id !== 'string')
      return { ok: false, error: `${at}.id 不是字串` }
    if (e.description !== undefined && typeof e.description !== 'string') {
      return { ok: false, error: `${at}.description 不是字串` }
    }
    const m: MutationInput = {
      id: (e.id as string | undefined) ?? null,
      file: toPosix(e.file),
      from: e.from,
      to: e.to,
      occurrence,
    }
    if (e.description !== undefined) m.description = e.description as string
    out.push(m)
  }
  return { ok: true, mutations: out }
}

// ───────────────────────── 替換（load hook 與 transform plugin 共用語意）─────────────────────────

// 實作在零 import 的 mutation-core.mjs（load-hook.mjs 也 import 它）：替換語意只有一份。
// `applyMutation` 的 `m` 只用 `from`／`to`／`occurrence`（MutationInput 的子集）。
export { applyMutation, findOccurrence } from './mutation-core.mjs'

// ───────────────────────── not-applicable 前置判定 ─────────────────────────

/**
 * 前置判定（FR-005）：回 `na_reason` 或 null（可以跑）。
 * 順序：`target-is-test`（只看路徑）→ `target-missing`（檔案不在）→ `target-not-found`（`from` 第 n 處不存在）。
 * `isTestPath` 與 `source-assert-detect.ts` 同一份。
 */
export function judgeApplicability(root: string, m: MutationInput): NaReason | null {
  if (isTestPath(m.file)) return 'target-is-test'
  const abs = join(root, m.file)
  if (!existsSync(abs)) return 'target-missing'
  const source = readFileSync(abs, 'utf8')
  if (findOccurrence(source, m.from, m.occurrence) < 0) return 'target-not-found'
  return null
}

// ───────────────────────── site_scope ─────────────────────────

type TsApi = typeof import('typescript')

let tsCache: TsApi | null | undefined

/** 從呼叫端 repo 的 node_modules 取 `typescript`；取不到回 null。 */
export function loadTypescript(): TsApi | null {
  if (tsCache !== undefined) return tsCache
  try {
    tsCache = createRequire(import.meta.url)('typescript') as TsApi
  } catch {
    tsCache = null
  }
  return tsCache
}

/**
 * SourceFile 帶語法錯誤嗎？`parseDiagnostics` 是 TypeScript 的內部欄位（沒進公開型別），
 * 所以從 unknown 起手用守衛讀，不靠斷言鏈宣稱形狀。
 */
export function hasParseDiagnostics(sf: unknown): boolean {
  if (typeof sf !== 'object' || sf === null) return false
  const diagnostics: unknown = Reflect.get(sf, 'parseDiagnostics')
  return Array.isArray(diagnostics) && diagnostics.length > 0
}

function scriptKindFor(ts: TsApi, file: string) {
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
 * 突變點（`from` 的第 `occurrence` 處整段）是否在任何函式本體內。
 * - 在函式（宣告／運算式／箭頭／方法／建構子／存取子）的本體或參數預設值內 → `function-body`
 *   （每次呼叫才求值）；非 static 的 class 屬性初始化也算（每個實例才求值）。
 * - 其餘（含整段剛好是一個函式定義）→ `module-level`（載入時求值一次）。
 * - 讀不到 `typescript`、副檔名不是 JS／TS、語法解析有錯、找不到 `from` → `unknown`。
 */
export function siteScope(source: string, m: MutationInput): SiteScope {
  const ts = loadTypescript()
  if (!ts) return 'unknown'
  const kind = scriptKindFor(ts, m.file)
  if (kind === null) return 'unknown'
  const start = findOccurrence(source, m.from, m.occurrence)
  if (start < 0) return 'unknown'
  const end = start + m.from.length

  const sf = ts.createSourceFile(m.file, source, ts.ScriptTarget.Latest, true, kind)
  if (hasParseDiagnostics(sf)) return 'unknown'

  const within = (n: import('typescript').Node) => n.getStart(sf) <= start && end <= n.end
  let found: SiteScope = 'module-level'

  const visit = (node: import('typescript').Node): void => {
    if (found === 'function-body' || node.end < start || node.getStart(sf) > end) return
    if (
      ts.isFunctionLike(node) &&
      (node as import('typescript').FunctionLikeDeclaration).body !== undefined
    ) {
      const fn = node as import('typescript').FunctionLikeDeclaration
      if (within(fn.body) || fn.parameters.some((p) => within(p))) {
        found = 'function-body'
        return
      }
    }
    if (
      ts.isPropertyDeclaration(node) &&
      node.initializer &&
      !node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword) &&
      within(node.initializer)
    ) {
      found = 'function-body'
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** 組 `MutationSpec`（含 `site_scope`）。檔案讀不到或 `from` 不存在時 `site_scope=unknown`。 */
export function toMutationSpec(root: string, m: MutationInput): MutationSpec {
  const abs = join(root, m.file)
  let scope: SiteScope = 'unknown'
  if (existsSync(abs)) scope = siteScope(readFileSync(abs, 'utf8'), m)
  const spec: MutationSpec = {
    id: m.id,
    file: m.file,
    from: m.from,
    to: m.to,
    occurrence: m.occurrence,
    site_scope: scope,
  }
  if (m.description !== undefined) spec.description = m.description
  return spec
}
