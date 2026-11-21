#!/usr/bin/env node
/**
 * PreToolUse:Bash｜Monitor hook — Review Bridge 代簽守門：`review-bridge start|resume … --yes` 只在已有席位代簽紀錄時放行（exit 2 擋）。
 *
 * 為什麼：Bridge 設計允許 agent 帶 `--yes` 轉達人的 yes（`router/guards/nativeGate.mjs:1-8`），不驗證人真的說過；擋 agent
 * 自作主張歸我們自己的工具。Charles 要 Bridge 卡片由主持者或主管主動放行；規格在 yudefine-hq
 * `tasks/2026-11-08-bridge-主動整合.md` § 顧問計畫 W4 與 § Q1。
 *
 * 規則（`start`、`resume` 都算；`stop`、`status` 等其他子命令與不帶 `--yes`／`-y` 的呼叫不管——例外：指令含 review-bridge
 *   字樣又帶看不懂的語法類別時不解析，不論子命令與 --yes 都擋，含檔名帶 review-bridge 的 glob、`$`，見 parse 檔）：
 *   放行條件 = proxy-answers.jsonl 有一筆
 *     1. `at` 在 24 小時內（不接受超過 5 分鐘的未來時間）；
 *     2. `plan_sha256` 等於指令帶的 `BRIDGE_PLAN_SHA256=<卡片上的 plan sha256>`（指令沒帶就擋：判不出是哪張工單）；
 *     3. 簽的人是主持者席或 HQ 主管常駐席：`signer_session` 對到現役主持者（holders 裡 pid 還活著、proc_start 對得上、
 *        不是 `--interim` 暫代、`--headless` 子 watch 或非 fleet 的 `--backlog` 並存線；墓碑未 retired、heartbeat 在 10 分鐘內、同樣排除這些）
 *        或 HQ 席位狀態檔（resident.json、dialogue.json、agents.json 的 team=resident）的 session。只認 session：
 *        Herdr pane id 重開機後會被不相干的 session 重用，pane 對上不算；
 *     4. 簽的人不是正在執行這條指令的 session（`signer_session` ≠ 本 session、`signer_pane` ≠ 本 pane）。
 *   worker（含 HQ 派出的直轄 worker）自己記的紀錄對不到席位，不算；席位也不能自簽自跑。
 *
 * 生效工具：Bash 與 Monitor（兩者都從 `tool_input.command` 跑 shell；machine-safety-gate.ts 的 matcher）。
 *
 * 型別：安全型 gate，threat model 是防漂移（絆索不是牆）：誠實但健忘的 agent 順手帶 `--yes`。不防主動偽造——
 * 紀錄是純文字，存心的 agent 可以抄席位的 session id。Bridge 的卡片 sha 由 Bridge 自己綁授權；本 hook 只比
 * 「指令宣稱的 sha」與紀錄，不重算 plan。
 *
 * 指令解析（哪些寫法算簽核嘗試、看不懂的語法整類擋、解析層繞行場景與不承諾項）在同目錄的
 * `pre-bash-review-bridge-sign-gate.parse.ts` 檔頭；本檔只判「簽核嘗試有沒有對得上的席位代簽紀錄」。
 *
 * 繞行場景（紀錄層）：
 *   | 繞法 | 預期攔截點 |
 *   | worker 自己補一筆 signer_session＝自己的紀錄 | 擋：自己不是席位 |
 *   | 席位補紀錄後自己跑 | 擋：簽的人＝執行者 |
 *   | 抄一份舊紀錄改 sha、或 24 小時前的紀錄 | 擋：sha 不符／過期 |
 *   | 授權由受檢對象自證：worker 抄席位的 session id 冒名寫紀錄 | 不承諾（紀錄是純文字）；追責靠 Bridge 授權紀錄與 proxy-answers 對帳 |
 *   | 指令宣稱的 sha 與 Bridge 實際收的卡不同 | 不承諾（hook 看不到卡）；同上對帳 |
 *
 * 判不出來的分支（倒向擋，只在命中 start|resume＋--yes 時才走到）：
 *   | 分支 | 處置 |
 *   | stdin 非 JSON、沒有 command | 原文含 review-bridge 與 --yes／-y 就擋，否則放行 |
 *   | proxy-answers.jsonl 讀不到 | 擋（印路徑） |
 *   | 席位狀態檔全讀不到 | 擋（沒有任何席位可對） |
 *   | 席位在別台機器（席位狀態、proxy-answers 只讀本機） | 擋；在席位狀態所在的機器跑，或不帶 --yes 交席位跑 |
 *   | 單列 JSON 壞掉 | 跳過該列 |
 *
 * 路徑覆寫（測試用）：`BRIDGE_SIGN_PROXY_ANSWERS`、`HQ_STATE_DIR`、`COORDINATOR_STATE_DIR`、`XDG_CACHE_HOME`、`HQ_REPO`。
 * 外殼：`pre-bash-review-bridge-sign-gate.sh` 做快篩（不付 node 啟動成本）與 node 故障時的保守擋法，再呼叫本檔。
 * 生效範圍：vendor/scripts/lib/machine-safety-gate.ts（MACHINE_SAFETY_GATES）由 `dev-node.ts self-heal` 把外殼、本檔與 parse 檔
 * 複製到 `~/.claude/hooks/clade-machine-safety/` 的 user scope——Bridge 在 yudefine-hq 與各 consumer 跑，不只 clade。
 * 本檔只用 node 內建模組與同目錄的 parse 檔，NEVER import repo 內其他檔：user scope 只複製外殼、本檔與 parse 檔。
 */

