// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/publish-in-flight.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/publish-in-flight.ts
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

export type ProcessProbe = () => string[]

/** Return publish/propagate processes without filtering on executable shape. */
export function detectPublishInFlight(): string[] {
  const result = spawnSync('pgrep', ['-af', 'scripts/(publish|propagate)\\.ts'], {
    encoding: 'utf8',
  })
  if (result.status === 1) return []
  if (result.status !== 0)
    return [`pgrep failed (status=${result.status}); treating as in-flight (fail closed)`]
  return result.stdout.split('\n').filter((line) => line.trim())
}

/** Narrow process matches to processes which can read the requested tree. */
export function inFlightHoldersFor(
  targetRoot: string | undefined,
  detect: ProcessProbe = detectPublishInFlight,
) {
  const lines = detect()
  if (lines.length === 0) return []
  if (!targetRoot) return lines

  let target: string
  try {
    target = realpathSync(resolve(targetRoot))
  } catch {
    return lines
  }

  const held: string[] = []
  for (const line of lines) {
    const pid = line.trim().split(/\s+/)[0]
    if (!/^\d+$/.test(pid)) {
      held.push(line)
      continue
    }
    let cwd: string
    try {
      cwd = realpathSync(`/proc/${pid}/cwd`)
    } catch {
      held.push(line)
      continue
    }
    if (cwd === target || cwd.startsWith(`${target}/`) || target.startsWith(`${cwd}/`))
      held.push(line)
  }
  return held
}

export function assertNoPublishInFlight(
  action: string,
  targetRoot?: string,
  allow = false,
  detect: ProcessProbe = detectPublishInFlight,
) {
  if (allow) return
  const lines = inFlightHoldersFor(targetRoot, detect)
  if (lines.length === 0) return
  throw new Error(
    `${action}: 有 publish / propagate 在飛，這個動作會改 main 的 working tree／HEAD 並打死它。\n` +
      `${lines.map((line) => `  ${line}`).join('\n')}\n` +
      '等它回報完成再跑，或 --i-know-publish-is-running 明示覆寫（TD-1064）。',
  )
}
