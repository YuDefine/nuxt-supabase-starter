#!/usr/bin/env node
/**
 * gh-pr-create-work.ts — `gh pr create` 必須帶 `Work:` 行（W-2026-09-29-pr-orphan-prevention P1）。
 *
 * 為什麼存在：33 張孤兒 PR 抽樣裡 A 類（15%）是 PR body 沒有 `Work:` 行——自動修補（coordinator
 * Rule 8 `pr-repair`）看不到 work id 就不派，主人一消失那張 PR 就只剩人工考古。在開立那一刻要求
 * 一行，比事後每輪由主持者鑄 id 便宜。
 *
 * 兩個入口共用這一份判定：
 *   - fleet：`pre-bash-gh-pr-create-work-gate.sh`（同目錄）以 stdin 餵 hook payload 執行本檔
 *   - clade home：`.claude/hooks/clade-home-guard.ts` import `ghPrCreateWorkViolation`
 *
 * 絆索不是牆：只看 agent 的 Bash tool call；GitHub UI、別的 harness 開的 PR 不受影響。
 * 判不出 body 一律放行（fail-open）：
 *
 *   | 判不出的東西 | 結果 |
 *   | --- | --- |
 *   | body 含 `$` 展開且字面上沒有 `Work:` 行 | 放行 |
 *   | `--body-file -`、`--body-file "$X"`、檔案讀不到 | 放行 |
 *   | `--fill`／`--fill-first`／`--fill-verbose`／`--template`／`--web`（body 來自 commit／模板／瀏覽器）| 放行 |
 *   | stdin 不是 JSON、解析丟例外 | 放行 |
 *
 * 逃生門：`CLADE_ALLOW_NO_WORK=1` 放行（非 clade 工作、上游 repo 的 PR）。
 *
 *   | REQUIRED 欄位 | 內容 |
 *   | --- | --- |
 *   | 觸發條件 | Bash 的 `gh pr create` 判得出 body 且沒有 `Work:` 行 → exit 2 擋下該次 tool call |
 *   | 消費端 | 正在開 PR 的 agent（stderr 印可貼的 `Work:`／`Owner:` 兩行）；下游是 coordinator-pr-triage 的 `pr-repair` 自動派修 |
 *   | 觸發點 | 工具事件 hook：`pre-bash-gh-pr-create-work-gate.sh`（fleet）與 `.claude/hooks/clade-home-guard.ts`（clade home）在 `gh pr create` 那一刻判定；訊息由 test/gh-pr-create-work.test.ts 釘住 |
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WORK_LINE_RE = /^[ \t]*Work(?:[ \t]*id)?[ \t]*[:：][ \t]*\S/mu

const FAIL_OPEN_FLAGS = new Set([
  '--fill',
  '-f',
  '--fill-first',
  '--fill-verbose',
  '--template',
  '-T',
  '--web',
  '-w',
])

/** 指令切段（`&&` `||` `;` `|` 換行），尊重引號；heredoc 本文不切（`$(cat <<EOF … EOF)` 在引號內整段保留）。 */
function segments(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let q: '"' | "'" | null = null
  let depth = 0
  const pending: string[] = []
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (q) {
      if (c === '\\' && q === '"') {
        cur += c + (cmd[++i] ?? '')
        continue
      }
      if (c === q) q = null
      cur += c
      continue
    }
    if (c === "'" || c === '"') q = c
    else if (c === '\\') {
      cur += c + (cmd[++i] ?? '')
      continue
    } else if (cmd.startsWith('<<<', i)) {
      cur += '<<<'
      i += 2
      continue
    } else if (c === '<' && depth === 0) {
      // heredoc 本文是資料不是指令（寫文件、測試檔時常含 gh pr create 範例）：換行後整段跳過
      const hd = /^<<-?\s*(['"]?)([A-Za-z_]\w*)\1/u.exec(cmd.slice(i))
      if (hd) {
        pending.push(hd[2])
        cur += hd[0]
        i += hd[0].length - 1
        continue
      }
    } else if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    if (c === '\n' && depth === 0 && pending.length) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      while (pending.length) {
        const delim = pending.shift()
        while (i + 1 < cmd.length) {
          const nl = cmd.indexOf('\n', i + 1)
          const line = cmd.slice(i + 1, nl === -1 ? cmd.length : nl)
          i = nl === -1 ? cmd.length : nl
          if (line.trim() === delim) break
        }
      }
      continue
    }
    if (depth === 0 && (c === '\n' || c === ';' || c === '|' || c === '&')) {
      if (c === '&' && (cur.endsWith('>') || cmd[i + 1] === '>')) {
        cur += c
        continue
      }
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      if ((c === '&' || c === '|') && cmd[i + 1] === c) i++
      continue
    }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** segment → words（去引號）；回傳每個 word 是否含未加單引號的 `$`（變數／命令替換）。 */
function words(seg: string): { text: string; dynamic: boolean }[] {
  const out: { text: string; dynamic: boolean }[] = []
  let cur = ''
  let has = false
  let dyn = false
  let q: '"' | "'" | null = null
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]
    if (q) {
      if (c === q) q = null
      else if (c === '\\' && q === '"' && i + 1 < seg.length) cur += seg[++i]
      else {
        if (c === '$' && q === '"') dyn = true
        cur += c
      }
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
      if (has || cur) out.push({ text: cur, dynamic: dyn })
      cur = ''
      has = false
      dyn = false
      continue
    }
    if (c === '$') dyn = true
    cur += c
  }
  if (has || cur) out.push({ text: cur, dynamic: dyn })
  return out
}

