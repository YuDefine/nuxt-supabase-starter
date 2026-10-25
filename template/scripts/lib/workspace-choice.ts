// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/workspace-choice.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/workspace-choice.ts
/**
 * workspace-choice.ts — 「這件工作的 pane／Tab 該落在哪個 Herdr workspace」的唯一 selector。
 *
 * 三個呼叫端共用同一套判定：
 *   - `lib/dev-workspace.ts` 的 `chooseDevWorkspace`（dev-session 的 dev Tab）
 *   - `herdr-session-handoff.ts` 的 `chooseWorkspace`（派工落點）
 *   - `lib/pane-auto-dispose.ts` 的 `resumeSpace`（停放續接開 Tab）
 *
 * 判定順序（label 為身分、pane cwd 為退路）：
 *   0. 顯式 pin：只要該 workspace 掛身分名或有 pane 落在 repoRoots 內就照指定，否則拒絕。
 *      pin 是 caller 自己的證據，排除規則不適用。
 *   1. workspace label（大小寫不敏感）命中 `identityLabels` 且**唯一** → 它。repo／consumer
 *      名的 space 是該 repo 的家，誤放進別名 space 的 pane 不會蓋過它。
 *   2. label 多命中時只在它們之間看 pane cwd（掛別名的 space 裡的同 repo pane 多半是誤放，
 *      不是歸屬證據）；沒有 label 命中時看全部合格 workspace：有 pane 的
 *      cwd／foreground_cwd 落在 repoRoots 內且**唯一** → 它。
 *   3. 多個候選 → tie-break：`exactCwd` 有 pane 精確停在目標 cwd → 依序 `preferIds`
 *      （呼叫者所在 workspace、HERDR_WORKSPACE_ID）→ 候選中 label 唯一命中 `tieLabels`。
 *   4. 候選全是同一身分 label（例：三個都叫 `clade`）且上面都分不出 → 落側欄最上面那個：
 *      `number`（Herdr 側欄位置）最小者；caller 沒帶 `number` 時取 `workspaces` 排最前者——
 *      `herdr workspace list` 依 `number` 遞增輸出，caller 照原序傳入即同義。同名就是同一個家，
 *      使用者在側欄分不出它們；回 `null` 會讓 caller 再開第 N+1 個同名 workspace，一旦有兩個
 *      就每次派工都多一個。
 *   5. 都不是 → `null`，caller 自行建一個以身分命名的新 workspace——NEVER 退回 focused，
 *      也 NEVER 在 label 不同的多候選間亂猜。
 *
 * caller 排除（誤放自我強化的防線）：
 *   - `excludePane`：不該算歸屬證據的 pane（dev-session 用它剔掉自己建的 `dev-*` pane——
 *     誤建過一次之後，把它算進去會讓 cwd 比對永遠多一個候選收不回來）。
 *   - `requireHost`：host 資格（目標 repo 為該 workspace pane 的嚴格最多數）；只套在 cwd
 *     退路、零 label 命中時。
 *   - `excludeWorkspace`：workspace 層排除（三個 caller 都用 `labelBelongsToOtherRepo` 剔掉
 *     label 可證明屬於別的 repo 的 workspace——即使它含目標 repo 的 pane）。只套在 cwd
 *     退路的命中集上：label 命中身分的 workspace 不可能「屬於別的 repo」，沒有目標 repo
 *     pane 的 workspace 本來就不會被 cwd 選中——排除判定常要逐 pane 跑 `git`／`ssh`，
 *     不在這兩種 workspace 上白花。
 *
 * 本檔只做純判定：不呼叫 herdr、不碰檔案系統。workspace／pane 清單由 caller 取好傳進來
 * （沒有 herdr server 的環境才能測）；路徑正規化（realpath 等）由 caller 經 `canonPath`
 * 注入，`repoRoots` 本身則由 caller 先正規化好。
 */

export type WorkspaceInfo = {
  workspace_id?: string
  label?: string | null
  /** Herdr 側欄位置（`workspace list` 的 `number`）；只用於同名多命中時挑最上面那個。 */
  number?: number
}

export type PaneInfo = {
  workspace_id?: string
  label?: string | null
  cwd?: string | null
  foreground_cwd?: string | null
}

export type WorkspaceChoiceReason =
  | 'pin' // 顯式 pin 命中
  | 'label' // 身分 label 唯一命中
  | 'cwd' // pane cwd 退路唯一命中（含 label 多命中間的 cwd 消歧）
  | 'cwd-exact' // tie-break：有 pane 精確停在目標 cwd
  | 'preferred' // tie-break：preferIds 依序命中
  | 'label-tie' // tie-break：候選中唯一命中 tieLabels
  | 'label-first' // 同身分 label 多命中且分不出：落側欄最上面（number 最小）那個
  | 'none'

export type WorkspaceChoice = {
  /** 命中的 workspace；null = caller 應自行建一個新 workspace。 */
  workspaceId: string | null
  reason: WorkspaceChoiceReason
  /** 進入最後判定的那組候選（cwd 命中集，或 label 多命中集）；ambiguous 時回報用。 */
  candidates: string[]
}

