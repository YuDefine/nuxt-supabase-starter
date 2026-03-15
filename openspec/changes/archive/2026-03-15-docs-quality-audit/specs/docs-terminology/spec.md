## ADDED Requirements

### Requirement: Self-hosted terminology is consistent

All documentation SHALL use "Self-hosted" (hyphenated, capitalized S) as the English adjective form, and "自架" as the Chinese equivalent. The verb form "self-host" (lowercase) is acceptable only in verb position (e.g., "you can self-host Supabase").

#### Scenario: Grep finds no non-standard Self-hosted variants

- **WHEN** searching all markdown files for self-host terminology
- **THEN** every adjectival usage is "Self-hosted" (not "Self-host", "self hosted", or "Selfhosted")
- **AND** every Chinese equivalent is "自架" (not "自建" or "自行架設")

### Requirement: service_role terminology is consistent

Documentation SHALL use `service_role` (backtick-wrapped, snake_case) in code/SQL contexts and "Service Role" (capitalized, no backticks) in prose descriptions.

#### Scenario: Code contexts use backtick-wrapped service_role

- **WHEN** a markdown file references the service role in a code block or inline code
- **THEN** it uses `` `service_role` `` (snake_case, backtick-wrapped)

#### Scenario: Prose contexts use capitalized Service Role

- **WHEN** a markdown file references the service role in a prose sentence
- **THEN** it uses "Service Role" (capitalized, no backticks)

### Requirement: Skills category naming is consistent

Documentation SHALL use "通用 Skills" for general-purpose skills and "情境 Skills" for context-triggered skills. The term "通用技術 Skills" SHALL NOT be used.

#### Scenario: No document uses deprecated skills category name

- **WHEN** searching all markdown files for skills category references
- **THEN** no file contains "通用技術 Skills"
- **AND** all references use "通用 Skills" or "情境 Skills"

### Requirement: Migration action verb is consistent

Documentation SHALL use "套用" (Chinese) or "apply" (English) for the action of executing a migration. The term "應用" SHALL NOT be used for migrations.

#### Scenario: No document uses deprecated migration verb

- **WHEN** searching all markdown files for migration action descriptions
- **THEN** no file uses "應用 migration" or "應用 Migration"
- **AND** all Chinese references use "套用"

### Requirement: RLS examples include service_role bypass

All RLS policy examples in documentation SHALL include the `service_role` bypass clause as required by CLAUDE.md rules.

#### Scenario: RLS_BEST_PRACTICES examples have service_role bypass

- **WHEN** RLS_BEST_PRACTICES.md shows an RLS policy example
- **THEN** every policy includes `(SELECT auth.role()) = 'service_role' OR <user_condition>`

### Requirement: auth.role() wrapper is consistent

Documentation SHALL consistently use `(SELECT auth.role())` (with SELECT wrapper) in RLS policy examples, per the project's performance optimization pattern.

#### Scenario: No unwrapped auth.role() in policy examples

- **WHEN** a markdown file shows an RLS policy with auth.role()
- **THEN** it uses `(SELECT auth.role())` form (not bare `auth.role()`)
