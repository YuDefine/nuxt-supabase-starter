## ADDED Requirements

### Requirement: Cost and time budget in README

The README.md SHALL include a "費用與時間" section showing development time estimates and production costs at different scales.

#### Scenario: Time budget table

- **WHEN** a newcomer reads the cost/time section
- **THEN** it SHALL show time estimates for:
  - Clone to running app: ~15 minutes
  - First feature (FIRST_CRUD): ~20 minutes
  - Deployment to production: ~30 minutes
- **AND** each estimate SHALL be realistic (not marketing-optimistic)

#### Scenario: Cost budget table

- **WHEN** a team evaluates this starter for production
- **THEN** the section SHALL show monthly costs at 3 scales:
  - Development/MVP: free (Supabase free + Cloudflare free)
  - Small production: ~$30/month (Supabase Pro + Cloudflare paid)
  - Growth: ~$100+/month (Supabase Pro + custom domain + monitoring)
- **AND** each tier SHALL list what is included
