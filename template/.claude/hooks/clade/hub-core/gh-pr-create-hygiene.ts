/**
 * gh-pr-create-hygiene.ts — `gh pr create` 的 PR 去重與大小上限。
 *
 * 為什麼存在：同一份 plan 常被拆成多張 PR 各自排 CI＋0-A，大 PR 一張吃掉一整輪 0-A 預算，open PR 一多就堆成山。
 * 在開立那一刻收住比事後由主持者關閉便宜。`Work:` 行通過之後才判（`gh-pr-create-work.ts` 的 `ghPrCreateWorkGate` 呼叫本檔）。
 *
 *   | 判定 | 擋下條件 | 放行方式 |
 *   | --- | --- | --- |
 *   | 去重 | 同 repo 另一條 branch 已有 open PR，body 的 `Work:` 是同一個 work id（work id ↔ plan 目錄一對一）。integration 模式不算：base 或 head 是 `integration/<work-id>` 的 PR（slice PR 與 integration→main 那張共用同一個 `Work:`）不參與去重 | 改推那張 PR 的分支；主持者刻意平行拆的 → body 加 `Parallel-to: #<N>` |
 *   | 記帳類 | clade home 的 diff 每一個路徑都在登記簿 allowlist（`vendor/scripts/lib/register-paths.ts` `isRegisterPath`；`rules/core/github-flow.md` § 紀錄型改動不開 PR）。先於去重判；`--base` 不是 main（stacked PR）不判（register-land 只落 main）；**不看 body**（`--body-file -`、動態 body 也判）、跟著指令裡的 `cd <dir>` 量那棵 worktree、`--head`／`--base` 動態時量 HEAD 相對預設分支 | 不開 PR：本 worktree commit 後跑 `node scripts/register-land.ts`；混了 allowlist 外的檔就照常開 PR |
 *   | 大小 | 扣掉投影檔後 >1000 行（增＋刪）或 >50 檔；量的是 `--head` 相對 `--base`（省略時 HEAD 相對預設分支） | 拆成多張；或 body 宣告 `Mechanical: <產生方式>`（0-A 可走 `--independent` 範圍分級） |
 *
 * 只擋開 PR，**NEVER** 擋派工或限制 open PR 總數（入口不設上限）。
 * 判不出一律放行（fail-open）：不在 git repo、`gh` 失敗或逾時、diff 讀不到、工作目錄判不出（動態 `cd`）、`--repo` 指向別的 repo 或值是動態展開（本機 checkout 量不到）；body 判不出或 `--base`／`--head` 值是動態展開時，只放行去重與大小，記帳類照判。
 * 記帳類判定同樣只在 clade home 做（登記簿 allowlist 與 register-land 只存在那裡），只載入本 hook 自己那棵 checkout 的 allowlist。
 * 投影檔的判定只在 clade home 做得出（`scripts/audit-clade-home-projections.ts` 的投影計畫），且只載入本 hook
 * 自己那棵 checkout 的投影程式（NEVER 執行目標 repo 的程式碼）；其他 repo → 大小判定不跑（只做去重）。
 * 投影計畫要起 node 子行程並建完整規則計畫，遠慢於 git／gh：只在未扣投影前就超限時才算，且吃整體預算的剩餘時間而非單次上限。
 *
 *   | REQUIRED 欄位 | 內容 |
 *   | --- | --- |
 *   | 觸發條件 | 上表「擋下條件」成立 → exit 2 擋下該次 tool call |
 *   | 消費端 | 正在開 PR 的 agent（stderr 印改推的指令或拆分／宣告的改法） |
 *   | 觸發點 | 工具事件 hook：與 `gh-pr-create-work.ts` 同兩個入口（fleet `pre-bash-gh-pr-create-work-gate.sh`、clade home `clade-home-guard.ts`）；訊息由 test/gh-pr-create-hygiene.test.ts 釘住 |
 */

import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PR_SIZE_LIMITS = { lines: 1000, files: 50 } as const

