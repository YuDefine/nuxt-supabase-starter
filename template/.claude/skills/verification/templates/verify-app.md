---
name: verify-{{APP}}
description: "{{DISCOVERY_DESCRIPTION}}"
---

# Verify {{APP_DISPLAY_NAME}}

{{ONE_LINE_PURPOSE}}

## Launch

- Command：`{{LAUNCH_COMMAND}}`
- Ready signal：{{READY_SIGNAL}}
- Lease：{{LEASE_POLICY}}
- Teardown：`{{TEARDOWN_COMMAND}}`

## Doctor

- Command：`{{DOCTOR_COMMAND}}`
- 判讀：{{DOCTOR_EXPECTATION}}（instance、revision、port ownership、auth）
- 何時重跑：first drive、fresh session、surprising failure 之後

## Drive

- Harness：{{HARNESS}}
- Stable handles：{{STABLE_HANDLES}}
- Feature map：`features/README.md`

## Evidence

- User path：{{USER_PATH_RULE}}
- Action + result：{{ACTION_RESULT_RULE}}
- Side-effect proof：{{SECOND_VIEW_PROOF}}
- Artifact location：`{{ARTIFACT_DIR}}`
- Recorder：{{RECORDER_OR_MANIFEST}}

## Cleanup

- 清除：{{OWNED_STATE}}
- 確認：{{EVIDENCE_SURVIVES_CHECK}}

## Helpers

- `{{HELPER_PATH}}`：invocation `{{HELPER_INVOCATION}}`；inputs {{HELPER_INPUTS}}；outputs {{HELPER_OUTPUTS}}；executable bit {{HELPER_EXEC_BIT}}

