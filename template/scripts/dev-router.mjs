#!/usr/bin/env node
// Dev router — 常駐 L4 TCP proxy + worktree backend switcher（consumer-agnostic，clade vendor）.
//
// 為什麼存在：tunnel（perno-bigbyte-dev.yudefine.com.tw）固定指向一個公開 port，
// 但開發時常在多個 git worktree 之間切換。每切一次 dir + 重啟 nuxt dev + 重啟
// tunnel 很煩。dev-router 用 L4 TCP proxy 佔住公開 port（3040 / 3045），背後把
// 流量整段雙向 pipe 到「當前 active worktree backend 的 nuxt dev server」。切換
// backend = 改 activePort + destroy 既有 client sockets，瀏覽器 reload 後新連線
// 打到新 backend，乾淨 cutover。
//
// 為什麼是 L4 TCP proxy（node:net）而不是 HTTP proxy：nuxt.config.ts 在
// TUNNEL_HOSTNAME 存在時設 vite.server.hmr = { protocol:'wss', host:tunnelHostname,
// clientPort:443 } 且 allowedHosts:[tunnelHostname]。L4 protocol-agnostic、不 parse
// HTTP、不改 Host → HTTP/1.1 + WebSocket(HMR) + SSE + keep-alive 全部自然透傳，
// HMR ws 與 allowedHosts 不被破壞。零新增 npm dependency。
//
// 用法：
//   pnpm dev:router:bigbyte           # 啟動常駐 router（proxy + control UI + tunnel + main backend）
//   pnpm dev:router:shared
//   node scripts/dev-router.mjs list             # 列當前 state
//   node scripts/dev-router.mjs use <slug>       # 切 active backend
//   node scripts/dev-router.mjs stop <slug>      # 停某 backend（active 拒絕）
//
// control UI：http://127.0.0.1:<controlPort>（controlPort = publicPort + 300；perno bigbyte 3040→3340）

import { parseArgs } from 'node:util'
import net from 'node:net'
import http from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

// ─────────────────────────────────────────────────────────────────────────
// App 設定自動偵測（從 consumer package.json dev script）— consumer-agnostic
// ─────────────────────────────────────────────────────────────────────────
// 不硬編碼 app 表。從 package.json 的 `dev` / `dev:<app>` script 偵測：
//   - framework dev 子命令（backend spawn 原樣保留、spawn 時只換 port token）
//   - --port（publicPort；缺則用 framework 預設 3000 並注入 --port 供 router 換 port）
//   - --dotenv basename（envFile；缺則 backend 不額外 copy env）
//   - 是否含 tunnel 子命令（缺則 router 不起 tunnel）
// controlPort = publicPort + 300（consumer-namespaced：publicPort 各 consumer 唯一 = registry
//   dev_ports 3000-3080，+300 落 3300-3380，與 proxy band 不重疊且跨 consumer 不撞 → 避免
//   多 consumer dev-router daemon 共撞同一 control port 互相劫持 state）；
//   backendBand = [controlPort+1, controlPort+99]（findFreePort 掃空閒，容忍跨 consumer 重疊）。
// 支援：純 framework dev / concurrently(framework+tunnel) / vite / next / astro 等。
// 偵測不到任何 app → fail-loud（見下方 CLI）。

// shell-ish tokenizer：尊重單/雙引號。
function tokenize(cmd) {
  const out = []
  let cur = '',
    quote = null
  for (const c of cmd) {
    if (quote) {
      if (c === quote) quote = null
      else cur += c
    } else if (c === '"' || c === "'") quote = c
    else if (/\s/.test(c)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
    } else cur += c
  }
  if (cur) out.push(cur)
  return out
}

// 從 concurrently 命令抽出被引號包住、含空白的子命令字串。
function extractQuotedSubcommands(cmd) {
  const subs = []
  const re = /"([^"]*)"|'([^']*)'/g
  let m
  while ((m = re.exec(cmd))) {
    const s = m[1] ?? m[2]
    if (s && /\s/.test(s)) subs.push(s)
  }
  return subs
}

const FRAMEWORK_DEV_RE = /\b(nuxt dev|nuxi dev|vite|next dev|astro dev|remix vite:dev)\b/
const TUNNEL_RE = /(dev-tunnel|cloudflared|ngrok|\btunnel\b)/

