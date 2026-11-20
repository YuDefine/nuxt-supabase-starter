<!-- Clade native rule; source: adapters/claude/instructions/rules/core/threshold-remediation.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude threshold review transport

When the shared threshold rule requires the read-only Opus 5.5 structural review, use the Claude review transport. The seat depends on the main line's model and is read from the "唯讀結構審查席（依主線 model 決定）" line of [[agent-routing.routing-table]] § 主線 residency; this rule NEVER hard-codes a seat name:

`Agent({ subagent_type: '<seat that line names for the current main line>', run_in_background: false, prompt: <read-only brief> })`

Omit `model`: the seat's frontmatter pins Opus 5.5 and its effort. NEVER use `Plan` with `model: 'opus'` instead: the `Agent` tool has no effort parameter, so `Plan` inherits the main line's effort, which on a Sonnet main line means Opus at high. The routing gate refuses a seat that does not match the main line, so if that line names none for this main line (or the model is unreadable), do not pick one yourself.

The brief MUST include the threshold, measured history, current remediation and measured reduction. The reviewer only returns advice and reasons; it NEVER edits files. If this transport or Opus 5.5 is unavailable, keep the remediation gate incomplete and report the concrete capability gap; NEVER substitute a banned model (Fable, Haiku, Sonnet — Sonnet 5.5 only sits the implementation rows — and the rest of the shared banned list).
