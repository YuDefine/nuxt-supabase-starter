#!/usr/bin/env node
/**
 * haiku-implementer 的 Bash 越界判定（PreToolUse，只管 agent_type 是 haiku-implementer 的工具呼叫）。
 *
 * gate 型別：安全型（判不出來倒向擋）。
 * threat model：防漂移——誠實但會亂找答案或自作主張的 Haiku（會 `git fetch` 讀到未來的合入結果、
 *   會違規自 commit）。不防刻意繞過的 agent（例如把 git 包進 node -e）。
 *
 * 擋兩類：
 *   - 讀未來：`git fetch`／`pull`／`ls-remote`／`remote`、git 指令引用遠端 ref（`origin/…`、`refs/remotes/`、
 *     `FETCH_HEAD`、`@{u}`／`@{upstream}`／`@{push}`、`--remotes`、`--all`、`branch -r／-a`）、`git clone`，以及 `gh`／`hub`。
 *     只擋不記：沒讀到東西，Haiku 照常續做，結果由收尾測試判。
 *   - 越權：`git commit`／`push`／`merge`／`rebase`／`cherry-pick`／`revert`／`am`／`update-ref`，建立或刪除 tag，`worktree` 除 `list` 外。
 *     擋下並記違規；SubagentStop 收尾一律判 failed（boundary-violation），照現行升級鏈轉交 sonnet-implementer。
 *
 * 判法：去掉 heredoc 本文、接回續行，依引號切指令段（引號內不切）、`$(…)`／反引號另判，跳過環境指派、shell 關鍵字與
 *   包裝指令後找 git／gh，再看子指令與參數；不解變數展開。
 * 兜底：解析器只是近似 bash，可能跟 bash 不同步（heredoc 本文裡的引號、註解）。解析判 ok 時，再對整段原文
 *   （含 heredoc 本文、引號、註解）掃一次 git／gh 越權或讀遠端的字樣；有就擋（不記違規）。
 *   兜底以邏輯行為單位：git 字樣（容許路徑前綴）之後每個字都當子指令交給同一個 judgeGit 試，不另抄規則。
 *   所以只要 git／gh 字樣寫在指令原文裡（不經變數或編碼，見 threat model），解析失準只會多擋、不會放過；
 *   被誤擋時把字樣拆開或改寫指令即可。
 */

import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type BoundaryVerdict =
  | { kind: 'ok' }
  | { kind: 'read-future'; reason: string }
  | { kind: 'overreach'; reason: string }

const OVERREACH_SUBCOMMANDS = new Set([
  'commit',
  'push',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'am',
  'update-ref',
])
const REMOTE_SUBCOMMANDS = new Set(['fetch', 'pull', 'ls-remote', 'remote', 'clone'])
// git 的全域旗標裡會吃下一個 token 的
const GIT_OPTS_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])
// 裸 remote 名（`origin`、`HEAD..origin`、`origin..HEAD`、`origin~1`、`origin@{1}`、`origin:path`）解析成 refs/remotes/<remote>/HEAD，一樣算遠端
const REMOTE_REF =
  /(?:^|[\s:'"=.^~])(?:origin|upstream)(?:[/:~^@]|\.\.|$)|refs\/remotes\/|FETCH_HEAD|@\{(?:u|upstream|push)\}/i
// `--all` 在多數子指令（log、rev-list、rev-parse、cherry、fsck、bisect…）是「連遠端 ref 一起看」，預設算讀遠端；
// 只放行 `--all` 意思是「工作樹全部檔案」的子指令（commit／stash 等本來就另判越權）
const WORKTREE_ALL_SUBCOMMANDS = new Set(['add', 'stage'])
// shell 重導向 token（`2>`、`>`、`2>&1`、`>out.txt`）：不是 git 參數
const REDIRECT_TOKEN = /^(?:\d*|&)(?:>>?|<)/
// 唯讀的 tag／worktree 用法；其餘（建立、刪除、移動）算越權
const TAG_WRITE_FLAG =
  /^(?:-[adsfmuF]|--delete|--annotate|--sign|--force|--message|--local-user|--file)/
// 這些旗標讓 git tag 進列出模式
const TAG_LIST_FLAG =
  /^(?:-l|--list|-n\d*|-v|--verify|--contains|--no-contains|--points-at|--merged|--no-merged)(?:=|$)/
// 唯讀：沒有任何寫入旗標，且沒有位置參數或在列出模式；其餘一律當建立／刪除
function isReadOnlyTag(args: string[]): boolean {
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!REDIRECT_TOKEN.test(arg)) rest.push(arg)
    // `>` 單獨成 token 時下一個 token 是重導向目標
    else if (/^(?:\d*|&)(?:>>?|<)&?$/.test(arg)) i++
  }
  if (rest.some((arg) => TAG_WRITE_FLAG.test(arg))) return false
  return !rest.some((arg) => !arg.startsWith('-')) || rest.some((arg) => TAG_LIST_FLAG.test(arg))
}
const SHELL_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
  '!',
  '{',
  '}',
])
const WRAPPERS = new Set([
  'env',
  'sudo',
  'command',
  'exec',
  'time',
  'nice',
  'nohup',
  'timeout',
  'xargs',
  'stdbuf',
  'ionice',
])

