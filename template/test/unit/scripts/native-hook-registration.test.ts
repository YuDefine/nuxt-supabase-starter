import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'

// plugin→native 遷移後的 settings.json 守門：
// 1. 註冊的 hook 檔都在；2. 上游已退役的 hub-core hook 不再留孤兒檔；
// 3. hub-*@clade plugin 在專案層明確關掉（{} 擋不住更寬 scope 開的 plugin，會雙跑）。
const root =
  process.env.NATIVE_HOOK_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '../../..')
const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'))

const RETIRED_HUB_CORE_HOOKS = [
  'deferred-landing-pr.ts',
  'pre-bash-deferred-landing-pr-gate.sh',
  'pre-bash-codex-exec-gate.sh',
  'user-prompt-shorthand-gate.sh',
]

describe('native hook registration', () => {
  it('every registered hub-core hook file exists', () => {
    const commands: string[] = Object.values(settings.hooks ?? {})
      .flat()
      .flatMap((entry: any) => entry.hooks ?? [])
      .map((h: any) => String(h.command ?? ''))
    const files = commands.flatMap((c) =>
      [...c.matchAll(/\.claude\/hooks\/clade\/hub-core\/([\w.-]+)/g)].map((m) => m[1]!),
    )
    expect(files.length).toBeGreaterThan(0)
    const missing = files.filter((f) => !existsSync(join(root, '.claude/hooks/clade/hub-core', f)))
    expect(missing).toEqual([])
  })

  it('retired hub-core hooks are not left as orphan files', () => {
    const present = RETIRED_HUB_CORE_HOOKS.filter((f) =>
      existsSync(join(root, '.claude/hooks/clade/hub-core', f)),
    )
    expect(present).toEqual([])
  })

  it('hub-core@clade plugin is explicitly disabled at project scope', () => {
    expect(settings.enabledPlugins['hub-core@clade']).toBe(false)
    const enabled = Object.entries(settings.enabledPlugins).filter(([, v]) => v !== false)
    expect(enabled).toEqual([])
  })
})
