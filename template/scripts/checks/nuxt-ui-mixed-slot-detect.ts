#!/usr/bin/env node
// CLADE:VENDOR-SCRIPT
/**
 * Nuxt UI mixed-slot detector — 單一真相偵測器。
 *
 * 根因：`UDashboardPanel`（@nuxt/ui 4.x）的 named slots（header/body/footer）是
 * **default slot 的 fallback content**。Vue 編譯規則：component children 混用
 * `<template #named>` 與非 template 元素時，非 template 元素被編譯成 default slot
 * → `slots.default` 存在 → named slots 整組靜默不 render。頁面全空、console 零錯誤、
 * typecheck / lint 全綠（<consumer-b> /reports/daily-machining 空白 18 天實證）。
 *
 * 正解：UDashboardPanel 直接子元素**只能**二擇一 —
 *   (a) 全部 `<template #...>` named slots；或 (b) 全部 default slot 內容。
 *   混用 → 把 stray 元素移進 `<template #body>`（overlay 類移 body 尾端即可，teleport 不受位置影響）。
 *
 * ⚠️ 偵測範圍**只限** fallback 結構元件（目前：UDashboardPanel）。UModal / USlideover /
 *    UDrawer / UPopover 的 default slot 語意是 **trigger**，混用 named slots 是合法用法，
 *    **不可**納入偵測。
 *
 * 被三處共用（single source of truth）：
 *   - vendor/scripts/pre-commit/checks/nuxt-ui-mixed-slot.sh（staged，blocking）
 *   - vendor/scripts/pre-push/checks/nuxt-ui-mixed-slot.sh（全 repo，blocking — fleet 基線 0 hit）
 *   - ad-hoc cross-consumer 盤點（--all）
 *
 * CLI:
 *   node nuxt-ui-mixed-slot-detect.mjs <file.vue> [file2.vue ...]   # 指定檔案
 *   node nuxt-ui-mixed-slot-detect.mjs --all [--root <dir>]         # 走訪預設 app roots
 *   node nuxt-ui-mixed-slot-detect.mjs --all --roots <dir>...       # 覆寫掃描 root
 *   node nuxt-ui-mixed-slot-detect.mjs --mode staged <files...>     # 標註呼叫端的取檔模式
 *   node nuxt-ui-mixed-slot-detect.mjs --warn-only <files...>       # 命中不 exit 1
 *
 * `--roots` 是**覆寫**用；不傳時預設 root 涵蓋 monorepo（`packages` 遞迴）——
 * NEVER 把預設縮回 `app` / `layers`，那會讓 monorepo consumer 一個檔都沒掃卻報 pass。
 *
 * Exit code：命中且非 --warn-only → 1；讀檔失敗 → 2（infrastructure error）；否則 0。
 * 輸出契約見 rules/core/checker-contract.md § REQUIRED output contract。
 *
 * Pitfall: docs/pitfalls/2026-07-06-nuxt-ui-named-slot-default-fallback-shadowing.md（TD-236）
 * 由 ~/clade vendor/scripts/checks/ 散播，請勿直接編輯 consumer 副本。
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** named slots 為 default fallback 的元件清單（勿加 trigger 語意元件） */
const FALLBACK_SLOT_COMPONENTS = ['UDashboardPanel']

const VOID_TAGS = new Set(['input', 'img', 'br', 'hr'])

/** 預設掃描 root。`packages` 為遞迴走訪，涵蓋 monorepo 的 packages/<pkg>/app。 */
const DEFAULT_APP_ROOTS = ['app', 'layers', 'template/app', 'packages']

const SKIPPED_DESC = 'node_modules, dot-directories, non-.vue files'
const CHECKER = 'nuxt-ui-mixed-slot'

/**
 * 抽出某段 template 內容在深度 0 的直接子 tag。
 * AST-lite tokenizer：追蹤 open/close 深度；self-closing（`/>`）與 void tag 不進深度。
 * @param {string} inner
 * @returns {{ name: string, attrs: string }[]}
 */
export function directChildren(inner) {
  const children = []
  let depth = 0
  const tagRe = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
  let m
  while ((m = tagRe.exec(inner)) !== null) {
    const [, closing, name, attrs] = m
    const selfClose = attrs.trimEnd().endsWith('/') || VOID_TAGS.has(name.toLowerCase())
    if (!closing) {
      if (depth === 0) children.push({ name, attrs: attrs.trim() })
      if (!selfClose) depth += 1
    } else {
      depth -= 1
    }
  }
  return children
}

/**
 * 掃單一 .vue 原始碼，回傳違規清單。
 * @param {string} src
 * @returns {{ component: string, stray: string[] }[]}
 */
export function detectMixedSlot(src) {
  const findings = []
  for (const comp of FALLBACK_SLOT_COMPONENTS) {
    const re = new RegExp(`<${comp}\\b[^>]*>([\\s\\S]*?)<\\/${comp}>`, 'g')
    let m
    while ((m = re.exec(src)) !== null) {
      const kids = directChildren(m[1])
      const isNamedTemplate = (k) => k.name === 'template' && k.attrs.includes('#')
      const named = kids.filter(isNamedTemplate)
      const stray = kids.filter((k) => !isNamedTemplate(k))
      if (named.length > 0 && stray.length > 0) {
        findings.push({ component: comp, stray: stray.map((k) => k.name) })
      }
    }
  }
  return findings
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
      `scope: roots=${roots}; patterns=${FALLBACK_SLOT_COMPONENTS.join(', ')}; mode=${mode}\n` +
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
  let mode
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
    mode = modeFlag ?? 'filesystem'
    if (present.length === 0) {
      report('N/A', { roots, mode })
      return
    }
  } else {
    files = argv.filter((a) => a.endsWith('.vue') && !optionValues.has(a))
    roots = `explicit file list (${files.length} file${files.length === 1 ? '' : 's'})`
    mode = modeFlag ?? 'filesystem'
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
    for (const finding of detectMixedSlot(src)) findings.push({ file, ...finding })
  }

  report(findings.length > 0 ? 'finding' : 'pass', { roots, mode })

  for (const f of findings) {
    process.stderr.write(
      `[${CHECKER}] ${f.file}: <${f.component}> 混用 named <template #...> 與 stray 直接子元素 [${f.stray.join(', ')}] — named slots 是 default slot 的 fallback，stray 元素會讓 header/body/footer 整組靜默不 render。修法：把 stray 元素移進 <template #body>（pitfall: 2026-07-06-nuxt-ui-named-slot-default-fallback-shadowing）\n`,
    )
  }

  if (findings.length > 0 && !warnOnly) process.exit(1)
}

main()
