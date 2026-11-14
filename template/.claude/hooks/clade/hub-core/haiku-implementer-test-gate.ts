#!/usr/bin/env node
/**
 * haiku-implementer 收尾機械複驗：Haiku 自報的狀態不算數，由 hook 重跑 brief 指定的測試。
 *
 * gate 型別：安全型（判不出來倒向 failed）。
 * threat model：防漂移——誠實但會誤報「修好了」的 Haiku 與照單全收的主線。
 * test-command 在 hook 內執行，**不經** Bash 工具的 permission deny 規則、sandbox 與各 PreToolUse Bash gate，
 * 所以只跑「測試 runner 前綴＋位置參數、不含 shell 控制字元與引號」的指令（isRunnableTestCommand）：串接、重導、替換、背景、
 * runner 旗標（`--import=data:…`、`go test -exec`、`--test-reporter-destination` 等能載入程式碼、指定外部程式或寫任意檔的入口）
 * 一律不跑，判成 failed 轉 sonnet。PATH 上有 `clade-gate` 時一律包 `clade-gate run test --` 執行，取 gate-slot 不超賣。runner 本身仍會執行專案的測試碼，權限與主線相同；NEVER 把不可信內容放成行首的 `test-command:` 行。
 * 不承諾：Haiku 改弱測試本身、改寫自己的 transcript；測試綠只代表指令 exit 0，不代表測試驗到該驗的事。
 *
 * 流程：
 *   SubagentStop（`subagent-stop`）：從 agent transcript 第一則 user 訊息（brief）取 `test-command:` 行，
 *     逐條在 subagent 起跑的 cwd 重跑。
 *     - 越界 gate 記過越權（haiku-implementer-boundary.ts）→ 不論測試綠不綠都判 failed（boundary-violation）。
 *     - 全綠 → exit 0 放行。
 *     - 任一紅／逾時／起不來、brief 沒 `test-command:`（routing table：沒有可跑測試定義完成就不該派 Haiku）、
 *       transcript 讀不到 → 寫 handoff 與 latch，exit 2 要 Haiku 把最終輸出第一行改成 FAILED。
 *   PreToolUse（`pre-tool`）與 Stop（`stop`）：hook 叫不了 Agent 工具，「轉交」由 latch 落實——主線在 latch 期間
 *     只准 Read／Grep／Glob／ToolSearch，以及帶該 handoff 路徑的 Agent(sonnet-implementer)（PostToolUse 確認派出才解 latch）；
 *     其他工具與收工一律擋，訊息逐字給 AGENT_CALL。Haiku 文字就算還寫 DONE，主線也走不下去。
 *
 * 繞行場景：
 *   | Haiku 不照改第一行、仍寫 DONE | latch 不看 Haiku 文字，主線照樣被擋 |
 *   | 主線改派 Haiku 或 SendMessage 續跑 | 不在放行清單，deny |
 *   | 弄壞判定 | 外殼不沿用退出碼，走 fail-closed latch |
 *   | Haiku 第二次收尾想蒙混 | 同一 agent 已 latch 就不重跑，verdict 不翻案 |
 *
 * 逃生門（sonnet 不可用時）：`node <本檔> --release <id> --reason '<理由>'`，理由進 audit log。
 * 已知限制：harness 砍掉 hook 屬 non-blocking，外殼收不到，故測試逾時（預設 14 分）壓在 hooks.json timeout 之內。
 */

import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  readdirSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUTPUT_TAIL_CHARS = 6000
const DEFAULT_TIMEOUT_MS = 14 * 60 * 1000
const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'ToolSearch'])
const SELF_PATH = fileURLToPath(import.meta.url)
// 印給主線照抄的指令：路徑含空白、中文、@、+ 時要包單引號，isReleaseCommand 兩種寫法都認
const SELF_PATH_ARG = /^[\w./-]+$/.test(SELF_PATH)
  ? SELF_PATH
  : `'${SELF_PATH.replaceAll("'", "'\\''")}'`

