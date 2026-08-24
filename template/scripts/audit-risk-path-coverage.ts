#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/audit-risk-path-coverage.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/audit-risk-path-coverage.ts

/**
 * audit-risk-path-coverage.ts — 高風險 diff 有沒有對應的 Risk paths 宣告（warn-only）
 *
 * 對應 `rules/core/testing-anti-patterns.md` § E2E 以風險路徑排序 § 規約最小要求 與 TD-636。
 *
 * ## 這支存在的理由
 *
 * 該規約要求 change 動到五類路徑時，archive 前 MUST 在 design.md / proposal.md 列出對應風險
 * 路徑。落地機制原本逐字是「靠 reviewer 在 manual-review tier 1/2 攔截，不靠 CI gate（會誤殺
 * typo fix）」——但在 agent 為主要產出者的 fleet 裡，那個 reviewer 多數時候也是 agent。
 *
 * **規約反對的是無條件 hard gate，本支不是那個。** 五類觸發條件全部是 diff 路徑可偵測的，
 * 條件觸發碰不到 typo fix，所以原理由對本支不適用。本支恆 exit 0，findings 是 review 的
 * 對話起點，**NEVER** 升成 blocking——升了就正面違反該規約自己寫的理由。
 *
 * ## 為什麼不只驗「章節存在」
 *
 * 只驗 `## Risk paths` 這個標題在不在，agent 會 pro forma 生一段就過關——那正是
 * 「全部打勾但沒人看」的機械版。所以本支同時驗**該節引用的測試檔真的存在**：節內每個看起來
 * 像測試路徑的引用都去磁碟查。查無 = finding，與整段缺席同級。
 *
 * ## 已知盲區（NEVER 把綠燈讀成「風險路徑覆蓋足夠」）
 *
 * 本支驗的是「有沒有宣告、宣告指的檔在不在」，**不驗那些測試測得對不對**、不驗覆蓋完不完整。
 * 測試內容的判斷不可 grep，只有人能判——本支的 finding 是 review 的輸入，不是它的結論。
 *
 * ## 用法
 *
 *   node vendor/scripts/audit-risk-path-coverage.ts [--base <ref>] [--json]
 *
 * `--base` 預設依序試 `origin/main` → `main`。無 git 或無 openspec/changes/ 時印 skip 理由。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 五類觸發條件，逐條對應規約 § 規約最小要求 的五個 bullet。
 * **改這張表 MUST 同步改該規約**——兩邊是同一份清單的兩種形式，散開就會 drift。
 */
