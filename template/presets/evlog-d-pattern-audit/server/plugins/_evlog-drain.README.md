<!-- 🔒 LOCKED — managed by clade sync-evlog-presets.mjs -->
<!-- preset: evlog-d-pattern-audit -->
<!-- source: vendor/snippets/evlog-drain-pipeline/README.md -->
<!-- to: presets/evlog-d-pattern-audit/server/plugins/_evlog-drain.README.md -->
<!-- do not edit consumer-side; modify clade vendor snippet then re-propagate -->

# evlog Drain Pipeline

`createDrainPipeline` 是 evlog 的 batch + retry + buffer overflow 包覆層。clade 5 consumer 全跑 Cloudflare Workers，**所有 drain 都 MUST 經此 pipeline**（見 `rules/core/logging.md` Drain pipeline 規範）；raw drain 直接送外部 sink 會把 Workers 50 subrequest budget 吃光，且失敗無 fallback。

Reference: `docs/evlog-master-plan.md` § 3.2 + § 7（Cloudflare Workers 限制）

本 snippet 是 **T1 / T2 / T3 / O1 共用底層**，其他 evlog drain 系列（`evlog-sentry-drain` / `evlog-postgres-drain` / `evlog-nuxthub-drain`）都會 import 此 pipeline 模式。

## 為什麼強制 pipeline

| 不走 pipeline  | 後果                                                                                |
| -------------- | ----------------------------------------------------------------------------------- |
| 沒 batch       | 一次 request 50 events × `fetch` = 50 subrequest 用光，其他 fetch（DB、第三方）失敗 |
| 沒 retry       | Sentry / Axiom 限速 429 → drop event → wide event 信號斷                            |
| 沒 buffer 上限 | event 暴量時 Worker 128MB 記憶體被吃光 → OOM                                        |
| 沒 flush hook  | Worker 結束時 in-memory batch 被 GC → event 丟失                                    |

`createDrainPipeline` 把這 4 個問題一次包好。本 snippet 提供經 5 consumer 驗證的預設值。

## 安裝 SOP

1. 複製 `pipeline.ts` 到 `server/plugins/evlog-drain.ts`（multi-package 改 `packages/<x>/server/plugins/evlog-drain.ts`）。
2. 確認 consumer 已裝 `evlog` + `evlog/sentry`（`pnpm add evlog @sentry/nuxt`）。
3. `nuxt.config.ts` 設 runtime config：
   ```ts
   runtimeConfig: {
     evlog: {
       sentry: {
         dsn: '', // 由 NUXT_EVLOG_SENTRY_DSN env override
       },
     },
   }
   ```
4. `.env` / `.env.example` 加 `NUXT_SENTRY_DSN=<sentry dsn>`。
5. `pnpm dev` 起 server，觸發任一 endpoint，看 Sentry Logs（Explore → Logs）有沒有收到。
6. **Production smoke test 必跑**：`pnpm build && wrangler dev --remote`，再打 endpoint 確認 `event.waitUntil` 真的把 batch flush 出去。`pnpm dev` 跑 `node-server` preset 時 `waitUntil` 是 noop，**不能**作為 production 驗證。

## Pipeline 預設值（與 Workers 限制對齊）

| Option                 | 值                    | 為什麼                                                      |
| ---------------------- | --------------------- | ----------------------------------------------------------- |
| `batch.size`           | 50                    | 一次 `fetch` 帶 50 events = 1 subrequest（Workers 50 上限） |
| `batch.intervalMs`     | 5000                  | 5 秒沒滿也 flush，避免 event 卡太久看不到                   |
| `retry.maxAttempts`    | 3                     | 對 429 / 短暫 502 有彈性；3 次失敗就 drop（onDropped 觀測） |
| `retry.backoff`        | `'exponential'`       | 1s → 2s → 4s（hit `maxDelayMs` 截）對下游 friendly          |
| `retry.initialDelayMs` | 1000                  | 1 秒緩衝，多數 Sentry 限速 1 秒內恢復                       |
| `retry.maxDelayMs`     | 30000                 | 上限 30 秒，避免單一壞 batch 卡太久                         |
| `maxBufferSize`        | 1000                  | 1000 events 上限；超過 drop 最舊                            |
| `onDropped`            | console + Sentry meta | drop 必觀測，不可 silent                                    |

高量 consumer（> 1000 req/s）可調 `batch.size` 100、`maxBufferSize` 5000；低量 consumer 預設值即可。

## meta-event 觀測（onDropped 唯一訊號）

`createDrainPipeline` 把 buffer overflow 與 retry exhausted 都走 `onDropped` callback。區分方式：

```ts
onDropped: (events, error) => {
  if (error) {
    // retry exhausted — 對外送失敗（Sentry 限速 / 網路斷 / DSN 錯）
    // 行動：alert oncall，檢查 SENTRY_DSN 與 outbound network
  } else {
    // buffer overflow — 內部消化不及（可能是事件量暴漲 / Workers CPU 卡）
    // 行動：增 batch.size 或調高 maxBufferSize；長期看是否有事件源 spam
  }
}
```