// 測試逾時封頂在預設值：註冊 SubagentStop 時 hook timeout 要比它長，否則 harness 先殺掉 hook、不寫 latch 而靜默放行
export function testTimeoutMs(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(n, DEFAULT_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS
}

type Payload = Record<string, unknown>

type Latch = {
  id: string
  session_id: string
  agent_id: string
  verdict: 'test-red' | 'no-test-command' | 'unverifiable' | 'gate-broken' | 'boundary-violation'
  handoff_path: string
  routing_row: string
}

type CommandResult = { command: string; ok: boolean; status: string; output: string }

function stateRoot(): string {
  const cacheRoot = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  return (
    process.env.CLADE_HAIKU_GATE_STATE_DIR || join(cacheRoot, 'clade', 'haiku-implementer-gate')
  )
}

function latchDir(): string {
  return join(stateRoot(), 'latched')
}

function safeSegment(value: string): string {
  return value.replace(/[^\w.-]/g, '_')
}

export function isHaikuImplementer(agentType: unknown): boolean {
  return typeof agentType === 'string' && /^(?:[\w-]+:)?haiku-implementer$/.test(agentType)
}

/** 只認 code fence 外行首的 `test-command:`；brief 內文或引用的範例提到這個字樣不算宣告。 */
export function parseTestCommands(brief: string): string[] {
  const commands: string[] = []
  let inFence = false
  for (const line of brief.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^\s*(?:[-*]\s+)?test-command:\s*(.+?)\s*$/.exec(line)
    if (!match) continue
    const command = match[1].replace(/^`([^`]+)`$/, '$1').trim()
    if (command) commands.push(command)
  }
  return commands
}

export function parseRoutingRow(brief: string): string {
  return /^\s*(?:[-*]\s+)?routing-row:\s*`?([\w-]+)`?/m.exec(brief)?.[1] ?? 'non-ui-implementation'
}

/** transcript 第一則 user 訊息就是 brief；haiku 之後的 tool result 也是 user role，所以只取第一則。 */
export function readBrief(transcriptPath: unknown): { brief: string; cwd?: string } | null {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return null
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return null
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let entry: { type?: string; cwd?: string; message?: { content?: unknown } }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type !== 'user') continue
    const content = entry.message?.content
    const brief =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .map((block: { text?: unknown }) =>
                typeof block?.text === 'string' ? block.text : '',
              )
              .join('\n')
          : ''
    return brief ? { brief, cwd: entry.cwd } : null
  }
  return null
}

// 測試 runner 前綴；後面只接參數。shell 控制字元（串接、管線、重導、替換、背景、跳脫、換行）一律不收。
// 分隔只認 bash 會切詞的空白（空格、tab）：\v \f \r 與 Unicode 空白 bash 不切詞，用 \s 會讓判定與實際執行不一致
const TEST_RUNNER_PREFIX =
  /^(?:node[ \t]+--test|node[ \t]+--run[ \t]+test|(?:pnpm|npm|yarn|bun)(?:[ \t]+run)?[ \t]+test|pnpm[ \t]+(?:exec[ \t]+)?vitest|npx[ \t]+vitest|vitest|vp[ \t]+test|pytest|python3?[ \t]+-m[ \t]+pytest|cargo[ \t]+test|go[ \t]+test)(?=[ \t]|$)/
const SHELL_CONTROL = /[;&|`$<>()\\\n{}!]/
// 其餘控制字元（tab 除外）與 bash 不切詞的 Unicode 空白一律不收
const BAD_CHARS =
  // oxlint-disable-next-line no-control-regex -- 本來就是要比對控制字元
  /[\x00-\x08\x0b-\x1f\x7f\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/

// `clade-gate run test -- <指令>` 是 gate-slot 限流入口：`run test` 後一個 token 必須正好是 `--`，
// `--` 之後同樣要是 runner 形狀，且不得再含獨立的 `--`，不能當任意指令的跳板
const CLADE_GATE_PREFIX = /^clade-gate[ \t]+run[ \t]+test[ \t]+--[ \t]+/

// runner 後面只收位置參數：旗標（含 `--`）能載入程式碼或指定外部程式，引號能把旗標藏進看似位置參數的 token
function onlyPositionalArgs(rest: string): boolean {
  if (/['"]/.test(rest)) return false
  return rest
    .split(/[ \t]+/)
    .filter(Boolean)
    .every((token) => !token.startsWith('-'))
}

function runnerShapeOk(command: string): boolean {
  const match = TEST_RUNNER_PREFIX.exec(command)
  return match !== null && onlyPositionalArgs(command.slice(match[0].length))
}

export function isRunnableTestCommand(command: string): boolean {
  if (SHELL_CONTROL.test(command) || BAD_CHARS.test(command)) return false
  const trimmed = command.replace(/^[ \t]+|[ \t]+$/g, '')
  if (/^clade-gate(?=[ \t]|$)/.test(trimmed)) {
    if (!CLADE_GATE_PREFIX.test(trimmed)) return false
    return runnerShapeOk(trimmed.replace(CLADE_GATE_PREFIX, ''))
  }
  return runnerShapeOk(trimmed)
}

// PATH 上找得到 clade-gate 就包它取 gate-slot（hook 不經 PreToolUse Bash gate，不包會超賣 slot 造成假紅）
function withGateSlot(command: string, env: NodeJS.ProcessEnv): string {
  if (/^[ \t]*clade-gate(?=[ \t]|$)/.test(command)) return command
  const found = (env.PATH ?? '')
    .split(delimiter)
    .some((dir) => dir !== '' && existsSync(join(dir, 'clade-gate')))
  return found ? `clade-gate run test -- ${command}` : command
}

// detached 讓 bash 自成 session（sid = pid）。只殺 process group 不夠：包了 clade-gate 時 gate-slot 用
// timeout(1) 執行 runner，timeout 會 setpgid 自成一組，runner 與子孫逃出 group，卻仍留在同一個 session，
// 逾時後會繼續寫工作樹、佔 port，timeout 還握著 gate-slot 的 flock。所以依 /proc 的 session 欄位收整個 session。
function killSession(sid: number): void {
  const victims = new Set<number>()
  try {
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue
      try {
        const stat = readFileSync(join('/proc', entry, 'stat'), 'utf8')
        // comm 可含空白與括號：從最後一個 `)` 之後切欄位：state ppid pgrp session …
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
        if (Number(fields[3]) === sid) victims.add(Number(entry))
      } catch {
        // 行程已結束
      }
    }
  } catch {
    // 沒有 /proc（非 Linux）：退回只收 process group
  }
  // spawn 失敗時 pid 是 0，kill(-0) 會打到 hook 自己的 group；sid 不會是 hook 自己（detached 新開的 session）
  try {
    process.kill(-sid, 'SIGKILL')
  } catch {
    // group 已經沒人了
  }
  for (const pid of victims) {
    if (pid === process.pid) continue
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // 已結束
    }
  }
}

function runCommand(command: string, cwd: string, timeoutMs: number): CommandResult {
  // stdout／stderr 寫檔不接 pipe：測試的孫行程握著 pipe 會讓 spawnSync 逾時後仍卡住
  const logDir = join(stateRoot(), 'tmp')
  mkdirSync(logDir, { recursive: true, mode: 0o700 })
  const logPath = join(logDir, `${process.pid}-${Date.now()}.log`)
  const fd = openSync(logPath, 'w', 0o600)
  // detached 在 spawnSync 有效，只是 SpawnSyncOptions 型別沒列
  const options: SpawnSyncOptions & { detached: boolean } = {
    cwd,
    stdio: ['ignore', fd, fd],
    timeout: timeoutMs,
    // 預設 SIGTERM：runner trap 掉或轉送後等 hung worker，spawnSync 會一直等到超過 hook timeout，
    // harness 殺掉 hook 視為非阻擋 → 沒 latch、Haiku 的 DONE 照收。SIGKILL 收不掉的孫行程由下面的 group kill 收。
    killSignal: 'SIGKILL',
    detached: true,
  }
  const result = spawnSync('bash', ['-c', withGateSlot(command, process.env)], options)
  closeSync(fd)
  // timeout 只打得到 bash 本身；開自己的 process group 才收得掉 runner 與背景行程（正常 exit 也會留下
  // `server &` 之類），否則它們會在 sonnet 接手時繼續寫工作樹或佔 port
  // spawn 失敗時 pid 是 0，kill(-0) 會打到 hook 自己的 group
  if (result.pid) killSession(result.pid)
  let output = ''
  try {
    output = readFileSync(logPath, 'utf8')
    rmSync(logPath, { force: true })
  } catch {
    // 讀不到輸出不影響判定，下面照 exit code
  }
  const status = result.error
    ? `spawn/timeout error: ${result.error.message}`
    : result.signal
      ? `signal ${result.signal}`
      : `exit ${result.status}`
  return {
    command,
    ok: !result.error && result.status === 0,
    status,
    output: output.slice(-OUTPUT_TAIL_CHARS),
  }
}

function writeLatch(
  payload: Payload,
  verdict: Latch['verdict'],
  detail: string,
  brief: string,
  cwd?: string,
): Latch {
  const sessionId = String(payload.session_id ?? '')
  const agentId = String(payload.agent_id ?? '')
  const id = `${safeSegment(sessionId)}__${safeSegment(agentId)}`
  const handoffDir = join(stateRoot(), 'handoff')
  mkdirSync(handoffDir, { recursive: true, mode: 0o700 })
  mkdirSync(latchDir(), { recursive: true, mode: 0o700 })
  const handoffPath = join(handoffDir, `${id}.md`)
  const routingRow = parseRoutingRow(brief)
  writeFileSync(
    handoffPath,
    [
      `# haiku-implementer 機械複驗 failed（${verdict}）→ 轉交 sonnet-implementer`,
      '',
      'Haiku 的改動還留在工作樹，從現況接手，不要假設它做對；完成條件同原 brief。',
      '',
      `測試重跑所在的工作樹（Haiku 起跑的 cwd，sonnet 要在這裡接手）：${cwd ?? '（讀不到：向主線要）'}`,
      '',
      '## 複驗結果',
      '',
      detail,
      '',
      '## 原 brief（逐字）',
      '',
      brief || '（讀不到原 brief：向主線要）',
      '',
    ].join('\n'),
    { mode: 0o600 },
  )
  const latch: Latch = {
    id,
    session_id: sessionId,
    agent_id: agentId,
    verdict,
    handoff_path: handoffPath,
    routing_row: routingRow,
  }
  // 先寫暫存再 rename：背景派工時主線可能同時讀 latch，讀到寫一半的檔會被判成 gate-broken，照 --release 就跳過轉交
  const latchPath = join(latchDir(), `${id}.json`)
  const tmpPath = `${latchPath}.${process.pid}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(latch, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmpPath, latchPath)
  return latch
}

function failedMessageForHaiku(latch: Latch, detail: string): string {
  return [
    `機械複驗 failed（${latch.verdict}）。NEVER 繼續修、NEVER 重跑。`,
    '現在直接結束：最終輸出第一行 MUST 是 `FAILED`，其後貼下面的紅燈結果；主線會轉交 sonnet-implementer。',
    '',
    detail,
  ].join('\n')
}

function formatResults(results: CommandResult[]): string {
  return results
    .map((r) =>
      [
        `### ${r.ok ? '綠' : '紅'}：\`${r.command}\`（${r.status}）`,
        '',
        '```',
        r.output.trimEnd(),
        '```',
      ].join('\n'),
    )
    .join('\n\n')
}

