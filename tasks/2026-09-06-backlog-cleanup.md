# Starter backlog cleanup — 2026-09-06

## Scope

- Repository: `<home>/offline/nuxt-supabase-starter`
- Worktree: `<home>/offline/nuxt-supabase-starter-wt/backlog-cleanup`
- Branch: `session/2026-09-06-1215-backlog-cleanup` (created by `wt-helper add`)
- Owned files: `docs/tech-debt.md`, `docs/archives/tech-debt-closed-2026-09.md`, this task receipt, and an existing root `HANDOFF.md` if present.
- `HANDOFF.md` is absent at the repository root. No empty replacement was created.
- `template/HANDOFF.md` and `template/docs/tech-debt.md` are separate post-scaffold assets and were intentionally not changed.
- No source code, tests, `.claude/**`, `.cursor/**`, workflow, commit, merge, flow, or push changes were made.

## Original TD manifest and disposition

| ID | Original status | Disposition | Evidence / blocker |
| --- | --- | --- | --- |
| TD-001 | done (2026-05-07) | archived | `de5227d`; runs `25485436035`, `25486587955`; ~6 min each |
| TD-002 | done (2026-05-10) | archived | D1 overlay capability; 41 e2e/audit tests passed; decision doc retained |
| TD-003 | done (2026-08-19) | archived | `cli.ts:542`; non-TTY `--yes` probe exit 0 |
| TD-004 | in-progress | retained active | CI structural diff still unknown; local/shallow/Node 24 simulations PASS |
| TD-005 | open | retained active | clade vendor half requires source change + publish/propagate before consumer acceptance |
| TD-006 | done (2026-08-19) | archived | install leaves template `.claude` clean; negative identifier probe blocked; audits PASS |
| TD-007 | done (2026-08-19) | archived | cwd leak fixed; 93 passed / 1 skipped; global check exit 0 |
| TD-008 | open | retained active | choose root relocation or strip-manifest path, then add hygiene fixtures |
| TD-009 | done (2026-08-24) | archived | typecheck, 280 unit tests / 2 skipped, format and hygiene audits PASS; four auth pages rendered |
| TD-010 | open | retained active | observed `403 CSRF Token Mismatch`; valid credential path and mutation protection remain unverified |
| TD-011 | open (clade scope) | retained active | managed projection still has old package name; source must be changed in clade |
| TD-012 | open | retained active | `pnpm lint <args>` shell guard failure remains unverified/fix pending |

## Handoff evidence

The root `HANDOFF.md` did not exist at review time. `template/HANDOFF.md` exists but belongs to the scaffolded project
asset and was preserved. There were no root handoff entries to disposition.

## Verification record

- Source baseline: 12 unique `## TD-NNN —` headings in `docs/tech-debt.md` at worktree HEAD `02c721b2`.
- Result: 6 active records in the main register; 6 canonical terminal records in the 2026-09 archive; all original IDs represented exactly once across those two files.
- Active records each retain `Status`, `Priority`, `Discovered`, `Location`, `Problem`, `Fix approach`, and `Acceptance`.
- Archived records each contain terminal `Status`, `Resolution/Reason`, and `Evidence`.
- `git diff --check` passed.
- `scope-verify.ts` with the three owned repository paths reported `outside: []`.
- `bash scripts/audit-template-hygiene.sh` passed; `node scripts/audit-public-hygiene.mjs` passed with 0 violations and 90 pre-existing warnings.
