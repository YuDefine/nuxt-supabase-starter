## ADDED Requirements

### Requirement: Self-hosted deployment has single authoritative source

Self-hosted Supabase deployment instructions SHALL exist only in `docs/verify/SELF_HOSTED_SUPABASE.md`. Other files (SUPABASE_MIGRATION_GUIDE.md, ENVIRONMENT_VARIABLES.md) SHALL contain a brief summary (1 sentence) followed by a cross-reference link.

#### Scenario: SUPABASE_MIGRATION_GUIDE references instead of duplicating

- **WHEN** a reader views the Self-hosted section in SUPABASE_MIGRATION_GUIDE.md
- **THEN** it contains a 1-2 line summary and a link to SELF_HOSTED_SUPABASE.md
- **AND** it does NOT contain full deployment steps, Docker commands, or backup procedures

#### Scenario: ENVIRONMENT_VARIABLES references instead of duplicating

- **WHEN** a reader views Self-hosted environment variables in ENVIRONMENT_VARIABLES.md
- **THEN** the Cloud vs Self-hosted comparison table remains (it is unique context)
- **AND** detailed Self-hosted configuration references SELF_HOSTED_SUPABASE.md

### Requirement: Role definitions have single authoritative source

User role definitions (admin, manager, staff, unauthorized) SHALL be fully defined only in `docs/verify/AUTH_INTEGRATION.md`. Other files SHALL reference that definition.

#### Scenario: API_DESIGN_GUIDE references roles from AUTH_INTEGRATION

- **WHEN** API_DESIGN_GUIDE.md mentions user roles
- **THEN** it references AUTH_INTEGRATION.md for the definitive role list
- **AND** it does NOT duplicate the full role definition table

#### Scenario: RLS_BEST_PRACTICES references roles from AUTH_INTEGRATION

- **WHEN** RLS_BEST_PRACTICES.md uses role-based examples
- **THEN** it references AUTH_INTEGRATION.md for role definitions

### Requirement: Skills information has single authoritative source

The complete skills list with sources and counts SHALL exist only in `docs/CLAUDE_CODE_GUIDE.md`. Other files SHALL state the count and link to it.

#### Scenario: NEW_PROJECT_CHECKLIST references CLAUDE_CODE_GUIDE for skills

- **WHEN** NEW_PROJECT_CHECKLIST.md mentions skills verification
- **THEN** it states the total count and links to CLAUDE_CODE_GUIDE.md for the full list

#### Scenario: CROSS_PROJECT_SKILLS_SYNC references install script

- **WHEN** CROSS_PROJECT_SKILLS_SYNC.md lists skills categories
- **THEN** it references `scripts/install-skills.sh` as the source of truth

### Requirement: Spectra commands have single authoritative source

The complete Spectra command reference SHALL exist only in `docs/OPENSPEC.md`. Other files SHALL provide a summary with a link.

#### Scenario: CLAUDE_CODE_GUIDE summarizes Spectra with link

- **WHEN** CLAUDE_CODE_GUIDE.md mentions Spectra commands
- **THEN** it provides a brief summary table and links to OPENSPEC.md for details

#### Scenario: FAQ references OPENSPEC for Spectra details

- **WHEN** FAQ.md answers Spectra-related questions
- **THEN** it links to OPENSPEC.md rather than duplicating command tables

### Requirement: Auth setup has single authoritative source

The primary auth setup walkthrough SHALL exist in `docs/QUICK_START.md`. INTEGRATION_GUIDE.md SHALL reference it for the base setup and only document integration-specific differences.

#### Scenario: INTEGRATION_GUIDE references QUICK_START for base auth

- **WHEN** INTEGRATION_GUIDE.md covers authentication setup
- **THEN** it references QUICK_START.md for the standard flow
- **AND** only documents steps that differ for existing project integration
