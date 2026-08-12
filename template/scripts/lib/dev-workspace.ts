/**
 * dev-workspace.ts — 決定 dev-session 的 herdr Tab 該落在哪個 workspace。
 *
 * 為什麼需要這層：`herdr tab create` 不帶 `--workspace` 時，Tab 建在**當下 focused
 * workspace**。agent 幾乎都從 clade session 起 consumer 的 dev server，於是每一台
 * dev server 的 Tab 都堆在 clade 的 workspace 裡（2026-08-12 實測：`dev-<consumer-b>` 的
 * pane cwd 是 <home>/offline/<consumer-b>，workspace 卻是 w2 = clade）。`--cwd` 只
 * 決定 shell 的工作目錄，對 Tab 歸屬零影響。
 *
 * 判定順序刻意與 `herdr-session-handoff.ts` 的 chooseWorkspace 同語意（label 消歧 +
 * pane cwd 落在 repo root 下），差別只在這裡 label 比的是 consumerId、而非 caller 傳的
 * dispatch label。
 *
 * 本檔只做**純判定**，不呼叫 herdr、不碰檔案系統——herdr 的 workspace / pane 清單由
 * caller 取好傳進來，才能在沒有 herdr server 的環境下測。
 */

export type WorkspaceInfo = {
  workspace_id?: string
  label?: string | null
}

export type PaneInfo = {
  workspace_id?: string
  label?: string | null
  cwd?: string | null
  foreground_cwd?: string | null
}

export type DevWorkspaceChoice = {
  /** 命中的 workspace；null = caller 應自行建一個新 workspace。 */
  workspaceId: string | null
  /** 命中理由；`none` 代表沒有任何 workspace 夠格。 */
  reason: 'label' | 'cwd' | 'none'
  /** cwd 比對命中的 workspace（用於 ambiguous 時回報，判定本身不看它）。 */
  candidates: string[]
}

function normalizeLabel(label: string | null | undefined): string {
  return typeof label === 'string' ? label.trim().toLocaleLowerCase() : ''
}

/** path 是否等於 root 或落在 root 之下。兩邊都先去掉結尾斜線，避免 `/a/bc` 被算成在 `/a/b` 內。 */
function isInside(path: string, root: string): boolean {
  const p = path.replace(/\/+$/, '')
  const r = root.replace(/\/+$/, '')
  if (!p || !r) return false
  return p === r || p.startsWith(`${r}/`)
}

/**
 * dev-session 自己建的 Tab 不算 workspace 歸屬證據。
 *
 * 沒有這條會自我強化：`dev-<consumer-b>` 被誤建在 clade 的 workspace 之後，clade 的 workspace
 * 裡就有一個 cwd 落在 <consumer-b> repo 的 pane，下一次 cwd 比對於是同時命中 clade 與 <consumer-b> →
 * ambiguous → 永遠修不回去。
 */
function isDevSessionPane(pane: PaneInfo): boolean {
  return typeof pane.label === 'string' && pane.label.startsWith('dev-')
}

function paneMatchesRoots(pane: PaneInfo, repoRoots: string[]): boolean {
  const paths = [pane.cwd, pane.foreground_cwd].filter(
    (path): path is string => typeof path === 'string' && path.length > 0,
  )
  return paths.some((path) => repoRoots.some((root) => isInside(path, root)))
}

/**
 * 挑 dev Tab 該落腳的 workspace。
 *
 * 1. workspace label 大小寫不敏感等於 consumerId，且**唯一** → 用它
 * 2. 否則：有 non-dev pane 的 cwd 落在 repoRoots 之下、且**唯一**的 workspace → 用它
 * 3. 否則（0 個或多個都不算命中）→ `null`，caller 自行建新 workspace
 *
 * 兩層都要求唯一：猜錯 workspace 的代價（dev server 跑去別人的 space）跟現況一樣糟，
 * 而建一個新 workspace 一定正確。
 */
export function chooseDevWorkspace(input: {
  workspaces: WorkspaceInfo[]
  panes: PaneInfo[]
  consumerId: string
  repoRoots: string[]
}): DevWorkspaceChoice {
  const workspaces = input.workspaces.filter(
    (w) => typeof w.workspace_id === 'string' && w.workspace_id,
  )
  const repoRoots = input.repoRoots.filter((root) => typeof root === 'string' && root.length > 0)

  const wanted = normalizeLabel(input.consumerId)
  if (wanted) {
    const labelHits = workspaces.filter((w) => normalizeLabel(w.label) === wanted)
    if (labelHits.length === 1) {
      return { workspaceId: labelHits[0].workspace_id as string, reason: 'label', candidates: [] }
    }
  }

  const cwdHits = new Set<string>()
  if (repoRoots.length) {
    for (const pane of input.panes) {
      if (!pane || typeof pane.workspace_id !== 'string' || !pane.workspace_id) continue
      if (isDevSessionPane(pane)) continue
      if (paneMatchesRoots(pane, repoRoots)) cwdHits.add(pane.workspace_id)
    }
  }
  const candidates = [...cwdHits].filter((id) => workspaces.some((w) => w.workspace_id === id))
  if (candidates.length === 1) return { workspaceId: candidates[0], reason: 'cwd', candidates }

  return { workspaceId: null, reason: 'none', candidates }
}
