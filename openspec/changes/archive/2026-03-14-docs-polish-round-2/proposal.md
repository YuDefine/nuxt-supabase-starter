## Summary

Second-round documentation polish targeting the 4 specific gaps identified in the re-evaluation (scored 7.5/10), aiming for 8.5/10: simplify README, expand troubleshooting coverage, add deployment guide, and create a post-tutorial progression path.

## Motivation

The re-evaluation identified clear friction points that prevent the score from reaching best-in-class (8.5+):

1. **README is 436 lines** — newcomers take 2-3 minutes to find the entry point. Best-in-class starters keep README under 300 lines by moving detail to dedicated docs.
2. **Troubleshooting covers only 50%** — missing migration repair, hydration mismatch, N+1 queries, auth token expiry, Supabase emulator quirks (~15 more scenarios needed).
3. **No deployment guide** — Cloudflare is mentioned but no step-by-step exists. This blocks the production path.
4. **No "after tutorial" guide** — FIRST_CRUD.md ends abruptly. Newcomers don't know what to learn next.

## Proposed Solution

### 1. README Slim-Down (436 → ~250 lines)

- Move "Tech Stack" detailed tables to `docs/TECH_STACK.md`
- Move "為什麼選這套 Stack" to `docs/TECH_STACK.md`
- Move "AI 輔助效率" to `docs/CLAUDE_CODE_GUIDE.md`
- Move "Skills 更新機制" to `docs/SKILL_UPDATE_GUIDE.md` (already exists)
- Keep: intro, 60-second quick start, core concepts (condensed), directory structure, license

### 2. Troubleshooting Expansion (+15 scenarios)

- Migration repair (reverted status, conflict resolution)
- Nuxt hydration mismatch (SSR/SPA mode switch)
- Auth token/session expiry edge cases
- N+1 query detection and fix
- Supabase local emulator quirks (email verification bypass, rate limits)
- `pnpm check` individual step failures
- TypeScript strict mode type errors
- Wrangler deployment authentication
- Hot reload not working
- Database connection pool exhaustion
- Missing RLS on new tables
- Seed data not loading
- Environment variable not available at runtime
- Nuxt module compatibility errors
- Git hook (husky) failures

### 3. Deployment Guide (`docs/DEPLOYMENT.md`)

- Cloudflare Workers step-by-step (GitHub Actions CI/CD)
- Environment variables via GitHub Secrets
- Supabase production setup (connection string, pooler)
- Post-deployment verification checklist
- Rollback strategy

### 4. Learning Progression Path

- Add "What's Next" section to FIRST_CRUD.md
- Create progression roadmap: Tutorial → Intermediate Topics → Advanced Topics
- Link to existing docs in recommended order

## Capabilities

### New Capabilities

- `readme-slim`: Streamlined README with detail moved to dedicated documents
- `troubleshooting-expansion`: Extended troubleshooting coverage from 10 to 25 scenarios
- `deployment-guide`: Step-by-step deployment guide for Cloudflare Workers
- `learning-progression`: Post-tutorial learning path and topic roadmap

### Modified Capabilities

(none)

## Impact

- Modified files: `README.md`, `docs/TROUBLESHOOTING.md`, `docs/FIRST_CRUD.md`
- New files: `docs/TECH_STACK.md`, `docs/DEPLOYMENT.md`
- No migration required
- No API changes
- No dependency changes