export const MECHANICAL_LINE_RE = /^[ \t]*Mechanical[ \t]*[:：][ \t]*\S/mu
export const PARALLEL_LINE_RE = /^[ \t]*Parallel-to[ \t]*[:：][ \t]*#?\d+/mu

/** hook 上限 10s、超時視為非阻擋（fail-open）。git／gh 單次上限；整體另受 HYGIENE_BUDGET_MS 約束。 */
export const HYGIENE_TIMEOUT_MS = 1_500

/** 去重＋大小判定的整體預算：每次外部呼叫的限時是 min(單次上限, 剩餘預算)，合計不會超過它（留餘量給 node 啟動與 Work 行推導）。 */
export const HYGIENE_BUDGET_MS = 7_000

/** 投影計畫（node 子行程＋完整規則計畫）的單次上限，仍受剩餘預算截斷。 */
export const PROJECTION_TIMEOUT_MS = 6_000

export interface OpenPr {
  number: number
  headRefName: string
  body: string
  /** PR 的 base 分支；integration 模式的 slice PR 以它辨認。 */
  baseRefName?: string
  /** fork 來的 PR：body 與 branch 名由外人控制，不算重複。 */
  isCrossRepository?: boolean
}

/** `gh pr create` 指令列上決定「量哪一組」的旗標；值缺省＝用 gh 的預設（cwd 的 repo、目前 branch、預設分支）。 */
export interface PrCreateTarget {
  base?: string
  head?: string
  repo?: string
  /** 任一個值是動態展開（`$X`）或旗標缺值：去重與大小判定放行。 */
  opaque?: boolean
  /** 其中 `--repo` 判不出：本機 checkout 量不到那個 repo，連記帳類判定也放行（`--base`／`--head` 判不出時記帳類改量 HEAD 相對預設分支）。 */
  opaqueRepo?: boolean
}

export interface NumstatEntry {
  path: string
  /** 二進位檔為 null。 */
  added: number | null
  deleted: number | null
}

export interface HygieneDeps {
  /** repo 頂層；null＝不在 git repo（判不出，放行）。 */
  top?: (cwd: string) => string | null
  branch?: (top: string) => string | null
  /** 同 repo 的 open PR（body 含 work id 的）；`repo` 是指令的 `--repo`；null＝查不到。 */
  openPrs?: (top: string, workId: string, repo?: string) => OpenPr[] | null
  /** `head`（省略＝HEAD）相對 `base`（省略＝預設分支）的 numstat；null＝讀不到或 ref 解析不了。 */
  numstat?: (top: string, range: { base?: string; head?: string }) => NumstatEntry[] | null
  /** 投影檔路徑集；null＝本 repo 沒有投影計畫（大小判定不跑）。 */
  projections?: (top: string) => ReadonlySet<string> | null
  /** 登記簿 allowlist 的判定；null＝本 repo 不是 clade home（記帳類判定不跑）。 */
  registerPath?: (top: string) => ((path: string) => boolean) | null
  /** checkout 的 origin（`git remote get-url origin`）；null＝沒有或讀不到。 */
  originUrl?: (top: string) => string | null
}

const WORK_OF_BODY_RE = /^[ \t]*Work(?:[ \t]*id)?[ \t]*[:：][ \t]*(\S+)/mu

/** body 的 `Work:` 值。 */
export function workIdOfBody(body: string): string | null {
  return WORK_OF_BODY_RE.exec(body)?.[1] ?? null
}

/** integration 模式的整合分支名：slice PR 的 base、integration→main 那張的 head。 */
export const integrationBranch = (workId: string): string => `integration/${workId}`

/** `--repo` 值或 remote URL → 小寫 `owner/repo`（`HOST/OWNER/REPO`、https、ssh 寫法同一個結果）。 */
export const repoSlug = (repo: string): string =>
  repo
    .trim()
    .replace(/\.git$/u, '')
    .replace(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?github\.com[:/]/iu, '')
    .toLowerCase()

