#!/usr/bin/env node
/**
 * _add-frontmatter.mjs — 一次性 helper，給 docs/ 下缺 frontmatter 的 .md
 * 補最小 frontmatter（audience + applies-to）。已有 frontmatter 跳過。
 *
 * Usage:
 *   node scripts/_add-frontmatter.mjs --dry-run   # 看會改哪些
 *   node scripts/_add-frontmatter.mjs --apply     # 實際寫入
 *
 * 推導規則：
 *   docs/<top-level>/...  → applies-to 依 top-level 對應表
 *   無對應表的 → 預設 post-scaffold
 *   全部用 audience: both（之後可手動細化）
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(process.cwd(), 'docs')
const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')

const APPLIES_MAP = {
  guide: 'post-scaffold',
  database: 'post-scaffold',
  frontend: 'post-scaffold',
  gotchas: 'post-scaffold',
  verify: 'post-scaffold',
  api: 'post-scaffold',
  architecture: 'architecture',
  auth: 'post-scaffold',
  decisions: 'architecture',
  rules: 'post-scaffold',
  solutions: 'post-scaffold',
}

const SKIP_DIRS = new Set(['.vitepress', 'node_modules', 'public'])

function inferFrontmatter(file) {
  const rel = relative(ROOT, file)
  const top = rel.split('/')[0]
  const isInDir = rel.includes('/')
  const appliesTo = isInDir ? APPLIES_MAP[top] || 'post-scaffold' : 'post-scaffold'
  return `---\naudience: both\napplies-to: ${appliesTo}\n---\n\n`
}

let added = 0
let skipped = 0

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      walk(p)
    } else if (entry.endsWith('.md')) {
      processFile(p)
    }
  }
}

function processFile(file) {
  const content = readFileSync(file, 'utf8')
  // 偵測既有 frontmatter — 容錯處理：
  //   - UTF-8 BOM（﻿）
  //   - CRLF（---\r\n）
  //   - LF（---\n）
  //   - 檔案恰好只有 `---` 三字（極少見但可能）
  // 用 regex 一次涵蓋，避免 startsWith('---\n') 漏判 CRLF / BOM 而重複加 frontmatter。
  const stripped = content.startsWith('﻿') ? content.slice(1) : content
  if (/^---(\r?\n|$)/.test(stripped)) {
    skipped++
    return
  }
  const fm = inferFrontmatter(file)
  added++
  const rel = relative(ROOT, file)
  if (APPLY) {
    writeFileSync(file, fm + content)
    console.log(`[+] ${rel}`)
  } else {
    console.log(`[would add] ${rel}`)
  }
}

walk(ROOT)

console.log('')
console.log(`${APPLY ? 'Added' : 'Would add'} frontmatter to ${added} files`)
console.log(`Skipped (already has frontmatter): ${skipped} files`)
if (!APPLY) console.log('\nRe-run with --apply to write changes')
