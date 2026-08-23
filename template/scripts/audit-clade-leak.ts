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
 * 用途：偵測 clade 中央倉的 rule / skill / commands / agents 帶進公開 repo 的
 * 四類洩漏 —— 其他 consumer 與客戶的**名稱**、maintainer 的**個人路徑**、
 * maintainer 的 **email / 網域**，以及未該對外曝光的 maintainer skill
 * (`oops` / `improvement-loop` / `review-rules`)。
 *
 * 前三類的 token 表**一律 runtime 解析、不落字面**（TD-503）：字面寫在這裡會被
 * propagate 的 sanitization 逐字改寫成它自己的替換值，投影副本因此掃錯東西。
 * 來源與失效形狀見下方 `IDENTITY` 上方那段，**改動前先讀完**。
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
 *      （consumer name 別名 + personal redaction needles + home-path regex；
 *      consumer 名冊只在 clade home 載得到，見 `IDENTITY`）
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
 *   node vendor/scripts/audit-clade-leak.ts --all-consumers    # 掃 consumers.local 內所有
 *                                                              # visibility == PUBLIC 的
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
 *   `--all-consumers` 掃 **visibility == PUBLIC** 的 consumer（走
 *   `scripts/lib/repo-visibility.ts`，與 propagate 判去敏感化的同一個來源）。
 *   NEVER 改回「帶 sanitization_profile」那個宣告層判準：宣告漏一次 = 該 repo 的
 *   consumer 名偵測永久盲（TD-612）。
 *
 * 對應 governance：clade `scripts/lib/sanitization-governance.ts`。
 */

import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// 嘗試 import clade-managed lib（若 starter 端的 .clade/ 投影 / consumer scripts/
// 已有同步副本，路徑會穩定）。failure 時 fallback hardcode 一份 minimal list 避免
// audit 自身因 missing dep 而綠燈過。
// IMPORTANT：在 starter 端跑時，starter 倉本身**不**會內含這份 lib（clade
// `scripts/lib/` 是 clade 中央倉自己的，不散播到 starter）。所以必須 fallback。

// ─── Identity tables：一律 runtime 解析，NEVER 落字面（TD-503）──────────────
//
// 這裡**刻意不寫**任何個人路徑 / email / consumer 名的字面。本檔會被散播到每個
// PUBLIC consumer，而 propagate 對投影出去的每個檔逐字套 sanitization profile
// （consumer 名 regex + personal_redactions 字面比對）—— 字面 needle 因此在投影
// 副本裡被改寫成它自己的**替換值**：maintainer 的 home 前綴變成 `~/`、consumer 名
// 變成 `<consumer-x>`。改寫後那份 audit 掃的是 `~/`（技術文件裡到處都是）與從不
// 出現的 placeholder：
// 實測 <consumer-c> 24 條 violation 全部假陽性，consumer 名偵測全失效。
//
// NEVER 把任一條 needle 改回字面（即使「只有一條、看起來無害」）：needle 與
// sanitization 用的是同一份字串比對，寫進來就必然被改寫。也 NEVER 用「把 `~/`
// 加進白名單」繞過 —— 那讓 audit 對個人路徑這**整個類別**失去偵測力，而那正是
// 它最主要的職責（v1.4.502 外洩的 `.sync-manifest.json` 就是 918–982 條絕對路徑）。
//
// 兩張表的來源：
//   - **consumer 名冊**：`registry/consumers.json` ＋ `scripts/lib/sanitization-governance.ts`
//     的 `buildFleetProfile()` —— 即 propagate 實際拿來遮蔽的**同一份** profile
//     （順帶消掉「硬寫名冊 vs registry 漂移」）。兩者只在 **clade home** 存在，
//     consumer 端的投影副本讀不到 → 名冊為空、consumer 名偵測不執行，改由 clade 端
//     `node vendor/scripts/audit-clade-leak.ts --all-consumers` 承接。覆蓋面的縮減
//     **一律印出來**（見 main()），NEVER 讓它靜默發生。
//     `--all-consumers` 的選取判準是「repo visibility == PUBLIC」（TD-612 起），
//     所以 consumer 端讀不到名冊的那一半，在 clade 端由**每一個** PUBLIC consumer
//     承接，不再取決於有沒有人替它手寫 sanitization_profile。
//   - **個人路徑 / email**：由執行者環境當場派生（`homedir()` / `userInfo()` /
//     `git config user.email`）。語義因此是「跑這支 audit 的人的個人身分外洩了嗎」，
//     在 clade home 與 consumer 端都成立，且不依賴任何落檔的字面。
let IDENTITY = {
  aliasGroups: [],
  nameTokens: [],
  personalNeedles: [],
  rosterSource: null,
  notices: [],
}

