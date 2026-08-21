#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/spectra-advanced/verify-url-check.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/spectra-advanced/verify-url-check.ts
// verify-url-check — ## 人工檢查 item URL 的機械驗證（TD-220，
// pitfall-verify-item-fake-url-no-interaction prevention #4）。
//
// 兩件事：
//   1. URL path 對照 Nuxt route tree（app/pages / pages，支援 [param] / [...slug]
//      dynamic segment）確認 page 檔存在 — 杜絕臆想出來的路徑進 review。
//   2. query string 的每個 param 名 grep resolved page source — page 沒讀的
//      param 代表該 URL 的 query 無法影響頁面狀態（假 URL 的典型形態）。
//
// Output（單一 JSON on stdout）：
//   { path, pagesRoot, routeExists, resolvedFile, queryParams, unusedParams }
// pagesRoot: null → consumer 無 pages 目錄（非 Nuxt page 專案），caller 應跳過整個檢查。
// Exit 永遠 0（advisory helper；block 與否由 hook 決定）。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

export function parseUrl(url) {
  let raw = String(url ?? '').trim()
  raw = raw.replace(/^https?:\/\/[^/]+/, '')
  const [beforeHash] = raw.split('#')
  const [pathPart, queryPart = ''] = beforeHash.split('?')
  const queryParams = []
  for (const pair of queryPart.split('&')) {
    const name = pair.split('=')[0].trim()
    if (name && !queryParams.includes(name)) queryParams.push(name)
  }
  const path = pathPart.replace(/\/+$/, '') || '/'
  return { path, queryParams }
}

function listVueEntries(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return { files: [], dirs: [] }
  }
  const files = []
  const dirs = []
  for (const e of entries) {
    const full = join(dir, e)
    try {
      if (statSync(full).isDirectory()) dirs.push(e)
      else if (e.endsWith('.vue')) files.push(e)
    } catch {
      // unreadable entry — skip
    }
  }
  return { files, dirs }
}

// 遞迴比對 route segments 對 pages 目錄：exact match 優先，其次 [param]，
// 最後 [...slug] catch-all。回傳 pagesRoot 相對檔案路徑或 null。
// list 可換成 in-memory lister，讓「本 change 宣告要新建的 page」共用同一套比對。
function matchSegments(dir, segments, list = listVueEntries) {
  const { files, dirs } = list(dir)
  if (segments.length === 0) {
    if (files.includes('index.vue')) return 'index.vue'
    return null
  }
  const [seg, ...rest] = segments
  // exact file（最後一段）
  if (rest.length === 0 && files.includes(`${seg}.vue`)) return `${seg}.vue`
  // exact dir
  if (dirs.includes(seg)) {
    const sub = matchSegments(join(dir, seg), rest, list)
    if (sub) return join(seg, sub)
  }
  // dynamic [param]
  for (const f of files) {
    if (rest.length === 0 && /^\[[^.\]]+\]\.vue$/.test(f)) return f
  }
  for (const d of dirs) {
    if (/^\[[^.\]]+\]$/.test(d)) {
      const sub = matchSegments(join(dir, d), rest, list)
      if (sub) return join(d, sub)
    }
  }
  // catch-all [...slug].vue 吃掉剩餘所有 segments
  for (const f of files) {
    if (/^\[\.\.\.[^\]]+\]\.vue$/.test(f)) return f
  }
  return null
}

export function resolveRoute(consumerPath, path) {
  const roots = ['app/pages', 'pages']
  let pagesRoot = null
  for (const root of roots) {
    if (existsSync(join(consumerPath, root))) {
      pagesRoot = root
      break
    }
  }
  if (!pagesRoot) return { pagesRoot: null, resolvedFile: null }
  const segments = path.split('/').filter(Boolean)
  const matched = matchSegments(join(consumerPath, pagesRoot), segments)
  return { pagesRoot, resolvedFile: matched ? join(pagesRoot, matched) : null }
}

// ── 本 change 宣告要新建的 page ────────────────────────────────────────────
// propose 階段跑這支檢查時，change 尚未 apply — 「本 change 才要建的 page」在
// route tree 當然找不到，那不是臆想 URL。從 change 的 md 文字抽出所有
// `(app/)?pages/<...>.vue` 提及，當成一棵 virtual route tree 用同一套 segment
// 比對，命中即代表該 URL 有對應的實作 task 撐著。

