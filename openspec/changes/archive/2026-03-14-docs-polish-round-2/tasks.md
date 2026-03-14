## 1. README Content Extraction to Dedicated Docs

- [x] 1.1 Create `docs/TECH_STACK.md` — extract full Tech Stack tables (核心框架, UI, 認證, 開發工具, 部署監控) and "為什麼選這套 Stack" comparison from README, forming a tech stack dedicated document
- [x] 1.2 Implement README line count reduction — replace extracted sections with condensed summaries + links, remove "AI 輔助效率" (content to CLAUDE_CODE_GUIDE.md), remove "Skills 更新機制" (already in SKILL_UPDATE_GUIDE.md), target ≤250 lines
- [x] 1.3 Verify README is under 250 lines and all links resolve correctly

## 2. Troubleshooting Append-Only Expansion

- [x] 2.1 Add quick-search index table at top of TROUBLESHOOTING.md listing all scenarios with symptom keywords and anchor links
- [x] 2.2 Add expanded troubleshooting scenarios 11-17: migration repair, Nuxt hydration mismatch, auth token expiry, N+1 query detection, Supabase emulator email verification bypass, pnpm check step failures, TypeScript strict mode errors
- [x] 2.3 Add expanded troubleshooting scenarios 18-25: wrangler deployment auth, hot reload not working, database connection pool exhaustion, missing RLS on new tables, seed data not loading, env var not available at runtime, Nuxt module compatibility errors, git hook husky failures
- [x] 2.4 Verify format consistency — each new entry has Symptom → Causes → Diagnostic Commands → Solution

## 3. Deployment Guide as Standalone Document

- [x] 3.1 Create Cloudflare deployment guide `docs/DEPLOYMENT.md` — prerequisites, GitHub Secrets listing, CI/CD workflow explanation, Supabase production setup, post-deployment verification checklist, rollback strategy
- [x] 3.2 Add cross-references from existing docs — link DEPLOYMENT.md from README and QUICK_START.md

## 4. Learning Progression as FIRST_CRUD Appendix

- [x] 4.1 Add post-tutorial learning path "What's Next" section to `docs/FIRST_CRUD.md` — three-tier progression (Beginner → Intermediate → Advanced), each with 3-4 linked docs in recommended reading order
- [x] 4.2 Update READING_GUIDE cross-reference — mention FIRST_CRUD.md as recommended hands-on starting point