/**
 * 越界 gate（haiku-implementer-boundary.ts）記下的越權紀錄。不 import 它：判定檔要能單檔複製執行，
 * 少一個檔就整支起不來。路徑與格式兩邊一致：<state>/violations/<session>__<agent>.json 的 reasons 陣列。
 */
function readViolation(sessionId: string, agentId: string): string | null {
  const path = join(
    stateRoot(),
    'violations',
    `${safeSegment(sessionId)}__${safeSegment(agentId)}.json`,
  )
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { reasons?: unknown }
    return Array.isArray(parsed.reasons) && parsed.reasons.length > 0
      ? parsed.reasons.map(String).join('；')
      : '越權（紀錄不完整）'
  } catch {
    return '越權（紀錄讀不到）'
  }
}

function subagentStop(payload: Payload): number {
  if (!isHaikuImplementer(payload.agent_type)) return 0
  const sessionId = String(payload.session_id ?? '')
  const agentId = String(payload.agent_id ?? '')
  if (!sessionId || !agentId) throw new Error('payload 缺 session_id／agent_id')
  // 已判 failed 的第二次收尾直接放行（否則擋不完），verdict 不翻案
  if (existsSync(join(latchDir(), `${safeSegment(sessionId)}__${safeSegment(agentId)}.json`)))
    return 0

  const parsed = readBrief(payload.agent_transcript_path)
  if (!parsed) {
    const detail = `讀不到 agent transcript 的 brief（${String(payload.agent_transcript_path)}），無法複驗。`
    const latch = writeLatch(payload, 'unverifiable', detail, '')
    process.stderr.write(`${failedMessageForHaiku(latch, detail)}\n`)
    return 2
  }

  // 越權（commit／push 等）由 PreToolUse 越界 gate 擋下並記錄：不論測試綠不綠都轉交，越權的那棵樹不可信
  const violation = readViolation(sessionId, agentId)
  if (violation) {
    const detail = `Haiku 嘗試越權（已被擋下）：${violation}。依現行升級鏈轉交 sonnet-implementer。`
    const latch = writeLatch(payload, 'boundary-violation', detail, parsed.brief, parsed.cwd)
    process.stderr.write(`${failedMessageForHaiku(latch, detail)}\n`)
    return 2
  }

  const commands = parseTestCommands(parsed.brief)
  if (commands.length === 0) {
    const detail =
      'brief 沒有 `test-command:` 行：沒有可重跑的測試定義完成，依 routing table 不該由 Haiku 收尾。'
    const latch = writeLatch(payload, 'no-test-command', detail, parsed.brief, parsed.cwd)
    process.stderr.write(`${failedMessageForHaiku(latch, detail)}\n`)
    return 2
  }

  // transcript 沒記 Haiku 起跑的 cwd 就判不出該在哪棵樹重跑：退回主線 cwd 會在沒有改動的樹上假綠
  if (!parsed.cwd) {
    const detail =
      'agent transcript 第一則 user 訊息沒有 cwd，判不出 Haiku 在哪棵樹起跑，無法複驗。'
    const latch = writeLatch(payload, 'unverifiable', detail, parsed.brief)
    process.stderr.write(`${failedMessageForHaiku(latch, detail)}\n`)
    return 2
  }
  const cwd = parsed.cwd
  const timeoutMs = testTimeoutMs(process.env.CLADE_HAIKU_GATE_TEST_TIMEOUT_MS)
  const deadline = Date.now() + timeoutMs
  const results = commands.map((command) =>
    isRunnableTestCommand(command)
      ? runCommand(command, cwd, Math.max(1, deadline - Date.now()))
      : {
          command,
          ok: false,
          status:
            'not run: 不是測試 runner 指令形狀（只收 runner 前綴＋位置參數，不含旗標、引號與 ; & | ` $ < > ( ) 等）',
          output: '',
        },
  )
  if (results.every((r) => r.ok)) return 0

  const detail = formatResults(results)
  const latch = writeLatch(payload, 'test-red', detail, parsed.brief, cwd)
  process.stderr.write(`${failedMessageForHaiku(latch, detail)}\n`)
  return 2
}

