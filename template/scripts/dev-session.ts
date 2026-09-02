#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/dev-session.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/dev-session.ts
/**
 * dev-session.ts — durable dev-server 單一入口（herdr tab + lease + 反累積）.
 *
 * 為什麼存在（root cause）：
 *   agent（Claude Code / Codex）的 harness 會在 tool-call 生命週期結束時回收
 *   Bash 衍生的整個 process tree —— **連 `spawn(detached:true)+unref()` / setsid /
 *   nohup 都逃不掉**（實測 2026-06-01 <consumer-a>：run_in_background 與 setsid 起的 nuxt
 *   dev 都被 reap，唯獨掛在 multiplexer server daemon 下的存活）。dev-singleton.ts
 *   的 `spawn(detached:true)` 同樣會被回收。
 *
 *   唯一可靠的持久化 = 把 dev process 交給一個**獨立於 agent session 的常駐
 *   multiplexer daemon**（本倉唯一標準：herdr）。dev process 變成 herdr server 的
 *   子孫、不在 agent 的 spawn tree 裡 → 跨 tool-call / 跨 session 存活。
 *
 *   **NEVER** 改回 tmux / zellij：本 fleet 的多工器唯一標準是 herdr
 *   （見 rules/core/proactive-skills.dev-server-spawn.md § 多工器唯一標準）。
 *
 * 三層職責（本 script 是單一入口，收斂三者）：
 *   1. durability   → herdr 獨立 Tab（`tab create --label --cwd --no-focus` + `pane run`）
 *   2. ownership    → verification-lease（相容 dev-singleton.ts 的 /tmp/<id>-verification-lease.json schema v1）
 *   3. 反累積       → 一 consumer(-app) 一個 durable session（起前先查、有就 reuse）；
 *                     多 worktree 切換走 dev-router 不要 N 個 dev+tunnel；sweep 清死 session
 *
 * 4. slot broker  → **agent 租約有界、人類租約無界**（見下）
 *
 * 為什麼要 broker（別把它簡化掉）：
 *   lease 原本是 session-scoped 且**無界** —— 誰先起就持有到 session 結束。無界所有權的
 *   必然推論鏈是「另一個 agent 永遠不會自己放手 → 想用只能砍掉他 → 砍是破壞性動作 →
 *   所以必須問 user」。那個「必須問 user」不是規約訂太保守，是無界所有權的數學結果。
 *   解法**不是**放寬規約讓 agent 自行 takeover（那會變成 agent 互砍），是讓所有權**有界**：
 *
 *     holder 是 agent  → 必須有 TTL（預設 10m），過期或心跳斷 → 其他 agent 自動接管，不問 user
 *     holder 是人類    → 無界，**NEVER** 自動回收；agent 要用一律 refuse + 把訊息呈給 user
 *
 *   人類租約無界這條是整個設計的安全閥：agent 之間完全自治，而 user 自己跑的 dev server
 *   永遠不會被 agent 踢掉。
 *
 * 用法：
 *   node scripts/dev-session.ts [opts] -- <cmd...>   # 起/reuse durable dev session（= start）
 *   node scripts/dev-session.ts wait [opts] -- <cmd...>  # 排隊等 slot，取得後直接接手
 *   node scripts/dev-session.ts heartbeat [opts]     # 續租（heartbeatAt=now、expiresAt 往後推一個 TTL）
 *   node scripts/dev-session.ts release [opts]       # 主動釋放 lease（不動 herdr tab）
 *   node scripts/dev-session.ts status [opts]        # 查 session + port + lease + 佇列
 *   node scripts/dev-session.ts stop [opts]          # 關掉 tab + 釋放 lease
 *   node scripts/dev-session.ts list                 # 列所有 dev-* session + health
 *   node scripts/dev-session.ts sweep [--dry-run]    # 清掉 dev 已退出的 dev-* tab（反累積）
 *
 * 常用 opts：
 *   --consumer-meta <path>   讀 consumer_id / dev.ports / auth.portPinned / dev.leaseMode
 *   --app <name>             multi-app consumer 的 app 後綴（session 名 + port 選擇）
 *   --session <name>         覆寫 session 名（預設 dev-<consumer_id>[-<app>]）
 *   --cwd <dir>              dev 命令的 working dir（預設 process.cwd()）
 *   --port <N>               dev port（health / lease 用；缺則從 cmd argv 或 consumer-meta 推）
 *   --label <text>           lease holder label
 *   --task <text>            這次租用要做什麼（agent 租約 MUST 帶）
 *   --ttl <10m|30m|90s|1h>   租期；agent 未給則預設 10m，人類 holder 一律無界
 *   --wait-timeout <15m>     `wait` 排隊上限（預設 15m），逾時 exit 1
 *   --agent                  強制視為 agent 租約（有界），即使偵測不到 agent runtime
 *   --kind <claude|codex|human|subagent>   覆寫自動偵測的 holder kind
 *   --takeover               搶佔別人的 lease（strict 模式衝突時；會 log 前 holder）
 *   --no-lease               跳過 lease（純 durability + 反累積）
 *
 * 退出碼：0 成功（起 / reuse / status / stop / sweep）；1 lease 衝突 refuse / 啟動逾時 / 用法錯 /
 *         herdr server 不可用
 *
 * 與 dev-singleton / dev-router 的關係：
 *   - dev-singleton.ts 是舊的「lease + spawn(detached)」wrapper —— spawn 層會被 reap，
 *     dev-session 取而代之（durability 靠 herdr，lease schema 相容）。
 *   - dev-router.ts 管「一個公開 port 後面多 worktree backend 切換」；dev-session 起的
 *     是「一 consumer 一個 durable backend」。多 worktree 驗收走 dev-router，不要對每個
 *     worktree 各起一個 dev-session（那就是反累積要防的）。
 *
 * 詳見 rules/core/proactive-skills.md § Dev Server Auto-Spawn 與 rules/core/verification-lease.md。
 */