// 解析單一 dev script → { backendArgv, portIdx, publicPort, envFile, tunnel } 或 null。
// backendArgv 用 `pnpm exec <fwToks>` 包，確保 resolve 到 worktree 本地 framework bin。
function parseDevScript(cmd) {
  let backendStr
  let tunnelStr = null
  if (/\bconcurrently\b/.test(cmd)) {
    const subs = extractQuotedSubcommands(cmd)
    backendStr = subs.find((s) => FRAMEWORK_DEV_RE.test(s)) || null
    tunnelStr = subs.find((s) => TUNNEL_RE.test(s)) || null
    if (!backendStr) return null
  } else {
    if (!FRAMEWORK_DEV_RE.test(cmd)) return null // 非 framework dev script（如 dev:db）→ 跳過
    backendStr = cmd
  }
  const fwToks = tokenize(backendStr)
  if (!fwToks.length) return null
  // peel 開頭的 inline env 賦值（如 `NODE_OPTIONS=--dns-result-order=ipv4first nuxt dev`）→ spawn env
  const backendEnv = {}
  while (fwToks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(fwToks[0])) {
    const kv = fwToks.shift()
    const i = kv.indexOf('=')
    backendEnv[kv.slice(0, i)] = kv.slice(i + 1)
  }
  if (!fwToks.length) return null
  const backendArgv = ['exec', ...fwToks]
  // port flag → value token index（normalize --port=N / -p=N 成獨立 token）
  let publicPort = null,
    portIdx = -1
  for (let i = 0; i < backendArgv.length; i++) {
    const t = backendArgv[i]
    const eq = t.match(/^(--port|-p)=(\d+)$/)
    if (eq) {
      backendArgv[i] = eq[1]
      backendArgv.splice(i + 1, 0, eq[2])
      publicPort = +eq[2]
      portIdx = i + 1
      break
    }
    if ((t === '--port' || t === '-p') && /^\d+$/.test(backendArgv[i + 1] || '')) {
      publicPort = +backendArgv[i + 1]
      portIdx = i + 1
      break
    }
  }
  if (!publicPort) {
    // framework 預設 port（nuxt/vite/next 皆 3000）；注入 --port 供 router 換 backend port
    publicPort = 3000
    backendArgv.push('--port', '3000')
    portIdx = backendArgv.length - 1
  }
  // envFile basename
  let envFile = null
  for (let i = 0; i < fwToks.length; i++) {
    if (fwToks[i] === '--dotenv' && fwToks[i + 1]) {
      envFile = fwToks[i + 1].split('/').pop()
      break
    }
    const mm = fwToks[i].match(/^--dotenv=(.+)$/)
    if (mm) {
      envFile = mm[1].split('/').pop()
      break
    }
  }
  // tunnel 子命令原樣保留（指向 publicPort，router 持有該 port）
  let tunnel = null
  if (tunnelStr) {
    const tToks = tokenize(tunnelStr)
    if (tToks.length) tunnel = { bin: tToks[0], argv: tToks.slice(1) }
  }
  return { backendArgv, portIdx, publicPort, envFile, tunnel, backendEnv }
}

// package.json → { <appName>: { publicPort, controlPort, backendBand, envFile, backendArgv, portIdx, tunnel } }
function detectApps(mainRepoRoot) {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(mainRepoRoot, 'package.json'), 'utf8'))
  } catch {
    throw new Error(`[dev-router] cannot read ${join(mainRepoRoot, 'package.json')}`)
  }
  const scripts = pkg.scripts ?? {}
  const names = Object.keys(scripts).filter(
    (n) => (n === 'dev' || n.startsWith('dev:')) && !n.startsWith('dev:router'),
  )
  const apps = {}
  for (const name of names) {
    if (typeof scripts[name] !== 'string') continue
    const parsed = parseDevScript(scripts[name])
    if (!parsed) continue
    const appName = name === 'dev' ? 'default' : name.slice('dev:'.length)
    if (apps[appName]) continue
    // consumer-namespaced control port：用 app 自己的 publicPort（registry dev_ports 各
    // consumer 唯一）+ 300，避免不同 consumer 的 dev-router daemon 共撞 3340 互相劫持。
    const controlPort = parsed.publicPort + 300
    apps[appName] = {
      publicPort: parsed.publicPort,
      controlPort,
      backendBand: [controlPort + 1, controlPort + 99],
      envFile: parsed.envFile,
      backendArgv: parsed.backendArgv,
      portIdx: parsed.portIdx,
      tunnel: parsed.tunnel,
      backendEnv: parsed.backendEnv,
    }
  }
  return apps
}

