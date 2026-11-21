// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/herdr-socket.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/herdr-socket.ts
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads'

/**
 * Herdr API socket client for callers that used to spawn `herdr <noun> <verb>` once per call.
 *
 * Why: the API server (`src/api/server.rs`, `CONNECTION_POLL_INTERVAL = 100ms`) reads a new
 * connection's request one byte at a time and sleeps 100 ms whenever the bytes are not there yet.
 * The CLI can lose that race on top of its own process start (smoke: 40–75 %; the later
 * 2026-09 measurement saw 2.0 %, so the rate varies with load — see
 * `specs/plans/W-2026-09-17-herdr-interactive-qos/evidence/herdr-api-poll-100ms.md`). Writing the
 * JSON-line straight after `connect()` from a process that is already running removes the spawn
 * and measured ≤10 % at the 100 ms peak (`ops/herdr-qos/rtt-probe.py`, same evidence file).
 *
 * Node has no synchronous socket API, and these callers are synchronous, so one lazily started
 * worker thread owns the sockets and the caller blocks on `Atomics.wait` until the reply is posted.
 * The worker is `unref`ed: a short-lived CLI exits normally without closing it.
 */

export type HerdrSocketRequest = { method: string; params: Record<string, string> }

/**
 * Maps the exact CLI argv shapes whose `herdr --session default …` output is the raw socket
 * response (verified by diffing both for each verb, including `pane|tab rename` with a non-empty
 * label; an empty label is not mapped). Anything else — `api snapshot`, `agent list`,
 * `pane read`, … — has a CLI-side transformation, so it returns undefined and the caller keeps the
 * CLI for that call.
 */
export function herdrArgsToRequest(args: readonly string[]): HerdrSocketRequest | undefined {
  const [noun, verb, first, second] = args
  const n = args.length
  if (n === 3 && first !== undefined) {
    if (noun === 'pane' && verb === 'get') return { method: 'pane.get', params: { pane_id: first } }
    if (noun === 'tab' && verb === 'get') return { method: 'tab.get', params: { tab_id: first } }
    if (noun === 'agent' && verb === 'get')
      return { method: 'agent.get', params: { target: first } }
  }
  if (n === 4 && first !== undefined && second !== undefined) {
    if (noun === 'pane' && verb === 'process-info' && first === '--pane')
      return { method: 'pane.process_info', params: { pane_id: second } }
    if (noun === 'pane' && verb === 'list' && first === '--workspace')
      return { method: 'pane.list', params: { workspace_id: second } }
    if (noun === 'tab' && verb === 'list' && first === '--workspace')
      return { method: 'tab.list', params: { workspace_id: second } }
    // `--clear` and other flags are CLI syntax, not a label.
    if (second !== '' && !second.startsWith('--') && !first.startsWith('--')) {
      if (noun === 'pane' && verb === 'rename')
        return { method: 'pane.rename', params: { pane_id: first, label: second } }
      if (noun === 'tab' && verb === 'rename')
        return { method: 'tab.rename', params: { tab_id: first, label: second } }
    }
  }
  if (n === 2 && noun === 'workspace' && verb === 'list')
    return { method: 'workspace.list', params: {} }
  return undefined
}

type WorkerReply = { ok: true; line: string } | { ok: false; code: string; message: string }

// Plain JS on purpose: an eval'd worker needs no TypeScript loader and no file next to this module.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const net = require('node:net')
const { port, flag } = workerData
port.on('message', ({ socketPath, line, timeoutMs }) => {
  let buffer = ''
  let settled = false
  const finish = (reply) => {
    if (settled) return
    settled = true
    socket.destroy()
    port.postMessage(reply)
    Atomics.store(flag, 0, 1)
    Atomics.notify(flag, 0)
  }
  const socket = net.createConnection(socketPath)
  socket.setTimeout(timeoutMs, () => finish({ ok: false, code: 'timeout', message: 'Herdr socket timed out' }))
  // Queued before the connect completes, so the bytes go out in the same loop turn as the connect.
  socket.write(line)
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    const newline = buffer.indexOf('\\n')
    if (newline !== -1) finish({ ok: true, line: buffer.slice(0, newline) })
  })
  socket.on('end', () => {
    if (buffer.trim()) finish({ ok: true, line: buffer.trim() })
    else finish({ ok: false, code: 'empty_response', message: 'Herdr socket closed without a reply' })
  })
  socket.on('error', (error) => finish({ ok: false, code: error.code || 'socket_error', message: error.message }))
})
`

type Channel = {
  worker: Worker
  port: MessageChannel['port1']
  flag: Int32Array
}

let channel: Channel | undefined

function openChannel(): Channel {
  if (channel) return channel
  const { port1, port2 } = new MessageChannel()
  const flag = new Int32Array(new SharedArrayBuffer(4))
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { port: port2, flag },
    transferList: [port2],
  })
  worker.unref()
  // A worker that dies later must not leave a dead channel behind for the next call.
  worker.on('exit', () => {
    if (channel?.worker === worker) channel = undefined
  })
  worker.on('error', () => {})
  channel = { worker, port: port1, flag }
  return channel
}

function dropChannel(): void {
  const current = channel
  channel = undefined
  if (current) {
    void current.worker.terminate()
    current.port.close()
  }
}

/** Boot slack for the first call: the worker starts while the caller is already blocked. */
const WORKER_BOOT_SLACK_MS = 5_000

/**
 * One request/response on the Herdr API socket, blocking. Returns the parsed JSON-line reply
 * (a success `{id,result}` or an error `{id,error}` — the caller decides what an error means) or
 * a transport failure as `{ transport: { code, message } }`.
 */
export function herdrSocketCallSync(
  socketPath: string,
  request: HerdrSocketRequest,
  timeoutMs = 10_000,
): { reply: unknown } | { transport: { code: string; message: string } } {
  const current = openChannel()
  Atomics.store(current.flag, 0, 0)
  const message = {
    socketPath,
    line: `${JSON.stringify({ id: `clade:${process.pid}`, ...request })}\n`,
    timeoutMs,
  }
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads 的 MessagePort，不是 window.postMessage
  current.port.postMessage(message)
  const waited = Atomics.wait(current.flag, 0, 0, timeoutMs + WORKER_BOOT_SLACK_MS)
  if (waited === 'timed-out') {
    dropChannel()
    return { transport: { code: 'timeout', message: 'Herdr socket worker did not answer' } }
  }
  const replied = receiveMessageOnPort(current.port)?.message as WorkerReply | undefined
  if (!replied) {
    dropChannel()
    return { transport: { code: 'no_reply', message: 'Herdr socket worker posted no reply' } }
  }
  if (replied.ok === false) return { transport: { code: replied.code, message: replied.message } }
  try {
    return { reply: JSON.parse(replied.line) as unknown }
  } catch {
    return { transport: { code: 'invalid_response', message: replied.line.slice(0, 200) } }
  }
}
