// 🔒 LOCKED — managed by clade · Source: vendor/scripts/preservation-profiles.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/preservation-profiles.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ConsumerProfile, EvidenceState } from './preservation-policy.ts'

interface ProfileDefinition {
  topology: ConsumerProfile['topology']
  resources: ConsumerProfile['resources']
  resourceAdapters?: ConsumerProfile['resourceAdapters']
  localSupabase?: ConsumerProfile['localSupabase']
  filesystem?: ConsumerProfile['filesystem']
  rebuildable?: string[]
  byteReserve?: number
}

const unknownTopology: ConsumerProfile['topology'] = {
  nestedRepositories: 'unknown',
  submodules: 'unknown',
  sharedGitObjects: 'unknown',
  lfs: 'unknown',
}
const unknownResources: ConsumerProfile['resources'] = {
  databases: 'unknown',
  volumes: 'unknown',
  sidecars: 'unknown',
  secrets: 'unknown',
}
const unknownFilesystem: ConsumerProfile['filesystem'] = {
  externalSymlinks: 'unknown',
  specialFiles: 'unknown',
  acl: 'unknown',
  xattr: 'unknown',
}
const absentResources: ConsumerProfile['resources'] = {
  databases: 'verified-absent',
  volumes: 'verified-absent',
  sidecars: 'verified-absent',
  secrets: 'verified-absent',
}
// consumer 名必須留在字串 literal 位置：public consumer 的投影會把 fleet 私名
// sanitize 成 `<consumer-x>` 佔位符——只有在字串位置才仍是合法 TS（裸 object
// key `<consumer-a>:` 會退化成 `<consumer-a>:` 語法錯誤）。object literal 的 quoted key
// 又會被 fmt `quoteProps: 'as-needed'` 脫回裸 key，所以這裡用 entries tuple。
//
// 只列 profile 與 default（全 unknown）不同的 consumer：default 已由
// preservationProfileFor 的 fallback 給出，重列一次只會把 consumer 名多寫進投影檔。
// public starter 的投影不 sanitize 它自己的名字，scaffold 出的新專案 placeholder
// scan 會把那一行當成未替換的 starter 名而擋下。
const profileEntries: Array<[string, ProfileDefinition]> = [
  [
    'clade',
    {
      // Evidence 2026-09-17 (98 linked worktrees + 3 landed sources inventoried): two
      // uninitialized gitlinks (vendor/aixbdd, vendor/specformula); no nested .git, no
      // objects/info/alternates, no LFS filter; 0 special files / ACL / xattr on ext4; the only
      // external symlink is wt-helper's `consumers.local` runtime link; only template env files.
      // `node_modules` (incl. `.pnpm`) is rebuildable from the committed lockfile.
      topology: {
        nestedRepositories: 'verified-absent',
        submodules: 'declared-present',
        sharedGitObjects: 'verified-absent',
        lfs: 'verified-absent',
      },
      resources: absentResources,
      filesystem: {
        externalSymlinks: 'declared-present',
        externalSymlinkAllowlist: ['consumers.local'],
        specialFiles: 'verified-absent',
        acl: 'verified-absent',
        xattr: 'verified-absent',
      },
      rebuildable: ['node_modules'],
    },
  ],
  [
    '<consumer-a>',
    {
      topology: unknownTopology,
      resources: {
        ...unknownResources,
        databases: 'declared-present',
        sidecars: 'declared-present',
      },
    },
  ],
  [
    '<consumer-d>',
    {
      topology: unknownTopology,
      resources: { ...unknownResources, databases: 'declared-present' },
    },
  ],
  [
    '<consumer-b>',
    {
      // Evidence 2026-10-11 (main + 108 linked worktrees, 13.95M entries on ext4): Pi
      // clones under `.pi/git/github.com/YuDefine/clade` in main + 7 trees and nested
      // `.claude/worktrees/*/.git` gitfiles in main; no gitlink or tracked .gitmodules
      // in any index (the nested clade clone's own .gitmodules is not <consumer-b>'s); no
      // objects/info/alternates in the common dir or any worktree gitdir; no `filter=lfs`
      // in any .gitattributes, no .git/lfs, no lfs hooks (only the host-wide
      // /etc/gitconfig filter and a vestigial `lfs.repositoryformatversion=0`); 0 special
      // files / posix ACL / xattr; 80 stale external symlinks under main's
      // `.claude/worktrees/agent-*/.claude/rules/*.md` (-> ~/...) plus a
      // `node_modules` cross-tree link in 2 trees — no allowlist: observed paths churn
      // per agent worktree, exact-match entries would block captures (<consumer-j>
      // precedent). Dev resources verified on fc-supabase-dev: <consumer-b>_base + 82 `<consumer-b>_wt_*`
      // clone databases, 54 `<consumer-b>-pgrst-wt-*`/`<consumer-b>-storage-wt-*` sidecar containers, 61
      // `<consumer-b>-storage-wt-*-data` + `supabase_{db,storage,edge_runtime}_<consumer-b>` volumes;
      // local docker also holds `supabase_*_<consumer-b>` volumes. Real secrets: `.env.local`
      // in 80 trees, `.env`/`.env.sentry-read`/`.env.local.bak-*` in main.
      topology: {
        nestedRepositories: 'declared-present',
        submodules: 'verified-absent',
        sharedGitObjects: 'verified-absent',
        lfs: 'verified-absent',
      },
      resources: {
        databases: 'declared-present',
        volumes: 'declared-present',
        sidecars: 'declared-present',
        secrets: 'declared-present',
      },
      filesystem: {
        externalSymlinks: 'declared-present',
        specialFiles: 'verified-absent',
        acl: 'verified-absent',
        xattr: 'verified-absent',
      },
    },
  ],
  [
    '<consumer-k>',
    {
      // Evidence 2026-10-15 (main + 21 linked worktrees, 1,186,861 entries on ext4; plan
      // evidence/2026-10-15-<consumer-k>-inventory.md): the only nested repository is the
      // gitignored Pi clone `.pi/git/github.com/YuDefine/clade/.git` in main; no gitlink or
      // .gitmodules, no objects/info/alternates, no `filter=lfs` attribute or .git/lfs (only
      // the host-wide git config filter); 0 special files, no xattr and so no posix ACL. 65,332
      // symlinks, none resolving outside its tree: 211 dangling-but-in-tree links (105 each in
      // the two `batch-*` integration trees, 1 `.pnpm-store` link in main) keep the inventory
      // fail-closed on missing targets for those trees. No docker container or volume, no
      // `.claude/worktree-db.json` (registry preview_db is shared-preview-db, auth is D1): the
      // only database state is miniflare D1 under main's `.wrangler/state`, in-tree and kept by
      // the full-tree archive. Real secrets: `.env` (main) and `.env.local` in every tree.
      topology: {
        nestedRepositories: 'declared-present',
        submodules: 'verified-absent',
        sharedGitObjects: 'verified-absent',
        lfs: 'verified-absent',
      },
      resources: {
        databases: 'verified-absent',
        volumes: 'verified-absent',
        sidecars: 'verified-absent',
        secrets: 'declared-present',
      },
      resourceAdapters: { secrets: 'in-tree-archive' },
      filesystem: {
        externalSymlinks: 'verified-absent',
        specialFiles: 'verified-absent',
        acl: 'verified-absent',
        xattr: 'verified-absent',
      },
    },
  ],
  [
    '<consumer-l>',
    {
      topology: unknownTopology,
      resources: { ...unknownResources, databases: 'verified-absent' },
    },
  ],
  [
    '<consumer-i>',
    {
      // Evidence 2026-10-15 (main + 49 linked worktrees, 534,143 entries on ext4; plan
      // evidence/2026-10-15-<consumer-i>-inventory.md): the only nested repositories are
      // gitignored Pi clones `.pi/git/github.com/YuDefine/clade/.git` (main + 3 worktrees); no
      // gitlink or .gitmodules, no objects/info/alternates, no `filter=lfs` attribute or
      // .git/lfs (only the host-wide git config filter); 0 special files, no xattr and so no
      // posix ACL. Only 3 symlinks leave their tree, all in main: the gitignored
      // `vendor/<consumer-b>-{migrations,seed,types}` links that scripts/setup-dev-links.sh points at
      // the sibling <consumer-b> checkout (allowlisted; the target is a separate consumer's tree).
      // Docker state is host-level, not per worktree: every service pins a fixed
      // `container_name` (a second instance cannot coexist), the compose project name is
      // pinned (`COMPOSE_PROJECT_NAME=compose`, running as `cnclinkref` from main's
      // infra/compose) and keys the named volumes, and no container/volume/mount references
      // any `<consumer-i>-wt/*` path; there is no `.claude/worktree-db.json` and no
      // writable in-tree bind mount. No real secret file exists in any tree today (only
      // `.env.example`/`appsettings.example.json`), but infra/compose/.env is the documented
      // place for one, so secrets stay declared-present and are kept by the full-tree archive.
      topology: {
        nestedRepositories: 'declared-present',
        submodules: 'verified-absent',
        sharedGitObjects: 'verified-absent',
        lfs: 'verified-absent',
      },
      resources: {
        databases: 'verified-absent',
        volumes: 'verified-absent',
        sidecars: 'verified-absent',
        secrets: 'declared-present',
      },
      resourceAdapters: { secrets: 'in-tree-archive' },
      filesystem: {
        externalSymlinks: 'declared-present',
        externalSymlinkAllowlist: [
          'vendor/<consumer-b>-migrations',
          'vendor/<consumer-b>-seed',
          'vendor/<consumer-b>-types',
        ],
        specialFiles: 'verified-absent',
        acl: 'verified-absent',
        xattr: 'verified-absent',
      },
    },
  ],
  [
    '<consumer-h>',
    {
      topology: unknownTopology,
      resources: { ...unknownResources, databases: 'unknown' },
    },
  ],
  [
    '<consumer-j>',
    {
      // Evidence 2026-09-29 (main + 18 linked worktrees, 1.41M entries on ext4): three trees
      // carry Pi clones under `.pi/git/**/.git`; no gitlink or .gitmodules, no
      // objects/info/alternates, no `filter=lfs` (only the host-wide /etc/gitconfig filter);
      // 76k symlinks all resolve inside their tree; 0 special files; no posix ACL xattr; seven
      // Samba `user.DOSATTRIB` xattrs, one inside the common .git (spectra-app/.migrated).
      // Real `.env` secrets and a worktree's local Supabase volumes and containers exist.
      topology: {
        nestedRepositories: 'declared-present',
        submodules: 'verified-absent',
        sharedGitObjects: 'verified-absent',
        lfs: 'verified-absent',
      },
      resources: {
        databases: 'declared-present',
        volumes: 'declared-present',
        sidecars: 'declared-present',
        secrets: 'declared-present',
      },
      resourceAdapters: {
        secrets: 'in-tree-archive',
        // <consumer-j> is a plain local Supabase CLI consumer (registry preview_db: none, no
        // .claude/worktree-db.json), not a worktree-db topology; claiming worktree-db made every
        // source retain on E_NO_TOPOLOGY (plan § Decisions 2026-10-13).
        databases: 'local-supabase',
        sidecars: 'local-supabase',
        volumes: 'local-supabase',
      },
      localSupabase: { canonicalProjectId: '<consumer-j>' },
      filesystem: {
        externalSymlinks: 'verified-absent',
        specialFiles: 'verified-absent',
        acl: 'verified-absent',
        xattr: 'declared-present',
      },
    },
  ],
  [
    '<consumer-f>',
    {
      topology: {
        nestedRepositories: 'declared-present',
        submodules: 'verified-absent',
        sharedGitObjects: 'verified-absent',
        lfs: 'verified-absent',
      },
      resources: absentResources,
      filesystem: {
        externalSymlinks: 'declared-present',
        specialFiles: 'verified-absent',
        acl: 'verified-absent',
        xattr: 'verified-absent',
      },
      byteReserve: 8 * 1024 ** 3,
    },
  ],
]
const profiles: Record<string, ProfileDefinition> = Object.fromEntries(profileEntries)

