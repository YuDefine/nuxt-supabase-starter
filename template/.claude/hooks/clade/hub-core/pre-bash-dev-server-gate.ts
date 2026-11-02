#!/usr/bin/env node
/**
 * pre-bash-dev-server-gate.ts — 擋 Bash 裸起長駐 dev server，導向單一入口。
 *
 * 為什麼存在：`rules/core/proactive-skills.dev-server-spawn.md` 寫「harness 會 reap Bash 衍生的 process」，
 * 實況不是——`run_in_background` 起的 `nuxt dev` 被 init 收養後長活（2026-10-31 實查：zenbook 一個 clade pane
 * 掛 7 個 port、孤兒最久 40h）。文字規約沒擋住，所以掛在動作上：命令位置出現長駐 dev 命令就擋，
 * 不論前景或背景（前景也會卡住 Bash tool 直到 timeout，留下孤兒）。
 *
 * 判定：把 Bash command 切成命令段（只認未加引號的 `; && || | &` 與換行；heredoc 內文與引號內文是資料），
 * 每段剝掉 env 賦值與 `env`／`nohup`／`setsid`／`time`／`exec`／`sudo`／`timeout N`／`pnpm exec`／`npx`／`pnpm dlx` 等包裝後，
 * 取 argv 比對：
 *   - `nuxt|nuxi dev|preview`、`vite`（無子命令或 dev／serve／preview）、`wrangler dev`、`wrangler pages dev`
 *   - `pnpm|npm|yarn|bun dev`、`pnpm|npm|yarn|bun run dev`（script 名剛好是 `dev`；`dev:agent` 等是 consumer 的入口，放行）
 *   - `node .output/server[/…]`
 *   - `bash|sh|zsh -c '<字串>'` 遞迴判字串
 * 放行逃生門：前綴／export `CLADE_ALLOW_RAW_DEV=1`（Charles 同意這次裸起時）。
 *
 * gate 型別：安全型的降級。判不出來（解析例外、引號不成對）一律放行——漏擋的代價是一個孤兒 server，
 * 有 `dev-port-audit --runtime` 與 reaper 兜底；誤擋整個 Bash 的代價更高。
 *
 * 繞行場景：`bash script.sh` 內的 dev 命令（看不到）、前一次 Bash 呼叫定義的 alias／變數、`ssh host '…'`（遠端不歸本 gate）。
 *
 * 測試：`test/pre-bash-dev-server-gate.test.ts`。
 */
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const ENTRY_HINT =
  '長駐 dev server 一律走單一入口（帳本、lease、port 池、自動回收都掛在入口上）：\n' +
  '  worktree 內：node vendor/scripts/wt-helper.ts dev [<alias>]\n' +
  '  main／consumer：node scripts/dev-session.ts start（已有就 reuse：node scripts/dev-session.ts list）\n' +
  '詳見 rules/core/proactive-skills.dev-server-spawn.md。Charles 明確同意這次裸起時前綴 CLADE_ALLOW_RAW_DEV=1。'

type Verdict = { block: false } | { block: true; matched: string }

const SEPARATORS = new Set([';', '&&', '||', '|', '&', '\n', '|&'])

/** 把命令字串切成「段」，每段是未加引號展開的 argv。heredoc 內文丟掉。 */
export function splitSegments(command: string): string[][] | null {
  const segments: string[][] = []
  let cur: string[] = []
  let tok = ''
  let hasTok = false
  let quote: '"' | "'" | null = null
  const pendingHeredocs: string[] = []
  const flushTok = () => {
    if (hasTok) cur.push(tok)
    tok = ''
    hasTok = false
  }
  const flushSeg = () => {
    flushTok()
    if (cur.length > 0) segments.push(cur)
    cur = []
  }
  const n = command.length
  let i = 0
  while (i < n) {
    const c = command[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < n) {
        tok += command[i + 1]
        i++
      } else tok += c
      i++
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      hasTok = true
      i++
      continue
    }
    if (c === '\\' && i + 1 < n) {
      if (command[i + 1] === '\n') {
        i += 2
        continue
      }
      tok += command[i + 1]
      hasTok = true
      i += 2
      continue
    }
    if (c === '#' && !hasTok) {
      while (i < n && command[i] !== '\n') i++
      continue
    }
    if (c === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
      // heredoc：記下 delimiter，換行後略過內文
      let j = i + 2
      if (command[j] === '-') j++
      while (command[j] === ' ' || command[j] === '\t') j++
      let delim = ''
      let q: string | null = null
      while (j < n && !/[\s;&|<>()]/.test(command[j]!)) {
        const d = command[j]!
        if (q) {
          if (d === q) q = null
          else delim += d
        } else if (d === "'" || d === '"') q = d
        else delim += d
        j++
      }
      if (delim) pendingHeredocs.push(delim)
      i = j
      flushTok()
      continue
    }
    if (c === '\n') {
      flushSeg()
      i++
      for (const delim of pendingHeredocs.splice(0)) {
        // 略過到只含 delim 的那一行
        while (i < n) {
          let e = command.indexOf('\n', i)
          if (e === -1) e = n
          const line = command.slice(i, e).trim()
          i = Math.min(e + 1, n)
          if (line === delim) break
        }
      }
      continue
    }
    const two = command.slice(i, i + 2)
    if (SEPARATORS.has(two)) {
      flushSeg()
      i += 2
      continue
    }
    if (SEPARATORS.has(c!)) {
      // `>&2`、`2>&1` 的 & 不是分隔
      if (c === '&' && (command[i - 1] === '>' || command[i - 1] === '<')) {
        tok += c
        hasTok = true
        i++
        continue
      }
      flushSeg()
      i++
      continue
    }
    if (c === ' ' || c === '\t') {
      flushTok()
      i++
      continue
    }
    if (c === '(' || c === ')' || c === '{' || c === '}') {
      // subshell／group：當分隔
      if (!hasTok) {
        flushSeg()
        i++
        continue
      }
    }
    tok += c
    hasTok = true
    i++
  }
  if (quote) return null // 引號不成對：判不出
  flushSeg()
  return segments
}

