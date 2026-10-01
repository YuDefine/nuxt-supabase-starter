<!-- Clade native rule; source: adapters/claude/instructions/rules/core/threshold-remediation.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude threshold review transport

When the shared threshold rule requires the read-only Opus 5.5 structural review, use the Claude review transport:

`Agent({ subagent_type: 'opus-advisor', run_in_background: false, prompt: <read-only brief> })`

`opus-advisor`'s frontmatter pins Opus 5.5 at effort medium. NEVER use `Plan` with `model: 'opus'` instead: the `Agent` tool has no effort parameter, so `Plan` inherits the main line's effort, which on a Sonnet main line means Opus at high.

The brief MUST include the threshold, measured history, current remediation and measured reduction. The reviewer only returns advice and reasons; it NEVER edits files. If this transport or Opus 5.5 is unavailable, keep the remediation gate incomplete and report the concrete capability gap; NEVER substitute a banned model (Fable, Haiku, Sonnet — Sonnet 5.5 only sits the implementation rows — and the rest of the shared banned list).
