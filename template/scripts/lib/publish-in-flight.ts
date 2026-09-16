// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/publish-in-flight.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/publish-in-flight.ts
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'

export type ProcessProbe = () => string[]

const SCRIPT_ARG = /(?:^|\/)scripts\/(?:publish|propagate)\.ts$/

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
 * Return publish/propagate processes: pgrep hits whose argv runs the script itself.
 *
 * 識別的是**被執行的腳本**，不是 launcher 長相：不論 mise 絕對路徑 node、`process.execPath`、
 * `--experimental-strip-types`、tsx、`timeout`／`env` 前綴，執行 `scripts/publish.ts` 時該路徑
 * 必定是獨立的 argv 元素。所以這不是 `^[0-9]+ node ` 那型「拿 launcher 長相過濾」——那型的
 * 正例過不了，本判準的正例恆過；cmdline 讀不到一律保留（fail closed）。
 *
 * 被濾掉的只有「路徑嵌在更大 argv 元素的字串裡」：`zsh -c '…; git status -- scripts/propagate.ts'`、
 * heredoc `cat`、`herdr agent prompt '<訊息提到 node scripts/publish.ts>'`。它們若真的在跑
 * publish，publish 本體是另一個有 argv 元素的行程，照樣被看到。
 * 實測兩次：2026-09-16 merge-back 被自己的三層 shell 祖先擋下（實際在飛 = 0）；2026-09-17 真
 * publish 期間，一個 cwd=$HOME、只在訊息字串裡提到路徑的 herdr prompt 讓 `~/.tmp`／`~/.cache`
 * 底下所有 wt-helper／wt-batch fixture 被判在飛（重現：該形狀常駐時 3 檔紅、70 次拒跑）。
 *
 * 已知差集：`node -e "import('./scripts/publish.ts')"` pgrep 命中而本判準不留（repo 內無此呼叫）。
 * 殘餘誤報：`tail -f`／`vim`／`git log --` 把路徑當獨立引數的常駐行程，方向是 fail closed。
 */
export function detectPublishInFlight(): string[] {
  const result = spawnSync('pgrep', ['-af', 'scripts/(publish|propagate)\\.ts'], {
    encoding: 'utf8',
  })
  if (result.status === 1) return []
  if (result.status !== 0)
    return [`pgrep failed (status=${result.status}); treating as in-flight (fail closed)`]
  return result.stdout
    .split('\n')
    .filter((line) => line.trim())
    .filter((line) => runsPublishScript(Number(line.trim().split(/\s+/)[0])))
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
  const unreadable: { pid: string; line: string }[] = []
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
      unreadable.push({ pid, line })
      continue
    }
    if (cwd === target || cwd.startsWith(`${target}/`) || target.startsWith(`${cwd}/`))
      held.push(line)
  }
  // cwd 讀不到 → 再問同一個 detector 一次，仍被列出才 fail closed。已退出的行程在兩次探測之間
  // 消失：pgrep 不再列出 zombie／正在退出者（cmdline 已清空），已回收者更不會出現。
  // 判準仍是 detector 本身，NEVER 改讀 /proc 狀態自行宣告「行程已死」—— 那會讓注入的 probe
  // 與真實 pgrep 走兩套語義。
  //
  // 2026-09-16 CI（run 35145389949, test-lanes 2/4）：同 shard `publish-lock-exit-code.test.ts`
  // 的 `publish.ts --wait 2` 在 pgrep 與讀 cwd 之間退出，`wt-batch.test.ts` 的 cleanup 因此被擋。
  // 本機探測：讀 cwd 失敗的每一筆都是 state Z／R 且 cmdline 長度 0。
  if (unreadable.length > 0) {
    const still = new Set(detect().map((line) => line.trim().split(/\s+/)[0]))
    for (const { pid, line } of unreadable) if (still.has(pid)) held.push(line)
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
