/**
 * 🔒 LOCKED — managed by clade sync-evlog-presets.mjs
 * preset: evlog-d-pattern-audit
 * source: vendor/snippets/evlog-client-transport/identity-helper.ts
 * to: presets/evlog-d-pattern-audit/app/utils/evlog-identity.ts
 * do not edit consumer-side; modify clade vendor snippet then re-propagate
 */
/**
 * evlog client identity helper — setIdentity / clearIdentity 黏 auth state
 *
 * Source: clade docs/evlog-master-plan.md § 5 (post-M3a-yuntech 重寫)
 *
 * 重要：evlog/nuxt module **自動處理**：
 * - server-side `/api/_evlog/ingest` handler 註冊（透過 ModuleOptions.transport.endpoint）
 * - client-side 透過 `transport: { enabled: true }` 自動把 client log 透過 fetch/sendBeacon 送 server
 *
 * 本 snippet 只負責 **identity 同步**：login → setIdentity；logout → clearIdentity。
 * 不需要自家 `app/plugins/evlog-client.client.ts` 包 createHttpLogDrain；
 * 不需要自家 `server/api/_evlog/ingest.post.ts`（會跟 module 註冊的衝突）。
 *
 * 使用：
 *   1. nuxt.config.ts 內：
 *      evlog: {
 *        transport: { enabled: true, endpoint: '/api/_evlog/ingest', credentials: 'same-origin' },
 *      }
 *   2. consumer 自行決定 setIdentity 呼叫位置：
 *      - nuxt-auth-utils：在 login API success / `useUserSession` watcher
 *      - Better Auth：在 `createAuthMiddleware` after hook
 *      - LINE OAuth：在 `/auth/line/callback` 成功後
 *   3. logout / session expired 路徑呼叫 clearIdentity()
 *
 * 反模式：
 * - 把 identity 寫進 cookie / localStorage 當 source of truth — auth state 才是 source
 * - 在 `nuxt.config.ts` `evlog.transport` 之外另寫 client plugin 包 createHttpLogDrain
 *   — 重複 init 會 race，且 module 自動 init 會被覆蓋
 */

import { clearIdentity, setIdentity } from 'evlog/client'

/**
 * 在 login 成功路徑呼叫；之後該 user 的所有 client wide event 都會帶 identity。
 *
 * @example nuxt-auth-utils watcher
 *   watch(() => session.user.value, (user) => {
 *     if (user) syncEvlogIdentity({ userId: user.id, tenantId: user.tenantId })
 *     else clearEvlogIdentity()
 *   }, { immediate: true })
 */
export function syncEvlogIdentity(identity: {
  userId: string
  tenantId?: string
  [key: string]: unknown
}): void {
  setIdentity(identity)
}

/**
 * 在 logout / session expired 呼叫；之後 client wide event 不再帶 identity。
 */
export function clearEvlogIdentity(): void {
  clearIdentity()
}
