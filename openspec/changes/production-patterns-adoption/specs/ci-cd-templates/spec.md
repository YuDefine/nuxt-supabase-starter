## ADDED Requirements

### Requirement: CI workflow template

The starter SHALL provide a GitHub Actions CI workflow template at `docs/templates/.github/workflows/ci.yml` that runs format check, lint, typecheck, and tests in sequence.

#### Scenario: CI template content

- **WHEN** a user copies the CI template to their project's `.github/workflows/ci.yml`
- **THEN** the workflow triggers on push to tags and workflow_dispatch
- **AND** the workflow runs format check, lint, typecheck, and test steps in order
- **AND** the workflow uses `voidzero-dev/setup-vp@v1` for Node.js and pnpm setup
- **AND** the workflow has a timeout of 10 minutes

### Requirement: Deploy workflow template

The starter SHALL provide a GitHub Actions deploy workflow template at `docs/templates/.github/workflows/deploy.yml` that chains CI, database migration, Cloudflare Workers deployment, and Discord notification.

#### Scenario: Deploy template structure

- **WHEN** a user copies the deploy template to their project
- **THEN** the workflow defines four jobs: `ci`, `migrate`, `deploy`, `notify`
- **AND** `migrate` runs after `ci` succeeds
- **AND** `deploy` runs after `migrate` succeeds
- **AND** `notify` runs always (regardless of prior job results)

#### Scenario: Deploy template uses GitHub Secrets

- **WHEN** the deploy workflow runs
- **THEN** all sensitive values (Supabase keys, Cloudflare tokens, OAuth secrets) are read from GitHub Secrets
- **AND** no secrets are hardcoded in the workflow file
- **AND** the Cloudflare Workers deploy step syncs secrets via wrangler-action

#### Scenario: Notification includes job status

- **WHEN** the notify job runs
- **THEN** it sends a Discord webhook with status icons for each job (CI, Migrate, Deploy)
- **AND** the embed includes a link to the GitHub Actions run

### Requirement: E2E workflow template

The starter SHALL provide a GitHub Actions E2E workflow template at `docs/templates/.github/workflows/e2e.yml` that runs Playwright tests after CI.

#### Scenario: E2E template triggers

- **WHEN** the E2E workflow template is used
- **THEN** it triggers after the CI workflow succeeds (workflow_run)
- **AND** it sets up a Supabase local instance, builds the app, and runs Playwright tests

### Requirement: Deploy workflow templates in docs/templates

All workflow templates SHALL be placed in `docs/templates/.github/workflows/`, NOT in the starter's own `.github/workflows/` directory. The starter itself does not have active CI/CD workflows.

#### Scenario: Templates do not trigger on starter repo

- **WHEN** a commit is pushed to the starter repository
- **THEN** no CI/CD workflows are triggered from the template files
- **AND** the template files are located under `docs/templates/` only