/** 同 work id、別條 branch 的 open PR（去重判定，純函式）；integration 分支上的 PR（base 或 head）不算重複。 */
export function duplicatePrs(
  prs: readonly OpenPr[],
  workId: string,
  branch: string | null,
): OpenPr[] {
  const integration = integrationBranch(workId)
  return prs
    .filter(
      (p) =>
        !p.isCrossRepository &&
        p.headRefName !== branch &&
        p.headRefName !== integration &&
        p.baseRefName !== integration &&
        workIdOfBody(p.body) === workId,
    )
    .toSorted((a, b) => a.number - b.number)
}

export interface SizeVerdict {
  lines: number
  files: number
  /** 扣掉的投影檔數。 */
  projections: number
  over: boolean
}

/** 扣投影後的行數與檔數（純函式）；二進位檔算檔數不算行數。 */
export function judgePrSize(
  entries: readonly NumstatEntry[],
  projections: ReadonlySet<string>,
  limits: { lines: number; files: number } = PR_SIZE_LIMITS,
): SizeVerdict {
  const kept = entries.filter((e) => !projections.has(e.path))
  const lines = kept.reduce((n, e) => n + (e.added ?? 0) + (e.deleted ?? 0), 0)
  return {
    lines,
    files: kept.length,
    projections: entries.length - kept.length,
    over: lines > limits.lines || kept.length > limits.files,
  }
}

/** `git diff --numstat -z` 輸出；rename 取新路徑。 */
export function parseNumstatZ(out: string): NumstatEntry[] {
  const parts = out.split('\0')
  const res: NumstatEntry[] = []
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/su.exec(parts[i]!)
    if (!m) continue
    let path = m[3]!
    // rename／copy：路徑欄為空，接著兩段是舊、新路徑
    if (!path) {
      i += 2
      path = parts[i] ?? ''
    }
    if (!path) continue
    res.push({
      path,
      added: m[1] === '-' ? null : Number(m[1]),
      deleted: m[2] === '-' ? null : Number(m[2]),
    })
  }
  return res
}

export function duplicateMessage(workId: string, dups: readonly OpenPr[]): string {
  const first = dups[0]!
  // branch 名不進指令：只給 PR 號，由 gh 解析 head（訊息裡不出現可被 PR 作者控制的 ref）
  return (
    `⛔ gh pr create：同一份 plan（Work: ${workId}）已有 open PR ${dups.map((p) => `#${p.number}`).join('、')}。` +
    `改推那張 PR 的分支，不另開：gh pr checkout ${first.number}，把本 branch 的 commit 合進去再 push。` +
    `主持者刻意平行拆的工作 → body 加一行 \`Parallel-to: #${first.number}\` 後重跑。`
  )
}

export function sizeMessage(v: SizeVerdict, limits = PR_SIZE_LIMITS): string {
  return (
    `⛔ gh pr create：扣掉 ${v.projections} 個投影檔後仍有 ${v.lines} 行、${v.files} 檔（上限 ${limits.lines} 行或 ${limits.files} 檔）。` +
    `拆成多張 PR；或改動是機械產生的 → body 加一行 \`Mechanical: <產生方式（指令或 codemod）>\` 後重跑（0-A 可走 --independent 範圍分級）。`
  )
}

export function registerOnlyMessage(files: number): string {
  return (
    `⛔ gh pr create：改動的 ${files} 個檔全在登記簿 allowlist 內（紀錄型改動不開 PR、不在 0-A 範圍）。` +
    `不開 PR：在本 worktree commit 後跑 \`node scripts/register-land.ts\`（先過 CONTENT_CHECKS 再直推 main）。` +
    `判準：rules/core/github-flow.md § 紀錄型改動不開 PR。`
  )
}

