#!/usr/bin/env node
/**
 * pre-bash-agent-browser-profile-gate.ts — 擋 agent-browser 用錯 profile：
 * 對已綁 profile 的 session 下沒帶同一個 `--profile` 的指令、`--profile` 給目錄路徑（不是桌面 Chrome 的 profile 名稱）、
 * 全新 session 不帶 `--profile` 開外部網址。
 *
 * 為什麼存在：agent-browser 的 profile 是啟動參數，不跟著 session 保存。session 的 daemon 用 profile P 起好之後，
 * 只要有一個指令沒帶 `--profile`（或帶了別的），launchHash 就變，daemon 會把 Chrome 換成
 * `/tmp/agent-browser-chrome-<uuid>` 的暫存 profile——人在 KasmVNC 看到的就變成一個沒登入過的 Chrome，
 * 在裡面登入也不會寫回 P。實例：daemon env `AGENT_BROWSER_PROFILE=~/.agent-browser/profile-<name>`，
 * 同一 daemon 的 Chrome 卻是 `--user-data-dir=/tmp/agent-browser-chrome-90be9514…`，Charles 登入兩次都白登。
 * 規則本身早寫在 user-level agent-browser skill 的 `rules/profile與session不變量.md` Rule 1，文字沒擋住，所以改掛在動作上。
 * 新建／暫存 profile 與目錄路徑同理：`情境路線判準.md` Rule 3 的「NEVER 自行新建、NEVER 暫存」只靠文字擋不住，所以一併掛上；
 * 一律擋 `--profile` 目錄路徑（`~/.agent-browser/profile-*` 已退場），也看懂同一指令串前面定義的 `$AB`。
 * profile 只認桌面 Chrome「誰在使用 Chrome?」裡的設定檔（`--profile <名稱>`，agent-browser 複製一份到 /tmp 再開、
 * 登入由 Charles 在桌面 Chrome 完成），沒有的由 Charles 在那個畫面「新增」並命名。
 * 不存在的名稱 agent-browser 自己會拒絕並列出可用 profile，本 gate 不重判。
 *
 * 判定：Bash command 裡每個在命令位置的 `agent-browser` 呼叫（含同一個指令串前面定義過的 `$AB`／`${AB}` 展開），
 * 取它的 session（`--session`／`AGENT_BROWSER_SESSION=`，預設 `default`）與 profile（`--profile`／`AGENT_BROWSER_PROFILE=`）。
 * 子命令是 `close`／`session`／`profiles` 等不啟動瀏覽器的 → 放行；其餘依序：
 *   1. 帶了 profile：是目錄路徑（含 `/`，或以 `~`、`.` 開頭）→ 擋，Charles 同意這次用目錄時前綴 `CLADE_ALLOW_AB_PATH_PROFILE=1`；
 *      名稱（`cc3-yudefine`、`Profile 6`）放行。
 *   2. 到 /proc 找這個 session 活著的 daemon（environ 有 `AGENT_BROWSER_DAEMON=1` 與同名 `AGENT_BROWSER_SESSION`）；
 *      daemon 帶 profile、而這個指令沒帶或帶了不同的 → 擋。
 *   3. 沒帶 profile、沒有活 daemon（或同一串前面 close 過）→ 會開出暫存 profile 的新 Chrome → 擋。放行：`open` 本機網址
 *      （localhost／127.0.0.1／file:，dev-login 路線）、以上任一放行後同一串裡同 session 的後續指令、`--cdp`／`--auto-connect`／`--provider`
 *      連現成瀏覽器、匿名 daemon 早已在跑、Charles 同意時前綴 `CLADE_ALLOW_AB_TEMP_PROFILE=1`。
 *
 * threat model：防漂移（絆索不是牆）。字串比對型：不承諾完整語意，只認常見入口——同一個指令串裡定義的
 * `$AB` 會展開（照 bash：只切空白、不去引號，`--profile 'Main'` 判成字面 `'Main'`）、`export AGENT_BROWSER_SESSION=…／AGENT_BROWSER_PROFILE=…`
 * 會沿用；前一次 Bash 呼叫定義的變數、`bash -c`、腳本檔、`node -e` 裡的呼叫都看不到（判不出來 → 放行）。
 * 會攔到談論該指令的文字（heredoc 內文在命令位置時）；被誤擋時改用 Write 落檔，或前綴 `CLADE_ALLOW_AB_PROFILE_SWITCH=1`。
 * 不承諾：daemon 已退出（`close` 之後）再用同名 session 不帶 profile 重開——那是全新 session，本 gate 看不到過去；
 * 交接給人之前用 `vendor/snippets/agent-browser/verify-headed.sh` 驗 Chrome 實際的 user-data-dir。
 * daemon env 記的是 daemon 啟動時的 profile；若之後用別的 `--profile` 故意換過，本 gate 以啟動時那個為準（誤擋 → 逃生門）。
 *
 * gate 型別：安全型的降級。倒向擋的代價過高——判定故障時擋下全部 agent-browser 呼叫會讓所有瀏覽器工作停擺，
 * 而漏擋的代價只是換成暫存 profile（可重開補救）。所以判不出來一律放行，外殼以 additionalContext 告知「gate 故障未判定」。
 *
 *   | # | 分支 | 位置 | 行為 |
 *   | - | --- | --- | --- |
 *   | E1 | `node` 不在 PATH | `.sh` | exit 0＋additionalContext 告知 |
 *   | E2 | 本檔不在 `.sh` 同目錄 | `.sh` | 同 E1 |
 *   | E3 | stdin 不是 JSON／沒有 command | `main()` | exit 0 無輸出（不是 Bash 呼叫，無從判定也無須告知） |
 *   | E4 | 判定丟例外 | `main()` | exit 3 → 外殼同 E1 |
 *   | E5 | 判定行程非 0／2 退出 | `.sh` | 外殼不沿用退出碼，同 E1 |
 *   | E6 | 逾時 | harness | harness 砍掉 hook 屬 non-blocking，外殼收不到：已知限制 |
 *   | —  | /proc 讀不到（非 Linux、權限） | `liveDaemonProfile()` | 視為沒有活 daemon → 放行 |
 *   | —  | session／profile 值含 `$HOME` 以外的變數 | `judgeSegment()` | 輸入歧義，放行 |
 *   | —  | 全新 session 不帶 profile、`open` 的網址是變數 | `judge()` | 判不出是不是本機網址，放行 |
 *
 * 繞行場景：session／profile 在前一次 Bash 呼叫 export 或定義 `$AB`（不攔；skill 規定每次 Bash 開頭重新 export，同串的會沿用判定）；
 * `bash -c '<agent-browser …>'`（不攔）；同一個 profile 一次寫名稱、一次寫目錄名（`cc3-yudefine` 與 `Profile 6`）經 Local State 對成同一個，不算換 profile；
 * 開本機網址後在同一個暫存 Chrome 跳外部網站（不攔，本機路線的已知缺口）；
 * 改用 `AGENT_BROWSER_PROFILE=` 前綴（認得，視同 `--profile`）；弄壞判定（E1–E5 放行並告知，降級理由見上）。
 *
 * Locked 面：本 gate 不保護任何檔案，改它自己、它的測試不經過它（判定只看 agent-browser 呼叫）。
 *
 * 測試：`test/pre-bash-agent-browser-profile-gate.test.ts`（以帶 env 的假 daemon 行程造 /proc fixture）。
 */
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 不啟動、不重啟瀏覽器的子命令；對它們不必帶 profile。 */
const NO_LAUNCH = new Set([
  'close',
  'session',
  'profiles',
  'skills',
  'install',
  'doctor',
  'help',
  '--help',
  '-h',
  '--version',
  '-V',
])