const WRAPPERS = new Set([
  'env',
  'nohup',
  'setsid',
  'time',
  'exec',
  'sudo',
  'command',
  'nice',
  'stdbuf',
  'unbuffer',
])
const RUNNERS_SUB = new Map<string, Set<string>>([
  ['pnpm', new Set(['exec', 'dlx'])],
  ['npm', new Set(['exec'])],
  ['yarn', new Set(['exec', 'dlx'])],
  ['bun', new Set(['x'])],
])
const RUNNERS_BARE = new Set(['npx', 'bunx'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash'])

const base = (s: string) => s.slice(s.lastIndexOf('/') + 1)

function stripPrefix(argv: string[]): string[] {
  let a = argv.slice()
  for (let guard = 0; guard < 8 && a.length > 0; guard++) {
    const head = a[0]!
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {
      a = a.slice(1)
      continue
    }
    const name = base(head)
    if (name === 'timeout') {
      // timeout [opts] DURATION cmd
      let k = 1
      while (k < a.length && a[k]!.startsWith('-')) k++
      a = a.slice(k + 1)
      continue
    }
    if (WRAPPERS.has(name)) {
      let k = 1
      while (k < a.length && (a[k]!.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(a[k]!))) k++
      a = a.slice(k)
      continue
    }
    if (RUNNERS_BARE.has(name)) {
      let k = 1
      while (k < a.length && a[k]!.startsWith('-')) k++
      a = a.slice(k)
      continue
    }
    const subs = RUNNERS_SUB.get(name)
    if (subs && a[1] && subs.has(a[1])) {
      let k = 2
      while (k < a.length && a[k]!.startsWith('-')) k++
      a = a.slice(k)
      continue
    }
    break
  }
  return a
}

function firstPositional(args: string[]): string | undefined {
  return args.find((x) => !x.startsWith('-'))
}

function matchArgv(argvRaw: string[], depth: number): string | null {
  const argv = stripPrefix(argvRaw)
  if (argv.length === 0) return null
  const name = base(argv[0]!)
  const rest = argv.slice(1)
  const sub = firstPositional(rest)
  if (name === 'nuxt' || name === 'nuxi') {
    return sub === 'dev' || sub === 'preview' ? `${name} ${sub}` : null
  }
  if (name === 'vite') {
    // vite 的旗標帶值（`--port 5173`），子命令只看第一個參數；沒有子命令＝dev
    const first = rest[0]
    if (first === undefined || first.startsWith('-')) return 'vite'
    return first === 'dev' || first === 'serve' || first === 'preview' ? `vite ${first}` : null
  }
  if (name === 'wrangler') {
    if (sub === 'dev') return 'wrangler dev'
    if (sub === 'pages' && rest.filter((x) => !x.startsWith('-'))[1] === 'dev')
      return 'wrangler pages dev'
    return null
  }
  if (name === 'pnpm' || name === 'npm' || name === 'yarn' || name === 'bun') {
    // `pnpm nuxt dev`：pnpm／yarn 直接跑 local bin
    if (sub && ['nuxt', 'nuxi', 'vite', 'wrangler'].includes(sub)) {
      return matchArgv(rest.slice(rest.indexOf(sub)), depth)
    }
    if (sub === 'dev') return `${name} dev`
    if (sub === 'run' || sub === 'run-script') {
      const script = rest.slice(rest.indexOf(sub) + 1).find((x) => !x.startsWith('-'))
      if (script === 'dev') return `${name} run dev`
    }
    return null
  }
  if (name === 'node' || name === 'bun') {
    const script = firstPositional(rest)
    if (script && /(^|\/)\.output\/server(\/|$)/.test(script)) return `node ${script}`
    return null
  }
  if (SHELLS.has(name) && depth < 3) {
    const ci = rest.indexOf('-c')
    const cmd = ci >= 0 ? rest[ci + 1] : undefined
    if (cmd) return judgeInner(cmd, depth + 1)
  }
  return null
}

function judgeInner(command: string, depth: number): string | null {
  const segs = splitSegments(command)
  if (!segs) return null
  for (const seg of segs) {
    const hit = matchArgv(seg, depth)
    if (hit) return hit
  }
  return null
}

export function judge(command: string, env: NodeJS.ProcessEnv = process.env): Verdict {
  if (env.CLADE_ALLOW_RAW_DEV === '1') return { block: false }
  // 命令串內前綴／export 的逃生門
  if (/(^|[\s;&|])(export\s+)?CLADE_ALLOW_RAW_DEV=1(\s|;|$)/.test(command)) return { block: false }
  try {
    const hit = judgeInner(command, 0)
    return hit ? { block: true, matched: hit } : { block: false }
  } catch {
    return { block: false }
  }
}

function main(): number {
  let raw = ''
  try {
    raw = readFileSync(0, 'utf8')
  } catch {
    return 0
  }
  let command = ''
  try {
    command = String(JSON.parse(raw)?.tool_input?.command ?? '')
  } catch {
    return 0
  }
  if (!command) return 0
  const v = judge(command)
  if (!v.block) return 0
  process.stderr.write(`BLOCKED：裸起長駐 dev server（${v.matched}）。\n${ENTRY_HINT}\n`)
  return 2
}

const self = process.argv[1] ? realpathSync(process.argv[1]) : ''
if (self === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exit(main())
  } catch {
    process.exit(3)
  }
}