/** 判定（`Work:` 行已通過或判不出）：違規回 deny 字串，否則 null。 */
export function ghPrCreateHygiene(
  /** null＝body 判不出（`--body-file -`、動態展開、讀不到）：只判記帳類（它不看 body），去重與大小放行。 */
  body: string | null,
  cwd: string,
  deps: HygieneDeps = {},
  target: PrCreateTarget = {},
): string | null {
  if (target.opaqueRepo) return null
  deadline = Date.now() + HYGIENE_BUDGET_MS
  const d = { ...defaultHygieneDeps, ...deps }
  const top = d.top(cwd)
  if (!top) return null
  const workId = body === null ? null : workIdOfBody(body)
  // `--head owner:branch` 的 branch 名在 `:` 之後
  const head = target.head?.replace(/^[^:]*:/u, '')
  // 本機 checkout 量不到別的 repo 的 branch：記帳類與大小判定都不跑（`--repo` 指向本 checkout 的 origin 照量）
  const origin = target.repo ? d.originUrl(top) : null
  const measurable = !target.repo || (origin !== null && repoSlug(origin) === repoSlug(target.repo))
  let entries: NumstatEntry[] | null | undefined
  const diff = () =>
    entries === undefined ? (entries = d.numstat(top, { base: target.base, head })) : entries
  // register-land 只落 main：疊在別的 branch 上的 PR（`--base` 不是 main）不是它能接的，照一般 PR 判
  const stacked = Boolean(target.base) && target.base !== 'main'
  const isRegister = measurable && !stacked ? d.registerPath(top) : null
  if (isRegister) {
    const got = diff()
    if (got?.length && got.every((e) => isRegister(e.path))) return registerOnlyMessage(got.length)
  }
  // 以下的去重與大小判定要 body 與確定的 base／head
  if (body === null || target.opaque) return null
  if (
    workId &&
    !PARALLEL_LINE_RE.test(body) &&
    target.base !== integrationBranch(workId) &&
    head !== integrationBranch(workId)
  ) {
    const prs = d.openPrs(top, workId, target.repo)
    const dups = prs ? duplicatePrs(prs, workId, head ?? d.branch(top)) : []
    if (dups.length) return duplicateMessage(workId, dups)
  }
  if (MECHANICAL_LINE_RE.test(body)) return null
  if (!measurable) return null
  const got = diff()
  if (!got) return null
  // 投影計畫昂貴：連未扣投影的數字都沒超限就不必算
  if (!judgePrSize(got, new Set()).over) return null
  const projections = d.projections(top)
  if (!projections) return null
  const v = judgePrSize(got, projections)
  return v.over ? sizeMessage(v) : null
}

/** 本次判定的截止時刻（epoch ms）；`ghPrCreateHygiene` 進場時設。 */
let deadline = Number.POSITIVE_INFINITY

const run = (
  cmd: string,
  args: string[],
  cwd: string,
  cap: number = HYGIENE_TIMEOUT_MS,
): string | null => {
  const timeout = Math.min(cap, deadline - Date.now())
  if (timeout <= 0) return null
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout })
  return r.status === 0 ? r.stdout : null
}

/** 第一個解析得到 commit 的 ref；都不是 → null。 */
const resolveRef = (top: string, candidates: string[]): string | null =>
  candidates.find((c) => run('git', ['rev-parse', '--verify', '--quiet', `${c}^{commit}`], top)) ??
  null

export const defaultHygieneDeps: Required<HygieneDeps> = {
  top: (cwd) => run('git', ['rev-parse', '--show-toplevel'], cwd)?.trim() || null,
  branch: (top) => run('git', ['branch', '--show-current'], top)?.trim() || null,
  openPrs: (top, workId, repo) => {
    const out = run(
      'gh',
      [
        'pr',
        'list',
        ...(repo ? ['--repo', repo] : []),
        '--state',
        'open',
        '--limit',
        '30',
        '--search',
        `"${workId}" in:body`,
        '--json',
        'number,headRefName,baseRefName,body,isCrossRepository',
      ],
      top,
    )
    if (out === null) return null
    try {
      const raw = JSON.parse(out) as unknown
      return Array.isArray(raw) ? (raw as OpenPr[]) : null
    } catch {
      return null
    }
  },
  numstat: (top, range) => {
    const base = range.base
      ? resolveRef(top, [`origin/${range.base}`, range.base])
      : run(
          'git',
          ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
          top,
        )?.trim() || 'origin/main'
    const head = range.head ? resolveRef(top, [range.head, `origin/${range.head}`]) : 'HEAD'
    if (!base || !head) return null
    const out = run('git', ['diff', '--numstat', '-z', '-M', `${base}...${head}`], top)
    return out === null ? null : parseNumstatZ(out)
  },
  projections: (top) => cladeHomeProjectionPaths(top),
  registerPath: (top) => cladeHomeRegisterMatcher(top),
  originUrl: (top) => run('git', ['remote', 'get-url', 'origin'], top)?.trim() || null,
}

