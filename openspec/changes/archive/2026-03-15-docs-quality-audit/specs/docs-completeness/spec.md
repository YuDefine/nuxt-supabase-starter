## ADDED Requirements

### Requirement: PINIA_ARCHITECTURE reflects actual store structure

PINIA_ARCHITECTURE.md directory structure section SHALL match the actual `app/stores/` directory contents in the codebase.

#### Scenario: Store directory listing matches codebase

- **WHEN** a reader views the store directory structure in PINIA_ARCHITECTURE.md
- **THEN** the listed files match what actually exists in `app/stores/`

### Requirement: package.json declares Node.js version requirement

`package.json` SHALL include an `engines` field specifying the minimum Node.js version requirement (18+) as documented in README and QUICK_START.

#### Scenario: engines field exists and matches docs

- **WHEN** a developer runs `npm install` or `pnpm install`
- **THEN** the package manager checks the Node.js version against the `engines` field
- **AND** the minimum version matches what README and QUICK_START state (18+)

### Requirement: DEPLOYMENT includes pre-deployment checklist

DEPLOYMENT.md SHALL include a pre-deployment checklist before the "首次部署" section covering database backup, environment variable verification, and DNS configuration.

#### Scenario: Pre-deployment checklist exists

- **WHEN** a reader follows DEPLOYMENT.md for first deployment
- **THEN** a checklist section appears before the deployment steps
- **AND** it includes items for backup, env var verification, and DNS (if custom domain)

### Requirement: QUICK_START links to troubleshooting

QUICK_START.md SHALL include a "common issues" note or link to TROUBLESHOOTING.md after the final setup step.

#### Scenario: Reader can find help after setup

- **WHEN** a reader completes all QUICK_START steps
- **THEN** a section at the end points to TROUBLESHOOTING.md for common issues
