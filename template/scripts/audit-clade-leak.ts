#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/audit-clade-leak.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/audit-clade-leak.ts
// CLADE:VENDOR-SCRIPT
/**
 * audit-clade-leak.ts — PUBLIC consumer 0-leak audit
 *
 * 適用對象是**每一個 PUBLIC repo consumer**，不是只有 starter：投影條件在
 * `scripts/lib/vendor-targets.ts` 綁 `consumerIsPublic`（2026-08-13 由 `starterOnly`
 * 改判準，TD-414）。判準是「公不公開」，**NEVER** 改回綁某個 consumer 身分——
 * v1.4.502 的實際後果是 fleet 兩個 PUBLIC repo 只有一個拿得到這支 audit，另一個
 * 零層防護一路綠燈 push 上公開 GitHub。
 *
 * 用途：clade 中央倉的 rule /
 * skill / commands / agents 內含 consumer 名稱（<consumer-a> / <consumer-b> / <consumer-c> /
 * <consumer-d> / <consumer-c>）、personal path (`~/`)、
 * personal email (`<maintainer-email>`)、客戶名 (<client-a> / <client-b>)、
 * 以及未該對外曝光的 maintainer skill (`oops` / `improvement-loop` / `review-rules`)。
 *
 * Sanitization 在 clade 端 propagate 時自動處理（v1.4.349 起依 repo visibility
 * 套用 registry 生成的 fleet profile）；本 script 是**成果驗證用的手動工具**，
 * 直接 grep `template/.claude/` 內 clade-managed checksums 列出的所有檔，
 * 任何 forbidden token / maintainer-only skill 殘留 → exit 1。
 *
 * 執行載體（per `rules/core/checker-contract.md` § 執行載體）：**沒有**自動觸發點。
 * 唯一消費端是 `pnpm audit:manual`（registry/audits.json 宣告 cadence `on-demand`
 * / consumers `["npm-script"]` / blocking false）。**不要**把檔頭寫成「CI gate」——
 * starter CI 從未跑過它，那是願望不是現況（TD-273）。
 *
 * Fleet 名冊 token 是「**自身以外**的 consumer 名」：`selfAliases()` 依 repo 目錄名 /
 * `package.json` name / git remote 判出這個 repo 自己是誰，把對應 token 從清單移除，
 * 否則 `<consumer-c>` 會對自己的名字報約 100 條類別錯誤的 violation。
 * 被排除的 token **一律印出來**（text 與 `--json` 都有）：那是覆蓋面的縮減，
 * **NEVER** 讓它靜默發生——靜默排除與「這個 repo 很乾淨」輸出完全同形。
 *
 * Scope:
 *   1. `template/.agents/skills/{oops,improvement-loop,review-rules}/` 殘留：
 *      若任一存在 → violation（maintainer-only skill 不該散播到公開 repo）
 *   2. `template/.claude/` checksums 列出的所有檔：grep forbidden tokens
 *      （consumer name 別名 + personal redactions needles + home-path regex）
 *   3. 已退役 generator 的 `{,template/}.{agents,codex}/.sync-manifest.json`：
 *      **從 git object 讀**（該檔已不在 worktree，leak 只存在於 index/HEAD）
 *
 * Output:
 *   - 0 violations → exit 0
 *   - 1+ violations → 列每條 `<path>: <token>` 後 exit 1
 *
 * Usage:
 *   node vendor/scripts/audit-clade-leak.ts                    # 預設 cwd = repo root
 *   node vendor/scripts/audit-clade-leak.ts --root <path>      # 指定 consumer repo root
 *   node vendor/scripts/audit-clade-leak.ts --all-consumers    # 掃 registry 內所有帶
 *                                                              # sanitization_profile 的
 *                                                              # consumer（只在 clade home 可用）
 *   node vendor/scripts/audit-clade-leak.ts --json             # 機器輸出
 *   node vendor/scripts/audit-clade-leak.ts --self <token>     # 額外指定「這是我自己的名字」
 *                                                              # （可重複；自動偵測判不出時用）
 *
 * 觸發點：**手動**（`pnpm audit:manual`）。
 *   ⚠️ 本檔曾聲稱「starter CI（GitHub Actions）作 mandatory job」——2026-07-26 查證
 *   為不實：starter 的 `.github/workflows/` 與 `package.json` 皆無此 job，
 *   `propagate.ts` 也沒有呼叫它（只有一句註解）。宣告已改為 on-demand，
 *   接上真實消費端要走 TD-273。
 *
 *   `--all-consumers` 只掃帶 `sanitization_profile` 的 consumer —— 那是宣告層的
 *   「這個 repo 需要去敏感化」，與 self-exclusion 正交。
 *
 * 對應 governance：clade `scripts/lib/sanitization-governance.ts`。
 */

