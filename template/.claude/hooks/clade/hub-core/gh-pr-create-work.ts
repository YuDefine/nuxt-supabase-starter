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
 *   | body 含 `$` 展開且字面上沒有 `Work:` 行（`$(cat <<'EOF' … EOF)` 本文看得到，照字面判，不算判不出） | 放行 |
 *   | `--body-file -`、`--body-file "$X"`、檔案讀不到 | 放行 |
 *   | `--fill`／`--fill-first`／`--fill-verbose`／`--template`／`--web`（body 來自 commit／模板／瀏覽器）| 放行 |
 *   | stdin 不是 JSON、解析丟例外 | 放行 |
 *
 * 缺 `Work:` 行時先推導 work id（`deriveWorkId`：`CLADE_WORK_ID` → 本樹的 claim → branch 改到的唯一一份
 * plan.md frontmatter）。推得出且 body 來自看得到的 `--body-file` 檔（一般檔、realpath 在 cwd 或系統 tmpdir 底下、
 * 指令沒有 `cd`／`pushd`／`env -C`／`--chdir`、id 是單純 token）→ 直接把 `Work:` 行補進檔案、放行；
 * 其餘（`--body` 字面、heredoc）擋下並把推出的那一行印成可貼的改法；推不出就擋並印取得 work id 的指令
 * heredoc 照字面判，缺行就擋，NEVER 當成判不出放行（放行出去的 PR 沒有主人、修補件派不出去）。
 *
 * 逃生門：`CLADE_ALLOW_NO_WORK=1` 放行（非 clade 工作、上游 repo 的 PR）。
 *
 * `Work:` 行通過後接著判 PR 去重與大小上限（`gh-pr-create-hygiene.ts`）。
 *
 *   | REQUIRED 欄位 | 內容 |
 *   | --- | --- |
 *   | 觸發條件 | Bash 的 `gh pr create` 判得出 body 且沒有 `Work:` 行 → exit 2 擋下該次 tool call |
 *   | 消費端 | 正在開 PR 的 agent（stderr 印可貼的 `Work:`／`Owner:` 兩行）；下游是 coordinator-pr-triage 的 `pr-repair` 自動派修 |
 *   | 觸發點 | 工具事件 hook：`pre-bash-gh-pr-create-work-gate.sh`（fleet）與 `.claude/hooks/clade-home-guard.ts`（clade home）在 `gh pr create` 那一刻判定；訊息由 test/gh-pr-create-work.test.ts 釘住 |
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ghPrCreateHygiene, type HygieneDeps, type PrCreateTarget } from './gh-pr-create-hygiene.ts'

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
export function segments(cmd: string): string[] {
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
export function words(seg: string): { text: string; dynamic: boolean }[] {
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
export const WRAPPERS = new Set([
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

/**
 * `$(cat <<'EOF' … EOF)` 命令替換：heredoc 本文就在指令字面上，照字面判。分隔字加引號（本文不展開），
 * 或本文沒有 `$`，才算看得到；其餘展開仍判不出。
 */
export function literalHeredocBody(text: string): string | null {
  const m =
    /^\$\(\s*cat\s+<<-?\s*(['"]?)([A-Za-z_]\w*)\1[ \t]*\n([\s\S]*?)\n[ \t]*\2[ \t]*\n?\s*\)$/u.exec(
      text.trim(),
    )
  if (!m) return null
  return m[1] || !m[3]!.includes('$') ? m[3]! : null
}

export interface WorkProblem {
  why: string
  /** body 來自這個看得到的檔（絕對路徑）：推得出 work id 時可以直接補行。 */
  file?: string
}

/** 違規時回傳原因與 body 檔（給 deny 訊息與自動補行用），否則 null。 */
export function ghPrCreateWorkProblem(
  cmd: string,
  cwd: string,
  readFile: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): WorkProblem | null {
  if (!/\bgh\b[\s\S]*\bpr\b[\s\S]*\bcreate\b/u.test(cmd)) return null
  for (const seg of segments(cmd)) {
    const body = prCreateBody(seg)
    if (!body || body.kind === 'unknown') continue
    if (body.kind === 'none') return { why: '沒有 --body／--body-file' }
    if (body.kind === 'text') {
      if (WORK_LINE_RE.test(body.text)) continue
      if (body.dynamic && literalHeredocBody(body.text) === null) continue
      return { why: body.dynamic ? '--body 的 heredoc 沒有 Work: 行' : '--body 沒有 Work: 行' }
    }
    if (body.dynamic || body.path === '-' || !body.path) continue
    const file = isAbsolute(body.path) ? body.path : resolve(cwd, body.path)
    let text: string
    try {
      text = readFile(file)
    } catch {
      continue
    }
    if (!WORK_LINE_RE.test(text)) return { why: `--body-file ${body.path} 沒有 Work: 行`, file }
  }
  return null
}

/** `gh pr create` 看得到的 body 全文（去重／大小判定用）；判不出（動態展開、`-`、讀不到、沒有 gh pr create）回 null。 */
export function prCreateBodyText(
  cmd: string,
  cwd: string,
  readFile: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): string | null {
  for (const seg of segments(cmd)) {
    const body = prCreateBody(seg)
    if (!body) continue
    if (body.kind === 'text') return body.dynamic ? literalHeredocBody(body.text) : body.text
    if (body.kind !== 'file' || body.dynamic || body.path === '-' || !body.path) return null
    try {
      return readFile(isAbsolute(body.path) ? body.path : resolve(cwd, body.path))
    } catch {
      return null
    }
  }
  return null
}

const TARGET_FLAGS: Record<string, keyof Omit<PrCreateTarget, 'opaque'>> = {
  '--base': 'base',
  '-B': 'base',
  '--head': 'head',
  '-H': 'head',
  '--repo': 'repo',
  '-R': 'repo',
}

/** 指令裡 `gh pr create` 的 `--base`／`--head`／`--repo`（去重與大小判定要量的那一組）；值是動態展開或缺值 → `opaque`。 */
export function prCreateTarget(cmd: string): PrCreateTarget {
  const target: PrCreateTarget = {}
  for (const seg of segments(cmd)) {
    if (!prCreateBody(seg)) continue
    const w = words(seg)
    const pr = w.findIndex((x, i) => x.text === 'pr' && w[i + 1]?.text === 'create')
    const args = w.slice(pr + 2)
    for (let i = 0; i < args.length; i++) {
      const a = args[i].text
      const eq = a.indexOf('=')
      let flag = a
      let val: { text: string; dynamic: boolean } | undefined
      if (a.startsWith('--') && eq > 0) {
        flag = a.slice(0, eq)
        val = { text: a.slice(eq + 1), dynamic: args[i].dynamic }
      } else if (/^-[BHR]./u.test(a)) {
        // 短旗標黏值：`-Rowner/repo`、`-Bmain`
        flag = a.slice(0, 2)
        val = { text: a.slice(2), dynamic: args[i].dynamic }
      }
      const key = TARGET_FLAGS[flag]
      if (!key) continue
      val ??= args[++i]
      if (!val || val.dynamic || !val.text) target.opaque = true
      else target[key] = val.text
    }
  }
  return target
}

/** 違規時回傳原因字串（給 deny 訊息用），否則 null。 */
export function ghPrCreateWorkViolation(
  cmd: string,
  cwd: string,
  readFile: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): string | null {
  return ghPrCreateWorkProblem(cmd, cwd, readFile)?.why ?? null
}

export interface DerivedWork {
  id: string
  /** 從哪裡推出來的（印給 agent 看）。 */
  basis: string
}

export interface DeriveDeps {
  git?: (args: string[], cwd: string) => string | null
  readFile?: (path: string) => string
  readDir?: (path: string) => string[]
}

/** hook 上限 10s、超時視為非阻擋（fail-open）：推導最多 3 次 git 呼叫，合計須遠小於上限，逾時一律當推不出而擋下。 */
export const GIT_TIMEOUT_MS = 2_000

const defaultGit = (args: string[], cwd: string): string | null => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS })
  return r.status === 0 ? r.stdout : null
}

const PLAN_PATH_RE = /^specs\/plans\/[^/]+\/plan\.md$/u

/**
 * 缺 `Work:` 行時推 work id：`CLADE_WORK_ID` → 本樹的 claim（`<repo>/.clade/claims/*.json` 的 worktree_path）→
 * branch 相對預設分支改到的 plan.md，frontmatter `work_id` 只有一個時採用。推不出（或 plan 有多個）回 null，
 * NEVER 另鑄——鑄出來的 id 對不到任何 plan，等於沒有主人。
 */
export function deriveWorkId(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  deps: DeriveDeps = {},
): DerivedWork | null {
  const fromEnv = env.CLADE_WORK_ID?.trim()
  if (fromEnv) return { id: fromEnv, basis: 'CLADE_WORK_ID' }
  const git = deps.git ?? defaultGit
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, 'utf8'))
  const readDir = deps.readDir ?? ((p: string) => readdirSync(p))
  try {
    const [commonDir, top] = (
      git(['rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel'], cwd) ?? ''
    )
      .trim()
      .split('\n')
    if (!commonDir || !top) return null
    const claims = join(dirname(commonDir), '.clade', 'claims')
    let names: string[] = []
    try {
      names = readDir(claims).filter((n) => n.endsWith('.json'))
    } catch {
      /* 沒有 claim 目錄：往下推 plan */
    }
    for (const n of names) {
      try {
        const c = JSON.parse(readFile(join(claims, n))) as {
          worktree_path?: unknown
          work_id?: unknown
        }
        if (c.worktree_path === top && typeof c.work_id === 'string' && c.work_id.trim())
          return { id: c.work_id.trim(), basis: `claim ${n}` }
      } catch {
        /* 壞的 claim 不算 */
      }
    }
    const base =
      (git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], top) ?? '').trim() ||
      'origin/main'
    const changed = (git(['diff', '--name-only', '-z', `${base}...HEAD`], top) ?? '')
      .split('\0')
      .filter((f) => PLAN_PATH_RE.test(f))
    const ids = new Set<string>()
    for (const f of changed) {
      try {
        const id = /^work_id:[ \t]*["']?([^\s"']+)/mu.exec(readFile(join(top, f)))?.[1]
        if (id && id !== '-') ids.add(id)
      } catch {
        /* 刪掉的 plan 不算 */
      }
    }
    if (ids.size === 1)
      return { id: [...ids][0]!, basis: `branch 改到的 plan（${changed.join('、')}）` }
  } catch {
    /* 推不出就照拒建 */
  }
  return null
}

