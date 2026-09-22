// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/publish-in-flight.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/publish-in-flight.ts
import { spawnSync } from 'node:child_process'
import { readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type ProcessProbe = () => string[]

const SCRIPT_ARG = /(?:^|\/)scripts\/(?:publish|propagate)\.ts$/
/** pgrep 行裡獨立的絕對腳本路徑 → 該腳本所在樹根（`…/scripts/publish.ts` 的上兩層）。 */
const ABSOLUTE_SCRIPT = /(?:^|\s)(\/\S+\/scripts\/(?:publish|propagate)\.ts)(?=\s|$)/

function scriptTreeFromLine(line: string): string | undefined {
  const match = ABSOLUTE_SCRIPT.exec(line)
  if (!match) return undefined
  return resolve(match[1], '../..')
}

const CI_HOME = /clade-ci-home-r\d+/

/** Other-run isolate vs this target. Unproven paths stay fail closed. */
function isForeignScriptTree(scriptTree: string, target: string): boolean {
  if (within(scriptTree, target)) return false
  const scriptHome = CI_HOME.exec(scriptTree)?.[0]
  const targetHome = CI_HOME.exec(target)?.[0]
  if (scriptHome && targetHome && scriptHome !== targetHome) return true
  try {
    realpathSync(scriptTree)
    return true
  } catch {
    return false
  }
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

const within = (cwd: string, target: string) =>
  cwd === target || cwd.startsWith(`${target}/`) || target.startsWith(`${cwd}/`)

/** 同一個檔案系統物件（dev＋ino），不經路徑字串。 */
const sameObject = (a: { dev: number; ino: number }, b: { dev: number; ino: number }) =>
  a.dev === b.dev && a.ino === b.ino

/**
 * cwd 物件在不在 target 樹內：它若在樹內的 `<rel>`，它視角路徑字串的尾段就是 `<rel>`（d_path 由 dentry
 * 名稱組成，與掛載無關），而我方的 `<target>/<rel>` 會是同一個 dev/ino。逐個尾段比對即可。
 * NEVER 改成沿 `/proc/<pid>/cwd/..` 往上走：`..` 之後核心會跨進對方的掛載點，被 overmount 的祖先
 * 看不到（2026-09-17 unshare 實測：落到 tmpfs 根 ino=1）。
 *
 * 已知差集：對方 cwd 經 bind 別名進入樹內（`/repo/scripts` 掛在 `/alias`、cwd=`/alias`）時尾段對不上。
 * 同一命名空間的 realpath 判定對同一形狀一樣回 free（射程本來就以路徑界定，2026-09-17 unshare 實測）。
 */
function cwdObjectInside(cwdPath: string, cwd: { dev: number; ino: number }, target: string) {
  const parts = cwdPath.split('/').filter(Boolean)
  for (let k = 0; k <= parts.length; k++) {
    try {
      if (sameObject(statSync(join(target, ...parts.slice(k))), cwd)) return true
    } catch (error) {
      // 我方沒有這個尾段 → 不是這一種對應；其他錯誤（權限）證明不了不在樹內，往上拋 fail closed
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
    }
  }
  return false
}

/**
 * 持有者與我方不在同一個掛載命名空間時，它的 cwd 路徑字串是**它視角**的：在我方 realpath 不是
 * ENOENT，就是解析到我方同名的另一個目錄。所以不拿路徑字串在我方解析，改問兩件與視角無關的事：
 *
 * 1. cwd **物件**是不是在我方 target 樹內（見 `cwdObjectInside`）——它把該路徑 overmount 掉、cwd 仍
 *    留在原樹內時，只看 root 視角會漏判
 * 2. 它 root 底下的同一路徑是不是我方 target 物件——是，才拿它視角的 cwd 字串判「cwd 是 target 祖先」
 *
 * 回 `undefined` = 同一命名空間或判不出命名空間，走原本的 realpath 判定；`'unreadable'` = 確定跨
 * 命名空間但讀不到，交給下方二次探測 fail closed。
 *
 * TD-1085（2026-09-17 CT 102）：runner slot 同 user、共用 PID namespace、各自 `PrivateTmp=yes`，
 * shard 2 的 cleanup 被 shard 4 存活中的 `publish.ts --wait 2` 擋下（cwd 在 shard 4 私有 /tmp）。
 */
function crossNamespaceHold(
  proc: string,
  pid: string,
  target: string,
): 'held' | 'free' | 'unreadable' | undefined {
  let ours: string
  let theirs: string
  try {
    ours = readlinkSync(`${proc}/self/ns/mnt`)
    theirs = readlinkSync(`${proc}/${pid}/ns/mnt`)
  } catch {
    return undefined
  }
  if (ours === theirs) return undefined
  try {
    const cwd = readlinkSync(`${proc}/${pid}/cwd`)
    if (cwd.endsWith(' (deleted)')) return 'unreadable'
    const mine = statSync(target)
    if (cwdObjectInside(cwd, statSync(`${proc}/${pid}/cwd`), target)) return 'held'
    let seen: ReturnType<typeof statSync>
    try {
      seen = statSync(`${proc}/${pid}/root${target}`)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return 'free'
      throw error
    }
    return sameObject(seen, mine) && target.startsWith(`${cwd}/`) ? 'held' : 'free'
  } catch {
    return 'unreadable'
  }
}

/** Narrow process matches to processes which can read the requested tree. */
export function inFlightHoldersFor(
  targetRoot: string | undefined,
  detect: ProcessProbe = detectPublishInFlight,
  proc = '/proc',
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
    const cross = crossNamespaceHold(proc, pid, target)
    if (cross !== undefined) {
      if (cross === 'held') held.push(line)
      else if (cross === 'unreadable') unreadable.push({ pid, line })
      continue
    }
    let cwd: string
    try {
      cwd = realpathSync(`${proc}/${pid}/cwd`)
    } catch {
      unreadable.push({ pid, line })
      continue
    }
    if (within(cwd, target)) held.push(line)
  }
  // cwd 讀不到 → 再問同一個 detector 一次，仍被列出才 fail closed。已退出的行程在兩次探測之間
  // 消失：pgrep 不再列出 zombie／正在退出者（cmdline 已清空），已回收者更不會出現。
  // 判準仍是 detector 本身，NEVER 改讀 /proc 狀態自行宣告「行程已死」—— 那會讓注入的 probe
  // 與真實 pgrep 走兩套語義。
  //
  // 2026-09-16 CI（run 35145389949, test-lanes 2/4）：同 shard `publish-lock-exit-code.test.ts`
  // 的 `publish.ts --wait 2` 在 pgrep 與讀 cwd 之間退出，`wt-batch.test.ts` 的 cleanup 因此被擋。
  // 本機探測：讀 cwd 失敗的每一筆都是 state Z／R 且 cmdline 長度 0。
  //
  // 2026-09-18 CI（run 35394786384, leftover #82 lane 2）：同一 runner 上另一趟
  // `clade-ci-home-r35394162751a1-lane1` 的 `clade-deleted-cwd-publish` fixture 仍在跑，
  // cwd 已刪所以 realpath 失敗。舊判準 fail closed 把**另一個 run 的私有樹**當成 holder，
  // 擋掉本 job fixture 的 `batch cleanup`。腳本絕對路徑若與 target 不相交，那不是這棵樹。
  //
  // 2026-09-21 CI（run 35549872744, lanes 2–5 全紅）：別的 runner service（PrivateTmp，跨掛
  // 載命名空間）殘留的 `node scripts/publish.ts` **相對 argv** 孤兒活了 6+ 分鐘，cwd 已刪。
  // 相對 argv 抽不出絕對腳本樹 → 走不到 isForeignScriptTree → 無限期 fail closed。cwd 已刪
  // 的行程其工作目錄物件已不存在：它不可能是 target、也裝不下還活著的 target。readlink 仍給
  // 得出它最後的路徑字串——字面上在 target 內（曾是我方樹的一部分）→ 照樣擋；在外 → free。
  // 已知差集（與 cwdObjectInside 註解同型、實害低——已刪的樹無法再對活 target publish）：
  // 經 bind alias 進入 target 的已刪 cwd，路徑字串對不上 → free；絕對 argv 指向 target 外、
  // 腳本樹本身也已不存在時，不再要 isForeignScriptTree 的 live/CI-home 佐證即放行。
  if (unreadable.length > 0) {
    const still = new Set(detect().map((line) => line.trim().split(/\s+/)[0]))
    for (const { pid, line } of unreadable) {
      if (!still.has(pid)) continue
      const gone = deletedCwdPath(proc, pid)
      if (gone !== undefined) {
        // 相對 argv 的腳本樹就是已刪的 cwd 本身；絕對 argv 仍看腳本樹（在我方樹內 → 擋）。
        const scriptTree = scriptTreeFromLine(line) ?? gone
        if (within(scriptTree, target) || within(gone, target)) held.push(line)
        continue
      }
      const scriptTree = scriptTreeFromLine(line)
      // Skip a proven other tree (another CI home / live tmp isolate). `/repo/scripts/publish.ts`
      // in wt-batch's same-tree probe is not a live isolate — fail closed and still hold.
      if (scriptTree && isForeignScriptTree(scriptTree, target)) continue
      held.push(line)
    }
  }
  return held
}

/**
 * `/proc/<pid>/cwd` readlink 原文以 ` (deleted)` 結尾 → 回已刪 cwd 最後的路徑字串；
 * 讀不到或不是 deleted → `undefined`（留在原本的 fail-closed 路徑）。
 *
 * 尾綴只是 link 文字：活著的目錄若剛好以 ` (deleted)` 結尾，單看字尾會誤判成已刪。
 * 補一道 `statSync` 的 nlink 判準（本機實測：被刪但仍被引用的目錄 inode 還在、
 * nlink=0；活目錄 nlink ≥ 2）。stat 成功且 nlink>0 → 活目錄、不是 deleted；
 * nlink=0 或 stat 失敗（跨 ns 我方解析不到／dangling）→ 與已刪一致。
 * 方向仍是 fail closed：判不出來就不當 deleted。
 */
function deletedCwdPath(proc: string, pid: string): string | undefined {
  let raw: string
  try {
    raw = readlinkSync(`${proc}/${pid}/cwd`)
  } catch {
    return undefined
  }
  if (!raw.endsWith(' (deleted)')) return undefined
  try {
    if (statSync(`${proc}/${pid}/cwd`).nlink !== 0) return undefined
  } catch {
    // stat 失敗（跨 ns 路徑不可達／懸空）：與已刪一致
  }
  return raw.slice(0, -' (deleted)'.length)
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
