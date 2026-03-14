## Summary

Third-round polish fixing the 3 specific issues from the re-evaluation: FAQ missing Performance/Cost/Team questions, DEPLOYMENT.md unclear Smoke Test format, and setup.sh lacking post-completion guidance on which .env values need manual configuration.

## Motivation

The third audit scored 8.1/10 and identified three concrete gaps:

1. **FAQ blind spots**: No Performance questions ("Is RLS slow?", "How to detect N+1?"), no Cost questions ("What scale does the free plan support?"), no Team questions ("How to avoid migration conflicts?"). These block team adoption decisions.
2. **DEPLOYMENT.md Smoke Test unclear**: `DEPLOY_URL` variable mentioned but format not specified (protocol? trailing slash?). Users can't complete post-deploy verification.
3. **setup.sh missing .env guidance**: Script copies `.env.example` → `.env` but doesn't tell the user which values need manual configuration. Users skip critical secrets.

Additionally, the README still has "核心概念" and "開發工作流程" sections (80+ lines) that are too advanced for the first page — they belong in guides.

## Proposed Solution

1. **FAQ expansion** (+9 entries across 3 new categories: Performance, Cost, Team)
2. **DEPLOYMENT.md fix** — clarify DEPLOY_URL format with example
3. **setup.sh enhancement** — list unfilled .env keys after completion
4. **README final trim** — move "核心概念" and "開發工作流程" to existing docs, get README under 200 lines

## Capabilities

### New Capabilities

- `faq-expansion`: Performance, Cost, and Team FAQ entries for adoption decision support
- `docs-detail-fixes`: Targeted fixes for DEPLOYMENT.md and setup.sh guidance gaps
- `readme-final-trim`: Final README reduction by moving advanced sections to existing guides

### Modified Capabilities

(none)

## Impact

- Modified files: `docs/FAQ.md`, `docs/DEPLOYMENT.md`, `scripts/setup.sh`, `README.md`
- No new files
- No migration required
- No API changes