function readLatches(sessionId: string): Latch[] {
  if (!existsSync(latchDir())) return []
  const prefix = `${safeSegment(sessionId)}__`
  const latches: Latch[] = []
  for (const name of readdirSync(latchDir())) {
    if (!name.startsWith(prefix) || !name.endsWith('.json')) continue
    const path = join(latchDir(), name)
    try {
      latches.push(JSON.parse(readFileSync(path, 'utf8')) as Latch)
    } catch {
      // 壞掉的 latch 仍要擋：外殼寫的 broken latch 或半寫入，以檔名當 id
      const id = name.slice(0, -'.json'.length)
      latches.push({
        id,
        session_id: sessionId,
        agent_id: '',
        verdict: 'gate-broken',
        handoff_path: '',
        routing_row: 'non-ui-implementation',
      })
    }
  }
  return latches
}

function clearLatch(id: string): void {
  rmSync(join(latchDir(), `${id}.json`), { force: true })
}

function handoffInstruction(latches: Latch[]): string {
  const calls = latches.map((latch) => {
    if (!latch.handoff_path) {
      return `- ${latch.id}（gate 故障，沒有 handoff）：解除 → node ${SELF_PATH_ARG} --release ${latch.id} --reason '<理由>'`
    }
    const prompt = `routing-row: ${latch.routing_row}\\n讀 ${latch.handoff_path} 全文並照做`
    return `- AGENT_CALL（${latch.verdict}）：Agent({ subagent_type: 'sonnet-implementer', description: '接手 Haiku 未過的實作', prompt: '${prompt}' })`
  })
  return [
    '⛔ haiku-implementer 機械複驗 failed：它的回報不算數（就算寫 DONE），NEVER 當成功轉述、NEVER 原樣重派 Haiku。',
    '現在 MUST 照下面派 sonnet-implementer 接手（派出成功才解鎖）：',
    ...calls,
    "只裝 hub-core plugin、沒有專案層 .claude/agents/ 時 subagent_type 改寫 'hub-core:sonnet-implementer'（找不到 agent type 就換這個拼法）。",
    `sonnet 不可用時才解除並照 routing table 走鏈尾：node ${SELF_PATH_ARG} --release <id> --reason '<理由>'`,
  ].join('\n')
}