import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  realpathSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { basename, join, resolve, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { detectHolderKind, detectSessionId } from './lib/detect-runtime.ts'
import {
  probeBackingService,
  runWtEnvBootstrap,
  describeBackingServiceGap,
} from './lib/wt-env-bootstrap-runner.ts'
import { chooseDevWorkspace } from './lib/dev-workspace.ts'
// 分配模型的 SoT。base 池寬度 NEVER 在本檔另外定義一次——第二份常數與分配器漂開時，
// 回收會殺到合法的 dev server。
import { DEV_PORT_BAND } from './lib/worktree-dev-port.ts'

const LEASE_DIR = tmpdir()
const READY_TIMEOUT_MS = 90_000
const READY_POLL_MS = 1_500

/** agent 租約未指定 `--ttl` 時的預設租期。人類 holder 不套用（無界）。 */
const DEFAULT_TTL_MS = 10 * 60_000
/**
 * 心跳判死門檻。`expiresAt` 還沒到但 agent 已崩潰時，唯一的訊號就是心跳停了 ——
 * 所以 liveness **MUST 兩條都看**，只看 `expiresAt` 會讓崩潰的 agent 把 slot 佔滿整個 TTL。
 * 同一個門檻也用來剔除不再 poll 的排隊者（NEVER 另發明一套判準）。
 */
const HEARTBEAT_DEAD_MS = 180_000
const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60_000
const WAIT_POLL_MS = 5_000

// ─────────────────────────────────────────────────────────────────────────
// 小工具
// ─────────────────────────────────────────────────────────────────────────

function out(s) {
  process.stdout.write(s + '\n')
}
function err(s) {
  process.stderr.write(s + '\n')
}

function sh(cmd, args, { allowFail = true } = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch (e) {
    if (allowFail) return null
    throw e
  }
}

/**
 * herdr CLI 走 unix socket 連常駐 server，**不要求 caller 自己在 Herdr 內**
 * （實測 2026-08-12：`env -u HERDR_ENV herdr tab list` exit 0）。所以這裡驗的是
 * 「server 在跑且 CLI 通得到」，不是 `HERDR_ENV=1`——後者會讓所有非 Herdr 終端
 * 起的 agent 失去 durable dev server 的能力，而它們其實用得了。
 */
function herdrAvailable() {
  return herdrJson(['tab', 'list']) !== null
}

/**
 * herdr 不可用時分辨**三種**成因，各自給不同訊息 —— 塌成同一句的代價已實測過一次
 * （2026-08-28：review-gui systemd service 的 PATH 缺 ~/.local/bin，binary 明明裝著、
 * server 明明在跑，訊息卻把讀的人導向「herdr 掛了」）：
 *
 * 1. binary 不在**本行程**的 PATH → 附上實際 PATH。這是唯一能讓讀的人看出
 *    「是 service 環境問題、不是安裝問題」的資訊。
 * 2. binary 在、版本 / protocol 不相容 → 附 `herdr status` 的相容性段落。
 * 3. binary 在、server 連不上 → 維持原訊息（先 `herdr status`，再重跑）。
 */
function herdrUnavailableReason() {
  let probe
  try {
    probe = spawnSync('herdr', ['--version'], { encoding: 'utf8' })
  } catch {
    probe = { error: { code: 'ENOENT' } }
  }
  if (probe?.error?.code === 'ENOENT') {
    return (
      '`herdr` 不在本行程的 PATH（不是沒安裝 —— 呼叫端環境沒帶到它的安裝目錄，' +
      '典型：systemd service 未設 Environment=PATH= 含 ~/.local/bin）。\n' +
      `本行程 PATH=${process.env.PATH ?? '(未設)'}`
    )
  }
  const status = sh('herdr', ['status'])
  if (status && /compatible:\s*no/i.test(status)) {
    const compat = status
      .split('\n')
      .filter((l) => /version|protocol|compatible/i.test(l))
      .join('\n')
    return `herdr client 與 server 版本 / protocol 不相容：\n${compat}\n先升級或重啟 herdr server 再重跑。`
  }
  return 'herdr server 連不上（server 沒在跑 / socket 不通）。dev-session 以 herdr 為持久層：先確認 `herdr status`，再重跑。'
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * `10m` / `90s` / `1h` / `500ms` → ms。**裸數字視為分鐘**（`--ttl 10` = 10m）——
 * 這個位置的量級是「分鐘」，把裸數字當毫秒會安靜地產生一個 10ms 的租約。
 * 解不出來回 null，caller 自己決定 fallback（NEVER 靜默當 0）。
 */
function parseDuration(s) {
  if (s === undefined || s === null) return null
  const m = String(s)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 0) return null
  const unit = (m[2] || 'm').toLowerCase()
  const mult = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[unit]
  return Math.round(n * mult)
}

function fmtDuration(ms) {
  if (ms === null || ms === undefined) return '—'
  if (ms < 0) return '已過期'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const mnt = Math.floor(s / 60)
  if (mnt < 60) return `${mnt}m${s % 60 ? ` ${s % 60}s` : ''}`
  return `${Math.floor(mnt / 60)}h ${mnt % 60}m`
}

// ─────────────────────────────────────────────────────────────────────────
// 租約有界性（broker 的核心分流）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 這份 lease 是 agent 租約還是人類租約。
 *
 * 判準是 holder.kind：`human` 以外的都是 agent（claude / codex / subagent / …）。
 * **NEVER 把判不出來的 holder 當成 agent** —— detectHolderKind() 在偵測不到任何 agent
 * runtime 時回的就是 `human`，那正是「user 自己在 terminal 跑 pnpm dev」的情形。
 * 誤判成 agent 會讓 user 的 dev server 被自動回收，也就是本設計唯一的安全閥失效。
 */
function isAgentLease(lease) {
  const kind = lease?.holder?.kind
  if (!kind) return false
  return kind !== 'human'
}

/** 本次 claim 是不是 agent 租約（`--agent` 顯式覆寫優先）。 */
function claimingAsAgent(o) {
  return o.agent || holderKind(o) !== 'human'
}

/** 本次 claim 的 TTL（ms）；人類租約回 null = 無界。 */
function claimTtlMs(o) {
  if (!claimingAsAgent(o)) return null
  return o.ttl ?? DEFAULT_TTL_MS
}

/**
 * 租約是否已可回收。**MUST 兩條判準都看**：
 *   1. `expiresAt < now` → 到期
 *   2. `heartbeatAt` 早於 now − 180s → 心跳斷（agent 崩潰，expiresAt 還沒到也算死）
 *
 * 人類租約（`expiresAt` 為 null）**恆回 false** —— 無界，永不自動回收。
 * 舊格式 lease（沒有這三個欄位）同樣恆回 false：往後相容，不會因為升級就被回收。
 */
function leaseReclaimable(lease, now = Date.now()) {
  if (!lease || !isAgentLease(lease)) return null
  const expiresAt = lease.expiresAt ? Date.parse(lease.expiresAt) : null
  if (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt < now) return 'expired'
  const hb = lease.heartbeatAt ? Date.parse(lease.heartbeatAt) : null
  if (hb !== null && Number.isFinite(hb) && now - hb > HEARTBEAT_DEAD_MS) return 'heartbeat-dead'
  return null
}

// ─────────────────────────────────────────────────────────────────────────
// 佇列（FIFO；檔案化，放在 lease 檔旁）
// ─────────────────────────────────────────────────────────────────────────

function queuePath(id) {
  return join(LEASE_DIR, `${id}-verification-lease.queue.json`)
}

function readQueue(id) {
  const p = queuePath(id)
  if (!existsSync(p)) return []
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    return Array.isArray(parsed?.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeQueue(id, entries) {
  try {
    const p = queuePath(id)
    if (!entries.length) {
      if (existsSync(p)) unlinkSync(p)
      return
    }
    writeFileSync(p, JSON.stringify({ schemaVersion: '1', entries }, null, 2) + '\n')
  } catch {
    /* fail-open：佇列壞掉不該擋住開發 */
  }
}

/** 剔除超過 HEARTBEAT_DEAD_MS 沒 poll 的排隊項（同一套 liveness 判準）。 */
function pruneQueue(entries, now = Date.now()) {
  return entries.filter((e) => {
    const t = Date.parse(e?.polledAt || e?.enqueuedAt || '')
    return Number.isFinite(t) && now - t <= HEARTBEAT_DEAD_MS
  })
}

/** 把自己排進佇列（已在其中則只更新 polledAt），回傳 pruned 後的整條佇列。 */
function enqueueSelf(o, id) {
  const me = holderSessionId(o)
  const now = new Date().toISOString()
  const entries = pruneQueue(readQueue(id))
  const mine = entries.find((e) => e.sessionId === me)
  if (mine) {
    mine.polledAt = now
    if (o.task) mine.task = o.task
  } else {
    entries.push({
      holderKind: holderKind(o),
      sessionId: me,
      task: o.task || null,
      enqueuedAt: now,
      polledAt: now,
    })
  }
  writeQueue(id, entries)
  return entries
}

function dequeueSelf(o, id) {
  const me = holderSessionId(o)
  writeQueue(
    id,
    pruneQueue(readQueue(id)).filter((e) => e.sessionId !== me),
  )
}

// ─────────────────────────────────────────────────────────────────────────
// arg 解析（保留 `--` 之後的整段當 cmd argv）
// ─────────────────────────────────────────────────────────────────────────

function parse(argv) {
  const o = {
    _: [], // positional（subcommand）
    cmd: null, // `--` 之後
    consumerMeta: null,
    app: null,
    session: null,
    cwd: process.cwd(),
    port: null,
    label: null,
    task: null,
    ttl: null, // ms；null = 未指定（agent → DEFAULT_TTL_MS，人類 → 無界）
    waitTimeout: DEFAULT_WAIT_TIMEOUT_MS,
    agent: false,
    kind: null,
    takeover: false,
    noLease: false,
    dryRun: false,
  }
  const sep = argv.indexOf('--')
  const head = sep === -1 ? argv : argv.slice(0, sep)
  if (sep !== -1) o.cmd = argv.slice(sep + 1)
  for (let i = 0; i < head.length; i++) {
    const a = head[i]
    const next = () => head[++i]
    switch (a) {
      case '--consumer-meta':
        o.consumerMeta = next()
        break
      case '--app':
        o.app = next()
        break
      case '--session':
        o.session = next()
        break
      case '--cwd':
        o.cwd = next()
        break
      case '--port':
        o.port = Number(next())
        break
      case '--label':
        o.label = next()
        break
      case '--task':
        o.task = next()
        break
      case '--ttl':
        o.ttl = parseDuration(next())
        break
      case '--wait-timeout':
        o.waitTimeout = parseDuration(next()) ?? DEFAULT_WAIT_TIMEOUT_MS
        break
      case '--agent':
        o.agent = true
        break
      case '--kind':
        o.kind = next()
        break
      case '--takeover':
        o.takeover = true
        break
      case '--no-lease':
        o.noLease = true
        break
      case '--dry-run':
        o.dryRun = true
        break
      case '-h':
      case '--help':
        o._.push('help')
        break
      default:
        if (!a.startsWith('-')) o._.push(a)
        break
    }
  }
  return o
}

// ─────────────────────────────────────────────────────────────────────────
// consumer / session / port 解析
// ─────────────────────────────────────────────────────────────────────────

function readConsumerMeta(p) {
  if (!p || !existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function resolveConsumerId(o, meta) {
  // key 名以 registry/consumer-meta.schema.json 為準：`consumerId`（camelCase）。
  // 曾經只讀 snake_case，對每一份符合 schema 的 manifest 都恆為 undefined，於是靜默
  // fallback 到目錄名推導 —— 目錄名剛好等於 consumerId 的 consumer 看不出異狀，改名或
  // clone 過的則拿到錯的 session 名與 lease 路徑。舊 key 保留作相容 fallback。
  if (meta?.consumerId) return meta.consumerId
  if (meta?.consumer_id) return meta.consumer_id

  // **MUST 解析 main worktree 的名字，不是當前 worktree 的目錄名。**
  //
  // `git rev-parse --show-toplevel` 在 linked worktree 內回的是**該 worktree 的路徑**
  // （例：.../<consumer-a>-wt/td-279-280-submit-chain），basename 就變成 slug 而不是 consumer 名。
  // 後果：lease 檔路徑算成 /tmp/<slug>-verification-lease.json —— 跟 main 用的
  // /tmp/<consumer>-verification-lease.json 是**不同檔案**。於是從 worktree 跑、又沒帶
  // --consumer-meta 的指令會靜默操作錯的 lease：release 釋放不到、conflict 偵測不到，
  // 跨 worktree 的 lease 隔離形同虛設（2026-07-26 <consumer-a> 實證：worktree 內 `stop` 後
  // /tmp/<consumer-a>-verification-lease.json 原封不動殘留）。 fixed-temp-path-exempt: 2026-07-26 事故的現場路徑，改寫等於竄改事故紀錄
  //
  // `--git-common-dir` 在 main 回 `<repo>/.git`、在 linked worktree 回
  // `<main-repo>/.git/worktrees/<slug>`；兩者的 dirname 往上找到 `.git` 的父層即 main worktree。
  const commonDir = sh('git', [
    '-C',
    o.cwd,
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ])
  if (commonDir) {
    // 去掉結尾的 /.git（linked worktree 會是 .../.git/worktrees/<slug>，先截到 .git）
    const gitIdx = commonDir.lastIndexOf('/.git')
    if (gitIdx > 0) return basename(commonDir.slice(0, gitIdx))
  }

  const top = sh('git', ['-C', o.cwd, 'rev-parse', '--show-toplevel'])
  if (top) return basename(top)
  return basename(o.cwd)
}

/**
 * 這次要起的 dev server 屬於哪些 repo 路徑（用來比對 herdr pane 的 cwd）。
 *
 * 回 main worktree root 與當前 toplevel 兩者：從 linked worktree 起 dev server 時，
 * consumer 的 workspace 裡放的多半是 main worktree 的 pane，只比對其中一邊會漏。
 */
function resolveRepoRoots(o) {
  const roots = []
  const commonDir = sh('git', [
    '-C',
    o.cwd,
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ])
  if (commonDir) {
    const gitIdx = commonDir.lastIndexOf('/.git')
    if (gitIdx > 0) roots.push(commonDir.slice(0, gitIdx))
  }
  const top = sh('git', ['-C', o.cwd, 'rev-parse', '--show-toplevel'])
  if (top) roots.push(top)
  if (!roots.length) roots.push(o.cwd)
  return [...new Set(roots)]
}

export function resolveSessionName(o, consumerId, port = null, primaryPort = null) {
  if (o.session) return o.session
  if (o.app) return `dev-${consumerId}-${o.app}`
  // port 分名與 leaseId 同規則：primary（或未知）維持舊名，非 primary 才加後綴。
  // 無條件加後綴會讓既有的 `dev-<consumer>` session 變孤兒。
  if (!port || !primaryPort || port === primaryPort) return `dev-${consumerId}`
  return `dev-${consumerId}-${port}`
}

// 從 cmd argv 找 `--port N`；或從 consumer-meta dev.ports 推
function resolvePort(o, meta) {
  if (o.port) return o.port
  if (o.cmd) {
    const i = o.cmd.indexOf('--port')
    if (i !== -1 && o.cmd[i + 1]) {
      const n = Number(o.cmd[i + 1])
      if (n) return n
    }
  }
  const ports = meta?.dev?.ports
  if (Array.isArray(ports) && ports.length) {
    if (o.app) {
      const m = ports.find((p) => p.alias === o.app || p.app === o.app)
      if (m?.port) return m.port
    }
    if (ports[0]?.port) return ports[0].port
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────
// port health
// ─────────────────────────────────────────────────────────────────────────

function portListening(port) {
  if (!port) return false
  const r = sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
  return !!(r && r.length)
}

function portPid(port) {
  if (!port) return null
  const r = sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
  return r ? r.split('\n')[0].trim() : null
}

function spawnStatusPath(cwd, port) {
  return join(cwd, '.review-gui', `spawn-${port}.json`)
}

/**
 * 結局檔給 review-gui 的 poll 讀。寫失敗要出聲——GUI 讀不到 = 自助頁永遠停在「正在啟動」。
 * 但寫失敗本身不改 exit 路徑（該 exit 1 的還是 exit 1）。
 */
function writeSpawnStatus(cwd, port, payload) {
  if (!cwd || !port) return
  try {
    mkdirSync(join(cwd, '.review-gui'), { recursive: true })
    writeFileSync(
      spawnStatusPath(cwd, port),
      JSON.stringify(
        {
          requestedPort: port,
          heardPort: null,
          message: null,
          herdrTab: null,
          // 消費端的 stale 判定靠這個 pid 分辨「還在起（可能卡在無上限的 backing service
          // 補建）」與「起動程序已經消失」。NEVER 拿它當「dev server 的 pid」——它是
          // dev-session 自己，dev server 由 herdr 持有（見 writeLease 的 devServer.pid）。
          pid: process.pid,
          updatedAt: new Date().toISOString(),
          ...payload,
        },
        null,
        2,
      ) + '\n',
    )
  } catch (e) {
    err(`[dev-session] 寫不進 spawn status（${spawnStatusPath(cwd, port)}）：${e?.message ?? e}`)
  }
}

/**
 * 這個 cwd 裡現在有誰在聽。用來抓「請求 3070、實際綁 3000」——只盯請求 port 會把它
 * 退化成 90s 逾時，外觀與還在編譯完全相同。
 */
function listeningPortsForCwd(cwd) {
  if (!cwd) return []
  let wanted = cwd
  try {
    wanted = realpathSync(cwd)
  } catch {
    /* keep cwd */
  }
  const raw = sh('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pPn'])
  if (!raw) return []
  const ports = []
  let pid = null
  for (const line of raw.split('\n')) {
    if (line.startsWith('p')) {
      pid = line.slice(1)
      continue
    }
    if (!line.startsWith('n') || !pid) continue
    const m = line.match(/:(\d+)\s*$/)
    if (!m) continue
    try {
      if (realpathSync(`/proc/${pid}/cwd`) === wanted) ports.push(Number(m[1]))
    } catch {
      /* pid 已消失或沒權限讀 cwd */
    }
  }
  return [...new Set(ports)]
}

// ─────────────────────────────────────────────────────────────────────────
// 外來占用分類（foreign-misbound → 自動回收）
//
// 為什麼是分類而不是一律 refuse：port 的**分配**層早就切乾淨了（registry/consumers.json
// 給每個 consumer 一個 base + base+1..+9 + 一段 50 號的 worktree band），缺的只有
// **runtime enforcement** —— 沒有任何東西擋「process 綁到不屬於它的 port」。而原本那句
// 「先確認該程序是什麼」就是「agent 回頭問人怎麼搶回來」的唯一來源，儘管它有能力自己判：
// listener 的 /proc/<pid>/cwd 指得出它屬於哪個 consumer，registry 說得出那個 port 屬於誰。
//
// 2026-09-02 實例：<consumer-b> 要收 evidence，3000 被 <consumer-a> 的一支重複 nuxt dev 佔著
// （cmdline 寫 `--port 3040`、實際聽 3000、cwd 在 <consumer-a>），而 <consumer-a> 現役的 3040 由另一支
// pid 持有。分配層對這件事完全正確，沒有任何一層在 runtime 說「你綁錯了」。
//
// **判得出「它綁錯了」才回收，判不出一律維持 refuse。** 缺一即非 foreign-misbound：
// registry 讀得到 / self 與 owner 都解得出且不同 / listener 是 dev server 型態 /
// port 屬於 self / port 不屬於 owner / 沒有人類租約持有它。
// **NEVER** 把任何一條改成「大概是」——回收是破壞性動作，多問一次的成本遠低於殺掉別人
// 正在收 evidence 的 dev server。

/** review-gui 的常駐 port。它是驗收介面本身，殺掉等於把眼睛挖掉。 */
const RECLAIM_NEVER_PORTS = new Set([5174])
/** 常駐服務的 cmdline 特徵。dev-router 是 3000 的 L4 前門，回收它會斷掉所有 worktree 的 tunnel。 */
const RECLAIM_NEVER_CMD_RE = /review-gui|dev-router/
/**
 * dev server 型態。**這是前置條件不是加分項**：不匹配一律維持 refuse ——
 * 一個判不出是什麼的 listener，唯一安全的處置是問人。
 */
const DEV_SERVER_CMD_RE =
  /(?:^|[\s/])(?:nuxt|nuxi|vite|next|astro)(?:[\s/]|$)|node[\s/][^\s]*.*\bdev\b/

/** 這個 pid 的 cmdline（NUL → space）。讀不到回 null（pid 已消失 / 沒權限）。 */
function procCmdline(pid) {
  if (!pid) return null
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ')
  } catch {
    return null
  }
}

/** 這個 pid 的 cwd（realpath）。讀不到回 null。 */
function procCwd(pid) {
  if (!pid) return null
  try {
    return realpathSync(`/proc/${pid}/cwd`)
  } catch {
    return null
  }
}

/**
 * clade registry 目錄。consumer 端跑的是投影副本（`<consumer>/scripts/dev-session.ts`），
 * 上推三層找不到 registry，所以 fallback 到 clade home —— 與 review-gui.ts /
 * audit-screenshot-*.ts 同一個 fallback 慣例。找不到回 null，分類器據此退回 refuse。
 */
let registryDirCache
function cladeRegistryDir() {
  if (registryDirCache !== undefined) return registryDirCache
  const cands = []
  if (process.env.CLADE_HOME) cands.push(join(process.env.CLADE_HOME, 'registry'))
  cands.push(resolve(fileURLToPath(import.meta.url), '..', '..', '..', 'registry'))
  if (process.env.HOME) cands.push(join(process.env.HOME, 'offline', 'clade', 'registry'))
  registryDirCache = cands.find((d) => existsSync(join(d, 'consumers.json'))) ?? null
  return registryDirCache
}

/**
 * 每個 consumer 的地盤：檔案系統 root（含 `<id>-wt/` 底下的 worktree）＋ port 分配。
 *
 * port 分配兩段，與 lib/worktree-dev-port.ts 的分配模型同源（base 池 `base..base+9`、
 * band 4200 區，`DEV_PORT_BAND` 直接 import 自那支）：**NEVER** 在這裡自己發明第三段 ——
 * 多一段就是第二份 matcher，它與真正的分配器漂開的那一刻，回收會殺到合法的 dev server。
 */
/**
 * consumer 的 checkout 都排在同一層（`<offlineRoot>/<id>` 與
 * `<offlineRoot>/<id>-wt/<slug>`，見 wt-helper.ts）。registry 在 `<cladeRoot>/registry/`，
 * 所以 offline root 是 clade root 的上一層 —— **除非 clade root 自己就是一條 worktree**。
 *
 * 這一格是實測抓到的：本檔在 `~/offline/clade-wt/<slug>/vendor/scripts/` 跑時，上推兩層
 * 得到 `~/offline/clade-wt`，於是**每一個** consumer root 都指向不存在的路徑、
 * territoryForCwd 對所有 cwd 回 null、分類器一律退回 refuse。而它的失敗是**靜默**的：
 * refuse 本來就是預設行為，沒有任何訊號說「分類器其實從來沒運作過」。
 * 而 dev server 正是最常從 worktree 起的東西 —— 錯的那一格就是唯一會用到的那一格。
 *
 * **NEVER** 寫死 `~/offline`：clade 可以被 clone 到任何位置，寫死之後這條判準在別台機器上
 * 同樣會靜默失效。
 */
export function offlineRootFromRegistryDir(registryDir) {
  const cladeRoot = resolve(registryDir, '..')
  const parent = resolve(cladeRoot, '..')
  return basename(parent).endsWith('-wt') ? resolve(parent, '..') : parent
}

export function consumerTerritories() {
  const dir = cladeRegistryDir()
  if (!dir) return null
  let list
  try {
    list = JSON.parse(readFileSync(join(dir, 'consumers.json'), 'utf8'))?.consumers
  } catch {
    return null
  }
  if (!Array.isArray(list)) return null
  let metaConsumers = {}
  try {
    metaConsumers =
      JSON.parse(readFileSync(join(dir, 'consumers-meta.json'), 'utf8'))?.consumers ?? {}
  } catch {
    /* 多 app 宣告缺席時退回 dev_ports.nuxt */
  }
  const offlineRoot = offlineRootFromRegistryDir(dir)
  const territories = []
  for (const c of list) {
    const id = c?.consumer_id
    if (!id) continue
    const bases = new Set<number>()
    if (Number.isInteger(c?.dev_ports?.nuxt)) bases.add(c.dev_ports.nuxt)
    for (const p of metaConsumers?.[id]?.declared?.dev?.ports ?? []) {
      if (Number.isInteger(p?.port)) bases.add(p.port)
    }
    const ports = new Set<number>()
    for (const b of bases) for (let n = b; n <= b + DEV_PORT_BAND; n++) ports.add(n)
    const band = c?.dev_ports?.worktree_band
    territories.push({
      id,
      roots: [join(offlineRoot, id), join(offlineRoot, `${id}-wt`)],
      ports,
      bands: Array.isArray(band) && band.length === 2 ? [[band[0], band[1]]] : [],
    })
  }
  return territories
}

export function ownsPort(territory, port) {
  if (territory.ports.has(port)) return true
  return territory.bands.some(([lo, hi]) => port >= lo && port <= hi)
}

/**
 * 這個 cwd 落在哪個 consumer 的地盤。取**最長**匹配 root：`~/offline/<consumer-h>` 與
 * `~/offline/<consumer-h>` 兩個 root 都是 registry 成員，短的先命中就會把
 * platform 的 worktree 判成 <consumer-h> 的。
 */
export function territoryForCwd(territories, cwd) {
  if (!cwd) return null
  let best = null
  let bestLen = -1
  for (const t of territories) {
    for (const root of t.roots) {
      let r = root
      try {
        r = realpathSync(root)
      } catch {
        /* root 不存在（consumer 沒 clone 到本機）也照樣字串比對 */
      }
      if ((cwd === r || cwd.startsWith(r + '/')) && r.length > bestLen) {
        best = t
        bestLen = r.length
      }
    }
  }
  return best
}

/**
 * 這個 pid / port 是不是某個**人類** lease 的 dev server。人類租約無界、NEVER 自動回收
 *（見檔頭 broker 段）—— 而 step 2 的 lease gate 只看 `(self consumer, port)` 那一把，
 * 對「人在別的 consumer id 底下持有這台」完全盲。回收前 MUST 自己掃一次整個 LEASE_DIR。
 *
 * 掃不到（讀不了目錄）時回一個 sentinel 而不是 null —— 判不出來要 fail closed。
 */
export function humanLeaseHolding(pid, port) {
  let files
  try {
    files = readdirSync(LEASE_DIR).filter((f) => f.endsWith('-verification-lease.json'))
  } catch {
    return { holder: { kind: 'unknown', label: 'lease 目錄讀不到，保守視為有人持有' } }
  }
  for (const f of files) {
    let lease
    try {
      lease = JSON.parse(readFileSync(join(LEASE_DIR, f), 'utf8'))
    } catch {
      continue
    }
    const d = lease?.devServer
    if (!d) continue
    const matches =
      (pid && Number(d.pid) === Number(pid)) || (port && Number(d.port) === Number(port))
    if (!matches) continue
    // 無界租約（`expiresAt === null`）即人類租約 —— 兩個判準同源，見 writeLease。
    if (lease?.holder?.kind === 'human' || lease?.expiresAt === null) return lease
  }
  return null
}

/**
 * 外來占用分類。`foreign-misbound` 才回收；其餘一律讓 caller 維持 refuse 並印出 `why`。
 */
export function classifySquatter({ port, pid, selfConsumerId, territories: injected = null }) {
  // owner / cwd / cmd 在每一個分支都出現，缺席時填 null —— 讓 caller 拿到單一形狀，
  // NEVER 讓「判不出來」與「這個欄位不存在」變成兩種要各自處理的情況。
  const nope = (verdict, why) => ({ verdict, why, owner: null, cwd: null, cmd: null })
  const n = Number(port)
  if (!pid) return nope('unknown', 'listener pid 查不到')
  if (RECLAIM_NEVER_PORTS.has(n)) return nope('protected', `port ${n} 是 review-gui 的常駐號碼`)
  const cmd = procCmdline(pid)
  if (!cmd) return nope('unknown', `讀不到 PID ${pid} 的 cmdline`)
  if (RECLAIM_NEVER_CMD_RE.test(cmd))
    return nope('protected', 'listener 是 review-gui / dev-router 常駐服務')
  if (!DEV_SERVER_CMD_RE.test(cmd))
    return nope('unknown', `listener 不是 dev server 型態（${cmd.slice(0, 120)}）`)
  if (!selfConsumerId)
    return nope('unknown', '本 session 的 consumer_id 解不出（缺 --consumer-meta）')
  const territories = injected ?? consumerTerritories()
  if (!territories) return nope('unknown', 'clade registry 讀不到，無法判 port 歸屬')
  const self = territories.find((t) => t.id === selfConsumerId)
  if (!self) return nope('unknown', `registry 沒有 consumer ${selfConsumerId}`)
  const cwd = procCwd(pid)
  if (!cwd) return nope('unknown', `讀不到 PID ${pid} 的 cwd`)
  const owner = territoryForCwd(territories, cwd)
  if (!owner) return nope('unknown', `PID ${pid} 的 cwd 不屬於任何 registry consumer（${cwd}）`)
  if (owner.id === selfConsumerId)
    return nope('unknown', `PID ${pid} 的 cwd 也屬於 ${selfConsumerId}，不是外來程序`)
  if (!ownsPort(self, n)) return nope('unknown', `port ${n} 不在 ${selfConsumerId} 的分配內`)
  if (ownsPort(owner, n))
    return nope('unknown', `port ${n} 也在 ${owner.id} 的分配內，兩邊都宣告 → 交給人判`)
  const human = humanLeaseHolding(pid, n)
  if (human)
    return nope(
      'human-lease',
      `PID ${pid} 由人類租約持有（${human.holder?.label ?? human.holder?.kind}）`,
    )
  return {
    verdict: 'foreign-misbound',
    why: `${owner.id} 的程序綁到 ${selfConsumerId} 的 port ${n}`,
    owner,
    cwd,
    cmd,
  }
}

/**
 * SIGTERM → 等 5s → SIGKILL。回 true 代表 port 真的放掉了。
 *
 * 等待綁「port 不再有人聽」這個可觀察事件，**NEVER** 只等 pid 消失 —— dev server 的
 * child 才是真正持有 socket 的那一個，parent 先走不代表 port 放掉了。每一輪重解一次
 * listener pid，正是為了在 parent 死後打到那個 child。
 */
export async function reclaimSquatter(port, firstPid) {
  const rounds: [NodeJS.Signals, number][] = [
    ['SIGTERM', 5_000],
    ['SIGKILL', 3_000],
  ]
  for (const [sig, waitMs] of rounds) {
    if (!portListening(port)) return true
    const pid = Number(portPid(port)) || Number(firstPid)
    try {
      process.kill(pid, sig)
    } catch {
      /* 已經不在 */
    }
    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
      await sleep(250)
      if (!portListening(port)) return true
    }
  }
  return !portListening(port)
}

/**
 * 殺掉本 cwd 底下綁到「不是請求的那個 port」的 listener，回報殺了哪些、跳過哪些。
 *
 * 治本那半。上游沒有 `strictPort`：Nuxt / listhen 在請求的 port 被佔住時**靜默換一個**，
 * 而換到的號碼幾乎必然屬於別人 —— registry 把各 consumer 的 base 排成 +10 間距，中間的
 * 空號全是別人的地盤。2026-09-02 實證：<consumer-a> 請求 3040（被自家 worktree 的 dev server
 * 佔著）→ 靜默落到 3000 → 撞進 <consumer-b> 的分配，<consumer-b> 那邊收不了 evidence。
 *
 * 所以偵測到 heard ≠ requested 時 **MUST 殺掉再 fail，NEVER 只 fail 留著它**：留著的那支
 * 會一直佔著別人的號碼，而下一次起 dev 只會再撞一次同一個 fallback ——「只 fail」把一次
 * 意外變成一個常駐的衝突源。事後偵測 + 殺是這裡唯一可行的 enforcement。
 *
 * **保護判準與 classifySquatter 同一組常數**（`RECLAIM_NEVER_*` / `DEV_SERVER_CMD_RE`）：
 * 同一個 cwd 底下不是只有 dev server —— review-gui 從 consumer root 起就跟它同 cwd，
 * 在這裡自己寫第二套「哪些不能殺」等於保證兩邊有一天會漂開。
 */
export async function killStrayListeners(cwd, requestedPort) {
  const stray = listeningPortsForCwd(cwd).filter((p) => p !== requestedPort)
  const killed = []
  const spared = []
  for (const p of stray) {
    const pid = portPid(p)
    const cmd = procCmdline(pid) ?? ''
    if (RECLAIM_NEVER_PORTS.has(p) || RECLAIM_NEVER_CMD_RE.test(cmd)) {
      spared.push({ port: p, pid, why: 'review-gui / dev-router 常駐服務' })
      continue
    }
    if (!DEV_SERVER_CMD_RE.test(cmd)) {
      spared.push({ port: p, pid, why: '不是 dev server 型態' })
      continue
    }
    if (await reclaimSquatter(p, pid)) killed.push({ port: p, pid })
    else spared.push({ port: p, pid, why: 'SIGKILL 後仍在聽' })
  }
  return { stray, killed, spared }
}

// ─────────────────────────────────────────────────────────────────────────
// herdr tab primitives
//
// 一個 durable dev session = 一個 herdr Tab，session 名記在 **pane 的 label**。
// tab_id / pane_id 由 herdr 指派、跨 process 呼叫（stop / sweep / status）拿不到，
// 一律用 label 反查現況。
//
// **identity 用 pane.label，不用 tab label**（2026-08-12 實測）：`tab create --label`
// 給的名字會被 pane 的第一次 terminal title 更新蓋掉——shell 依 cwd 設 title，於是
// `dev-probe` 在 dev 起來前就變成了 `tmp`，findSession 從此找不到自己剛建的 session。
// `pane rename` / `tab rename` 寫的是獨立於 title 的 label 欄，明確設定後不再被覆寫，
// 所以 createBackgroundTab **MUST** 在 create 之後補一次 rename。
// ─────────────────────────────────────────────────────────────────────────

/** 跑一個回 JSON 的 herdr 指令；非 0 或非 JSON 一律 null（caller 自行 fail-open / 報錯）。 */
function herdrJson(args) {
  const raw = sh('herdr', args)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * `herdr pane run` 的介面是 **command 字串**（`herdr pane run <PANE_ID> <COMMAND>...`），
 * 不是 argv 陣列——直接把 argv 用空白接起來會讓含空白 / 引號的參數在 pane 的 shell 內
 * 被重新斷詞。逐個 single-quote 才能保證 pane 內看到的 argv 與 caller 給的一致。
 */
function shellQuote(argv) {
  return argv.map((a) => `'${String(a).replaceAll("'", `'\\''`)}'`).join(' ')
}

// 回傳 [{ name, tabId, paneId, workspaceId }]（name = pane label）
function listHerdrTabs() {
  const panes = herdrJson(['pane', 'list'])?.result?.panes
  if (!Array.isArray(panes)) return []
  return panes
    .filter((p) => typeof p?.label === 'string' && p.label)
    .map((p) => ({
      name: p.label,
      tabId: p.tab_id,
      paneId: p.pane_id,
      workspaceId: p.workspace_id,
    }))
}

function listDevTabs() {
  return listHerdrTabs().filter((t) => t.name.startsWith('dev-'))
}

/**
 * herdr 沒有 zellij 的 EXITED session 概念：Tab 在就是在。「裡面的 dev 是否還活著」
 * 由 caller 用 port + lease 的 devServer.pid 判定（見 cmdLaunch），或用
 * devProcessAlive() 直接問 herdr 前景程序。
 */
function findSession(name) {
  return listHerdrTabs().find((t) => t.name === name) || null
}

/**
 * 前景還有沒有 dev 在跑。前景 process group == shell 本身 = 命令已結束、只剩 prompt，
 * 那個 Tab 就是殘骸（等同舊的 EXITED）。查不到資訊時回 true——**NEVER** 讓一個
 * 判不出來的 Tab 被 sweep 當成死的殺掉。
 */
function devProcessAlive(paneId) {
  if (!paneId) return true
  const info = herdrJson(['pane', 'process-info', '--pane', paneId])?.result?.process_info
  if (!info) return true
  const fg = info.foreground_process_group_id
  const shell = info.shell_pid
  if (typeof fg !== 'number' || typeof shell !== 'number') return true
  return fg !== shell
}

/**
 * 這台 dev server 的 Tab 該落在哪個 workspace；null = 沒有夠格的既有 workspace。
 *
 * herdr 的清單取不到時一律回 null（caller 會退回「建新 workspace」而非硬塞進當前
 * workspace）——猜錯歸屬正是本函式要修的病。
 */
function resolveDevWorkspaceId(consumerId, repoRoots) {
  const workspaces = herdrJson(['workspace', 'list'])?.result?.workspaces
  if (!Array.isArray(workspaces)) return null
  const panes = herdrJson(['pane', 'list'])?.result?.panes
  return chooseDevWorkspace({
    workspaces,
    panes: Array.isArray(panes) ? panes : [],
    consumerId,
    repoRoots,
  }).workspaceId
}

/**
 * 起一個 background Tab（不搶焦點），回 { tabId, paneId }。
 * 已存在同 label 的 Tab 時直接回它的 id，維持 zellij `attach --create-background`
 * 的 idempotent 語意。
 *
 * **MUST 顯式指定 workspace**：不帶 `--workspace` 時 herdr 把 Tab 建在當下 focused
 * workspace，而 agent 幾乎都從別的 repo（典型：clade）的 session 起 consumer 的 dev
 * server，於是每台 dev server 都堆在那個 repo 的 space 裡。`--cwd` 只管 shell 的工作
 * 目錄，對 Tab 歸屬零影響（2026-08-12 實證）。找不到該 consumer 的 workspace 就**建
 * 一個**，NEVER 退回不帶 `--workspace` 的寫法。
 */
function createBackgroundTab(name, cwd, ownership) {
  const existing = findSession(name)
  if (existing) return { tabId: existing.tabId, paneId: existing.paneId }

  const consumerId = ownership?.consumerId || name.replace(/^dev-/, '')
  const workspaceId = resolveDevWorkspaceId(consumerId, ownership?.repoRoots || [cwd])

  let res
  if (workspaceId) {
    res = herdrJson([
      'tab',
      'create',
      '--workspace',
      workspaceId,
      '--cwd',
      cwd,
      '--label',
      name,
      '--no-focus',
    ])?.result
  } else {
    // 建新 workspace 會連 Tab + root pane 一起建出來，回應形狀與 `tab create` 相同
    // （多一層 result.workspace）。
    out(`  找不到 ${consumerId} 的 herdr workspace → 新建一個（label: ${consumerId}）`)
    res = herdrJson([
      'workspace',
      'create',
      '--cwd',
      cwd,
      '--label',
      consumerId,
      '--no-focus',
    ])?.result
  }
  const tabId = res?.tab?.tab_id
  const paneId = res?.root_pane?.pane_id
  if (!tabId || !paneId) return null

  // create 的 --label 撐不過第一次 title 更新（見本區塊開頭）。rename 才是 identity 的落點：
  // pane 的給 findSession 用，tab 的給人在 UI 上認。
  sh('herdr', ['pane', 'rename', paneId, name])
  sh('herdr', ['tab', 'rename', tabId, name])
  return { tabId, paneId }
}

/** Tab 建立時已帶 --cwd，這裡不再 cd。 */
function runInTab(paneId, cmdArgv) {
  return sh('herdr', ['pane', 'run', paneId, shellQuote(cmdArgv)], { allowFail: false })
}

/** 關掉 Tab 連同裡面的 process（實測：Tab 一關，dev 的 port 立即 dead）。 */
function killSession(name) {
  const t = findSession(name)
  if (!t) return
  sh('herdr', ['tab', 'close', t.tabId])
}

// ─────────────────────────────────────────────────────────────────────────
// lease（相容 dev-singleton.ts schema v1；fail-open per verification-lease.md §7）
// ─────────────────────────────────────────────────────────────────────────

/**
 * Lease 檔名的 identity。**per (consumer, port)，不是 per consumer。**
 *
 * 為什麼不能只用 consumerId：一個 consumer 可以同時有多台合法、互不相干的 dev server ——
 * <consumer-a> 的 `dev:<client-a>`(3040) 與 `dev:shared`(3045) 是兩個不同的 app；再加上為了「一邊開發
 * 一邊人工檢查」而開的 review slot，就有三台。它們共用一個 lease 檔時，第二台一律被判成
 * 衝突（strict → refuse），於是平行變成不可能——而那個衝突是假的：它們根本沒有共用 port。
 *
 * **primary port 沿用舊檔名**（`/tmp/<consumer>-verification-lease.json`）。這不是美觀考量：
 * 規約、snippets、dev-signin template、wt-helper 的殘留清理都寫死這個路徑，改掉等於一次性
 * 讓所有既有讀者對不上，而它們讀的正是最常用的那一台。非 primary port 才加 `-<port>` 後綴。
 *
 * `primaryPort` 解不出來（沒有 consumer-meta）時一律回舊檔名 —— 未知不該製造新的檔名空間。
 */
function leaseId(consumerId, port, primaryPort) {
  if (!port || !primaryPort || port === primaryPort) return consumerId
  return `${consumerId}-${port}`
}

function leasePath(id) {
  return join(LEASE_DIR, `${id}-verification-lease.json`)
}

/** consumer-meta 的 primary port（`dev.ports[0]`）。解不出回 null。 */
function resolvePrimaryPort(meta) {
  const ports = meta?.dev?.ports
  if (Array.isArray(ports) && ports.length && ports[0]?.port) return ports[0].port
  return null
}

function holderKind(o) {
  if (o.kind) return o.kind
  return detectHolderKind()
}

function holderSessionId(o) {
  const id = detectSessionId()
  if (id) return id
  if (holderKind(o) === 'human') return 'human'
  return createHash('sha1').update(o.cwd).digest('hex').slice(0, 12)
}

function readLease(id) {
  const p = leasePath(id)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function pidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(Number(pid), 0)
    return true
  } catch {
    return false
  }
}

function writeLease(o, consumerId, sessionName, port, id) {
  try {
    const tab = findSession(sessionName)
    const now = Date.now()
    const ttlMs = claimTtlMs(o)
    const lease = {
      schemaVersion: '1',
      consumerId,
      claimedAt: new Date(now).toISOString(),
      // broker 三欄位。人類租約的 expiresAt 是 null（無界），ttlMs 同步為 null ——
      // 這兩者一起構成「NEVER 自動回收人類 lease」的唯一判準來源。
      task: o.task || null,
      ttlMs,
      expiresAt: ttlMs === null ? null : new Date(now + ttlMs).toISOString(),
      heartbeatAt: new Date(now).toISOString(),
      holder: {
        kind: holderKind(o),
        sessionId: holderSessionId(o),
        label: o.label || `dev-session ${sessionName}`,
      },
      devServer: {
        pid: port ? Number(portPid(port)) || null : null,
        // MUST 存正規化的絕對路徑：canonicalLeaseCwd() 讀回時不做 resolve()，
        // 相對路徑會被判為「無法確認」→ 保守 mismatch。
        cwd: canonicalCwd(o.cwd),
        port: port || null,
        url: port ? `http://127.0.0.1:${port}` : null,
      },
      // tabId / paneId 純供除錯與 log 追查。**NEVER** 拿它們當 identity 反查現況：
      // herdr 重建 Tab 後 id 會換，label（= name）才是穩定的 session 名。
      devSession: {
        multiplexer: 'herdr',
        name: sessionName,
        tabId: tab?.tabId ?? null,
        paneId: tab?.paneId ?? null,
      },
    }
    writeFileSync(leasePath(id), JSON.stringify(lease, null, 2) + '\n')
  } catch {
    /* fail-open */
  }
}

function releaseLease(o, id) {
  try {
    dequeueSelf(o, id)
    const lease = readLease(id)
    if (!lease) return
    const mine = lease.holder?.sessionId === holderSessionId(o)
    if (mine || !pidAlive(lease.devServer?.pid) || leaseReclaimable(lease))
      unlinkSync(leasePath(id))
  } catch {
    /* fail-open */
  }
}

// cwd 比對 MUST 正規化後再比。lease 內的 cwd 是寫入當下的 `o.cwd`，而 `--cwd` 由 caller 傳，
// 可能是相對路徑（`.` / `../<consumer-a>`）、帶結尾斜線、或走 symlink 的等價路徑。裸字串比對把這些
// 等價形式判成「不同 worktree」，兩個方向都會出錯：strict 模式對自己那台 refuse（擋掉合法
// 操作），或 --takeover 誤殺自己剛起的 dev server。
function canonicalCwd(p) {
  if (!p) return ''
  const abs = resolve(p) // 絕對化 + 去結尾斜線 + 收斂 `.` / `..`
  try {
    return realpathSync(abs) // 解 symlink（worktree 常經 symlink 路徑進入）
  } catch {
    return abs // 路徑已不存在（worktree 已移除）→ 至少 abs 比裸字串可靠
  }
}

// lease 檔內存的 cwd 專用。**NEVER 對它用 `resolve()`** —— resolve 會拿**當前** process
// 的 cwd 去解相對路徑，於是兩個不同 worktree 各自存 `.` 的 lease 都會被解析成「自己的」
// cwd、比對後相等，mismatch 檢查靜默失效並回報 reuse 成功。那比不檢查更危險：caller 拿到
// exit 0 就往下收 evidence，實際服務的是另一份 code。
//
// 寫入端（claim）存的一律是 canonicalCwd() 的絕對路徑；讀到非絕對路徑代表 lease 是舊格式
// 或被手改過 → 回 null，caller MUST 當成「無法確認」而非「相同」。
function canonicalLeaseCwd(p) {
  if (!p || !isAbsolute(p)) return null
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

// strict lease 衝突判定：別人持有 + 其 dev pid 還活 + cwd 不同 → refuse（除非 takeover）
function leaseConflict(o, id) {
  const lease = readLease(id)
  if (!lease) return null
  const mine = lease.holder?.sessionId === holderSessionId(o)
  if (mine) return null
  if (!pidAlive(lease.devServer?.pid)) return null // stale → 不算衝突
  // 有界性：agent 租約過期 / 心跳斷 → 可回收，不算衝突（下一個 agent 自動接手，不問 user）。
  // 人類租約在 leaseReclaimable() 內恆回 null，所以這條**不會**放行對人類 lease 的接管。
  if (leaseReclaimable(lease)) return null
  const leaseCwd = canonicalLeaseCwd(lease.devServer?.cwd)
  if (leaseCwd && leaseCwd === canonicalCwd(o.cwd)) return null // 同 cwd → 同工作
  return lease
}

// 服務的 code 對不對 —— **與 holder 是誰無關**。
//
// 這跟 leaseConflict() 是兩件事：leaseConflict 問「lease 被別人持有嗎」（ownership），
// 這裡問「正在跑的 dev server 服務的是不是我要的那份 code」（served code）。同一個 holder
// 在別的 worktree 起的 dev server，服務的仍然是別的 code —— 一樣危險。
//
// 必須拆開的實證原因：holderSessionId() 在沒有 CLAUDE_SESSION_ID / CODEX_SESSION_ID 時
// 一律回 'human'，於是所有這類 caller 的身分**塌縮成同一個**，leaseConflict() 開頭的
// `if (mine) return null` 會先短路，cwd 比對永遠走不到。
function servedCwdMismatch(o, id) {
  const lease = readLease(id)
  if (!lease) return null
  if (!pidAlive(lease.devServer?.pid)) return null // stale → 不算
  if (!lease.devServer?.cwd) return null // 無紀錄 → 由 caller 端 warn
  const leaseCwd = canonicalLeaseCwd(lease.devServer.cwd)
  if (leaseCwd && leaseCwd === canonicalCwd(o.cwd)) return null
  return lease // 含 leaseCwd === null（非絕對路徑，無法確認）→ 保守判為 mismatch
}

// launch / reuse 共用的 lease gate。
//
// **NEVER 讓 reuse 路徑跳過這道檢查。** 曾經的 bug：cmdLaunch 的「反累積 reuse」分支在
// 確認 port 有人聽之後就直接 return，從來走不到後面的 lease 衝突判定 —— 於是 caller 傳的
// `--cwd` 被靜默忽略，指令回 exit 0 + 「✓ reuse」，但實際服務的是**別的 working tree 的
// code**。任何 agent 照這個成功訊號往下收 evidence（截圖 / round-trip），拍到的都是錯的
// 版本，且外觀與成功無異 —— 比直接失敗危險得多。
function enforceLeaseOrExit(o, meta, consumerId, lid, port) {
  if (o.noLease) return null
  const strict = meta?.dev?.leaseMode === 'strict' || meta?.auth?.portPinned === true

  // (0) 有界性 gate — agent 租約過期 / 心跳斷 → 自動接管，**不問 user**。
  //
  // 這裡把 o.takeover 打開而不是自己動手殺，是為了走**既有的** takeover 路徑
  // （kill lease 記錄的 dev pid + killSession → 重建）。NEVER 在這裡自組 lsof + kill。
  //
  // 人類租約永遠走不到這條：leaseReclaimable() 對 `holder.kind === 'human'` 恆回 null。
  const existing = readLease(lid)
  const reclaim = leaseReclaimable(existing)
  if (reclaim && !o.takeover) {
    err(
      `[lease:${consumerId}] 前 holder ${existing.holder?.kind}:${existing.holder?.sessionId} 的 agent 租約已${reclaim === 'expired' ? '到期' : '心跳中斷（>180s）'} → 自動接管`,
    )
    if (existing.task) err(`  前一個 task: ${existing.task}`)
    o.takeover = true
  }

  // (1) served-code mismatch — 優先於 ownership 判定，因為它跟持有者是誰無關
  const mismatch = servedCwdMismatch(o, lid)
  if (mismatch && !o.takeover) {
    if (strict) {
      err(`[lease:${consumerId}] refuse — 既有 dev server 服務的不是你要的 working tree`)
      err(`  serving: ${mismatch.devServer?.cwd}`)
      err(`  你要的:  ${o.cwd}`)
      err(
        `  holder:  ${mismatch.holder?.kind}:${mismatch.holder?.sessionId}（since ${mismatch.claimedAt}）`,
      )
      err(`  dev:     PID ${mismatch.devServer?.pid}, port=${mismatch.devServer?.port}`)
      err(`  ⚠ 照這個 session 收 evidence 會拍到**錯的 code**。`)
      err(`  要接管請加 --takeover（會 kill 現有 dev process 後重建）。`)
      writeSpawnStatus(o.cwd, port, {
        status: 'failed',
        message: `[lease] refuse — 既有 dev server 服務的不是你要的 working tree（serving ${mismatch.devServer?.cwd}，你要的 ${o.cwd}）`,
      })
      process.exit(1)
    }
    err(`[lease:${consumerId}] ⚠ served cwd 不符（advisory 模式，不阻擋）`)
    err(`  serving: ${mismatch.devServer?.cwd}`)
    err(`  你要的:  ${o.cwd}`)
    err(`  你看到的畫面來自另一個 working tree，收 evidence 前請自行確認。`)
    return mismatch
  }
  if (mismatch && o.takeover) return mismatch

  // (2) ownership conflict — lease 被別人持有
  const conflict = leaseConflict(o, lid)
  if (!conflict) return null

  // takeover 由 caller 端處理（kill 前 holder），這裡只把 conflict 交回去
  if (o.takeover) return conflict

  if (strict) {
    err(
      `[lease:${consumerId}] 無法 claim — 已被 ${conflict.holder?.kind}:${conflict.holder?.sessionId} 持有`,
    )
    if (isAgentLease(conflict)) {
      const left = conflict.expiresAt ? Date.parse(conflict.expiresAt) - Date.now() : null
      err(
        `  這是**存活中的 agent 租約**（task: ${conflict.task || '未註明'}，剩餘 ${fmtDuration(left)}）`,
      )
      err(`  → 排隊等它到期：dev-session.ts wait --task "<你要做什麼>" -- <cmd>（不需問 user）`)
    } else {
      err(`  這是**人類租約（無界）**——agent NEVER 自動接管。`)
      err(`  → 把本訊息原樣呈給 user，由 user 決定要不要停掉自己的 dev server。`)
    }
    err(`  since:   ${conflict.claimedAt}`)
    err(
      `  dev:     PID ${conflict.devServer?.pid}, cwd=${conflict.devServer?.cwd}, port=${conflict.devServer?.port}`,
    )
    err(`  你要的:  cwd=${o.cwd}`)
    err(`  ⚠ cwd 不符代表既有 dev server 服務的是另一個 working tree 的 code。`)
    err(`  要強制接管請加 --takeover（會 log 前 holder 並 kill 其 dev process）。`)
    writeSpawnStatus(o.cwd, port, {
      status: 'failed',
      message: `[lease] 無法 claim — 已被 ${conflict.holder?.kind}:${conflict.holder?.sessionId} 持有`,
    })
    process.exit(1)
  }

  // advisory 模式不阻擋，但 cwd 不符 MUST 大聲 warn —— 沉默是本 bug 的危害來源。
  err(`[lease:${consumerId}] ⚠ cwd 不符（advisory 模式，不阻擋）`)
  err(`  既有 dev server 服務： ${conflict.devServer?.cwd}`)
  err(`  你要的：              ${o.cwd}`)
  err(`  你看到的畫面來自另一個 working tree，收 evidence 前請自行確認。`)
  return conflict
}

// ─────────────────────────────────────────────────────────────────────────
// commands
// ─────────────────────────────────────────────────────────────────────────

/**
 * 起 dev server 前確認這個 worktree 的 backing service（clone DB + PostgREST sidecar）還在。
 *
 * 為什麼非查不可：launcher 的成功判準是「port 有沒有 LISTENING」，而那對本問題**恆為真**
 * —— app 起得來、只是打不到 DB。於是第一個發現異常的是瀏覽器，拿到的又是 app 為「後端暫時
 * 抖動」寫的 503 文案，完全指不到 DB。修復成本 ≈ 0（兩個指令、數十秒），發現成本極高
 * （<consumer-b> 2026-07-31 實測十幾輪，中途還跟兩個無關的 dev server 症狀混淆）。這個不對稱就是
 * 把檢查前移的全部理由。
 *
 * 缺席 → 自動補建；補建失敗才 fail-loud 擋下，且訊息 **MUST 點名 backing service 本身與修復
 * 指令**，NEVER 只說「後端連線失敗」—— 那正是要消滅的那層代言。
 *
 * 沒有 per-worktree 拓樸的 consumer（絕大多數）在第一個 probe 就 `applicable:false` 退出，
 * 零行為改變。探針自身故障同樣走這條 —— tooling 面 fail-open，NEVER 因工具壞掉擋住開發。
 */
function preflightBackingService(o, port) {
  const probe = probeBackingService(o.cwd)
  if (!probe.applicable) return
  if (probe.state === 'ready') return

  const svc = probe.dbName ? `${probe.dbName}` : '(未命名)'
  out(`⏳ per-worktree backing service 未就緒（state=${probe.state}，${svc}）→ 自動補建…`)

  let ensureErr: string | null = null
  try {
    runWtEnvBootstrap(o.cwd, 'ensure')
  } catch (e) {
    ensureErr = (e as Error)?.message ?? String(e)
  }

  // ensure 的 exit 0 只代表「指令沒失敗」，不代表 service 真的起來了 —— 重新 probe 才算驗證。
  const after = ensureErr ? probe : probeBackingService(o.cwd)
  if (!ensureErr && after.applicable && after.state === 'ready') {
    out(
      `✓ backing service 已補建：${after.dbName ?? svc}${after.port ? ` (port ${after.port})` : ''}`,
    )
    return
  }

  const gapMsg = describeBackingServiceGap(
    after.applicable ? after : probe,
    ensureErr ?? `補建後 state 仍為 ${after.state}`,
  )
  err(gapMsg)
  writeSpawnStatus(o.cwd, port, { status: 'failed', message: gapMsg })
  process.exit(1)
}

async function cmdLaunch(o) {
  // port 先於一切失敗分支解出來：結局檔以 port 定址（spawn-<port>.json），早退路徑若只拿
  // o.port（caller 沒帶 --port、port 其實來自 consumer-meta 時為 null）就寫不進正確的檔，
  // GUI 讀到的仍是「starting」—— 黑洞的另一種長相。
  const meta = readConsumerMeta(o.consumerMeta)
  const port = resolvePort(o, meta)
  try {
    await runLaunch(o, meta, port)
  } catch (e) {
    // 沒被任何具名失敗分支接住的例外（herdr RPC / lease IO / probe 自爆…）也是一條
    // 「非零退出」路徑 —— 不回寫結局檔，自助頁就永遠停在「正在啟動」。
    writeSpawnStatus(o.cwd, port, {
      status: 'failed',
      message: `dev-session 意外中止：${e?.message ?? e}`,
    })
    throw e
  }
}

async function runLaunch(o, meta, port) {
  if (!o.cmd || !o.cmd.length) {
    const msg = '用法：dev-session.ts [opts] -- <cmd...>（缺少 `-- <cmd>`）'
    writeSpawnStatus(o.cwd, port, { status: 'failed', message: msg })
    err(msg)
    process.exit(1)
  }
  if (!herdrAvailable()) {
    const msg = herdrUnavailableReason()
    writeSpawnStatus(o.cwd, port, { status: 'failed', message: msg })
    for (const line of msg.split('\n')) err(line)
    err('  **NEVER** 退回 `run_in_background` / setsid / nohup —— 那些一律會被 harness reap。')
    process.exit(1)
  }

  const consumerId = resolveConsumerId(o, meta)
  const primaryPort = resolvePrimaryPort(meta)
  const sessionName = resolveSessionName(o, consumerId, port, primaryPort)
  // lease identity 綁 (consumer, port)：同 consumer 的不同 app / review slot 是不同 lease
  const lid = leaseId(consumerId, port, primaryPort)
  const urlHint = port ? `http://127.0.0.1:${port}` : '(port 未知)'

  // 0) per-worktree backing service 存在性檢查（per rules/core/db-preview-env.md § 缺席側）。
  //
  //    **MUST 排在 reuse 判定之前**：reuse 分支同樣是「使用者要求起 dev server」的結果，而
  //    clone / sidecar 是在 session 存活期間被 reconcile / 手動清理 / 主機重啟拿掉的 —— 只檢查
  //    重建路徑，等於放過最常見的那一種缺席。
  preflightBackingService(o, port)

  // 1) 反累積：起前先查 existing session
  const existing = findSession(sessionName)
  if (existing) {
    // 「有人在聽 port」不等於「聽的是我們這個 session 的 dev」。Tab 還在、
    // 但裡面的 dev 已死、port 隨即被別的程序接手時，只驗 portListening 會走進 reuse 分支
    // 宣告成功（lease 也還在且 cwd 相符），caller 於是在**外來程序**上收 evidence，
    // 而外觀與正常成功完全相同。lease 的 devServer.pid 記的就是當初的 port listener pid
    // （見 writeLease），拿它跟現況比對即可辨識。
    const leasePid = readLease(lid)?.devServer?.pid
    const listenerPid = port ? portPid(port) : null
    const portHijacked =
      Boolean(port) &&
      Boolean(listenerPid) &&
      Boolean(leasePid) &&
      Number(listenerPid) !== Number(leasePid)

    if (portHijacked) {
      err(`session ${sessionName} 存在，但 port ${port} 的 listener 已換人`)
      err(`  lease 記錄 PID ${leasePid}，實際在聽的是 PID ${listenerPid}`)
      err(`  不 reuse（會在外來程序上收 evidence），改重建`)
    } else if (!port || portListening(port)) {
      // reuse 前 MUST 過 lease gate — cwd 不符時 strict 模式直接 refuse。
      // 這裡曾是靜默漏洞：直接 return 導致 --cwd 被忽略、caller 在錯的 code 上收 evidence。
      const conflict = enforceLeaseOrExit(o, meta, consumerId, lid, port)

      // --takeover + cwd 不符：caller 明確要接管，reuse 別人那台等於沒接管 → 改重建
      if (conflict && o.takeover) {
        err(
          `[lease:${consumerId}] --takeover：既有 session 服務 ${conflict.devServer?.cwd}，不 reuse，改重建`,
        )
        if (pidAlive(conflict.devServer?.pid)) sh('kill', [String(conflict.devServer.pid)])
        killSession(sessionName)
      } else {
        // reuse 且原 lease 已可回收（或根本沒 lease）→ 接手成為 holder。
        // 只在這兩種情形改寫 holder：**NEVER** 從一個存活中的 holder 手上把 lease 記錄抹掉
        // 卻繼續用他的 dev server —— 那會讓他的 release 找不到自己的 lease。
        if (!o.noLease) {
          const cur = readLease(lid)
          if (!cur || leaseReclaimable(cur)) writeLease(o, consumerId, sessionName, port, lid)
          dequeueSelf(o, lid)
        }
        const servedCwd = readLease(lid)?.devServer?.cwd
        out(`✓ reuse 既有 durable dev session（反累積，不重起）`)
        out(`  session: ${sessionName}  ｜  ${urlHint}`)
        if (servedCwd) {
          out(`  serving: ${servedCwd}`)
        } else {
          err(`  ⚠ 無 lease 紀錄，無法確認此 session 服務哪個 working tree。`)
          err(`    收 evidence 前請自行驗：ls -l /proc/<dev-pid>/cwd`)
        }
        out(`  看畫面：herdr tab focus ${existing.tabId}`)
        out(`  停止：  node scripts/dev-session.ts stop --session ${sessionName}`)
        writeSpawnStatus(o.cwd, port, {
          status: 'ready',
          heardPort: port,
          herdrTab: existing.tabId,
        })
        return
      }
    }
    // 走到這裡代表不 reuse：port 沒在聽（內部 dev 已死）、listener 換人、或 --takeover 要重建。
    // 前兩者的原因已在上面各自印過，這裡只補「port 沒在聽」那條。
    if (!portHijacked) {
      err(`session ${sessionName} 存在但 port ${port} 沒在聽 → 視為內部 dev 已死，重建`)
    }
    killSession(sessionName)
  }

  // 2) lease（strict 衝突 refuse）— 與 reuse 路徑共用同一個 gate，避免兩處邏輯漂移
  if (!o.noLease) {
    const conflict = enforceLeaseOrExit(o, meta, consumerId, lid, port)
    if (conflict && o.takeover) {
      err(
        `[lease:${consumerId}] --takeover：接管 ${conflict.holder?.kind}:${conflict.holder?.sessionId} 的 lease`,
      )
      if (pidAlive(conflict.devServer?.pid)) sh('kill', [String(conflict.devServer.pid)])
    }
  }

  // 2.5) 外來占用分類。走到這裡代表沒有可 reuse 的活 session，所以 port 若已經有人在聽，
  // 那個 listener 一定不是我們起的。不擋的話：新 session 內的 dev 撞 EADDRINUSE 立刻死，
  // 但 step 4 的 ready loop 第一次 poll 就看到 listener → 宣告 ready + 寫 lease，
  // caller 於是在別的程序上收 evidence，而 lease 指向一個我們並不擁有的 dev server。
  //
  // **擋不等於問人。** classifySquatter 判得出「別的 consumer 的 dev server 綁到了本
  // consumer 的號碼」（foreign-misbound）時直接回收 —— 那件事 registry 早就有答案，
  // 把它變成一個問題丟回給 user 是這條路徑唯一的成本來源。判不出來才 refuse，
  // 而 refuse 的訊息現在會帶上 `why`：說不出哪一條前提沒過的 refuse 等於沒說明。
  if (port && portListening(port)) {
    const squatter = portPid(port)
    const verdict = classifySquatter({ port, pid: squatter, selfConsumerId: consumerId })
    if (verdict.verdict === 'foreign-misbound') {
      out(
        `[dev-session] 回收 ${verdict.owner.id}:${squatter}（cwd ${verdict.cwd}）綁錯 port ${port}`,
      )
      if (!(await reclaimSquatter(port, squatter))) {
        const msg = `port ${port} 上 ${verdict.owner.id} 的程序（PID ${squatter}）SIGKILL 後仍在聽`
        err(`[dev-session] ${msg}`)
        writeSpawnStatus(o.cwd, port, { status: 'failed', message: msg })
        process.exit(1)
      }
    } else {
      err(`[dev-session] port ${port} 已被非本 session 的程序占用（PID ${squatter}）`)
      err(`  不自動回收：${verdict.why}`)
      err(`  同名 herdr Tab（${sessionName}）不存在，因此這不是可 reuse 的 durable session。`)
      err(`  先確認該程序是什麼，再擇一處理：`)
      err(`    - 若是舊的 dev server：node scripts/dev-session.ts stop --session ${sessionName}`)
      err(`    - 若是別的服務：換 port（--port <n>）或自行停掉該程序`)
      writeSpawnStatus(o.cwd, port, {
        status: 'failed',
        message: `port ${port} 已被非本 session 的程序占用（PID ${squatter}）：${verdict.why}`,
      })
      process.exit(1)
    }
  }

  // 3) 起 background Tab（不搶焦點）+ 把 dev 命令丟進它的 pane
  out(`▶ 起 durable dev session（herdr Tab）：${sessionName}`)
  out(`  cmd: ${o.cmd.join(' ')}`)
  out(`  cwd: ${o.cwd}`)
  const tab = createBackgroundTab(sessionName, o.cwd, {
    consumerId,
    repoRoots: resolveRepoRoots(o),
  })
  if (!tab) {
    const msg = `herdr Tab 建立失敗（${sessionName}）—— 沒有拿到 tab_id / pane_id。先確認 herdr status，再重跑。`
    writeSpawnStatus(o.cwd, port, { status: 'failed', message: msg })
    err(`[dev-session] herdr Tab 建立失敗（${sessionName}）—— 沒有拿到 tab_id / pane_id`)
    err(`  先確認 \`herdr status\`，再重跑。**NEVER** 退回 run_in_background。`)
    process.exit(1)
  }
  runInTab(tab.paneId, o.cmd)

  // 4) 等 port ready（若 port 已知）
  if (!port) {
    out(`✓ 已丟進 herdr Tab ${sessionName}（port 未知，無法輪詢）`)
    out(`  看畫面：herdr tab focus ${tab.tabId}`)
    return
  }
  const start = Date.now()
  while (Date.now() - start < READY_TIMEOUT_MS) {
    await sleep(READY_POLL_MS)
    if (portListening(port)) {
      if (!o.noLease) {
        writeLease(o, consumerId, sessionName, port, lid)
        dequeueSelf(o, lid)
        const ttl = claimTtlMs(o)
        if (ttl !== null) {
          out(
            `  租約：agent，${fmtDuration(ttl)}（續租：dev-session.ts heartbeat；用完請 release）`,
          )
        }
      }
      out(
        `✓ durable dev ready：${urlHint}（session ${sessionName}，掛在 herdr server 不會被 harness reap）`,
      )
      out(`  看畫面：herdr tab focus ${tab.tabId}`)
      out(`  停止：  node scripts/dev-session.ts stop --session ${sessionName}`)
      writeSpawnStatus(o.cwd, port, {
        status: 'ready',
        heardPort: port,
        herdrTab: tab.tabId,
      })
      return
    }
    // 請求 A、聽到 B：上游靜默換 port 了。**殺掉再 fail** —— 留著它就是留下一個佔著
    // 別人號碼的常駐衝突源（見 killStrayListeners 的成因段）。
    const strayPorts = listeningPortsForCwd(o.cwd).filter((p) => p !== port)
    if (strayPorts.length) {
      const { killed, spared } = await killStrayListeners(o.cwd, port)
      const msg = `請求 ${port}、聽到 ${strayPorts[0]}（上游沒有 strictPort，靜默換了號碼）`
      err(`⚠ ${msg}`)
      for (const k of killed) err(`  已殺掉綁錯號碼的 listener：port ${k.port}（PID ${k.pid}）`)
      for (const sp of spared) err(`  保留 port ${sp.port}（PID ${sp.pid}）：${sp.why}`)
      err(`  真因通常是請求的 ${port} 當時被別人佔著。session ${sessionName} 保留供檢查：`)
      err(`  herdr tab focus ${tab.tabId}（看 dev 卡在哪）`)
      writeSpawnStatus(o.cwd, port, {
        status: 'failed',
        heardPort: strayPorts[0],
        message: msg,
        herdrTab: tab.tabId,
      })
      process.exit(1)
    }
  }
  const timeoutMsg = `⚠ 啟動逾時（${READY_TIMEOUT_MS}ms）port ${port} 仍未聽。session ${sessionName} 保留供檢查： herdr tab focus ${tab.tabId}`
  err(`⚠ 啟動逾時（${READY_TIMEOUT_MS}ms）port ${port} 仍未聽。session ${sessionName} 保留供檢查：`)
  err(`  herdr tab focus ${tab.tabId}（看 dev 卡在哪）`)
  writeSpawnStatus(o.cwd, port, {
    status: 'failed',
    message: timeoutMsg,
    herdrTab: tab.tabId,
  })
  process.exit(1)
}

function cmdStatus(o) {
  const meta = readConsumerMeta(o.consumerMeta)
  const consumerId = resolveConsumerId(o, meta)
  const port = resolvePort(o, meta)
  const primaryPort = resolvePrimaryPort(meta)
  const sessionName = resolveSessionName(o, consumerId, port, primaryPort)
  const lid = leaseId(consumerId, port, primaryPort)
  const s = findSession(sessionName)
  out(`dev-session status — ${sessionName}`)
  out(
    `  herdr tab: ${s ? `${s.tabId}（${devProcessAlive(s.paneId) ? '有前景程序' : '只剩 shell — dev 已退出'}）` : '不存在'}`,
  )
  if (port) out(`  port ${port}: ${portListening(port) ? `LISTENING（${urlOf(port)}）` : '沒在聽'}`)
  const lease = readLease(lid)
  if (lease) {
    out(
      `  lease holder: ${lease.holder?.kind}:${lease.holder?.sessionId}  cwd=${lease.devServer?.cwd}`,
    )
    out(`  task: ${lease.task || '（未註明）'}`)
    if (!isAgentLease(lease)) {
      out(`  租約: 人類（無界）—— agent NEVER 自動接管`)
    } else if (!lease.expiresAt) {
      out(`  租約: agent（舊格式，無 expiresAt）—— 不自動回收`)
    } else {
      const reclaim = leaseReclaimable(lease)
      const left = Date.parse(lease.expiresAt) - Date.now()
      out(
        `  租約: agent，剩餘 ${fmtDuration(left)}${reclaim ? `（可回收：${reclaim}）` : ''}  heartbeat=${lease.heartbeatAt || '—'}`,
      )
    }
  } else out(`  lease: 無`)
  const queue = pruneQueue(readQueue(lid))
  out(`  佇列: ${queue.length} 個等待中`)
  for (const [i, e] of queue.entries()) {
    out(
      `    ${i + 1}. ${e.holderKind}:${e.sessionId} — ${e.task || '（未註明）'}（自 ${e.enqueuedAt}）`,
    )
  }
}

/**
 * 續租。**只有 holder 自己能續**——別人續租等於延長不屬於自己的所有權，
 * 那會讓「過期就能自動接管」這條保證失效。
 */
function cmdHeartbeat(o) {
  const meta = readConsumerMeta(o.consumerMeta)
  const consumerId = resolveConsumerId(o, meta)
  const port = resolvePort(o, meta)
  const lid = leaseId(consumerId, port, resolvePrimaryPort(meta))
  const lease = readLease(lid)
  if (!lease) {
    err(`[lease:${consumerId}] 無 lease 可續租（是否已被回收？重跑 start / wait）`)
    process.exit(1)
  }
  if (lease.holder?.sessionId !== holderSessionId(o)) {
    err(
      `[lease:${consumerId}] 你不是 holder（現持有者 ${lease.holder?.kind}:${lease.holder?.sessionId}），拒絕續租`,
    )
    process.exit(1)
  }
  if (!isAgentLease(lease)) {
    out(`[lease:${consumerId}] 人類租約無界，不需要續租`)
    return
  }
  const now = Date.now()
  const ttlMs = o.ttl ?? lease.ttlMs ?? DEFAULT_TTL_MS
  lease.ttlMs = ttlMs
  lease.heartbeatAt = new Date(now).toISOString()
  lease.expiresAt = new Date(now + ttlMs).toISOString()
  if (o.task) lease.task = o.task
  try {
    writeFileSync(leasePath(lid), JSON.stringify(lease, null, 2) + '\n')
  } catch (e) {
    err(`[lease:${consumerId}] 續租寫檔失敗：${(e as Error)?.message ?? e}`)
    process.exit(1)
  }
  out(`✓ 續租 ${fmtDuration(ttlMs)}（到期 ${lease.expiresAt}）`)
}

/** 主動釋放 lease（不動 herdr Tab）——task 做完就該放手，別讓下一個 agent 等到 TTL 到期。 */
function cmdRelease(o) {
  const meta = readConsumerMeta(o.consumerMeta)
  const consumerId = resolveConsumerId(o, meta)
  const lid = leaseId(consumerId, resolvePort(o, meta), resolvePrimaryPort(meta))
  const before = readLease(lid)
  releaseLease(o, lid)
  if (before && existsSync(leasePath(lid))) {
    out(`[lease:${consumerId}] 你不是 holder 且對方仍存活 —— 未釋放（no-op）`)
    return
  }
  out(`✓ 已釋放 lease${before?.task ? `（task: ${before.task}）` : ''}`)
}

/**
 * 排隊等 slot，取得後直接接手（含把 dev server 切到本次的 cwd）。
 *
 * 分流與 [[verification-lease]] 的 predicate 表一致：
 *   - lease 不存在 / agent 租約已過期或心跳斷 → 立刻接手，**不問 user**
 *   - agent 租約仍存活 → 排隊 poll，**不問 user**；逾時才 exit 1 回報
 *   - **人類租約 → 立刻 refuse**，訊息原樣呈給 user（排隊也沒有意義：它無界，等不到）
 */
async function cmdWait(o) {
  if (!o.cmd || !o.cmd.length) {
    err('用法：dev-session.ts wait [opts] -- <cmd...>（缺少 `-- <cmd>`）')
    process.exit(1)
  }
  const meta = readConsumerMeta(o.consumerMeta)
  const consumerId = resolveConsumerId(o, meta)
  const lid = leaseId(consumerId, resolvePort(o, meta), resolvePrimaryPort(meta))
  const me = holderSessionId(o)
  const deadline = Date.now() + o.waitTimeout

  for (;;) {
    const lease = readLease(lid)
    const held =
      lease &&
      lease.holder?.sessionId !== me &&
      pidAlive(lease.devServer?.pid) &&
      !leaseReclaimable(lease)

    if (held && !isAgentLease(lease)) {
      dequeueSelf(o, lid)
      err(`[lease:${consumerId}] 人類租約（無界）持有中 —— agent NEVER 自動接管，也無從排隊。`)
      err(`  holder: ${lease.holder?.kind}:${lease.holder?.sessionId}（since ${lease.claimedAt}）`)
      err(`  dev:    PID ${lease.devServer?.pid}, cwd=${lease.devServer?.cwd}`)
      err(`  → 把本訊息原樣呈給 user，由 user 決定要不要停掉自己的 dev server。`)
      process.exit(1)
    }

    const queue = enqueueSelf(o, lid)
    const head = queue[0]
    if (!held && head?.sessionId === me) {
      dequeueSelf(o, lid)
      return cmdLaunch(o) // 走既有 launch 路徑接手（含 lease gate 的自動回收分支）
    }

    if (Date.now() >= deadline) {
      dequeueSelf(o, lid)
      err(`[lease:${consumerId}] 排隊逾時（${fmtDuration(o.waitTimeout)}）仍未取得 slot`)
      if (held)
        err(
          `  持有者 ${lease.holder?.kind}:${lease.holder?.sessionId}，task: ${lease.task || '未註明'}`,
        )
      err(`  佇列位置：${queue.findIndex((e) => e.sessionId === me) + 1}/${queue.length}`)
      process.exit(1)
    }
    await sleep(WAIT_POLL_MS)
  }
}

function cmdStop(o) {
  const meta = readConsumerMeta(o.consumerMeta)
  const consumerId = resolveConsumerId(o, meta)
  const port = resolvePort(o, meta)
  const primaryPort = resolvePrimaryPort(meta)
  const sessionName = resolveSessionName(o, consumerId, port, primaryPort)
  // stop 也要解 port —— 否則非 primary port 的 lease 永遠釋放不到，殘留成假衝突
  const lid = leaseId(consumerId, port, primaryPort)
  const s = findSession(sessionName)
  if (!s) {
    out(`session ${sessionName} 不存在，無需停止`)
  } else {
    killSession(sessionName)
    out(`✓ 已關閉 herdr Tab ${s.tabId}（session ${sessionName}）`)
  }
  if (!o.noLease) releaseLease(o, lid)
}

function urlOf(port) {
  return `http://127.0.0.1:${port}`
}

function cmdList() {
  const sessions = listDevTabs()
  if (!sessions.length) {
    out('沒有 dev-* herdr Tab')
    return
  }
  out('dev-* durable sessions：')
  for (const s of sessions) {
    const alive = devProcessAlive(s.paneId)
    out(`  ${s.name}  ${s.tabId}${alive ? '' : '  [dev 已退出]'}`)
  }
}

function cmdSweep(o) {
  // herdr 沒有 EXITED session：殘骸 = Tab 還在但前景只剩 shell（dev 命令已結束）。
  const sessions = listDevTabs().map((s) => ({ ...s, alive: devProcessAlive(s.paneId) }))
  const dead = sessions.filter((s) => !s.alive)
  if (!dead.length) {
    out('sweep：沒有 dev 已退出的 dev-* Tab 需要清')
  } else {
    out(`sweep：${dead.length} 個 dev 已退出的 dev-* Tab${o.dryRun ? '（--dry-run，不動）' : ''}`)
    for (const s of dead) {
      out(`  ${o.dryRun ? '[would close]' : '[closed]'} ${s.name}（${s.tabId}）`)
      if (!o.dryRun) killSession(s.name)
    }
  }
  // 提醒跨 consumer 累積（純報告，不自動殺活的）
  const alive = sessions.filter((s) => s.alive)
  if (alive.length > 1) {
    out(
      `提醒：目前有 ${alive.length} 個活著的 dev-* session：${alive.map((s) => s.name).join(', ')}`,
    )
    out(`  多 worktree 驗收請改走 dev-router（一個公開 port 切 backend），避免每個各起一台。`)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────

function usage() {
  // 讀檔頭的 block comment 當說明。**用結束標記切，不要用行號** —— 行號在每次補一段
  // 註解時都會靜默失準（少印或印到 import），而少印的通常正是新加的那幾行用法。
  const lines = readFileSync(new URL(import.meta.url))
    .toString()
    .split('\n')
  const end = lines.findIndex((l) => l.trimEnd() === ' */')
  out(
    lines
      .slice(1, end === -1 ? 38 : end)
      .map((l) => l.replace(/^ \*?/, ''))
      .join('\n'),
  )
}

async function main() {
  const o = parse(process.argv.slice(2))
  const sub = o._[0]
  if (sub === 'help') return usage()
  switch (sub) {
    case 'status':
      return cmdStatus(o)
    case 'stop':
      return cmdStop(o)
    case 'heartbeat':
      return cmdHeartbeat(o)
    case 'release':
      return cmdRelease(o)
    case 'wait':
      return cmdWait(o)
    case 'start':
      return cmdLaunch(o) // 顯式別名；無 subcommand 亦為 launch（既有呼叫方式不變）
    case 'list':
      return cmdList()
    case 'sweep':
      return cmdSweep(o)
    default:
      return cmdLaunch(o) // 無 subcommand = launch
  }
}

function invokedAsCli() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return entry === fileURLToPath(import.meta.url)
  }
}

if (invokedAsCli()) {
  main().catch((e) => {
    err(`dev-session error: ${e?.message || e}`)
    process.exit(1)
  })
}