/** 後面接一個值的全域旗標（只用來跳過值以找出子命令；不認得的 `--x` 當布林）。 */
const VALUE_FLAGS = new Set([
  '--session',
  '--profile',
  '--download-path',
  '--cdp',
  '--state',
  '--executable-path',
  '--proxy',
  '--proxy-bypass',
  '--user-agent',
  '--args',
  '--headers',
  '--extension',
  '--provider',
  '-p',
  '--device',
  '--session-name',
  '--color-scheme',
])

const BYPASS = 'CLADE_ALLOW_AB_PROFILE_SWITCH'
/** Charles 同意這次用目錄當 profile（不是桌面 Chrome 的設定檔）時才用。 */
const ALLOW_PATH = 'CLADE_ALLOW_AB_PATH_PROFILE'
/** Charles 同意這次用暫存 profile（不登入、不給人看）時才用。 */
const ALLOW_TEMP = 'CLADE_ALLOW_AB_TEMP_PROFILE'

/** 會帶網址參數的子命令；全新 session 開本機網址不必帶 profile（dev-login 路線）。 */
const OPEN_SUBS = new Set(['open', 'goto', 'navigate'])

/** 依 shell 分隔符（換行 ; && || | &）切段，略過引號內的分隔符。 */
export function splitSegments(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let q: string | null = null
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (q) {
      cur += c
      if (c === '\\' && q === '"' && i + 1 < cmd.length) cur += cmd[++i]
      else if (c === q) q = null
      continue
    }
    if (c === "'" || c === '"') {
      q = c
      cur += c
      continue
    }
    if (c === '\\' && i + 1 < cmd.length) {
      cur += c + cmd[++i]
      continue
    }
    if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')') {
      out.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

/** 簡化版 shell 分詞：處理單雙引號與反斜線，不做展開。 */
export function tokenize(seg: string): string[] {
  const toks: string[] = []
  let cur = ''
  let has = false
  let q: string | null = null
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]
    if (q) {
      if (c === q) q = null
      else if (c === '\\' && q === '"' && i + 1 < seg.length) cur += seg[++i]
      else cur += c
      continue
    }
    if (c === "'" || c === '"') {
      q = c
      has = true
      continue
    }
    if (c === '\\' && i + 1 < seg.length) {
      cur += seg[++i]
      has = true
      continue
    }
    if (/\s/.test(c)) {
      if (has) toks.push(cur)
      cur = ''
      has = false
      continue
    }
    cur += c
    has = true
  }
  if (has) toks.push(cur)
  return toks
}

