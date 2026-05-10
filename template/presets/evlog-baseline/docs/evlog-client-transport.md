<!-- 🔒 LOCKED — managed by clade sync-evlog-presets.mjs -->
<!-- preset: evlog-baseline -->
<!-- source: vendor/snippets/evlog-client-transport/README.md -->
<!-- to: presets/evlog-baseline/docs/evlog-client-transport.md -->
<!-- do not edit consumer-side; modify clade vendor snippet then re-propagate -->

# evlog Client Transport

5/5 clade consumer 共同 gap：瀏覽器端 wide event 信號在 client 消失，瀏覽器錯誤完全靠 Sentry SDK。本 snippet 是 baseline 修補。

> **重大設計修正（M3a-yuntech 後）**：evlog/nuxt module 已內建 client transport — 自動註冊 `/api/_evlog/ingest` server handler + 自動把 client wide event 透過 fetch/sendBeacon 送出。**不需要**自家 `app/plugins/evlog-client.client.ts` 包 `createHttpLogDrain`，**不需要**自家 `server/api/_evlog/ingest.post.ts`（會跟 module 註冊的衝突）。
>
> 本 snippet 簡化為「nuxt module 配置 + identity helper 兩步」。

Reference: `docs/evlog-master-plan.md` § 5 + `rules/core/logging.md` Client logging 規範

本 snippet 內容：

- `identity-helper.ts` — 包 `setIdentity` / `clearIdentity` 的 helper（在 login / logout handler 呼叫）
- 本 README — 配置與整合指引

## 啟用 client transport（兩步）

### Step 1: nuxt.config.ts 配 `evlog.transport`

```ts
export default defineNuxtConfig({
  modules: ['evlog/nuxt'],
  evlog: {
    transport: {
      enabled: true,
      endpoint: '/api/_evlog/ingest', // nuxt module 自動註冊 handler
      credentials: 'same-origin', // 不送 cross-origin cookie
    },
  },
})
```

`evlog/nuxt` module 會：

- 自動註冊 `/api/_evlog/ingest` server handler（接 client event，re-emit 為 server-side wide event 進 enricher / drain）
- 自動 inject client plugin 包 `setMinLevel` / 預設 `keepalive: true` fetch + `sendBeacon` fallback
- 自動套 server-side `redact` 二次過濾

### Step 2: identity 同步（login / logout handler）

```ts
// 任何 login 成功路徑
import { syncEvlogIdentity, clearEvlogIdentity } from '~/utils/evlog-identity'

// nuxt-auth-utils 範例
const session = useUserSession()
watch(
  () => session.user.value,
  (user) => {
    if (user) syncEvlogIdentity({ userId: user.id, tenantId: user.tenantId })
    else clearEvlogIdentity()
  },
  { immediate: true }
)
```

不同 auth solution 的 hook 點：

| Auth            | 呼叫位置                                                                |
| --------------- | ----------------------------------------------------------------------- |
| nuxt-auth-utils | `useUserSession()` watcher（client side）                               |
| Better Auth     | `createAuthMiddleware` after hook（server）/ session callback（client） |
| LINE OAuth      | `/auth/line/callback` 成功後 redirect 前                                |
| Supabase Auth   | `onAuthStateChange` callback                                            |

## 反模式

| 反模式                                                                                   | 為什麼壞                                                                           | 怎麼改                                                                  |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 自寫 `app/plugins/evlog-client.client.ts` 包 `createHttpLogDrain` + `initLog({ drain })` | nuxt module 自動 init，重複 init race；且 `initLog` 不接 `drain` 參數（type fail） | 刪掉自家 plugin；只在 login/logout 呼叫 `setIdentity` / `clearIdentity` |
| 自寫 `server/api/_evlog/ingest.post.ts`                                                  | 跟 nuxt module 註冊的 handler 衝突（後註冊覆蓋前）                                 | 刪掉自家 endpoint；module 已自帶                                        |
| identity 寫進 cookie / localStorage 當 source of truth                                   | auth state 才是 source；多處存 = 不一致風險                                        | 只在 login 成功時 setIdentity，logout 時 clearIdentity                  |
| 沒設 `transport.enabled = true` 但寫了 setIdentity                                       | identity 沒 forward 通道，只是 in-memory dead state                                | 一定要先開 transport，再加 setIdentity                                  |