export function extractDeclaredPages(text) {
  const re = /(?:app\/)?pages\/([A-Za-z0-9_\-./[\]]*\.vue)/g
  const out = []
  let m
  while ((m = re.exec(String(text ?? '')))) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

function makeDeclaredLister(files) {
  const index = new Map()
  const ensure = (d) => {
    if (!index.has(d)) index.set(d, { files: [], dirs: [] })
    return index.get(d)
  }
  ensure('.')
  for (const rel of files) {
    const parts = rel.split('/').filter(Boolean)
    let cur = '.'
    for (const seg of parts.slice(0, -1)) {
      const node = ensure(cur)
      if (!node.dirs.includes(seg)) node.dirs.push(seg)
      cur = join(cur, seg)
      ensure(cur)
    }
    const node = ensure(cur)
    const file = parts[parts.length - 1]
    if (file && !node.files.includes(file)) node.files.push(file)
  }
  return (d) => index.get(d) ?? { files: [], dirs: [] }
}

// 回傳命中的 declared page 相對路徑，或 null（沒宣告 / 對不上）。
export function matchDeclaredRoute(changeText, path) {
  const declared = extractDeclaredPages(changeText)
  if (declared.length === 0) return null
  const segments = String(path ?? '')
    .split('/')
    .filter(Boolean)
  return matchSegments('.', segments, makeDeclaredLister(declared))
}

function readChangeText(changeDir) {
  const chunks = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e)
      try {
        if (statSync(full).isDirectory()) walk(full, depth + 1)
        else if (e.endsWith('.md')) chunks.push(readFileSync(full, 'utf8'))
      } catch {
        // unreadable entry — skip
      }
    }
  }
  walk(changeDir, 0)
  return chunks.join('\n')
}

// param「有被使用」的判準：param 名以 word boundary 出現在 page source 任一處
// （route.query.foo / useRouteQuery('foo') / 解構 { foo } 都會命中）。故意放寬 —
// 這裡要抓的是「page 根本不認識這個 param」的臆想 URL，不是精確 data-flow 分析。
export function findUnusedParams(source, queryParams) {
  return queryParams.filter((p) => {
    const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    return !re.test(source)
  })
}

export function checkUrl({ consumerPath, url, changeDir = null }) {
  const { path, queryParams } = parseUrl(url)
  const { pagesRoot, resolvedFile } = resolveRoute(consumerPath, path)
  if (!pagesRoot) {
    return {
      path,
      pagesRoot: null,
      routeExists: null,
      resolvedFile: null,
      queryParams,
      unusedParams: [],
      declaredInChange: null,
    }
  }
  if (!resolvedFile) {
    // route 不存在時再問一次：本 change 有沒有宣告要建這個 page？
    const declaredInChange = changeDir ? matchDeclaredRoute(readChangeText(changeDir), path) : null
    return {
      path,
      pagesRoot,
      routeExists: false,
      resolvedFile: null,
      queryParams,
      unusedParams: [],
      declaredInChange,
    }
  }
  let unusedParams = []
  if (queryParams.length > 0) {
    try {
      const source = readFileSync(join(consumerPath, resolvedFile), 'utf8')
      unusedParams = findUnusedParams(source, queryParams)
    } catch {
      unusedParams = []
    }
  }
  return {
    path,
    pagesRoot,
    routeExists: true,
    resolvedFile,
    queryParams,
    unusedParams,
    declaredInChange: null,
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  try {
    const { values } = parseArgs({
      options: {
        'consumer-path': { type: 'string' },
        url: { type: 'string' },
        'change-dir': { type: 'string' },
      },
    })
    const result = checkUrl({
      consumerPath: values['consumer-path'] ?? '.',
      url: values.url ?? '',
      changeDir: values['change-dir'] ?? null,
    })
    process.stdout.write(JSON.stringify(result) + '\n')
  } catch {
    process.stdout.write(
      JSON.stringify({
        path: null,
        pagesRoot: null,
        routeExists: null,
        resolvedFile: null,
        queryParams: [],
        unusedParams: [],
        declaredInChange: null,
      }) + '\n',
    )
  }
  process.exit(0)
}
