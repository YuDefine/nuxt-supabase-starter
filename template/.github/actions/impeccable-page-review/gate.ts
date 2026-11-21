#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/actions/impeccable-page-review/gate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/actions/impeccable-page-review/gate.ts
// CLADE:VENDOR-SCRIPT
// impeccable-page-review — 新頁面／新專案的 impeccable critique＋audit 收據關卡。
//
// AI 判讀（`impeccable critique`、`impeccable audit`）在 /commit 0-B.3 由本機 session 用訂閱帳號跑，
// 跑完以 `stamp` 寫收據進 `.impeccable/page-reviews/`；`check` 只做機械核對，不花模型額度。
//
// 誰要收據（targets）：
//   - 新頁面：本 PR 新增的路由檔（預設 `(^|/)pages/.+\.(vue|tsx|jsx)$`，涵蓋 Nuxt 的 pages/、
//     app/pages/、packages/<x>/app/pages/）。內容有改的改名算新增，100% 相同的純搬移不算。既有頁面的修改不要求。只要求有採用標記（所屬目錄或祖先）覆蓋的檔。
//   - 新專案：merge base 的樹上一個 UI 檔（.vue/.css/.scss/.html/.tsx/.jsx）都沒有（投影層不算：preset 的 PROJECTION_EXCLUDES 目錄條目與 .clade/generated-files.json 列出的檔）。此時新增的路由檔都要收據；
//     一個路由檔都沒有就改成新增的每個 UI 檔都要收據。
//
// 收據合格＝target 的 sha256 等於現在內容（審完又改就失效，要重審）、critique 與 audit 兩份報告
// 檔存在且 sha256 吻合、兩者 P0 與 P1 都是 0。
// 目前只記不擋：check 把不合格項印成 warning、一律 exit 0；沒有 --enforce、沒有 pre-push 與 CI 關卡，
// 本檔也刻意不帶 action.yml（不當 CI action 投影）。exit 2 只給用法／環境錯。
// 政策輸入（routePattern、投影清單）一律取 merge base，PR 改不動自己的判定範圍；PR 版 page-review.json 壞了照報。
// 用法：
//   （targets／check 加 --worktree：連未 commit 與 untracked 的新檔一起算，供 /commit 0-B.3 在 commit 前用）
//   node gate.ts active                               exit 0＝本 repo 已啟用（採用標記），3＝未啟用，其他＝環境錯
//   node gate.ts targets --base <ref>                 列出本 PR 需要收據的檔（一行一個）
//   node gate.ts check   --base <ref>                 0-B.3 核對；不合格只印 warning，exit 0（2＝用法／環境錯）
//   node gate.ts stamp   --target <file> --critique-report <md> --audit-report <md>
//                        --critique P0,P1,P2,P3 --audit P0,P1,P2,P3
//                        [--reviewer <who>] [--account <ccN>] [--tokens <n>] [--duration-s <n>]
//
// 可選設定 `.impeccable/page-review.json`：{ "routePattern": "<regex>" } 覆寫路由檔判定。

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const UI_RE = /\.(vue|css|scss|html|tsx|jsx)$/
const DEFAULT_ROUTE = '(^|/)pages/.+\\.(vue|tsx|jsx)$'
const RECEIPT_DIR = '.impeccable/page-reviews'
const SEVERITIES = ['P0', 'P1', 'P2', 'P3']

// 一律走 stderr：`targets` 的 stdout 只放檔名，0-B.3 以「有沒有印出一行」判觸發
function annotate(level, msg) {
  console.error(`[${level}] ${msg}`)
}

function die(msg) {
  annotate('error', `infrastructure-error: ${msg}; the gate did NOT run`)
  process.exit(2)
}

function git(args) {
  const r = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (r.status !== 0) return null
  return r.stdout
}

function parseArgs(argv) {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    if (a === '--worktree') {
      out[a.slice(2)] = '1'
      continue
    }
    out[a.slice(2)] = argv[i + 1] ?? ''
    i++
  }
  return out
}

// 非 --worktree 一律讀 HEAD 的樹：留下紀錄的是 commit，沒 commit 或被 gitignore 的收據在本機看得到、
// 別處看不到，NEVER 讓本機因此判 PASS。--worktree（0-B.3 commit 前）讀 working tree，但收據與報告
// 必須已 tracked 或已 staged：被 gitignore 的永遠進不了 commit，untracked 的會被精確路徑 commit 漏掉。
let WORKTREE = false