export type BodySource =
  | { kind: 'text'; text: string; dynamic: boolean }
  | { kind: 'file'; path: string; dynamic: boolean }
  | { kind: 'none' }
  | { kind: 'unknown' }

// 命令位置上會再執行後面命令的 shell 關鍵字與 wrapper（它們的選項形狀各異，不逐一解析）。
const WRAPPERS = new Set([
  'if',
  'then',
  'elif',
  'else',
  'do',
  'while',
  'until',
  '!',
  '{',
  '(',
  'time',
  'exec',
  'nohup',
  'sudo',
  'doas',
  'nice',
  'ionice',
  'timeout',
  'xargs',
  'stdbuf',
  'setsid',
  'builtin',
])

/** 一個 segment 若是 `gh … pr create …`，回傳 body 來源；不是就回 null。 */
export function prCreateBody(seg: string): BodySource | null {
  const w = words(seg)
  // 只認命令位置（容許前置 env/assignment）；參數或 echo 的文字不是 gh 指令。
  let gh = 0
  while (/^[A-Za-z_][A-Za-z_0-9]*=/.test(w[gh]?.text ?? '')) gh++
  if (w[gh]?.text === 'env') {
    gh++
    while (gh < w.length) {
      const arg = w[gh].text
      if (
        /^[A-Za-z_][A-Za-z_0-9]*=/.test(arg) ||
        ['-i', '--ignore-environment', '-0', '--null'].includes(arg) ||
        /^(-u.+|--unset=.+|-C.+|--chdir=.+)$/.test(arg)
      ) {
        gh++
      } else if (['-u', '--unset', '-C', '--chdir'].includes(arg)) {
        gh += 2
      } else if (arg === '--') {
        gh++
        break
      } else {
        break
      }
    }
  }
  if (w[gh]?.text === 'command') {
    gh++
    while (w[gh]?.text === '-p' || w[gh]?.text === '--') gh++
  }
  const isGh = (text: string) => text === 'gh' || text.endsWith('/gh')
  if (!isGh(w[gh]?.text ?? '')) {
    // 命令位置是 shell 關鍵字、wrapper、subshell／group 或 env 不認得的選項：拆不準就退回舊的全段搜尋（寧可多擋）。
    const lead = w[gh]?.text ?? ''
    const opaque =
      WRAPPERS.has(lead) ||
      /^[({!]/.test(lead) ||
      (w[gh - 1]?.text === 'env' && lead.startsWith('-'))
    if (!opaque) return null
    gh = w.findIndex((x, i) => i >= gh && isGh(x.text.replace(/^[({!]+/, '')))
    if (gh === -1) return null
  }
  const pr = w.findIndex((x, i) => i > gh && x.text === 'pr')
  if (pr === -1 || w[pr + 1]?.text !== 'create') return null
  const args = w.slice(pr + 2)
  let body: BodySource = { kind: 'none' }
  for (let i = 0; i < args.length; i++) {
    const a = args[i].text
    const eq = a.indexOf('=')
    const flag = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a
    const inline = a.startsWith('--') && eq > 0
    const val = () => (inline ? { text: a.slice(eq + 1), dynamic: args[i].dynamic } : args[++i])
    if (FAIL_OPEN_FLAGS.has(flag)) return { kind: 'unknown' }
    if (flag === '--body' || flag === '-b') {
      const v = val()
      if (!v) return { kind: 'unknown' }
      body = { kind: 'text', text: v.text, dynamic: v.dynamic }
    } else if (flag === '--body-file' || flag === '-F') {
      const v = val()
      if (!v) return { kind: 'unknown' }
      body = { kind: 'file', path: v.text, dynamic: v.dynamic }
    }
  }
  return body
}

/** 違規時回傳原因字串（給 deny 訊息用），否則 null。 */
export function ghPrCreateWorkViolation(
  cmd: string,
  cwd: string,
  readFile: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): string | null {
  if (!/\bgh\b[\s\S]*\bpr\b[\s\S]*\bcreate\b/u.test(cmd)) return null
  for (const seg of segments(cmd)) {
    const body = prCreateBody(seg)
    if (!body || body.kind === 'unknown') continue
    if (body.kind === 'none') return '沒有 --body／--body-file'
    if (body.kind === 'text') {
      if (WORK_LINE_RE.test(body.text) || body.dynamic) continue
      return '--body 沒有 Work: 行'
    }
    if (body.dynamic || body.path === '-' || !body.path) continue
    let text: string
    try {
      text = readFile(isAbsolute(body.path) ? body.path : resolve(cwd, body.path))
    } catch {
      continue
    }
    if (!WORK_LINE_RE.test(text)) return `--body-file ${body.path} 沒有 Work: 行`
  }
  return null
}

export function denyMessage(why: string, env: NodeJS.ProcessEnv = process.env): string {
  const work = env.CLADE_WORK_ID?.trim() || '<work-id>'
  const owner = env.CLADE_DISPATCH_ID?.trim()
    ? env.CLADE_DISPATCH_ID.trim()
    : env.CLAUDE_SESSION_ID?.trim()
      ? `session:${env.CLAUDE_SESSION_ID.trim()}`
      : '<dispatch_id | session:<id> | bot:<job>>'
  return (
    `⛔ gh pr create：${why}。PR body MUST 帶兩行，讓 PR 從開立那一刻就有機器可讀的主人（主人消失時 triage 才派得了修補）：\n` +
    `  Work: ${work}\n` +
    `  Owner: ${owner}\n` +
    `沒有 work id → 先 node vendor/scripts/flow/flow.ts open <slug> 取得。非 clade 工作的 PR → CLADE_ALLOW_NO_WORK=1 前綴放行。`
  )
}

function main() {
  if (process.env.CLADE_ALLOW_NO_WORK === '1') return
  let input: { tool_input?: { command?: unknown }; cwd?: string } = {}
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return
  }
  const cmd = typeof input.tool_input?.command === 'string' ? input.tool_input.command : ''
  if (!cmd) return
  if (/(^|[\s;&|])CLADE_ALLOW_NO_WORK=1\s/u.test(cmd)) return
  let why: string | null
  try {
    why = ghPrCreateWorkViolation(cmd, input.cwd || process.cwd())
  } catch {
    return
  }
  if (!why) return
  process.stderr.write(`${denyMessage(why)}\n`)
  process.exitCode = 2
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
