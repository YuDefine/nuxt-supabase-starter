#!/usr/bin/env node
// truth 逆向基準線的機械檢查（可重跑、只讀、任一項不過 exit 1）。
//   ① x-source 回指：contracts／data 內每個 `x-source:` 的檔案存在且行號在範圍內
//   ② 三處同一組模組鍵：contracts/<模組>.yaml、features/backend/<模組>/、data/<模組>.dbml
//   ③ DBML 總覽（data-model.dbml）與聚合檔的資料表集合一致
//   ④ feature 步驟與 dsl.md 對帳：每個步驟恰好對到一列句型；每列句型至少被一個 feature 使用；
//      標「未實作」的句型只被 @unverified feature 使用（規約 MUST 3 ①②的 feature 端）
//   ⑤ feature 驗證狀態：無標籤 = 由 SpecFormula runner 執行（TD-026 D5 起 `pnpm test:bdd` 是
//      真 runner）；@unverified／@code-mismatch 仍合法但必須掛 [need clarification] Q-…，
//      且該 Q 在 questions.md
//   ⑥ 覆蓋矩陣：每列狀態合法，「刻意不補」附理由
// step definition 端對帳由 features/steps/profiles.steps.ts 承接（規約 MUST 3 的 runner 部分）。
// 用法（任何 cwd）：node specs/plans/001-baseline-reverse/tools/check-truth.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const plan = join(root, 'specs/plans/001-baseline-reverse')
const truth = join(root, 'specs/truth')
const errors = []
const fail = (msg) => errors.push(msg)
const read = (p) => readFileSync(p, 'utf8')
const rel = (p) => relative(root, p).split('\\').join('/')
const walk = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .toSorted()
        .flatMap((n) => {
          const p = join(dir, n)
          return statSync(p).isDirectory() ? walk(p) : [p]
        })
    : []