/** 展開 `~`、`$HOME`、`${HOME}`；其他變數回 null（判不出來）。 */
function expand(v: string): string | null {
  const home = process.env.HOME || homedir()
  let s = v.replace(/^~(?=\/|$)/, home).replace(/\$\{HOME\}|\$HOME\b/g, home)
  if (s.includes('$')) return null
  return s
}

/** 目錄路徑（不是桌面 Chrome 的 profile 名稱）：agent-browser 對含 `/` 的值當路徑；`~`、`.` 開頭也一定是路徑。 */
function isPath(p: string): boolean {
  return p.includes('/') || p.startsWith('~') || p.startsWith('.')
}

const chromeDirs = new Map<string, Map<string, string>>()
/** 桌面 Chrome 的顯示名稱與目錄名 → 目錄名（讀 Local State；讀不到就空表，名稱原樣比較）。 */
function chromeProfileDirs(): Map<string, string> {
  const root = process.env.CHROME_USER_DATA_DIR ?? `${homedir()}/.config/google-chrome`
  const cached = chromeDirs.get(root)
  if (cached) return cached
  const dirs = new Map<string, string>()
  chromeDirs.set(root, dirs)
  try {
    const info = JSON.parse(readFileSync(`${root}/Local State`, 'utf8'))?.profile?.info_cache ?? {}
    for (const [dir, d] of Object.entries<{ name?: string }>(info)) {
      dirs.set(dir, dir)
      if (d?.name) dirs.set(d.name, dir)
    }
  } catch {
    // 沒有桌面 Chrome：名稱原樣比較
  }
  return dirs
}

/** profile 比較用的正規化：路徑轉絕對路徑；名稱轉成桌面 Chrome 的目錄名（`cc3-yudefine` 與 `Profile 6` 視為同一個）。 */
function normProfile(p: string): string {
  return isPath(p) ? resolve(p).replace(/\/+$/, '') : (chromeProfileDirs().get(p) ?? p)
}

interface Call {
  session: string | null
  profile: string | null | undefined // undefined＝沒帶；null＝帶了但判不出值
  sub: string | null
  /** sub 後的第一個位置參數（open 的網址） */
  arg: string | null
  /** 連到現成瀏覽器（`--cdp`／`--auto-connect`／`--provider`），不會由 agent-browser 開新的 Chrome */
  attach: boolean
  bypass: boolean
  allowPath: boolean
  allowTemp: boolean
}

type BaseEnv = Record<string, string | undefined>