**反模式**：在 `onDropped` 內 `throw` 或回送 evlog → 製造遞迴，把整個 worker 拖垮。要 ship 到 Sentry 必須用 Sentry SDK 直送 `captureMessage`，**不**走 evlog drain。

## Workers `event.waitUntil` 必接

```ts
nitroApp.hooks.hook('request', (event) => {
  const waitUntil = event.context.cloudflare?.context?.waitUntil
  if (typeof waitUntil === 'function') {
    waitUntil(drain.flush())
  }
})
```

**為什麼**：Workers 的 request handler return 後，runtime 立即回收 worker context（包含 in-memory batch）。沒 wire `waitUntil` 時 Worker 結束 = batch 丟失。`waitUntil` 把 flush promise 註冊給 runtime，runtime 等 promise resolve 才回收。

**警告**：本地 `pnpm dev`（node-server preset）`waitUntil` 是 noop，dev 看起來都 OK。**只有** production `wrangler dev --remote` 或 deployed Worker 才能真的驗證 batch flush。adoption checklist 必跑這條 smoke test。

## 與其他 snippet 的關係

- **`evlog-sentry-drain/`**：建議 SaaS error tracker drain，import 本 pipeline 包覆
- **`evlog-postgres-drain/`**（T2 optional）：自家 `evlog_events` table 寫入，也包 pipeline；建議 batch.size 100、intervalMs 10000（DB write 比 HTTP 容忍延遲）
- **`evlog-nuxthub-drain/`**（T3）：D1 100 writes/s 上限，**MUST** 包 pipeline + sample rate
- **`evlog-audit-signed/`**（O1）：audit 走獨立 pipeline，batch.size 20 + intervalMs 2000（量小但要快）+ `onDropped` 必 alert（chain integrity 風險）

## Multi-drain composition

```ts
const mainDrain = mainPipeline(createSentryDrain({ dsn }))
const auditDrain = auditOnly(auditPipeline(createSentryDrain({ dsn: AUDIT_DSN })))

nitroApp.hooks.hook('evlog:drain', mainDrain)
nitroApp.hooks.hook('evlog:drain', auditDrain)
```

audit 與 main pipeline **獨立**，不共用 batch / buffer，避免 audit event 排在 main batch 後面延遲送出。

## Sampling 整合（M3a-yuntech 後校正）

evlog 沒有 `samplingPolicy` factory function — sampling 是 nuxt module / LoggerConfig 的 `sampling` 欄位，由 evlog 內部在 emit 階段處理（**不**在 drain pipeline 之外包覆）：

```ts
// nuxt.config.ts — 真實 evlog API
export default defineNuxtConfig({
  modules: ['evlog/nuxt'],
  evlog: {
    sampling: {
      // rates 是百分比 0-100（不是 0-1）；error 預設 100 不可降
      rates: { error: 100, warn: 100, info: 50, debug: 0 },
      // keep[] 是 OR-logic 條件：符合任一就強制 keep（取代 legacy `forceKeep` callback）
      // 條件型別：{ status?: number, duration?: number, path?: string }
      keep: [
        { status: 400 }, // 4xx / 5xx 永遠 keep
        { duration: 1000 }, // 慢 endpoint (≥ 1s) 永遠 keep
        { path: '/api/critical/**' }, // critical path 永遠 keep
      ],
    },
  },
})
```

audit event 的「強制 keep」由 consumer 在 `server/plugins/evlog-enrich.ts` 末尾 `evlog:emit:keep` Nitro hook wire（`if (kind === 'audit') ctx.shouldKeep = true`）— evlog 2.16 **無**內建 audit forceKeep（master plan §14 第 12 條校正；vendor `evlog-enrichers-stack/enrichers.ts` 已含此 hook）。

drain pipeline 內 sampling **不需要也不能**包覆——sampling 在 emit 階段（pipeline 之前）就決定要不要送到 drain。

## Consumer onboarding checklist

- [ ] `evlog/pipeline` 已 import；`createDrainPipeline` 包覆所有 outbound drain
- [ ] `batch.size` ≤ 100、`maxBufferSize` 已設且 ≤ 5000
- [ ] `onDropped` callback 至少 console.error + Sentry meta（不可 silent）
- [ ] `nitroApp.hooks.hook('close', () => drain.flush())` 已 wire
- [ ] Cloudflare Workers consumer 已 wire `event.waitUntil(drain.flush())`
- [ ] Production smoke test：`wrangler dev --remote` 跑過 / deployed Worker 觸發 endpoint，Sentry Logs 真的有收到
- [ ] sampling / redact 在 nuxt module config 而非 drain pipeline 內
- [ ] audit drain 用獨立 pipeline，不共用 main pipeline 的 batch 配額

## 何時不該用此 pipeline

- **edge-only worker（無 nuxt nitro）**：直接呼叫 `createDrainPipeline()` 包 drain 後當 listener；無 `defineNitroPlugin` 殼
- **純 SPA / SSG**：沒 server 端，evlog 用 `evlog/client`，client transport 自帶 batch（不需此 pipeline）
- **dev fs drain（`createFsDrain`）**：本機 debug 用，可不包 pipeline（fs 寫入快，沒 batch 必要）
- **單元測試**：mock drain，跳過 pipeline
