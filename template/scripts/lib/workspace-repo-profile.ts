// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/workspace-repo-profile.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/workspace-repo-profile.ts
/**
 * workspace-repo-profile.ts — Herdr workspace 「屬於哪個 repo」的共用判定。
 *
 * 三處共用同一份語意（現行判準：vendor/snippets/herdr-session-handoff/README.md 的 workspace placement 段；選擇規則本體在 ./workspace-choice.ts）：
 *   - `herdr-session-handoff.ts` 的 chooseWorkspace：派工只落進「host」workspace；
 *   - `lib/dev-workspace.ts`：dev-session 的 Tab 落點；
 *   - `herdr-patrol.ts`：列出混放與標籤不符的 workspace。
 *
 * 為什麼要有「host」而不是「有一個 pane 落在 repo 下」：後者讓任何躺著一個 B repo pane 的
 * workspace 對 B 永遠是候選（呼叫者自己的 pane 也算），relay／--coordinate 的決勝再全往它倒，
 * 於是 clade 的 workspace 越塞越多別的專案（事件經過見 git history：clade #1768）。
 * host 要求目標 repo 是該 workspace 的**嚴格最多數**。
 *
 * repo key＝pane cwd 所屬 git repo 的主 checkout（linked worktree 歸主 checkout）。解析不出來的
 * pane 是 unclassified，不計入任何 repo——寧可少算也不把 `~` 的 shell 算成一個 repo。
 */

import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

export type PaneLike = {
  cwd?: string | null
  foreground_cwd?: string | null
}

/** path → repo key；解析不出來回 null（unclassified）。 */
export type RepoKeyResolver = (path: string) => string | null

export type WorkspaceProfile = {
  /** repo key → classified pane 數。 */
  repos: Map<string, number>
  unclassified: number
  total: number
}

function trimTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '')
}

/**
 * `<main>-wt/<slug>[/…]` → `<main>`：clade 的 worktree 慣例（wt-helper 把 linked worktree 放在主
 * checkout 旁的 `<name>-wt/`）。不碰檔案系統；不符合慣例回 null。peer 機器沒有可靠的遠端 git 查詢，
 * 只能靠它——所以 peer 的主 checkout pane 是 unclassified，不計入任何 repo。代價：別 repo 的主 checkout
 * pane 不會壓低目標 repo 的占比，peer 上「host」資格比本機寬鬆；呼叫端不可把「unclassified 不存在」當成
 * 前提（例如命名對齊就另外只信目標 repo 的 pane）。
 */
export function repoKeyByConvention(path: string): string | null {
  const p = trimTrailingSlash(path)
  if (!p.startsWith('/')) return null
  const match = /^(.+)-wt\/[^/]+(?:\/.*)?$/.exec(p)
  return match?.[1] ? match[1] : null
}

const gitKeyCache = new Map<string, string | null>()

/**
 * 本機的權威解析：`git rev-parse --git-common-dir` 取主 checkout；git 失敗（非 git、路徑已刪）
 * 退回 `-wt/` 慣例，再不行就是 unclassified。結果在本行程內快取（同一個 cwd 一輪只問一次 git）。
 */
