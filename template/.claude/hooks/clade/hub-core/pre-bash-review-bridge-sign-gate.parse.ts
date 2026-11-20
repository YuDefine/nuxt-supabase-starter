/**
 * Review Bridge 代簽守門的判定核心：從一條 shell 指令找出 `review-bridge start|resume … --yes` 呼叫（簽核嘗試）。
 * 只做指令解析，不讀任何狀態；代簽紀錄與席位判定、hook 接線不在本檔。
 * 本檔自足（只用 node 內建模組），可原樣複製到別處執行。
 *
 * threat model：防漂移（絆索不是牆）——誠實但健忘的 agent 順手帶 `--yes`；不防主動偽造。
 *
 * 看不懂就擋（fail closed）：指令含 review-bridge 字樣，又帶 parser 不完全理解的語法類別（OPAQUE_SYNTAX：`$( )`、反引號、括號、
 *   反斜線續行、eval／source、任何 `$`、大括號展開、glob（命令字本身用 glob 拼的不承諾，見繞行場景）、xargs／parallel、
 *   heredoc／here-string、alias／function），不解析、整條當簽核嘗試——逐種補寫法窮舉不完 shell 語法，所以列舉看不懂的類別整類擋。
 *   gate 自己的檔名（`review-bridge-sign-gate`）與 consumer 的 Bridge 設定目錄（`.review-bridge/`）不算字樣，維護指令
 *   （`git add …-sign-gate.{sh,ts}`、`jq '.x[0]' .review-bridge/bridge.json`）不會被誤判；指令帶 `$`／反引號時不豁免（可用檔名拼出命令字）。
 * 字樣判定：去掉引號、反斜線、`$` 與反斜線續行後含 `review-bridge` 才進判定。
 *   跳脫碼拼字（`$'review\x2dbridge'`、`$'review\055bridge'`）在 threat model 外（誠實的 agent 不會這樣寫），不承諾。
 * 會攔到談論該指令的文字，不只執行：`echo "review-bridge start x --yes"`、heredoc 內文、`git commit -m '…'` 的訊息含
 * 那串字也會中（帶引號且含空白的字串一律遞迴當指令判）；要寫這種文字，改用 Write／Edit 落檔。
 *
 * 繞行場景（解析層）：
 *   | 繞法 | 預期攔截點 |
 *   | `npx review-bridge start x --yes`、`/abs/path/review-bridge resume <run> -y` | 命令字 basename |
 *   | `bash -c 'review-bridge start x --yes'`、`ssh desk "review-bridge start x --yes"`、`ssh desk "review-bridge start x" --yes` | 字串引數接上其後的字遞迴 |
 *   | `$(…)`／反引號／`<(…)` 當引數、續行、`$RB start x --yes`、`bash <<<"…"`、alias | 看不懂的語法類別 |
 *   | `review-"bridge"`、`review-$''bridge` 拆字 | 正規化後含字樣，再由看不懂的語法類別或命令字判 |
 *   | `node node_modules/review-bridge/dist/cli.js start x --yes` | 路徑段 `review-bridge[@版本]/` 也算命令字 |
 *   | `$'review\x2dbridge' start x --yes` 這類跳脫碼拼字 | 不承諾（threat model 外） |
 *   | `review-bri* start x --yes`、`review-bridg? …` 這類 glob 拼命令字 | 不承諾（字樣判定不中，到不了 glob 類別；threat model 外） |
 *   | 腳本檔、`node -e`（指令字面沒有 review-bridge） | 不承諾 |
 *
 * 判定（指令先切成簡單指令；含空白、含 review-bridge 的字串引數連同其後所有字接起來遞迴判）：
 *   命令字的 basename 是 `review-bridge`、`review-bridge@<版本>` 或 `review-bridge.mjs`，或路徑含 `review-bridge[@版本]/` 段
 *   （套件內進入點；`npx`／`vp`／`pnpm exec`／`pnpm dlx` 前綴涵蓋；同一簡單指令裡每個這樣的字都各判一次），其後第一個
 *   非選項、非重導向的字是子命令；帶 --yes 而子命令位置不是 start／resume 時，其後出現的 start／resume 仍算（倒向擋）。
 *   反斜線續行、`2>&1`／`&>`／`>&2`／`>|` 重導向不切斷簡單指令。
 */