/** 從一段 `export K=V …`／純賦值（沒有後續指令）取出 K=V；不是就回 null。 */
function parseAssignments(seg: string): Record<string, string> | null {
  const t = tokenize(seg)
  if (t[0] === 'export') t.shift()
  if (t.length === 0) return null
  const out: Record<string, string> = {}
  for (const tok of t) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(tok)
    if (!m) return null
    out[m[1]] = m[2]
  }
  return out
}

/** 從一段指令取出 agent-browser 呼叫；不在命令位置就回 null。base 是前面已設好的 session／profile 環境。 */
export function parseCall(
  seg: string,
  base: BaseEnv = {},
  vars: Record<string, string> = {},
): Call | null {
  let t = tokenize(seg)
  let i = 0
  const env: Record<string, string> = {}
  let bypass = false
  for (;;) {
    let tok = t[i]
    if (tok === undefined) return null
    // `$AB`／`${AB}`：同一個指令串前面定義過的就展開。照 bash 未加引號的變數展開只切空白、不去引號，
    // 判定才與實際執行一致（`AB="… --profile 'Main'"` 真正送出的是字面 `'Main'`）
    const v = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(tok)
    if (v && vars[v[1]] !== undefined) {
      t = [...t.slice(0, i), ...vars[v[1]].split(/\s+/).filter(Boolean), ...t.slice(i + 1)]
      tok = t[i]
      if (tok === undefined) return null
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(tok)
    if (m) {
      env[m[1]] = m[2]
      if (m[1] === BYPASS && m[2] === '1') bypass = true
      i++
      continue
    }
    if (tok === 'export') return null // `export AGENT_BROWSER_PROFILE=…` 不是呼叫
    if (['env', 'command', 'nice', 'exec', 'time', 'timeout', 'npx', 'bunx'].includes(tok)) {
      i++
      if (tok === 'timeout') while (t[i] !== undefined && /^(-\S+|\d+[smhd]?)$/.test(t[i])) i++
      continue
    }
    if (
      (tok === 'pnpm' || tok === 'npm' || tok === 'yarn') &&
      ['exec', 'dlx', 'x'].includes(t[i + 1] ?? '')
    ) {
      i += 2
      continue
    }
    break
  }
  const bin = t[i]
  if (bin !== 'agent-browser' && !bin.endsWith('/agent-browser')) return null
  let session: string | null = env.AGENT_BROWSER_SESSION ?? base.AGENT_BROWSER_SESSION ?? 'default'
  let profile: string | null | undefined = env.AGENT_BROWSER_PROFILE ?? base.AGENT_BROWSER_PROFILE
  let sub: string | null = null
  let arg: string | null = null
  let attach = Boolean(env.AGENT_BROWSER_CDP || env.AGENT_BROWSER_PROVIDER)
  for (let j = i + 1; j < t.length; j++) {
    const a = t[j]
    const eq = a.indexOf('=')
    const flag = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a
    const inline = a.startsWith('--') && eq > 0 ? a.slice(eq + 1) : undefined
    if (flag === '--session' || flag === '--profile' || VALUE_FLAGS.has(flag)) {
      const val = inline ?? t[++j]
      if (flag === '--session') session = val ?? null
      if (flag === '--profile') profile = val ?? null
      if (flag === '--cdp' || flag === '--provider' || flag === '-p') attach = true
      continue
    }
    if (flag === '--auto-connect') attach = true
    if (a.startsWith('-') && !NO_LAUNCH.has(a)) continue
    sub = a
    for (let k = j + 1; k < t.length; k++) {
      if (t[k].startsWith('-')) continue
      arg = t[k]
      break
    }
    break
  }
  if (session !== null) session = expand(session)
  if (typeof profile === 'string') profile = expand(profile)
  return {
    session,
    profile,
    sub,
    arg,
    attach,
    bypass,
    allowPath: (env[ALLOW_PATH] ?? base[ALLOW_PATH]) === '1',
    allowTemp: (env[ALLOW_TEMP] ?? base[ALLOW_TEMP]) === '1',
  }
}

/** 找這個 session 活著的 daemon，回它啟動時的 profile；沒有 daemon 回 undefined，有但沒 profile 回 ''。 */
export function liveDaemonProfile(session: string, procRoot = '/proc'): string | undefined {
  let pids: string[]
  try {
    pids = readdirSync(procRoot).filter((d) => /^\d+$/.test(d))
  } catch {
    return undefined
  }
  for (const pid of pids) {
    let raw: string
    try {
      raw = readFileSync(`${procRoot}/${pid}/environ`, 'latin1')
    } catch {
      continue
    }
    if (!raw.includes('AGENT_BROWSER_DAEMON=1')) continue
    const vars = new Map<string, string>()
    for (const kv of raw.split('\0')) {
      const k = kv.indexOf('=')
      if (k > 0) vars.set(kv.slice(0, k), kv.slice(k + 1))
    }
    if (vars.get('AGENT_BROWSER_DAEMON') !== '1') continue
    if ((vars.get('AGENT_BROWSER_SESSION') ?? 'default') !== session) continue
    // Chrome 子行程也繼承 daemon 的 env（值相同，不影響判定），只是不必多讀；認 argv[0] 是 agent-browser 的那個
    let argv0 = ''
    try {
      argv0 = readFileSync(`${procRoot}/${pid}/cmdline`, 'latin1').split('\0')[0]
    } catch {
      continue
    }
    if (!argv0.includes('agent-browser')) continue
    return vars.get('AGENT_BROWSER_PROFILE') ?? ''
  }
  return undefined
}

export type FindingKind = 'switch' | 'path-profile' | 'temp-profile'

export interface Finding {
  kind: FindingKind
  session: string
  /** switch：daemon 啟動時的 profile；其他種類：空字串 */
  expected: string
  got: string | undefined
}

/** 本機網址：dev server 走 dev-login，不需要登入過的 profile。 */
export function isLocalUrl(u: string): boolean {
  if (/^(file|about|data|chrome):/i.test(u)) return true
  let host: string
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `http://${u}`).hostname
  } catch {
    return false
  }
  host = host.replace(/^\[|\]$/g, '')
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  )
}