// 政策檔壞掉：照報 warning、由呼叫端退回較寬的判定（多要收據，不少要）
function policyProblem(msg: string) {
  annotate('warning', `impeccable-page-review: ${msg}`)
}

// null 只代表「這個 rev 的樹上沒有這個路徑」；git 本身失敗（partial clone 缺物件、ENOBUFS…）一律 die，
// NEVER 讀成「不存在」——否則標記、routePattern 判成不存在等於把範圍縮到零而放行
function readAt(rev: string, path: string): Buffer | null {
  const ls = spawnSync('git', ['ls-tree', '-z', rev, '--', path], { encoding: 'utf8' })
  if (ls.status !== 0) die(`git ls-tree ${rev} -- ${path} failed: ${(ls.stderr || '').trim()}`)
  const entry = ls.stdout.split('\0').find((e) => e.endsWith(`\t${path}`))
  if (!entry) return null
  const [, type, oid] = entry.split('\t')[0].split(' ')
  if (type !== 'blob') return null
  const r = spawnSync('git', ['cat-file', 'blob', oid], { maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0)
    die(`git cat-file blob ${oid} (${rev}:${path}) failed: ${r.stderr.toString().trim()}`)
  return r.stdout
}

function readRepo(path: string): Buffer | null {
  if (WORKTREE) return existsSync(path) ? readFileSync(path) : null
  return readAt('HEAD', path)
}

function ignored(path: string) {
  // 不帶 --no-index：已 tracked（force-add）的檔照樣進得了 commit，不算被 ignore
  return spawnSync('git', ['check-ignore', '-q', path]).status === 0
}

// --worktree 專用：進不了 commit 的檔回訊息，否則 null；要已在 index（tracked 或已 staged），untracked 的
// 檔 `commit --only <paths>` 漏列就無聲遺失
function notCommittable(path: string) {
  if (ignored(path)) return ignoredMsg(path)
  const inIndex = spawnSync('git', ['ls-files', '--error-unmatch', '--', path], { stdio: 'ignore' })
  if (inIndex.status === 0) return null
  return `${path} is not tracked or staged — git add it, or a commit by exact paths leaves it out`
}

// CRLF → LF 後再取 hash：autocrlf／clean filter 讓 blob 與工作樹位元組不同，同一份內容 NEVER 因此判 stale
function sha256(buf: Buffer) {
  return createHash('sha256').update(buf.toString('utf8').replaceAll('\r\n', '\n')).digest('hex')
}

// 投影層（propagate 帶進來的檔）不是專案自己的 UI：既不算「base 已有 UI」，也不當要收據的新檔。清單取 merge base：
// preset.ts 的 PROJECTION_EXCLUDES 目錄條目（只從 repo 根比對）＋ .clade/generated-files.json 的精確路徑。
let PROJECTED: (f: string) => boolean = () => false

// preset 是程式碼：從 merge base 的原文取 PROJECTION_EXCLUDES 的目錄條目，NEVER 執行它
function basePrefixes(mergeBase: string): string[] {
  const raw = readAt(mergeBase, 'vendor/oxc-shared/preset.ts')
  if (raw === null) return []
  const list = /export const PROJECTION_EXCLUDES = \[([\s\S]*?)\n\]/.exec(raw.toString('utf8'))?.[1]
  const prefixes = [...(list ?? '').matchAll(/^\s*'([^'*]+\/)\*\*',?\s*$/gm)].map((m) => m[1])
  if (prefixes.length === 0)
    policyProblem(
      'vendor/oxc-shared/preset.ts at the merge base has no PROJECTION_EXCLUDES entries',
    )
  return prefixes
}

function loadProjection(mergeBase: string) {
  const prefixes = basePrefixes(mergeBase)
  const generated = new Set<string>()
  const raw = readAt(mergeBase, '.clade/generated-files.json')
  if (raw !== null) {
    try {
      const j = JSON.parse(raw.toString('utf8'))
      for (const g of j.generated ?? []) for (const p of g.paths ?? []) generated.add(p)
    } catch {
      policyProblem('.clade/generated-files.json at the merge base is not valid')
    }
  }
  PROJECTED = (f) => generated.has(f) || prefixes.some((p) => f.startsWith(p))
}

// pre-commit 的 vp-staged 會對 staged 檔先 `vp lint --fix` 再 `vp fmt`；stamp 取 hash 前照同樣順序、同一個
// consumer root（CLADE_PROJECT_ROOT，starter 的 template/）先跑一次，否則 commit 後收據就 stale、白燒一輪審查
function formatBeforeHash(files: string[]) {
  const roots = [process.env.CLADE_PROJECT_ROOT, TOP].filter(Boolean) as string[]
  const bin = process.platform === 'win32' ? 'vp.cmd' : 'vp'
  const root = roots.find((r) => existsSync(join(r, 'node_modules', '.bin', bin)))
  if (!root) {
    annotate(
      'warning',
      'vp not found under CLADE_PROJECT_ROOT or the repo root — stamping without pre-commit lint/fmt; if pre-commit rewrites these files the receipt goes stale',
    )
    return
  }
  const vp = join(root, 'node_modules', '.bin', bin)
  const abs = files.map((f) => join(TOP, f))
  const lintable = abs.filter((f) => /\.(vue|[cm]?[jt]sx?)$/.test(f))
  const run = (args: string[]) => {
    const r = spawnSync(vp, args, { cwd: root, encoding: 'utf8' })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    if (
      r.status !== 0 &&
      !/No files found to (lint|format)|Expected at least one target file/.test(out)
    )
      die(`vp ${args[0]} failed — fix it before stamping (pre-commit would fail too):\n${out}`)
  }
  if (lintable.length > 0) run(['lint', '--fix', ...lintable])
  run(['fmt', ...abs])
}

function sha256File(file: string) {
  return sha256(readFileSync(file))
}

// 收據完整性：對 integrity 以外的欄位（鍵排序後）取 sha256，只擋「手改」；擋不了重跑 stamp 填假計數（計數是 reviewer 回報的值）
const INTEGRITY_SALT = 'impeccable-page-review/receipt/v2'

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .filter((k) => k !== 'integrity')
        .toSorted()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    )
  return v
}