// 通用 email domain 不當 needle：有人用個人 gmail 跑這支 audit 時，`gmail.com`
// 會把每個提到它的文件變成 violation。
const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'qq.com',
  'proton.me',
  'protonmail.com',
  'users.noreply.github.com',
])

// 兩個平台 layout 各派生一份：redaction 與偵測都是逐字比對，缺一邊等於該平台上
// 完全偵測不到洩漏（同 sanitization-governance 的 personal_redactions）。
function derivePersonalNeedles() {
  const needles = new Set<string>()
  const users = new Set<string>()
  try {
    const u = userInfo().username
    if (u) users.add(u)
  } catch {
    // 沒有 passwd entry（容器 / CI）—— homedir() 那條照走
  }
  const home = homedir()
  if (home) users.add(basename(home))
  for (const user of users) {
    if (!user || user === '/' || user === '.') continue
    for (const prefix of [`/Users/${user}`, `/home/${user}`]) {
      needles.add(`${prefix}/.local/bin/`)
      needles.add(`${prefix}/offline/clade`)
      needles.add(`${prefix}/offline/`)
      needles.add(`${prefix}/`)
    }
  }
  // 非標準 home layout（`/root`、`/var/home/...`）—— 上面兩個前綴都蓋不到
  if (home && !home.startsWith('/Users/') && !home.startsWith('/home/')) needles.add(`${home}/`)
  return needles
}

async function deriveEmailNeedles() {
  const needles = new Set<string>()
  let email = ''
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'user.email'])
    email = stdout.trim()
  } catch {
    // 沒設 git email —— 個人路徑那條照走
  }
  if (!email.includes('@')) return needles
  needles.add(email)
  const domain = email.split('@').pop()
  if (domain && domain.includes('.') && !GENERIC_EMAIL_DOMAINS.has(domain.toLowerCase())) {
    needles.add(domain)
  }
  return needles
}

// registry 的 consumer_name_map：一個 placeholder = 一個身分的所有別名（`<consumer-c>`
// 與 `<consumer-c>` 共用 `<consumer-c>`）。分組後 selfAliases() 命中組內
// 任一別名就整組排除 —— 只排掉命中的那一個，該 repo 會對自己的短名報 violation。
function groupAliasesByPlaceholder(nameMap) {
  const byPlaceholder = new Map()
  for (const [name, placeholder] of Object.entries(nameMap || {})) {
    if (!name || !placeholder) continue
    if (!byPlaceholder.has(placeholder)) byPlaceholder.set(placeholder, new Set())
    byPlaceholder.get(placeholder).add(name)
  }
  return Array.from(byPlaceholder.values(), (set) => Array.from(set))
}

// registry 內各 consumer 手寫的 sanitization_profile 的 union —— governance lib
// import 不到時的退路（欄位語義相同，只是不含 registry 動態生成的新 consumer）。
function declaredNameMap(registry) {
  const merged = {}
  for (const entry of registry?.consumers || registry || []) {
    Object.assign(merged, entry?.sanitization_profile?.consumer_name_map || {})
  }
  return merged
}

// clade home 才有 registry / governance lib；consumer 端的投影副本兩者皆無。
async function loadFleetIdentity(cladeRoot) {
  const notices = []
  const registryPath = join(cladeRoot, 'registry', 'consumers.json')
  if (!existsSync(registryPath)) {
    notices.push(
      'fleet 名冊未載入（本副本沒有 registry/consumers.json）— consumer 名偵測未執行，' +
        '個人路徑 / email 偵測照跑；名冊那半要在 clade home 跑 `--all-consumers`' +
        '（涵蓋每一個 visibility == PUBLIC 的 consumer）',
    )
    return { groups: [], personalNeedles: [], source: null, notices }
  }

  let registry
  try {
    registry = JSON.parse(await readFile(registryPath, 'utf8'))
  } catch (err) {
    notices.push(
      `registry/consumers.json 解析失敗（${err.message.split('\n')[0]}）— consumer 名偵測未執行`,
    )
    return { groups: [], personalNeedles: [], source: null, notices }
  }

  let profile = null
  const libPath = join(cladeRoot, 'scripts', 'lib', 'sanitization-governance.ts')
  if (existsSync(libPath)) {
    try {
      const mod = await import(pathToFileURL(libPath).href)
      profile = mod.buildFleetProfile(registry)
    } catch (err) {
      notices.push(
        `sanitization-governance 載入失敗（${err.message.split('\n')[0]}）— 改用 registry 手寫 profile 的 union`,
      )
    }
  }

  const nameMap = profile?.consumer_name_map ?? declaredNameMap(registry)
  return {
    groups: groupAliasesByPlaceholder(nameMap),
    // clade 端把 propagate 實際用的 redaction needle 一併納入：那是本機環境派生
    // 不出來的部分（例如 maintainer 的其他 layout）。consumer 端沒有這份。
    personalNeedles: Object.keys(profile?.personal_redactions || {}),
    source: profile ? 'registry + buildFleetProfile()' : 'registry (手寫 profile union)',
    notices,
  }
}

