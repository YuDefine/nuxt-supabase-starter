## ADDED Requirements

### Requirement: Expanded troubleshooting scenarios

The `docs/TROUBLESHOOTING.md` SHALL be expanded from 10 to at least 25 troubleshooting entries.

#### Scenario: New entries added

- **WHEN** the expansion is complete
- **THEN** the document SHALL include at minimum these additional scenarios:
  1. Migration repair (reverted status on remote)
  2. Nuxt hydration mismatch warnings
  3. Auth token/session expiry
  4. N+1 query detection
  5. Supabase emulator email verification bypass
  6. `pnpm check` individual step failures
  7. TypeScript strict mode errors
  8. Wrangler deployment auth failures
  9. Hot reload not working
  10. Database connection pool exhaustion
  11. Missing RLS on new tables
  12. Seed data not loading
  13. Environment variable not available at runtime
  14. Nuxt module compatibility errors
  15. Git hook (husky) pre-commit failures

#### Scenario: Format consistency

- **WHEN** new entries are added
- **THEN** each entry SHALL follow the existing format: Symptom → Possible Causes → Diagnostic Commands → Solution
- **AND** each entry SHALL include at least one diagnostic command

### Requirement: Quick-search index table

The troubleshooting document SHALL include a quick-search table at the top for fast navigation.

#### Scenario: Index covers all entries

- **WHEN** a user opens TROUBLESHOOTING.md
- **THEN** a table at the top SHALL list all scenarios with symptom keywords and anchor links
- **AND** the table SHALL be sorted by frequency of occurrence
