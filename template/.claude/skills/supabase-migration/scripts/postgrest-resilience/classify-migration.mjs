#!/usr/bin/env node

import fs from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('Usage: classify-migration.ts <migration.sql>')
  process.exit(2)
}

const sql = fs.readFileSync(file, 'utf8')
const statements = splitStatements(sql)

// 陳述式切分：認得註解（-- 與巢狀 /* */）、單引號字串、雙引號識別字、dollar-quoted body（$$ 與 $tag$），
// 只在頂層 ; 切。classify 比對用 masked（字串內容與 dollar body 抹掉），避免 function body 內的文字誤觸規則；
// 顯示用 text（保留原文）。
function splitStatements(source) {
  const parts = []
  let text = ''
  let masked = ''
  const flush = () => {
    if (text.trim()) parts.push({ text: text.trim(), masked: masked.trim() })
    text = ''
    masked = ''
  }
  const dollarTag = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (source.startsWith('--', i)) {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end
      continue
    }
    if (source.startsWith('/*', i)) {
      let depth = 1
      let j = i + 2
      while (j < source.length && depth > 0) {
        if (source.startsWith('/*', j)) {
          depth++
          j += 2
        } else if (source.startsWith('*/', j)) {
          depth--
          j += 2
        } else j++
      }
      text += ' '
      masked += ' '
      i = j
      continue
    }
    if (ch === "'" || ch === '"') {
      const backslashEscapes =
        ch === "'" && /[eE]/.test(source[i - 1] ?? '') && !/\w/.test(source[i - 2] ?? '')
      let j = i + 1
      while (j < source.length) {
        if (backslashEscapes && source[j] === '\\') j += 2
        else if (source[j] === ch && source[j + 1] === ch) j += 2
        else if (source[j] === ch) break
        else j++
      }
      const literal = source.slice(i, j + 1)
      text += literal
      masked += ch === "'" ? "''" : literal
      i = j + 1
      continue
    }
    if (ch === '$' && !/[\w$]/.test(source[i - 1] ?? '')) {
      dollarTag.lastIndex = i
      const open = dollarTag.exec(source)
      if (open) {
        const close = source.indexOf(open[0], i + open[0].length)
        const end = close === -1 ? source.length : close + open[0].length
        text += source.slice(i, end)
        masked += `${open[0]} ${open[0]}`
        i = end
        continue
      }
    }
    if (ch === ';') {
      flush()
      i++
      continue
    }
    text += ch
    masked += ch
    i++
  }
  flush()
  return parts
}

