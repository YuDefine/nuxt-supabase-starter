// 🔒 LOCKED — managed by clade · Source: vendor/scripts/preservation-profiles.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/preservation-profiles.ts
import type { ConsumerProfile, EvidenceState } from './preservation-policy.ts'

interface ProfileDefinition {
  topology: ConsumerProfile['topology']
  resources: ConsumerProfile['resources']
  filesystem?: ConsumerProfile['filesystem']
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
const profileEntries: Array<[string, ProfileDefinition]> = [
  [
    'clade',
    {
      // Evidence 2026-09-17 (98 linked worktrees + 3 landed sources inventoried): two
      // uninitialized gitlinks (vendor/aixbdd, vendor/specformula); no nested .git, no
      // objects/info/alternates, no LFS filter; 0 special files / ACL / xattr on ext4; the only
      // external symlink is wt-helper's `consumers.local` runtime link; only template env files.
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
  ['nuxt-supabase-starter', { topology: unknownTopology, resources: unknownResources }],
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
      topology: unknownTopology,
      resources: {
        ...unknownResources,
        databases: 'declared-present',
        sidecars: 'declared-present',
      },
    },
  ],
  [
    '<consumer-j>',
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
    '<consumer-k>',
    {
      topology: unknownTopology,
      resources: { ...unknownResources, databases: 'verified-absent' },
    },
  ],
  [
    '<consumer-h>',
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
    '<consumer-g>',
    {
      topology: unknownTopology,
      resources: { ...unknownResources, databases: 'unknown' },
    },
  ],
  [
    '<consumer-i>',
    {
      topology: unknownTopology,
      resources: { ...unknownResources, databases: 'declared-present' },
    },
  ],
  ['<consumer-f>', { topology: unknownTopology, resources: unknownResources }],
  [
    '<consumer-e>',
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

export function preservationProfileFor(
  consumerId: string,
  source: string,
  destination: string,
): ConsumerProfile {
  const definition = profiles[consumerId] ?? {
    topology: unknownTopology,
    resources: unknownResources,
  }
  return {
    id: `${consumerId}-p0-profile`,
    version: 1,
    roots: { source },
    topology: { ...definition.topology },
    resources: { ...definition.resources },
    filesystem: { ...unknownFilesystem, ...definition.filesystem },
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