export function normalizeLabel(label: string | null | undefined): string {
  return typeof label === 'string' ? label.trim().toLocaleLowerCase() : ''
}

/** path 是否等於 root 或落在 root 之下。兩邊都先去掉結尾斜線，避免 `/a/bc` 被算成在 `/a/b` 內。 */
export function pathInside(path: string, root: string): boolean {
  const p = path.replace(/\/+$/, '')
  const r = root.replace(/\/+$/, '')
  if (!p || !r) return false
  return p === r || p.startsWith(`${r}/`)
}

/** pane 的 cwd／foreground_cwd（經 `canon` 正規化；正規化失敗照原樣）。 */
function panePaths(pane: PaneInfo, canon?: (path: string) => string): string[] {
  return [pane.cwd, pane.foreground_cwd]
    .filter((path): path is string => typeof path === 'string' && path.length > 0)
    .map((path) => {
      if (!canon) return path
      try {
        return canon(path)
      } catch {
        return path
      }
    })
}

export function paneInsideRoots(
  pane: PaneInfo,
  roots: string[],
  canon?: (path: string) => string,
): boolean {
  return panePaths(pane, canon).some((path) => roots.some((root) => pathInside(path, root)))
}

/** pane 是否精確停在 `target`（`target` 與 pane 路徑同經 `canon` 正規化後比等）。 */
export function paneAtPath(
  pane: PaneInfo,
  target: string,
  canon?: (path: string) => string,
): boolean {
  let want: string
  try {
    want = canon ? canon(target) : target
  } catch {
    want = target
  }
  want = want.replace(/\/+$/, '')
  return panePaths(pane, canon).some((path) => path.replace(/\/+$/, '') === want)
}

/**
 * 挑 Tab／pane 該落腳的 workspace；回 `null` 表示沒有夠格的既有 workspace（caller 自建）。
 * `pin` 不命中任何掛身分名或承載 repo pane 的 workspace 時 throw——壞 pin 是錯誤，不自開。
 */