export function receiptIntegrity(r: unknown) {
  return createHash('sha256')
    .update(`${INTEGRITY_SALT}\n${JSON.stringify(canonical(r))}`)
    .digest('hex')
}

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/

export function receiptPath(target) {
  return join(RECEIPT_DIR, `${target.replaceAll('/', '__')}.json`)
}

const ROUTE_CONFIG = '.impeccable/page-review.json'

function parseRoute(raw: Buffer | null): { re: RegExp } | { err: string } {
  if (raw === null) return { re: new RegExp(DEFAULT_ROUTE) }
  let j
  try {
    j = JSON.parse(raw.toString('utf8'))
  } catch {
    return { err: 'is not valid JSON' }
  }
  if (typeof j?.routePattern !== 'string' || !j.routePattern)
    return { re: new RegExp(DEFAULT_ROUTE) }
  try {
    return { re: new RegExp(j.routePattern) }
  } catch (err) {
    return { err: `routePattern is not a valid regex: ${(err as Error).message}` }
  }
}

// target 用 merge base 的設定選：PR 新增頁面又改 routePattern 讓它對不到，NEVER 因此放行；PR 版另外驗格式，
// base 已壞時改用 PR 的合法版本。
function routeRegex(mergeBase: string) {
  const base = parseRoute(readAt(mergeBase, ROUTE_CONFIG))
  const head = parseRoute(readRepo(ROUTE_CONFIG))
  if ('err' in head) policyProblem(`${ROUTE_CONFIG} in this change ${head.err}`)
  if ('re' in base) return base.re
  if ('re' in head) {
    annotate(
      'warning',
      `${ROUTE_CONFIG} at the merge base ${base.err}; using this change's version`,
    )
    return head.re
  }
  policyProblem(`${ROUTE_CONFIG} at the merge base ${base.err}; using the default route pattern`)
  return new RegExp(DEFAULT_ROUTE)
}

function gitOrDie(args: string[], what: string) {
  const out = git(args)
  // 判定失敗（treeless clone 缺物件、ENOBUFS…）NEVER 讀成「沒有新頁面」而放行
  if (out === null) die(`${what} failed (git ${args.slice(0, 2).join(' ')})`)
  return out
}