/**
 * 兩個入口（fleet hook、clade-home-guard）共用的一次判定：沒違規 → `{}`；body 檔缺行且推得出 → 補進檔案、
 * 回 `note`；其餘回 `deny`（推得出時訊息帶推出的那一行）。
 */
export function ghPrCreateWorkGate(
  cmd: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  /** `hygiene: false` 關掉去重／大小判定（只判 Work 行）；預設跑真的 git／gh。 */
  deps: DeriveDeps & {
    append?: (path: string, text: string) => void
    hygiene?: HygieneDeps | false
  } = {},
): { deny?: string; note?: string } {
  // Work 行通過（或剛補上）之後才判去重與大小（gh-pr-create-hygiene.ts）
  const hygiene = (verdict: { note?: string }): { deny?: string; note?: string } => {
    if (deps.hygiene === false || !/\bgh\b[\s\S]*\bpr\b[\s\S]*\bcreate\b/u.test(cmd)) return verdict
    const body = prCreateBodyText(cmd, cwd, deps.readFile)
    if (body === null) return verdict
    let deny: string | null = null
    try {
      deny = ghPrCreateHygiene(body, cwd, deps.hygiene, prCreateTarget(cmd))
    } catch {
      /* 判不出就放行 */
    }
    return deny ? { ...verdict, deny } : verdict
  }
  const problem = ghPrCreateWorkProblem(cmd, cwd, deps.readFile)
  if (!problem) return hygiene({})
  const derived = deriveWorkId(cwd, env, deps)
  if (derived && problem.file && appendableBodyFile(cmd, cwd, problem.file, derived.id)) {
    try {
      ;(deps.append ?? appendFileSync)(problem.file, `\nWork: ${derived.id}\n`)
      return hygiene({
        note: `ℹ gh pr create：${problem.why}，已依 ${derived.basis} 補上 \`Work: ${derived.id}\``,
      })
    } catch {
      /* 寫不進去：照擋，訊息帶推出的那一行 */
    }
  }
  return { deny: denyMessage(problem.why, env, derived) }
}