export function judge(cmd: string, procRoot = '/proc', hookEnv: BaseEnv = process.env): Finding[] {
  if (!cmd.includes('agent-browser')) return []
  const findings: Finding[] = []
  // 前面 export／賦值過的 session、profile，以及 hook 自己的環境（與 Bash 工具同源）
  const base: BaseEnv = {
    AGENT_BROWSER_SESSION: hookEnv.AGENT_BROWSER_SESSION,
    AGENT_BROWSER_PROFILE: hookEnv.AGENT_BROWSER_PROFILE,
    [ALLOW_PATH]: hookEnv[ALLOW_PATH],
    [ALLOW_TEMP]: hookEnv[ALLOW_TEMP],
  }
  const vars: Record<string, string> = {}
  const closed = new Set<string>()
  /** 同一個指令串裡已放行開出匿名 Chrome 的全新 session：後續指令沿用同一個，不再判 */
  const anonLaunched = new Set<string>()
  /** 同一個指令串裡每個 session 只掃一次 /proc */
  const daemons = new Map<string, string | undefined>()
  for (const seg of splitSegments(cmd)) {
    const call = parseCall(seg, base, vars)
    if (!call) {
      const assigned = parseAssignments(seg)
      if (assigned) {
        Object.assign(vars, assigned)
        for (const k of ['AGENT_BROWSER_SESSION', 'AGENT_BROWSER_PROFILE'])
          if (k in assigned) base[k] = assigned[k]
      }
      continue
    }
    if (call.bypass) continue
    if (call.sub === 'close' && call.session !== null) closed.add(call.session)
    if (call.sub !== null && NO_LAUNCH.has(call.sub)) continue
    if (call.session === null || call.profile === null) continue // 輸入歧義：判不出值
    const session = call.session

    // 1. profile 本身：只准桌面 Chrome 的 profile 名稱，不准目錄路徑
    if (
      typeof call.profile === 'string' &&
      !call.attach &&
      isPath(call.profile) &&
      !call.allowPath
    ) {
      findings.push({ kind: 'path-profile', session, expected: '', got: call.profile })
      continue
    }

    // 2. 已綁 profile 的活 daemon：指令要帶同一個
    if (!daemons.has(session)) daemons.set(session, liveDaemonProfile(session, procRoot))
    const live = closed.has(session) ? undefined : daemons.get(session)
    if (live) {
      const expectedPath = expand(live) ?? live // daemon env 可能記字面 `~/…`
      if (call.profile !== undefined && normProfile(call.profile) === normProfile(expectedPath))
        continue
      findings.push({ kind: 'switch', session, expected: live, got: call.profile })
      continue
    }

    // 3. 沒帶 profile、也沒有可沿用的匿名 daemon：會開出 /tmp 暫存 profile 的新 Chrome
    if (call.profile !== undefined || call.attach) continue
    if (live === '') continue // 匿名 daemon 早就在跑，這個指令不會再開新的
    if (anonLaunched.has(session)) continue
    const opensUrl = call.sub !== null && OPEN_SUBS.has(call.sub) && call.arg !== null
    if (
      call.allowTemp ||
      // 網址是變數：判不出是不是本機，放行
      (opensUrl && (call.arg!.includes('$') || isLocalUrl(call.arg!)))
    ) {
      anonLaunched.add(session)
      continue
    }
    findings.push({ kind: 'temp-profile', session, expected: '', got: undefined })
  }
  return findings
}

