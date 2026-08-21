#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/checks/utable-slot-detect.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/checks/utable-slot-detect.ts
// CLADE:VENDOR-SCRIPT
/**
 * Nuxt UI UTable cell-slot detector — 單一真相偵測器。
 *
 * 根因：`UTable`（@nuxt/ui 4.x）的 cell renderer slot **MUST** 命名為
 * `#<accessorKey>-cell="{ row }"`。漏掉 `-cell` 後綴時 Vue 照樣接受該 template
 * （它是合法的具名 slot），但 Nuxt UI 不會把它當 cell renderer —— 該欄靜默回退成
 * 預設渲染。typecheck / lint / console 全綠，只有肉眼看畫面才會發現。
 *
 * 與 nuxt-ui-mixed-slot 同一個 failure class：靜默視覺回退，機械層以外抓不到。
 *
 * ⚠️ 帶 `{ row }` 的 slot 不必然是 cell slot —— consumer 自家 wrapper 元件
 *    （如 <consumer-a> `AppDataTable` 的 `#mobile-card`）也會解構 `row`。因此偵測範圍
 *    **只限 `<UTable>…</UTable>` 區塊內**；STRUCTURAL_SLOTS 再排掉 UTable 自身的
 *    非 accessorKey slot，**不可**當成「已知違規的豁免清單」拿來塞繞過用。
 *
 * 被三處共用（single source of truth）：
 *   - vendor/scripts/pre-commit/checks/utable-slots.sh（staged，blocking）
 *   - vendor/scripts/pre-push/checks/utable-slots.sh（全 repo，blocking — fleet 基線 0 hit）
 *   - ad-hoc cross-consumer 盤點（--all）
 *
 * CLI:
 *   node utable-slot-detect.mjs <file.vue> [file2.vue ...]   # 指定檔案
 *   node utable-slot-detect.mjs --all [--root <dir>]         # 走訪預設 app roots
 *   node utable-slot-detect.mjs --all --roots <dir>...       # 覆寫掃描 root
 *   node utable-slot-detect.mjs --mode staged <files...>     # 標註呼叫端的取檔模式
 *   node utable-slot-detect.mjs --warn-only <files...>       # 命中不 exit 1
 *
 * `--roots` 是**覆寫**用；不傳時預設 root 涵蓋 monorepo（`packages` 遞迴）——
 * NEVER 把預設縮回 `app` / `layers`，那會讓 monorepo consumer 一個檔都沒掃卻報 pass。
 *
 * Exit code：命中且非 --warn-only → 1；讀檔失敗 → 2（infrastructure error）；否則 0。
 * 輸出契約見 rules/core/checker-contract.md § REQUIRED output contract。
 *
 * 由 ~/clade vendor/scripts/checks/ 散播，請勿直接編輯 consumer 副本。
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 預設掃描 root。`packages` 為遞迴走訪，涵蓋 monorepo 的 packages/<pkg>/app。 */
const DEFAULT_APP_ROOTS = ['app', 'layers', 'template/app', 'packages']

/**
 * UTable 自身的結構性 slot（非 accessorKey），這些不需要 `-cell` 後綴。
 * 只列 UTable API 上真實存在、且 slot props 會帶 `row` 的名稱。
 */
const STRUCTURAL_SLOTS = new Set(['default', 'expanded', 'empty', 'loading', 'caption', 'body'])

/** UTable 區塊。self-closing `<UTable />` 沒有 slot，不需匹配。 */
const UTABLE_BLOCK_RE = /<UTable\b[^>]*>([\s\S]*?)<\/UTable>/g

/** `<template #<name>="{ row ...` —— 名稱允許 dash（accessorKey 可為 kebab-case）。 */
const SLOT_RE = /<template\s+#([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*["']\{\s*row\b/g

const SKIPPED_DESC =
  'node_modules, dot-directories, non-.vue files, slots outside <UTable> blocks, UTable structural slots'
const CHECKER = 'utable-slots'

/**
 * 掃單一 .vue 原始碼，回傳缺 `-cell` 後綴的 UTable cell slot。
 *
 * **只掃 `<UTable>…</UTable>` 區塊內**的 slot。帶 `{ row }` 的 slot 在 UTable 之外
 * 是合法的（consumer 自家 wrapper 元件如 `AppDataTable` 的 `#mobile-card`），對整份
 * 檔案掃描會把那些全報成違規——實測 <consumer-a> 一家就 20+ 個 false positive。
 *
 * @param {string} src
 * @returns {{ line: number, slot: string, text: string }[]}
 */