async function resolveIdentity(cladeRoot) {
  const fleet = await loadFleetIdentity(cladeRoot)
  const personal = new Set([
    ...derivePersonalNeedles(),
    ...(await deriveEmailNeedles()),
    ...fleet.personalNeedles,
  ])
  IDENTITY = {
    aliasGroups: fleet.groups,
    nameTokens: fleet.groups.flat(),
    // 長的排前面，命中時 token 讀起來是最具體的那條
    personalNeedles: Array.from(personal).toSorted((a, b) => b.length - a.length),
    rosterSource: fleet.source,
    notices: fleet.notices,
  }
}

// 上面那份是逐字 needle，只認**執行者自己**的 username。這條 regex 補「任意 username ×
// 兩平台」，來源是 `vendor/signals/redact.mjs` 的 `home-path` pattern（同一份語義，
// 那邊已在 signal payload 上用了很久）。兩者並存：needle 命中時 token 可讀
// （`/Users/<you>/offline/`），regex 負責兜住 needle 蓋不到的 username。
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
//
// 選取判準是 **repo visibility == PUBLIC**，NEVER「registry 帶 sanitization_profile」
// （TD-612）：後者是**宣告層**——有人手寫了 profile 才算數，於是「PUBLIC 但沒人替它
// 寫 profile」的 consumer 兩邊都掃不到 consumer 名（consumer 端投影副本讀不到
// registry、clade 端這裡又沒選到它）。宣告漏一次 = 該 repo 的名冊偵測永久盲。
// visibility 則是 repo 的客觀狀態，補不補 profile 都不影響它被掃到。
//
// visibility 不落 registry（那會變成第二份會漂移的真相，per TD-274），一律走
// `scripts/lib/repo-visibility.ts` 的三層解析（memo → 快取檔 → `gh repo view`），
// 與 propagate 判「要不要去敏感化」用的是**同一個**來源。
//
// 判不出 visibility 的 consumer **NEVER 靜默跳過**：跳過它就是 TD-612 的盲區原樣
// 復發。一律回進 `errors` 讓輸出變紅，其餘 PUBLIC consumer 照掃。
//
// 三個 SoT 要對起來：`registry/consumers.json` 給 `consumer_id → repo_id`、
// visibility 解析給 `repo_id → PUBLIC?`、`consumers.local` 給本機路徑
// （每行一條，可帶 `flow=` 後綴）。
export async function resolvePublicConsumers(
  cladeRoot,
  opts: { getVisibility?: (repoId: string) => boolean | Promise<boolean> } = {},
) {
  const registryPath = join(cladeRoot, 'registry', 'consumers.json')
  const localPath = join(cladeRoot, 'consumers.local')
  if (!existsSync(registryPath) || !existsSync(localPath)) {
    return {
      error: `--all-consumers 需要 registry/consumers.json 與 consumers.local（在 ${cladeRoot} 找不到）`,
    }
  }

  const parsed = JSON.parse(await readFile(registryPath, 'utf8'))
  const entries = (parsed.consumers || parsed).filter((e) => e?.consumer_id)

  const getVisibility = opts.getVisibility ?? (await loadVisibilityResolver(cladeRoot))
  if (!getVisibility) {
    return {
      error:
        `--all-consumers 需要 scripts/lib/repo-visibility.ts 判定哪些 repo 是 PUBLIC` +
        `（在 ${cladeRoot} 找不到）—— 沒有它就只能靠宣告層猜，那正是 TD-612 的盲區`,
    }
  }

  const localRoots = (await readFile(localPath, 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0])
    .filter((p) => existsSync(p))

  const roots = []
  const errors = []
  for (const path of localRoots) {
    const entry = matchConsumerEntry(path, entries)
    if (!entry) {
      errors.push(
        `${path}: consumers.local 有這條路徑，但 registry 找不到對應 consumer_id —— ` +
          `判不出 repo visibility，本輪未掃描（補 registry 條目或移除該行）`,
      )
      continue
    }
    if (!entry.repo_id) {
      errors.push(`${entry.consumer_id}: registry 缺 repo_id —— 判不出 repo visibility，本輪未掃描`)
      continue
    }
    let visibility
    try {
      visibility = await getVisibility(entry.repo_id, { cladeRoot })
    } catch (err) {
      errors.push(
        `${entry.consumer_id}: repo visibility 判不出（${
          err.message.split('\n')[0]
        }）—— 本輪未掃描，NEVER 當成「不是 PUBLIC」`,
      )
      continue
    }
    if (visibility !== 'PUBLIC') continue
    roots.push({ path, consumerId: entry.consumer_id, repoId: entry.repo_id, visibility })
  }
  return { roots, errors }
}

