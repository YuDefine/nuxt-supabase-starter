// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/publish-in-flight.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/publish-in-flight.ts
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'

export type ProcessProbe = () => string[]

const SCRIPT_ARG = /(?:^|\/)scripts\/(?:publish|propagate)\.ts$/

/**
 * 呼叫者自己的祖先 pid（含自身）。讀的是 `/proc/<pid>/stat` 的 ppid —— 行程樹的結構事實，
 * NEVER 是 cmdline 長什麼樣子。讀不到（非 Linux、/proc 不可讀）就停在那裡：集合變小，
 * 排除得少，方向是 fail closed。
 */
export function ancestorPids(start = process.pid): Set<number> {
  const seen = new Set<number>()
  let pid = start
  while (pid > 1 && !seen.has(pid)) {
    seen.add(pid)
    let stat: string
    try {
      stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    } catch {
      break
    }
    // comm 可含空白與括號，ppid 一律從最後一個 ')' 之後取。
    const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
    if (!Number.isInteger(ppid)) break
    pid = ppid
  }
  return seen
}

/** 這個行程是不是把 publish/propagate 腳本當成**獨立的 argv 元素**在執行。讀不到 → true。 */
function runsPublishScript(pid: number): boolean {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      .split('\0')
      .some((a) => SCRIPT_ARG.test(a))
  } catch {
    return true
  }
}

/**
 * Return publish/propagate processes without filtering on executable shape.
 *
 * 唯一的排除是**呼叫者自己的祖先鏈**：`zsh -c '…; git status -- scripts/propagate.ts'`、
 * `run-evidence.ts -- /bin/bash -c '…'` 這類 wrapper 的 cmdline 只是字串裡**提到**該路徑，
 * 而它們是這次呼叫的祖先 —— 它們若真在跑 publish，publish 本體會是另一個（非祖先）行程，
 * 照樣被看到（2026-09-16 實測：merge-back 被自己的三層 shell 祖先擋下，實際在飛 = 0）。
 *
 * 祖先本身**就是** publish/propagate（argv 有一個元素是腳本路徑，例如 publish.ts 自己
 * spawn 了寫 main 的指令）時 NEVER 排除 —— 那正是 TD-1064 要擋的「你自己那一趟」。
 * 這道 argv 檢查只會把行程**留下**，不會多放行任何一個非祖先行程，所以它不是
 * 「pgrep 後接 cmdline 長相過濾」那型（那型的失敗方向是靜默放行）。
 */
export function detectPublishInFlight(ancestors: Set<number> = ancestorPids()): string[] {
  const result = spawnSync('pgrep', ['-af', 'scripts/(publish|propagate)\\.ts'], {
    encoding: 'utf8',
  })
  if (result.status === 1) return []
  if (result.status !== 0)
    return [`pgrep failed (status=${result.status}); treating as in-flight (fail closed)`]
  return result.stdout
    .split('\n')
    .filter((line) => line.trim())
    .filter((line) => {
      const pid = Number(line.trim().split(/\s+/)[0])
      return !ancestors.has(pid) || runsPublishScript(pid)
    })
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
