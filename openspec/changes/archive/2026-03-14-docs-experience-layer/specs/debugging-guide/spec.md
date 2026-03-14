## ADDED Requirements

### Requirement: Hands-on debugging guide

The project SHALL provide a `docs/DEBUGGING.md` guide with real terminal output examples for common debugging scenarios.

#### Scenario: Four debugging sections

- **WHEN** a newcomer reads `docs/DEBUGGING.md`
- **THEN** it SHALL cover these 4 scenarios with real output:
  1. Reading and fixing Vitest test failures
  2. Debugging a failing server API endpoint
  3. Analyzing slow Supabase queries with `EXPLAIN ANALYZE`
  4. Using Vue DevTools for state inspection
- **AND** each section SHALL include the actual terminal/console output
- **AND** each section SHALL annotate what each output line means

#### Scenario: Vitest failure section

- **WHEN** a newcomer encounters a failing test
- **THEN** the guide SHALL show a real Vitest error output
- **AND** explain how to read the diff, locate the failing assertion, and fix it

#### Scenario: Supabase query analysis section

- **WHEN** a newcomer suspects a slow query
- **THEN** the guide SHALL show how to run `EXPLAIN ANALYZE` via Supabase Studio
- **AND** explain how to read the output (Seq Scan vs Index Scan, cost, rows)