import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type BridgeCall, SHA_ENV, signAttempt } from './pre-bash-review-bridge-sign-gate.parse.ts'

export const SIGN_TTL_MS = 24 * 60 * 60_000
const FUTURE_SKEW_MS = 5 * 60_000

export interface Seats {
  /** 席位 session id → 席位名稱。只認 session，不認 pane（pane id 會被重用）。 */
  sessions: Map<string, string>
  sources: number
}

/** holder 的 pid 還活著（EPERM 也算活著）；讀不到 pid 算不活。 */
function pidAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** `/proc/<pid>/stat` 的開機後啟動時間（同 vendor/scripts/lib/coordinator-lease.ts processStartToken）；讀不到回 null。 */
function procStartToken(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const close = stat.lastIndexOf(')')
    return close >= 0
      ? (stat
          .slice(close + 2)
          .trim()
          .split(/\s+/)[19] ?? null)
      : null
  } catch {
    return null
  }
}

/**
 * 主持者 watch 登記算不算現役席位（同 vendor/scripts/lib/coordinator-holder.ts holderAlive＋isSeatedCoordinator）：
 * `--interim` 暫代、`--headless` daemon 子 watch、`--backlog` 不是 fleet 的並存線與專責 watch 都不是主持者；
 * 有 proc_start 時要和現在那個 pid 的啟動時間一致（重開機後 pid 被重用的殘留不算）。
 */
function seatScope(raw: unknown): boolean {
  const scope = Array.isArray(raw) ? (raw as unknown[]) : []
  if (scope.includes('--interim') || scope.includes('--headless')) return false
  const backlog = scope.find((f) => typeof f === 'string' && f.startsWith('--backlog '))
  return backlog === undefined || backlog === '--backlog fleet'
}

function holderSeated(h: { pid?: unknown; proc_start?: unknown; scope?: unknown }): boolean {
  if (!seatScope(h.scope)) return false
  if (!pidAlive(h.pid)) return false
  if (typeof h.proc_start !== 'string') return true
  return procStartToken(h.pid as number) === h.proc_start
}

/** 墓碑只撐 watch 重掛的空窗（同 coordinator-holder.ts WATCH_REREGISTER_GRACE_MS）：heartbeat 過期是 crash 或已退成一般主線。 */
const TOMBSTONE_GRACE_MS = 10 * 60_000

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export interface GateEnv {
  proxyFile: string
  hqStateDir: string
  coordinatorStateDir: string
}

export function gateEnv(env: NodeJS.ProcessEnv = process.env): GateEnv {
  const home = env.HOME || homedir()
  const hqRepo = env.HQ_REPO?.trim() || join(home, 'offline', 'yudefine-hq')
  return {
    proxyFile:
      env.BRIDGE_SIGN_PROXY_ANSWERS?.trim() || join(hqRepo, 'state', 'proxy-answers.jsonl'),
    hqStateDir: env.HQ_STATE_DIR?.trim() || join(home, '.local', 'state', 'yudefine-hq'),
    coordinatorStateDir:
      env.COORDINATOR_STATE_DIR?.trim() ||
      join(env.XDG_CACHE_HOME?.trim() || join(home, '.cache'), 'clade', 'coordinator'),
  }
}

