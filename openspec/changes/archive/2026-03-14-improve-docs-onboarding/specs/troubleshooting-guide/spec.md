## ADDED Requirements

### Requirement: Systematic troubleshooting document

The project SHALL provide a `docs/TROUBLESHOOTING.md` document organized by error symptom with diagnostic flowcharts.

#### Scenario: Document organization

- **WHEN** a user encounters an error and opens `docs/TROUBLESHOOTING.md`
- **THEN** the document SHALL be organized by symptom category, NOT by technology
- **AND** each entry SHALL follow the format: Symptom → Possible Causes → Diagnostic Commands → Solution

#### Scenario: Coverage of top error scenarios

- **WHEN** the document is complete
- **THEN** it SHALL cover at minimum these 10 scenarios:
  1. `supabase start` fails (Docker not running, port conflict)
  2. `pnpm dev` fails to start (missing env vars, port in use)
  3. Type generation errors (`pnpm db:types` fails)
  4. OAuth callback errors (redirect URI mismatch)
  5. RLS policy denies access (missing service_role bypass)
  6. Migration deployment fails (table owner mismatch)
  7. `pnpm install` fails (Node version, lockfile conflict)
  8. CORS errors in development
  9. Auth session not persisting (cookie/SSR configuration)
  10. Cloudflare deployment build errors

### Requirement: Diagnostic commands for each scenario

Each troubleshooting entry SHALL include specific diagnostic commands the user can run to identify the root cause.

#### Scenario: Actionable diagnostics

- **WHEN** a user reads a troubleshooting entry
- **THEN** the entry SHALL include at least one diagnostic command
- **AND** the expected output for both "problem found" and "no problem" states
- **AND** the specific fix for each identified cause

### Requirement: FAQ cross-references troubleshooting

The `docs/FAQ.md` SHALL link to `TROUBLESHOOTING.md` for error-related questions.

#### Scenario: FAQ links to troubleshooting

- **WHEN** a FAQ entry describes an error scenario
- **THEN** it SHALL include a link to the corresponding TROUBLESHOOTING.md section
- **AND** the FAQ answer SHALL remain concise (1-2 sentences + link)

### Requirement: Demo page separation

The component showcase SHALL be moved from the home page to a dedicated demo page.

#### Scenario: Home page simplified

- **WHEN** a new user opens the application at `/`
- **THEN** the home page SHALL display a clean welcome message
- **AND** include navigation links to key sections (demo, auth, profile)
- **AND** SHALL NOT display the full component showcase

#### Scenario: Demo page preserves content

- **WHEN** a user navigates to `/demo`
- **THEN** the page SHALL display the complete component showcase (charts, forms, tables, buttons)
- **AND** the content SHALL be identical to the current `(home).vue` content