const WORK_ID_RE = /^[A-Za-z0-9._-]+$/u
/** 會讓相對路徑對不到的目錄轉向：`cd`、`pushd`、`env -C <dir>`／`--chdir`。 */
const REDIRECTS_CWD_RE = /(^|[;&|(\s])(cd|pushd)\s|(^|\s)(-C|--chdir)([\s=]|$)/u

/**
 * hook 跑在指令（與權限確認）之前，補行等於替 agent 先寫檔：只在範圍收得住時才寫——
 * id 是單純 token、指令裡沒有 `cd`（否則相對路徑對不到）、body 檔是一般檔（不追 symlink），
 * realpath 落在 cwd 底下或系統 tmpdir 底下。其餘一律改成拒建並印要補的那一行。
 */
function appendableBodyFile(cmd: string, cwd: string, file: string, id: string): boolean {
  if (!WORK_ID_RE.test(id) || REDIRECTS_CWD_RE.test(cmd)) return false
  try {
    if (!lstatSync(file).isFile()) return false
    const real = realpathSync(file)
    return [cwd, tmpdir()].some((root) => {
      const r = realpathSync(root)
      return real.startsWith(r.endsWith(sep) ? r : r + sep)
    })
  } catch {
    return false
  }
}

export function denyMessage(
  why: string,
  env: NodeJS.ProcessEnv = process.env,
  derived: DerivedWork | null = null,
): string {
  const work = derived?.id || env.CLADE_WORK_ID?.trim() || '<work-id>'
  const owner = env.CLADE_DISPATCH_ID?.trim()
    ? env.CLADE_DISPATCH_ID.trim()
    : env.CLAUDE_SESSION_ID?.trim()
      ? `session:${env.CLAUDE_SESSION_ID.trim()}`
      : '<dispatch_id | session:<id> | bot:<job>>'
  return (
    `⛔ gh pr create：${why}。PR body MUST 帶兩行，讓 PR 從開立那一刻就有機器可讀的主人（主人消失時 triage 才派得了修補）：\n` +
    `  Work: ${work}\n` +
    `  Owner: ${owner}\n` +
    (derived
      ? `Work id 依 ${derived.basis} 推得；把上面兩行加進 body 末尾後重跑。`
      : `推不出 work id（沒有 CLADE_WORK_ID、本樹沒有 claim、branch 沒改到唯一一份 plan.md）。`) +
    `沒有 work id → 先 node vendor/scripts/flow/flow.ts work open <slug> 取得。非 clade 工作的 PR → CLADE_ALLOW_NO_WORK=1 前綴放行。`
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
  let verdict: { deny?: string; note?: string }
  try {
    verdict = ghPrCreateWorkGate(cmd, input.cwd || process.cwd())
  } catch {
    return
  }
  if (verdict.note) process.stderr.write(`${verdict.note}\n`)
  if (!verdict.deny) return
  process.stderr.write(`${verdict.deny}\n`)
  process.exitCode = 2
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