export function chooseRepoWorkspace(input: {
  workspaces: WorkspaceInfo[]
  panes: PaneInfo[]
  /** 身分 label（正規化後比等；dev 傳 consumerId、resume 傳 repo 名、派工傳 repo label）。 */
  identityLabels: string[]
  /** 目標 repo 的 checkout roots（caller 先正規化；linked worktree 全列上）。 */
  repoRoots: string[]
  excludePane?: (pane: PaneInfo) => boolean
  excludeWorkspace?: (workspace: WorkspaceInfo, panes: PaneInfo[]) => boolean
  /**
   * host 資格（spec W-2026-10-13-herdr-workspace-repo-classification § C1）：cwd 退路只收
   * 回 true 的 workspace——目標 repo 要是它 pane 的**嚴格最多數**，只躺著一個目標 repo pane
   * （caller 自己的、relay 繼任者的）不算家。判定本身（git／慣例解析）由 caller 注入。
   * 只套在 cwd 退路：label 命中身分的 workspace 是顯式主張，不受它限；顯式 pin 同樣不受限。
   */
  requireHost?: (workspace: WorkspaceInfo, panes: PaneInfo[]) => boolean
  /** 顯式 `--workspace`：命中掛身分名或有 repo pane 的 workspace 才受理。 */
  pin?: string
  /** tie-break：有 pane 的 cwd 精確等於此路徑的 workspace 優先。 */
  exactCwd?: string
  /** tie-break：依序偏好這些 workspace_id（呼叫者所在、環境指定）。 */
  preferIds?: string[]
  /** tie-break：候選中 label 唯一命中這組（派工帶派工 label）時落它。 */
  tieLabels?: string[]
  /** pane 路徑正規化（例：realpath）；不給就用原字串比對。 */
  canonPath?: (path: string) => string
}): WorkspaceChoice {
  const workspaces = input.workspaces.filter(
    (w): w is WorkspaceInfo & { workspace_id: string } =>
      typeof w.workspace_id === 'string' && w.workspace_id.length > 0,
  )
  const roots = input.repoRoots.filter((root) => typeof root === 'string' && root.length > 0)
  const panesByWorkspace = new Map<string, PaneInfo[]>()
  for (const pane of input.panes) {
    if (!pane || typeof pane.workspace_id !== 'string' || !pane.workspace_id) continue
    const list = panesByWorkspace.get(pane.workspace_id) ?? []
    list.push(pane)
    panesByWorkspace.set(pane.workspace_id, list)
  }
  const panesOf = (id: string) => panesByWorkspace.get(id) ?? []
  const identity = new Set(input.identityLabels.map(normalizeLabel).filter(Boolean))
  const labelHit = (w: WorkspaceInfo) => identity.has(normalizeLabel(w.label))
  const hostsPane = (w: WorkspaceInfo & { workspace_id: string }, ignoreExclusions = false) =>
    panesOf(w.workspace_id).some(
      (pane) =>
        (ignoreExclusions || !input.excludePane?.(pane)) &&
        paneInsideRoots(pane, roots, input.canonPath),
    )

  if (input.pin !== undefined) {
    const pinned = workspaces.find(
      (w) => w.workspace_id === input.pin && (labelHit(w) || hostsPane(w, true)),
    )
    if (!pinned) {
      throw new Error(
        `workspace ${JSON.stringify(input.pin)} neither carries the target repository's name nor holds a pane in it`,
      )
    }
    return { workspaceId: pinned.workspace_id, reason: 'pin', candidates: [pinned.workspace_id] }
  }

  const labelHits = workspaces.filter(labelHit)
  if (labelHits.length === 1) {
    return {
      workspaceId: labelHits[0].workspace_id,
      reason: 'label',
      candidates: [labelHits[0].workspace_id],
    }
  }

  // label 多命中時 cwd 只在它們之間比（它們已是顯式主張，免 host 資格）；零命中才輪到
  // 全部 workspace，此時要過 host 資格。排除與 host 判定只問 cwd 命中者。
  const pool = labelHits.length ? labelHits : workspaces
  const needHost = labelHits.length === 0 && input.requireHost !== undefined
  const cwdHits = roots.length
    ? pool.filter(
        (w) =>
          hostsPane(w) &&
          !input.excludeWorkspace?.(w, panesOf(w.workspace_id)) &&
          (!needHost || input.requireHost?.(w, panesOf(w.workspace_id))),
      )
    : []
  if (cwdHits.length === 1) {
    return {
      workspaceId: cwdHits[0].workspace_id,
      reason: 'cwd',
      candidates: [cwdHits[0].workspace_id],
    }
  }

  // cwd 無法消歧的多個 label 命中仍以 label 集為候選（tie-break 可能再分出勝負）。
  const finalists = cwdHits.length > 1 ? cwdHits : labelHits
  const candidateIds = finalists.map((w) => w.workspace_id)
  if (finalists.length > 1) {
    if (input.exactCwd) {
      const exact = finalists.filter((w) =>
        panesOf(w.workspace_id).some(
          (pane) =>
            !input.excludePane?.(pane) &&
            paneAtPath(pane, input.exactCwd as string, input.canonPath),
        ),
      )
      if (exact.length === 1) {
        return { workspaceId: exact[0].workspace_id, reason: 'cwd-exact', candidates: candidateIds }
      }
    }
    for (const id of input.preferIds ?? []) {
      const preferred = finalists.filter((w) => w.workspace_id === id)
      if (preferred.length === 1) {
        return {
          workspaceId: preferred[0].workspace_id,
          reason: 'preferred',
          candidates: candidateIds,
        }
      }
    }
    const tieSet = new Set((input.tieLabels ?? []).map(normalizeLabel).filter(Boolean))
    if (tieSet.size) {
      const labelMatches = finalists.filter((w) => tieSet.has(normalizeLabel(w.label)))
      if (labelMatches.length === 1) {
        return {
          workspaceId: labelMatches[0].workspace_id,
          reason: 'label-tie',
          candidates: candidateIds,
        }
      }
    }
    if (finalists.every(labelHit)) {
      // filter 不改序，缺 number 的保持 list 原序（sort 為穩定排序）。
      const position = (w: WorkspaceInfo) =>
        typeof w.number === 'number' ? w.number : Number.POSITIVE_INFINITY
      const [first] = finalists.toSorted((a, b) => position(a) - position(b))
      return { workspaceId: first.workspace_id, reason: 'label-first', candidates: candidateIds }
    }
  }
  return { workspaceId: null, reason: 'none', candidates: candidateIds }
}

/**
 * label 可證明屬於別的 repo 的 workspace：它自己的 label 等於它某個「非目標 repo」pane 所在
 * git checkout 的 repo 名（`repoLabelOf` 由 caller 注入——本機跑 `git worktree list`、peer
 * 走 ssh，第一行主 checkout 的目錄名）。誤放進來的目標 repo pane 不讓它變成目標 repo 的家。
 * 使用者自訂、對不上任何 repo 的 label（`scratch`、空 label）與不在 git 樹內的 pane 一律
 * 不構成排除——猜不出歸屬就不放棄既有 workspace。
 */
export function labelBelongsToOtherRepo(
  workspace: WorkspaceInfo,
  panes: PaneInfo[],
  opts: {
    roots: string[]
    /** 目標 repo 的身分名（含派工 label）；label 等於其一就不是別人的。 */
    wantedLabels: Iterable<string>
    repoLabelOf: (path: string) => string | null
    canonPath?: (path: string) => string
  },
): boolean {
  const own = normalizeLabel(workspace.label)
  if (!own) return false
  for (const wanted of opts.wantedLabels) if (normalizeLabel(wanted) === own) return false
  return panes.some((pane) => {
    if (paneInsideRoots(pane, opts.roots, opts.canonPath)) return false
    return [pane.cwd, pane.foreground_cwd].some(
      (path) =>
        typeof path === 'string' &&
        path.length > 0 &&
        normalizeLabel(opts.repoLabelOf(path)) === own,
    )
  })
}
