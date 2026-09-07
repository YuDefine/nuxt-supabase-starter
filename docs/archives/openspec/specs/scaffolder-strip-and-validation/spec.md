# scaffolder-strip-and-validation Specification

## Purpose

TBD - created by archiving change 'scaffolder-strip-manifest-and-validation-gate'. Update Purpose after archive.

## Requirements

### Requirement: Shared strip manifest source of truth

The starter SHALL define a shared strip manifest for meta-only scaffold cleanup. The manifest SHALL live at `presets/_base/strip-manifest.json` and SHALL be the only source of truth for paths or patterns that must be removed from clean starter output by both the root clean script and the scaffolder.

#### Scenario: Manifest declares a meta-only path

- **WHEN** a maintainer adds a meta-only file or directory that must not remain in clean starter output
- **THEN** the maintainer SHALL add a manifest entry with a relative path or glob, a reason, and at least one consumer
- **AND** the root clean script and the scaffolder SHALL consume that same manifest entry instead of using separate hardcoded lists

##### Example: scaffolder package is stripped by create-clean

- **GIVEN** a manifest entry `{"path":"packages/create-nuxt-starter","reason":"scaffolder-package","consumers":["create-clean"]}`
- **WHEN** `../scripts/create-clean.sh --yes` runs in the starter maintenance repository
- **THEN** `packages/create-nuxt-starter` is removed from the clean output by the manifest consumer

#### Scenario: Manifest schema is invalid

- **WHEN** the strip manifest is missing, malformed, uses an unsupported schema version, contains an absolute path, or contains path traversal
- **THEN** every manifest consumer MUST fail closed before deleting or generating files
- **AND** the failure message SHALL identify the manifest path and the invalid field

##### Example: invalid path entries

| Manifest entry                         | Expected result                     |
| -------------------------------------- | ----------------------------------- |
| `/tmp/private`                         | fail: absolute path is not allowed  |
| `../scripts/audit-template-hygiene.sh` | fail: path traversal is not allowed |
| `scripts/**/*.sh` with no consumers    | fail: consumers are required        |

---

### Requirement: create-clean manifest consumption

The root `../scripts/create-clean.sh` script SHALL read the shared strip manifest and use it to remove manifest-declared meta-only artifacts from clean project output. The script SHALL NOT maintain a second hardcoded meta-only strip list for paths covered by the manifest.

#### Scenario: create-clean strips manifest-declared entries

- **WHEN** `../scripts/create-clean.sh --yes` runs from the starter maintenance repository
- **THEN** the script SHALL resolve `template/presets/_base/strip-manifest.json`
- **AND** it SHALL remove every manifest entry whose consumers include create-clean when that entry exists in the output tree
- **AND** it SHALL report stripped and skipped entries without treating absent optional paths as failures

#### Scenario: create-clean cannot resolve the manifest

- **WHEN** create-clean cannot resolve a valid manifest before cleanup starts
- **THEN** create-clean MUST exit non-zero
- **AND** it SHALL explain whether the manifest is missing, malformed, or unreachable

##### Example: missing manifest before cleanup

- **GIVEN** `template/presets/_base/strip-manifest.json` does not exist in the starter maintenance repository
- **WHEN** `../scripts/create-clean.sh --yes` starts
- **THEN** the command exits non-zero before removing demo files
- **AND** stderr identifies the missing manifest path

---

### Requirement: Scaffolder manifest consumption

The scaffolder SHALL apply the shared strip manifest to fresh scaffold output after all base, agent, script, database overlay, and evlog preset files have been layered. The scaffolder SHALL NOT ship meta-only artifacts that the manifest marks for the scaffolder consumer.

#### Scenario: Scaffolder strips meta-only artifacts

- **WHEN** the scaffolder generates a fresh project for any supported evlog preset
- **THEN** it SHALL load `presets/_base/strip-manifest.json` from the starter root
- **AND** it SHALL remove every manifest entry whose consumers include scaffolder when that entry exists in the generated output
- **AND** the generated project SHALL NOT contain manifest-declared meta-only paths

#### Scenario: Manifest entry is absent from a generated path

- **WHEN** a manifest entry applies to scaffolder but the generated project does not contain that path
- **THEN** the scaffolder SHALL treat the entry as skipped
- **AND** the scaffold operation SHALL continue if the manifest itself is valid

