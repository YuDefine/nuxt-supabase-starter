import * as Sentry from '@sentry/nuxt'

Sentry.init({
  dsn: import.meta.env.NUXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
})
