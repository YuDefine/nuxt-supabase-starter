<!-- 🔒 LOCKED — managed by clade sync-evlog-presets.mjs -->
<!-- preset: evlog-nuxthub-ai -->
<!-- source: vendor/snippets/evlog-ai-sdk-logger/README.md -->
<!-- to: presets/evlog-nuxthub-ai/docs/evlog-ai-sdk-logger.md -->
<!-- do not edit consumer-side; modify clade vendor snippet then re-propagate -->

# evlog AI SDK Logger（convention，非 evlog API）

T3 必補：把 AI SDK 呼叫（`generateText` / `streamText` / tool call / moderation / embedding）的 cost / token / duration 灌進 wide event 的 `ai.*` 欄位。

Reference: `docs/evlog-master-plan.md` § 8.4 (agentic-rag T3)

## 釐清：evlog 沒有 createAILogger

master plan 早期版本提到 `createAILogger` — **這個函式不存在**。本 snippet 是 convention：在現有 `useLogger(event)` 上掛 `ai.*` 欄位 + 用 `log.info('ai.tool_call', ...)` 發子事件。

優點：

- 共享 enricher / drain / sampling / redaction 配置
- cost / token 與 user / route / tenant 在同一筆 wide event
- 不是新 logger 種類，認知成本低

## 4 個 helper

| Helper                                   | 用途                                                             |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `recordAIGeneration(log, result)`        | generateText / streamText 落地後加 ai.\* 欄位                    |
| `recordToolCall(log, name, ms, success)` | 每次 tool 執行 emit `ai.tool_call` 子事件                        |
| `recordModeration(log, result)`          | moderation outcome；flagged 時 emit `ai.moderation_flagged` warn |
| `recordEmbedding(log, result)`           | embedding query；cost > $0.001 才 keep（自家 sample）            |

`AILogFields` interface 列出共用 schema — T2 升級可改 evlog typed fields。

## 安裝 SOP

1. 確認 consumer 已裝 `evlog`、AI SDK（`ai` + provider，例如 `@ai-sdk/openai` / `@ai-sdk/anthropic`）。
2. 複製 `ai-logger.ts` 到 `server/utils/ai-logger.ts`。
3. 在 AI endpoint（例：`server/api/chat.post.ts`）import 後使用：
   ```ts
   import { recordAIGeneration, recordToolCall } from '~/server/utils/ai-logger'
   ```
4. dev 觸發 chat endpoint，到 Sentry / NuxtHub D1 看 `event.ai.cost_usd` / `event.ai.tool_calls` 都進來了。

## Cost 計算

`costUsd` 由 consumer 自己計算（evlog 不知道 model pricing）。建議：

```ts
const PRICING = {
  'gpt-4o-mini': { prompt: 0.15 / 1_000_000, completion: 0.6 / 1_000_000 },
  'claude-haiku-4-5': { prompt: 0.8 / 1_000_000, completion: 4 / 1_000_000 },
  '@cf/meta/llama-3-8b-instruct': { prompt: 0, completion: 0 }, // Workers AI free tier
}

function estimateCost(model: string, usage: { promptTokens: number; completionTokens: number }) {
  const p = PRICING[model]
  if (!p) return undefined
  return p.prompt * usage.promptTokens + p.completion * usage.completionTokens
}
```

## Sampling 策略（高量 AI consumer）

| 子事件                  | 採樣                  | 理由                                   |
| ----------------------- | --------------------- | -------------------------------------- |
| 主 generateText 落地    | 100%                  | wide event 的 ai.\* 欄位是核心，不採樣 |
| `ai.tool_call` 子事件   | 100%                  | tool 失敗 / latency outlier 必須看到   |
| `ai.embedding`          | cost > $0.001 才 keep | 高量 batch embed 量太大，自家 filter   |
| `ai.moderation_flagged` | 100%                  | 合規必須有                             |

進 nuxt.config.ts `evlog.sampling.byRoute`：

```ts
sampling: {
  byRoute: {
    'POST /api/chat': 1.0, // 全收
    'POST /api/embed': 0.1, // 高量 embedding 採樣 10%
  },
}
```

## PII / 安全（強制條件）

**MUST NOT** 把以下寫進 `event.ai.*`：

| 不可寫                        | 理由                            |
| ----------------------------- | ------------------------------- |
| Raw prompt（user query 全文） | PII risk + wide event size 撐爆 |
| Raw output（model 完整回答）  | 同上                            |
| Embedding vector              | 高維 array，wide event 不適合   |
| API key / model token         | secret leak                     |

**正解**：

- prompt / output → 短 TTL server log（`evlog/fs` 寫 dev、production 不寫）
- 真正需要 prompt 重現 → audit pattern + 短 TTL envelope（不進 audit DB）

snippet 的 helper 都已避開上述欄位。

## 與 nuxt-edge-agentic-rag 的對應

agentic-rag 既有 chat.post.ts 已經有自家 `createRequestLogger` SSE child logger（見 `evlog-mcp-sse-child-logger/`）；本 snippet 補的是 AI SDK 呼叫的 cost / token / tool 欄位灌入。兩個 snippet 並用：

```
useLogger(event)  →  AI SDK 呼叫  →  recordAIGeneration（本 snippet）
                  ↓
                  createRequestLogger child（mcp-sse-child-logger）
                  ↓
                  SSE stream lifecycle log
```

## 與其他 snippet 的關係

- `evlog-mcp-sse-child-logger/`：本 snippet 的 helpers 也適用 child logger（傳 `streamLog` 而非 parent log）
- `evlog-nuxthub-drain/`：`event.ai.*` 欄位寫進 D1 `_evlog.data` JSONB
- `evlog-sentry-drain/`：`event.ai.*` 在 Sentry Logs 顯示為 attributes

## Consumer onboarding checklist

- [ ] `server/utils/ai-logger.ts` 已就位
- [ ] AI endpoint 都呼叫 `recordAIGeneration` / `recordToolCall`（grep `recordAI` 看覆蓋率）
- [ ] cost 計算函式（`estimateCost` 或自家版）已 import 並餵進 `costUsd`
- [ ] PII：raw prompt / output 沒進 `event.ai.*`（review 抽幾筆 wide event 看 attributes）
- [ ] sampling 已配（高量 AI consumer 必降 embedding 量）
- [ ] dev：chat endpoint 觸發後 Sentry / D1 看到 `event.ai.cost_usd`、`event.ai.tool_calls`

## 何時不該用此 snippet

- **無 AI SDK call**：consumer 不跑 LLM，本 snippet 多餘
- **AI 量極小**（< 10/day）：cost 觀測不重要，省略亦可
- **直接呼叫 provider HTTP API（不走 AI SDK）**：本 snippet 假設 `ai` package；自家 wrapper 可參考但要改 import