export function repoKeyByGit(path: string): string | null {
  const absolute = resolve(path)
  if (gitKeyCache.has(absolute)) return gitKeyCache.get(absolute) ?? null
  let key: string | null = null
  const probe = spawnSync(
    'git',
    ['-C', absolute, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8', timeout: 5_000 },
  )
  if (probe.status === 0) {
    const common = trimTrailingSlash(probe.stdout.trim())
    if (common) {
      const main = basename(common) === '.git' ? dirname(common) : common
      try {
        key = realpathSync(main)
      } catch {
        key = main
      }
    }
  }
  if (!key) {
    const byConvention = repoKeyByConvention(absolute)
    if (byConvention) {
      try {
        key = realpathSync(byConvention)
      } catch {
        key = byConvention
      }
    }
  }
  gitKeyCache.set(absolute, key)
  return key
}

function panePaths(pane: PaneLike): string[] {
  return [pane.foreground_cwd, pane.cwd].filter(
    (path): path is string => typeof path === 'string' && path.length > 0,
  )
}

/**
 * 統計一個 workspace 內 pane 的 repo 分布。`targetKey`＋`matchesTarget` 讓 caller 先用自己的
 * 「落在目標 worktree roots」判定把 pane 認成目標 repo（目標是非 git 目錄時 git 解析不出 key，
 * 但 caller 的 roots 比對仍然成立）。
 */
export function profileWorkspacePanes(
  panes: PaneLike[],
  resolveKey: RepoKeyResolver,
  target?: { key: string; matches: (pane: PaneLike) => boolean },
): WorkspaceProfile {
  const repos = new Map<string, number>()
  let unclassified = 0
  for (const pane of panes) {
    let key: string | null = null
    if (target?.matches(pane)) key = target.key
    else {
      for (const path of panePaths(pane)) {
        key = resolveKey(path)
        if (key) break
      }
    }
    if (key) repos.set(key, (repos.get(key) ?? 0) + 1)
    else unclassified += 1
  }
  return { repos, unclassified, total: panes.length }
}

/** workspace 是不是 repo `key` 的 host：該 repo 至少一個 pane，且是**嚴格**最多數（平手不算）。 */
export function workspaceHostsRepo(profile: WorkspaceProfile, key: string): boolean {
  const own = profile.repos.get(key) ?? 0
  if (own === 0) return false
  for (const [other, count] of profile.repos) {
    if (other !== key && count >= own) return false
  }
  return true
}

export function repoNameOfKey(key: string): string {
  return basename(trimTrailingSlash(key)) || key
}

/** 標籤是否已經點名這個 repo：全等，或以 repo 名開頭、後面接非英數分隔（例如 `clade（worktree shell）`）。 */
export function labelNamesRepo(label: string | null | undefined, repoName: string): boolean {
  const l = (label ?? '').trim().toLocaleLowerCase()
  const r = repoName.trim().toLocaleLowerCase()
  if (!l || !r) return false
  if (l === r) return true
  if (!l.startsWith(r)) return false
  return /[\s（([:：/·|]/.test(l.charAt(r.length))
}

export type LabelOrigin = 'empty' | 'default' | 'custom'

/**
 * Herdr 建 workspace 不帶 `--label` 時，標籤＝當下 cwd 的 basename（worktree slug）。標籤等於該
 * workspace 某 pane 的 cwd／foreground_cwd 的 basename，就視為「預設標籤」——可自動對齊；
 * 其餘一律當人為命名（Charles 可能手動取過名），只告警不覆寫。判不出就是 custom。
 */
export function labelOrigin(label: string | null | undefined, panes: PaneLike[]): LabelOrigin {
  const l = (label ?? '').trim()
  if (!l) return 'empty'
  const lower = l.toLocaleLowerCase()
  for (const pane of panes) {
    for (const path of panePaths(pane)) {
      if (basename(trimTrailingSlash(path)).toLocaleLowerCase() === lower) return 'default'
    }
  }
  return 'custom'
}

export type WorkspaceFinding = {
  workspace_id: string
  label: string
  kind: 'mixed' | 'label_mismatch'
  /** 各 repo 的 pane 數，多到少。 */
  repos: Array<{ repo: string; panes: number }>
  /** 嚴格最多數的 repo 名；平手為 null。 */
  home_repo: string | null
  label_origin: LabelOrigin
  /** `label_mismatch`：建議的標籤（repo 名）。 */
  suggested_label?: string
  unclassified_panes: number
}

/**
 * 巡檢用：逐 workspace 判 `mixed`（≥2 個 repo）與 `label_mismatch`（只屬一個 repo、標籤沒點名它）。
 * 沒有 classified pane（全是 shell／非 git）的 workspace 不報——沒有證據就不說話。
 */
export function classifyWorkspaces(
  workspaces: Array<{ workspace_id: string; label?: string | null; panes: PaneLike[] }>,
  resolveKey: RepoKeyResolver,
): WorkspaceFinding[] {
  const findings: WorkspaceFinding[] = []
  for (const workspace of workspaces) {
    const profile = profileWorkspacePanes(workspace.panes, resolveKey)
    const ranked = [...profile.repos].toSorted((a, b) => b[1] - a[1])
    if (!ranked.length) continue
    const label = (workspace.label ?? '').trim()
    const base = {
      workspace_id: workspace.workspace_id,
      label,
      repos: ranked.map(([key, panes]) => ({ repo: repoNameOfKey(key), panes })),
      label_origin: labelOrigin(label, workspace.panes),
      unclassified_panes: profile.unclassified,
    }
    if (ranked.length >= 2) {
      const tie = ranked[0][1] === ranked[1][1]
      findings.push({
        ...base,
        kind: 'mixed',
        home_repo: tie ? null : repoNameOfKey(ranked[0][0]),
      })
      continue
    }
    const repo = repoNameOfKey(ranked[0][0])
    if (!labelNamesRepo(label, repo)) {
      findings.push({
        ...base,
        kind: 'label_mismatch',
        home_repo: repo,
        suggested_label: repo,
      })
    }
  }
  return findings
}
