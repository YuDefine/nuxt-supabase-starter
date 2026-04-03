---
description: Server API 設計規範
globs: ['server/api/**/*.ts']
---

# API Patterns

**MUST** use Zod validation for all API inputs — `getValidatedQuery(event, schema.parse)` / `readValidatedBody(event, schema.parse)`
**MUST** call `requireAuth()` or `requireRole()` before any business logic
**MUST** use `getSupabaseWithContext(event)` for database access
**MUST** log mutations to `audit_logs` table（action, target_type, target_id, details）— 選用
**MUST** use unified response format `{ data, pagination? }`
**NEVER** return raw database errors to client — use `handleDbError()` + `createError()` with user-friendly message
**MUST** `const log = useLogger(event)` as first line — see `logging.md` for evlog patterns

Reference: `docs/api/API_DESIGN_GUIDE.md` — 完整 API 設計指南含進階模式
