// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/dev-workspace.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/dev-workspace.ts
/**
 * dev-workspace.ts — dev-session 那一側的 workspace 落點入口。
 *
 * 判定本體在 `./workspace-choice.ts` 的 `chooseRepoWorkspace`（handoff 派工、停放續接、
 * dev-session 同一份 cwd 比對與 label 正規化）。本檔只剩
 * dev-session 的 caller 排除——`dev-*` pane 是 dev-session 自己建的 Tab，不算 workspace
 * 歸屬證據；沒有這條會自我強化：`dev-<consumer-b>` 被誤建在 clade 的 workspace 之後，clade 的
 * workspace 裡就多出一個 cwd 落在 <consumer-b> repo 的 pane，下一次 cwd 比對於是同時命中
 * clade 與 <consumer-b> → ambiguous → 永遠修不回去。
 *
 * 為什麼需要這層：`herdr tab create` 不帶 `--workspace` 時，Tab 建在**當下 focused
 * workspace**。agent 幾乎都從 clade session 起 consumer 的 dev server，於是每一台
 * dev server 的 Tab 都堆在 clade 的 workspace 裡（2026-08-12 實測：`dev-<consumer-b>` 的
 * pane cwd 是 <home>/offline/<consumer-b>，workspace 卻是 w2 = clade）。`--cwd` 只
 * 決定 shell 的工作目錄，對 Tab 歸屬零影響。
 *
 * 本檔只做判定的薄轉接，不呼叫 herdr——herdr 的 workspace / pane 清單由 caller 取好傳進來，
 * 才能在沒有 herdr server 的環境下測（repo key 解析可注入）。
 *
 * host 資格（現行判準：vendor/snippets/herdr-session-handoff/README.md 的 workspace placement 段，選擇規則在 ./workspace-choice.ts）：cwd 退路
 * 要求目標 repo 是該 workspace 的**嚴格最多數**——一個別 repo 的 pane 躺在 clade 的 workspace 裡，
 * 不該讓那個 workspace 變成該 repo 的 dev 落點。pane 的 repo 歸屬預設用 git 解析（`repoKeyOf`
 * 可注入，測試傳純函式），判定本體在 `./workspace-repo-profile.ts`。
 */

import { realpathSync } from 'node:fs'

import { taskName } from '../herdr-visible-identity.ts'
import {
  chooseRepoWorkspace,
  labelBelongsToOtherRepo,
  normalizeLabel,
  paneInsideRoots,
  type PaneInfo,
  type WorkspaceInfo,
} from './workspace-choice.ts'
import {
  profileWorkspacePanes,
  repoKeyByGit,
  workspaceHostsRepo,
  type RepoKeyResolver,
} from './workspace-repo-profile.ts'

export type { PaneInfo, WorkspaceInfo }
export { labelBelongsToOtherRepo, normalizeLabel }

export type DevWorkspaceChoice = {
  /** 命中的 workspace；null = caller 應自行建一個新 workspace。 */
  workspaceId: string | null
  /** 命中理由；`none` 代表沒有任何 workspace 夠格。 */
  reason: 'label' | 'cwd' | 'none'
  /** 進入最後判定的候選（用於 ambiguous 時回報，判定本身不看它）。 */
  candidates: string[]
}

/**
 * dev-session 自己建的 Tab 不算 workspace 歸屬證據（見檔頭）。`taskName` 先剝掉
 * `[wN:pM] ` pane 前綴，`dev-` 前綴認的是任務名。
 */
export function isDevSessionPane(pane: PaneInfo): boolean {
  return typeof pane.label === 'string' && taskName(pane.label).startsWith('dev-')
}

/**
 * 挑 dev Tab 該落腳的 workspace（`chooseRepoWorkspace` 的 dev-session 取參）：
 * 身分 label = consumerId；caller 排除 = dev-* pane。
 * cwd 退路另要求目標 repo 在該 workspace 是嚴格最多數（host 資格，見檔頭）。
 *
 * 兩層都要求唯一：猜錯 workspace 的代價（dev server 跑去別人的 space）跟現況一樣糟，
 * 而建一個新 workspace 一定正確。唯一例外是多個 workspace 都掛 consumerId：同名即同一個家，
 * selector 落側欄最上面那個（`label-first`），不再多建一個同名的。
 */
export function chooseDevWorkspace(input: {
  workspaces: WorkspaceInfo[]
  panes: PaneInfo[]
  consumerId: string
  repoRoots: string[]
  /** 需要時可再注入 workspace 層排除（例如 label 可證明屬於別的 repo）。 */
  excludeWorkspace?: (workspace: WorkspaceInfo, panes: PaneInfo[]) => boolean
  /** pane cwd → repo key（主 checkout）；預設 git 解析，null＝unclassified。 */
  repoKeyOf?: RepoKeyResolver
}): DevWorkspaceChoice {
  const repoRoots = input.repoRoots.filter((root) => typeof root === 'string' && root.length > 0)
  // Same realpath form `repoKeyByGit` returns, so a symlinked checkout does not split into two keys.
  let key = (repoRoots[0] ?? '').replace(/\/+$/, '')
  try {
    if (key) key = realpathSync(key)
  } catch {
    // Not on this filesystem (tests, deleted dir): the path as given is the key.
  }
  const resolveKey = input.repoKeyOf ?? repoKeyByGit
  const choice = chooseRepoWorkspace({
    workspaces: input.workspaces,
    panes: input.panes,
    identityLabels: [input.consumerId],
    repoRoots,
    excludePane: isDevSessionPane,
    excludeWorkspace: input.excludeWorkspace,
    requireHost: (_workspace, panes) => {
      const own = panes.filter((pane) => !isDevSessionPane(pane))
      const profile = profileWorkspacePanes(own, resolveKey, {
        key,
        matches: (pane) => paneInsideRoots(pane, repoRoots),
      })
      return workspaceHostsRepo(profile, key)
    },
  })
  const reason = choice.reason === 'label' ? 'label' : choice.workspaceId ? 'cwd' : 'none'
  return { workspaceId: choice.workspaceId, reason, candidates: choice.candidates }
}
