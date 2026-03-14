## Context

The repo has 23 high-quality Markdown docs and scored 8.6/10 in a newcomer audit, but critical gaps remain: no automated setup, no end-to-end tutorial, no troubleshooting guide, and the new CLI tool is undocumented. The review identified a clear priority ordering: P0 (blocks first-time users) → P1 (reduces time-to-productivity) → P2 (polish).

Current documentation structure:

- `docs/` — 14 guides (L1 quickstart, L2 development, L3 advanced)
- `docs/verify/` — 9 reference docs (system state truth)
- `scripts/` — 6 utility scripts (no unified setup)

## Goals / Non-Goals

**Goals:**

- New users get a running environment in under 5 minutes with a single command
- New users can build their first feature (table → API → UI → test) in 15 minutes following a tutorial
- Common errors have a systematic diagnostic path, not just "check X"
- The CLI tool (`create-nuxt-starter`) is documented in docs/verify/
- README.md gives a 60-second quick start path

**Non-Goals:**

- Rewriting existing docs that already work well (AUTH_INTEGRATION, API_DESIGN_GUIDE, etc.)
- Building a VitePress web documentation site (separate effort)
- Adding video tutorials or interactive walkthroughs
- Restructuring the L1/L2/L3 documentation hierarchy

## Decisions

### Setup script with prerequisite validation

Create `scripts/setup.sh` that checks prerequisites (Node 20+, pnpm, Docker, Supabase CLI), runs install, starts Supabase, generates types, and prints a success summary. Uses `command -v` for tool detection and version checks with regex.

**Alternative**: npm `postinstall` hook — rejected because Supabase startup is slow and shouldn't run on every install.

### Tutorial as a standalone document

Create `docs/FIRST_CRUD.md` as a self-contained 15-minute walkthrough building a "Bookmark" feature. It covers: migration → RLS → API endpoint → Pinia store → Vue component → unit test. This deliberately uses a simple domain to avoid cognitive overload.

**Alternative**: Interactive in-app tutorial — rejected as over-engineering for the current stage.

### Troubleshooting guide with decision trees

Create `docs/TROUBLESHOOTING.md` organized by error symptom (not by technology). Each entry follows: Symptom → Possible Causes → Diagnostic Commands → Solution. Covers top 10 issues from the audit: Docker failures, Supabase start issues, type generation errors, OAuth callback mismatches, RLS denials, migration conflicts, port conflicts, pnpm install failures, ARM compatibility, and CORS errors.

**Alternative**: FAQ expansion only — rejected because FAQ format lacks diagnostic flow structure.

### CLI documentation in docs/verify/

Create `docs/verify/CLI_SCAFFOLD.md` as a reference document following the verify/ convention (present tense, system state). Covers: installation, interactive mode, non-interactive mode, feature modules list, template structure, and adding new features.

### README quick start section

Add a "60-Second Quick Start" section to README.md with three paths: (1) use CLI for new project, (2) clone starter directly, (3) integrate into existing project. Keep it under 20 lines.

### Demo page separation

Move the component showcase from `app/pages/(home).vue` to `app/pages/demo.vue`. Simplify `(home).vue` to a clean welcome page with navigation links. This gives newcomers a clear starting point.

## Risks / Trade-offs

- **[Setup script portability]** → `scripts/setup.sh` assumes bash and macOS/Linux. Mitigation: add Windows notes in the script header and QUICK_START.md.
- **[Tutorial drift]** → FIRST_CRUD tutorial may become outdated as APIs evolve. Mitigation: tutorial uses the same patterns as existing code; the `/validate-starter` script can be extended to verify tutorial steps.
- **[Demo page route change]** → Moving home page content to `/demo` changes the default landing. Mitigation: new home page links to demo page prominently.
