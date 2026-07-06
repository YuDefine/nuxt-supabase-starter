#!/usr/bin/env node
// CLADE:VENDOR-SCRIPT
/**
 * Pinia Colada mutation-status-as-loading detector — 單一真相偵測器。
 *
 * 根因：`@pinia/colada` 的 `useMutation()` 回傳的 `status`（'pending' | 'success' | 'error'）是
 * data-state，component mount 當下就是 'pending'（還沒呼叫過、沒 data），與有沒有執行無關。
 * 拿它當 loading → 按鈕 / spinner 一進頁面就永久 loading。typecheck 全綠、不發 request。
 * 正解：mutation loading 用 `isLoading` / `asyncStatus === 'loading'`。
 *
 * ⚠️ query 的 `status === 'pending'`（首載無資料）是對的，不算違規。本 detector 只認
 *    「alias 來源自 use*Mutation()」或「物件名帶 Mutation」的 status === 'pending'。
 *
 * 被三處共用（single source of truth）：
 *   - scripts/audit-pinia-mutation-loading.mjs（clade-home cross-consumer 盤點）
 *   - vendor/scripts/pre-commit/checks/mutation-loading.sh（staged，blocking）
 *   - vendor/scripts/pre-push/checks/mutation-loading.sh（全 repo，warn-only）
 *
 * 相對於舊 audit 內嵌 heuristic 的關鍵修正：**支援跨行 destructuring**。
 *   const { mutateAsync: completeMutate, status: completeStatus } =
 *       useCompleteStocktakeSessionMutation()
 * 舊版要求 `status:` 與 `Mutation(` 同一行 → 漏抓；新版對整份 src 做 multi-line 掃描。
 *
 * CLI:
 *   node mutation-loading-detect.mjs <file.vue> [file2.vue ...]   # 指定檔案
 *   node mutation-loading-detect.mjs --all [--root <dir>]         # 走訪 app root
 *   node mutation-loading-detect.mjs --warn-only <files...>       # 命中不 exit 1
 *
 * Exit code：命中且非 --warn-only → 1；否則 0。
 *
 * 由 ~/clade vendor/scripts/checks/ 散播，請勿直接編輯 consumer 副本。
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const APP_ROOTS = ['app', 'template/app']
const MONOREPO_GLOB = 'packages' // packages/*/app

/**
 * 抽出「來自 use*Mutation() 解構的 status alias」名單。支援跨行 destructuring。
 * @param {string} src
 * @returns {Set<string>} alias 名（含未改名的 `status` 本身）
 */
export function mutationStatusAliases(src) {
  const aliases = new Set()
  // const|let { ...任意（可跨行，不跨 }） } = use<X>Mutation(
  const re = /(?:const|let)\s*\{([^}]*)\}\s*=\s*use[A-Za-z0-9_$]*Mutation\s*\(/gs
  let m
  while ((m = re.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const p = part.trim()
      if (!p) continue
      // "status: alias" → alias ; 裸 "status" → status
      const mm = p.match(/^(\w+)\s*(?::\s*(\w+))?/)
      if (mm && mm[1] === 'status') aliases.add(mm[2] || mm[1])
    }
  }
  return aliases
}

/**
 * 抽出「object-form mutation 變數」名單：const del = useDeleteMutation()
 * @param {string} src
 * @returns {Set<string>}
 */
export function mutationObjectVars(src) {
  const vars = new Set()
  const re = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*use[A-Za-z0-9_$]*Mutation\s*\(/g
  let m
  while ((m = re.exec(src)) !== null) vars.add(m[1])
  return vars
}

/**
 * 偵測單檔內所有 mutation status === 'pending' 當 loading 的命中行。
 * @param {string} src
 * @returns {Array<{line:number, text:string, kind:'alias'|'object'}>}
 */
export function detectFile(src) {
  const hits = []
  const aliases = mutationStatusAliases(src)
  const objs = mutationObjectVars(src)
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 形式 A：destructured alias —— xStatus(.value)? === 'pending'
    let matched = false
    for (const a of aliases) {
      if (new RegExp(`\\b${a}(?:\\.value)?\\s*===\\s*['"]pending['"]`).test(line)) {
        hits.push({ line: i + 1, text: line.trim(), kind: 'alias' })
        matched = true
        break
      }
    }
    if (matched) continue
    // 形式 B：object-form —— someMutation.status(.value)? === 'pending'
    for (const o of objs) {
      if (new RegExp(`\\b${o}\\.status(?:\\.value)?\\s*===\\s*['"]pending['"]`).test(line)) {
        hits.push({ line: i + 1, text: line.trim(), kind: 'object' })
        break
      }
    }
  }
  return hits
}

// 走訪 app root 底下所有 .vue（含 monorepo packages/*/app）
function walkVue(dir, acc = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.nuxt' || e.name === '.output') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) walkVue(full, acc)
    else if (e.name.endsWith('.vue')) acc.push(full)
  }
  return acc
}

export function resolveAppRoots(consumerRoot) {
  const roots = []
  for (const sub of APP_ROOTS) {
    const p = join(consumerRoot, sub)
    if (existsSync(p)) roots.push(p)
  }
  const pkgDir = join(consumerRoot, MONOREPO_GLOB)
  if (existsSync(pkgDir)) {
    for (const e of readdirSync(pkgDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const p = join(pkgDir, e.name, 'app')
      if (existsSync(p)) roots.push(p)
    }
  }
  return roots
}

// ---- CLI ----
function isMain() {
  return process.argv[1] && process.argv[1].endsWith('mutation-loading-detect.mjs')
}

if (isMain()) {
  const argv = process.argv.slice(2)
  const warnOnly = argv.includes('--warn-only')
  const useAll = argv.includes('--all')
  let root = process.cwd()
  const rootIdx = argv.indexOf('--root')
  if (rootIdx !== -1 && argv[rootIdx + 1]) root = argv[rootIdx + 1]
  // --root 的 value index（無 --root 時為 -1，避免誤把 argv[0] 當 root value 濾掉檔案）
  const rootValIdx = rootIdx === -1 ? -1 : rootIdx + 1

  let files = argv.filter((a, i) => !a.startsWith('--') && i !== rootValIdx)
  if (useAll) {
    files = resolveAppRoots(root).flatMap((r) => walkVue(r))
  }

  const violations = []
  for (const f of files) {
    if (!f.endsWith('.vue')) continue
    let src
    try {
      src = readFileSync(f, 'utf8')
    } catch {
      continue
    }
    for (const h of detectFile(src)) violations.push({ file: f, ...h })
  }

  if (violations.length > 0) {
    const label = warnOnly ? '⚠️' : '❌'
    process.stderr.write(
      `${label} mutation 的 status === 'pending' 當 loading（按鈕永久 spinner 的靜默 bug）：\n`,
    )
    for (const v of violations) {
      process.stderr.write(`  ${v.file}:${v.line}  ${v.text}\n`)
    }
    process.stderr.write(
      `\n正解：mutation loading 用 asyncStatus === 'loading' 或 isLoading（execution-state），\n` +
        `      status === 'pending' 是 data-state，mount 當下恆為 true → 永久 loading。\n` +
        `      ⚠️ query 的 status === 'pending'（首載無資料）是對的，不要一起改。\n` +
        `詳細規約：rules/modules/framework/nuxt/page-loading-golden-path.md Tier 2.5\n`,
    )
    process.exit(warnOnly ? 0 : 1)
  }
  process.exit(0)
}