// 路徑 → consumer：比對**路徑區段**而非 substring。substring 會讓 `<consumer-h>` 命中
// `<consumer-g>`，而選錯 consumer 就是選錯 repo_id、選錯 visibility。
// 多個區段都命中時取最長的 id（`<consumer-g>` 勝過 `<consumer-h>`）。
function matchConsumerEntry(path, entries) {
  const segments = new Set(path.split('/').filter(Boolean))
  let best = null
  for (const entry of entries) {
    if (!segments.has(entry.consumer_id)) continue
    if (!best || entry.consumer_id.length > best.consumer_id.length) best = entry
  }
  return best
}

// visibility 解析 lib 只在 clade home 有（`scripts/lib/` 不散播到 consumer），
// 與 loadFleetIdentity 對 sanitization-governance 的處理同型。
async function loadVisibilityResolver(cladeRoot) {
  const libPath = join(cladeRoot, 'scripts', 'lib', 'repo-visibility.ts')
  if (!existsSync(libPath)) return null
  try {
    const mod = await import(pathToFileURL(libPath).href)
    return mod.getRepoVisibility ?? null
  } catch {
    return null
  }
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
  for (const group of IDENTITY.aliasGroups) {
    const hitByName = group.some((t) => lowered.some((h) => h.includes(t.toLowerCase())))
    const hitByFlag = group.some((t) => extra.some((e) => e.toLowerCase() === t.toLowerCase()))
    if (hitByName || hitByFlag) for (const t of group) self.add(t)
  }
  return self
}

function forbiddenTokenRegexes(selfSet) {
  return IDENTITY.nameTokens
    .filter((t) => !selfSet.has(t))
    .map((t) => new RegExp(String.raw`\b${t}\b`, 'g'))
}

function scanForbiddenTokens(text, tokenRegexes) {
  const hits = new Set()
  for (const re of tokenRegexes) {
    re.lastIndex = 0
    const m = text.match(re)
    if (m) for (const t of m) hits.add(t)
  }
  for (const needle of IDENTITY.personalNeedles) {
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

  // 掃描前先解析身分表：consumer 名冊（clade home 才有）＋ 個人路徑 / email
  // （環境派生）。NEVER 把它改成 module 載入期的字面常數，成因見 IDENTITY 上方。
  await resolveIdentity(resolve(scriptDir, '..', '..'))

  let roots
  const errors = []
  if (opts.allConsumers) {
    const resolved = await resolvePublicConsumers(resolve(scriptDir, '..', '..'))
    if (resolved.error) {
      process.stderr.write(`${resolved.error}\n`)
      process.exit(2)
    }
    roots = resolved.roots
    // 判不出 visibility 的 consumer 進 errors —— 覆蓋面縮減一律出聲並讓輸出變紅，
    // NEVER 讓「跳過了幾個」藏在 0 violations 後面（TD-612）。
    errors.push(...resolved.errors)
    if (roots.length === 0) {
      process.stderr.write('consumers.local 內沒有 PUBLIC consumer（visibility 判定後）\n')
      process.exit(2)
    }
  } else {
    const startRoot = resolveStarterRoot(opts)
    const path = (await findRepoRoot(startRoot)) || startRoot
    roots = [{ path, consumerId: basename(path), repoId: null, visibility: null }]
  }

  const violations = []
  const selfExcluded = []
  for (const { path: root } of roots) {
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
      roots,
      rosterSource: IDENTITY.rosterSource,
      notices: IDENTITY.notices,
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  } else {
    if (errors.length > 0) {
      process.stderr.write('audit errors:\n')
      for (const e of errors) process.stderr.write(`  ✘ ${e}\n`)
    }
    // 覆蓋面的縮減一律先印，NEVER 讓它藏在 0 violations 後面。
    // 名冊來源同理：`consumer 名偵測未執行` 與「掃過了、很乾淨」的輸出完全同形。
    for (const n of IDENTITY.notices) process.stdout.write(`ℹ ${n}\n`)
    process.stdout.write(
      `ℹ fleet 名冊：${IDENTITY.nameTokens.length} tokens${
        IDENTITY.rosterSource ? ` (${IDENTITY.rosterSource})` : ''
      }\n`,
    )
    if (opts.allConsumers) {
      process.stdout.write(
        `ℹ 掃描面（PUBLIC repo）：${roots.map((r) => r.consumerId).join(', ')}\n`,
      )
    }
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
