<!-- 🔒 LOCKED — managed by clade sync-evlog-presets.mjs -->
<!-- preset: evlog-nuxthub-ai -->
<!-- source: vendor/snippets/evlog-mcp-sse-child-logger/README.md -->
<!-- to: presets/evlog-nuxthub-ai/docs/evlog-mcp-sse-child-logger.md -->
<!-- do not edit consumer-side; modify clade vendor snippet then re-propagate -->

# evlog SSE / MCP Child Request Logger

T3 必補：SSE / MCP / Durable Object 的 lifecycle 跨越 Nitro `afterResponse`，parent `useLogger(event)` 會在 stream / tool call 還沒結束時就 emit，後續 `log.set` 撞 sealed wide event。本 snippet 提供 fork-child + 手動 emit pattern（agentic-rag TD-057 已實證）。

Reference: `docs/evlog-master-plan.md` § 8.4 (agentic-rag T3) + nuxt-edge-agentic-rag `server/api/chat.post.ts` TD-057

## 為什麼需要 child logger

| 場景                  | parent log 行為                                   | child log 解法                  |
| --------------------- | ------------------------------------------------- | ------------------------------- |
| SSE chat stream       | Response 構造時 emit；stream 內 log.set 撞 sealed | child 在 stream settle 時 emit  |
| MCP tool session 多輪 | 同上；多輪跨多個 fetch                            | child sessionLog 跨整個 session |
| Durable Object alarm  | alarm callback 與初始 fetch 分離                  | child 在 alarm 觸發時 fork      |

## API（2 個 helper）

| Helper                                     | 用途                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `forkChildLogger(event, options)`          | 從 parent log 建獨立 child；child 帶 `operation` + `_parentRequestId`；不自動 emit                |
| `emitChildLogger(event, child, { error })` | stream settle / session close 時手動觸發 enricher + drain；error 時 `_forceKeep` 防被 sampling 丟 |

## 安裝 SOP

1. 確認 consumer 已裝 `evlog`（`createRequestLogger` from root）。
2. 複製 `child-logger.ts` 到 `server/utils/sse-child-logger.ts`。
3. 對使用 SSE 的 endpoint（例：`server/api/chat.post.ts`）改寫：

   ```ts
   import { forkChildLogger, emitChildLogger } from '~/server/utils/sse-child-logger'

   if (wantsSseResponse(event)) {
     const streamLog = forkChildLogger<ChatLogFields>(event, {
       operation: 'web-chat-sse-stream',
       user: { id: user.id },
     })
     return createSseChatResponse({
       log: streamLog,
       onStreamSettled: ({ error }) => emitChildLogger(event, streamLog, { error }),
     })
   }
   ```

4. dev：觸發 SSE endpoint，到 Sentry / D1 看到「parent wide event（operation: web-chat）+ child wide event（operation: web-chat-sse-stream），兩者用 `_parentRequestId` 串接」。

## 為什麼 child 要手動 emit + drain

evlog 的 nitro plugin 對「parent request」自動跑 enricher → drain hook chain。child request 不是 nitro 認識的對象，nitro 不會自動觸發。本 snippet 的 `runChildLogDrain` 手動呼叫 `nitroApp.hooks.callHook('evlog:enrich', ...)` 與 `'evlog:drain'`，讓 child wide event 走完同一條 pipeline。

**反模式**：fork child 後忘了 emit / drain — child wide event 完全消失，stream 內的所有 log.set 白做。

## `_forceKeep` 與 tail sampling

```ts
emitChildLogger(event, streamLog, { error: streamError })
```

內部 `streamLog.emit({ _forceKeep: error !== undefined })` — error 時強制不採樣，確保失敗 stream 一定看得到。

對 sampling 高的 consumer（info: 0.1）這條 forceKeep 是 audit 級的觀測保證。

## SSE / MCP 串聯模式

```
parent useLogger(event)         ← 自動 emit (afterResponse)
  ├─ operation: 'web-chat'
  ├─ user / route / tenant
  └─ result / status
        ↓ child request via _parentRequestId

streamLog (forked child)        ← 手動 emit (onStreamSettled)
  ├─ operation: 'web-chat-sse-stream'
  ├─ _parentRequestId
  ├─ ai.cost_usd / ai.tool_calls （見 evlog-ai-sdk-logger）
  └─ stream lifecycle metrics
```

跨 wide event JOIN 用 `_parentRequestId`。Sentry Logs UI 直接 filter `_parentRequestId:abc123` 看到 parent + 所有 child。

## 與 evlog-ai-sdk-logger 的關係

兩 snippet 配對使用：

| 檔案                               | 職責                                                         |
| ---------------------------------- | ------------------------------------------------------------ |
| `evlog-ai-sdk-logger/ai-logger.ts` | 提供 `recordAIGeneration` / `recordToolCall` — 灌 ai.\* 欄位 |
| 本 snippet                         | 提供 child logger lifecycle                                  |

組合：

```ts
const streamLog = forkChildLogger(event, { operation: 'web-chat-sse-stream' })
const aiResult = await generateText({...})
recordAIGeneration(streamLog, { ... })  // 灌進 child logger
emitChildLogger(event, streamLog)
```

## Workers 限制

`emitChildLogger` 內部用 `event.waitUntil(drainPromise)`：

- Workers：waitUntil 註冊 promise 給 runtime，stream lifecycle 結束後 runtime 等 drain flush 完才回收
- Node dev：直接 await（drain 會 block stream 結束的 Response）

dev 階段的 await 不影響功能，但 production Workers 必須 waitUntil。

## Consumer onboarding checklist（agentic-rag T3）

- [ ] `server/utils/sse-child-logger.ts` 已就位
- [ ] SSE endpoint（chat.post.ts）改用 `forkChildLogger` + `emitChildLogger`
- [ ] MCP tool session 改用 `forkChildLogger`
- [ ] error path 都有 `_forceKeep: error !== undefined`
- [ ] dev：觸發 SSE 後 Sentry 看到 parent + child 兩條 wide event，`_parentRequestId` 串接
- [ ] 無 `[evlog] log.X() called after the wide event was emitted` warning
- [ ] Workers production：streamLog drain 真的 flush（檢查 Sentry 收到 child wide event）

## 何時不該用此 snippet

- **無 SSE / MCP / Durable Object**（5 consumer 中只有 agentic-rag 用）
- **stream lifecycle 在 afterResponse 之內結束**：parent log 已夠
- **單一 quick AI call（無 stream）**：parent log + `recordAIGeneration` 即可，不需 child
