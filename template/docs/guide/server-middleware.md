---
audience: both
applies-to: post-scaffold
---

# Server Middleware Templates

This project provides opt-in middleware templates in `scripts/templates/server/middleware/`. These are not auto-installed — copy them when needed.

## Rate Limiter

**Template:** `scripts/templates/server/middleware/rate-limiter.ts`

IP-based rate limiting using Nitro's built-in `unstorage`. Runs in-memory by default.

### Usage

1. Copy to `server/middleware/rate-limiter.ts`
2. Edit the `config` object to match your needs:

```typescript
const config = {
  targetPath: '/api/auth/log', // Which endpoint to protect
  windowMs: 60 * 1000, // Time window (1 minute)
  maxRequests: 20, // Max requests per window
  message: 'Too many requests.',
}
```

### Behavior

- Only applies to the configured `targetPath`
- Tracks requests per IP using unstorage
- Returns 429 when limit is exceeded
- Fails open if IP cannot be determined

### Production Notes

For production with multiple workers, configure unstorage with Redis:

```typescript
// nitro.config.ts
export default defineNitroConfig({
  storage: {
    'rate-limit': { driver: 'redis', url: process.env.REDIS_URL },
  },
})
```

## CSP Report-Only

**Template:** `scripts/templates/server/middleware/csp-report-only.ts`

Adds `Content-Security-Policy-Report-Only` headers during development.

### Usage

1. Copy to `server/middleware/csp-report-only.ts`
2. Adjust the CSP directives for your domains

### Behavior

- Only active when `NODE_ENV === 'development'`
- Does not affect production (use `nuxt-security` module instead)
- Allows common development origins (Google OAuth, Sentry, Supabase)
