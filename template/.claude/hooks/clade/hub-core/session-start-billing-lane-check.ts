#!/usr/bin/env node
// SessionStart hook — 計費管道比對：cwd 所屬 consumer 的 registry billing（lab／prod）與本 session 實際登入方式
// （cc 個人帳號／Console API key）不符時印一行警告並追加一列帳，不擋。入口是同名 .sh（一行 exec，rules/core/code-style.md D11 L5）。
//
// 定案：yudefine-hq plans/53-AI訂閱與API組合.md § 已定：正式區計費管道 一之 1、3。
// 公司 API 組織還沒開通（T2）前只警告＋記帳；「不符即結束 session」等組織開通後另做。
// 判定在 clade home 的 scripts/billing-lane-check.ts（真相表 registry/consumers.json 只在 clade home），
// 所以 consumer session 也找 clade home（CLADE_HOME → ~/clade → ~/offline/clade）；找不到 clade home 才靜默（不是 clade 機器）。
// 找到了卻逾時（預設 4s，小於 hooks.json 的 5s 上限；CLADE_BILLING_LANE_TIMEOUT_MS 可覆寫）、node 起不來或非 0 結束又沒印東西時
// 印一行警告並追加一列 check_failed（逾時印「結果不明」，其餘印「比對失敗」）：這是計費管道唯一的稽核來源，靜默等於「沒有不符」。
// 帳：~/.local/state/clade/billing-lane/mismatch.jsonl（CLADE_BILLING_LANE_LEDGER 可覆寫）。沒比對成（逾時、node 起不來、非 0 結束）
// 也追加一列 status=check_failed，讀帳才分得出「這個 session 沒有不符」與「根本沒比對成」。
// cloud VM（CLAUDE_CODE_REMOTE 有值）整支跳過：那裡沒有 cc 帳號目錄，登入方式由雲端決定。
// 只用 node 內建模組：hooks 目錄會投影給 consumer，不能 import clade home 的 lib。
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'

export const DEFAULT_TIMEOUT_MS = 4000
const CLI = join('scripts', 'billing-lane-check.ts')
const FAIL = '⚠ 計費管道比對失敗（沒比對）：'
const env = process.env

let sessionId: string | null = null
let source: string | null = null

/** 沒比對成也留一列帳；記帳失敗就照實說。帳本路徑與 home 解析都在 try 內：它們可能正是失敗原因。回傳警告尾巴。 */
function recordFailure(reason: string, cwd: string | null): string {
  try {
    const ledger =
      env.CLADE_BILLING_LANE_LEDGER ||
      join(env.HOME || homedir(), '.local', 'state', 'clade', 'billing-lane', 'mismatch.jsonl')
    mkdirSync(dirname(ledger), { recursive: true })
    const row = {
      ts: new Date().toISOString(),
      host: hostname(),
      session_id: sessionId,
      source,
      cwd,
      status: 'check_failed',
      reason,
    }
    appendFileSync(ledger, JSON.stringify(row) + '\n')
    return `（已記一列 check_failed：${ledger}）`
  } catch {
    return '（check_failed 列也沒記進帳）'
  }
}

/** 工作目錄讀不到（例如 cwd 已被刪）時回 null，不丟。 */
function safeCwd(): string | null {
  try {
    return env.CLAUDE_PROJECT_DIR || process.cwd()
  } catch {
    return null
  }
}

function main(): void {
  if (!['', '0', 'false'].includes(env.CLAUDE_CODE_REMOTE ?? '')) return
  let input = ''
  try {
    input = readFileSync(0, 'utf8')
  } catch {
    /* 沒有 stdin 就不帶 session_id／source */
  }
  try {
    const j = input.trim() ? (JSON.parse(input) as { session_id?: unknown; source?: unknown }) : {}
    if (typeof j.session_id === 'string') sessionId = j.session_id
    if (typeof j.source === 'string') source = j.source
  } catch {
    /* hook 輸入讀不懂就不帶 session_id／source */
  }
  const home = env.HOME || homedir()
  const root = [env.CLADE_HOME, join(home, 'clade'), join(home, 'offline', 'clade')].find(
    (c): c is string => Boolean(c) && existsSync(join(c as string, CLI)),
  )
  if (!root) return
  const timeout = Number(env.CLADE_BILLING_LANE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
  const cwd = safeCwd()
  if (cwd === null) {
    const why = '讀不到工作目錄'
    process.stdout.write(`${FAIL}${why}${recordFailure(why, null)}\n`)
    return
  }
  const r = spawnSync(process.execPath, [join(root, CLI), '--cwd', cwd], {
    input,
    encoding: 'utf8',
    timeout,
    killSignal: 'SIGKILL',
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  const first = (r.stdout ?? '').split('\n').find((l) => l.trim())
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code
  if (first) process.stdout.write(first + '\n')
  else if (code === 'ETIMEDOUT') {
    // CLI 先記帳再印：逾時落在兩者之間時帳上可能已有一列 mismatch，所以說「結果不明」
    const why = `${timeout / 1000}s 內沒回（逾時）`
    process.stdout.write(`⚠ 計費管道比對結果不明：${why}${recordFailure(why, cwd)}\n`)
  } else if (r.error) {
    const why = `node 起不來（${code ?? r.error.message}）`
    process.stdout.write(`${FAIL}${why}${recordFailure(why, cwd)}\n`)
  } else if (r.status !== 0) {
    const why = `node exit ${r.status ?? r.signal}`
    process.stdout.write(`${FAIL}${why}${recordFailure(why, cwd)}\n`)
  }
}

try {
  main()
} catch (e) {
  // 最後一道防線本身也不能丟：recordFailure／safeCwd 內部都已收住 homedir()／process.cwd() 的例外
  const why = String((e as Error)?.message ?? e).split('\n')[0]
  process.stdout.write(`${FAIL}${why}${recordFailure(why, safeCwd())}\n`)
}
process.exit(0)
