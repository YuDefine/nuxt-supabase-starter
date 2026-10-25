<!-- 🔒 LOCKED — managed by clade sync-evlog-presets.ts -->
<!-- preset: evlog-nuxthub-ai -->
<!-- source: vendor/snippets/evlog-ai-sdk-logger/README.md -->
<!-- to: presets/evlog-nuxthub-ai/docs/evlog-ai-sdk-logger.md -->
<!-- do not edit consumer-side; modify clade vendor snippet then re-propagate -->

# evlog LLM trace cookbook（AI SDK 與原生 SDK 兩條路徑）

把每次 LLM 呼叫的 provider／model／token／finishReason／cost／tool 結果灌進請求 wide event 的 `ai.*` 欄位。
兩條路徑的欄位名一致，以 `evlog/ai` 的 `AIEventData`（camelCase）為準，**NEVER** 維護平行 schema。
規約本文：`rules/modules/capabilities/ai-agent/ai-agent.md`（宣告 `modules.capabilities` 含 `ai-agent` 才投影）。

| 你的 consumer 怎麼打模型 | 用哪一段 |
| --- | --- |
| AI SDK（`ai` + `@ai-sdk/<provider>`） | § 1 `evlog/ai` |
| 原生 SDK（`@anthropic-ai/sdk`、`@google/genai`、`openai`…） | § 2 `ai-logger.ts` 累加器 |

兩條都有時（例：原生 SDK 打模型、`ai` 只做 UI 串流），依**實際打模型的 SDK** 選段，不是依套件名單。

## 1. AI SDK 路徑：直接用 `evlog/ai`

evlog 2.29 起有 subpath `evlog/ai`，匯出 `createAILogger`／`createAIMiddleware`。

```ts
import { createAILogger } from 'evlog/ai'

const ai = createAILogger(log) // log = useLogger(event)
const result = streamText({ model: ai.wrap(openai('gpt-4o-mini')), prompt, tools })
```

`wrap()` 自動把 token、tool 執行、`estimatedCost` 寫進同一筆 wide event。隱私選項：

| 選項 | 規定 |
| --- | --- |
| `prompt`、`output` capture | **MUST NOT** 開啟（預設 `false`，保持） |
| `toolInputs` capture | 預設 `false`；要開 MUST 同時給遮罩 `transform` |

peer 依賴 `ai` `>=6.0.168 <8.0.0`。

## 2. 原生 SDK 路徑：`ai-logger.ts` 累加器

複製 `ai-logger.ts` 到 `server/utils/ai-logger.ts`（`sync-evlog-presets` 的 `evlog-nuxthub-ai` preset 也會複製；不 import `evlog`）。

```ts
const trace = createNativeAITrace({ estimateCost }) // estimateCost 必填：consumer 自有價目表
// 每輪 LLM 呼叫後
trace.recordCall({ provider, model, usage: { inputTokens, outputTokens }, finishReason })
// 每次 tool 執行後
trace.recordTool({ name, durationMs, success })
// 請求結束（finally）只寫一次
log.set({ ai: trace.finish() })
```

- 多輪的 token 為各輪加總；`finish()` 回同一份物件。
- 失敗輪 `recordCall({ provider, model, error })`，`finish()` 帶 `error`。
- 欄位名子集：`provider`、`model`、`inputTokens`、`outputTokens`、`cacheReadTokens`、`finishReason`、`error`、`tools[]`（`name`、`durationMs`、`success`、`error`）、`estimatedCost`；由 `test/ai-agent-native-trace-snippet.test.ts` 釘住。
- consumer 現有欄位若是 `latencyMs`／`costUsd`，改名為 `msToFinish`／`estimatedCost`（改名不改語意，屬 consumer 端 relay）。

### 價目函式

`estimatedCost` 由 consumer 自己的價目表算（evlog 不知道 model pricing）；範例值依 provider 現行價目表填：

