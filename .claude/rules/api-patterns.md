---
description: Server API 設計規範
globs: ['server/api/**/*.ts']
---

# API Patterns

**MUST** use Zod validation for all API inputs
**MUST** call `requireAuth()` or `requireRole()` before any business logic
**MUST** use unified response format `{ data, pagination? }`
**MUST** `const log = useLogger(event)` as first line — see `logging.md` for evlog patterns
**NEVER** return raw database errors to client — use `handleDbError()` + `createError()`
