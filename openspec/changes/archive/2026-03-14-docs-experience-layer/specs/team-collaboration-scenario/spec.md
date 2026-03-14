## ADDED Requirements

### Requirement: Practical team workflow scenario

The project SHALL provide a `docs/TEAM_WORKFLOW.md` document with a concrete multi-person development scenario.

#### Scenario: Two-developer conflict resolution

- **WHEN** a team reads `docs/TEAM_WORKFLOW.md`
- **THEN** it SHALL walk through a complete scenario:
  1. Dev A creates a migration on branch-a
  2. Dev B creates a migration on branch-b
  3. Both merge to main
  4. Migration conflict occurs
  5. Resolution steps with exact commands
- **AND** each step SHALL include the actual Git and Supabase CLI commands
- **AND** each step SHALL show expected terminal output

#### Scenario: PR workflow included

- **WHEN** the scenario covers the merge process
- **THEN** it SHALL include:
  - How to create a PR with migration changes
  - What CI checks run on the PR
  - How to review migration SQL in a PR
  - How to handle CI failure due to migration conflict

### Requirement: READING_GUIDE updated with new docs

The READING_GUIDE.md SHALL reference the new documents (VISUAL_GUIDE, DEBUGGING, TEAM_WORKFLOW).

#### Scenario: New docs listed in reading guide

- **WHEN** a user reads READING_GUIDE.md
- **THEN** it SHALL include entries for VISUAL_GUIDE.md, DEBUGGING.md, and TEAM_WORKFLOW.md in the appropriate tiers
