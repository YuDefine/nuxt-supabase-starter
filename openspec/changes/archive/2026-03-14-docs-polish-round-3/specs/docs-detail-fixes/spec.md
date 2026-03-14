## ADDED Requirements

### Requirement: DEPLOYMENT.md smoke test clarification

The DEPLOYMENT.md SHALL clearly specify the format and example value for the `DEPLOY_URL` variable.

#### Scenario: DEPLOY_URL format documented

- **WHEN** a user reads the GitHub Variables section of DEPLOYMENT.md
- **THEN** the `DEPLOY_URL` entry SHALL include:
  - The expected format: full URL with protocol, no trailing slash
  - An example value: `https://my-app.workers.dev`
  - A note that this is a GitHub Variable (not Secret)

### Requirement: Setup script .env guidance

The setup script SHALL list unfilled .env keys after completion so users know which values require manual configuration.

#### Scenario: Empty .env keys listed

- **WHEN** the setup script completes successfully
- **THEN** it SHALL parse the `.env` file
- **AND** list all keys that are empty or contain placeholder values
- **AND** display them as a warning with brief descriptions

#### Scenario: All .env keys filled

- **WHEN** all .env keys have non-placeholder values
- **THEN** the script SHALL NOT display the warning
- **AND** display a confirmation that all values are configured