import { basename } from 'node:path'

export const SHA_ENV = 'BRIDGE_PLAN_SHA256'
export const GUARDED = new Set(['start', 'resume'])
/** 帶值的選項（值不是子命令）；`--x=v` 形式不吃下一個字。 */
const VALUE_OPTS = new Set([
  '--writer',
  '--reviewer',
  '--breakpoint',
  '--allow-paths',
  '--owner',
  '--work-package',
  '--rounds',
  '--call-timeout',
  '--update',
  '--project',
  '--fake-cli',
  '--fake-scenario',
  '--target',
  '--profile',
  '--port',
])

const REDIRECT = /^\d*(?:&>>?|>>?[&|]?|<<?<?|<[&>])/
const REDIRECT_BARE = /^\d*(?:&>>?|>>?[&|]?|<<?<?|<[&>])$/

export interface BridgeCall {
  sub: string
  target: string | null
  yes: boolean
  sha: string | null
}

type Tok = { w: string; op: false; quoted: boolean } | { w: string; op: true }

/** 簡化的 shell 斷字：引號、反斜線、控制運算子（; & | 換行 括號）。不做展開。 */
export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let cur = ''
  let has = false
  let quoted = false
  const push = () => {
    if (has) out.push({ w: cur, op: false, quoted })
    cur = ''
    has = false
    quoted = false
  }
  // 前一個字元是未跳脫、未加引號的 `<`／`>` 運算子（`\\>|` 的 | 仍是管線）
  let redir = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    const afterRedir = redir
    redir = false
    if (c === "'") {
      const end = src.indexOf("'", i + 1)
      const stop = end < 0 ? src.length : end
      cur += src.slice(i + 1, stop)
      has = true
      quoted = true
      i = stop
    } else if (c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== '"') {
        // 雙引號內的反斜線續行同樣整組拿掉
        if (src[j] === '\\' && src[j + 1] === '\n') {
          j += 2
          continue
        }
        // bash 雙引號內反斜線只跳脫 $ ` " \；其餘照留（`"…-y\n"` 不能讀成 `-yn`）
        if (src[j] === '\\' && j + 1 < src.length && '$`"\\'.includes(src[j + 1]!)) j++
        cur += src[j]
        j++
      }
      has = true
      quoted = true
      i = j
    } else if (c === '\\' && i + 1 < src.length) {
      // 反斜線續行：整組拿掉，不產生 word（否則多行寫法會冒出空字串子命令而放行）
      if (src[i + 1] !== '\n') {
        cur += src[i + 1]
        has = true
      }
      i++
    } else if (c === '#' && !has) {
      const nl = src.indexOf('\n', i)
      i = nl < 0 ? src.length : nl - 1
    } else if ((c === '&' || c === '|') && afterRedir) {
      // `2>&1`、`>&2`、`<&0`、`>|` 的 &／| 是重導向的一部分，不是控制運算子
      cur += c
      has = true
    } else if (c === '>' || c === '<' || (c === '&' && src[i + 1] === '>')) {
      // 重導向運算子開新字（bash 裡它們會結束前一個字：`--yes>out`、`--yes&>/dev/null` 的 --yes 照樣傳出去）；
      // 前一個字全是數字時是 fd（`2>`），併在一起
      if (has && !/^[\d&<>]*$/.test(cur)) push()
      cur += c
      has = true
      redir = c !== '&'
    } else if (/[;&|\n()`]/.test(c)) {
      push()
      out.push({ w: c, op: true })
    } else if (/\s/.test(c)) {
      push()
    } else {
      cur += c
      has = true
    }
  }
  push()
  return out
}

function isBridgeWord(w: string): boolean {
  // 套件內的進入點（`node node_modules/review-bridge/dist/cli.js start …`）也算命令字
  return (
    /^review-bridge(?:@[^/\s]*|\.mjs)?$/.test(basename(w)) ||
    // 只認進入點形狀（目錄本身、dist／bin 底下、.js 類檔）：plan 放在 bridge checkout 裡（`~/offline/review-bridge/work/x.md`）不算命令字
    /(?:^|\/)review-bridge(?:@[^/\s]*)?\/(?:$|(?:.*\/)?(?:dist|bin)\/|.*\.[cm]?[jt]s$)/.test(w)
  )
}

function parseSimple(
  words: { w: string; quoted: boolean }[],
  out: BridgeCall[],
  depth: number,
): void {
  // 每個命令字位置都判一次：`npx -p review-bridge review-bridge start …`、`pnpm --filter review-bridge exec review-bridge …`
  // 的第一個 review-bridge 是選項值，真正的呼叫在後面
  // 含空白的字不當命令字、一律走下方遞迴：`ssh h 'review-bridge start ~/x/review-bridge/y.md --yes'` 整串被判成命令字就漏掉字串內的 start
  const idxs = words.flatMap((t, k) => (isBridgeWord(t.w) && !/\s/.test(t.w) ? [k] : []))
  // 引數字串裡藏著 review-bridge（bash -c '…'、ssh host '…'）：遞迴展開
  for (let k = 0; k < words.length; k++) {
    if (idxs.includes(k)) continue
    const t = words[k]!
    // 比對前去掉引號與反斜線（同 signAttempt）：`bash -c "review-'bridge' start x --yes"` 內層 shell 會還原
    const norm = t.w.replace(/\\\r?\n/g, '').replace(/["'\\$]/g, '')
    if (!norm.includes('review-bridge')) continue
    // 超過遞迴深度還含 review-bridge：判不出，倒向擋
    if (depth >= 4) out.push({ sub: 'start', target: null, yes: true, sha: null })
    // 不論有沒有引號：`bash -c review-bridge\ start\ x\ --yes` 的跳脫空白一樣會被內層 shell 斷字
    else if (/\s/.test(t.w) && depth < 4)
      // 重導向運算子緊接引號（`bash <<<"review-bridge start x --yes"`）會和引號內容併成一字：先剝掉運算子。
      // 字串之後的字一起接上再判：`ssh host "review-bridge start x" --yes` 遠端收到的是整串接起來的一條指令
      // （bash -c 後面的字是位置參數，接上去只會多擋，倒向擋）。字面跳脫碼（`\n`、`\t`、`\x0a`、`\012`…）先換成空白：
      // `printf 'review-bridge start x --yes\n' | bash` 的 printf 會先展開，不換掉會讀成 `--yesn`
      out.push(
        ...parseBridgeCalls(
          [
            t.w
              .replace(REDIRECT, '')
              .replace(/\\(?:x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|[0-7]{1,3}|[abefnrtv])/g, ' '),
            ...words.slice(k + 1).map((x) => x.w),
          ].join(' '),
          depth + 1,
        ),
      )
  }
  for (const idx of idxs) parseAt(words, idx, out)
}

function parseAt(words: { w: string; quoted: boolean }[], idx: number, out: BridgeCall[]): void {
  let sha: string | null = null
  for (const t of words.slice(0, idx)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(t.w)
    if (m && m[1] === SHA_ENV) sha = m[2]!.trim().toLowerCase()
  }
  let sub: string | null = null
  let target: string | null = null
  let yes = false
  const rest = words.slice(idx + 1).map((t) => t.w)
  // yes 先對所有字判（倒向擋）：不讓重導向或選項值的跳字吃掉 `--yes`
  for (const w of rest) {
    if (w === '--yes' || w === '-y') yes = true
    else if (w.startsWith('--yes=') && !/^(false|0|no)$/i.test(w.slice(6))) yes = true
  }
  for (let k = 0; k < rest.length; k++) {
    const w = rest[k]!
    if (w === '--yes' || w === '-y' || w.startsWith('--yes=')) continue
    else if (w === '--') continue
    else if (REDIRECT.test(w)) {
      // 重導向：只有運算子（`>`、`2>`、`&>`）時目標在下一個字
      if (REDIRECT_BARE.test(w)) k++
    } else if (w.startsWith('-')) {
      if (VALUE_OPTS.has(w)) k++
    } else if (sub === null) sub = w
    else if (target === null) target = w
  }
  // 倒向擋：帶 yes 時，子命令位置判歪（判不出的重導向寫法）也不放過後面出現的 start／resume
  if (yes && (sub === null || !GUARDED.has(sub))) {
    const g = rest.find((w) => GUARDED.has(w))
    if (g) sub = g
  }
  // 子命令判不出（引數從別處來）又帶 --yes：倒向擋，當成 start
  if (sub === null && yes) sub = 'start'
  if (sub !== null) out.push({ sub, target, yes, sha })
}

/** 找出指令裡所有 review-bridge 呼叫（含 bash -c 等字串引數內的）。只在 opaqueSyntax 判過沒有看不懂的語法後才可信。 */
export function parseBridgeCalls(command: string, depth = 0): BridgeCall[] {
  const out: BridgeCall[] = []
  let words: { w: string; quoted: boolean }[] = []
  const toks: Tok[] = [...tokenize(command), { w: ';', op: true }]
  for (const t of toks) {
    if (t.op === true) {
      if (words.length) parseSimple(words, out, depth)
      words = []
    } else words.push({ w: t.w, quoted: t.quoted })
  }
  return out
}

/**
 * parser 不完全理解的語法類別。指令含 review-bridge 又帶其中任何一類，就不解析、一律當簽核嘗試擋下（fail closed）：
 * 逐種補寫法窮舉不完 shell 語法，所以改成列舉看不懂的類別整類擋。
 * 只比對字面（含引號內：`"$(…)"`、`bash -c '…'` 的內文一樣會被 shell 展開或執行）。
 * eval／source、xargs／parallel、alias／function 只認命令位置的獨立字（前面是開頭、空白、`;&|'"(`）：路徑段
 * `work/source.md`、`docs/function.md` 不算。
 */
export const OPAQUE_SYNTAX: readonly { label: string; re: RegExp }[] = [
  { label: '命令替換 $( )', re: /\$\(/ },
  { label: '反引號命令替換', re: /`/ },
  { label: '括號（subshell、程序替換 <( )、算術）', re: /[()]/ },
  { label: '反斜線續行', re: /\\\r?\n/ },
  { label: 'eval／source', re: /(?:^|[\s;&|'"(])(?:eval|source)(?=$|[\s;&|'")])/ },
  { label: '任何 $（變數／參數展開、ANSI-C 與在地化引號）', re: /\$/ },
  { label: '大括號展開（{a,b}、{1..3}）', re: /[{}]/ },
  { label: 'glob（* ? [ ]）', re: /[*?[\]]/ },
  {
    label: '引數來自 stdin（xargs、parallel）',
    re: /(?:^|[\s;&|'"(])(?:xargs|parallel)(?=$|[\s;&|'")])/,
  },
  { label: 'heredoc／here-string（<<、<<<）', re: /<</ },
  { label: 'alias／function 定義', re: /(?:^|[\s;&|'"(])(?:alias|function)(?=$|[\s;&|'")])/ },
]

/** 回傳指令裡出現的看不懂語法類別（沒有回空陣列）。 */
export function opaqueSyntax(command: string): string[] {
  return OPAQUE_SYNTAX.filter((o) => o.re.test(command)).map((o) => o.label)
}

/** 一條指令的簽核嘗試判定結果：`opaque` 非空＝含字樣又帶看不懂的語法（整條當簽核嘗試）；否則 `calls` 是帶 --yes 的 start／resume 呼叫。 */
export interface SignAttempt {
  opaque: string[]
  calls: BridgeCall[]
}

/** 找出指令裡的簽核嘗試。`opaque` 與 `calls` 都空＝不是簽核嘗試，放行。 */
export function signAttempt(command: string): SignAttempt {
  // 去掉引號、反斜線、`$` 與續行再比對：`review-"bridge"`、`review-$''bridge` 這類拆字也要進判定
  const unquoted = command.replace(/\\\r?\n/g, '').replace(/["'\\$]/g, '')
  // gate 自己的檔名與 consumer 的 `.review-bridge/` 設定目錄不算字樣；指令有 `$`／反引號時不豁免
  // （`rb=review-bridge-sign-gate; ${rb%-sign-gate} start x --yes` 會用檔名拼出命令字）
  const flat = /[$`]/.test(command)
    ? unquoted
    : unquoted.replaceAll('review-bridge-sign-gate', '').replaceAll('.review-bridge/', '')
  if (flat.includes('review-bridge')) {
    const opaque = opaqueSyntax(command)
    if (opaque.length) return { opaque, calls: [] }
  }
  return {
    opaque: [],
    calls: parseBridgeCalls(command).filter((c) => c.yes && GUARDED.has(c.sub)),
  }
}
