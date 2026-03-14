## ADDED Requirements

### Requirement: Cloudflare deployment guide

The project SHALL provide a `docs/DEPLOYMENT.md` with step-by-step instructions for deploying to Cloudflare Workers via GitHub Actions.

#### Scenario: Document structure

- **WHEN** a user reads `docs/DEPLOYMENT.md`
- **THEN** the document SHALL cover:
  1. Prerequisites (Cloudflare account, wrangler CLI)
  2. GitHub Secrets configuration (list all required secrets)
  3. CI/CD workflow explanation (what each step does)
  4. Supabase production setup (connection string, pooler URL)
  5. Post-deployment verification checklist
  6. Rollback strategy

#### Scenario: GitHub Secrets listing

- **WHEN** the document lists required secrets
- **THEN** it SHALL include every environment variable needed for production
- **AND** each secret SHALL have a description of where to obtain it

#### Scenario: Verification checklist

- **WHEN** a user completes deployment
- **THEN** the document SHALL provide a checklist of items to verify:
  - App loads at production URL
  - Auth flow works (login/register)
  - API endpoints respond
  - Supabase connection is healthy
  - Sentry receives events (if configured)

### Requirement: Cross-references from existing docs

The README.md and QUICK_START.md SHALL link to the deployment guide.

#### Scenario: README links to deployment

- **WHEN** a user reads README.md
- **THEN** the deployment guide SHALL be referenced in the relevant section