import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// 嘗試 import clade-managed lib（若 starter 端的 .clade/ 投影 / consumer scripts/
// 已有同步副本，路徑會穩定）。failure 時 fallback hardcode 一份 minimal list 避免
// audit 自身因 missing dep 而綠燈過。
// IMPORTANT：在 starter 端跑時，starter 倉本身**不**會內含這份 lib（clade
// `scripts/lib/` 是 clade 中央倉自己的，不散播到 starter）。所以必須 fallback。

// Fleet 名冊 + 客戶名。語義是「**這個 repo 以外**的 consumer / 客戶名字」——
// 掃描前會依 selfAliases() 把該 repo 自己的名字移除（見檔頭）。
//
// **一組 = 一個身分的所有別名**（對應 `sanitization_profile.consumer_name_map` 裡
// 共用同一個 placeholder 的那幾個 key，如 `<consumer-c>` 與 `<consumer-c>` 都是
// `<consumer-c>`）。自身偵測命中組內任一別名就**整組**排除——只排掉命中的那一個，
// 該 repo 會對自己的短名報 violation，那是同一個類別錯誤換個名字回來。
const FLEET_ALIAS_GROUPS = [
  ['<consumer-c>', '<consumer-c>'],
  ['<consumer-d>'],
  ['<consumer-a>'],
  ['<consumer-b>'],
  ['<client-a>'],
  ['<client-b>'],
]

const FLEET_NAME_TOKENS = FLEET_ALIAS_GROUPS.flat()

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
// `sync-to-codex.ts` 的 cleanup() 每輪 `rm -rf .agents/` 除 skills 外全部 ——
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
  const out = { root: null, json: false, allConsumers: false, self: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--root') {
      out.root = argv[i + 1]
      i += 1
    } else if (a === '--json') {
      out.json = true
    } else if (a === '--all-consumers') {
      out.allConsumers = true
    } else if (a === '--self') {
      if (argv[i + 1]) out.self.push(argv[i + 1])
      i += 1
    }
  }
  return out
}