// 只認 gate 自己的路徑（照印出的寫法，裸或包單引號）：只比檔名的話，主線可以跑一支同名的別的檔繞過 latch
const RELEASE_COMMAND = new RegExp(
  `^[ \\t]*node[ \\t]+(?:${[...new Set([SELF_PATH, SELF_PATH_ARG])]
    .map((path) => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join(
      '|',
    )})[ \\t]+--release[ \\t]+[\\w.-]+[ \\t]+--reason[ \\t]+(?:'[^'\\n]+'|[^\\s;&|<>\`$'"]+)[ \\t]*$`,
)

function isReleaseCommand(toolName: unknown, toolInput: Payload): boolean {
  if (toolName !== 'Bash' || typeof toolInput.command !== 'string') return false
  // 整串錨定：`--release x --reason y; 任意指令` 不算，否則 latch 期間什麼都跑得了
  return RELEASE_COMMAND.test(toolInput.command)
}

function preTool(payload: Payload): number {
  if (payload.agent_id) return 0 // subagent 自己的工具呼叫不受主線 latch 管
  const latches = readLatches(String(payload.session_id ?? ''))
  if (latches.length === 0) return 0
  const toolName = payload.tool_name
  if (typeof toolName === 'string' && READ_ONLY_TOOLS.has(toolName)) return 0
  const toolInput = (payload.tool_input ?? {}) as Payload
  if (isReleaseCommand(toolName, toolInput)) return 0
  if (
    (toolName === 'Agent' || toolName === 'Task') &&
    /^(?:[\w-]+:)?sonnet-implementer$/.test(String(toolInput.subagent_type ?? ''))
  ) {
    const prompt = String(toolInput.prompt ?? '')
    const matched = latches.find(
      (latch) => latch.handoff_path && prompt.includes(latch.handoff_path),
    )
    if (matched) return 0
  }
  process.stderr.write(`${handoffInstruction(latches)}\n`)
  return 2
}

