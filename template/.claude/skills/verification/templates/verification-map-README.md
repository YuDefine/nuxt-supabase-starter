# {{APP_DISPLAY_NAME}} verification map

- Last source reconciliation: {{LAST_SOURCE_RECONCILIATION}}
- Subject revision: {{SUBJECT_REVISION}}
- Maintainer outcome: {{MAINTAINER_OUTCOME}}

## Baseline preconditions

- URL：{{BASE_URL}}
- Env：{{ENV_REQUIREMENTS}}
- Seed：{{SEED_REQUIREMENTS}}
- Auth：{{AUTH_REQUIREMENTS}}
- Doctor：{{DOCTOR_REFERENCE}}
- Isolation：{{ISOLATION_POLICY}}
- Lease：{{LEASE_POLICY}}

## Driving conventions

- Baseline state：{{BASELINE_STATE}}
- Stable handles：{{STABLE_HANDLES}}
- Harness：{{HARNESS}}
- Reset：{{RESET_PROCEDURE}}

## Proof and skip reporting

- Action/result evidence：{{ACTION_RESULT_EVIDENCE}}
- Side effects：{{SIDE_EFFECT_PROOF}}
- Unreachable prerequisites：{{UNREACHABLE_REPORTING}}
- Entry-point honesty：{{ENTRY_POINT_HONESTY}}

## Feature entry contract

每份 feature 檔以 H1 與一段 user-visible behavior 開頭，接著依序只有 `Sub-features`、`How to get to it (user POV)`、`Driving it with <harness>`、`Gotchas` 四個 H2。

## Features

- [{{FEATURE_TITLE}}](./{{FEATURE_FILE}})