// registry 只在 clade home 存在（本檔會被散播到 consumer，那邊沒有 registry），
// 所以 --all-consumers 找不到 registry 時要明講而不是靜默掃 0 個。
// 只回傳帶 sanitization_profile 的 consumer —— 判準是為公開 repo 設計的，
// 對私有 consumer 跑會得到約 100 條類別錯誤的「violation」（見檔頭）。
// 兩個 SoT 要對起來：`registry/consumers.json` 說「誰帶 sanitization_profile」（宣告層，
// 不含路徑），`consumers.local` 說「本機路徑」（每行一條，可帶 `flow=` 後綴）。
async function resolveSanitizedConsumers(cladeRoot) {
  const registryPath = join(cladeRoot, 'registry', 'consumers.json')
  const localPath = join(cladeRoot, 'consumers.local')
  if (!existsSync(registryPath) || !existsSync(localPath)) {
    return {
      error: `--all-consumers 需要 registry/consumers.json 與 consumers.local（在 ${cladeRoot} 找不到）`,
    }
  }

  const parsed = JSON.parse(await readFile(registryPath, 'utf8'))
  const sanitizedIds = (parsed.consumers || parsed)
    .filter((entry) => entry?.sanitization_profile)
    .map((entry) => entry.consumer_id)
    .filter(Boolean)

  const localRoots = (await readFile(localPath, 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0])

  const roots = localRoots.filter(
    (p) => existsSync(p) && sanitizedIds.some((id) => p.includes(`/${id}`)),
  )
  return { roots }
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

// 這個 repo 自己叫什麼：目錄名 / package.json name / git remote 三個來源任一命中即算。
// 三個都查不到時回空集合 —— 那代表**一個 token 都不排除**（保守方向：寧可多報，
// 不可少掃）。呼叫端負責把結果印出來。
async function selfAliases(repoRoot, extra = []) {
  const haystacks = [basename(repoRoot)]

  for (const rel of ['package.json', 'template/package.json']) {
    const abs = join(repoRoot, rel)
    if (!existsSync(abs)) continue
    try {
      const pkg = JSON.parse(await readFile(abs, 'utf8'))
      if (typeof pkg?.name === 'string') haystacks.push(pkg.name)
    } catch {
      // package.json 壞掉不是本 audit 的職責，其他來源照走
    }
  }

  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: repoRoot,
    })
    haystacks.push(stdout.trim())
  } catch {
    // 沒有 origin（新 repo / 純本機）—— 其他來源照走
  }

  const lowered = haystacks.filter(Boolean).map((h) => h.toLowerCase())
  const self = new Set()
  for (const group of FLEET_ALIAS_GROUPS) {
    const hitByName = group.some((t) => lowered.some((h) => h.includes(t.toLowerCase())))
    const hitByFlag = group.some((t) => extra.some((e) => e.toLowerCase() === t.toLowerCase()))
    if (hitByName || hitByFlag) for (const t of group) self.add(t)
  }
  return self
}

function forbiddenTokenRegexes(selfSet) {
  return FLEET_NAME_TOKENS.filter((t) => !selfSet.has(t)).map(
    (t) => new RegExp(String.raw`\b${t}\b`, 'g'),
  )
}

