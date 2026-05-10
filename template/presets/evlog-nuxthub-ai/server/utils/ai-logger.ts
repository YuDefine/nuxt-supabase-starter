/**
 * 🔒 LOCKED — managed by clade sync-evlog-presets.mjs
 * preset: evlog-nuxthub-ai
 * source: vendor/snippets/evlog-ai-sdk-logger/ai-logger.ts
 * to: presets/evlog-nuxthub-ai/server/utils/ai-logger.ts
 * do not edit consumer-side; modify clade vendor snippet then re-propagate
 */
/**
 * AI SDK + evlog wide event 整合（convention，非 evlog API）
 *
 * Source: clade docs/evlog-master-plan.md § 8.4 (agentic-rag T3)
 *
 * 使用：
 *   cp vendor/snippets/evlog-ai-sdk-logger/ai-logger.ts \
 *      server/utils/ai-logger.ts
 *
 * 釐清：evlog 沒有 createAILogger 內建函式 — AI 子事件採用「在現有 useLogger
 * 上掛 ai.* 欄位」的 convention，不是新 logger 種類。優點：
 * - 共享 enricher / drain / sampling 配置
 * - cost / token 進 wide event attributes，跟 user / route 在同一筆 event
 * - tool call 子事件用 ad-hoc log.info('ai.tool_call', { ... }) 即可
 *
 * AI SDK 呼叫場景：
 * - generateText / streamText（@ai-sdk/openai / @ai-sdk/anthropic / Workers AI）
 * - tool call 結果
 * - moderation outcome
 * - embedding query
 */

import type { RequestLogger } from 'evlog'

// AI helpers 接受任何 logger（typed 或 untyped）— `AILogFields & Record<string, unknown>` 表示
// 同時接受 ai.* typed fields + ad-hoc 欄位（避免 ReturnType<typeof useLogger> 縮成
// RequestLogger<Record<string, unknown>>，後者拒絕 { ai: ... } literal）（M3a-agentic-rag 修正）
type Logger = RequestLogger<AILogFields & Record<string, unknown>>

// ── 共用 AI 欄位 schema（typed fields candidate；T2 升級可改 evlog typed fields）
export interface AILogFields {
  ai?: {
    provider?: string // 'openai' | 'anthropic' | 'workers-ai' | ...
    model?: string // 'gpt-4o-mini' | 'claude-haiku-4-5' | '@cf/meta/llama-3-8b-instruct' | ...
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    cost_usd?: number
    finish_reason?: string // 'stop' | 'length' | 'tool_calls' | 'content_filter' | ...
    duration_ms?: number
    cached?: boolean // prompt cache hit
    tool_calls?: Array<{ name: string; duration_ms?: number; success: boolean }>
    moderation?: {
      flagged: boolean
      categories?: string[]
    }
  }
}

// ── 1. generateText / streamText 落地（成功路徑）─────────────────────────
export function recordAIGeneration(
  log: Logger,
  result: {
    provider: string
    model: string
    promptTokens?: number
    completionTokens?: number
    costUsd?: number
    finishReason?: string
    durationMs: number
    cached?: boolean
  }
) {
  log.set({
    ai: {
      provider: result.provider,
      model: result.model,
      prompt_tokens: result.promptTokens,
      completion_tokens: result.completionTokens,
      total_tokens: (result.promptTokens ?? 0) + (result.completionTokens ?? 0) || undefined,
      cost_usd: result.costUsd,
      finish_reason: result.finishReason,
      duration_ms: result.durationMs,
      cached: result.cached,
    },
  })
}

// ── 2. Tool call（每次 tool 執行都 emit 子事件 + 加總到 wide event）──────
export function recordToolCall(
  log: Logger,
  toolName: string,
  durationMs: number,
  success: boolean,
  metadata?: Record<string, unknown>
) {
  log.info('ai.tool_call', {
    ai: {
      tool_calls: [{ name: toolName, duration_ms: durationMs, success }],
    },
    ...metadata,
  })
}

// ── 3. Moderation 結果 ────────────────────────────────────────────────────
export function recordModeration(log: Logger, result: { flagged: boolean; categories?: string[] }) {
  log.set({
    ai: {
      moderation: {
        flagged: result.flagged,
        categories: result.categories,
      },
    },
  })
  if (result.flagged) {
    log.warn('ai.moderation_flagged', { categories: result.categories })
  }
}

// ── 4. Embedding query（高量場景）─────────────────────────────────────────
export function recordEmbedding(
  log: Logger,
  result: {
    provider: string
    model: string
    inputCount: number
    totalTokens?: number
    costUsd?: number
    durationMs: number
  }
) {
  // 高量 sample：cost > $0.001 才 keep（自家 sampling，不依賴 evlog sampling）
  if ((result.costUsd ?? 0) > 0.001) {
    log.info('ai.embedding', { ai: { ...result } })
  }
}

/**
 * 使用範例（agentic-rag 的 chat.post.ts 簡化版）
 *
 * import { useLogger } from 'evlog'
 * import { generateText } from 'ai'
 * import { recordAIGeneration, recordToolCall } from '~/server/utils/ai-logger'
 *
 * export default defineEventHandler(async (event) => {
 *   const log = useLogger(event)
 *   log.set({ user: { id: user.id }, conversation: { id: convId } })
 *
 *   const start = Date.now()
 *   const result = await generateText({
 *     model: openai('gpt-4o-mini'),
 *     prompt: query,
 *     tools: { searchDocs },
 *     maxSteps: 5,
 *   })
 *
 *   recordAIGeneration(log, {
 *     provider: 'openai',
 *     model: 'gpt-4o-mini',
 *     promptTokens: result.usage.promptTokens,
 *     completionTokens: result.usage.completionTokens,
 *     costUsd: estimateCost('gpt-4o-mini', result.usage),
 *     finishReason: result.finishReason,
 *     durationMs: Date.now() - start,
 *   })
 *
 *   for (const step of result.steps) {
 *     for (const tc of step.toolCalls) {
 *       recordToolCall(log, tc.toolName, tc.duration ?? 0, tc.success ?? true)
 *     }
 *   }
 *
 *   return { answer: result.text }
 * })
 */

/**
 * 反模式：把 raw prompt / 完整 output 寫進 wide event
 *
 * log.set({ ai: { prompt: userQuery, output: result.text } })  // ❌
 *
 * 為什麼：
 * - prompt / output 是 PII potential（user 私人問題、回答含個資）
 * - wide event 進 Sentry 後保留期長，PII 殘留風險
 * - prompt / output 大 → wide event size 撐爆 → drain pipeline 卡
 *
 * 正解：
 * - prompt / output 寫進短 TTL 的 server-side log（fs / debug only）
 * - wide event 只放 cost / tokens / model / finish_reason / 摘要長度
 * - 真正需要 prompt 重現時走 audit pattern + 短 TTL envelope（PII 不入 audit DB）
 */
