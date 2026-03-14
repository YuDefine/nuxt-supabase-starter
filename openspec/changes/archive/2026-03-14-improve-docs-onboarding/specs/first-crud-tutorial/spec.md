## ADDED Requirements

### Requirement: End-to-end CRUD tutorial document

The project SHALL provide a `docs/FIRST_CRUD.md` tutorial that walks a newcomer through building a complete feature from database to UI.

#### Scenario: Tutorial structure

- **WHEN** a newcomer opens `docs/FIRST_CRUD.md`
- **THEN** the tutorial SHALL cover these steps in order:
  1. Create a database migration (using `supabase migration new`)
  2. Add RLS policies (with service_role bypass)
  3. Reset database and generate types
  4. Create a server API endpoint (`server/api/v1/`)
  5. Create a Pinia store or Pinia Colada query
  6. Create a Vue component with the data
  7. Write a unit test
- **AND** each step SHALL include the exact commands to run
- **AND** each step SHALL include the complete file content to create

#### Scenario: Tutorial uses project conventions

- **WHEN** the tutorial creates code artifacts
- **THEN** all code SHALL follow the project's established patterns:
  - `useSupabaseClient()` for client reads
  - Service role client for server writes
  - `SET search_path = ''` in database functions
  - RLS policies with service_role bypass
  - Named exports (never default exports)
  - Composition API with `<script setup>`

#### Scenario: Tutorial domain is simple

- **WHEN** a newcomer follows the tutorial
- **THEN** the domain model SHALL be simple enough to complete in 15 minutes
- **AND** the domain SHALL NOT require auth or admin features to function

#### Scenario: Tutorial verification steps

- **WHEN** a newcomer completes each section
- **THEN** the tutorial SHALL include a verification step (e.g., "You will see...")
- **AND** the final verification SHALL confirm the feature works end-to-end

### Requirement: QUICK_START.md references tutorial

The QUICK_START.md SHALL reference the FIRST_CRUD tutorial as the next step after environment setup.

#### Scenario: Linking from quick start

- **WHEN** a user finishes the QUICK_START.md setup steps
- **THEN** the document SHALL link to `FIRST_CRUD.md` with text like "Build your first feature"