function scanForbiddenTokens(text, tokenRegexes) {
  const hits = new Set()
  for (const re of tokenRegexes) {
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

const TEXTUAL_REL_RE = /\.(md|mjs|cjs|js|mts|cts|ts|json|jsonc|sh|bash|zsh|yml|yaml|txt)$/i

// git tracked 檔案清單（限定前綴）。用 git 而非 readdir：未 tracked 的東西不算
// 洩漏，掃它只會製造假陽性。
async function listTrackedUnder(repoRoot, prefixes) {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '--', ...prefixes], {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
    })
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

async function auditOneRoot(repoRoot, selfFlags = []) {
  const violations = []
  const errors = []
  const self = await selfAliases(repoRoot, selfFlags)
  const tokenRegexes = forbiddenTokenRegexes(self)

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
      // symlink 模式的 consumer（`.claude/rules/*.md` → `.clade/runtime/rules/`）：
      // git 裡存的是 mode 120000 的 53-byte 路徑字串，**target 未 tracked**，所以那些
      // 內容根本沒有被公開。readFile 會跟隨 symlink 讀到本機檔案，於是把「本機有」
      // 誤報成「已洩漏」——2026-07-26 實測讓 <consumer-c> 虛報 39 處 <consumer-a> / 32 處
      // <consumer-b> / 5 處 <client-a>，全部來自未 tracked 的 symlink target。
      // 公開洩漏的判準是「git 裡有什麼」，不是「檔案系統上有什麼」。
      let stats
      try {
        stats = await lstat(abs)
      } catch (err) {
        errors.push(`${rel}: lstat failed (${err.message.split('\n')[0]})`)
        continue
      }
      if (stats.isSymbolicLink()) continue

      let text
      try {
        text = await readFile(abs, 'utf8')
      } catch (err) {
        errors.push(`${rel}: read failed (${err.message.split('\n')[0]})`)
        continue
      }
      const hits = scanForbiddenTokens(text, tokenRegexes)
      for (const token of hits) {
        violations.push({ path: rel, token })
      }
    }
  }

  // (2b) `.clade/**` —— clade 投影出去、但不在 hub-state checksums 內的那一層。
  // 這裡曾是完全的盲區：`.clade/registry/consumers.json` 放著整份 fleet 名冊
  // （每個 consumer_id + repo_id，含客戶 org 名），是 TD-274 裡單項最嚴重的洩漏，
  // 而 audit 從頭到尾沒掃過它——清完 checksums 那層會以為已經乾淨。
  //
  // 判準一律是「git 裡有什麼」：symlink 在 git 裡只是路徑字串，讀 blob 天然不會
  // 把未 tracked 的 target 內容誤報成已洩漏（TD-274 § 兩個量測錯誤）。
  for (const rel of await listTrackedUnder(repoRoot, ['.clade', 'template/.clade'])) {
    if (!TEXTUAL_REL_RE.test(rel)) continue
    const blob = await readTrackedBlob(repoRoot, rel)
    if (blob === null) continue
    for (const token of scanForbiddenTokens(blob, tokenRegexes)) {
      violations.push({ path: rel, token })
    }
  }

  // (3) 已退役 generator 的 metadata 檔 —— git object 與磁碟都要看
  for (const rel of RETIRED_MANIFEST_RELS) {
    const blob = await readTrackedBlob(repoRoot, rel)
    if (blob !== null) {
      const hits = scanForbiddenTokens(blob, tokenRegexes)
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
      const hits = scanForbiddenTokens(text, tokenRegexes)
      if (hits.length > 0) {
        // 磁碟上存在但可能還沒進版控 —— 一次 `git add -A` 就會 leak。
        for (const token of hits) violations.push({ path: `${rel} (worktree)`, token })
      }
    }
  }

  return { violations, errors, selfExcluded: Array.from(self) }
}

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const opts = parseArgs(process.argv.slice(2))

  let roots
  if (opts.allConsumers) {
    const resolved = await resolveSanitizedConsumers(resolve(scriptDir, '..', '..'))
    if (resolved.error) {
      process.stderr.write(`${resolved.error}\n`)
      process.exit(2)
    }
    roots = resolved.roots
    if (roots.length === 0) {
      process.stderr.write('registry 內沒有帶 sanitization_profile 的 consumer\n')
      process.exit(2)
    }
  } else {
    const startRoot = resolveStarterRoot(opts)
    roots = [(await findRepoRoot(startRoot)) || startRoot]
  }

  const violations = []
  const errors = []
  const selfExcluded = []
  for (const root of roots) {
    const res = await auditOneRoot(root, opts.self)
    // 多 root 時在 path 前綴 repo 名，否則兩個 consumer 的同名路徑會混在一起讀不出來。
    const label = roots.length > 1 ? `${basename(root)}/` : ''
    for (const v of res.violations) violations.push({ ...v, path: `${label}${v.path}` })
    for (const e of res.errors) errors.push(`${label}${e}`)
    selfExcluded.push({ root: basename(root), tokens: res.selfExcluded })
  }

  // Output
  if (opts.json) {
    const out = {
      ok: violations.length === 0 && errors.length === 0,
      violations,
      errors,
      selfExcluded,
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  } else {
    if (errors.length > 0) {
      process.stderr.write('audit errors:\n')
      for (const e of errors) process.stderr.write(`  ✘ ${e}\n`)
    }
    // 覆蓋面的縮減一律先印，NEVER 讓它藏在 0 violations 後面。
    for (const { root, tokens } of selfExcluded) {
      const shown =
        tokens.length > 0 ? tokens.join(', ') : '(none — 自身身分判不出，全部 token 照掃)'
      process.stdout.write(`ℹ self-exclusion ${root}: ${shown}\n`)
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

// CLI 進入判定：兩邊都 realpath。node 預設把 import.meta.url realpath 化、
// process.argv[1] 則原樣保留，經 symlink 叫進去兩者不相等 → 整個 CLI 區塊被靜默
// 跳過且 exit 0，長相與「一切正常」無法區分（TD-460）。
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
  main().catch((err) => {
    process.stderr.write(`audit-clade-leak crashed: ${err.message}\n`)
    process.exit(2)
  })
}
