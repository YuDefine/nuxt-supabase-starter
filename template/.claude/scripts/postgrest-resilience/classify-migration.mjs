#!/usr/bin/env node

import fs from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('Usage: classify-migration.mjs <migration.sql>')
  process.exit(2)
}

const sql = fs.readFileSync(file, 'utf8')
const statements = sql
  .replace(/--.*$/gm, '')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean)

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

const findings = statements.map((statement, index) => {
  const matched = rules.filter((rule) => rule.pattern.test(statement))
  return {
    index: index + 1,
    statement: statement.replace(/\s+/g, ' ').slice(0, 220),
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
          (finding) => finding.classification === 'expand_contract_required'
        ).length,
        maintenanceRequired: findings.filter(
          (finding) => finding.classification === 'maintenance_required'
        ).length,
        reviewRequired: findings.filter((finding) => finding.classification === 'review_required')
          .length,
      },
      findings,
    },
    null,
    2
  )
)
