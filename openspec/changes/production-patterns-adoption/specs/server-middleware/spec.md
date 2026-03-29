## ADDED Requirements

### Requirement: Rate limiter middleware template

The system SHALL provide an IP-based rate limiter middleware template at `scripts/templates/server/middleware/rate-limiter.ts` that limits requests to a configurable path using Nitro unstorage.

#### Scenario: Rate limiter blocks excessive requests

- **WHEN** a client IP sends more than `maxRequests` requests to the configured `targetPath` within `windowMs` milliseconds
- **THEN** the middleware returns HTTP 429 Too Many Requests
- **AND** the response includes a descriptive status message

#### Scenario: Rate limiter allows normal traffic

- **WHEN** a client IP sends fewer than `maxRequests` requests within the time window
- **THEN** all requests pass through without interference

#### Scenario: Rate limiter ignores non-target paths

- **WHEN** a request is made to a path other than the configured `targetPath`
- **THEN** the middleware does not apply rate limiting
- **AND** the request proceeds normally

#### Scenario: Rate limiter handles missing IP gracefully

- **WHEN** a request has no identifiable IP address
- **THEN** the middleware allows the request to proceed (fail-open)

### Requirement: CSP report-only middleware template

The system SHALL provide a CSP report-only middleware template at `scripts/templates/server/middleware/csp-report-only.ts` for development environments.

#### Scenario: CSP headers applied in development

- **WHEN** the middleware is active and the environment is development
- **THEN** the response includes a `Content-Security-Policy-Report-Only` header
- **AND** the CSP directives allow common development origins (Google OAuth, Sentry, Supabase)

#### Scenario: CSP middleware inactive in production

- **WHEN** the environment is production
- **THEN** the middleware does not set any CSP headers (production CSP is handled by nuxt-security)

### Requirement: Middleware templates are not auto-installed

Server middleware templates SHALL be stored in `scripts/templates/server/middleware/`, NOT in the active `server/middleware/` directory. Users copy them manually when needed.

#### Scenario: Starter runs without template middleware

- **WHEN** the starter project runs with `pnpm dev`
- **THEN** no rate limiting or CSP report-only middleware is active
- **AND** the template files exist only in `scripts/templates/`