export function detectUTableSlots(src) {
  const findings = []
  const lines = src.split('\n')
  UTABLE_BLOCK_RE.lastIndex = 0
  let block
  while ((block = UTABLE_BLOCK_RE.exec(src)) !== null) {
    const innerStart = block.index + block[0].indexOf(block[1])
    SLOT_RE.lastIndex = 0
    let m
    while ((m = SLOT_RE.exec(block[1])) !== null) {
      const slot = m[1]
      if (slot.endsWith('-cell')) continue
      if (STRUCTURAL_SLOTS.has(slot)) continue
      const line = countLines(src, innerStart + m.index)
      findings.push({ line, slot, text: (lines[line - 1] ?? '').trim() })
    }
  }
  return findings
}

/** offset → 1-based 行號。 */
function countLines(src, offset) {
  let line = 1
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === '\n') line += 1
  }
  return line
}

function* walkVueFiles(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walkVueFiles(p)
    else if (e.name.endsWith('.vue')) yield p
  }
}

/** 讀 `--roots a b c` 形式的多值選項（讀到下一個 `--` 開頭為止）。 */
function readOptionValues(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) return []
  const values = []
  for (let i = index + 1; i < argv.length && !argv[i].startsWith('--'); i++) values.push(argv[i])
  return values
}

/** 讀 `--root <dir>` 形式的單值選項——多吃一個值會把後面的檔案參數當成選項值吞掉。 */
function readOptionValue(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  const value = argv[index + 1]
  return value === undefined || value.startsWith('--') ? undefined : value
}

/**
 * 依 checker-contract § REQUIRED output contract 印三行標頭。
 * @param {'pass'|'finding'|'N/A'|'infrastructure-error'} status
 * @param {{ roots: string, mode: string }} meta
 */
function report(status, { roots, mode }) {
  process.stderr.write(
    `${CHECKER}: ${status}\n` +
      `scope: roots=${roots}; patterns=UTable cell slots (missing -cell suffix); mode=${mode}\n` +
      `skipped: ${SKIPPED_DESC}\n`,
  )
}

function main() {
  const argv = process.argv.slice(2)
  const warnOnly = argv.includes('--warn-only')
  const all = argv.includes('--all')
  const rootFlag = readOptionValue(argv, '--root')
  const base = rootFlag ?? process.cwd()
  const modeFlag = readOptionValue(argv, '--mode')

  const optionValues = new Set(
    [rootFlag, modeFlag, ...readOptionValues(argv, '--roots')].filter(Boolean),
  )

  let files = []
  let roots
  const mode = modeFlag ?? 'filesystem'
  if (all) {
    const overrides = readOptionValues(argv, '--roots')
    const scanRoots = overrides.length > 0 ? overrides : DEFAULT_APP_ROOTS
    const present = []
    for (const rel of scanRoots) {
      const path = join(base, rel)
      if (!existsSync(path) || !statSync(path).isDirectory()) continue
      present.push(path)
      files.push(...walkVueFiles(path))
    }
    roots = present.length > 0 ? present.join(', ') : `(none of: ${scanRoots.join(', ')})`
    if (present.length === 0) {
      report('N/A', { roots, mode })
      return
    }
  } else {
    files = argv.filter((a) => a.endsWith('.vue') && !optionValues.has(a))
    roots = `explicit file list (${files.length} file${files.length === 1 ? '' : 's'})`
    if (files.length === 0) {
      report('N/A', { roots, mode })
      return
    }
  }

  const findings = []
  for (const file of files) {
    let src
    try {
      src = readFileSync(file, 'utf8')
    } catch (err) {
      // checker-contract § Fail-closed Iron Law：讀不到就報 infrastructure error，
      // NEVER 靜默 continue 當成「沒有 finding」。
      report('infrastructure-error', { roots, mode })
      process.stderr.write(`[${CHECKER}] 讀取失敗：${file} — ${err.message}\n`)
      process.exit(2)
    }
    for (const finding of detectUTableSlots(src)) findings.push({ file, ...finding })
  }

  report(findings.length > 0 ? 'finding' : 'pass', { roots, mode })

  if (findings.length > 0) {
    process.stderr.write(
      `[${CHECKER}] UTable cell slot 缺少 -cell 後綴（該欄會靜默回退成預設渲染）：\n`,
    )
    for (const f of findings) {
      process.stderr.write(`  ${f.file}:${f.line}  #${f.slot} → 應為 #${f.slot}-cell\n`)
      process.stderr.write(`    ${f.text}\n`)
    }
    process.stderr.write(
      `\n命名規則：#<accessorKey>-cell，例 <template #actions-cell="{ row }">。\n` +
        `若該 slot 是 UTable 自身的結構性 slot（非 accessorKey），把名稱加進 detector 的 STRUCTURAL_SLOTS。\n`,
    )
  }

  if (findings.length > 0 && !warnOnly) process.exit(1)
}

main()