## minLevel / 自家 sampling

evlog/nuxt module 的 client log 預設 `minLevel = 'info'`；要在 client 端 runtime 動態調，用 `setMinLevel`：

```ts
// app/plugins/evlog-min-level.client.ts
import { setMinLevel } from 'evlog/client'

export default defineNuxtPlugin(() => {
  if (import.meta.dev) setMinLevel('debug')
  else setMinLevel('warn')
})
```

`suppressConsole` 由 nuxt module config 的 `console: false` 控制（M3a-yuntech 後 evlog 提供）。

## ingest endpoint 保護（nuxt module 內建 + 補強）

| 保護                | nuxt module 內建？                                               | 補強建議                                                          |
| ------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| **CSRF**            | ❌（接 same-origin POST，相依 nuxt-security 的 csrf middleware） | consumer 加 `nuxt-security` 或 `useStorage('csrf')` token 驗證    |
| **Rate-limit**      | ❌                                                               | consumer 加 `nuxt-rate-limit` 或 Cloudflare Rate Limiting binding |
| **Body schema**     | ✅（module 自家 schema 驗證）                                    | 一般情況不需動                                                    |
| **Redact 二次過濾** | ✅（透過 `evlog.redact: true` 對 ingest 也套用）                 | 配 `redact` 即可                                                  |

> yuntech-usr-sroi 採用 `nuxt-security` 的 csrf middleware（已在 `security: { csrf: true }` 啟用），不需要為 ingest endpoint 額外設定。

## 與其他 snippet 的關係

- `evlog-drain-pipeline` / `evlog-sentry-drain`：server-side ingest 收到 client event 後 re-emit，走完整 enricher + drain pipeline
- `evlog-enrichers-stack`：server-side enricher 自動 trigger，client event 也帶 geo / trace 上下文
- `evlog-client-http-drain`：純 client-side `createHttpLogDrain` 替代版；現在沒場景需要（nuxt module 已自帶 fetch/beacon transport）；本 snippet 不再依賴

## Consumer onboarding checklist

- [ ] `nuxt.config.ts` `evlog.transport.enabled = true` + `endpoint`
- [ ] auth flow 整合 `syncEvlogIdentity` / `clearEvlogIdentity` (見 step 2)
- [ ] CSRF middleware 已套（nuxt-security 或同等）
- [ ] dev：browser console 跑 `useLogger().warn('client-smoke')`，server-side log（Sentry / fs drain）應收到帶 `client.*` 欄位 + `actor.id` event
- [ ] production smoke：deployed worker，client log 真的進 Sentry / drain
- [ ] **未做**：自家寫 `app/plugins/evlog-client.client.ts` 或 `server/api/_evlog/ingest.post.ts`（兩者都 = 反模式）

## 何時不該用 client transport

- **純 SSR / SSG（沒 client interactivity）**：沒 browser event 可 forward；不開 transport
- **edge-only worker（無 nuxt nitro）**：用 `evlog/workers` server-side；client 端不適用
- **event 量 > 100/min/user**：考慮 `setMinLevel('error')` 過濾，或客製 client-side sampling

## 從 legacy snippet 遷移

如果 consumer 已有舊版 `app/plugins/evlog-client.client.ts` + `server/api/_evlog/ingest.post.ts`（pre M3a-yuntech vendor snippet）：

1. `rm app/plugins/evlog-client.client.ts`
2. `rm -rf server/api/_evlog`
3. `nuxt.config.ts` 加 `evlog.transport.enabled = true`
4. login / logout handler 加 `syncEvlogIdentity` / `clearEvlogIdentity`
5. 跑 `pnpm typecheck` 確認無遺留 import