const RISK_CATEGORIES = [
  {
    key: 'auth',
    label: '認證 / 授權',
    re: /(^|\/)(auth|login|signin|session|permission|rbac|policy|guard|middleware)/i,
  },
  { key: 'migration', label: 'DB schema migration', re: /(^|\/)(migrations?|drizzle)\//i },
  {
    key: 'contract',
    label: '跨服務 / 跨 module contract',
    re: /(^|\/)(server\/api|api|routes?|events?|schema)\//i,
  },
  {
    key: 'payment',
    label: 'payment / 不可逆操作',
    re: /(payment|billing|checkout|invoice|refund|charge|payout)/i,
  },
  {
    key: 'deletion',
    label: '資料 deletion / soft-delete',
    re: /(delete|destroy|purge|soft[-_]?delete)/i,
  },
]

/** 看起來像測試檔的引用——附檔名而非目錄名，避免把 `e2e/` 這種散文提及當成引用 */
const TEST_REF = /[\w./-]*\.(?:spec|test)\.[jt]sx?|[\w./-]*e2e\/[\w./-]+\.[jt]s/g

const RISK_SECTION = /^#{2,4}\s*(?:§\s*)?Risk paths?\b/im

function git(args: string[], cwd: string) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

function resolveBase(explicit: string | undefined, cwd: string) {
  const candidates = explicit ? [explicit] : ['origin/main', 'main']
  for (const ref of candidates) {
    try {
      git(['rev-parse', '--verify', '--quiet', ref], cwd)
      return ref
    } catch {
      /* 試下一個 */
    }
  }
  return null
}

function changedFiles(base: string, cwd: string) {
  // three-dot：拿的是 base 之後這條線上的改動，不含 base 自己往前跑的部分
  const out = git(['diff', '--name-only', `${base}...HEAD`], cwd)
  return out.split('\n').filter(Boolean)
}

export function classifyRiskPaths(files: string[]) {
  const hits = new Map<string, string[]>()
  for (const f of files) {
    for (const c of RISK_CATEGORIES) {
      if (c.re.test(f)) hits.set(c.key, [...(hits.get(c.key) ?? []), f])
    }
  }
  return hits
}

function activeChangeDirs(cwd: string) {
  const root = join(cwd, 'openspec', 'changes')
  if (!existsSync(root)) return null
  return readdirSync(root)
    .filter((n) => n !== 'archive')
    .map((n) => join(root, n))
    .filter((p) => statSync(p).isDirectory())
}

/**
 * 回 `{ section: boolean, refs: string[], missing: string[] }`。
 * `section` 為 false 時 refs / missing 一律空——**NEVER** 把「沒有節」報成「節內零引用」，
 * 兩者的處置不同（前者要補宣告，後者要補測試）。
 */
export function inspectRiskSection(docText: string, repoRoot: string) {
  const lines = docText.split('\n')
  const start = lines.findIndex((l) => RISK_SECTION.test(l))
  if (start === -1) return { section: false, refs: [], missing: [] }
  const level = (lines[start].match(/^#+/) ?? ['##'])[0].length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/)
    if (m && m[1].length <= level) {
      end = i
      break
    }
  }
  const body = lines.slice(start, end).join('\n')
  const refs = [...new Set(body.match(TEST_REF) ?? [])]
  const missing = refs.filter((r) => !existsSync(join(repoRoot, r.replace(/^\.\//, ''))))
  return { section: true, refs, missing }
}

export function auditRepo(cwd: string, baseRef?: string) {
  const dirs = activeChangeDirs(cwd)
  if (dirs === null) return { skipped: 'no openspec/changes/', findings: [] }
  const base = resolveBase(baseRef, cwd)
  if (!base) return { skipped: 'no resolvable base ref (tried origin/main, main)', findings: [] }

  const hits = classifyRiskPaths(changedFiles(base, cwd))
  if (hits.size === 0) return { skipped: null, base, findings: [], hits }

  const findings: Array<{ change: string; kind: string; detail: string }> = []
  for (const dir of dirs) {
    const docs = ['design.md', 'proposal.md'].map((n) => join(dir, n)).filter((p) => existsSync(p))
    if (docs.length === 0) {
      findings.push({ change: dir, kind: 'no-doc', detail: '無 design.md / proposal.md 可查' })
      continue
    }
    const merged = docs.map((p) => readFileSync(p, 'utf8')).join('\n')
    const r = inspectRiskSection(merged, cwd)
    const cats = [...hits.keys()]
      .map((k) => RISK_CATEGORIES.find((c) => c.key === k)!.label)
      .join('、')
    if (!r.section) {
      findings.push({ change: dir, kind: 'missing-section', detail: `diff 命中：${cats}` })
    } else if (r.refs.length === 0) {
      findings.push({
        change: dir,
        kind: 'no-test-ref',
        detail: `§ Risk paths 存在但未引用任何測試檔（命中：${cats}）`,
      })
    } else if (r.missing.length > 0) {
      findings.push({
        change: dir,
        kind: 'dangling-test-ref',
        detail: `引用的測試檔不存在：${r.missing.join(', ')}`,
      })
    }
  }
  return { skipped: null, base, findings, hits }
}

function invokedAsCli() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return entry === fileURLToPath(import.meta.url)
  }
}

if (invokedAsCli()) {
  const argv = process.argv.slice(2)
  const baseIdx = argv.indexOf('--base')
  const res = auditRepo(process.cwd(), baseIdx === -1 ? undefined : argv[baseIdx + 1])
  if (argv.includes('--json')) {
    console.log(JSON.stringify(res, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v), 2))
  } else {
    console.log('# risk-path coverage 稽核（warn-only）\n')
    if (res.skipped) {
      console.log(`跳過：${res.skipped}`)
    } else if (res.findings.length === 0) {
      const n = res.hits ? res.hits.size : 0
      console.log(
        n === 0
          ? 'diff 未命中五類高風險路徑 ✓'
          : `命中 ${n} 類高風險路徑，作用中的 change 都有 § Risk paths 且引用的測試檔存在 ✓`,
      )
    } else {
      console.log('| Change | 類型 | 細節 |')
      console.log('| --- | --- | --- |')
      for (const f of res.findings)
        console.log(`| ${f.change} | ${f.kind} | ${f.detail.replace(/\|/g, '\\|')} |`)
      console.log(
        `\n共 ${res.findings.length} 條（warn-only，恆 exit 0）。` +
          `\n這是 review 的**對話起點**，NEVER 當成 blocking gate——規約 § 規約最小要求 逐字反對無條件 CI gate。` +
          `\n綠燈只代表「有宣告、宣告指的檔在」，NEVER 讀成「風險路徑覆蓋足夠」——測得對不對只有人能判。`,
      )
    }
  }
}
