import { sentryCloudflareNitroPlugin } from '@sentry/nuxt/module/plugins'
import { defineNitroPlugin } from 'nitropack/runtime'

import pkg from '../../package.json'

// Cloudflare Workers 專用的 Sentry Nitro plugin
// 參考：https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/nuxt/
export default defineNitroPlugin(
  sentryCloudflareNitroPlugin({
    dsn: process.env.SENTRY_DSN,
    // 使用 MODE 支援 staging 等其他環境，fallback 為 'production'
    environment: process.env.NODE_ENV || 'production',
    // Release 版本：優先使用環境變數，fallback 為 package.json 版本
    release: process.env.SENTRY_RELEASE || pkg.version,
    // Server 端的 transaction 取樣率
    tracesSampleRate: 0.2,
  })
)