/** Agent 真的派出才解鎖：PreToolUse 就解的話，派工失敗（型別不存在、被別支 hook 擋）鎖就白白沒了。失敗時 PostToolUse 不 fire。 */
function postTool(payload: Payload): number {
  if (payload.agent_id) return 0
  const toolInput = (payload.tool_input ?? {}) as Payload
  if (!/^(?:[\w-]+:)?sonnet-implementer$/.test(String(toolInput.subagent_type ?? ''))) return 0
  const prompt = String(toolInput.prompt ?? '')
  for (const latch of readLatches(String(payload.session_id ?? ''))) {
    if (latch.handoff_path && prompt.includes(latch.handoff_path)) clearLatch(latch.id)
  }
  return 0
}

function stop(payload: Payload): number {
  if (payload.agent_id) return 0
  const latches = readLatches(String(payload.session_id ?? ''))
  if (latches.length === 0) return 0
  // 不設次數上限：次數放行等於連停 N 次就繞過；出口是 AGENT_CALL 與 --release
  process.stdout.write(
    `${JSON.stringify({ decision: 'block', reason: handoffInstruction(latches) })}\n`,
  )
  return 0
}

function release(args: string[]): number {
  const id = args[args.indexOf('--release') + 1]
  const reason = args.includes('--reason') ? args[args.indexOf('--reason') + 1] : ''
  if (!id || !reason) {
    process.stderr.write('用法：--release <id> --reason <理由>\n')
    return 1
  }
  const path = join(latchDir(), `${safeSegment(id)}.json`)
  if (!existsSync(path)) {
    process.stderr.write(`沒有這個 latch：${id}\n`)
    return 1
  }
  mkdirSync(stateRoot(), { recursive: true })
  appendFileSync(
    join(stateRoot(), 'release-audit.jsonl'),
    `${JSON.stringify({ at: new Date().toISOString(), id, reason })}\n`,
  )
  clearLatch(safeSegment(id))
  process.stdout.write(`已解除 ${id}\n`)
  return 0
}

function main(): number {
  const args = process.argv.slice(2)
  if (args.includes('--release')) return release(args)
  let payload: Payload
  try {
    payload = JSON.parse(readFileSync(0, 'utf8')) as Payload
  } catch {
    return 3
  }
  switch (args[0]) {
    case 'subagent-stop':
      return subagentStop(payload)
    case 'pre-tool':
      return preTool(payload)
    case 'post-tool':
      return postTool(payload)
    case 'stop':
      return stop(payload)
    default:
      return 3
  }
}

// 比 realpath：經 symlink 呼叫時字面比對不成立，main 不跑、exit 0，整道 gate 靜默放行
if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  try {
    process.exitCode = main()
  } catch (error) {
    process.stderr.write(`haiku-implementer-test-gate 判定丟例外：${String(error)}\n`)
    process.exitCode = 3
  }
}
