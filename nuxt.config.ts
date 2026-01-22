// https://nuxt.com/docs/api/configuration/nuxt-config
import pkg from './package.json'

export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  ssr: false,

  modules: [
    '@nuxt/ui',
    '@nuxt/test-utils/module',
    '@nuxt/image',
    '@nuxtjs/supabase',
    '@pinia/nuxt',
    '@vueuse/nuxt',
    '@sentry/nuxt/module',
    '@onmax/nuxt-better-auth',
    '@pinia/colada-nuxt',
    'nuxt-charts',
  ],

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
    customCollections: [
      {
        prefix: 'custom',
        dir: './app/assets/icons',
      },
    ],
  },

  typescript: {
    typeCheck: true,
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
    },
  },

  // Vite 配置：移除 production 所有 console
  vite: {
    // 注入 package.json 版本號到 client-side
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
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
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
  },

  // 啟用 hidden source maps（上傳到 Sentry 但不公開）
  sourcemap: {
    client: 'hidden',
  },

  nitro: {
    experimental: {
      openAPI: true,
    },
    preset: 'cloudflare_module',
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
  },
})
