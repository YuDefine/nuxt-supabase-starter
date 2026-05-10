/**
 * 🔒 LOCKED — managed by clade sync-evlog-presets.mjs
 * preset: evlog-nuxthub-ai
 * source: vendor/snippets/evlog-mcp-sse-child-logger/child-logger.ts
 * to: presets/evlog-nuxthub-ai/server/utils/sse-child-logger.ts
 * do not edit consumer-side; modify clade vendor snippet then re-propagate
 */
/**
 * SSE / MCP child request logger（基於 evlog createRequestLogger）
 *
 * Source: clade docs/evlog-master-plan.md § 8.4 (agentic-rag T3)
 *         agentic-rag TD-057 已實證 pattern
 *
 * 使用：
 *   cp vendor/snippets/evlog-mcp-sse-child-logger/child-logger.ts \
 *      server/utils/sse-child-logger.ts
 *
 * 為什麼需要 child logger：
 * - SSE / MCP / Durable Object 的 lifecycle 跨越 Nitro `afterResponse` hook
 * - parent useLogger(event) 在 Response 構造時就 emit，stream / tool call 後
 *   再 log.set 會撞 "called after the wide event was emitted" warning
 * - 解法：fork 出獨立 child request logger，stream settle 時再 emit + drain
 *
 * 應用場景：
 * - SSE chat stream（agentic-rag TD-057 已實作）
 * - MCP tool session（多輪 tool call 跨 stream）
 * - Durable Object alarm callback（lifecycle 與 fetch 分離）
 */

import { createRequestLogger, useLogger } from 'evlog'

import type { H3Event } from 'h3'
import type { RequestLogger } from 'evlog'

interface ForkChildLoggerOptions {
  operation: string // 'web-chat-sse-stream' | 'mcp-tool-session' | ...
  user?: { id: string | null }
  metadata?: Record<string, unknown>
}

/**
 * 從 parent request log 建獨立 child logger
 *
 * 約定：
 * - child 帶 `operation` 區分自己（與 parent 不同 operation）
 * - child 帶 `_parentRequestId` 對應 parent，跨 wide event JOIN 用
 * - child 用 `_deferDrain: true` — 不自動 emit，由呼叫端手動 emit + drain
 */
export function forkChildLogger<T extends object = Record<string, unknown>>(
  event: H3Event,
  options: ForkChildLoggerOptions
): RequestLogger<T> {
  const parent = useLogger(event)
  const parentCtx = parent.getContext()

  const child = createRequestLogger<T>(
    {
      method: typeof parentCtx.method === 'string' ? parentCtx.method : event.method,
      path: typeof parentCtx.path === 'string' ? parentCtx.path : event.path,
      requestId: crypto.randomUUID(),
    },
    { _deferDrain: true } // 不自動 emit；由呼叫端負責
  )

  // 真實 FieldContext = DeepPartial<Omit<T, keyof InternalFields>> & InternalFields；
  // 用 unknown 中介 cast 避免 Partial<T> 不對齊（M3a-agentic-rag 修正）
  child.set({
    operation: options.operation,
    _parentRequestId: typeof parentCtx.requestId === 'string' ? parentCtx.requestId : undefined,
    user: options.user,
    ...options.metadata,
  } as unknown as Parameters<typeof child.set>[0])

  return child
}

/**
 * Stream settled handler（SSE / MCP 完成後的 emit + drain wiring）
 *
 * 用法：在 SSE stream end / MCP session close 時呼叫
 */
export async function emitChildLogger(
  event: H3Event,
  child: RequestLogger<Record<string, unknown>>,
  options: {
    error?: unknown // 有錯時 forceKeep，避免被 sampling 丟
  } = {}
) {
  const emitted = child.emit({ _forceKeep: options.error !== undefined })
  if (!emitted) return // 已 emit 過（重複呼叫）

  // 對 child 跑 enricher → drain pipeline（手動觸發 evlog hook chain）
  // agentic-rag 自家 `runStreamLogDrain` 是 nitro hook 的 wrapper；
  // 不同 consumer 可能命名不同
  const drainPromise = runChildLogDrain(event, emitted)

  // Workers per-stream flush
  const waitUntil = event.context.cloudflare?.context?.waitUntil ?? event.context.waitUntil
  if (typeof waitUntil === 'function') {
    waitUntil(drainPromise)
  } else {
    await drainPromise
  }
}