const VERSIONED_CREATE_FUNCTION =
  /^\s*create\s+(function|procedure)\s+(?:(?:"[^"]+"|\w+)\s*\.\s*)?(?:"[^"]*_v\d+"|\w*_v\d+)\s*\(/i

const rules = [
  {
    id: 'maintenance-access-exclusive-lock',
    severity: 'maintenance_required',
    pattern: /\block\s+table\b[\s\S]*\baccess\s+exclusive\b/i,
    reason: 'ACCESS EXCLUSIVE lock blocks readers and writers on the target relation.',
  },
  {
    id: 'maintenance-alter-column-type',
    severity: 'maintenance_required',
    pattern: /\balter\s+table\b[\s\S]*\balter\s+column\b[\s\S]*\btype\b/i,
    reason: 'Column type changes may rewrite the table or require blocking locks.',
  },
  {
    id: 'maintenance-nonconcurrent-index',
    severity: 'maintenance_required',
    pattern: /\bcreate\s+(unique\s+)?index\b(?!\s+concurrently\b)/i,
    reason: 'Non-concurrent indexes on hot tables can block writes.',
  },
  {
    id: 'expand-contract-rename',
    severity: 'expand_contract_required',
    pattern: /\balter\s+table\b[\s\S]*\brename\s+(column|to)\b/i,
    reason: 'Renames break old application code unless deployed through expand/contract.',
  },
  {
    id: 'expand-contract-drop-column',
    severity: 'expand_contract_required',
    pattern: /\balter\s+table\b[\s\S]*\bdrop\s+column\b/i,
    reason: 'Dropping columns requires readers and writers to be migrated first.',
  },
  {
    id: 'expand-contract-drop-function',
    severity: 'expand_contract_required',
    pattern: /\bdrop\s+function\b/i,
    reason: 'Dropping exposed RPC signatures can break PostgREST clients during rollout.',
  },
  {
    id: 'expand-contract-replace-function',
    severity: 'expand_contract_required',
    pattern: /^\s*create\s+or\s+replace\s+(function|procedure)\b/i,
    reason:
      'Replacing an exposed RPC in place changes behavior or signature under live clients; ship a new versioned function first, then contract.',
  },
  {
    id: 'expand-contract-revoke',
    severity: 'expand_contract_required',
    pattern: /^\s*revoke\b/i,
    reason:
      'Revoking privileges removes access PostgREST roles may still rely on; migrate callers first (expand/contract).',
  },
  {
    id: 'online-create-index-concurrently',
    severity: 'online_safe',
    pattern: /\bcreate\s+(unique\s+)?index\s+concurrently\b/i,
    reason: 'Concurrent indexes avoid blocking normal writes.',
  },
  {
    id: 'online-add-not-valid-constraint',
    severity: 'online_safe',
    pattern: /\badd\s+constraint\b[\s\S]*\bnot\s+valid\b/i,
    reason: 'NOT VALID constraints avoid validating existing rows in the migration step.',
  },
  {
    id: 'online-add-nullable-column',
    severity: 'online_safe',
    pattern: /\balter\s+table\b[\s\S]*\badd\s+column\b(?![\s\S]*\bnot\s+null\b)/i,
    reason: 'Adding a nullable column is generally backward-compatible.',
  },
  {
    id: 'online-create-function-versioned',
    severity: 'online_safe',
    pattern: VERSIONED_CREATE_FUNCTION,
    reason:
      'Creating a new versioned function (name ends in _vN) cannot overload an exposed RPC; existing signatures are untouched.',
  },
  {
    id: 'expand-contract-create-function',
    severity: 'expand_contract_required',
    pattern:
      /^\s*create\s+(function|procedure)\b(?!\s+(?:(?:"[^"]+"|\w+)\s*\.\s*)?(?:"[^"]*_v\d+"|\w*_v\d+)\s*\()/i,
    reason:
      'A new overload of an exposed function name makes PostgREST RPC calls ambiguous (PGRST203); use a versioned name (_v2) or confirm the name is unused, and annotate the migration risk.',
  },
  {
    id: 'expand-contract-grant-public',
    severity: 'expand_contract_required',
    pattern: /^\s*grant\b[\s\S]*\bto\b[\s\S]*\b(anon|public)\b/i,
    reason:
      'Granting to anon/public widens access for unauthenticated roles; needs reviewer attention.',
  },
  {
    id: 'online-grant',
    severity: 'online_safe',
    pattern: /^\s*grant\b/i,
    reason:
      'Granting to authenticated roles is additive; it only widens what the target role can reach.',
  },
  {
    id: 'online-comment-on',
    severity: 'online_safe',
    pattern: /^\s*comment\s+on\b/i,
    reason: 'COMMENT ON only changes catalog descriptions (PostgREST OpenAPI text), not behavior.',
  },
  {
    id: 'online-create-table',
    severity: 'online_safe',
    pattern: /\bcreate\s+table\b/i,
    reason: 'Creating a new table is isolated from existing readers.',
  },
]

const rank = {
  online_safe: 1,
  expand_contract_required: 2,
  maintenance_required: 3,
  review_required: 4,
}

function highest(severities) {
  if (severities.length === 0) return 'review_required'
  return severities.toSorted((a, b) => rank[b] - rank[a])[0]
}

const findings = statements.map(({ text, masked }, index) => {
  const matched = rules.filter((rule) => rule.pattern.test(masked))
  return {
    index: index + 1,
    statement: text.replace(/\s+/g, ' ').slice(0, 220),
    classification: highest(matched.map((rule) => rule.severity)),
    rules: matched.map(({ id, severity, reason }) => ({ id, severity, reason })),
  }
})

const overall = highest(findings.map((finding) => finding.classification))

console.log(
  JSON.stringify(
    {
      file,
      generatedAt: new Date().toISOString(),
      overall,
      hardStop: overall === 'maintenance_required',
      summary: {
        onlineSafe: findings.filter((finding) => finding.classification === 'online_safe').length,
        expandContractRequired: findings.filter(
          (finding) => finding.classification === 'expand_contract_required',
        ).length,
        maintenanceRequired: findings.filter(
          (finding) => finding.classification === 'maintenance_required',
        ).length,
        reviewRequired: findings.filter((finding) => finding.classification === 'review_required')
          .length,
      },
      findings,
    },
    null,
    2,
  ),
)