// ─────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────
const { values, positionals } = parseArgs({
  options: {
    // 不給 default；未指定時用偵測到的第一個 app。
    app: { type: 'string' },
    // control HTTP server 的 bind host。default loopback；用 0.0.0.0 可讓
    // 跨裝置（Tailscale）+ 跨 origin（review-gui bookmarklet）打到 control API。
    // 只影響 control server listen 端；CLI client 與 proxy bind 都維持 127.0.0.1。
    'control-host': { type: 'string', default: '127.0.0.1' },
    // --no-tunnel：不 spawn tunnel（review 走 localhost 即可，且避開 CF token 403）。
    'no-tunnel': { type: 'boolean', default: false },
    // --lazy：啟動不 spawn main backend，第一次 use / control UI Activate 才 spawn。
    // 多 consumer launcher 一次起多個 router 時用，避免一次 spawn N 個 nuxt。
    lazy: { type: 'boolean', default: false },
  },
  allowPositionals: true,
})

const controlHost = values['control-host']
const NO_TUNNEL = values['no-tunnel']
const LAZY = values.lazy
const mainRepoRootForDetect = resolveMainRepoRoot()
const detectPathSegments = mainRepoRootForDetect.split('/').filter(Boolean)
const consumerId = detectPathSegments[detectPathSegments.length - 1] || 'app'
const APPS = detectApps(mainRepoRootForDetect)
const appNames = Object.keys(APPS)
if (!appNames.length) {
  console.error(
    `[dev-router] 偵測不到任何 dev app（${join(mainRepoRootForDetect, 'package.json')}）。\n` +
      `  期待一個 "dev" 或 "dev:<app>" script 跑 nuxt/vite/next dev（含可解析的命令）。\n` +
      `  exotic dev script（無 framework dev、無 --port）暫不支援 auto-detect。`,
  )
  process.exit(1)
}
const appName = values.app || appNames[0]
const appConfig = APPS[appName]
if (!appConfig) {
  console.error(`[dev-router] unknown --app: ${appName} (detected: ${appNames.join(', ')})`)
  process.exit(1)
}

const { publicPort, controlPort, backendBand, envFile } = appConfig
const STATE_PATH = `/tmp/devrouter-${consumerId}-${appName}.json`

// ─────────────────────────────────────────────────────────────────────────
// main repo root 解析
// dev-router 可能從 main 或某 worktree 被跑起；publicPort proxy / tunnel /
// backend spawn 都以 main repo root 當基準（tunnel 在 mainRepoRoot 跑，backend
// 的 cwd 是各 worktree 自己的 path）。
// ─────────────────────────────────────────────────────────────────────────
function resolveMainRepoRoot() {
  // git worktree list 第一筆非 bare entry 即 main worktree。
  const entries = parseWorktrees()
  const main = entries.find((e) => !e.bare)
  if (main) return main.path
  // fallback：git-common-dir 的 parent
  const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim()
  return resolve(commonDir, '..')
}

// ─────────────────────────────────────────────────────────────────────────
// git worktree 解析
// ─────────────────────────────────────────────────────────────────────────
function parseWorktrees() {
  let raw
  try {
    raw = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
    })
  } catch (err) {
    console.error(
      '[dev-router] failed to run git worktree list:',
      err instanceof Error ? err.message : err,
    )
    return []
  }
  const entries = []
  let cur = null
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) entries.push(cur)
      cur = {
        path: line.slice('worktree '.length).trim(),
        branch: null,
        bare: false,
        detached: false,
      }
    } else if (!cur) {
      continue
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).trim() // refs/heads/<name>
    } else if (line === 'bare') {
      cur.bare = true
    } else if (line === 'detached') {
      cur.detached = true
    }
    // HEAD / locked / 其他行忽略
  }
  if (cur) entries.push(cur)
  return entries
}

