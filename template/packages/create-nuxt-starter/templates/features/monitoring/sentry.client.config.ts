import * as Sentry from '@sentry/nuxt'
import { browserTracingIntegration, replayIntegration } from '@sentry/nuxt'

// 使用 import.meta.env 讀取 DSN（build time 注入）
// 因為 sentry.client.config.ts 在 Nuxt 初始化前執行，useRuntimeConfig() 此時還沒有正確的值
declare const __APP_VERSION__: string

const sentryDsn = import.meta.env.NUXT_PUBLIC_SENTRY_DSN
const sentryRelease = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'

// 僅在 production 環境且 DSN 存在時初始化 Sentry
if (!import.meta.dev && sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE || 'production',
    release: sentryRelease,
    integrations: [
      browserTracingIntegration(),
      replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    // 效能監控
    tracesSampleRate: 0.1,
    // 會話重播
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    // 過濾常見的無害錯誤
    ignoreErrors: [
      'ResizeObserver loop',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      'Network request failed',
      'Failed to fetch',
      'Load failed',
      'AbortError',
      /^chrome-extension:\/\//,
      /^moz-extension:\/\//,
      'Importing a module script failed',
      /Loading chunk .* failed/,
      /ChunkLoadError/,
      /Loading CSS chunk .* failed/,
    ],
    // 過濾第三方腳本錯誤
    denyUrls: [
      /google-analytics\.com/,
      /googletagmanager\.com/,
      /connect\.facebook\.net/,
      /extensions\//,
      /^chrome:\/\//,
      /^chrome-extension:\/\//,
      /^moz-extension:\/\//,
    ],
  })
}
