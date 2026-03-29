import { defineEventHandler, setResponseHeader } from 'h3'

/**
 * CSP Report-Only middleware (development only)
 *
 * Adds Content-Security-Policy-Report-Only headers for development.
 * In production, use nuxt-security module for proper CSP enforcement.
 *
 * Usage: Copy to server/middleware/csp-report-only.ts
 */
export default defineEventHandler((event) => {
  // Only active in development
  if (process.env.NODE_ENV !== 'development') return

  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' https: data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io",
    "frame-src 'self' https://accounts.google.com",
  ].join('; ')

  setResponseHeader(event, 'Content-Security-Policy-Report-Only', csp)
})