/** `capabilities` of the registry entry; undefined where the registry is not shipped (consumers). */
function registryCapabilities(consumerId: string): Record<string, string> | undefined {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../registry/consumers.json', import.meta.url)),
        'utf8',
      ),
    )
    const consumers = (parsed as { consumers?: unknown }).consumers
    if (!Array.isArray(consumers)) return undefined
    const entry = consumers.find(
      (item): item is { consumer_id: string; capabilities?: Record<string, string> } =>
        typeof item === 'object' && item !== null && item.consumer_id === consumerId,
    )
    return entry ? { ...entry.capabilities } : undefined
  } catch {
    return undefined
  }
}

export function preservationProfileFor(
  consumerId: string,
  source: string,
  destination: string,
): ConsumerProfile {
  const definition = profiles[consumerId] ?? {
    topology: unknownTopology,
    resources: unknownResources,
  }
  // Only a profile that claims adapters is checked against the registry; others stay identical.
  const declaredCapabilities = definition.resourceAdapters
    ? registryCapabilities(consumerId)
    : undefined
  return {
    id: `${consumerId}-p0-profile`,
    // A rebuildable declaration narrows what a receipt covers, so it retires v1 receipts.
    version: definition.rebuildable ? 2 : 1,
    roots: { source },
    ...(declaredCapabilities ? { declaredCapabilities } : {}),
    topology: { ...definition.topology },
    resources: { ...definition.resources },
    ...(definition.resourceAdapters
      ? { resourceAdapters: { ...definition.resourceAdapters } }
      : {}),
    ...(definition.localSupabase ? { localSupabase: { ...definition.localSupabase } } : {}),
    filesystem: { ...unknownFilesystem, ...definition.filesystem },
    ...(definition.rebuildable ? { rebuildable: [...definition.rebuildable] } : {}),
    retention: {
      destination,
      owner: 'clade-preservation',
      ...(definition.byteReserve !== undefined ? { byteReserve: definition.byteReserve } : {}),
    },
  }
}

export function unknownProfileFields(profile: ConsumerProfile): string[] {
  const filesystemEvidence: Record<string, EvidenceState> = {
    externalSymlinks: profile.filesystem.externalSymlinks,
    specialFiles: profile.filesystem.specialFiles,
    acl: profile.filesystem.acl,
    xattr: profile.filesystem.xattr,
  }
  const groups: Record<string, Record<string, EvidenceState>> = {
    topology: profile.topology,
    resources: profile.resources,
    filesystem: filesystemEvidence,
  }
  return Object.entries(groups).flatMap(([group, fields]) =>
    Object.entries(fields)
      .filter(([, state]) => state === 'unknown')
      .map(([field]) => `${group}.${field}`),
  )
}
