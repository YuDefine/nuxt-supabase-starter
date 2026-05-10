## ADDED Requirements

### Requirement: Meta and template boundary rule

Capability: `starter-hygiene` SHALL define the root meta repository and `template/` starter seed boundary for the Nuxt Supabase starter.

Why: `template/` content is inherited by scaffolded projects, so dogfood business code, private environment files, tenant-specific identifiers, and unmarked starter-only documents MUST be classified before they enter scaffolded paths.

Behavior: The root starter hygiene rule SHALL identify work that belongs in root meta files, work that belongs in `template/` seed files, and cross-layer Spectra work that requires explicit path-level labeling. The rule MUST state that `template/.claude/rules/` is a clade-managed projection and MUST NOT be used as the source of truth for root meta hygiene policy.

Constraints: This capability MUST NOT cover strip manifest unification, create-clean output rewriting, scaffolder CLI behavior, or validate-starter CI gate integration. Those concerns belong to the follow-up strip manifest and validation gate change.

Examples: A root maintenance script belongs outside `template/`; a starter-safe example belongs under `template/.examples/`; a starter-only note kept under `template/` uses `*.starter.md` or lives in `template/.starter/`.

#### Scenario: Maintainer classifies a cross-layer change

- **WHEN** a maintainer reads the root starter hygiene rule before changing root scripts and `template/` files
- **THEN** the rule SHALL identify which work belongs in root meta files and which work belongs in `template/` seed files
- **AND** the rule SHALL require cross-layer Spectra artifacts to label root paths separately from `template/` paths

#### Scenario: Starter-only document remains in template

- **WHEN** a starter-only document is intentionally kept under `template/`
- **THEN** the rule SHALL require the file to use a `.starter.md` suffix or live under `template/.starter/`
- **AND** the rule SHALL reject unmarked starter-only documents in ordinary starter documentation paths

#### Scenario: Dogfood business code appears in template

- **WHEN** a proposed change adds dogfood business pages, tenant-specific schema, private seed data, or real tenant identifiers under `template/`
- **THEN** the rule SHALL classify the content as starter pollution
- **AND** the rule SHALL require moving the content outside scaffolded starter paths or documenting an explicit starter-safe example location

### Requirement: Staged template hygiene pre-commit enforcement

Capability: `starter-hygiene` SHALL protect staged `template/` files through root pre-commit enforcement before pollution enters git history.

Why: Full-tree audits are useful, but staged pollution must be blocked before commit history records private environment files, secrets, tenant identifiers, dogfood hints, or unmarked starter-only documents.

Behavior: The root pre-commit hook SHALL inspect staged files under `template/`. The hook MUST block private environment files, secret-like content, real personal identifiers, tenant identifiers, dogfood business hints, and unmarked starter-only documentation. The hook MUST fail closed when a staged blob cannot be inspected.

Constraints: The hook SHALL preserve existing root hook behavior, SHALL avoid printing full secret values, and MUST NOT require a Node or package-manager startup path for the starter hygiene checks.

Examples: `template/.env.local` is blocked; `template/.env.example` with placeholder values is allowed; a file containing a Slack webhook URL is blocked without printing the full webhook URL.

#### Scenario: Private environment file is staged

- **WHEN** `template/.env.local` or `template/**/.env` is staged
- **THEN** the pre-commit hook SHALL exit non-zero
- **AND** stderr SHALL include a `[Starter Hygiene]` failure report naming the private environment file check

#### Scenario: Env example is staged

- **WHEN** `template/.env.example` is staged with placeholder values
- **THEN** the pre-commit hook SHALL allow the file to pass the private environment file check

#### Scenario: Secret-like content is staged

- **WHEN** a staged `template/` file contains an API key prefix, Bearer token, JWT-shaped token, Slack webhook URL, private key block, or equivalent secret-like pattern
- **THEN** the pre-commit hook SHALL exit non-zero
- **AND** stderr SHALL report the file path and the secret pattern category without printing the full secret value

#### Scenario: Hook scanner fails to read a staged blob

- **WHEN** the pre-commit hook cannot read a staged `template/` blob needed for hygiene checks
- **THEN** the hook SHALL exit non-zero
- **AND** stderr SHALL instruct the maintainer to rerun the audit script or inspect the staged file manually

### Requirement: Full-tree template hygiene audit script

Capability: `starter-hygiene` SHALL provide a root bash audit script for full-tree starter hygiene scans.

Why: Maintainers and future CI gates need an independent CLI entrypoint that scans the complete `template/` tree with the same hygiene vocabulary used by the pre-commit hook.

Behavior: The audit script SHALL scan `template/` for private environment files, secret-like patterns, real email values, tenant identifiers, non-placeholder UUID values, unmarked starter-only documents, and dogfood schema or page hints. The report SHALL be human-readable, grouped by starter hygiene check name, and redact full secret values.

Constraints: The script SHALL run from the repository root and from the `template/` cwd, SHALL exit 0 only when the tree is clean, and SHALL exit non-zero when at least one finding or scanner error exists. The script MUST NOT require JSON output in this change.

Examples: A clean starter tree reports no findings and exits 0; a fixture tree containing `template/.env.local`, a fake token, and an unmarked starter-only document reports three grouped findings and exits non-zero.

#### Scenario: Clean template audit

- **WHEN** the audit script scans a clean `template/` tree containing only starter-safe files and placeholder values
- **THEN** the script SHALL exit 0
- **AND** the report SHALL state that no starter hygiene findings were detected

#### Scenario: Polluted template audit

