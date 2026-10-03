#!/usr/bin/env node
// 盤點程式碼成中介產物（不進 truth）：HTTP 路由、資料表、頁面、既有測試，每項附檔案與行號。
// 可重跑：輸出只取決於程式碼，不含時間戳；重跑後 `git diff` 為空。
// 用法（任何 cwd）：node specs/plans/001-baseline-reverse/tools/build-inventory.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const out = resolve(root, 'specs/plans/001-baseline-reverse/mapping/inventory.md')

function walk(dir) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.toSorted().flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}
const rel = (p) => relative(root, p).split('\\').join('/')
const lines = (p) => readFileSync(p, 'utf8').split('\n')

const rows = []
const emit = (s = '') => rows.push(s)

// 1. HTTP 路由（Nitro 檔案式路由）
emit('# 程式碼盤點（由 tools/build-inventory.mjs 產生，NEVER 手改）')
emit()
emit('## HTTP 路由（server/api/**）')
emit()
emit('| 方法 | 路徑 | 檔案 | 行數 |')
emit('| --- | --- | --- | --- |')
for (const f of walk(join(root, 'server/api')).filter((p) =>
  /\.(get|post|put|patch|delete)\.ts$/.test(p),
)) {
  const r = rel(f).replace(/^server/, '')
  const m = r.match(/^(.*)\.(get|post|put|patch|delete)\.ts$/)
  const path = m[1].replace(/\/index$/, '').replace(/\[([^\]]+)\]/g, '{$1}')
  emit(`| ${m[2].toUpperCase()} | \`${path}\` | \`${rel(f)}\` | ${lines(f).length} |`)
}

// 2. 資料表（migrations）
emit()
emit('## 資料表（supabase/migrations/*.sql）')
emit()
emit('| 資料表 | 檔案:行 |')
emit('| --- | --- |')
for (const f of walk(join(root, 'supabase/migrations')).filter((p) => p.endsWith('.sql'))) {
  lines(f).forEach((l, i) => {
    const m = l.match(/^\s*CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?([a-z_0-9]+)/i)
    if (m) emit(`| ${m[1]} | \`${rel(f)}:${i + 1}\` |`)
  })
}

// 3. 頁面
emit()
emit('## 頁面（app/pages/**）')
emit()
emit('| 路由 | 檔案 | 行數 |')
emit('| --- | --- | --- |')
for (const f of walk(join(root, 'app/pages')).filter((p) => p.endsWith('.vue'))) {
  const r = rel(f)
    .replace(/^app\/pages/, '')
    .replace(/\.vue$/, '')
    .replace(/\/index$/, '')
    .replace(/\(home\)/, '')
  emit(`| \`${r || '/'}\` | \`${rel(f)}\` | ${lines(f).length} |`)
}

// 4. 既有測試
emit()
emit('## 既有測試（test/**、e2e/**）')
emit()
emit('| 檔案 | runner | 測試案例數（`it(`／`test(` 出現次數；`it.each` 的展開不計） |')
emit('| --- | --- | --- |')
for (const f of [...walk(join(root, 'test')), ...walk(join(root, 'e2e'))].filter((p) =>
  /\.(test|spec)\.ts$/.test(p),
)) {
  const text = readFileSync(f, 'utf8')
  const n = (text.match(/^\s*(?:it|test)(?:\.each\([^)]*\))?\(/gm) ?? []).length
  const runner = rel(f).startsWith('e2e/')
    ? 'playwright'
    : rel(f).startsWith('test/nuxt/')
      ? 'vitest(nuxt)'
      : 'vitest(unit)'
  emit(`| \`${rel(f)}\` | ${runner} | ${n} |`)
}
emit()

writeFileSync(out, rows.join('\n'))
console.log(`wrote ${rel(out)} (${rows.length} lines)`)
