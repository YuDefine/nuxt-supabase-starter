## Context

After round 1 improvements (setup script, FIRST_CRUD tutorial, troubleshooting guide, CLI docs), the repo scored 7.5/10 in a strict newcomer audit. Four specific gaps remain: README density, troubleshooting coverage, missing deployment guide, and no post-tutorial progression. This round targets each gap with minimal, focused changes.

## Goals / Non-Goals

**Goals:**

- README under 250 lines without losing essential information
- Troubleshooting covers 25+ scenarios (up from 10)
- Newcomers can deploy to Cloudflare following a step-by-step guide
- FIRST_CRUD graduates know exactly what to learn next

**Non-Goals:**

- Rewriting any existing docs that already work
- Adding Vercel or Node.js deployment guides (only Cloudflare for now)
- Building a VitePress documentation site
- Video tutorials

## Decisions

### README content extraction to dedicated docs

Move 3 sections out of README into existing or new docs, replacing with one-liner + link. This preserves all content while reducing README from 436 to ~250 lines.

Sections to extract:

- "Tech Stack" tables + "為什麼選這套 Stack" → new `docs/TECH_STACK.md`
- "AI 輔助效率" → append to existing `docs/CLAUDE_CODE_GUIDE.md`
- "Skills 更新機制" → already in `docs/SKILL_UPDATE_GUIDE.md`, just remove from README

### Troubleshooting append-only expansion

Add 15 new entries to the existing `docs/TROUBLESHOOTING.md` without modifying existing 10 entries. Same format: Symptom → Cause → Diagnostic → Fix.

### Deployment guide as standalone document

Create `docs/DEPLOYMENT.md` focused on Cloudflare Workers via GitHub Actions — the default deployment target. Structure: prerequisites → GitHub Secrets → workflow explanation → post-deploy verification → rollback.

### Learning progression as FIRST_CRUD appendix

Add a "What's Next" section at the end of `docs/FIRST_CRUD.md` with a 3-tier progression: Beginner → Intermediate → Advanced, each tier linking to 3-4 existing docs in recommended order.

## Risks / Trade-offs

- **[README link rot]** → Moving content to separate files creates more link targets. Mitigation: each extracted section gets a clear anchor in the new file.
- **[Troubleshooting bloat]** → 25 entries is a lot. Mitigation: keep each entry concise (under 30 lines); add a quick-search table at the top.
