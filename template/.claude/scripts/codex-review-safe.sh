#!/usr/bin/env bash
# codex-review-safe.sh — cross-model code review via `codex exec`
#
# Engine: `codex exec -s read-only` with an embedded review prompt — not
# `codex review`, which hardcodes a `workspace-write` sandbox that permanently
# hangs any MCP server registered in ~/.codex/config.toml on its first tool
# call (see rules/core/agent-routing.codex-watch-protocol.md § "`codex review`
# 禁用"). read-only sandbox allows shell commands (git diff, cat) but rejects
# write operations and MCP tool calls (fail-fast, not hang) — matches review's
# read-only intent and blocks prompt-injection escape to write/MCP side-effects.
# ~/.codex/config.toml is never read, copied, or moved by this script.
#
# Usage:
#   .claude/scripts/codex-review-safe.sh [reasoning_effort] [extra codex args...]
#
# Default reasoning_effort = xhigh. The commit 0-A flow calls this twice:
# 0-A.1 with `high` (always, unless fast-path skips), and 0-A.2 with `xhigh`
# (conditional — only when 0-A.1 surfaces Critical/Major). Other contexts
# (Spectra propose/apply) use xhigh. See .claude/skills/commit/SKILL.md Step 0-A.
#
# The embedded prompt tells codex to collect the uncommitted diff itself
# (staged + unstaged + untracked) as the first thing it does in its own
# turn — that's what gives Step 0-A its "reviews a snapshot; later
# working-tree edits don't retroactively affect an already-running review"
# semantics.
#
# TD-235 resolved: migrated from --dangerously-bypass-approvals-and-sandbox to
# -s read-only (2026-07-08). Prompt injection can no longer escape to writes or
# MCP side-effects; "fleet-own diffs only" constraint remains as defense-in-depth.
#
# Semantic Verdict injection (W5-6): the prompt is assembled from two literal
# (single-quoted) heredocs sandwiching a runtime-generated block that lists
# vendor/review-rules/patterns.json's `semantic` rules — that block cannot be
# a plain `<<'PROMPT_EOF'` heredoc because heredocs quoted that way never
# expand shell variables. Missing/empty patterns.json degrades to an empty
# block plus one stderr warning; it never fails the script.
#
# Exit code: passes through codex exec's exit code.

set -uo pipefail

REASONING="${1:-xhigh}"
shift || true  # tolerate no args after reasoning

# Resolve repo root via git, not the script's own path — clade's own checkout
# (plugins/hub-core/scripts/) and a consumer's projected copy (.claude/scripts/)
# sit at different depths, so a path computed from $0 would resolve wrong in
# one of the two contexts.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PATTERNS_JSON="$REPO_ROOT/vendor/review-rules/patterns.json"

SEMANTIC_LIST=""
if [ -f "$PATTERNS_JSON" ]; then
  SEMANTIC_LIST="$(node -e '
    const fs = require("fs")
    try {
      const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
      const items = Array.isArray(data.semantic) ? data.semantic : []
      if (items.length > 0) {
        console.log("Semantic rules to also evaluate (each requires a verdict below):")
        for (const it of items) console.log(`- ${it.id}: ${it.guidance}`)
      }
    } catch {}
  ' "$PATTERNS_JSON" 2>/dev/null)"
  if [ -z "$SEMANTIC_LIST" ]; then
    echo "[codex-review-safe] warn: $PATTERNS_JSON 無 semantic 規則 — 略過 Semantic Verdict 注入" >&2
  fi
else
  echo "[codex-review-safe] warn: $PATTERNS_JSON 不存在 — 略過 Semantic Verdict 注入" >&2
fi

{
  cat <<'PROMPT_PREFIX'
You are performing a cross-model code review of the current git working tree.

Collect the uncommitted changes yourself first, using:
- `git diff --cached` for staged changes
- `git diff` for unstaged changes
- `git ls-files --others --exclude-standard` for untracked new files — read each one

Review those changes for bugs, logic errors, security issues, and edge
cases — not style or formatting. This is a read-only review: **NEVER** edit,
create, or delete any file, and **NEVER** run any command that changes
repository or working-tree state (no git add/commit/checkout/stash/push, no
file writes via any tool). Only run read-only inspection commands.

PROMPT_PREFIX
  if [ -n "$SEMANTIC_LIST" ]; then
    printf '%s\n\n' "$SEMANTIC_LIST"
  fi
  cat <<'PROMPT_SUFFIX'
Output your findings under a single `## Review Verdict` heading, one line
per finding:
- [Critical|Major|Minor] <file>:<line> — <one-sentence finding and why it matters>

If you find nothing, output exactly one line under that heading:
- No findings.
PROMPT_SUFFIX
  if [ -n "$SEMANTIC_LIST" ]; then
    cat <<'PROMPT_VERDICT'
Additionally, for EACH semantic rule listed above, output a `## Semantic Verdict` table with one row per id: `| <id> | pass|fail|n-a | <one-line evidence> |`. Use n-a only when the diff touches no file in that rule's scope.
PROMPT_VERDICT
  fi
} | codex exec \
  --model gpt-5.6-sol \
  -s read-only \
  --skip-git-repo-check \
  -c model_reasoning_effort="$REASONING" \
  --ephemeral \
  --disable memories \
  "$@" 2>&1
