#!/usr/bin/env bash

set -euo pipefail

jq -nc --arg msg "結束前快速檢查三件事：1. 是否需要把非直覺解法寫進 docs/solutions/；2. 是否有值得沉澱到 skill 或 rule 的流程；3. 是否需要更新或清理 template/HANDOFF.md。" '{
  followup_message: $msg
}'