/** 現役主持者席（holders 裡 pid 活著的、墓碑未 retired）與 HQ 主管常駐席（resident.json、dialogue.json、agents.json team=resident）的 session。 */
export function readSeats(g: GateEnv, now: number = Date.now()): Seats {
  const seats: Seats = { sessions: new Map(), sources: 0 }
  const add = (label: string, session: unknown) => {
    if (typeof session === 'string' && session.trim()) seats.sessions.set(session.trim(), label)
  }
  const holders = join(g.coordinatorStateDir, 'holders')
  try {
    for (const n of readdirSync(holders).filter((name) => name.endsWith('.json'))) {
      try {
        const h = readJson(join(holders, n)) as {
          session_id?: unknown
          pid?: unknown
          proc_start?: unknown
          scope?: unknown
        }
        seats.sources++
        if (holderSeated(h)) add('主持者席', h.session_id)
      } catch {}
    }
  } catch {}
  try {
    const t = readJson(join(g.coordinatorStateDir, 'coordinator-last.json')) as {
      session_id?: unknown
      retired?: unknown
      scope?: unknown
      heartbeat_at?: unknown
    }
    seats.sources++
    const age = typeof t.heartbeat_at === 'string' ? now - Date.parse(t.heartbeat_at) : Number.NaN
    if (t.retired !== true && seatScope(t.scope) && age >= 0 && age <= TOMBSTONE_GRACE_MS)
      add('主持者席', t.session_id)
  } catch {}
  for (const kind of ['resident', 'dialogue']) {
    try {
      const s = readJson(join(g.hqStateDir, `${kind}.json`)) as { session?: unknown }
      add(`HQ 主管席（${kind}）`, s.session)
      seats.sources++
    } catch {}
  }
  try {
    const rows = readJson(join(g.hqStateDir, 'agents.json'))
    if (Array.isArray(rows))
      for (const r of rows as { team?: unknown; session?: unknown }[])
        if (r?.team === 'resident') {
          add('HQ 主管席（resident）', r.session)
          seats.sources++
        }
  } catch {}
  return seats
}

export interface ProxyRow {
  at?: unknown
  plan_sha256?: unknown
  signer_session?: unknown
  signer_pane?: unknown
  span_id?: unknown
}

export type Verdict = { allow: true; reason: string } | { allow: false; reason: string }

/** 單一 start|resume＋--yes 呼叫的判定。`rows` 為 proxy-answers 解析後的列（壞列已略過）。 */
export function judge(
  call: BridgeCall,
  rows: readonly ProxyRow[],
  seats: Seats,
  self: { session: string | null; pane: string | null },
  nowMs: number,
): Verdict {
  if (!call.sha || !/^[0-9a-f]{64}$/.test(call.sha))
    return {
      allow: false,
      reason: `指令沒帶 ${SHA_ENV}=<卡片上的 plan sha256>（64 位 hex），判不出要對哪張工單的代簽紀錄`,
    }
  if (seats.sources === 0)
    return {
      allow: false,
      reason:
        '讀不到任何席位狀態檔（主持者 holders／墓碑、HQ resident／dialogue／agents），無法確認簽的人',
    }
  const misses: string[] = []
  for (const r of rows) {
    if (typeof r.plan_sha256 !== 'string' || r.plan_sha256.trim().toLowerCase() !== call.sha)
      continue
    const at = typeof r.at === 'string' ? Date.parse(r.at) : Number.NaN
    const id = typeof r.span_id === 'string' ? r.span_id : '(無 span_id)'
    if (!Number.isFinite(at) || at > nowMs + FUTURE_SKEW_MS || nowMs - at > SIGN_TTL_MS) {
      misses.push(`${id}：at 不在 24 小時內`)
      continue
    }
    const ss = typeof r.signer_session === 'string' ? r.signer_session.trim() : ''
    const sp = typeof r.signer_pane === 'string' ? r.signer_pane.trim() : ''
    const seat = (ss && seats.sessions.get(ss)) || null
    if (!seat) {
      misses.push(`${id}：簽的人（signer_session）不是現役主持者席或 HQ 主管常駐席`)
      continue
    }
    if ((ss && self.session && ss === self.session) || (sp && self.pane && sp === self.pane)) {
      misses.push(`${id}：簽的人就是正在執行的這個 session，不能自簽自跑`)
      continue
    }
    return { allow: true, reason: `${id}（${seat}簽）` }
  }
  return {
    allow: false,
    reason: misses.length
      ? `plan sha256 ${call.sha.slice(0, 12)}… 的紀錄都不合格：${misses.join('；')}`
      : `proxy-answers 沒有 plan sha256 ${call.sha.slice(0, 12)}… 的代簽紀錄`,
  }
}

