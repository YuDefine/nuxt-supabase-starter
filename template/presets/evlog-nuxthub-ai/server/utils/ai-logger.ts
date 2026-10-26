/**
 * 🔒 LOCKED — managed by clade sync-evlog-presets.ts
 * preset: evlog-nuxthub-ai
 * source: vendor/snippets/evlog-ai-sdk-logger/ai-logger.ts
 * to: presets/evlog-nuxthub-ai/server/utils/ai-logger.ts
 * do not edit consumer-side; modify clade vendor snippet then re-propagate
 */
/**
 * 原生 SDK 的 LLM trace 累加器（evlog `ai.*` 欄位，不依賴 evlog 套件）
 *
 * 適用：直接呼叫 `@anthropic-ai/sdk`、`@google/genai`、`openai` 等原生 SDK 的 consumer。
 * AI SDK（`ai` + `@ai-sdk/<provider>`）consumer 不用本檔，直接用 `evlog/ai` 的
 * `createAILogger(log).wrap(model)`，見同目錄 README。
 *
 * 使用：
 *   cp vendor/snippets/evlog-ai-sdk-logger/ai-logger.ts server/utils/ai-logger.ts
 *
 * 欄位名以 `evlog/ai` 的 `AIEventData` 為準（camelCase 子集），兩條路徑查同一組欄位；
 * 本檔 MUST NOT 另立平行 schema。請求結束時 `log.set({ ai: trace.finish() })` 只寫一次。
 */

/** `AIEventData` 的子集（evlog 2.29 `evlog/ai`）；欄位名由 clade 的 node:test 釘住。 */
export interface NativeAIEvent {
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  finishReason?: string
  error?: string
  tools?: Array<{ name: string; durationMs: number; success: boolean; error?: string }>
  estimatedCost?: number
}

export interface NativeAIUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
}

export interface NativeAICall {
  provider: string
  model: string
  usage?: NativeAIUsage
  finishReason?: string
  /** 失敗輪的訊息；NEVER 放 prompt／output 原文。 */
  error?: string
}

export interface NativeAITool {
  name: string
  durationMs: number
  success: boolean
  error?: string
}

export interface NativeAITraceOptions {
  /** consumer 自有價目表算出的費用；MUST 提供，`estimatedCost` 不得省略。 */
  estimateCost: (model: string, usage: NativeAIUsage) => number | undefined
}

/**
 * per-request 累加器：每輪 LLM 呼叫 `recordCall`、每次 tool 執行 `recordTool`，
 * 請求結束 `finish()` 取得要寫進 wide event 的 `ai` 物件（同一份物件，token 為各輪加總）。
 *
 * 反模式：把 raw prompt／完整 output／embedding vector／API key 放進任何欄位。
 * prompt／output 是 PII 且撐大 wide event；需要重現時走短 TTL 的 server-side log，不進 wide event。
 */
export function createNativeAITrace(options: NativeAITraceOptions) {
  if (typeof options?.estimateCost !== 'function') {
    throw new TypeError('createNativeAITrace: estimateCost 價目函式必填（estimatedCost 不得省略）')
  }
  const event: NativeAIEvent = {}
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let hasUsage = false
  let hasCache = false
  const tools: NonNullable<NativeAIEvent['tools']> = []

  return {
    recordCall(call: NativeAICall): void {
      event.provider = call.provider
      event.model = call.model
      if (call.finishReason !== undefined) event.finishReason = call.finishReason
      if (call.error !== undefined) event.error = call.error
      if (call.usage) {
        hasUsage = true
        inputTokens += call.usage.inputTokens
        outputTokens += call.usage.outputTokens
        if (call.usage.cacheReadTokens !== undefined) {
          hasCache = true
          cacheReadTokens += call.usage.cacheReadTokens
        }
      }
    },
    recordTool(tool: NativeAITool): void {
      tools.push({
        name: tool.name,
        durationMs: tool.durationMs,
        success: tool.success,
        ...(tool.error === undefined ? {} : { error: tool.error }),
      })
    },
    finish(): NativeAIEvent {
      if (hasUsage) {
        event.inputTokens = inputTokens
        event.outputTokens = outputTokens
        if (hasCache) event.cacheReadTokens = cacheReadTokens
        if (event.model !== undefined) {
          const cost = options.estimateCost(event.model, {
            inputTokens,
            outputTokens,
            ...(hasCache ? { cacheReadTokens } : {}),
          })
          if (cost !== undefined) event.estimatedCost = cost
        }
      }
      if (tools.length) event.tools = tools
      return event
    },
  }
}

/**
 * 使用範例（原生 SDK 的 chat endpoint）
 *
 * import { useLogger } from 'evlog'
 * import { createNativeAITrace } from '~/server/utils/ai-logger'
 *
 * export default defineEventHandler(async (event) => {
 *   const log = useLogger(event)
 *   const trace = createNativeAITrace({ estimateCost })
 *   try {
 *     const res = await anthropic.messages.create({ model, messages })
 *     trace.recordCall({
 *       provider: 'anthropic',
 *       model,
 *       usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
 *       finishReason: res.stop_reason ?? undefined,
 *     })
 *     return { answer: res.content }
 *   } catch (err) {
 *     trace.recordCall({ provider: 'anthropic', model, error: String(err) })
 *     throw err
 *   } finally {
 *     log.set({ ai: trace.finish() }) // 請求結束只寫一次
 *   }
 * })
 */