// ① x-source
const xsrc =
  /x-source:\s*['"]?([^\s'"`,;)）。:]+(?:\[[^\]]+\][^\s'"`,;)）。:]*)?)(?::(\d+)(?:-(\d+))?)?/g
let xsrcCount = 0
for (const f of [...walk(join(truth, 'contracts')), ...walk(join(truth, 'data'))]) {
  const text = read(f)
  for (const m of text.matchAll(xsrc)) {
    const [, file, from, to] = m
    if (!/[./]/.test(file)) continue
    xsrcCount++
    const target = join(root, file)
    if (!existsSync(target)) {
      fail(`① ${rel(f)}: x-source 檔案不存在 ${file}`)
      continue
    }
    const n = read(target).split('\n').length
    for (const ln of [from, to].filter(Boolean)) {
      if (Number(ln) < 1 || Number(ln) > n)
        fail(`① ${rel(f)}: x-source ${file}:${ln} 超出檔案行數 ${n}`)
    }
  }
}
if (xsrcCount === 0) fail('① 找不到任何 x-source')

// ② 模組鍵
const keys = (names) => new Set(names)
const contractKeys = keys(
  walk(join(truth, 'contracts'))
    .map((p) => p.split('/').pop())
    .filter((n) => n.endsWith('.yaml') && n !== 'openapi.yaml')
    .map((n) => n.replace(/^\d+-/, '').replace(/\.yaml$/, '')),
)
const featureKeys = keys(
  readdirSync(join(truth, 'features/backend'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name.replace(/^\d+-/, '')),
)
const dataKeys = keys(
  walk(join(truth, 'data'))
    .map((p) => p.split('/').pop())
    .filter((n) => n.endsWith('.dbml') && n !== 'data-model.dbml')
    .map((n) => n.replace(/^\d+-/, '').replace(/\.dbml$/, '')),
)
const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x))
if (!same(contractKeys, featureKeys))
  fail(`② contracts 模組鍵 {${[...contractKeys]}} ≠ features/backend 模組鍵 {${[...featureKeys]}}`)
if (!same(contractKeys, dataKeys))
  fail(`② contracts 模組鍵 {${[...contractKeys]}} ≠ data 聚合檔鍵 {${[...dataKeys]}}`)

// ③ DBML 表集合
const tables = (text) =>
  new Set([...text.matchAll(/^\s*Table\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\{/gm)].map((m) => m[1]))
const overview = tables(read(join(truth, 'data/data-model.dbml')))
const aggregate = new Set(
  walk(join(truth, 'data'))
    .filter((p) => p.endsWith('.dbml') && !p.endsWith('data-model.dbml'))
    .flatMap((p) => [...tables(read(p))]),
)
if (!same(overview, aggregate))
  fail(`③ 總覽表集合 {${[...overview]}} ≠ 聚合檔表集合 {${[...aggregate]}}`)

// ④ feature ↔ dsl
const dslFiles = walk(join(truth, 'features/backend')).filter((p) => p.endsWith('dsl.md'))
const rows = []
for (const f of dslFiles) {
  for (const line of read(f).split('\n')) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|(.*)\|\s*$/)
    if (!m || m[1] === 'DSL 句型') continue
    const esc = m[1].replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '(.*?)')
    rows.push({
      file: rel(f),
      pattern: m[1],
      re: new RegExp(`^${esc}$`),
      unimplemented: /未實作/.test(m[2]),
      used: 0,
    })
  }
}
const seen = new Map()
for (const r of rows) {
  if (seen.has(r.pattern))
    fail(`④ 句型重複出現於 ${seen.get(r.pattern)} 與 ${r.file}：${r.pattern}`)
  seen.set(r.pattern, r.file)
}
const features = walk(join(truth, 'features/backend')).filter((p) => p.endsWith('.feature'))
const questionsText = existsSync(join(plan, 'questions.md')) ? read(join(plan, 'questions.md')) : ''
let stepCount = 0
for (const f of features) {
  const text = read(f)
  const tags = new Set(
    text
      .split('\n')
      .filter((l) => /^\s*@/.test(l))
      .join(' ')
      .match(/@[\w-]+/g) ?? [],
  )
  // ⑤ 驗證狀態（TD-026 D5 起無標籤 = runner 會執行；@unverified 只留給句型
  //    尚未實作、runner 無法表達的 feature）
  const status = ['@code-mismatch', '@unverified'].filter((t) => tags.has(t))
  if (status.length > 1) fail(`⑤ ${rel(f)}: @code-mismatch 與 @unverified 不可並存`)
  if (status.length > 0 && !/\[need clarification\]/.test(text))
    fail(`⑤ ${rel(f)}: @${status[0].slice(1)} 缺 [need clarification] 註解`)
  if (tags.has('@unverified') && /@code-mismatch/.test(text))
    fail(`⑤ ${rel(f)}: @unverified 內文不得再掛 @code-mismatch`)
  for (const q of new Set(text.match(/Q-[a-z0-9-]+-\d+/g) ?? [])) {
    if (!questionsText.includes(q)) fail(`⑤ ${rel(f)}: ${q} 不在 questions.md`)
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:Given|When|Then|And|But)\s+(.+?)\s*$/)
    if (!m) continue
    stepCount++
    const hits = rows.filter((r) => r.re.test(m[1]))
    if (hits.length !== 1) {
      fail(`④ ${rel(f)}: 步驟對到 ${hits.length} 列（需恰好 1）：${m[1]}`)
      continue
    }
    hits[0].used++
    if (!tags.has('@unverified') && hits[0].unimplemented)
      fail(`④ ${rel(f)}: 句型標「未實作」卻被非 @unverified feature 使用：${m[1]}`)
  }
}
for (const r of rows) if (r.used === 0) fail(`④ ${r.file}: 句型沒有任何 feature 使用：${r.pattern}`)
if (features.length === 0) fail('④ 找不到任何 feature')

// ⑥ 覆蓋矩陣
const STATUS = new Set(['既有覆蓋', '逆向補齊', '刻意不補', '未展開'])
let matrixRows = 0
for (const f of walk(join(plan, 'coverage')).filter((p) => p.endsWith('.md'))) {
  for (const line of read(f).split('\n')) {
    if (!line.startsWith('|') || /^\|\s*-/.test(line)) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
    if (cells.length < 4 || cells[0] === '盤點葉檔' || cells[0] === '模組') continue
    matrixRows++
    const status = cells[3]
    if (!STATUS.has(status.split(/[（(：:]/)[0]))
      fail(`⑥ ${rel(f)}: 狀態不合法「${status}」：${cells[0]}`)
    if (status.startsWith('刻意不補') && !/[（(：:].{2,}/.test(status))
      fail(`⑥ ${rel(f)}: 「刻意不補」缺理由：${cells[0]}`)
  }
}
if (matrixRows === 0) fail('⑥ 覆蓋矩陣沒有任何列')

if (errors.length > 0) {
  console.error(errors.join('\n'))
  console.error(`\ncheck-truth: ${errors.length} 個問題`)
  process.exit(1)
}
console.log(
  `check-truth: OK（x-source ${xsrcCount}、句型 ${rows.length}、feature ${features.length}、步驟 ${stepCount}、矩陣列 ${matrixRows}）`,
)
