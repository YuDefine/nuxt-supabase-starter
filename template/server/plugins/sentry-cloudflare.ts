import { sentryCloudflareNitroPlugin } from '@sentry/nuxt/module/plugins'
import { defineNitroPlugin } from 'nitropack/runtime'

import pkg from '../../package.json'

// Cloudflare Workers 專用的 Sentry Nitro plugin
// 參考：https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/nuxt/
export default defineNitroPlugin(
  sentryCloudflareNitroPlugin({
    dsn: process.env.SENTRY_DSN,
    // 部署身分取自注入，NEVER 從 build mode 推導（clade rules/core/deploy-env-identity.md）：
    // NODE_ENV 描述「用什麼模式 build」，不是「build 出來的東西被放到哪」。
    // 注入斷掉時落到顯眼的 'unknown'，NEVER 是 'production'。
    environment: useRuntimeConfig().appEnv,
    // Release 版本：優先使用環境變數，fallback 為 package.json 版本
    release: process.env.SENTRY_RELEASE || pkg.version,
    // Server 端的 transaction 取樣率
    tracesSampleRate: 0.2,
  }),
)