- **WHEN** the audit script scans a `template/` tree containing a private env file, secret-like token, dogfood schema hint, or unmarked starter-only document
- **THEN** the script SHALL exit non-zero
- **AND** the report SHALL group findings by starter hygiene check name

#### Scenario: Audit script runs from template cwd

- **WHEN** the audit script is executed while the current working directory is `template/`
- **THEN** the script SHALL locate the repository root correctly
- **AND** it SHALL scan the intended `template/` directory instead of the current directory twice

### Requirement: Root agent guidance for meta versus template work

Capability: `starter-hygiene` SHALL expose the meta versus template boundary in root `CLAUDE.md` for agent sessions and maintainer onboarding.

Why: Agent sessions read `CLAUDE.md` first, so the entrypoint must route work to root meta files, `template/` seed files, or a separate Spectra change before implementation begins.

Behavior: The root `CLAUDE.md` SHALL include a responsibility table, a change-routing checklist, a pointer to the root starter hygiene rule, and a statement that `template/.claude/rules/` is not the location for root meta hygiene rules. Cross-layer Spectra guidance SHALL require path levels to be marked in proposal, design, and tasks artifacts.

Constraints: This guidance SHALL NOT replace the root rule; it SHALL point to the rule. It MUST NOT direct agents to edit clade-managed template projections for root meta policy.

Examples: A root hook change routes to `../.husky/pre-commit`; a starter seed example routes to `template/.examples/`; a change spanning both layers marks root paths and `template/` paths separately.

#### Scenario: Claude session starts at repository root

- **WHEN** a Claude session reads root `CLAUDE.md`
- **THEN** the document SHALL explain that root scripts and docs are meta maintenance surfaces
- **AND** it SHALL explain that `template/` files are scaffolded starter seed surfaces

#### Scenario: Cross-layer Spectra change is planned

- **WHEN** a Spectra change touches both root meta files and `template/` files
- **THEN** root `CLAUDE.md` SHALL instruct the author to mark path levels in proposal, design, and tasks artifacts
- **AND** it SHALL reference the boundary governance sequence of boundary, projection, and validation

### Requirement: Starter hygiene violation reporting format

Capability: `starter-hygiene` SHALL standardize hygiene violation reports across rule text, pre-commit enforcement, and full-tree audit output.

Why: Maintainers need one recognizable failure format that identifies the check name, evidence, fix path, and bypass requirement without exposing secrets.

Behavior: Starter hygiene rule, pre-commit hook, and audit script violation reports SHALL use a consistent `[Starter Hygiene] <check name> 不通過` format. Each report MUST include problem, evidence, fix instructions, and bypass guidance.

Constraints: Reports MUST redact full secret values, MUST include enough file evidence to act on, and MUST keep check names aligned between the root rule, hook, audit script, and fixtures.

Examples: A private env failure names `template/.env.local`; a secret-like content failure names the file path and pattern category; an unmarked starter-only document failure names the document path and required marker location.

#### Scenario: Hook blocks a violation

- **WHEN** the pre-commit hook blocks a starter hygiene violation
- **THEN** stderr SHALL include the check name, a concise problem statement, file evidence, concrete fix instructions, and an explicit bypass path requiring documented rationale

##### Example: private env failure report

- **GIVEN** the staged file is `template/.env.local`
- **WHEN** the pre-commit hook evaluates staged template files
- **THEN** stderr includes `[Starter Hygiene] private env file 不通過`, evidence naming `template/.env.local`, instructions to remove the file or use `template/.env.example`, and bypass guidance requiring documented rationale

#### Scenario: Audit script reports multiple violations

- **WHEN** the audit script finds multiple starter hygiene violations
- **THEN** the report SHALL preserve each check name separately
- **AND** it SHALL include enough file evidence for a maintainer to fix each violation without rerunning the scan first

##### Example: grouped audit findings

| Finding input                                                | Expected group                 | Required evidence              |
| ------------------------------------------------------------ | ------------------------------ | ------------------------------ |
| `template/.env.local`                                        | private env file               | file path                      |
| `template/server/demo.ts` containing a redacted Bearer token | secret-like content            | file path and pattern category |
| `template/docs/internal.md` containing `starter-only`        | unmarked starter-only document | file path and marker category  |

### Requirement: Governance artifact sync

Capability: `starter-hygiene` SHALL record the meta versus template boundary decision in a template ADR and preserve archive follow-through in the roadmap manual completion area.

Why: The boundary decision is a durable governance choice that future strip manifest and validation gate work must reference without reverse-engineering the archived change.

Behavior: The change SHALL create `template/docs/decisions/2026-05-10-starter-meta-template-boundary.md` and SHALL update the manual `openspec/ROADMAP.md` Done area after archive. The ADR MUST describe the relationship between boundary enforcement, follow-up strip manifest unification, and follow-up validate-starter gate integration.

Constraints: This capability MUST NOT edit the ROADMAP auto-generated area. It SHALL NOT implement strip manifest or CI gate behavior in this change.

Examples: After archive, the ADR records governance layers A, B, and C; the roadmap manual Done area records `starter-hygiene-boundary-rules` as complete.

#### Scenario: Change is archived

- **WHEN** `starter-hygiene-boundary-rules` is archived after implementation
- **THEN** `template/docs/decisions/2026-05-10-starter-meta-template-boundary.md` SHALL exist with the governance decision
- **AND** `template/openspec/ROADMAP.md` SHALL record the completed change in the manual Done area

#### Scenario: Follow-up change starts after this change

- **WHEN** `scaffolder-strip-manifest-and-validation-gate` starts after this change is complete
- **THEN** the ADR and starter hygiene rule SHALL provide the boundary criteria used to decide what strip manifest and validate-starter checks enforce