// branch → slug
// main worktree 的 slug 固定 'main'（由 caller 判斷）。
// session/<YYYY-MM-DD-HHMM>-<slug>（或舊/非標準格式 session/<YYYY-MM-DD>-<slug>，無 HHMM）
//   → 剝 session/ 前綴 + 開頭日期戳（HHMM 段 optional），對齊 review-gui worktreeSlug。
// branch 不符此格式 → branch basename。
function branchToSlug(branch) {
  if (!branch) return null
  let name = branch.replace(/^refs\/heads\//, '')
  if (name.startsWith('session/')) {
    name = name.slice('session/'.length)
    // 剝開頭時間戳 YYYY-MM-DD[-HHMM]-（HHMM 段 optional：handle 舊/非標準格式無 HHMM 的 session branch，
    // 否則日期前綴殘留會與 review-gui/wt-helper slug drift → `use <slug>` unknown slug）
    name = name.replace(/^\d{4}-\d{2}-\d{2}(-\d{4})?-/, '')
    return name
  }
  // branch basename
  return name.split('/').pop()
}

// 回傳 [{ slug, path, branch }]，已排除 ephemeral agent worktree。
// main worktree（path === mainRepoRoot）slug 固定 'main'，其餘由 branch 推導。
function listManagedWorktrees(mainRepoRoot) {
  const entries = parseWorktrees().filter(
    (e) => !e.bare && !e.path.includes('/.claude/worktrees/agent-'),
  )
  const out = entries.map((e) => {
    const slug =
      e.path === mainRepoRoot ? 'main' : branchToSlug(e.branch) || e.path.split('/').pop()
    return { slug, path: e.path, branch: (e.branch || '').replace(/^refs\/heads\//, '') }
  })
  // 保底：若沒任何一筆對到 main repo root（例如 detached main），第一筆強制 'main'。
  if (out.length && !out.some((w) => w.slug === 'main')) {
    out[0].slug = 'main'
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// state 檔
// ─────────────────────────────────────────────────────────────────────────
function readState() {
  if (!existsSync(STATE_PATH)) return { activeSlug: null, backends: {} }
  try {
    const obj = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
    return {
      activeSlug: obj.activeSlug ?? null,
      backends: obj.backends ?? {},
    }
  } catch {
    return { activeSlug: null, backends: {} }
  }
}

function writeState(state) {
  try {
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('[dev-router] failed to write state:', err instanceof Error ? err.message : err)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// free port scan（在 backendBand 內）
// ─────────────────────────────────────────────────────────────────────────
function isPortFree(port) {
  return new Promise((res) => {
    const srv = net.createServer()
    srv.once('error', () => res(false))
    srv.once('listening', () => {
      srv.close(() => res(true))
    })
    srv.listen(port, '127.0.0.1')
  })
}

async function scanFreePort(taken) {
  const [lo, hi] = backendBand
  for (let p = lo; p <= hi; p++) {
    if (taken.has(p)) continue
    if (await isPortFree(p)) return p
  }
  throw new Error(`[dev-router] no free port in backend band ${lo}-${hi}`)
}

// 試 TCP 連線確認 port 有人 listen（backend ready）
function canConnect(port) {
  return new Promise((res) => {
    const sock = net.connect({ port, host: '127.0.0.1' })
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      sock.destroy()
      res(ok)
    }
    sock.once('connect', () => finish(true))
    sock.once('error', () => finish(false))
    sock.setTimeout(1000, () => finish(false))
  })
}

async function waitForPort(port, timeoutMs = 120000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await canConnect(port)) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`[dev-router] timeout waiting for backend port ${port} (>${timeoutMs}ms)`)
}

// ════════════════════════════════════════════════════════════════════════
// 子命令模式（list / status / use / stop）— 與 daemon 對話，不進常駐
// ════════════════════════════════════════════════════════════════════════
function daemonUrl(path) {
  return `http://127.0.0.1:${controlPort}${path}`
}

async function daemonFetch(path, init) {
  try {
    const res = await fetch(daemonUrl(path), init)
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, body }
  } catch {
    return null // daemon not reachable
  }
}

async function runSubcommand(cmd, arg) {
  if (cmd === 'list' || cmd === 'status') {
    const res = await daemonFetch('/api/state')
    if (res && res.ok) {
      printState(res.body, true)
    } else {
      // daemon 不在 → 讀 state 檔
      const mainRepoRoot = resolveMainRepoRoot()
      const state = readState()
      const worktrees = listManagedWorktrees(mainRepoRoot).map((w) => ({
        slug: w.slug,
        path: w.path,
        branch: w.branch,
        backendPort: state.backends[w.slug]?.port ?? null,
        running: false,
      }))
      printState(
        {
          app: appName,
          publicPort,
          activeSlug: state.activeSlug,
          worktrees,
        },
        false,
      )
    }
    return
  }

  if (cmd === 'use') {
    if (!arg) {
      console.error('[dev-router] usage: node scripts/dev-router.mjs use <slug>')
      process.exit(1)
    }
    const res = await daemonFetch(`/api/activate?slug=${encodeURIComponent(arg)}`, {
      method: 'POST',
    })
    if (!res) {
      console.error(`[dev-router] daemon not running. start it first: pnpm dev:router:${appName}`)
      process.exit(1)
    }
    if (!res.ok) {
      console.error(`[dev-router] activate failed (${res.status}): ${res.body?.error ?? 'unknown'}`)
      process.exit(1)
    }
    console.log(`[dev-router] active backend → ${res.body.activeSlug}`)
    printState(res.body, true)
    return
  }

  if (cmd === 'stop') {
    if (!arg) {
      console.error('[dev-router] usage: node scripts/dev-router.mjs stop <slug>')
      process.exit(1)
    }
    const res = await daemonFetch(`/api/stop?slug=${encodeURIComponent(arg)}`, { method: 'POST' })
    if (!res) {
      console.error(`[dev-router] daemon not running. start it first: pnpm dev:router:${appName}`)
      process.exit(1)
    }
    if (!res.ok) {
      console.error(`[dev-router] stop failed (${res.status}): ${res.body?.error ?? 'unknown'}`)
      process.exit(1)
    }
    console.log(`[dev-router] stopped backend → ${arg}`)
    printState(res.body, true)
    return
  }

  console.error(
    `[dev-router] unknown subcommand: ${cmd} (use: list | status | use <slug> | stop <slug>)`,
  )
  process.exit(1)
}

function printState(state, daemonRunning) {
  console.log('')
  console.log(`  app:        ${state.app}`)
  console.log(
    `  proxy:      http://127.0.0.1:${state.publicPort}  ${daemonRunning ? '(daemon running)' : '(daemon NOT running)'}`,
  )
  console.log(`  active:     ${state.activeSlug ?? '(none)'}`)
  console.log('')
  console.log('  SLUG'.padEnd(36) + 'PORT'.padEnd(8) + 'STATE'.padEnd(10) + 'BRANCH')
  for (const w of state.worktrees) {
    const active = w.slug === state.activeSlug ? '*' : ' '
    const stateStr = w.running ? 'running' : 'stopped'
    console.log(
      `${active} ${String(w.slug).padEnd(34)}${String(w.backendPort ?? '-').padEnd(8)}${stateStr.padEnd(10)}${w.branch}`,
    )
  }
  console.log('')
}

// ── kill 整個 process group（負 pid）──
// backend / tunnel 都用 detached:true spawn，child.pid 是 group leader pid；
// 送負 pid 收整串（pnpm→sh→nuxt / node→cloudflared），避免 orphan。
function killGroup(pid, signal = 'SIGTERM') {
  if (!pid) return
  try {
    process.kill(-pid, signal)
  } catch {
    /* group already gone */
  }
}

// ════════════════════════════════════════════════════════════════════════
// 常駐 daemon 模式
// ════════════════════════════════════════════════════════════════════════
async function runDaemon() {
  const mainRepoRoot = resolveMainRepoRoot()

  // in-memory：spawn 的 child process refs（pid 也存 state，但 child ref 用來 kill）
  /** @type {Map<string, import('node:child_process').ChildProcess>} */
  const children = new Map() // slug → child
  let tunnelChild = null

  // proxy state
  let activePort = null
  let activeSlug = null
  /** @type {Set<net.Socket>} */
  const clientSockets = new Set()

  // 載入既有 state（沿用 slug→port 配置）
  const state = readState()
  // 啟動時清掉 pid（上次 daemon 的 child 已不歸我管）
  for (const slug of Object.keys(state.backends)) {
    if (state.backends[slug]) state.backends[slug].pid = null
  }

  // ── port 分配：穩定優先讀 state，無則 scan ──
  async function ensureBackendPort(slug) {
    if (state.backends[slug]?.port) return state.backends[slug].port
    const taken = new Set(
      Object.values(state.backends)
        .map((b) => b?.port)
        .filter(Boolean),
    )
    const port = await scanFreePort(taken)
    state.backends[slug] = { ...state.backends[slug], port, pid: null }
    writeState(state)
    return port
  }

  // ── 確保 worktree 有 envFile（缺則從 main copy）──
  function ensureEnvFile(worktreePath) {
    if (!envFile) return // consumer dev script 未用 --dotenv → 無需 copy env
    const dst = join(worktreePath, envFile)
    if (existsSync(dst)) return
    const src = join(mainRepoRoot, envFile)
    if (!existsSync(src)) {
      throw new Error(
        `[dev-router] env file missing in both worktree and main:\n  worktree: ${dst}\n  main:     ${src}`,
      )
    }
    copyFileSync(src, dst)
    console.log(`[dev-router] copied ${envFile} → ${worktreePath}`)
  }

  // ── spawn backend nuxt dev（mirror dev:bigbyte 的 nuxt 子命令）──
  function spawnBackend(slug, worktreePath, backendPort) {
    ensureEnvFile(worktreePath)
    console.log(`[dev-router] spawning backend "${slug}" on :${backendPort} (cwd=${worktreePath})`)
    // 原樣沿用 consumer dev script 偵測到的 framework dev 命令，只換 port token。
    const argv = [...appConfig.backendArgv]
    argv[appConfig.portIdx] = String(backendPort)
    const child = spawn('pnpm', argv, {
      cwd: worktreePath,
      stdio: 'inherit',
      env: { ...process.env, ...appConfig.backendEnv },
      // process group leader：kill 時送負 pid 收整串 pnpm→sh→nuxt，避免 orphan nuxt
      // 還 listen 在 backend port。stdio:'inherit' 仍保留（看得到 nuxt log）。
      detached: true,
    })
    children.set(slug, child)
    state.backends[slug] = {
      ...state.backends[slug],
      port: backendPort,
      pid: child.pid ?? null,
    }
    writeState(state)
    child.on('exit', (code, signal) => {
      console.log(`[dev-router] backend "${slug}" exited (code=${code} signal=${signal})`)
      children.delete(slug)
      if (state.backends[slug]) {
        state.backends[slug].pid = null
        writeState(state)
      }
    })
    return child
  }

  // ── 是否 running（child ref 存在且未死）──
  function isRunning(slug) {
    const child = children.get(slug)
    return !!(child && child.exitCode === null && !child.killed)
  }

  // ── activate：冷的先 spawn + wait-for-port，再切 activePort + destroy sockets ──
  async function activate(slug) {
    const worktrees = listManagedWorktrees(mainRepoRoot)
    const wt = worktrees.find((w) => w.slug === slug)
    if (!wt) throw new Error(`unknown slug: ${slug}`)

    const backendPort = await ensureBackendPort(slug)
    if (!isRunning(slug)) {
      spawnBackend(slug, wt.path, backendPort)
      await waitForPort(backendPort)
    } else {
      // 已 running 但可能還沒 ready（極少見）— 也確認一下
      await waitForPort(backendPort)
    }

    // 切換：先改 activePort 讓新連線打到新 backend，再 destroy 既有 client sockets
    // 強制瀏覽器 reload 後重連到新 backend，乾淨 cutover。
    activePort = backendPort
    activeSlug = slug
    state.activeSlug = slug
    writeState(state)

    for (const sock of clientSockets) {
      sock.destroy()
    }
    clientSockets.clear()

    console.log(`[dev-router] active backend → "${slug}" (:${backendPort})`)
  }

  // ── stop：kill backend（active 拒絕）──
  function stopBackend(slug) {
    if (slug === activeSlug) {
      throw new Error('cannot stop the active backend — switch to another first')
    }
    const child = children.get(slug)
    if (child && child.exitCode === null) {
      killGroup(child.pid)
    } else if (state.backends[slug]?.pid) {
      // 沒 child ref 但 state 有 pid（理論上不會發生，daemon 啟動時已清 pid）
      killGroup(state.backends[slug].pid)
    }
    children.delete(slug)
    if (state.backends[slug]) {
      state.backends[slug].pid = null
      writeState(state)
    }
  }

  // ── 即時組 state JSON ──
  async function buildStateJson() {
    const worktrees = listManagedWorktrees(mainRepoRoot).map((w) => ({
      slug: w.slug,
      path: w.path,
      branch: w.branch,
      backendPort: state.backends[w.slug]?.port ?? null,
      running: isRunning(w.slug),
    }))
    return {
      app: appName,
      publicPort,
      activeSlug,
      worktrees,
    }
  }

  // ── TCP proxy ──
  const proxy = net.createServer((client) => {
    if (activePort === null) {
      // 尚無 active backend，安靜 destroy（瀏覽器自動 retry）
      client.destroy()
      return
    }
    clientSockets.add(client)
    const upstream = net.connect(activePort, '127.0.0.1')

    client.on('error', () => {
      upstream.destroy()
    })
    upstream.on('error', () => {
      // backend 未就緒 / 連線斷 → 安靜 destroy client，不回 HTML
      client.destroy()
    })
    client.on('close', () => {
      clientSockets.delete(client)
      upstream.destroy()
    })
    upstream.on('close', () => {
      client.destroy()
    })

    client.pipe(upstream)
    upstream.pipe(client)
  })
  proxy.on('error', (err) => {
    console.error(
      `[dev-router] proxy server error on :${publicPort}:`,
      err instanceof Error ? err.message : err,
    )
    if (err && err.code === 'EADDRINUSE') {
      console.error(
        `[dev-router] public port ${publicPort} already in use — is a dev server / another router running?`,
      )
      process.exit(1)
    }
  })

  // ── control HTTP server ──
  // CORS：讓 review-gui origin（http://<host>:5174）的 bookmarklet 能跨 origin
  // POST 並讀 response。control API 只在本機 / Tailscale 內網開放，wildcard 可接受。
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': '*',
  }
  const control = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const send = (status, obj) => {
      res.writeHead(status, { ...corsHeaders, 'content-type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    // preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders)
      res.end()
      return
    }
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { ...corsHeaders, 'content-type': 'text/html; charset=utf-8' })
        res.end(CONTROL_HTML(appName, publicPort, controlPort))
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        send(200, await buildStateJson())
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/activate') {
        const slug = url.searchParams.get('slug')
        if (!slug) return send(400, { error: 'missing slug' })
        try {
          await activate(slug)
          send(200, await buildStateJson())
        } catch (err) {
          send(400, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/stop') {
        const slug = url.searchParams.get('slug')
        if (!slug) return send(400, { error: 'missing slug' })
        try {
          stopBackend(slug)
          send(200, await buildStateJson())
        } catch (err) {
          send(409, { error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
      send(404, { error: 'not found' })
    } catch (err) {
      send(500, { error: err instanceof Error ? err.message : String(err) })
    }
  })

  // ── tunnel ──
  function spawnTunnel() {
    if (!appConfig.tunnel) {
      console.log(
        '[dev-router] dev script 無 tunnel 子命令 — 跳過 tunnel（純 local proxy + worktree switch）',
      )
      return
    }
    console.log(
      `[dev-router] spawning tunnel (${appConfig.tunnel.bin} ${appConfig.tunnel.argv.join(' ')})`,
    )
    tunnelChild = spawn(appConfig.tunnel.bin, appConfig.tunnel.argv, {
      cwd: mainRepoRoot,
      stdio: 'inherit',
      env: process.env,
      // process group leader：group kill 確保 cloudflared 一起收（dev-tunnel.mjs
      // 自己也 forward SIGTERM，負 pid kill 是雙保險）。
      detached: true,
    })
    tunnelChild.on('exit', (code, signal) => {
      console.log(`[dev-router] tunnel exited (code=${code} signal=${signal})`)
      tunnelChild = null
    })
  }

  // ── graceful shutdown ──
  let shuttingDown = false
  function shutdown() {
    if (shuttingDown) return
    shuttingDown = true
    console.log('\n[dev-router] shutting down — killing backends + tunnel...')
    for (const [slug, child] of children) {
      if (child.exitCode === null) killGroup(child.pid)
      if (state.backends[slug]) state.backends[slug].pid = null
    }
    if (tunnelChild && tunnelChild.exitCode === null) killGroup(tunnelChild.pid)
    state.activeSlug = null
    writeState(state)
    try {
      proxy.close()
    } catch {
      /* noop */
    }
    try {
      control.close()
    } catch {
      /* noop */
    }
    // 給 child 一點時間收 SIGTERM 後 exit
    setTimeout(() => process.exit(0), 500).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // ── 啟動序列 ──
  await new Promise((res) => proxy.listen(publicPort, '127.0.0.1', res))
  await new Promise((res) => control.listen(controlPort, controlHost, res))
  if (!NO_TUNNEL) spawnTunnel()

  // spawn main backend + 設 active（--lazy 時跳過，第一次 use / control UI Activate 才 spawn）
  if (!LAZY) {
    console.log('[dev-router] starting main backend...')
    try {
      await activate('main')
    } catch (err) {
      console.error(
        '[dev-router] failed to start main backend:',
        err instanceof Error ? err.message : err,
      )
      shutdown()
      return
    }
  }

  // banner
  const lines = [
    '',
    '━'.repeat(64),
    `  🔀 ${consumerId} dev router — app=${appName}`,
    `  proxy (public):  http://127.0.0.1:${publicPort}`,
    `  control UI:      http://127.0.0.1:${controlPort}`,
  ]
  if (controlHost !== '127.0.0.1') {
    lines.push(`                   (control bound on ${controlHost} — reachable cross-device)`)
  }
  lines.push(
    NO_TUNNEL
      ? `  tunnel:          (disabled — --no-tunnel)`
      : `  tunnel:          → :${publicPort}`,
    activeSlug
      ? `  active backend:  "${activeSlug}" (:${activePort})`
      : `  active backend:  (lazy — 第一次 use / control UI Activate 才 spawn)`,
    '',
    `  切換 backend：control UI 或 \`node scripts/dev-router.mjs use <slug> --app ${appName}\``,
    '━'.repeat(64),
    '',
  )
  console.log(lines.join('\n'))

  // keep alive
  await new Promise(() => {})
}

// ─────────────────────────────────────────────────────────────────────────
// control UI HTML（inline，無外部資源）
// ─────────────────────────────────────────────────────────────────────────
function CONTROL_HTML(app, pubPort, ctrlPort) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${consumerId} dev router — ${app}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 24px; max-width: 920px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #888; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #8884; }
  th { color: #888; font-weight: 600; font-size: 12px; text-transform: uppercase; }
  tr.active { background: #2e7d3220; }
  tr.active td:first-child::before { content: "● "; color: #2e7d32; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px; }
  .running { background: #2e7d3233; color: #2e7d32; }
  .stopped { background: #8884; color: #888; }
  button { font: inherit; padding: 4px 12px; border-radius: 6px; border: 1px solid #8886; background: #8881; cursor: pointer; }
  button:hover:not(:disabled) { background: #8883; }
  button:disabled { opacity: .4; cursor: default; }
  button.activate { border-color: #2e7d3288; }
  .msg { margin-top: 14px; min-height: 20px; color: #c77; }
  .branch { color: #888; font-size: 12px; }
</style>
</head>
<body>
<h1>🔀 ${consumerId} dev router</h1>
<div class="meta">app=<b>${app}</b> · proxy=http://127.0.0.1:${pubPort} · control=http://127.0.0.1:${ctrlPort}</div>
<table>
  <thead>
    <tr><th>slug</th><th>port</th><th>state</th><th>branch</th><th></th></tr>
  </thead>
  <tbody id="rows"><tr><td colspan="5">載入中…</td></tr></tbody>
</table>
<div class="msg" id="msg"></div>
<script>
const $rows = document.getElementById('rows')
const $msg = document.getElementById('msg')
let busy = false

function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])) }

async function refresh(){
  try {
    const r = await fetch('/api/state')
    const s = await r.json()
    render(s)
  } catch (e) {
    $msg.textContent = '無法連到 daemon（可能已關閉）'
  }
}

function render(s){
  const active = s.activeSlug
  $rows.innerHTML = s.worktrees.map(w => {
    const isActive = w.slug === active
    const stateCls = w.running ? 'running' : 'stopped'
    const stateTxt = w.running ? 'running' : 'stopped'
    const activateBtn = isActive
      ? '<button disabled>active</button>'
      : '<button class="activate" onclick="activate(\\''+esc(w.slug)+'\\')">Activate</button>'
    const stopBtn = isActive
      ? '<button disabled>Stop</button>'
      : '<button onclick="stopWt(\\''+esc(w.slug)+'\\')"' + (w.running ? '' : ' disabled') + '>Stop</button>'
    return '<tr class="'+(isActive?'active':'')+'">'
      + '<td>'+esc(w.slug)+'</td>'
      + '<td>'+esc(w.backendPort ?? '-')+'</td>'
      + '<td><span class="pill '+stateCls+'">'+stateTxt+'</span></td>'
      + '<td class="branch">'+esc(w.branch)+'</td>'
      + '<td>'+activateBtn+' '+stopBtn+'</td>'
      + '</tr>'
  }).join('')
}

async function activate(slug){
  if (busy) return
  busy = true
  $msg.style.color = '#888'
  $msg.textContent = '啟動中… "'+slug+'"（首次可能要 1-2 分鐘 compile）'
  try {
    const r = await fetch('/api/activate?slug='+encodeURIComponent(slug), { method:'POST' })
    const b = await r.json()
    if (!r.ok) { $msg.style.color = '#c77'; $msg.textContent = '失敗：'+(b.error||r.status) }
    else { $msg.style.color = '#2e7d32'; $msg.textContent = '已切換 → '+slug; render(b) }
  } catch(e){ $msg.style.color = '#c77'; $msg.textContent = '錯誤：'+e.message }
  busy = false
}

async function stopWt(slug){
  if (busy) return
  busy = true
  $msg.style.color = '#888'
  $msg.textContent = '停止中… "'+slug+'"'
  try {
    const r = await fetch('/api/stop?slug='+encodeURIComponent(slug), { method:'POST' })
    const b = await r.json()
    if (!r.ok) { $msg.style.color = '#c77'; $msg.textContent = '失敗：'+(b.error||r.status) }
    else { $msg.style.color = '#2e7d32'; $msg.textContent = '已停止 → '+slug; render(b) }
  } catch(e){ $msg.style.color = '#c77'; $msg.textContent = '錯誤：'+e.message }
  busy = false
}

refresh()
setInterval(() => { if (!busy) refresh() }, 2000)
</script>
</body>
</html>`
}

// ════════════════════════════════════════════════════════════════════════
// entry
// ════════════════════════════════════════════════════════════════════════
const subcommand = positionals[0]
if (!subcommand) {
  await runDaemon()
} else {
  await runSubcommand(subcommand, positionals[1])
}