function describe(f: Finding): string {
  switch (f.kind) {
    case 'switch':
      return `- session \`${f.session}\` 的 daemon 是用 profile \`${f.expected}\` 起的，這個指令${
        f.got === undefined ? '沒帶 `--profile`' : `帶的是 \`${f.got}\``
      }——Chrome 會被換成暫存 profile。改法：每次 Bash 開頭 \`export AGENT_BROWSER_SESSION=<s> AGENT_BROWSER_PROFILE='<同一個 profile>'\`，之後的指令不帶 \`--session\`／\`--profile\`；真的要換就先 close。`
    case 'path-profile':
      return `- session \`${f.session}\` 的 \`--profile ${f.got}\` 是目錄路徑——profile 只認桌面 Chrome「誰在使用 Chrome?」裡的設定檔（~/.agent-browser/profile-* 已退場）。改法：\`--profile <桌面 profile 名稱>\`，用 \`bash ~/offline/clade/vendor/snippets/agent-browser/profile-index.sh <網域>\` 挑；沒有合適的就請 Charles 在那個畫面「新增」並命名、在桌面 Chrome 登入。Charles 同意這次用目錄時才前綴 ${ALLOW_PATH}=1。`
    case 'temp-profile':
      return `- session \`${f.session}\` 是全新 session，指令沒帶 \`--profile\`——agent-browser 會開出 /tmp/agent-browser-chrome-* 暫存 profile 的新 Chrome。改法：帶桌面 profile 名稱（profile-index.sh 解析）；只開本機 dev server（localhost／127.0.0.1）不必帶；Charles 同意用暫存 profile 時才前綴 ${ALLOW_TEMP}=1。`
  }
}

function main(): void {
  let input: { tool_name?: string; tool_input?: { command?: unknown } }
  try {
    input = JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    process.exit(0) // E3
  }
  const cmd = input?.tool_input?.command
  if (typeof cmd !== 'string' || !cmd) process.exit(0) // E3
  if (process.env[BYPASS] === '1') process.exit(0)
  let findings: Finding[]
  try {
    findings = judge(cmd)
  } catch {
    process.exit(3) // E4
  }
  if (findings.length === 0) process.exit(0)
  process.stderr.write(
    [
      'agent-browser profile gate: 這個指令會開出沒有登入狀態的 Chrome（暫存或非桌面 profile），人在 KasmVNC 會看到沒登入過的視窗。',
      ...findings.map(describe),
      '',
      `只是在文件裡寫這段指令（不是要跑）：前綴 ${BYPASS}=1 放行。`,
      '判準：user-level agent-browser skill `rules/情境路線判準.md` Rule 3、`rules/profile與session不變量.md` Rule 1；交接給人前跑 vendor/snippets/agent-browser/verify-headed.sh。',
    ].join('\n') + '\n',
  )
  process.exit(2)
}

/** 本檔是不是被直接執行：兩邊都過 realpath，symlink 與需 percent-encode 的路徑（空白、CJK）才不會讓 main 靜默不跑。 */
function isMain(): boolean {
  const argv1 = process.argv[1]
  if (!argv1) return false
  const self = fileURLToPath(import.meta.url)
  try {
    return realpathSync(resolve(argv1)) === realpathSync(self)
  } catch {
    return resolve(argv1) === self
  }
}

if (isMain()) main()
