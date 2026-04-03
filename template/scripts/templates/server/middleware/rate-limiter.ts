import { defineEventHandler, getRequestIP, createError } from 'h3'

const storage = useStorage('rate-limit')

// --- Configuration ---
// Adjust these parameters for your needs
const config = {
  // Target path: only apply rate limiting to this endpoint
  targetPath: '/api/auth/log',
  // Time window (milliseconds)
  windowMs: 60 * 1000, // 1 minute
  // Maximum requests per window
  maxRequests: 20,
  // Error message
  message: 'Too many requests, please try again later.',
}
// --- End Configuration ---

/**
 * IP-based rate limiter middleware
 *
 * - Only applies to the configured target path
 * - Uses Nitro's unstorage for request tracking
 * - Runs in-memory (unless an external driver like Redis is configured)
 *
 * Usage: Copy to server/middleware/rate-limiter.ts
 */
export default defineEventHandler(async (event) => {
  if (event.path !== config.targetPath) {
    return
  }

  const ip = getRequestIP(event, { xForwardedFor: true })
  if (!ip) {
    // Fail-open if IP cannot be determined
    return
  }

  const storageKey = `ip:${ip}`
  const record = await storage.getItem<{ count: number; startTime: number }>(storageKey)

  const now = Date.now()
  const windowStart = now - config.windowMs

  if (!record || record.startTime < windowStart) {
    await storage.setItem(storageKey, { count: 1, startTime: now })
    return
  }

  if (record.count >= config.maxRequests) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      message: config.message,
    })
  }

  await storage.setItem(storageKey, { ...record, count: record.count + 1 })
})