```ts
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  'claude-haiku-4-5': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
}
const estimateCost = (model: string, u: { inputTokens: number; outputTokens: number }) => {
  const p = PRICING[model]
  return p ? p.input * u.inputTokens + p.output * u.outputTokens : undefined
}
```

## PII / 安全（兩條路徑共同）

**MUST NOT** 寫進 `event.ai.*`：raw prompt、raw output、embedding vector、API key。prompt／output 是 PII 且撐大 wide event；需要重現時走短 TTL 的 server-side log，不進 wide event，更不進 audit chain。

## Sampling 策略（高量 AI consumer）

| 子事件 | 採樣 | 理由 |
| --- | --- | --- |
| 主 LLM 呼叫的 `ai.*` 欄位 | 100% | wide event 的 `ai.*` 是核心，不採樣 |
| tool 子事件 | 100% | tool 失敗／latency outlier 必須看到 |
| embedding | cost > $0.001 才 keep | 高量 batch 量太大，走 Nitro `evlog:emit:keep` hook 自訂條件 |

進 `nuxt.config.ts` `evlog.sampling`（evlog 2.27 型別：`rates` 是依 level 的 0–100 百分比，沒有依 route 的 head sampling；依 route 保留用 `keep`）：

```ts
sampling: {
  rates: { info: 10 }, // info 事件 head sampling 留 10%
  keep: [
    { path: '/api/chat' }, // chat 路由本身（server/api/chat.post.ts）一律保留
    { path: '/api/chat/**' }, // chat 子路由一律保留
    { status: 400 }, // status >= 400 一律保留
  ],
}
```

`keep` 各條件是 OR，命中任一條就繞過 `rates`。**NEVER** 只寫 `/api/chat/**`：evlog 的 `**` 要求前面那個 `/` 存在，`/api/chat/**` **不**匹配 `/api/chat` 本身，而 chat endpoint 多半就是 `server/api/chat.post.ts`——那條路由的 info 事件會落回 `rates.info: 10`，約九成被丟。brace（`/api/chat{,/**}`）也不支援。上述行為在 evlog 2.29.0 `matchesPattern` 實測。

## 與其他 snippet 的關係

- `evlog-mcp-sse-child-logger/`：SSE／MCP 子 logger；把 `streamLog` 當 `log` 傳給 `createAILogger(streamLog)` 或 `log.set({ ai: trace.finish() })` 即可
- `evlog-nuxthub-drain/`：`event.ai.*` 寫進 D1 `_evlog.data` JSONB
- `evlog-sentry-drain/`：`event.ai.*` 在 Sentry Logs 顯示為 attributes

## Consumer onboarding checklist

- [ ] 依實際打模型的 SDK 選 § 1 或 § 2
- [ ] 每個 LLM 呼叫處都寫 `ai.*`（AI SDK：`wrap`；原生：請求結束 `log.set({ ai: trace.finish() })` 一次）
- [ ] `estimatedCost` 有值（價目表已涵蓋白名單內每個 model）
- [ ] `prompt`／`output` capture 沒開、`toolInputs` 有遮罩；抽幾筆 wide event 確認沒有原文
- [ ] sampling 已配
- [ ] dev：chat endpoint 觸發後 Sentry／D1 看到 `event.ai.inputTokens`、`event.ai.estimatedCost`、`event.ai.tools`

## 從舊版遷移

舊版 snippet 的 `AILogFields`／`recordAIGeneration`／`recordToolCall`／`recordModeration`／`recordEmbedding`（snake_case 欄位）已移除。import 過它們的 consumer（`server/utils/ai-logger.ts`）下次 preset 同步會被覆寫而斷：改用 § 1 或 § 2，欄位 `prompt_tokens`→`inputTokens`、`completion_tokens`→`outputTokens`、`cost_usd`→`estimatedCost`、`finish_reason`→`finishReason`、`tool_calls`→`tools`。

## 何時不該用

- **無 LLM 呼叫**：consumer 不跑 LLM，多餘
- **AI 量極小**（< 10/day）：cost 觀測不重要，省略亦可
