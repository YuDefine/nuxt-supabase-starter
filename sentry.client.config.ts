import * as Sentry from '@sentry/nuxt'
import { browserTracingIntegration, replayIntegration } from '@sentry/nuxt'

// 使用 import.meta.env 讀取 DSN（build time 注入）
// 因為 sentry.client.config.ts 在 Nuxt 初始化前執行，useRuntimeConfig() 此時還沒有正確的值
// 參考：https://docs.sentry.io/platforms/javascript/guides/nuxt/

// 宣告 Vite 注入的全域常數
declare const __APP_VERSION__: string

const sentryDsn = import.meta.env.NUXT_PUBLIC_SENTRY_DSN
const sentryRelease = __APP_VERSION__

// 僅在 production 環境且 DSN 存在時初始化 Sentry
// 這樣可以確保本地開發和 build 時不會啟用，只有 Cloudflare Workers production 才會啟用
// 使用 !import.meta.dev 判斷 production（Nuxt 原生方式，見 https://nuxt.com/docs/4.x/api/advanced/import-meta）
if (!import.meta.dev && sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    // 使用 MODE 支援 staging 等其他環境，fallback 為 'production' 確保可靠性
    environment: import.meta.env.MODE || 'production',
    // Release 版本：用於追蹤不同版本的錯誤，與 server 端保持一致
    release: sentryRelease,
    integrations: [
      browserTracingIntegration(),
      replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    // 效能監控
    tracesSampleRate: 0.1, // 捕獲 10% 的交易，後續根據流量和費用調整
    // 會話重播
    replaysSessionSampleRate: 0.1, // 對 10% 的會話進行抽樣
    replaysOnErrorSampleRate: 1.0, // 錯誤發生時 100% 重播
    // 過濾常見的無害錯誤
    ignoreErrors: [
      // 瀏覽器擴充套件或第三方腳本產生的錯誤
      'ResizeObserver loop',
      'ResizeObserver loop completed with undelivered notifications',
      // 非 Error 物件的 Promise rejection
      'Non-Error promise rejection captured',
      // 網路錯誤（通常是使用者網路問題）
      'Network request failed',
      'Failed to fetch',
      'Load failed',
      // 使用者取消操作
      'AbortError',
      // Chrome 擴充套件錯誤
      /^chrome-extension:\/\//,
      /^moz-extension:\/\//,
      // Chunk load 錯誤（部署新版本後舊 chunk 被刪除）
      'Importing a module script failed',
      /Loading chunk .* failed/,
      /ChunkLoadError/,
      /Loading CSS chunk .* failed/,
    ],
    // 過濾特定 URL 的錯誤（第三方腳本）
    denyUrls: [
      // Google Analytics
      /google-analytics\.com/,
      /googletagmanager\.com/,
      // Facebook
      /connect\.facebook\.net/,
      // 瀏覽器擴充套件
      /extensions\//,
      /^chrome:\/\//,
      /^chrome-extension:\/\//,
      /^moz-extension:\/\//,
    ],
  })
}
