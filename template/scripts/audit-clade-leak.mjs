#!/usr/bin/env node
/**
 * audit-clade-leak.mjs — starter consumer 公開倉 0-leak audit
 *
 * 用途：`nuxt-supabase-starter` 是公開 GitHub repo。clade 中央倉的 rule /
 * skill / commands / agents 內含 consumer 名稱（<consumer-a> / <consumer-b> / <consumer-c> /
 * <consumer-d> / <consumer-c>）、personal path (`~/`)、
 * personal email (`<maintainer-email>`)、客戶名 (<client-a> / <client-b>)、
 * 以及未該對外曝光的 maintainer skill (`oops` / `improvement-loop` / `review-rules`)。
 *
 * Sanitization 應在 clade 端 propagate 時自動處理；本 audit script 是 CI gate
 * 兜底，直接 grep `template/.claude/` 內 clade-managed checksums 列出的所有檔，
 * 任何 forbidden token / maintainer-only skill 殘留 → exit 1。
 *
 * Scope:
 *   1. `template/.claude/` checksums 列出的所有檔：grep forbidden tokens
 *      （consumer name 別名 + personal redactions needles）
 *   2. `template/.agents/skills/{oops,improvement-loop,review-rules}/` 殘留：
 *      若任一存在 → exit 1（maintainer-only skill 不該散播到 starter）
 *
 * Output:
 *   - 0 violations → exit 0
 *   - 1+ violations → 列每條 `<path>: <token>` 後 exit 1
 *
 * Usage:
 *   node scripts/audit-clade-leak.mjs                 # 預設 cwd = repo root
 *   node scripts/audit-clade-leak.mjs --root <path>   # 指定 starter repo root
 *   node scripts/audit-clade-leak.mjs --json          # CI-friendly 機器輸出
 *
 * 觸發點：starter CI（GitHub Actions）作 mandatory job + maintainer 本機散播
 * 後手動跑驗證。
 *
 * 對應 governance：clade `scripts/lib/sanitization-governance.mjs`。
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// 嘗試 import clade-managed lib（若 starter 端的 .clade/ 投影 / consumer scripts/
// 已有同步副本，路徑會穩定）。failure 時 fallback hardcode 一份 minimal list 避免
// audit 自身因 missing dep 而綠燈過。
// IMPORTANT：在 starter 端跑時，starter 倉本身**不**會內含這份 lib（clade
// `scripts/lib/` 是 clade 中央倉自己的，不散播到 starter）。所以必須 fallback。

const FALLBACK_FORBIDDEN_TOKENS = [
  // consumer name 別名（覆蓋 sanitization-governance 對應 list）
  /\bnuxt-edge-<consumer-c>\b/g,
  /\byuntech-usr-<consumer-d>\b/g,
  /\bedge-rag\b/g,
  /\bperno\b/g,
  /\bTDMS\b/g,
  /\bbigbyte\b/g,
  /\bfongchen\b/g,
]

const FALLBACK_PERSONAL_NEEDLES = [
  // macOS home layout
  '<HOME>/.local/bin/',
  '<clade-central-repo>',
  '<home>/offline/',
  '~/',
  // Linux home layout — 逐字比對，缺一邊等於該平台上完全偵測不到洩漏
  '<HOME>/.local/bin/',
  '<clade-central-repo>',
  '<home>/offline/',
  '~/',
  '<maintainer-email>',
  '<maintainer-domain>',
]

// 上面那份是逐字 needle，只認 `charles` 這個 username。這條 regex 補「任意 username ×
// 兩平台」，來源是 `vendor/signals/redact.mjs` 的 `home-path` pattern（同一份語義，
// 那邊已在 signal payload 上用了很久）。兩者並存：needle 命中時 token 可讀
// （`<home>/offline/`），regex 負責兜住 needle 蓋不到的 username。
const HOME_PATH_RE = /\/(?:Users|home)\/([^/\s"']+)/g

// 文件裡示範用的佔位路徑（`/Users/<you>/…`、`/Users/...`、`/home/$USER/…`）不是洩漏。
// 少了這層過濾，clade 自家 rule 的說明段就會被算成 violation —— 實測命中
// rules/manual-review.backend.md 與 rules/session-claims.md。
const PLACEHOLDER_USER_RE = /^(?:<|\.{2,}|\$|\{|%|YOUR|your\b)/

const MAINTAINER_ONLY_SKILLS = ['oops', 'improvement-loop', 'review-rules']

// 已退役 generator 留下的 metadata 檔。`sync-to-agents` 於 v1.4.315 更名為
// `sync-to-codex`（commit b05efa9a）時 writer 被一併移除但沒人發現，而
// `sync-to-codex.mjs` 的 cleanup() 每輪 `rm -rf .agents/` 除 skills 外全部 ——
// 於是檔案在 worktree 消失、在 index/HEAD/remote 永存（propagate 的 selective
// `--only` 永遠不會撿起這條 deletion）。內容是投影來源的**絕對路徑**，918–982 條
// `~/...`，含全套 skill 名稱清單，已 push 進兩個 public repo。
//
// 為什麼要獨立一個 scope：這個檔既不在 `.claude/` 底下、也不在 `.hub-state.json`
// checksums 內，scope (2) 兩個條件都不滿足；而且**磁碟上不存在**，`existsSync` 一律
// false。所以必須從 git object 讀，不是從檔案系統讀。
const RETIRED_MANIFEST_RELS = [
  '.agents/.sync-manifest.json',
  '.codex/.sync-manifest.json',
  'template/.agents/.sync-manifest.json',
  'template/.codex/.sync-manifest.json',
]

function parseArgs(argv) {
  const out = { root: null, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--root') {
      out.root = argv[i + 1]
      i += 1
    } else if (a === '--json') {
      out.json = true
    }
  }
  return out
}

async function findRepoRoot(start) {
  let cur = resolve(start)
  while (true) {
    if (existsSync(join(cur, 'template', '.claude', '.hub-state.json'))) return cur
    if (existsSync(join(cur, '.claude', '.hub-state.json'))) return cur
    const parent = dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

function resolveStarterRoot(opts) {
  if (opts.root) {
    return isAbsolute(opts.root) ? opts.root : resolve(process.cwd(), opts.root)
  }
  return process.cwd()
}

async function loadHubStateFiles(repoRoot) {
  const candidates = [
    join(repoRoot, 'template', '.claude', '.hub-state.json'),
    join(repoRoot, '.claude', '.hub-state.json'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) {
      const text = await readFile(c, 'utf8')
      const state = JSON.parse(text)
      const root = c.endsWith('template/.claude/.hub-state.json')
        ? join(repoRoot, 'template', '.claude')
        : join(repoRoot, '.claude')
      return { hubStatePath: c, claudeRoot: root, checksums: state.checksums || {} }
    }
  }
  return null
}

function scanForbiddenTokens(text) {
  const hits = new Set()
  for (const re of FALLBACK_FORBIDDEN_TOKENS) {
    re.lastIndex = 0
    const m = text.match(re)
    if (m) for (const t of m) hits.add(t)
  }
  for (const needle of FALLBACK_PERSONAL_NEEDLES) {
    if (text.includes(needle)) hits.add(needle)
  }
  HOME_PATH_RE.lastIndex = 0
  for (const m of text.matchAll(HOME_PATH_RE)) {
    if (PLACEHOLDER_USER_RE.test(m[1])) continue
    hits.add(m[0])
  }
  return Array.from(hits)
}

// 從 git 讀，不是從檔案系統讀 —— 見 RETIRED_MANIFEST_RELS 的說明。回傳 null 表示
// 該路徑在 git 裡不存在（tracked 與否都算，untracked 由呼叫端另外查磁碟）。
async function readTrackedBlob(repoRoot, rel) {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '--error-unmatch', '--', rel], {
      cwd: repoRoot,
    })
    if (!stdout.trim()) return null
  } catch {
    return null // 非 tracked
  }
  try {
    const { stdout } = await execFileAsync('git', ['show', `HEAD:${rel}`], {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
    })
    return stdout
  } catch {
    return null // tracked 但不在 HEAD（例如剛 git add 的新檔）
  }
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const opts = parseArgs(process.argv.slice(2))
  const startRoot = resolveStarterRoot(opts)
  const repoRoot = (await findRepoRoot(startRoot)) || startRoot

  const violations = []
  const errors = []

  // (1) Maintainer-only skill 殘留偵測
  const agentsSkillsRoot = existsSync(join(repoRoot, 'template'))
    ? join(repoRoot, 'template', '.agents', 'skills')
    : join(repoRoot, '.agents', 'skills')
  for (const name of MAINTAINER_ONLY_SKILLS) {
    const skillDir = join(agentsSkillsRoot, name)
    if (existsSync(skillDir)) {
      violations.push({
        path: skillDir.replace(repoRoot + '/', ''),
        token: `maintainer-only skill: ${name}`,
      })
    }
  }

  // (2) hub-state checksums 列出的所有檔 grep forbidden token
  const state = await loadHubStateFiles(repoRoot)
  if (!state) {
    errors.push(
      `no .hub-state.json found under ${repoRoot}/template/.claude/ or ${repoRoot}/.claude/ — audit cannot proceed`,
    )
  } else {
    for (const rel of Object.keys(state.checksums)) {
      const abs = join(state.claudeRoot, rel)
      if (!existsSync(abs)) continue
      let text
      try {
        text = await readFile(abs, 'utf8')
      } catch (err) {
        errors.push(`${rel}: read failed (${err.message.split('\n')[0]})`)
        continue
      }
      const hits = scanForbiddenTokens(text)
      for (const token of hits) {
        violations.push({ path: rel, token })
      }
    }
  }

  // (3) 已退役 generator 的 metadata 檔 —— git object 與磁碟都要看
  for (const rel of RETIRED_MANIFEST_RELS) {
    const blob = await readTrackedBlob(repoRoot, rel)
    if (blob !== null) {
      const hits = scanForbiddenTokens(blob)
      // 即使沒命中 token，這個檔本身就是不該還在版控裡的退役產物（無 writer 重生）。
      violations.push({
        path: `${rel} (git HEAD)`,
        token: 'retired sync-manifest still tracked (generator removed in v1.4.315)',
      })
      for (const token of hits) violations.push({ path: `${rel} (git HEAD)`, token })
    }

    const abs = join(repoRoot, rel)
    if (existsSync(abs)) {
      let text = ''
      try {
        text = await readFile(abs, 'utf8')
      } catch (err) {
        errors.push(`${rel}: read failed (${err.message.split('\n')[0]})`)
        continue
      }
      const hits = scanForbiddenTokens(text)
      if (hits.length > 0) {
        // 磁碟上存在但可能還沒進版控 —— 一次 `git add -A` 就會 leak。
        for (const token of hits) violations.push({ path: `${rel} (worktree)`, token })
      }
    }
  }

  // Output
  if (opts.json) {
    const out = { ok: violations.length === 0 && errors.length === 0, violations, errors }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  } else {
    if (errors.length > 0) {
      process.stderr.write('audit errors:\n')
      for (const e of errors) process.stderr.write(`  ✘ ${e}\n`)
    }
    if (violations.length === 0) {
      process.stdout.write('✓ audit-clade-leak: 0 violations\n')
    } else {
      process.stdout.write(`✘ audit-clade-leak: ${violations.length} violations\n`)
      const grouped = new Map()
      for (const v of violations) {
        if (!grouped.has(v.path)) grouped.set(v.path, [])
        grouped.get(v.path).push(v.token)
      }
      for (const [path, tokens] of grouped) {
        process.stdout.write(`  ${path}\n`)
        for (const t of tokens) process.stdout.write(`    - ${t}\n`)
      }
    }
  }

  process.exit(violations.length > 0 || errors.length > 0 ? 1 : 0)
}

const invokedDirect = fileURLToPath(import.meta.url) === resolve(process.argv[1] || '')
if (invokedDirect) {
  main().catch((err) => {
    process.stderr.write(`audit-clade-leak crashed: ${err.message}\n`)
    process.exit(2)
  })
}