// 新增檔：A，加上改名時內容也變了的 R<100（等於新檔）。100% 相似的純搬移只在舊路徑本來就是路由檔時不算
// （例如 pages/ → app/pages/）；把元件原封不動搬進 pages/ 仍是新頁面。--worktree：用暫存 index 把 working
// tree 全加進去再比，`mv` 搬的頁面也做得了 rename 偵測。
function addedFiles(mergeBase: string, worktree: boolean, route: RegExp) {
  const env = { ...process.env }
  let tmpIndex = ''
  if (worktree) {
    tmpIndex = join(mkdtempSync(join(tmpdir(), 'impeccable-idx-')), 'index')
    const idx = gitOrDie(['rev-parse', '--git-path', 'index'], 'locating index').trim()
    if (existsSync(idx)) copyFileSync(idx, tmpIndex)
    env.GIT_INDEX_FILE = tmpIndex
    const add = spawnSync('git', ['add', '-A'], { env, encoding: 'utf8' })
    if (add.status !== 0) die(`staging the working tree into a temp index failed: ${add.stderr}`)
  }
  const r = spawnSync(
    'git',
    [
      'diff',
      '--name-status',
      '-z',
      '-M',
      '--diff-filter=AR',
      ...(worktree ? ['--cached'] : []),
      mergeBase,
      ...(worktree ? [] : ['HEAD']),
    ],
    { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  if (tmpIndex) rmSync(dirname(tmpIndex), { recursive: true, force: true })
  if (r.status !== 0) die(`listing added files failed (git diff): ${r.stderr}`)
  const raw = r.stdout.split('\0')
  const out: string[] = []
  for (let i = 0; i < raw.length;) {
    const status = raw[i]
    if (!status) {
      i++
      continue
    }
    if (status.startsWith('R')) {
      if (!(status === 'R100' && route.test(raw[i + 1]))) out.push(raw[i + 2])
      i += 3
    } else {
      out.push(raw[i + 1])
      i += 2
    }
  }
  return out.filter(Boolean)
}

const MARKERS = ['PRODUCT.md', 'DESIGN.md', '.impeccable/config.json']

function hasMarker(path: string) {
  return MARKERS.some((m) => readRepo(path ? `${path}/${m}` : m) !== null)
}

// 見 gates.md § 0-B.1。
function adoptedFor(file: string) {
  let dir = dirname(file)
  for (;;) {
    if (hasMarker(dir === '.' ? '' : dir)) return true
    if (dir === '.' || dir === '' || dir === '/') return false
    dir = dirname(dir)
  }
}

function mergeBaseOf(base: string | undefined) {
  if (!base) die('--base is empty — pass the base ref (e.g. origin/main)')
  const mb = git(['merge-base', base, 'HEAD'])
  if (mb === null) die(`no merge base between '${base}' and HEAD — fetch the base ref first`)
  return mb.trim()
}

export function computeTargets(base, worktree = false) {
  const mergeBase = mergeBaseOf(base)
  const route = routeRegex(mergeBase)
  const added = addedFiles(mergeBase, worktree, route).filter((f) => !PROJECTED(f))
  const baseTree = gitOrDie(
    ['ls-tree', '-r', '--name-only', '-z', mergeBase],
    'listing base tree',
  ).split('\0')
  const newProject = !baseTree.some((f) => UI_RE.test(f) && !PROJECTED(f))
  // 只要求有採用標記覆蓋的檔：沒採用 impeccable 的 package 產不出收據。
  const scope = (files: string[]) => files.filter(adoptedFor)
  const pages = scope(added.filter((f) => route.test(f)))
  if (pages.length > 0)
    return {
      mergeBase,
      newProject,
      targets: pages,
      reason: newProject ? 'new-project' : 'new-page',
    }
  if (newProject) {
    const ui = scope(added.filter((f) => UI_RE.test(f)))
    return { mergeBase, newProject, targets: ui, reason: ui.length > 0 ? 'new-project' : 'none' }
  }
  return { mergeBase, newProject, targets: [], reason: 'none' }
}

function parseCounts(s, name) {
  const parts = String(s ?? '')
    .split(',')
    .map((x) => x.trim())
  if (parts.length !== 4 || parts.some((x) => !/^\d+$/.test(x))) {
    console.error(`--${name} must be four non-negative integers P0,P1,P2,P3 (got '${s ?? ''}')`)
    process.exit(2)
  }
  return Object.fromEntries(SEVERITIES.map((k, i) => [k, Number(parts[i])]))
}

function ignoredMsg(path: string) {
  return `${path} is gitignored — it can never be committed; un-ignore .impeccable/page-reviews/ (see vendor/snippets/impeccable/README.md)`
}

export function verifyReceipt(target) {
  const rp = receiptPath(target)
  const where = WORKTREE ? 'working tree' : 'HEAD'
  const rawReceipt = readRepo(rp)
  if (rawReceipt === null)
    return `${target}: no critique+audit receipt in ${where} (${rp}) — run /commit 0-B.3 (impeccable critique + audit, then gate.ts stamp), and commit it`
  const rpBad = WORKTREE && notCommittable(rp)
  if (rpBad) return `${target}: ${rpBad}`
  const rawTarget = readRepo(target)
  if (rawTarget === null) return `${target}: target not found in ${where}`
  let r
  try {
    r = JSON.parse(rawReceipt.toString('utf8'))
  } catch {
    return `${target}: receipt ${rp} is not valid JSON`
  }
  if (r.schema !== 2 || r.target !== target)
    return `${target}: receipt ${rp} has wrong schema/target (re-stamp with this gate.ts)`
  if (r.integrity !== receiptIntegrity(r))
    return `${target}: receipt ${rp} was edited by hand — only gate.ts stamp may write it; re-run 0-B.3`
  if (typeof r.run_id !== 'string' || !RUN_ID_RE.test(r.run_id))
    return `${target}: receipt ${rp} has no reviewer run id`
  if (r.sha256 !== sha256(rawTarget))
    return `${target}: receipt is stale — the file changed after review; re-run critique + audit and re-stamp`
  for (const kind of ['critique', 'audit']) {
    const k = r[kind]
    if (!k || typeof k !== 'object') return `${target}: receipt lacks ${kind}`
    const rawReport = k.report ? readRepo(k.report) : null
    if (rawReport === null)
      return `${target}: ${kind} report missing in ${where} (${k.report ?? 'unset'}) — commit it next to the receipt`
    const reportBad = WORKTREE && notCommittable(k.report)
    if (reportBad) return `${target}: ${reportBad}`
    if (k.report_sha256 !== sha256(rawReport))
      return `${target}: ${kind} report ${k.report} changed after stamping`
    for (const sev of SEVERITIES) {
      if (!Number.isInteger(k[sev]) || k[sev] < 0) return `${target}: ${kind}.${sev} is not a count`
    }
    if (k.P0 > 0 || k.P1 > 0)
      return `${target}: ${kind} has P0=${k.P0} P1=${k.P1} — fix them, re-run ${kind}, re-stamp`
  }
  return null
}

function cmdTargets(a) {
  const { targets } = computeTargets(a.base, 'worktree' in a)
  for (const t of targets) console.log(t)
}

function cmdCheck(a) {
  const { targets, reason, mergeBase } = computeTargets(a.base, 'worktree' in a)
  if (targets.length === 0) {
    console.log(
      `impeccable-page-review: skip — no new page (route file) and not a new project since ${mergeBase}`,
    )
    return
  }
  console.log(
    `impeccable-page-review: ${reason}, ${targets.length} target(s) need critique+audit receipts`,
  )
  const bad = targets.map(verifyReceipt).filter(Boolean)
  for (const b of bad) annotate('warning', b)
  if (bad.length > 0) {
    const summary = `${bad.length}/${targets.length} target(s) without a passing receipt`
    console.log(`impeccable-page-review: RECORDED — ${summary} (record only, not blocking)`)
    return
  }
  console.log(
    `impeccable-page-review: PASS — ${targets.length} target(s), critique+audit P0/P1 = 0`,
  )
}

// 收據裡的路徑一律存 repo 相對路徑：絕對路徑或 repo 外的檔換一台機器就不存在。
function repoRel(p: string | undefined, flag: string) {
  if (!p) die(`--${flag} is required`)
  const given = resolve(START_CWD, p)
  if (!existsSync(given)) die(`--${flag} '${p}' does not exist`)
  // TOP 是 git 給的 realpath；路徑經 symlink 前綴（macOS 的 /var → /private/var）也要比得上
  const rel = relative(realpathSync(TOP), realpathSync(given))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) die(`--${flag} '${p}' is outside the repo`)
  return rel.split('\\').join('/')
}

function cmdStamp(a) {
  const target = repoRel(a.target, 'target')
  const critiqueReport = repoRel(a['critique-report'], 'critique-report')
  const auditReport = repoRel(a['audit-report'], 'audit-report')
  // 計數是 reviewer 回報的值，收據本身證明不了審過；至少擋掉兩種一眼可見的空殼
  if (critiqueReport === auditReport)
    die('--critique-report and --audit-report must be two different reports')
  for (const rep of [critiqueReport, auditReport])
    if (!readFileSync(rep, 'utf8').trim()) die(`report '${rep}' is empty`)
  const critique = parseCounts(a.critique, 'critique')
  const audit = parseCounts(a.audit, 'audit')
  const runId = String(a['run-id'] ?? '')
  if (!RUN_ID_RE.test(runId))
    die(
      '--run-id is required: the id of the fresh reviewer subagent run that produced both reports',
    )
  // 參數全驗完才動檔：formatBeforeHash 會改寫 target 與報告
  formatBeforeHash([target, critiqueReport, auditReport])
  const receipt: Record<string, unknown> = {
    schema: 2,
    target,
    run_id: runId,
    sha256: sha256File(target),
    critique: {
      ...critique,
      report: critiqueReport,
      report_sha256: sha256File(critiqueReport),
    },
    audit: {
      ...audit,
      report: auditReport,
      report_sha256: sha256File(auditReport),
    },
    reviewer: a.reviewer || null,
    account: a.account || null,
    usage: {
      tokens: a.tokens ? Number(a.tokens) : null,
      duration_s: a['duration-s'] ? Number(a['duration-s']) : null,
    },
    reviewed_at: new Date().toISOString(),
  }
  receipt.integrity = receiptIntegrity(receipt)
  const rp = receiptPath(target)
  mkdirSync(dirname(rp), { recursive: true })
  writeFileSync(rp, `${JSON.stringify(receipt, null, 2)}\n`)
  const blocked = critique.P0 + critique.P1 + audit.P0 + audit.P1 > 0
  console.log(
    `${rp} written${blocked ? ' — P0/P1 > 0, check will report it until fixed and re-stamped' : ''}`,
  )
  for (const p of [rp, critiqueReport, auditReport])
    if (ignored(p)) annotate('warning', ignoredMsg(p))
}

// 啟用判定（0-B.3 用）：repo 有 impeccable 採用標記才算啟用；沒採用的 repo 產不出收據（沒有 launcher、
// 沒有設計脈絡）。未啟用用專屬 exit 3：exit 1／2／127 都可能是環境錯（node 不在、例外、git 失敗），
// 呼叫端只在 3 時跳過，NEVER 把判定失敗讀成未啟用。
export const INACTIVE_EXIT = 3

function cmdActive() {
  const listed = git(['ls-files', '-z'])
  if (listed === null) die('git ls-files failed — cannot tell whether this repo is adopted')
  const marker = listed
    .split('\0')
    .find((f) => /(^|\/)(PRODUCT\.md|DESIGN\.md|\.impeccable\/config\.json)$/.test(f))
  if (marker) {
    console.log(`impeccable-page-review: active (adoption marker ${marker})`)
    return
  }
  console.log('impeccable-page-review: inactive — no impeccable adoption marker')
  process.exit(INACTIVE_EXIT)
}

const [cmd, ...rest] = process.argv.slice(2)
const a = parseArgs(rest)
const START_CWD = process.cwd()
const top = git(['rev-parse', '--show-toplevel'])
if (top === null) die('not inside a git repository')
const TOP = top.trim()
process.chdir(TOP)
WORKTREE = 'worktree' in a
if (cmd === 'active') cmdActive()
else if (cmd === 'targets' || cmd === 'check') {
  loadProjection(mergeBaseOf(a.base))
  if (cmd === 'targets') cmdTargets(a)
  else cmdCheck(a)
} else if (cmd === 'stamp') cmdStamp(a)
else {
  console.error(
    'usage: gate.ts active | targets|check --base <ref> [--worktree] | stamp --target <file> ...',
  )
  process.exit(2)
}
