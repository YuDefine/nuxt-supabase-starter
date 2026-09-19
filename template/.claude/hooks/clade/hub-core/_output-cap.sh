#!/usr/bin/env bash
# _output-cap.sh — shared output capper for SessionStart hooks (sourced, not executed).
#
# SessionStart hook output is injected into the session context on every session
# start. Unbounded segments (roadmap drift warnings, claims/followups summaries,
# orphan sidecar warnings, ...) can inject 5-10KB per session. This helper caps
# any stream at a line + byte budget, keeping the head (key status lines come
# first by convention) and folding the tail into a single pointer line.
#
# Usage (from a hook in the same directory):
#   . "$(dirname "$0")/_output-cap.sh"
#   some_command 2>&1 | cap_output 8 800 "node /abs/path/script.ts" 1>&2
#
# cap_output <max_lines> <max_bytes> <full_cmd_hint>
#   Reads stdin, writes to stdout (caller redirects to stderr as needed).
#   - Input within both budgets → passed through verbatim (no fold line).
#   - Over budget → emits head lines, then exactly one fold line:
#       … folded N more lines — run <full_cmd_hint> for full output
#     Total output (head + fold line) stays <= max_lines lines and
#     <= max_bytes bytes; byte accounting is per-byte (LC_ALL=C), so
#     multibyte (CJK) content is counted correctly.
#   - Empty input → no output at all (hooks stay silent when clean).
#   Always exits 0.
cap_output() {
  local max_lines="${1:-40}"
  local max_bytes="${2:-4000}"
  local hint="${3:-the underlying command}"
  LC_ALL=C awk -v max_lines="$max_lines" -v max_bytes="$max_bytes" -v hint="$hint" '
    { total++; lines[total] = $0 }
    END {
      if (total == 0) exit 0
      total_bytes = 0
      for (i = 1; i <= total; i++) total_bytes += length(lines[i]) + 1
      if (total <= max_lines && total_bytes <= max_bytes) {
        for (i = 1; i <= total; i++) print lines[i]
        exit 0
      }
      # Over budget: reserve room for the fold line (worst case: folded == total)
      fold_max = sprintf("… folded %d more lines — run %s for full output", total, hint)
      byte_budget = max_bytes - (length(fold_max) + 1)
      if (byte_budget < 0) byte_budget = 0
      line_budget = max_lines - 1
      emitted = 0
      bytes = 0
      for (i = 1; i <= total; i++) {
        lb = length(lines[i]) + 1
        if (emitted + 1 > line_budget) break
        if (bytes + lb > byte_budget) break
        print lines[i]
        bytes += lb
        emitted++
      }
      printf "… folded %d more lines — run %s for full output\n", total - emitted, hint
      exit 0
    }
  '
}
