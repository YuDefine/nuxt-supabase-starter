#!/usr/bin/env node
// page-display-check — reverse page-grep helper for Layer A
// (VERIFY_UI_SAMPLE_KEY_DISPLAY_CHECK).
//
// Called by post-propose-manual-review-check.sh when a [verify:ui] item pairs an
// identification verb (找到/定位/locate/find/search) with a business-key literal
// (EMP-\d+ / contract-...\d / UUID). It maps the item's target URL to the Nuxt
// page .vue file and greps for identifier-column tokens + the literal key, so
// the propose-time finding can carry CONCRETE evidence instead of a generic
// "this might be a fab risk" message.
//
// Design note: this does NOT suppress the finding when tokens are present. The
// incident class (employeeNameMap lookup → empty → 員工 column all "-") has the
// column key (`employee_no`) living in a UTable `columns` config in <script>,
// so a whole-file grep "found employee_no" would wrongly conclude "rendered" and
// suppress the very defect we guard. So the helper only ENRICHES the remediation
// with what it found; the author decides keep [verify:ui] vs reclassify to
// [review:ui] using the real grep output.
//
// Output: single JSON object on stdout:
//   { resolvedFile, candidates, keyLiteralFound, columnHintsFound, columnHintsSearched }
// Exit 0 always (advisory). Errors degrade to resolvedFile: null.

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

// Map a URL (or path) to candidate Nuxt page file paths, relative to consumer
// root. Covers `app/pages/` + `pages/` roots and `index.vue`. Bounded, no fs
// walk — the caller checks existsSync.
export function urlToPageCandidates(url) {
  let path = String(url ?? '').trim()
  // Strip scheme + host.
  path = path.replace(/^https?:\/\/[^/]+/, '')
  // Strip query + hash.
  path = path.replace(/[?#].*$/, '')
  // Normalize slashes.
  path = path.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!path) path = 'index'
  const roots = ['app/pages', 'pages']
  const candidates = []
  for (const root of roots) {
    candidates.push(`${root}/${path}.vue`)
    candidates.push(`${root}/${path}/index.vue`)
  }
  return candidates
}

// Identifier-column tokens to look for, keyed by the business-key shape.
export function columnHintsForKey(key) {
  const k = String(key ?? '')
  if (/^EMP-/i.test(k)) {
    return [
      'employee_no',
      'employeeNo',
      'emp_no',
      'empNo',
      'employee_id',
      'employeeId',
      '員工編號',
      'staff_no',
    ]
  }
  if (/^contract-/i.test(k)) {
    return ['contract_id', 'contractId', 'contract_no', 'contractNo', '合約編號']
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) {
    // UUID — too generic for a column-name hint; rely on literal presence only.
    return []
  }
  return []
}

export function grepPage({ consumerPath, candidates, key }) {
  let resolvedFile = null
  for (const c of candidates) {
    if (existsSync(join(consumerPath, c))) {
      resolvedFile = c
      break
    }
  }
  const columnHintsSearched = columnHintsForKey(key)
  if (!resolvedFile) {
    return {
      resolvedFile: null,
      candidates,
      keyLiteralFound: false,
      columnHintsFound: [],
      columnHintsSearched,
    }
  }
  const src = readFileSync(join(consumerPath, resolvedFile), 'utf-8')
  const keyLiteralFound = key ? src.includes(key) : false
  const columnHintsFound = columnHintsSearched.filter((h) => src.includes(h))
  return { resolvedFile, candidates, keyLiteralFound, columnHintsFound, columnHintsSearched }
}

function main() {
  const { values: args } = parseArgs({
    options: {
      'consumer-path': { type: 'string', default: process.cwd() },
      url: { type: 'string' },
      key: { type: 'string', default: '' },
    },
  })
  const consumerPath = resolve(args['consumer-path'])
  const url = args.url ?? ''
  const candidates = urlToPageCandidates(url)
  let result
  try {
    result = grepPage({ consumerPath, candidates, key: args.key })
  } catch (e) {
    result = {
      resolvedFile: null,
      candidates,
      keyLiteralFound: false,
      columnHintsFound: [],
      columnHintsSearched: [],
      error: e.message,
    }
  }
  process.stdout.write(JSON.stringify(result) + '\n')
  process.exit(0)
}

// Run as CLI only (not when imported by tests). Compare by suffix to dodge the
// macOS /tmp symlink argv quirk.
if (process.argv[1] && process.argv[1].endsWith('page-display-check.mjs')) {
  main()
}