// ── runChildLogDrain：手動跑 enricher / drain hook chain ──────────────────
// 不是 evlog 公開 API；nitro 不會自動對 child wide event 跑 hooks，
// 所以要自己呼叫 enricher / drain（與 nitro plugin 用的同一條 pipeline）
//
// 真實 hook payload shape（M3a-agentic-rag 修正）：
//   evlog:enrich → EnrichContext { event, request, headers, response }
//   evlog:drain → DrainContext { event, request, headers }
// 早期版本傳 `{ event, h3Event }` — h3Event 不在 type 內，且其他 drain（Sentry / PostHog / Axiom）
// 拿不到 request meta / headers，會少掉 method / path / requestId 等欄位。
async function runChildLogDrain(event: H3Event, emittedEvent: unknown) {
  const nitroApp = (event.context as { nitroApp?: unknown }).nitroApp as
    | {
        hooks: {
          callHook: (name: string, ctx: unknown) => Promise<void>
        }
      }
    | undefined

  if (!nitroApp) {
    // eslint-disable-next-line no-console
    console.warn('[evlog] child log drain skipped — no nitroApp in event.context')
    return
  }

  // 對齊 evlog 內部 buildHookContext output
  const request = { method: event.method, path: event.path }
  const headers = getSafeHeaders(event)

  try {
    await nitroApp.hooks.callHook('evlog:enrich', {
      event: emittedEvent,
      request,
      headers,
      response: { status: event.node?.res?.statusCode ?? 200 },
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[evlog] enrich failed (child):', error)
  }

  try {
    await nitroApp.hooks.callHook('evlog:drain', {
      event: emittedEvent,
      request,
      headers,
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[evlog] drain failed (child):', error)
  }
}

// 過濾 sensitive headers（與 evlog 內部 getSafeHeaders 行為對齊；
// 不暴露 authorization / cookie / x-api-key 等）
function getSafeHeaders(event: H3Event): Record<string, string> {
  const SENSITIVE = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key'])
  const safe: Record<string, string> = {}
  const headers = event.node?.req?.headers
  if (!headers) return safe
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE.has(key.toLowerCase())) continue
    if (typeof value === 'string') safe[key] = value
    else if (Array.isArray(value)) safe[key] = value.join(', ')
  }
  return safe
}

/**
 * 使用範例（SSE chat stream，agentic-rag 風格）
 *
 * export default defineEventHandler(async (event) => {
 *   const log = useLogger(event)  // parent request log
 *   log.set({ user: { id: user.id }, conversation: { id: convId } })
 *
 *   if (wantsSseResponse(event)) {
 *     const streamLog = forkChildLogger<ChatLogFields>(event, {
 *       operation: 'web-chat-sse-stream',
 *       user: { id: user.id },
 *     })
 *
 *     return createSseChatResponse({
 *       log: streamLog,
 *       onResult: (result) => streamLog.set({ result }),
 *       onStreamSettled: ({ error }) => emitChildLogger(event, streamLog, { error }),
 *     })
 *   }
 *
 *   const result = await runChatRequest()
 *   log.set({ result })  // parent log，afterResponse 自動 emit
 *   return { data: result }
 * })
 */

/**
 * MCP tool session 範例
 *
 * const sessionLog = forkChildLogger(event, {
 *   operation: 'mcp-tool-session',
 *   metadata: { sessionId, mcpTransport: 'sse' },
 * })
 *
 * for await (const toolCall of mcpSession) {
 *   sessionLog.info('mcp.tool_invoke', { tool: toolCall.name, ... })
 * }
 *
 * await emitChildLogger(event, sessionLog)
 */
