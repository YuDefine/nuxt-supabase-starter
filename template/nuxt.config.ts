// https://nuxt.com/docs/api/configuration/nuxt-config
import pkg from './package.json'

export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  ssr: false,

  modules: [
    '@nuxt/ui',
    '@nuxt/test-utils/module',
    '@nuxt/image',
    '@nuxt/hints',
    '@nuxtjs/supabase',

    '@pinia/nuxt',
    '@vueuse/nuxt',
    '@sentry/nuxt/module',
    '@onmax/nuxt-better-auth',
    '@pinia/colada-nuxt',
    'nuxt-charts',
    'nuxt-security',
    'evlog/nuxt',
  ],

  // @nuxt/hints: dev-time real-time feedback
  // Web Vitals / hydration mismatch / 第三方腳本 / 未使用元件 / HTML 驗證
  hints: {
    devtools: true,
    features: {
      hydration: true,
      lazyLoad: true,
      webVitals: true,
      thirdPartyScripts: true,
      htmlValidate: true,
    },
  },

  // evlog: wide event logging
  evlog: {
    env: { service: 'nuxt-supabase-starter' },
    include: ['/api/**'],
    sampling: {
      rates: { info: 10 },
      keep: [{ status: 400 }, { duration: 1000 }],
    },
  },

  // @nuxt/image 配置：影像優化
  image: {
    quality: 80,
    format: ['webp', 'jpg', 'png'],
  },

  css: ['~/assets/css/main.css'],

  // 元件目錄配置：移除路徑前綴，讓元件名稱更簡潔
  // 例如 components/machines/MachineTable.vue 可直接使用 <MachineTable />
  components: [
    {
      path: '~/components',
      pathPrefix: false,
    },
  ],

  icon: {
    // ssr: false 時 @nuxt/icon 預設使用 "iconify" CDN provider，
    // 會被 CSP connect-src 擋掉。強制使用 server bundle（讀取本地 @iconify-json/*）
    provider: 'server',
    customCollections: [
      {
        prefix: 'custom',
        dir: './app/assets/icons',
      },
    ],
  },

  typescript: {
    // CI 關掉避免 Playwright E2E dev mode 載入 vite-plugin-checker 時的
    // /_nuxt/@vite-plugin-checker-runtime 解析失敗。Template CI 的 typecheck
    // step 用 `vp run typecheck` 獨立跑，不依賴此 dev-time plugin。
    typeCheck: !process.env.CI,
  },

  runtimeConfig: {
    // Server-side only（不會暴露給 client）
    supabase: {
      // Service role key，用於 serverSupabaseServiceRole()
      // 從環境變數 SUPABASE_SECRET_KEY 讀取
      secretKey: process.env.SUPABASE_SECRET_KEY,
    },
    // OAuth 設定（從環境變數讀取）
    oauth: {
      google: {
        clientId: process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID,
        clientSecret: process.env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET,
      },
      line: {
        clientId: process.env.NUXT_OAUTH_LINE_CLIENT_ID,
        clientSecret: process.env.NUXT_OAUTH_LINE_CLIENT_SECRET,
      },
      github: {
        clientId: process.env.NUXT_OAUTH_GITHUB_CLIENT_ID,
        clientSecret: process.env.NUXT_OAUTH_GITHUB_CLIENT_SECRET,
      },
    },
    // Session 設定（password 由環境變數 NUXT_SESSION_PASSWORD 提供）
    session: {
      maxAge: 60 * 60 * 24 * 7, // 7 天
      password: process.env.NUXT_SESSION_PASSWORD || '',
    },
    public: {
      supabase: {
        // 這裡明確告訴 Nuxt：請讀取系統環境變數中的 SUPABASE_URL 與 KEY
        // 如果沒有這一行，Nuxt 在 Cloudflare 上可能無法在執行時動態替換新值
        url: process.env.SUPABASE_URL,
        key: process.env.SUPABASE_KEY,
      },
      // Sentry DSN（用於 sentry.client.config.ts）
      sentry: {
        dsn: process.env.NUXT_PUBLIC_SENTRY_DSN || '',
      },
    },
  },

  // Vite 配置：移除 production 所有 console
  vite: {
    // 注入全域常數到 client-side
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      // 手動注入 NUXT_PUBLIC_SENTRY_DSN 到 import.meta.env
      // 因為 sentry.client.config.ts 在 Nuxt 初始化前執行，需要使用 import.meta.env
      // Vite 只會自動注入 VITE_* 前綴的環境變數，所以需要手動處理
      'import.meta.env.NUXT_PUBLIC_SENTRY_DSN': JSON.stringify(
        process.env.NUXT_PUBLIC_SENTRY_DSN || ''
      ),
    },
    esbuild: {
      drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    },
  },

  app: {
    head: {
      link: [
        // favicon (多種尺寸)
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        {
          rel: 'icon',
          type: 'image/png',
          sizes: '16x16',
          href: '/favicon-16x16.png',
        },
        {
          rel: 'icon',
          type: 'image/png',
          sizes: '32x32',
          href: '/favicon-32x32.png',
        },

        // iOS / Android
        {
          rel: 'apple-touch-icon',
          sizes: '180x180',
          href: '/apple-touch-icon.png',
        },
      ],
    },
  },

  // nuxt-security: OWASP 安全性 headers + rate limiting + CSRF
  security: {
    // Cloudflare Workers 相容：停用不支援的功能
    rateLimiter: false,
    // 安全性 headers
    headers: {
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        'base-uri': ["'none'"],
        'font-src': ["'self'", 'https:', 'data:'],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'img-src': ["'self'", 'data:', 'https:'],
        'object-src': ["'none'"],
        'script-src-attr': ["'none'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'connect-src': [
          "'self'",
          // local Supabase（.env.example 預設 SUPABASE_URL=http://127.0.0.1:54321）
          'http://127.0.0.1:54321',
          'http://localhost:54321',
          'ws://127.0.0.1:54321',
          'ws://localhost:54321',
          // managed / self-hosted Supabase（fork 後依實際 host 調整）
          'https://*.supabase.co',
          'wss://*.supabase.co',
          // Sentry
          'https://*.ingest.sentry.io',
          'https://*.ingest.us.sentry.io',
          // Iconify CDN（@nuxt/icon dev mode；prod 已 bundle）
          'https://api.iconify.design',
        ],
        'upgrade-insecure-requests': true,
      },
      xFrameOptions: 'DENY',
    },
    // CSRF 保護
    csrf: true,
  },

  supabase: {
    // ⚠️ 重要: 即使 ssr: false，也要啟用 SSR cookies 以便伺服器 API 可以讀取 session
    useSsrCookies: true,
    // 關閉自動重定向，由 middleware 完全控制
    redirect: false,
  },

  devtools: {
    enabled: true,
  },

  // Sentry 建置時設定：Source Maps 上傳
  // 需要設定 SENTRY_AUTH_TOKEN、SENTRY_ORG、SENTRY_PROJECT 環境變數
  sentry: {
    enabled: Boolean(process.env.SENTRY_AUTH_TOKEN),
    telemetry: false,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
  },

  // 只有在有 auth token 時才啟用 hidden source maps，上傳到 Sentry
  sourcemap: process.env.SENTRY_AUTH_TOKEN
    ? {
        client: 'hidden',
      }
    : false,

  nitro: {
    experimental: {
      openAPI: true,
    },
    preset: 'cloudflare_module',
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
    // evlog@2.10 _http adapter 帶 `import('nitro/runtime-config')` v3 fallback；nitropack v2
    // cloudflare preset 下 rollup 會把這個 dynamic import 當 unresolved external 直接 throw
    // (`and externals are not allowed!`)。給 noop stub 讓 build 通過；runtime 會走 `nitropack/runtime` 那條路徑，stub 永遠不被執行。
    virtual: {
      'nitro/runtime-config': 'export const useRuntimeConfig = () => ({});',
    },
  },
})
