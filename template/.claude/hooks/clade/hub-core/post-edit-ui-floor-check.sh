#!/usr/bin/env bash
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HOOK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd) || exit 0
HANDLER=''
for candidate in \
  "$ROOT/scripts/runtime-handlers/ui-floor-check.mjs" \
  "$ROOT/vendor/scripts/runtime-handlers/ui-floor-check.mjs" \
  "$HOOK_DIR/../../../vendor/scripts/runtime-handlers/ui-floor-check.mjs" \
  "${CLADE_HOME:-}/vendor/scripts/runtime-handlers/ui-floor-check.mjs"; do
  [ -n "$candidate" ] && [ -f "$candidate" ] && HANDLER="$candidate" && break
done
[ -n "$HANDLER" ] || exit 0
[ -f "$(dirname -- "$HANDLER")/edited-file-paths.mjs" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
PAYLOAD=$(python3 -c 'import json,sys
try:
 d=json.load(sys.stdin)
 print(json.dumps({"repoRoot":sys.argv[1],"filePaths":[(d.get("tool_input") or {}).get("file_path","")] }))
except Exception:
 raise SystemExit(0)' "$ROOT") || exit 0
printf '%s\n' "$PAYLOAD" | node "$HANDLER"
exit $?
