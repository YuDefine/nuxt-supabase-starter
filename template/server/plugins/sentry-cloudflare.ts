import { sentryCloudflareNitroPlugin } from '@sentry/nuxt/module/plugins'
import { defineNitroPlugin } from 'nitropack/runtime'
import { useRuntimeConfig } from 'nitropack/runtime/config'

import pkg from '../../package.json'

// Cloudflare Workers 專用的 Sentry Nitro plugin
// 參考：https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/nuxt/
export default defineNitroPlugin(
  sentryCloudflareNitroPlugin(() => {
    // vite-doctor 的 NITRO0008 會打在下面這行，要求改成 useRuntimeConfig(event)。這裡做不到：
    // 這個 callback 的簽名是 (nitroApp: NitroApp) => CloudflareOptions（見 @sentry/nuxt 的
    // runtime/plugins/sentry-cloudflare.server.d.ts）—— 它收到的是 NitroApp，整條路徑上
    // 沒有任何地方拿得到 H3Event。而規則只看「server/ 底下有沒有零引數的 useRuntimeConfig()」，
    // 不分 plugin 與 request handler，所以在這個位置無論如何都滿足不了。
    // vite-doctor 0.0.10 已是 npm 上最新版，升版解決不了，因此就地抑制。
    //
    // 注意這個 callback **每個 request 都會跑一次**（@sentry/nuxt 把它包在 nitroApp.localFetch
    // 的 Proxy apply 裡），不是啟動時跑一次。零引數的 useRuntimeConfig() 回傳的則是 module
    // 載入當下就凍結的 snapshot，兩者的時機不一致 —— 在 Cloudflare 上 env 是每次 invocation
    // 才注入的，這裡是否讀得到 wrangler 注入的 NUXT_APP_ENV 尚未實測。見 docs/tech-debt.md
    // TD-016。**不要**因為這個未解問題就把 config.appEnv 換成 process.env：
    // deploy-env-identity 規約指名 server / nitro plugin 就是要讀 runtime config 的 appEnv。
    //
    // 抑制註解 MUST 貼在被打的那一行**上方 1 或 2 行**（實測：正好 3 行就失效，且是靜默失效
    // —— doctor 照常報這條，外觀跟沒加抑制一模一樣）。
    // doctor-disable-next-line nitro/runtime/require-event-runtime-config-in-server -- callback 收到的是 NitroApp，拿不到 H3Event；見上方註解
    const config = useRuntimeConfig()
    return {
      dsn: process.env.SENTRY_DSN,
      // 部署身分取自 runtime config，NEVER 從 build mode 推導（clade rules/core/deploy-env-identity.md）：
      // NODE_ENV 描述「用什麼模式 build」，不是「build 出來的東西被放到哪」。
      // 注入斷掉時落到顯眼的 'unknown'，NEVER 是 'production'。
      environment: config.appEnv || 'unknown',
      // Release 版本：優先使用環境變數，fallback 為 package.json 版本
      release: process.env.SENTRY_RELEASE || pkg.version,
      // Server 端的 transaction 取樣率
      tracesSampleRate: 0.2,
    }
  }),
)