function commandWord(token: string): string {
  return token.replace(/^.*\//, '')
}

/** 去掉 heredoc 本文、接回行尾反斜線續行：本文是資料不是指令。 */
function stripHeredocs(command: string): string {
  const out: string[] = []
  let terminator: { word: string; dash: boolean } | null = null
  for (const line of command.replace(/\\\n/g, '').split('\n')) {
    if (terminator) {
      if ((terminator.dash ? line.replace(/^\t+/, '') : line) === terminator.word) terminator = null
      continue
    }
    out.push(line)
    // heredoc 本文只在明列的資料消費者（cat、tee、python3、node…，以指令字的 basename 判）且沒經管線送出去時
    // 當資料跳過；其餘（bash、/bin/sh、sudo、ssh、判不出的包裝）一律照指令判（<<< 不是 heredoc）。
    // 當資料跳過的本文仍由原文兜底掃（只擋不記）
    const match = /(?<!<)<<(?!<)(-?)\s*(['"]?)([\w.-]+)\2/.exec(line)
    // `$((1<<2))` 是算術左移，不是 heredoc
    if (match && !/\$\(\([^)]*$/.test(line.slice(0, match.index))) {
      const head =
        line
          .slice(0, match.index)
          .split(/[;&|(]/)
          .pop() ?? ''
      const word = (head.trim().split(/\s+/)[0] ?? '').split('/').pop() ?? ''
      if (
        HEREDOC_DATA_CONSUMERS.has(word) &&
        !line.slice(match.index + match[0].length).includes('|')
      )
        terminator = { word: match[3], dash: match[1] === '-' }
    }
  }
  return out.join('\n')
}

/** heredoc 本文當資料的指令字（basename）；不在這裡的一律把本文當指令判。 */
const HEREDOC_DATA_CONSUMERS = new Set([
  'cat',
  'tee',
  'python',
  'python3',
  'node',
  'jq',
  'awk',
  'sed',
  'grep',
  'rg',
  'wc',
  'head',
  'tail',
  'sort',
  'diff',
])

/** 從 `$(` 的 `(` 之後找對應的 `)`；引號內的括號不算。找不到回 -1。 */
function closeParen(text: string, from: number): number {
  let depth = 1
  let quote: "'" | '"' | null = null
  for (let i = from; i < text.length; i++) {
    const ch = text[i]
    if (quote === "'") {
      if (ch === "'") quote = null
    } else if (ch === '\\') i++
    else if (quote === '"') {
      if (ch === '"') quote = null
    } else if (ch === "'" || ch === '"') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i
  }
  return -1
}

interface Parsed {
  segments: string[][]
  /** 引號、`$(`、反引號沒收尾：判不出就擋 */
  unparseable: boolean
}

/**
 * 依 shell 引號切成指令段：引號內的 ; & | 換行是字面，不切；引號拿掉、內容留在同一個 token。
 * 雙引號內的 \\ 跳脫照 shell 處理；`#` 開頭的註解跳到行尾。
 * `$(…)`（可巢狀）與反引號整段留在 token 裡，內容另外遞迴當指令判。
 */
function parse(command: string): Parsed {
  const text = stripHeredocs(command)
  const result: string[][] = []
  let unparseable = false
  let tokens: string[] = []
  let token = ''
  let hasToken = false
  let quote: "'" | '"' | null = null
  const endToken = () => {
    if (hasToken) tokens.push(token)
    token = ''
    hasToken = false
  }
  const endSegment = () => {
    endToken()
    if (tokens.length) result.push(tokens)
    tokens = []
  }
  const substitution = (i: number): number => {
    // i 指在 `$(` 的 `$` 或反引號上；回傳結尾位置，內容遞迴判
    let close: number
    let inner: string
    if (text[i] === '`') {
      close = text.indexOf('`', i + 1)
      inner = close < 0 ? '' : text.slice(i + 1, close)
    } else {
      close = closeParen(text, i + 2)
      inner = close < 0 ? '' : text.slice(i + 2, close)
    }
    if (close < 0) {
      unparseable = true
      return text.length
    }
    const nested = parse(inner)
    result.push(...nested.segments)
    if (nested.unparseable) unparseable = true
    token += text.slice(i, close + 1)
    hasToken = true
    return close
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote === "'") {
      if (ch === "'") quote = null
      else token += ch
      continue
    }
    if (quote === '"') {
      if (ch === '"') quote = null
      else if (ch === '\\' && i + 1 < text.length) {
        const next = text[i + 1]
        token += '"\\$`\n'.includes(next) ? next : ch + next
        i++
      } else if ((ch === '$' && text[i + 1] === '(') || ch === '`') i = substitution(i)
      else token += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      hasToken = true
    } else if (ch === '\\' && i + 1 < text.length) {
      token += text[++i]
      hasToken = true
    } else if ((ch === '$' && text[i + 1] === '(') || ch === '`') {
      i = substitution(i)
    } else if (ch === '#' && !hasToken) {
      const eol = text.indexOf('\n', i)
      i = eol < 0 ? text.length : eol - 1
    } else if (/[;&|\n()]/.test(ch)) {
      endSegment()
    } else if (/\s/.test(ch)) {
      endToken()
    } else {
      token += ch
      hasToken = true
    }
  }
  if (quote) unparseable = true
  endSegment()
  return { segments: result, unparseable }
}

function gitSubcommandIndex(args: string[]): number {
  let i = 0
  while (i < args.length && args[i].startsWith('-')) {
    i += GIT_OPTS_WITH_ARG.has(args[i]) ? 2 : 1
  }
  return i
}

function judgeGit(args: string[]): BoundaryVerdict {
  const i = gitSubcommandIndex(args)
  const sub = args[i] ?? ''
  const rest = args.slice(i + 1)
  if (OVERREACH_SUBCOMMANDS.has(sub))
    return { kind: 'overreach', reason: `git ${sub}：不准改 git 歷史或推送` }
  if (sub === 'tag' && !isReadOnlyTag(rest))
    return { kind: 'overreach', reason: 'git tag（建立／刪除）：不准改 git 歷史' }
  if (sub === 'worktree' && rest[0] !== 'list')
    return { kind: 'overreach', reason: `git worktree ${rest[0] ?? ''}：不准動 worktree` }
  if (REMOTE_SUBCOMMANDS.has(sub))
    return { kind: 'read-future', reason: `git ${sub}：不准讀遠端（可能讀到未來的合入結果）` }
  if (rest.some((arg) => REMOTE_REF.test(arg)))
    return { kind: 'read-future', reason: `git ${sub} 引用遠端 ref：只准看本機工作樹與 HEAD` }
  if (
    rest.some(
      (arg) =>
        arg === '--remotes' ||
        arg.startsWith('--remotes=') ||
        (arg === '--all' && !WORKTREE_ALL_SUBCOMMANDS.has(sub)),
    )
  )
    return { kind: 'read-future', reason: `git ${sub} --remotes／--all：只准看本機工作樹與 HEAD` }
  if (sub === 'branch' && rest.some((arg) => /^-[a-z]*[ra]/.test(arg)))
    return { kind: 'read-future', reason: 'git branch -r／-a：只准看本機分支' }
  return { kind: 'ok' }
}

/** 跳過環境變數指派、shell 關鍵字與包裝指令（連同包裝的旗標與數值參數），回真正的指令位置。 */
function commandIndex(tokens: string[]): number {
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (/^[A-Za-z_]\w*=/.test(t) || SHELL_KEYWORDS.has(t)) {
      i++
    } else if (WRAPPERS.has(commandWord(t))) {
      // 包裝的旗標與參數形狀太多，不逐一解析：包裝後面任一個 token 是 git／gh 就從那裡判（寧可多擋）
      const inner = tokens.findIndex(
        (token, j) =>
          j > i && ['git', 'gh', 'hub', 'npm', 'pnpm', 'yarn'].includes(commandWord(token)),
      )
      return inner >= 0 ? inner : tokens.length
    } else {
      break
    }
  }
  return i
}

/**
 * 原文兜底：不管在引號、註解或 heredoc 本文裡，邏輯行上出現 git 字樣（容許路徑前綴與引號）就把它後面每個字
 * 都當子指令試一次 judgeGit——跟解析共用同一套規則，不另抄一份；出現 gh／hub 後面接參數也算。
 */
function tokensMentionRisk(tokens: string[], wholeLine = false): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const base = tokens[i].split('/').pop()
    if ((base === 'gh' || base === 'hub') && i + 1 < tokens.length) return true
    if (base !== 'git') continue
    for (let j = i + 1; j < tokens.length; j++) {
      // 整行試時 tag／worktree 的位置參數可能是後面別段的字（`git tag | tail -5`），交給逐段試判
      if (wholeLine && (tokens[j] === 'tag' || tokens[j] === 'worktree')) continue
      if (judgeGit(tokens.slice(j)).kind !== 'ok') return true
    }
  }
  return false
}

function rawMentionsRisk(command: string): boolean {
  // 重導向（`2>/dev/null`、`> out`、`2>&1`）連同目標先拿掉：目標不是 git 參數，留著會被當成 tag 名
  const words = (text: string) =>
    text
      .replace(/(?:\d*|&)(?:>>?|<(?!<))&?\s*[^\s;&|()<>]*/g, ' ')
      .split(/[\s;&|()`'"<>]+/)
      .filter(Boolean)
  for (const line of command.replace(/\\\n/g, '').split('\n')) {
    // 整行試一次（引號失準時 ; 可能在引號裡），再逐段試一次（後面別段的 -l、list 不能替前面的 tag／worktree 擔保）
    if (tokensMentionRisk(words(line), true)) return true
    if (line.split(/[;&|()`#]/).some((part) => tokensMentionRisk(words(part)))) return true
  }
  return false
}

/** `npm [旗標…] version <newversion>` 且沒關掉 git tag：會 commit 並打 tag。 */
function packageVersionBumps(args: string[]): boolean {
  let j = 0
  // 子指令前的全域旗標（`--prefix pkg`、`-C dir`、`--filter x`）：吃參數的連下一個一起跳
  while (j < args.length && args[j].startsWith('-'))
    j +=
      /^--?[\w-]+$/.test(args[j]) &&
      j + 1 < args.length &&
      !args[j + 1].startsWith('-') &&
      args[j + 1] !== 'version'
        ? 2
        : 1
  if (args[j] !== 'version') return false
  const rest = args.slice(j + 1)
  const off = rest.some(
    (t, k) =>
      t === '--no-git-tag-version' ||
      t === '--git-tag-version=false' ||
      (t === '--git-tag-version' && rest[k + 1] === 'false'),
  )
  const positional = rest.filter(
    (t, k) => !t.startsWith('-') && !(k > 0 && rest[k - 1] === '--git-tag-version'),
  )
  return !off && positional.length > 0
}

export function judgeBashCommand(command: string): BoundaryVerdict {
  let readFuture: BoundaryVerdict | null = null
  const parsed = parse(command)
  for (const tokens of parsed.segments) {
    const i = commandIndex(tokens)
    const word = commandWord(tokens[i] ?? '')
    let verdict: BoundaryVerdict = { kind: 'ok' }
    if (word === 'git') verdict = judgeGit(tokens.slice(i + 1))
    // `npm version <newversion>` 等預設會 commit 並打 tag；不帶位置參數只印版本，不算
    else if (
      (word === 'npm' || word === 'pnpm' || word === 'yarn') &&
      packageVersionBumps(tokens.slice(i + 1))
    )
      verdict = {
        kind: 'overreach',
        reason: `${word} version：預設會 commit 並打 tag，不准改 git 歷史（要改版號加 --no-git-tag-version）`,
      }
    else if (word === 'gh' || word === 'hub')
      verdict = {
        kind: 'read-future',
        reason: `${word}：不准查 GitHub（PR／合入結果就是答案）`,
      }
    if (verdict.kind === 'overreach') return verdict
    if (verdict.kind === 'read-future' && !readFuture) readFuture = verdict
  }
  if (parsed.unparseable)
    return {
      kind: 'read-future',
      reason: '指令的引號、$( 或反引號沒收尾，判不出就擋：改寫成引號成對的指令',
    }
  if (readFuture) return readFuture
  if (rawMentionsRisk(command))
    return {
      kind: 'read-future',
      reason:
        '指令原文（含引號、註解、heredoc 本文）出現 git 越權／讀遠端或 gh 的字樣，解析判不準就擋：' +
        '把這類字樣移出指令，或拆成單純的指令再跑',
    }
  return { kind: 'ok' }
}

export function isHaikuImplementer(agentType: unknown): boolean {
  return typeof agentType === 'string' && /^(?:[\w-]+:)?haiku-implementer$/.test(agentType)
}

function stateRoot(): string {
  const cacheRoot = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  return (
    process.env.CLADE_HAIKU_GATE_STATE_DIR || join(cacheRoot, 'clade', 'haiku-implementer-gate')
  )
}

function safeSegment(value: string): string {
  return value.replace(/[^\w.-]/g, '_')
}

// 收尾 gate（haiku-implementer-test-gate.ts 的 readViolation）照同一路徑讀，改這裡要一起改
export function violationPath(sessionId: string, agentId: string): string {
  return join(stateRoot(), 'violations', `${safeSegment(sessionId)}__${safeSegment(agentId)}.json`)
}

function recordViolation(
  sessionId: string,
  agentId: string,
  reason: string,
  command: string,
): void {
  const path = violationPath(sessionId, agentId)
  mkdirSync(join(stateRoot(), 'violations'), { recursive: true, mode: 0o700 })
  let previous: { reasons?: string[]; commands?: string[] } = {}
  try {
    previous = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // 第一筆
  }
  const record = {
    session_id: sessionId,
    agent_id: agentId,
    reasons: [...(previous.reasons ?? []), reason],
    commands: [...(previous.commands ?? []), command.slice(0, 500)],
  }
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}

type Payload = Record<string, unknown>

export function preToolBoundary(payload: Payload): { status: number; stderr: string } {
  if (!payload.agent_id || !isHaikuImplementer(payload.agent_type)) return { status: 0, stderr: '' }
  if (payload.tool_name !== 'Bash') return { status: 0, stderr: '' }
  const toolInput = (payload.tool_input ?? {}) as Payload
  const command = typeof toolInput.command === 'string' ? toolInput.command : ''
  const verdict = judgeBashCommand(command)
  if (verdict.kind === 'ok') return { status: 0, stderr: '' }
  if (verdict.kind === 'read-future')
    return {
      status: 2,
      stderr:
        `⛔ haiku-implementer 越界（讀未來）：${verdict.reason}。` +
        '只用本機工作樹、HEAD 與 brief 給的內容做；查不到要的資訊就回 NEEDS_CONTEXT。\n',
    }
  recordViolation(
    String(payload.session_id ?? ''),
    String(payload.agent_id),
    verdict.reason,
    command,
  )
  return {
    status: 2,
    stderr:
      `⛔ haiku-implementer 越權：${verdict.reason}。已記違規，本次收尾會判 failed、轉交 sonnet-implementer。` +
      '現在直接結束：最終輸出第一行 MUST 是 `FAILED`，NEVER 再試別的寫法。\n',
  }
}

function main(): number {
  let payload: Payload
  try {
    payload = JSON.parse(readFileSync(0, 'utf8')) as Payload
  } catch {
    process.stderr.write('haiku-implementer-boundary：stdin 不是 JSON，判不出就擋。\n')
    return 2
  }
  const result = preToolBoundary(payload)
  if (result.stderr) process.stderr.write(result.stderr)
  return result.status
}

if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  try {
    process.exitCode = main()
  } catch (error) {
    process.stderr.write(`haiku-implementer-boundary 判定丟例外：${String(error)}，判不出就擋。\n`)
    process.exitCode = 2
  }
}