export function readRows(file: string): ProxyRow[] {
  const rows: ProxyRow[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const v: unknown = JSON.parse(line)
      if (v && typeof v === 'object') rows.push(v as ProxyRow)
    } catch {}
  }
  return rows
}

function denyText(reason: string, g: GateEnv): string {
  return `review-bridge sign gate: 擋下。原因：${reason}

規則（Charles 要 Bridge 卡片由主持者或主管主動放行）：worker 不能自己帶 --yes。要放行，先由主持者席或 HQ 主管常駐席
（不是要執行的這個 session）在 ${g.proxyFile} 補一筆 24 小時內的代簽紀錄，至少含：
  {"at":"<ISO 時刻>","span_id":"<flow span>","plan_sha256":"<卡片上的 plan sha256>","signer_session":"<簽的席位 session id>",
   "signer_pane":"<簽的席位 pane>","answer":"主管代簽|主持者代簽","by":"<席位>","authorization_id":null}
再用 ${SHA_ENV}=<同一個 sha256> review-bridge start|resume … --yes 重跑（run 建立後把 authorization_id 補回那一筆）。
席位狀態與紀錄只讀本機：席位在別台機器時，到席位狀態所在的機器跑。
不帶 --yes 跑會印卡片、不會開跑；把卡片交給席位判斷。`
}

export function main(
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
  nowMs = Date.now(),
): { code: number; stderr: string } {
  // 去掉引號、反斜線與 `$` 再比對：`review-"bridge"`、`review-$''bridge` 這類拆字也要進判定（外殼快篩同一條）
  // JSON 裡的反斜線續行（`review-\\\nbridge`）先整組拿掉，否則剝完反斜線剩 `review-nbridge`
  if (
    !raw
      .replaceAll('\\\\\\n', '')
      .replace(/["'\\$]/g, '')
      .includes('review-bridge')
  )
    return { code: 0, stderr: '' }
  let command: string | null = null
  let session: string | null = null
  try {
    const v = JSON.parse(raw) as { tool_input?: { command?: unknown }; session_id?: unknown }
    if (typeof v.tool_input?.command === 'string') command = v.tool_input.command
    if (typeof v.session_id === 'string') session = v.session_id
  } catch {}
  const g = gateEnv(env)
  if (command === null) {
    if (
      /review-bridge/.test(raw) &&
      /(?:--yes|\s-y)\b/.test(raw) &&
      /\b(?:start|resume)\b/.test(raw)
    )
      return { code: 2, stderr: denyText('hook 輸入不是預期的 JSON，判不出指令', g) }
    return { code: 0, stderr: '' }
  }
  // 含 review-bridge 又帶 parser 看不懂的語法：不解析，整條當簽核嘗試擋下（判定在 parse 檔）
  const { opaque, calls } = signAttempt(command)
  if (opaque.length)
    return {
      code: 2,
      stderr: denyText(
        `指令含 review-bridge 又帶判定看不懂的語法（${opaque.join('、')}），一律當簽核嘗試擋下；改寫成單行、不含替換／變數／括號的純字面指令再跑（要寫含這串字的文字，改用 Write／Edit 落檔）`,
        g,
      ),
    }
  if (!calls.length) return { code: 0, stderr: '' }
  let rows: ProxyRow[]
  try {
    rows = readRows(g.proxyFile)
  } catch {
    return { code: 2, stderr: denyText(`讀不到 ${g.proxyFile}`, g) }
  }
  const seats = readSeats(g, nowMs)
  const self = { session, pane: env.HERDR_PANE_ID?.trim() || null }
  for (const c of calls) {
    const v = judge(c, rows, seats, self, nowMs)
    if (!v.allow) return { code: 2, stderr: denyText(v.reason, g) }
  }
  return { code: 0, stderr: '' }
}

function isEntry(): boolean {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntry()) {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  const r = main(Buffer.concat(chunks).toString('utf8'))
  if (r.stderr) process.stderr.write(`${r.stderr}\n`)
  process.exit(r.code)
}
