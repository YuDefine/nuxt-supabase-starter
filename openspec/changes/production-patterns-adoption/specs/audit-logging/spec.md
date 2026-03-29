## ADDED Requirements

### Requirement: Audit logs migration template

The system SHALL provide an audit_logs migration SQL template in `scripts/templates/migrations/audit_logs.sql` that creates an `audit_logs` table with fields for tracking entity changes.

#### Scenario: Migration template table structure

- **WHEN** the audit_logs migration template is applied
- **THEN** the `audit_logs` table contains columns: `id` (uuid, PK), `user_id` (uuid, nullable), `action` (text, NOT NULL), `entity_type` (text, NOT NULL), `entity_id` (text, NOT NULL), `changes` (jsonb, nullable), `metadata` (jsonb, nullable), `created_at` (timestamptz, default now())
- **AND** an index exists on `(entity_type, entity_id)`
- **AND** an index exists on `user_id`
- **AND** an index exists on `created_at`

#### Scenario: RLS policies for audit logs

- **WHEN** the audit_logs migration template is applied
- **THEN** RLS is enabled on the `audit_logs` table
- **AND** an INSERT policy allows `service_role` only
- **AND** a SELECT policy allows `service_role` OR the authenticated user reading their own logs

### Requirement: Server-side audit utility

The system SHALL provide a `createAuditLog()` function in `server/utils/audit.ts` that inserts an audit log entry using the service role Supabase client.

#### Scenario: Create audit log entry

- **WHEN** `createAuditLog({ userId, action, entityType, entityId, changes })` is called from a server API handler
- **THEN** a row is inserted into the `audit_logs` table with the provided values
- **AND** `created_at` is automatically set to the current timestamp

#### Scenario: Audit log with metadata

- **WHEN** `createAuditLog()` is called with an optional `metadata` object
- **THEN** the metadata is stored in the `metadata` jsonb column

#### Scenario: Audit log error does not break the request

- **WHEN** `createAuditLog()` fails (e.g., database error)
- **THEN** the error is logged to the server console
- **AND** the calling API handler is NOT interrupted (audit logging is fire-and-forget)

### Requirement: Migration is a template, not auto-applied

The audit_logs migration SHALL be provided as a template file in `scripts/templates/migrations/`, NOT as a file in `supabase/migrations/`. Users MUST create their own migration via `supabase migration new audit_logs` and copy the template content.

#### Scenario: Template does not affect starter database

- **WHEN** `supabase db reset` is run on the starter project
- **THEN** no `audit_logs` table is created
- **AND** the template file exists only in `scripts/templates/migrations/`
