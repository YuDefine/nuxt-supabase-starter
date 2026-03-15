## 1. Correct project statistics in README and directory trees match actual codebase — batch by file, not by issue type; README numbers: use "this template provides" framing

- [x] 1.1 Correct project statistics in README: rewrite exaggerated commit/API/migration counts to describe structural capabilities; update directory trees match actual codebase by adding .spectra/, shared/, packages/, .agent/, .agents/
- [x] 1.2 Fix CLAUDE.md: update Project Structure so directory trees match actual codebase (add shared/, packages/, .spectra/); ensure file paths reference existing locations by fixing .github/workflows/ → docs/templates/.github/workflows/
- [x] 1.3 Fix docs/CLAUDE_CODE_GUIDE.md: remove "2.5 個月" so no time-relative statements remain
- [x] 1.4 Fix docs/FAQ.md: remove time-relative statement so no time-relative statements remain

## 2. File paths reference existing locations and package names are current

- [x] 2.1 Ensure file paths reference existing locations in AUTH_INTEGRATION.md: change server/routes/auth/ to server/api/auth/
- [x] 2.2 Ensure file paths reference existing locations in API_DESIGN_GUIDE.md: verify shared/types/ path, update to actual location
- [x] 2.3 Ensure package names are current in verify/README.md: change @nuxtjs/supabase to @onmax/nuxt-better-auth

## 3. Ensure skills counts are accurate across all docs

- [x] 3.1 Update SKILL_UPDATE_GUIDE.md so skills counts are accurate: Antfu Skills 7 → 8
- [x] 3.2 Update NEW_PROJECT_CHECKLIST.md so skills counts are accurate: reflect 26 general skills

## 4. Self-hosted deployment has single authoritative source — deduplication strategy: keep in the most specific file

- [x] 4.1 Ensure Self-hosted deployment has single authoritative source: replace SUPABASE_MIGRATION_GUIDE.md Self-hosted chapter with summary + cross-reference
- [x] 4.2 Ensure Self-hosted deployment has single authoritative source: update ENVIRONMENT_VARIABLES.md to reference SELF_HOSTED_SUPABASE.md

## 5. Role definitions have single authoritative source — deduplication strategy: keep in the most specific file

- [x] 5.1 Ensure role definitions have single authoritative source: update API_DESIGN_GUIDE.md to reference AUTH_INTEGRATION.md
- [x] 5.2 Ensure role definitions have single authoritative source: update RLS_BEST_PRACTICES.md to reference AUTH_INTEGRATION.md

## 6. Skills information has single authoritative source and Spectra commands have single authoritative source

- [x] 6.1 Ensure skills information has single authoritative source: update CROSS_PROJECT_SKILLS_SYNC.md to reference install-skills.sh
- [x] 6.2 Ensure Spectra commands have single authoritative source: simplify CLAUDE_CODE_GUIDE.md Spectra table to summary + link
- [x] 6.3 Ensure Spectra commands have single authoritative source: simplify FAQ.md Spectra content to summary + link

## 7. Auth setup has single authoritative source

- [x] 7.1 Ensure auth setup has single authoritative source: update INTEGRATION_GUIDE.md to reference QUICK_START.md for base setup

## 8. Terminology standardization rules — Self-hosted terminology is consistent, service_role terminology is consistent, skills category naming is consistent, migration action verb is consistent

- [x] 8.1 Ensure Self-hosted terminology is consistent: grep and fix all adjective "Self-host" → "Self-hosted", Chinese → "自架"
- [x] 8.2 Ensure service_role terminology is consistent: prose uses "Service Role", code uses backtick-wrapped `service_role`
- [x] 8.3 Ensure skills category naming is consistent: "通用技術 Skills" → "通用 Skills"
- [x] 8.4 Ensure migration action verb is consistent: "應用 migration" → "套用"

## 9. RLS examples include service_role bypass and auth.role() wrapper is consistent

- [x] 9.1 Ensure RLS examples include service_role bypass: add bypass clause to all policy examples in RLS_BEST_PRACTICES.md
- [x] 9.2 Ensure auth.role() wrapper is consistent: standardize all bare auth.role() to (SELECT auth.role()) in RLS_BEST_PRACTICES.md

## 10. PINIA_ARCHITECTURE reflects actual store structure

- [x] 10.1 Ensure PINIA_ARCHITECTURE reflects actual store structure: update directory listing to match actual app/stores/ contents

## 11. Add missing content (docs-completeness)

- [x] 11.1 Ensure package.json declares Node.js version requirement: add engines field
- [x] 11.2 Ensure DEPLOYMENT includes pre-deployment checklist: add section before "首次部署"
- [x] 11.3 Ensure QUICK_START links to troubleshooting: add link at end of guide