/** 本檔所在的 repo 根（`<root>/capabilities/core/hooks/`）：只有它的投影計畫可信。 */
const HOOK_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** `top` 是不是本 hook 所在的 clade checkout（含它的 worktree 各自的 checkout）。 */
function isHookRepo(top: string, hookRoot: string): boolean {
  try {
    return realpathSync(top) === realpathSync(hookRoot)
  } catch {
    return false
  }
}

/** `top` 與 hook 所在 checkout 是同一個 repo 的兩棵 worktree（git-common-dir 相同）：`cd <別棵 worktree> && gh pr create` 量的是它。 */
function sharesGitCommonDir(top: string, hookRoot: string): boolean {
  const common = (dir: string): string | null =>
    run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], dir)?.trim() || null
  const a = common(top)
  return a !== null && a === common(hookRoot)
}

/**
 * clade home 的登記簿 allowlist 判定（`vendor/scripts/lib/register-paths.ts`，main-sync／register-land 共用同一份）。
 * 只在 `top` 就是本 hook 所在的 clade checkout（或同 repo 的另一棵 worktree）時才載入；hook 散播到 consumer 時那邊沒有 register-land → 回 null。
 * 同步載入（require(esm)）：本判定在同步的 hook 路徑上，且檔案只有常數與一支純函式。
 */
export function cladeHomeRegisterMatcher(
  top: string,
  hookRoot = HOOK_REPO_ROOT,
): ((path: string) => boolean) | null {
  // allowlist 永遠從 hook 自己的 checkout 載入；被量的 diff 可以在同 repo 的任一棵 worktree
  if (!isHookRepo(top, hookRoot) && !sharesGitCommonDir(top, hookRoot)) return null
  const file = join(hookRoot, 'vendor', 'scripts', 'lib', 'register-paths.ts')
  if (!existsSync(file)) return null
  try {
    const m = createRequire(import.meta.url)(file) as { isRegisterPath?: unknown }
    return typeof m.isRegisterPath === 'function'
      ? (m.isRegisterPath as (path: string) => boolean)
      : null
  } catch {
    return null
  }
}

/**
 * clade home 的投影輸出路徑（投影計畫，與 audit-clade-home-projections 同一份）。只在 `top` 就是本 hook 所在的
 * clade checkout（含它的 worktree）時才載入投影程式；別的 repo 的 `scripts/` 是那個 repo 的程式碼，hook NEVER 執行它
 * （consumer 裡的投影 hook 落在別處，自然不符合）→ 回 null、不判大小。
 */
export function cladeHomeProjectionPaths(
  top: string,
  hookRoot = HOOK_REPO_ROOT,
): Set<string> | null {
  if (!isHookRepo(top, hookRoot)) return null
  const script = join(hookRoot, 'scripts', 'audit-clade-home-projections.ts')
  if (!existsSync(script)) return null
  const out = run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const m = await import(${JSON.stringify(script)}); const a = await m.cladeHomeProjectionArtifacts(${JSON.stringify(top)}); process.stdout.write(JSON.stringify(a.map((x) => x.path)))`,
    ],
    top,
    PROJECTION_TIMEOUT_MS,
  )
  if (out === null) return null
  try {
    return new Set(JSON.parse(out) as string[])
  } catch {
    return null
  }
}