##### Example: optional projection path is not generated

- **GIVEN** a manifest entry `{"path":".cursor","reason":"projection-metadata","consumers":["scaffolder"],"required":false}`
- **AND** the selected agent targets do not include cursor
- **WHEN** the scaffolder generates a project
- **THEN** the missing `.cursor` path is reported as skipped
- **AND** scaffold generation continues

---

### Requirement: Strip manifest schema and reporting contract

The strip manifest SHALL use a versioned JSON schema that includes `schema_version` and an `entries` array. Each entry SHALL include one path selector, a non-empty `reason`, and a non-empty `consumers` list whose values are limited to create-clean and scaffolder.

#### Scenario: Valid manifest entry is parsed

- **WHEN** a manifest entry contains `path`, `reason`, and consumers `["create-clean", "scaffolder"]`
- **THEN** the parser SHALL normalize the path as repository-relative output path data
- **AND** it SHALL expose the same entry to both create-clean and scaffolder consumers

#### Scenario: Unknown consumer is rejected

- **WHEN** a manifest entry contains a consumer other than create-clean or scaffolder
- **THEN** the parser MUST reject the manifest
- **AND** the error SHALL include the unknown consumer value

##### Example: valid entry shape

- **GIVEN** `{"path":"packages/create-nuxt-starter","reason":"scaffolder-package","consumers":["create-clean"]}`
- **WHEN** the create-clean consumer loads the manifest
- **THEN** the entry is included in create-clean cleanup
- **AND** the entry is not applied to scaffolder output unless scaffolder is also listed as a consumer

---

### Requirement: validate-starter audit regression gate

The starter SHALL provide a validate-starter command that generates fresh scaffold fixtures and runs audit regression checks for baseline, d-pattern-audit, nuxthub-ai, and none paths. The command SHALL exit 0 only when all four paths satisfy their expected audit signals and contain no blocked findings.

#### Scenario: All four audit paths pass

- **WHEN** the validate-starter command runs on a clean starter checkout
- **THEN** it SHALL generate fresh scaffold output for baseline, d-pattern-audit, nuxthub-ai, and none
- **AND** it SHALL run the audit command for each generated output
- **AND** it SHALL exit 0 after reporting all four paths as passed

#### Scenario: Audit signal regression is detected

- **WHEN** any fresh scaffold path has blocked findings or an expected audit signal mismatch
- **THEN** validate-starter MUST exit non-zero
- **AND** the report SHALL identify the preset, generated path, signal name, expected value, and actual value

##### Example: required path coverage

| Path            | Required expectations                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| baseline        | blocked = 0, NuxtHub module not installed, Supabase default path present                                            |
| d-pattern-audit | blocked = 0, audit force-keep wiring present, Supabase default path present                                         |
| nuxthub-ai      | blocked = 0, NuxtHub module installed, drain pipeline wraps = 1, enrichers installed = 5, Supabase DB layout absent |
| none            | blocked = 0, evlog preset signals absent, Supabase default path present                                             |

---

### Requirement: CI validate-starter gate

The repository SHALL run validate-starter in GitHub Actions so pull requests cannot merge scaffold output regressions without a failing CI signal.

#### Scenario: Pull request runs validate-starter

- **WHEN** a pull request runs the validate-starter workflow
- **THEN** the workflow SHALL install project dependencies
- **AND** it SHALL run the validate-starter command
- **AND** it SHALL fail the job when validate-starter exits non-zero

##### Example: workflow command

- **GIVEN** `.github/workflows/validate-starter.yml` is triggered by a pull request
- **WHEN** the workflow reaches the validation step
- **THEN** the job runs `pnpm validate:starter`
- **AND** the job status mirrors the validate-starter exit code

#### Scenario: CI exposes the failing path

- **WHEN** the validate-starter workflow fails because one scaffold path regressed
- **THEN** the job log SHALL include the failing preset and audit signal summary
- **AND** the workflow SHALL NOT require a browser screenshot or manual UI review to diagnose the backend-only regression

##### Example: nuxthub-ai signal mismatch

- **GIVEN** the nuxthub-ai scaffold audit returns `nuxthub.moduleInstalled = 0`
- **WHEN** validate-starter runs in GitHub Actions
- **THEN** the job log includes `preset=nuxthub-ai`, `signal=nuxthub.moduleInstalled`, `expected=1`, and `actual=0`
